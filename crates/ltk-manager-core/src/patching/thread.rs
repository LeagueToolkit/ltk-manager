//! Background patching thread: builds the overlay, runs the injection session,
//! rebuilds between games when the library changes, and reports everything
//! user-facing through [`PatcherEvents`].

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use parking_lot::Mutex;

use ltk_telemetry::Telemetry;

use ltk_manager_base::config::Config;
use ltk_manager_base::error::{AppError, AppResult, message_with_sources};
use ltk_manager_library::mods::ModLibrary;
use ltk_manager_library::overlay::{OverlayBuild, WorkshopTestProject};
use ltk_manager_runtime::diagnostics::binary_id::PatcherBinaries;
use ltk_manager_runtime::diagnostics::incident::SessionFailure;
use ltk_manager_runtime::diagnostics::store::IncidentStore;
use ltk_manager_runtime::diagnostics::telemetry;
use ltk_manager_runtime::launcher::is_game_running;

use super::pipeline::IncidentPipeline;
use ltk_manager_runtime::patcher::error::PatcherError;
use ltk_manager_runtime::patcher::events::PatcherEvents;
use ltk_manager_runtime::patcher::host::{HostConfig, HostLogLevel, PatcherHost};
use ltk_manager_runtime::patcher::injector::SessionEnd;
use ltk_manager_runtime::patcher::recorder::GameRecorder;
use ltk_manager_runtime::patcher::refresh::OverlayRefresh;
use ltk_manager_runtime::patcher::session::{self, SessionError, SessionObserver};
use ltk_manager_runtime::patcher::state::{PatcherPhase, PatcherStateInner, StoredPatcherConfig};

/// How long a rebuild waits for the last game's process to let go of the overlay.
const GAME_RELEASE_TIMEOUT: Duration = Duration::from_secs(10);

/// How often a rebuild checks whether the game process is gone.
const GAME_RELEASE_POLL: Duration = Duration::from_millis(100);

/// The workshop projects a session started from `config` tests.
pub fn workshop_tests(config: &StoredPatcherConfig) -> Vec<WorkshopTestProject> {
    let layers = config.workshop_layers.as_ref();

    config
        .workshop_projects
        .iter()
        .flatten()
        .map(|path| WorkshopTestProject {
            path: PathBuf::from(path),
            enabled_layers: layers
                .and_then(|layers| layers.get(path))
                .map(|names| names.iter().cloned().collect()),
        })
        .collect()
}

/// The host that a session runs and the identity of its binaries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedHost {
    pub exe: PathBuf,
    pub binaries: PatcherBinaries,
}

/// Prepares the host of a session on the session thread, because it can wait for a download.
pub type PrepareHost = Box<dyn FnOnce() -> AppResult<PreparedHost> + Send>;

/// Per-session inputs for [`PatcherThread::start`], resolved by the caller
/// before the patcher state is claimed.
pub struct SessionParams {
    pub prepare_host: PrepareHost,
    pub config: Config,
    pub library: ModLibrary,
    pub workshop_projects: Vec<WorkshopTestProject>,
    pub host_flags: u32,
    /// Where the session's incidents are written.
    pub incident_store: Arc<IncidentStore>,
    /// Whether the overlay is built from scratch rather than reused.
    pub force_rebuild: bool,
    /// Where the session reports that it ended.
    pub telemetry: Telemetry,
}

/// Inputs moved into the background patcher thread.
pub struct PatcherThread {
    events: Arc<dyn PatcherEvents>,
    observer: Arc<SessionObserver>,
    state: Arc<Mutex<PatcherStateInner>>,
    host: Arc<Mutex<Option<PatcherHost>>>,
    stop_flag: Arc<AtomicBool>,
    refresh: Arc<OverlayRefresh>,
    config: Config,
    library: ModLibrary,
    workshop_projects: Vec<WorkshopTestProject>,
    host_flags: u32,
    force_rebuild: bool,
    telemetry: Telemetry,
}

