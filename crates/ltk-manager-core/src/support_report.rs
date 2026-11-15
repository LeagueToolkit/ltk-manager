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
};

use chrono::{DateTime, Utc};
use ltk_manager_base::utils::text;
use ltk_redact::Counts;
use serde::{Deserialize, Serialize};
use zip::{ZipWriter, write::SimpleFileOptions};

use crate::log_dir::LogDir;

mod files;

#[cfg(test)]
mod tests;

/// The version of the layout of a report. A change to a file name or to a field raises it.
pub const SCHEMA_VERSION: u32 = 1;

/// The largest size of the files of a report together, in bytes.
pub const MAX_REPORT_BYTES: usize = 2 * 1024 * 1024;

/// The number of runs that the log of a report holds, the current run included.
const LOG_RUNS: usize = 3;

/// The largest size of the summary for a Discord message, in characters. A Discord message
/// holds 2,000.
pub const MAX_SUMMARY_CHARS: usize = 1500;

/// The largest size of the problem line in the summary, in characters.
const SUMMARY_LINE_CHARS: usize = 160;

/// The largest size of the user's words and of the cause in the summary, in characters each.
const SUMMARY_TEXT_CHARS: usize = 300;

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
pub enum ReportProblem {
    ModNotShown,
    GameCrashed,
    Manager,
}

impl ReportProblem {
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
pub struct ReportDescription {
    pub problem: Option<ReportProblem>,
    /// The name of the mod that the report is about.
    pub mod_name: Option<String>,
    /// The user's own words. The text is redacted like every other part of a report.
    pub text: String,
}

/// One file of a report, after redaction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReportFile {
    /// The path of the file inside the zip, with `/` as the separator.
    pub path: String,
    pub contents: String,
}

/// What the manager found: the verdict of the newest incident.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Finding {
    title: String,
    consequence: String,
    cause: String,
    incident_id: String,
    token: String,
}

/// One file of a report, as the dialog shows it before the report leaves.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ReportPreviewFile {
    pub path: String,
    pub bytes: u32,
    pub contents: String,
}

/// The number of replacements in a report, by the kind of value that was replaced.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ReportReplacements {
    /// The profile directory, the League, storage and workshop paths, and the path of
    /// another user.
    pub paths: u32,
    /// URLs and `ltk://` links.
    pub links: u32,
    /// IP addresses and email addresses.
    pub addresses: u32,
    /// Every other value, such as the username, the computer name and a secret.
    pub other: u32,
}

/// A complete report as the dialog shows it before the report leaves.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ReportPreview {
    pub id: String,
    /// The file name of the zip.
    pub file_name: String,
    /// Every file of the report, in the order of the zip.
    pub files: Vec<ReportPreviewFile>,
    pub replaced: ReportReplacements,
    /// The summary that `Copy for Discord` puts on the clipboard.
    pub summary: String,
}

/// The entry of one file in the manifest.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
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
    description: ReportDescription,
    /// What the manager found. The incident builder sets it.
    found: Option<Finding>,
    files: Vec<ReportFile>,
    counts: Counts,
}

impl SupportReport {
    /// Returns an empty report of the build `app`, created at `created_at`, with an id of
    /// eight random hex characters.
    #[must_use]
    pub fn new(
        app: AppIdentity,
        description: ReportDescription,
        created_at: DateTime<Utc>,
    ) -> Self {
        let mut id = uuid::Uuid::new_v4().simple().to_string();
        id.truncate(8);
        Self {
            id,
            created_at,
            app,
            description,
            found: None,
            files: Vec::new(),
            counts: Counts::default(),
        }
    }

    /// Adds `contents` as the file at `path`, redacted line by line. Every file enters a
    /// report here.
    fn add(&mut self, path: impl Into<String>, contents: &str) {
        let mut redacted = String::with_capacity(contents.len());
        for line in contents.split_inclusive('\n') {
            redacted.push_str(&ltk_redact::redact_counting(line, &mut self.counts));
        }
        self.files.push(ReportFile {
            path: path.into(),
            contents: redacted,
        });
    }

