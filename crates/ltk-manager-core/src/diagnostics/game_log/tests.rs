//! Unit tests for the game log reader.

use std::io::Cursor;

use chrono::TimeZone;

use super::*;

const CLEAN: &str = include_str!("../fixtures/clean_game_r3dlog.txt");
const CRASH_TRUNCATED: &[u8] = include_bytes!("../fixtures/crash_truncated_r3dlog.bin");
const DEVICE_ERROR: &str = include_str!("../fixtures/device_error_r3dlog.txt");
const MISSING_DATA: &str = include_str!("../fixtures/missing_data_r3dlog.txt");
const SHADER_FAILURE: &str = include_str!("../fixtures/shader_failure_r3dlog.txt");
const STUCK_LOADING: &str = include_str!("../fixtures/stuck_loading_r3dlog.txt");
const WAD_MOUNT: &str = include_str!("../fixtures/wad_mount_r3dlog.txt");

fn read(text: &str) -> GameLogFacts {
    GameLogFacts::read(Cursor::new(text)).expect("the fixture reads")
}

fn codes(facts: &GameLogFacts) -> Vec<&str> {
    facts.codes.iter().map(|s| s.code.as_str()).collect()
}

#[test]
fn a_clean_game_reads_its_facts() {
    let facts = read(CLEAN);
    assert_eq!(facts.started_at.as_deref(), Some("2026-08-17T07:26:15.487"));
    assert_eq!(facts.build_version.as_deref(), Some("16.16.804.9184"));
    assert_eq!(
        facts.content_version.as_deref(),
        Some("16.16.8049184+branch.releases-16-16.content.release")
    );
    assert_eq!(
        facts.game_base_dir.as_deref(),
        Some("C:/Riot Games/League of Legends")
    );
    assert_eq!(facts.crash_reporting, Some(false));
    assert!(facts.loading_ended);
    assert!(facts.reached_game_loop);
    assert!(facts.torn_down);
    assert_eq!(facts.error_lines, 1);
    assert_eq!(facts.total_lines, 173);
    assert!((facts.last_time - 8.543).abs() < 1e-9);
}

#[test]
fn a_clean_game_keeps_every_code_in_order() {
    let facts = read(CLEAN);
    let seen = codes(&facts);
    assert_eq!(seen.len(), 20);
    assert_eq!(seen[0], "SEJ-1A4F7C20");
    assert_eq!(seen[12], "SEJ-5F4B27D8");
    assert_eq!(seen[19], "ALE-8SDFH23F");
    assert!(facts.codes.windows(2).all(|pair| pair[0].at <= pair[1].at));

    let step = facts.last_load_step.expect("a last load step");
    assert_eq!(step.code, "SEJ-5F4B27D8");
    assert_eq!(
        log_codes::lookup(&step.code).map(|row| row.kind),
        Some(CodeKind::LoadStep(63))
    );
    assert_eq!(step.line, "000004.111| ALWAYS|  LOAD| SEJ-5F4B27D8");
}

#[test]
fn the_excerpt_is_bounded_and_ends_with_the_last_line() {
    let facts = read(CLEAN);
    let bytes: usize = facts.excerpt.iter().map(String::len).sum();
    assert!(bytes < EXCERPT_BYTES, "{bytes} bytes");
    assert_eq!(
        facts.excerpt.last().map(String::as_str),
        Some("000008.543| ALWAYS| r3dRenderLayer::Close() exit")
    );
    assert!(facts.excerpt.len() >= TAIL_LINES);
    assert!(
        facts
            .excerpt
            .iter()
            .any(|line| line.ends_with("LoadGlobalEffects")),
        "the lines before the first LOAD marker are context"
    );
    assert!(
        facts
            .excerpt
            .iter()
            .any(|line| line.ends_with("Loading Ended")),
        "the lines after the last LOAD marker are context"
    );
    assert!(
        !facts.excerpt.iter().any(|line| line.contains("Init enter")),
        "a line far from any code and outside the tail is not kept"
    );
}

