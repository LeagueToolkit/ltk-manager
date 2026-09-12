use super::off_thread;
use crate::error::{AppResult, IpcResult, Utf8PathExt};
use crate::mods::{
    inspect_modpkg_file, with_zip_extension, BulkInstallResult, EditModMetadataArgs, ExportScope,
    ExportShape, ExportSummary, InstalledMod, ModDocument, ModLibraryState, ModStorage,
    ModWadReport, ModpkgInfo, WadReportState,
};
use crate::patcher::{PatcherError, PatcherState};
use crate::state::SettingsState;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

/// Get all installed mods from the mod library.
#[tauri::command]
pub fn get_installed_mods(
    library: State<ModLibraryState>,
    settings: State<SettingsState>,
) -> IpcResult<Vec<InstalledMod>> {
    let config = settings.config();
    library.0.get_installed_mods(&config).into()
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
        let config = settings.config();
        let installed = library.0.install_mod_from_package(&config, &file_path)?;
        library
            .0
            .spawn_categorization(&config, vec![installed.id.clone()]);
        library
            .0
            .spawn_health_check(&config, vec![installed.id.clone()]);
        Ok(installed)
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
        let config = settings.config();
        let result = library.0.install_mods_from_packages(&config, &file_paths)?;
        let ids: Vec<String> = result.installed.iter().map(|m| m.id.clone()).collect();
        library.0.spawn_categorization(&config, ids.clone());
        library.0.spawn_health_check(&config, ids);
        Ok(result)
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
        let config = settings.config();
        library.0.uninstall_mod_by_id(&config, &mod_id)
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
        let config = settings.config();
        library.0.toggle_mod_enabled(&config, &mod_id, enabled)
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
        let config = settings.config();
        library.0.reorder_mods(&config, mod_ids)
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
        let config = settings.config();
        library.0.set_mod_layers(&config, &mod_id, layer_states)
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
        let config = settings.config();
        library
            .0
            .enable_mod_with_layers(&config, &mod_id, layer_states)
    })();
    result.into()
}

/// Edit a mod's metadata (name, tags, champions, maps).
#[tauri::command]
pub fn edit_mod_metadata(
    mod_id: String,
    metadata: EditModMetadataArgs,
    library: State<ModLibraryState>,
    settings: State<SettingsState>,
) -> IpcResult<InstalledMod> {
    let config = settings.config();
    library
        .0
        .edit_mod_metadata(&config, &mod_id, metadata)
        .into()
}

/// Read a mod's content from its archive or from an unpacked tree from now on.
///
/// Off-thread because unpacking writes the mod's whole content tree, which is
/// the one direction that is not instant.
#[tauri::command]
pub async fn set_mod_storage(
    mod_id: String,
    storage: ModStorage,
    app_handle: AppHandle,
) -> IpcResult<InstalledMod> {
    let setup: AppResult<_> = (|| {
        let patcher = app_handle.state::<PatcherState>();
        reject_if_patcher_running(&patcher)?;
        let config = app_handle.state::<SettingsState>().config();
        let library = app_handle.state::<ModLibraryState>().0.clone();
        Ok((config, library))
    })();

    let (config, library) = match setup {
        Ok(v) => v,
        Err(e) => return IpcResult::from(Err::<InstalledMod, _>(e)),
    };

    off_thread(move || {
        let updated = library.set_mod_storage(&config, &mod_id, storage)?;
        library.announce_change();
        Ok(updated)
    })
    .await
}

/// Copy the mods `scope` selects out to `destination`.
///
/// Off-thread because a library is gigabytes, and the zip shape reads every
/// archive through. Not rejected while the patcher runs: an export only reads.
#[tauri::command]
pub async fn export_mods(
    scope: ExportScope,
    shape: ExportShape,
    destination: String,
    app_handle: AppHandle,
) -> IpcResult<ExportSummary> {
    let config = app_handle.state::<SettingsState>().config();
    let library = app_handle.state::<ModLibraryState>().0.clone();

    off_thread(move || {
        let destination = match shape {
            ExportShape::Zip => with_zip_extension(Path::new(&destination)),
            ExportShape::Folder => PathBuf::from(destination),
        };
        library.export_mods(&config, scope, shape, &destination)
    })
    .await
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
    let config = settings.config();
    library.0.get_mod_thumbnail_path(&config, &mod_id).into()
}

