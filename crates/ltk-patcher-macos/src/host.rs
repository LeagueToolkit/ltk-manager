//! The host state machine: consume protocol commands, scan for the game, and
//! apply the patch, reporting lifecycle over the same events the Windows host
//! emits. Mirrors the poll loop of cslol's `patcher::run`.

use std::io::{BufRead, Write};
use std::sync::mpsc::{self, Receiver, TryRecvError};
use std::sync::Arc;
use std::time::Duration;

use crate::patch::{self, PatchOptions};
use crate::process::{self, Process};
use crate::protocol::{parse_command, Command, Emitter, State, GAME_FOUND, INIT_DONE, SCANNING_FOR_GAME};

/// Serve the host protocol over one duplex channel: parse commands from
/// `input` on a reader thread, and drive the loop, writing events to `output`.
///
/// Used directly (stdin/stdout) and by the elevated worker (a Unix socket).
pub fn serve(input: impl BufRead + Send + 'static, output: Box<dyn Write + Send>) {
    let emitter = Arc::new(Emitter::new(output));
    let (tx, rx) = mpsc::channel::<Command>();

    std::thread::spawn(move || {
        for line in input.lines() {
            match line {
                Ok(line) => {
                    if let Some(cmd) = parse_command(&line) {
                        if tx.send(cmd).is_err() {
                            return;
                        }
                    }
                }
                Err(_) => return,
            }
        }
        // EOF: dropping `tx` disconnects the receiver, ending the run loop.
    });

    run(emitter, rx);
}

/// Executable-path suffix identifying a running League process.
const GAME_SUFFIX: &str = "/LeagueofLegends";

/// Hook flag bits, matching `ltk-manager-core`'s `patcher::host::hook_flags`.
const FLAG_DISABLE_VERIFY: u32 = 1;
const FLAG_DISABLE_FILE: u32 = 2;
const FLAG_OPT_OUT_AH_V1: u32 = 4;
const FLAG_FULL_WAD_SCAN: u32 = 8;

#[derive(Default)]
struct Config {
    prefix: Vec<u8>,
    flags: u32,
    warned_unsupported_flags: bool,
}

/// Run the host loop until stdin closes (the `commands` sender is dropped).
pub fn run(emitter: Arc<Emitter>, commands: Receiver<Command>) {
    let mut config = Config::default();
    let mut scanning = false;
    let mut announced_scanning = false;

    loop {
        // Apply every pending command first, so a `stop` between game launches
        // takes effect promptly.
        loop {
            match commands.try_recv() {
                Ok(cmd) => {
                    if handle_command(&emitter, &mut config, &mut scanning, cmd) {
                        announced_scanning = false;
                    }
                }
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => return,
            }
        }

        if !scanning {
            std::thread::sleep(Duration::from_millis(50));
            continue;
        }

        match process::find_pid(GAME_SUFFIX) {
            None => {
                if !announced_scanning {
                    emitter.status(State::Injecting, SCANNING_FOR_GAME);
                    announced_scanning = true;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            Some(pid) => {
                announced_scanning = false;
                run_session(&emitter, &config, &commands, pid, &mut scanning);
            }
        }
    }
}

/// Returns true if the command reset the scanning announcement (start/stop).
fn handle_command(
    emitter: &Emitter,
    config: &mut Config,
    scanning: &mut bool,
    cmd: Command,
) -> bool {
    match cmd {
        Command::ConfigLogLevel(_) => {
            emitter.ok("loglevel set");
            false
        }
        Command::ConfigFlags(flags) => {
            config.flags = flags;
            emitter.ok("flags set");
            false
        }
        Command::ConfigPrefix(prefix) => {
            match patch::prepare_prefix(&prefix) {
                Ok(bytes) => {
                    config.prefix = bytes;
                    emitter.ok("prefix set");
                }
                Err(e) => emitter.error(&e.to_string()),
            }
            false
        }
        Command::StartScan | Command::StartPassive => {
            *scanning = true;
            warn_unsupported_flags(emitter, config);
            emitter.ok("started");
            true
        }
        Command::Stop => {
            *scanning = false;
            emitter.ok("stopped");
            true
        }
        Command::Unknown(line) => {
            emitter.error(&format!("unknown command: {line}"));
            false
        }
    }
}

/// The macOS host has no in-game DLL, so the anti-hack scan flags have no
/// effect here. Say so once rather than silently ignoring them.
fn warn_unsupported_flags(emitter: &Emitter, config: &mut Config) {
    if config.warned_unsupported_flags {
        return;
    }
    if config.flags & (FLAG_OPT_OUT_AH_V1 | FLAG_FULL_WAD_SCAN) != 0 {
        emitter.error(
            "anti-hack scan options are not supported on macOS; the injected DLL that runs them exists only on Windows",
        );
        config.warned_unsupported_flags = true;
    }
}

fn options_from_flags(flags: u32) -> PatchOptions {
    PatchOptions {
        disable_verify: flags & FLAG_DISABLE_VERIFY != 0,
        disable_file: flags & FLAG_DISABLE_FILE != 0,
    }
}

/// Patch one game process and wait for it to exit.
fn run_session(
    emitter: &Emitter,
    config: &Config,
    commands: &Receiver<Command>,
    pid: u32,
    scanning: &mut bool,
) {
    emitter.status(State::Injecting, GAME_FOUND);

    let mut process = match Process::open(pid) {
        Ok(p) => p,
        Err(e) => {
            emitter.status(State::Failed, &format!("open process: {e}"));
            *scanning = false;
            return;
        }
    };

    if let Err(e) = patch::scan_and_patch(&mut process, &config.prefix, options_from_flags(config.flags)) {
        emitter.status(State::Failed, &e.to_string());
        *scanning = false;
        return;
    }

    emitter.status(State::Injected, "patched");
    // No DLL on macOS; announce the overlay is live so the UI matches Windows.
    emitter.dll(pid, "info", INIT_DONE);
    emitter.status(State::Waiting, "waiting for exit");

    loop {
        // A `stop` while waiting must end the session at once.
        match commands.try_recv() {
            Ok(Command::Stop) => {
                *scanning = false;
                emitter.ok("stopped");
                return;
            }
            Ok(_) => {}
            Err(TryRecvError::Empty) => {}
            Err(TryRecvError::Disconnected) => {
                *scanning = false;
                return;
            }
        }

        if process.is_exited() {
            emitter.status(State::Exited, "game exit");
            return;
        }
        std::thread::sleep(Duration::from_millis(1000));
    }
}
