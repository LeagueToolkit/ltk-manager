use crate::error::{AppError, AppResult, IpcResult, MutexResultExt};
use crate::hotkeys::{HotkeyAction, HotkeyManager};
use crate::mods::ModLibraryState;
use crate::patcher::{PatcherHostState, PatcherState};
use crate::state::{persist_settings, IncidentStoreState, SettingsState};
use std::path::Path;
use std::process::Command;
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
    let last_config = patcher_state.with(|ps| ps.last_config.clone())?;

    let config = match last_config {
        Some(c) => c,
        None => {
            tracing::trace!("Hot reload: no previous patcher session, ignoring");
            return Ok(());
        }
    };

    if patcher_state.request_stop()? {
        tracing::trace!("Hot reload: stopping patcher...");
    }

    wait_for_patcher_stop(&patcher_state)?;
    kill_league_process();
    std::thread::sleep(std::time::Duration::from_millis(500));

    let patcher_config = PatcherConfig {
        flags: config.flags,
        workshop_projects: config.workshop_projects,
    };

    tracing::info!("Hot reload: restarting patcher");
    start_patcher_inner(
        patcher_config,
        app_handle,
        &patcher_state,
        &host_state,
        &settings_state,
        &library_state,
        &incidents_state,
    )?;

    // Best-effort LCU reconnect (in background - retries take time)
    let league_path = settings_state.config()?.league_path;
    if let Some(path) = league_path {
        std::thread::spawn(move || try_lcu_reconnect(&path));
    }

    Ok(())
}

/// Execute kill-league action.
pub(crate) fn execute_kill_league(app_handle: &AppHandle) -> AppResult<()> {
    let patcher_state = app_handle.state::<PatcherState>();
    let settings_state = app_handle.state::<SettingsState>();

    let should_stop_patcher = {
        let s = settings_state.0.lock().mutex_err()?;
        s.kill_league_stops_patcher
    };

    if should_stop_patcher {
        if patcher_state.request_stop()? {
            tracing::trace!("Kill league: also stopping patcher");
        }
        wait_for_patcher_stop(&patcher_state)?;
    }

    kill_league_process();
    Ok(())
}

// ── IPC commands (called from frontend) ──

/// Temporarily unregister all hotkeys (e.g. while capturing a new binding).
#[tauri::command]
pub fn pause_hotkeys(
    hotkeys: State<HotkeyManager>,
    settings: State<SettingsState>,
) -> IpcResult<()> {
    pause_hotkeys_inner(&hotkeys, &settings).into()
}

fn pause_hotkeys_inner(
    hotkeys: &State<HotkeyManager>,
    settings: &State<SettingsState>,
) -> AppResult<()> {
    let s = settings.0.lock().mutex_err()?;
    hotkeys.pause(&s);
    Ok(())
}

/// Re-register all hotkeys after capture mode ends.
#[tauri::command]
pub fn resume_hotkeys(
    hotkeys: State<HotkeyManager>,
    settings: State<SettingsState>,
) -> IpcResult<()> {
    resume_hotkeys_inner(&hotkeys, &settings).into()
}

fn resume_hotkeys_inner(
    hotkeys: &State<HotkeyManager>,
    settings: &State<SettingsState>,
) -> AppResult<()> {
    let s = settings.0.lock().mutex_err()?;
    hotkeys.resume(&s);
    Ok(())
}

/// Set (or clear) a global hotkey for the given action.
#[tauri::command]
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
    let mut s = settings.0.lock().mutex_err()?;
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

/// Kill the League of Legends process, optionally stopping the patcher first.
///
/// Runs on a blocking thread rather than inline: stopping the patcher waits up
/// to 5 s for the session thread to wind down, which would otherwise hold the
/// IPC handler for the whole duration. Shares [`execute_kill_league`] with the
/// hotkey path so the two cannot drift.
#[tauri::command]
pub async fn kill_league(app_handle: AppHandle) -> IpcResult<()> {
    tauri::async_runtime::spawn_blocking(move || execute_kill_league(&app_handle))
        .await
        .unwrap_or_else(|e| Err(AppError::Other(e.to_string())))
        .into()
}

// ── Helpers ──

/// Wait for the patcher thread to finish (with timeout).
fn wait_for_patcher_stop(state: &PatcherState) -> AppResult<()> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        if !state.is_running()? {
            return Ok(());
        }
        if std::time::Instant::now() > deadline {
            return Err(AppError::Other(
                "Timed out waiting for patcher to stop".to_string(),
            ));
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
}

// ── LCU Reconnect ──

/// Parsed LCU lockfile data.
struct LockfileData {
    port: u16,
    password: String,
}

