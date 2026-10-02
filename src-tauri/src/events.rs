//! Tauri adapter for the core [`EventSink`].

use ltk_manager_core::events::{BackendEvent, EventSink};
use tauri::{AppHandle, Emitter};

/// Delivers [`BackendEvent`]s to the webview.
///
/// Emit failures are swallowed: every call site treats notification as
/// best-effort, and a closing window makes failures routine rather than
/// exceptional.
pub struct TauriEventSink {
    app_handle: AppHandle,
}

impl TauriEventSink {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

impl EventSink for TauriEventSink {
    fn emit(&self, event: BackendEvent) {
        let name = event.name();
        let result = self.app_handle.emit(name, &event);

        if let Err(e) = result {
            tracing::debug!("Failed to emit `{name}`: {e}");
        }
    }
}
