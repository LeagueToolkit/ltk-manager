//! Persistent per-mod WAD footprint reports.
//!
//! See `specs/010-mod-wad-report` for the design. Reports describe which game
//! WADs each mod's overrides land in, computed independently of other mods.
//! They're produced as a side effect of [`crate::overlay::ensure_overlay`] and
//! on demand via the `analyze_mod_wads` Tauri command.

use super::categorize::DerivedCategorization;
use crate::error::AppResult;
use crate::utils::fs::write_json;
use fs_err as fs;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};

const WAD_REPORTS_FILENAME: &str = "wad-reports.json";
/// v2 added the persisted `derived` categorization. Older (`v1`) caches load
/// fine — their missing `derived` defaults to empty and is recomputed coarsely
/// from `affected_wads` on read, then upgraded to precise on the next analysis.
const SCHEMA_VERSION: u32 = 2;

/// Per-mod WAD footprint summary sent across the IPC boundary.
///
/// Mirrors `ltk_overlay::ModWadReport` but adds the `is_stale` flag derived
/// at read time.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ModWadReport {
    pub mod_id: String,
    pub affected_wads: Vec<String>,
    pub wad_count: u32,
    pub override_count: u32,
    pub content_fingerprint: Option<u64>,
    pub game_index_fingerprint: u64,
    /// ISO-8601 timestamp the report was computed.
    pub computed_at: String,
    /// `true` when the cached report's fingerprints no longer match the
    /// current values; computed on read, never persisted.
    #[serde(default)]
    pub is_stale: bool,
    /// Champions / maps / tags derived from the mod's contents. Computed at
    /// analysis time — precisely from a modpkg's chunk paths when available,
    /// otherwise coarsely from `affected_wads` — and persisted so reads don't
    /// re-open the archive. Improving the classifier takes effect on the next
    /// analysis (e.g. reinstall or "Analyze uncategorized").
    #[serde(default)]
    pub derived: DerivedCategorization,
}

impl ModWadReport {
    /// Construct from an upstream `ltk_overlay::ModWadReport`. Always fresh
    /// (`is_stale = false`); the store flips that flag on subsequent reads.
    pub fn from_upstream(report: ltk_overlay::ModWadReport) -> Self {
        // Split the upstream per-WAD entries into the path list we keep and a
        // transient path→count map. The counts feed the coarse classifier's
        // spillover suppression but aren't stored — only the resulting `derived`
        // is persisted.
        let mut affected_wads = Vec::with_capacity(report.affected_wads.len());
        let mut overrides_per_wad = HashMap::with_capacity(report.affected_wads.len());
        for wad in report.affected_wads {
            let path = String::from(wad.path);
            overrides_per_wad.insert(path.clone(), wad.override_count);
            affected_wads.push(path);
        }

        let wad_count = affected_wads.len() as u32;
        let derived = DerivedCategorization::from_wad_footprint(&affected_wads, &overrides_per_wad);
        Self {
            mod_id: report.mod_id,
            affected_wads,
            wad_count,
            override_count: report.override_count,
            content_fingerprint: report.content_fingerprint,
            game_index_fingerprint: report.game_index_fingerprint,
            computed_at: chrono::Utc::now().to_rfc3339(),
            is_stale: false,
            derived,
        }
    }
}

/// Persisted form. Same shape as [`ModWadReport`] minus `is_stale`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedWadReport {
    mod_id: String,
    affected_wads: Vec<String>,
    wad_count: u32,
    override_count: u32,
    content_fingerprint: Option<u64>,
    game_index_fingerprint: u64,
    computed_at: String,
    /// Explicitly flagged by the reconcile pass when the archive's mtime
    /// indicates the content has changed since this report was computed.
    /// Orthogonal to game-index staleness.
    #[serde(default)]
    content_stale: bool,
    /// Categorization captured at analysis time. Absent on `v1` caches.
    #[serde(default)]
    derived: DerivedCategorization,
}

