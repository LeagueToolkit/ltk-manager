use crate::error::{AppError, AppErrorResponse, AppResult, IpcResult, MutexResultExt};
use crate::mods::{LinkedBinOffenderInfo, LinkedBinState, ModLibraryState};
use crate::patcher::host::{HostConfig, HostLogLevel};
use crate::patcher::injector::{Injector, InjectorEvent, INJECTOR_EXE_NAME};
use crate::patcher::{PatcherPhase, PatcherState, StoredPatcherConfig};
use crate::state::SettingsState;
use serde::{Deserialize, Serialize};

use super::mods::reject_if_patcher_running;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter, Manager, State};
use ts_rs::TS;

/// Configuration for starting the patcher.
#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PatcherConfig {
    /// Optional hook flags bitmask forwarded to the injection host
    #[ts(optional, type = "number")]
    pub flags: Option<u64>,
    /// Absolute paths to workshop project directories to include in the overlay.
    ///
    /// These are loaded directly from disk via `FsModContent` and prepended to
    /// the enabled mod list (highest priority).
    #[ts(optional)]
    pub workshop_projects: Option<Vec<String>>,
}

/// Current status of the patcher.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PatcherStatus {
    /// Whether the patcher is currently running.
    pub running: bool,
    /// The config path the patcher was started with.
    pub config_path: Option<String>,
    /// Current phase of the patcher lifecycle.
    pub phase: PatcherPhase,
}

/// One archive that failed the integrity scan, sent in [`WadScanFailedPayload`].
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct WadScanFailureInfo {
    /// The offending archive (e.g. `TahmKench.wad.client`), if its name parsed.
    pub wad: Option<String>,
    /// The NTSTATUS-style code the scan reported (e.g. `c0000229` skinhack,
    /// `c000003e` corrupt WAD).
    pub status: String,
}

/// Payload for the `patcher-wad-scan-failed` event, emitted when the injected
/// DLL's integrity scan rejects one or more modded archives. When this fires
/// the patcher auto-stops and applies no mods for the session.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct WadScanFailedPayload {
    /// The archives that failed the scan, de-duplicated. May be empty if no
    /// names could be parsed from the scan log.
    pub failures: Vec<WadScanFailureInfo>,
}

/// Payload for the `linked-bins-warning` event, emitted after a patcher start whose
/// single overlay build found enabled mods with unresolved linked dependencies (only
/// when `linked_bin_check_enabled`). Injection is non-fatal, so this never blocks the
/// start — it drives a non-blocking toast. The per-mod badges and the reachable
/// `LinkedBinWarningDialog` carry the detail (fetched via `get_linked_bin_offenders`).
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LinkedBinWarningPayload {
    /// Number of enabled mods flagged in the latest build.
    pub count: u32,
}

/// Resolve a bundled resource file (e.g. the injector executable) from the
/// app's resource directory, falling back to next-to-executable and the crate's
/// checked-in `resources/` folder for `tauri dev`.
fn resolve_resource(app_handle: &AppHandle, file_name: &str) -> AppResult<PathBuf> {
    let resource_path = app_handle
        .path()
        .resource_dir()
        .map_err(|e| AppError::Other(format!("Failed to get resource directory: {}", e)))?
        .join(file_name);

    if resource_path.exists() {
        tracing::debug!(
            "Resolved {} from resource_dir: {}",
            file_name,
            resource_path.display()
        );
        return Ok(resource_path);
    }

    // Fallback for development: check next to executable
    let dev_path = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .map(|p| p.join(file_name));

    if let Some(ref path) = dev_path {
        if path.exists() {
            tracing::debug!(
                "Resolved {} next to executable: {}",
                file_name,
                path.display()
            );
            return Ok(path.clone());
        }
    }

    // Fallback for `tauri dev`: use the checked-in resources folder from the crate.
    // (`resource_dir()` during dev often points at `target/debug/`, but resources may not be copied there.)
    let manifest_resource_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join(file_name);
    if manifest_resource_path.exists() {
        tracing::debug!(
            "Resolved {} from CARGO_MANIFEST_DIR resources: {}",
            file_name,
            manifest_resource_path.display()
        );
        return Ok(manifest_resource_path);
    }

    Err(AppError::Other(format!(
        "{} not found. Tried:\n - {}\n - {}\n - {}",
        file_name,
        resource_path.display(),
        dev_path
            .as_ref()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| "<unavailable>".to_string()),
        manifest_resource_path.display(),
    )))
}