#[test]
fn a_log_a_crash_cut_short_reads_without_panic() {
    let facts = GameLogFacts::read(Cursor::new(CRASH_TRUNCATED)).expect("the fixture reads");
    assert_eq!(facts.started_at.as_deref(), Some("2026-06-23T13:23:08.419"));
    assert_eq!(facts.total_lines, 3);
    assert_eq!(facts.crash_reporting, Some(true));
    assert!(!facts.torn_down);
    assert!(!facts.loading_ended);
    assert!(facts.codes.is_empty());
    assert_eq!(facts.excerpt.len(), 3);
    assert!(
        facts.excerpt.iter().all(|line| !line.contains('\0')),
        "no NUL byte reaches the excerpt"
    );
    assert_eq!(
        facts.excerpt[2],
        r#"000000.148| ALWAYS|   CFG| Command Line: "-GameBaseDir=C:\Riot Games\League of Legends" "-EnableCrashpad=true""#
    );
}

#[test]
fn missing_data_is_sighted_with_the_step_that_ran() {
    let facts = read(MISSING_DATA);
    assert_eq!(codes(&facts).last(), Some(&"ALE-9B39AA45"));
    let step = facts.last_load_step.expect("a last load step");
    assert_eq!(step.code, "SEJ-9F31B5D0");
    assert_eq!(
        log_codes::lookup(&step.code).map(|row| row.kind),
        Some(CodeKind::LoadStep(52))
    );
    assert!(!facts.loading_ended);
    assert!(!facts.reached_game_loop);
    assert!(!facts.torn_down);
    assert_eq!(facts.error_lines, 1);
    assert_eq!(facts.crash_reporting, Some(true));
    let fatal = facts.codes.last().expect("the fatal sighting");
    assert!(fatal.line.ends_with("Missing data: 0x1a2b3c4d5e6f7081"));
    assert!((fatal.at - 12.344).abs() < 1e-9);
}

#[test]
fn stuck_loading_stops_at_the_last_marker() {
    let facts = read(STUCK_LOADING);
    let step = facts.last_load_step.expect("a last load step");
    assert_eq!(step.code, "SEJ-9F31B5D0");
    assert!(!facts.loading_ended);
    assert!(!facts.reached_game_loop);
    assert!(!facts.torn_down);
    assert_eq!(facts.error_lines, 0);
    assert_eq!(facts.crash_reporting, Some(false));
    assert!((facts.last_time - 3.664).abs() < 1e-9);
}

#[test]
fn a_device_error_is_sighted_each_time() {
    let facts = read(DEVICE_ERROR);
    let device: Vec<_> = facts
        .codes
        .iter()
        .filter(|s| s.code == "ALE-D0D00009")
        .collect();
    assert_eq!(device.len(), 4);
    assert_eq!(facts.error_lines, 4);
    assert!(facts.loading_ended);
    assert!(facts.reached_game_loop);
    assert!(!facts.torn_down);
    assert_eq!(facts.crash_reporting, Some(false));
    assert_eq!(
        device[0].line,
        r#"000056.778|  ERROR| Error: "ALE-D0D00009" - Result: DXGI_ERROR_INVALID_CALL."#
    );
}

#[test]
fn the_command_line_keeps_only_the_base_dir_and_crashpad() {
    let line = r#"000000.173| ALWAYS|   CFG| Command Line:  "10.20.30.40 7058 QUJDRA== 12345678" "-Product=LoL" "-PlayerID=12345678" "-GameID=1234567890" "-LNPBlob=QUJD" "-GameBaseDir=C:\Riot Games\League of Legends" "-Region=EUW" "-EnableCrashpad=true" "-DisableCrashUploading" "-RiotClientPort=49925" "-RiotClientAuthToken=abcDEF" "#;
    assert_eq!(
        redact_line(line),
        r#"000000.173| ALWAYS|   CFG| Command Line: "-GameBaseDir=C:\Riot Games\League of Legends" "-EnableCrashpad=true" "-DisableCrashUploading""#
    );

    let bare = "000000.173| ALWAYS|   CFG| Command Line:  \"10.20.30.40 7058 QUJDRA== 12345678\" \"-PlayerID=12345678\"";
    assert_eq!(
        redact_line(bare),
        "000000.173| ALWAYS|   CFG| Command Line:"
    );
}

