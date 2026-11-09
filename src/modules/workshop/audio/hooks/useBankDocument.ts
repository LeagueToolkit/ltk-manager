import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { match } from "ts-pattern";

import { useToast } from "@/components";
import { errorSummary, m } from "@/i18n";
import {
  api,
  type AssetRef,
  type AudioBankState,
  type BankEdit,
  type MediaReplacement,
  type NodeParent,
} from "@/lib/tauri";
import { type HistoryStep, useDocumentHistory, useDocumentSave } from "@/modules/editor";

import { previewDocument } from "../../documents/utils/contentDocument";
import { assetKey } from "../../preview/utils/assetRef";
import { useOptionalProjectContext } from "../../projects/state/ProjectContext";
import { useSandbox } from "../../sandbox/state/SandboxContext";
import { useWorkshopEditorStore } from "../../state";
import type { BankRevision } from "../api/queries";
import { afterEdit, afterStep, type HistoryDepth, NO_HISTORY } from "../utils/bankHistory";

/** An event bank held open for edits, and what the event tree does to it. */
export interface BankDocument {
  /** The open document's state, and null while none is open. */
  readonly state: AudioBankState | null;
  /** The revision that reads apply the edits of, and null while no document is open. */
  readonly revision: BankRevision | null;
  /** Upgrades an older bank to version 145. Resolves false, after a toast, if it was refused. */
  readonly upgrade: () => Promise<boolean>;
  /** The reason why the bank cannot be edited, or null if it takes edits or is not a hierarchy bank. */
  readonly readOnlyReason: "game" | "no_project" | "legacy" | null;
  /** Applies `edit` as one undo step. Resolves false, after a toast, if it was refused. */
  readonly edit: (edit: BankEdit) => Promise<boolean>;
  /**
   * Adds the WEM file at `file` as a new sound under `parent`, as one undo step. Resolves false,
   * after a toast, if it was refused.
   */
  readonly importWem: (parent: NodeParent, file: string) => Promise<boolean>;
  /**
   * Reads what replacing the media `source` with the file at `file` writes. Resolves null, after
   * a toast, if the file or the media takes no replacement.
   */
  readonly previewReplace: (source: number, file: string) => Promise<MediaReplacement | null>;
  /**
   * Replaces the media `source` with the file at `file`, as one undo step. Resolves false, after
   * a toast, if it was refused.
   */
  readonly replaceMedia: (source: number, file: string) => Promise<boolean>;
  /** Steps the history back or forward. Resolves false if it took no step. */
  readonly step: (step: HistoryStep) => Promise<boolean>;
  /** Writes the unsaved edits. Rejects, after a toast, if the save fails. */
  readonly save: () => Promise<void>;
  /** The undo and redo steps that the document counted since it opened. */
  readonly history: HistoryDepth;
}

/**
 * Holds the event bank `asset` open for edits in a project sandbox while `enabled`, and closes
 * it after.
 *
 * `documentId` is the tab's id. The tab takes the unsaved dot, `Ctrl+S` and the undo keys, as
 * the bin document's tab does. A save of a game bank that the first edit copied into the
 * project puts the layer file in the tab. Per "Editing" in docs/ux/AUDIO.md.
 */
