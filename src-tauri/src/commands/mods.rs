use crate::deep_link;
use crate::error::{AppError, AppResult, IpcResult, MutexResultExt, Utf8PathExt};
use crate::mods::{
    inspect_modpkg_file, BulkInstallResult, EditModMetadataArgs, InstalledMod, ModLibraryState,
    ModWadReport, ModpkgInfo, WadReportState,
};
use crate::patcher::{PatcherError, PatcherState};
use crate::state::SettingsState;
use ltk_manager_core::config::Config;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::State;

/// Get all installed mods from the mod library.
#[tauri::command]
pub fn get_installed_mods(
    library: State<ModLibraryState>,
    settings: State<SettingsState>,
) -> IpcResult<Vec<InstalledMod>> {
    let result: AppResult<Vec<InstalledMod>> = (|| {
        let config = settings.config()?;
        library.0.get_installed_mods(&config)
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
        let config = settings.config()?;
        let installed = library.0.install_mod_from_package(&config, &file_path)?;
        let thumbnail_library = library.0.clone();
        let thumbnail_config = config.clone();
        let thumbnail_mod = installed.clone();
        std::thread::spawn(move || {
            cache_missing_runeforge_thumbnail(
                &thumbnail_library,
                &thumbnail_config,
                &thumbnail_mod,
            );
        });
        library
            .0
            .spawn_categorization(&config, vec![installed.id.clone()]);
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
        let config = settings.config()?;
        let result = library.0.install_mods_from_packages(&config, &file_paths)?;
        let thumbnail_library = library.0.clone();
        let thumbnail_config = config.clone();
        let thumbnail_mods = result.installed.clone();
        std::thread::spawn(move || {
            for installed in thumbnail_mods {
                cache_missing_runeforge_thumbnail(
                    &thumbnail_library,
                    &thumbnail_config,
                    &installed,
                );
            }
        });
        let ids = result.installed.iter().map(|m| m.id.clone()).collect();
        library.0.spawn_categorization(&config, ids);
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
        let config = settings.config()?;
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
        let config = settings.config()?;
        library.0.toggle_mod_enabled(&config, &mod_id, enabled)
    })();
    result.into()
}

fn cache_missing_runeforge_thumbnail(
    library: &crate::mods::ModLibrary,
    config: &Config,
    installed: &InstalledMod,
) {
    let metadata_dir = std::path::Path::new(&installed.mod_dir);
    if metadata_dir.join("thumbnail.webp").exists() || metadata_dir.join("thumbnail.png").exists() {
        return;
    }

    match deep_link::find_runeforge_thumbnail(&installed.display_name, &installed.authors) {
        Ok(Some(bytes)) => {
            if let Err(error) = library.cache_mod_thumbnail(config, &installed.id, &bytes) {
                tracing::warn!("Failed to cache RuneForge thumbnail: {}", error);
            }
        }
        Ok(None) => {}
        Err(error) => tracing::warn!("Failed to find RuneForge thumbnail: {}", error),
    }
}

/// Set multiple mods to the same enabled state in one library transaction.
#[tauri::command]
pub fn set_mods_enabled(
    mod_ids: Vec<String>,
    enabled: bool,
    library: State<ModLibraryState>,
    settings: State<SettingsState>,
    patcher: State<PatcherState>,
) -> IpcResult<()> {
    let result: AppResult<()> = (|| {
        reject_if_patcher_running(&patcher)?;
        let config = settings.config()?;
        library.0.set_mods_enabled(&config, &mod_ids, enabled)
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
        let config = settings.config()?;
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
        let config = settings.config()?;
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
        let config = settings.config()?;
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
    let result: AppResult<InstalledMod> = (|| {
        let config = settings.config()?;
        library.0.edit_mod_metadata(&config, &mod_id, metadata)
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
        let config = settings.config()?;
        library.0.get_mod_thumbnail_path(&config, &mod_id)
    })();
    result.into()
}

/// Search RuneForge for artwork for an installed mod and cache a strong match.
#[tauri::command]
pub fn fetch_mod_thumbnail(
    mod_id: String,
    library: State<ModLibraryState>,
    settings: State<SettingsState>,
) -> IpcResult<Option<String>> {
    let result: AppResult<Option<String>> = (|| {
        let config = settings.config()?;
        if let Some(existing) = library.0.get_mod_thumbnail_path(&config, &mod_id)? {
            return Ok(Some(existing));
        }
        let installed = library
            .0
            .get_installed_mods(&config)?
            .into_iter()
            .find(|installed| installed.id == mod_id)
            .ok_or_else(|| AppError::ModNotFound(mod_id.clone()))?;
        let Some(bytes) =
            deep_link::find_runeforge_thumbnail(&installed.display_name, &installed.authors)?
        else {
            return Ok(None);
        };
        library
            .0
            .cache_mod_thumbnail(&config, &mod_id, &bytes)
            .map(Some)
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
        let config = settings.config()?;
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
    reports: State<Arc<WadReportState>>,
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
    reports: State<Arc<WadReportState>>,
) -> IpcResult<ModWadReport> {
    let result: AppResult<ModWadReport> = (|| {
        let config = settings.config()?;
        let game_dir = ltk_manager_core::utils::game::GameDir::resolve(&config)?.into_path();
        let (profile_dir, mut enabled_mod) =
            library.0.build_single_mod_provider(&config, &mod_id)?;

        let game_dir = game_dir.try_into_utf8("game directory")?;
        let state_dir = profile_dir.try_into_utf8("profile directory")?;

        let upstream = ltk_overlay::OverlayBuilder::analyze_single_mod(
            &game_dir,
            &state_dir,
            &mut enabled_mod,
        )
        .map_err(|e| AppError::Other(format!("Mod analysis failed: {}", e)))?;

        let mut report = ModWadReport::from_upstream(upstream);
        library
            .0
            .apply_precise_categorization(&config, game_dir.as_std_path(), &mut report);
        let mut store = reports.0.lock().mutex_err()?;
        store.upsert(report.clone())?;
        Ok(store.get(&report.mod_id).unwrap_or(report))
    })();
    result.into()
}

/// Reject the operation if the patcher is currently running.
pub(super) fn reject_if_patcher_running(patcher: &State<PatcherState>) -> AppResult<()> {
    if patcher.is_running()? {
        return Err(PatcherError::Busy.into());
    }
    Ok(())
}
