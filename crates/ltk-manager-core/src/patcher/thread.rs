//! Background patching thread: builds the overlay, runs one injection session,
//! and reports everything user-facing through [`PatcherEvents`].

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use crate::config::Config;
use crate::diagnostics::incident::SessionFailure;
use crate::diagnostics::store::IncidentStore;
use crate::error::{AppError, AppResult, MutexResultExt};
use crate::mods::ModLibrary;
use crate::overlay::OverlayBuild;

use super::error::PatcherError;
use super::events::PatcherEvents;
use super::host::{HostConfig, HostLogLevel, PatcherHost};
use super::pipeline::IncidentPipeline;
use super::recorder::GameRecorder;
use super::session::{self, SessionError, SessionObserver};
use super::state::{PatcherPhase, PatcherStateInner, StoredPatcherConfig};

/// Per-session inputs for [`PatcherThread::start`], resolved by the caller
/// before the patcher state is claimed.
pub struct SessionParams {
    pub injector_exe: PathBuf,
    pub config: Config,
    pub library: ModLibrary,
    pub workshop_paths: Vec<PathBuf>,
    pub host_flags: u32,
    pub should_elevate: bool,
    /// Where the session's incidents are written.
    pub incident_store: Arc<IncidentStore>,
}

/// Inputs moved into the background patcher thread.
pub struct PatcherThread {
    events: Arc<dyn PatcherEvents>,
    observer: Arc<SessionObserver>,
    state: Arc<Mutex<PatcherStateInner>>,
    host: Arc<Mutex<Option<PatcherHost>>>,
    stop_flag: Arc<AtomicBool>,
    injector_exe: PathBuf,
    config: Config,
    library: ModLibrary,
    workshop_paths: Vec<PathBuf>,
    host_flags: u32,
    should_elevate: bool,
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
        let mut patcher_state = state.lock().mutex_err()?;
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
            injector_exe,
            config,
            library,
            workshop_paths,
            host_flags,
            should_elevate,
            incident_store,
        } = params;
        let pipeline = Arc::new(IncidentPipeline::new(
            config.clone(),
            host_flags,
            library.clone(),
            workshop_paths.clone(),
            incident_store,
            Arc::clone(&events),
        ));
        let observer = Arc::new(SessionObserver::new(
            Arc::clone(&events),
            GameRecorder::new(origin, should_elevate),
            pipeline,
        ));
        let session = Self {
            events,
            observer,
            state: Arc::clone(state),
            host: Arc::clone(host),
            stop_flag: Arc::clone(&patcher_state.stop_flag),
            injector_exe,
            config,
            library,
            workshop_paths,
            host_flags,
            should_elevate,
        };
        patcher_state.thread_handle = Some(thread::spawn(move || session.run()));
        Ok(())
    }

    fn run(self) {
        let Some(overlay_prefix) = self.build_overlay() else {
            return;
        };
        self.run_session(overlay_prefix);
    }

    /// Build the overlay and return its prefix path, or `None` on failure/early
    /// stop (state already reset).
    fn build_overlay(&self) -> Option<String> {
        let build = match self
            .library
            .ensure_overlay(&self.config, &self.workshop_paths, false)
        {
            Ok(build) => build,
            Err(e) => {
                tracing::error!(error = ?e, "Overlay build failed");
                self.observer.session_failed(SessionFailure::Build {
                    kind: e.kind(),
                    message: e.to_string(),
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
        let offender_count = outcome.linked_bin_offenders.len();
        self.library.record_overlay_build(outcome);

        if self.stop_flag.load(Ordering::SeqCst) {
            tracing::info!("Stop requested after overlay build, exiting");
            self.reset_to_idle();
            return None;
        }

        self.check_linked_bins(offender_count);

        tracing::info!("Using overlay root: {}", overlay_root.display());
        Some(session::normalize_overlay_prefix(
            &overlay_root.display().to_string(),
        ))
    }

    fn check_linked_bins(&self, offender_count: usize) {
        // TODO: move the linked-bin check into the workshop - we can check
        // for the missing linked bins when a given mod project is opened by
        // iterating over all linked bins in the mod, overlaying their paths,
        // and checking if they exist. This would allow us to show the user
        // the missing linked bins before they even start the patcher.
        if self.config.linked_bin_check_enabled && offender_count > 0 {
            self.events.linked_bin_warning(offender_count as u32);
        }
    }

    /// Run one injection session via the core orchestration, blocking until the
    /// game exits or the caller stops, then reset state.
    fn run_session(&self, overlay_prefix: String) {
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
            &self.injector_exe,
            self.should_elevate,
            &host_config,
            &self.stop_flag,
            Arc::clone(&self.observer),
        );

        match result {
            Ok(()) => {
                tracing::info!("Injector stopped");
                self.observer.session_stopped();
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
            }
        }

        self.reset_to_idle();
        tracing::info!("Patcher thread exiting");
    }

    /// Move the session to patching against the overlay the build produced.
    ///
    /// Records the transition, then announces it - in that order, so an
    /// embedder that reads the shared state from its listener never sees the
    /// old value.
    fn enter_patching(&self, overlay_prefix: String) {
        if let Ok(mut s) = self.state.lock() {
            s.enter_patching(overlay_prefix);
        }
        self.events.phase_changed(PatcherPhase::Patching);
    }

    /// Close the session. Runs on every thread exit path.
    fn reset_to_idle(&self) {
        if let Ok(mut s) = self.state.lock() {
            s.end_session();
        }
        self.events.phase_changed(PatcherPhase::Idle);
    }
}
