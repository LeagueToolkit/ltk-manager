use crate::error::{AppError, AppResult};
use crate::mods::{ModLibrary, WadReportState};
use crate::state::{Settings, WadBlocklistEntry};
use camino::Utf8PathBuf;
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager};

const SCRIPTS_WAD: &str = "scripts.wad.client";
const TFT_WAD: &str = "map22.wad.client";

#[derive(Clone, serde::Serialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum OverlayStage {
    Indexing,
    Collecting,
    Patching,
    Strings,
    Complete,
}

/// Progress event emitted during overlay building.
#[derive(Clone, serde::Serialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct OverlayProgress {
    pub stage: OverlayStage,
    pub current_file: Option<String>,
    pub current: u32,
    pub total: u32,
}

impl ModLibrary {
    /// Ensure the overlay exists and is up-to-date for the current enabled mod set.
    ///
    /// Returns the overlay root directory (the prefix passed to the legacy patcher).
    ///
    /// Workshop project paths (if any) are loaded via `FsModContent` and prepended
    /// to the enabled mod list so they take highest priority.
    pub fn ensure_overlay(
        &self,
        settings: &Settings,
        workshop_project_paths: &[PathBuf],
    ) -> AppResult<PathBuf> {
        let storage_dir = self.storage_dir(settings)?;
        let game_dir = resolve_game_dir(settings)?;
        let (profile_slug, enabled_mods) = self.get_enabled_mods_for_overlay(settings)?;

        let profile_dir = storage_dir.join("profiles").join(profile_slug.as_str());
        let overlay_root = profile_dir.join("overlay");

        tracing::info!("Overlay: storage_dir={}", storage_dir.display());
        tracing::info!("Overlay: profile_slug={}", profile_slug);
        tracing::info!("Overlay: overlay_root={}", overlay_root.display());
        tracing::info!("Overlay: game_dir={}", game_dir.display());

        let enabled_ids = enabled_mods
            .iter()
            .map(|m| m.id.clone())
            .collect::<Vec<_>>();
        tracing::info!(
            "Overlay: enabled_mods={} ids=[{}]",
            enabled_ids.len(),
            enabled_ids.join(", ")
        );

        let utf8_game_dir = Utf8PathBuf::from_path_buf(game_dir.clone()).map_err(|p| {
            AppError::Other(format!("Non-UTF-8 game directory path: {}", p.display()))
        })?;
        let utf8_overlay_root = Utf8PathBuf::from_path_buf(overlay_root.clone()).map_err(|p| {
            AppError::Other(format!("Non-UTF-8 overlay root path: {}", p.display()))
        })?;
        let utf8_state_dir = Utf8PathBuf::from_path_buf(profile_dir).map_err(|p| {
            AppError::Other(format!("Non-UTF-8 profile directory path: {}", p.display()))
        })?;

        let available_wads = list_game_wads(&game_dir).unwrap_or_else(|e| {
            tracing::warn!(
                "Failed to enumerate game WADs for regex expansion: {}; \
                 regex blocklist entries will match nothing",
                e
            );
            Vec::new()
        });
        let blocked_wads = resolve_blocked_wads(settings, &available_wads);
        tracing::info!("Overlay: blocked_wads count={}", blocked_wads.len());

        Self::clean_corrupt_overlay_state(&utf8_state_dir);

        let app_handle_clone = self.app_handle().clone();
        let mut builder =
            ltk_overlay::OverlayBuilder::new(utf8_game_dir, utf8_overlay_root, utf8_state_dir)
                .with_blocked_wads(blocked_wads)
                .with_progress(move |progress| {
                    let stage = match progress.stage {
                        ltk_overlay::OverlayStage::Indexing => OverlayStage::Indexing,
                        ltk_overlay::OverlayStage::CollectingOverrides => OverlayStage::Collecting,
                        ltk_overlay::OverlayStage::PatchingWad => OverlayStage::Patching,
                        ltk_overlay::OverlayStage::ApplyingStringOverrides => OverlayStage::Strings,
                        ltk_overlay::OverlayStage::Complete => OverlayStage::Complete,
                    };
                    let _ = app_handle_clone.emit(
                        "overlay-progress",
                        OverlayProgress {
                            stage,
                            current_file: progress.current_file,
                            current: progress.current,
                            total: progress.total,
                        },
                    );
                });

        let mut all_mods = Vec::new();
        for project_path in workshop_project_paths {
            let utf8_path = Utf8PathBuf::from_path_buf(project_path.clone()).map_err(|p| {
                AppError::Other(format!("Non-UTF-8 workshop project path: {}", p.display()))
            })?;
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
        builder.set_enabled_mods(all_mods);

        builder
            .build()
            .map_err(|e| AppError::Other(format!("Overlay build failed: {}", e)))?;

        // Capture per-mod WAD reports for the library badge UI. Failure to
        // persist must not fail the patch — log and continue.
        //
        // Note: `OverlayBuilder::build()` emits its own `Complete` progress event
        // *before* returning, so the frontend may see that event before the reports
        // are persisted. We emit a dedicated `wad-reports-updated` event after
        // persisting so the frontend knows the cache is ready to query.
        let reports = builder.take_mod_wad_reports();
        if !reports.is_empty() {
            if let Some(state) = self.app_handle().try_state::<WadReportState>() {
                if let Err(e) = state.record_reports(reports) {
                    tracing::warn!("Failed to persist per-mod WAD reports: {}", e);
                } else {
                    let _ = self.app_handle().emit("wad-reports-updated", ());
                }
            }
        }

        Ok(overlay_root)
    }

    /// Scan `state_dir` for top-level JSON files that are empty or contain invalid
    /// JSON and remove them so `ltk_overlay` does not fail to parse stale/corrupt
    /// state files written by a previous run that was interrupted mid-write.
    fn clean_corrupt_overlay_state(state_dir: &camino::Utf8Path) {
        let entries = match std::fs::read_dir(state_dir) {
            Ok(e) => e,
            Err(_) => return,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                continue;
            }
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let contents = match std::fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            if contents.trim().is_empty()
                || serde_json::from_str::<serde_json::Value>(&contents).is_err()
            {
                tracing::warn!(
                    "Removing corrupt overlay state file before build: {}",
                    path.display()
                );
                let _ = std::fs::remove_file(&path);
            }
        }
    }
}

