use std::io::{Cursor, Read};

use chrono::TimeZone;
use fs_err as fs;
use serde_json::json;

use super::*;
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

fn report(description: Description) -> SupportReport {
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
    let mut report = report(Description::default());
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
    let report = report(Description {
        problem: Some(Problem::ModNotShown),
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
    let mut report = report(Description::default());
    report.add_log(&logs);
    report.add_settings(&json!({ "readGameLog": true }));

    let report = report.finish();

    let paths: Vec<&str> = report.files().iter().map(|file| file.path).collect();
    assert_eq!(paths, [REPORT_MD, MANIFEST_JSON, LOG_FILE, SETTINGS_JSON]);
    let manifest = report.manifest();
    assert_eq!(manifest.schema, SCHEMA_VERSION);
    assert_eq!(manifest.ruleset, ltk_redact::RULESET_VERSION);
    let listed: Vec<(&str, usize)> = manifest
        .files
        .iter()
        .map(|entry| (entry.path, entry.bytes))
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
    let mut report = report(Description::default());
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
    let mut report = report(Description::default());
    report.add_log(&logs);
    let report = report.finish();

    let mut bytes = Cursor::new(Vec::new());
    report.write_zip(&mut bytes).unwrap();

    let mut zip = zip::ZipArchive::new(bytes).unwrap();
    assert_eq!(zip.len(), report.files().len());
    for expected in report.files() {
        let mut contents = String::new();
        zip.by_name(expected.path)
            .unwrap()
            .read_to_string(&mut contents)
            .unwrap();
        assert_eq!(contents, expected.contents, "{}", expected.path);
    }
}
