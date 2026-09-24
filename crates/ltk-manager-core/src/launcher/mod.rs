//! Launching League, and following the session that comes of it.
//!
//! The work lives in [`ritoclient`], which knows nothing about this crate - no
//! [`Config`], no [`EventSink`], no error enum of ours. This module is the seam:
//! it unpacks the config, wraps the sink, and owns the types that cross the IPC
//! boundary (see `types`) so the frontend never depends on a crate it cannot
//! see a rename in.
//!
//! [`LeagueLauncher`] is what the shell holds. A [`ritoclient::Launcher`] is
//! meant to be built once and kept - its progress observer is a
//! construction-time property - and the two watchers it starts have to outlive
//! the command that started them, so one lives in app state rather than being
//! rebuilt per call.

pub mod install;
mod types;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::{Mutex, MutexGuard};
use serde::{Deserialize, Serialize};

use ritoclient::ids::{patchlines, products};
use ritoclient::prelude::*;
use ritoclient::{SessionEvent, SessionWatch};

use crate::config::Config;
use crate::events::{BackendEvent, EventSink};

pub use install::{InstallMismatch, InstalledPatchline, detect_install_mismatch, same_install};
pub use ritoclient::{LaunchTarget, StopFlag};
pub use types::{
    LaunchOutcome, LaunchProgress, LaunchRoute, LaunchStage, LauncherError, SessionChanged,
    SessionEnded, SessionGameRunning, SessionStarted,
};

/// Lowercase basename of the League client.
///
/// [`ritoclient`] names no products, so the executable to watch for is supplied
/// from here - this crate is the one that knows the manager is a League tool.
/// `riotclientservices.exe` running is *normal* and must never block a launch,
/// only this one does.
pub const LEAGUE_CLIENT_EXE: &str = "leagueclient.exe";

/// Lowercase basename of the League game.
pub const LEAGUE_GAME_EXE: &str = "league of legends.exe";

/// How often [`wait_for_game_exit`] reads the process table.
const GAME_EXIT_POLL: Duration = Duration::from_millis(100);

/// Block until the League game has exited, or `timeout` passes.
///
/// A killed game keeps its archives mapped until Windows has torn the process
/// down, and an overlay build before then cannot replace them. Returns whether
/// the game is gone.
pub fn wait_for_game_exit(timeout: Duration) -> bool {
    let start = Instant::now();

    while ritoclient::processes::is_running(LEAGUE_GAME_EXE) {
        if start.elapsed() >= timeout {
            return false;
        }
        std::thread::sleep(GAME_EXIT_POLL);
    }

    true
}

/// The product and patchline the manager launches by default.
///
/// Deliberately not a `Default` impl on [`LaunchTarget`]: which product to
/// launch is not the API crate's to assume, and a PBE picker will want to pass
/// something else here.
pub fn league_target() -> LaunchTarget {
    LaunchTarget::new(products::LEAGUE_OF_LEGENDS, patchlines::LIVE)
}

/// Whether a launch is possible right now, and why not if it isn't.
///
/// The manager's own view of [`ritoclient::Availability`]: same answers, but
/// named for the one game this application is about, which is what the UI
/// renders against.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct LaunchAvailability {
    /// Whether the platform supports launching and a Riot Client was resolved.
    pub can_launch: bool,
    /// The resolved `RiotClientServices.exe`, when one was found.
    pub riot_client_path: Option<String>,
    /// Whether a Riot Client is alive, i.e. whether a launch would take the
    /// handoff route rather than cold-starting.
    pub riot_client_running: bool,
    /// Whether `LeagueClient.exe` is already up.
    pub league_running: bool,
}

impl From<ritoclient::Availability> for LaunchAvailability {
    fn from(availability: ritoclient::Availability) -> Self {
        Self {
            can_launch: availability.can_launch,
            riot_client_path: availability.riot_client_path,
            riot_client_running: availability.riot_client_running,
            league_running: availability.game_running,
        }
    }
}

