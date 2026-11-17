use std::sync::Arc;

use chrono::TimeZone;
use ltk_manager_assets::{hashtables::WadPathResolverState, test_util::make_named_fantome_zip};
use ltk_manager_base::{
    advisory::{Advisories, Advisory},
    events::NullEventSink,
    hashing::OverlayFingerprint,
};
use ltk_manager_library::mods::{ChecksumMismatchState, DerivedCategorization, WadReportState};
use ltk_manager_runtime::{
    diagnostics::incident::{GameRecord, SkippedArchive},
    patcher::SessionOrigin,
};

use super::*;

const AATROX: &str = "Aatrox.wad.client";
const GLOBAL: &str = "Global.wad.client";

fn at(minute: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 17, 19, minute, 0).unwrap()
}

fn fingerprint(hex: &str) -> Option<OverlayFingerprint> {
    Some(serde_json::from_value(serde_json::json!(hex)).unwrap())
}

/// A build at minute 0 with the fingerprint `aaaa` that applied `mods`.
fn build(mods: &[&str]) -> BuildRecord {
    BuildRecord {
        built_at: at(0),
        fingerprint: fingerprint("aaaa"),
        mods: mods.iter().map(|id| (*id).to_owned()).collect(),
        advisories: Advisories::default(),
    }
}

/// A game from minute 2 to minute 26 that ran the overlay `aaaa` live and served `served`.
fn game(served: &[&str]) -> StoredGame {
    let mut record = GameRecord::open(at(2), SessionOrigin::Library);
    record.ended_at = at(26);
    record.overlay = OverlayOutcome::Live;
    record.overlay_fingerprint = fingerprint("aaaa");
    record.redirected = served.iter().map(|wad| (*wad).to_owned()).collect();
    record.stored(None)
}

/// The last row for a mod that patches `Aatrox.wad.client` and `Global.wad.client`.
fn last_game(build: &BuildRecord, game: Option<&StoredGame>) -> TraceFact {
    let archives = [AATROX.to_owned(), GLOBAL.to_owned()];
    TraceFact::of_last_game(&GameEvidence {
        build,
        game,
        archives: Some(&archives),
        champions: &["Aatrox".to_owned()],
        newest_logged_game: None,
        run_started_at: Some(at(1)),
    })
}

#[test]
fn the_last_row_reads_no_game_before_a_game_ran_the_build() {
    let build = build(&["a"]);
    let mut older = game(&[AATROX]);
    older.overlay_fingerprint = fingerprint("bbbb");

    assert_eq!(last_game(&build, None), TraceFact::GameNone);
    assert_eq!(last_game(&build, Some(&older)), TraceFact::GameNone);
}

#[test]
fn the_last_row_compares_the_times_if_a_fingerprint_is_missing() {
    let mut build = build(&["a"]);
    build.fingerprint = None;
    let after = game(&[AATROX, GLOBAL]);
    let mut before = game(&[AATROX, GLOBAL]);
    before.started_at = at(0) - chrono::Duration::minutes(30);

    assert_eq!(
        last_game(&build, Some(&after)),
        TraceFact::GameLoaded {
            loaded: 2,
            total: 2
        }
    );
    assert_eq!(last_game(&build, Some(&before)), TraceFact::GameNone);
}

#[test]
fn the_last_row_reads_a_game_that_no_session_followed() {
    let build = build(&["a"]);
    let followed = game(&[AATROX]);
    let archives = [AATROX.to_owned()];
    let read = |game: Option<&StoredGame>, logged: u32, run: u32| {
        TraceFact::of_last_game(&GameEvidence {
            build: &build,
            game,
            archives: Some(&archives),
            champions: &[],
            newest_logged_game: Some(at(logged)),
            run_started_at: Some(at(run)),
        })
    };

    // The manager ran when League started the game at minute 40.
    assert_eq!(
        read(Some(&followed), 40, 1),
        TraceFact::GamePatcherNotRunning
    );
    assert_eq!(read(None, 40, 1), TraceFact::GamePatcherNotRunning);
    // This run of the manager started after the game.
    assert_eq!(read(Some(&followed), 40, 50), TraceFact::GameUnwatched);
    // The newest log directory is the one of the game that the session followed.
    assert_eq!(
        read(Some(&followed), 2, 1),
        TraceFact::GameLoaded {
            loaded: 1,
            total: 1
        }
    );
}