/// Resolve the user's blocklist settings into a concrete, deduped list of WAD
/// filenames to hand to `ltk_overlay::OverlayBuilder::with_blocked_wads`.
///
/// - `Exact` entries are lowercased and passed through as-is.
/// - `Regex` entries are compiled case-insensitively and expanded against
///   `available_wads`; invalid patterns are logged and skipped so one bad entry
///   can't break the whole patch.
/// - `block_scripts_wad` and `!patch_tft` add their respective WADs.
///
/// `available_wads` should come from `list_game_wads`; pass an empty slice if
/// enumeration failed (regex entries then match nothing).
pub(crate) fn resolve_blocked_wads(settings: &Settings, available_wads: &[String]) -> Vec<String> {
    let mut blocked: Vec<String> = Vec::new();

    for entry in &settings.wad_blocklist {
        match entry {
            WadBlocklistEntry::Exact { value } => {
                blocked.push(value.to_lowercase());
            }
            WadBlocklistEntry::Regex { value } => {
                match regex::Regex::new(&format!("(?i){}", value)) {
                    Ok(re) => {
                        for wad in available_wads {
                            if re.is_match(wad) {
                                blocked.push(wad.clone());
                            }
                        }
                    }
                    Err(e) => {
                        tracing::warn!("Invalid regex in wad_blocklist {:?}: {}", value, e);
                    }
                }
            }
        }
    }

    if settings.block_scripts_wad {
        blocked.push(SCRIPTS_WAD.to_string());
    }
    if !settings.patch_tft {
        blocked.push(TFT_WAD.to_string());
    }

    blocked.sort();
    blocked.dedup();
    blocked
}

