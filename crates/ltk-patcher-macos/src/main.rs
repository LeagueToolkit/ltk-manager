//! `ltk_patcher_host` — the macOS injection host.
//!
//! Modes:
//! - default: serve the line protocol on stdin/stdout, patching directly (used
//!   when the manager already runs as root).
//! - `--elevate`: relay stdin/stdout to a root copy of ourselves, launched once
//!   via an administrator prompt.
//! - `--worker <socket>`: the root copy; connect back and serve over the socket.

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("ltk_patcher_host runs on macOS only");
    std::process::exit(1);
}

#[cfg(target_os = "macos")]
fn main() {
    use ltk_patcher_macos::{elevate, host};
    use std::io::{self, BufReader};

    let args: Vec<String> = std::env::args().collect();

    if let Some(pos) = args.iter().position(|a| a == "--worker") {
        let sock = args.get(pos + 1).cloned().unwrap_or_default();
        if sock.is_empty() {
            eprintln!("--worker requires a socket path");
            std::process::exit(2);
        }
        if let Err(e) = elevate::worker(std::path::Path::new(&sock)) {
            eprintln!("worker failed: {e}");
            std::process::exit(1);
        }
        return;
    }

    let want_elevate = args.iter().any(|a| a == "--elevate");
    if want_elevate && !elevate::is_root() {
        let self_path = std::env::current_exe().unwrap_or_else(|_| args[0].clone().into());
        if let Err(e) = elevate::relay(&self_path) {
            eprintln!("elevation bridge failed: {e}");
            std::process::exit(1);
        }
        return;
    }

    // Direct mode: patch from this process (already root, or elevation off).
    host::serve(BufReader::new(io::stdin()), Box::new(io::stdout()));
}