impl CachedWadReport {
    fn from_report(report: ModWadReport) -> Self {
        Self {
            mod_id: report.mod_id,
            affected_wads: report.affected_wads,
            wad_count: report.wad_count,
            override_count: report.override_count,
            content_fingerprint: report.content_fingerprint,
            game_index_fingerprint: report.game_index_fingerprint,
            computed_at: report.computed_at,
            content_stale: false,
            derived: report.derived,
        }
    }

    fn into_report(self, game_index_stale: bool) -> ModWadReport {
        let mut report = ModWadReport {
            mod_id: self.mod_id,
            affected_wads: self.affected_wads,
            wad_count: self.wad_count,
            override_count: self.override_count,
            content_fingerprint: self.content_fingerprint,
            game_index_fingerprint: self.game_index_fingerprint,
            computed_at: self.computed_at,
            is_stale: game_index_stale || self.content_stale,
            derived: self.derived,
        };
        // Pre-v2 caches (and any mod analyzed before precise classification)
        // carry no persisted categorization — recompute it coarsely on read.
        if report.derived.is_empty() {
            report.derived = report.derive_categorization();
        }
        report
    }
}

/// On-disk schema for `wad-reports.json`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WadReportFile {
    version: u32,
    /// Most recently observed game-index fingerprint. Used to flag staleness
    /// when a previously cached report was computed against an older game.
    current_game_index_fp: Option<u64>,
    reports: BTreeMap<String, CachedWadReport>,
}

/// Persistent map of mod id → WAD report.
///
/// Lives behind a [`WadReportState`] mutex. All mutating methods persist to
/// disk via temp-file-then-rename before returning.
pub struct WadReportStore {
    path: Option<PathBuf>,
    file: WadReportFile,
}

impl WadReportStore {
    /// Load reports from `{storage_dir}/wad-reports.json`. A missing or
    /// corrupted file is tolerated by starting from an empty store and
    /// logging at WARN — see FR-012 / SC-006.
    pub fn load(storage_dir: Option<&Path>) -> Self {
        let Some(storage_dir) = storage_dir else {
            return Self {
                path: None,
                file: WadReportFile {
                    version: SCHEMA_VERSION,
                    ..Default::default()
                },
            };
        };

        let path = storage_dir.join(WAD_REPORTS_FILENAME);
        if !path.exists() {
            return Self {
                path: Some(path),
                file: WadReportFile {
                    version: SCHEMA_VERSION,
                    ..Default::default()
                },
            };
        }

        let file = match fs::read_to_string(&path) {
            Ok(contents) => match serde_json::from_str::<WadReportFile>(&contents) {
                Ok(f) => f,
                Err(e) => {
                    tracing::warn!(
                        "WAD report cache at {} is corrupt, starting empty: {}",
                        path.display(),
                        e
                    );
                    WadReportFile {
                        version: SCHEMA_VERSION,
                        ..Default::default()
                    }
                }
            },
            Err(e) => {
                tracing::warn!(
                    "Failed to read WAD report cache at {}, starting empty: {}",
                    path.display(),
                    e
                );
                WadReportFile {
                    version: SCHEMA_VERSION,
                    ..Default::default()
                }
            }
        };

        Self {
            path: Some(path),
            file,
        }
    }

    /// `true` when `fingerprint` differs from the most recently observed
    /// game-index fingerprint. An unknown current fingerprint is treated as
    /// not-stale (nothing to compare against yet).
    fn game_index_stale(&self, fingerprint: u64) -> bool {
        self.file
            .current_game_index_fp
            .is_some_and(|current| current != fingerprint)
    }

    /// Read a single report, deriving `is_stale` against the most recently
    /// observed game-index fingerprint stored alongside the cache.
    pub fn get(&self, mod_id: &str) -> Option<ModWadReport> {
        let cached = self.file.reports.get(mod_id)?.clone();
        let is_stale = self.game_index_stale(cached.game_index_fingerprint);
        Some(cached.into_report(is_stale))
    }

    /// Read all reports, deriving `is_stale` for each entry.
    pub fn get_all(&self) -> std::collections::HashMap<String, ModWadReport> {
        self.file
            .reports
            .iter()
            .map(|(id, cached)| {
                let is_stale = self.game_index_stale(cached.game_index_fingerprint);
                (id.clone(), cached.clone().into_report(is_stale))
            })
            .collect()
    }

