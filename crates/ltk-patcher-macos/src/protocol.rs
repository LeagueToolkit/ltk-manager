//! The stdin/stdout line protocol, matched to `ltk-manager-core`'s
//! `patcher::host::protocol` so the same injector parses this host's output.
//!
//! Commands in (UI → host): `config loglevel|flags|prefix <v>`, `start
//! scan|passive`, `stop`. Events out (host → UI): `ok`, `status`, `error`, and
//! synthetic `dll` records that drive the same overlay-live UI the Windows DLL
//! does.

use std::io::Write;
use std::sync::Mutex;
use std::time::Instant;

/// A command parsed from the host's stdin.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    ConfigLogLevel(u32),
    ConfigFlags(u32),
    ConfigPrefix(String),
    StartScan,
    StartPassive,
    Stop,
    /// A line we recognized the shape of but not the verb.
    Unknown(String),
}

/// Parse one command line. Returns `None` for blank lines.
pub fn parse_command(line: &str) -> Option<Command> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }
    let mut parts = line.splitn(2, ' ');
    let verb = parts.next()?;
    let rest = parts.next().unwrap_or("").trim();

    Some(match verb {
        "config" => {
            let mut kv = rest.splitn(2, ' ');
            let key = kv.next().unwrap_or("");
            let value = kv.next().unwrap_or("").trim();
            match key {
                "loglevel" => Command::ConfigLogLevel(value.parse().unwrap_or(0)),
                "flags" => Command::ConfigFlags(value.parse().unwrap_or(0)),
                "prefix" => Command::ConfigPrefix(value.to_string()),
                _ => Command::Unknown(line.to_string()),
            }
        }
        "start" => match rest {
            "scan" => Command::StartScan,
            "passive" => Command::StartPassive,
            _ => Command::Unknown(line.to_string()),
        },
        "stop" => Command::Stop,
        _ => Command::Unknown(line.to_string()),
    })
}

/// Injection lifecycle state, matching the Windows host's `status` states.
#[derive(Debug, Clone, Copy)]
pub enum State {
    Injecting,
    Injected,
    Waiting,
    Exited,
    Failed,
}

impl State {
    fn keyword(self) -> &'static str {
        match self {
            State::Injecting => "injecting",
            State::Injected => "injected",
            State::Waiting => "waiting",
            State::Exited => "exited",
            State::Failed => "failed",
        }
    }
}

/// Status messages the injector matches on (see core `dll_lines::host_status`).
pub const SCANNING_FOR_GAME: &str = "scanning for game";
pub const GAME_FOUND: &str = "game found";

/// DLL log messages the injector maps to overlay outcomes (see core
/// `dll_lines`). The macOS host has no DLL, so it emits `init done` itself once
/// the in-process hook is live.
pub const INIT_DONE: &str = "init done";

/// Writes protocol lines to a shared sink with a monotonic host clock, so the
/// stdin reader and the worker thread can both emit without interleaving.
pub struct Emitter {
    out: Mutex<Box<dyn Write + Send>>,
    start: Instant,
}

impl Emitter {
    pub fn new(out: Box<dyn Write + Send>) -> Self {
        Self {
            out: Mutex::new(out),
            start: Instant::now(),
        }
    }

    fn timestamp(&self) -> String {
        let secs = self.start.elapsed().as_secs_f64();
        format!("{secs:.7}")
    }

    fn line(&self, s: &str) {
        if let Ok(mut out) = self.out.lock() {
            let _ = writeln!(out, "{s}");
            let _ = out.flush();
        }
    }

    pub fn ok(&self, message: &str) {
        self.line(&format!("ok {} {}", self.timestamp(), message));
    }

    pub fn status(&self, state: State, message: &str) {
        self.line(&format!(
            "status {} {} {}",
            self.timestamp(),
            state.keyword(),
            message
        ));
    }

    pub fn error(&self, message: &str) {
        self.line(&format!("error {} {}", self.timestamp(), message));
    }

    /// A synthetic DLL record: `dll <ts> <pid> <tid> <level> <message>`.
    pub fn dll(&self, pid: u32, level: &str, message: &str) {
        self.line(&format!(
            "dll {} {} 0 {} {}",
            self.timestamp(),
            pid,
            level,
            message
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_config_and_control_verbs() {
        assert_eq!(parse_command("config loglevel 16"), Some(Command::ConfigLogLevel(16)));
        assert_eq!(parse_command("config flags 8"), Some(Command::ConfigFlags(8)));
        assert_eq!(
            parse_command("config prefix /Users/x/overlay/"),
            Some(Command::ConfigPrefix("/Users/x/overlay/".to_string()))
        );
        assert_eq!(parse_command("start scan"), Some(Command::StartScan));
        assert_eq!(parse_command("stop"), Some(Command::Stop));
        assert_eq!(parse_command("   "), None);
    }
}
