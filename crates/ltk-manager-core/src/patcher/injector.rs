//! External-process injector via the host line protocol.
//!
//! We communicate with the host process over its stdin/stdout line protocol.
//! The host owns all injection logic (window scanning, `SetWindowsHookEx`, DLL
//! pipe) and reports structured lifecycle events back to us.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::diagnostics::incident::{EvidenceSource, LaunchKind, OverlayOutcome};

use super::dll_lines::{self, DllLine, host_status};
use super::host::{self, HOST_EXE_NAME, HostError, HostEvent, HostLine, HostState, PatcherHost};

pub use super::dll_lines::parse_wad_scan_failure;

/// Re-export the executable name that `commands/patcher.rs` resolves.
pub const INJECTOR_EXE_NAME: &str = HOST_EXE_NAME;

#[derive(Debug, thiserror::Error)]
pub enum InjectorError {
    #[error("Host process error: {0}")]
    Host(#[from] HostError),
    #[error("Host injection failed: {0}")]
    Failed(String),
}

/// Notable conditions the injector surfaces to the host application while a
/// session is running. Keeps the injector free of any Tauri/UI dependency: the
/// command layer supplies a callback that translates these into UI events.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InjectorEvent {
    /// The host is scanning for a game, at the start of the session or after
    /// the last game's window went away.
    Scanning,
    /// The host hooked a game's thread. The first sign of a game.
    GameFound,
    /// The DLL acked the host's config. `pid` is read from the first `dll`
    /// record after the ack, and is `None` when none came in time.
    GameAttached { pid: Option<u64> },
    /// What the DLL said about the overlay after it attached. `detail` is the
    /// archive and reason for a disabled overlay, the hook that failed, or the
    /// build timestamp the DLL refused.
    Overlay {
        outcome: OverlayOutcome,
        detail: Option<String>,
    },
    /// The overlay hook served an archive, named by its last path segment.
    WadRedirected { wad: String },
    /// The lazy scan skipped one archive, and the game runs without it.
    WadSkipped { wad: String, why: String },
    /// What kind of game the DLL read from the command line.
    Launch(LaunchKind),
    /// The game process ended. The last sign of a game, and not of the session.
    GameExited,
    /// One or more archives failed the injected DLL's integrity scan, so no mods
    /// were applied this session. The DLL aborts on the first failure, so we
    /// auto-stop the patcher and surface the failures instead of silently doing
    /// nothing.
    WadScanFailed { failures: Vec<WadScanFailure> },
    /// A line with no typed event of its own, kept for the evidence timeline:
    /// the host's other status lines, and the DLL's notable records.
    Line {
        source: EvidenceSource,
        /// The host's own clock, in seconds since it started.
        at_host: String,
        text: String,
    },
}

/// A single archive that failed the injected DLL's integrity scan.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WadScanFailure {
    /// The archive (e.g. `TahmKench.wad.client`), if we could parse the name.
    pub wad: Option<String>,
    /// The NTSTATUS-style code the scan reported (e.g. `c0000229` skinhack,
    /// `c000003e` parse error). Callers classify it; the injector stays
    /// status-agnostic.
    pub status: String,
}

type EventCallback = Box<dyn Fn(InjectorEvent) + Send>;

/// Ends the host's current injection session.
///
/// The event loop needs exactly one thing from the host - the ability to say
/// "stop" - so it takes this instead of the whole `Arc<Mutex<Option<PatcherHost>>>`.
/// That is what makes the loop testable: production passes the real host, tests
/// pass a stub that records the call.
pub trait SessionControl {
    fn stop_session(&self);
}

impl SessionControl for Arc<Mutex<Option<PatcherHost>>> {
    fn stop_session(&self) {
        if let Ok(mut guard) = self.lock()
            && let Some(h) = guard.as_mut()
        {
            let _ = h.stop_session();
        }
    }
}

/// How long to keep gathering "WAD scan failed" lines after the first before
/// reporting them together. They arrive as a burst during the game's load scan,
/// so a short window captures every offending archive.
const WAD_FAILURE_COLLECT_WINDOW: Duration = Duration::from_millis(750);