#[test]
fn the_last_row_ignores_a_logged_game_from_before_the_build() {
    let build = build(&["a"]);
    let fact = TraceFact::of_last_game(&GameEvidence {
        build: &build,
        game: None,
        archives: None,
        champions: &[],
        newest_logged_game: Some(at(0) - chrono::Duration::hours(3)),
        run_started_at: Some(at(1)),
    });

    assert_eq!(fact, TraceFact::GameNone);
}

#[test]
fn the_last_row_reads_the_outcome_of_an_overlay_that_was_not_live() {
    let build = build(&["a"]);
    let mut late = game(&[]);
    late.overlay = OverlayOutcome::TooLate;
    let mut refused = GameRecord::open(at(2), SessionOrigin::Library);
    refused.ended_at = at(26);
    refused.overlay = OverlayOutcome::Refused;
    refused.overlay_fingerprint = fingerprint("aaaa");
    refused.advisories.raise(
        Advisory::new(AdvisoryCode::OverlayRefused, at(3))
            .with_patcher_code(Some("VRF00000008".to_owned())),
    );

    assert_eq!(
        last_game(&build, Some(&late)),
        TraceFact::GameOverlayNotLive {
            outcome: OverlayOutcome::TooLate,
            patcher_code: None
        }
    );
    assert_eq!(
        last_game(&build, Some(&refused.stored(None))),
        TraceFact::GameOverlayNotLive {
            outcome: OverlayOutcome::Refused,
            patcher_code: Some("VRF00000008".to_owned())
        }
    );
}

#[test]
fn the_last_row_names_the_champions_if_league_opened_no_archive_of_the_mod() {
    let build = build(&["a"]);
    let other = game(&["Ahri.wad.client"]);

    assert_eq!(
        last_game(&build, Some(&other)),
        TraceFact::GameArchivesNotLoaded {
            champions: vec!["Aatrox".to_owned()]
        }
    );
}

#[test]
fn the_last_row_counts_the_archives_that_league_opened() {
    let build = build(&["a"]);

    assert_eq!(
        last_game(&build, Some(&game(&["aatrox.wad.client", GLOBAL]))),
        TraceFact::GameLoaded {
            loaded: 2,
            total: 2
        }
    );
    assert_eq!(
        last_game(&build, Some(&game(&[GLOBAL]))),
        TraceFact::GameLoaded {
            loaded: 1,
            total: 2
        }
    );
}

#[test]
fn the_last_row_names_the_archives_that_the_patcher_could_not_open() {
    let build = build(&["a"]);
    let mut record = GameRecord::open(at(2), SessionOrigin::Library);
    record.ended_at = at(26);
    record.overlay = OverlayOutcome::Live;
    record.overlay_fingerprint = fingerprint("aaaa");
    record.redirected = vec![GLOBAL.to_owned()];
    record.skipped = vec![SkippedArchive {
        wad: AATROX.to_owned(),
        why: "open modded file: not found".to_owned(),
    }];

    assert_eq!(
        last_game(&build, Some(&record.stored(None))),
        TraceFact::GameArchivesNotServed {
            archives: vec![AATROX.to_owned()]
        }
    );
}

#[test]
fn the_last_row_reads_a_live_overlay_for_a_mod_without_an_archive_report() {
    let build = build(&["a"]);
    let game = game(&[AATROX]);
    let fact = TraceFact::of_last_game(&GameEvidence {
        build: &build,
        game: Some(&game),
        archives: None,
        champions: &[],
        newest_logged_game: None,
        run_started_at: None,
    });

    assert_eq!(fact, TraceFact::GameOverlayLive);
}

