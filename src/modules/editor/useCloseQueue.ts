import { useCallback, useEffect, useRef, useState } from "react";

import { useToast } from "@/components";
import { errorMessage, m } from "@/i18n";

import type { UnsavedAnswer } from "./components/UnsavedCloseDialog";
import { documentSave, useSavesOnDemand } from "./state/documentSaves";
import type { EditorDocumentBase } from "./types";

/** The question standing over one document whose close would lose edits. */
export interface UnsavedQuestion {
  documentId: string;
  /** The document's tab title, which the question names. */
  title: string | undefined;
  /** This document offers a save on demand, which is what puts Save in the question. */
  saves: boolean;
}

export interface CloseQueue {
  /** Close one document, asking first where it holds unsaved edits. */
  closeOne: (id: string) => void;
  /** Close every unpinned document but one. */
  closeOthers: (id: string) => void;
  /** Close every unpinned document after one, in strip order. */
  closeToRight: (id: string) => void;
  /** Close every unpinned document. */
  closeAll: () => void;
  /** The question on screen, or null while none stands. */
  question: UnsavedQuestion | null;
  /** The standing question's save is being written. */
  saving: boolean;
  answer: (answer: UnsavedAnswer) => void;
}

export interface CloseQueueOptions<D extends EditorDocumentBase> {
  documents: readonly D[];
  /** Documents whose editor has reported unsaved edits. */
  dirtyIds: ReadonlySet<string>;
  /** Documents a user pinned, which a batch close passes over. */
  pinnedIds: readonly string[];
  /** One document's tab title, for what its question names. */
  titleOf: (document: D) => string | undefined;
  onClose: (id: string) => void;
  /** Brings a queued document to the front, so its question stands over it. */
  onActivate: (id: string) => void;
}

/** A batch close over `ids` has work: one of them is unpinned. */
export function anyClosable(ids: readonly string[], pinnedIds: readonly string[]): boolean {
  return ids.some((id) => !pinnedIds.includes(id));
}

/**
 * The four closes, and the question a close with unsaved edits asks.
 *
 * Per "The unsaved-edits question" in `docs/ux/PROJECT_EDITOR.md`. A queue
 * rather than one document, because Close Others can meet several unsaved
 * editors at once.
 */
export function useCloseQueue<D extends EditorDocumentBase>({
  documents,
  dirtyIds,
  pinnedIds,
  titleOf,
  onClose,
  onActivate,
}: CloseQueueOptions<D>): CloseQueue {
  const [queue, setQueue] = useState<readonly D[]>([]);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  /** The strip's own order, minus whatever a pin holds back. */
  const closableIds = useCallback(
    (candidates: readonly D[]) =>
      candidates.filter((document) => !pinnedIds.includes(document.id)).map((it) => it.id),
    [pinnedIds],
  );

  /** Close what can go now, and queue whatever would lose edits. */
  const requestClose = useCallback(
    (ids: readonly string[]) => {
      const pending: D[] = [];
      for (const id of ids) {
        const document = documents.find((candidate) => candidate.id === id);
        if (document && dirtyIds.has(id)) pending.push(document);
        else onClose(id);
      }
      if (pending.length === 0) return;

      setQueue((standing) => {
        const added = pending.filter(
          (document) => !standing.some((queued) => queued.id === document.id),
        );
        return added.length === 0 ? standing : [...standing, ...added];
      });
    },
    [documents, dirtyIds, onClose],
  );

  const closeOne = useCallback((id: string) => requestClose([id]), [requestClose]);

  const closeOthers = useCallback(
    (id: string) => requestClose(closableIds(documents.filter((document) => document.id !== id))),
    [closableIds, documents, requestClose],
  );

  const closeToRight = useCallback(
    (id: string) => {
      const from = documents.findIndex((document) => document.id === id);
      if (from < 0) return;
      requestClose(closableIds(documents.slice(from + 1)));
    },
    [closableIds, documents, requestClose],
  );

  const closeAll = useCallback(
    () => requestClose(closableIds(documents)),
    [closableIds, documents, requestClose],
  );

  const pending = queue[0] ?? null;
  const pendingId = pending?.id ?? null;
  const title = pending ? titleOf(pending) : undefined;
  const saves = useSavesOnDemand(pendingId);

  /* Guarded by the id rather than by the effect's own dependencies: a host
     passing a fresh `onActivate` each render would re-activate on every one. */
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (pendingId === null) {
      asked.current = null;
      return;
    }
    if (asked.current === pendingId) return;
    asked.current = pendingId;
    onActivate(pendingId);
  }, [pendingId, onActivate]);

  /** Drop the document the question names, and stand the next one up. */
  function closePending() {
    if (!pending) return;

    onClose(pending.id);
    setQueue((standing) => standing.filter((queued) => queued.id !== pending.id));
  }

  async function savePending() {
    if (!pending) return;

    const save = documentSave(pending.id);
    if (!save) return;

    setSaving(true);
    try {
      await save();
      closePending();
    } catch (error) {
      toast.toast({
        type: "error",
        title: m.editor_unsaved_save_failed_hint({
          title: title ?? pending.id,
          reason: errorMessage(error),
        }),
        error,
      });
      setQueue([]);
    } finally {
      setSaving(false);
    }
  }

  function answer(answer: UnsavedAnswer) {
    if (answer === "save") {
      void savePending();
      return;
    }
    if (answer === "discard") {
      closePending();
      return;
    }
    setQueue([]);
  }

  return {
    closeOne,
    closeOthers,
    closeToRight,
    closeAll,
    question: pendingId === null ? null : { documentId: pendingId, title, saves },
    saving,
    answer,
  };
}