/// How long after `status injected` to wait for a `dll` record to name the
/// game's pid before reporting the attach without one. The DLL logs `init in
/// process` at once, so this only runs out when it logs nothing at all.
const ATTACH_PID_WINDOW: Duration = Duration::from_secs(1);

/// Drives one patching session against an already-running [`PatcherHost`].
///
/// The host process itself is spawned and kept alive by the caller (see
/// `commands::patcher`); the injector only runs the per-session event loop and,
/// on stop, issues a `stop` command rather than killing the host.
pub struct Injector {
    elevate: bool,
    on_event: Option<EventCallback>,
}

impl Default for Injector {
    fn default() -> Self {
        Self::new()
    }
}

impl Injector {
    pub fn new() -> Self {
        Self {
            elevate: false,
            on_event: None,
        }
    }

    /// Enable elevation mode (`--elevate`), which triggers a UAC prompt and
    /// runs the host at high integrity. Required when the game is protected
    /// by Vanguard.
    pub fn with_elevate(mut self, elevate: bool) -> Self {
        self.elevate = elevate;
        self
    }

    /// Register a callback invoked when the injector observes a notable
    /// condition during a session (see [`InjectorEvent`]).
    pub fn on_event(mut self, f: impl Fn(InjectorEvent) + Send + 'static) -> Self {
        self.on_event = Some(Box::new(f));
        self
    }

    fn emit_event(&self, event: InjectorEvent) {
        if let Some(cb) = &self.on_event {
            cb(event);
        }
    }

    /// Run one patching session's event loop against a persistent host, blocking
    /// until the game exits or `stop_flag` is set.
    ///
    /// The caller has already configured the host and started the scan; here we
    /// only consume `events` - the host's stdout line stream - dispatching events
    /// until the session ends. On stop (or an auto-stop from a failed WAD scan)
    /// we send `stop` to the host over `host` but leave the process running.
    ///
    /// Returns the event stream so the caller can hand it back to the host for
    /// the next session (see [`PatcherHost::restore_events`]).
    pub fn run_session(
        &self,
        events: Receiver<HostLine>,
        host: &Arc<Mutex<Option<PatcherHost>>>,
        stop_flag: &AtomicBool,
    ) -> (Result<(), InjectorError>, Receiver<HostLine>) {
        let result = self.event_loop(&events, host, stop_flag);
        (result, events)
    }