#[test]
fn private_fields_are_redacted_wherever_they_repeat() {
    let cases = [
        (
            "000001.663| ALWAYS| GameStartData::GameID=1234567890",
            "000001.663| ALWAYS| GameStartData::GameID=<redacted>",
        ),
        (
            "000001.664| ALWAYS|  CONN| Starting Multiplayer Session: PlayerClient GameID(1234567890) ServerAddress(10.20.30.40:7058) SummonerID(12345678)",
            "000001.664| ALWAYS|  CONN| Starting Multiplayer Session: PlayerClient GameID(<redacted>) ServerAddress(<redacted>:7058) SummonerID(<redacted>)",
        ),
        (
            "000001.664| ALWAYS|  CONN| Connecting to address (10.20.30.40) port (7058)",
            "000001.664| ALWAYS|  CONN| Connecting to address (<redacted>) port (7058)",
        ),
        (
            "000000.632| ALWAYS| LCURemotingClient: Initializing on port 49925",
            "000000.632| ALWAYS| LCURemotingClient: Initializing on port <redacted>",
        ),
        (
            r"000000.200| ALWAYS| Replay: C:\Replays\EUW1-7939624995.rofl",
            r"000000.200| ALWAYS| Replay: C:\Replays\EUW1-<redacted>.rofl",
        ),
        (
            "000001.861| ALWAYS|  ROST| CONNECTION READY | TeamOrder 0) 'Someone#EUW' **LOCAL** - Champion(Aatrox) PUUID(b8482d4d-3590-5b21-81fa-4c87306b2a54)",
            "000001.861| ALWAYS|  ROST| CONNECTION READY | TeamOrder 0) '<redacted>' **LOCAL** - Champion(Aatrox) PUUID(<redacted>)",
        ),
        (
            "000000.001| ALWAYS| RiotClientAuthToken=E-tb5OWD6TzjkT7jjQJecg LNPBlob=S6StbDjMbK4= RiotClientPort=49925",
            "000000.001| ALWAYS| RiotClientAuthToken=<redacted> LNPBlob=<redacted> RiotClientPort=<redacted>",
        ),
    ];
    for (line, expected) in cases {
        assert_eq!(redact_line(line), expected);
    }
}

#[test]
fn a_line_with_nothing_private_is_borrowed() {
    let lines = [
        "000000.558| ALWAYS|   CFG| Build Version: Version 16.16.804.9184 (Aug 10 2026/16:10:32) [PUBLIC] <Releases/16.16> ChangeList: 8049184",
        "000000.568| ALWAYS|   CFG| Content Version: 16.16.8049184+branch.releases-16-16.content.release",
        "000003.691| ALWAYS|  LOAD| SEJ-1A4F7C20",
        "000000.659| ALWAYS| Detected Adapter 'NVIDIA GeForce RTX 4070 SUPER'",
    ];
    for line in lines {
        assert!(
            matches!(redact_line(line), Cow::Borrowed(same) if same == line),
            "{line}"
        );
    }
}

