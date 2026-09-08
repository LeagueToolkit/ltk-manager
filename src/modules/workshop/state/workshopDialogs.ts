import type { FantomePeekResult, WorkshopProject } from "@/lib/tauri";
import { createDialogStore } from "@/stores/createDialogStore";

export const usePackDialog = createDialogStore<WorkshopProject>();
export const useDeleteProjectDialog = createDialogStore<WorkshopProject>();
export const useRenameProjectDialog = createDialogStore<WorkshopProject>();
export const useNewProjectDialog = createDialogStore();
export const useGitImportDialog = createDialogStore();
/** A fantome archive picked for import, as what was read out of it and where it sits. */
export interface FantomeImport {
  peekResult: FantomePeekResult;
  filePath: string;
}

export const useFantomeImportDialog = createDialogStore<FantomeImport>();
export const useBulkPackDialog = createDialogStore<WorkshopProject[]>();
export const useBulkDeleteDialog = createDialogStore<WorkshopProject[]>();
