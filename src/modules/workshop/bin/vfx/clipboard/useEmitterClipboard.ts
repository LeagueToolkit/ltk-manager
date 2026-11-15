import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { use } from "react";

import { useToast } from "@/components";
import { useCopyToClipboard } from "@/hooks";
import { m } from "@/i18n";
import { api, type BinEdit, type ObjectCreation, type TemplateEmitter } from "@/lib/tauri";

import { emitterAtPath } from "../../curves/hooks/curvePlayhead";
import { useDeclares } from "../../documents/hooks/useDeclared";
import { useDocumentCall } from "../../documents/hooks/useDocumentCall";
import { LeafEditContext } from "../../tree/hooks/useLeafEdit";
import { RowDocumentContext } from "../../tree/state/rowFold";
import type { SystemModel } from "../engine/model/model";
import { VfxRunContext } from "../playback/state/run";
import { maskUse, stencilMasks } from "../stencil/maskModel";
import { landingEdits } from "../templates/templateEdits";
import {
  COMPLEX_LIST,
  type CopiedEmitter,
  type CopiedSystem,
  duplicateAllEdits,
  emitterCopiesText,
  type EmitterRef,
  emitterPlace,
  landingPropertyEdits,
  linkedSystems,
  readEmitterCopies,
  remappedMasks,
  removeAllEdits,
} from "./emitterCopy";
import type { EmitterClipboard } from "./emitterKeys";

/** The text the last copy wrote, which a paste reads where the webview grants no clipboard. */
let lastCopy: string | null = null;

/**
 * Duplicate, copy, paste and delete of the open system's emitters, each edit one undo step.
 *
 * A copy holds the backend's copy of each emitter and of each child system that it links by
 * `effect`, so a paste lands in any system of any open document. A refusal is a toast, as an
 * object row's own edits report theirs. "Duplicating, pasting and deleting an emitter" in
 * docs/ux/BIN_EDITOR.md.
 */
