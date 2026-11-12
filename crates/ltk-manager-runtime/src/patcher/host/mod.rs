//! Line-protocol client for the injection host process.
//!
//! The host process owns all injection logic and communicates with us over a
//! line-oriented protocol on stdin (commands) and stdout (events). Split into:
//!
//! - `protocol` - the wire protocol: keywords, session config, event parsing
//! - `process` - spawning and driving a single host child process
//! - `persistent` - the long-lived [`PatcherHost`] reused across sessions

mod persistent;
mod process;
mod protocol;

pub use persistent::{HostLine, PatcherHost};
pub use process::{HostError, HostProcess};
pub use protocol::{HostConfig, HostEvent, HostLogLevel, HostState, hook_flags, parse_event};

/// Returns the `tracing` level that `word` names, ignoring case.
fn parse_level(word: &str) -> Option<tracing::Level> {
    use tracing::Level;
    [
        Level::ERROR,
        Level::WARN,
        Level::INFO,
        Level::DEBUG,
        Level::TRACE,
    ]
    .into_iter()
    .find(|level| word.eq_ignore_ascii_case(level.as_str()))
}

/// Returns the level of a DLL record. Falls back to `INFO` if `level` names no level.
pub fn dll_record_level(level: &str) -> tracing::Level {
    parse_level(level).unwrap_or(tracing::Level::INFO)
}

/// Returns the level of a host stderr line, which the host writes as
/// `<uptime> <LEVEL> <target>: <message>`. Falls back to `WARN` if neither of the
/// first two words names a level.
fn stderr_line_level(line: &str) -> tracing::Level {
    line.split_whitespace()
        .take(2)
        .find_map(parse_level)
        .unwrap_or(tracing::Level::WARN)
}

/// Writes `message` to the log at `level`.
pub fn log_at(level: tracing::Level, message: std::fmt::Arguments<'_>) {
    use tracing::Level;
    match level {
        Level::ERROR => tracing::error!("{message}"),
        Level::WARN => tracing::warn!("{message}"),
        Level::INFO => tracing::info!("{message}"),
        Level::DEBUG => tracing::debug!("{message}"),
        Level::TRACE => tracing::trace!("{message}"),
    }
}

/// Bundled host executable name.
pub const HOST_EXE_NAME: &str = "ltk_patcher_host.exe";

/// Delivered hook DLL the host injects into the game. This is the file the
/// diagnostics suite inspects (presence / signature / lock) - it replaced the
/// legacy in-process `cslol-dll.dll`.
pub const HOOK_DLL_NAME: &str = "ltk_patcher_dll.dll";

#[cfg(test)]
mod tests {
    use super::*;
    use tracing::Level;

    #[test]
    fn dll_record_level_reads_each_level() {
        assert_eq!(dll_record_level("error"), Level::ERROR);
        assert_eq!(dll_record_level("WARN"), Level::WARN);
        assert_eq!(dll_record_level("debug"), Level::DEBUG);
    }

    #[test]
    fn dll_record_level_falls_back_to_info() {
        assert_eq!(dll_record_level("verbose"), Level::INFO);
    }

    #[test]
    fn stderr_line_level_reads_host_format() {
        let line = "   0.004211300s  INFO ltk_patcher_host::worker: pipe connected";
        assert_eq!(stderr_line_level(line), Level::INFO);
        let line = "   1.250000000s ERROR ltk_patcher_host::elevate: pipe closed";
        assert_eq!(stderr_line_level(line), Level::ERROR);
    }

    #[test]
    fn stderr_line_level_falls_back_to_warn() {
        assert_eq!(stderr_line_level("thread 'main' panicked"), Level::WARN);
        assert_eq!(stderr_line_level("failed to read info block"), Level::WARN);
    }
}
