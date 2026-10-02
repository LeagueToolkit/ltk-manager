use crate::error::{AppResult, IpcResult, Utf8PathExt};
use crate::mods::{
    with_zip_extension, BulkInstallResult, EditModMetadataArgs, ExportScope, ExportShape,
    ExportSummary, InstalledMod, ModDocument, ModLibraryState, ModStorage, ModWadReport,
    WadReportState,
};
use crate::patcher::PatcherState;
use crate::services::shared::off_thread;
use crate::services::shared::Library;
use crate::state::SettingsState;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

/// Get all installed mods from the mod library.
#[tauri::command]
#[specta::specta]
pub fn get_installed_mods(library: Library) -> IpcResult<Vec<InstalledMod>> {
    library.with(|library, config| library.get_installed_mods(config))
}

/// Install a mod from a `.modpkg` or `.fantome` file into `modStoragePath`.
#[tauri::command]
#[specta::specta]
pub fn install_mod(
    file_path: String,
    library: State<ModLibraryState>,
    settings: State<SettingsState>,
    patcher: State<PatcherState>,
) -> IpcResult<InstalledMod> {
    let result: AppResult<InstalledMod> = (|| {
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
    patcher.refresh_overlay();
    result.into()
}

/// Install multiple mods from `.modpkg` or `.fantome` files in a single batch.
#[tauri::command]
#[specta::specta]
pub fn install_mods(
    file_paths: Vec<String>,
    library: State<ModLibraryState>,
    settings: State<SettingsState>,
    patcher: State<PatcherState>,
) -> IpcResult<BulkInstallResult> {
    let result: AppResult<BulkInstallResult> = (|| {
        let config = settings.config();
        let result = library.0.install_mods_from_packages(&config, &file_paths)?;
        let ids: Vec<String> = result.installed.iter().map(|m| m.id.clone()).collect();
        library.0.spawn_categorization(&config, ids.clone());
        library.0.spawn_health_check(&config, ids);
        Ok(result)
    })();
    patcher.refresh_overlay();
    result.into()
}

/// Replace a library mod from a new archive.
#[tauri::command]
#[specta::specta]
pub async fn update_mod(
    mod_id: String,
    file_path: String,
    app_handle: AppHandle,
) -> IpcResult<InstalledMod> {
    let config = app_handle.state::<SettingsState>().config();
    let library = app_handle.state::<ModLibraryState>().0.clone();
    off_thread(move || {
        let updated = library.update_mod_from_package(&config, &mod_id, &file_path);
        app_handle.state::<PatcherState>().refresh_overlay();
        let updated = updated?;
        library.announce_change();
        library.spawn_categorization(&config, vec![mod_id.clone()]);
        library.spawn_health_check(&config, vec![mod_id]);
        Ok(updated)
    })
    .await
}
/// Uninstall a mod by id.
#[tauri::command]
#[specta::specta]
pub fn uninstall_mod(mod_id: String, library: Library) -> IpcResult<()> {
    library.with_refresh(|library, config| library.uninstall_mod_by_id(config, &mod_id))
}

/// Toggle a mod's enabled state.
#[tauri::command]
#[specta::specta]
pub fn toggle_mod(mod_id: String, enabled: bool, library: Library) -> IpcResult<()> {
    library.with_refresh(|library, config| library.toggle_mod_enabled(config, &mod_id, enabled))
}

/// Reorder the enabled mods in the active profile.
#[tauri::command]
#[specta::specta]
pub fn reorder_mods(mod_ids: Vec<String>, library: Library) -> IpcResult<()> {
    library.with_refresh(|library, config| library.reorder_mods(config, mod_ids))
}

/// Set the enabled/disabled state of individual layers for a mod.
#[tauri::command]
#[specta::specta]
pub fn set_mod_layers(
    mod_id: String,
    layer_states: HashMap<String, bool>,
    library: Library,
) -> IpcResult<()> {
    library.with_refresh(|library, config| library.set_mod_layers(config, &mod_id, layer_states))
}

/// Enable a mod and set its initial layer configuration atomically.
#[tauri::command]
#[specta::specta]
pub fn enable_mod_with_layers(
    mod_id: String,
    layer_states: HashMap<String, bool>,
    library: Library,
) -> IpcResult<()> {
    library.with_refresh(|library, config| {
        library.enable_mod_with_layers(config, &mod_id, layer_states)
    })
}

/// Edit a mod's metadata (name, tags, champions, maps).
#[tauri::command]
#[specta::specta]
pub fn edit_mod_metadata(
    mod_id: String,
    metadata: EditModMetadataArgs,
    library: Library,
) -> IpcResult<InstalledMod> {
    library.with(|library, config| library.edit_mod_metadata(config, &mod_id, metadata))
}

/// Read a mod's content from its archive or from an unpacked tree from now on.
///
/// Off-thread because unpacking writes the mod's whole content tree, which is
/// the one direction that is not instant.
#[tauri::command]
#[specta::specta]
pub async fn set_mod_storage(
    mod_id: String,
    storage: ModStorage,
    app_handle: AppHandle,
) -> IpcResult<InstalledMod> {
    let config = app_handle.state::<SettingsState>().config();
    let library = app_handle.state::<ModLibraryState>().0.clone();

    off_thread(move || {
        let updated = library.set_mod_storage(&config, &mod_id, storage);
        app_handle.state::<PatcherState>().refresh_overlay();
        let updated = updated?;
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
#[specta::specta]
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

/// Get a mod's cached thumbnail path, extracting from the archive on first access.
/// Returns `null` if the mod has no thumbnail.
#[tauri::command]
#[specta::specta]
pub fn get_mod_thumbnail(mod_id: String, library: Library) -> IpcResult<Option<String>> {
    library.with(|library, config| library.get_mod_thumbnail_path(config, &mod_id))
}

/// Get the cached thumbnail path of each of `mod_ids` that has one.
///
/// One index read for the whole list, and a mod with no thumbnail is absent
/// from the map rather than an error. Off-thread, because a first read extracts
/// from every archive that has not been asked for yet.
#[tauri::command]
#[specta::specta]
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
#[specta::specta]
pub async fn get_mod_readme(mod_id: String, app_handle: AppHandle) -> IpcResult<ModDocument> {
    let config = app_handle.state::<SettingsState>().config();
    let library = app_handle.state::<ModLibraryState>().0.clone();

    off_thread(move || library.get_mod_readme(&config, &mod_id)).await
}

/// Get an installed mod's license text, which is never written to disk.
///
/// Off-thread, because every ask mounts the mod's archive.
#[tauri::command]
#[specta::specta]
pub async fn get_mod_license_text(mod_id: String, app_handle: AppHandle) -> IpcResult<ModDocument> {
    let config = app_handle.state::<SettingsState>().config();
    let library = app_handle.state::<ModLibraryState>().0.clone();

    off_thread(move || library.get_mod_license_text(&config, &mod_id)).await
}

/// Get the mod storage directory path.
#[tauri::command]
#[specta::specta]
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

/// Get all cached WAD footprint reports in a single batch. Returns a map of
/// mod id → report. Far cheaper than one IPC call per mod.
#[tauri::command]
#[specta::specta]
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
#[specta::specta]
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