export function useBankDocument(
  asset: AssetRef,
  documentId: string | null,
  enabled: boolean,
): BankDocument {
  const sandbox = useSandbox();
  const project = useOptionalProjectContext()?.path ?? null;
  const open = enabled && documentId !== null && sandbox.kind !== "game" && project !== null;
  const [state, setState] = useState<AudioBankState | null>(null);
  const [history, setHistory] = useState<HistoryDepth>(NO_HISTORY);
  const toast = useToast();
  const queryClient = useQueryClient();
  const latest = useRef(state);
  latest.current = state;

  /* Keyed by its text, so a fresh object for the same file keeps the document open. */
  const key = assetKey(asset);
  const held = useRef({ asset, sandbox });
  held.current = { asset, sandbox };

  useEffect(() => {
    if (!open) return;

    let id: number | null = null;
    let closed = false;
    const { asset: opening, sandbox: within } = held.current;
    void api.audioBankOpen(within, opening).then((opened) => {
      if (!opened.ok) {
        toast.error(m.audio_edit_open_failed_title(), errorSummary(opened.error));
        return;
      }
      if (closed) {
        void api.audioBankClose(opened.value.id);
        return;
      }
      id = opened.value.id;
      setState(opened.value);
    });

    return () => {
      closed = true;
      setState(null);
      setHistory(NO_HISTORY);
      if (id !== null) void api.audioBankClose(id);
    };
  }, [key, open, toast]);

  const upgrade = useCallback(async () => {
    const current = latest.current;
    if (current === null) return false;

    const result = await api.audioBankUpgrade(current.id);
    if (!result.ok) {
      toast.error(m.audio_edit_refused_title(), errorSummary(result.error));
      return false;
    }
    setState(result.value);
    setHistory(afterEdit);
    void invalidateBinReads(queryClient);
    return true;
  }, [queryClient, toast]);

  const edit = useCallback(
    async (change: BankEdit) => {
      const current = latest.current;
      if (current === null) return false;

      const result = await api.audioBankEdit(current.id, change);
      if (!result.ok) {
        toast.error(m.audio_edit_refused_title(), errorSummary(result.error));
        return false;
      }
      setState(result.value);
      setHistory(afterEdit);
      void invalidateBinReads(queryClient);
      return true;
    },
    [queryClient, toast],
  );

  const importWem = useCallback(
    async (parent: NodeParent, file: string) => {
      const current = latest.current;
      if (current === null) return false;

      const result = await api.audioBankImport(current.id, parent, file);
      if (!result.ok) {
        toast.error(m.audio_edit_import_failed_title(), errorSummary(result.error));
        return false;
      }
      setState(result.value);
      setHistory(afterEdit);
      return true;
    },
    [toast],
  );

  const previewReplace = useCallback(
    async (source: number, file: string) => {
      const current = latest.current;
      if (current === null) return null;

      const result = await api.audioBankReplacePreview(current.id, source, file);
      if (!result.ok) {
        toast.error(m.audio_replace_failed_title(), errorSummary(result.error));
        return null;
      }
      return result.value;
    },
    [toast],
  );

  const replaceMedia = useCallback(
    async (source: number, file: string) => {
      const current = latest.current;
      if (current === null) return false;

      const result = await api.audioBankReplace(current.id, source, file);
      if (!result.ok) {
        toast.error(m.audio_replace_failed_title(), errorSummary(result.error));
        return false;
      }
      setState(result.value);
      setHistory(afterEdit);
      return true;
    },
    [toast],
  );

  const step = useCallback(
    async (direction: HistoryStep) => {
      const current = latest.current;
      if (current === null) return false;

      const result = await api.audioBankStep(current.id, direction === "undo");
      if (!result.ok) {
        const title =
          direction === "undo"
            ? m.audio_edit_undo_failed_title()
            : m.audio_edit_redo_failed_title();
        toast.error(title, errorSummary(result.error));
        return false;
      }
      setHistory((depth) => afterStep(depth, direction, result.value !== null));
      if (result.value === null) return false;

      setState(result.value);
      void invalidateBinReads(queryClient);
      return true;
    },
    [queryClient, toast],
  );

  const replaceDocument = useWorkshopEditorStore((store) => store.replaceDocument);
  const save = useCallback(async () => {
    const current = latest.current;
    if (current === null || !current.dirty) return;

    const result = await api.audioBankSave(current.id);
    if (!result.ok) {
      toast.error(m.audio_edit_save_failed_title(), errorSummary(result.error));
      throw new Error(m.audio_edit_save_failed_title());
    }
    setState(result.value);

    const saved = result.value.asset;
    if (project !== null && documentId !== null && assetKey(saved) !== key) {
      replaceDocument(project, documentId, previewDocument(saved));
    }
  }, [documentId, key, project, replaceDocument, toast]);

  const tab = documentId ?? `audio-bank:${key}`;
  const dirty = state?.dirty === true;
  const setDocumentDirty = useWorkshopEditorStore((store) => store.setDocumentDirty);
  useEffect(() => {
    if (project === null) return;

    setDocumentDirty(project, tab, dirty);
    return () => setDocumentDirty(project, tab, false);
  }, [project, tab, dirty, setDocumentDirty]);
  useDocumentSave(tab, save);

  const stepFromKeys = useCallback(
    (direction: HistoryStep, target: Element | null) => {
      if (target?.closest("[data-draft]")) return false;

      void step(direction);
      return true;
    },
    [step],
  );
  useDocumentHistory(tab, stepFromKeys, state?.editable === true);

  const readOnlyReason = match({
    sandboxKind: sandbox.kind,
    project,
    editable: state?.editable,
  })
    .with({ sandboxKind: "game" }, () => "game" as const)
    .with({ project: null }, () => "no_project" as const)
    .with({ editable: false }, () => "legacy" as const)
    .otherwise(() => null);

  const revision = state === null ? null : { id: state.id, revision: state.revision };
  return {
    state,
    revision,
    upgrade,
    readOnlyReason,
    edit,
    importWem,
    previewReplace,
    replaceMedia,
    step,
    save,
    history,
  };
}

/**
 * Marks the reads of every open bin document stale, so a bin tab draws the unit and sound fields
 * that an edit of the bank changed in the same tree.
 */
function invalidateBinReads(queryClient: ReturnType<typeof useQueryClient>) {
  return queryClient.invalidateQueries({
    predicate: (query) => {
      const [head] = query.queryKey;
      return typeof head === "string" && head.startsWith("bin-");
    },
  });
}
