//! The last row of a mod trace: what the last game did with the mod.
//!
//! The row reads the newest game record. It also reads the start of the newest game that
//! League made a log directory for, because a game that no patcher session followed has no
//! game record.

use chrono::{DateTime, Utc};
use ltk_manager_base::advisory::AdvisoryCode;
use ltk_manager_library::overlay::BuildRecord;
use ltk_manager_runtime::diagnostics::{games::StoredGame, incident::OverlayOutcome};
use serde::Serialize;

use super::RowState;

#[cfg(test)]
mod tests;

/// What the last game did with the mod.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(
    tag = "reading",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum GameReading {
    /// No game ran with the overlay of the last build.
    NoGame,
    /// League ran a game after the last build while the manager ran, and no patcher
    /// session followed the game.
    PatcherNotRunning,
    /// League ran a game after the last build, before this run of the manager started.
    Unwatched,
    /// The overlay was not live in the game.
    OverlayNotLive {
        outcome: OverlayOutcome,
        /// The code that the patcher gave a refusal, such as `VRF00000008`.
        patcher_code: Option<String>,
    },
    /// The patcher could not open `archives` of the mod.
    ArchivesNotServed { archives: Vec<String> },
    /// The overlay was live, and League opened no archive of the mod. `champions` holds
    /// the champions that the mod is for.
    ArchivesNotLoaded { champions: Vec<String> },
    /// The overlay was live, and League opened `loaded` of the `total` archives of the mod.
    Loaded { loaded: u32, total: u32 },
    /// The overlay was live, and the manager holds no archive report of the mod.
    OverlayLive,
}

impl GameReading {
    /// Returns how a row with this reading ended.
    #[must_use]
    pub fn state(&self) -> RowState {
        match self {
            Self::NoGame => RowState::Unknown,
            Self::PatcherNotRunning
            | Self::Unwatched
            | Self::OverlayNotLive { .. }
            | Self::ArchivesNotServed { .. } => RowState::Fail,
            Self::ArchivesNotLoaded { .. } => RowState::Warn,
            Self::Loaded { .. } | Self::OverlayLive => RowState::Pass,
        }
    }
}

/// The newest game that a patcher session followed, for the last line of the panel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct LastGame {
    pub started_at: DateTime<Utc>,
    pub ended_at: DateTime<Utc>,
    /// Whether the session stopped while the game was running.
    pub still_running: bool,
}

impl From<&StoredGame> for LastGame {
    fn from(game: &StoredGame) -> Self {
        Self {
            started_at: game.started_at,
            ended_at: game.ended_at,
            still_running: game.still_running,
        }
    }
}

/// What the last row reads.
pub(super) struct GameEvidence<'a> {
    pub build: &'a BuildRecord,
    /// The newest game that a patcher session followed.
    pub game: Option<&'a StoredGame>,
    /// The archives that the mod patches, each by its last path segment. `None` if the
    /// mod has no archive report.
    pub archives: Option<&'a [String]>,
    /// The champions that the mod is for.
    pub champions: &'a [String],
    /// The start of the newest game that League made a log directory for. `None` if the
    /// directory was not read, or if a patcher session follows a game now.
    pub newest_logged_game: Option<DateTime<Utc>>,
    /// The start of this run of the manager.
    pub run_started_at: Option<DateTime<Utc>>,
}

impl GameEvidence<'_> {
    /// Returns what the last game did with the mod.
    ///
    /// A game that no session followed is read first, because it is newer than every game
    /// record. Then the newest game record is read, if that game ran the overlay of the
    /// build.
    pub fn reading(&self) -> GameReading {
        if let Some(start) = self.unfollowed_game() {
            let in_this_run = self.run_started_at.is_some_and(|run| start >= run);
            return if in_this_run {
                GameReading::PatcherNotRunning
            } else {
                GameReading::Unwatched
            };
        }
        let Some(game) = self.game.filter(|game| self.ran_the_build(game)) else {
            return GameReading::NoGame;
        };
        if game.overlay != OverlayOutcome::Live {
            return GameReading::OverlayNotLive {
                outcome: game.overlay,
                patcher_code: game
                    .advisories
                    .iter()
                    .find(|advisory| advisory.code == AdvisoryCode::OverlayRefused)
                    .and_then(|advisory| advisory.patcher_code.clone()),
            };
        }
        let Some(archives) = self.archives else {
            return GameReading::OverlayLive;
        };

        let not_served: Vec<String> = archives
            .iter()
            .filter(|archive| {
                game.skipped
                    .iter()
                    .any(|skipped| skipped.wad.eq_ignore_ascii_case(archive))
            })
            .cloned()
            .collect();
        if !not_served.is_empty() {
            return GameReading::ArchivesNotServed {
                archives: not_served,
            };
        }
        let loaded = archives
            .iter()
            .filter(|archive| {
                game.redirected
                    .iter()
                    .any(|served| served.eq_ignore_ascii_case(archive))
            })
            .count();
        if loaded == 0 {
            return GameReading::ArchivesNotLoaded {
                champions: self.champions.to_vec(),
            };
        }
        GameReading::Loaded {
            loaded: u32::try_from(loaded).unwrap_or(u32::MAX),
            total: u32::try_from(archives.len()).unwrap_or(u32::MAX),
        }
    }

    /// Returns the start of a game that League ran after the build and that no patcher
    /// session followed.
    fn unfollowed_game(&self) -> Option<DateTime<Utc>> {
        let followed_until = self.game.map(|game| game.ended_at);
        self.newest_logged_game.filter(|start| {
            *start > self.build.built_at && followed_until.is_none_or(|end| *start > end)
        })
    }

    /// Returns whether `game` ran with the overlay of the build.
    ///
    /// Compares the fingerprints. Compares the times if either record holds no
    /// fingerprint.
    fn ran_the_build(&self, game: &StoredGame) -> bool {
        match (&self.build.fingerprint, &game.overlay_fingerprint) {
            (Some(built), Some(ran)) => built == ran,
            _ => game.started_at >= self.build.built_at,
        }
    }
}
