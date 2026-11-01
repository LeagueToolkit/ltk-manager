//! The patcher service: starting and stopping the patcher, the overlay it builds, and what it
//! found wrong with the mods it read.

use crate::error::{AppError, AppResult, IpcResult};
use crate::mods::{ChecksumMismatchInfo, ChecksumMismatchState, ModLibraryState};
use crate::patcher::host::{HOOK_DLL_NAME, HOST_EXE_NAME};
use crate::patcher::injector::INJECTOR_EXE_NAME;
use crate::patcher::thread::TauriPatcherEvents;
use crate::patcher::{
    PatcherDeliveryState, PatcherError, PatcherEvents, PatcherHostState, PatcherPhase,
    PatcherSession, PatcherState, PatcherThread, PreparedHost, SessionParams, StoredPatcherConfig,
};
use crate::state::{IncidentStoreState, SettingsState};
use ltk_manager_base::utils::client_settings::LeagueClientSettings;
use ltk_manager_base::utils::game::GameDir;
use ltk_manager_runtime::diagnostics::binary_id::PatcherBinaries;
use ltk_manager_runtime::patcher::delivery::Channel;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::services::shared::off_thread;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};

/// Hex length of a binary identity: the first 8 bytes of its SHA-256.
const BINARY_HASH_LEN: usize = 16;

/// Configuration for starting the patcher.
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PatcherConfig {
    /// Optional hook flags bitmask forwarded to the injection host
    #[specta(optional)]
    pub flags: Option<u64>,
    /// Absolute paths to workshop project directories to include in the overlay.
    ///
    /// These are loaded directly from disk via `FsModContent` and prepended to
    /// the enabled mod list (highest priority).
    #[specta(optional)]
    pub workshop_projects: Option<Vec<String>>,
    /// The layers each workshop project is tested with, by project path.
    ///
    /// A project missing from the map is tested with every layer, and `base` is
    /// always on.
    #[specta(optional)]
    pub workshop_layers: Option<HashMap<String, Vec<String>>>,
    /// Build the overlay from scratch rather than reuse the last build.
    #[specta(optional)]
    pub force_rebuild: Option<bool>,
}

impl PatcherConfig {
    /// The config a session ran with, for starting it again.
    pub(crate) fn from_stored(stored: StoredPatcherConfig, force_rebuild: bool) -> Self {
        Self {
            flags: stored.flags,
            workshop_projects: stored.workshop_projects,
            workshop_layers: stored.workshop_layers,
            force_rebuild: Some(force_rebuild),
        }
    }
}

/// Current status of the patcher.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PatcherStatus {
    /// Whether the patcher is currently running.
    pub running: bool,
    /// Current phase of the patcher lifecycle.
    pub phase: PatcherPhase,
    /// The session in flight. `null` while idle.
    pub session: Option<PatcherSession>,
    /// Whether a library edit waits for the running game to end before the
    /// overlay is rebuilt.
    pub changes_after_game: bool,
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
#[specta::specta]
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
    let telemetry = crate::telemetry::state(app_handle);

    tracing::debug!("Start patcher requested (external injector)");
    let injector_exe = resolve_resource(app_handle, INJECTOR_EXE_NAME)?;
    tracing::debug!("Using injector: {}", injector_exe.display());

    let stored_config = StoredPatcherConfig {
        flags: config.flags,
        workshop_projects: config.workshop_projects.clone(),
        workshop_layers: config.workshop_layers.clone(),
    };
    // Decides which tray icon set this session drives.
    let is_workshop = stored_config.origin().is_workshop();

    let workshop_projects = ltk_manager_core::patching::workshop_tests(&stored_config);

    let config_snapshot = settings.config();
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

    if let Err(refusal) = ltk_manager_runtime::patcher::check_unelevated() {
        let facts = ltk_manager_runtime::diagnostics::elevation::facts();
        telemetry.report_patcher_refused(&refusal, &facts);
        return Err(refusal.into());
    }

    let delivery = app_handle.state::<PatcherDeliveryState>().inner().clone();
    delivery.sync_in_background(&config_snapshot);

    let channel = crate::patcher::delivery::channel(&config_snapshot);
    let prepare_host = Box::new(move || prepare_host(&delivery, channel, &injector_exe));

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
            prepare_host,
            config: config_snapshot,
            library: library.0.clone(),
            workshop_projects,
            host_flags,
            incident_store,
            force_rebuild: config.force_rebuild.unwrap_or(false),
            telemetry: telemetry.handle(),
        },
    )
}

