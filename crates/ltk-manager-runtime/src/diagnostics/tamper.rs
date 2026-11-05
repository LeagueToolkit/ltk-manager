//! Detection of an external launcher and its debugging channel.
//!
//! An external launcher starts the manager with WebView2 remote debugging
//! enabled and injects a DLL that calls Tauri commands over CDP. The
//! environment is cleared at `main`; this module names the live artifacts that
//! remain, without relying on any one injector's name.

use std::fmt;

/// A live artifact of an external launcher.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TamperSignal {
    /// The manager started with variables that open WebView2 to debugging.
    LauncherEnvironment,
    /// A launcher that injects into the manager is running.
    LauncherProcess,
    /// A WebView2 child of this process serves a debug endpoint.
    DebugWebView,
    /// This process listens on a TCP port, as an injected bridge does.
    BridgeListener,
}

impl fmt::Display for TamperSignal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::LauncherEnvironment => "the manager started with browser debugging variables",
            Self::LauncherProcess => "an external launcher is running",
            Self::DebugWebView => "WebView2 serves remote debugging",
            Self::BridgeListener => "this process listens on a TCP port",
        })
    }
}

/// Returns the live artifacts of an external launcher.
///
/// Returns an empty list off Windows.
pub fn signals() -> Vec<TamperSignal> {
    #[cfg(target_os = "windows")]
    {
        probe::signals()
    }
    #[cfg(not(target_os = "windows"))]
    {
        Vec::new()
    }
}

/// Whether a command line carries a switch that opens WebView2 to CDP.
pub fn has_debug_switch(command_line: &str) -> bool {
    command_line.split_whitespace().any(|argument| {
        let argument = argument.trim_matches('"').to_ascii_lowercase();
        ["--remote-debugging-port", "--remote-debugging-pipe"]
            .iter()
            .any(|switch| {
                argument == *switch
                    || argument
                        .strip_prefix(switch)
                        .is_some_and(|rest| rest.starts_with('='))
            })
    })
}

#[cfg(target_os = "windows")]
mod probe;

#[cfg(test)]
mod tests;
