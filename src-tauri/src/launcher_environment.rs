//! Environment variables a parent process uses to control the manager's WebView2.
//!
//! The some launcher starts the manager with remote debugging enabled
//! and injects a DLL that calls the manager's Tauri commands over CDP. The
//! launcher sets these variables, and the DLL sets the first one itself when
//! neither of its port variables is present.

use std::ffi::OsString;

/// Variables that open the WebView2 to remote debugging, load it from another
/// folder, or steer the tooling that calls into it.
const LAUNCHER_VARIABLES: [&str; 5] = [
    "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
    "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER",
    "WEBVIEW2_RELEASE_CHANNEL_PREFERENCE",
    "WEBVIEW2_CHANNEL_SEARCH_KIND",
    "LTF_CDP_PORT",
];

/// Removes the variables a parent process sets to control the manager.
pub fn clear() {
    let names: Vec<OsString> = std::env::vars_os()
        .map(|(name, _)| name)
        .filter(|name| name.to_str().is_some_and(is_launcher_variable))
        .collect();

    for name in names {
        std::env::remove_var(name);
    }
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

#[cfg(test)]
mod tests;
