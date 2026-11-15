import { useQuery } from "@tanstack/react-query";
import { type ReactNode, use, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useToast } from "@/components";
import { errorSummary, m } from "@/i18n";
import {
  api,
  type AssetRef,
  type BinDocumentId,
  type NewObject,
  type PropertyEdit,
  type ReadOnly,
  type UiFile,
} from "@/lib/tauri";

import { useSandbox } from "../../../sandbox/state/SandboxContext";
import { sandboxProject } from "../../../sandbox/utils/sandboxRef";
import { binSaveKey, queueForSave } from "../../../state";
import { useBinDocument, type VariantOf } from "../../documents/hooks/useBinDocument";
import { type DocumentCall, useDocumentCall } from "../../documents/hooks/useDocumentCall";
import { lendHistory } from "../../documents/state/historyLoans";
import { useInvalidateBinReads } from "../../tree/hooks/useBinEdit";
import { LeafEditContext } from "../../tree/hooks/useLeafEdit";
import { uiQueries } from "../api/uiQueries";
import { variantSlots } from "../engine/model/variants";
import type { ViewSource } from "../hooks/useAtlasSources";
import { type AtlasEdit, AtlasEditContext } from "../state/atlasEdit";
import { useViewVariant, viewKey } from "../state/atlasPreview";

export interface AtlasEditScopeProps {
  readonly document: BinDocumentId;
  readonly entry: string;
  /** A view controller's shell, or the shell of an element of the scene bin open as `document`. */
  readonly source: ViewSource;
  readonly children: ReactNode;
}

/**
 * Where the edits of the Atlas shell under it land, per "Edits through `bin_edit`" in
 * docs/plans/atlas-ui-editor.md.
 *
 * An element's shell edits the scene bin its tab holds. A controller's shell opens the base scene
 * bin its view names, draws the view from that open document so an edit shows before its save,
 * and lends the bin's history to the controller's tab so the undo keys reach the canvas's edits.
 * With a variant drawn, it opens the variant laid over that bin in its place, which in a project
 * declares into the variant.
 */
export function AtlasEditScope({ document, entry, source, children }: AtlasEditScopeProps) {
  if (source === "scene") return <TabScope document={document}>{children}</TabScope>;
  return (
    <ControllerScope document={document} entry={entry}>
      {children}
    </ControllerScope>
  );
}

function TabScope({ document, children }: { document: BinDocumentId; children: ReactNode }) {
  const leaf = use(LeafEditContext);
  const toast = useToast();
  const send = leaf?.send;
  const landed = leaf?.landed;

  const edit = useMemo<AtlasEdit>(
    () => ({
      scene: document,
      variant: null,
      asset: null,
      editable: send !== undefined && landed !== undefined,
      readOnly: null,
      apply: (edits) =>
        send === undefined || landed === undefined
          ? Promise.resolve(false)
          : applyEdits(send, landed, edits, toast.error),
      create: (name, origin) =>
        send === undefined || landed === undefined
          ? Promise.resolve(null)
          : createObject(send, landed, name, origin, toast.error),
      remove: (entries) =>
        send === undefined || landed === undefined
          ? Promise.resolve(false)
          : removeObjects(send, landed, entries, toast.error),
    }),
    [document, send, landed, toast],
  );
  return <AtlasEditContext value={edit}>{children}</AtlasEditContext>;
}

/** A bin's open, as its opener reports it. */
interface OpenScene {
  readonly document: BinDocumentId;
  readonly editable: boolean;
  readonly readOnly: ReadOnly | null;
}

type Reopen = { current: (() => Promise<BinDocumentId | null>) | null };

function ControllerScope({
  document,
  entry,
  children,
}: {
  document: BinDocumentId;
  entry: string;
  children: ReactNode;
}) {
  const files = useViewFiles(document, entry);
  const base = files?.find((file) => file.role === "base")?.asset ?? null;
  const drawn = useViewVariant(viewKey(document, entry));
  const variant = useVariantOpen(files, drawn);
  const declares = sandboxProject(useSandbox()) !== null;

  const [scene, setScene] = useState<OpenScene | null>(null);
  const [declared, setDeclared] = useState<OpenScene | null>(null);
  const reopenScene: Reopen = useRef(null);
  const reopenVariant: Reopen = useRef(null);
  /* A drawn variant takes the edits, and with none open the view takes none. */
  const active = drawn === null ? scene : declared;
  const activeReopen = useRef(reopenScene);
  activeReopen.current = drawn === null ? reopenScene : reopenVariant;

  const send = useDocumentCall(
    active?.document ?? null,
    useCallback(() => activeReopen.current.current?.(), []),
  );
  const landed = useLanded(drawn === null ? base : (variant?.asset ?? null));
  const toast = useToast();

  useEffect(() => {
    if (active === null || !active.editable) return;

    return lendHistory(document, async (step) => {
      const run = step === "undo" ? api.bin.undo : api.bin.redo;
      const { result, id } = await send((id) => run(id));
      if (!result.ok) {
        const title =
          step === "undo" ? m.workshop_bin_undo_failed_title() : m.workshop_bin_redo_failed_title();
        toast.failure(title, result.error);
        return true;
      }
      if (result.value === null) return false;

      landed(id);
      return true;
    });
  }, [document, active, send, landed, toast]);

  const edit = useMemo<AtlasEdit>(
    () => ({
      scene: scene?.document ?? null,
      variant: drawn === null ? null : (declared?.document ?? null),
      asset: base,
      editable: active?.editable ?? false,
      readOnly: active?.readOnly ?? scene?.readOnly ?? null,
      apply: (edits) =>
        active?.editable === true
          ? applyEdits(send, landed, edits, toast.error)
          : Promise.resolve(false),
      create: (name, origin) =>
        active?.editable === true
          ? createObject(send, landed, name, origin, toast.error)
          : Promise.resolve(null),
      remove: (entries) =>
        active?.editable === true
          ? removeObjects(send, landed, entries, toast.error)
          : Promise.resolve(false),
    }),
    [scene, declared, drawn, active, base, send, landed, toast],
  );

  return (
    <>
      {base !== null && <SceneOpener asset={base} onOpen={setScene} reopen={reopenScene} />}
      {base !== null && variant !== null && declares && (
        <SceneOpener
          asset={variant.asset}
          variantOf={{ base, path: variant.path }}
          onOpen={setDeclared}
          reopen={reopenVariant}
        />
      )}
      <AtlasEditContext value={edit}>{children}</AtlasEditContext>
    </>
  );
}

