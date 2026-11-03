//! The settings service: the settings themselves, the League install they point at, and
//! the lists the settings pages pick from.

use super::launcher::LauncherState;
use super::shared::{data_move, off_thread};
use crate::data_location::{self, DataMoveError, DataMovePlan};
use crate::data_usage::{self, DataArea, DataUsage};
use crate::error::{AppErrorResponse, AppResult, IpcResult};
use crate::events::TauriEventSink;
use crate::mods::ModLibraryState;
use crate::patcher::PatcherState;
use crate::settings_backup;
use crate::state::{persist_settings, LaunchMode, Settings, SettingsState};
use ltk_manager_base::config::Config;
use ltk_manager_base::events::{BackendEvent, DataMoveProgress, DataMoveStage, EventSink as _};
use ltk_manager_base::game_build::GameBuild;
use ltk_manager_base::utils::game::GameDir;
use ltk_manager_bin::meta_schema;
use ltk_manager_library::overlay::{
    forcible_map_skins, map_decorations, ForcibleMapSkin, MapDecoration,
};
use ltk_manager_problems::patch_status::PatchStatus;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_autostart::ManagerExt;

/// Get current settings.
#[tauri::command]
#[specta::specta]
pub fn get_settings(state: State<SettingsState>) -> IpcResult<Settings> {
    IpcResult::ok(state.0.lock().clone())
}

/// Read patch support and the installed content version without scanning a project.
#[tauri::command]
#[specta::specta]
pub async fn get_patch_status(app_handle: AppHandle) -> IpcResult<PatchStatus> {
    let config = app_handle.state::<SettingsState>().config();
    off_thread(move || {
        let installed = GameBuild::installed(&config);
        let schema = meta_schema::shared(installed);
        Ok(PatchStatus::new(
            &schema,
            installed,
            config.league_path.is_some(),
        ))
    })
    .await
}

/// Save settings.
#[tauri::command]
#[specta::specta]
pub fn save_settings(
    settings: Settings,
    app_handle: AppHandle,
    state: State<SettingsState>,
) -> IpcResult<()> {
    save_settings_inner(settings, &app_handle, &state).into()
}

pub(crate) fn save_settings_inner(
    mut settings: Settings,
    app_handle: &AppHandle,
    state: &State<SettingsState>,
) -> AppResult<()> {
    // Before the write, so a secret minted here reaches the file with everything
    // else rather than waiting for the next save.
    let (secret, _) = crate::telemetry::ensure_secret(&mut settings);
    let (was_collecting, had_file_types, had_beta_patcher) = {
        let current = state.0.lock();
        settings.runeforge = current.runeforge.clone();
        (
            current.telemetry_enabled,
            current.register_file_types,
            current.config.beta_patcher,
        )
    };

    // Sync OS autolaunch with the updated setting
    let autolaunch = app_handle.autolaunch();
    if settings.auto_run {
        let _ = autolaunch.enable();
    } else {
        let _ = autolaunch.disable();
    }

    persist_settings(app_handle, &settings)?;

    if settings.register_file_types != had_file_types {
        super::integrations::apply_file_types(app_handle, settings.register_file_types);
    }

    // A selection reads only the cache, so a change of channel starts a background sync.
    if settings.config.beta_patcher != had_beta_patcher {
        app_handle
            .state::<crate::patcher::PatcherDeliveryState>()
            .sync_in_background(&settings.config);
    }

    // The launcher is built from the install root and re-reads the window
    // hider, both of which the user may just have moved. Logged rather than
    // propagated: the settings are already saved, and failing the save for a
    // launcher that cannot be rebuilt would report the wrong thing.
    let launcher: State<'_, LauncherState> = app_handle.state();
    if let Err(e) = launcher.launcher().reconfigure(&settings.config) {
        tracing::error!(error = ?e, "Could not apply the new settings to the launcher");
    }

    // Rebuilt rather than toggled, because turning the setting off has to drop
    // what was spooled under the old answer rather than hold it back.
    let telemetry = crate::telemetry::state(app_handle);
    let remote = telemetry.remote();
    telemetry.replace(crate::telemetry::build(
        app_handle, &settings, secret, &remote,
    ));

    // Only on the way back on, because an install that refused never fetched the
    // document and would otherwise report under the compiled defaults.
    if settings.telemetry_enabled && !was_collecting {
        crate::telemetry::refresh_from_document(app_handle);
    }

    let mut current = state.0.lock();
    *current = settings;

    Ok(())
}

/// Shortest time between two progress events of a data directory move.
const DATA_MOVE_PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

/// Measures the disk usage of the manager's data.
#[tauri::command]
#[specta::specta]
pub async fn data_usage(app_handle: AppHandle) -> IpcResult<DataUsage> {
    off_thread(move || {
        let config = app_handle.state::<SettingsState>().config();
        let library = app_handle.state::<ModLibraryState>().0.clone();
        data_usage::usage(&app_handle, &config, &library)
    })
    .await
}

