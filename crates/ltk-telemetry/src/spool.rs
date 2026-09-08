//! What survives a restart, and what is dropped to keep it bounded.

use std::io::Write as _;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tracing::{debug, warn};

use fs_err as fs;

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
/// ceiling an unexpectedly large property map cannot cross. The newest event is
/// kept whatever the byte cap says, because a spool holding nothing reports
/// nothing.
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

/// How far into the spool a delivery reached.
///
/// A delivery acknowledges which entries it took rather than how many, so events
/// appended while a batch was in the air cannot be mistaken for delivered ones.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct SpoolMark(u64);

/// The events one flush takes, and the mark that says which they were.
#[derive(Debug, Clone, Default)]
pub struct Batch {
    events: Vec<Event>,
    mark: Option<SpoolMark>,
}

impl Batch {
    /// The events to deliver, oldest first.
    #[must_use]
    pub fn events(&self) -> &[Event] {
        &self.events
    }

    /// The mark to acknowledge once the events are delivered.
    #[must_use]
    pub fn mark(&self) -> Option<SpoolMark> {
        self.mark
    }

    /// How many events the batch carries.
    #[must_use]
    pub fn len(&self) -> usize {
        self.events.len()
    }

    /// Whether the batch carries nothing.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.events.is_empty()
    }
}

/// One event as the spool writes it down, under the mark it is acknowledged by.
#[derive(Debug, Serialize, Deserialize)]
struct Entry {
    seq: u64,
    event: Event,
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
    next_seq: u64,
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
            next_seq: 0,
        };

        let entries = spool.entries();
        spool.entries = entries.len();
        spool.next_seq = entries.iter().map(|entry| entry.seq + 1).max().unwrap_or(0);
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
        let entry = Entry {
            seq: self.next_seq,
            event: event.clone(),
        };
        let Ok(mut line) = serde_json::to_string(&entry) else {
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

        self.next_seq += 1;
        self.entries += 1;
        self.enforce_caps();
    }

    /// Every event the spool holds, oldest first.
    #[must_use]
    pub fn read(&self) -> Vec<Event> {
        self.entries()
            .into_iter()
            .map(|entry| entry.event)
            .collect()
    }

    /// Everything the spool holds, as one batch to deliver.
    #[must_use]
    pub fn batch(&self) -> Batch {
        let entries = self.entries();
        Batch {
            mark: entries.last().map(|entry| SpoolMark(entry.seq)),
            events: entries.into_iter().map(|entry| entry.event).collect(),
        }
    }

    /// Drop every event up to and including `mark`, which a delivery took.
    ///
    /// Whatever was appended since keeps a higher mark and survives, so a flush
    /// that ran alongside a track cannot drop an event nobody sent.
    pub fn remove_through(&mut self, mark: SpoolMark) {
        let kept: Vec<Entry> = self
            .entries()
            .into_iter()
            .filter(|entry| entry.seq > mark.0)
            .collect();
        if kept.is_empty() {
            self.clear();
            return;
        }
        self.rewrite(&kept);
    }

    /// Drop everything the spool holds.
    pub fn clear(&mut self) {
        match fs::remove_file(&self.path) {
            Ok(()) => self.entries = 0,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => self.entries = 0,
            Err(error) => warn!(%error, "Failed to clear the telemetry spool"),
        }
    }

    /// Every entry the spool holds, oldest first.
    ///
    /// A line that cannot be read is skipped rather than failing the read, so one
    /// entry written by an older build cannot strand the rest.
    fn entries(&self) -> Vec<Entry> {
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
                Ok(entry) => Some(entry),
                Err(error) => {
                    debug!(%error, "Dropped an unreadable telemetry spool entry");
                    None
                }
            })
            .collect()
    }

    /// Drop from the front until both caps hold, keeping the newest entry always.
    ///
    /// The rewrite costs the whole file, which is why it runs only once a cap is
    /// crossed. The cap is what bounds that cost.
    fn enforce_caps(&mut self) {
        if self.entries <= self.caps.entries && self.file_len() <= self.caps.bytes {
            return;
        }

        let entries = self.entries();
        let mut kept = entries.as_slice();
        while kept.len() > 1
            && (kept.len() > self.caps.entries || encoded_len(kept) > self.caps.bytes)
        {
            kept = &kept[1..];
        }
        self.rewrite(kept);
    }

    fn rewrite(&mut self, entries: &[Entry]) {
        let mut contents = String::new();
        for entry in entries {
            match serde_json::to_string(entry) {
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
        self.entries = entries.len();
    }

    fn file_len(&self) -> u64 {
        fs::metadata(&self.path).map(|meta| meta.len()).unwrap_or(0)
    }
}

/// How many bytes `entries` take as spool lines.
fn encoded_len(entries: &[Entry]) -> u64 {
    entries
        .iter()
        .map(|entry| {
            serde_json::to_string(entry)
                .map(|line| line.len() as u64 + 1)
                .unwrap_or(0)
        })
        .sum()
}
