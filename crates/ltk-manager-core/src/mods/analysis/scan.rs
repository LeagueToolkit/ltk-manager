//! Working out what a mod actually touches.
//!
//! Two sources feed this. The WAD footprint comes from the overlay builder and
//! is available for every format. Chunk paths are readable only in modpkgs —
//! fantome archives key their chunks by hash — so precise categorization
//! upgrades the coarse footprint result when it can and leaves it alone when it
//! can't. All of it is best-effort: a mod that fails analysis stays
//! uncategorized rather than failing its install.

use crate::config::Config;
use crate::error::{AppError, AppResult, MutexResultExt};
use crate::events::BackendEvent;
use crate::mods::index::ModArchiveFormat;
use crate::mods::{
    ChampionRoster, DerivedCategorization, ModLibrary, ModWadReport, WadReportState,
};
use camino::Utf8PathBuf;
use ltk_modpkg::Modpkg;
use std::fs::File;
use std::path::Path;
use std::sync::Arc;

impl ModLibrary {
    /// Read a modpkg's readable internal chunk paths (e.g.
    /// `assets/characters/aatrox/skins/skin01/...`) for precise categorization.
    ///
    /// Returns `Ok(None)` for fantome mods — their packed WAD chunks are keyed
    /// by hash, carrying no readable path — and for any modpkg with no usable
    /// paths. Mounting reads only the chunk table, not chunk data.
    fn modpkg_chunk_paths(&self, config: &Config, mod_id: &str) -> AppResult<Option<Vec<String>>> {
        self.with_index(config, |storage_dir, index| {
            let entry = index
                .mods
                .iter()
                .find(|m| m.id == mod_id)
                .ok_or_else(|| AppError::ModNotFound(mod_id.to_string()))?;

            if !matches!(entry.format, ModArchiveFormat::Modpkg) {
                return Ok(None);
            }

            let archive_path = entry.archive_path(storage_dir);
            let modpkg = Modpkg::mount_from_reader(File::open(&archive_path)?)
                .map_err(|e| AppError::Other(format!("Failed to mount modpkg: {}", e)))?;
            let paths: Vec<String> = modpkg.chunk_paths().values().cloned().collect();
            Ok((!paths.is_empty()).then_some(paths))
        })
    }

    /// Upgrade a report's `derived` to precise chunk-path classification when the
    /// mod is a modpkg. A no-op (keeping the coarse WAD-footprint result) for
    /// fantome mods or on any failure — categorization is best-effort and must
    /// never block analysis. `game_dir` is the `Game/` directory containing
    /// `DATA/FINAL`, used to build the champion roster.
    pub fn apply_precise_categorization(
        &self,
        config: &Config,
        game_dir: &Path,
        report: &mut ModWadReport,
    ) {
        let chunk_paths = match self.modpkg_chunk_paths(config, &report.mod_id) {
            Ok(Some(paths)) => paths,
            Ok(None) => return,
            Err(e) => {
                tracing::debug!("No chunk paths for {}: {}", report.mod_id, e);
                return;
            }
        };

        let roster = ChampionRoster::from_internal_names(
            crate::utils::game::GameDir::from_path(game_dir).champion_names(),
        );
        let precise = DerivedCategorization::from_chunk_paths(&chunk_paths, &roster);
        if !precise.is_empty() {
            report.derived = precise;
        }
    }

    /// Best-effort: analyze one mod's WAD footprint and persist the report so
    /// auto-categorization is available without an explicit "Analyze" click.
    ///
    /// Returns `None` (logged) when no League path is configured or the
    /// analysis fails for any reason — categorization must never block or fail
    /// an install. Used by the post-install background pass in `commands::mods`.
    pub fn try_analyze_and_record(
        &self,
        config: &Config,
        reports: &WadReportState,
        mod_id: &str,
    ) -> Option<ModWadReport> {
        let game_dir = match crate::utils::game::GameDir::resolve(config) {
            Ok(dir) => dir.into_path(),
            Err(e) => {
                tracing::info!("Skipping WAD analysis for {mod_id}: {e}");
                return None;
            }
        };

        let (profile_dir, mut enabled_mod) = match self.build_single_mod_provider(config, mod_id) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!("Could not build content provider for {mod_id}: {e}");
                return None;
            }
        };

        let (Ok(utf8_game_dir), Ok(utf8_state_dir)) = (
            Utf8PathBuf::from_path_buf(game_dir),
            Utf8PathBuf::from_path_buf(profile_dir),
        ) else {
            tracing::warn!("Non-UTF8 path while analyzing {mod_id}; skipping");
            return None;
        };

        let upstream = match ltk_overlay::OverlayBuilder::analyze_single_mod(
            &utf8_game_dir,
            &utf8_state_dir,
            &mut enabled_mod,
        ) {
            Ok(u) => u,
            Err(e) => {
                tracing::warn!("WAD analysis failed for {mod_id}: {e}");
                return None;
            }
        };

        let mut report = ModWadReport::from_upstream(upstream);
        self.apply_precise_categorization(config, utf8_game_dir.as_std_path(), &mut report);
        match reports.0.lock().mutex_err() {
            Ok(mut store) => {
                if let Err(e) = store.upsert(report.clone()) {
                    tracing::warn!("Failed to persist WAD report for {mod_id}: {e}");
                    return None;
                }
            }
            Err(e) => {
                tracing::warn!("WAD report store lock poisoned for {mod_id}: {e}");
                return None;
            }
        }
        Some(report)
    }

    /// Compute WAD footprint reports for freshly installed mods on a detached
    /// background thread, then emit `wad-reports-updated` once so the UI refetches.
    /// Best-effort: never blocks or fails the install — a missing League path
    /// or analysis error just leaves the mod uncategorized until the user analyzes it manually.
    pub fn spawn_categorization(&self, config: &Config, mod_ids: Vec<String>) {
        if mod_ids.is_empty() {
            return;
        }

        let library = self.clone();
        let config = config.clone();
        let events = Arc::clone(self.events());
        let reports = Arc::clone(self.wad_reports());
        std::thread::spawn(move || {
            let mut recorded_any = false;
            for id in &mod_ids {
                if library
                    .try_analyze_and_record(&config, &reports, id)
                    .is_some()
                {
                    recorded_any = true;
                }
            }

            if recorded_any {
                events.emit(BackendEvent::WadReportsUpdated);
            }
        });
    }
}
