//! External-process injector via the host line protocol.
//!
//! We communicate with the host process over its stdin/stdout line protocol.
//! The host owns all injection logic (window scanning, `SetWindowsHookEx`, DLL
//! pipe) and reports structured lifecycle events back to us.

use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use super::host::{self, HostConfig, HostError, HostEvent, HostProcess, HostState, HOST_EXE_NAME};

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
#[derive(Debug, Clone)]
pub enum InjectorEvent {
    /// One or more archives failed the injected DLL's integrity scan, so no mods
    /// were applied this session. The DLL aborts on the first failure, so we
    /// auto-stop the patcher and surface the failures instead of silently doing
    /// nothing.
    WadScanFailed { failures: Vec<WadScanFailure> },
}

/// A single archive that failed the injected DLL's integrity scan.
#[derive(Debug, Clone)]
pub struct WadScanFailure {
    /// The archive (e.g. `TahmKench.wad.client`), if we could parse the name.
    pub wad: Option<String>,
    /// The NTSTATUS-style code the scan reported (e.g. `c0000229` skinhack,
    /// `c000003e` parse error). Callers classify it; the injector stays
    /// status-agnostic.
    pub status: String,
}

type EventCallback = Box<dyn Fn(InjectorEvent) + Send>;

/// How long to keep gathering "WAD scan failed" lines after the first before
/// reporting them together. They arrive as a burst during the game's load scan,
/// so a short window captures every offending archive.
const WAD_FAILURE_COLLECT_WINDOW: Duration = Duration::from_millis(750);

/// Spawns and supervises the injection host process.
pub struct Injector {
    exe_path: PathBuf,
    elevate: bool,
    on_event: Option<EventCallback>,
}

