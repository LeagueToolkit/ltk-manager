import { invoke } from "@tauri-apps/api/core";

import type {
  AddFilesReport,
  AppError,
  AppInfo,
  BulkInstallResult,
  ContentTree,
  CreateProjectArgs,
  CslolModInfo,
  DiagnosticReport,
  EditModMetadataArgs,
  FantomePeekResult,
  HotkeyAction,
  ImportFantomeArgs,
  ImportGitRepoArgs,
  InstalledMod,
  LibraryFolder,
  ModpkgInfo,
  ModWadReport,
  PackProjectArgs,
  PackResult,
  PatcherConfig,
  PatcherStatus,
  PlatformSupport,
  Profile,
  SaveProjectConfigArgs,
  Settings,
  StorageMedium,
  ValidationResult,
  WorkshopLayerInfo,
  WorkshopProject,
} from "@/lib/bindings";
import type { Result } from "@/utils/result";

export type * from "@/lib/bindings";
export type { Result } from "@/utils/result";
export { isErr, isOk, match, unwrap, unwrapOr } from "@/utils/result";

type IpcResponse<T> = { ok: true; value: T } | { ok: false; error: AppError };

/**
 * Transform the raw IPC response to our Result type.
 */
function toResult<T>(response: IpcResponse<T>): Result<T> {
  if (response.ok) {
    return { ok: true, value: response.value };
  }
  return { ok: false, error: response.error };
}

/**
 * Invoke a Tauri command and return a typed Result.
 */
async function invokeResult<T>(cmd: string, args?: Record<string, unknown>): Promise<Result<T>> {
  const response = await invoke<IpcResponse<T>>(cmd, args);
  return toResult(response);
}

// Deep-link protocol types
export type DeepLinkInstallRequest = {
  url: string;
  name: string | null;
  author: string | null;
  source: string | null;
};

export type ProtocolInstallProgress = {
  stage: "downloading" | "validating" | "installing" | "complete" | "error";
  bytesDownloaded: number;
  totalBytes: number | null;
  error: string | null;
};

export type DeepLinkBlockedPayload = {
  domain: string;
  url: string;
};

