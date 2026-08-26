//! Unit tests for sync progress, the update check and the WAD path resolver.

use super::*;
use crate::events::NullEventSink;
use ltk_mimir_cache::{TableDiff, TableEntry};

/// Keeps the sync progress it is handed, for the throttle tests.
#[derive(Default)]
struct RecordingSink(Mutex<Vec<HashtableSyncProgress>>);

impl RecordingSink {
    fn taken(&self) -> Vec<HashtableSyncProgress> {
        self.0.lock().unwrap().clone()
    }
}

impl EventSink for RecordingSink {
    fn emit(&self, event: BackendEvent) {
        if let BackendEvent::HashtableSyncProgress(progress) = event {
            self.0.lock().unwrap().push(progress);
        }
    }
}

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
                "last_run": { "repo": "CommunityDragon/Data", "commit": "abc123" },
                "tables": {
                    "rst-xxh3": {
                        "file": "rst-xxh3-2026-06-01.lhdb",
                        "sha256": "22",
                        "entries": 7,
                        "key_width": 8
                    },
                    "game": {
                        "file": "game-2026-07-10.lhdb",
                        "sha256": "11",
                        "entries": 42,
                        "key_width": 8,
                        "version": "2026-07-10",
                        "source": { "repo": "CommunityDragon/Data", "commit": "abc123" }
                    }
                }
            }"#,
    );
    std::fs::write(tmp.path().join("game-2026-07-10.lhdb"), [0u8; 3]).unwrap();

    let status = HashtableCache::at(tmp.path()).status().unwrap();

    assert_eq!(status.generated_at.as_deref(), Some("2026-07-10T00:00:00Z"));

    // `game` first, `rst-xxh3` last: Table::ALL order, not manifest order.
    assert_eq!(status.tables.len(), 2);
    assert_eq!(status.tables[0].id, "game");
    assert_eq!(status.tables[0].file, "game-2026-07-10.lhdb");
    assert_eq!(status.tables[0].version, "2026-07-10");
    assert_eq!(status.tables[0].entries, 42);
    assert_eq!(status.tables[0].size_bytes, 3);
    assert_eq!(
        status.tables[0].source_repo.as_deref(),
        Some("CommunityDragon/Data")
    );
    assert_eq!(status.tables[0].source_commit.as_deref(), Some("abc123"));
    assert_eq!(status.tables[1].id, "rst-xxh3");
    assert_eq!(status.tables[1].size_bytes, 0, "file absent stats as 0");
    assert_eq!(
        status.tables[1].version, "2026-06-01",
        "an entry that predates the version field takes it from its filename"
    );
    assert_eq!(status.tables[1].source_repo, None);

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
    assert!(matches!(err, HashtableError::SyncLocked(_)));
    assert!(
        err.to_string().contains("pid "),
        "the lock names its holder: {err}"
    );
}

#[test]
fn a_lock_that_names_nobody_still_says_someone_holds_it() {
    assert_eq!(
        SyncHolder::unknown().to_string(),
        "another process",
        "an unreadable holder record is not the same as an unheld lock"
    );
}

fn planned(table: Table, size_bytes: Option<u64>) -> PlannedTable {
    PlannedTable {
        table,
        version: "2026-07-10".to_owned(),
        size_bytes,
    }
}

/// One event as a table opens, one per [`PROGRESS_STEP`] after that, and
/// one as it lands however short its tail was.
#[test]
fn sync_progress_is_throttled_but_always_reports_a_table_landing() {
    let events = RecordingSink::default();
    let progress = SyncProgress::new(&events);

    progress.planned(&[planned(Table::Game, Some(PROGRESS_STEP + 7))]);
    progress.progressed(Table::Game, 0, None);
    progress.progressed(Table::Game, PROGRESS_STEP / 2, None);
    progress.progressed(Table::Game, PROGRESS_STEP, None);
    progress.progressed(Table::Game, PROGRESS_STEP + 7, None);
    progress.downloaded(Table::Game);

    let seen = events.taken();
    assert_eq!(
        seen.iter().map(|p| p.downloaded).collect::<Vec<_>>(),
        [0, PROGRESS_STEP, PROGRESS_STEP + 7]
    );
    assert!(seen.iter().all(|p| p.table == "game"));
    assert_eq!(seen[0].total_bytes, Some(PROGRESS_STEP + 7));
}

