use crate::error::{AppError, AppResult, IpcResult};
use crate::mods::{LinkedBinOffenderInfo, LinkedBinState, ModLibraryState};
use crate::patcher::host::HOOK_DLL_NAME;
use crate::patcher::injector::INJECTOR_EXE_NAME;
use crate::patcher::thread::TauriPatcherEvents;
use crate::patcher::{
    PatcherError, PatcherEvents, PatcherHostState, PatcherPhase, PatcherSession, PatcherState,
    PatcherThread, SessionParams, StoredPatcherConfig,
};
use crate::state::{IncidentStoreState, SettingsState};
use ltk_manager_core::diagnostics::binary_id::PatcherBinaries;
use ltk_manager_core::utils::client_settings::LeagueClientSettings;
use ltk_manager_core::utils::game::GameDir;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use super::mods::reject_if_patcher_running;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};
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
    /// Current phase of the patcher lifecycle.
    pub phase: PatcherPhase,
    /// The session in flight. `null` while idle.
    pub session: Option<PatcherSession>,
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
    host_state: State<PatcherHostState>,
    settings: State<SettingsState>,
    library: State<ModLibraryState>,
    incidents: State<IncidentStoreState>,
) -> IpcResult<()> {
    let result = start_patcher_inner(
        config,
        &app_handle,
        &state,
        &host_state,
        &settings,
        &library,
        &incidents,
    );
    if let Err(ref e) = result {
        tracing::error!(error = ?e, "Start patcher failed");
    }
    result.into()
}

pub(crate) fn start_patcher_inner(
    config: PatcherConfig,
    app_handle: &AppHandle,
    state: &State<PatcherState>,
    host_state: &State<PatcherHostState>,
    settings: &State<SettingsState>,
    library: &State<ModLibraryState>,
    incidents: &State<IncidentStoreState>,
) -> AppResult<()> {
    if cfg!(not(target_os = "windows")) {
        return Err(PatcherError::UnsupportedPlatform.into());
    }

    tracing::debug!("Start patcher requested (external injector)");
    let injector_exe = resolve_resource(app_handle, INJECTOR_EXE_NAME)?;
    tracing::debug!("Using injector: {}", injector_exe.display());

    let stored_config = StoredPatcherConfig {
        flags: config.flags,
        workshop_projects: config.workshop_projects.clone(),
    };
    // Decides which tray icon set this session drives.
    let is_workshop = stored_config.origin().is_workshop();

    let workshop_paths: Vec<PathBuf> = config
        .workshop_projects
        .clone()
        .unwrap_or_default()
        .iter()
        .map(PathBuf::from)
        .collect();

    let config_snapshot = settings.config()?;
    tracing::debug!(
        "Config snapshot: league_path={} mod_storage_path={}",
        config_snapshot
            .league_path
            .as_ref()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| "<unset>".to_string()),
        config_snapshot
            .mod_storage_path
            .as_ref()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| "<unset>".to_string())
    );

    let mut host_flags = config.flags.unwrap_or(0) as u32;
    if !config_snapshot.enforce_skinhack_scan {
        host_flags |= crate::patcher::host::hook_flags::OPT_OUT_AH_V1;
    }
    if config_snapshot.full_wad_scan {
        host_flags |= crate::patcher::host::hook_flags::FULL_WAD_SCAN;
    }

    // The client rewrites its own settings when it exits, so the preference is
    // re-applied at every start rather than once.
    if config_snapshot.disable_crash_reporting {
        match GameDir::resolve(&config_snapshot)
            .and_then(|game_dir| LeagueClientSettings::disable_crash_reporting(&game_dir))
        {
            Ok(true) => tracing::info!("Turned the League client's crash reporting off"),
            Ok(false) => {}
            Err(e) => {
                tracing::warn!("Could not turn the League client's crash reporting off: {e}")
            }
        }
    }

    let should_elevate = ltk_manager_core::patcher::should_elevate(&config_snapshot);

    let dll_path = crate::commands::diagnostics::resolve_patcher_dll(app_handle)
        .or_else(|| injector_exe.parent().map(|dir| dir.join(HOOK_DLL_NAME)))
        .unwrap_or_else(|| PathBuf::from(HOOK_DLL_NAME));
    let patcher_binaries = PatcherBinaries::identify(
        &dll_path,
        &injector_exe,
        option_env!("LTK_BUNDLED_DLL_HASH").unwrap_or_default(),
        option_env!("LTK_BUNDLED_HOST_HASH").unwrap_or_default(),
    );

    let events: Arc<dyn PatcherEvents> =
        Arc::new(TauriPatcherEvents::new(app_handle.clone(), is_workshop));
    // The cap is a setting, so the session's store reads it as a snapshot.
    let incident_store = Arc::new(
        incidents
            .0
            .as_ref()
            .clone()
            .with_keep(config_snapshot.keep_incidents as usize),
    );

    PatcherThread::start(
        events,
        state.handle(),
        host_state.handle(),
        stored_config,
        SessionParams {
            injector_exe,
            config: config_snapshot,
            library: library.0.clone(),
            workshop_paths,
            host_flags,
            should_elevate,
            patcher_binaries,
            incident_store,
        },
    )
}

