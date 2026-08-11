//! Tauri adapter for the core patcher thread.
//!
//! The session logic itself lives in [`ltk_manager_core::patcher::thread`]; what
//! stays here is the [`PatcherEvents`] implementation that turns its
//! notifications into frontend events and tray-icon changes, plus the `ts-rs`
//! payload types those events carry.

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use ts_rs::TS;

use crate::error::{AppError, AppErrorResponse};
use crate::tray::AppTrayState;
use ltk_manager_core::patcher::events::PatcherEvents;
use ltk_manager_core::patcher::injector::WadScanFailure;
use ltk_manager_core::patcher::PatcherPhase;

/// One archive that failed the integrity scan, sent in [`WadScanFailedPayload`].
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct WadScanFailureInfo {
    /// The offending archive (e.g. `TahmKench.wad.client`), if its name parsed.
    pub wad: Option<String>,
    /// The NTSTATUS-style code the scan reported (e.g. `c0000229` skinhack,
    /// `c000003e` corrupt WAD).
    pub status: String,
}

/// Payload for the `patcher-wad-scan-failed` event, emitted when the injected
/// DLL's integrity scan rejects one or more modded archives. When this fires
/// the patcher auto-stops and applies no mods for the session.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct WadScanFailedPayload {
    /// The archives that failed the scan, de-duplicated. May be empty if no
    /// names could be parsed from the scan log.
    pub failures: Vec<WadScanFailureInfo>,
}

/// Payload for the `linked-bins-warning` event, emitted after a patcher start whose
/// single overlay build found enabled mods with unresolved linked dependencies (only
/// when `linked_bin_check_enabled`). Injection is non-fatal, so this never blocks the
/// start - it drives a non-blocking toast. The per-mod badges and the reachable
/// `LinkedBinWarningDialog` carry the detail (fetched via `get_linked_bin_offenders`).
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LinkedBinWarningPayload {
    /// Number of enabled mods flagged in the latest build.
    pub count: u32,
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
        // The frontend keeps a slow polling fallback, but lifecycle transitions
        // should be visible immediately rather than up to one poll interval late.
        let _ = self.app_handle.emit("patcher-status-changed", phase);
        let _ = crate::tray::set_tray_state(
            self.app_handle.clone(),
            tray_state_for(phase, self.is_workshop),
        );
    }

    fn error(&self, error: AppError) {
        let response: AppErrorResponse = error.into();
        let _ = self.app_handle.emit("patcher-error", &response);
    }

    fn wad_scan_failed(&self, failures: Vec<WadScanFailure>) {
        let payload = WadScanFailedPayload {
            failures: failures
                .into_iter()
                .map(|f| WadScanFailureInfo {
                    wad: f.wad,
                    status: f.status,
                })
                .collect(),
        };
        let _ = self.app_handle.emit("patcher-wad-scan-failed", payload);
    }

    fn linked_bin_warning(&self, count: u32) {
        let _ = self
            .app_handle
            .emit("linked-bins-warning", LinkedBinWarningPayload { count });
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
