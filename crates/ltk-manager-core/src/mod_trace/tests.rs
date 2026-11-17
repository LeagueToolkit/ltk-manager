use std::sync::Arc;

use chrono::TimeZone;
use ltk_manager_assets::{hashtables::WadPathResolverState, test_util::make_named_fantome_zip};
use ltk_manager_base::{
    advisory::{Advisories, AdvisoryCode},
    events::NullEventSink,
    hashing::OverlayFingerprint,
};
use ltk_manager_library::{
    mods::{ChecksumMismatchState, DerivedCategorization, WadReportState},
    overlay::BuildRecord,
};
use ltk_manager_runtime::{
    diagnostics::{
        games::StoredGame,
        incident::{GameRecord, OverlayOutcome},
    },
    patcher::SessionOrigin,
};
use serde_json::json;

use super::*;

pub(super) const AATROX: &str = "Aatrox.wad.client";
pub(super) const GLOBAL: &str = "Global.wad.client";

pub(super) fn at(minute: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 17, 19, minute, 0).unwrap()
}

pub(super) fn fingerprint(hex: &str) -> Option<OverlayFingerprint> {
    Some(serde_json::from_value(json!(hex)).unwrap())
}

/// A build at minute 0 with the fingerprint `aaaa` that applied `mods`.
pub(super) fn build(mods: &[&str]) -> BuildRecord {
    BuildRecord {
        built_at: at(0),
        fingerprint: fingerprint("aaaa"),
        mods: mods.iter().map(|id| (*id).to_owned()).collect(),
        advisories: Advisories::default(),
    }
}

