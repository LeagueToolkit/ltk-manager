//! What a failure reports, for the three seams a failure reaches.
//!
//! A backend error travelling to the frontend is frequently routine, so it is a
//! normal event. A panic and a frontend crash are exceptions in the vendor's
//! sense, which is a `$exception` event carrying `$exception_list`, and it is
//! that shape rather than a name of ours that gets a stack symbolicated and an
//! issue grouped. Which of the two a `$exception` is stays readable as `kind`.

use ltk_telemetry::Properties;
use serde::Deserialize;
use serde_json::json;

/// A backend error that reached the frontend.
pub const APP_ERROR: &str = "app_error";

/// The one event name the vendor reads an exception from.
pub const EXCEPTION: &str = "$exception";

/// The exceptions this app reports, as the `kind` telling them apart.
pub const KIND_APP_PANIC: &str = "app_panic";
pub const KIND_UI_ERROR: &str = "ui_error";

/// The vendor's own name for a stack frame that came from no known runtime.
const CUSTOM_PLATFORM: &str = "custom";

/// What a frontend crash reports, as the boundary and the two window handlers
/// hand it over.
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UiError {
    /// The error's constructor name, which is what an issue groups on.
    pub name: String,
    pub message: String,
    /// The stack as the engine wrote it, unresolved until the maps are uploaded.
    pub stack: Option<String>,
    /// Which components were mounted, where React gives one.
    pub component_stack: Option<String>,
    /// The route the reader was on, which is the location a crash carries.
    pub route: Option<String>,
    /// Whether anything caught it, which the vendor draws on an issue.
    pub handled: bool,
}

/// What a backend error reports.
///
/// The code is the one the frontend matches on, so an issue groups the same way
/// the app already treats the failure. The message is prose from outside the app
/// and is scrubbed on the way past, like every other string.
#[must_use]
pub fn app_error(code: &str, message: &str) -> Properties {
    Properties::new()
        .with("app_version", env!("CARGO_PKG_VERSION"))
        .with("error_code", code)
        .with("message", message)
}

/// What a panic reports, as the vendor reads an exception.
///
/// The location is the standard library's, which needs no symbols, so a panic is
/// readable from the event alone.
#[must_use]
pub fn panic_exception(message: &str, location: Option<&str>, line: Option<u32>) -> Properties {
    let mut frame = json!({
        "platform": CUSTOM_PLATFORM,
        "lang": "rust",
        "function": "panic",
        "in_app": true,
    });
    if let Some(location) = location {
        frame["filename"] = json!(location);
    }
    if let Some(line) = line {
        frame["lineno"] = json!(line);
    }

    exception(
        KIND_APP_PANIC,
        "RustPanic",
        message,
        false,
        vec![frame],
        Properties::new(),
    )
}

/// What a frontend crash reports, as the vendor reads an exception.
///
/// The stack travels as one frame holding the whole trace rather than as parsed
/// frames. The engine writes it in its own shape and the maps that resolve it
/// are uploaded separately, so parsing it here would only be a second place to
/// get it wrong.
#[must_use]
pub fn ui_exception(error: &UiError) -> Properties {
    let mut frame = json!({
        "platform": CUSTOM_PLATFORM,
        "lang": "javascript",
        "function": error.route.as_deref().unwrap_or("unknown"),
        "in_app": true,
    });
    if let Some(stack) = &error.stack {
        frame["module"] = json!(stack);
    }

    let mut extra = Properties::new();
    if let Some(route) = &error.route {
        extra.insert("route", route.clone());
    }
    if let Some(components) = &error.component_stack {
        extra.insert("component_stack", components.clone());
    }

    exception(
        KIND_UI_ERROR,
        &error.name,
        &error.message,
        error.handled,
        vec![frame],
        extra,
    )
}

/// The vendor's exception shape, filled in for one of the two kinds.
fn exception(
    kind: &str,
    error_type: &str,
    value: &str,
    handled: bool,
    frames: Vec<serde_json::Value>,
    extra: Properties,
) -> Properties {
    let entry = json!({
        "type": error_type,
        "value": value,
        "mechanism": { "handled": handled, "synthetic": false },
        "stacktrace": { "type": "raw", "frames": frames },
    });

    let mut properties = Properties::new()
        .with("app_version", env!("CARGO_PKG_VERSION"))
        .with("kind", kind)
        .with("$exception_list", json!([entry]));
    for (key, value) in extra.as_map().clone() {
        properties.insert(key, value);
    }
    properties
}

/// What two reports of the same failure share, so the second is not sent.
///
/// The kind and the location, never the message: a message carrying a path, an
/// id or a count is a different string every time and would defeat the window it
/// is measured over.
#[must_use]
pub fn fingerprint(kind: &str, location: &str) -> String {
    format!("{kind}:{location}")
}

#[cfg(test)]
mod tests;
