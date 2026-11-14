use super::*;

const MAX_BYTES: usize = 1024 * 1024;

/// A log directory with one file for each of `days`.
fn log_dir(days: &[(&str, &str)]) -> (tempfile::TempDir, LogDir) {
    let dir = tempfile::tempdir().expect("a temporary directory");
    for (date, contents) in days {
        fs::write(dir.path().join(format!("ltk-manager.{date}.log")), contents).unwrap();
    }
    let logs = LogDir::new(dir.path());
    (dir, logs)
}

fn run(name: &str) -> String {
    format!("INFO {RUN_START}1.34.0\nINFO {name} line\n")
}

#[test]
fn files_returns_the_daily_log_files_only() {
    let (dir, logs) = log_dir(&[("2026-11-14", ""), ("2026-11-15", "")]);
    for other in [
        "notes.txt",
        "ltk-manager.log",
        ".redacted",
        "ltk-manager.2026.log.redacting",
    ] {
        fs::write(dir.path().join(other), "").unwrap();
    }

    let mut names: Vec<String> = logs
        .files()
        .unwrap()
        .map(|path| path.file_name().unwrap().to_string_lossy().into_owned())
        .collect();
    names.sort();

    assert_eq!(
        names,
        ["ltk-manager.2026-11-14.log", "ltk-manager.2026-11-15.log"]
    );
}

#[test]
fn recent_runs_keeps_the_newest_runs_across_files() {
    let (_dir, logs) = log_dir(&[
        ("2026-11-13", &[run("first"), run("second")].concat()),
        ("2026-11-14", &run("third")),
        ("2026-11-15", &run("fourth")),
    ]);

    assert_eq!(
        logs.recent_runs(3, MAX_BYTES).unwrap(),
        [run("second"), run("third"), run("fourth")].concat()
    );
}

#[test]
fn recent_runs_returns_the_whole_log_if_it_holds_fewer_runs() {
    let (_dir, logs) = log_dir(&[("2026-11-15", "INFO a line before any start\n")]);

    assert_eq!(
        logs.recent_runs(3, MAX_BYTES).unwrap(),
        "INFO a line before any start\n"
    );
}

#[test]
fn recent_runs_cuts_the_oldest_lines_at_the_size_limit() {
    let (_dir, logs) = log_dir(&[("2026-11-15", "one\ntwo\nthree\nfour\n")]);

    assert_eq!(logs.recent_runs(3, 12).unwrap(), "three\nfour\n");
}

#[test]
fn recent_runs_returns_none_if_the_directory_holds_no_log_file() {
    let (dir, logs) = log_dir(&[]);

    assert_eq!(logs.recent_runs(3, MAX_BYTES), None);
    assert_eq!(
        LogDir::new(dir.path().join("missing")).recent_runs(3, MAX_BYTES),
        None
    );
}

#[test]
fn redact_existing_rewrites_log_files_once() {
    let (dir, logs) = log_dir(&[("2026-11-01", "GET https://a.example/b?sig=1\nplain line\n")]);
    let log = dir.path().join("ltk-manager.2026-11-01.log");
    let other = dir.path().join("notes.txt");
    fs::write(&other, "https://a.example/b?sig=1").unwrap();

    logs.redact_existing();

    assert_eq!(
        fs::read_to_string(&log).unwrap(),
        "GET https://a.example/b\nplain line\n"
    );
    assert_eq!(
        fs::read_to_string(&other).unwrap(),
        "https://a.example/b?sig=1"
    );

    fs::write(&log, "GET https://a.example/b?sig=2\n").unwrap();
    logs.redact_existing();
    assert_eq!(
        fs::read_to_string(&log).unwrap(),
        "GET https://a.example/b?sig=2\n"
    );
}

#[test]
fn remove_older_than_deletes_the_files_past_the_age() {
    let (dir, logs) = log_dir(&[("2026-11-13", "old\n"), ("2026-11-15", "new\n")]);
    let old = dir.path().join("ltk-manager.2026-11-13.log");
    let two_days_ago = SystemTime::now() - Duration::from_secs(2 * 24 * 60 * 60);
    fs::OpenOptions::new()
        .write(true)
        .open(&old)
        .unwrap()
        .set_modified(two_days_ago)
        .unwrap();

    logs.remove_older_than(Duration::from_secs(24 * 60 * 60));

    assert!(!old.exists());
    assert!(dir.path().join("ltk-manager.2026-11-15.log").exists());
}
