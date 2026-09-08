import { create } from "zustand";
import { persist } from "zustand/middleware";

import { localJsonStorage } from "@/stores/storage";

interface LibraryViewStore {
  expandedFolders: Set<string>;

  toggleFolderExpanded: (folderId: string) => void;
  cleanupStaleFolders: (validFolderIds: Set<string>) => void;
}

export const useLibraryViewStore = create<LibraryViewStore>()(
  persist(
    (set) => ({
      expandedFolders: new Set<string>(),

      toggleFolderExpanded: (folderId) =>
        set((state) => {
          const next = new Set(state.expandedFolders);
          if (next.has(folderId)) next.delete(folderId);
          else next.add(folderId);
          return { expandedFolders: next };
        }),

      cleanupStaleFolders: (validFolderIds) =>
        set((state) => {
          const next = new Set<string>();
          for (const id of state.expandedFolders) {
            if (validFolderIds.has(id)) next.add(id);
          }
          return { expandedFolders: next };
        }),
    }),
    {
      name: "ltk-library-view",
      version: 1,
      /* Version 0 wrote the set as a bare array, which the shared codec reads
         back as one. */
      migrate: (persisted) => {
        const state = persisted as { expandedFolders?: unknown };
        return {
          ...state,
          expandedFolders: new Set(
            Array.isArray(state.expandedFolders) ? (state.expandedFolders as string[]) : [],
          ),
        } as LibraryViewStore;
      },
      storage: localJsonStorage,
      partialize: (state) => ({ expandedFolders: state.expandedFolders }),
    },
  ),
);