/// Clears `area` of the manager's data. The overlay areas wait for the patcher to stop.
#[tauri::command]
#[specta::specta]
pub async fn clear_data_area(area: DataArea, app_handle: AppHandle) -> IpcResult<()> {
    off_thread(move || {
        if matches!(area, DataArea::OverlayBuilds | DataArea::Leftovers) {
            app_handle.state::<PatcherState>().reject_if_running()?;
        }

        let config = app_handle.state::<SettingsState>().config();
        let library = app_handle.state::<ModLibraryState>().0.clone();
        data_usage::clear(&app_handle, &config, &library, area)
    })
    .await
}

/// Writes the settings to a backup file at `path`.
#[tauri::command]
#[specta::specta]
pub fn export_settings(path: PathBuf, state: State<SettingsState>) -> IpcResult<()> {
    let settings = state.0.lock().clone();
    settings_backup::export(&settings, &path)
        .map_err(|error| AppErrorResponse::SettingsBackup { error })
        .into()
}

/// Reads the backup at `path` over the current settings, and returns the result unsaved.
///
/// The caller saves the result through `save_settings`, which applies its side effects.
#[tauri::command]
#[specta::specta]
pub fn read_settings_backup(path: PathBuf, state: State<SettingsState>) -> IpcResult<Settings> {
    let current = state.0.lock().clone();
    settings_backup::restore(&current, &path)
        .map_err(|error| AppErrorResponse::SettingsBackup { error })
        .into()
}

/// Plans a move of the data directory to `target`, or to the app data directory if `target` is `None`.
#[tauri::command]
#[specta::specta]
pub async fn plan_data_move(
    target: Option<PathBuf>,
    app_handle: AppHandle,
) -> IpcResult<DataMovePlan> {
    data_move(move || {
        let config = app_handle.state::<SettingsState>().config();
        let (from, to) = data_move_folders(&app_handle, &config, target.as_deref())?;
        data_location::plan(&from, &to)
    })
    .await
}

/// Moves the data directory to `target`, or to the app data directory if `target` is `None`.
///
/// Stores the new location and restarts the app, because the library watcher, the incident
/// store and the patcher delivery read the data directory once at startup. The library index
/// stays locked from the move until the settings name the new folder.
#[tauri::command]
#[specta::specta]
pub async fn move_data(target: Option<PathBuf>, app_handle: AppHandle) -> IpcResult<()> {
    data_move(move || {
        if app_handle.state::<PatcherState>().is_running() {
            return Err(DataMoveError::PatcherRunning);
        }

        let state = app_handle.state::<SettingsState>();
        let mut settings = state.0.lock().clone();
        let (from, to) = data_move_folders(&app_handle, &settings.config, target.as_deref())?;
        let library = app_handle.state::<ModLibraryState>().0.clone();
        let events = TauriEventSink::new(app_handle.clone());

        library.with_index_held(|| {
            let plan = data_location::plan(&from, &to)?;
            let total = plan.bytes();
            let mut last_report: Option<Instant> = None;
            data_location::run(&plan, |entry, moved| {
                let now = Instant::now();
                if last_report.is_some_and(|at| now - at < DATA_MOVE_PROGRESS_INTERVAL) {
                    return;
                }
                last_report = Some(now);
                events.emit(BackendEvent::DataMoveProgress(DataMoveProgress {
                    stage: DataMoveStage::Moving,
                    current_entry: Some(entry.to_owned()),
                    moved,
                    total,
                }));
            })?;

            settings.config.mod_storage_path = target;
            persist_settings(&app_handle, &settings)?;
            *state.0.lock() = settings;

            events.emit(BackendEvent::DataMoveProgress(DataMoveProgress {
                stage: DataMoveStage::Restarting,
                current_entry: None,
                moved: total,
                total,
            }));
            Ok::<_, DataMoveError>(())
        })?;

        tracing::info!(from = %from.display(), to = %to.display(), "Moved the data directory, restarting");
        crate::patcher::shutdown_resources(&app_handle);
        app_handle.restart()
    })
    .await
}

/// Returns the current data directory and the one that `target` selects.
fn data_move_folders(
    app_handle: &AppHandle,
    config: &Config,
    target: Option<&Path>,
) -> Result<(PathBuf, PathBuf), DataMoveError> {
    let unavailable = || DataMoveError::Io {
        detail: "the app data directory is unavailable".to_owned(),
    };

    let from = data_location::data_dir(app_handle, config).ok_or_else(unavailable)?;
    let to = match target {
        Some(target) => target.to_path_buf(),
        None => crate::state::get_app_data_dir(app_handle).ok_or_else(unavailable)?,
    };
    Ok((from, to))
}

