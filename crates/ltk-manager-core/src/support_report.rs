//! The support report: a set of named text files in one zip, for a maintainer to read.
//!
//! A file is in a report only if a builder method of [`SupportReport`] writes it. No method
//! copies a directory. Every file passes the shared redactor when it is added, and the
//! manifest holds the count of the replacements.
//!
//! The module needs no webview, so that a report can be built when the window does not open.

use std::{
    collections::BTreeMap,
    io::{self, Seek, Write},
    path::{Path, PathBuf},
};

use chrono::{DateTime, Utc};
use fs_err as fs;
use ltk_redact::Counts;
use serde::{Deserialize, Serialize};
use zip::{ZipWriter, write::SimpleFileOptions};

#[cfg(test)]
mod tests;

/// The version of the layout of a report. A change to a file name or to a field raises it.
pub const SCHEMA_VERSION: u32 = 1;

/// The largest size of the files of a report together, in bytes.
pub const MAX_REPORT_BYTES: usize = 2 * 1024 * 1024;

/// The number of runs that the log of a report holds, the current run included.
const LOG_RUNS: usize = 3;

/// The text that starts the first log line of a run.
pub const RUN_START: &str = "Starting LTK Manager v";

const REPORT_MD: &str = "report.md";
const MANIFEST_JSON: &str = "manifest.json";
const LOG_FILE: &str = "log/ltk-manager.log";
const SETTINGS_JSON: &str = "settings.json";

/// The settings fields that a report holds. A field that is not listed is left out, so a
/// field that is added to the settings later is absent until it is listed here.
const SETTINGS_ALLOWLIST: &[&str] = &[
    "leaguePath",
    "modStoragePath",
    "workshopPath",
    "patchTft",
    "blockScriptsWad",
    "wadBlocklist",
    "autoHealthCheckEnabled",
    "applyStringOverridesToAllLocales",
    "verbosePatcherLogging",
    "betaPatcher",
    "fullWadScan",
    "disableCrashReporting",
    "hideRiotClientOnLaunch",
    "readGameLog",
    "keepIncidents",
    "builtinMods",
    "defaultWardSkins",
    "baseSkins",
    "mapSkin",
    "forcedMapSkin",
    "mapDecorations",
    "characterInking",
    "minimizeToTray",
    "startInTray",
    "autoRun",
    "autoDownloadUpdates",
    "alwaysStartPatcher",
    "launchMode",
    "stopPatcherOnSessionEnd",
    "watcherEnabled",
    "telemetryEnabled",
];

/// The build that writes a report.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppIdentity {
    /// The app identifier, such as `dev.leaguetoolkit.manager`.
    pub identifier: String,
    pub version: String,
    /// Whether the build is a release build.
    pub release_build: bool,
}

/// The kind of failure that the user reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "kebab-case")]
pub enum Problem {
    ModNotShown,
    GameCrashed,
    Manager,
}

impl Problem {
    /// Returns the English sentence for the problem, as `report.md` states it.
    fn sentence(self) -> &'static str {
        match self {
            Self::ModNotShown => "A mod does not show",
            Self::GameCrashed => "The game crashed",
            Self::Manager => "The manager has a problem",
        }
    }
}

/// What the user says went wrong.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Description {
    pub problem: Option<Problem>,
    /// The name of the mod that the report is about.
    pub mod_name: Option<String>,
    /// The user's own words. The text is redacted like every other part of a report.
    pub text: String,
}

/// One file of a report, after redaction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReportFile {
    /// The path of the file inside the zip, with `/` as the separator.
    pub path: &'static str,
    pub contents: String,
}

/// The entry of one file in the manifest.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: &'static str,
    pub bytes: usize,
}

/// The contents of `manifest.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub schema: u32,
    /// The version of the redaction rules that the report was built with.
    pub ruleset: u32,
    pub id: String,
    pub created_at: DateTime<Utc>,
    pub app: AppIdentity,
    pub os: &'static str,
    pub arch: &'static str,
    /// The number of replacements of each redaction rule, over every other file.
    pub replacements: BTreeMap<&'static str, usize>,
    /// Every other file of the report, in the order of the zip.
    pub files: Vec<FileEntry>,
}

/// A report under construction. Each `add_` method is the builder of one file.
#[derive(Debug)]
pub struct SupportReport {
    id: String,
    created_at: DateTime<Utc>,
    app: AppIdentity,
    description: Description,
    files: Vec<ReportFile>,
    counts: Counts,
}