impl PatcherThread {
    /// Atomically claim the patcher state and spawn the session thread.
    ///
    /// The running check and every start side effect (stop-flag reset, phase,
    /// config stash for hot-reload, the `Building` notification, handle store)
    /// happen under one lock, so a concurrent start can't slip between them and
    /// respawn the shared host under a live session.
    pub fn start(
        events: Arc<dyn PatcherEvents>,
        state: &Arc<Mutex<PatcherStateInner>>,
        host: &Arc<Mutex<Option<PatcherHost>>>,
        stored_config: StoredPatcherConfig,
        params: SessionParams,
    ) -> AppResult<()> {
        let mut patcher_state = state.lock();
        if patcher_state.is_running() {
            return Err(PatcherError::AlreadyRunning.into());
        }

        let origin = stored_config.origin();
        patcher_state.stop_flag.store(false, Ordering::SeqCst);
        patcher_state.begin_session(origin.clone());
        patcher_state.last_config = Some(stored_config);

        // Announced under the same lock so the session's failure path (which
        // resets the phase after locking the state) can't be observed before
        // the flip to `Building`.
        events.phase_changed(PatcherPhase::Building);

        let SessionParams {
            prepare_host,
            config,
            library,
            workshop_projects,
            host_flags,
            incident_store,
            force_rebuild,
            telemetry,
        } = params;
        let pipeline = Arc::new(IncidentPipeline::new(
            config.clone(),
            host_flags,
            library.clone(),
            workshop_projects.clone(),
            incident_store,
            Arc::clone(&events),
            telemetry.clone(),
        ));
        let observer = Arc::new(SessionObserver::new(
            Arc::clone(&events),
            GameRecorder::new(origin),
            Arc::new(move |record| pipeline.spawn(record)),
        ));
        let session = Self {
            events,
            observer,
            state: Arc::clone(state),
            host: Arc::clone(host),
            stop_flag: Arc::clone(&patcher_state.stop_flag),
            refresh: Arc::clone(&patcher_state.overlay_refresh),
            config,
            library,
            workshop_projects,
            host_flags,
            force_rebuild,
            telemetry,
        };
        patcher_state.thread_handle = Some(thread::spawn(move || session.run(prepare_host)));
        Ok(())
    }

    fn run(self, prepare_host: PrepareHost) {
        let host = match prepare_host() {
            Ok(host) => host,
            Err(e) => {
                tracing::error!(error = ?e, "Could not prepare the patcher host");
                self.report_prepare_failure(&e);
                self.events.error(e);
                self.reset_to_idle();
                return;
            }
        };
        self.observer.set_patcher(host.binaries);

        let mut force_rebuild = self.force_rebuild;

        loop {
            let Some(overlay_prefix) = self.build_overlay(force_rebuild) else {
                return;
            };
            force_rebuild = false;

            if self.run_session(&host.exe, overlay_prefix) == SessionEnd::Stopped {
                break;
            }
            self.resume_building();
        }

        self.reset_to_idle();
        tracing::info!("Patcher thread exiting");
    }

    /// Reports a start that got no host, by the delivery failure's kind.
    ///
    /// A failure that is not a `DllUnavailable` reports as `other`.
    fn report_prepare_failure(&self, error: &AppError) {
        let reason = match error.domain::<PatcherError>() {
            Some(PatcherError::DllUnavailable { reason, .. }) => reason.as_str(),
            _ => "other",
        };
        self.telemetry.track(
            telemetry::PATCHER_START_FAILED,
            telemetry::patcher_start_failed(self.library.app_version(), reason),
        );
    }