/// Enumerate every `.wad` / `.wad.client` filename under the game's `DATA` directory.
///
/// Returns lowercased, deduplicated filenames (not paths) sorted alphabetically.
/// The WAD filename space is effectively flat from the overlay's perspective —
/// `OverlayBuilder::with_blocked_wads` matches by filename only — so we discard
/// the directory part.
pub(crate) fn list_game_wads(game_dir: &Path) -> AppResult<Vec<String>> {
    let data_dir = game_dir.join("DATA");
    if !data_dir.exists() {
        return Err(AppError::ValidationFailed(format!(
            "Game DATA directory does not exist: {}",
            data_dir.display()
        )));
    }

    let mut out: Vec<String> = Vec::new();
    let mut stack: Vec<PathBuf> = vec![data_dir];
    while let Some(dir) = stack.pop() {
        let read = match std::fs::read_dir(&dir) {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("Failed to read {}: {}", dir.display(), e);
                continue;
            }
        };
        for entry in read.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            let lower = name.to_ascii_lowercase();
            if lower.ends_with(".wad") || lower.ends_with(".wad.client") {
                out.push(lower);
            }
        }
    }

    out.sort();
    out.dedup();
    Ok(out)
}

pub(crate) fn resolve_game_dir(settings: &Settings) -> AppResult<PathBuf> {
    let league_root = settings
        .league_path
        .clone()
        .ok_or_else(|| AppError::ValidationFailed("League path is not configured".to_string()))?;

    // Users might configure either the install root (…/League of Legends) or the Game dir (…/League of Legends/Game).
    // Accept both.
    let game_dir = league_root.join("Game");
    if game_dir.exists() {
        return Ok(game_dir);
    }
    if league_root.join("DATA").exists() {
        return Ok(league_root);
    }

    Err(AppError::ValidationFailed(format!(
        "League path does not look like an install root or a Game directory: {}",
        league_root.display()
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use assert_matches::assert_matches;

    #[test]
    fn resolve_game_dir_no_league_path() {
        let settings = Settings::default();
        assert_matches!(
            resolve_game_dir(&settings),
            Err(AppError::ValidationFailed(_))
        );
    }

    #[test]
    fn resolve_game_dir_with_game_subdir() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("Game")).unwrap();

        let settings = Settings {
            league_path: Some(dir.path().to_path_buf()),
            ..Settings::default()
        };
        let result = resolve_game_dir(&settings).unwrap();
        assert!(result.ends_with("Game"));
    }

    #[test]
    fn resolve_game_dir_with_data_dir() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("DATA")).unwrap();

        let settings = Settings {
            league_path: Some(dir.path().to_path_buf()),
            ..Settings::default()
        };
        let result = resolve_game_dir(&settings).unwrap();
        assert_eq!(result, dir.path().to_path_buf());
    }

    #[test]
    fn resolve_game_dir_neither_dir() {
        let dir = tempfile::tempdir().unwrap();
        let settings = Settings {
            league_path: Some(dir.path().to_path_buf()),
            ..Settings::default()
        };
        assert_matches!(
            resolve_game_dir(&settings),
            Err(AppError::ValidationFailed(_))
        );
    }

    #[test]
    fn list_game_wads_finds_nested_wads_and_lowercases() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("DATA");
        let final_dir = data.join("FINAL").join("Champions");
        std::fs::create_dir_all(&final_dir).unwrap();
        std::fs::write(final_dir.join("Aatrox.wad.client"), b"").unwrap();
        std::fs::write(final_dir.join("Ahri.wad.client"), b"").unwrap();
        std::fs::write(data.join("Shared.wad"), b"").unwrap();
        std::fs::write(final_dir.join("not-a-wad.txt"), b"").unwrap();

        let wads = list_game_wads(dir.path()).unwrap();
        assert!(wads.contains(&"aatrox.wad.client".to_string()));
        assert!(wads.contains(&"ahri.wad.client".to_string()));
        assert!(wads.contains(&"shared.wad".to_string()));
        assert_eq!(wads.len(), 3);
    }

    #[test]
    fn resolve_blocked_wads_exact_lowercased_and_scripts_added_by_default() {
        let settings = Settings {
            wad_blocklist: vec![WadBlocklistEntry::Exact {
                value: "Aatrox.wad.client".to_string(),
            }],
            ..Settings::default()
        };
        let result = resolve_blocked_wads(&settings, &[]);
        assert!(result.contains(&"aatrox.wad.client".to_string()));
        assert!(result.contains(&"scripts.wad.client".to_string()));
        assert!(result.contains(&"map22.wad.client".to_string()));
    }

    #[test]
    fn resolve_blocked_wads_regex_expanded_against_available() {
        let settings = Settings {
            block_scripts_wad: false,
            patch_tft: true,
            wad_blocklist: vec![WadBlocklistEntry::Regex {
                value: r"^map\d+\.en_us\.wad\.client$".to_string(),
            }],
            ..Settings::default()
        };
        let available = vec![
            "map11.en_us.wad.client".to_string(),
            "map12.wad.client".to_string(),
            "map22.en_us.wad.client".to_string(),
            "aatrox.wad.client".to_string(),
        ];
        let result = resolve_blocked_wads(&settings, &available);
        assert_eq!(
            result,
            vec![
                "map11.en_us.wad.client".to_string(),
                "map22.en_us.wad.client".to_string(),
            ]
        );
    }

    #[test]
    fn resolve_blocked_wads_invalid_regex_skipped_and_others_kept() {
        let settings = Settings {
            block_scripts_wad: false,
            patch_tft: true,
            wad_blocklist: vec![
                WadBlocklistEntry::Regex {
                    value: "[bad(".to_string(),
                },
                WadBlocklistEntry::Exact {
                    value: "keeper.wad.client".to_string(),
                },
            ],
            ..Settings::default()
        };
        let result = resolve_blocked_wads(&settings, &[]);
        assert_eq!(result, vec!["keeper.wad.client".to_string()]);
    }

    #[test]
    fn resolve_blocked_wads_dedupes_overlapping_entries() {
        let settings = Settings {
            block_scripts_wad: true,
            patch_tft: true,
            wad_blocklist: vec![
                WadBlocklistEntry::Exact {
                    value: "Scripts.wad.client".to_string(),
                },
                WadBlocklistEntry::Regex {
                    value: "^scripts".to_string(),
                },
            ],
            ..Settings::default()
        };
        let available = vec!["scripts.wad.client".to_string()];
        let result = resolve_blocked_wads(&settings, &available);
        assert_eq!(result, vec!["scripts.wad.client".to_string()]);
    }

    #[test]
    fn list_game_wads_errors_when_data_missing() {
        let dir = tempfile::tempdir().unwrap();
        assert_matches!(
            list_game_wads(dir.path()),
            Err(AppError::ValidationFailed(_))
        );
    }

    #[test]
    fn overlay_stage_serialization() {
        assert_eq!(
            serde_json::to_string(&OverlayStage::Indexing).unwrap(),
            "\"indexing\""
        );
        assert_eq!(
            serde_json::to_string(&OverlayStage::Collecting).unwrap(),
            "\"collecting\""
        );
        assert_eq!(
            serde_json::to_string(&OverlayStage::Patching).unwrap(),
            "\"patching\""
        );
        assert_eq!(
            serde_json::to_string(&OverlayStage::Strings).unwrap(),
            "\"strings\""
        );
        assert_eq!(
            serde_json::to_string(&OverlayStage::Complete).unwrap(),
            "\"complete\""
        );
    }

    #[test]
    fn overlay_progress_serialization() {
        let progress = OverlayProgress {
            stage: OverlayStage::Patching,
            current_file: Some("test.wad.client".to_string()),
            current: 5,
            total: 10,
        };
        let json = serde_json::to_value(&progress).unwrap();
        assert_eq!(json["stage"], "patching");
        assert_eq!(json["currentFile"], "test.wad.client");
        assert_eq!(json["current"], 5);
        assert_eq!(json["total"], 10);
    }
}