/// The manager's League launcher, and everything that outlives one launch.
///
/// Wraps a [`ritoclient::Launcher`] with the settings it was built from, the
/// session it is following, and the window hider it started. Build one and keep
/// it: [`reconfigure`](Self::reconfigure) is how a settings change reaches it,
/// so the watchers survive one.
pub struct LeagueLauncher {
    events: Arc<dyn EventSink>,
    inner: Mutex<Inner>,
}

/// Debug without the sink, which is an adapter over a window handle often
/// enough that printing its type would say nothing.
impl std::fmt::Debug for LeagueLauncher {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut out = f.debug_struct("LeagueLauncher");

        // `try_lock` rather than `lock`: a `Mutex` is not reentrant, so a
        // `{:?}` from inside a method that already holds it would deadlock, and
        // deadlocking on a debug print is the worst trade in the file.
        match self.inner.try_lock() {
            Some(inner) => out
                .field("built_for", &inner.built_for)
                .field("hide_riot_client", &inner.hide_riot_client)
                .field("following_a_session", &inner.session.is_some()),
            None => out.field("state", &"locked"),
        }
        .finish_non_exhaustive()
    }
}

struct Inner {
    launcher: ritoclient::Launcher,
    built_for: BuiltFor,
    hide_riot_client: bool,
    /// The session being followed, when there is one.
    session: Option<SessionWatch>,
    /// The window hider started for that session.
    hide: Option<SessionWatch>,
}

/// What a [`ritoclient::Launcher`] was built for.
///
/// Both halves are construction-time properties over there and settings over
/// here, so this is what notices when one moves.
#[derive(Debug, Clone, PartialEq, Eq)]
struct BuiltFor {
    league_path: Option<PathBuf>,
    target: LaunchTarget,
}

impl BuiltFor {
    fn new(config: &Config) -> Self {
        Self {
            league_path: config.league_path.clone(),
            target: league_target(),
        }
    }

    /// A launcher for this install and target.
    ///
    /// # Errors
    ///
    /// Only when [`LEAGUE_CLIENT_EXE`] is blank, which is a bug in this crate
    /// rather than a condition a caller can hit.
    fn launcher(&self, events: Arc<dyn EventSink>) -> Result<ritoclient::Launcher, LauncherError> {
        let mut builder = ritoclient::Launcher::builder(self.target.clone(), LEAGUE_CLIENT_EXE)
            .observer(SinkObserver(events));

        if let Some(root) = &self.league_path {
            builder = builder.product_root(root);
        }

        Ok(builder.build()?)
    }
}

impl LeagueLauncher {
    /// Build the launcher the whole app shares.
    ///
    /// # Errors
    ///
    /// See `BuiltFor::launcher` - a failure here is a bug rather than a
    /// machine the user can fix.
    pub fn new(config: &Config, events: Arc<dyn EventSink>) -> Result<Self, LauncherError> {
        let built_for = BuiltFor::new(config);
        let launcher = built_for.launcher(Arc::clone(&events))?;

        Ok(Self {
            events,
            inner: Mutex::new(Inner {
                launcher,
                built_for,
                hide_riot_client: config.hide_riot_client_on_launch,
                session: None,
                hide: None,
            }),
        })
    }

    /// Re-read the settings a live launcher depends on.
    ///
    /// The install root is a construction-time property of the underlying
    /// launcher, so a moved league path rebuilds it rather than being noticed on
    /// the next launch. Turning the window hider off also stops the one already
    /// running: the setting is about this session too, not only the next one.
    ///
    /// # Errors
    ///
    /// See `BuiltFor::launcher`. The old launcher is kept when a rebuild
    /// fails, so the app is never left without one.
    pub fn reconfigure(&self, config: &Config) -> Result<(), LauncherError> {
        let mut inner = self.lock();

        if inner.built_for.league_path != config.league_path {
            tracing::debug!("League path changed, rebuilding the launcher");
            inner.rebuild(BuiltFor::new(config), &self.events)?;
        }

        inner.hide_riot_client = config.hide_riot_client_on_launch;
        if !inner.hide_riot_client {
            inner.stop_hide();
        }

        Ok(())
    }