export function useEmitterClipboard(): EmitterClipboard | null {
  const edit = use(LeafEditContext);
  const document = use(RowDocumentContext);
  const call = useDocumentCall(document);
  const toast = useToast();
  const writeClipboard = useCopyToClipboard();
  const system = use(VfxRunContext)?.system ?? null;
  const declares = useDeclares();

  if (document === null) return null;

  const copyText = async (entry: string, path: string) =>
    (await call((id) => api.bin.copyValue(id, entry, path))).result;

  /** Reads the name of each system that a child of the document can link, by lowercase entry. */
  const linkable = async (): Promise<Map<string, string>> => {
    const { result } = await call((id) => api.bin.vfxChildTargets(id));
    if (!result.ok) return new Map();

    return new Map(
      result.value.map((target) => [target.entry.toLowerCase(), target.name ?? target.entry]),
    );
  };

  /* A linked system that the document does not contain, such as a resolver target, is skipped. */
  const childSystems = async (texts: readonly string[]): Promise<CopiedSystem[]> => {
    const names = await linkable();
    const queue = texts.flatMap(linkedSystems);
    const seen = new Set<string>();
    const systems: CopiedSystem[] = [];
    for (let entry = queue.shift(); entry !== undefined; entry = queue.shift()) {
      const name = names.get(entry);
      if (seen.has(entry) || name === undefined) continue;
      seen.add(entry);

      const copied = await copyText(entry, "");
      if (!copied.ok) continue;

      systems.push({ entry, name, text: copied.value });
      queue.push(...linkedSystems(copied.value));
    }
    return systems;
  };

  const copy = async (emitters: readonly EmitterRef[]) => {
    const first = emitters[0];
    if (first === undefined) return;

    const copied: CopiedEmitter[] = [];
    for (const emitter of emitters) {
      const result = await copyText(emitter.entry, emitter.wire);
      if (!result.ok) {
        toast.failure(m.workshop_bin_emitter_copy_failed_title(), result.error);
        return;
      }

      const model = emitterAtPath(system, emitter.entry, emitter.wire);
      const mask = model === undefined ? undefined : maskUse(model)?.name;
      copied.push({
        list: emitterPlace(emitter.wire)?.list ?? COMPLEX_LIST,
        text: result.value,
        mask: mask?.id === null ? mask.ref : null,
      });
    }

    const text = emitterCopiesText({
      system: first.entry.toLowerCase(),
      emitters: copied,
      systems: await childSystems(copied.map((emitter) => emitter.text)),
    });
    lastCopy = text;
    const names = emitters.map((emitter) => emitter.name).join(", ");
    await writeClipboard(text, m.workshop_bin_emitter_label(), names);
  };

  const send = edit?.send;
  const landed = edit?.landed;
  if (send === undefined || landed === undefined) {
    return { copy, duplicate: null, paste: null, remove: null, land: null };
  }

  const apply = async (request: BinEdit) => {
    const { result, id } = await send((id) => api.bin.edit(id, request));
    if (!result.ok) {
      toast.failure(m.workshop_bin_emitter_edit_failed_title(), result.error);
      return false;
    }

    landed(id);
    return true;
  };

  const duplicate = async (emitters: readonly EmitterRef[]) => {
    const edits = duplicateAllEdits(emitters[0]?.entry ?? "", emitters, declares);
    if (edits.length > 0) await apply({ kind: "editProperties", edits });
  };

  const remove = async (emitters: readonly EmitterRef[]) => {
    const edits = removeAllEdits(emitters[0]?.entry ?? "", emitters);
    if (edits.length > 0) await apply({ kind: "editProperties", edits });
  };

  if (system === null) return { copy, duplicate, paste: null, remove, land: null };

  const paste = async (entry: string, after: EmitterRef | null) => {
    const text = await readClipboard();
    const copies = text === null ? null : readEmitterCopies(text);
    if (copies === null) {
      toast.error(
        m.workshop_bin_emitter_edit_failed_title(),
        m.workshop_bin_emitter_paste_empty_description(),
      );
      return;
    }

    const place = after === null || declares ? null : emitterPlace(after.wire);
    const start = (list: string) =>
      place?.list === list ? place.index + 1 : listEnd(system, list);
    const masks =
      copies.system === entry.toLowerCase()
        ? new Map<number, number>()
        : remappedMasks(copies.emitters, stencilMasks(system));
    const edits = landingPropertyEdits(entry, copies.emitters, start, masks);

    const linked = copies.systems.length === 0 ? new Map<string, string>() : await linkable();
    const objects: ObjectCreation[] = copies.systems
      .filter((child) => !linked.has(child.entry))
      .map((child) => ({ name: child.name, origin: { type: "paste", text: child.text } }));

    await apply({ kind: "createAndEdit", objects, edits });
  };

  const land = async (
    entry: string,
    after: EmitterRef | null,
    emitters: readonly TemplateEmitter[],
  ) => {
    const place = after === null || declares ? null : emitterPlace(after.wire);
    const list = place?.list ?? COMPLEX_LIST;
    const index = place === null ? listEnd(system, COMPLEX_LIST) : place.index + 1;
    const taken = new Set(system.emitters.map((emitter) => emitter.name));
    const edits = landingEdits(emitters, index, taken);
    return apply({ kind: "editProperty", entry, holder: "", field: list, edits });
  };

  return { copy, duplicate, paste, remove, land };
}

/** The index past the last emitter of the system's list `list`. */
function listEnd(system: SystemModel, list: string): number {
  const simple = list !== COMPLEX_LIST;
  return system.emitters
    .filter((emitter) => emitter.simple === simple)
    .reduce((most, emitter) => Math.max(most, emitter.listIndex + 1), 0);
}

/**
 * The clipboard's text, else the last copy's where the read fails.
 *
 * Read through the backend, since a read of the webview's own asks the user for permission each time.
 */
async function readClipboard(): Promise<string | null> {
  try {
    return await readText();
  } catch {
    return lastCopy;
  }
}
