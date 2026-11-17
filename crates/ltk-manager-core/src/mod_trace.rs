//! The mod trace: why one mod did or did not reach the last game.
//!
//! The trace reads the library index, the mod health verdict, the record of the last overlay
//! build, the archive report of the mod and the newest game record. It lists one row for
//! each source, top to bottom, and ends at the first row that fails. A row holds a code and
//! typed fields, and the frontend catalog words it (ADR-0017).

use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use ltk_manager_base::{
    advisory::{AdvisoryCode, AdvisorySubject},
    config::Config,
    error::{AppError, AppResult},
};
use ltk_manager_library::{
    mods::{ModHealth, ModLibrary, ModWadReport},
    overlay::{BuildRecord, WorkshopTestProject},
};
use ltk_manager_runtime::diagnostics::{
    game_log::LeagueLogs,
    games::{GameStore, StoredGame},
    incident::OverlayOutcome,
};
use serde::{Deserialize, Serialize};

#[cfg(test)]
mod tests;

/// How one row of a trace ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "kebab-case")]
pub enum RowState {
    /// The row holds nothing that keeps the mod out of the game.
    Pass,
    /// The row holds a condition that can keep the mod out of the game. The trace goes on.
    Warn,
    /// The mod did not get past the row. The trace ends here.
    Fail,
    /// The manager holds no answer for the row.
    Unknown,
}

/// What one row of a trace found.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum TraceFact {
    /// The mod is enabled in the active profile.
    Enabled { profile: String },
    /// The mod is not enabled in the active profile.
    NotEnabled { profile: String },
    /// The verdict of the last health check of the mod.
    Health {
        health: ModHealth,
        /// ISO-8601.
        checked_at: String,
    },
    /// The mod has no health verdict.
    HealthUnchecked,
    /// The last build applied the mod.
    OverlayBuilt { built_at: DateTime<Utc> },
    /// The last build applied the mod, and the mod or the game changed after it.
    OverlayStale { built_at: DateTime<Utc> },
    /// No build is on record.
    OverlayNotBuilt,
    /// The last build left the mod out and raised `advisory`.
    OverlayLeftOut { advisory: AdvisoryCode },
    /// The last build did not get the mod. The mod was enabled, or the project was put
    /// under test, after the build.
    OverlayWithoutMod { built_at: DateTime<Utc> },
    /// The game archives that the mod patches, each by its last path segment.
    Archives { archives: Vec<String> },
    /// The mod patches no game archive.
    NoArchives,
    /// The last build raised `code` about the mod and applied the mod.
    Advisory { code: AdvisoryCode },
    /// No game ran with the overlay of the last build.
    GameNone,
    /// League ran a game after the last build while the manager ran, and no patcher
    /// session followed the game.
    GamePatcherNotRunning,
    /// League ran a game after the last build, before this run of the manager started.
    GameUnwatched,
    /// The overlay was not live in the last game.
    GameOverlayNotLive {
        outcome: OverlayOutcome,
        /// The code that the patcher gave a refusal, such as `VRF00000008`.
        patcher_code: Option<String>,
    },
    /// The patcher could not open `archives` of the mod in the last game.
    GameArchivesNotServed { archives: Vec<String> },
    /// The overlay was live, and League opened no archive of the mod. `champions` holds
    /// the champions that the mod is for.
    GameArchivesNotLoaded { champions: Vec<String> },
    /// The overlay was live, and League opened `loaded` of the `total` archives of the mod.
    GameLoaded { loaded: u32, total: u32 },
    /// The overlay was live, and the manager holds no archive report of the mod.
    GameOverlayLive,
}

impl TraceFact {
    /// Returns how a row with this fact ended.
    #[must_use]
    pub fn state(&self) -> RowState {
        match self {
            Self::Enabled { .. }
            | Self::OverlayBuilt { .. }
            | Self::Archives { .. }
            | Self::GameLoaded { .. }
            | Self::GameOverlayLive => RowState::Pass,
            Self::Health { health, .. } => match health {
                ModHealth::Healthy => RowState::Pass,
                ModHealth::Repairable | ModHealth::Unrepairable => RowState::Warn,
            },
            Self::OverlayStale { .. }
            | Self::Advisory { .. }
            | Self::GameArchivesNotLoaded { .. } => RowState::Warn,
            Self::NotEnabled { .. }
            | Self::OverlayNotBuilt
            | Self::OverlayLeftOut { .. }
            | Self::OverlayWithoutMod { .. }
            | Self::NoArchives
            | Self::GamePatcherNotRunning
            | Self::GameUnwatched
            | Self::GameOverlayNotLive { .. }
            | Self::GameArchivesNotServed { .. } => RowState::Fail,
            Self::HealthUnchecked | Self::GameNone => RowState::Unknown,
        }
    }