impl SupportReport {
    /// Returns an empty report of the build `app`, created at `created_at`, with an id of
    /// eight random hex characters.
    #[must_use]
    pub fn new(app: AppIdentity, description: Description, created_at: DateTime<Utc>) -> Self {
        let mut id = uuid::Uuid::new_v4().simple().to_string();
        id.truncate(8);
        Self {
            id,
            created_at,
            app,
            description,
            files: Vec::new(),
            counts: Counts::default(),
        }
    }

    /// Adds `contents` as the file at `path`, redacted line by line. Every file enters a
    /// report here.
    fn add(&mut self, path: &'static str, contents: &str) {
        let mut redacted = String::with_capacity(contents.len());
        for line in contents.split_inclusive('\n') {
            redacted.push_str(&ltk_redact::redact_counting(line, &mut self.counts));
        }
        self.files.push(ReportFile {
            path,
            contents: redacted,
        });
    }

    /// Adds `log/ltk-manager.log`: the current run and the two runs before it, from the log
    /// files in `log_dir`.
    ///
    /// Adds nothing if `log_dir` holds no log file. A log file that cannot be read is
    /// skipped.
    pub fn add_log(&mut self, log_dir: &Path) {
        if let Some(log) = recent_runs(log_dir, LOG_RUNS, MAX_REPORT_BYTES) {
            self.add(LOG_FILE, &log);
        }
    }

    /// Adds `settings.json`: the fields of `settings` that the allowlist names.
    ///
    /// `settings` is the settings document as the settings file holds it. Adds nothing if it
    /// is not a JSON object.
    pub fn add_settings(&mut self, settings: &serde_json::Value) {
        let Some(fields) = settings.as_object() else {
            return;
        };
        let kept: serde_json::Map<String, serde_json::Value> = SETTINGS_ALLOWLIST
            .iter()
            .filter_map(|key| Some(((*key).to_owned(), fields.get(*key)?.clone())))
            .collect();
        if let Ok(json) = serde_json::to_string_pretty(&kept) {
            self.add(SETTINGS_JSON, &json);
        }
    }

    /// Completes the report: cuts the log if the files exceed [`MAX_REPORT_BYTES`], then
    /// writes `report.md` and `manifest.json`.
    #[must_use]
    pub fn finish(mut self) -> BuiltReport {
        let summary = self.summary();
        self.add(REPORT_MD, &summary);
        self.cut_log_to_fit();

        // `report.md` is the first file that a reader opens, so it is the first file.
        self.files.sort_by_key(|file| file.path != REPORT_MD);
        let manifest = Manifest {
            schema: SCHEMA_VERSION,
            ruleset: ltk_redact::RULESET_VERSION,
            id: self.id,
            created_at: self.created_at,
            app: self.app,
            os: std::env::consts::OS,
            arch: std::env::consts::ARCH,
            replacements: self.counts.iter().collect(),
            files: self
                .files
                .iter()
                .map(|file| FileEntry {
                    path: file.path,
                    bytes: file.contents.len(),
                })
                .collect(),
        };
        let json = serde_json::to_string_pretty(&manifest)
            .expect("a manifest holds strings and numbers only");
        self.files.insert(
            1,
            ReportFile {
                path: MANIFEST_JSON,
                contents: json,
            },
        );
        BuiltReport {
            manifest,
            files: self.files,
        }
    }

    /// Returns the text of `report.md`, in English, before redaction.
    ///
    /// The first line states the app identifier, the version and the kind of the build.
    fn summary(&self) -> String {
        let build = if self.app.release_build {
            "release build"
        } else {
            "development build"
        };
        let mut out = format!(
            "{} {}, {build}, {} {}\n\n# LTK Manager support report {}\n\nCreated {} UTC\n",
            self.app.identifier,
            self.app.version,
            std::env::consts::OS,
            std::env::consts::ARCH,
            self.id,
            self.created_at.format("%Y-%m-%d %H:%M"),
        );

        out.push_str("\n## What went wrong\n\n");
        let problem = self.description.problem.map(Problem::sentence);
        match (problem, self.description.mod_name.as_deref()) {
            (Some(problem), Some(name)) => out.push_str(&format!("{problem}: {name}\n")),
            (Some(problem), None) => out.push_str(&format!("{problem}\n")),
            (None, Some(name)) => out.push_str(&format!("Mod: {name}\n")),
            (None, None) => out.push_str("Not stated\n"),
        }
        let text = self.description.text.trim();
        if !text.is_empty() {
            out.push_str(&format!("\n{text}\n"));
        }
        out
    }

