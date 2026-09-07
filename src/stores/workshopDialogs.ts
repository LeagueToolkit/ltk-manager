import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { FantomePeekResult, WorkshopProject } from "@/lib/tauri";

interface WorkshopDialogsStore {
  packProject: WorkshopProject | null;
  deleteProject: WorkshopProject | null;
  renameProject: WorkshopProject | null;
  newProjectOpen: boolean;
  fantomeImport: { peekResult: FantomePeekResult; filePath: string } | null;
  gitImportOpen: boolean;
  bulkPackProjects: WorkshopProject[];
  bulkDeleteProjects: WorkshopProject[];
  lastAuthorName: string;

  openPackDialog: (project: WorkshopProject) => void;
  closePackDialog: () => void;
  openDeleteDialog: (project: WorkshopProject) => void;
  closeDeleteDialog: () => void;
  openRenameDialog: (project: WorkshopProject) => void;
  closeRenameDialog: () => void;
  openNewProjectDialog: () => void;
  closeNewProjectDialog: () => void;
  openFantomeImportDialog: (peekResult: FantomePeekResult, filePath: string) => void;
  closeFantomeImportDialog: () => void;
  openGitImportDialog: () => void;
  closeGitImportDialog: () => void;
  openBulkPackDialog: (projects: WorkshopProject[]) => void;
  closeBulkPackDialog: () => void;
  openBulkDeleteDialog: (projects: WorkshopProject[]) => void;
  closeBulkDeleteDialog: () => void;
  setLastAuthorName: (name: string) => void;
}

export const useWorkshopDialogsStore = create<WorkshopDialogsStore>()(
  persist(
    (set) => ({
      packProject: null,
      deleteProject: null,
      renameProject: null,
      newProjectOpen: false,
      fantomeImport: null,
      gitImportOpen: false,
      bulkPackProjects: [],
      bulkDeleteProjects: [],
      lastAuthorName: "",

      openPackDialog: (project) => set({ packProject: project }),
      closePackDialog: () => set({ packProject: null }),
      openDeleteDialog: (project) => set({ deleteProject: project }),
      closeDeleteDialog: () => set({ deleteProject: null }),
      openRenameDialog: (project) => set({ renameProject: project }),
      closeRenameDialog: () => set({ renameProject: null }),
      openNewProjectDialog: () => set({ newProjectOpen: true }),
      closeNewProjectDialog: () => set({ newProjectOpen: false }),
      openFantomeImportDialog: (peekResult, filePath) =>
        set({ fantomeImport: { peekResult, filePath } }),
      closeFantomeImportDialog: () => set({ fantomeImport: null }),
      openGitImportDialog: () => set({ gitImportOpen: true }),
      closeGitImportDialog: () => set({ gitImportOpen: false }),
      openBulkPackDialog: (projects) => set({ bulkPackProjects: projects }),
      closeBulkPackDialog: () => set({ bulkPackProjects: [] }),
      openBulkDeleteDialog: (projects) => set({ bulkDeleteProjects: projects }),
      closeBulkDeleteDialog: () => set({ bulkDeleteProjects: [] }),
      setLastAuthorName: (name) => set({ lastAuthorName: name }),
    }),
    {
      name: "workshop-dialogs",
      partialize: (state) => ({ lastAuthorName: state.lastAuthorName }),
    },
  ),
);
