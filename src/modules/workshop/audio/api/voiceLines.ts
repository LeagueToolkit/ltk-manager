import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import { useToast } from "@/components/Toast";
import { m } from "@/i18n";
import {
  api,
  type AppError,
  type AssetRef,
  type BinDocumentId,
  type BinEdit,
  type ClassChoice,
  type Declaring,
  type SandboxRef,
  type VoiceLinesResponse,
  type VoiceSkin,
} from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import { openGated } from "../../bin/documents/hooks/useBinDocument";
import { useDeclarationsOn } from "../../bin/documents/hooks/useDeclared";
import type { Reopen } from "../../bin/documents/hooks/useDocumentCall";
import { nameHash } from "../../bin/shared/utils/binHash";
import { useInvalidateBinReads } from "../../bin/tree/hooks/useBinEdit";
import { useLeafEdit } from "../../bin/tree/hooks/useLeafEdit";
import { objectDocument } from "../../documents/utils/contentDocument";
import { useSandbox } from "../../sandbox/state/SandboxContext";
import { sandboxKey, sandboxProject } from "../../sandbox/utils/sandboxRef";
import {
  announceBinEdit,
  binSaveKey,
  flushBinSave,
  queueForSave,
  useOpenDocumentAs,
} from "../../state";
import { useChooseVoiceSkin } from "../state/voiceLines";
import { copyObjectName } from "../utils/voiceLines";

/** The query root of every voice lines read, which a bin edit leaves stale. */
const VOICE_LINES = "audio-voice-lines";

export const voiceLinesQueries = {
  /* Keyed on the open document, so an edit of it reads again through `useInvalidateBinReads`. */
  of: (sandbox: SandboxRef, document: BinDocumentId, entry: string, skin: string | null) =>
    queryOptions<VoiceLinesResponse, AppError>({
      queryKey: [VOICE_LINES, sandboxKey(sandbox), document, entry, skin] as const,
      queryFn: async () =>
        unwrapForQuery(await api.audioVoiceLines(sandbox, document, entry, skin)),
      placeholderData: keepPreviousData,
      retry: false,
    }),
  /* The classes the conditions list at `path` takes, which Add condition offers. */
  conditionClasses: (document: BinDocumentId, entry: string, path: string) =>
    queryOptions<ClassChoice[], AppError>({
      queryKey: [VOICE_LINES, "condition-classes", document, entry, path] as const,
      queryFn: async () => {
        const answer = unwrapForQuery(
          await api.bin.choices(document, { kind: "itemClasses", entry, path }),
        );
        return answer.kind === "classes" ? answer.classes : [];
      },
      staleTime: Infinity,
      retry: false,
    }),
};

/** Reads the voice lines of the object `entry` of the open document, resolved as `skin`. */
export function useVoiceLines(document: BinDocumentId, entry: string, skin: string | null) {
  return useQuery(voiceLinesQueries.of(useSandbox(), document, entry, skin));
}

/** What a view needs to send an edit of its object's document. */
export interface VoiceDocument {
  readonly document: BinDocumentId;
  readonly asset: AssetRef;
  readonly onNotOpen: Reopen;
}

/**
 * Returns a function that sends one bin edit of the open document and resolves `true` if it
 * landed.
 *
 * Each edit is one step of the document's history (ADR-0051), and the save queues where it landed,
 * as a tree edit's does. A refusal is stated in a toast.
 */
export function useVoiceEdit({ document, asset, onNotOpen }: VoiceDocument) {
  const invalidate = useInvalidateBinReads();
  const { send, landed } = useLeafEdit(document, asset, invalidate, onNotOpen);
  const toast = useToast();

  return useCallback(
    async (edit: BinEdit): Promise<boolean> => {
      const { result, id } = await send((at) => api.bin.edit(at, edit));
      if (!result.ok) {
        toast.failure(m.workshop_bin_edit_refused_title(), result.error);
        return false;
      }

      landed(id);
      return true;
    },
    [landed, send, toast],
  );
}

/** Returns the clipboard text of a new rule named `name` that plays `short` for the owner. */
export async function ruleTemplate(name: string, short: string): Promise<string | null> {
  const result = await api.audioVoiceRuleTemplate(name, short);
  return result.ok ? result.value : null;
}

/** How long the copy's own open of the skin bin outlives the tab it opens. */
const LINGER_MS = 10_000;

/**
 * Returns a function that copies the object `entry` into the bin of `skin` and links the skin to
 * the copy, then opens the copy's tab.
 *
 * The copy is declared in the skin bin, named by `copyObjectName`, with `mObjectPath` set to its
 * name. The create, the rename and the relink are one `createAndEdit` edit of the skin bin, so one
 * undo in that bin reverts all three. ADR-0073.
 */
export function useCopyForSkin(
  view: VoiceDocument & { readonly entry: string; readonly object: string },
) {
  const sandbox = useSandbox();
  const declaring: Declaring =
    useDeclarationsOn(sandboxProject(sandbox) ?? undefined) === true ? "on" : "off";
  const open = useOpenDocumentAs();
  const choose = useChooseVoiceSkin();
  const toast = useToast();

  return useCallback(
    async (skin: VoiceSkin): Promise<boolean> => {
      const name = copyObjectName(view.object, skin.bin);
      const asset = skin.row.asset;
      if (name === null || asset === null) {
        toast.error(m.audio_voice_copy_failed_title(), m.audio_voice_copy_unnamed_description());
        return false;
      }

      const refuse = (error: AppError) => {
        toast.failure(m.audio_voice_copy_failed_title(), error);
        return false;
      };

      const copied = await api.bin.copyValue(view.document, view.entry, "");
      if (!copied.ok) return refuse(copied.error);

      const opened = await openGated(sandbox, asset, skin.row.objectHash, null, () => declaring);
      if (!opened.ok) return refuse(opened.error);

      const id = opened.value.document;
      const entry = nameHash(name);
      const edited = await api.bin.edit(id, {
        kind: "createAndEdit",
        objects: [{ name, origin: { type: "paste", text: copied.value } }],
        edits: [
          {
            entry,
            holder: "",
            field: nameHash("mObjectPath"),
            edits: [{ type: "setLeaf", path: "", value: { type: "string", value: name } }],
          },
          {
            entry: skin.row.objectHash,
            holder: "",
            field: nameHash("mContextualActionData"),
            edits: [{ type: "setLeaf", path: "", value: { type: "objectLink", text: name } }],
          },
        ],
      });
      if (!edited.ok) {
        void api.bin.close(id);
        toast.failure(m.audio_voice_copy_failed_title(), edited.error);
        return false;
      }

      const key = binSaveKey(sandbox, asset);
      queueForSave(key, id);
      announceBinEdit(key);
      choose(entry, skin.bin);
      open(objectDocument(asset, entry, name, skin.bin, "ContextualActionData"), "default");
      toast.success(m.audio_voice_copy_done_title({ name }));
      setTimeout(() => void flushBinSave(key).finally(() => void api.bin.close(id)), LINGER_MS);
      return true;
    },
    [choose, declaring, open, sandbox, toast, view.document, view.entry, view.object],
  );
}
