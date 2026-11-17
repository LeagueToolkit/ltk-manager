//! The directory that holds the daily log files of the app.

use std::{
    io,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

use chrono::{DateTime, Utc};
use fs_err as fs;
use ltk_manager_base::utils::text;
use ltk_manager_runtime::diagnostics::ids::LogIds;
use serde::{Deserialize, Serialize};

#[cfg(test)]
mod tests;

/// The file in the log directory that holds the ruleset version of the last rewrite.
const REDACTED_MARKER: &str = ".redacted";

/// The file in the log directory that holds the panic record of a run.
const PANIC_RECORD: &str = "panic.json";

/// The time and the build of a panic. The log of the run holds the message and the location,
/// so the record holds no text that needs redaction.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PanicRecord {
    pub at: DateTime<Utc>,
    /// The version of the build that panicked.
    pub version: String,
}

/// The directory that holds the daily log files of the app and the panic record.
///
/// The log appender writes one file for each day, named
/// `<FILE_PREFIX>.<date>.<FILE_SUFFIX>`. A run that panics writes the panic record, and a
/// run that exits normally deletes it, so a record at startup is the panic that closed the
/// run before.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogDir(PathBuf);

impl LogDir {
    /// The part of a log file name before the date.
    pub const FILE_PREFIX: &'static str = "ltk-manager";
    /// The part of a log file name after the date.
    pub const FILE_SUFFIX: &'static str = "log";

    /// Returns the log directory at `path`. The directory does not have to exist.
    #[must_use]
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self(path.into())
    }

    /// Returns the path of the directory.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.0
    }

    /// Writes `record` as the panic record of this run. Replaces an earlier record.
    ///
    /// Reports no failure, because the caller is the panic hook.
    pub fn record_panic(&self, record: &PanicRecord) {
        if let Ok(json) = serde_json::to_vec(record) {
            let _ = fs::write(self.0.join(PANIC_RECORD), json);
        }
    }

    /// Returns the panic record and leaves it in the directory.
    ///
    /// Returns `None` if the directory holds no record, or if the record cannot be parsed.
    #[must_use]
    pub fn panic_record(&self) -> Option<PanicRecord> {
        let json = fs::read(self.0.join(PANIC_RECORD)).ok()?;
        serde_json::from_slice(&json).ok()
    }

    /// Returns the panic record and deletes it.
    ///
    /// Returns `None` if the directory holds no record, or if the record cannot be parsed.
    #[must_use]
    pub fn take_panic(&self) -> Option<PanicRecord> {
        let record = self.panic_record();
        self.clear_panic();
        record
    }

    /// Deletes the panic record. Does nothing if the directory holds no record.
    pub fn clear_panic(&self) {
        let _ = fs::remove_file(self.0.join(PANIC_RECORD));
    }

    /// Returns the path of each log file in the directory.
    ///
    /// # Errors
    ///
    /// Returns the error of the directory read.
    pub fn files(&self) -> io::Result<impl Iterator<Item = PathBuf>> {
        let is_log_file = |name: &str| {
            name.strip_prefix(Self::FILE_PREFIX)
                .and_then(|rest| rest.strip_suffix(Self::FILE_SUFFIX))
                .is_some_and(|date| date.len() > 2 && date.starts_with('.') && date.ends_with('.'))
        };
        Ok(fs::read_dir(&self.0)?
            .flatten()
            .map(|entry| entry.path())
            .filter(move |path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(is_log_file)
            }))
    }

    /// Returns the newest `runs` runs of the log, `max_bytes` at most.
    ///
    /// A run starts at a line that carries another run id than the line with an id before
    /// it, so a line without an id belongs to the run before it. Returns the whole log if it
    /// holds fewer runs. Cuts the oldest lines if the runs exceed `max_bytes`. Skips a file
    /// that cannot be read. Returns `None` if the directory holds no log text.
    #[must_use]
    pub fn recent_runs(&self, runs: usize, max_bytes: usize) -> Option<String> {
        // The file name holds the date, so the order of the names is the order of the days.
        let mut paths: Vec<PathBuf> = self.files().ok()?.collect();
        paths.sort();

        let mut log = Log::default();
        for path in paths.iter().rev() {
            let Ok(bytes) = fs::read(path) else {
                continue;
            };
            log.prepend(&String::from_utf8_lossy(&bytes));
            // One run more than `runs`, because the oldest run of the text can start in an
            // older file.
            if log.run_starts().len() > runs || log.0.len() >= max_bytes {
                break;
            }
        }

        log.keep_newest_runs(runs);
        let log = text::last_lines(&log.0, max_bytes);
        (!log.is_empty()).then(|| log.to_owned())
    }

    /// Rewrites each log file through the shared redactor, once for each ruleset version.
    ///
    /// A release that did not redact the log wrote the existing files. Skips the rewrite if
    /// the marker file holds the current ruleset version. Leaves a file unchanged if it
    /// cannot be read or replaced, and then writes no marker, so the next start tries again.
    ///
    /// Reports a failure on stderr, because the caller runs before logging is initialized.
    pub fn redact_existing(&self) {
        let marker = self.0.join(REDACTED_MARKER);
        let current = ltk_redact::RULESET_VERSION.to_string();
        if fs::read_to_string(&marker).is_ok_and(|done| done.trim() == current) {
            return;
        }
        let Ok(files) = self.files() else {
            return;
        };

        let mut complete = true;
        for path in files {
            if let Err(e) = redact_file(&path) {
                eprintln!("Failed to redact log file {}: {}", path.display(), e);
                complete = false;
            }
        }
        if complete {
            let _ = fs::write(&marker, current);
        }
    }

    /// Deletes each log file that was last written more than `max_age` ago.
    pub fn remove_older_than(&self, max_age: Duration) {
        let files = match self.files() {
            Ok(files) => files,
            Err(e) => {
                tracing::warn!("Failed to read log directory for cleanup: {}", e);
                return;
            }
        };

        for path in files {
            let Ok(modified) = fs::metadata(&path).and_then(|m| m.modified()) else {
                continue;
            };
            let Ok(age) = SystemTime::now().duration_since(modified) else {
                continue;
            };
            if age <= max_age {
                continue;
            }
            match fs::remove_file(&path) {
                Ok(()) => tracing::info!("Deleted old log file: {}", path.display()),
                Err(e) => {
                    tracing::warn!("Failed to delete old log file {}: {}", path.display(), e);
                }
            }
        }
    }
}

