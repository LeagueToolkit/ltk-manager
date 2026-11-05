//! Environment variables a parent process uses to control the manager's WebView2.
//!
//! An external launcher starts the manager with remote debugging enabled and
//! injects a DLL that calls the manager's Tauri commands over CDP. The launcher
//! sets these variables, and the injected DLL sets the first one itself when
//! neither of its port variables is present.

use std::ffi::{OsStr, OsString};
use std::sync::atomic::{AtomicBool, Ordering};

/// Variables that open the WebView2 to remote debugging, load it from another
/// folder, or steer the tooling that calls into it.
const LAUNCHER_VARIABLES: [&str; 5] = [
    "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
    "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER",
    "WEBVIEW2_RELEASE_CHANNEL_PREFERENCE",
    "WEBVIEW2_CHANNEL_SEARCH_KIND",
    "LTF_CDP_PORT",
];

/// Set when [`clear`] found a variable that lets a parent control the manager.
static STARTED_WITH_LAUNCHER_ENV: AtomicBool = AtomicBool::new(false);

/// Removes the variables a parent process sets to control the manager.
pub fn clear() {
    let variables: Vec<(OsString, OsString)> = std::env::vars_os()
        .filter(|(name, _)| name.to_str().is_some_and(is_launcher_variable))
        .collect();

    if variables.iter().any(|(name, value)| {
        name.to_str()
            .is_some_and(|name| is_control_variable(name, value))
    }) {
        STARTED_WITH_LAUNCHER_ENV.store(true, Ordering::Relaxed);
    }

    for (name, _) in variables {
        std::env::remove_var(name);
    }
}

/// Whether a parent process controlled this manager, at startup or now.
///
/// Clearing the variables stops WebView2 from opening the debug endpoint, but
/// the manager is still running in the process the launcher started. The
/// patcher refuses to start there and asks for a normal restart instead.
pub fn is_controlled() -> bool {
    STARTED_WITH_LAUNCHER_ENV.load(Ordering::Relaxed) || variables_present()
}

/// Whether any controlling variable is in the current environment.
fn variables_present() -> bool {
    std::env::vars_os().any(|(name, value)| {
        name.to_str()
            .is_some_and(|name| is_launcher_variable(name) && is_control_variable(name, &value))
    })
}

/// Whether `name` is a variable [`clear`] removes.
///
/// Windows compares environment variable names without case, so a process can
/// set one under any spelling.
fn is_launcher_variable(name: &str) -> bool {
    name.to_ascii_uppercase().starts_with("CELESTIAL_")
        || LAUNCHER_VARIABLES
            .iter()
            .any(|known| name.eq_ignore_ascii_case(known))
}

/// Whether `name` and `value` let a parent drive the manager, rather than just
/// adjust how WebView2 starts.
fn is_control_variable(name: &str, value: &OsStr) -> bool {
    let upper = name.to_ascii_uppercase();

    if upper.starts_with("CELESTIAL_")
        || upper == "LTF_CDP_PORT"
        || upper == "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER"
    {
        return true;
    }

    upper == "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"
        && value
            .to_str()
            .is_some_and(ltk_manager_runtime::diagnostics::tamper::has_debug_switch)
}

#[cfg(test)]
mod tests;
