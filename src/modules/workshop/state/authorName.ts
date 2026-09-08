import { create } from "zustand";
import { persist } from "zustand/middleware";

import { keepUnversioned } from "@/stores/storage";

interface AuthorNameStore {
  lastAuthorName: string;
  setLastAuthorName: (name: string) => void;
}

/**
 * What the new-project dialog offers as the author, remembered across runs.
 *
 * The key is the dialogs store this preference used to sit in, so a name a
 * reader already has survives the split.
 */
export const useAuthorNameStore = create<AuthorNameStore>()(
  persist(
    (set) => ({
      lastAuthorName: "",
      setLastAuthorName: (name) => set({ lastAuthorName: name }),
    }),
    {
      name: "workshop-dialogs",
      version: 1,
      migrate: keepUnversioned<AuthorNameStore>,
      partialize: (state) => ({ lastAuthorName: state.lastAuthorName }),
    },
  ),
);

export const useLastAuthorName = () => useAuthorNameStore((s) => s.lastAuthorName);
export const useSetLastAuthorName = () => useAuthorNameStore((s) => s.setLastAuthorName);
