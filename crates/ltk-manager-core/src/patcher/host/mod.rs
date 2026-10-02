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

/// Bundled host executable name. The macOS host ships without an extension.
#[cfg(target_os = "windows")]
pub const HOST_EXE_NAME: &str = "ltk_patcher_host.exe";
#[cfg(not(target_os = "windows"))]
pub const HOST_EXE_NAME: &str = "ltk_patcher_host";

/// Bundled hook DLL the host injects into the game. This is the file the
/// diagnostics suite inspects (presence / signature / lock) - it replaced the
/// legacy in-process `cslol-dll.dll`.
pub const HOOK_DLL_NAME: &str = "ltk_patcher_dll.dll";