/// Start the patcher with the given configuration.
///
/// Returns immediately after spawning a background thread that builds the overlay
/// and then runs the patcher loop. Progress is reported via events.
#[tauri::command]
pub fn start_patcher(
    config: PatcherConfig,
    app_handle: AppHandle,
    state: State<PatcherState>,
    settings: State<SettingsState>,
    library: State<ModLibraryState>,
) -> IpcResult<()> {
    let result = start_patcher_inner(config, &app_handle, &state, &settings, &library);
    if let Err(ref e) = result {
        tracing::error!(error = ?e, "Start patcher failed");
    }
    result.into()
}

pub(crate) fn start_patcher_inner(
    config: PatcherConfig,
    app_handle: &AppHandle,
    state: &State<PatcherState>,
    settings: &State<SettingsState>,
    library: &State<ModLibraryState>,
) -> AppResult<()> {
    if cfg!(not(target_os = "windows")) {
        return Err(AppError::Other(
            "The patcher is not yet available on this platform".to_string(),
        ));
    }

    // Lock briefly: check state, set phase, clone what we need for the thread
    let (stop_flag, state_arc) = {
        let mut patcher_state = state.0.lock().mutex_err()?;

        if patcher_state.is_running() {
            return Err(AppError::Other("Patcher is already running".to_string()));
        }

        patcher_state.stop_flag.store(false, Ordering::SeqCst);
        patcher_state.phase = PatcherPhase::Building;

        (Arc::clone(&patcher_state.stop_flag), Arc::clone(&state.0))
    };

    tracing::debug!("Start patcher requested (external injector)");
    let injector_exe = resolve_resource(app_handle, INJECTOR_EXE_NAME)?;
    tracing::debug!("Using injector: {}", injector_exe.display());

    // Stash config for hot-reload
    {
        let mut patcher_state = state.0.lock().mutex_err()?;
        patcher_state.last_config = Some(StoredPatcherConfig {
            flags: config.flags,
            workshop_projects: config.workshop_projects.clone(),
        });
    }

    // tray: we see if we are loading Workshop or Library based on the config
    let is_workshop = config
        .workshop_projects
        .as_ref()
        .map(|v| !v.is_empty())
        .unwrap_or(false);

    let workshop_paths: Vec<PathBuf> = config
        .workshop_projects
        .unwrap_or_default()
        .iter()
        .map(PathBuf::from)
        .collect();

    let settings_snapshot = settings.0.lock().mutex_err()?.clone();
    tracing::debug!(
        "Settings snapshot: league_path={} mod_storage_path={}",
        settings_snapshot
            .league_path
            .as_ref()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| "<unset>".to_string()),
        settings_snapshot
            .mod_storage_path
            .as_ref()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| "<unset>".to_string())
    );
    let library_clone = library.0.clone();
    let mut host_flags = config.flags.unwrap_or(0) as u32;
    // The anti-skinhack scan aborts patching on a flagged champion WAD by
    // default; turning the setting off opts out via the hook flag, downgrading
    // the failure to a warning so patching proceeds.
    if !settings_snapshot.enforce_skinhack_scan {
        host_flags |= crate::patcher::host::hook_flags::OPT_OUT_AH_V1;
    }

    // Decide whether to elevate the injection host. An elevated game can only be
    // injected by an equally elevated host, so we elevate when the user opts in
    // OR when we detect League is configured to run as administrator. If the
    // manager is already elevated, any host it spawns inherits high integrity,
    // so the `--elevate` UAC bridge would be redundant and we skip it.
    let manager_elevated = crate::diagnostics::manager_is_elevated();
    let league_admin = crate::diagnostics::league_configured_as_admin();
    let should_elevate = !manager_elevated && (settings_snapshot.elevate_injector || league_admin);
    tracing::info!(
        "Injector elevation = {should_elevate} (opt_in={}, league_admin={league_admin}, manager_elevated={manager_elevated})",
        settings_snapshot.elevate_injector
    );

    // tray: clone the app handle so we can pass it into the background thread
    let app_handle_thread = app_handle.clone();

    // tray: set initial LOADING state before thread starts
    let initial_state = if is_workshop {
        crate::tray::AppTrayState::WorkshopLoading
    } else {
        crate::tray::AppTrayState::LibraryLoading
    };
    let _ = crate::tray::set_tray_state(app_handle.clone(), initial_state);

    let handle = thread::spawn(move || {
        // Phase 1: Build overlay (the slow part). The build records any linked-bin
        // offenders into `LinkedBinState` and emits `linked-bins-updated` as a
        // byproduct (no separate pre-flight build); we only need the count here to
        // decide whether to raise the non-blocking warning toast below.
        let (overlay_root, offender_count) =
            match library_clone.ensure_overlay(&settings_snapshot, &workshop_paths, false) {
                Ok(v) => v,
                Err(e) => {
                    tracing::error!(error = ?e, "Overlay build failed");
                    let error_response: AppErrorResponse = e.into();
                    let _ = library_clone
                        .app_handle()
                        .emit("patcher-error", &error_response);
                    if let Ok(mut s) = state_arc.lock() {
                        s.phase = PatcherPhase::Idle;
                    }
                    // TRAY: Reset to default on error
                    let _ = crate::tray::set_tray_state(
                        app_handle_thread.clone(),
                        crate::tray::AppTrayState::Default,
                    );
                    return;
                }
            };

        // Check stop flag between build and patcher loop
        if stop_flag.load(Ordering::SeqCst) {
            tracing::info!("Stop requested after overlay build, exiting");
            if let Ok(mut s) = state_arc.lock() {
                s.phase = PatcherPhase::Idle;
            }
            // tray: R$reset to default on early stop
            let _ = crate::tray::set_tray_state(
                app_handle_thread.clone(),
                crate::tray::AppTrayState::Default,
            );
            return;
        }

        tracing::info!("Using overlay root: {}", overlay_root.display());

        // Non-blocking advisory: missing linked bins are non-fatal at injection, so
        // we inject straight through and let the user review/disable via the badges
        // and reachable dialog. The toast is the one-time start-of-session nudge.
        if settings_snapshot.linked_bin_check_enabled && offender_count > 0 {
            let _ = app_handle_thread.emit(
                "linked-bins-warning",
                LinkedBinWarningPayload {
                    count: offender_count as u32,
                },
            );
        }

        let mut overlay_root_str = overlay_root.display().to_string();
        if !overlay_root_str.ends_with(std::path::MAIN_SEPARATOR) {
            overlay_root_str.push(std::path::MAIN_SEPARATOR);
        }

        // Phase 2: Run patcher loop
        {
            if let Ok(mut s) = state_arc.lock() {
                s.phase = PatcherPhase::Patching;
                s.config_path = Some(overlay_root_str.clone());
            }
        }

        // tray: overlay is built, we are now Patching
        let on_state = if is_workshop {
            crate::tray::AppTrayState::WorkshopOn
        } else {
            crate::tray::AppTrayState::LibraryOn
        };
        let _ = crate::tray::set_tray_state(app_handle_thread.clone(), on_state);

        // Build the host config from the patcher settings.
        let host_config = HostConfig {
            prefix: overlay_root_str.clone(),
            log_level: HostLogLevel::Info,
            flags: host_flags,
        };

        // This blocks until the game closes or the patcher is stopped. The
        // host runs as a separate process and communicates over a line protocol,
        // so we never load the patcher DLL into the manager.
        let event_handle = app_handle_thread.clone();
        match Injector::new(injector_exe)
            .with_elevate(should_elevate)
            .on_event(move |event| match event {
                InjectorEvent::Injected => {
                    let _ = event_handle.emit("patcher-injected", ());
                }
                InjectorEvent::WadScanFailed { failures } => {
                    let payload = WadScanFailedPayload {
                        failures: failures
                            .into_iter()
                            .map(|f| WadScanFailureInfo {
                                wad: f.wad,
                                status: f.status,
                            })
                            .collect(),
                    };
                    let _ = event_handle.emit("patcher-wad-scan-failed", payload);
                }
            })
            .run(&overlay_root_str, &stop_flag, &host_config)
        {
            Ok(()) => tracing::info!("Injector stopped"),
            Err(e) => {
                tracing::error!("Injector error: {}", e);
                let error_response: AppErrorResponse = AppError::Other(e.to_string()).into();
                let _ = app_handle_thread.emit("patcher-error", &error_response);
            }
        }

        // Cleanup Phase
        if let Ok(mut s) = state_arc.lock() {
            s.phase = PatcherPhase::Idle;
            s.config_path = None;
        }

        // tray: game closed or patcher stopped, revert to default icon
        let _ = crate::tray::set_tray_state(app_handle_thread, crate::tray::AppTrayState::Default);

        tracing::info!("Patcher thread exiting");
    });

    // Store thread handle
    let mut patcher_state = state.0.lock().mutex_err()?;
    patcher_state.thread_handle = Some(handle);

    Ok(())
}

