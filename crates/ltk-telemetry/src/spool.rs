//! What survives a restart, and what is dropped to keep it bounded.

use std::io::Write as _;
use std::path::{Path, PathBuf};

use fs_err as fs;
use tracing::{debug, warn};

use crate::event::Event;

#[cfg(test)]
mod tests;

/// The file the spool is kept in, inside the directory the caller names.
const FILE_NAME: &str = "telemetry-spool.jsonl";

/// The file a rewrite is built in, so a crash cannot leave a half written spool.
const TEMP_FILE_NAME: &str = "telemetry-spool.jsonl.tmp";

/// What the spool holds before the oldest entry is dropped.
///
/// Both caps are enforced on every append. A session event runs to roughly two
/// kilobytes, so the entry cap is what binds in practice and the byte cap is the
/// ceiling an unexpectedly large property map cannot cross.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SpoolCaps {
    /// How many events are kept.
    pub entries: usize,

    /// How many bytes the file may reach.
    pub bytes: u64,
}

impl Default for SpoolCaps {
    fn default() -> Self {
        Self {
            entries: 256,
            bytes: 1024 * 1024,
        }
    }
}

/// The events written down but not yet delivered, oldest first.
///
/// Every failure is logged and swallowed. A machine whose disk refuses the write
/// loses telemetry, which is the only acceptable outcome.
#[derive(Debug)]
pub struct Spool {
    path: PathBuf,
    temp_path: PathBuf,
    caps: SpoolCaps,
    entries: usize,
}

impl Spool {
    /// The spool kept in `dir`, creating the directory when it is missing.
    #[must_use]
    pub fn open(dir: impl AsRef<Path>, caps: SpoolCaps) -> Self {
        let dir = dir.as_ref();
        if let Err(error) = fs::create_dir_all(dir) {
            warn!(%error, "Failed to make the telemetry spool directory");
        }

        let mut spool = Self {
            path: dir.join(FILE_NAME),
            temp_path: dir.join(TEMP_FILE_NAME),
            caps,
            entries: 0,
        };
        spool.entries = spool.read().len();
        spool
    }

    /// Where the spool is written.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// How many events the spool holds.
    #[must_use]
    pub fn len(&self) -> usize {
        self.entries
    }

    /// Whether the spool holds nothing.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entries == 0
    }

    /// Write `event` down, dropping the oldest entries when a cap is crossed.
    ///
    /// The write reaches the file before this answers, which is what lets a panic
    /// hook record the event that explains the panic.
    pub fn append(&mut self, event: &Event) {
        let Ok(mut line) = serde_json::to_string(event) else {
            warn!(event = event.name(), "Failed to encode a telemetry event");
            return;
        };
        line.push('\n');

        let appended = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .and_then(|mut file| file.write_all(line.as_bytes()));
        if let Err(error) = appended {
            warn!(%error, "Failed to write a telemetry event to the spool");
            return;
        }

        self.entries += 1;
        self.enforce_caps();
    }

    /// Every event the spool holds, oldest first.
    ///
    /// A line that cannot be read is skipped rather than failing the read, so one
    /// event written by an older build cannot strand the rest.
    #[must_use]
    pub fn read(&self) -> Vec<Event> {
        let contents = match fs::read_to_string(&self.path) {
            Ok(contents) => contents,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Vec::new(),
            Err(error) => {
                warn!(%error, "Failed to read the telemetry spool");
                return Vec::new();
            }
        };

        contents
            .lines()
            .filter(|line| !line.trim().is_empty())
            .filter_map(|line| match serde_json::from_str(line) {
                Ok(event) => Some(event),
                Err(error) => {
                    debug!(%error, "Dropped an unreadable telemetry spool entry");
                    None
                }
            })
            .collect()
    }

    /// Drop the first `count` events, which are the ones a flush delivered.
    pub fn remove_first(&mut self, count: usize) {
        if count == 0 {
            return;
        }
        let events = self.read();
        if count >= events.len() {
            self.clear();
            return;
        }
        self.rewrite(&events[count..]);
    }

    /// Drop everything the spool holds.
    pub fn clear(&mut self) {
        match fs::remove_file(&self.path) {
            Ok(()) => self.entries = 0,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => self.entries = 0,
            Err(error) => warn!(%error, "Failed to clear the telemetry spool"),
        }
    }

    /// Drop from the front until both caps hold, keeping the newest event always.
    fn enforce_caps(&mut self) {
        let over_entries = self.entries > self.caps.entries;
        let over_bytes = self.file_len() > self.caps.bytes;
        if !over_entries && !over_bytes {
            return;
        }

        let events = self.read();
        let mut kept = events.as_slice();
        while kept.len() > 1
            && (kept.len() > self.caps.entries || encoded_len(kept) > self.caps.bytes)
        {
            kept = &kept[1..];
        }
        self.rewrite(kept);
    }

    fn rewrite(&mut self, events: &[Event]) {
        let mut contents = String::new();
        for event in events {
            match serde_json::to_string(event) {
                Ok(line) => {
                    contents.push_str(&line);
                    contents.push('\n');
                }
                Err(error) => warn!(%error, "Dropped a telemetry event that stopped encoding"),
            }
        }

        if let Err(error) = fs::write(&self.temp_path, &contents) {
            warn!(%error, "Failed to rewrite the telemetry spool");
            return;
        }
        if let Err(error) = fs::rename(&self.temp_path, &self.path) {
            warn!(%error, "Failed to put the rewritten telemetry spool in place");
            return;
        }
        self.entries = events.len();
    }

    fn file_len(&self) -> u64 {
        fs::metadata(&self.path).map(|meta| meta.len()).unwrap_or(0)
    }
}

/// How many bytes `events` take as spool lines.
fn encoded_len(events: &[Event]) -> u64 {
    events
        .iter()
        .map(|event| {
            serde_json::to_string(event)
                .map(|line| line.len() as u64 + 1)
                .unwrap_or(0)
        })
        .sum()
}