// API functions
export const api = {
  getAppInfo: () => invokeResult<AppInfo>("get_app_info"),
  getPlatformSupport: () => invokeResult<PlatformSupport>("get_platform_support"),

  // Settings
  getSettings: () => invokeResult<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invokeResult<void>("save_settings", { settings }),
  autoDetectLeaguePath: () => invokeResult<string | null>("auto_detect_league_path"),
  validateLeaguePath: (path: string) => invokeResult<boolean>("validate_league_path", { path }),
  checkSetupRequired: () => invokeResult<boolean>("check_setup_required"),
  listAvailableWads: () => invokeResult<string[]>("list_available_wads"),

  // Mods
  getInstalledMods: () => invokeResult<InstalledMod[]>("get_installed_mods"),
  installMod: (filePath: string) => invokeResult<InstalledMod>("install_mod", { filePath }),
  installMods: (filePaths: string[]) =>
    invokeResult<BulkInstallResult>("install_mods", { filePaths }),
  uninstallMod: (modId: string) => invokeResult<void>("uninstall_mod", { modId }),
  toggleMod: (modId: string, enabled: boolean) =>
    invokeResult<void>("toggle_mod", { modId, enabled }),
  getModThumbnail: (modId: string) => invokeResult<string | null>("get_mod_thumbnail", { modId }),
  getStorageDirectory: () => invokeResult<string>("get_storage_directory"),
  reorderMods: (modIds: string[]) => invokeResult<void>("reorder_mods", { modIds }),
  setModLayers: (modId: string, layerStates: Record<string, boolean>) =>
    invokeResult<void>("set_mod_layers", { modId, layerStates }),
  enableModWithLayers: (modId: string, layerStates: Record<string, boolean>) =>
    invokeResult<void>("enable_mod_with_layers", { modId, layerStates }),
  editModMetadata: (modId: string, metadata: EditModMetadataArgs) =>
    invokeResult<InstalledMod>("edit_mod_metadata", { modId, metadata }),
  getModWadReport: (modId: string) =>
    invokeResult<ModWadReport | null>("get_mod_wad_report", { modId }),
  getAllModWadReports: () => invokeResult<Record<string, ModWadReport>>("get_all_mod_wad_reports"),
  analyzeModWads: (modId: string) => invokeResult<ModWadReport>("analyze_mod_wads", { modId }),

  // Migration
  scanCslolMods: (directory: string) =>
    invokeResult<CslolModInfo[]>("scan_cslol_mods", { directory }),
  importCslolMods: (directory: string, selectedFolders: string[]) =>
    invokeResult<BulkInstallResult>("import_cslol_mods", { directory, selectedFolders }),

  // Inspector
  inspectModpkg: (filePath: string) => invokeResult<ModpkgInfo>("inspect_modpkg", { filePath }),

  // Patcher
  startPatcher: (config: PatcherConfig) => invokeResult<void>("start_patcher", { config }),
  stopPatcher: () => invokeResult<void>("stop_patcher"),
  getPatcherStatus: () => invokeResult<PatcherStatus>("get_patcher_status"),

  // Hotkeys
  pauseHotkeys: () => invokeResult<void>("pause_hotkeys"),
  resumeHotkeys: () => invokeResult<void>("resume_hotkeys"),
  setHotkey: (action: HotkeyAction, accelerator: string | null) =>
    invokeResult<void>("set_hotkey", { action, accelerator }),
  hotReloadMods: () => invokeResult<void>("hot_reload_mods"),
  killLeague: () => invokeResult<void>("kill_league"),

  // Profiles
  listModProfiles: () => invokeResult<Profile[]>("list_mod_profiles"),
  getActiveModProfile: () => invokeResult<Profile>("get_active_mod_profile"),
  createModProfile: (name: string) => invokeResult<Profile>("create_mod_profile", { name }),
  deleteModProfile: (profileId: string) => invokeResult<void>("delete_mod_profile", { profileId }),
  switchModProfile: (profileId: string) =>
    invokeResult<Profile>("switch_mod_profile", { profileId }),
  renameModProfile: (profileId: string, newName: string) =>
    invokeResult<Profile>("rename_mod_profile", { profileId, newName }),

  // Folders
  getFolders: () => invokeResult<LibraryFolder[]>("get_folders"),
  getFolderOrder: () => invokeResult<string[]>("get_folder_order"),
  createFolder: (name: string) => invokeResult<LibraryFolder>("create_folder", { name }),
  renameFolder: (folderId: string, newName: string) =>
    invokeResult<void>("rename_folder", { folderId, newName }),
  deleteFolder: (folderId: string) => invokeResult<void>("delete_folder", { folderId }),
  moveModToFolder: (modId: string, folderId: string) =>
    invokeResult<void>("move_mod_to_folder", { modId, folderId }),
  toggleFolder: (folderId: string, enabled: boolean) =>
    invokeResult<void>("toggle_folder", { folderId, enabled }),
  reorderFolderMods: (folderId: string, modIds: string[]) =>
    invokeResult<void>("reorder_folder_mods", { folderId, modIds }),
  reorderFolders: (folderOrder: string[]) => invokeResult<void>("reorder_folders", { folderOrder }),

  // Deep Link
  deepLinkInstallMod: (
    url: string,
    name?: string | null,
    author?: string | null,
    source?: string | null,
  ) => invokeResult<InstalledMod>("deep_link_install_mod", { url, name, author, source }),

  // Shell
  revealInExplorer: (path: string) => invokeResult<void>("reveal_in_explorer", { path }),
  minimizeToTray: () => invokeResult<void>("minimize_to_tray"),

  // Storage
  detectStorageMedium: (path: string) =>
    invokeResult<StorageMedium>("detect_storage_medium", { path }),

  // Diagnostics
  runDiagnostics: () => invokeResult<DiagnosticReport>("run_diagnostics"),
  openElevatedTerminal: (withBanner: boolean) =>
    invokeResult<void>("open_elevated_terminal", { withBanner }),

  // Workshop
  getWorkshopProjects: () => invokeResult<WorkshopProject[]>("get_workshop_projects"),
  createWorkshopProject: (args: CreateProjectArgs) =>
    invokeResult<WorkshopProject>("create_workshop_project", { args }),
  getWorkshopProject: (projectPath: string) =>
    invokeResult<WorkshopProject>("get_workshop_project", { projectPath }),
  getProjectContentTree: (projectPath: string) =>
    invokeResult<ContentTree>("get_project_content_tree", { projectPath }),
  saveProjectConfig: (args: SaveProjectConfigArgs) =>
    invokeResult<WorkshopProject>("save_project_config", { args }),
  renameWorkshopProject: (projectPath: string, newName: string) =>
    invokeResult<WorkshopProject>("rename_workshop_project", { projectPath, newName }),
  deleteWorkshopProject: (projectPath: string) =>
    invokeResult<void>("delete_workshop_project", { projectPath }),
  packWorkshopProject: (args: PackProjectArgs) =>
    invokeResult<PackResult>("pack_workshop_project", { args }),
  importFromModpkg: (filePath: string) =>
    invokeResult<WorkshopProject>("import_from_modpkg", { filePath }),
  peekFantome: (filePath: string) => invokeResult<FantomePeekResult>("peek_fantome", { filePath }),
  importFromFantome: (args: ImportFantomeArgs) =>
    invokeResult<WorkshopProject>("import_from_fantome", { args }),
  importFromGitRepo: (args: ImportGitRepoArgs) =>
    invokeResult<WorkshopProject>("import_from_git_repo", { args }),
  validateProject: (projectPath: string) =>
    invokeResult<ValidationResult>("validate_project", { projectPath }),
  setProjectThumbnail: (projectPath: string, imagePath: string) =>
    invokeResult<WorkshopProject>("set_project_thumbnail", { projectPath, imagePath }),
  removeProjectThumbnail: (projectPath: string) =>
    invokeResult<WorkshopProject>("remove_project_thumbnail", { projectPath }),
  getProjectThumbnail: (thumbnailPath: string) =>
    invokeResult<string>("get_project_thumbnail", { thumbnailPath }),
  saveLayerStringOverrides: (
    projectPath: string,
    layerName: string,
    stringOverrides: Record<string, Record<string, string>>,
  ) =>
    invokeResult<WorkshopProject>("save_layer_string_overrides", {
      projectPath,
      layerName,
      stringOverrides,
    }),
  getLayerContentPath: (projectPath: string, layerName: string) =>
    invokeResult<string>("get_layer_content_path", { projectPath, layerName }),
  getLayerInfo: (projectPath: string, layerNames: string[]) =>
    invokeResult<Record<string, WorkshopLayerInfo>>("get_layer_info", { projectPath, layerNames }),
  createProjectLayer: (
    projectPath: string,
    name: string,
    displayName?: string,
    description?: string,
  ) =>
    invokeResult<WorkshopProject>("create_project_layer", {
      projectPath,
      name,
      displayName,
      description,
    }),
  renameProjectLayer: (projectPath: string, layerName: string, newDisplayName: string) =>
    invokeResult<WorkshopProject>("rename_project_layer", {
      projectPath,
      layerName,
      newDisplayName,
    }),
  deleteProjectLayer: (projectPath: string, layerName: string) =>
    invokeResult<WorkshopProject>("delete_project_layer", { projectPath, layerName }),
  reorderProjectLayers: (projectPath: string, layerNames: string[]) =>
    invokeResult<WorkshopProject>("reorder_project_layers", { projectPath, layerNames }),
  updateLayerDescription: (projectPath: string, layerName: string, description?: string) =>
    invokeResult<WorkshopProject>("update_layer_description", {
      projectPath,
      layerName,
      description,
    }),
  addFilesToLayer: (projectPath: string, layerName: string, sources: string[]) =>
    invokeResult<AddFilesReport>("add_files_to_layer", { projectPath, layerName, sources }),
};
