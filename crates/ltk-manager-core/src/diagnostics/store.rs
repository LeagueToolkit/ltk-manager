//! Where incidents live: `incidents/<id>.json` under the app data directory.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::Deserialize;

use super::incident::Incident;
use crate::error::{AppError, AppResult};

/// The incident files, capped by count and by size.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IncidentStore {
    dir: PathBuf,
    keep: usize,
}

impl IncidentStore {
    /// How many incidents the store keeps unless told otherwise.
    pub const DEFAULT_KEEP: usize = 50;
    /// The store's size cap, which wins over the count when it fills first.
    pub const MAX_BYTES: u64 = 1024 * 1024;

    /// A store over `dir`, created on the first write.
    pub fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            keep: Self::DEFAULT_KEEP,
        }
    }

    /// Keep `keep` incidents instead of [`Self::DEFAULT_KEEP`].
    pub fn with_keep(mut self, keep: usize) -> Self {
        self.keep = keep;
        self
    }

    /// The directory the files live in.
    pub fn dir(&self) -> &PathBuf {
        &self.dir
    }

    /// How many incidents the store keeps.
    pub fn keep(&self) -> usize {
        self.keep
    }

    /// Writes `incident`, then drops the oldest past the caps. A dismissed
    /// incident goes before an undismissed one of the same age.
    ///
    /// # Errors
    ///
    /// The directory could not be created, or the file could not be written.
    pub fn record(&self, incident: &Incident) -> AppResult<()> {
        fs::create_dir_all(&self.dir)?;
        self.write(incident)?;
        self.prune(&incident.id)
    }

    /// Every incident, newest first. A missing directory is an empty list.
    ///
    /// # Errors
    ///
    /// The directory could not be listed.
    pub fn list(&self) -> AppResult<Vec<Incident>> {
        let mut incidents = Vec::new();
        for path in self.files()? {
            match Self::read(&path) {
                Ok(incident) => incidents.push(incident),
                Err(error) => tracing::warn!(
                    "Skipping an incident that did not read, {}: {error}",
                    path.display()
                ),
            }
        }
        incidents.sort_by(|a, b| {
            ended_at_of(&b.ended_at)
                .cmp(&ended_at_of(&a.ended_at))
                .then_with(|| b.id.cmp(&a.id))
        });
        Ok(incidents)
    }

    /// One incident by id.
    ///
    /// # Errors
    ///
    /// The file exists and could not be read or parsed.
    pub fn get(&self, id: &str) -> AppResult<Option<Incident>> {
        let path = self.path_of(id)?;
        match fs::read(&path) {
            Ok(bytes) => {
                let mut incident: Incident = serde_json::from_slice(&bytes)?;
                incident.backfill_scan_status();
                Ok(Some(incident))
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    /// Marks an incident dismissed. Unknown ids are not an error.
    ///
    /// # Errors
    ///
    /// The file could not be rewritten.
    pub fn dismiss(&self, id: &str) -> AppResult<()> {
        let Some(mut incident) = self.get(id)? else {
            return Ok(());
        };
        if !incident.dismissed {
            incident.dismissed = true;
            self.write(&incident)?;
        }
        Ok(())
    }

    /// The file for `id`. An id names one file and nothing above the directory.
    fn path_of(&self, id: &str) -> AppResult<PathBuf> {
        if id.is_empty() || id.contains(['/', '\\']) || id == "." || id == ".." {
            return Err(AppError::InvalidPath(format!("Not an incident id: {id:?}")));
        }
        Ok(self.dir.join(format!("{id}.json")))
    }

    fn write(&self, incident: &Incident) -> AppResult<()> {
        let path = self.path_of(&incident.id)?;
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_vec_pretty(incident)?)?;
        fs::rename(&tmp, &path)?;
        Ok(())
    }

    fn read(path: &Path) -> AppResult<Incident> {
        let mut incident: Incident = serde_json::from_slice(&fs::read(path)?)?;
        incident.backfill_scan_status();
        Ok(incident)
    }

    fn files(&self) -> AppResult<Vec<PathBuf>> {
        let entries = match fs::read_dir(&self.dir) {
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

    /// Evicts until both caps hold. The order is dismissed first, then oldest
    /// first, and the file just written is never a candidate.
    fn prune(&self, just_written: &str) -> AppResult<()> {
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
            if count <= self.keep && bytes <= Self::MAX_BYTES {
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
                    tracing::warn!("Could not evict incident {}: {error}", entry.path.display())
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

/// The list order's key. A stamp that does not parse sorts oldest.
fn ended_at_of(text: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(text)
        .map(|at| at.with_timezone(&Utc))
        .unwrap_or(DateTime::<Utc>::MIN_UTC)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics::incident::{ScanStatus, fixtures};

    fn store(keep: usize) -> (tempfile::TempDir, IncidentStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = IncidentStore::new(dir.path().join("incidents")).with_keep(keep);
        (dir, store)
    }

    fn ids(store: &IncidentStore) -> Vec<String> {
        store
            .list()
            .unwrap()
            .into_iter()
            .map(|incident| incident.id)
            .collect()
    }

    #[test]
    fn an_incident_round_trips() {
        let (_dir, store) = store(50);
        let incident = fixtures::incident("a", "2026-08-21T21:14:02+00:00");
        store.record(&incident).unwrap();
        assert_eq!(store.get("a").unwrap(), Some(incident));
    }

    #[test]
    fn the_list_is_newest_first() {
        let (_dir, store) = store(50);
        store
            .record(&fixtures::incident("old", "2026-08-20T10:00:00+00:00"))
            .unwrap();
        store
            .record(&fixtures::incident("new", "2026-08-21T10:00:00+00:00"))
            .unwrap();
        store
            .record(&fixtures::incident("mid", "2026-08-20T20:00:00+00:00"))
            .unwrap();
        assert_eq!(ids(&store), ["new", "mid", "old"]);
    }

    #[test]
    fn the_count_cap_evicts_the_oldest() {
        let (_dir, store) = store(2);
        store
            .record(&fixtures::incident("old", "2026-08-20T10:00:00+00:00"))
            .unwrap();
        store
            .record(&fixtures::incident("mid", "2026-08-20T20:00:00+00:00"))
            .unwrap();
        store
            .record(&fixtures::incident("new", "2026-08-21T10:00:00+00:00"))
            .unwrap();
        assert_eq!(ids(&store), ["new", "mid"]);
    }

    #[test]
    fn a_dismissed_incident_goes_before_an_undismissed_one_of_the_same_age() {
        let (_dir, store) = store(2);
        store
            .record(&fixtures::incident("read", "2026-08-20T10:00:00+00:00"))
            .unwrap();
        store
            .record(&fixtures::incident("unread", "2026-08-20T10:00:00+00:00"))
            .unwrap();
        store.dismiss("read").unwrap();
        store
            .record(&fixtures::incident("new", "2026-08-21T10:00:00+00:00"))
            .unwrap();
        assert_eq!(ids(&store), ["new", "unread"]);
    }

    #[test]
    fn a_dismissed_incident_goes_before_an_older_unread_one() {
        let (_dir, store) = store(2);
        store
            .record(&fixtures::incident(
                "older-unread",
                "2026-08-19T10:00:00+00:00",
            ))
            .unwrap();
        store
            .record(&fixtures::incident(
                "newer-read",
                "2026-08-20T10:00:00+00:00",
            ))
            .unwrap();
        store.dismiss("newer-read").unwrap();
        store
            .record(&fixtures::incident("new", "2026-08-21T10:00:00+00:00"))
            .unwrap();
        assert_eq!(ids(&store), ["new", "older-unread"]);
    }

    #[test]
    fn the_size_cap_evicts_the_oldest() {
        let (_dir, store) = store(50);
        let third_of_a_megabyte = "x".repeat(360 * 1024);
        for (id, ended_at) in [
            ("a", "2026-08-20T10:00:00+00:00"),
            ("b", "2026-08-20T11:00:00+00:00"),
            ("c", "2026-08-20T12:00:00+00:00"),
        ] {
            let mut incident = fixtures::incident(id, ended_at);
            incident.verdict.cause = third_of_a_megabyte.clone();
            store.record(&incident).unwrap();
        }
        assert_eq!(ids(&store), ["c", "b"]);
    }

    #[test]
    fn the_one_just_written_is_never_evicted() {
        let (_dir, store) = store(0);
        store
            .record(&fixtures::incident("only", "2026-08-21T10:00:00+00:00"))
            .unwrap();
        assert_eq!(ids(&store), ["only"]);
    }

    /// A file written before `scanStatus` existed still names the status in
    /// the DLL's own rejection line, so a history keeps working after an
    /// upgrade instead of only the games played since.
    #[test]
    fn a_stored_incident_recovers_the_scan_status_it_predates() {
        let (_dir, store) = store(50);
        let mut incident = fixtures::incident("old", "2026-08-21T10:00:00+00:00");
        incident.scan_status = None;
        incident.evidence[0].line = "scan rejected graves.wad.client, status c0000229".to_string();
        store.record(&incident).unwrap();

        let mut stored = serde_json::from_slice::<serde_json::Value>(
            &fs::read(store.dir().join("old.json")).unwrap(),
        )
        .unwrap();
        stored.as_object_mut().unwrap().remove("scanStatus");
        fs::write(
            store.dir().join("old.json"),
            serde_json::to_vec(&stored).unwrap(),
        )
        .unwrap();

        let read = store.get("old").unwrap().unwrap();
        assert_eq!(read.scan_status, Some(ScanStatus::Skinhack));
        assert_eq!(
            store.list().unwrap()[0].scan_status,
            Some(ScanStatus::Skinhack)
        );
    }

    /// Two archives rejected for different reasons cannot say which one the
    /// verdict is about, so the recovery declines rather than guessing.
    #[test]
    fn a_recovery_declines_when_the_rejections_disagree() {
        let mut incident = fixtures::incident("mixed", "2026-08-21T10:00:00+00:00");
        incident.scan_status = None;
        incident.evidence[0].line = "scan rejected graves.wad.client, status c0000229".to_string();
        incident.evidence[1].line = "scan rejected ahri.wad.client, status c000003e".to_string();

        incident.backfill_scan_status();

        assert_eq!(incident.scan_status, None);
    }

    #[test]
    fn a_corrupt_file_does_not_hide_the_rest() {
        let (_dir, store) = store(50);
        store
            .record(&fixtures::incident("good", "2026-08-21T10:00:00+00:00"))
            .unwrap();
        fs::write(store.dir().join("bad.json"), "{ not json").unwrap();
        assert_eq!(ids(&store), ["good"]);
    }

    #[test]
    fn dismiss_flips_the_flag_and_keeps_the_rest() {
        let (_dir, store) = store(50);
        let incident = fixtures::incident("a", "2026-08-21T10:00:00+00:00");
        store.record(&incident).unwrap();
        store.dismiss("a").unwrap();
        let stored = store.get("a").unwrap().unwrap();
        assert!(stored.dismissed);
        assert_eq!(stored.verdict, incident.verdict);
        store.dismiss("missing").unwrap();
    }

    #[test]
    fn a_missing_directory_lists_empty() {
        let (_dir, store) = store(50);
        assert!(store.list().unwrap().is_empty());
        assert_eq!(store.get("a").unwrap(), None);
    }

    #[test]
    fn an_id_that_leaves_the_directory_is_refused() {
        let (_dir, store) = store(50);
        assert!(store.get("../a").is_err());
        assert!(store.dismiss("..").is_err());
    }
}