/// Stop the running patcher.
#[tauri::command]
pub fn stop_patcher(state: State<PatcherState>) -> IpcResult<()> {
    stop_patcher_inner(&state).into()
}

pub(crate) fn stop_patcher_inner(state: &State<PatcherState>) -> AppResult<()> {
    if !state.request_stop()? {
        return Err(PatcherError::NotRunning.into());
    }

    tracing::info!("Stopping patcher...");
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
        let config = app_handle.state::<SettingsState>().config()?;
        let library = app_handle.state::<ModLibraryState>().0.clone();
        Ok((config, library))
    })();

    let (config, library) = match setup {
        Ok(v) => v,
        Err(e) => return IpcResult::from(Err::<(), _>(e)),
    };

    tauri::async_runtime::spawn_blocking(move || library.rebuild_overlay(&config).map(|_| ()))
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
    state.with_mut(|patcher_state| {
        let running = patcher_state.is_running();

        // Defensive reset: if the thread has died but phase wasn't reset (e.g. panic),
        // correct it so the UI doesn't get stuck.
        if !running && patcher_state.phase != PatcherPhase::Idle {
            tracing::warn!(
                "Patcher thread dead but phase was {:?}, resetting to Idle",
                patcher_state.phase
            );
            patcher_state.end_session();
        }

        PatcherStatus {
            running,
            phase: patcher_state.phase,
            session: if running {
                patcher_state.session.clone()
            } else {
                None
            },
        }
    })
}

/// Linked-bin offenders found in the most recent overlay build, keyed by mod id.
///
/// These are recorded as a byproduct of `start_patcher`'s single overlay build (and
/// any hot-reload), so this is a cheap read with no IO - it never builds the overlay
/// itself. Display names are resolved from the library index; mods absent from the
/// latest build (e.g. since-disabled) simply don't appear. Missing linked bins are
/// non-fatal at injection, so this is advisory: the frontend surfaces it as per-mod
/// badges and a reachable warning dialog.
#[tauri::command]
pub fn get_linked_bin_offenders(
    linked_bins: State<Arc<LinkedBinState>>,
    library: State<ModLibraryState>,
    settings: State<SettingsState>,
) -> IpcResult<HashMap<String, LinkedBinOffenderInfo>> {
    let result: AppResult<HashMap<String, LinkedBinOffenderInfo>> = (|| {
        let offenders = linked_bins.get_all()?;
        if offenders.is_empty() {
            return Ok(HashMap::new());
        }

        let config_snapshot = settings.config()?;
        let display_names: HashMap<String, String> = library
            .0
            .get_installed_mods(&config_snapshot)?
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