    /// Cuts the oldest lines of the log until the files fit in [`MAX_REPORT_BYTES`].
    fn cut_log_to_fit(&mut self) {
        let total: usize = self.files.iter().map(|file| file.contents.len()).sum();
        let Some(excess) = total
            .checked_sub(MAX_REPORT_BYTES)
            .filter(|excess| *excess > 0)
        else {
            return;
        };
        if let Some(log) = self.files.iter_mut().find(|file| file.path == LOG_FILE) {
            let keep = log.contents.len().saturating_sub(excess);
            log.contents = newest(&log.contents, keep).to_owned();
        }
    }
}

/// A complete report.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BuiltReport {
    manifest: Manifest,
    files: Vec<ReportFile>,
}

impl BuiltReport {
    /// Returns the manifest of the report.
    #[must_use]
    pub fn manifest(&self) -> &Manifest {
        &self.manifest
    }

    /// Returns every file of the report, `manifest.json` included, in the order of the zip.
    #[must_use]
    pub fn files(&self) -> &[ReportFile] {
        &self.files
    }

    /// Returns the file name of the zip: `ltk-report-<date>-<id>.zip`.
    #[must_use]
    pub fn file_name(&self) -> String {
        format!(
            "ltk-report-{}-{}.zip",
            self.manifest.created_at.format("%Y-%m-%d"),
            self.manifest.id
        )
    }

    /// Writes the report to `writer` as a zip.
    ///
    /// # Errors
    ///
    /// Returns the error of `writer`, or of the zip encoder.
    pub fn write_zip(&self, writer: impl Write + Seek) -> io::Result<()> {
        let mut zip = ZipWriter::new(writer);
        for file in &self.files {
            zip.start_file(file.path, SimpleFileOptions::default())?;
            zip.write_all(file.contents.as_bytes())?;
        }
        zip.finish()?;
        Ok(())
    }
}

/// Returns the path of each log file in `log_dir`.
///
/// # Errors
///
/// Returns the error of the directory read.
pub fn log_files(log_dir: &Path) -> io::Result<impl Iterator<Item = PathBuf>> {
    let is_log_file = |name: &str| name.starts_with("ltk-manager.") && name.ends_with(".log");
    Ok(fs::read_dir(log_dir)?
        .flatten()
        .map(|entry| entry.path())
        .filter(move |path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(is_log_file)
        }))
}

/// Returns the newest `runs` runs of the log files in `log_dir`, `max_bytes` at most.
///
/// A run starts at a line that holds [`RUN_START`]. Returns the whole log if it holds fewer
/// runs. Cuts the oldest lines if the runs exceed `max_bytes`. Returns `None` if `log_dir`
/// holds no log text.
fn recent_runs(log_dir: &Path, runs: usize, max_bytes: usize) -> Option<String> {
    // The file name holds the date, so the order of the names is the order of the days.
    let mut paths: Vec<PathBuf> = log_files(log_dir).ok()?.collect();
    paths.sort();

    let mut log = String::new();
    for path in paths.iter().rev() {
        let Ok(bytes) = fs::read(path) else {
            continue;
        };
        log.insert_str(0, &String::from_utf8_lossy(&bytes));
        if log.matches(RUN_START).count() >= runs || log.len() >= max_bytes {
            break;
        }
    }

    let starts: Vec<usize> = log.match_indices(RUN_START).map(|(at, _)| at).collect();
    if let Some(start) = starts.len().checked_sub(runs).map(|first| starts[first]) {
        // The marker sits after the timestamp and the level, so the run starts at the
        // start of its line.
        let line_start = log[..start].rfind('\n').map_or(0, |newline| newline + 1);
        log.drain(..line_start);
    }
    let log = newest(&log, max_bytes);
    (!log.is_empty()).then(|| log.to_owned())
}

/// Returns the last `max_bytes` bytes of `text`, starting at the start of a line.
fn newest(text: &str, max_bytes: usize) -> &str {
    let Some(mut cut) = text.len().checked_sub(max_bytes).filter(|cut| *cut > 0) else {
        return text;
    };
    while !text.is_char_boundary(cut) {
        cut += 1;
    }
    match text[cut..].find('\n') {
        Some(newline) => &text[cut + newline + 1..],
        None => "",
    }
}