#[test]
fn nothing_private_survives_into_the_record() {
    // Short enough that the whole file is the tail, so every private line
    // of the header reaches the excerpt.
    let facts = read(MISSING_DATA);
    assert_eq!(facts.excerpt.len(), 27);
    let kept: Vec<&str> = facts
        .excerpt
        .iter()
        .map(String::as_str)
        .chain(facts.codes.iter().map(|s| s.line.as_str()))
        .chain(facts.last_load_step.iter().map(|s| s.line.as_str()))
        .collect();
    for line in &kept {
        assert!(!line.contains("0.0.0.0"), "{line}");
        assert!(!line.contains("AAAA"), "{line}");
        assert!(!line.contains("PlayerID=0"), "{line}");
        assert!(!line.contains("GameID=0"), "{line}");
        assert!(!line.contains("GameID(0)"), "{line}");
        assert!(!line.contains("SummonerID(0)"), "{line}");
        assert!(!line.contains("port 0"), "{line}");
    }
    assert!(kept.iter().any(|line| {
        line.ends_with(
            r#"Command Line: "-GameBaseDir=C:\Riot Games\League of Legends" "-EnableCrashpad=true""#,
        )
    }));
    assert!(
        kept.iter()
            .any(|line| line.ends_with("GameStartData::GameID=<redacted>"))
    );
    assert!(
        kept.iter()
            .any(|line| line.ends_with("Connecting to address (<redacted>) port (0)"))
    );

    let clean = read(CLEAN);
    let roster = clean
        .excerpt
        .iter()
        .chain(clean.codes.iter().map(|s| &s.line))
        .find(|line| line.contains("ROST"));
    assert_eq!(
        roster, None,
        "the roster line is far from any code and the tail"
    );
}

