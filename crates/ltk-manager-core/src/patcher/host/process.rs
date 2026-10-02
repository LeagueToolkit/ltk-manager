//! Spawning and driving a single injection-host child process.

use std::io::{BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use super::protocol::{HostConfig, command};
use crate::platform::hide_console;

#[derive(Debug, thiserror::Error)]
pub enum HostError {
    #[error("Failed to spawn host '{path}': {source}")]
    Spawn {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("Host stdin closed unexpectedly")]
    StdinClosed,
    #[error("Host stdout closed unexpectedly")]
    StdoutClosed,
    #[error("Host reported error: {0}")]
    Protocol(String),
}

/// Manages a running host child process.
pub struct HostProcess {
    child: Child,
    exe_path: PathBuf,
}

impl HostProcess {
    /// Spawn the host process. If `elevate` is true, passes `--elevate` which
    /// triggers a UAC prompt and runs the host at high integrity.
    pub fn spawn(exe_path: &Path, elevate: bool) -> Result<Self, HostError> {
        let mut command = Command::new(exe_path);

        if elevate {
            command.arg("--elevate");
        }

        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(dir) = exe_path.parent() {
            command.current_dir(dir);
        }

        hide_console(&mut command);

        tracing::info!(
            "Spawning host: {} {}",
            exe_path.display(),
            if elevate { "--elevate" } else { "" }
        );

        let child = command.spawn().map_err(|source| HostError::Spawn {
            path: exe_path.display().to_string(),
            source,
        })?;

        Ok(Self {
            child,
            exe_path: exe_path.to_path_buf(),
        })
    }

    /// Send a raw command line to the host's stdin.
    pub fn send_command(&mut self, cmd: &str) -> Result<(), HostError> {
        let stdin = self.child.stdin.as_mut().ok_or(HostError::StdinClosed)?;
        write_line(stdin, cmd)
    }

    /// Send all config commands derived from a `HostConfig`.
    pub fn configure(&mut self, config: &HostConfig) -> Result<(), HostError> {
        for line in command::configure(config) {
            self.send_command(&line)?;
        }
        Ok(())
    }

    /// Send `start scan` to begin host-driven injection.
    pub fn start_scan(&mut self) -> Result<(), HostError> {
        self.send_command(&command::start_scan())
    }

    /// Send `start passive` for modding-framework integration.
    #[allow(dead_code)]
    pub fn start_passive(&mut self) -> Result<(), HostError> {
        self.send_command(&command::start_passive())
    }

    /// Send `stop` to tear down the current injection session.
    pub fn stop_session(&mut self) -> Result<(), HostError> {
        self.send_command(command::STOP)
    }

    /// Take stdout and wrap it in a buffered line reader for event parsing.
    /// This consumes the stdout handle - call once.
    pub fn take_event_reader(&mut self) -> Option<BufReader<std::process::ChildStdout>> {
        self.child.stdout.take().map(BufReader::new)
    }

    /// Take stderr for forwarding diagnostics.
    pub fn take_stderr(&mut self) -> Option<std::process::ChildStderr> {
        self.child.stderr.take()
    }

    /// Whether the child process is still running (has not exited).
    pub fn is_alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    /// Grace period to wait for the host to exit on its own before force-killing.
    const SHUTDOWN_GRACE: Duration = Duration::from_secs(5);

    /// Close stdin (signals the host to shut down) and wait for the child,
    /// force-killing it if it doesn't exit within the grace period.
    ///
    /// Closing stdin alone is not a guaranteed exit signal - if the host is
    /// parked scanning for the game and ignores the `stop`/EOF, an unbounded
    /// `wait()` here would hang the patcher thread forever and leave the UI
    /// stuck "running". The grace-then-kill keeps shutdown bounded.
    pub fn shutdown(&mut self) {
        drop(self.child.stdin.take());

        let deadline = Instant::now() + Self::SHUTDOWN_GRACE;
        loop {
            match self.child.try_wait() {
                Ok(Some(status)) => {
                    tracing::info!("Host {} exited with {}", self.exe_path.display(), status);
                    return;
                }
                Ok(None) => {
                    if Instant::now() >= deadline {
                        tracing::warn!(
                            "Host {} did not exit within {:?}; killing",
                            self.exe_path.display(),
                            Self::SHUTDOWN_GRACE
                        );
                        self.kill();
                        return;
                    }
                    thread::sleep(Duration::from_millis(50));
                }
                Err(e) => {
                    tracing::warn!("Failed to wait for host process: {}", e);
                    return;
                }
            }
        }
    }

    /// Kill the host process immediately.
    pub fn kill(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Write one command line to a host's stdin.
///
/// Split out from [`HostProcess::send_command`] so the framing is testable
/// without a child process: the host reads line-at-a-time, so an extra newline
/// makes it see a blank command and a missing flush leaves it waiting for input
/// that is sitting in our buffer.
fn write_line<W: Write>(sink: &mut W, line: &str) -> Result<(), HostError> {
    tracing::debug!("[ltk-host] >> {}", line);
    writeln!(sink, "{}", line).map_err(|_| HostError::StdinClosed)?;
    sink.flush().map_err(|_| HostError::StdinClosed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::patcher::host::HostLogLevel;
    use assert_matches::assert_matches;
    use std::io;

    /// A sink that fails on exactly one of write/flush, to prove both paths map
    /// to `StdinClosed`.
    struct FailingSink {
        fail_flush: bool,
    }

    impl Write for FailingSink {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            if self.fail_flush {
                Ok(buf.len())
            } else {
                Err(io::Error::new(io::ErrorKind::BrokenPipe, "stdin closed"))
            }
        }

        fn flush(&mut self) -> io::Result<()> {
            if self.fail_flush {
                Err(io::Error::new(io::ErrorKind::BrokenPipe, "stdin closed"))
            } else {
                Ok(())
            }
        }
    }

    #[test]
    fn write_line_terminates_with_exactly_one_newline() {
        let mut sink = Vec::new();
        write_line(&mut sink, "start scan").unwrap();
        assert_eq!(String::from_utf8(sink).unwrap(), "start scan\n");
    }

    #[test]
    fn write_line_does_not_separate_commands_with_blank_lines() {
        let mut sink = Vec::new();
        for line in command::configure(&HostConfig {
            prefix: "overlay\\".to_string(),
            log_level: HostLogLevel::Info,
            flags: 0,
        }) {
            write_line(&mut sink, &line).unwrap();
        }
        assert_eq!(
            String::from_utf8(sink).unwrap(),
            "config loglevel 16\nconfig flags 0\nconfig prefix overlay\\\n"
        );
    }

    #[test]
    fn write_line_reports_a_dead_pipe_as_stdin_closed() {
        let mut sink = FailingSink { fail_flush: false };
        assert_matches!(write_line(&mut sink, "stop"), Err(HostError::StdinClosed));
    }

    /// A write that lands in the buffer but never reaches the host is still a
    /// dead pipe - the failure must not be swallowed by the `writeln!` success.
    #[test]
    fn write_line_reports_a_failed_flush_as_stdin_closed() {
        let mut sink = FailingSink { fail_flush: true };
        assert_matches!(write_line(&mut sink, "stop"), Err(HostError::StdinClosed));
    }

    #[test]
    fn spawn_reports_a_missing_host_binary_with_the_path_it_tried() {
        let missing = std::env::temp_dir().join("ltk-manager-no-such-host.exe");
        let Err(error) = HostProcess::spawn(&missing, false) else {
            panic!("spawning a missing binary should fail");
        };
        assert_matches!(error, HostError::Spawn { path, .. } => {
            assert!(path.contains("ltk-manager-no-such-host"), "path was {path}");
        });
    }
}