    /// Build the overlay and return its prefix path, or `None` on failure or
    /// an early stop (state already reset).
    fn build_overlay(&self, force_rebuild: bool) -> Option<String> {
        self.refresh.clear();

        let stop_flag = Arc::clone(&self.stop_flag);
        let build = match self.library.ensure_overlay(
            &self.config,
            &self.workshop_projects,
            force_rebuild,
            move || stop_flag.load(Ordering::SeqCst),
        ) {
            Ok(build) => build,
            Err(AppError::Overlay(ltk_overlay::Error::CalledOff)) => {
                tracing::info!("Stop requested during overlay build, exiting");
                self.reset_to_idle();
                return None;
            }
            Err(e) => {
                tracing::error!(error = ?e, "Overlay build failed");
                self.observer.session_failed(SessionFailure::Build {
                    kind: e.kind(),
                    category: e.overlay_category(),
                    message: message_with_sources(&e),
                });
                self.events.error(e);
                self.reset_to_idle();
                return None;
            }
        };

        let OverlayBuild {
            overlay_root,
            outcome,
        } = build;
        // Refreshes the library badges. Advisory, so it happens even if we are
        // about to bail on a stop request - the data is already correct.
        self.library.record_overlay_build(outcome);

        if self.stop_flag.load(Ordering::SeqCst) {
            tracing::info!("Stop requested after overlay build, exiting");
            self.reset_to_idle();
            return None;
        }

        tracing::info!("Using overlay root: {}", overlay_root.display());
        Some(session::normalize_overlay_prefix(
            &overlay_root.display().to_string(),
        ))
    }

    /// Run one injection session via the core orchestration, blocking until the
    /// caller stops or a library edit asks for a rebuild. A failure is reported
    /// and ends the session.
    fn run_session(&self, host_exe: &Path, overlay_prefix: String) -> SessionEnd {
        self.enter_patching(overlay_prefix.clone());

        let host_config = HostConfig {
            prefix: overlay_prefix,
            log_level: if self.config.verbose_patcher_logging {
                HostLogLevel::Debug
            } else {
                HostLogLevel::Info
            },
            flags: self.host_flags,
        };

        let result = session::run_injection_session(
            &self.host,
            host_exe,
            &host_config,
            &self.stop_flag,
            &self.refresh,
            Arc::clone(&self.observer),
        );

        match result {
            Ok(SessionEnd::Refresh) => SessionEnd::Refresh,
            Ok(SessionEnd::Stopped) => {
                tracing::info!("Injector stopped");
                self.observer.session_stopped();
                SessionEnd::Stopped
            }
            Err(e) => {
                match &e {
                    SessionError::Host(err) => {
                        tracing::error!("Failed to start injection host: {}", err)
                    }
                    SessionError::Injector(err) => tracing::error!("Injector error: {}", err),
                }
                let error = PatcherError::from(e);
                if let PatcherError::InjectionFailed { stage, message } = &error {
                    self.observer.session_failed(SessionFailure::Injection {
                        stage: *stage,
                        message: message.clone(),
                    });
                }
                self.events.error(AppError::from(error));
                SessionEnd::Stopped
            }
        }
    }

    /// Return to the build phase for a rebuild, once the last game's process has
    /// let go of the overlay or the wait runs out.
    fn resume_building(&self) {
        self.state.lock().resume_building();
        self.events.phase_changed(PatcherPhase::Building);

        let deadline = Instant::now() + GAME_RELEASE_TIMEOUT;
        while is_game_running() && !self.stop_flag.load(Ordering::SeqCst) {
            if Instant::now() >= deadline {
                tracing::warn!("Game still running, rebuilding the overlay anyway");
                break;
            }
            thread::sleep(GAME_RELEASE_POLL);
        }
    }

    /// Move the session to patching against the overlay the build produced.
    ///
    /// Records the transition, then announces it - in that order, so an
    /// embedder that reads the shared state from its listener never sees the
    /// old value.
    fn enter_patching(&self, overlay_prefix: String) {
        self.state.lock().enter_patching(overlay_prefix);
        self.events.phase_changed(PatcherPhase::Patching);
    }

    /// Close the session. Runs on every thread exit path.
    fn reset_to_idle(&self) {
        self.state.lock().end_session();
        self.events.phase_changed(PatcherPhase::Idle);
    }
}

#[cfg(test)]
mod tests;
