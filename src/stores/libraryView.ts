import { create } from "zustand";
import { persist } from "zustand/middleware";

import { persistentJsonStorage } from "./storage";

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
      migrate: (persisted, version) => {
        const state = persisted as { expandedFolders?: Set<string> | string[] };
        if (version === 0 && Array.isArray(state.expandedFolders)) {
          return { ...state, expandedFolders: new Set(state.expandedFolders) };
        }
        return persisted as LibraryViewStore;
      },
      partialize: (state) => ({
        expandedFolders: state.expandedFolders,
      }),
      storage: persistentJsonStorage,
    },
  ),
);