    /// Insert or replace a single report and persist.
    pub fn upsert(&mut self, report: ModWadReport) -> AppResult<()> {
        self.upsert_many(vec![report])
    }

    /// Bulk insert; persists once at the end.
    pub fn upsert_many(&mut self, reports: Vec<ModWadReport>) -> AppResult<()> {
        if reports.is_empty() {
            return Ok(());
        }
        // All reports in a batch come from the same build/analyze call and
        // share one game-index fingerprint. Record it as the "current" value
        // so subsequent `get()` calls can flag older reports as stale.
        if let Some(first) = reports.first() {
            self.file.current_game_index_fp = Some(first.game_index_fingerprint);
        }
        for report in reports {
            self.file
                .reports
                .insert(report.mod_id.clone(), CachedWadReport::from_report(report));
        }
        self.save()
    }

    /// Mark cached reports as content-stale for the given mod IDs. The next
    /// [`get`](Self::get) will surface `is_stale = true` for each affected
    /// entry. Persists once at the end.
    ///
    /// Used by the reconcile pass when external archive edits are detected.
    pub fn invalidate_by_content(&mut self, mod_ids: &[String]) -> AppResult<()> {
        let mut changed = false;
        for mod_id in mod_ids {
            if let Some(entry) = self.file.reports.get_mut(mod_id.as_str())
                && !entry.content_stale
            {
                entry.content_stale = true;
                changed = true;
            }
        }
        if changed {
            self.save()?;
        }
        Ok(())
    }

    /// Drop reports for mods no longer in the library.
    pub fn prune_orphans(&mut self, valid_ids: &HashSet<String>) -> AppResult<()> {
        let before = self.file.reports.len();
        self.file.reports.retain(|id, _| valid_ids.contains(id));
        if self.file.reports.len() != before {
            self.save()?;
        }
        Ok(())
    }

    fn save(&self) -> AppResult<()> {
        let Some(path) = &self.path else {
            return Ok(());
        };
        let mut to_save = self.file.clone();
        to_save.version = SCHEMA_VERSION;
        write_json(path, &to_save)
    }
}

/// Tauri-managed wrapper around [`WadReportStore`].
pub struct WadReportState(pub Mutex<WadReportStore>);

impl WadReportState {
    pub fn new(storage_dir: Option<&Path>) -> Self {
        Self(Mutex::new(WadReportStore::load(storage_dir)))
    }

