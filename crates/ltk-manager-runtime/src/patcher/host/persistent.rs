//! The long-lived injection host, kept alive across patching sessions.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::thread::{self, JoinHandle};

use super::process::{HostError, HostProcess};
use super::protocol::HostConfig;

/// A line forwarded from the host's stdout: `Ok(line)` for a full line, `Err`
/// for a read error or (implicitly, via channel disconnect) EOF.
pub type HostLine = std::io::Result<String>;

/// A long-lived injection host, kept alive across patching sessions.
///
/// Spawned once, lazily, on the first patcher start, and driven with
/// `start`/`stop` commands. A single reader thread owns the host's stdout for
/// its whole life and funnels every line onto [`Self::take_events`]'s channel;
/// each session borrows that receiver for the duration of its event loop and
/// hands it back via [`Self::restore_events`].
pub struct PatcherHost {
    proc: HostProcess,
    events: EventStream,
    reader_handle: Option<JoinHandle<()>>,
    stderr_handle: Option<JoinHandle<()>>,
    /// The executable that the host was spawned from. A session for another
    /// executable forces a respawn.
    exe: PathBuf,
}

impl PatcherHost {
    /// Spawn the host and start its persistent stdout reader thread.
    pub fn spawn(exe_path: &Path) -> Result<Self, HostError> {
        let mut proc = HostProcess::spawn(exe_path)?;
        let stderr_handle = proc.take_stderr().map(forward_stderr);
        let reader = match proc.take_event_reader() {
            Some(reader) => reader,
            None => {
                // Piped stdout should always be present; if not, don't leak the child.
                proc.kill();
                return Err(HostError::StdoutClosed);
            }
        };

        let (tx, rx) = mpsc::channel::<HostLine>();
        let reader_handle = thread::spawn(move || forward_lines(reader, tx));

        Ok(Self {
            proc,
            events: EventStream(Some(rx)),
            reader_handle: Some(reader_handle),
            stderr_handle,
            exe: exe_path.to_path_buf(),
        })
    }

    /// Whether the host process is still running.
    pub fn is_alive(&mut self) -> bool {
        self.proc.is_alive()
    }

    /// Returns the executable that the host was spawned from.
    pub fn exe(&self) -> &Path {
        &self.exe
    }

    /// Send all config commands for a session.
    pub fn configure(&mut self, config: &HostConfig) -> Result<(), HostError> {
        self.proc.configure(config)
    }

    /// Begin a scan session.
    pub fn start_scan(&mut self) -> Result<(), HostError> {
        self.proc.start_scan()
    }

    /// Tear down the current injection session, leaving the host running.
    pub fn stop_session(&mut self) -> Result<(), HostError> {
        self.proc.stop_session()
    }

    /// Discard buffered lines left over from a previous session and report
    /// whether the stream is still usable. See [`EventStream::drain`].
    pub fn drain_events(&mut self) -> bool {
        self.events.drain()
    }

    /// Borrow the host's line stream for the duration of a session. Returns
    /// `None` if a session already holds it (shouldn't happen - only one runs at
    /// a time).
    pub fn take_events(&mut self) -> Option<Receiver<HostLine>> {
        self.events.take()
    }

    /// Hand the line stream back after a session ends, so the next one can reuse
    /// this host.
    pub fn restore_events(&mut self, events: Receiver<HostLine>) {
        self.events.restore(events);
    }

    /// Gracefully stop the host: close stdin (with a kill fallback) and join the
    /// reader/stderr threads. For app shutdown / respawn.
    pub fn shutdown(&mut self) {
        self.proc.shutdown();
        if let Some(h) = self.reader_handle.take() {
            let _ = h.join();
        }
        if let Some(h) = self.stderr_handle.take() {
            let _ = h.join();
        }
    }
}

impl Drop for PatcherHost {
    fn drop(&mut self) {
        // Safety net: if the app exits without an explicit `shutdown`, `Child`'s
        // own `Drop` would leak the process. Kill it so the host never outlives us.
        self.proc.kill();
    }
}

/// The host's stdout line stream, borrowed by one session at a time.
///
/// Its own type so the borrow protocol - and the "disconnected means respawn"
/// rule [`Self::drain`] encodes - can be exercised without a child process.
struct EventStream(Option<Receiver<HostLine>>);

impl EventStream {
    /// Discard buffered lines left over from a previous session and report
    /// whether the stream is still usable.
    ///
    /// Returns `false` if the receiver is missing (a session panicked while
    /// holding it) or disconnected (the reader thread died even though the
    /// process may still be alive) - reusing such a host would make every
    /// future session fail instantly, so it must be respawned.
    fn drain(&mut self) -> bool {
        let Some(rx) = &self.0 else {
            return false;
        };
        loop {
            match rx.try_recv() {
                Ok(_) => {}
                Err(TryRecvError::Empty) => return true,
                Err(TryRecvError::Disconnected) => return false,
            }
        }
    }

    fn take(&mut self) -> Option<Receiver<HostLine>> {
        self.0.take()
    }

    fn restore(&mut self, events: Receiver<HostLine>) {
        self.0 = Some(events);
    }
}

