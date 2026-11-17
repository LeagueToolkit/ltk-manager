use std::sync::Arc;

use chrono::TimeZone;
use ltk_manager_assets::hashtables::WadPathResolverState;
use ltk_manager_base::{advisory::Advisories, events::NullEventSink};
use ltk_manager_library::{
    mods::{ChecksumMismatchState, WadReportState},
    overlay::BuildRecord,
};
use ltk_manager_runtime::{diagnostics::incident::GameRecord, patcher::SessionOrigin};

use super::*;

fn at(minute: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 17, 12, minute, 0).unwrap()
}

/// A library, its config and a game store under one temporary directory.
fn fixture() -> (tempfile::TempDir, ModLibrary, Config, GameStore) {
    let dir = tempfile::tempdir().unwrap();
    let storage = dir.path().join("storage");
    fs_err::create_dir_all(&storage).unwrap();
    let library = ModLibrary::new(
        Arc::new(NullEventSink),
        Some(storage.clone()),
        "1.34.0",
        Arc::new(ChecksumMismatchState::default()),
        Arc::new(WadReportState::new(Some(&storage))),
        Arc::new(WadPathResolverState::default()),
    );
    let config = Config {
        mod_storage_path: Some(storage),
        ..Config::default()
    };
    let games = GameStore::new(dir.path().join("games"));
    (dir, library, config, games)
}

/// Saves a build at `minute` that raised `advisories`.
fn save_build(config: &Config, minute: u32, advisories: Vec<Advisory>) {
    let mut raised = Advisories::default();
    for advisory in advisories {
        raised.raise(advisory);
    }
    let record = BuildRecord {
        built_at: at(minute),
        fingerprint: None,
        mods: Vec::new(),
        advisories: raised,
    };
    let storage = config.mod_storage_path.as_deref().unwrap();
    record.save(storage).unwrap();
}

/// Stores a game that ended at `minute` and raised `advisory`.
fn store_game(games: &GameStore, minute: u32, advisory: Advisory) {
    let mut record = GameRecord::open(at(minute - 1), SessionOrigin::Library);
    record.ended_at = at(minute);
    record.advisories.raise(advisory);
    games.record(&record.stored(None)).unwrap();
}

fn missing(id: &str) -> Advisory {
    Advisory::new(AdvisoryCode::ModMissing, at(0))
        .about(AdvisorySubject::mod_id(id))
        .with_detail("a detail for the report")
}

fn refused() -> Advisory {
    Advisory::new(AdvisoryCode::OverlayRefused, at(0))
        .with_patcher_code(Some("VRF00000008".to_owned()))
}

fn codes(shown: &[ShownAdvisory]) -> Vec<(AdvisoryCode, AdvisorySource)> {
    shown
        .iter()
        .map(|advisory| (advisory.code, advisory.source))
        .collect()
}

#[test]
fn list_returns_nothing_before_any_build_or_game() {
    let (_dir, library, config, games) = fixture();

    assert_eq!(ShownAdvisory::list(&library, &config, &games).unwrap(), []);
}

#[test]
fn list_holds_the_build_then_a_game_that_ended_after_it() {
    let (_dir, library, config, games) = fixture();
    save_build(&config, 10, vec![missing("a")]);
    store_game(&games, 20, refused());

    let shown = ShownAdvisory::list(&library, &config, &games).unwrap();

    assert_eq!(
        codes(&shown),
        [
            (AdvisoryCode::ModMissing, AdvisorySource::Build),
            (AdvisoryCode::OverlayRefused, AdvisorySource::Game),
        ]
    );
    assert_eq!(shown[0].tier, None);
    assert_eq!(shown[0].subject, Some(AdvisorySubject::mod_id("a")));
    assert_eq!(shown[1].tier, Some(AdvisoryTier::Integrity));
    assert_eq!(shown[1].patcher_code.as_deref(), Some("VRF00000008"));
}

#[test]
fn list_leaves_out_a_game_that_ended_before_the_build() {
    let (_dir, library, config, games) = fixture();
    store_game(&games, 5, refused());
    save_build(&config, 10, vec![missing("a")]);

    let shown = ShownAdvisory::list(&library, &config, &games).unwrap();

    assert_eq!(
        codes(&shown),
        [(AdvisoryCode::ModMissing, AdvisorySource::Build)]
    );
}

#[test]
fn list_marks_a_muted_advisory_and_keeps_it() {
    let (_dir, library, config, games) = fixture();
    save_build(&config, 10, vec![missing("a"), missing("b")]);
    library
        .mute_advisory(&config, AdvisoryCode::ModMissing, "a")
        .unwrap();

    let shown = ShownAdvisory::list(&library, &config, &games).unwrap();

    let muted: Vec<bool> = shown.iter().map(|advisory| advisory.muted).collect();
    assert_eq!(muted, [true, false]);
}

#[test]
fn a_shown_advisory_holds_no_detail() {
    let (_dir, library, config, games) = fixture();
    save_build(&config, 10, vec![missing("a")]);

    let shown = ShownAdvisory::list(&library, &config, &games).unwrap();

    let wire = serde_json::to_string(&shown).unwrap();
    assert!(!wire.contains("detail"), "{wire}");
    assert!(!wire.contains("a detail for the report"), "{wire}");
}
