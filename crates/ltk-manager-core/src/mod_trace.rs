//! The mod trace: why one mod did or did not reach the last game.
//!
//! [`ModTracer::trace`] reads one source after another and adds a row for each: the library
//! index, the mod health verdict, the record of the last overlay build, the archive report
//! of the mod, the advisories of the build and the newest game record. The trace ends at the
//! first row that fails.
//!
//! - `row` holds the row, its state and the reading of each source.
//! - `overlay` reads the record of the last build.
//! - `last_game` reads the newest game record and the game log directory.
//!
//! A reading is a code with typed fields, and the frontend catalog words it (ADR-0017).

use std::{
    borrow::Cow,
    path::{Path, PathBuf},
};

use chrono::{DateTime, Utc};
use ltk_manager_base::{
    advisory::{Advisory, AdvisorySubject},
    config::Config,
    error::{AppError, AppResult},
};
use ltk_manager_library::{
    mods::{ModLibrary, ModWadReport},
    overlay::WorkshopTestProject,
};
use ltk_manager_runtime::diagnostics::{game_log::LeagueLogs, games::GameStore};
use serde::{Deserialize, Serialize};

use self::last_game::GameEvidence;
pub use self::{
    last_game::{GameReading, LastGame},
    overlay::OverlayReading,
    row::{HealthCheck, RowReading, RowState, TraceRow},
};

mod last_game;
mod overlay;
mod row;
#[cfg(test)]
mod tests;

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

impl TraceSubject {
    /// Returns the id of the subject in the record of an overlay build.
    fn overlay_id(&self) -> Cow<'_, str> {
        match self {
            Self::Mod { id } => Cow::Borrowed(id),
            Self::Project { path } => {
                Cow::Owned(WorkshopTestProject::all_layers(path).overlay_id())
            }
        }
    }

    /// Returns whether `advisory` is about the subject.
    fn is_subject_of(&self, advisory: &Advisory) -> bool {
        match (self, &advisory.subject) {
            (Self::Mod { id }, Some(AdvisorySubject::Mod { id: about })) => id == about,
            (Self::Project { path }, Some(AdvisorySubject::Project { path: about })) => {
                path == Path::new(about)
            }
            _ => false,
        }
    }
}

/// Why one mod, or one workshop project under test, did or did not reach the last game.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ModTrace {
    /// The rows, top to bottom. The last row is the first one that failed, if any failed.
    pub rows: Vec<TraceRow>,
    /// The newest game that a patcher session followed. `None` if no game is on record.
    pub last_game: Option<LastGame>,
}

impl ModTrace {
    /// Adds a row for `reading`, unless the trace ended.
    fn push(&mut self, reading: RowReading) {
        if !self.ended() {
            self.rows.push(TraceRow::from(reading));
        }
    }

    /// Returns whether the last row failed, which ends the trace.
    fn ended(&self) -> bool {
        self.rows
            .last()
            .is_some_and(|row| row.state == RowState::Fail)
    }
}

/// Reads the trace of a mod from the stores of the manager.
#[derive(Clone, Copy)]
pub struct ModTracer<'a> {
    pub library: &'a ModLibrary,
    pub config: &'a Config,
    pub games: &'a GameStore,
    /// The start of this run of the manager.
    pub run_started_at: Option<DateTime<Utc>>,
    /// Whether a patcher session follows a game now.
    pub game_open: bool,
}

impl ModTracer<'_> {
    /// Returns the trace of `subject`.
    ///
    /// A library mod has a row for each source: enabled, health, the overlay, the archives,
    /// each advisory of the build about the mod, and the last game. A workshop project has
    /// no enabled row and no health row.
    ///
    /// # Errors
    ///
    /// Fails if the index or the game store cannot be read, or if the library holds no
    /// mod with the id of a mod subject.
    pub fn trace(&self, subject: &TraceSubject) -> AppResult<ModTrace> {
        let games = self.games.list()?;
        let newest_game = games.first();
        let mut trace = ModTrace {
            rows: Vec::new(),
            last_game: newest_game.map(LastGame::from),
        };

        if let TraceSubject::Mod { id } = subject {
            trace.push(self.read_enabled(id)?);
            trace.push(self.read_health(id)?);
        }

        let build = self.library.last_build(self.config);
        let report = self
            .library
            .wad_reports()
            .0
            .lock()
            .get(&subject.overlay_id());
        trace.push(RowReading::Overlay(OverlayReading::read(
            build.as_ref(),
            subject,
            report.as_ref(),
        )));
        let Some(build) = build else {
            return Ok(trace);
        };

        let archives = report.as_ref().map(ModWadReport::archive_names);
        if let Some(archives) = &archives {
            trace.push(RowReading::Archives {
                archives: archives.clone(),
            });
        }
        for advisory in &build.advisories {
            if subject.is_subject_of(advisory) {
                trace.push(RowReading::Advisory {
                    code: advisory.code,
                });
            }
        }
        if trace.ended() {
            return Ok(trace);
        }

        let evidence = GameEvidence {
            build: &build,
            game: newest_game,
            archives: archives.as_deref(),
            champions: report
                .as_ref()
                .map(|report| report.derived.champions.as_slice())
                .unwrap_or_default(),
            newest_logged_game: self.newest_logged_game(),
            run_started_at: self.run_started_at,
        };
        trace.push(RowReading::LastGame(evidence.reading()));
        Ok(trace)
    }

    /// Returns whether the active profile enables the mod `mod_id`.
    fn read_enabled(&self, mod_id: &str) -> AppResult<RowReading> {
        let installed = self
            .library
            .get_installed_mods(self.config)?
            .into_iter()
            .find(|installed| installed.id == mod_id)
            .ok_or_else(|| AppError::ModNotFound(mod_id.to_owned()))?;
        Ok(RowReading::Enabled {
            enabled: installed.enabled,
            profile: self.library.get_active_profile_info(self.config)?.name,
        })
    }

    /// Returns the last health check of the mod `mod_id`.
    fn read_health(&self, mod_id: &str) -> AppResult<RowReading> {
        let verdict = self
            .library
            .mod_health_verdicts(self.config)?
            .remove(mod_id);
        Ok(RowReading::Health {
            check: verdict.map(|verdict| HealthCheck {
                health: verdict.health,
                checked_at: verdict.checked_at,
            }),
        })
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