    /// Convenience: lock and call [`WadReportStore::upsert_many`] from the
    /// overlay piggyback path.
    pub fn record_reports(&self, reports: Vec<ltk_overlay::ModWadReport>) -> AppResult<()> {
        if reports.is_empty() {
            return Ok(());
        }
        let converted: Vec<ModWadReport> = reports
            .into_iter()
            .map(ModWadReport::from_upstream)
            .collect();
        let mut store = self.0.lock();
        store.upsert_many(converted)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn sample_report(id: &str, gif: u64) -> ModWadReport {
        ModWadReport {
            mod_id: id.to_string(),
            affected_wads: vec!["DATA/FINAL/Champions/Aatrox.wad.client".to_string()],
            wad_count: 1,
            override_count: 5,
            content_fingerprint: Some(0xABCD),
            game_index_fingerprint: gif,
            computed_at: "2026-04-08T00:00:00Z".to_string(),
            is_stale: false,
            derived: DerivedCategorization::default(),
        }
    }

    #[test]
    fn load_missing_file_starts_empty() {
        let dir = tempdir().unwrap();
        let store = WadReportStore::load(Some(dir.path()));
        assert!(store.get("anything").is_none());
    }

    #[test]
    fn load_corrupt_file_starts_empty() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join(WAD_REPORTS_FILENAME), "{ this is not json").unwrap();
        let store = WadReportStore::load(Some(dir.path()));
        assert!(store.get("anything").is_none());
    }

    #[test]
    fn upsert_and_get_round_trip() {
        let dir = tempdir().unwrap();
        let mut store = WadReportStore::load(Some(dir.path()));
        store.upsert(sample_report("mod-a", 100)).unwrap();
        let got = store.get("mod-a").unwrap();
        assert_eq!(got.mod_id, "mod-a");
        assert_eq!(got.wad_count, 1);
        assert!(!got.is_stale);
        // The sample carries no persisted `derived`, so it's recomputed coarsely
        // from the cached footprint on read.
        assert_eq!(got.derived.champions, vec!["Aatrox"]);
        assert_eq!(got.derived.tags, vec!["champion-skin"]);
    }

    #[test]
    fn persisted_precise_derived_survives_round_trip() {
        let dir = tempdir().unwrap();
        let mut report = sample_report("mod-a", 100);
        // A precise (chunk-path) classification that the coarse footprint could
        // never produce — e.g. a summoner-icon mod. It must not be clobbered by
        // the coarse fallback on read, and must persist across a reload.
        report.derived = DerivedCategorization {
            tags: vec!["summoner-icon".to_string()],
            ..Default::default()
        };
        {
            let mut store = WadReportStore::load(Some(dir.path()));
            store.upsert(report).unwrap();
            assert_eq!(
                store.get("mod-a").unwrap().derived.tags,
                vec!["summoner-icon"]
            );
        }
        let store = WadReportStore::load(Some(dir.path()));
        assert_eq!(
            store.get("mod-a").unwrap().derived.tags,
            vec!["summoner-icon"]
        );
    }

    #[test]
    fn stale_flag_set_when_game_index_changes() {
        let dir = tempdir().unwrap();
        let mut store = WadReportStore::load(Some(dir.path()));
        store.upsert(sample_report("mod-a", 100)).unwrap();
        // Newer report from a different game version updates current_game_index_fp.
        store.upsert(sample_report("mod-b", 200)).unwrap();
        let stale = store.get("mod-a").unwrap();
        assert!(stale.is_stale);
        let fresh = store.get("mod-b").unwrap();
        assert!(!fresh.is_stale);
    }

    #[test]
    fn invalidate_by_content_flips_stale_flag() {
        let dir = tempdir().unwrap();
        let mut store = WadReportStore::load(Some(dir.path()));
        store.upsert(sample_report("mod-a", 100)).unwrap();
        store.invalidate_by_content(&["mod-a".to_string()]).unwrap();
        let got = store.get("mod-a").unwrap();
        assert!(got.is_stale);
    }

    #[test]
    fn content_stale_cleared_by_fresh_upsert() {
        let dir = tempdir().unwrap();
        let mut store = WadReportStore::load(Some(dir.path()));
        store.upsert(sample_report("mod-a", 100)).unwrap();
        store.invalidate_by_content(&["mod-a".to_string()]).unwrap();
        assert!(store.get("mod-a").unwrap().is_stale);
        // A fresh upsert replaces the entry with content_stale=false.
        store.upsert(sample_report("mod-a", 100)).unwrap();
        assert!(!store.get("mod-a").unwrap().is_stale);
    }

    #[test]
    fn prune_orphans_removes_unknown_ids() {
        let dir = tempdir().unwrap();
        let mut store = WadReportStore::load(Some(dir.path()));
        store.upsert(sample_report("mod-a", 1)).unwrap();
        store.upsert(sample_report("mod-b", 1)).unwrap();
        let mut keep = HashSet::new();
        keep.insert("mod-a".to_string());
        store.prune_orphans(&keep).unwrap();
        assert!(store.get("mod-a").is_some());
        assert!(store.get("mod-b").is_none());
    }

    #[test]
    fn persistence_round_trip() {
        let dir = tempdir().unwrap();
        {
            let mut store = WadReportStore::load(Some(dir.path()));
            store.upsert(sample_report("mod-a", 42)).unwrap();
        }
        let store = WadReportStore::load(Some(dir.path()));
        let got = store.get("mod-a").unwrap();
        assert_eq!(got.game_index_fingerprint, 42);
    }
}