    /// Read and dispatch events from the host until the session is over.
    fn event_loop(
        &self,
        rx: &Receiver<HostLine>,
        control: &dyn SessionControl,
        stop_flag: &AtomicBool,
    ) -> Result<(), InjectorError> {
        let mut state = SessionState::default();

        loop {
            // Finalize the WAD-failure report once its collection window elapses,
            // then fall through to the normal stop path below. Checked at the top
            // so it still fires on recv timeouts.
            if let Some(failures) = state.take_ready_failures() {
                tracing::warn!(
                    "Integrity scan rejected {} archive(s); stopping patcher",
                    failures.len()
                );
                self.emit_event(InjectorEvent::WadScanFailed { failures });
                stop_flag.store(true, Ordering::SeqCst);
            }

            if state.take_expired_attach() {
                self.emit_event(InjectorEvent::GameAttached { pid: None });
            }

            if stop_flag.load(Ordering::SeqCst) {
                tracing::info!("Stop requested, sending stop to host");
                control.stop_session();
                return Ok(());
            }

            let line = match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(Ok(line)) => line,
                Ok(Err(e)) => {
                    tracing::warn!("Host stdout read error: {}", e);
                    if stop_flag.load(Ordering::SeqCst) {
                        return Ok(());
                    }
                    return Err(self
                        .unexpected_exit_error(state.last_error.or_else(|| Some(e.to_string()))));
                }
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => {
                    // Reader thread ended: the host closed stdout / hit EOF. If we
                    // didn't ask it to stop, the host died on its own - it crashed,
                    // antivirus blocked it, or (on the elevated path) the user
                    // dismissed the UAC prompt. Surface that instead of silently
                    // reporting a clean stop.
                    if stop_flag.load(Ordering::SeqCst) {
                        return Ok(());
                    }
                    return Err(self.unexpected_exit_error(state.last_error));
                }
            };

            if !line.trim().is_empty() {
                self.dispatch_line(&line, &mut state)?;
            }
        }
    }

    /// Handle one parsed host line: log it and fold it into `state`. Returns `Err`
    /// only on a fatal `status failed`, which ends the session.
    fn dispatch_line(&self, line: &str, state: &mut SessionState) -> Result<(), InjectorError> {
        match host::parse_event(line) {
            Some(HostEvent::Ok { message, .. }) => tracing::debug!("[ltk-host] ok: {}", message),
            Some(HostEvent::Status {
                timestamp,
                state: host_state,
                message,
            }) => self.handle_status(host_state, timestamp, message, state)?,
            Some(HostEvent::Error { message, .. }) => {
                // A protocol-level error (e.g. an unrecognized command) is not
                // necessarily fatal to an in-progress injection - the host reports
                // fatal failures via `status failed`. Keep it so the EOF branch can
                // surface it as the reason if the host then dies.
                tracing::warn!("[ltk-host] error: {}", message);
                state.last_error = Some(message);
            }
            Some(HostEvent::DllLog {
                timestamp,
                pid,
                tid,
                level,
                message,
            }) => {
                tracing::info!("[ltk-dll pid={} tid={} {}] {}", pid, tid, level, message);
                self.handle_dll_record(pid, &timestamp, &level, &message, state);
            }
            None => tracing::trace!("[ltk-host] unparsed: {}", line),
        }
        Ok(())
    }

    /// Log an injection-lifecycle transition and type the game's boundaries.
    /// Only `Failed` ends the session; a game `Exited` keeps the loop alive so
    /// the host re-scans for the next game.
    fn handle_status(
        &self,
        state: HostState,
        timestamp: String,
        message: String,
        session: &mut SessionState,
    ) -> Result<(), InjectorError> {
        match state {
            HostState::Injecting => {
                tracing::info!("[ltk-host] injecting: {}", message);
                match message.as_str() {
                    host_status::SCANNING_FOR_GAME => {
                        self.flush_attach(session);
                        self.emit_event(InjectorEvent::Scanning);
                    }
                    host_status::GAME_FOUND => self.emit_event(InjectorEvent::GameFound),
                    _ => self.emit_host_line(timestamp, message),
                }
            }
            HostState::Injected => {
                tracing::info!("[ltk-host] injected: {}", message);
                session.await_attach_pid();
            }
            HostState::Waiting => {
                tracing::info!("[ltk-host] waiting: {}", message);
                self.emit_host_line(timestamp, message);
            }
            HostState::Exited => {
                tracing::info!(
                    "[ltk-host] game exited: {}; awaiting next instance",
                    message
                );
                self.flush_attach(session);
                self.emit_event(InjectorEvent::GameExited);
            }
            HostState::Failed => {
                tracing::error!("[ltk-host] failed: {}", message);
                self.flush_attach(session);
                self.emit_host_line(timestamp, format!("failed: {message}"));
                return Err(InjectorError::Failed(message));
            }
        }
        Ok(())
    }

    /// Fold one DLL record into the session: the scan-failure batch, the pid
    /// an attach was waiting for, and the typed line it carries.
    fn handle_dll_record(
        &self,
        pid: u64,
        timestamp: &str,
        level: &str,
        message: &str,
        session: &mut SessionState,
    ) {
        session.record_wad_failure(message);
        if session.take_awaiting_attach() {
            self.emit_event(InjectorEvent::GameAttached { pid: Some(pid) });
        }

        let Some(line) = DllLine::parse(message) else {
            if level.eq_ignore_ascii_case("error") {
                self.emit_dll_line(timestamp, message);
            }
            return;
        };

        let event = match line {
            DllLine::ScanFailed(_) => return,
            DllLine::InitDone => InjectorEvent::Overlay {
                outcome: OverlayOutcome::Live,
                detail: None,
            },
            DllLine::JoinedTooLate => InjectorEvent::Overlay {
                outcome: OverlayOutcome::TooLate,
                detail: None,
            },
            DllLine::EndOfLife { build } => InjectorEvent::Overlay {
                outcome: OverlayOutcome::EndOfLife,
                detail: Some(build),
            },
            DllLine::OverlayDisabled { wad, why } => InjectorEvent::Overlay {
                outcome: OverlayOutcome::Disabled,
                detail: Some(format!("{wad}: {why}")),
            },
            DllLine::HookFailed { hook } => InjectorEvent::Overlay {
                outcome: OverlayOutcome::HookFailed,
                detail: Some(hook),
            },
            DllLine::Redirected { wad } => {
                self.emit_event(InjectorEvent::WadRedirected { wad });
                return;
            }
            DllLine::WadSkipped { wad, why } => InjectorEvent::WadSkipped { wad, why },
            DllLine::Launch(kind) => InjectorEvent::Launch(kind),
        };
        self.emit_event(event);
        self.emit_dll_line(timestamp, message);
    }

    /// Report an attach the DLL never put a pid to.
    fn flush_attach(&self, session: &mut SessionState) {
        if session.take_awaiting_attach() {
            self.emit_event(InjectorEvent::GameAttached { pid: None });
        }
    }

    fn emit_host_line(&self, at_host: String, text: String) {
        self.emit_event(InjectorEvent::Line {
            source: EvidenceSource::Host,
            at_host,
            text,
        });
    }

    fn emit_dll_line(&self, at_host: &str, message: &str) {
        self.emit_event(InjectorEvent::Line {
            source: EvidenceSource::Dll,
            at_host: at_host.to_string(),
            text: dll_lines::strip_target(message).to_string(),
        });
    }

    /// Build the error returned when the host process disappears without us
    /// asking it to stop. Tailors the hint to whether we elevated, since a
    /// dismissed UAC prompt is the most common cause on the elevated path.
    fn unexpected_exit_error(&self, last_error: Option<String>) -> InjectorError {
        let base = if self.elevate {
            "The injection host exited unexpectedly. If you dismissed the Windows User Account Control (UAC) prompt, the patcher cannot run elevated - accept the prompt next time, or turn off \"Run injector elevated\" in Settings if League is not running as administrator."
        } else {
            "The injection host exited unexpectedly. It may have crashed or been blocked by antivirus."
        };
        match last_error {
            Some(detail) if !detail.is_empty() => {
                InjectorError::Failed(format!("{base} (host reported: {detail})"))
            }
            _ => InjectorError::Failed(base.to_string()),
        }
    }
}

