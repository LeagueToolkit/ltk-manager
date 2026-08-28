//! Mod health: what a check concluded about one library mod.
//!
//! The Problems engine speaks to a modder, in findings addressed to a property
//! inside a file. A mod user gets the same rules summarized to a verdict, per
//! "The verdict" in docs/ux/MOD_HEALTH.md. Verdicts are remembered in
//! `mod-health-verdicts.json` beside the library index, so the library view can
//! badge every mod without re-scanning any.

pub mod sweep;

use crate::config::Config;
use crate::error::{AppError, AppResult, MutexResultExt};
use crate::mods::ModLibrary;
use crate::mods::archive::install::STAGING_PREFIX;
use crate::mods::index::{LibraryModEntry, ModStorage};
use crate::problems::{self, Budget, Counts, GameBuild, Run};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use uuid::Uuid;

/// Where the library remembers its verdicts, beside `library.json`.
const MOD_HEALTH_VERDICTS_FILENAME: &str = "mod-health-verdicts.json";

/// What that file was called before this module was named for mod health.
pub(in crate::mods) const LEGACY_VERDICTS_FILENAME: &str = "check-verdicts.json";

/// What one check concluded, summarized for a mod user.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct ModHealthVerdict {
    pub mod_id: String,
    pub health: ModHealth,
    /// How many findings a repair would fix.
    pub fixable: u32,
    /// Every live finding by severity, fixable or not.
    pub counts: Counts,
    /// ISO-8601 timestamp the check ran.
    pub checked_at: String,
    /// What the check was a claim about, for the sweep to compare against.
    #[serde(default)]
    pub basis: HealthCheckBasis,
}

/// What a check ran against, and therefore what makes an old one stale.
///
/// Per "The basis" in docs/ux/MOD_HEALTH.md.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct HealthCheckBasis {
    /// The installed game build, absent where none could be read.
    #[cfg_attr(feature = "ts", ts(type = "string | null"))]
    pub build: Option<GameBuild>,
    /// The manager version, which is what a migration table ships in.
    pub manager: String,
}

impl LibraryModEntry {
    /// Whether the Problems rules can reach this mod's content at all.
    ///
    /// A faulted mod has no content to trust, and a modpkg's only exists inside
    /// its archive with no unpacked form to run the rules over - ADR-0001.
    pub(in crate::mods) fn is_checkable(&self) -> bool {
        self.fault.is_none() && self.format.is_convertible()
    }
}

/// The one word a mod's badge says.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum ModHealth {
    /// Nothing a live rule objects to.
    Healthy,
    /// At least one finding a repair can fix.
    Repairable,
    /// Findings, and no fix for any of them.
    Unrepairable,
}

impl ModLibrary {
    /// Check one mod and remember the verdict.
    ///
    /// Runs the Problems rules over the mod's content — unpacking an
    /// archive-storage mod into staging to do it — without writing anything
    /// to the mod itself.
    ///
    /// # Errors
    ///
    /// Fails when the mod is not in the library, has faulted, or its content
    /// cannot be read.
    pub fn check_mod_health(&self, config: &Config, mod_id: &str) -> AppResult<ModHealthVerdict> {
        self.check_mod_health_within(config, mod_id, &Budget::repair())
    }

    /// [`check_mod_health`](Self::check_mod_health) under a caller's own budget.
    ///
    /// A run called off part way records no verdict at all, so the next sweep
    /// picks the mod up rather than trusting a check that did not finish.
    ///
    /// # Errors
    ///
    /// The same as [`check_mod_health`](Self::check_mod_health), plus a run
    /// that was cancelled before this mod was finished.
    pub(in crate::mods) fn check_mod_health_within(
        &self,
        config: &Config,
        mod_id: &str,
        budget: &Budget,
    ) -> AppResult<ModHealthVerdict> {
        let storage_dir = self.storage_dir(config)?;
        let entry = self.with_index(config, |_storage_dir, index| {
            index
                .mods
                .iter()
                .find(|m| m.id == mod_id)
                .cloned()
                .ok_or_else(|| AppError::ModNotFound(mod_id.to_string()))
        })?;
        if entry.fault.is_some() {
            return Err(AppError::ValidationFailed(
                "This mod is in a failed state. Remove it and install it again.".to_string(),
            ));
        }

        let run = self.run_over(config, &storage_dir, &entry, budget)?;
        if budget.is_cancelled() {
            return Err(cancelled(mod_id));
        }
        self.record_health_check(config, &storage_dir, mod_id, &run)
    }

    /// Summarize `run` as `mod_id`'s verdict and remember it.
    ///
    /// The seam repair reaches through: it has already analyzed the mod, and
    /// the verdict rides along rather than costing a second scan.
    pub(in crate::mods) fn record_health_check(
        &self,
        config: &Config,
        storage_dir: &Path,
        mod_id: &str,
        run: &Run,
    ) -> AppResult<ModHealthVerdict> {
        let verdict = ModHealthVerdict::from_run(mod_id, run, self.health_check_basis(config));
        let _lock = self.verdict_lock().lock().mutex_err()?;
        let mut file = VerdictFile::load(storage_dir);
        file.verdicts.insert(mod_id.to_string(), verdict.clone());
        file.save(storage_dir)?;
        Ok(verdict)
    }