/// Every figure spans the run, so the second table's bytes carry the
/// first's rather than starting over at zero.
#[test]
fn a_second_table_continues_the_run_rather_than_restarting_it() {
    let events = RecordingSink::default();
    let progress = SyncProgress::new(&events);

    progress.planned(&[
        planned(Table::Game, Some(PROGRESS_STEP)),
        planned(Table::Lcu, Some(PROGRESS_STEP)),
        planned(Table::Rst, Some(PROGRESS_STEP)),
    ]);
    progress.progressed(Table::Game, PROGRESS_STEP, None);
    progress.downloaded(Table::Game);
    progress.progressed(Table::Lcu, 0, None);
    progress.progressed(Table::Lcu, PROGRESS_STEP, None);
    progress.downloaded(Table::Lcu);

    let seen = events.taken();
    assert_eq!(
        seen.iter()
            .map(|p| (p.table.as_str(), p.current, p.total, p.downloaded))
            .collect::<Vec<_>>(),
        [
            ("game", 1, 3, PROGRESS_STEP),
            ("lcu", 2, 3, PROGRESS_STEP),
            ("lcu", 2, 3, 2 * PROGRESS_STEP),
        ],
        "the run's bytes only ever climb, across a table boundary too"
    );
    assert_eq!(seen.last().unwrap().total_bytes, Some(3 * PROGRESS_STEP));
}

/// A release that recorded no sizes leaves the run without a total, which
/// is the reader's cue to draw a bar with no end rather than divide by it.
#[test]
fn a_release_without_sizes_leaves_the_run_untotalled() {
    let events = RecordingSink::default();
    let progress = SyncProgress::new(&events);

    progress.planned(&[
        planned(Table::Game, Some(PROGRESS_STEP)),
        planned(Table::Lcu, None),
    ]);
    progress.progressed(Table::Game, 0, None);

    let seen = events.taken();
    assert_eq!(
        seen[0].total_bytes, None,
        "one missing size unsizes the run"
    );
    assert_eq!(seen[0].total, 2, "the table count is known either way");
}

fn entry(version: &str) -> TableEntry {
    serde_json::from_value(serde_json::json!({
        "file": format!("t-{version}.lhdb"),
        "sha256": "00",
        "entries": 1,
        "key_width": 8,
        "version": version,
    }))
    .unwrap()
}

fn diff(table: Table, status: TableStatus, have: Option<&str>) -> TableDiff {
    TableDiff {
        table,
        status,
        remote: entry("2026-07-10"),
        local: have.map(entry),
    }
}

/// A table published in a format this build cannot open is behind in the
/// plain sense and still not something syncing can fix, so it is counted
/// apart from the updates the button promises.
#[test]
fn a_check_separates_what_a_sync_can_install_from_what_it_cannot() {
    let check = HashtableUpdateCheck::from(CheckReport {
        tables: vec![
            diff(Table::Game, TableStatus::Stale, Some("2026-06-01")),
            diff(Table::Lcu, TableStatus::Absent, None),
            diff(Table::Rst, TableStatus::Current, Some("2026-07-10")),
            diff(Table::BinTypes, TableStatus::Unsupported, None),
        ],
        unknown_tables: vec!["future".to_owned()],
    });

    assert!(!check.up_to_date);
    assert_eq!(
        check
            .behind
            .iter()
            .map(|update| update.id.as_str())
            .collect::<Vec<_>>(),
        ["game", "lcu"]
    );
    assert_eq!(check.behind[0].have.as_deref(), Some("2026-06-01"));
    assert_eq!(check.behind[0].want, "2026-07-10");
    assert_eq!(
        check.behind[1].have, None,
        "a table the cache has none of has no version to name"
    );
    assert_eq!(check.unsupported_tables, ["bintypes"]);
    assert_eq!(check.unknown_tables, ["future"]);
}

