//! Transient record of linked-bin offenders from the most recent overlay build.
//!
//! Unlike [`crate::mods::WadReportState`], offender status is **not** a stable
//! per-mod property: whether a mod's linked bins resolve depends on the entire
//! enabled set in a given build (another enabled mod can supply the dependency).
//! So this is deliberately in-memory only and replaced wholesale on every build —
//! persisting it across restarts could surface warnings that no longer hold.

use crate::error::{AppResult, MutexResultExt};
use serde::Serialize;
use std::sync::Mutex;

/// One library mod whose property-bins reference linked dependencies no archive
/// the game mounts can answer.
///
/// The lookup is across every mounted archive rather than inside the one the
/// declaring bin came from, so what the check tests is presence anywhere in the
/// built overlay bar the archives the user blocked.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct LinkedBinOffenderInfo {
    /// Library mod id (matches `InstalledMod.id` on the frontend).
    pub mod_id: String,
    /// Mod display name — a fallback for the UI when it can't resolve the id.
    pub display_name: String,
    /// WAD targets (e.g. `Ahri.wad.client`) in this mod that contain the unresolved
    /// bins. May be empty when the offending bin came from a RAW override.
    pub wads: Vec<String>,
    /// The missing linked bin paths, deduped.
    pub missing_links: Vec<String>,
}

/// Tauri-managed snapshot of the offenders found in the latest overlay build.
#[derive(Default)]
pub struct LinkedBinState(pub Mutex<Vec<LinkedBinOffenderInfo>>);

impl LinkedBinState {
    /// Replace the stored offenders with a fresh build's results. `display_name`
    /// is seeded with the mod id; the read command resolves real names from the
    /// library so this stays decoupled from the index.
    pub fn record(&self, offenders: Vec<ltk_overlay::LinkedBinOffender>) -> AppResult<()> {
        let converted = offenders
            .into_iter()
            .map(|o| LinkedBinOffenderInfo {
                display_name: o.mod_id.clone(),
                mod_id: o.mod_id,
                wads: o.wads,
                missing_links: o.missing_links,
            })
            .collect();
        *self.0.lock().mutex_err()? = converted;
        Ok(())
    }

    /// Snapshot the current offenders.
    pub fn get_all(&self) -> AppResult<Vec<LinkedBinOffenderInfo>> {
        Ok(self.0.lock().mutex_err()?.clone())
    }
}