    /// Ask the Riot Client to launch League, then follow what comes of it.
    ///
    /// Blocks until the request is delivered, which is most of a minute when the
    /// client has to boot from the tray. Progress arrives on the event sink
    /// meanwhile, `stop` ends the wait early, and the session the outcome names
    /// is watched from here on.
    ///
    /// `target` overrides the product for this launch and every one after it -
    /// the launcher is rebuilt for it, because which product it drives is a
    /// construction-time property.
    ///
    /// # Errors
    ///
    /// Every way the Riot Client can decline, plus [`LauncherError::Stopped`]
    /// for a launch the user called off. That one is not a failure and must not
    /// be shown as one.
    pub fn launch(
        &self,
        target: Option<LaunchTarget>,
        stop: &StopFlag,
    ) -> Result<LaunchOutcome, LauncherError> {
        // Cloned out of the lock: the call below can hold for two minutes, and
        // availability has to keep answering while a launch is in flight.
        let launcher = {
            let mut inner = self.lock();
            if let Some(target) = target {
                inner.retarget(target, &self.events)?;
            }
            inner.launcher.clone()
        };

        let outcome = LaunchOutcome::from(launcher.launch_with_stop(stop)?);
        tracing::info!(
            route = ?outcome.route,
            session_id = ?outcome.session_id,
            "The Riot Client took the launch request"
        );

        self.follow(&launcher, &outcome);
        Ok(outcome)
    }

    /// Whether a launch is possible right now. Never fails.
    pub fn availability(&self) -> LaunchAvailability {
        let launcher = self.lock().launcher.clone();
        launcher.availability().into()
    }

    /// Ask the Riot Client to close the game it launched.
    ///
    /// Success means the client took the request, not that the game is gone -
    /// measured, that follows within six seconds.
    ///
    /// # Errors
    ///
    /// [`LauncherError::Refused`] when no client is running or it never
    /// launched this product, and [`LauncherError::RiotClientUnreachable`] when
    /// one is up but did not answer.
    pub fn close(&self) -> Result<(), LauncherError> {
        let launcher = self.lock().launcher.clone();
        launcher.close()?;
        Ok(())
    }

    /// Pick up whatever session the Riot Client has open, and report it.
    ///
    /// A game survives a restart of this app and the session id following it
    /// does not, so the status bar would come back empty with League still up.
    /// The Riot Client kept the record, and this asks for it.
    ///
    /// It answers as well as watches because a caller that arrives after the
    /// watcher's first poll would otherwise have missed the only announcement
    /// of a session already in progress - which is every caller on the far side
    /// of a webview that is still booting.
    ///
    /// Blocking. Starting a watch is skipped when one is already running: a
    /// launch this app made is the better handle, and replacing it would report
    /// the same session opening twice.
    pub fn follow_current_session(&self) -> Option<SessionStarted> {
        let (launcher, following) = {
            let inner = self.lock();
            (inner.launcher.clone(), inner.session.is_some())
        };

        let session = launcher.session()?;
        let current = SessionStarted {
            phase: session.phase().to_string(),
            // The process table, for the same reason the watcher uses it: the
            // phase reads `None` for a player sitting in the client, so asking
            // the session whether League is up gets the wrong answer.
            running: ritoclient::processes::is_running(LEAGUE_CLIENT_EXE),
            version: session.version,
        };

        if let Some(session_id) = (!following).then(|| launcher.session_id()).flatten() {
            let mut inner = self.lock();
            // A launch may have started following one while this asked.
            if inner.session.is_none() {
                tracing::info!(%session_id, "Following a League session this app did not start");
                inner.watch_session(&launcher, &session_id, Arc::clone(&self.events));
            }
        }

        Some(current)
    }

