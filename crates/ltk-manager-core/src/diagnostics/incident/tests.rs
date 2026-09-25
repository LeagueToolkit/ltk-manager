//! Unit tests for the incident classifier and its verdicts.

use chrono::{TimeDelta, TimeZone};

use super::*;

fn at(secs: i64) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 8, 21, 21, 14, 0).unwrap() + TimeDelta::seconds(secs)
}

fn mods() -> Vec<ModFootprint> {
    let footprint = |id: &str, name: &str, priority: usize, wad: &str| ModFootprint {
        mod_id: id.to_string(),
        display_name: name.to_string(),
        priority,
        affected_wads: vec![wad.to_string()],
    };
    vec![
        footprint(
            "aatrox-justicar",
            "Aatrox Justicar",
            1,
            "DATA/FINAL/Champions/Aatrox.wad.client",
        ),
        footprint("classic-rift", "Classic Rift", 0, "Map11.wad.client"),
        footprint("ahri-star", "Ahri Star Guardian", 2, "Ahri.wad.client"),
    ]
}

fn no_path(_: u64) -> Option<String> {
    None
}

fn aatrox_path(hash: u64) -> Option<String> {
    (hash == 0x1a2b3c4d5e6f7081)
        .then(|| "assets/characters/aatrox/skins/skin12/aatrox_skin12_tx_cm.dds".to_string())
}

fn modded_game() -> GameRecord {
    let mut record = GameRecord::open(at(0), SessionOrigin::Library);
    record.ended_at = at(12);
    record.injected = true;
    record.overlay = OverlayOutcome::Live;
    record.scan = Some(ScanMode::Eager);
    record.redirected = [
        "Aatrox.wad.client",
        "Map11.wad.client",
        "UI.wad.client",
        "Global.wad.client",
    ]
    .map(String::from)
    .to_vec();
    record
}

fn crashed(mut record: GameRecord) -> GameRecord {
    record.ending = Ending {
        exit_reason: Some("Interrupt".to_string()),
        exit_code: Some(-1073741819),
        crashed: Some(true),
    };
    record
}

fn clean(mut record: GameRecord) -> GameRecord {
    record.ending = Ending {
        exit_reason: Some("Exit".to_string()),
        exit_code: Some(0),
        crashed: Some(false),
    };
    record
}

fn sighting(code: &str, at: f64, line: &str) -> CodeSighting {
    CodeSighting {
        code: code.to_string(),
        at,
        line: line.to_string(),
        detail: Vec::new(),
    }
}

fn channel(code: &str, at: f64) -> CodeSighting {
    sighting(code, at, &format!("{at:010.3}| ALWAYS|  LOAD| {code}"))
}

fn log_with(codes: Vec<CodeSighting>) -> GameLogFacts {
    GameLogFacts {
        build_version: Some("16.16.804.9184".to_string()),
        last_time: 12.4,
        codes,
        ..Default::default()
    }
}

fn classify(record: &GameRecord, resolve: &dyn Fn(u64) -> Option<String>) -> Option<Incident> {
    let mods = mods();
    record.classify(&ClassifyContext {
        mods: &mods,
        projects: &[],
        resolve_hash: resolve,
        league_path: None,
    })
}

fn names(incident: &Incident) -> Vec<&str> {
    incident
        .suspects
        .iter()
        .map(|suspect| suspect.display_name.as_str())
        .collect()
}

#[test]
fn a_clean_game_is_no_incident() {
    let mut record = clean(modded_game());
    record.log = Some(GameLogFacts {
        torn_down: true,
        ..log_with(vec![channel("SEJ-9F31B5D0", 3.0)])
    });
    assert_eq!(classify(&record, &no_path), None);
}

#[test]
fn a_build_failure_is_the_whole_story() {
    let mut record = GameRecord::open(at(0), SessionOrigin::Library);
    record.failure = Some(SessionFailure::Build {
        kind: ErrorKind::Io,
        category: None,
        message: "Overlay build failed: bad layer".to_string(),
    });
    let incident = classify(&record, &no_path).unwrap();
    assert_eq!(incident.verdict.kind, VerdictKind::OverlayBuildFailed);
    assert!(incident.verdict.cause.contains("merged into one overlay"));
    // The kind survives the message, so a thin error still says what failed.
    assert!(
        incident
            .verdict
            .cause
            .ends_with("IO: Overlay build failed: bad layer.")
    );
    assert_eq!(
        incident.evidence[0].line,
        "overlay build failed, IO: Overlay build failed: bad layer"
    );
    assert!(incident.suspects.is_empty());
    assert!(incident.game.is_none());
    assert!(!incident.id.is_empty());
}

/// A build failure's hints follow the overlay's own category: a wrong game
/// directory is fixed in Settings, corrupt game files by a repair, a builder
/// bug by an update or a report. Rebuilding fixes none of those, so the
/// rebuild hint stays only where nothing more specific is known.
#[test]
fn a_build_failure_hints_at_the_category_remedy() {
    let cases: [(Option<OverlayErrorCategory>, &[Hint]); 6] = [
        (Some(OverlayErrorCategory::GameDir), &[Hint::CheckGamePath]),
        (
            Some(OverlayErrorCategory::Corrupt),
            &[Hint::RebuildOverlay, Hint::RepairInstall],
        ),
        (
            Some(OverlayErrorCategory::Bug),
            &[Hint::UpdateManager, Hint::CopyReport],
        ),
        (
            Some(OverlayErrorCategory::ModContent),
            &[Hint::RebuildOverlay],
        ),
        (Some(OverlayErrorCategory::FileInUse), &[Hint::CloseGame]),
        (None, &[Hint::RebuildOverlay]),
    ];

    for (category, hints) in cases {
        let mut record = GameRecord::open(at(0), SessionOrigin::Library);
        record.failure = Some(SessionFailure::Build {
            kind: ErrorKind::Overlay,
            category,
            message: "it did not build".to_string(),
        });
        let incident = classify(&record, &no_path).unwrap();
        assert_eq!(incident.verdict.hints, hints, "for {category:?}");
    }
}

/// Records written before the category was kept load with `None`, so an
/// upgrade never invalidates the incident store.
#[test]
fn a_build_failure_without_a_category_still_loads() {
    let json = r#"{"build":{"kind":"IO","message":"Access is denied."}}"#;
    let failure: SessionFailure = serde_json::from_str(json).unwrap();
    assert_eq!(
        failure,
        SessionFailure::Build {
            kind: ErrorKind::Io,
            category: None,
            message: "Access is denied.".to_string(),
        }
    );
}

#[test]
fn a_host_failure_points_at_the_system_checks() {
    let mut record = GameRecord::open(at(0), SessionOrigin::Library);
    record.failure = Some(SessionFailure::Injection {
        stage: InjectionStage::Host,
        message: "host stdout closed".to_string(),
    });
    let incident = classify(&record, &no_path).unwrap();
    assert_eq!(incident.verdict.kind, VerdictKind::InjectionHostFailed);
    assert_eq!(incident.verdict.hints, [Hint::SystemChecks]);
}

#[test]
fn a_dll_that_never_attached_hints_at_elevation_or_the_signature() {
    let mut record = GameRecord::open(at(0), SessionOrigin::Library);
    record.failure = Some(SessionFailure::Injection {
        stage: InjectionStage::Injection,
        message: "DLL never attached after 60s".to_string(),
    });
    let incident = classify(&record, &no_path).unwrap();
    assert_eq!(incident.verdict.kind, VerdictKind::PatcherDidNotRun);
    assert!(incident.verdict.cause.contains("never got into League"));
    assert!(
        incident
            .verdict
            .cause
            .ends_with("DLL never attached after 60s.")
    );
    assert_eq!(incident.verdict.hints, [Hint::Elevate, Hint::SystemChecks]);

    record.host_elevated = true;
    let incident = classify(&record, &no_path).unwrap();
    assert_eq!(
        incident.verdict.hints,
        [Hint::Signature, Hint::SystemChecks]
    );
}