#[test]
fn crash_reporting_follows_the_switches() {
    let read_switches = |switches: &str| {
        let log = format!(
            "000000.000| ALWAYS| Logging started at 2026-08-17T07:26:15.487\n000000.173| ALWAYS|   CFG| Command Line:  {switches}\n"
        );
        read(&log).crash_reporting
    };
    assert_eq!(read_switches(r#""-EnableCrashpad=true""#), Some(true));
    assert_eq!(read_switches(r#""-EnableCrashpad""#), Some(true));
    assert_eq!(
        read_switches(r#""-EnableCrashpad=true" "-DisableCrashUploading""#),
        Some(false)
    );
    assert_eq!(read_switches(r#""-EnableCrashpad=false""#), Some(false));
    assert_eq!(read_switches(r#""-Product=LoL""#), Some(false));
    assert_eq!(
        read_switches("-EnableCrashpad=true -Product=LoL"),
        Some(true)
    );
    assert_eq!(
        read("000000.000| ALWAYS| Logging started at 2026-08-17T07:26:15.487\n").crash_reporting,
        None
    );
}

#[test]
fn garbage_reads_as_an_empty_record() {
    for garbage in ["", "\0\0\0\0", "not a log\nat all\n", "|||\n1e5| X| y\n"] {
        let facts = read(garbage);
        assert_eq!(facts, GameLogFacts::default(), "{garbage:?}");
    }
    let torn = "000000.000| ALWAYS| Logging started at 2026-08-17T07:26:15.487\r\n000012.3";
    let facts = read(torn);
    assert_eq!(facts.total_lines, 1);
    assert_eq!(facts.excerpt.len(), 1, "a torn line is not a detail line");
}

#[test]
fn continuation_lines_join_the_sighting_of_their_record() {
    let facts = read(WAD_MOUNT);
    assert_eq!(facts.total_lines, 18);
    assert_eq!(facts.error_lines, 1);
    assert_eq!(
        facts.game_base_dir.as_deref(),
        Some("C:/Riot Games/League of Legends")
    );
    assert_eq!(facts.build_version.as_deref(), Some("16.17.812.1337"));

    let fatal = facts.codes.last().expect("the wad mount sighting");
    assert_eq!(fatal.code, "ALE-18967994");
    assert!(fatal.line.ends_with("WadFile mount failed"));
    assert_eq!(
        fatal.detail,
        [
            "- WadFile: DATA/FINAL/Shaders/Shaders.wad.client",
            "- Problem: Inconsistent"
        ]
    );
    assert_eq!(
        fatal.detail_value("WadFile"),
        Some("DATA/FINAL/Shaders/Shaders.wad.client")
    );
    assert_eq!(fatal.detail_value("problem"), Some("Inconsistent"));
    assert_eq!(fatal.detail_value("Reason"), None);

    let tail: Vec<&str> = facts
        .excerpt
        .iter()
        .rev()
        .take(3)
        .map(String::as_str)
        .collect();
    assert_eq!(
        tail,
        [
            "- Problem: Inconsistent",
            "- WadFile: DATA/FINAL/Shaders/Shaders.wad.client",
            "000001.912|  ERROR| ALE-18967994 FATAL ERROR. WadFile mount failed",
        ],
        "the excerpt keeps the detail lines under their record"
    );
}

#[test]
fn a_failed_shader_compile_is_sighted_with_its_programs_and_defines() {
    let facts = read(SHADER_FAILURE);
    let compiles: Vec<&MessageSighting> = facts
        .messages
        .iter()
        .filter(|sighting| sighting.message == LogMessage::ShaderCompileFailed)
        .collect();
    assert_eq!(compiles.len(), 12);

    let first = compiles[0];
    assert!((first.at - 1.973).abs() < 1e-9);
    assert!(first.line.ends_with("Failed to compile shader."));
    assert_eq!(first.detail.len(), 4);
    assert_eq!(first.detail_value("Vertex Shader"), Some(""));
    assert_eq!(first.detail_value("Pixel Shader"), Some(""));
    assert_eq!(
        first.detail_value("Pass Defines"),
        Some("FEATURE_DISPLACEMENT=1NUM_BLEND_WEIGHTS=4")
    );
    assert_eq!(first.detail_value("Global Defines"), Some(""));
    assert_eq!(
        compiles[2].detail_value("Pixel Shader"),
        Some("ASSETS/Shaders/HLSL/SkinnedMesh/SOLID_COLOR_PS.ps")
    );
    assert!(
        facts
            .codes
            .iter()
            .all(|sighting| sighting.detail.is_empty())
    );
}

#[test]
fn a_missing_pipeline_is_sighted_with_its_hash() {
    let facts = read(SHADER_FAILURE);
    let missing = facts.messages.last().expect("the missing pipeline");
    assert_eq!(missing.message, LogMessage::MissingPipeline);
    assert_eq!(missing.missing_pipeline(), Some("822941f5adffbcc"));
    assert!(missing.detail.is_empty());
    assert_eq!(facts.messages[0].missing_pipeline(), None);

    let tail = facts.excerpt.last().expect("an excerpt");
    assert!(tail.ends_with("SentryHandleException"), "{tail}");
    assert!(
        facts.excerpt.iter().any(|line| line
            == "Pass Defines:   FEATURE_DISPLACEMENT=1GENERATE_SHADOW_MAP=1NUM_BLEND_WEIGHTS=4"),
        "the excerpt keeps the detail lines under their record"
    );
}

#[test]
fn a_record_the_reader_does_not_know_is_no_message() {
    let facts = read(CLEAN);
    assert!(facts.messages.is_empty());
}

#[test]
fn message_sightings_are_bounded() {
    let mut log = String::from("000000.000| ALWAYS| Logging started at 2026-08-17T07:26:15.487\n");
    for n in 0..200 {
        log.push_str(&format!(
            "{:010.3}| ALWAYS| Failed to compile shader.\nPass Defines:   N={n}\n",
            f64::from(n)
        ));
    }
    let facts = read(&log);
    assert_eq!(facts.messages.len(), MAX_MESSAGES);
    assert_eq!(
        facts
            .messages
            .last()
            .and_then(|m| m.detail_value("Pass Defines")),
        Some("N=199")
    );
}

#[test]
fn a_continuation_line_never_starts_a_record() {
    let log = "- Problem: Inconsistent\n000000.000| ALWAYS| Logging started at 2026-08-17T07:26:15.487\n\0\0\0\n";
    let facts = read(log);
    assert_eq!(facts.total_lines, 1);
    assert_eq!(facts.excerpt.len(), 1);
    assert!(facts.codes.is_empty());
}

#[test]
fn a_detail_line_is_redacted_like_its_record() {
    let log = "000000.000| ALWAYS| Logging started at 2026-08-17T07:26:15.487\n000001.912|  ERROR| ALE-18967994 FATAL ERROR. WadFile mount failed\n- Player: 'Someone#EUW' at 10.20.30.40\n000002.000| ALWAYS| Destroying the renderer\n";
    let facts = read(log);
    let fatal = facts.codes.last().expect("the sighting");
    assert_eq!(fatal.detail, ["- Player: '<redacted>' at <redacted>"]);
    assert!(
        facts
            .excerpt
            .contains(&"- Player: '<redacted>' at <redacted>".to_string()),
        "{:?}",
        facts.excerpt
    );
    assert_eq!(facts.total_lines, 3);
}

#[test]
fn a_record_without_a_code_keeps_its_detail_in_the_excerpt_alone() {
    let log = "000000.000| ALWAYS| Logging started at 2026-08-17T07:26:15.487\n000001.000| ALWAYS| Detected Adapter\n- Vendor: NVIDIA\n000001.912|  ERROR| ALE-18967994 FATAL ERROR. WadFile mount failed\n";
    let facts = read(log);
    let fatal = facts.codes.last().expect("the sighting");
    assert!(fatal.detail.is_empty());
    assert_eq!(facts.excerpt[2], "- Vendor: NVIDIA");
}

#[test]
fn detail_lines_are_bounded_on_the_sighting_and_in_the_excerpt() {
    let mut log = String::from(
        "000000.000| ALWAYS| Logging started at 2026-08-17T07:26:15.487\n000001.912|  ERROR| ALE-18967994 FATAL ERROR. WadFile mount failed\n",
    );
    for n in 0..400 {
        log.push_str(&format!("- Line {n}: {}\n", "x".repeat(100)));
    }
    let facts = read(&log);
    let fatal = facts.codes.last().expect("the sighting");
    assert_eq!(fatal.detail.len(), DETAIL_LINES);
    assert!(fatal.detail[0].starts_with("- Line 0:"));
    let bytes: usize = facts.excerpt.iter().map(String::len).sum();
    assert!(bytes <= EXCERPT_BYTES, "{bytes} bytes");
}

fn at(h: u32, m: u32, s: u32) -> DateTime<Local> {
    Local
        .with_ymd_and_hms(2026, 8, 17, h, m, s)
        .single()
        .expect("an unambiguous local time")
}

fn stamp_dir(root: &Path, stamp: DateTime<Local>, header_at: DateTime<Local>) -> PathBuf {
    let name = stamp.format("%Y-%m-%dT%H-%M-%S").to_string();
    let dir = root.join("Logs").join("GameLogs").join(&name);
    fs::create_dir_all(&dir).expect("the fixture directory");
    let path = dir.join(format!("{name}_r3dlog.txt"));
    fs::write(
        &path,
        format!(
            "000000.000| ALWAYS| Logging started at {}\r\n000000.001| ALWAYS|   CFG| CrashHandler(Sentry)\r\n",
            header_at.format("%Y-%m-%dT%H:%M:%S%.3f")
        ),
    )
    .expect("the fixture log");
    path
}

#[test]
fn the_newest_directory_in_the_window_is_picked() {
    let tmp = tempfile::tempdir().expect("a temp dir");
    let window = GameWindow {
        first_sign: at(7, 26, 30),
        last_sign: at(7, 35, 0),
    };
    stamp_dir(tmp.path(), at(7, 20, 0), at(7, 20, 0));
    let older = stamp_dir(tmp.path(), at(7, 25, 40), at(7, 25, 40));
    let expected = stamp_dir(tmp.path(), at(7, 26, 15), at(7, 26, 15));
    stamp_dir(tmp.path(), at(7, 45, 0), at(7, 45, 0));
    fs::create_dir_all(tmp.path().join("Logs/GameLogs/not-a-stamp")).expect("a stray dir");

    let logs = LeagueLogs::new(tmp.path());
    let found = logs.find_game_log(&window);
    assert_eq!(found.as_deref(), Some(expected.as_path()));
    assert_ne!(found.as_deref(), Some(older.as_path()));
}

#[test]
fn a_stamp_whose_header_disagrees_is_refused() {
    let tmp = tempfile::tempdir().expect("a temp dir");
    let window = GameWindow {
        first_sign: at(7, 26, 30),
        last_sign: at(7, 35, 0),
    };
    stamp_dir(tmp.path(), at(7, 26, 15), at(9, 0, 0));
    let logs = LeagueLogs::new(tmp.path());
    assert_eq!(logs.find_game_log(&window), None);
}

#[test]
fn a_stamp_with_no_log_inside_is_refused() {
    let tmp = tempfile::tempdir().expect("a temp dir");
    let window = GameWindow {
        first_sign: at(7, 26, 30),
        last_sign: at(7, 35, 0),
    };
    fs::create_dir_all(tmp.path().join("Logs/GameLogs/2026-08-17T07-26-15"))
        .expect("an empty stamp dir");
    let logs = LeagueLogs::new(tmp.path());
    assert_eq!(logs.find_game_log(&window), None);
}

#[test]
fn no_game_logs_directory_is_no_log() {
    let tmp = tempfile::tempdir().expect("a temp dir");
    let window = GameWindow {
        first_sign: at(7, 26, 30),
        last_sign: at(7, 35, 0),
    };
    let logs = LeagueLogs::new(tmp.path());
    assert_eq!(logs.find_game_log(&window), None);
    assert_eq!(logs.last_crash(), None);
}

#[test]
fn last_crash_reads_the_marker_and_nothing_else() {
    let tmp = tempfile::tempdir().expect("a temp dir");
    let crashes = tmp.path().join("Logs/GameCrashes");
    fs::create_dir_all(&crashes).expect("the crash dir");
    let logs = LeagueLogs::new(tmp.path());

    fs::write(crashes.join("last_crash"), "2026-03-13T15:20:23.400Z\n").expect("the marker");
    let expected = Utc
        .with_ymd_and_hms(2026, 3, 13, 15, 20, 23)
        .single()
        .expect("a UTC time")
        + TimeDelta::milliseconds(400);
    assert_eq!(logs.last_crash(), Some(expected));

    fs::write(crashes.join("last_crash"), "yesterday, probably").expect("the marker");
    assert_eq!(logs.last_crash(), None);

    fs::write(crashes.join("last_crash"), "").expect("the marker");
    assert_eq!(logs.last_crash(), None);
}

#[test]
fn reading_a_file_on_disk_gives_the_same_facts() {
    let tmp = tempfile::tempdir().expect("a temp dir");
    let path = tmp.path().join("clean_r3dlog.txt");
    fs::write(&path, CLEAN).expect("the log");
    let logs = LeagueLogs::new(tmp.path());
    assert_eq!(logs.read_game_log(&path).expect("reads"), read(CLEAN));
}

#[test]
fn a_missing_file_is_an_error_after_the_retries() {
    let tmp = tempfile::tempdir().expect("a temp dir");
    let path = tmp.path().join("gone_r3dlog.txt");
    let err = LeagueLogs::read_game_log_within(&path, Duration::from_millis(20))
        .expect_err("a missing file");
    assert_eq!(err.kind(), io::ErrorKind::NotFound);
}

#[test]
fn reading_a_short_game_is_cheap() {
    let started = Instant::now();
    for _ in 0..100 {
        let facts = read(CLEAN);
        assert_eq!(facts.total_lines, 173);
    }
    let elapsed = started.elapsed();
    assert!(
        elapsed < Duration::from_secs(1),
        "{elapsed:?} for 100 reads"
    );
}
