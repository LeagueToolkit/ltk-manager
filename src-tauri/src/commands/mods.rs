use crate::error::{AppError, AppResult, IpcResult, MutexResultExt};
use crate::mods::{
    inspect_modpkg_file, BulkInstallResult, InstalledMod, ModLibraryState, ModWadReport,
    ModpkgInfo, WadReportState,
};
use crate::patcher::PatcherState;
use crate::state::SettingsState;
use camino::Utf8PathBuf;
use std::collections::HashMap;
use tauri::State;

/// Get all installed mods from the mod library.
#[tauri::command]
pub fn get_installed_mods(
    library: State<ModLibraryState>,
    settings: State<SettingsState>,
) -> IpcResult<Vec<InstalledMod>> {
    let result: AppResult<Vec<InstalledMod>> = (|| {
        let settings = settings.0.lock().mutex_err()?.clone();
        library.0.get_installed_mods(&settings)
    })();
    result.into()
}

/// Install a mod from a `.modpkg` or `.fantome` file into `modStoragePath`.
#[tauri::command]
pub fn install_mod(
    file_path: String,
    library: State<ModLibraryState>,
    settings: State<SettingsState>,
    patcher: State<PatcherState>,
) -> IpcResult<InstalledMod> {
    let result: AppResult<InstalledMod> = (|| {
        reject_if_patcher_running(&patcher)?;
        let settings = settings.0.lock().mutex_err()?.clone();
        library.0.install_mod_from_package(&settings, &file_path)
    })();
    result.into()
}

/// Install multiple mods from `.modpkg` or `.fantome` files in a single batch.
#[tauri::command]
pub fn install_mods(
    file_paths: Vec<String>,
    library: State<ModLibraryState>,
    settings: State<SettingsState>,
    patcher: State<PatcherState>,
) -> IpcResult<BulkInstallResult> {
    let result: AppResult<BulkInstallResult> = (|| {
        reject_if_patcher_running(&patcher)?;
        let settings = settings.0.lock().mutex_err()?.clone();
        library.0.install_mods_from_packages(&settings, &file_paths)
    })();
    result.into()
}

/// Uninstall a mod by id.
#[tauri::command]
pub fn uninstall_mod(
    mod_id: String,
    library: State<ModLibraryState>,
    settings: State<SettingsState>,
    patcher: State<PatcherState>,
) -> IpcResult<()> {
    let result: AppResult<()> = (|| {
        reject_if_patcher_running(&patcher)?;
        let settings = settings.0.lock().mutex_err()?.clone();
        library.0.uninstall_mod_by_id(&settings, &mod_id)
    })();
    result.into()
}

/// Toggle a mod's enabled state.
#[tauri::command]
pub fn toggle_mod(
    mod_id: String,
    enabled: bool,
    library: State<ModLibraryState>,
    settings: State<SettingsState>,
    patcher: State<PatcherState>,
) -> IpcResult<()> {
    let result: AppResult<()> = (|| {
        reject_if_patcher_running(&patcher)?;
        let settings = settings.0.lock().mutex_err()?.clone();
        library.0.toggle_mod_enabled(&settings, &mod_id, enabled)
    })();
    result.into()
}

/// Reorder the enabled mods in the active profile.
#[tauri::command]
pub fn reorder_mods(
    mod_ids: Vec<String>,
    library: State<ModLibraryState>,
    settings: State<SettingsState>,
    patcher: State<PatcherState>,
) -> IpcResult<()> {
    let result: AppResult<()> = (|| {
        reject_if_patcher_running(&patcher)?;
        let settings = settings.0.lock().mutex_err()?.clone();
        library.0.reorder_mods(&settings, mod_ids)
    })();
    result.into()
}

/// Set the enabled/disabled state of individual layers for a mod.
#[tauri::command]
pub fn set_mod_layers(
    mod_id: String,
    layer_states: HashMap<String, bool>,
    library: State<ModLibraryState>,
    settings: State<SettingsState>,
    patcher: State<PatcherState>,
) -> IpcResult<()> {
    let result: AppResult<()> = (|| {
        reject_if_patcher_running(&patcher)?;
        let settings = settings.0.lock().mutex_err()?.clone();
        library.0.set_mod_layers(&settings, &mod_id, layer_states)
    })();
    result.into()
}

/// Enable a mod and set its initial layer configuration atomically.
#[tauri::command]
pub fn enable_mod_with_layers(
    mod_id: String,
    layer_states: HashMap<String, bool>,
    library: State<ModLibraryState>,
    settings: State<SettingsState>,
    patcher: State<PatcherState>,
) -> IpcResult<()> {
    let result: AppResult<()> = (|| {
        reject_if_patcher_running(&patcher)?;
        let settings = settings.0.lock().mutex_err()?.clone();
        library
            .0
            .enable_mod_with_layers(&settings, &mod_id, layer_states)
    })();
    result.into()
}

#[derive(Debug, serde::Deserialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct EditModMetadataArgs {
    pub display_name: Option<String>,
    pub tags: Option<Vec<String>>,
    pub champions: Option<Vec<String>>,
    pub maps: Option<Vec<String>>,
    #[serde(default)]
    pub set_thumbnail_path: Option<String>,
    #[serde(default)]
    pub remove_thumbnail: Option<bool>,
}