    /// Returns what the record of `build` holds about `traced`.
    fn of_overlay(
        build: Option<&BuildRecord>,
        traced: &Traced,
        report: Option<&ModWadReport>,
    ) -> Self {
        let Some(build) = build else {
            return Self::OverlayNotBuilt;
        };
        let left_out = build.advisories.iter().find(|advisory| {
            traced.is_subject_of(advisory.subject.as_ref()) && advisory.code.leaves_mod_out()
        });
        if let Some(advisory) = left_out {
            return Self::OverlayLeftOut {
                advisory: advisory.code,
            };
        }
        let built_at = build.built_at;
        if !build.mods.contains(&traced.id) {
            Self::OverlayWithoutMod { built_at }
        } else if report.is_some_and(|report| report.is_stale) {
            Self::OverlayStale { built_at }
        } else {
            Self::OverlayBuilt { built_at }
        }
    }

    /// Returns what the last game of `evidence` did with the mod.
    fn of_last_game(evidence: &GameEvidence<'_>) -> Self {
        if let Some(start) = evidence.unfollowed_game() {
            let in_this_run = evidence.run_started_at.is_some_and(|run| start >= run);
            return if in_this_run {
                Self::GamePatcherNotRunning
            } else {
                Self::GameUnwatched
            };
        }
        let Some(game) = evidence.game.filter(|game| evidence.ran_the_build(game)) else {
            return Self::GameNone;
        };
        if game.overlay != OverlayOutcome::Live {
            let patcher_code = game
                .advisories
                .iter()
                .find(|advisory| advisory.code == AdvisoryCode::OverlayRefused)
                .and_then(|advisory| advisory.patcher_code.clone());
            return Self::GameOverlayNotLive {
                outcome: game.overlay,
                patcher_code,
            };
        }
        let Some(archives) = evidence.archives else {
            return Self::GameOverlayLive;
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
            return Self::GameArchivesNotServed {
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
            return Self::GameArchivesNotLoaded {
                champions: evidence.champions.to_vec(),
            };
        }
        Self::GameLoaded {
            loaded: u32::try_from(loaded).unwrap_or(u32::MAX),
            total: u32::try_from(archives.len()).unwrap_or(u32::MAX),
        }
    }
}

/// One row of a trace.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct TraceRow {
    pub state: RowState,
    pub fact: TraceFact,
}

/// The newest game that a patcher session followed, for the last line of the panel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct TracedGame {
    pub started_at: DateTime<Utc>,
    pub ended_at: DateTime<Utc>,
    /// Whether the session stopped while the game was running.
    pub still_running: bool,
}

/// Why one mod, or one workshop project under test, did or did not reach the last game.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ModTrace {
    /// The rows, top to bottom. The last row is the first one that failed, if any failed.
    pub rows: Vec<TraceRow>,
    /// `None` if no game is on record.
    pub last_game: Option<TracedGame>,
}

impl ModTrace {
    /// Adds a row for `fact`, unless a row before it failed.
    fn push(&mut self, fact: TraceFact) {
        if self.failed() {
            return;
        }
        self.rows.push(TraceRow {
            state: fact.state(),
            fact,
        });
    }

    /// Returns whether the last row failed, which ends the trace.
    fn failed(&self) -> bool {
        self.rows
            .last()
            .is_some_and(|row| row.state == RowState::Fail)
    }
}

/// The mod or the project that a trace is about, as the build names it.
struct Traced {
    /// The id of the mod in the record of a build.
    id: String,
    subject: AdvisorySubject,
}

impl Traced {
    /// Returns whether an advisory with `subject` is about the traced mod.
    fn is_subject_of(&self, subject: Option<&AdvisorySubject>) -> bool {
        subject == Some(&self.subject)
    }
}

/// What the last row of a trace reads.
struct GameEvidence<'a> {
    build: &'a BuildRecord,
    /// The newest game that a patcher session followed.
    game: Option<&'a StoredGame>,
    /// The archives that the mod patches, each by its last path segment. `None` if the
    /// mod has no archive report.
    archives: Option<&'a [String]>,
    /// The champions that the mod is for.
    champions: &'a [String],
    /// The start of the newest game that League made a log directory for. `None` if the
    /// directory was not read, or if a patcher session follows a game now.
    newest_logged_game: Option<DateTime<Utc>>,
    run_started_at: Option<DateTime<Utc>>,
}

impl GameEvidence<'_> {
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

/// The library mod or the workshop project that a trace is about.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TraceSubject {
    /// A mod of the library, by its id.
    Mod { id: String },
    /// A workshop project, by its directory.
    Project { path: PathBuf },
}

