//! Tauri adapter for the core [`EventSink`].

use ltk_manager_base::events::{BackendEvent, EventSink};
use tauri::{AppHandle, Emitter, Manager};

use crate::patcher::PatcherState;

/// Delivers [`BackendEvent`]s to the webview.
///
/// Emit failures are swallowed: every call site treats notification as
/// best-effort, and a closing window makes failures routine rather than
/// exceptional.
///
/// An overlay progress event is also kept on the patcher state, so a status read after the
/// event sees where the build phase is.
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
        if let BackendEvent::OverlayProgress(progress) = &event {
            if let Some(patcher) = self.app_handle.try_state::<PatcherState>() {
                patcher.with_mut(|state| state.record_overlay_progress(progress.clone()));
            }
        }

        let name = event.name();
        let result = self.app_handle.emit(name, &event);

        if let Err(e) = result {
            tracing::debug!("Failed to emit `{name}`: {e}");
        }
    }
}