    /// What a check running now would be a claim about.
    pub(in crate::mods) fn health_check_basis(&self, config: &Config) -> HealthCheckBasis {
        HealthCheckBasis {
            build: GameBuild::installed(config),
            manager: self.app_version().to_owned(),
        }
    }

    /// Check each of `mod_ids`, and report how many verdicts were recorded.
    ///
    /// A mod that cannot be checked is logged and skipped, so one unreadable
    /// mod does not cost the caller the rest.
    pub fn check_mods_health(&self, config: &Config, mod_ids: &[String]) -> usize {
        let mut recorded = 0;
        for id in mod_ids {
            match self.check_mod_health(config, id) {
                Ok(_) => recorded += 1,
                Err(e) => tracing::warn!("Could not check mod {id}: {e}"),
            }
        }
        recorded
    }

    /// [`check_mods_health`](Self::check_mods_health) on a detached background
    /// thread, announcing once at the end so the UI refetches.
    ///
    /// For the install path: a newly imported mod is checked without asking,
    /// and thirty at once must not make the import wait.
    pub fn spawn_health_check(&self, config: &Config, mod_ids: Vec<String>) {
        if mod_ids.is_empty() {
            return;
        }

        let library = self.clone();
        let config = config.clone();
        std::thread::spawn(move || {
            if library.check_mods_health(&config, &mod_ids) > 0 {
                library
                    .events()
                    .emit(crate::events::BackendEvent::ModHealthVerdictsUpdated);
            }
        });
    }

    /// Every verdict the library remembers, by mod id.
    ///
    /// A mod never checked has no entry.
    ///
    /// # Errors
    ///
    /// Fails when no storage directory is configured.
    pub fn mod_health_verdicts(
        &self,
        config: &Config,
    ) -> AppResult<BTreeMap<String, ModHealthVerdict>> {
        let storage_dir = self.storage_dir(config)?;
        Ok(VerdictFile::load(&storage_dir).verdicts)
    }

    /// One Problems run over the mod's content, whichever storage holds it.
    ///
    /// A Project-storage mod is read where it lives. An Archive-storage mod is
    /// unpacked into staging just to be read, and the staging is gone before
    /// this returns — a check never leaves anything behind.
    fn run_over(
        &self,
        config: &Config,
        storage_dir: &Path,
        entry: &LibraryModEntry,
        budget: &Budget,
    ) -> AppResult<Run> {
        match entry.storage {
            ModStorage::Project => {
                problems::analyze_within(&entry.mod_dir(storage_dir), config, budget.clone())
            }
            ModStorage::Archive => {
                let archive = entry.convertible_archive(storage_dir)?;
                let staging = storage_dir
                    .join("mods")
                    .join(format!("{STAGING_PREFIX}{}", Uuid::new_v4()));
                fs::create_dir_all(&staging)?;
                let run = self
                    .unpack_for_rules(&staging, &archive)
                    .and_then(|_| problems::analyze_within(&staging, config, budget.clone()));
                let _ = fs::remove_dir_all(&staging);
                run
            }
        }
    }
}

impl ModHealthVerdict {
    /// Summarize one run the way a mod's badge reads it.
    fn from_run(mod_id: &str, run: &Run, basis: HealthCheckBasis) -> Self {
        let counts = Counts::over(run.live_problems());
        let fixable = run
            .live_problems()
            .filter(|problem| problem.fix.is_some())
            .count() as u32;
        let total = counts.fatals + counts.errors + counts.warnings + counts.infos;

        let health = if total == 0 {
            ModHealth::Healthy
        } else if fixable > 0 {
            ModHealth::Repairable
        } else {
            ModHealth::Unrepairable
        };

        Self {
            mod_id: mod_id.to_string(),
            health,
            fixable,
            counts,
            checked_at: chrono::Utc::now().to_rfc3339(),
            basis,
        }
    }
}

/// The error a mod the run never finished reports.
///
/// Its own sentence rather than a silent skip: a caller counting what it asked
/// for has to be able to tell a mod that was called off from one that failed.
pub(in crate::mods) fn cancelled(mod_id: &str) -> AppError {
    AppError::ValidationFailed(format!("The run was cancelled before {mod_id} finished"))
}

/// On-disk shape of `mod-health-verdicts.json`.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VerdictFile {
    version: u32,
    verdicts: BTreeMap<String, ModHealthVerdict>,
}

impl VerdictFile {
    /// Read the stored verdicts, starting empty when the file is missing or
    /// unreadable — a lost cache re-fills on the next check, and is not worth
    /// failing a read over.
    fn load(storage_dir: &Path) -> Self {
        let path = storage_dir.join(MOD_HEALTH_VERDICTS_FILENAME);
        match fs::read_to_string(&path) {
            Ok(contents) => serde_json::from_str(&contents).unwrap_or_else(|e| {
                tracing::warn!("Unreadable {MOD_HEALTH_VERDICTS_FILENAME}, starting over: {e}");
                Self::default()
            }),
            Err(_) => Self::default(),
        }
    }

    fn save(&self, storage_dir: &Path) -> AppResult<()> {
        let path = storage_dir.join(MOD_HEALTH_VERDICTS_FILENAME);
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_string_pretty(self)?)?;
        fs::rename(&tmp, &path)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests;