#[test]
fn an_end_of_life_dll_is_an_out_of_date_patcher_even_on_a_clean_ending() {
    let mut record = clean(modded_game());
    record.overlay = OverlayOutcome::EndOfLife;
    record.overlay_detail = Some(OverlayDetail::Build("0x68a1b2c3".to_string()));
    let incident = classify(&record, &no_path).unwrap();
    assert_eq!(incident.verdict.kind, VerdictKind::PatcherOutOfDate);
    assert!(
        incident
            .verdict
            .cause
            .starts_with("The patcher does not know this version of League.")
    );
    assert!(incident.verdict.cause.contains("0x68a1b2c3"));
    assert_eq!(incident.verdict.hints, [Hint::UpdateManager]);
    assert!(incident.suspects.is_empty());
}

#[test]
fn a_rejected_archive_names_its_writers() {
    let mut record = clean(modded_game());
    record.scan_failures = vec![WadScanFailure {
        wad: Some("DATA/FINAL/Champions/Aatrox.wad.client".to_string()),
        status: "c0000229".to_string(),
    }];
    let incident = classify(&record, &no_path).unwrap();
    assert_eq!(incident.verdict.kind, VerdictKind::SkinhackDetected);
    assert_eq!(
        incident.verdict.subject.as_deref(),
        Some("Aatrox.wad.client")
    );
    assert_eq!(incident.scan_status, Some(ScanStatus::Skinhack));
    assert_eq!(incident.scan_status_code.as_deref(), Some("c0000229"));
    assert_eq!(incident.scan_rejected, 1);
    // The words are the frontend's, from the three fields above.
    assert!(incident.verdict.cause.is_empty());
    // The finding a player recognises, not the machinery that caught it.
    assert_eq!(incident.verdict.title, "Skinhack Detection");
    assert_eq!(incident.verdict.title_override, None);
    assert_eq!(names(&incident), ["Aatrox Justicar"]);
    assert_eq!(
        incident.suspects[0].because,
        "writes Aatrox.wad.client, which the scan rejected"
    );
    assert_eq!(incident.verdict.hints, [Hint::RemoveSkinhack]);

    record.scan_failures[0].status = "base_skin".to_string();
    let incident = classify(&record, &no_path).unwrap();
    assert_eq!(incident.scan_status, Some(ScanStatus::BaseSkin));
    assert_eq!(incident.verdict.hints, [Hint::ReimportMod]);
    // Only a skinhack reaches its own kind.
    assert_eq!(incident.verdict.kind, VerdictKind::ArchiveRejected);
    assert_eq!(incident.verdict.title, "Archive Scan Rejection");

    // The DLL renamed the token it reports this by, so the rejection has to
    // read the same either way or one player's history splits across an update.
    record.scan_failures[0].status = "mod_wad".to_string();
    let renamed = classify(&record, &no_path).unwrap();
    assert_eq!(renamed.scan_status, incident.scan_status);
    assert_eq!(renamed.verdict.hints, incident.verdict.hints);
    assert_eq!(renamed.scan_status_code.as_deref(), Some("mod_wad"));

    record.scan_failures[0].status = "base_wad".to_string();
    let incident = classify(&record, &no_path).unwrap();
    assert_eq!(incident.scan_status, Some(ScanStatus::BaseWad));
    assert_eq!(incident.verdict.hints, [Hint::RepairGame]);

    // A burst is counted, so the frontend can say how many it does not name.
    record.scan_failures.push(WadScanFailure {
        wad: Some("Ahri.wad.client".to_string()),
        status: "base_wad".to_string(),
    });
    let incident = classify(&record, &no_path).unwrap();
    assert_eq!(incident.scan_rejected, 2);
}

/// The tokens the DLL emits are the contract, and one this build cannot name
/// reaches the player as a status with no reading and no fix.
#[test]
fn every_token_the_dll_emits_reads_and_advises() {
    let table = [
        ("c0000229", ScanStatus::Skinhack),
        ("c0000225", ScanStatus::MissingBin),
        ("c000003e", ScanStatus::Corrupt),
        ("mod_wad", ScanStatus::BaseSkin),
        ("base_wad", ScanStatus::BaseWad),
        // What `mod_wad` replaced, still read for a history an older DLL wrote.
        ("base_skin", ScanStatus::BaseSkin),
        // The game's own scan, which the DLL passes through untouched.
        ("c0000017", ScanStatus::OutOfMemory),
        ("c000009a", ScanStatus::OutOfMemory),
    ];
    for (token, status) in table {
        assert_eq!(ScanStatus::parse(token), status, "{token} reads wrong");
        assert_eq!(
            ScanStatus::parse(&format!("  {}  ", token.to_uppercase())),
            status,
            "{token} does not survive a change of case or a stray space"
        );
    }
    // The game writes its codes with the prefix as often as without.
    assert_eq!(ScanStatus::parse("0xC0000229"), ScanStatus::Skinhack);

    for status in [
        ScanStatus::Skinhack,
        ScanStatus::MissingBin,
        ScanStatus::Corrupt,
        ScanStatus::OutOfMemory,
        ScanStatus::BaseSkin,
        ScanStatus::BaseWad,
        ScanStatus::Unknown,
    ] {
        let _ = status.hint();
    }
}

/// The two halves of the evidence phrase live in different modules, so only
/// a round trip catches one of them being reworded on its own.
#[test]
fn a_rejection_reads_back_the_status_it_wrote() {
    for wad in [Some("Aatrox.wad.client".to_string()), None] {
        for status in [
            "c0000229",
            "base_skin",
            "mod_wad",
            "base_wad",
            "c000003e",
            "deadbeef",
        ] {
            let failure = WadScanFailure {
                wad: wad.clone(),
                status: status.to_string(),
            };
            assert_eq!(
                ScanStatus::from_evidence_line(&failure.evidence_line()),
                Some(ScanStatus::parse(status)),
                "{} does not read back",
                failure.evidence_line()
            );
        }
    }
}

#[test]
fn a_disabled_overlay_records_on_a_clean_ending() {
    let mut record = clean(modded_game());
    record.overlay = OverlayOutcome::Disabled;
    record.overlay_detail = Some(OverlayDetail::Rejected {
        wad: "Aatrox.wad.client".to_string(),
        why: "file would not open".to_string(),
    });
    let incident = classify(&record, &no_path).unwrap();
    assert_eq!(incident.verdict.kind, VerdictKind::OverlayDisabled);
    assert_eq!(
        incident.verdict.subject.as_deref(),
        Some("Aatrox.wad.client")
    );
    assert!(
        incident
            .verdict
            .cause
            .contains("Aatrox.wad.client did not verify: file would not open.")
    );
    assert_eq!(names(&incident), ["Aatrox Justicar"]);
    assert_eq!(incident.verdict.hints, [Hint::RebuildOverlay]);
}

#[test]
fn an_unmodded_crash_says_why_and_an_unmodded_clean_game_is_nothing() {
    let mut record = crashed(modded_game());
    record.injected = false;
    record.overlay = OverlayOutcome::None;
    record.redirected.clear();
    let incident = classify(&record, &no_path).unwrap();
    assert_eq!(incident.verdict.kind, VerdictKind::Unmodded);
    assert!(incident.verdict.cause.contains("never attached"));

    record.injected = true;
    record.overlay = OverlayOutcome::TooLate;
    let incident = classify(&record, &no_path).unwrap();
    assert!(incident.verdict.cause.contains("joined too late"));
    assert_eq!(incident.verdict.hints, [Hint::StartFirst]);

    assert_eq!(classify(&clean(record), &no_path), None);
}