/// Mutable state carried across one session's event loop.
#[derive(Default)]
struct SessionState {
    /// Most recent host `error` line, surfaced as the failure reason if the host
    /// then dies.
    last_error: Option<String>,
    /// WAD-scan failures gathered during the load-scan burst. The DLL emits one
    /// line per rejected archive then aborts, so we collect over a short window
    /// and report them together. `reported` latches so we finalize exactly once.
    failures: Vec<WadScanFailure>,
    collect_deadline: Option<Instant>,
    reported: bool,
    /// Set at `status injected`, and cleared when a `dll` record names the pid,
    /// a later status line ends the wait, or the window runs out.
    attach_deadline: Option<Instant>,
}

impl SessionState {
    /// Fold a DLL log line into the failure set: parse it, de-duplicate by
    /// (wad, status), and arm the collection window on the first hit. Non-failure
    /// lines and anything after finalization are ignored.
    fn record_wad_failure(&mut self, message: &str) {
        if self.reported {
            return;
        }
        let Some(failure) = parse_wad_scan_failure(message) else {
            return;
        };
        let dup = self.failures.iter().any(|f| {
            f.status == failure.status
                && match (&f.wad, &failure.wad) {
                    (Some(a), Some(b)) => a.eq_ignore_ascii_case(b),
                    (None, None) => true,
                    _ => false,
                }
        });
        if !dup {
            self.failures.push(failure);
        }
        self.collect_deadline
            .get_or_insert_with(|| Instant::now() + WAD_FAILURE_COLLECT_WINDOW);
    }