/// A library with one installed mod, its config and a game store under one directory.
struct Fixture {
    dir: tempfile::TempDir,
    library: ModLibrary,
    config: Config,
    games: GameStore,
    mod_id: String,
}

impl Fixture {
    fn new() -> Self {
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
            mod_storage_path: Some(storage.clone()),
            read_game_log: false,
            ..Config::default()
        };
        let archive = storage.join("test mod.fantome");
        make_named_fantome_zip(&archive, "Test Mod");
        library
            .install_mod_from_package(&config, &archive.to_string_lossy())
            .unwrap();
        let mod_id = library.get_installed_mods(&config).unwrap()[0].id.clone();
        let games = GameStore::new(dir.path().join("games"));
        Self {
            dir,
            library,
            config,
            games,
            mod_id,
        }
    }

    fn sources(&self) -> TraceSources<'_> {
        TraceSources {
            library: &self.library,
            config: &self.config,
            games: &self.games,
            run_started_at: Some(at(1)),
            game_open: false,
        }
    }

    fn save_build(&self, build: &BuildRecord) {
        build.save(&self.dir.path().join("storage")).unwrap();
    }

    /// Saves an archive report of the mod `id` that lists `archives`.
    fn save_report(&self, id: &str, archives: &[&str]) {
        let report = ModWadReport {
            mod_id: id.to_owned(),
            affected_wads: archives.iter().map(|wad| (*wad).to_owned()).collect(),
            wad_count: archives.len() as u32,
            override_count: 3,
            content_fingerprint: Some(7),
            game_index_fingerprint: 9,
            computed_at: at(0).to_rfc3339(),
            is_stale: false,
            derived: DerivedCategorization {
                champions: vec!["Aatrox".to_owned()],
                ..DerivedCategorization::default()
            },
        };
        self.library.wad_reports().0.lock().upsert(report).unwrap();
    }

    fn facts(trace: &ModTrace) -> Vec<&TraceFact> {
        trace.rows.iter().map(|row| &row.fact).collect()
    }
}

#[test]
fn trace_mod_ends_at_a_mod_that_is_not_enabled() {
    let fixture = Fixture::new();
    fixture
        .library
        .toggle_mod_enabled(&fixture.config, &fixture.mod_id, false)
        .unwrap();
    fixture.save_build(&build(&[&fixture.mod_id]));

    let trace = fixture.sources().trace_mod(&fixture.mod_id).unwrap();

    assert_eq!(
        Fixture::facts(&trace),
        [&TraceFact::NotEnabled {
            profile: "Default".to_owned()
        }]
    );
    assert_eq!(trace.rows[0].state, RowState::Fail);
}

#[test]
fn trace_mod_ends_at_the_advisory_of_a_mod_that_the_build_left_out() {
    let fixture = Fixture::new();
    let mut build = build(&[]);
    build.advisories.raise(
        Advisory::new(AdvisoryCode::EntryUnreadable, at(0))
            .about(AdvisorySubject::mod_id(fixture.mod_id.as_str())),
    );
    fixture.save_build(&build);
    fixture.games.record(&game(&[AATROX])).unwrap();

    let trace = fixture.sources().trace_mod(&fixture.mod_id).unwrap();

    assert_eq!(
        Fixture::facts(&trace),
        [
            &TraceFact::Enabled {
                profile: "Default".to_owned()
            },
            &TraceFact::HealthUnchecked,
            &TraceFact::OverlayLeftOut {
                advisory: AdvisoryCode::EntryUnreadable
            },
        ]
    );
    assert!(trace.last_game.is_some());
}

#[test]
fn trace_mod_ends_at_a_mod_that_was_enabled_after_the_build() {
    let fixture = Fixture::new();
    fixture.save_build(&build(&["another"]));

    let trace = fixture.sources().trace_mod(&fixture.mod_id).unwrap();

    assert_eq!(
        trace.rows.last().map(|row| &row.fact),
        Some(&TraceFact::OverlayWithoutMod { built_at: at(0) })
    );
}

