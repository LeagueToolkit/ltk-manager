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

#[test]
fn a_host_failure_points_at_the_system_checks() {
    let mut record = GameRecord::open(at(0), SessionOrigin::Library);
    record.failure = Some(SessionFailure::Injection {
        stage: InjectionStage::Host,
        message: "host stdout closed".to_string(),
    });
    let incident = classify(&record, &no_path).unwrap();
    assert_eq!(incident.verdict.kind, VerdictKind::InjectionHostFailed);
    assert_eq!(incident.verdict.hints, [hint::SYSTEM_CHECKS]);
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
    assert_eq!(incident.verdict.hints, [hint::ELEVATE, hint::SYSTEM_CHECKS]);

    record.host_elevated = true;
    let incident = classify(&record, &no_path).unwrap();
    assert_eq!(
        incident.verdict.hints,
        [hint::SIGNATURE, hint::SYSTEM_CHECKS]
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
    assert_eq!(incident.verdict.hints, [hint::UPDATE_MANAGER]);
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
    assert!(incident.verdict.cause.contains("skinhack"));
    assert_eq!(incident.scan_status, Some(ScanStatus::Skinhack));
    // The finding a player recognises, not the machinery that caught it.
    assert_eq!(incident.verdict.title, "Skinhack Detection");
    assert_eq!(incident.verdict.title_override, None);
    assert_eq!(names(&incident), ["Aatrox Justicar"]);
    assert_eq!(
        incident.suspects[0].because,
        "writes Aatrox.wad.client, which the scan rejected"
    );

    record.scan_failures[0].status = "base_skin".to_string();
    let incident = classify(&record, &no_path).unwrap();
    assert!(incident.verdict.cause.contains("incomplete mod"));
    assert!(!incident.verdict.cause.contains("skinhack"));
    assert_eq!(incident.scan_status, Some(ScanStatus::BaseSkin));
    // Only a skinhack reaches its own kind.
    assert_eq!(incident.verdict.kind, VerdictKind::ArchiveRejected);
    assert_eq!(incident.verdict.title, "Archive Scan Rejection");
}

/// The two halves of the evidence phrase live in different modules, so only
/// a round trip catches one of them being reworded on its own.
#[test]
fn a_rejection_reads_back_the_status_it_wrote() {
    for wad in [Some("Aatrox.wad.client".to_string()), None] {
        for status in ["c0000229", "base_skin", "c000003e", "deadbeef"] {
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
    assert_eq!(incident.verdict.hints, [hint::REBUILD_OVERLAY]);
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
    assert_eq!(incident.verdict.hints, [hint::START_FIRST]);

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
    assert_eq!(incident.verdict.hints, [hint::DISABLE_SUSPECT]);
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
            .contains("Probably an archive could not be mounted, because it is corrupt.")
    );
    assert_eq!(names(&incident), ["Classic Rift", "Aatrox Justicar"]);
    assert_eq!(
        incident.verdict.hints,
        [hint::REBUILD_OVERLAY, hint::REPAIR_INSTALL]
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
        assert!(
            incident.verdict.hints[0].contains("multiple of 4"),
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
    assert!(incident.verdict.hints[0].contains("Close what else is running"));
    assert!(incident.verdict.hints[1].contains("4 modded archives were in this game"));
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
    assert_eq!(incident.verdict.hints, [hint::UPDATE_DRIVER]);
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
fn a_loading_screen_the_player_left_is_not_stuck() {
    let record = clean(stuck_at("SEJ-9F31B5D0"));
    assert_eq!(classify(&record, &no_path), None);
}

#[test]
fn an_early_crash_under_the_lazy_scan_earns_the_up_front_hint() {
    let mut record = stuck_at("SEJ-9F31B5D0");
    record.scan = Some(ScanMode::Lazy);
    let incident = classify(&record, &no_path).unwrap();
    assert_eq!(incident.verdict.hints, [hint::SCAN_UP_FRONT]);
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
    assert_eq!(incident.verdict.hints, [hint::COPY_REPORT]);
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
    record.log_path = Some(PathBuf::from(
        r"C:\Riot Games\League of Legends\Logs\GameLogs\2026-08-21T21-14-02\2026-08-21T21-14-02_r3dlog.txt",
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
        [hint::REBUILD_OVERLAY, hint::OPEN_PROJECT]
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
        .with_hint("one")
        .with_hint("two")
        .with_hint("three");
    assert_eq!(verdict.hints, ["one", "two"]);
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
