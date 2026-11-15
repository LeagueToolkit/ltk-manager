use std::{
    io::{Cursor, Read},
    path::{Path, PathBuf},
    sync::Arc,
};

use chrono::TimeZone;
use fs_err as fs;
use ltk_manager_assets::{hashtables::WadPathResolverState, test_util::make_named_fantome_zip};
use ltk_manager_base::{config::Config, events::NullEventSink};
use ltk_manager_library::mods::{ChecksumMismatchState, ModLibrary, WadReportState};
use ltk_manager_runtime::{
    diagnostics::{
        CheckCtx,
        incident::{ClassifyContext, Ending, GameInfo, GameRecord, Incident, OverlayOutcome},
        store::IncidentStore,
    },
    patcher::{
        SessionOrigin,
        delivery::{Channel, StagedPatcher},
    },
};
use serde_json::json;

use super::{files::path_facts, *};
use crate::log_dir::RUN_START;

fn app() -> AppIdentity {
    AppIdentity {
        identifier: "dev.leaguetoolkit.manager".to_owned(),
        version: "1.34.0".to_owned(),
        release_build: true,
    }
}

fn created_at() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 15, 14, 2, 0)
        .single()
        .expect("2026-11-15 is a real date")
}

fn report(description: ReportDescription) -> SupportReport {
    SupportReport::new(app(), description, created_at())
}

fn file<'a>(report: &'a BuiltReport, path: &str) -> &'a str {
    &report
        .files()
        .iter()
        .find(|file| file.path == path)
        .unwrap_or_else(|| panic!("the report holds no {path}"))
        .contents
}

/// A log directory that holds one file with `contents`.
fn log_dir(contents: &str) -> (tempfile::TempDir, LogDir) {
    let dir = tempfile::tempdir().expect("a temporary directory");
    fs::write(dir.path().join("ltk-manager.2026-11-15.log"), contents).unwrap();
    let logs = LogDir::new(dir.path());
    (dir, logs)
}

fn run(name: &str) -> String {
    format!("INFO {RUN_START}1.34.0\nINFO {name} line\n")
}

#[test]
fn add_settings_keeps_the_allowlisted_fields_only() {
    let mut report = report(ReportDescription::default());
    report.add_settings(&json!({
        "readGameLog": true,
        "patchTft": false,
        "telemetrySecret": "a-secret-value",
        "runeforge": { "username": "someone" },
        "trustedDomains": ["example.com"],
        "aFieldAddedLater": 1,
    }));

    let report = report.finish();
    let settings: serde_json::Value = serde_json::from_str(file(&report, SETTINGS_JSON)).unwrap();

    assert_eq!(settings, json!({ "readGameLog": true, "patchTft": false }));
}

#[test]
fn report_md_states_the_build_first_and_redacts_the_description() {
    let report = report(ReportDescription {
        problem: Some(ReportProblem::ModNotShown),
        mod_name: Some("Aatrox Justicar".to_owned()),
        text: "it broke, mail me at someone@example.com".to_owned(),
    })
    .finish();

    let summary = file(&report, REPORT_MD);
    let first_line = summary.lines().next().unwrap();

    assert!(
        first_line.starts_with("dev.leaguetoolkit.manager 1.34.0, release build, "),
        "{first_line}"
    );
    assert!(summary.contains("A mod does not show: Aatrox Justicar\n"));
    assert!(summary.contains("it broke, mail me at <redacted>\n"));
    assert_eq!(report.manifest().replacements.get("email"), Some(&1));
}

#[test]
fn finish_lists_every_other_file_in_the_manifest() {
    let (_dir, logs) = log_dir(&run("only"));
    let mut report = report(ReportDescription::default());
    report.add_log(&logs);
    report.add_settings(&json!({ "readGameLog": true }));

    let report = report.finish();

    let paths: Vec<&str> = report
        .files()
        .iter()
        .map(|file| file.path.as_str())
        .collect();
    assert_eq!(paths, [REPORT_MD, MANIFEST_JSON, LOG_FILE, SETTINGS_JSON]);
    let manifest = report.manifest();
    assert_eq!(manifest.schema, SCHEMA_VERSION);
    assert_eq!(manifest.ruleset, ltk_redact::RULESET_VERSION);
    let listed: Vec<(&str, usize)> = manifest
        .files
        .iter()
        .map(|entry| (entry.path.as_str(), entry.bytes))
        .collect();
    assert_eq!(
        listed,
        [
            (REPORT_MD, file(&report, REPORT_MD).len()),
            (LOG_FILE, run("only").len()),
            (SETTINGS_JSON, file(&report, SETTINGS_JSON).len()),
        ]
    );
    assert_eq!(
        report.file_name(),
        format!("ltk-report-2026-11-15-{}.zip", manifest.id)
    );
}

