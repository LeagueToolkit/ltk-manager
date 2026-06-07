use crate::error::{AppResult, IpcResult, MutexResultExt};
use crate::overlay::{list_game_wads, resolve_game_dir};
use crate::state::{save_settings_to_disk, Settings, SettingsState};
use std::path::PathBuf;
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;

/// Get current settings.
#[tauri::command]
pub fn get_settings(state: State<SettingsState>) -> IpcResult<Settings> {
    get_settings_inner(&state).into()
}

fn get_settings_inner(state: &State<SettingsState>) -> AppResult<Settings> {
    let settings = state.0.lock().mutex_err()?;
    Ok(settings.clone())
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

fn save_settings_inner(
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

    save_settings_to_disk(app_handle, &settings)?;

    let mut current = state.0.lock().mutex_err()?;
    *current = settings;

    Ok(())
}

/// Auto-detect League of Legends installation path.
#[tauri::command]
pub fn auto_detect_league_path() -> IpcResult<Option<PathBuf>> {
    IpcResult::ok(auto_detect_league_path_inner())
}

fn auto_detect_league_path_inner() -> Option<PathBuf> {
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
    let valid = resolve_game_dir(&Settings {
        league_path: Some(path),
        ..Settings::default()
    })
    .is_ok();
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
    let settings = state.0.lock().mutex_err()?.clone();
    let game_dir = resolve_game_dir(&settings)?;
    list_game_wads(&game_dir)
}

/// Check if initial setup is required (league path not configured).
#[tauri::command]
pub fn check_setup_required(state: State<SettingsState>) -> IpcResult<bool> {
    check_setup_required_inner(&state).into()
}

fn check_setup_required_inner(state: &State<SettingsState>) -> AppResult<bool> {
    let settings = state.0.lock().mutex_err()?;

    Ok(settings.league_path.is_none())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_league_path_accepts_resolvable_game_dir() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("League of Legends");
        std::fs::create_dir_all(root.join("Game")).unwrap();

        assert!(matches!(
            validate_league_path(root),
            IpcResult::Ok { value: true }
        ));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn validate_league_path_accepts_macos_inner_lol_root() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir
            .path()
            .join("League of Legends.app")
            .join("Contents")
            .join("LoL");
        std::fs::create_dir_all(root.join("Game")).unwrap();

        assert!(matches!(
            validate_league_path(root),
            IpcResult::Ok { value: true }
        ));
    }
}