/// Edit a mod's metadata (name, tags, champions, maps).
#[tauri::command]
pub fn edit_mod_metadata(
    mod_id: String,
    metadata: EditModMetadataArgs,
    library: State<ModLibraryState>,
    settings: State<SettingsState>,
) -> IpcResult<InstalledMod> {
    let result: AppResult<InstalledMod> = (|| {
        let settings = settings.0.lock().mutex_err()?.clone();
        library.0.edit_mod_metadata(&settings, &mod_id, metadata)
    })();
    result.into()
}

/// Inspect a `.modpkg` file and return its metadata.
#[tauri::command]
pub fn inspect_modpkg(file_path: String) -> IpcResult<ModpkgInfo> {
    inspect_modpkg_file(&file_path).into()
}

/// Get a mod's cached thumbnail path, extracting from the archive on first access.
/// Returns `null` if the mod has no thumbnail.
#[tauri::command]
pub fn get_mod_thumbnail(
    mod_id: String,
    library: State<ModLibraryState>,
    settings: State<SettingsState>,
) -> IpcResult<Option<String>> {
    let result: AppResult<Option<String>> = (|| {
        let settings = settings.0.lock().mutex_err()?.clone();
        library.0.get_mod_thumbnail_path(&settings, &mod_id)
    })();
    result.into()
}

/// Get the mod storage directory path.
#[tauri::command]
pub fn get_storage_directory(
    library: State<ModLibraryState>,
    settings: State<SettingsState>,
) -> IpcResult<String> {
    let result: AppResult<String> = (|| {
        let settings = settings.0.lock().mutex_err()?.clone();
        let storage_dir = library.0.storage_dir(&settings)?;
        Ok(storage_dir.display().to_string())
    })();
    result.into()
}

/// Get the cached WAD footprint report for a single mod, if one exists.
///
/// Returns `null` when the mod has never been analyzed nor included in a
/// successful patch run. Reports include an `is_stale` flag computed at read
/// time against the most recently observed game-index fingerprint.
#[tauri::command]
pub fn get_mod_wad_report(
    mod_id: String,
    reports: State<WadReportState>,
) -> IpcResult<Option<ModWadReport>> {
    let result: AppResult<Option<ModWadReport>> = (|| {
        let store = reports.0.lock().mutex_err()?;
        Ok(store.get(&mod_id))
    })();
    result.into()
}

/// Get all cached WAD footprint reports in a single batch. Returns a map of
/// mod id → report. Far cheaper than one IPC call per mod.
#[tauri::command]
pub fn get_all_mod_wad_reports(
    reports: State<WadReportState>,
) -> IpcResult<HashMap<String, ModWadReport>> {
    let result: AppResult<HashMap<String, ModWadReport>> = (|| {
        let store = reports.0.lock().mutex_err()?;
        Ok(store.get_all())
    })();
    result.into()
}

/// Force a fresh WAD footprint analysis for a single mod without running the
/// full patcher. Safe to call while the patcher is running — it neither
/// touches overlay state nor takes the patcher mutex.
///
/// Runs synchronously on Tauri's blocking command thread pool (not a Tokio
/// worker) so heavy I/O (game index build, modpkg mount) won't starve the
/// async runtime.
#[tauri::command]
pub fn analyze_mod_wads(
    mod_id: String,
    library: State<ModLibraryState>,
    settings: State<SettingsState>,
    reports: State<WadReportState>,
) -> IpcResult<ModWadReport> {
    let result: AppResult<ModWadReport> = (|| {
        let settings_snapshot = settings.0.lock().mutex_err()?.clone();
        let game_dir = crate::overlay::resolve_game_dir(&settings_snapshot)?;
        let (profile_dir, mut enabled_mod) = library
            .0
            .build_single_mod_provider(&settings_snapshot, &mod_id)?;

        let utf8_game_dir = Utf8PathBuf::from_path_buf(game_dir)
            .map_err(|p| AppError::InvalidPath(format!("Non-UTF8 game dir: {}", p.display())))?;
        let utf8_state_dir = Utf8PathBuf::from_path_buf(profile_dir)
            .map_err(|p| AppError::InvalidPath(format!("Non-UTF8 profile dir: {}", p.display())))?;

        let upstream = ltk_overlay::OverlayBuilder::analyze_single_mod(
            &utf8_game_dir,
            &utf8_state_dir,
            &mut enabled_mod,
        )
        .map_err(|e| AppError::Other(format!("Mod analysis failed: {}", e)))?;

        let report = ModWadReport::from_upstream(upstream);
        let mut store = reports.0.lock().mutex_err()?;
        store.upsert(report.clone())?;
        Ok(store.get(&report.mod_id).unwrap_or(report))
    })();
    result.into()
}

/// Reject the operation if the patcher is currently running.
pub(super) fn reject_if_patcher_running(patcher: &State<PatcherState>) -> AppResult<()> {
    let state = patcher.0.lock().mutex_err()?;
    if state.is_running() {
        return Err(AppError::PatcherRunning);
    }
    Ok(())
}