#[test]
fn finish_cuts_the_log_first_if_the_files_exceed_the_limit() {
    let line = "INFO a log line of some length that repeats\n";
    let lines = MAX_REPORT_BYTES / line.len() + 100;
    let (_dir, logs) = log_dir(&line.repeat(lines));
    let mut report = report(ReportDescription::default());
    report.add_log(&logs);
    report.add_settings(&json!({ "readGameLog": true }));

    let report = report.finish();

    let total: usize = report
        .manifest()
        .files
        .iter()
        .map(|entry| entry.bytes)
        .sum();
    assert!(total <= MAX_REPORT_BYTES, "{total}");
    assert!(file(&report, LOG_FILE).starts_with(line));
    assert!(file(&report, SETTINGS_JSON).contains("readGameLog"));
}

#[test]
fn write_zip_holds_each_file_with_its_contents() {
    let (_dir, logs) = log_dir(&run("only"));
    let mut report = report(ReportDescription::default());
    report.add_log(&logs);
    let report = report.finish();

    let mut bytes = Cursor::new(Vec::new());
    report.write_zip(&mut bytes).unwrap();

    let mut zip = zip::ZipArchive::new(bytes).unwrap();
    assert_eq!(zip.len(), report.files().len());
    for expected in report.files() {
        let mut contents = String::new();
        zip.by_name(&expected.path)
            .unwrap()
            .read_to_string(&mut contents)
            .unwrap();
        assert_eq!(contents, expected.contents, "{}", expected.path);
    }
}

/// A library in `storage` that holds one installed mod named `Test Mod`.
fn library(storage: &Path) -> (ModLibrary, Config) {
    let config = Config {
        mod_storage_path: Some(storage.to_path_buf()),
        ..Config::default()
    };
    let library = ModLibrary::new(
        Arc::new(NullEventSink),
        Some(storage.to_path_buf()),
        "1.34.0",
        Arc::new(ChecksumMismatchState::default()),
        Arc::new(WadReportState::new(Some(storage))),
        Arc::new(WadPathResolverState::default()),
    );
    let archive = storage.join("test mod.fantome");
    make_named_fantome_zip(&archive, "Test Mod");
    library
        .install_mod_from_package(&config, &archive.to_string_lossy())
        .expect("the mod installs");
    (library, config)
}

/// An incident of a game that crashed with no reason, which is a verdict.
fn incident() -> Incident {
    let mut record = GameRecord::open(created_at(), SessionOrigin::Library);
    record.ended_at = created_at() + chrono::Duration::minutes(20);
    record.injected = true;
    record.overlay = OverlayOutcome::Live;
    record.ending = Ending {
        exit_reason: Some("Unknown".to_owned()),
        exit_code: Some(-1_073_741_819),
        crashed: Some(true),
    };
    record
        .classify(&ClassifyContext {
            mods: &[],
            projects: &[],
            resolve_hash: &|_| None,
            league_path: None,
        })
        .expect("a crash with no reason is a verdict")
}

fn json_file(report: &BuiltReport, path: &str) -> serde_json::Value {
    serde_json::from_str(file(report, path)).unwrap_or_else(|e| panic!("{path}: {e}"))
}

#[test]
fn add_system_checks_holds_the_checks_and_the_path_facts() {
    let mut report = report(ReportDescription::default());
    report.add_system_checks(&CheckCtx {
        league_path: Some(PathBuf::from("/games/Ligue des légendes")),
        mod_storage_path: None,
        mod_storage_is_default: true,
        patcher_dll_path: None,
        manager_exe: None,
    });

    let system = json_file(&report.finish(), "system.json");

    assert!(!system["checks"].as_array().unwrap().is_empty());
    assert_eq!(
        system["paths"]["league"],
        json!({ "characters": 25, "drive": null, "nonAscii": true })
    );
    assert_eq!(system["paths"]["storage"], json!(null));
}

#[test]
fn path_facts_states_the_drive_of_a_windows_path() {
    assert_eq!(
        path_facts(Some(Path::new(r"d:\Riot Games\League of Legends"))),
        json!({ "characters": 31, "drive": "D:", "nonAscii": false })
    );
}

#[test]
fn add_library_lists_the_mods_of_the_active_profile() {
    let storage = tempfile::tempdir().unwrap();
    let (library, config) = library(storage.path());
    let mut report = report(ReportDescription::default());
    report.add_library(&library, &config);

    let library = json_file(&report.finish(), "library.json");

    assert!(library["profile"].is_string());
    assert_eq!(library["otherProfiles"], json!(0));
    let mods = library["mods"].as_array().unwrap();
    assert_eq!(mods.len(), 1);
    assert_eq!(mods[0]["name"], json!("Test Mod"));
    assert_eq!(mods[0]["enabled"], json!(true));
    assert_eq!(mods[0]["priority"], json!(0));
}