/// Selects the delivered build of a session and identifies its binaries.
///
/// Fails with [`PatcherError::DllUnavailable`] if no build is usable.
fn prepare_host(
    delivery: &PatcherDeliveryState,
    channel: Channel,
    bundled_host: &Path,
) -> AppResult<PreparedHost> {
    let staged =
        delivery
            .prepare(channel, bundled_host)
            .map_err(|error| PatcherError::DllUnavailable {
                message: error.to_string(),
                reason: error.kind().to_string(),
            })?;
    tracing::info!(
        version = %staged.version,
        digest = %staged.digest,
        "Using the delivered patcher DLL"
    );

    let exe = staged.dir.join(HOST_EXE_NAME);
    let binaries = PatcherBinaries::identify(
        &staged.dir.join(HOOK_DLL_NAME),
        &exe,
        &staged.digest[..BINARY_HASH_LEN],
        option_env!("LTK_BUNDLED_HOST_HASH").unwrap_or_default(),
    );

    Ok(PreparedHost { exe, binaries })
}

/// Stop the running patcher.
#[tauri::command]
#[specta::specta]
pub fn stop_patcher(state: State<PatcherState>) -> IpcResult<()> {
    stop_patcher_inner(&state).into()
}

pub(crate) fn stop_patcher_inner(state: &State<PatcherState>) -> AppResult<()> {
    if !state.request_stop() {
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
#[specta::specta]
pub async fn rebuild_overlay(app_handle: AppHandle) -> IpcResult<()> {
    let setup: AppResult<_> = (|| {
        let patcher = app_handle.state::<PatcherState>();
        patcher.reject_if_running()?;
        let config = app_handle.state::<SettingsState>().config();
        let library = app_handle.state::<ModLibraryState>().0.clone();
        Ok((config, library))
    })();

    let (config, library) = match setup {
        Ok(v) => v,
        Err(e) => return IpcResult::from(Err::<(), _>(e)),
    };

    off_thread(move || library.rebuild_overlay(&config).map(|_| ())).await
}

/// Get the current status of the patcher.
#[tauri::command]
#[specta::specta]
pub fn get_patcher_status(state: State<PatcherState>) -> IpcResult<PatcherStatus> {
    IpcResult::ok(get_patcher_status_inner(&state))
}

fn get_patcher_status_inner(state: &State<PatcherState>) -> PatcherStatus {
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
            changes_after_game: running && patcher_state.overlay_refresh.waits_for_game(),
        }
    })
}

/// Checksum mismatches found in the most recent overlay build, keyed by mod id.
///
/// Recorded as a byproduct of `start_patcher`'s overlay build and of any
/// hot-reload, so this is a cheap read with no IO. A mismatch marks a badly-packed mod: its
/// container claimed a checksum its own bytes do not have. Never fatal - the
/// overlay carries the recomputed value, so this is advisory, surfaced per-mod
/// in mod details.
#[tauri::command]
#[specta::specta]
pub fn get_checksum_mismatches(
    checksum_mismatches: State<Arc<ChecksumMismatchState>>,
) -> IpcResult<HashMap<String, Vec<ChecksumMismatchInfo>>> {
    IpcResult::ok(checksum_mismatches.by_mod())
}

/// The patcher service's row of `services/table.rs`.
pub struct Table;

/// The plugin answering the patcher commands.
pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    super::plugin::<Table>().build()
}