/// Stop the running patcher.
#[tauri::command]
pub fn stop_patcher(state: State<PatcherState>) -> IpcResult<()> {
    stop_patcher_inner(&state).into()
}

pub(crate) fn stop_patcher_inner(state: &State<PatcherState>) -> AppResult<()> {
    let patcher_state = state.0.lock().mutex_err()?;

    if !patcher_state.is_running() {
        return Err(AppError::Other("Patcher is not running".to_string()));
    }

    tracing::info!("Stopping patcher...");

    patcher_state.stop_flag.store(true, Ordering::SeqCst);

    Ok(())
}

/// Force a full rebuild of the active profile's overlay.
///
/// Troubleshooting escape hatch: the incremental overlay builder can reuse a
/// previously-built (and possibly stale or incorrectly-built) WAD, so this
/// discards the cached overlay state and regenerates it from scratch. Refuses
/// while the patcher is running, since it rewrites the very files the running
/// session points at. Runs on a blocking thread and reports progress via the
/// same `overlay-progress` events as a normal patch.
#[tauri::command]
pub async fn rebuild_overlay(app_handle: AppHandle) -> IpcResult<()> {
    let setup: AppResult<_> = (|| {
        let patcher = app_handle.state::<PatcherState>();
        reject_if_patcher_running(&patcher)?;
        let settings = app_handle
            .state::<SettingsState>()
            .0
            .lock()
            .mutex_err()?
            .clone();
        let library = app_handle.state::<ModLibraryState>().0.clone();
        Ok((settings, library))
    })();

    let (settings, library) = match setup {
        Ok(v) => v,
        Err(e) => return IpcResult::from(Err::<(), _>(e)),
    };

    tauri::async_runtime::spawn_blocking(move || library.rebuild_overlay(&settings).map(|_| ()))
        .await
        .unwrap_or_else(|e| Err(AppError::Other(e.to_string())))
        .into()
}

