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

    launch_root_worker(self_path, &sock_path)?;

    // The user may sit on the password prompt; give them a generous window.
    listener.set_nonblocking(true)?;
    let stream = accept_with_timeout(&listener, Duration::from_secs(120))?;
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
    // Closing our write half signals EOF to the worker, which then exits.
    to_worker.shutdown(std::net::Shutdown::Write).ok();
    pump_out.join().ok();

    std::fs::remove_file(&sock_path).ok();
    if let Some(parent) = sock_path.parent() {
        std::fs::remove_dir(parent).ok();
    }
    Ok(())
}

fn accept_with_timeout(listener: &UnixListener, timeout: Duration) -> io::Result<UnixStream> {
    let deadline = Instant::now() + timeout;
    loop {
        match listener.accept() {
            Ok((stream, _)) => return Ok(stream),
            Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err(io::Error::new(
                        io::ErrorKind::TimedOut,
                        "elevated worker did not connect (was the password prompt cancelled?)",
                    ));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(e),
        }
    }
}

/// Launch a root copy of ourselves that connects back to `sock_path`, prompting
/// for the administrator password once via `osascript`.
fn launch_root_worker(self_path: &Path, sock_path: &Path) -> io::Result<()> {
    let self_q = shell_quote(&self_path.to_string_lossy());
    let sock_q = shell_quote(&sock_path.to_string_lossy());
    // Background and detach so `do shell script` returns while the worker runs.
    let shell_cmd = format!("{self_q} --worker {sock_q} >/dev/null 2>&1 &");
    let script = format!(
        "do shell script \"{}\" with administrator privileges",
        applescript_quote(&shell_cmd)
    );

    let status = Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(&script)
        .status()?;

    if !status.success() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "administrator authorization was declined",
        ));
    }
    Ok(())
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
