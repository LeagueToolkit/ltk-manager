//! A directory of `<id>.json` records under two caps: a number of records and a number of
//! bytes. The incident store and the game store keep their files in one each.

use std::{io, path::PathBuf};

use chrono::{DateTime, Utc};
use fs_err as fs;
use ltk_manager_base::{
    error::{AppError, AppResult},
    utils::fs::write_json,
};
use serde::{Deserialize, Serialize};

/// The caps of a [`RecordDir`]. The cap on the bytes applies if it fills first.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Caps {
    /// The largest number of records.
    pub keep: usize,
    /// The largest size of the record files together.
    pub max_bytes: u64,
}

/// A directory that holds one `<id>.json` file for each record. The directory is created
/// on the first write.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RecordDir(PathBuf);

impl RecordDir {
    pub fn new(dir: PathBuf) -> Self {
        Self(dir)
    }

    /// Returns the path of the directory.
    pub fn path(&self) -> &PathBuf {
        &self.0
    }

    /// Returns the file of the record `id`.
    ///
    /// # Errors
    ///
    /// Fails if `id` is not one path component, so an id names no file outside the
    /// directory.
    pub fn path_of(&self, id: &str) -> AppResult<PathBuf> {
        if id.is_empty() || id.contains(['/', '\\']) || id == "." || id == ".." {
            return Err(AppError::InvalidPath(format!("Not a record id: {id:?}")));
        }
        Ok(self.0.join(format!("{id}.json")))
    }

    /// Returns the path of each record file. Returns no path if the directory is missing.
    ///
    /// # Errors
    ///
    /// Returns the error of the directory read.
    pub fn files(&self) -> AppResult<Vec<PathBuf>> {
        let entries = match fs::read_dir(&self.0) {
            Ok(entries) => entries,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error.into()),
        };
        let mut files = Vec::new();
        for entry in entries {
            let path = entry?.path();
            if path.extension().is_some_and(|ext| ext == "json") {
                files.push(path);
            }
        }
        Ok(files)
    }

    /// Writes `record` as the file of `id`, then removes records until `caps` hold.
    ///
    /// A dismissed record is removed before an undismissed one, and an older record before
    /// a newer one. The record `id` is never removed.
    ///
    /// # Errors
    ///
    /// Fails if the directory cannot be created or the file cannot be written.
    pub fn record(&self, id: &str, record: &impl Serialize, caps: Caps) -> AppResult<()> {
        fs::create_dir_all(&self.0)?;
        self.write(id, record)?;
        self.prune(caps, id)
    }

    /// Writes `record` as the file of `id`.
    ///
    /// # Errors
    ///
    /// Fails if `id` is not a record id or the file cannot be written.
    pub fn write(&self, id: &str, record: &impl Serialize) -> AppResult<()> {
        write_json(&self.path_of(id)?, record)
    }

    fn prune(&self, caps: Caps, just_written: &str) -> AppResult<()> {
        let mut entries: Vec<Stored> = self.files()?.into_iter().filter_map(Stored::read).collect();
        let mut count = entries.len();
        let mut bytes: u64 = entries.iter().map(|entry| entry.bytes).sum();
        entries.sort_by(|a, b| {
            b.dismissed
                .cmp(&a.dismissed)
                .then_with(|| a.ended_at.cmp(&b.ended_at))
                .then_with(|| a.id.cmp(&b.id))
        });
        for entry in entries {
            if count <= caps.keep && bytes <= caps.max_bytes {
                break;
            }
            if entry.id == just_written {
                continue;
            }
            match fs::remove_file(&entry.path) {
                Ok(()) => {
                    count -= 1;
                    bytes -= entry.bytes;
                }
                Err(error) => {
                    tracing::warn!("Could not evict record {}: {error}", entry.path.display())
                }
            }
        }
        Ok(())
    }
}

/// The fields the eviction order reads, without the rest of the record.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Head {
    ended_at: String,
    #[serde(default)]
    dismissed: bool,
}

/// One file on disk, as the eviction order sees it.
#[derive(Debug)]
struct Stored {
    path: PathBuf,
    id: String,
    ended_at: DateTime<Utc>,
    dismissed: bool,
    bytes: u64,
}

impl Stored {
    /// A file that does not parse has nothing to lose, so it reads as
    /// dismissed and goes first.
    fn read(path: PathBuf) -> Option<Self> {
        let meta = fs::metadata(&path).ok()?;
        let id = path.file_stem()?.to_str()?.to_string();
        let modified = meta
            .modified()
            .ok()
            .map(DateTime::<Utc>::from)
            .unwrap_or(DateTime::<Utc>::MIN_UTC);
        let head: Option<Head> = fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok());
        let (ended_at, dismissed) = match head {
            Some(head) => (
                DateTime::parse_from_rfc3339(&head.ended_at)
                    .map(|at| at.with_timezone(&Utc))
                    .unwrap_or(modified),
                head.dismissed,
            ),
            None => (modified, true),
        };
        Some(Self {
            path,
            id,
            ended_at,
            dismissed,
            bytes: meta.len(),
        })
    }
}