fn missing_data_line() -> CodeSighting {
    sighting(
        "ALE-9B39AA45",
        12.344,
        "000012.344|  ERROR| ALE-9B39AA45 FATAL ERROR. Missing data: 0x1a2b3c4d5e6f7081",
    )
}

#[test]
fn missing_data_with_a_path_names_the_archive_writer() {
    let mut record = crashed(modded_game());
    record.log = Some(log_with(vec![
        channel("SEJ-9F31B5D0", 12.301),
        missing_data_line(),
    ]));
    let incident = classify(&record, &aatrox_path).unwrap();
    assert_eq!(incident.verdict.kind, VerdictKind::MissingData);
    assert_eq!(incident.verdict.title, "Missing Game Data");
    // The path is the answer, so it is the subject and not a clause.
    assert_eq!(
        incident.verdict.subject.as_deref(),
        Some("assets/characters/aatrox/skins/skin12/aatrox_skin12_tx_cm.dds")
    );
    assert!(!incident.verdict.cause.contains("assets/characters"));
    assert_eq!(names(&incident), ["Aatrox Justicar"]);
    assert_eq!(
        incident.suspects[0].because,
        "writes Aatrox.wad.client, which holds the path"
    );
    assert_eq!(incident.verdict.hints, [Hint::DisableSuspect]);
}

#[test]
fn missing_data_with_two_writers_names_both() {
    let mut record = crashed(modded_game());
    record.log = Some(log_with(vec![missing_data_line()]));
    let mut mods = mods();
    mods.push(ModFootprint {
        mod_id: "aatrox-other".to_string(),
        display_name: "Aatrox Other".to_string(),
        priority: 0,
        affected_wads: vec!["aatrox.WAD.client".to_string()],
    });
    let incident = record
        .classify(&ClassifyContext {
            mods: &mods,
            projects: &[],
            resolve_hash: &aatrox_path,
            league_path: None,
        })
        .unwrap();
    assert_eq!(names(&incident), ["Aatrox Other", "Aatrox Justicar"]);
}

#[test]
fn missing_data_without_a_path_lists_the_redirected_writers() {
    let mut record = crashed(modded_game());
    record.log = Some(log_with(vec![missing_data_line()]));
    let incident = classify(&record, &no_path).unwrap();
    assert_eq!(incident.verdict.subject, None);
    assert!(incident.verdict.cause.contains("0x1a2b3c4d5e6f7081"));
    assert_eq!(names(&incident), ["Classic Rift", "Aatrox Justicar"]);
    assert_eq!(
        incident.suspects[0].because,
        "writes Map11.wad.client, redirected this game"
    );
}

#[test]
fn a_log_verdict_applies_even_when_the_client_said_exit() {
    let mut record = clean(modded_game());
    record.log = Some(log_with(vec![missing_data_line()]));
    let incident = classify(&record, &aatrox_path).unwrap();
    assert_eq!(incident.verdict.kind, VerdictKind::MissingData);
}

fn wad_mount_sighting(problem: Option<&str>) -> CodeSighting {
    let mut sighting = sighting(
        "ALE-18967994",
        1.912,
        "000001.912|  ERROR| ALE-18967994 FATAL ERROR. WadFile mount failed",
    );
    sighting
        .detail
        .push("- WadFile: DATA/FINAL/Shaders/Shaders.wad.client".to_string());
    if let Some(problem) = problem {
        sighting.detail.push(format!("- Problem: {problem}"));
    }
    sighting
}

fn shader_mods() -> Vec<ModFootprint> {
    let mut mods = mods();
    mods.push(ModFootprint {
        mod_id: "neon-shaders".to_string(),
        display_name: "Neon Shaders".to_string(),
        priority: 3,
        affected_wads: vec![
            "DATA/FINAL/Shaders/Shaders.wad.client".to_string(),
            "Map11.wad.client".to_string(),
        ],
    });
    mods
}

fn classify_with(record: &GameRecord, mods: &[ModFootprint]) -> Option<Incident> {
    record.classify(&ClassifyContext {
        mods,
        projects: &[],
        resolve_hash: &no_path,
        league_path: None,
    })
}

/// The lines under the code name the archive and the problem, and the verdict
/// names both. Inconsistent is the one an overlay makes, and a repair of the
/// install finds nothing to fix, so the rebuild hint stands alone.
#[test]
fn a_wad_mount_fatal_names_the_archive_and_the_problem() {
    let mut record = crashed(modded_game());
    record.redirected = vec!["Shaders.wad.client".to_string()];
    record.log = Some(log_with(vec![wad_mount_sighting(Some("Inconsistent"))]));
    let incident = classify_with(&record, &shader_mods()).unwrap();
    assert_eq!(incident.verdict.kind, VerdictKind::CorruptArchive);
    assert_eq!(
        incident.verdict.subject.as_deref(),
        Some("Shaders.wad.client")
    );
    assert_eq!(
        incident.verdict.cause,
        "League could not mount Shaders.wad.client. The game found it inconsistent with another mounted archive."
    );
    assert_eq!(incident.verdict.hints, [Hint::RebuildOverlay]);
    assert_eq!(names(&incident), ["Neon Shaders"]);
    assert_eq!(
        incident.suspects[0].because,
        "writes Shaders.wad.client, which League could not mount"
    );
}

#[test]
fn the_other_mount_problems_keep_the_repair_hint() {
    let cases = [
        ("Missing", "The game found it missing."),
        ("Unable to open", "The game could not open it."),
        ("Corrupt", "The game found it corrupt."),
    ];
    for (word, reading) in cases {
        let mut record = crashed(modded_game());
        record.log = Some(log_with(vec![wad_mount_sighting(Some(word))]));
        let incident = classify_with(&record, &shader_mods()).unwrap();
        assert_eq!(
            incident.verdict.cause,
            format!("League could not mount Shaders.wad.client. {reading}"),
            "{word}"
        );
        assert_eq!(
            incident.verdict.hints,
            [Hint::RebuildOverlay, Hint::RepairInstall],
            "{word}"
        );
    }

    let mut record = crashed(modded_game());
    record.log = Some(log_with(vec![wad_mount_sighting(Some("Haunted"))]));
    let incident = classify_with(&record, &shader_mods()).unwrap();
    assert_eq!(
        incident.verdict.cause,
        "League could not mount Shaders.wad.client. The game reported the problem as Haunted."
    );
    assert_eq!(
        incident.verdict.hints,
        [Hint::RebuildOverlay, Hint::RepairInstall]
    );

    record.log = Some(log_with(vec![wad_mount_sighting(None)]));
    let incident = classify_with(&record, &shader_mods()).unwrap();
    assert_eq!(
        incident.verdict.cause,
        "League could not mount Shaders.wad.client."
    );
}

/// The reporter's log, read by the reader and classified against a library
/// with one mod writing the archive.
#[test]
fn the_reporters_log_names_the_shaders_archive_and_its_writer() {
    let incident = classify_with(&reporters_record(), &shader_mods()).unwrap();
    assert_eq!(incident.verdict.kind, VerdictKind::CorruptArchive);
    assert_eq!(
        incident.verdict.subject.as_deref(),
        Some("Shaders.wad.client")
    );
    assert!(incident.verdict.cause.contains("inconsistent"));
    assert_eq!(incident.verdict.hints, [Hint::RebuildOverlay]);
    assert_eq!(names(&incident), ["Neon Shaders"]);
    assert_eq!(incident.phase, GamePhase::Loading);
    assert_eq!(
        incident.game.as_ref().map(|game| game.version.as_str()),
        Some("16.17.812.1337")
    );
}

