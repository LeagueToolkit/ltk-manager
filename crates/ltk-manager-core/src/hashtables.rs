//! Status and sync for the shared mimir hashtable cache.
//!
//! The cache is one directory of versioned `.lhdb` tables plus a
//! `manifest.json`, shared by every mimir-backed tool on the machine. This
//! module reports what the cache holds, refreshes it from the published
//! GitHub release, and opens the WAD path tables for chunk resolution.

use std::borrow::Cow;
use std::fmt;
use std::path::PathBuf;
use std::time::Duration;

use ltk_mimir_cache::{
    HashStore, ManifestError, NoCacheDirError, Table, UpdateError, UpdateOptions, UpdateOutcome,
};
use ltk_wad::PathResolver;
use serde::Serialize;
use thiserror::Error;

use crate::events::{BackendEvent, EventSink, HashtableSyncProgress};

pub use ltk_hashdb::LayeredHashDb;

/// Download base for the published hashtable release assets.
const RELEASE_BASE_URL: &str = "https://github.com/LeagueToolkit/mimir/releases/latest/download";

/// Whole-request budget per asset. The largest tables are tens of megabytes,
/// so this allows even slow connections to finish one download.
const SYNC_TIMEOUT: Duration = Duration::from_secs(300);

/// Budget for establishing each connection, separate from the download itself.
const SYNC_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// Errors from reading or syncing the hashtable cache.
#[derive(Debug, Error)]
pub enum HashtableError {
    /// No platform cache directory could be resolved.
    #[error(transparent)]
    NoCacheDir(#[from] NoCacheDirError),

    /// The cache manifest exists but could not be read or parsed.
    #[error("hashtable cache manifest: {0}")]
    Manifest(#[from] ManifestError),

    /// Another process already holds the cache's update lock.
    #[error("another process is already syncing the hashtables")]
    SyncLocked,

    /// The HTTP client for a sync could not be built.
    #[error("hashtable sync client: {0}")]
    Http(#[from] reqwest::Error),

    /// A sync run failed while downloading, verifying, or installing tables.
    #[error("hashtable sync: {0}")]
    Sync(#[from] UpdateError<reqwest::Error>),
}

/// One present table in a [`HashtableCacheStatus`].
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct HashtableStatus {
    /// Stable table id, e.g. `game`.
    pub id: String,
    /// Active `.lhdb` filename from the manifest.
    pub file: String,
    /// Entry count recorded in the manifest.
    pub entries: u64,
    /// On-disk size of the active file, or 0 when it cannot be read.
    pub size_bytes: u64,
}

/// What the shared hashtable cache currently holds.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct HashtableCacheStatus {
    /// Absolute cache directory.
    pub dir: String,
    /// Manifest generation time (RFC 3339), or `None` when the cache is empty.
    pub generated_at: Option<String>,
    /// Repository the table inputs came from, e.g. `CommunityDragon/Data`.
    pub source_repo: Option<String>,
    /// Commit of that repository the inputs were taken at.
    pub source_commit: Option<String>,
    /// Present tables, in [`Table::ALL`] order.
    pub tables: Vec<HashtableStatus>,
    /// Ids from [`Table::ALL`] absent from the manifest.
    pub missing: Vec<String>,
}

/// What a completed sync run changed.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct HashtableSyncReport {
    /// True when nothing needed installing.
    pub up_to_date: bool,
    /// Ids of the tables installed by this run.
    pub installed: Vec<String>,
    /// Remote table ids this build does not know. Skipped, never fatal.
    pub unknown_tables: Vec<String>,
}

/// The shared mimir hashtable cache on this machine.
#[derive(Debug, Clone)]
pub struct HashtableCache {
    store: HashStore,
}

impl HashtableCache {
    /// Resolve the platform cache directory without touching the filesystem.
    ///
    /// # Errors
    ///
    /// Fails with [`HashtableError::NoCacheDir`] when no platform data
    /// directory can be determined.
    pub fn discover() -> Result<Self, HashtableError> {
        Ok(Self {
            store: HashStore::discover()?,
        })
    }

    /// Use an explicit cache directory (tests, overrides).
    pub fn at(dir: impl Into<PathBuf>) -> Self {
        Self {
            store: HashStore::at(dir),
        }
    }

    /// Report the manifest's view of the cache plus on-disk file sizes.
    ///
    /// A cache that was never populated is not an error: the report then has
    /// no `generated_at` and lists every table as missing.
    ///
    /// # Errors
    ///
    /// Fails with [`HashtableError::Manifest`] when a manifest exists but
    /// cannot be read or parsed.
    pub fn status(&self) -> Result<HashtableCacheStatus, HashtableError> {
        let manifest = match self.store.manifest() {
            Ok(manifest) => Some(manifest),
            Err(ManifestError::Missing(_)) => None,
            Err(e) => return Err(e.into()),
        };

        let mut tables = Vec::new();
        let mut missing = Vec::new();
        for table in Table::ALL {
            let Some(entry) = manifest.as_ref().and_then(|m| m.entry(table)) else {
                missing.push(table.id().to_owned());
                continue;
            };
            let size_bytes = std::fs::metadata(self.store.dir().join(&entry.file))
                .map(|m| m.len())
                .unwrap_or(0);
            tables.push(HashtableStatus {
                id: table.id().to_owned(),
                file: entry.file.clone(),
                entries: entry.entries,
                size_bytes,
            });
        }

        Ok(HashtableCacheStatus {
            dir: self.store.dir().display().to_string(),
            generated_at: manifest.as_ref().map(|m| m.generated_at.clone()),
            source_repo: manifest
                .as_ref()
                .and_then(|m| m.source.as_ref())
                .and_then(|s| s.repo.clone()),
            source_commit: manifest
                .as_ref()
                .and_then(|m| m.source.as_ref())
                .and_then(|s| s.commit.clone()),
            tables,
            missing,
        })
    }

    /// Bring the cache up to date with the latest published release.
    ///
    /// Emits [`BackendEvent::HashtableSyncProgress`] through `events` once per
    /// asset the run downloads. `force` reinstalls every table even when the
    /// local copy already matches.
    ///
    /// # Errors
    ///
    /// Fails with [`HashtableError::SyncLocked`] when another process is
    /// already syncing, and with [`HashtableError::Sync`] when a download,
    /// checksum, or install step fails.
    pub fn sync(
        &self,
        force: bool,
        user_agent: &str,
        events: &dyn EventSink,
    ) -> Result<HashtableSyncReport, HashtableError> {
        let client = reqwest::blocking::Client::builder()
            .user_agent(user_agent)
            .timeout(SYNC_TIMEOUT)
            .connect_timeout(SYNC_CONNECT_TIMEOUT)
            .build()?;

        let fetch = |filename: &str| -> Result<Vec<u8>, reqwest::Error> {
            events.emit(BackendEvent::HashtableSyncProgress(HashtableSyncProgress {
                file: filename.to_owned(),
            }));
            let url = format!("{RELEASE_BASE_URL}/{filename}");
            let response = client.get(&url).send()?.error_for_status()?;
            Ok(response.bytes()?.to_vec())
        };

        match self.store.update(&fetch, UpdateOptions { force })? {
            UpdateOutcome::Locked => Err(HashtableError::SyncLocked),
            UpdateOutcome::Completed(report) => Ok(HashtableSyncReport {
                up_to_date: report.is_up_to_date(),
                installed: report.installed.iter().map(|t| t.id().to_owned()).collect(),
                unknown_tables: report.unknown_tables,
            }),
        }
    }

    /// Open the `game` and `lcu` tables layered for WAD chunk resolution.
    ///
    /// Best-effort by design: tables absent from the cache are logged at debug
    /// and skipped, so their hashes simply miss.
    pub fn wad_tables(&self) -> LayeredHashDb {
        let (db, errors) = self.store.open_layered(&[Table::Game, Table::Lcu]);
        for (table, e) in errors {
            tracing::debug!("Hashtable `{}` unavailable: {e}", table.id());
        }
        db
    }

    /// The same tables as [`wad_tables`](Self::wad_tables), as a resolver.
    pub fn wad_path_resolver(&self) -> WadPathResolver {
        WadPathResolver::new(self.wad_tables())
    }
}

/// Names WAD chunks from the shared mimir tables when extracting an archive.
///
/// A hash no table knows keeps the hex name [`ltk_wad::HexPathResolver`] would
/// have given it, so extraction resolves what it can and never fails for want
/// of a table.
pub struct WadPathResolver {
    db: LayeredHashDb,
}

impl WadPathResolver {
    /// Open the shared cache's WAD tables.
    ///
    /// Best-effort: a machine whose cache is missing or never synced resolves
    /// nothing, and every chunk lands under its hex name.
    pub fn discover() -> Self {
        let db = match HashtableCache::discover() {
            Ok(cache) => cache.wad_tables(),
            Err(e) => {
                tracing::warn!("No hashtable cache to name WAD chunks with: {e}");
                LayeredHashDb::new()
            }
        };

        if db.bases().is_empty() {
            tracing::warn!("No hashtables loaded, WAD chunks will keep their hex names");
        }

        Self::new(db)
    }

    /// Resolve through tables the caller already opened.
    pub fn new(db: LayeredHashDb) -> Self {
        Self { db }
    }
}

impl fmt::Debug for WadPathResolver {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("WadPathResolver")
            .field("tables", &self.db.bases().len())
            .finish_non_exhaustive()
    }
}

impl PathResolver for WadPathResolver {
    fn resolve(&self, path_hash: u64) -> Cow<'_, str> {
        self.db
            .get(path_hash)
            .unwrap_or_else(|| Cow::Owned(format!("{path_hash:016x}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::NullEventSink;

    fn write_manifest(dir: &std::path::Path, json: &str) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join("manifest.json"), json).unwrap();
    }

    #[test]
    fn status_of_an_empty_cache_reports_every_table_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let status = HashtableCache::at(tmp.path()).status().unwrap();

        assert_eq!(status.dir, tmp.path().display().to_string());
        assert_eq!(status.generated_at, None);
        assert_eq!(status.source_repo, None);
        assert_eq!(status.source_commit, None);
        assert!(status.tables.is_empty());
        let all_ids: Vec<String> = Table::ALL.iter().map(|t| t.id().to_owned()).collect();
        assert_eq!(status.missing, all_ids);
    }