/// Read and parse the League Client lockfile.
/// Format: `LeagueClient:pid:port:password:https` (5-part) or `process:port:password:protocol` (4-part).
fn read_lockfile(league_path: &Path) -> Option<LockfileData> {
    let lockfile_path = league_path.join("lockfile");

    let content = match std::fs::read_to_string(&lockfile_path) {
        Ok(s) => s,
        Err(e) => {
            tracing::debug!("Could not read lockfile at {:?}: {}", lockfile_path, e);
            return None;
        }
    };

    let parts: Vec<&str> = content.trim().split(':').collect();

    match parts.len() {
        4 => {
            // Old format: process:port:password:protocol
            let port = parts[1].parse::<u16>().ok()?;
            let password = parts[2].to_string();
            tracing::debug!("Parsed lockfile (4-part): port={}", port);
            Some(LockfileData { port, password })
        }
        5 => {
            // New format: process:pid:port:password:protocol
            let port = parts[2].parse::<u16>().ok()?;
            let password = parts[3].to_string();
            tracing::debug!("Parsed lockfile (5-part): port={}", port);
            Some(LockfileData { port, password })
        }
        n if n > 5 => {
            // Try 5-part interpretation
            let port = parts[2].parse::<u16>().ok()?;
            let password = parts[3].to_string();
            tracing::warn!(
                "Lockfile has {} parts, using 5-part format guess: port={}",
                n,
                port
            );
            Some(LockfileData { port, password })
        }
        _ => {
            tracing::warn!("Invalid lockfile format: {} parts", parts.len());
            None
        }
    }
}

/// Attempt to reconnect to League via the LCU API (best-effort, non-fatal).
/// Retries several times with delays to give the client time to process the game exit.
fn try_lcu_reconnect(league_path: &Path) {
    let lockfile = match read_lockfile(league_path) {
        Some(data) => data,
        None => {
            tracing::debug!("No lockfile found, skipping LCU reconnect");
            return;
        }
    };

    let client = match reqwest::blocking::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(5))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("Failed to build HTTP client for LCU: {}", e);
            return;
        }
    };

    // Retry up to 5 times with increasing delays.
    // The League client needs time to process the game exit before it accepts reconnect.
    let retry_delays = [
        std::time::Duration::from_secs(3),
        std::time::Duration::from_secs(3),
        std::time::Duration::from_secs(5),
        std::time::Duration::from_secs(5),
        std::time::Duration::from_secs(5),
    ];

    for (attempt, delay) in retry_delays.iter().enumerate() {
        tracing::debug!(
            "LCU reconnect: waiting {}s before attempt {} of {}",
            delay.as_secs(),
            attempt + 1,
            retry_delays.len()
        );
        std::thread::sleep(*delay);

        if try_lcu_reconnect_once(&client, &lockfile) {
            return;
        }
    }

    tracing::debug!("LCU reconnect: all attempts exhausted (client may not need reconnect)");
}

/// Single attempt to reconnect via LCU API. Returns true on success.
fn try_lcu_reconnect_once(client: &reqwest::blocking::Client, lockfile: &LockfileData) -> bool {
    let endpoints = [
        ("POST", "/lol-gameflow/v1/reconnect"),
        ("PUT", "/lol-gameflow/v1/reconnect"),
        ("POST", "/lol-login/v1/session/reconnect"),
    ];

    for (method, path) in &endpoints {
        let url = format!("https://127.0.0.1:{}{}", lockfile.port, path);
        tracing::debug!("Trying LCU reconnect: {} {}", method, url);

        let result = match *method {
            "POST" => client
                .post(&url)
                .basic_auth("riot", Some(&lockfile.password))
                .header("Content-Type", "application/json")
                .send(),
            "PUT" => client
                .put(&url)
                .basic_auth("riot", Some(&lockfile.password))
                .header("Content-Type", "application/json")
                .send(),
            _ => continue,
        };

        match result {
            Ok(resp) if resp.status().is_success() => {
                tracing::info!("LCU reconnect succeeded via {} {}", method, path);
                return true;
            }
            Ok(resp) => {
                tracing::debug!("LCU {} {} returned {}", method, path, resp.status());
            }
            Err(e) => {
                tracing::debug!("LCU {} {} failed: {}", method, path, e);
            }
        }
    }

    false
}

/// Kill the League of Legends game process.
fn kill_league_process() {
    tracing::info!("Killing League of Legends process");

    #[cfg(target_os = "windows")]
    let result = Command::new("taskkill")
        .args(["/F", "/IM", "League of Legends.exe"])
        .spawn();

    #[cfg(target_os = "macos")]
    let result = Command::new("pkill")
        .args(["-f", "League of Legends"])
        .spawn();

    #[cfg(target_os = "linux")]
    let result = Command::new("pkill")
        .args(["-f", "League of Legends"])
        .spawn();

    match result {
        Ok(mut child) => {
            let timeout = std::time::Duration::from_secs(3);
            let start = std::time::Instant::now();
            loop {
                match child.try_wait() {
                    Ok(Some(_)) => break,
                    Ok(None) => {
                        if start.elapsed() > timeout {
                            tracing::warn!("kill command timed out");
                            break;
                        }
                        std::thread::sleep(std::time::Duration::from_millis(100));
                    }
                    Err(e) => {
                        tracing::warn!("Error waiting for kill command: {}", e);
                        break;
                    }
                }
            }
        }
        Err(e) => {
            tracing::warn!("Failed to spawn kill command: {}", e);
        }
    }
}
