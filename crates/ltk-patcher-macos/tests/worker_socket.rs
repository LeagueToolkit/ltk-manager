//! The elevated worker connects to the relay's socket and serves the protocol.
//!
//! Exercises the socket serve path end to end (minus the `osascript` privilege
//! step, which the relay drives): drive a worker over a Unix socket the way the
//! relay does, and confirm it acks a command and reports scanning when no game
//! is running.

#![cfg(target_os = "macos")]

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixListener;
use std::time::{Duration, Instant};

#[test]
fn worker_acks_and_scans_over_the_socket() {
    let dir = std::env::temp_dir().join(format!("ltk-worker-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let sock = dir.join("host.sock");

    let listener = UnixListener::bind(&sock).unwrap();

    // The worker connects back, exactly as under `--worker`.
    let sock_for_worker = sock.clone();
    let worker = std::thread::spawn(move || {
        let _ = ltk_patcher_macos::elevate::worker(&sock_for_worker);
    });

    let (stream, _) = listener.accept().unwrap();
    let mut writer = stream.try_clone().unwrap();
    let mut reader = BufReader::new(stream);

    // Two commands whose acks are deterministic regardless of game state:
    // `config prefix` then `start scan`. (We avoid asserting the follow-on
    // `scanning for game`, which depends on whether a game is running — and if
    // one is, the worker would go on to attempt a patch we do not want here.)
    writer.write_all(b"config prefix /tmp/ltk-test/\n").unwrap();
    writer.write_all(b"start scan\n").unwrap();
    writer.flush().unwrap();

    let mut saw_prefix = false;
    let mut saw_started = false;
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut line = String::new();
    while Instant::now() < deadline && !(saw_prefix && saw_started) {
        line.clear();
        if reader.read_line(&mut line).unwrap_or(0) == 0 {
            break;
        }
        if line.contains("ok ") && line.contains("prefix set") {
            saw_prefix = true;
        }
        if line.contains("ok ") && line.contains("started") {
            saw_started = true;
        }
    }

    // Closing the socket ends the worker's reader; we deliberately do not join
    // the worker thread — if a real game is running it may be mid-scan, and the
    // test only needs to confirm the socket serve path acks commands.
    writer.shutdown(std::net::Shutdown::Both).ok();
    drop(worker);
    std::fs::remove_file(&sock).ok();
    std::fs::remove_dir(&dir).ok();

    assert!(saw_prefix, "worker should ack `config prefix` with `ok ... prefix set`");
    assert!(saw_started, "worker should ack `start scan` with `ok ... started`");
}
