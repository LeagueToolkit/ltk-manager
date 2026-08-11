import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { ViewMode } from "@/modules/workshop";

import { persistentJsonStorage } from "./storage";

interface WorkshopViewStore {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

export const useWorkshopViewStore = create<WorkshopViewStore>()(
  persist(
    (set) => ({
      viewMode: "grid",
      setViewMode: (mode) => set({ viewMode: mode }),
      searchQuery: "",
      setSearchQuery: (query) => set({ searchQuery: query }),
    }),
    {
      name: "ltk-workshop-view",
      storage: persistentJsonStorage,
    },
  ),
);