    /// Stop both watchers, for an app that is quitting.
    ///
    /// The session watcher ends on its own terminal event, but the hider polls
    /// for up to five minutes for a game that may never come, so quitting stops
    /// them rather than leaving threads talking to a client nobody is listening
    /// to.
    pub fn shutdown(&self) {
        let mut inner = self.lock();
        inner.stop_session();
        inner.stop_hide();
    }

    /// Start the watchers a delivered launch earns.
    fn follow(&self, launcher: &ritoclient::Launcher, outcome: &LaunchOutcome) {
        let mut inner = self.lock();

        match &outcome.session_id {
            Some(session_id) => {
                inner.watch_session(launcher, session_id, Arc::clone(&self.events));
            }
            // Every route the client answers names a session, so no id means
            // the launch went somewhere this build does not understand.
            None => {
                tracing::warn!("The launch outcome carries no session id, so nothing to follow")
            }
        }

        // Neither already-running route launched anything, so neither hides
        // anything: putting away a window belonging to a session the manager
        // merely found would make "your open client was left alone" a lie.
        if inner.hide_riot_client && !outcome.route.found_a_running_game() {
            inner.start_hide(launcher);
        }
    }

    /// The state behind the lock.
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock()
    }
}

impl Inner {
    /// Follow a session, replacing whatever was being followed before.
    fn watch_session(
        &mut self,
        launcher: &ritoclient::Launcher,
        session_id: &str,
        events: Arc<dyn EventSink>,
    ) {
        self.stop_session();
        self.session = Some(launcher.watch_session(session_id, SessionSink(events)));
    }

    /// Hide the Riot Client for this session, replacing any earlier hider.
    fn start_hide(&mut self, launcher: &ritoclient::Launcher) {
        self.stop_hide();
        self.hide = Some(launcher.hide_during_session());
    }

    fn stop_session(&mut self) {
        if let Some(watch) = self.session.take() {
            watch.stop();
        }
    }

    fn stop_hide(&mut self) {
        if let Some(watch) = self.hide.take() {
            watch.stop();
        }
    }

    /// Point the launcher at a different product, rebuilding it when it moves.
    fn retarget(
        &mut self,
        target: LaunchTarget,
        events: &Arc<dyn EventSink>,
    ) -> Result<(), LauncherError> {
        if self.built_for.target == target {
            return Ok(());
        }

        tracing::info!(%target, "Launch target changed, rebuilding the launcher");
        self.rebuild(
            BuiltFor {
                league_path: self.built_for.league_path.clone(),
                target,
            },
            events,
        )
    }

    /// Swap the underlying launcher, keeping the old one when the new one
    /// cannot be built.
    fn rebuild(
        &mut self,
        built_for: BuiltFor,
        events: &Arc<dyn EventSink>,
    ) -> Result<(), LauncherError> {
        self.launcher = built_for.launcher(Arc::clone(events))?;
        self.built_for = built_for;
        Ok(())
    }
}

/// Bridges the crate's launch observer to the manager's event registry.
struct SinkObserver(Arc<dyn EventSink>);

impl ritoclient::LaunchObserver for SinkObserver {
    fn on_progress(&self, progress: ritoclient::LaunchProgress) {
        self.0.emit(BackendEvent::LaunchProgress(progress.into()));
    }
}

/// Bridges the crate's session observer to the manager's event registry.
struct SessionSink(Arc<dyn EventSink>);

impl ritoclient::SessionObserver for SessionSink {
    fn on_event(&self, event: SessionEvent) {
        // Runs on the watching thread, so this maps and emits and does nothing
        // else.
        if let Some(event) = Self::as_backend_event(event) {
            self.0.emit(event);
        }
    }
}

