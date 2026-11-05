//! Tauri adapter for the core patcher thread.
//!
//! The session logic itself lives in [`ltk_manager_core::patching::thread`]; what
//! stays here is the [`PatcherEvents`] implementation that turns its
//! notifications into frontend events and tray-icon changes, plus the `ts-rs`
//! payload types those events carry.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppErrorResponse};
use crate::events::TauriEventSink;
use crate::tray::AppTrayState;
use ltk_manager_base::events::{BackendEvent, EventSink as _, OverlayProgress};
use ltk_manager_runtime::diagnostics::incident::{Incident, OverlayOutcome, ScanStatus};
use ltk_manager_runtime::patcher::events::PatcherEvents;
use ltk_manager_runtime::patcher::injector::WadScanFailure;
use ltk_manager_runtime::patcher::PatcherPhase;

/// One archive that failed the integrity scan, sent in [`WadScanFailedPayload`].
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WadScanFailureInfo {
    /// The offending archive (e.g. `TahmKench.wad.client`), if its name parsed.
    pub wad: Option<String>,
    /// The code the scan reported, an NTSTATUS-style one the game raised
    /// (`c0000229`), or a word the DLL's own checks named (`mod_wad`).
    pub status: String,
    /// What [`ScanStatus::parse`] makes of `status`, so the dialog reads a
    /// rejection the way the Games tab does instead of keeping a second table.
    pub reading: ScanStatus,
}

/// Payload for the `patcher-wad-scan-failed` event, emitted when the injected
/// DLL's integrity scan rejects one or more modded archives. When this fires
/// the patcher auto-stops and applies no mods for the session.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WadScanFailedPayload {
    /// The archives that failed the scan, de-duplicated. May be empty if no
    /// names could be parsed from the scan log.
    pub failures: Vec<WadScanFailureInfo>,
}

/// Payload for the `patcher-game-attached` event: the DLL is in the game,
/// which says nothing yet about whether the overlay went live.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GameAttachedPayload {
    /// The game's process id, when a `dll` line named it.
    pub pid: Option<u64>,
}

/// Payload for the `patcher-game-overlay` event: what the DLL said about the
/// overlay after it attached.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GameOverlayPayload {
    pub outcome: OverlayOutcome,
}

/// Maps core patcher notifications to Tauri UI events and the tray icon.
pub struct TauriPatcherEvents {
    app_handle: AppHandle,
    /// Which tray icon set this session drives. Fixed for the session's
    /// lifetime, so the phase alone decides the icon.
    is_workshop: bool,
}

impl TauriPatcherEvents {
    pub fn new(app_handle: AppHandle, is_workshop: bool) -> Self {
        Self {
            app_handle,
            is_workshop,
        }
    }
}

impl PatcherEvents for TauriPatcherEvents {
    fn phase_changed(&self, phase: PatcherPhase) {
        let _ = crate::tray::set_tray_state(
            self.app_handle.clone(),
            tray_state_for(phase, self.is_workshop),
        );
        let _ = self.app_handle.emit("patcher-status-changed", ());
    }

    fn error(&self, error: AppError) {
        let response: AppErrorResponse = error.into();
        let _ = self.app_handle.emit("patcher-error", &response);
        let _ = self.app_handle.emit("patcher-status-changed", ());
    }

    /// Through the same sink as the library's own progress, so the status keeps it as well.
    fn overlay_progress(&self, progress: OverlayProgress) {
        TauriEventSink::new(self.app_handle.clone()).emit(BackendEvent::OverlayProgress(progress));
    }

    fn wad_scan_failed(&self, failures: Vec<WadScanFailure>) {
        let payload = WadScanFailedPayload {
            failures: failures
                .into_iter()
                .map(|f| WadScanFailureInfo {
                    wad: f.wad,
                    reading: ScanStatus::parse(&f.status),
                    status: f.status,
                })
                .collect(),
        };
        let _ = self.app_handle.emit("patcher-wad-scan-failed", payload);
    }

    fn game_attached(&self, pid: Option<u64>) {
        let _ = self
            .app_handle
            .emit("patcher-game-attached", GameAttachedPayload { pid });
    }

    fn game_overlay(&self, outcome: OverlayOutcome) {
        let _ = self
            .app_handle
            .emit("patcher-game-overlay", GameOverlayPayload { outcome });
    }

    fn game_exited(&self) {
        let _ = self.app_handle.emit("patcher-game-exited", ());
    }

    fn overlay_deferred(&self) {
        let _ = self.app_handle.emit("patcher-status-changed", ());
    }

    fn incident_recorded(&self, incident: Incident) {
        let _ = self.app_handle.emit("incident-recorded", incident);
    }
}

/// The tray icon a phase maps to. Pure so the mapping is testable without an
/// `AppHandle`; it is the only thing that distinguishes a workshop session from
/// a library one.
fn tray_state_for(phase: PatcherPhase, is_workshop: bool) -> AppTrayState {
    match (phase, is_workshop) {
        (PatcherPhase::Idle, _) => AppTrayState::Default,
        (PatcherPhase::Building, false) => AppTrayState::LibraryLoading,
        (PatcherPhase::Building, true) => AppTrayState::WorkshopLoading,
        (PatcherPhase::Patching, false) => AppTrayState::LibraryOn,
        (PatcherPhase::Patching, true) => AppTrayState::WorkshopOn,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn library_session_walks_the_library_icons() {
        assert_eq!(
            tray_state_for(PatcherPhase::Building, false),
            AppTrayState::LibraryLoading
        );
        assert_eq!(
            tray_state_for(PatcherPhase::Patching, false),
            AppTrayState::LibraryOn
        );
    }

    #[test]
    fn workshop_session_walks_the_workshop_icons() {
        assert_eq!(
            tray_state_for(PatcherPhase::Building, true),
            AppTrayState::WorkshopLoading
        );
        assert_eq!(
            tray_state_for(PatcherPhase::Patching, true),
            AppTrayState::WorkshopOn
        );
    }

    /// Idle is the reset every thread exit path funnels through - a workshop
    /// session must not leave a workshop icon behind.
    #[test]
    fn idle_clears_the_icon_for_both_session_kinds() {
        assert_eq!(
            tray_state_for(PatcherPhase::Idle, false),
            AppTrayState::Default
        );
        assert_eq!(
            tray_state_for(PatcherPhase::Idle, true),
            AppTrayState::Default
        );
    }
}