impl Injector {
    pub fn new(exe_path: PathBuf) -> Self {
        Self {
            exe_path,
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

    /// Run the host-based injector, blocking until the patching session ends
    /// or `stop_flag` is set.
    ///
    /// Sends configuration commands, starts a scan session, then reads event
    /// lines from the host until the game exits or we're told to stop.
    pub fn run(
        &self,
        overlay_dir: &str,
        stop_flag: &AtomicBool,
        config: &HostConfig,
    ) -> Result<(), InjectorError> {
        let mut proc = HostProcess::spawn(&self.exe_path, self.elevate)?;

        // Forward stderr on a background thread for startup diagnostics.
        let stderr_handle = proc.take_stderr().map(forward_stderr);

        // Take the event reader before sending commands so we don't miss events.
        let reader = proc.take_event_reader();

        // Phase 1: Send configuration.
        if let Err(e) = proc.configure(config) {
            tracing::error!("Failed to configure host: {}", e);
            proc.kill();
            join_handle(stderr_handle);
            return Err(e.into());
        }

        // Phase 2: Start scanning.
        if let Err(e) = proc.start_scan() {
            tracing::error!("Failed to start host scan: {}", e);
            proc.kill();
            join_handle(stderr_handle);
            return Err(e.into());
        }

        tracing::info!("Host started, scanning for game (prefix: {})", overlay_dir);

        // Phase 3: Read events until the session ends.
        let result = if let Some(reader) = reader {
            self.event_loop(reader, &mut proc, stop_flag)
        } else {
            tracing::error!("Host stdout not available");
            Err(InjectorError::Host(HostError::StdoutClosed))
        };

        // Cleanup: signal the host to exit and wait for it (with a kill
        // fallback) before joining the stderr forwarder. Joining stderr first
        // would deadlock if the host only exits once its stdin is closed, since
        // stderr won't reach EOF until the host process is gone.
        proc.shutdown();
        join_handle(stderr_handle);

        result
    }

    /// Read and dispatch events from the host until the session is over.
    fn event_loop(
        &self,
        reader: BufReader<std::process::ChildStdout>,
        proc: &mut HostProcess,
        stop_flag: &AtomicBool,
    ) -> Result<(), InjectorError> {
        // `reader.lines()` blocks until a full line arrives or EOF. While the
        // host is silently scanning for the game it emits nothing, so checking
        // the stop flag inline would never fire (the read is parked). Funnel the
        // blocking reads through a channel and poll it with a timeout so the
        // stop flag is honored within the poll interval regardless of host
        // chatter. The reader thread self-terminates on EOF (once the host
        // closes stdout during shutdown) or when the receiver is dropped.
        let (tx, rx) = mpsc::channel::<std::io::Result<String>>();
        thread::spawn(move || {
            for line_result in reader.lines() {
                let is_err = line_result.is_err();
                if tx.send(line_result).is_err() || is_err {
                    break;
                }
            }
        });

        // Tracks the most recent host-reported error so that, if the host then
        // dies, we can surface it to the UI as the failure reason.
        let mut last_error: Option<String> = None;

        // The DLL emits one "WAD scan failed" line per rejected archive, in a
        // burst during the game's load scan, then aborts injection. Accumulate
        // them over a short window so we report every failure together, then
        // auto-stop. `failure_reported` flips once we've finalized so we don't
        // re-fire or fight the shutdown we just initiated.
        let mut failures: Vec<WadScanFailure> = Vec::new();
        let mut collect_deadline: Option<Instant> = None;
        let mut failure_reported = false;

        loop {
            // Finalize the failure report once the collection window elapses.
            // Done at the top of the loop so it runs even on recv timeouts.
            if !failure_reported {
                if let Some(deadline) = collect_deadline {
                    if Instant::now() >= deadline {
                        failure_reported = true;
                        tracing::warn!(
                            "Integrity scan rejected {} archive(s); stopping patcher",
                            failures.len()
                        );
                        self.emit_event(InjectorEvent::WadScanFailed {
                            failures: std::mem::take(&mut failures),
                        });
                        // Reuse the existing stop path: the check below sends
                        // `stop` to the host and returns Ok.
                        stop_flag.store(true, Ordering::SeqCst);
                    }
                }
            }

            if stop_flag.load(Ordering::SeqCst) {
                tracing::info!("Stop requested, sending stop to host");
                let _ = proc.stop_session();
                return Ok(());
            }

            let line = match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(Ok(line)) => line,
                Ok(Err(e)) => {
                    tracing::warn!("Host stdout read error: {}", e);
                    if stop_flag.load(Ordering::SeqCst) {
                        return Ok(());
                    }
                    return Err(
                        self.unexpected_exit_error(last_error.or_else(|| Some(e.to_string())))
                    );
                }
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => {
                    // Reader thread ended: the host closed stdout / hit EOF. If we
                    // didn't ask it to stop, the host died on its own — it crashed,
                    // antivirus blocked it, or (on the elevated path) the user
                    // dismissed the UAC prompt. Surface that instead of silently
                    // reporting a clean stop.
                    if stop_flag.load(Ordering::SeqCst) {
                        return Ok(());
                    }
                    return Err(self.unexpected_exit_error(last_error));
                }
            };

            if line.trim().is_empty() {
                continue;
            }

            match host::parse_event(&line) {
                Some(HostEvent::Ok { message, .. }) => {
                    tracing::debug!("[cslol-host] ok: {}", message);
                }
                Some(HostEvent::Status { state, message, .. }) => {
                    match state {
                        HostState::Injecting => {
                            tracing::info!("[cslol-host] injecting: {}", message);
                        }
                        HostState::Injected => {
                            tracing::info!("[cslol-host] injected: {}", message);
                        }
                        HostState::Waiting => {
                            tracing::info!("[cslol-host] waiting: {}", message);
                        }
                        HostState::Exited => {
                            tracing::info!("[cslol-host] game exited: {}", message);
                            // Game closed — the host will re-scan automatically
                            // for the next game instance. Keep the event loop
                            // running so injection persists across games until
                            // the user explicitly stops the patcher.
                            tracing::info!("[cslol-host] waiting for next game instance...");
                        }
                        HostState::Failed => {
                            tracing::error!("[cslol-host] failed: {}", message);
                            return Err(InjectorError::Failed(message));
                        }
                    }
                }
                Some(HostEvent::Error { message, .. }) => {
                    // A protocol-level error (e.g. an unrecognized command) is not
                    // necessarily fatal to an in-progress injection — the host
                    // reports fatal injection failures via `status ... failed`. Log
                    // it and keep going; if the host then dies, the EOF branch above
                    // surfaces this message as the failure reason.
                    tracing::warn!("[cslol-host] error: {}", message);
                    last_error = Some(message);
                }
                Some(HostEvent::DllLog {
                    pid, tid, message, ..
                }) => {
                    tracing::info!("[cslol-dll pid={} tid={}] {}", pid, tid, message);

                    // A fatal scan rejection (skinhack hit, parse error, or out
                    // of memory) aborts the whole session — no mods are applied.
                    // Collect every failure in the burst; the loop above finalizes
                    // once it settles. The frontend classifies the status code.
                    // (Missing linked bins no longer reach here — pre-flighted.)
                    if !failure_reported {
                        if let Some((wad, status)) = parse_wad_scan_failure(&message) {
                            let dup = failures.iter().any(|f| {
                                f.status == status
                                    && match (&f.wad, &wad) {
                                        (Some(a), Some(b)) => a.eq_ignore_ascii_case(b),
                                        (None, None) => true,
                                        _ => false,
                                    }
                            });
                            if !dup {
                                failures.push(WadScanFailure { wad, status });
                            }
                            collect_deadline
                                .get_or_insert_with(|| Instant::now() + WAD_FAILURE_COLLECT_WINDOW);
                        }
                    }
                }
                None => {
                    tracing::trace!("[cslol-host] unparsed: {}", line);
                }
            }
        }
    }

    /// Build the error returned when the host process disappears without us
    /// asking it to stop. Tailors the hint to whether we elevated, since a
    /// dismissed UAC prompt is the most common cause on the elevated path.
    fn unexpected_exit_error(&self, last_error: Option<String>) -> InjectorError {
        let base = if self.elevate {
            "The injection host exited unexpectedly. If you dismissed the Windows User Account Control (UAC) prompt, the patcher cannot run elevated — accept the prompt next time, or turn off \"Run injector elevated\" in Settings if League is not running as administrator."
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

/// Forward the host's stderr on a background thread.
fn forward_stderr<R: Read + Send + 'static>(stream: R) -> JoinHandle<()> {
    thread::spawn(move || {
        for line in BufReader::new(stream).lines() {
            match line {
                Ok(text) if !text.trim().is_empty() => {
                    tracing::warn!("[cslol-host stderr] {}", text);
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
    })
}

fn join_handle(handle: Option<JoinHandle<()>>) {
    if let Some(h) = handle {
        let _ = h.join();
    }
}

/// Detect the injected DLL's "WAD scan failed" diagnostic and pull out the
/// status code and offending archive name.
///
/// Observed format:
/// `error: WAD scan failed status with c0000229 for Ahri.wad.client`
///
/// When the anti-skinhack scan is opted out (`OPT_OUT_AH_V1`), the DLL emits
/// the same text at `warn:` level and proceeds with injection — that line is
/// informational, not a failure, so it must not trigger the abort/dialog path.
///
/// A scan can fail with several status codes; this only parses the line — the
/// frontend classifies the status into a failure kind.
///
/// Returns `(wad, status)` when the message is a WAD-scan failure, where `wad`
/// is the archive name when present and `status` falls back to `"unknown"` if
/// the code can't be parsed out.
fn parse_wad_scan_failure(message: &str) -> Option<(Option<String>, String)> {
    if !message.contains("WAD scan failed") {
        return None;
    }
    if message.trim_start().starts_with("warn:") {
        return None;
    }

    let status = message
        .split_once("status with ")
        .map(|(_, rest)| first_token(rest))
        .filter(|s| !s.is_empty())
        .unwrap_or("unknown")
        .to_string();

    let wad = message
        .rsplit_once(" for ")
        .map(|(_, rest)| rest.trim())
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    Some((wad, status))
}

/// First whitespace-delimited token of `s` (empty string if none).
fn first_token(s: &str) -> &str {
    s.split_whitespace().next().unwrap_or("")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_wad_scan_failure_with_wad_and_status() {
        let msg = "error: WAD scan failed status with c0000229 for Ahri.wad.client";
        let (wad, status) = parse_wad_scan_failure(msg).expect("should detect failure");
        assert_eq!(wad.as_deref(), Some("Ahri.wad.client"));
        assert_eq!(status, "c0000229");
    }

    #[test]
    fn ignores_warn_level_scan_line_from_opt_out() {
        // With OPT_OUT_AH_V1 set, the DLL logs the same text at warn level and
        // keeps injecting — it must not be reported as a fatal scan failure.
        assert!(parse_wad_scan_failure(
            "warn: WAD scan failed status with c0000229 for Ahri.wad.client"
        )
        .is_none());
    }

    #[test]
    fn ignores_scanning_info_line() {
        assert!(parse_wad_scan_failure("info: Scanning champion Ahri.wad.client").is_none());
    }

    #[test]
    fn ignores_wad_log_hash_dump() {
        assert!(
            parse_wad_scan_failure("error: AH WAD Log:  9fed2719bffb7d50 51df2d746a6b6791")
                .is_none()
        );
    }

    #[test]
    fn falls_back_when_status_and_wad_missing() {
        let (wad, status) = parse_wad_scan_failure("error: WAD scan failed").expect("detected");
        assert_eq!(wad, None);
        assert_eq!(status, "unknown");
    }

    #[test]
    fn falls_back_to_unknown_status_but_keeps_wad() {
        let (wad, status) =
            parse_wad_scan_failure("error: WAD scan failed for Kayn.wad.client").expect("detected");
        assert_eq!(wad.as_deref(), Some("Kayn.wad.client"));
        assert_eq!(status, "unknown");
    }

    #[test]
    fn parses_arbitrary_status_code() {
        // The parser stays status-agnostic — any hex code parses the same way and
        // the frontend classifies it. c0000225 is no longer emitted at runtime
        // (linked bins are validated pre-flight); kept here to prove that.
        let (wad, status) = parse_wad_scan_failure(
            "error: WAD scan failed status with c0000225 for TahmKench.wad.client",
        )
        .expect("parseable scan failure");
        assert_eq!(wad.as_deref(), Some("TahmKench.wad.client"));
        assert_eq!(status, "c0000225");
    }
}