    /// Adds `log/ltk-manager.log`: the current run and the two runs before it, from the
    /// files of `log_dir`.
    ///
    /// Adds nothing if `log_dir` holds no log text.
    pub fn add_log(&mut self, log_dir: &LogDir) {
        if let Some(log) = log_dir.recent_runs(LOG_RUNS, MAX_REPORT_BYTES) {
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
        let report_md = self.report_md();
        self.add(REPORT_MD, &report_md);
        self.cut_log_to_fit();
        let summary = self.discord_summary();

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
                    path: file.path.clone(),
                    bytes: file.contents.len(),
                })
                .collect(),
        };
        let json = serde_json::to_string_pretty(&manifest)
            .expect("a manifest holds strings and numbers only");
        self.files.insert(
            1,
            ReportFile {
                path: MANIFEST_JSON.to_owned(),
                contents: json,
            },
        );
        BuiltReport {
            manifest,
            files: self.files,
            summary,
        }
    }

    /// Returns the kind of the build, as `report.md` and the summary state it.
    fn build_kind(&self) -> &'static str {
        if self.app.release_build {
            "release build"
        } else {
            "development build"
        }
    }

    /// Returns the problem and the mod of the description as one line, in English.
    fn problem_line(&self) -> String {
        let problem = self.description.problem.map(ReportProblem::sentence);
        match (problem, self.description.mod_name.as_deref()) {
            (Some(problem), Some(name)) => format!("{problem}: {name}"),
            (Some(problem), None) => problem.to_owned(),
            (None, Some(name)) => format!("Mod: {name}"),
            (None, None) => "Not stated".to_owned(),
        }
    }

    /// Returns the summary for a Discord message, in English and redacted,
    /// [`MAX_SUMMARY_CHARS`] characters at most.
    ///
    /// The summary states the versions, the problem, the user's words, the verdict and the
    /// token of the newest incident, and the name of the zip.
    fn discord_summary(&self) -> String {
        let mut out = format!(
            "**LTK Manager {}** on {} {}, {}\n**Problem:** {}\n",
            self.app.version,
            std::env::consts::OS,
            std::env::consts::ARCH,
            self.build_kind(),
            text::first_chars(&self.problem_line(), SUMMARY_LINE_CHARS),
        );
        let words = self.description.text.trim();
        if !words.is_empty() {
            let words = text::first_chars(words, SUMMARY_TEXT_CHARS).replace('\n', " ");
            out.push_str(&format!("> {words}\n"));
        }
        match &self.found {
            Some(found) => out.push_str(&format!(
                "**Found:** {} ({}). {}\n**Token:** `{}`\n",
                found.title,
                found.consequence,
                text::first_chars(&found.cause, SUMMARY_TEXT_CHARS),
                found.token
            )),
            None => out.push_str("**Found:** no incident on record\n"),
        }
        out.push_str(&format!(
            "**Report:** `{}`, attached",
            zip_name(self.created_at, &self.id)
        ));

        let redacted = ltk_redact::redact(&out);
        text::first_chars(&redacted, MAX_SUMMARY_CHARS).to_owned()
    }

    /// Returns the text of `report.md`, in English, before redaction.
    ///
    /// The first line states the app identifier, the version and the kind of the build.
    fn report_md(&self) -> String {
        let mut out = format!(
            "{} {}, {}, {} {}\n\n# LTK Manager support report {}\n\nCreated {} UTC\n",
            self.app.identifier,
            self.app.version,
            self.build_kind(),
            std::env::consts::OS,
            std::env::consts::ARCH,
            self.id,
            self.created_at.format("%Y-%m-%d %H:%M"),
        );

        out.push_str(&format!(
            "\n## What went wrong\n\n{}\n",
            self.problem_line()
        ));
        let words = self.description.text.trim();
        if !words.is_empty() {
            out.push_str(&format!("\n{words}\n"));
        }
        if let Some(found) = &self.found {
            out.push_str(&format!(
                "\n## The manager found\n\n{} ({})\n\n{}\n\nIncident {}\nToken: {}\n",
                found.title, found.consequence, found.cause, found.incident_id, found.token
            ));
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
            log.contents = text::last_lines(&log.contents, keep).to_owned();
        }
    }
}

/// Returns the file name of the zip of the report `id` that was created at `created_at`.
fn zip_name(created_at: DateTime<Utc>, id: &str) -> String {
    format!("ltk-report-{}-{id}.zip", created_at.format("%Y-%m-%d"))
}

/// A complete report.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BuiltReport {
    manifest: Manifest,
    files: Vec<ReportFile>,
    summary: String,
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

    /// Returns the summary for a Discord message, in English, [`MAX_SUMMARY_CHARS`]
    /// characters at most.
    #[must_use]
    pub fn summary(&self) -> &str {
        &self.summary
    }

    /// Returns the file name of the zip: `ltk-report-<date>-<id>.zip`.
    #[must_use]
    pub fn file_name(&self) -> String {
        zip_name(self.manifest.created_at, &self.manifest.id)
    }

    /// Returns the report as the dialog shows it before the report leaves.
    #[must_use]
    pub fn preview(&self) -> ReportPreview {
        let count = |n: usize| u32::try_from(n).unwrap_or(u32::MAX);
        let mut replaced = ReportReplacements::default();
        for (rule, replacements) in &self.manifest.replacements {
            let kind = match *rule {
                "profile" | "league" | "data" | "workshop" | "other-user" => &mut replaced.paths,
                "url" | "deep-link" => &mut replaced.links,
                "ipv4" | "ipv6" | "email" => &mut replaced.addresses,
                _ => &mut replaced.other,
            };
            *kind += count(*replacements);
        }
        ReportPreview {
            id: self.manifest.id.clone(),
            file_name: self.file_name(),
            files: self
                .files
                .iter()
                .map(|file| ReportPreviewFile {
                    path: file.path.clone(),
                    bytes: count(file.contents.len()),
                    contents: file.contents.clone(),
                })
                .collect(),
            replaced,
            summary: self.summary.clone(),
        }
    }

    /// Writes the report to `writer` as a zip.
    ///
    /// # Errors
    ///
    /// Returns the error of `writer`, or of the zip encoder.
    pub fn write_zip(&self, writer: impl Write + Seek) -> io::Result<()> {
        let mut zip = ZipWriter::new(writer);
        for file in &self.files {
            zip.start_file(file.path.as_str(), SimpleFileOptions::default())?;
            zip.write_all(file.contents.as_bytes())?;
        }
        zip.finish()?;
        Ok(())
    }
}