/// A game from minute 2 to minute 26 that ran the overlay `aaaa` live and served `served`.
pub(super) fn game(served: &[&str]) -> StoredGame {
    let mut record = GameRecord::open(at(2), SessionOrigin::Library);
    record.ended_at = at(26);
    record.overlay = OverlayOutcome::Live;
    record.overlay_fingerprint = fingerprint("aaaa");
    record.redirected = served.iter().map(|wad| (*wad).to_owned()).collect();
    record.stored(None)
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

    fn tracer(&self) -> ModTracer<'_> {
        ModTracer {
            library: &self.library,
            config: &self.config,
            games: &self.games,
            run_started_at: Some(at(1)),
            game_open: false,
        }
    }

    /// Returns the trace of the installed mod.
    fn trace(&self) -> ModTrace {
        self.tracer().trace(&self.subject()).unwrap()
    }

    fn subject(&self) -> TraceSubject {
        TraceSubject::Mod {
            id: self.mod_id.clone(),
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
}

fn readings(trace: &ModTrace) -> Vec<&RowReading> {
    trace.rows.iter().map(|row| &row.reading).collect()
}

fn enabled(enabled: bool) -> RowReading {
    RowReading::Enabled {
        enabled,
        profile: "Default".to_owned(),
    }
}

#[test]
fn trace_ends_at_a_mod_that_is_not_enabled() {
    let fixture = Fixture::new();
    fixture
        .library
        .toggle_mod_enabled(&fixture.config, &fixture.mod_id, false)
        .unwrap();
    fixture.save_build(&build(&[&fixture.mod_id]));

    let trace = fixture.trace();

    assert_eq!(readings(&trace), [&enabled(false)]);
    assert_eq!(trace.rows[0].state, RowState::Fail);
}

#[test]
fn trace_ends_at_the_advisory_of_a_mod_that_the_build_left_out() {
    let fixture = Fixture::new();
    let mut build = build(&[]);
    build.advisories.raise(
        Advisory::new(AdvisoryCode::EntryUnreadable, at(0))
            .about(AdvisorySubject::mod_id(fixture.mod_id.as_str())),
    );
    fixture.save_build(&build);
    fixture.games.record(&game(&[AATROX])).unwrap();

    let trace = fixture.trace();

    assert_eq!(
        readings(&trace),
        [
            &enabled(true),
            &RowReading::Health { check: None },
            &RowReading::Overlay(OverlayReading::LeftOut {
                advisory: AdvisoryCode::EntryUnreadable
            }),
        ]
    );
    assert!(trace.last_game.is_some());
}

#[test]
fn trace_ends_at_a_mod_that_was_enabled_after_the_build() {
    let fixture = Fixture::new();
    fixture.save_build(&build(&["another"]));

    let trace = fixture.trace();

    assert_eq!(
        trace.rows.last().map(|row| &row.reading),
        Some(&RowReading::Overlay(OverlayReading::WithoutMod {
            built_at: at(0)
        }))
    );
}

#[test]
fn trace_ends_at_a_missing_build() {
    let fixture = Fixture::new();

    let trace = fixture.trace();

    assert_eq!(
        trace.rows.last().map(|row| &row.reading),
        Some(&RowReading::Overlay(OverlayReading::NotBuilt))
    );
}

#[test]
fn trace_reads_every_row_of_a_mod_that_the_last_game_loaded() {
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

    let trace = fixture.trace();

    assert_eq!(
        readings(&trace),
        [
            &enabled(true),
            &RowReading::Health { check: None },
            &RowReading::Overlay(OverlayReading::Built { built_at: at(0) }),
            &RowReading::Archives {
                archives: vec![AATROX.to_owned(), GLOBAL.to_owned()]
            },
            &RowReading::Advisory {
                code: AdvisoryCode::LayersUnset
            },
            &RowReading::LastGame(GameReading::Loaded {
                loaded: 2,
                total: 2
            }),
        ]
    );
    assert_eq!(
        trace.last_game,
        Some(LastGame {
            started_at: at(2),
            ended_at: at(26),
            still_running: false
        })
    );
}

#[test]
fn trace_fails_for_a_mod_that_the_library_does_not_hold() {
    let fixture = Fixture::new();
    let gone = TraceSubject::Mod {
        id: "gone".to_owned(),
    };

    assert!(matches!(
        fixture.tracer().trace(&gone),
        Err(AppError::ModNotFound(_))
    ));
}

#[test]
fn trace_reads_a_project_by_the_name_of_its_directory() {
    let fixture = Fixture::new();
    let workshop = fixture.dir.path().join("workshop");
    fixture.save_build(&build(&["workshop:my-skin"]));
    fixture.games.record(&game(&[AATROX])).unwrap();
    let trace = |name: &str| {
        let subject = TraceSubject::Project {
            path: workshop.join(name),
        };
        fixture.tracer().trace(&subject).unwrap()
    };

    assert_eq!(
        readings(&trace("my-skin")),
        [
            &RowReading::Overlay(OverlayReading::Built { built_at: at(0) }),
            &RowReading::LastGame(GameReading::OverlayLive),
        ]
    );
    assert_eq!(
        readings(&trace("other")),
        [&RowReading::Overlay(OverlayReading::WithoutMod {
            built_at: at(0)
        })]
    );
}

#[test]
fn trace_reads_the_game_log_directory_only_if_the_setting_is_on() {
    let mut fixture = Fixture::new();
    let league = fixture.dir.path().join("league");
    let stamp = (at(40).with_timezone(&chrono::Local))
        .format("%Y-%m-%dT%H-%M-%S")
        .to_string();
    fs_err::create_dir_all(league.join("Logs").join("GameLogs").join(stamp)).unwrap();
    fixture.config.league_path = Some(league);
    fixture.save_build(&build(&[&fixture.mod_id]));
    let last = |tracer: ModTracer<'_>, fixture: &Fixture| {
        let trace = tracer.trace(&fixture.subject()).unwrap();
        trace.rows.last().map(|row| row.reading.clone())
    };
    let no_game = Some(RowReading::LastGame(GameReading::NoGame));

    assert_eq!(last(fixture.tracer(), &fixture), no_game);

    fixture.config.read_game_log = true;
    assert_eq!(
        last(fixture.tracer(), &fixture),
        Some(RowReading::LastGame(GameReading::PatcherNotRunning))
    );

    let open = ModTracer {
        game_open: true,
        ..fixture.tracer()
    };
    assert_eq!(last(open, &fixture), no_game);
}

#[test]
fn a_row_serializes_as_one_object_with_its_state_and_its_reading() {
    let refused = TraceRow::from(RowReading::LastGame(GameReading::OverlayNotLive {
        outcome: OverlayOutcome::Refused,
        patcher_code: Some("VRF00000008".to_owned()),
    }));
    let not_built = TraceRow::from(RowReading::Overlay(OverlayReading::NotBuilt));

    assert_eq!(
        serde_json::to_value(&refused).unwrap(),
        json!({
            "state": "fail",
            "row": "last-game",
            "reading": "overlay-not-live",
            "outcome": "refused",
            "patcherCode": "VRF00000008",
        })
    );
    assert_eq!(
        serde_json::to_value(&not_built).unwrap(),
        json!({ "state": "fail", "row": "overlay", "reading": "not-built" })
    );
}
