import { create } from "zustand";

/** A request that the declarations document `documentId` show the outline item `itemId`. */
export interface OutlineRevealRequest {
  documentId: string;
  itemId: string;
  /** Tells two requests for the same item apart, so the second one still lands. */
  token: number;
}

interface OutlineRevealState {
  request: OutlineRevealRequest | null;
  reveal: (documentId: string, itemId: string) => void;
  settle: (token: number) => void;
}

let nextToken = 0;

const useOutlineRevealStore = create<OutlineRevealState>((set) => ({
  request: null,
  reveal: (documentId, itemId) => {
    nextToken += 1;
    set({ request: { documentId, itemId, token: nextToken } });
  },
  settle: (token) => set((state) => (state.request?.token === token ? { request: null } : state)),
}));

/** The pending request aimed at `documentId`, or null for a document nobody aimed. */
export function useOutlineRevealRequest(documentId: string): OutlineRevealRequest | null {
  return useOutlineRevealStore((state) =>
    state.request?.documentId === documentId ? state.request : null,
  );
}

/** Ask the open declarations document `documentId` to select and show `itemId`. */
export function useRevealOutlineItem(): (documentId: string, itemId: string) => void {
  return useOutlineRevealStore((state) => state.reveal);
}

/** Drop the request with `token`. The document it addressed has answered it. */
export function useSettleOutlineReveal(): (token: number) => void {
  return useOutlineRevealStore((state) => state.settle);
}