/// Get the current status of the patcher.
#[tauri::command]
pub fn get_patcher_status(state: State<PatcherState>) -> IpcResult<PatcherStatus> {
    get_patcher_status_inner(&state).into()
}

fn get_patcher_status_inner(state: &State<PatcherState>) -> AppResult<PatcherStatus> {
    let mut patcher_state = state.0.lock().mutex_err()?;

    let running = patcher_state.is_running();

    // Defensive reset: if the thread has died but phase wasn't reset (e.g. panic),
    // correct it so the UI doesn't get stuck.
    if !running && patcher_state.phase != PatcherPhase::Idle {
        tracing::warn!(
            "Patcher thread dead but phase was {:?}, resetting to Idle",
            patcher_state.phase
        );
        patcher_state.phase = PatcherPhase::Idle;
        patcher_state.config_path = None;
    }

    Ok(PatcherStatus {
        running,
        config_path: if running {
            patcher_state.config_path.clone()
        } else {
            None
        },
        phase: patcher_state.phase,
    })
}

/// Linked-bin offenders found in the most recent overlay build, keyed by mod id.
///
/// These are recorded as a byproduct of `start_patcher`'s single overlay build (and
/// any hot-reload), so this is a cheap read with no IO — it never builds the overlay
/// itself. Display names are resolved from the library index; mods absent from the
/// latest build (e.g. since-disabled) simply don't appear. Missing linked bins are
/// non-fatal at injection, so this is advisory: the frontend surfaces it as per-mod
/// badges and a reachable warning dialog.
#[tauri::command]
pub fn get_linked_bin_offenders(
    linked_bins: State<LinkedBinState>,
    library: State<ModLibraryState>,
    settings: State<SettingsState>,
) -> IpcResult<HashMap<String, LinkedBinOffenderInfo>> {
    let result: AppResult<HashMap<String, LinkedBinOffenderInfo>> = (|| {
        let offenders = linked_bins.get_all()?;
        if offenders.is_empty() {
            return Ok(HashMap::new());
        }

        let settings_snapshot = settings.0.lock().mutex_err()?.clone();
        let display_names: HashMap<String, String> = library
            .0
            .get_installed_mods(&settings_snapshot)?
            .into_iter()
            .map(|m| (m.id, m.display_name))
            .collect();

        Ok(offenders
            .into_iter()
            .map(|mut offender| {
                if let Some(name) = display_names.get(&offender.mod_id) {
                    offender.display_name = name.clone();
                }
                (offender.mod_id.clone(), offender)
            })
            .collect())
    })();
    result.into()
}
