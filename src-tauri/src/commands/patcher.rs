use crate::error::{AppError, AppErrorResponse, AppResult, IpcResult, MutexResultExt};
use crate::mods::{LinkedBinOffenderInfo, LinkedBinState, ModLibraryState};
use crate::patcher::backend::{
    selected_backend, BackendError, BackendEvent, PatcherContext, PatcherEventSink,
    PatcherPreflight,
};
use crate::patcher::{PatcherPhase, PatcherState, StoredPatcherConfig};
use crate::platform::LeagueInstall;
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

const DEFAULT_PATCHER_TIMEOUT_MS: u32 = 300_000;

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PatcherConfig {
    #[ts(optional)]
    pub log_file: Option<String>,
    #[ts(optional)]
    pub timeout_ms: Option<u32>,
    #[ts(optional, type = "number")]
    pub flags: Option<u64>,
    #[ts(optional)]
    pub workshop_projects: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PatcherStatus {
    pub running: bool,
    pub config_path: Option<String>,
    pub phase: PatcherPhase,
    pub backend: Option<String>,
    pub message: Option<String>,
}

#[tauri::command]
pub fn preflight_patcher(
    app_handle: AppHandle,
    settings: State<SettingsState>,
    library: State<ModLibraryState>,
) -> IpcResult<PatcherPreflight> {
    preflight_patcher_inner(&app_handle, &settings, &library).into()
}

fn preflight_patcher_inner(
    app_handle: &AppHandle,
    settings: &State<SettingsState>,
    library: &State<ModLibraryState>,
) -> AppResult<PatcherPreflight> {
    let settings = settings.0.lock().mutex_err()?.clone();
    let league_path = settings.league_path.as_ref().ok_or_else(|| {
        AppError::ValidationFailed("League installation path is not configured".into())
    })?;
    let league_install = LeagueInstall::resolve(league_path)?;
    let allowed_root = library.0.storage_dir(&settings)?;
    selected_backend(app_handle).preflight(&PatcherContext {
        overlay_root: allowed_root.clone(),
        allowed_root,
        league_install,
        log_file: None,
        timeout_ms: DEFAULT_PATCHER_TIMEOUT_MS,
        flags: 0,
        elevate: false,
    })
}

#[tauri::command]
pub fn start_patcher(
    config: PatcherConfig,
    app_handle: AppHandle,
    state: State<PatcherState>,
    settings: State<SettingsState>,
    library: State<ModLibraryState>,
) -> IpcResult<()> {
    let result = start_patcher_inner(config, &app_handle, &state, &settings, &library);
    if let Err(ref error) = result {
        tracing::error!(error = ?error, "Start patcher failed");
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
    reap_finished_thread(state)?;

    let backend = selected_backend(app_handle);
    let availability = backend.availability();
    if !availability.supported || !availability.ready {
        return Err(AppError::PatcherBackend {
            code: if availability.supported {
                "BACKEND_NOT_READY"
            } else {
                "UNSUPPORTED_PLATFORM"
            }
            .into(),
            detail: availability
                .reason
                .unwrap_or_else(|| "The patcher backend is not ready".into()),
        });
    }

    let settings_snapshot = settings.0.lock().mutex_err()?.clone();
    let league_path = settings_snapshot.league_path.as_ref().ok_or_else(|| {
        AppError::ValidationFailed("League installation path is not configured".into())
    })?;
    let league_install = LeagueInstall::resolve(league_path)?;
    let allowed_root = library.0.storage_dir(&settings_snapshot)?;

    let (stop_flag, state_arc) = {
        let mut patcher_state = state.0.lock().mutex_err()?;
        if patcher_state.is_running() {
            return Err(AppError::Other("Patcher is already running".into()));
        }
        patcher_state.stop_flag.store(false, Ordering::SeqCst);
        patcher_state.phase = PatcherPhase::Building;
        patcher_state.backend = Some(backend.name().into());
        patcher_state.message = Some("Building overlay".into());
        patcher_state.last_config = Some(StoredPatcherConfig {
            log_file: config.log_file.clone(),
            timeout_ms: config.timeout_ms,
            flags: config.flags,
            workshop_projects: config.workshop_projects.clone(),
        });
        (Arc::clone(&patcher_state.stop_flag), Arc::clone(&state.0))
    };

    let is_workshop = config
        .workshop_projects
        .as_ref()
        .is_some_and(|projects| !projects.is_empty());
    let workshop_paths: Vec<PathBuf> = config
        .workshop_projects
        .unwrap_or_default()
        .into_iter()
        .map(PathBuf::from)
        .collect();
    let log_file = config.log_file;
    let timeout_ms = config.timeout_ms.unwrap_or(DEFAULT_PATCHER_TIMEOUT_MS);

    let mut flags = config.flags.unwrap_or(0);
    // The anti-skinhack scan aborts patching on a flagged champion WAD by
    // default; turning the setting off opts out via the hook flag, downgrading
    // the failure to a warning so patching proceeds. Only the Windows host
    // backend interprets these flag bits; other backends ignore them.
    if !settings_snapshot.enforce_skinhack_scan {
        flags |= crate::patcher::host::hook_flags::OPT_OUT_AH_V1 as u64;
    }

    // Decide whether to elevate the injection host (Windows only — both
    // diagnostics probes return false elsewhere). An elevated game can only be
    // injected by an equally elevated host, so we elevate when the user opts in
    // OR when we detect League is configured to run as administrator. If the
    // manager is already elevated, any host it spawns inherits high integrity,
    // so the `--elevate` UAC bridge would be redundant and we skip it.
    let manager_elevated = crate::diagnostics::manager_is_elevated();
    let league_admin = crate::diagnostics::league_configured_as_admin();
    let elevate = !manager_elevated && (settings_snapshot.elevate_injector || league_admin);
    tracing::info!(
        "Injector elevation = {elevate} (opt_in={}, league_admin={league_admin}, manager_elevated={manager_elevated})",
        settings_snapshot.elevate_injector
    );

    let library_clone = library.0.clone();
    let app_handle_thread = app_handle.clone();

    let initial_tray_state = if is_workshop {
        crate::tray::AppTrayState::WorkshopLoading
    } else {
        crate::tray::AppTrayState::LibraryLoading
    };
    let _ = crate::tray::set_tray_state(app_handle.clone(), initial_tray_state);

    let handle = thread::spawn(move || {
        let result = (|| -> AppResult<()> {
            // The build records any linked-bin offenders into `LinkedBinState` and
            // emits `linked-bins-updated` as a byproduct (no separate pre-flight
            // build); we only need the count here to decide whether to raise the
            // non-blocking warning toast below.
            let (overlay_root, offender_count) =
                library_clone.ensure_overlay(&settings_snapshot, &workshop_paths, false)?;
            if stop_flag.load(Ordering::SeqCst) {
                return Ok(());
            }

            // Non-blocking advisory: missing linked bins are non-fatal at
            // injection, so we patch straight through and let the user
            // review/disable via the badges and reachable dialog.
            if settings_snapshot.linked_bin_check_enabled && offender_count > 0 {
                let _ = app_handle_thread.emit(
                    "linked-bins-warning",
                    LinkedBinWarningPayload {
                        count: offender_count as u32,
                    },
                );
            }

            let context = PatcherContext {
                overlay_root: overlay_root.clone(),
                allowed_root,
                league_install,
                log_file,
                timeout_ms,
                flags,
                elevate,
            };
            let preflight = backend.preflight(&context)?;
            if !preflight.compatible {
                return Err(AppError::PatcherBackend {
                    code: "UNSUPPORTED_GAME_BUILD".into(),
                    detail: preflight.reason.unwrap_or_else(|| {
                        "The installed League build is not compatible with this patcher".into()
                    }),
                });
            }

            {
                let mut patcher_state = state_arc.lock().map_err(|_| AppError::MutexLockFailed)?;
                patcher_state.phase = PatcherPhase::WaitingForGame;
                patcher_state.config_path = Some(overlay_root.display().to_string());
                patcher_state.message = Some("Waiting for League game process".into());
            }
            let active_tray_state = if is_workshop {
                crate::tray::AppTrayState::WorkshopOn
            } else {
                crate::tray::AppTrayState::LibraryOn
            };
            let _ = crate::tray::set_tray_state(app_handle_thread.clone(), active_tray_state);

            let event_state = Arc::clone(&state_arc);
            let event_app = app_handle_thread.clone();
            let event_sink: PatcherEventSink = Arc::new(move |event: BackendEvent| {
                tracing::info!(
                    event = %event.event,
                    pid = ?event.pid,
                    architecture = ?event.architecture,
                    signature = ?event.signature,
                    detail = ?event.detail,
                    "Patcher backend event"
                );
                if let Ok(mut patcher_state) = event_state.lock() {
                    patcher_state.phase = match event.event.as_str() {
                        "waitingForGame" | "ready" | "gameExited" => PatcherPhase::WaitingForGame,
                        "gameFound" | "scanning" | "patched" => PatcherPhase::Patching,
                        _ => patcher_state.phase,
                    };
                    patcher_state.message = Some(backend_event_message(&event));
                }
                let _ = event_app.emit("patcher-backend-event", &event);
            });

            match backend.run(context, Arc::clone(&stop_flag), event_sink) {
                Ok(()) | Err(BackendError::Stopped) => Ok(()),
                Err(BackendError::Failed { code, detail }) => {
                    Err(AppError::PatcherBackend { code, detail })
                }
            }
        })();

        if let Err(error) = result {
            tracing::error!(error = ?error, "Patcher session failed");
            let response: AppErrorResponse = error.into();
            let _ = app_handle_thread.emit("patcher-error", &response);
        }
        if let Ok(mut patcher_state) = state_arc.lock() {
            patcher_state.phase = PatcherPhase::Idle;
            patcher_state.config_path = None;
            patcher_state.backend = None;
            patcher_state.message = None;
        }
        let _ = crate::tray::set_tray_state(app_handle_thread, crate::tray::AppTrayState::Default);
    });

    state.0.lock().mutex_err()?.thread_handle = Some(handle);
    Ok(())
}

#[tauri::command]
pub fn stop_patcher(state: State<PatcherState>) -> IpcResult<()> {
    stop_patcher_inner(&state).into()
}

pub(crate) fn stop_patcher_inner(state: &PatcherState) -> AppResult<()> {
    let mut patcher_state = state.0.lock().mutex_err()?;
    if !patcher_state.is_running() {
        return Err(AppError::Other("Patcher is not running".into()));
    }
    tracing::info!("Stopping patcher");
    patcher_state.stop_flag.store(true, Ordering::SeqCst);
    patcher_state.message = Some("Stopping patcher".into());
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

#[tauri::command]
pub fn get_patcher_status(state: State<PatcherState>) -> IpcResult<PatcherStatus> {
    get_patcher_status_inner(&state).into()
}

fn get_patcher_status_inner(state: &State<PatcherState>) -> AppResult<PatcherStatus> {
    reap_finished_thread(state)?;
    let patcher_state = state.0.lock().mutex_err()?;
    let running = patcher_state.is_running();
    Ok(PatcherStatus {
        running,
        config_path: running.then(|| patcher_state.config_path.clone()).flatten(),
        phase: if running {
            patcher_state.phase
        } else {
            PatcherPhase::Idle
        },
        backend: patcher_state.backend.clone(),
        message: patcher_state.message.clone(),
    })
}

fn reap_finished_thread(state: &PatcherState) -> AppResult<()> {
    let handle = {
        let mut patcher_state = state.0.lock().mutex_err()?;
        if patcher_state
            .thread_handle
            .as_ref()
            .is_some_and(|handle| handle.is_finished())
        {
            patcher_state.thread_handle.take()
        } else {
            None
        }
    };
    if let Some(handle) = handle {
        if handle.join().is_err() {
            return Err(AppError::Other("Patcher thread panicked".into()));
        }
    }
    Ok(())
}

fn backend_event_message(event: &BackendEvent) -> String {
    match event.event.as_str() {
        "ready" | "waitingForGame" => "Waiting for League game process".into(),
        "gameFound" => event
            .pid
            .map(|pid| format!("Found League game process ({pid})"))
            .unwrap_or_else(|| "Found League game process".into()),
        "scanning" => "Validating League patch signature".into(),
        "patched" => "League process patched".into(),
        "gameExited" => "League exited; waiting for the next match".into(),
        other => event.detail.clone().unwrap_or_else(|| other.into()),
    }
}

/// One archive that failed the integrity scan, sent in [`WadScanFailedPayload`].
///
/// The scan itself runs inside the Windows injection host, so this is only
/// emitted by the Windows backend; the type stays cross-platform for the
/// generated TypeScript binding.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct WadScanFailureInfo {
    /// The offending archive (e.g. `TahmKench.wad.client`), if its name parsed.
    pub wad: Option<String>,
    /// The NTSTATUS-style code the scan reported (e.g. `c0000229` skinhack,
    /// `c000003e` corrupt WAD).
    pub status: String,
}

/// Payload for the `patcher-wad-scan-failed` event, emitted when the injected
/// DLL's integrity scan rejects one or more modded archives.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn stop_patcher_signals_without_joining_worker() {
        let state = PatcherState::new();
        let worker = thread::spawn(|| thread::sleep(Duration::from_millis(300)));
        {
            let mut inner = state.0.lock().unwrap();
            inner.thread_handle = Some(worker);
        }

        let started = Instant::now();
        stop_patcher_inner(&state).unwrap();
        assert!(started.elapsed() < Duration::from_millis(100));

        let worker = {
            let mut inner = state.0.lock().unwrap();
            assert!(inner.stop_flag.load(Ordering::SeqCst));
            assert_eq!(inner.message.as_deref(), Some("Stopping patcher"));
            inner.thread_handle.take().unwrap()
        };
        worker.join().unwrap();
    }
}