/// The settings a fresh install starts with.
///
/// Read once by the settings UI, so a row can say whether it is still at its
/// default and what resetting it would put back. The `get_` prefix is against
/// C-GETTER and stays, because `get_settings` is its neighbour.
#[tauri::command]
#[specta::specta]
pub fn get_default_settings() -> IpcResult<Settings> {
    IpcResult::ok(Settings::default())
}

/// Auto-detect League of Legends installation path.
#[tauri::command]
#[specta::specta]
pub fn auto_detect_league_path(state: State<SettingsState>) -> IpcResult<Option<PathBuf>> {
    let launch_mode = state.0.lock().launch_mode;

    IpcResult::ok(auto_detect_league_path_inner(launch_mode))
}

/// Ask the Riot Client first, then fall back to scanning for the executable.
///
/// The client's product registry is authoritative - Foundation builds League's
/// own command line from the same `install_full_path` - while the scan infers a
/// root by walking up from an exe it found. The scan stays because the registry
/// only answers while the client is running, which on first run it often isn't.
///
/// Classic skips the client and detects the way the manager did before it could
/// talk to one: the mode exists for people who keep the launcher out of it, so
/// asking the client to find their install would be the launcher back by another
/// route. The scan reads the client's `RiotClientInstalls.json`, the running
/// game, the usual install roots and the Windows registry, none of which need a
/// client to be up.
fn auto_detect_league_path_inner(launch_mode: LaunchMode) -> Option<PathBuf> {
    if launch_mode == LaunchMode::Modern {
        if let Some(root) = ltk_manager_runtime::launcher::detect_league_install_root() {
            tracing::info!(
                "Riot Client reports League installed at: {}",
                root.display()
            );
            return Some(root);
        }
    }

    let exe_path = ltk_mod_core::auto_detect_league_path()?;
    let path = std::path::Path::new(&exe_path);

    // Navigate from "Game/League of Legends.exe" to installation root
    let install_root = path.parent()?.parent()?;

    tracing::info!("Found League installation at: {:?}", install_root);
    Some(install_root.to_path_buf())
}

/// Validate a League installation path.
#[tauri::command]
#[specta::specta]
pub fn validate_league_path(path: PathBuf) -> IpcResult<bool> {
    let valid = if cfg!(target_os = "macos") {
        // Path points to the .app bundle (e.g. /Applications/League of Legends.app)
        path.join("Contents").join("LoL").join("Game").exists()
            // Path points to the LoL root inside the bundle
            || path.join("Game").join("League of Legends.app").exists()
    } else {
        path.join("Game").join("League of Legends.exe").exists()
    };
    IpcResult::ok(valid)
}

/// List every WAD filename under the configured League install's `DATA` directory.
///
/// Used by the WAD blocklist editor for autocomplete and regex match previews.
/// Returns lowercased filenames sorted alphabetically.
#[tauri::command]
#[specta::specta]
pub fn list_available_wads(state: State<SettingsState>) -> IpcResult<Vec<String>> {
    list_available_wads_inner(&state).into()
}

fn list_available_wads_inner(state: &State<SettingsState>) -> AppResult<Vec<String>> {
    let config = state.config();
    GameDir::resolve(&config)?.wads()
}

/// Every map skin the configured install can show in place of the one a server names.
#[tauri::command]
#[specta::specta]
pub fn list_forcible_map_skins(state: State<SettingsState>) -> IpcResult<Vec<ForcibleMapSkin>> {
    list_forcible_map_skins_inner(&state).into()
}

fn list_forcible_map_skins_inner(state: &State<SettingsState>) -> AppResult<Vec<ForcibleMapSkin>> {
    let config = state.config();
    forcible_map_skins(&GameDir::resolve(&config)?)
}

/// Every map decoration a mutator switches in the configured install.
#[tauri::command]
#[specta::specta]
pub fn list_map_decorations(state: State<SettingsState>) -> IpcResult<Vec<MapDecoration>> {
    list_map_decorations_inner(&state).into()
}

fn list_map_decorations_inner(state: &State<SettingsState>) -> AppResult<Vec<MapDecoration>> {
    let config = state.config();
    map_decorations(&GameDir::resolve(&config)?)
}

/// Whether League is configured to launch as administrator (an AppCompatFlags
/// `RUNASADMIN` layer on its executable).
///
/// When true, a patcher start fails, and the settings UI shows that.
#[tauri::command]
#[specta::specta]
pub fn detect_league_run_as_admin() -> IpcResult<bool> {
    IpcResult::ok(ltk_manager_runtime::diagnostics::league_configured_as_admin())
}

/// Check if initial setup is required (league path not configured).
#[tauri::command]
#[specta::specta]
pub fn check_setup_required(state: State<SettingsState>) -> IpcResult<bool> {
    IpcResult::ok(state.0.lock().config.league_path.is_none())
}

/// The settings service's row of `services/table.rs`.
pub struct Table;

/// The plugin answering the settings commands.
pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    super::plugin::<Table>().build()
}
