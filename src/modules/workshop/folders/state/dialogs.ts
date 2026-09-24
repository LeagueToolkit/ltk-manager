import type { FolderInspection } from "@/lib/tauri";
import { createDialogStore } from "@/stores/createDialogStore";

/** A picked folder with no config, and what it holds. */
export interface FolderConversion {
  path: string;
  inspection: Extract<FolderInspection, { kind: "fantome" } | { kind: "plain" }>;
}

export const useConvertFolderDialog = createDialogStore<FolderConversion>();

/** A picked folder whose subfolders are the mods. */
export interface FolderBatch {
  path: string;
  projects: string[];
  fantome: string[];
}

export const useAddFoldersDialog = createDialogStore<FolderBatch>();
