//! The advisories that the app shows.
//!
//! The app shows the advisories of the last overlay build, and the advisories of the newest
//! game if that game ended after the build. A later build replaces both. A shown advisory
//! holds no detail: the detail of an advisory is for the support report.

use chrono::{DateTime, Utc};
use ltk_manager_base::{
    advisory::{Advisory, AdvisoryCode, AdvisorySubject, AdvisoryTier},
    config::Config,
    error::AppResult,
};
use ltk_manager_library::mods::{ModLibrary, MutedAdvisories};
use ltk_manager_runtime::diagnostics::games::GameStore;
use serde::Serialize;

#[cfg(test)]
mod tests;

/// What raised an advisory.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "kebab-case")]
pub enum AdvisorySource {
    /// The last overlay build.
    Build,
    /// The newest game.
    Game,
}

/// One advisory as the app shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ShownAdvisory {
    pub code: AdvisoryCode,
    /// The tier of an advisory of the patcher. `None` for an advisory of the manager.
    pub tier: Option<AdvisoryTier>,
    pub subject: Option<AdvisorySubject>,
    /// The code that the patcher gave the condition, such as `VRF00000008`.
    pub patcher_code: Option<String>,
    pub source: AdvisorySource,
    pub at: DateTime<Utc>,
    /// Whether the user muted the code for the mod. The session bar and the mod card leave
    /// a muted advisory out.
    pub muted: bool,
}

impl ShownAdvisory {
    /// Returns the advisories that the app shows: those of the last build of `library`,
    /// then those of the newest game of `games` if that game ended after the build.
    ///
    /// # Errors
    ///
    /// Fails if the index of the library or the game store cannot be read.
    pub fn list(library: &ModLibrary, config: &Config, games: &GameStore) -> AppResult<Vec<Self>> {
        let muted = library.muted_advisories(config)?;
        let build = library.last_build(config);
        let built_at = build.as_ref().map(|build| build.built_at);

        let mut shown: Vec<Self> = build
            .iter()
            .flat_map(|build| &build.advisories)
            .map(|advisory| Self::of(advisory, AdvisorySource::Build, &muted))
            .collect();
        let newest = games.list()?.into_iter().next();
        if let Some(game) = newest.filter(|game| built_at.is_none_or(|at| game.ended_at >= at)) {
            shown.extend(
                game.advisories
                    .iter()
                    .map(|advisory| Self::of(advisory, AdvisorySource::Game, &muted)),
            );
        }
        Ok(shown)
    }

    /// Returns `advisory` without its detail, as `source` raised it.
    fn of(advisory: &Advisory, source: AdvisorySource, muted: &MutedAdvisories) -> Self {
        let is_muted = match &advisory.subject {
            Some(AdvisorySubject::Mod { id }) => muted.holds(advisory.code, id),
            _ => false,
        };
        Self {
            code: advisory.code,
            tier: advisory.code.tier(),
            subject: advisory.subject.clone(),
            patcher_code: advisory.patcher_code.clone(),
            source,
            at: advisory.at,
            muted: is_muted,
        }
    }
}