/// Rewrites the file at `path` through the redactor. Writes nothing if no line changes.
fn redact_file(path: &Path) -> io::Result<()> {
    let original = String::from_utf8_lossy(&fs::read(path)?).into_owned();
    let mut redacted = String::with_capacity(original.len());
    for line in original.split_inclusive('\n') {
        redacted.push_str(&ltk_redact::redact(line));
    }
    if redacted == original {
        return Ok(());
    }
    let temporary = path.with_extension("log.redacting");
    fs::write(&temporary, redacted)?;
    fs::rename(&temporary, path)
}

/// The text of the log across the daily files, oldest line first.
#[derive(Debug, Default)]
struct Log(String);

impl Log {
    /// Adds `older`, the text of an older file, before the first line.
    fn prepend(&mut self, older: &str) {
        self.0.insert_str(0, older);
    }

    /// Returns the offset of each line that starts a run: a line that carries another run
    /// id than the line with an id before it.
    fn run_starts(&self) -> Vec<usize> {
        let mut starts = Vec::new();
        let mut current = None;
        let mut offset = 0;
        for line in self.0.split_inclusive('\n') {
            if let Some(run) = LogIds::run_of(line).filter(|run| current != Some(*run)) {
                starts.push(offset);
                current = Some(run);
            }
            offset += line.len();
        }
        starts
    }

    /// Removes the lines before the newest `runs` runs. Keeps every line if the log holds
    /// fewer runs.
    fn keep_newest_runs(&mut self, runs: usize) {
        let starts = self.run_starts();
        if let Some(start) = starts.len().checked_sub(runs).map(|first| starts[first]) {
            self.0.drain(..start);
        }
    }
}