/** The loadables the view's controller links, read once from the view. */
function useViewFiles(document: BinDocumentId, entry: string): readonly UiFile[] | null {
  const [held, setHeld] = useState<readonly UiFile[] | null>(null);
  const read = useQuery({ ...uiQueries.view(document, entry), enabled: held === null }).data;

  useEffect(() => {
    if (read !== undefined) setHeld((previous) => previous ?? read.files);
  }, [read]);
  return held ?? read?.files ?? null;
}

/** The drawn variant's chunk and path where it opens for edits: shipped, and one the PC lays. */
function useVariantOpen(
  files: readonly UiFile[] | null,
  drawn: string | null,
): { readonly asset: AssetRef; readonly path: string } | null {
  return useMemo(() => {
    const file = files?.find((each) => each.role === "override" && each.slot === drawn);
    if (file?.asset == null) return null;

    const [slot] = variantSlots([file]);
    return slot.onPc ? { asset: file.asset, path: file.path } : null;
  }, [files, drawn]);
}

/** Queue the save of an edit that landed on the bin `id` of `asset`, and read every bin again. */
function useLanded(asset: AssetRef | null): (id: BinDocumentId) => void {
  const sandbox = useSandbox();
  const invalidate = useInvalidateBinReads();
  return useCallback(
    (id: BinDocumentId) => {
      if (asset !== null) queueForSave(binSaveKey(sandbox, asset), id);
      invalidate();
    },
    [asset, sandbox, invalidate],
  );
}

function SceneOpener({
  asset,
  variantOf = null,
  onOpen,
  reopen,
}: {
  asset: AssetRef;
  variantOf?: VariantOf | null;
  onOpen: (open: OpenScene | null) => void;
  reopen: Reopen;
}) {
  const { state, reopen: reopenScene } = useBinDocument(asset, null, "lingering", variantOf);
  reopen.current = reopenScene;
  const document = state.status === "open" ? state.handle.document : null;
  const readOnly = state.status === "open" ? state.handle.readOnly : null;
  const editable = state.status === "open" && readOnly === null;

  useEffect(() => {
    onOpen(document === null ? null : { document, editable, readOnly });
  }, [document, editable, readOnly, onOpen]);
  useEffect(() => () => onOpen(null), [onOpen]);
  return null;
}

async function applyEdits(
  send: DocumentCall,
  landed: (id: BinDocumentId) => void,
  edits: readonly PropertyEdit[],
  refuse: (title: string, description: string) => void,
): Promise<boolean> {
  if (edits.length === 0) return true;

  const { result, id } = await send((id) =>
    api.bin.edit(id, { kind: "editProperties", edits: [...edits] }),
  );
  if (!result.ok) {
    refuse(m.workshop_bin_edit_refused_title(), errorSummary(result.error));
    return false;
  }

  landed(id);
  return true;
}

async function createObject(
  send: DocumentCall,
  landed: (id: BinDocumentId) => void,
  name: string,
  origin: NewObject,
  refuse: (title: string, description: string) => void,
): Promise<string | null> {
  const { result, id } = await send((id) =>
    api.bin.edit(id, { kind: "object", edit: { kind: "create", name, origin } }),
  );
  if (!result.ok) {
    refuse(m.workshop_bin_edit_refused_title(), errorSummary(result.error));
    return null;
  }

  landed(id);
  return result.value.kind === "object" ? result.value.entry : null;
}

async function removeObjects(
  send: DocumentCall,
  landed: (id: BinDocumentId) => void,
  entries: readonly string[],
  refuse: (title: string, description: string) => void,
): Promise<boolean> {
  for (const entry of entries) {
    const { result, id } = await send((id) =>
      api.bin.edit(id, { kind: "object", edit: { kind: "remove", entry } }),
    );
    if (!result.ok) {
      refuse(m.workshop_bin_edit_refused_title(), errorSummary(result.error));
      return false;
    }

    landed(id);
  }
  return true;
}
