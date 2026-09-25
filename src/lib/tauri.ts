import { invoke } from "@tauri-apps/api/core";

import type {
  AddFilesReport,
  Announcement,
  AppError,
  AppInfo,
  AssetInfo,
  AssetRef,
  BulkInstallResult,
  ChecksumMismatchInfo,
  ContentTree,
  CreateProjectArgs,
  ForcibleMapSkin,
  MapDecoration,
  CslolModInfo,
  EditModMetadataArgs,
  ExportScope,
  ExportShape,
  ExportSummary,
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
  HealthCheckReadiness,
  HealthSweepReport,
  HealthSweepState,
  HealthTiming,
  HotkeyAction,
  ImportFantomeArgs,
  ImportGitRepoArgs,
  InstalledMod,
  LaunchAvailability,
  LaunchOutcome,
  LaunchTarget,
  LayoutMigrationState,
  LibraryFolder,
  LibraryRepairReport,
  LinkedBinOffenderInfo,
  ModDocument,
  ModHealthVerdict,
  ModpkgInfo,
  ModStorage,
  ModWadReport,
  Notice,
  PackProjectArgs,
  PackResult,
  PatcherConfig,
  PatcherStatus,
  PlatformSupport,
  ProblemId,
  Profile,
  ReleasePage,
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
import type {
  BinEdit,
  ChoiceQuery,
  ConvertFolderArgs,
  Declaring,
  IntegrationAction,
  MenuConflictPolicy,
  Tool,
  DeclaredModuleChoice,
  ModuleAction,
  ProjectTextFile,
  ReferenceQuery,
  Revision,
  SearchPreference,
  UiError,
} from "@/lib/bindings.gen";
import {
  type BinDocumentId,
  commands,
  type MaterialSource,
  type ProgramOptions,
} from "@/lib/bindings.gen";
import type { Result } from "@/utils/result";

export type * from "@/lib/bindings";
export type {
  IntegrationAction,
  IntegrationError,
  IntegrationOperation,
  IntegrationRelease,
  IntegrationStage,
  IntegrationStatus,
  MenuConflictPolicy,
  MenuStatus,
  Tool,
} from "@/lib/bindings.gen";
// The bin editor's types, per ADR-0029. An explicit export shadows the star above.
export type {
  AddableField,
  AddableFields,
  BinDocumentHandle,
  BinDocumentId,
  BinEdit,
  BinFileKind,
  BinFindHit,
  BinFindResult,
  BinHeader,
  BinObjectHeader,
  BinRow,
  BinRows,
  BinValue,
  ChoiceQuery,
  Choices,
  ClassChoice,
  ClassDocs,
  ClassSchema,
  DeclaredDiagnostic,
  DeclaredDiagnosticKind,
  DeclaredKind,
  DeclaredLinkMark,
  DeclaredMark,
  DeclaredModuleChoice,
  DeclaredModuleSummary,
  DeclaredObjectMark,
  DeclaredSign,
  DeclaredState,
  Declaring,
  Dependency,
  DependencyEdit,
  Doc,
  EditOutcome,
  EditRejection,
  FieldRevision,
  FieldSchema,
  KindShape,
  LeafValue,
  LinkChange,
  ModuleAction,
  NewItem,
  NewObject,
  NewProperty,
  ObjectChange,
  ObjectEdit,
  ObjectName,
  ObjectSkip,
  PropertyDocs,
  PropertyKind,
  ReadOnly,
  RowDeclaration,
  RowNode,
  SkipReason,
  ValueEdit,
} from "@/lib/bindings.gen";
// The object index's types, per ADR-0029.
export type {
  CharacterSpell,
  CharacterSpells,
  DeclaredObject,
  DeclaredObjects,
  GameFileEntry,
  GameSearchHit,
  GameSearchResult,
  ObjectClassHit,
  ObjectDeclaration,
  ObjectDir,
  ObjectDirListing,
  ObjectFind,
  ObjectFindHit,
  ObjectFindResult,
  ObjectIndexStatus,
  ObjectNodeEntry,
  ObjectPrefixEntry,
  ObjectReferences,
  ObjectSearch,
  ObjectSearchHit,
  ObjectSearchResult,
  ReferenceGroup,
  ReferenceHit,
  ReferenceProperty,
  ReferenceQuery,
  ReferenceResult,
  SearchPreference,
  SpellCatalog,
} from "@/lib/bindings.gen";
// The ignore rules' type, per ADR-0029.
export type { IgnoreRules } from "@/lib/bindings.gen";
// The opened project folders' types, per ADR-0029.
export type {
  AddFoldersReport,
  ConvertFolderArgs,
  ConvertPlacement,
  FantomeFolder,
  FolderFailure,
  FolderInspection,
  FolderWad,
  OpenedProjectFolder,
  ProjectLocation,
} from "@/lib/bindings.gen";
// The shader pipeline's types, per ADR-0029.
export type {
  Attribute,
  BlendFactor,
  BlockMember,
  Define,
  DefineSource,
  MaterialKind,
  MaterialProgram,
  MaterialSource,
  MemberScalar,
  ParamSource,
  PassParam,
  PassProgram,
  PassState,
  PassTexture,
  ProgramOptions,
  ProgramRead,
  ResolvedPass,
  RuntimeSwitch,
  SamplerBinding,
  SamplerState,
  SchemaParam,
  SchemaSwitch,
  SchemaTexture,
  ShaderSchema,
  Sidecar,
  StageProgram,
  TextureBinding,
  TextureDimension,
  TextureSource,
  UniformBlock,
  Winding,
} from "@/lib/bindings.gen";
export type { ProjectText, ProjectTextFile, Revision } from "@/lib/bindings.gen";
// A project's declarations outline, per ADR-0029.
export type {
  DeclarationsLayer,
  DeclarationsLoadError,
  DeclaredEntry,
  DeclaredKey,
  DeclaredModule,
  DeclaredObjectEdit,
  LineSpan,
  ModuleSelector,
} from "@/lib/bindings.gen";
// The particle renderer's types, per ADR-0029.
export type { VfxField, VfxMapEntry, VfxSystem, VfxValue } from "@/lib/bindings.gen";
// The skin preview's types, per ADR-0029.
export type {
  MissileMovement,
  MissileSpec,
  SpellIssue,
  SpellIssueKind,
  SpellPreview,
} from "@/lib/bindings.gen";
export type {
  AnimationGraph,
  BaseRule,
  BaseTexture,
  Blending,
  ClipEvent,
  ClipHeader,
  EffectSystem,
  EventKind,
  EventSpawn,
  GraphClip,
  HashRef,
  IdleEffect,
  KeyRef,
  MapCharacter,
  MapChunk,
  MapChunkItem,
  MapDepthOfField,
  MapFiles,
  MapFog,
  MapItemKind,
  MapModel,
  MapParticle,
  MapPath,
  MapPostEffects,
  MapSsao,
  MapSun,
  MapVariant,
  Mask,
  MaterialPreview,
  MaterialWarning,
  NamedAsset,
  RenderState,
  SkinModel,
  SubmeshOverride,
  SyncGroup,
  Track,
  Wrap,
} from "@/lib/bindings.gen";
/* The diagnostics types. A serde `default` or `skip_serializing_if` splits a type by
phase, and a command answers the serialize side, so that side takes the plain name. */
export type {
  BinaryId,
  Category,
  Check_Serialize as Check,
  CheckDetail,
  Consequence,
  DecodedBinary,
  DecodedIncident,
  DiagnosticReport_Serialize as DiagnosticReport,
  Ending,
  Evidence,
  EvidenceCode,
  EvidenceMark,
  EvidenceSource,
  GameInfo,
  GamePhase,
  Hint,
  Incident_Serialize as Incident,
  InstallMismatch,
  LaunchKind,
  OriginKind,
  OverlayOutcome,
  PatcherBinaries_Serialize as PatcherBinaries,
  PendingUpdate,
  ScanMode,
  ScanStatus,
  SessionFailure,
  Severity,
  ShaderFailure,
  SkippedArchive,
  Suspect,
  UiError,
  Verdict_Serialize as Verdict,
  VerdictKind,
} from "@/lib/bindings.gen";
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
  /** The host the trusted providers list does not cover, or `null` where it does. */
  untrustedDomain: string | null;
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

// API functions
export const api = {
  integrations: {
    status: () => commands.integrationStatus().then(toResult),
    release: (tool: Tool) => commands.integrationRelease(tool).then(toResult),
    change: (tool: Tool, action: IntegrationAction, conflicts: MenuConflictPolicy) =>
      commands.changeIntegration(tool, action, conflicts).then(toResult),
    cancel: (operationId: string) => commands.cancelIntegrationDownload(operationId).then(toResult),
  },
  getAppInfo: () => invokeResult<AppInfo>("get_app_info"),
  getPlatformSupport: () => invokeResult<PlatformSupport>("get_platform_support"),
  showMainWindow: () => invokeResult<void>("show_main_window"),
  listReleases: (page: number) => invokeResult<ReleasePage>("list_releases", { page }),
  listAnnouncements: () => invokeResult<Announcement[]>("list_announcements"),
  listNotices: () => invokeResult<Notice[]>("list_notices"),

  // Settings
  getSettings: () => invokeResult<Settings>("get_settings"),
  getDefaultSettings: () => invokeResult<Settings>("get_default_settings"),
  saveSettings: (settings: Settings) => invokeResult<void>("save_settings", { settings }),
  autoDetectLeaguePath: () => invokeResult<string | null>("auto_detect_league_path"),
  validateLeaguePath: (path: string) => invokeResult<boolean>("validate_league_path", { path }),
  checkSetupRequired: () => invokeResult<boolean>("check_setup_required"),
  detectLeagueRunAsAdmin: () => invokeResult<boolean>("detect_league_run_as_admin"),
  listAvailableWads: () => invokeResult<string[]>("list_available_wads"),
  listForcibleMapSkins: () => invokeResult<ForcibleMapSkin[]>("list_forcible_map_skins"),
  listMapDecorations: () => invokeResult<MapDecoration[]>("list_map_decorations"),

  // Mods
  getInstalledMods: () => invokeResult<InstalledMod[]>("get_installed_mods"),
  installMod: (filePath: string) => invokeResult<InstalledMod>("install_mod", { filePath }),
  installMods: (filePaths: string[]) =>
    invokeResult<BulkInstallResult>("install_mods", { filePaths }),
  updateMod: (modId: string, filePath: string) =>
    invokeResult<InstalledMod>("update_mod", { modId, filePath }),
  uninstallMod: (modId: string) => invokeResult<void>("uninstall_mod", { modId }),
  exportMods: (scope: ExportScope, shape: ExportShape, destination: string) =>
    invokeResult<ExportSummary>("export_mods", { scope, shape, destination }),
  toggleMod: (modId: string, enabled: boolean) =>
    invokeResult<void>("toggle_mod", { modId, enabled }),
  getModThumbnail: (modId: string) => invokeResult<string | null>("get_mod_thumbnail", { modId }),
  getModThumbnails: (modIds: readonly string[]) =>
    invokeResult<Record<string, string>>("get_mod_thumbnails", { modIds }),
  getModReadme: (modId: string) => invokeResult<ModDocument>("get_mod_readme", { modId }),
  getModLicenseText: (modId: string) =>
    invokeResult<ModDocument>("get_mod_license_text", { modId }),
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
  /** Re-check `modIds`, or every mod in the library when none are named. */
  sweepModHealth: (modIds?: string[]) =>
    invokeResult<HealthSweepReport>("sweep_mod_health", { modIds: modIds ?? null }),
  repairMod: (modId: string) => invokeResult<FixReport>("repair_mod", { modId }),
  repairMods: (modIds: string[]) => invokeResult<LibraryRepairReport>("repair_mods", { modIds }),
  getModHealthVerdicts: () =>
    invokeResult<Record<string, ModHealthVerdict>>("get_mod_health_verdicts"),
  getHealthSweep: () => invokeResult<HealthSweepState>("get_health_sweep"),
  getHealthCheckReadiness: () => invokeResult<HealthCheckReadiness>("get_health_check_readiness"),
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
  getChecksumMismatches: () =>
    invokeResult<Record<string, ChecksumMismatchInfo[]>>("get_checksum_mismatches"),

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

  // Diagnostics. One group per migrated module: the generated `commands` object is
  // The bin editor and the class reads over its documents, on tauri-specta.
  bin: {
    open: (asset: AssetRef, entry: string | null) => commands.binOpen(asset, entry).then(toResult),
    children: (
      document: BinDocumentId,
      entry: string,
      path: string,
      offset: number,
      limit: number,
    ) => commands.binChildren(document, entry, path, offset, limit).then(toResult),
    read: (document: BinDocumentId, entry: string, paths: readonly string[]) =>
      commands.binRead(document, entry, [...paths]).then(toResult),
    find: (document: BinDocumentId, entry: string | null, query: string) =>
      commands.binFind(document, entry, query).then(toResult),
    edit: (document: BinDocumentId, edit: BinEdit) =>
      commands.binEdit(document, edit).then(toResult),
    choices: (document: BinDocumentId, query: ChoiceQuery) =>
      commands.binChoices(document, query).then(toResult),
    save: (document: BinDocumentId) => commands.binSave(document).then(toResult),
    reload: (document: BinDocumentId) => commands.binReload(document).then(toResult),
    undo: (document: BinDocumentId) => commands.binUndo(document).then(toResult),
    redo: (document: BinDocumentId) => commands.binRedo(document).then(toResult),
    declared: (document: BinDocumentId) => commands.binDeclared(document).then(toResult),
    declareInto: (document: BinDocumentId, layer: string, module: DeclaredModuleChoice) =>
      commands.binDeclareInto(document, layer, module).then(toResult),
    setDeclaring: (document: BinDocumentId, declaring: Declaring) =>
      commands.binSetDeclaring(document, declaring).then(toResult),
    rowDeclaration: (document: BinDocumentId, entry: string, path: string) =>
      commands.binRowDeclaration(document, entry, path).then(toResult),
    roots: (document: BinDocumentId) => commands.binRoots(document).then(toResult),
    dependencies: (document: BinDocumentId) => commands.binDependencies(document).then(toResult),
    close: (document: BinDocumentId) => commands.binClose(document).then(toResult),
    classSchema: (classHash: string) => commands.classSchema(classHash).then(toResult),
    classDocs: (classHash: string) => commands.classDocs(classHash).then(toResult),
    syncMetaDocs: () => commands.syncMetaDocs().then(toResult),
    readVfxSystem: (document: BinDocumentId, entry: string) =>
      commands.readVfxSystem(document, entry).then(toResult),
    readSkin: (document: BinDocumentId, entry: string) =>
      commands.readSkin(document, entry).then(toResult),
    readMaterialPrograms: (
      source: MaterialSource,
      entries: readonly string[],
      options: ProgramOptions,
    ) => commands.readMaterialPrograms(source, [...entries], options).then(toResult),
    readDefaultSkinnedProgram: (document: BinDocumentId, options: ProgramOptions) =>
      commands.readDefaultSkinnedProgram(document, options).then(toResult),
    bakeSkinTangents: (document: BinDocumentId, entry: string) =>
      commands.bakeSkinTangents(document, entry).then(toResult),
    readMap: (document: BinDocumentId | null, map: string, materials: string[]) =>
      commands.readMap(document, map, materials).then(toResult),
    readMapParticles: (document: BinDocumentId) =>
      commands.readMapParticles(document).then(toResult),
    readMapCharacters: (document: BinDocumentId) =>
      commands.readMapCharacters(document).then(toResult),
    readMapVariants: (document: BinDocumentId, entry: string) =>
      commands.readMapVariants(document, entry).then(toResult),
    readMapOutline: (document: BinDocumentId) => commands.readMapOutline(document).then(toResult),
    locateFilesNear: (near: AssetRef, paths: readonly string[]) =>
      commands.locateFilesNear(near, [...paths]).then(toResult),
    locateMapFiles: (near: AssetRef, map: string) =>
      commands.locateMapFiles(near, map).then(toResult),
    readAnimationGraph: (document: BinDocumentId, entry: string) =>
      commands.readAnimationGraph(document, entry).then(toResult),
    readClipHeader: (asset: AssetRef) => commands.readClipHeader(asset).then(toResult),
    readSpell: (document: BinDocumentId, entry: string) =>
      commands.readSpell(document, entry).then(toResult),
  },

  // The object index and the install lookups a bin page makes, on tauri-specta.
  objects: {
    search: (query: string) => commands.searchObjectIndex(query).then(toResult),
    warm: () => commands.warmObjectIndex().then(toResult),
    drop: () => commands.dropObjectIndex().then(toResult),
    declared: (objectHashes: readonly string[], document: BinDocumentId | null = null) =>
      commands.declaredObjects([...objectHashes], document).then(toResult),
    dir: (prefix: string) => commands.objectDir(prefix).then(toResult),
    spells: (character: string) => commands.characterSpells(character).then(toResult),
    find: (pattern: string, regex: boolean, cls: string | null) =>
      commands.findObjects(pattern, regex, cls).then(toResult),
    references: (query: ReferenceQuery, project: string | null) =>
      commands.findReferences(query, project).then(toResult),
    cancelWalk: () => commands.cancelReferenceWalk().then(toResult),
    locateGameFiles: (paths: readonly string[]) =>
      commands.locateGameFiles([...paths]).then(toResult),
    searchGamePaths: (query: string, preference: SearchPreference) =>
      commands.searchGamePaths(query, preference).then(toResult),
  },

  // flat, so the module boundary lives here.
  diagnostics: {
    run: () => commands.runDiagnostics().then(toResult),
    openElevatedTerminal: (withBanner: boolean) =>
      commands.openElevatedTerminal(withBanner).then(toResult),
    listIncidents: () => commands.listIncidents().then(toResult),
    dismissIncident: (id: string) => commands.dismissIncident(id).then(toResult),
    dismissAllIncidents: () => commands.dismissAllIncidents().then(toResult),
    revealGameLog: (id: string) => commands.revealGameLog(id).then(toResult),
    incidentReport: (id: string, hints: string[]) =>
      commands.incidentReport(id, hints).then(toResult),
    incidentToken: (id: string) => commands.incidentToken(id).then(toResult),
    decodeIncidentToken: (token: string) => commands.decodeIncidentToken(token).then(toResult),
    telemetryIdentity: () => commands.telemetryIdentity().then(toResult),
    resetTelemetrySecret: () => commands.resetTelemetrySecret().then(toResult),
    trackUiError: (error: UiError) => commands.trackUiError(error).then(toResult),
  },

  // Launcher, on tauri-specta.
  launcher: {
    checkInstallMismatch: () => commands.checkInstallMismatch().then(toResult),
    switchLeagueInstall: (installRoot: string) =>
      commands.switchLeagueInstall(installRoot).then(toResult),
  },

  // The app's own update, on tauri-specta.
  updater: {
    check: () => commands.checkUpdate().then(toResult),
    download: () => commands.downloadUpdate().then(toResult),
    install: () => commands.installUpdate().then(toResult),
    discard: () => commands.discardUpdate().then(toResult),
  },

  // A project's ignore rules, on tauri-specta.
  ignoreRules: {
    read: (projectPath: string, at: string | null) =>
      commands.getProjectIgnoreRules(projectPath, at).then(toResult),
    recommended: () => commands.recommendedIgnoreRules().then(toResult),
    save: (projectPath: string, at: string | null, text: string) =>
      commands.saveProjectIgnoreRules(projectPath, at, text).then(toResult),
    addRecommended: (projectPath: string) =>
      commands.addRecommendedIgnoreRules(projectPath).then(toResult),
  },

  // Folders opened as projects from anywhere on disk, on tauri-specta.
  projectFolders: {
    inspect: (path: string) => commands.inspectProjectFolder(path).then(toResult),
    open: (path: string) => commands.openProjectFolder(path).then(toResult),
    recordOpened: (path: string) => commands.recordProjectOpened(path).then(toResult),
    list: () => commands.getOpenedProjectFolders().then(toResult),
    forget: (path: string) => commands.forgetProjectFolder(path).then(toResult),
    relocate: (oldPath: string, newPath: string) =>
      commands.relocateProjectFolder(oldPath, newPath).then(toResult),
    convert: (args: ConvertFolderArgs) => commands.convertFolderToProject(args).then(toResult),
    addAll: (paths: readonly string[]) => commands.addProjectFolders([...paths]).then(toResult),
  },

  // A project's root text files, on tauri-specta.
  projectText: {
    read: (projectPath: string, file: ProjectTextFile) =>
      commands.getProjectText(projectPath, file).then(toResult),
    save: (projectPath: string, file: ProjectTextFile, text: string, expected: Revision | null) =>
      commands.saveProjectText(projectPath, file, text, expected).then(toResult),
  },

  // A project's game data declarations, on tauri-specta.
  declarations: {
    outline: (projectPath: string) => commands.declarationsOutline(projectPath).then(toResult),
    /** A module action with no document to undo it, for a view of the manifest itself. */
    moduleAction: (projectPath: string, layer: string, action: ModuleAction) =>
      commands.declarationsModuleAction(projectPath, layer, action).then(toResult),
  },

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

/**
 * Open the file manager on `path`, for a control with nowhere to put a failure.
 *
 * A reveal the shell refuses is a dead click and nothing worse, so this logs and
 * returns rather than growing an error surface onto every caller. Both the
 * refusal and a rejected `invoke` land in the log.
 */
export function revealPath(path: string): void {
  void api.revealInExplorer(path).then(
    (result) => {
      if (!result.ok) console.error("Could not reveal", path, result.error);
    },
    (error: unknown) => console.error("Could not reveal", path, error),
  );
}