fn classify_for(record: &GameRecord, league_path: &str) -> Option<Incident> {
    record.classify(&ClassifyContext {
        mods: &shader_mods(),
        projects: &[],
        resolve_hash: &no_path,
        league_path: Some(Path::new(league_path)),
    })
}

fn reporters_record() -> GameRecord {
    let facts = GameLogFacts::read(std::io::Cursor::new(include_str!(
        "../fixtures/wad_mount_r3dlog.txt"
    )))
    .unwrap();
    let mut record = modded_game();
    record.ended_at = at(2);
    record.redirected = vec!["Shaders.wad.client".to_string()];
    record.log_searched = true;
    record.log_root = Some(PathBuf::from(r"C:\Riot Games\League of Legends"));
    record.log = Some(facts);
    record
}

/// The reporter's machine: the manager set up for PBE, the live game's log
/// found under the live install. The wad mount fatal is still in the evidence,
/// and the verdict is the install rather than the archive.
#[test]
fn the_reporters_log_against_the_pbe_path_is_a_wrong_install() {
    let incident = classify_for(
        &reporters_record(),
        r"C:\Riot Games\League of Legends (PBE)",
    )
    .unwrap();
    assert_eq!(incident.verdict.kind, VerdictKind::WrongInstall);
    assert_eq!(incident.verdict.consequence, Consequence::GameStopped);
    assert_eq!(
        incident.verdict.cause,
        "League ran from C:/Riot Games/League of Legends, and the overlay was built for C:/Riot Games/League of Legends (PBE). A mod built from one install crashes the other."
    );
    assert_eq!(incident.verdict.hints, [Hint::CheckGamePath]);
    assert!(incident.suspects.is_empty());
    assert_eq!(
        incident
            .game
            .as_ref()
            .and_then(|game| game.game_base_dir.as_deref()),
        Some("C:/Riot Games/League of Legends")
    );
    assert!(incident.evidence.iter().any(|row| {
        row.code
            .as_ref()
            .is_some_and(|code| code.id == "ALE-18967994")
    }));
}

/// The same install spelled another way is the same install.
#[test]
fn the_reporters_log_against_the_live_path_names_the_archive() {
    for spelling in [
        r"C:\Riot Games\League of Legends",
        "C:/Riot Games/League of Legends/",
        r"c:\riot games\league of legends",
    ] {
        let incident = classify_for(&reporters_record(), spelling).unwrap();
        assert_eq!(
            incident.verdict.kind,
            VerdictKind::CorruptArchive,
            "{spelling}"
        );
    }
}

/// A game from the other install that ends the way the client meant it to is
/// no incident. The client check is what names the mismatch while it runs.
#[test]
fn a_clean_game_from_another_install_is_no_incident() {
    let mut record = clean(modded_game());
    record.log_searched = true;
    record.log = Some(GameLogFacts {
        game_base_dir: Some(r"C:\Riot Games\League of Legends".to_string()),
        torn_down: true,
        ..log_with(Vec::new())
    });
    let pbe = r"C:\Riot Games\League of Legends (PBE)";
    assert_eq!(classify_for(&record, pbe), None);

    let record = crashed(record);
    assert_eq!(
        classify_for(&record, pbe).unwrap().verdict.kind,
        VerdictKind::WrongInstall
    );
}

/// A log with no base dir, or a record without a configured path, says nothing
/// about the install.
#[test]
fn a_wrong_install_needs_both_paths() {
    let mut record = reporters_record();
    assert_eq!(
        classify_with(&record, &shader_mods()).unwrap().verdict.kind,
        VerdictKind::CorruptArchive
    );
    record.log.as_mut().unwrap().game_base_dir = None;
    assert_eq!(
        classify_for(&record, r"C:\Riot Games\League of Legends (PBE)")
            .unwrap()
            .verdict
            .kind,
        VerdictKind::CorruptArchive
    );
}

/// An incident stored before the game's base dir was kept reads with none.
#[test]
fn a_stored_game_without_a_base_dir_reads() {
    let game: GameInfo = serde_json::from_value(serde_json::json!({
        "version": "16.16.804.9184",
        "contentVersion": "16.16.1",
        "logPath": "x",
    }))
    .expect("the game reads");
    assert_eq!(game.game_base_dir, None);
}

#[test]
fn a_corrupt_archive_reads_its_row_and_lists_the_redirected_writers() {
    let mut record = crashed(modded_game());
    record.log = Some(log_with(vec![channel("ALE-18967993", 5.0)]));
    let incident = classify(&record, &no_path).unwrap();
    assert_eq!(incident.verdict.kind, VerdictKind::CorruptArchive);
    assert!(
        incident
            .verdict
            .cause
            .contains("An archive could not be mounted, because it is corrupt.")
    );
    assert_eq!(names(&incident), ["Classic Rift", "Aatrox Justicar"]);
    assert_eq!(
        incident.verdict.hints,
        [Hint::RebuildOverlay, Hint::RepairInstall]
    );

    record.log = Some(log_with(vec![channel("ALE-89b0dee7", 5.0)]));
    let incident = classify(&record, &no_path).unwrap();
    assert!(
        incident
            .verdict
            .cause
            .contains("An archive holds an invalid sub-chunk.")
    );
}

