import { invoke } from "@tauri-apps/api/core";

import type {
  AddFilesReport,
  AppError,
  AppInfo,
  AssetInfo,
  AssetRef,
  BulkInstallResult,
  ContentTree,
  CreateProjectArgs,
  CslolModInfo,
  DecodedIncident,
  DiagnosticReport,
  EditModMetadataArgs,
  ExtractOptions,
  ExtractPlan,
  ExtractSummary,
  ExtractTarget,
  FantomePeekResult,
  FixReport,
  GameDirListing,
  GameFindResult,
  GameIndexStats,
  GameSearchResult,
  GameWadEntry,
  GameWadSummary,
  HashtableCacheStatus,
  HashtableSyncReport,
  HashtableUpdateCheck,
  HealthSweepState,
  HealthTiming,
  HotkeyAction,
  ImportFantomeArgs,
  ImportGitRepoArgs,
  Incident,
  InstalledMod,
  LaunchAvailability,
  LaunchOutcome,
  LaunchTarget,
  LayoutMigrationState,
  LibraryFolder,
  LibraryRepairReport,
  LinkedBinOffenderInfo,
  ModHealthVerdict,
  ModpkgInfo,
  ModStorage,
  ModWadReport,
  PackProjectArgs,
  PackResult,
  PatcherConfig,
  PatcherStatus,
  PlatformSupport,
  ProblemId,
  Profile,
  Run,
  SaveProjectConfigArgs,
  SessionStarted,
  Settings,
  StorageMedium,
  StringKeySearchResult,
  ValidationResult,
  WorkshopFileKind,
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

export type DeepLinkSettingsRequest = {
  focus: string;
};

/** A deep link that reached the backend before the frontend was listening for it. */
export type PendingDeepLink =
  | ({ kind: "install" } & DeepLinkInstallRequest)
  | ({ kind: "settings" } & DeepLinkSettingsRequest);

export type DeepLinkBlockedPayload = {
  domain: string;
  url: string;
};

// API functions
export const api = {
  getAppInfo: () => invokeResult<AppInfo>("get_app_info"),
  getPlatformSupport: () => invokeResult<PlatformSupport>("get_platform_support"),
  showMainWindow: () => invokeResult<void>("show_main_window"),
  prepareForUpdate: () => invokeResult<void>("prepare_for_update"),

  // Settings
  getSettings: () => invokeResult<Settings>("get_settings"),
  getDefaultSettings: () => invokeResult<Settings>("get_default_settings"),
  saveSettings: (settings: Settings) => invokeResult<void>("save_settings", { settings }),
  autoDetectLeaguePath: () => invokeResult<string | null>("auto_detect_league_path"),
  validateLeaguePath: (path: string) => invokeResult<boolean>("validate_league_path", { path }),
  checkSetupRequired: () => invokeResult<boolean>("check_setup_required"),
  detectLeagueRunAsAdmin: () => invokeResult<boolean>("detect_league_run_as_admin"),
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
  setModStorage: (modId: string, storage: ModStorage) =>
    invokeResult<InstalledMod>("set_mod_storage", { modId, storage }),
  getModWadReport: (modId: string) =>
    invokeResult<ModWadReport | null>("get_mod_wad_report", { modId }),
  getAllModWadReports: () => invokeResult<Record<string, ModWadReport>>("get_all_mod_wad_reports"),
  analyzeModWads: (modId: string) => invokeResult<ModWadReport>("analyze_mod_wads", { modId }),
  checkModHealth: (modId: string) => invokeResult<ModHealthVerdict>("check_mod_health", { modId }),
  repairMod: (modId: string) => invokeResult<FixReport>("repair_mod", { modId }),
  repairMods: (modIds: string[]) => invokeResult<LibraryRepairReport>("repair_mods", { modIds }),
  getModHealthVerdicts: () =>
    invokeResult<Record<string, ModHealthVerdict>>("get_mod_health_verdicts"),
  getHealthSweep: () => invokeResult<HealthSweepState>("get_health_sweep"),
  cancelModHealthRun: () => invokeResult<null>("cancel_mod_health_run"),
  /**
   * Time a health pass over the real library, into the dev console.
   *
   * Registered only in a debug build. `repair` runs the real repair, which
   * rewrites the mods it can fix and keeps no way back.
   */
  timeModHealth: (repair: boolean) => invokeResult<HealthTiming>("time_mod_health", { repair }),

  // Migration
  scanCslolMods: (directory: string) =>
    invokeResult<CslolModInfo[]>("scan_cslol_mods", { directory }),
  importCslolMods: (directory: string, selectedFolders: string[]) =>
    invokeResult<BulkInstallResult>("import_cslol_mods", { directory, selectedFolders }),
  getLayoutMigrationState: () => invokeResult<LayoutMigrationState>("get_layout_migration_state"),

  // Inspector
  inspectModpkg: (filePath: string) => invokeResult<ModpkgInfo>("inspect_modpkg", { filePath }),

  // Patcher
  startPatcher: (config: PatcherConfig) => invokeResult<void>("start_patcher", { config }),
  stopPatcher: () => invokeResult<void>("stop_patcher"),
  rebuildOverlay: () => invokeResult<void>("rebuild_overlay"),
  getPatcherStatus: () => invokeResult<PatcherStatus>("get_patcher_status"),
  getLinkedBinOffenders: () =>
    invokeResult<Record<string, LinkedBinOffenderInfo>>("get_linked_bin_offenders"),

  // Launcher
  // Resolves to null when a launch was already in flight - a redundant click.
  launchLeague: (target?: LaunchTarget) =>
    invokeResult<LaunchOutcome | null>("launch_league", { target: target ?? null }),
  // Resolves to false when nothing was in flight, which is what a Cancel
  // pressed just as the request landed looks like.
  cancelLaunch: () => invokeResult<boolean>("cancel_launch"),
  stopLeague: () => invokeResult<void>("stop_league"),
  getLaunchAvailability: () => invokeResult<LaunchAvailability>("get_launch_availability"),
  // Also starts following the session it reports, so a game already in progress
  // when the app opened still reaches the session events.
  getLeagueSession: () => invokeResult<SessionStarted | null>("get_league_session"),

  // Hotkeys
  pauseHotkeys: () => invokeResult<void>("pause_hotkeys"),
  resumeHotkeys: () => invokeResult<void>("resume_hotkeys"),
  setHotkey: (action: HotkeyAction, accelerator: string | null) =>
    invokeResult<void>("set_hotkey", { action, accelerator }),
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

  // Hashtables
  getHashtableCacheStatus: () => invokeResult<HashtableCacheStatus>("get_hashtable_cache_status"),
  checkHashtableUpdates: () => invokeResult<HashtableUpdateCheck>("check_hashtable_updates"),
  syncHashtables: (force: boolean) =>
    invokeResult<HashtableSyncReport>("sync_hashtables", { force }),

  // Game WADs
  getGameWads: () => invokeResult<GameWadSummary[]>("get_game_wads"),
  readGameWad: (wadName: string) => invokeResult<GameWadEntry[]>("read_game_wad", { wadName }),

  // Game index
  getGameIndex: () => invokeResult<GameIndexStats>("get_game_index"),
  readGameDir: (path: string) => invokeResult<GameDirListing>("read_game_dir", { path }),
  refreshGameIndex: () => invokeResult<void>("refresh_game_index"),
  searchGameIndex: (query: string) =>
    invokeResult<GameSearchResult>("search_game_index", { query }),
  findInGameIndex: (pattern: string, regex: boolean) =>
    invokeResult<GameFindResult>("find_in_game_index", { pattern, regex }),

  // Extract to disk
  planGameExtract: (targets: ExtractTarget[], kinds: WorkshopFileKind[] | null) =>
    invokeResult<ExtractPlan>("plan_game_extract", { targets, kinds }),
  // Resolves to null when an extract was already in flight - a redundant click.
  extractGameFiles: (targets: ExtractTarget[], options: ExtractOptions) =>
    invokeResult<ExtractSummary | null>("extract_game_files", { targets, options }),
  // Resolves to false when nothing was in flight, which is what a Cancel
  // pressed just as the run finished looks like.
  cancelExtract: () => invokeResult<boolean>("cancel_extract"),

  // Asset preview
  readAssetInfo: (asset: AssetRef) => invokeResult<AssetInfo>("read_asset_info", { asset }),
  saveAssetCopy: (asset: AssetRef, destination: string) =>
    invokeResult<void>("save_asset_copy", { asset, destination }),

  // Ritobin
  detectRitobinIntegration: () => invokeResult<boolean>("detect_ritobin_integration"),
  openAssetInRitobin: (asset: AssetRef, name?: string) =>
    invokeResult<void>("open_asset_in_ritobin", { asset, name }),

  // Deep Link
  deepLinkInstallMod: (
    url: string,
    name?: string | null,
    author?: string | null,
    source?: string | null,
  ) => invokeResult<InstalledMod>("deep_link_install_mod", { url, name, author, source }),
  takePendingDeepLink: () => invokeResult<PendingDeepLink | null>("take_pending_deep_link"),

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
  listIncidents: () => invokeResult<Incident[]>("list_incidents"),
  dismissIncident: (id: string) => invokeResult<void>("dismiss_incident", { id }),
  revealGameLog: (id: string) => invokeResult<void>("reveal_game_log", { id }),
  incidentReport: (id: string) => invokeResult<string>("incident_report", { id }),
  incidentToken: (id: string) => invokeResult<string>("incident_token", { id }),
  decodeIncidentToken: (token: string) =>
    invokeResult<DecodedIncident>("decode_incident_token", { token }),

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
  analyzeProject: (projectPath: string) => invokeResult<Run>("analyze_project", { projectPath }),
  fixProblems: (projectPath: string, problems: ProblemId[]) =>
    invokeResult<FixReport>("fix_problems", { projectPath, problems }),
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
  searchStringKeys: (query: string, limit?: number) =>
    invokeResult<StringKeySearchResult>("search_string_keys", { query, limit }),
  lookupStringValues: (keys: string[]) =>
    invokeResult<Record<string, string>>("lookup_string_values", { keys }),
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
  deleteLayerContent: (projectPath: string, layerName: string, relativePath: string) =>
    invokeResult<void>("delete_layer_content", { projectPath, layerName, relativePath }),
  // The editor state file is opaque to the backend, so both sides are strings.
  getProjectEditorState: (projectPath: string) =>
    invokeResult<string | null>("get_project_editor_state", { projectPath }),
  saveProjectEditorState: (projectPath: string, content: string) =>
    invokeResult<void>("save_project_editor_state", { projectPath, content }),
};