#[test]
fn add_incidents_writes_each_incident_and_states_the_newest_in_report_md() {
    let dir = tempfile::tempdir().unwrap();
    let store = IncidentStore::new(dir.path().to_path_buf());
    let incident = incident();
    store.record(&incident).unwrap();
    let mut report = report(ReportDescription::default());
    report.add_incidents(&store);

    let report = report.finish();

    let stored = json_file(&report, &format!("incidents/{}.json", incident.id));
    assert_eq!(stored["id"], json!(incident.id));
    let text = file(&report, &format!("incidents/{}.md", incident.id));
    assert!(text.contains(&incident.verdict.title), "{text}");
    let summary = file(&report, REPORT_MD);
    assert!(summary.contains("## The manager found"), "{summary}");
    assert!(summary.contains(&incident.verdict.title), "{summary}");
    assert!(summary.contains("Token: DIAG1-"), "{summary}");
}

#[test]
fn add_game_log_removes_the_private_fields_of_each_line() {
    let dir = tempfile::tempdir().unwrap();
    let log = dir.path().join("2026-11-15T14-02-00_r3dlog.txt");
    fs::write(&log, "000001.000| ALWAYS| connecting to 203.0.113.7\n").unwrap();
    let mut incident = incident();
    incident.game = Some(GameInfo {
        version: "16.22".to_owned(),
        content_version: "16.22.1".to_owned(),
        log_path: log.to_string_lossy().into_owned(),
        game_base_dir: None,
    });

    let mut with_log = report(ReportDescription::default());
    with_log.add_game_log(&incident, &Config::default());
    assert_eq!(
        file(&with_log.finish(), "game-log/r3dlog.txt"),
        "000001.000| ALWAYS| connecting to <redacted>\n"
    );

    let mut reader_off = report(ReportDescription::default());
    let config = Config {
        read_game_log: false,
        ..Config::default()
    };
    reader_off.add_game_log(&incident, &config);
    let reader_off = reader_off.finish();
    assert!(
        reader_off
            .files()
            .iter()
            .all(|file| file.path != "game-log/r3dlog.txt")
    );
}

#[test]
fn add_patcher_states_the_channel_and_the_staged_build() {
    let dir = tempfile::tempdir().unwrap();
    let staged = StagedPatcher {
        dir: dir.path().to_path_buf(),
        version: "1.4.0".to_owned(),
        digest: "ab".repeat(32),
        eol: 1_800_000_000,
    };
    let mut report = report(ReportDescription::default());
    report.add_patcher(Channel::Beta, Some(&staged));

    assert_eq!(
        json_file(&report.finish(), "patcher.json"),
        json!({
            "channel": "beta",
            "staged": {
                "version": "1.4.0",
                "digest": "ab".repeat(32),
                "endOfLife": 1_800_000_000,
                "built": null,
            },
        })
    );
}

#[test]
fn summary_stays_under_the_limit_for_the_longest_inputs() {
    let dir = tempfile::tempdir().unwrap();
    let store = IncidentStore::new(dir.path().to_path_buf());
    let mut incident = incident();
    incident.verdict.cause = "The cause runs on. ".repeat(400);
    store.record(&incident).unwrap();
    let mut report = report(ReportDescription {
        problem: Some(ReportProblem::ModNotShown),
        mod_name: Some("A mod name of some length ".repeat(40)),
        text: "It broke in a way that takes many words to tell.\n".repeat(200),
    });
    report.add_incidents(&store);

    let report = report.finish();
    let summary = report.summary();

    assert!(summary.chars().count() <= MAX_SUMMARY_CHARS, "{summary}");
    assert!(summary.contains("**Token:** `DIAG1-"), "{summary}");
    assert!(
        summary.ends_with(&format!("**Report:** `{}`, attached", report.file_name())),
        "{summary}"
    );
}

#[test]
fn summary_states_that_no_incident_is_on_record() {
    let report = report(ReportDescription {
        problem: Some(ReportProblem::Manager),
        mod_name: None,
        text: "reach me at someone@example.com".to_owned(),
    })
    .finish();

    let summary = report.summary();

    assert!(
        summary.contains("**Problem:** The manager has a problem\n"),
        "{summary}"
    );
    assert!(summary.contains("> reach me at <redacted>\n"), "{summary}");
    assert!(
        summary.contains("**Found:** no incident on record\n"),
        "{summary}"
    );
}

#[test]
fn preview_groups_the_replacements_by_kind() {
    let report = report(ReportDescription {
        problem: None,
        mod_name: None,
        text: r"from https://a.example/b?c=d by a@example.com at C:\Users\Other Person\Desktop"
            .to_owned(),
    })
    .finish();

    let preview = report.preview();

    assert_eq!(
        preview.replaced,
        ReportReplacements {
            paths: 1,
            links: 1,
            addresses: 1,
            other: 0,
        }
    );
    assert_eq!(preview.file_name, report.file_name());
    let paths: Vec<&str> = preview
        .files
        .iter()
        .map(|file| file.path.as_str())
        .collect();
    assert_eq!(paths, [REPORT_MD, MANIFEST_JSON]);
    assert_eq!(
        preview.files[0].bytes as usize,
        preview.files[0].contents.len()
    );
}