impl SessionSink {
    /// The manager's name for one of the crate's session events.
    ///
    /// `None` for an event this build does not know: [`SessionEvent`] is
    /// `#[non_exhaustive]`, and announcing an unknown one under an existing name
    /// would be a guess about what the session did.
    fn as_backend_event(event: SessionEvent) -> Option<BackendEvent> {
        Some(match event {
            SessionEvent::Opened {
                phase,
                version,
                game_running,
            } => BackendEvent::SessionStarted(SessionStarted {
                phase: phase.to_string(),
                running: game_running,
                version,
            }),
            SessionEvent::PhaseChanged { to, .. } => BackendEvent::SessionChanged(SessionChanged {
                phase: to.to_string(),
            }),
            SessionEvent::GameRunning { running } => {
                BackendEvent::SessionGameRunning(SessionGameRunning { running })
            }
            SessionEvent::Ended { exit_code, reason } => BackendEvent::SessionEnded(SessionEnded {
                exit_code: Some(exit_code),
                exit_reason: Some(reason.to_string()),
            }),
            // The client exited and took the record with it while the game also
            // stopped. A real ending with nothing to say about why, and wording
            // it as a crash would be inventing the reason.
            SessionEvent::Lost => BackendEvent::SessionEnded(SessionEnded {
                exit_code: None,
                exit_reason: None,
            }),
            _ => return None,
        })
    }
}

/// The install root of an installed League patchline, from a client that is
/// running right now.
///
/// Prefers `live`, then any other installed patchline, so a machine with only
/// PBE still detects something. `None` when no client is up or nothing is
/// installed - the caller falls back to scanning disk.
pub fn detect_league_install_root() -> Option<PathBuf> {
    let installed = ritoclient::Client::new()
        .ok()?
        .product_registry()
        .products()?;
    let league = installed
        .iter()
        .find(|product| product.id == products::LEAGUE_OF_LEGENDS)?;

    league
        .patchline(patchlines::LIVE)
        .filter(|patchline| patchline.is_installed())
        .or_else(|| league.installed_patchlines().next())
        .and_then(PatchlineExt::install_root)
}

#[cfg(test)]
mod tests {
    use super::*;

    use parking_lot::Mutex;

    use ritoclient::{LaunchObserver, SessionObserver, SessionPhase};

    #[derive(Default)]
    struct RecordingSink(Mutex<Vec<BackendEvent>>);

