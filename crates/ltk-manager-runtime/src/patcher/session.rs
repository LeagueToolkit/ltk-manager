//! Per-session orchestration of the persistent injection host.
//!
//! Ties the [`PatcherHost`] lifecycle to the [`Injector`] event loop for one
//! patching session: ensure a usable host, configure it, start the scan, drive
//! the event loop until the game exits or the caller stops, then hand the
//! host's event stream back for the next session. UI-facing conditions are
//! reported through [`PatcherEvents`], keeping this module frontend-agnostic.

use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::sync::mpsc::Receiver;

use chrono::Utc;
use parking_lot::Mutex;

use crate::diagnostics::binary_id::PatcherBinaries;
use crate::diagnostics::incident::{GameRecord, SessionFailure};

use super::events::PatcherEvents;
use super::host::{HostConfig, HostError, HostLine, PatcherHost};
use super::injector::{Injector, InjectorError, InjectorEvent, SessionEnd};
use super::recorder::GameRecorder;
use super::refresh::OverlayRefresh;

/// Fatal error from one injection session.
#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    /// The host process could not be spawned, configured, or started.
    #[error(transparent)]
    Host(#[from] HostError),
    /// The injection session itself failed.
    #[error(transparent)]
    Injector(#[from] InjectorError),
}

/// Takes each game record a session closes.
pub type RecordHandler = Arc<dyn Fn(GameRecord) + Send + Sync>;

/// Where a session's events go: the embedder, and the game record.
///
/// One per session, shared between the injector's callback and the thread
/// that owns the session, so a failure after the event loop returns still
/// reaches the record.
pub struct SessionObserver {
    events: Arc<dyn PatcherEvents>,
    recorder: Mutex<GameRecorder>,
    records: RecordHandler,
}

impl SessionObserver {
    pub fn new(
        events: Arc<dyn PatcherEvents>,
        recorder: GameRecorder,
        records: RecordHandler,
    ) -> Self {
        Self {
            events,
            recorder: Mutex::new(recorder),
            records,
        }
    }

    /// Routes one injector event to the embedder and the game record, and
    /// hands a closed record to the handler.
    pub fn observe(&self, event: InjectorEvent) {
        match &event {
            InjectorEvent::WadScanFailed { failures } => {
                self.events.wad_scan_failed(failures.clone());
            }
            InjectorEvent::GameAttached { pid } => self.events.game_attached(*pid),
            InjectorEvent::Overlay { outcome, .. } => self.events.game_overlay(*outcome),
            InjectorEvent::GameExited => self.events.game_exited(),
            InjectorEvent::OverlayDeferred => self.events.overlay_deferred(),
            _ => {}
        }
        let closed = self.recorder.lock().observe(&event, Utc::now());
        if let Some(record) = closed {
            (self.records)(record);
        }
    }

    /// Records the binaries that the session's games run with.
    pub fn set_patcher(&self, patcher: PatcherBinaries) {
        self.recorder.lock().set_patcher(patcher);
    }

    /// The session failed, in the build or at the host. The record, with any
    /// open game folded in, goes to the handler.
    pub fn session_failed(&self, failure: SessionFailure) {
        let record = self.recorder.lock().session_failed(failure, Utc::now());
        (self.records)(record);
    }

    /// The session ended by request. A game still running is dropped unless
    /// the scan rejected an archive, which is recorded.
    pub fn session_stopped(&self) {
        let closed = self.recorder.lock().session_stopped(Utc::now());
        if let Some(record) = closed {
            (self.records)(record);
        }
    }
}

/// Ensure the overlay prefix ends with a path separator, as the host's
/// `config prefix` command expects a directory prefix.
pub fn normalize_overlay_prefix(prefix: &str) -> String {
    let mut normalized = prefix.to_string();
    if !normalized.ends_with(std::path::MAIN_SEPARATOR) {
        normalized.push(std::path::MAIN_SEPARATOR);
    }
    normalized
}

/// Run one injection session against the persistent host, blocking until
/// `stop_flag` is set or `refresh` asks for a rebuild with no game open.
///
/// Ensures a usable host (spawning or respawning as needed), configures it,
/// starts the scan, and drives the injector's event loop. On exit the host's
/// event stream is handed back for reuse by the next session - unless the host
/// died, in which case it is cleared so the next start respawns.
pub fn run_injection_session(
    host: &Arc<Mutex<Option<PatcherHost>>>,
    injector_exe: &Path,
    config: &HostConfig,
    stop_flag: &AtomicBool,
    refresh: &OverlayRefresh,
    observer: Arc<SessionObserver>,
) -> Result<SessionEnd, SessionError> {
    let host_lines = ensure_host_started(host, injector_exe, config)?;

    // Blocks until the game closes or the patcher is stopped.
    let (result, host_lines) = Injector::new()
        .on_event(move |event| observer.observe(event))
        .run_session(host_lines, host, stop_flag, refresh);

    // Hand the event stream back to the host so the next session reuses it -
    // unless the host died, in which case clear it so the next start respawns.
    {
        let mut guard = host.lock();
        let alive = guard.as_mut().map(|h| h.is_alive()).unwrap_or(false);
        if alive {
            guard
                .as_mut()
                .expect("host present when alive")
                .restore_events(host_lines);
        } else {
            *guard = None;
        }
    }

    result.map_err(SessionError::from)
}

/// Configure the persistent host and begin a scan session, returning its event
/// stream. Reuses the live host, and respawns it if it is missing, dead, or runs
/// from another executable.
fn ensure_host_started(
    host_arc: &Arc<Mutex<Option<PatcherHost>>>,
    exe_path: &Path,
    config: &HostConfig,
) -> Result<Receiver<HostLine>, HostError> {
    let mut guard = host_arc.lock();

    ensure_started(
        &mut guard,
        || PatcherHost::spawn(exe_path),
        exe_path,
        config,
    )
}

/// What starting a session needs from a host.
///
/// Only exists so [`ensure_started`]'s reuse-or-respawn rules can be tested
/// against a stub: every branch below decides whether the session silently never
/// injects, and none of it is reachable with a real `Child` in a test.
trait SessionHost {
    fn is_alive(&mut self) -> bool;
    fn exe(&self) -> &Path;
    fn drain_events(&mut self) -> bool;
    fn configure(&mut self, config: &HostConfig) -> Result<(), HostError>;
    fn start_scan(&mut self) -> Result<(), HostError>;
    fn take_events(&mut self) -> Option<Receiver<HostLine>>;
    fn shutdown(&mut self);
}

impl SessionHost for PatcherHost {
    fn is_alive(&mut self) -> bool {
        PatcherHost::is_alive(self)
    }

    fn exe(&self) -> &Path {
        PatcherHost::exe(self)
    }

    fn drain_events(&mut self) -> bool {
        PatcherHost::drain_events(self)
    }

    fn configure(&mut self, config: &HostConfig) -> Result<(), HostError> {
        PatcherHost::configure(self, config)
    }

    fn start_scan(&mut self) -> Result<(), HostError> {
        PatcherHost::start_scan(self)
    }

    fn take_events(&mut self) -> Option<Receiver<HostLine>> {
        PatcherHost::take_events(self)
    }

    fn shutdown(&mut self) {
        PatcherHost::shutdown(self)
    }
}

/// Bring `slot` to a host that has been configured and told to start scanning,
/// and borrow its event stream for the session.
fn ensure_started<H: SessionHost>(
    slot: &mut Option<H>,
    spawn: impl FnOnce() -> Result<H, HostError>,
    exe: &Path,
    config: &HostConfig,
) -> Result<Receiver<HostLine>, HostError> {
    // `drain_events` clears the previous session's trailing lines and doubles as
    // a liveness probe: a lost or disconnected stream means the host can't serve
    // another session even if the process is still alive.
    let needs_spawn = match slot.as_mut() {
        None => true,
        Some(host) => !host.is_alive() || host.exe() != exe || !host.drain_events(),
    };
    if needs_spawn {
        if let Some(mut old) = slot.take() {
            // A dead host returns at once.
            old.shutdown();
        }
        *slot = Some(spawn()?);
    }

    let result = {
        let host = slot.as_mut().expect("host present after ensure");
        host.configure(config).and_then(|_| host.start_scan())
    };
    if let Err(e) = result {
        // A failed handshake may leave the host wedged; shut it down so the next
        // start spawns clean.
        if let Some(mut broken) = slot.take() {
            broken.shutdown();
        }
        return Err(e);
    }

    Ok(slot
        .as_mut()
        .expect("host present after ensure")
        .take_events()
        .expect("event stream present on a freshly spawned or reused host"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use assert_matches::assert_matches;
    use std::cell::RefCell;
    use std::path::PathBuf;
    use std::rc::Rc;
    use std::sync::mpsc;

    use crate::patcher::host::HostLogLevel;

    const HOST_EXE: &str = "host.exe";

    /// Which handshake step a stub host should fail at.
    #[derive(Clone, Copy, PartialEq)]
    enum FailAt {
        Configure,
        StartScan,
    }

    /// A stand-in for [`PatcherHost`] with no process behind it.
    ///
    /// Its event stream carries a single marker line naming the host, so a test
    /// can tell "you got the stream of the host that was already there" from
    /// "you got a freshly spawned one".
    struct FakeHost {
        name: &'static str,
        alive: bool,
        exe: PathBuf,
        drain_ok: bool,
        fail_at: Option<FailAt>,
        events: Option<Receiver<HostLine>>,
        log: Rc<RefCell<Vec<String>>>,
    }

    impl FakeHost {
        fn new(name: &'static str, log: &Rc<RefCell<Vec<String>>>) -> Self {
            let (tx, rx) = mpsc::channel();
            tx.send(Ok(name.to_string())).unwrap();
            Self {
                name,
                alive: true,
                exe: PathBuf::from(HOST_EXE),
                drain_ok: true,
                fail_at: None,
                events: Some(rx),
                log: Rc::clone(log),
            }
        }

        fn record(&self, what: &str) {
            self.log.borrow_mut().push(format!("{}:{what}", self.name));
        }
    }

    impl SessionHost for FakeHost {
        fn is_alive(&mut self) -> bool {
            self.alive
        }

        fn exe(&self) -> &Path {
            &self.exe
        }

        fn drain_events(&mut self) -> bool {
            self.drain_ok
        }

        fn configure(&mut self, _config: &HostConfig) -> Result<(), HostError> {
            self.record("configure");
            match self.fail_at {
                Some(FailAt::Configure) => Err(HostError::Protocol("configure failed".into())),
                _ => Ok(()),
            }
        }

        fn start_scan(&mut self) -> Result<(), HostError> {
            self.record("start_scan");
            match self.fail_at {
                Some(FailAt::StartScan) => Err(HostError::Protocol("start failed".into())),
                _ => Ok(()),
            }
        }

        fn take_events(&mut self) -> Option<Receiver<HostLine>> {
            self.events.take()
        }

        fn shutdown(&mut self) {
            self.record("shutdown");
        }
    }

    /// Name of the host whose stream a session ended up with.
    fn stream_owner(events: &Receiver<HostLine>) -> String {
        events.recv().unwrap().unwrap()
    }

    fn config() -> HostConfig {
        HostConfig {
            prefix: "overlay\\".to_string(),
            log_level: HostLogLevel::Info,
            flags: 0,
        }
    }

    /// Runs `ensure_started` for [`HOST_EXE`] against `slot`, recording whether a spawn
    /// happened.
    fn start(
        slot: &mut Option<FakeHost>,
        log: &Rc<RefCell<Vec<String>>>,
    ) -> (Result<Receiver<HostLine>, HostError>, usize) {
        start_from(slot, Path::new(HOST_EXE), log)
    }

    fn start_from(
        slot: &mut Option<FakeHost>,
        exe: &Path,
        log: &Rc<RefCell<Vec<String>>>,
    ) -> (Result<Receiver<HostLine>, HostError>, usize) {
        let spawned = Rc::new(RefCell::new(0));
        let result = {
            let spawned = Rc::clone(&spawned);
            let log = Rc::clone(log);
            ensure_started(
                slot,
                move || {
                    *spawned.borrow_mut() += 1;
                    let mut host = FakeHost::new("fresh", &log);
                    host.exe = exe.to_path_buf();
                    Ok(host)
                },
                exe,
                &config(),
            )
        };
        let spawned = *spawned.borrow();
        (result, spawned)
    }

    #[test]
    fn spawns_when_there_is_no_host_yet() {
        let log = Rc::new(RefCell::new(Vec::new()));
        let mut slot = None;

        let (events, spawned) = start(&mut slot, &log);

        assert_eq!(spawned, 1);
        assert_eq!(stream_owner(&events.unwrap()), "fresh");
        assert_eq!(*log.borrow(), ["fresh:configure", "fresh:start_scan"]);
    }

    #[test]
    fn reuses_a_healthy_host() {
        let log = Rc::new(RefCell::new(Vec::new()));
        let mut slot = Some(FakeHost::new("live", &log));

        let (events, spawned) = start(&mut slot, &log);

        assert_eq!(spawned, 0, "a live host must be reused");
        assert_eq!(stream_owner(&events.unwrap()), "live");
        assert_eq!(*log.borrow(), ["live:configure", "live:start_scan"]);
    }

    #[test]
    fn respawns_a_dead_host() {
        let log = Rc::new(RefCell::new(Vec::new()));
        let mut dead = FakeHost::new("dead", &log);
        dead.alive = false;
        let mut slot = Some(dead);

        let (events, spawned) = start(&mut slot, &log);

        assert_eq!(spawned, 1);
        assert_eq!(stream_owner(&events.unwrap()), "fresh");
        assert!(log.borrow().contains(&"dead:shutdown".to_string()));
    }

    #[test]
    fn ensure_started_respawns_when_exe_changes() {
        let log = Rc::new(RefCell::new(Vec::new()));
        let mut slot = Some(FakeHost::new("older", &log));

        let (events, spawned) = start_from(&mut slot, Path::new("delivered.exe"), &log);

        assert_eq!(spawned, 1);
        assert_eq!(stream_owner(&events.unwrap()), "fresh");
        assert_eq!(slot.unwrap().exe, Path::new("delivered.exe"));
        assert!(log.borrow().contains(&"older:shutdown".to_string()));
    }

    /// A host can outlive its own stdout reader. The process still looks alive,
    /// but every line it emits is lost, so the session must not reuse it.
    #[test]
    fn respawns_when_the_event_stream_is_lost() {
        let log = Rc::new(RefCell::new(Vec::new()));
        let mut deaf = FakeHost::new("deaf", &log);
        deaf.drain_ok = false;
        let mut slot = Some(deaf);

        let (events, spawned) = start(&mut slot, &log);

        assert_eq!(spawned, 1);
        assert_eq!(stream_owner(&events.unwrap()), "fresh");
        assert!(log.borrow().contains(&"deaf:shutdown".to_string()));
    }

    #[test]
    fn a_failed_configure_discards_the_host() {
        let log = Rc::new(RefCell::new(Vec::new()));
        let mut broken = FakeHost::new("broken", &log);
        broken.fail_at = Some(FailAt::Configure);
        let mut slot = Some(broken);

        let (result, _) = start(&mut slot, &log);

        assert_matches!(result, Err(HostError::Protocol(_)));
        assert!(slot.is_none(), "a wedged host must not be left in the slot");
        assert!(log.borrow().contains(&"broken:shutdown".to_string()));
        assert!(
            !log.borrow().contains(&"broken:start_scan".to_string()),
            "start must not be sent to a host that failed to configure"
        );
    }

    #[test]
    fn a_failed_start_scan_discards_the_host() {
        let log = Rc::new(RefCell::new(Vec::new()));
        let mut broken = FakeHost::new("broken", &log);
        broken.fail_at = Some(FailAt::StartScan);
        let mut slot = Some(broken);

        let (result, _) = start(&mut slot, &log);

        assert_matches!(result, Err(HostError::Protocol(_)));
        assert!(slot.is_none(), "a wedged host must not be left in the slot");
        assert!(log.borrow().contains(&"broken:shutdown".to_string()));
    }

    /// The old host is taken out of the slot before the spawn is attempted, so a
    /// spawn failure must not leave a stale one behind for the next start.
    #[test]
    fn a_failed_spawn_leaves_the_slot_empty() {
        let log = Rc::new(RefCell::new(Vec::new()));
        let mut dead = FakeHost::new("dead", &log);
        dead.alive = false;
        let mut slot = Some(dead);

        let result = ensure_started(
            &mut slot,
            || Err(HostError::StdoutClosed),
            Path::new(HOST_EXE),
            &config(),
        );

        assert_matches!(result, Err(HostError::StdoutClosed));
        assert!(slot.is_none());
        assert!(log.borrow().contains(&"dead:shutdown".to_string()));
    }

    #[test]
    fn normalize_overlay_prefix_appends_separator() {
        let normalized = normalize_overlay_prefix("overlay");
        assert_eq!(normalized, format!("overlay{}", std::path::MAIN_SEPARATOR));
    }

    #[test]
    fn normalize_overlay_prefix_keeps_existing_separator() {
        let prefix = format!("overlay{}", std::path::MAIN_SEPARATOR);
        assert_eq!(normalize_overlay_prefix(&prefix), prefix);
    }
}