    #[test]
    fn status_shapes_the_manifest_in_table_order() {
        let tmp = tempfile::tempdir().unwrap();
        write_manifest(
            tmp.path(),
            r#"{
                "schema": 1,
                "generated_at": "2026-07-10T00:00:00Z",
                "source": { "repo": "CommunityDragon/Data", "commit": "abc123" },
                "tables": {
                    "rst-xxh3": {
                        "file": "rst-xxh3-2026-07-10.lhdb",
                        "sha256": "22",
                        "entries": 7,
                        "key_width": 8
                    },
                    "game": {
                        "file": "game-2026-07-10.lhdb",
                        "sha256": "11",
                        "entries": 42,
                        "key_width": 8
                    }
                }
            }"#,
        );
        std::fs::write(tmp.path().join("game-2026-07-10.lhdb"), [0u8; 3]).unwrap();

        let status = HashtableCache::at(tmp.path()).status().unwrap();

        assert_eq!(status.generated_at.as_deref(), Some("2026-07-10T00:00:00Z"));
        assert_eq!(status.source_repo.as_deref(), Some("CommunityDragon/Data"));
        assert_eq!(status.source_commit.as_deref(), Some("abc123"));

        // `game` first, `rst-xxh3` last: Table::ALL order, not manifest order.
        assert_eq!(status.tables.len(), 2);
        assert_eq!(status.tables[0].id, "game");
        assert_eq!(status.tables[0].file, "game-2026-07-10.lhdb");
        assert_eq!(status.tables[0].entries, 42);
        assert_eq!(status.tables[0].size_bytes, 3);
        assert_eq!(status.tables[1].id, "rst-xxh3");
        assert_eq!(status.tables[1].size_bytes, 0, "file absent stats as 0");