#[test]
fn a_check_that_finds_nothing_to_install_reads_as_up_to_date() {
    let check = HashtableUpdateCheck::from(CheckReport {
        tables: vec![
            diff(Table::Game, TableStatus::Current, Some("2026-07-10")),
            diff(Table::BinTypes, TableStatus::Unsupported, None),
        ],
        unknown_tables: Vec::new(),
    });

    assert!(
        check.up_to_date,
        "a table only a newer app could install is not an update this one is behind on"
    );
    assert!(check.behind.is_empty());
    assert_eq!(check.unsupported_tables, ["bintypes"]);
}

/// A run whose plan is empty reports nothing, so a reader dismisses its
/// bar rather than waiting on progress that will never come.
#[test]
fn a_run_with_nothing_to_download_reports_nothing() {
    let events = RecordingSink::default();
    let progress = SyncProgress::new(&events);

    progress.planned(&[]);

    assert!(events.taken().is_empty());
}

#[test]
fn status_serializes_as_camel_case() {
    let json = serde_json::to_value(HashtableStatus {
        id: "game".to_owned(),
        file: "game-1.lhdb".to_owned(),
        version: "1".to_owned(),
        entries: 1,
        size_bytes: 2,
        source_repo: None,
        source_commit: None,
    })
    .unwrap();
    assert_eq!(json["sizeBytes"], 2);
    assert!(json["sourceRepo"].is_null());

    let json = serde_json::to_value(HashtableSyncReport {
        up_to_date: true,
        installed: vec![],
        unknown_tables: vec![],
        unsupported_tables: vec![],
    })
    .unwrap();
    assert_eq!(json["upToDate"], true);
    assert!(json["unknownTables"].is_array());
    assert!(json["unsupportedTables"].is_array());
}

#[test]
fn the_shared_handle_opens_once_and_reopens_after_a_sync() {
    let state = WadPathResolverState::default();

    let first = state.get().unwrap();
    assert!(Arc::ptr_eq(&first, &state.get().unwrap()));

    state.invalidate();
    assert!(!Arc::ptr_eq(&first, &state.get().unwrap()));
}

#[test]
fn resolver_names_a_hash_a_table_knows() {
    let path = "assets/characters/aatrox/aatrox.bin";
    let mut db = LayeredHashDb::new();
    db.insert(0x1234, path);
    let resolver = WadPathResolver::new(db);

    assert_eq!(resolver.resolve(WadHash(0x1234)).as_deref(), Some(path));
    assert!(resolver.is_known(WadHash(0x1234)));
}

/// The tables call back in the order they hold the paths and report what they
/// cannot name last, so the batch has to place each answer by its index rather
/// than in the order the answers arrive.
#[test]
fn resolver_answers_a_batch_against_the_hashes_it_was_asked() {
    let first = "assets/characters/aatrox/aatrox.bin";
    let second = "assets/characters/ahri/ahri.bin";
    let mut db = LayeredHashDb::new();
    db.insert(0x1234, first);
    db.insert(0x5678, second);
    let resolver = WadPathResolver::new(db);

    let resolved = resolver.resolve_all(&[
        WadHash(0x5678),
        WadHash(0xdead_beef),
        WadHash(0x1234),
        WadHash(0x5678),
    ]);

    assert_eq!(
        resolved,
        [
            Some(second.to_owned()),
            None,
            Some(first.to_owned()),
            Some(second.to_owned()),
        ]
    );
}

/// The batch and the single lookup name the same paths, which is what the
/// trait asks of an override.
#[test]
fn a_batch_names_what_the_single_lookups_name() {
    let path = "assets/characters/aatrox/aatrox.bin";
    let mut db = LayeredHashDb::new();
    db.insert(0x1234, path);
    let resolver = WadPathResolver::new(db);
    let asked = [WadHash(0x1234), WadHash(0xdead_beef)];

    let singly: Vec<Option<String>> = asked.iter().map(|&h| resolver.resolve(h)).collect();

    assert_eq!(resolver.resolve_all(&asked), singly);
}

/// A hash no table knows names nothing, and the extractor writes that
/// chunk under its hex hash rather than the resolver inventing one.
#[test]
fn resolver_names_nothing_for_a_hash_no_table_holds() {
    let resolver = WadPathResolver::new(LayeredHashDb::new());

    assert_eq!(resolver.resolve(WadHash(0xdead_beef)), None);
    assert!(!resolver.is_known(WadHash(0xdead_beef)));
}