#[test]
fn trace_mod_reads_every_row_of_a_mod_that_the_last_game_loaded() {
    let fixture = Fixture::new();
    let id = fixture.mod_id.as_str();
    let mut build = build(&[id]);
    build
        .advisories
        .raise(Advisory::new(AdvisoryCode::LayersUnset, at(0)).about(AdvisorySubject::mod_id(id)));
    fixture.save_build(&build);
    fixture.save_report(
        id,
        &[
            "DATA/FINAL/Champions/Aatrox.wad.client",
            "DATA/FINAL/Global.wad.client",
        ],
    );
    fixture.games.record(&game(&[AATROX, GLOBAL])).unwrap();

    let trace = fixture.sources().trace_mod(id).unwrap();

    assert_eq!(
        Fixture::facts(&trace),
        [
            &TraceFact::Enabled {
                profile: "Default".to_owned()
            },
            &TraceFact::HealthUnchecked,
            &TraceFact::OverlayBuilt { built_at: at(0) },
            &TraceFact::Archives {
                archives: vec![AATROX.to_owned(), GLOBAL.to_owned()]
            },
            &TraceFact::Advisory {
                code: AdvisoryCode::LayersUnset
            },
            &TraceFact::GameLoaded {
                loaded: 2,
                total: 2
            },
        ]
    );
    assert_eq!(
        trace.last_game,
        Some(TracedGame {
            started_at: at(2),
            ended_at: at(26),
            still_running: false
        })
    );
}

#[test]
fn trace_mod_fails_for_a_mod_that_the_library_does_not_hold() {
    let fixture = Fixture::new();

    assert!(matches!(
        fixture.sources().trace_mod("gone"),
        Err(AppError::ModNotFound(_))
    ));
}

#[test]
fn trace_project_reads_the_build_by_the_name_of_the_project_directory() {
    let fixture = Fixture::new();
    let project = fixture.dir.path().join("workshop").join("my-skin");
    fixture.save_build(&build(&["workshop:my-skin"]));
    fixture.games.record(&game(&[AATROX])).unwrap();

    let tested = fixture.sources().trace_project(&project).unwrap();
    let other = fixture
        .sources()
        .trace_project(&fixture.dir.path().join("workshop").join("other"))
        .unwrap();

    assert_eq!(
        Fixture::facts(&tested),
        [
            &TraceFact::OverlayBuilt { built_at: at(0) },
            &TraceFact::GameOverlayLive,
        ]
    );
    assert_eq!(
        Fixture::facts(&other),
        [&TraceFact::OverlayWithoutMod { built_at: at(0) }]
    );
}

#[test]
fn the_trace_reads_the_game_log_directory_only_if_the_setting_is_on() {
    let mut fixture = Fixture::new();
    let league = fixture.dir.path().join("league");
    let stamp = (at(40).with_timezone(&chrono::Local))
        .format("%Y-%m-%dT%H-%M-%S")
        .to_string();
    fs_err::create_dir_all(league.join("Logs").join("GameLogs").join(stamp)).unwrap();
    fixture.config.league_path = Some(league);
    fixture.save_build(&build(&[&fixture.mod_id]));
    let last = |fixture: &Fixture| {
        let trace = fixture.sources().trace_mod(&fixture.mod_id).unwrap();
        trace.rows.last().map(|row| row.fact.clone())
    };

    assert_eq!(last(&fixture), Some(TraceFact::GameNone));

    fixture.config.read_game_log = true;
    assert_eq!(last(&fixture), Some(TraceFact::GamePatcherNotRunning));

    let open = TraceSources {
        game_open: true,
        ..fixture.sources()
    };
    let trace = open.trace_mod(&fixture.mod_id).unwrap();
    assert_eq!(
        trace.rows.last().map(|row| &row.fact),
        Some(&TraceFact::GameNone)
    );
}
