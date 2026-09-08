//! Assembling an overlay for the active profile.
//!
//! This module is the orchestration seam: it resolves what to build from the
//! library index and the user's settings, hands that to [`build::build_overlay`],
//! and decides what to do with the results. The build itself knows nothing about
//! any of that — see [`build`] for why the split is drawn there.

mod artifacts;
mod build;
mod resolve;

pub(crate) use artifacts::OverlayStorageExt;
pub use build::{OverlayBuildInputs, OverlayBuildOutcome, build_overlay};
pub(crate) use resolve::{resolve_blocked_wads, resolve_string_override_mode};

use crate::config::Config;
use crate::error::{AppResult, Utf8PathExt};
use crate::events::BackendEvent;
use crate::mods::ModLibrary;
use std::path::PathBuf;
use std::sync::Arc;

/// One completed overlay build: where it landed, plus everything it learned.
pub struct OverlayBuild {
    /// The overlay root directory - the prefix the patcher is pointed at.
    pub overlay_root: PathBuf,
    /// What the build found. Advisory data for badges and reports; pass it to
    /// [`ModLibrary::record_overlay_build`] to persist and announce it, or drop
    /// it if the frontend has no use for it.
    pub outcome: OverlayBuildOutcome,
}

impl ModLibrary {
    /// Ensure the overlay exists and is up-to-date for the current enabled mod set.
    ///
    /// Builds and returns; persisting what the build found is a separate step
    /// ([`Self::record_overlay_build`]). A caller that only wants the overlay —
    /// a CLI, say — therefore doesn't silently mutate the badge caches or fire
    /// UI events as a side effect of asking for one.
    ///
    /// Workshop project paths (if any) are loaded via `FsModContent` and prepended
    /// to the enabled mod list so they take highest priority.
    pub fn ensure_overlay(
        &self,
        config: &Config,
        workshop_project_paths: &[PathBuf],
        force_rebuild: bool,
    ) -> AppResult<OverlayBuild> {
        let storage_dir = self.storage_dir(config)?;

        storage_dir.invalidate_stale_overlays(self.app_version());

        let game_dir = crate::utils::game::GameDir::resolve(config)?;
        let (profile_slug, enabled_mods) = self.get_enabled_mods_for_overlay(config)?;

        let profile_dir = storage_dir.join("profiles").join(profile_slug.as_str());
        let overlay_root = profile_dir.join("overlay");

        // A manual rebuild discards this profile's cached overlay state so the
        // builder regenerates every WAD from scratch instead of reusing files.
        if force_rebuild {
            tracing::info!("Overlay: force rebuild requested, purging cached overlay state");
            artifacts::purge_overlay_artifacts(&profile_dir, true);
        }

        tracing::info!("Overlay: storage_dir={}", storage_dir.display());
        tracing::info!("Overlay: profile_slug={}", profile_slug);
        tracing::info!("Overlay: overlay_root={}", overlay_root.display());
        tracing::info!("Overlay: game_dir={}", game_dir.path().display());

        let mods = self.collect_overlay_mods(workshop_project_paths, enabled_mods)?;

        let utf8_state_dir = profile_dir.try_into_utf8("profile directory")?;
        artifacts::clean_corrupt_overlay_state(&utf8_state_dir);

        let available_wads = game_dir.wads().unwrap_or_else(|e| {
            tracing::warn!(
                "Failed to enumerate game WADs for regex expansion: {}; \
                 regex blocklist entries will match nothing",
                e
            );
            Vec::new()
        });
        let blocked_wads = resolve_blocked_wads(config, &available_wads);
        let string_override_mode = resolve_string_override_mode(config, &game_dir);
        tracing::info!("Overlay: blocked_wads count={}", blocked_wads.len());
        tracing::info!("Overlay: string_override_mode={:?}", string_override_mode);

        let inputs = OverlayBuildInputs {
            game_dir: game_dir.into_path().try_into_utf8("game directory")?,
            overlay_root: overlay_root.clone().try_into_utf8("overlay root")?,
            state_dir: utf8_state_dir,
            blocked_wads,
            string_override_mode,
            mods,
        };

        let progress_events = Arc::clone(self.events());
        let outcome = build_overlay(inputs, move |progress| {
            progress_events.emit(BackendEvent::OverlayProgress(progress));
        })?;

        Ok(OverlayBuild {
            overlay_root,
            outcome,
        })
    }

    /// Prepend workshop projects to the enabled mods so they take highest priority.
    fn collect_overlay_mods(
        &self,
        workshop_project_paths: &[PathBuf],
        enabled_mods: Vec<ltk_overlay::EnabledMod>,
    ) -> AppResult<Vec<ltk_overlay::EnabledMod>> {
        let enabled_ids = enabled_mods
            .iter()
            .map(|m| m.id.clone())
            .collect::<Vec<_>>();
        tracing::info!(
            "Overlay: enabled_mods={} ids=[{}]",
            enabled_ids.len(),
            enabled_ids.join(", ")
        );

        let mut all_mods = Vec::new();
        for project_path in workshop_project_paths {
            let utf8_path = project_path
                .clone()
                .try_into_utf8("workshop project path")?;
            let dir_name = project_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown");
            let id = format!("workshop:{}", dir_name);
            tracing::info!("Adding workshop project: id={}, path={}", id, utf8_path);
            all_mods.push(ltk_overlay::EnabledMod {
                id,
                content: Box::new(ltk_overlay::FsModContent::new(utf8_path)),
                enabled_layers: None,
            });
        }
        all_mods.extend(enabled_mods);
        Ok(all_mods)
    }

    /// Persist what a build found and tell the frontend the snapshots moved.
    ///
    /// The WAD reports are advisory UI data, so a failure to write them is
    /// logged and swallowed — a patch that worked must not be reported as failed
    /// because a badge cache could not be written.
    ///
    /// `OverlayBuilder::build()` emits its own `Complete` progress event before
    /// returning, so the frontend can see the build finish before these land.
    /// The dedicated events are how it learns the caches are ready to query.
    pub fn record_overlay_build(&self, outcome: OverlayBuildOutcome) {
        self.linked_bins().record(outcome.linked_bin_offenders);
        self.events().emit(BackendEvent::LinkedBinsUpdated);

        self.checksum_mismatches()
            .record(outcome.checksum_mismatches);
        self.events().emit(BackendEvent::ChecksumMismatchesUpdated);

        if outcome.mod_wad_reports.is_empty() {
            return;
        }
        match self.wad_reports().record_reports(outcome.mod_wad_reports) {
            Ok(()) => self.events().emit(BackendEvent::WadReportsUpdated),
            Err(e) => tracing::warn!("Failed to persist per-mod WAD reports: {}", e),
        }
    }

    /// Force a full rebuild of the active profile's overlay.
    ///
    /// Discards the profile's cached overlay state (patched WADs, `overlay.json`,
    /// metadata and game-index caches) so the builder regenerates everything from
    /// scratch. This is the escape hatch for the case where the incremental builder
    /// would otherwise reuse a stale or incorrectly-built overlay WAD — its reuse
    /// decision keys on the mod set and content, not on the overlay's actual bytes
    /// or the builder version.
    ///
    /// Records the build, since refreshing the stale badge caches is half of what
    /// the user is asking for when they reach for this.
    pub fn rebuild_overlay(&self, config: &Config) -> AppResult<PathBuf> {
        let build = self.ensure_overlay(config, &[], true)?;
        self.record_overlay_build(build.outcome);
        Ok(build.overlay_root)
    }
}