    impl RecordingSink {
        fn names(&self) -> Vec<&'static str> {
            self.0.lock().iter().map(BackendEvent::name).collect()
        }
    }

    impl EventSink for RecordingSink {
        fn emit(&self, event: BackendEvent) {
            self.0.lock().push(event);
        }
    }

    fn launcher() -> LeagueLauncher {
        LeagueLauncher::new(&Config::default(), Arc::new(crate::events::NullEventSink)).unwrap()
    }

    /// The adapter's whole job is that launch progress reaches the sink under
    /// the name the frontend listens for. Nothing else here can prove that.
    #[test]
    fn progress_reaches_the_sink_as_a_launch_event() {
        let sink = Arc::new(RecordingSink::default());
        SinkObserver(sink.clone()).on_progress(ritoclient::LaunchProgress::at(
            ritoclient::LaunchStage::Resolving,
        ));

        assert_eq!(sink.names(), vec!["launch-progress"]);
    }

    /// The session watcher reports in a fixed order, and each of its events has
    /// exactly one name on this side.
    #[test]
    fn session_events_reach_the_sink_under_their_own_names() {
        let sink = Arc::new(RecordingSink::default());
        let observer = SessionSink(sink.clone());

        observer.on_event(SessionEvent::Opened {
            phase: SessionPhase::Pending,
            version: "24C2E5A086AFFB82".to_string(),
            game_running: false,
        });
        observer.on_event(SessionEvent::PhaseChanged {
            from: SessionPhase::Pending,
            to: SessionPhase::Gameplay,
        });
        observer.on_event(SessionEvent::GameRunning { running: true });
        observer.on_event(SessionEvent::Ended {
            exit_code: 0,
            reason: ritoclient::TerminationReason::Exit,
        });

        assert_eq!(
            sink.names(),
            vec![
                "session-started",
                "session-changed",
                "session-game-running",
                "session-ended"
            ]
        );
    }

    /// Recorded from client 137: a player sitting in the client reports phase
    /// `None` with League very much up. The phase is the match's business and
    /// the process is the manager's, so the two must not be crossed - reading
    /// "is League up" off the phase parks the status bar on "waiting" for a
    /// whole session.
    #[test]
    fn the_game_is_reported_running_whatever_the_phase_says() {
        let started = SessionSink::as_backend_event(SessionEvent::Opened {
            phase: SessionPhase::Nothing,
            version: "24C2E5A086AFFB82".to_string(),
            game_running: true,
        });
        assert!(matches!(
            started,
            Some(BackendEvent::SessionStarted(SessionStarted {
                running: true,
                ..
            }))
        ));

        let running = SessionSink::as_backend_event(SessionEvent::GameRunning { running: false });
        assert!(matches!(
            running,
            Some(BackendEvent::SessionGameRunning(SessionGameRunning {
                running: false
            }))
        ));
    }

    /// A phase this build does not know still reaches the frontend, spelled the
    /// way the client spelled it. Dropping it would leave the bar showing the
    /// phase before it.
    #[test]
    fn an_unknown_phase_is_passed_through_verbatim() {
        let event = SessionSink::as_backend_event(SessionEvent::Opened {
            phase: SessionPhase::Other("Rehearsal".to_string()),
            version: String::new(),
            game_running: false,
        });

        let Some(BackendEvent::SessionStarted(started)) = event else {
            panic!("expected a session-started event, got {event:?}");
        };
        assert_eq!(started.phase, "Rehearsal");
        assert!(!started.running);
    }

    /// The client stopped answering and the game is gone. That is an ending,
    /// and it is one with no reason - which the frontend must be able to tell
    /// apart from an ordinary exit.
    #[test]
    fn a_lost_session_ends_without_a_reason() {
        let event = SessionSink::as_backend_event(SessionEvent::Lost);

        let Some(BackendEvent::SessionEnded(ended)) = event else {
            panic!("expected a session-ended event, got {event:?}");
        };
        assert_eq!(ended.exit_code, None);
        assert_eq!(ended.exit_reason, None);
    }

    /// Availability must answer on any machine, configured or not - the button
    /// state depends on it, so it reports rather than fails. Whatever this
    /// machine happens to have installed, offering a launch without a resolved
    /// client would be offering one that cannot run.
    #[test]
    fn availability_never_offers_a_launch_without_a_client() {
        let availability = launcher().availability();

        assert_eq!(
            availability.can_launch,
            availability.riot_client_path.is_some()
        );
    }

    /// Stopping a launcher that never launched anything is what app exit does
    /// on most runs, so it has to be a no-op rather than a panic.
    #[test]
    fn shutting_down_without_a_session_is_harmless() {
        let launcher = launcher();
        launcher.shutdown();
        launcher.shutdown();
    }

    /// A launch the caller called off before it started must not resolve, wake
    /// or spawn anything - and it must arrive as `Stopped` rather than as a
    /// failure of the machine.
    #[test]
    fn a_launch_stopped_before_it_starts_reports_stopped() {
        let stop = StopFlag::new();
        stop.stop();

        let error = launcher().launch(None, &stop).unwrap_err();
        assert_eq!(error, LauncherError::Stopped);
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn launching_off_windows_is_refused_through_the_adapter() {
        let error = launcher().launch(None, &StopFlag::new()).unwrap_err();
        assert_eq!(error, LauncherError::UnsupportedPlatform);
    }
}
