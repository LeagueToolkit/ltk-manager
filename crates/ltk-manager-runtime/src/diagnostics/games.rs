//! The game records: `games/<id>.json` under the data directory, one for each game that the
//! patcher followed, clean games included.
//!
//! A record is built from the patcher's events and reads no file of League. No page lists
//! the records. The support report holds the newest ones.

use std::path::PathBuf;

use chrono::{DateTime, Utc};
use fs_err as fs;
use ltk_manager_base::{
    advisory::Advisories, error::AppResult, hashing::OverlayFingerprint, utils::text,
};
use serde::{Deserialize, Serialize};

use super::{
    incident::{GameRecord, OverlayOutcome, SkippedArchive},
    record_dir::{Caps, RecordDir},
};

/// The largest size of one line of a stored game, in characters.
const MAX_LINE_CHARS: usize = 300;

/// One game as the store keeps it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredGame {
    /// The id of the game: the local time of its first sign, as `2026-11-11T19-02-04`. The
    /// log lines of the game carry it.
    pub id: String,
    /// The id of the run of the manager that followed the game.
    pub run: String,
    /// The number of the patcher session inside the run.
    pub session: u32,
    pub started_at: DateTime<Utc>,
    pub ended_at: DateTime<Utc>,
    /// Whether the session stopped while the game was running. `ended_at` is then the time
    /// of the stop.
    pub still_running: bool,
    pub overlay: OverlayOutcome,
    /// The fingerprint of the overlay that the game ran with. `None` if the overlay state
    /// could not be read.
    pub overlay_fingerprint: Option<OverlayFingerprint>,
    /// The archives that the DLL served from the overlay, each by its last path segment.
    pub redirected: Vec<String>,
    pub skipped: Vec<SkippedArchive>,
    /// The id of the incident of the game. `None` if the game reached no verdict.
    pub incident: Option<String>,
    /// The records that the DLL and the host wrote at the warn or the error level, each
    /// distinct record once, as `<time> <source> <level> <text>`. Redacted.
    pub lines: Vec<String>,
    /// The advisories that the game raised. The detail of each is redacted. A record
    /// from before advisories holds none.
    #[serde(default)]
    pub advisories: Advisories,
}

impl GameRecord {
    /// Returns the record as the game store keeps it, for a game whose incident is
    /// `incident`.
    ///
    /// The lines, the reason of each skipped archive and the detail of each advisory pass
    /// the shared redactor.
    #[must_use]
    pub fn stored(&self, incident: Option<&str>) -> StoredGame {
        let lines = self
            .problems
            .iter()
            .map(|problem| {
                let line = format!(
                    "{} {} {}",
                    problem.at.format("%H:%M:%S"),
                    problem.source,
                    problem.line
                );
                text::first_chars(&ltk_redact::redact(&line), MAX_LINE_CHARS).to_owned()
            })
            .collect();
        let skipped = self
            .skipped
            .iter()
            .map(|skipped| SkippedArchive {
                wad: skipped.wad.clone(),
                why: ltk_redact::redact(&skipped.why).into_owned(),
            })
            .collect();
        StoredGame {
            id: self.game_id(),
            run: self.session.run.clone(),
            session: self.session.session,
            started_at: self.started_at,
            ended_at: self.ended_at,
            still_running: self.still_running,
            overlay: self.overlay,
            overlay_fingerprint: self.overlay_fingerprint.clone(),
            redirected: self.redirected.clone(),
            skipped,
            incident: incident.map(str::to_owned),
            lines,
            advisories: self
                .advisories
                .with_details(|detail| ltk_redact::redact(detail).into_owned()),
        }
    }
}

/// The game record files, capped by count and by size.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GameStore {
    dir: RecordDir,
}

impl GameStore {
    /// The number of games that the store keeps.
    pub const KEEP: usize = 20;
    /// The largest size of the game files together. This cap applies if it fills first.
    pub const MAX_BYTES: u64 = 200 * 1024;

    /// Returns the store over `dir`. The directory is created on the first write.
    #[must_use]
    pub fn new(dir: PathBuf) -> Self {
        Self {
            dir: RecordDir::new(dir),
        }
    }

    /// Writes `game`, then removes the oldest games until the caps hold.
    ///
    /// # Errors
    ///
    /// Fails if the directory cannot be created or the file cannot be written.
    pub fn record(&self, game: &StoredGame) -> AppResult<()> {
        let caps = Caps {
            keep: Self::KEEP,
            max_bytes: Self::MAX_BYTES,
        };
        self.dir.record(&game.id, game, caps)
    }

