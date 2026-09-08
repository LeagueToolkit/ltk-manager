use crate::commands::launcher::LauncherState;
use crate::error::{AppResult, IpcResult};
use crate::state::{persist_settings, LaunchMode, Settings, SettingsState};
use ltk_manager_core::utils::game::GameDir;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_autostart::ManagerExt;

/// Get current settings.
#[tauri::command]
pub fn get_settings(state: State<SettingsState>) -> IpcResult<Settings> {
    IpcResult::ok(state.0.lock().clone())
}

/// Save settings.
#[tauri::command]
pub fn save_settings(
    settings: Settings,
    app_handle: AppHandle,
    state: State<SettingsState>,
) -> IpcResult<()> {
    save_settings_inner(settings, &app_handle, &state).into()
}

pub(crate) fn save_settings_inner(
    settings: Settings,
    app_handle: &AppHandle,
    state: &State<SettingsState>,
) -> AppResult<()> {
    // Sync OS autolaunch with the updated setting
    let autolaunch = app_handle.autolaunch();
    if settings.auto_run {
        let _ = autolaunch.enable();
    } else {
        let _ = autolaunch.disable();
    }

    persist_settings(app_handle, &settings)?;

    // The launcher is built from the install root and re-reads the window
    // hider, both of which the user may just have moved. Logged rather than
    // propagated: the settings are already saved, and failing the save for a
    // launcher that cannot be rebuilt would report the wrong thing.
    let launcher: State<'_, LauncherState> = app_handle.state();
    if let Err(e) = launcher.launcher().reconfigure(&settings.config) {
        tracing::error!(error = ?e, "Could not apply the new settings to the launcher");
    }

    let mut current = state.0.lock();
    *current = settings;

    Ok(())
}

/// The settings a fresh install starts with.
///
/// Read once by the settings UI, so a row can say whether it is still at its
/// default and what resetting it would put back. The `get_` prefix is against
/// C-GETTER and stays, because `get_settings` is its neighbour.
#[tauri::command]
pub fn get_default_settings() -> IpcResult<Settings> {
    IpcResult::ok(Settings::default())
}

/// Auto-detect League of Legends installation path.
#[tauri::command]
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
        if let Some(root) = ltk_manager_core::launcher::detect_league_install_root() {
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
pub fn list_available_wads(state: State<SettingsState>) -> IpcResult<Vec<String>> {
    list_available_wads_inner(&state).into()
}

fn list_available_wads_inner(state: &State<SettingsState>) -> AppResult<Vec<String>> {
    let config = state.config();
    GameDir::resolve(&config)?.wads()
}

/// Whether League is configured to launch as administrator (an AppCompatFlags
/// `RUNASADMIN` layer on its executable).
///
/// When true, the patcher auto-elevates the injection host even if the
/// "run injector elevated" setting is off, since an elevated game can only be
/// injected by an elevated host. The settings UI surfaces this so users
/// understand why a UAC prompt may appear despite the setting being off.
#[tauri::command]
pub fn detect_league_run_as_admin() -> IpcResult<bool> {
    IpcResult::ok(ltk_manager_core::diagnostics::league_configured_as_admin())
}

/// Check if initial setup is required (league path not configured).
#[tauri::command]
pub fn check_setup_required(state: State<SettingsState>) -> IpcResult<bool> {
    IpcResult::ok(state.0.lock().config.league_path.is_none())
}
