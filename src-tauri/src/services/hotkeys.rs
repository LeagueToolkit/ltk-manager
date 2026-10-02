//! The hotkeys service: setting a global hotkey, and pausing every hotkey while one is
//! captured. What a pressed hotkey runs is here too.

use crate::error::{AppResult, IpcResult};
use crate::hotkeys::{HotkeyAction, HotkeyManager};
use crate::mods::ModLibraryState;
use crate::patcher::{PatcherHostState, PatcherState};
use crate::state::{persist_settings, IncidentStoreState, SettingsState};
use ltk_manager_core::launcher::{kill_game, reconnect_client};
use tauri::{AppHandle, Manager, State};

use super::patcher::{start_patcher_inner, PatcherConfig};

// ── Hotkey action implementations (called from shortcut callbacks) ──

/// Execute hot-reload: stop patcher → kill League → restart patcher.
pub(crate) fn execute_hot_reload(app_handle: &AppHandle) -> AppResult<()> {
    let patcher_state = app_handle.state::<PatcherState>();
    let host_state = app_handle.state::<PatcherHostState>();
    let settings_state = app_handle.state::<SettingsState>();
    let library_state = app_handle.state::<ModLibraryState>();
    let incidents_state = app_handle.state::<IncidentStoreState>();

    // Get the last config before stopping
    let last_config = patcher_state.with(|ps| ps.last_config.clone());

    let config = match last_config {
        Some(c) => c,
        None => {
            tracing::trace!("Hot reload: no previous patcher session, ignoring");
            return Ok(());
        }
    };

    if patcher_state.request_stop() {
        tracing::trace!("Hot reload: stopping patcher...");
    }

    patcher_state.wait_for_stop()?;
    kill_game();

    tracing::info!("Hot reload: restarting patcher");
    start_patcher_inner(
        PatcherConfig::from_stored(config, false),
        app_handle,
        &patcher_state,
        &host_state,
        &settings_state,
        &library_state,
        &incidents_state,
    )?;

    // Best-effort LCU reconnect (in background - retries take time)
    let league_path = settings_state.config().league_path;
    if let Some(path) = league_path {
        std::thread::spawn(move || reconnect_client(&path));
    }

    Ok(())
}

/// Execute kill-league action.
pub(crate) fn execute_kill_league(app_handle: &AppHandle) -> AppResult<()> {
    let patcher_state = app_handle.state::<PatcherState>();
    let settings_state = app_handle.state::<SettingsState>();

    let should_stop_patcher = {
        let s = settings_state.0.lock();
        s.kill_league_stops_patcher
    };

    if should_stop_patcher {
        if patcher_state.request_stop() {
            tracing::trace!("Kill league: also stopping patcher");
        }
        patcher_state.wait_for_stop()?;
    }

    kill_game();
    Ok(())
}

// ── IPC commands (called from frontend) ──

/// Temporarily unregister all hotkeys (e.g. while capturing a new binding).
#[tauri::command]
#[specta::specta]
pub fn pause_hotkeys(
    hotkeys: State<HotkeyManager>,
    settings: State<SettingsState>,
) -> IpcResult<()> {
    hotkeys.pause(&settings.0.lock());
    IpcResult::ok(())
}

/// Re-register all hotkeys after capture mode ends.
#[tauri::command]
#[specta::specta]
pub fn resume_hotkeys(
    hotkeys: State<HotkeyManager>,
    settings: State<SettingsState>,
) -> IpcResult<()> {
    hotkeys.resume(&settings.0.lock());
    IpcResult::ok(())
}

/// Set (or clear) a global hotkey for the given action.
#[tauri::command]
#[specta::specta]
pub fn set_hotkey(
    action: HotkeyAction,
    accelerator: Option<String>,
    app_handle: AppHandle,
    hotkeys: State<HotkeyManager>,
    settings: State<SettingsState>,
) -> IpcResult<()> {
    set_hotkey_inner(action, accelerator, &app_handle, &hotkeys, &settings).into()
}

fn set_hotkey_inner(
    action: HotkeyAction,
    accelerator: Option<String>,
    app_handle: &AppHandle,
    hotkeys: &State<HotkeyManager>,
    settings: &State<SettingsState>,
) -> AppResult<()> {
    let mut s = settings.0.lock();
    let old_hotkey = action.get_accelerator(&s).map(str::to_string);

    match accelerator {
        Some(ref accel) if !accel.trim().is_empty() => {
            let trimmed = accel.trim().to_string();
            action.check_no_conflict(&s, &trimmed)?;
            hotkeys.register(action, &trimmed)?;
            if let Some(ref old) = old_hotkey {
                hotkeys.unregister(old);
            }
            action.set_accelerator(&mut s, Some(trimmed));
        }
        _ => {
            if let Some(ref old) = old_hotkey {
                hotkeys.unregister(old);
            }
            action.set_accelerator(&mut s, None);
        }
    }

    persist_settings(app_handle, &s)?;
    Ok(())
}

/// The hotkeys service's row of `services/table.rs`.
pub struct Table;

/// The plugin answering the hotkey commands.
pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    super::plugin::<Table>().build()
}