/// Get the cached thumbnail path of each of `mod_ids` that has one.
///
/// One index read for the whole list, and a mod with no thumbnail is absent
/// from the map rather than an error. Off-thread, because a first read extracts
/// from every archive that has not been asked for yet.
#[tauri::command]
pub async fn get_mod_thumbnails(
    mod_ids: Vec<String>,
    app_handle: AppHandle,
) -> IpcResult<HashMap<String, String>> {
    let config = app_handle.state::<SettingsState>().config();
    let library = app_handle.state::<ModLibraryState>().0.clone();

    off_thread(move || library.get_mod_thumbnail_paths(&config, &mod_ids)).await
}

/// Get an installed mod's readme, extracting it from the archive on first access.
///
/// Off-thread, because a fantome's first ask mounts its archive.
#[tauri::command]
pub async fn get_mod_readme(mod_id: String, app_handle: AppHandle) -> IpcResult<ModDocument> {
    let config = app_handle.state::<SettingsState>().config();
    let library = app_handle.state::<ModLibraryState>().0.clone();

    off_thread(move || library.get_mod_readme(&config, &mod_id)).await
}

/// Get an installed mod's license text, which is never written to disk.
///
/// Off-thread, because every ask mounts the mod's archive.
#[tauri::command]
pub async fn get_mod_license_text(mod_id: String, app_handle: AppHandle) -> IpcResult<ModDocument> {
    let config = app_handle.state::<SettingsState>().config();
    let library = app_handle.state::<ModLibraryState>().0.clone();

    off_thread(move || library.get_mod_license_text(&config, &mod_id)).await
}

/// Get the mod storage directory path.
#[tauri::command]
pub fn get_storage_directory(
    library: State<ModLibraryState>,
    settings: State<SettingsState>,
) -> IpcResult<String> {
    let result: AppResult<String> = (|| {
        let config = settings.config();
        let storage_dir = library.0.storage_dir(&config)?;
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
    reports: State<Arc<WadReportState>>,
) -> IpcResult<Option<ModWadReport>> {
    IpcResult::ok(reports.0.lock().get(&mod_id))
}

/// Get all cached WAD footprint reports in a single batch. Returns a map of
/// mod id → report. Far cheaper than one IPC call per mod.
#[tauri::command]
pub fn get_all_mod_wad_reports(
    reports: State<Arc<WadReportState>>,
) -> IpcResult<HashMap<String, ModWadReport>> {
    IpcResult::ok(reports.0.lock().get_all())
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
    reports: State<Arc<WadReportState>>,
) -> IpcResult<ModWadReport> {
    let result: AppResult<ModWadReport> = (|| {
        let config = settings.config();
        let game_dir = ltk_manager_core::utils::game::GameDir::resolve(&config)?.into_path();
        let (profile_dir, mut enabled_mod) =
            library.0.build_single_mod_provider(&config, &mod_id)?;

        let game_dir = game_dir.try_into_utf8("game directory")?;
        let state_dir = profile_dir.try_into_utf8("profile directory")?;

        let upstream = ltk_overlay::OverlayBuilder::analyze_single_mod(
            &game_dir,
            &state_dir,
            &mut enabled_mod,
        )?;

        let mut report = ModWadReport::from_upstream(upstream);
        library
            .0
            .apply_precise_categorization(&config, game_dir.as_std_path(), &mut report);
        let mut store = reports.0.lock();
        store.upsert(report.clone())?;
        Ok(store.get(&report.mod_id).unwrap_or(report))
    })();
    result.into()
}

/// Reject the operation if the patcher is currently running.
pub(super) fn reject_if_patcher_running(patcher: &State<PatcherState>) -> AppResult<()> {
    if patcher.is_running() {
        return Err(PatcherError::Busy.into());
    }
    Ok(())
}
