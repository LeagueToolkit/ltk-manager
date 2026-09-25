//! The elevation bridge.
//!
//! `task_for_pid` on the game needs root. Rather than run the whole manager
//! elevated, the host it spawns re-launches itself as root once — via a single
//! `osascript` administrator prompt — and relays the line protocol to that root
//! worker over a private Unix socket. This mirrors the Windows UAC bridge, and
//! because the manager keeps the host alive across sessions, the password is
//! asked once per app run.

use std::io::{self, Read, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

/// Whether this process is running as root.
pub fn is_root() -> bool {
    unsafe { libc::geteuid() == 0 }
}

/// Create a `0700` directory under the temp dir for the relay socket.
fn private_socket_path() -> io::Result<PathBuf> {
    let mut dir = std::env::temp_dir();
    let unique = format!("ltk-patcher-{}-{}", std::process::id(), now_nanos());
    dir.push(unique);
    std::fs::create_dir(&dir)?;
    std::fs::set_permissions(&dir, std::os::unix::fs::PermissionsExt::from_mode(0o700))?;
    dir.push("host.sock");
    Ok(dir)
}

fn now_nanos() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

/// Single-quote a string for a POSIX shell command line.
fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Escape a string for embedding inside an AppleScript double-quoted literal.
fn applescript_quote(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Relay mode: bind a socket, launch the root worker via `osascript`, and pump
/// this process's stdin/stdout to and from it. Runs until stdin closes.
pub fn relay(self_path: &Path) -> io::Result<()> {
    let sock_path = private_socket_path()?;
    let listener = UnixListener::bind(&sock_path)?;

    // Run `osascript` blocking on its own thread rather than backgrounding the
    // root worker inside it: macOS reaps a privileged child that the authorizing
    // `osascript` is no longer waiting on (even `nohup &` dies), so the worker
    // must remain the process `osascript` is blocked on for the whole session.
    // The worker exits when we close the socket below, which lets `osascript`
    // return and this thread finish.
    let auth = launch_root_worker(self_path, &sock_path);

    // The user may sit on the password prompt; give them a generous window, but
    // bail out early (with a visible failure) if `osascript` returns before the
    // worker ever connects — that means the prompt was declined or it failed.
    listener.set_nonblocking(true)?;
    let stream = match accept_until(&listener, Duration::from_secs(180), &auth) {
        Ok(stream) => stream,
        Err(e) => {
            // Surface the failure to the manager as a protocol line, so the UI
            // shows a reason instead of a silent, output-less host.
            let mut stdout = io::stdout();
            let _ = writeln!(stdout, "status 0.0000000 failed {e}");
            let _ = stdout.flush();
            std::fs::remove_file(&sock_path).ok();
            if let Some(parent) = sock_path.parent() {
                std::fs::remove_dir(parent).ok();
            }
            return Err(io::Error::new(io::ErrorKind::Other, e));
        }
    };
    listener.set_nonblocking(false).ok();

    let mut to_worker = stream.try_clone()?;
    let mut from_worker = stream;

    // stdout <- worker
    let pump_out = std::thread::spawn(move || {
        let mut stdout = io::stdout();
        let mut buf = [0u8; 4096];
        loop {
            match from_worker.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if stdout.write_all(&buf[..n]).is_err() || stdout.flush().is_err() {
                        break;
                    }
                }
            }
        }
    });

    // worker <- stdin
    let mut stdin = io::stdin();
    let mut buf = [0u8; 4096];
    loop {
        match stdin.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                if to_worker.write_all(&buf[..n]).is_err() || to_worker.flush().is_err() {
                    break;
                }
            }
        }
    }
    // Closing our write half signals EOF to the worker, which then exits; that
    // in turn lets the blocking `osascript` return and the auth thread finish.
    to_worker.shutdown(std::net::Shutdown::Write).ok();
    pump_out.join().ok();
    auth.join().ok();

    std::fs::remove_file(&sock_path).ok();
    if let Some(parent) = sock_path.parent() {
        std::fs::remove_dir(parent).ok();
    }
    Ok(())
}

/// Accept the worker connection, giving up early if the `osascript` auth thread
/// finishes first (declined/failed prompt) or the deadline passes.
fn accept_until(
    listener: &UnixListener,
    timeout: Duration,
    auth: &std::thread::JoinHandle<String>,
) -> Result<UnixStream, String> {
    let deadline = Instant::now() + timeout;
    loop {
        match listener.accept() {
            Ok((stream, _)) => return Ok(stream),
            Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => {
                // If osascript already returned and no worker connected, the
                // authorization was declined or the worker could not start.
                if auth.is_finished() {
                    // Give a just-connected worker a brief chance to land first.
                    std::thread::sleep(Duration::from_millis(100));
                    if let Ok((stream, _)) = listener.accept() {
                        return Ok(stream);
                    }
                    return Err(
                        "administrator authorization was declined or the elevated helper could not start"
                            .to_string(),
                    );
                }
                if Instant::now() >= deadline {
                    return Err("timed out waiting for the administrator password".to_string());
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

/// Launch a root copy of ourselves that connects back to `sock_path`, prompting
/// for the administrator password once via `osascript`.
///
/// Returns a handle to the thread running `osascript` blocking: it stays alive
/// (keeping the privileged worker alive) until the worker exits. The joined
/// value is a short diagnostic string, empty on success.
fn launch_root_worker(self_path: &Path, sock_path: &Path) -> std::thread::JoinHandle<String> {
    let self_q = shell_quote(&self_path.to_string_lossy());
    let sock_q = shell_quote(&sock_path.to_string_lossy());
    // No backgrounding: `osascript` runs the worker in the foreground and blocks
    // until it exits, which is what keeps the privileged process from being
    // reaped.
    let shell_cmd = format!("exec {self_q} --worker {sock_q}");
    let script = format!(
        "do shell script \"{}\" with administrator privileges",
        applescript_quote(&shell_cmd)
    );

    std::thread::spawn(move || {
        match Command::new("/usr/bin/osascript")
            .arg("-e")
            .arg(&script)
            .status()
        {
            Ok(status) if status.success() => String::new(),
            Ok(_) => "osascript returned an error".to_string(),
            Err(e) => format!("could not run osascript: {e}"),
        }
    })
}

/// Worker mode: connect to `sock_path` and serve the host protocol over it.
pub fn worker(sock_path: &Path) -> io::Result<()> {
    let stream = UnixStream::connect(sock_path)?;
    let reader = io::BufReader::new(stream.try_clone()?);
    crate::host::serve(reader, Box::new(stream));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_quoting_wraps_and_escapes() {
        assert_eq!(shell_quote("/a b/host"), "'/a b/host'");
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
    }

    #[test]
    fn applescript_quoting_escapes_backslash_and_quote() {
        assert_eq!(applescript_quote(r#"a"b\c"#), "a\\\"b\\\\c");
    }
}