    /// Once the collection window has elapsed, latch and hand back the gathered
    /// failures for reporting. Returns `Some` exactly once; `None` until ready.
    fn take_ready_failures(&mut self) -> Option<Vec<WadScanFailure>> {
        if self.reported || Instant::now() < self.collect_deadline? {
            return None;
        }
        self.reported = true;
        Some(std::mem::take(&mut self.failures))
    }

    fn await_attach_pid(&mut self) {
        self.attach_deadline = Some(Instant::now() + ATTACH_PID_WINDOW);
    }

    /// Whether an attach is waiting for its pid. Clears the wait.
    fn take_awaiting_attach(&mut self) -> bool {
        self.attach_deadline.take().is_some()
    }

    /// Whether an attach waited for its pid past the window. Clears the wait.
    fn take_expired_attach(&mut self) -> bool {
        match self.attach_deadline {
            Some(deadline) if Instant::now() >= deadline => {
                self.attach_deadline = None;
                true
            }
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::{Sender, channel};

    /// Records whether the loop asked the host to stop, standing in for the real
    /// `Arc<Mutex<Option<PatcherHost>>>`.
    #[derive(Default)]
    struct StubControl {
        stops: AtomicBool,
    }

    impl SessionControl for StubControl {
        fn stop_session(&self) {
            self.stops.store(true, Ordering::SeqCst);
        }
    }

    impl StubControl {
        fn was_stopped(&self) -> bool {
            self.stops.load(Ordering::SeqCst)
        }
    }

    /// Wire-format helpers. The loop only sees lines, so getting these exactly
    /// right is the difference between testing the loop and testing nothing: an
    /// unparseable line is silently ignored, and the loop keeps waiting.
    fn dll_line(level: &str, message: &str) -> String {
        format!("dll 1.0000000 1234 5678 {level} {message}")
    }

    fn wad_failure_line(wad: &str) -> String {
        dll_line(
            "error",
            &format!("error: WAD scan failed status with c0000229 for {wad}"),
        )
    }

    struct Harness {
        injector: Injector,
        control: StubControl,
        stop_flag: Arc<AtomicBool>,
        tx: Option<Sender<HostLine>>,
        rx: Receiver<HostLine>,
        events: Arc<Mutex<Vec<InjectorEvent>>>,
    }

    impl Harness {
        fn new(elevate: bool) -> Self {
            let events = Arc::new(Mutex::new(Vec::new()));
            let sink = Arc::clone(&events);
            let injector = Injector::new()
                .with_elevate(elevate)
                .on_event(move |e| sink.lock().unwrap().push(e));
            let (tx, rx) = channel();
            Self {
                injector,
                control: StubControl::default(),
                stop_flag: Arc::new(AtomicBool::new(false)),
                tx: Some(tx),
                rx,
                events,
            }
        }

        fn send(&self, line: &str) {
            self.tx
                .as_ref()
                .expect("sender still open")
                .send(Ok(line.to_string()))
                .unwrap();
        }

        /// Drop the sender so the loop observes a disconnected channel, which is
        /// how a host death (crash, antivirus, dismissed UAC) reaches the loop.
        fn close(&mut self) {
            self.tx = None;
        }

        /// Runs the loop behind a watchdog that trips the stop flag if the loop
        /// outlives any legitimate case. Without it, a test that feeds a line the
        /// parser rejects hangs the whole suite instead of failing.
        fn run(&self) -> Result<(), InjectorError> {
            let watchdog_flag = Arc::clone(&self.stop_flag);
            let watchdog = std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(10));
                watchdog_flag.store(true, Ordering::SeqCst);
            });
            let result = self
                .injector
                .event_loop(&self.rx, &self.control, &self.stop_flag);
            drop(watchdog);
            result
        }