    /// Returns every game, newest first. Returns no game if the directory is missing. Skips
    /// a file that cannot be read.
    ///
    /// # Errors
    ///
    /// Fails if the directory cannot be listed.
    pub fn list(&self) -> AppResult<Vec<StoredGame>> {
        let mut games: Vec<StoredGame> = Vec::new();
        for path in self.dir.files()? {
            let game = fs::read(&path)
                .map_err(serde_json::Error::io)
                .and_then(|bytes| serde_json::from_slice(&bytes));
            match game {
                Ok(game) => games.push(game),
                Err(error) => tracing::warn!(
                    "Skipping a game record that did not read, {}: {error}",
                    path.display()
                ),
            }
        }
        games.sort_by(|a, b| b.ended_at.cmp(&a.ended_at).then_with(|| b.id.cmp(&a.id)));
        Ok(games)
    }
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    use super::*;
    use crate::diagnostics::ids::SessionIds;
    use crate::diagnostics::incident::{EvidenceSource, RawEvidence};
    use crate::patcher::SessionOrigin;

    fn at(minutes: i64) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 8, 21, 21, 0, 0).unwrap() + chrono::Duration::minutes(minutes)
    }

    fn session() -> SessionIds {
        SessionIds {
            run: "4be1c07a".to_owned(),
            session: 2,
        }
    }

    /// A game that started `minutes` after the first game and ran for one minute.
    fn game(minutes: i64) -> StoredGame {
        let mut record = record(minutes);
        record.ended_at = at(minutes + 1);
        record.stored(None)
    }

    /// A record of the session `session` that opened `minutes` after the first game.
    fn record(minutes: i64) -> GameRecord {
        let mut record = GameRecord::open(at(minutes), SessionOrigin::Library);
        record.session = session();
        record
    }

    fn store() -> (tempfile::TempDir, GameStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = GameStore::new(dir.path().join("games"));
        (dir, store)
    }

    #[test]
    fn stored_holds_the_facts_of_the_record_and_the_ids() {
        let mut record = record(0);
        record.ended_at = at(30);
        record.overlay = OverlayOutcome::Live;
        let fingerprint: OverlayFingerprint =
            serde_json::from_str(r#""ab12cd34ef567890""#).unwrap();
        record.overlay_fingerprint = Some(fingerprint.clone());
        record.redirected = vec!["Ahri.wad.client".to_owned()];
        record.skipped = vec![SkippedArchive {
            wad: "Map11.wad.client".to_owned(),
            why: "read failed".to_owned(),
        }];
        record.problems = vec![RawEvidence {
            at: at(1),
            source: EvidenceSource::Dll,
            line: "WARN lazy verification failed".to_owned(),
        }];

        let game = record.stored(Some("2026-08-21T21-00-05"));

        assert_eq!(game.id, record.game_id());
        assert_eq!((game.run.as_str(), game.session), ("4be1c07a", 2));
        assert_eq!((game.started_at, game.ended_at), (at(0), at(30)));
        assert_eq!(game.overlay, OverlayOutcome::Live);
        assert_eq!(game.overlay_fingerprint, Some(fingerprint));
        assert_eq!(game.redirected, ["Ahri.wad.client"]);
        assert_eq!(game.skipped, record.skipped);
        assert_eq!(game.incident.as_deref(), Some("2026-08-21T21-00-05"));
        assert_eq!(game.lines, ["21:01:00 dll WARN lazy verification failed"]);
        assert!(!game.still_running);
    }

    #[test]
    fn stored_cuts_a_long_line() {
        let mut record = record(0);
        record.problems = vec![RawEvidence {
            at: at(1),
            source: EvidenceSource::Dll,
            line: "x".repeat(MAX_LINE_CHARS * 2),
        }];

        let game = record.stored(None);

        assert_eq!(game.lines[0].chars().count(), MAX_LINE_CHARS);
    }

    #[test]
    fn a_game_round_trips_and_the_list_is_newest_first() {
        let (_dir, store) = store();
        assert_eq!(store.list().unwrap(), []);

        for minutes in [10, 30, 20] {
            store.record(&game(minutes)).unwrap();
        }

        assert_eq!(store.list().unwrap(), [game(30), game(20), game(10)]);
    }

    #[test]
    fn the_count_cap_removes_the_oldest_games() {
        let (_dir, store) = store();
        for minutes in 0..(GameStore::KEEP as i64 + 3) {
            store.record(&game(minutes * 2)).unwrap();
        }

        let games = store.list().unwrap();

        assert_eq!(games.len(), GameStore::KEEP);
        assert_eq!(games.last(), Some(&game(6)));
    }

    #[test]
    fn the_size_cap_removes_the_oldest_games() {
        let (_dir, store) = store();
        let large = |minutes: i64| {
            let mut game = game(minutes);
            game.redirected = vec!["a".repeat(1024); 60];
            game
        };
        for minutes in 0..5 {
            store.record(&large(minutes * 2)).unwrap();
        }

        let games = store.list().unwrap();

        assert_eq!(games, [large(8), large(6), large(4)]);
    }

    #[test]
    fn list_skips_a_file_that_is_not_a_game() {
        let (dir, store) = store();
        store.record(&game(0)).unwrap();
        fs::write(dir.path().join("games").join("bad.json"), "{ not json").unwrap();

        assert_eq!(store.list().unwrap(), [game(0)]);
    }
}