        assert_eq!(
            status.missing,
            [
                "lcu",
                "binentries",
                "bintypes",
                "binfields",
                "binhashes",
                "rst"
            ]
            .map(str::to_owned)
            .to_vec()
        );
    }

    #[test]
    fn a_corrupt_manifest_is_an_error() {
        let tmp = tempfile::tempdir().unwrap();
        write_manifest(tmp.path(), "{ not json");

        let err = HashtableCache::at(tmp.path()).status().unwrap_err();
        assert!(matches!(err, HashtableError::Manifest(_)));
    }

    #[test]
    fn sync_reports_locked_when_another_updater_holds_the_lock() {
        let tmp = tempfile::tempdir().unwrap();
        let store = HashStore::at(tmp.path());
        let _lock = store.try_lock_update().unwrap().unwrap();

        // The lock is checked before any fetch, so this stays offline.
        let err = HashtableCache::at(tmp.path())
            .sync(false, "ltk-manager-tests", &NullEventSink)
            .unwrap_err();
        assert!(matches!(err, HashtableError::SyncLocked));
    }

    #[test]
    fn status_serializes_as_camel_case() {
        let json = serde_json::to_value(HashtableStatus {
            id: "game".to_owned(),
            file: "game-1.lhdb".to_owned(),
            entries: 1,
            size_bytes: 2,
        })
        .unwrap();
        assert_eq!(json["sizeBytes"], 2);

        let json = serde_json::to_value(HashtableSyncReport {
            up_to_date: true,
            installed: vec![],
            unknown_tables: vec![],
        })
        .unwrap();
        assert_eq!(json["upToDate"], true);
        assert!(json["unknownTables"].is_array());
    }

    #[test]
    fn resolver_names_a_hash_a_table_knows() {
        let path = "assets/characters/aatrox/aatrox.bin";
        let mut db = LayeredHashDb::new();
        db.insert(0x1234, path);

        assert_eq!(WadPathResolver::new(db).resolve(0x1234), path);
    }

    #[test]
    fn resolver_falls_back_to_the_hex_name() {
        let resolver = WadPathResolver::new(LayeredHashDb::new());

        assert_eq!(resolver.resolve(0xdead_beef), "00000000deadbeef");
    }
}