/// Forward every line the host writes onto `tx` until EOF, a read error, or the
/// receiver going away.
///
/// Nothing is sent to mark the end: EOF ends `lines()` naturally and drops `tx`,
/// and it is that channel disconnect a waiting session reads as "the host
/// exited".
fn forward_lines<R: BufRead>(reader: R, tx: Sender<HostLine>) {
    for line in reader.lines() {
        let is_err = line.is_err();
        // Stop on a send failure (receiver gone) or the first read error; a
        // stream that has already errored will not recover.
        if tx.send(line).is_err() || is_err {
            break;
        }
    }
}

/// Forward the host's stderr on a background thread for startup diagnostics.
fn forward_stderr<R: Read + Send + 'static>(stream: R) -> JoinHandle<()> {
    thread::spawn(move || {
        for line in BufReader::new(stream).lines() {
            match line {
                Ok(text) if !text.trim().is_empty() => {
                    tracing::warn!("[ltk-host stderr] {}", text);
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    /// Yields one chunk, then fails - a pipe that dies mid-stream.
    struct BreaksAfter(Option<&'static str>);

    impl Read for BreaksAfter {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            match self.0.take() {
                Some(text) => {
                    buf[..text.len()].copy_from_slice(text.as_bytes());
                    Ok(text.len())
                }
                None => Err(std::io::Error::new(
                    std::io::ErrorKind::BrokenPipe,
                    "host pipe broke",
                )),
            }
        }
    }

    fn collect(rx: &Receiver<HostLine>) -> Vec<String> {
        rx.try_iter().filter_map(Result::ok).collect()
    }

    #[test]
    fn forward_lines_strips_terminators_and_preserves_order() {
        let (tx, rx) = mpsc::channel();
        forward_lines(Cursor::new("status 1.0 injecting\r\nok 2.0 done\n"), tx);
        assert_eq!(collect(&rx), ["status 1.0 injecting", "ok 2.0 done"]);
    }

    /// The session's only signal that the host exited: no sentinel line, just a
    /// disconnected channel once the reader returns.
    #[test]
    fn forward_lines_disconnects_the_channel_at_eof() {
        let (tx, rx) = mpsc::channel();
        forward_lines(Cursor::new("ok 1.0 done\n"), tx);
        assert!(rx.recv().is_ok());
        assert_matches::assert_matches!(rx.recv(), Err(_), "channel should be disconnected");
    }

    #[test]
    fn forward_lines_forwards_a_read_error_then_stops() {
        let (tx, rx) = mpsc::channel();
        forward_lines(BufReader::new(BreaksAfter(Some("ok 1.0 done\n"))), tx);
        let received: Vec<HostLine> = rx.try_iter().collect();
        assert_eq!(received.len(), 2, "the good line and the error");
        assert_eq!(received[0].as_ref().unwrap(), "ok 1.0 done");
        assert!(received[1].is_err());
    }

    /// A session that goes away must not wedge the reader thread on a full or
    /// dead channel - it returns instead of looping forever.
    #[test]
    fn forward_lines_returns_when_the_receiver_is_gone() {
        let (tx, rx) = mpsc::channel();
        drop(rx);
        forward_lines(Cursor::new("a\nb\nc\n"), tx);
    }

    #[test]
    fn drain_discards_the_previous_session_leftovers_and_keeps_the_stream() {
        let (tx, rx) = mpsc::channel();
        tx.send(Ok("dll 1.0 1 1 info stale".to_string())).unwrap();
        tx.send(Ok("ok 2.0 stale".to_string())).unwrap();
        let mut stream = EventStream(Some(rx));

        assert!(stream.drain());

        let rx = stream.take().unwrap();
        assert!(collect(&rx).is_empty(), "leftovers should be gone");
    }

    /// The reader thread dying is invisible to `is_alive` - the process can
    /// outlive its own stdout - so `drain` is what forces the respawn.
    #[test]
    fn drain_rejects_a_stream_whose_reader_died() {
        let (tx, rx) = mpsc::channel::<HostLine>();
        drop(tx);
        assert!(!EventStream(Some(rx)).drain());
    }

    /// A session that panicked while holding the stream never restored it; the
    /// host is unusable for the next one.
    #[test]
    fn drain_rejects_a_stream_a_session_never_gave_back() {
        assert!(!EventStream(None).drain());
    }

    #[test]
    fn take_then_restore_hands_the_same_stream_back() {
        let (tx, rx) = mpsc::channel();
        let mut stream = EventStream(Some(rx));

        let borrowed = stream.take().unwrap();
        assert!(stream.take().is_none(), "only one session may hold it");

        stream.restore(borrowed);
        tx.send(Ok("ok 1.0 next session".to_string())).unwrap();
        assert_eq!(collect(&stream.take().unwrap()), ["ok 1.0 next session"]);
    }

    #[test]
    fn forward_stderr_ends_at_eof() {
        forward_stderr(Cursor::new("warning: no signature\n\n"))
            .join()
            .expect("stderr forwarder should not panic");
    }

    #[test]
    fn forward_stderr_ends_on_a_read_error() {
        forward_stderr(BreaksAfter(Some("warning\n")))
            .join()
            .expect("stderr forwarder should not panic");
    }
}
