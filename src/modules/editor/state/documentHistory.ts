import { useEffect, useRef } from "react";
import { create } from "zustand";

/** One step through a document's edit history. */
export type HistoryStep = "undo" | "redo";

/**
 * Taking one step through a document's history for a keystroke over `target`.
 *
 * Answers whether the document took the keystroke, so a field that keeps it for its own
 * undo is left its default behaviour.
 */
export type DocumentHistory = (step: HistoryStep, target: Element | null) => boolean;

interface DocumentHistoryStore {
  histories: Readonly<Record<string, DocumentHistory>>;
  publish: (documentId: string, history: DocumentHistory) => void;
  withdraw: (documentId: string) => void;
}

/*
 * Published by the mounted editor, the way a document's save and find are, and keyed by
 * document id alone for the same reason.
 */
const useDocumentHistoryStore = create<DocumentHistoryStore>()((set) => ({
  histories: {},
  publish: (documentId, history) =>
    set((state) => ({ histories: { ...state.histories, [documentId]: history } })),
  withdraw: (documentId) =>
    set((state) => {
      if (!(documentId in state.histories)) return state;

      const histories = { ...state.histories };
      delete histories[documentId];
      return { histories };
    }),
}));

/**
 * Offer this document's undo and redo while it is mounted and `enabled`.
 *
 * `Ctrl+Z`, `Ctrl+Shift+Z` and `Ctrl+Y` over the group reach it wherever focus is, including
 * on no element at all after a field commits. `history` is read at call time.
 */
export function useDocumentHistory(
  documentId: string,
  history: DocumentHistory,
  enabled: boolean,
): void {
  const current = useRef(history);
  useEffect(() => {
    current.current = history;
  });

  useEffect(() => {
    if (!enabled) return;

    useDocumentHistoryStore
      .getState()
      .publish(documentId, (step, target) => current.current(step, target));
    return () => useDocumentHistoryStore.getState().withdraw(documentId);
  }, [documentId, enabled]);
}

/** The history `documentId` offers, or null for a document that offers none. */
export function documentHistory(documentId: string): DocumentHistory | null {
  return useDocumentHistoryStore.getState().histories[documentId] ?? null;
}