        fn emitted(&self) -> Vec<InjectorEvent> {
            self.events.lock().unwrap().clone()
        }

        /// The scan-failure batches among the emitted events.
        fn scan_failures(&self) -> Vec<Vec<WadScanFailure>> {
            self.emitted()
                .into_iter()
                .filter_map(|e| match e {
                    InjectorEvent::WadScanFailed { failures } => Some(failures),
                    _ => None,
                })
                .collect()
        }

        /// The emitted events with the timeline lines filtered out, which is the
        /// sequence a recorder's state machine runs on.
        fn typed(&self) -> Vec<InjectorEvent> {
            self.emitted()
                .into_iter()
                .filter(|e| !matches!(e, InjectorEvent::Line { .. }))
                .collect()
        }
    }

    #[test]
    fn stop_flag_ends_session_cleanly_and_stops_host() {
        let harness = Harness::new(false);
        harness.stop_flag.store(true, Ordering::SeqCst);

        assert!(harness.run().is_ok());
        assert!(
            harness.control.was_stopped(),
            "a requested stop must be forwarded to the host"
        );
    }

    #[test]
    fn host_death_without_stop_request_is_an_error() {
        let mut harness = Harness::new(false);
        harness.close();

        let err = harness.run().expect_err("EOF without stop must error");
        let msg = err.to_string();
        assert!(msg.contains("exited unexpectedly"), "got: {msg}");
        assert!(
            msg.contains("antivirus"),
            "non-elevated path should suggest antivirus, got: {msg}"
        );
    }

    /// A dismissed UAC prompt looks identical to a crash at the channel level, so
    /// the elevated path has to explain itself differently.
    #[test]
    fn host_death_on_elevated_path_mentions_uac() {
        let mut harness = Harness::new(true);
        harness.close();

        let msg = harness.run().expect_err("EOF must error").to_string();
        assert!(msg.contains("User Account Control"), "got: {msg}");
    }

    #[test]
    fn host_death_after_stop_request_is_clean() {
        let mut harness = Harness::new(false);
        harness.stop_flag.store(true, Ordering::SeqCst);
        harness.close();

        assert!(harness.run().is_ok());
    }

    /// A prior `error:` line becomes the reported reason when the host then dies,
    /// rather than being lost behind the generic message.
    #[test]
    fn last_host_error_is_surfaced_on_death() {
        let mut harness = Harness::new(false);
        harness.send("error 1.0000000 could not open process");
        harness.close();

        let msg = harness.run().expect_err("EOF must error").to_string();
        assert!(msg.contains("could not open process"), "got: {msg}");
    }

    #[test]
    fn status_failed_ends_the_session_with_its_message() {
        let harness = Harness::new(false);
        harness.send("status 1.0000000 failed injection rejected");

        let err = harness.run().expect_err("status failed must error");
        assert!(
            matches!(&err, InjectorError::Failed(m) if m.contains("injection rejected")),
            "got: {err}"
        );
    }

    /// A game exit is not a session end - the host re-scans for the next launch,
    /// so the loop must keep running.
    #[test]
    fn game_exit_does_not_end_the_session() {
        let mut harness = Harness::new(false);
        harness.send("status 1.0000000 exited game closed");
        harness.close();

        // Only the disconnect ends it, and since no stop was requested that is an
        // error - proving the loop survived the `exited` line.
        assert!(harness.run().is_err());
    }

    /// The DLL emits one line per rejected archive then aborts. They must be
    /// batched into a single event and auto-stop the session.
    #[test]
    fn wad_scan_failures_are_batched_and_auto_stop() {
        let harness = Harness::new(false);
        harness.send(&wad_failure_line("Ahri.wad.client"));
        harness.send(&wad_failure_line("Ashe.wad.client"));

        assert!(harness.run().is_ok(), "auto-stop is a clean end");

        let batches = harness.scan_failures();
        assert_eq!(batches.len(), 1, "failures must arrive as one batch");
        let wads: Vec<_> = batches[0].iter().filter_map(|f| f.wad.as_deref()).collect();
        assert!(wads.contains(&"Ahri.wad.client"), "got: {wads:?}");
        assert!(wads.contains(&"Ashe.wad.client"), "got: {wads:?}");
        assert!(
            harness.control.was_stopped(),
            "a failed scan must stop the host"
        );
    }

    #[test]
    fn duplicate_wad_failures_are_deduplicated() {
        let harness = Harness::new(false);
        for _ in 0..3 {
            harness.send(&wad_failure_line("Ahri.wad.client"));
        }

        assert!(harness.run().is_ok());

        let batches = harness.scan_failures();
        assert_eq!(batches[0].len(), 1, "same (wad, status) reported once");
    }

    #[test]
    fn clean_session_emits_no_events() {
        let harness = Harness::new(false);
        harness.send("ok 1.0000000 configured");
        harness.send("status 1.0000000 injected into pid 1234");
        harness.stop_flag.store(true, Ordering::SeqCst);

        assert!(harness.run().is_ok());
        assert!(harness.emitted().is_empty());
    }

    #[test]
    fn game_boundaries_are_typed_events() {
        let mut harness = Harness::new(false);
        harness.send("status 0.1000000 injecting scanning for game");
        harness.send("status 1.0000000 injecting game found");
        harness.send("status 9.0000000 exited dll detached");
        harness.send("status 9.1000000 injecting scanning for game");
        harness.close();

        let _ = harness.run();

        assert_eq!(
            harness.typed(),
            [
                InjectorEvent::Scanning,
                InjectorEvent::GameFound,
                InjectorEvent::GameExited,
                InjectorEvent::Scanning,
            ]
        );
    }

    /// The status line carries no pid, so the attach waits for the first `dll`
    /// record, which carries it on every line.
    #[test]
    fn attach_takes_its_pid_from_the_first_dll_record() {
        let mut harness = Harness::new(false);
        harness.send("status 1.0000000 injecting game found");
        harness.send("status 2.0000000 injected dll attached");
        harness.send("status 2.0000001 waiting game exit");
        harness.send("dll 2.1000000 4321 1 INFO ltk_patcher_dll::entry: init in process");
        harness.send("dll 2.2000000 4321 1 INFO ltk_patcher_dll::entry: init done");
        harness.close();

        let _ = harness.run();

        assert_eq!(
            harness.typed(),
            [
                InjectorEvent::GameFound,
                InjectorEvent::GameAttached { pid: Some(4321) },
                InjectorEvent::Overlay {
                    outcome: OverlayOutcome::Live,
                    detail: None,
                },
            ]
        );
    }

    #[test]
    fn attach_without_a_dll_record_reports_no_pid_before_the_exit() {
        let mut harness = Harness::new(false);
        harness.send("status 2.0000000 injected dll attached");
        harness.send("status 9.0000000 exited dll detached");
        harness.close();

        let _ = harness.run();

        assert_eq!(
            harness.typed(),
            [
                InjectorEvent::GameAttached { pid: None },
                InjectorEvent::GameExited,
            ]
        );
    }

    #[test]
    fn attach_without_a_dll_record_reports_no_pid_once_the_window_runs_out() {
        let harness = Harness::new(false);
        harness.send("status 2.0000000 injected dll attached");
        let stop_flag = Arc::clone(&harness.stop_flag);
        std::thread::spawn(move || {
            std::thread::sleep(ATTACH_PID_WINDOW + Duration::from_millis(400));
            stop_flag.store(true, Ordering::SeqCst);
        });

        assert!(harness.run().is_ok());

        assert_eq!(harness.typed(), [InjectorEvent::GameAttached { pid: None }]);
    }

    #[test]
    fn dll_init_lines_set_the_overlay_outcome() {
        let cases = [
            (
                "ltk_patcher_dll::entry: joined too late, not overlaying",
                OverlayOutcome::TooLate,
                None,
            ),
            (
                "ltk_patcher_dll::entry: end of life reached, please update: 0x68a1b2c3",
                OverlayOutcome::EndOfLife,
                Some("0x68a1b2c3"),
            ),
            (
                "ltk_patcher_dll::entry: failed to install overlay hook",
                OverlayOutcome::HookFailed,
                Some("overlay"),
            ),
            (
                "ltk_patcher_dll::verify: overlay verification failed, disabling overlay: wad data/final/champions/briar.wad.client: mount modded wad: bad magic",
                OverlayOutcome::Disabled,
                Some("briar.wad.client: mount modded wad: bad magic"),
            ),
        ];
        for (message, outcome, detail) in cases {
            let mut harness = Harness::new(false);
            harness.send(&dll_line("ERROR", message));
            harness.close();

            let _ = harness.run();

            assert_eq!(
                harness.typed(),
                [InjectorEvent::Overlay {
                    outcome,
                    detail: detail.map(str::to_string),
                }],
                "for {message}"
            );
        }
    }

    #[test]
    fn redirects_skips_and_launches_are_typed() {
        let mut harness = Harness::new(false);
        harness.send(&dll_line(
            "INFO",
            "ltk_patcher_dll::verify: replay (.rofl) launch; anti-hack scan will not block",
        ));
        harness.send(&dll_line(
            "INFO",
            "ltk_patcher_dll::hooks::fsov::imp_windows_iat: redirected wad: DATA/FINAL/Champions/Aatrox.wad.client",
        ));
        harness.send(&dll_line(
            "ERROR",
            "ltk_patcher_dll::verify: lazy verification failed, not overlaying: wad DATA/FINAL/Champions/Ahri.wad.client: open modded file: not found",
        ));
        harness.close();

        let _ = harness.run();

        assert_eq!(
            harness.typed(),
            [
                InjectorEvent::Launch(LaunchKind::Replay),
                InjectorEvent::WadRedirected {
                    wad: "Aatrox.wad.client".to_string()
                },
                InjectorEvent::WadSkipped {
                    wad: "Ahri.wad.client".to_string(),
                    why: "open modded file: not found".to_string(),
                },
            ]
        );
    }

    /// The status lines with no typed event, and the DLL's notable records, go
    /// to the timeline. A redirect does not: it is typed, and there are many.
    #[test]
    fn timeline_lines_carry_the_host_clock_and_the_text_after_the_target() {
        let mut harness = Harness::new(false);
        harness.send("status 2.5000000 waiting game exit");
        harness.send(&dll_line(
            "INFO",
            "ltk_patcher_dll::hooks::fsov::imp_windows_iat: redirected wad: DATA/FINAL/Champions/Aatrox.wad.client",
        ));
        harness.send(&dll_line(
            "ERROR",
            "ltk_patcher_dll::verify: AH init failed:00",
        ));
        harness.send(&dll_line(
            "INFO",
            "ltk_patcher_dll::verify: overlay verified 4 wad(s)",
        ));
        harness.send(&dll_line("INFO", "ltk_patcher_dll::entry: init done"));
        harness.close();

        let _ = harness.run();

        let lines: Vec<_> = harness
            .emitted()
            .into_iter()
            .filter(|e| matches!(e, InjectorEvent::Line { .. }))
            .collect();
        assert_eq!(
            lines,
            [
                InjectorEvent::Line {
                    source: EvidenceSource::Host,
                    at_host: "2.5000000".to_string(),
                    text: "game exit".to_string(),
                },
                InjectorEvent::Line {
                    source: EvidenceSource::Dll,
                    at_host: "1.0000000".to_string(),
                    text: "AH init failed:00".to_string(),
                },
                InjectorEvent::Line {
                    source: EvidenceSource::Dll,
                    at_host: "1.0000000".to_string(),
                    text: "init done".to_string(),
                },
            ]
        );
    }
}
