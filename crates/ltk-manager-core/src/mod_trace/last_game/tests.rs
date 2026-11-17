use ltk_manager_base::advisory::Advisory;
use ltk_manager_runtime::{
    diagnostics::incident::{GameRecord, SkippedArchive},
    patcher::SessionOrigin,
};

use super::{
    super::tests::{AATROX, GLOBAL, at, build, fingerprint, game},
    *,
};

/// The reading for a mod that patches `Aatrox.wad.client` and `Global.wad.client`, with no
/// read of the game log directory.
fn reading(build: &BuildRecord, game: Option<&StoredGame>) -> GameReading {
    let archives = [AATROX.to_owned(), GLOBAL.to_owned()];
    GameEvidence {
        build,
        game,
        archives: Some(&archives),
        champions: &["Aatrox".to_owned()],
        newest_logged_game: None,
        run_started_at: Some(at(1)),
    }
    .reading()
}

#[test]
fn reading_is_no_game_before_a_game_ran_the_build() {
    let build = build(&["a"]);
    let mut older = game(&[AATROX]);
    older.overlay_fingerprint = fingerprint("bbbb");

    assert_eq!(reading(&build, None), GameReading::NoGame);
    assert_eq!(reading(&build, Some(&older)), GameReading::NoGame);
}

#[test]
fn reading_compares_the_times_if_a_fingerprint_is_missing() {
    let mut build = build(&["a"]);
    build.fingerprint = None;
    let after = game(&[AATROX, GLOBAL]);
    let mut before = game(&[AATROX, GLOBAL]);
    before.started_at = at(0) - chrono::Duration::minutes(30);

    assert_eq!(
        reading(&build, Some(&after)),
        GameReading::Loaded {
            loaded: 2,
            total: 2
        }
    );
    assert_eq!(reading(&build, Some(&before)), GameReading::NoGame);
}

#[test]
fn reading_names_a_game_that_no_session_followed() {
    let build = build(&["a"]);
    let followed = game(&[AATROX]);
    let archives = [AATROX.to_owned()];
    let read = |game: Option<&StoredGame>, logged: u32, run: u32| {
        GameEvidence {
            build: &build,
            game,
            archives: Some(&archives),
            champions: &[],
            newest_logged_game: Some(at(logged)),
            run_started_at: Some(at(run)),
        }
        .reading()
    };

    // The manager ran when League started the game at minute 40.
    assert_eq!(read(Some(&followed), 40, 1), GameReading::PatcherNotRunning);
    assert_eq!(read(None, 40, 1), GameReading::PatcherNotRunning);
    // This run of the manager started after the game.
    assert_eq!(read(Some(&followed), 40, 50), GameReading::Unwatched);
    // The newest log directory is the one of the game that the session followed.
    assert_eq!(
        read(Some(&followed), 2, 1),
        GameReading::Loaded {
            loaded: 1,
            total: 1
        }
    );
}

#[test]
fn reading_ignores_a_logged_game_from_before_the_build() {
    let build = build(&["a"]);
    let evidence = GameEvidence {
        build: &build,
        game: None,
        archives: None,
        champions: &[],
        newest_logged_game: Some(at(0) - chrono::Duration::hours(3)),
        run_started_at: Some(at(1)),
    };

    assert_eq!(evidence.reading(), GameReading::NoGame);
}

#[test]
fn reading_holds_the_outcome_of_an_overlay_that_was_not_live() {
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
        reading(&build, Some(&late)),
        GameReading::OverlayNotLive {
            outcome: OverlayOutcome::TooLate,
            patcher_code: None
        }
    );
    assert_eq!(
        reading(&build, Some(&refused.stored(None))),
        GameReading::OverlayNotLive {
            outcome: OverlayOutcome::Refused,
            patcher_code: Some("VRF00000008".to_owned())
        }
    );
}

#[test]
fn reading_names_the_champions_if_league_opened_no_archive_of_the_mod() {
    let build = build(&["a"]);
    let other = game(&["Ahri.wad.client"]);

    assert_eq!(
        reading(&build, Some(&other)),
        GameReading::ArchivesNotLoaded {
            champions: vec!["Aatrox".to_owned()]
        }
    );
}

#[test]
fn reading_counts_the_archives_that_league_opened() {
    let build = build(&["a"]);

    assert_eq!(
        reading(&build, Some(&game(&["aatrox.wad.client", GLOBAL]))),
        GameReading::Loaded {
            loaded: 2,
            total: 2
        }
    );
    assert_eq!(
        reading(&build, Some(&game(&[GLOBAL]))),
        GameReading::Loaded {
            loaded: 1,
            total: 2
        }
    );
}

#[test]
fn reading_names_the_archives_that_the_patcher_could_not_open() {
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
        reading(&build, Some(&record.stored(None))),
        GameReading::ArchivesNotServed {
            archives: vec![AATROX.to_owned()]
        }
    );
}

#[test]
fn reading_is_a_live_overlay_for_a_mod_without_an_archive_report() {
    let build = build(&["a"]);
    let game = game(&[AATROX]);
    let evidence = GameEvidence {
        build: &build,
        game: Some(&game),
        archives: None,
        champions: &[],
        newest_logged_game: None,
        run_started_at: None,
    };

    assert_eq!(evidence.reading(), GameReading::OverlayLive);
}