/// Nothing in the log says which texture failed or where it came from, and
/// the game's own textures fail this way too, so naming a mod would be a
/// guess dressed as a finding.
#[test]
fn a_texture_failure_names_no_mod_whichever_code_reported_it() {
    let mut record = crashed(modded_game());
    for code in ["ALE-D0D00020", "ALE-D0D00022", "ALE-D0D00023"] {
        record.log = Some(log_with(vec![
            channel("SEJ-3E9A0C57", 8.9),
            sighting(
                code,
                9.0,
                &format!(r#"000009.000|  ERROR| Error: "{code}" - Result: E_INVALIDARG."#),
            ),
        ]));
        let incident = classify(&record, &no_path).unwrap();
        assert_eq!(incident.verdict.kind, VerdictKind::TextureFailed, "{code}");
        assert!(incident.suspects.is_empty(), "{code} named a mod");
        assert!(incident.verdict.cause.contains("onto the GPU"), "{code}");
        assert_eq!(
            incident.verdict.hints,
            [Hint::TextureDimensions, Hint::RebuildOverlay],
            "{code} lost the dimensions hint"
        );
    }
}

#[test]
fn out_of_memory_reads_the_code_that_named_it() {
    let mut record = crashed(modded_game());
    record.log = Some(log_with(vec![channel("ALE-546D9FE7", 9.0)]));
    let incident = classify(&record, &no_path).unwrap();
    assert_eq!(incident.verdict.kind, VerdictKind::OutOfMemory);
    assert!(incident.suspects.is_empty());
    assert_eq!(
        incident.verdict.hints,
        [Hint::FreeMemory, Hint::LargeTextures]
    );
    record.redirected.clear();
    let unmodded = classify(&record, &no_path).unwrap();
    assert_eq!(unmodded.verdict.hints, [Hint::FreeMemory]);
    // An allocation has more causes than a mod, and the cause must say so.
    assert!(incident.verdict.cause.contains("free RAM"));
    assert!(incident.verdict.cause.contains("page file"));

    record.log = Some(log_with(vec![
        channel("ALE-546D9FE7", 9.0),
        channel("ALE-71BBD00F", 9.1),
    ]));
    let incident = classify(&record, &no_path).unwrap();
    assert!(
        incident
            .verdict
            .cause
            .contains("The graphics device ran out of memory.")
    );
}

#[test]
fn a_graphics_fault_names_no_suspect() {
    let mut record = crashed(modded_game());
    record.log = Some(log_with(vec![channel("ALE-3112373", 9.0)]));
    let incident = classify(&record, &no_path).unwrap();
    assert_eq!(incident.verdict.kind, VerdictKind::GraphicsFault);
    assert!(incident.suspects.is_empty());
    assert_eq!(incident.verdict.hints, [Hint::UpdateDriver]);
}

fn stuck_at(code: &str) -> GameRecord {
    let mut record = crashed(modded_game());
    record.log = Some(GameLogFacts {
        last_load_step: Some(channel(code, 12.3)),
        loading_ended: false,
        ..log_with(vec![channel("SEJ-1A4F7C20", 3.0), channel(code, 12.3)])
    });
    record
}

#[test]
fn stuck_at_step_52_names_the_champion_mods_and_62_the_map_mods() {
    let incident = classify(&stuck_at("SEJ-9F31B5D0"), &no_path).unwrap();
    assert_eq!(incident.verdict.kind, VerdictKind::StuckLoading);
    assert_eq!(incident.verdict.subject.as_deref(), Some("step 52 of 64"));
    assert!(
        incident.verdict.cause.starts_with(
            "League stopped at loading step 52 of 64, mounting the champions' archives."
        )
    );
    assert_eq!(names(&incident), ["Aatrox Justicar"]);

    let incident = classify(&stuck_at("SEJ-3E9A0C57"), &no_path).unwrap();
    assert_eq!(names(&incident), ["Classic Rift"]);

    let incident = classify(&stuck_at("SEJ-5C2A6F38"), &no_path).unwrap();
    assert_eq!(incident.verdict.subject.as_deref(), Some("step 44 of 64"));
    assert!(incident.suspects.is_empty());
}

#[test]
fn a_stall_names_the_unmarked_steps_its_marker_covers() {
    let cause = |code| classify(&stuck_at(code), &no_path).unwrap().verdict.cause;
    assert!(cause("SEJ-9F31B5D0").ends_with("this is the step that did not finish."));
    assert!(cause("SEJ-5F4B27D8").ends_with("the step that did not finish is 63 or 64."));
    assert!(cause("SEJ-6B0D93F1").ends_with(
        "steps 56 to 58 write no marker of their own, so the step that did not finish is one of 55 to 58."
    ));
}

#[test]
fn a_loading_screen_the_player_left_is_not_stuck() {
    let record = clean(stuck_at("SEJ-9F31B5D0"));
    assert_eq!(classify(&record, &no_path), None);
}

#[test]
fn an_early_crash_under_the_lazy_scan_earns_the_up_front_hint() {
    let mut record = stuck_at("SEJ-9F31B5D0");
    record.scan = Some(ScanMode::Lazy);
    let incident = classify(&record, &no_path).unwrap();
    assert_eq!(incident.verdict.hints, [Hint::ScanUpFront]);
}

#[test]
fn a_skipped_archive_records_on_a_clean_ending() {
    let mut record = clean(modded_game());
    record.skipped = vec![SkippedArchive {
        wad: "DATA/FINAL/Champions/Ahri.wad.client".to_string(),
        why: "signature did not check".to_string(),
    }];
    let incident = classify(&record, &no_path).unwrap();
    assert_eq!(incident.verdict.kind, VerdictKind::ArchiveSkipped);
    assert!(
        incident
            .verdict
            .cause
            .starts_with("One archive was left unmodded.")
    );
    assert_eq!(incident.verdict.subject.as_deref(), Some("Ahri.wad.client"));
    assert_eq!(names(&incident), ["Ahri Star Guardian"]);
    assert_eq!(
        incident.suspects[0].because,
        "writes Ahri.wad.client, which the lazy scan skipped"
    );
}

#[test]
fn an_ending_with_no_reason_lists_the_facts() {
    let mut record = crashed(modded_game());
    record.log = Some(GameLogFacts {
        error_lines: 3,
        ..log_with(Vec::new())
    });
    let incident = classify(&record, &no_path).unwrap();
    assert_eq!(incident.verdict.kind, VerdictKind::EndedWithoutReason);
    let cause = &incident.verdict.cause;
    assert!(cause.starts_with("League closed, and left no reason the manager can read."));
    assert!(cause.contains("Interrupt, exit code 0xC0000005 STATUS_ACCESS_VIOLATION"));
    assert!(cause.contains("Crashpad ran."));
    assert!(cause.contains("3 error lines"));
    assert_eq!(incident.verdict.hints, [Hint::CopyReport]);
}

/// The reporter's game: two seconds after the DLL redirected an archive the
/// game was gone, and the configured install held no log for it.
#[test]
fn a_short_redirected_game_without_a_log_is_an_incident() {
    let mut record = modded_game();
    record.ended_at = at(2);
    record.log_searched = true;
    assert!(!record.worth_reporting());
    let incident = classify(&record, &no_path).unwrap();
    assert_eq!(incident.verdict.kind, VerdictKind::EndedWithoutReason);
    assert_eq!(
        incident.verdict.cause,
        "League ended 2 seconds after the patcher redirected an archive into it, and no game log for the game was found under the configured install."
    );
    assert_eq!(incident.verdict.hints, [Hint::CheckGamePath]);
    assert!(incident.suspects.is_empty());
    assert_eq!(incident.game, None);
}

#[test]
fn a_short_game_without_a_redirect_stays_clean_without_a_log() {
    let mut record = modded_game();
    record.ended_at = at(2);
    record.log_searched = true;
    record.redirected.clear();
    assert_eq!(classify(&record, &no_path), None);
}

#[test]
fn a_game_past_the_bound_stays_clean_without_a_log() {
    let mut record = modded_game();
    record.ended_at = at(120);
    record.log_searched = true;
    assert_eq!(classify(&record, &no_path), None);
}

/// With the reader off nothing was looked for, and a missing log says nothing.
#[test]
fn a_short_game_the_reader_never_looked_at_stays_clean() {
    let mut record = modded_game();
    record.ended_at = at(2);
    assert_eq!(classify(&record, &no_path), None);
}

#[test]
fn a_crash_marker_alone_is_worth_reporting() {
    let mut record = modded_game();
    record.ending.crashed = Some(true);
    assert!(record.worth_reporting());
    assert_eq!(
        classify(&record, &no_path).unwrap().verdict.kind,
        VerdictKind::EndedWithoutReason
    );
}

#[test]
fn on_the_classic_flow_the_log_decides() {
    let mut record = modded_game();
    assert!(!record.worth_reporting());
    record.log = Some(log_with(Vec::new()));
    assert!(record.worth_reporting());
    record.log.as_mut().unwrap().torn_down = true;
    assert!(!record.worth_reporting());
    assert_eq!(classify(&record, &no_path), None);
}

#[test]
fn a_non_zero_code_with_an_exit_reason_is_worth_reporting() {
    let mut record = clean(modded_game());
    record.ending.exit_code = Some(1);
    assert!(record.worth_reporting());
    record.ending.exit_code = Some(0);
    record.ending.exit_reason = Some("Timeout".to_string());
    assert!(record.worth_reporting());
}

#[test]
fn evidence_is_newest_first_on_the_game_clock() {
    let mut record = crashed(modded_game());
    record.timeline = vec![
        RawEvidence {
            at: at(4),
            source: EvidenceSource::Host,
            line: "injected, pid 18232".to_string(),
        },
        RawEvidence {
            at: at(0),
            source: EvidenceSource::Dll,
            line: "redirected Aatrox.wad.client".to_string(),
        },
    ];
    record.log = Some(log_with(vec![missing_data_line()]));
    let incident = classify(&record, &aatrox_path).unwrap();
    let rows: Vec<(&str, EvidenceSource)> = incident
        .evidence
        .iter()
        .map(|row| (row.at.as_str(), row.source))
        .collect();
    assert_eq!(
        rows,
        [
            ("00:12.4", EvidenceSource::Client),
            ("00:12.3", EvidenceSource::Game),
            ("00:04.0", EvidenceSource::Host),
            ("00:00.0", EvidenceSource::Dll),
        ]
    );
    assert_eq!(
        incident.evidence[0].line,
        "Interrupt, exit code 0xC0000005 STATUS_ACCESS_VIOLATION"
    );
    let code = incident.evidence[1].code.as_ref().unwrap();
    assert_eq!(code.id, "ALE-9B39AA45");
    assert_eq!(code.kind.as_deref(), Some("missing_data"));
    assert_eq!(code.mark, Some(EvidenceMark::Confirmed));
    assert!(incident.evidence[1].is_error_level());
}

#[test]
fn an_unknown_code_keeps_its_id_and_nothing_else() {
    let code = EvidenceCode::from_table("SEJ-ZZZZZZZZ");
    assert_eq!(code.id, "SEJ-ZZZZZZZZ");
    assert_eq!(code.kind, None);
    assert_eq!(code.meaning, None);
    assert_eq!(code.mark, None);
}

#[test]
fn the_id_is_the_log_stamp_when_there_is_a_log() {
    let mut record = crashed(modded_game());
    // Forward slashes: Windows accepts them, and `\` is not a separator on the CI host.
    record.log_path = Some(PathBuf::from(
        "C:/Riot Games/League of Legends/Logs/GameLogs/2026-08-21T21-14-02/2026-08-21T21-14-02_r3dlog.txt",
    ));
    record.log = Some(log_with(Vec::new()));
    let incident = classify(&record, &no_path).unwrap();
    assert_eq!(incident.id, "2026-08-21T21-14-02");
    let game = incident.game.unwrap();
    assert_eq!(game.version, "16.16.804.9184");
    assert_eq!(game.content_version, "");
    assert!(game.log_path.ends_with("_r3dlog.txt"));
    assert_eq!(incident.started_at, "2026-08-21T21:14:00+00:00");
    assert_eq!(incident.ended_at, "2026-08-21T21:14:12+00:00");
}

#[test]
fn a_workshop_test_names_the_project_and_the_open_hint() {
    let mut record = clean(modded_game());
    record.origin = SessionOrigin::Workshop {
        projects: vec![r"C:\ws\aatrox".to_string()],
    };
    record.skipped = vec![SkippedArchive {
        wad: "Aatrox.wad.client".to_string(),
        why: "hash mismatch".to_string(),
    }];
    let projects = [ProjectFootprint {
        project_path: r"C:\ws\aatrox".to_string(),
        display_name: "Aatrox (project)".to_string(),
        affected_wads: vec!["DATA/FINAL/Champions/Aatrox.wad.client".to_string()],
    }];
    let incident = record
        .classify(&ClassifyContext {
            mods: &[],
            projects: &projects,
            resolve_hash: &no_path,
            league_path: None,
        })
        .unwrap();
    assert_eq!(names(&incident), ["Aatrox (project)"]);
    assert_eq!(
        incident.suspects[0].project_path.as_deref(),
        Some(r"C:\ws\aatrox")
    );
    assert_eq!(incident.suspects[0].mod_id, None);
    assert_eq!(
        incident.verdict.hints,
        [Hint::RebuildOverlay, Hint::OpenProject]
    );
}

#[test]
fn a_mod_writing_two_redirected_archives_is_listed_once() {
    let mods = [ModFootprint {
        mod_id: "bundle".to_string(),
        display_name: "Bundle".to_string(),
        priority: 0,
        affected_wads: vec![
            "Aatrox.wad.client".to_string(),
            "Map11.wad.client".to_string(),
            "Ahri.wad.client".to_string(),
        ],
    }];
    let mut record = crashed(modded_game());
    record.log = Some(log_with(vec![channel("ALE-18967993", 5.0)]));
    let incident = record
        .classify(&ClassifyContext {
            mods: &mods,
            projects: &[],
            resolve_hash: &no_path,
            league_path: None,
        })
        .unwrap();
    assert_eq!(names(&incident), ["Bundle"]);
    assert_eq!(
        incident.suspects[0].because,
        "writes Aatrox.wad.client and Map11.wad.client, redirected this game"
    );
}

/// The numbers a token carries, pinned one by one. A renumbering that
/// stays consistent with itself passes a round trip, and this is what
/// fails it.
#[test]
fn the_token_numbers_are_pinned() {
    fn pinned<T: Copy + PartialEq + fmt::Debug>(
        table: &[(T, u8)],
        code: fn(T) -> u8,
        from_code: fn(u8) -> Option<T>,
    ) {
        for &(value, number) in table {
            assert_eq!(code(value), number, "{value:?} is number {number}");
            assert_eq!(from_code(number), Some(value), "number {number}");
        }
        let past_the_end = table.iter().map(|(_, n)| *n).max().unwrap_or(0) + 1;
        assert_eq!(from_code(past_the_end), None);
    }

    pinned(
        &[
            (VerdictKind::PatcherDidNotRun, 1),
            (VerdictKind::PatcherOutOfDate, 2),
            (VerdictKind::ArchiveRejected, 3),
            (VerdictKind::OverlayDisabled, 4),
            (VerdictKind::Unmodded, 5),
            (VerdictKind::MissingData, 6),
            (VerdictKind::CorruptArchive, 7),
            (VerdictKind::TextureFailed, 8),
            (VerdictKind::OutOfMemory, 9),
            (VerdictKind::GraphicsFault, 10),
            (VerdictKind::StuckLoading, 11),
            (VerdictKind::ArchiveSkipped, 12),
            (VerdictKind::EndedWithoutReason, 13),
            (VerdictKind::SkinhackDetected, 14),
            (VerdictKind::OverlayBuildFailed, 15),
            (VerdictKind::InjectionHostFailed, 16),
            (VerdictKind::WrongInstall, 17),
            (VerdictKind::ShaderFailed, 18),
        ],
        VerdictKind::code,
        VerdictKind::from_code,
    );
    assert_eq!(VerdictKind::from_code(0), None);
    pinned(
        &[
            (OverlayOutcome::None, 0),
            (OverlayOutcome::Live, 1),
            (OverlayOutcome::TooLate, 2),
            (OverlayOutcome::EndOfLife, 3),
            (OverlayOutcome::Disabled, 4),
            (OverlayOutcome::HookFailed, 5),
        ],
        OverlayOutcome::code,
        OverlayOutcome::from_code,
    );
    pinned(
        &[
            (LaunchKind::Match, 1),
            (LaunchKind::Replay, 2),
            (LaunchKind::Spectator, 3),
            (LaunchKind::Pbe, 4),
        ],
        LaunchKind::code,
        LaunchKind::from_code,
    );
    pinned(
        &[(ScanMode::Eager, 1), (ScanMode::Lazy, 2)],
        ScanMode::code,
        ScanMode::from_code,
    );
    pinned(
        &[
            (Consequence::ArchiveDropped, 1),
            (Consequence::OverlayOff, 2),
            (Consequence::GameHung, 3),
            (Consequence::GameStopped, 4),
        ],
        Consequence::code,
        Consequence::from_code,
    );
    pinned(
        &[
            (GamePhase::Unknown, 0),
            (GamePhase::Loading, 1),
            (GamePhase::InGame, 2),
            (GamePhase::TornDown, 3),
        ],
        GamePhase::code,
        GamePhase::from_code,
    );
    pinned(
        &[(OriginKind::Library, 1), (OriginKind::Workshop, 2)],
        OriginKind::code,
        OriginKind::from_code,
    );
}

/// The evidence table and the seed listing lay their columns out with a width,
/// which a `Display` honours only by going through `Formatter::pad`.
#[test]
fn a_source_and_a_consequence_fill_a_column() {
    assert_eq!(format!("{:<7}", EvidenceSource::Dll), "dll    ");
    assert_eq!(
        format!("{:<19}", Consequence::OverlayOff),
        "no mod ran         "
    );
}

#[test]
fn the_phase_follows_the_log() {
    let mut record = crashed(modded_game());
    assert_eq!(record.phase(), GamePhase::Unknown);
    let mut log = log_with(vec![missing_data_line()]);
    record.log = Some(log.clone());
    assert_eq!(record.phase(), GamePhase::Loading);
    log.loading_ended = true;
    record.log = Some(log.clone());
    assert_eq!(record.phase(), GamePhase::InGame);
    log.torn_down = true;
    record.log = Some(log);
    assert_eq!(record.phase(), GamePhase::TornDown);
}

#[test]
fn the_record_keeps_what_the_token_needs() {
    let mut record = crashed(modded_game());
    record.host_elevated = true;
    record.overlay_detail = Some(OverlayDetail::Hook("hook CreateFileW".to_string()));
    record.patcher = PatcherBinaries {
        dll: Some(crate::diagnostics::binary_id::BinaryId {
            hash: "a150130f1a90dcc2".to_string(),
            built: Some(0x6A83_01AB),
        }),
        host: None,
        matches_bundle: Some(false),
    };
    record.log = Some(log_with(vec![missing_data_line()]));
    let incident = classify(&record, &aatrox_path).unwrap();
    assert!(incident.host_elevated);
    assert_eq!(incident.overlay_detail.as_deref(), Some("hook CreateFileW"));
    assert_eq!(incident.enabled_count, 3);
    assert_eq!(incident.phase, GamePhase::Loading);
    assert_eq!(incident.failure, None);
    assert_eq!(
        incident.patcher.dll.as_ref().map(|id| id.hash.as_str()),
        Some("a150130f1a90dcc2")
    );
    assert_eq!(incident.patcher.matches_bundle, Some(false));
}

/// Every kind that turns the overlay off says so, whatever reached the
/// manager first. The skinhack rejection is the case this exists for: the
/// DLL acted, so the cost is a fact and no reading of a log code enters.
#[test]
fn a_verdict_costs_what_its_kind_costs() {
    use Consequence::*;
    use VerdictKind::*;

    for kind in [
        PatcherDidNotRun,
        PatcherOutOfDate,
        ArchiveRejected,
        OverlayDisabled,
        Unmodded,
    ] {
        assert_eq!(kind.consequence(), OverlayOff, "{kind:?}");
    }
    assert_eq!(ArchiveSkipped.consequence(), ArchiveDropped);
    assert_eq!(StuckLoading.consequence(), GameHung);
    assert_eq!(MissingData.consequence(), GameStopped);
    assert_eq!(ShaderFailed.consequence(), GameStopped);
    assert_eq!(GraphicsFault.consequence(), GameStopped);

    let verdict = Verdict::new(ArchiveRejected, "");
    assert_eq!(verdict.consequence, OverlayOff);
}

/// A message quoted after a full stop opens a sentence, and a writer who
/// spelled one `DLL` did not mean `Dll`.
#[test]
fn a_quoted_message_opens_its_sentence() {
    assert_eq!(
        capitalized_sentence("a layer wrote no files"),
        "A layer wrote no files."
    );
    assert_eq!(
        capitalized_sentence("DLL never attached"),
        "DLL never attached."
    );
    assert_eq!(capitalized_sentence("Already done."), "Already done.");
    assert_eq!(capitalized_sentence(""), "");
}

/// Several `AppError` variants render with no prefix, so a thin inner error
/// leaves the message empty. The kind is what is always there to read.
#[test]
fn a_failure_with_no_message_still_says_what_failed() {
    let mut record = GameRecord::open(at(0), SessionOrigin::Library);
    record.failure = Some(SessionFailure::Build {
        kind: ErrorKind::Preview,
        category: None,
        message: String::new(),
    });
    let incident = classify(&record, &no_path).unwrap();

    assert!(
        incident
            .verdict
            .cause
            .ends_with("PREVIEW, with no message.")
    );
    assert_eq!(incident.evidence[0].line, "overlay build failed, PREVIEW: ");
}

#[test]
fn a_verdict_carries_at_most_two_hints() {
    let verdict = Verdict::new(VerdictKind::Unmodded, "c")
        .with_hint(Hint::StartFirst)
        .with_hint(Hint::CopyReport)
        .with_hint(Hint::SystemChecks);
    assert_eq!(verdict.hints, [Hint::StartFirst, Hint::CopyReport]);
}

/// A hint crosses IPC and the store as its kebab-case name. The number is
/// pinned for a wire that carries one.
#[test]
fn a_hint_has_one_spelling_and_one_number() {
    use strum::IntoEnumIterator;
    let mut numbers = Vec::new();
    for hint in Hint::iter() {
        let wire = serde_json::to_value(hint).unwrap();
        let name = wire.as_str().expect("a string on the wire");
        assert!(
            name.bytes().all(|b| b.is_ascii_lowercase() || b == b'-'),
            "{name}"
        );
        assert_eq!(Hint::parse_stored(wire.clone()), Some(hint));
        assert_eq!(Hint::from_code(hint.code()), Some(hint));
        numbers.push(hint.code());
    }
    numbers.sort_unstable();
    numbers.dedup();
    assert_eq!(numbers.len(), Hint::iter().count());
    assert_eq!(Hint::code(Hint::SystemChecks), 1);
    assert_eq!(Hint::code(Hint::RebuildOverlay), 3);
    assert_eq!(Hint::code(Hint::CheckGamePath), 4);
    assert_eq!(Hint::code(Hint::LargeTextures), 19);
    assert_eq!(Hint::code(Hint::CloseGame), 20);
    assert_eq!(Hint::code(Hint::ShaderDefinition), 21);
    assert_eq!(Hint::from_code(0), None);
    assert_eq!(Hint::from_code(22), None);
}

/// An incident stored by an earlier build holds each hint as a sentence, and
/// one from a later build may hold a code this build does not know. Both read
/// without an error, and only the known codes survive.
#[test]
fn stored_hints_read_as_codes_or_as_nothing() {
    let verdict: Verdict = serde_json::from_value(serde_json::json!({
        "kind": "corrupt-archive",
        "cause": "",
        "subject": null,
        "hints": [
            "Rebuild the overlay.",
            "repair-install",
            "some-hint-from-the-future",
            7,
            "rebuild-overlay",
        ],
    }))
    .expect("the verdict reads");
    assert_eq!(verdict.hints, [Hint::RepairInstall, Hint::RebuildOverlay]);

    let bare: Verdict = serde_json::from_value(serde_json::json!({
        "kind": "corrupt-archive",
        "cause": "",
        "subject": null,
    }))
    .expect("a verdict without hints reads");
    assert!(bare.hints.is_empty());
}

#[test]
fn the_clock_reads_minutes_and_tenths() {
    assert_eq!(clock(0.0), "00:00.0");
    assert_eq!(clock(12.34), "00:12.3");
    assert_eq!(clock(75.0), "01:15.0");
    assert_eq!(clock(600.06), "10:00.1");
}

#[test]
fn a_log_line_drops_its_header_for_the_message() {
    let row = |line: &str| Evidence {
        at: String::new(),
        source: EvidenceSource::Game,
        line: line.to_string(),
        detail: Vec::new(),
        code: None,
    };
    assert_eq!(
        row("000012.344|  ERROR| ALE-9B39AA45 FATAL ERROR. Missing data: 0x1").message(),
        "ALE-9B39AA45 FATAL ERROR. Missing data: 0x1"
    );
    assert_eq!(
        row("000012.301| ALWAYS|  LOAD| SEJ-9F31B5D0").message(),
        "SEJ-9F31B5D0"
    );
    assert_eq!(
        row("000008.543| ALWAYS| r3dRenderLayer::Close() exit").message(),
        "r3dRenderLayer::Close() exit"
    );
    assert_eq!(row("injected, pid 18232").message(), "injected, pid 18232");
    assert!(row("000012.344|  ERROR| >>> boom").is_error_level());
    assert!(!row("000012.344|   WARN| >>> meh").is_error_level());
    assert_eq!(
        row("x Missing data: 0x1a2b3c4d5e6f7081").missing_data_hash(),
        Some(0x1a2b3c4d5e6f7081)
    );
}

#[test]
fn a_path_is_placed_by_its_first_segments() {
    assert_eq!(
        PathHome::of("ASSETS/Characters/Aatrox/Skins/Base/x.dds"),
        PathHome::Champion("aatrox".to_string())
    );
    assert_eq!(
        PathHome::of(r"data\maps\shipping\map11\x.bin"),
        PathHome::Map
    );
    assert_eq!(PathHome::of("assets/shared/x.dds"), PathHome::Unknown);
    assert_eq!(PathHome::of("ux/x.dds"), PathHome::Unknown);
}

#[test]
fn the_dll_detail_renders_to_the_persisted_string() {
    assert_eq!(
        OverlayDetail::Rejected {
            wad: "Aatrox.wad.client".to_string(),
            why: "file would not open".to_string(),
        }
        .to_string(),
        "Aatrox.wad.client: file would not open"
    );
    assert_eq!(
        OverlayDetail::Build("0x68a1b2c3".to_string()).to_string(),
        "0x68a1b2c3"
    );
}

#[test]
fn a_client_reason_reads_its_known_spellings() {
    assert_eq!(ClientReason::parse("Exit"), Some(ClientReason::Exit));
    assert_eq!(
        ClientReason::parse("Interrupt"),
        Some(ClientReason::Interrupt)
    );
    assert_eq!(ClientReason::parse("Bespoke"), None);
    for reason in [
        ClientReason::Exit,
        ClientReason::Interrupt,
        ClientReason::Timeout,
        ClientReason::Unknown,
    ] {
        assert_eq!(ClientReason::from_code(reason.code()), Some(reason));
        assert_eq!(ClientReason::parse(reason.as_str()), Some(reason));
    }
    assert_eq!(ClientReason::from_code(0), None);
    assert_eq!(ClientReason::from_code(5), None);
}

fn outline_mods() -> Vec<ModFootprint> {
    vec![ModFootprint {
        mod_id: "rengar-outline".to_string(),
        display_name: "Rengar Outline".to_string(),
        priority: 0,
        affected_wads: vec!["DATA/FINAL/Champions/Rengar.wad.client".to_string()],
    }]
}

/// A crashed game whose log is `text`, with the Rengar archive redirected.
fn outline_record(text: &str) -> GameRecord {
    let mut record = crashed(modded_game());
    record.redirected = vec!["Rengar.wad.client".to_string()];
    record.log = Some(GameLogFacts::read(std::io::Cursor::new(text)).unwrap());
    record
}

const SHADER_FAILURE: &str = include_str!("../fixtures/shader_failure_r3dlog.txt");

/// A mod that declared the Jade outline shader in a skin bin: the shader had no
/// programs, four variants failed three times over, and the material that used
/// it had no pipeline.
#[test]
fn a_shader_with_no_programs_is_a_shader_failure() {
    let incident = classify_with(&outline_record(SHADER_FAILURE), &outline_mods()).unwrap();
    assert_eq!(incident.verdict.kind, VerdictKind::ShaderFailed);
    assert_eq!(incident.verdict.consequence, Consequence::GameStopped);
    assert_eq!(incident.verdict.cause, "", "the frontend words the cause");
    assert_eq!(
        incident.shader,
        Some(ShaderFailure {
            variants: 4,
            unnamed_programs: true,
            missing_pipeline: Some("822941f5adffbcc".to_string()),
        })
    );
    assert_eq!(
        incident.verdict.subject.as_deref(),
        Some("FEATURE_DISPLACEMENT=1 NUM_BLEND_WEIGHTS=4")
    );
    assert_eq!(
        incident.verdict.hints,
        [Hint::ShaderDefinition, Hint::DisableSuspect]
    );
    assert_eq!(names(&incident), ["Rengar Outline"]);
}

/// Each failed variant shows once, at its last sighting, and the missing
/// pipeline is the newest row.
#[test]
fn a_shader_failure_shows_each_variant_once() {
    let incident = classify_with(&outline_record(SHADER_FAILURE), &outline_mods()).unwrap();
    let messages: Vec<&Evidence> = incident
        .evidence
        .iter()
        .filter(|row| row.source == EvidenceSource::Game && row.code.is_none())
        .collect();
    assert_eq!(messages.len(), 5);
    assert!(
        messages[0]
            .line
            .ends_with("Material Missing Pipeline: 822941f5adffbcc")
    );
    assert!(
        messages[1..]
            .iter()
            .all(|row| row.at == "00:03.9" && row.detail.len() == 4),
        "{messages:#?}"
    );
}

#[test]
fn a_clean_game_with_a_failed_shader_is_no_incident() {
    let mut record = outline_record(SHADER_FAILURE);
    record.ending = clean(modded_game()).ending;
    record.log.as_mut().unwrap().torn_down = true;
    assert_eq!(classify_with(&record, &outline_mods()), None);
}

/// A variant whose programs are named failed for a reason of its own, so the
/// verdict does not point at a shader declared outside the shaders bin.
#[test]
fn a_shader_with_named_programs_gets_no_definition_hint() {
    let log = "000000.000| ALWAYS| Logging started at 2026-09-25T12:46:41.127
               000003.914| ALWAYS| Failed to compile shader.
               Vertex Shader:  ASSETS/Shaders/HLSL/SkinnedMesh/Outline.vs
               Pixel Shader:   ASSETS/Shaders/HLSL/SkinnedMesh/Outline.ps
               Pass Defines:   
               000003.915|  ERROR| SentryHandleException
";
    let mut record = outline_record(log);
    record.origin = SessionOrigin::Workshop {
        projects: vec!["C:/mods/rengar-outline".to_string()],
    };
    let incident = classify_with(&record, &outline_mods()).unwrap();
    assert_eq!(incident.verdict.kind, VerdictKind::ShaderFailed);
    assert_eq!(
        incident.shader,
        Some(ShaderFailure {
            variants: 1,
            unnamed_programs: false,
            missing_pipeline: None,
        })
    );
    assert_eq!(incident.verdict.subject, None);
    assert_eq!(incident.verdict.hints, [Hint::OpenProject]);
}

#[test]
fn pass_defines_are_spaced_at_each_name() {
    assert_eq!(
        classify::spaced_defines("FEATURE_DISPLACEMENT=1GENERATE_SHADOW_MAP=1NUM_BLEND_WEIGHTS=4"),
        "FEATURE_DISPLACEMENT=1 GENERATE_SHADOW_MAP=1 NUM_BLEND_WEIGHTS=4"
    );
    assert_eq!(classify::spaced_defines("TRANSITION=1"), "TRANSITION=1");
    assert_eq!(classify::spaced_defines(""), "");
}
