import { create } from "zustand";

import type { ReferenceQuery } from "@/lib/tauri";

/** One question a menu asks, with what the References header reads. */
export interface ReferenceQuestion {
  readonly query: ReferenceQuery;
  /** The class name or the object path, the hash where no table names it. */
  readonly label: string;
}

/** One question the References document answers, and the project it was asked from. */
export interface ReferenceRequest extends ReferenceQuestion {
  /** The project whose layers a walk reads beside the install. Null on no project. */
  readonly project: string | null;
}

interface ReferencesStore {
  /** The question on screen, or null while the tab has been asked none. */
  request: ReferenceRequest | null;
  /** Ask a new question, which replaces the last and its answer. */
  ask: (request: ReferenceRequest) => void;
  /** Declaring files the user has shut, by the key of their asset. */
  shutFiles: ReadonlySet<string>;
  toggleFile: (key: string) => void;
  /** Collapse every one of `keys`, the files of the answer on screen. */
  collapseFiles: (keys: readonly string[]) => void;
}

/**
 * What the References document is answering, held outside the document that draws it.
 *
 * The objects browser's store keeps its state for the same reason: the leaf a preview
 * splits remounts the document under it. One store across the projects, because one
 * query reads one install, and a request names the project a walk reads beside it.
 */
export const useReferencesStore = create<ReferencesStore>()((set) => ({
  request: null,
  /* The shut files belong to the answer, so a new question opens every group of its own. */
  ask: (request) => set({ request, shutFiles: new Set() }),
  shutFiles: new Set(),
  toggleFile: (key) =>
    set((state) => {
      const next = new Set(state.shutFiles);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { shutFiles: next };
    }),
  collapseFiles: (keys) => set((state) => ({ shutFiles: new Set([...state.shutFiles, ...keys]) })),
}));

export const useReferenceRequest = () => useReferencesStore((s) => s.request);
export const useAskReferences = () => useReferencesStore((s) => s.ask);
export const useShutReferenceFiles = () => useReferencesStore((s) => s.shutFiles);
export const useToggleReferenceFile = () => useReferencesStore((s) => s.toggleFile);
export const useCollapseReferenceFiles = () => useReferencesStore((s) => s.collapseFiles);