/// The stores that a trace reads.
#[derive(Clone, Copy)]
pub struct TraceSources<'a> {
    pub library: &'a ModLibrary,
    pub config: &'a Config,
    pub games: &'a GameStore,
    /// The start of this run of the manager.
    pub run_started_at: Option<DateTime<Utc>>,
    /// Whether a patcher session follows a game now.
    pub game_open: bool,
}

impl TraceSources<'_> {
    /// Returns the trace of `subject`.
    ///
    /// # Errors
    ///
    /// Fails if the index or the game store cannot be read, or if the library holds no
    /// mod with the id of a mod subject.
    pub fn trace(&self, subject: &TraceSubject) -> AppResult<ModTrace> {
        match subject {
            TraceSubject::Mod { id } => self.trace_mod(id),
            TraceSubject::Project { path } => self.trace_project(path),
        }
    }

    /// Returns the trace of the library mod `mod_id`: whether it is enabled, its health,
    /// the last build, its archives, the advisories about it and the last game.
    fn trace_mod(&self, mod_id: &str) -> AppResult<ModTrace> {
        let installed = self
            .library
            .get_installed_mods(self.config)?
            .into_iter()
            .find(|installed| installed.id == mod_id)
            .ok_or_else(|| AppError::ModNotFound(mod_id.to_owned()))?;
        let profile = self.library.get_active_profile_info(self.config)?.name;

        let mut trace = ModTrace::default();
        trace.push(if installed.enabled {
            TraceFact::Enabled { profile }
        } else {
            TraceFact::NotEnabled { profile }
        });
        let verdict = self
            .library
            .mod_health_verdicts(self.config)?
            .remove(mod_id);
        trace.push(match verdict {
            Some(verdict) => TraceFact::Health {
                health: verdict.health,
                checked_at: verdict.checked_at,
            },
            None => TraceFact::HealthUnchecked,
        });

        let traced = Traced {
            id: mod_id.to_owned(),
            subject: AdvisorySubject::mod_id(mod_id),
        };
        self.finish(trace, &traced)
    }

    /// Returns the trace of the workshop project at `path`: the last build, its archives,
    /// the advisories about it and the last game.
    fn trace_project(&self, path: &Path) -> AppResult<ModTrace> {
        let traced = Traced {
            id: WorkshopTestProject::all_layers(path).overlay_id(),
            subject: AdvisorySubject::Project {
                path: path.to_string_lossy().into_owned(),
            },
        };
        self.finish(ModTrace::default(), &traced)
    }

    /// Adds the rows that a mod and a project share: the last build, the archives, the
    /// advisories and the last game.
    fn finish(&self, mut trace: ModTrace, traced: &Traced) -> AppResult<ModTrace> {
        let games = self.games.list()?;
        let newest = games.first();
        trace.last_game = newest.map(|game| TracedGame {
            started_at: game.started_at,
            ended_at: game.ended_at,
            still_running: game.still_running,
        });

        let build = self.library.last_build(self.config);
        let report = self.library.wad_reports().0.lock().get(&traced.id);
        trace.push(TraceFact::of_overlay(
            build.as_ref(),
            traced,
            report.as_ref(),
        ));
        let Some(build) = build.filter(|_| !trace.failed()) else {
            return Ok(trace);
        };

        let archives: Option<Vec<String>> = report.as_ref().map(|report| {
            report
                .affected_wads
                .iter()
                .map(|path| {
                    let name = path.rsplit(['/', '\\']).next().unwrap_or(path);
                    name.to_owned()
                })
                .collect()
        });
        match &archives {
            Some(archives) if archives.is_empty() => trace.push(TraceFact::NoArchives),
            Some(archives) => trace.push(TraceFact::Archives {
                archives: archives.clone(),
            }),
            None => {}
        }
        for advisory in &build.advisories {
            if traced.is_subject_of(advisory.subject.as_ref()) {
                trace.push(TraceFact::Advisory {
                    code: advisory.code,
                });
            }
        }

        let champions = report
            .as_ref()
            .map(|report| report.derived.champions.as_slice())
            .unwrap_or_default();
        trace.push(TraceFact::of_last_game(&GameEvidence {
            build: &build,
            game: newest,
            archives: archives.as_deref(),
            champions,
            newest_logged_game: self.newest_logged_game(),
            run_started_at: self.run_started_at,
        }));
        Ok(trace)
    }

    /// Returns the start of the newest game that League made a log directory for.
    ///
    /// Returns `None` without a read if `Read League's game log` is off, if no League
    /// path is set, or if a patcher session follows a game now.
    fn newest_logged_game(&self) -> Option<DateTime<Utc>> {
        if !self.config.read_game_log || self.game_open {
            return None;
        }
        let league_path = self.config.league_path.as_deref()?;
        let start = LeagueLogs::new(league_path).newest_game_start()?;
        Some(start.with_timezone(&Utc))
    }
}
