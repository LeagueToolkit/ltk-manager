//! The directory that holds the daily log files of the app.

use std::{
    io,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

use fs_err as fs;

#[cfg(test)]
mod tests;

/// The text that starts the first log line of a run.
pub const RUN_START: &str = "Starting LTK Manager v";

/// The file in the log directory that holds the ruleset version of the last rewrite.
const REDACTED_MARKER: &str = ".redacted";

/// The directory that holds the daily log files of the app.
///
/// The log appender writes one file for each day, named
/// `<FILE_PREFIX>.<date>.<FILE_SUFFIX>`. Every method reads or changes those files only.
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
    /// A run starts at a line that holds [`RUN_START`]. Returns the whole log if it holds
    /// fewer runs. Cuts the oldest lines if the runs exceed `max_bytes`. Skips a file that
    /// cannot be read. Returns `None` if the directory holds no log text.
    #[must_use]
    pub fn recent_runs(&self, runs: usize, max_bytes: usize) -> Option<String> {
        // The file name holds the date, so the order of the names is the order of the days.
        let mut paths: Vec<PathBuf> = self.files().ok()?.collect();
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

/// Returns the last `max_bytes` bytes of `text`, starting at the start of a line.
pub(crate) fn newest(text: &str, max_bytes: usize) -> &str {
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
