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
        let result = match &event {
            BackendEvent::OverlayProgress(progress) => self.app_handle.emit(name, progress),
            BackendEvent::InstallProgress(progress) => self.app_handle.emit(name, progress),
            BackendEvent::MigrationProgress(progress) => self.app_handle.emit(name, progress),
            BackendEvent::LayoutMigrationProgress(progress) => self.app_handle.emit(name, progress),
            BackendEvent::LayoutMigrationFinished(report) => self.app_handle.emit(name, report),
            BackendEvent::HealthSweepProgress(progress) => self.app_handle.emit(name, progress),
            BackendEvent::HealthSweepFinished(report) => self.app_handle.emit(name, report),
            BackendEvent::ModRepairProgress(progress) => self.app_handle.emit(name, progress),
            BackendEvent::FantomeImportProgress(progress) => self.app_handle.emit(name, progress),
            BackendEvent::ModStorageProgress(progress) => self.app_handle.emit(name, progress),
            BackendEvent::GitImportProgress(progress) => self.app_handle.emit(name, progress),
            BackendEvent::LaunchProgress(progress) => self.app_handle.emit(name, progress),
            BackendEvent::SessionStarted(session) => self.app_handle.emit(name, session),
            BackendEvent::SessionChanged(session) => self.app_handle.emit(name, session),
            BackendEvent::SessionGameRunning(session) => self.app_handle.emit(name, session),
            BackendEvent::SessionEnded(session) => self.app_handle.emit(name, session),
            BackendEvent::HashtableSyncProgress(progress) => self.app_handle.emit(name, progress),
            BackendEvent::ExtractProgress(progress) => self.app_handle.emit(name, progress),
            BackendEvent::LinkedBinsUpdated
            | BackendEvent::WadReportsUpdated
            | BackendEvent::ModHealthVerdictsUpdated
            | BackendEvent::LibraryChanged => self.app_handle.emit(name, ()),
        };

        if let Err(e) = result {
            tracing::debug!("Failed to emit `{name}`: {e}");
        }
    }
}
