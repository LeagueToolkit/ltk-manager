//! The library sweep: every mod re-checked when a check's premises moved.
//!
//! Per "The library sweep" in docs/ux/MOD_HEALTH.md.

use super::{
    HealthCheckBasis, LEGACY_VERDICTS_FILENAME, ModHealth, ModHealthVerdict, Refused, VerdictFile,
};
use crate::config::Config;
use crate::error::{AppError, AppResult};
use crate::events::{BackendEvent, HealthSweepProgress};
use crate::hashtables::HashtableCache;
use crate::meta_schema::cache::{MetaSchemaCache, PublishedDb};
use crate::mods::ModLibrary;
use crate::mods::index::LibraryModEntry;
use crate::problems::{BinNames, Budget, budget};
use fs_err as fs;
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::Path;

/// What one library sweep concluded.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct HealthSweepReport {
    /// What the sweep checked against.
    pub basis: HealthCheckBasis,
    /// Mods this run recorded a fresh verdict for.
    pub checked: usize,
    /// Checkable mods this run did not take.
    pub skipped: usize,
    /// Every mod in the library a repair would fix, by id.
    pub repairable: Vec<String>,
    /// Every mod in the library with findings and no fix for any, by id.
    pub unrepairable: Vec<String>,
}

/// What the library sweep has to say for itself this launch.
///
/// The run starts with the app and can be over before a webview exists to hear
/// it announced, so the outcome is kept for whoever asks next rather than only
/// emitted — the same reason
/// [`LayoutMigrationState`](crate::mods::LayoutMigrationState) is kept.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum HealthSweepState {
    /// The startup pass has not reported yet, so the answer is still coming.
    #[default]
    Pending,
    /// It ran and had nothing to re-check, which is every launch on the same
    /// game build under the same manager.
    Idle,
    /// It is working through the mods it owes a check.
    #[serde(rename_all = "camelCase")]
    Running { completed: usize, total: usize },
    /// It finished, and this is what the library looks like.
    #[serde(rename_all = "camelCase")]
    Finished { report: HealthSweepReport },
}

/// Which mods a sweep takes.
///
/// [`Due`](SweepScope::Due) and [`Installed`](SweepScope::Installed) are
/// automatic, and the other two run on a user's request. A requested run
/// checks every mod it names whatever the stored verdicts say, and returns an
/// error where it cannot run.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum SweepScope {
    /// Every checkable mod whose verdict predates the current basis.
    #[default]
    Due,
    /// Every checkable mod in the library.
    All,
    /// The checkable mods among these ids.
    Only(Vec<String>),
    /// The checkable mods among these ids, just installed.
    Installed(Vec<String>),
}

impl SweepScope {
    /// Whether a reader is waiting on this run.
    #[must_use]
    fn pressed(&self) -> bool {
        !matches!(self, Self::Due | Self::Installed(_))
    }

    /// The mods this scope takes, out of the library's `entries`.
    fn take(
        &self,
        entries: &[LibraryModEntry],
        kept: &BTreeMap<String, ModHealthVerdict>,
        basis: &HealthCheckBasis,
    ) -> Vec<String> {
        entries
            .iter()
            .filter(|entry| entry.is_checkable())
            .filter(|entry| match self {
                Self::Due => kept.get(&entry.id).is_none_or(|held| &held.basis != basis),
                Self::All => true,
                Self::Only(ids) | Self::Installed(ids) => ids.contains(&entry.id),
            })
            .map(|entry| entry.id.clone())
            .collect()
    }

    /// What the run may hold at once, and how many mods it opens together.
    ///
    /// A pressed run takes the larger share, because the reader is waiting on
    /// it rather than browsing past it.
    fn budget(&self) -> (Budget, usize) {
        match self {
            Self::Due | Self::Installed(_) => (Budget::sweep(), budget::SWEEP_MODS_AT_ONCE),
            _ => (Budget::repair(), budget::MODS_AT_ONCE),
        }
    }
}

impl ModLibrary {
    /// Re-check every mod whose verdict predates the current [`HealthCheckBasis`].
    ///
    /// One mod that cannot be read is logged and skipped, so a single unreadable
    /// archive never costs the user the rest of the library. The report covers
    /// every mod's verdict rather than only the ones this run refreshed.
    ///
    /// # Errors
    ///
    /// Fails only before the run starts, for a storage directory that cannot be
    /// resolved or an index that cannot be read. Once it is under way it always
    /// reports. A pressed `scope` also fails where the automatic one stands
    /// down, since a press has somebody to answer.
    pub fn sweep_mod_health(
        &self,
        config: &Config,
        scope: &SweepScope,
    ) -> AppResult<HealthSweepReport> {
        if scope.pressed()
            && let HealthSweepState::Running { .. } = self.health_sweep_state()
        {
            return Err(AppError::ValidationFailed(
                "The library is already being checked. Wait for that run to finish.".to_owned(),
            ));
        }
        let _run = self.sweep_lock.lock();

        let basis = self.health_check_basis(config);
        let entries = self.with_index(config, |_storage_dir, index| Ok(index.mods.clone()))?;
        let storage_dir = self.storage_dir(config)?;

        let kept = self.prune_verdicts(&storage_dir, &entries)?;

        // Pruning first, because a mod the library no longer holds should lose
        // its verdict whatever the tables say. Checking is what stands down:
        // every verdict this pass could record would misjudge what a repair
        // reaches - see `ModLibrary::hashtables_ready`.
        if !self.hashtables_ready() {
            if scope.pressed() {
                return Err(self.no_hashtables(Refused::Check));
            }
            tracing::warn!(
                "Not sweeping mod health: the hashtable cache is empty, so every verdict would be \
                 a claim about content the rules could not name"
            );
            let report = self.health_report(&storage_dir, basis, 0, 0);
            return Ok(self.report_sweep(scope, HealthSweepState::Idle, report));
        }

        let checkable = entries.iter().filter(|entry| entry.is_checkable()).count();
        let due = scope.take(&entries, &kept, &basis);
        let (total, skipped) = (due.len(), checkable - due.len());

        if total == 0 {
            let report = self.health_report(&storage_dir, basis, 0, skipped);
            return Ok(self.report_sweep(scope, HealthSweepState::Idle, report));
        }

        tracing::info!("Sweeping mod health: {total} to check, {skipped} already current");
        let started = std::time::Instant::now();

        let (share, at_once) = scope.budget();
        let budget = self.begin_health_run(share);
        let progress = SweepProgress::new(total);
        let outcomes = budget.map(
            &due,
            at_once,
            |_| 0,
            |mod_id| {
                progress.begin(mod_id, self);
                let checked = self.check_mod_health_within(config, mod_id, &budget);
                progress.end(mod_id, self);
                checked
            },
        );
        self.end_health_run(&budget);

        let mut checked = 0;
        for (mod_id, outcome) in due.iter().zip(outcomes) {
            match outcome {
                Some(Ok(_)) => checked += 1,
                Some(Err(e)) if !budget.is_cancelled() => {
                    tracing::warn!("Could not check mod {mod_id} during the library sweep: {e}");
                }
                _ => {}
            }
        }

        let report = self.health_report(&storage_dir, basis, checked, skipped);
        tracing::info!(
            "Swept mod health in {:?}: {checked} of {total} checked, {} repairable, {} unrepairable",
            started.elapsed(),
            report.repairable.len(),
            report.unrepairable.len()
        );
        Ok(self.report_sweep(
            scope,
            HealthSweepState::Finished {
                report: report.clone(),
            },
            report,
        ))
    }

    /// Record `state` as what the sweep concluded, and say so where it is owed.
    ///
    /// Every path out of a started sweep goes through here, including the two
    /// that check nothing. A press is answered whichever path it took, because
    /// a reader is waiting on it and the run has pruned whatever the check did.
    /// The automatic pass stays quiet unless it ran, so a launch with nothing
    /// due says nothing at all. An install check that checked nothing leaves
    /// the recorded state unchanged, so the startup sweep's `Pending` survives.
    fn report_sweep(
        &self,
        scope: &SweepScope,
        state: HealthSweepState,
        report: HealthSweepReport,
    ) -> HealthSweepReport {
        let ran = matches!(state, HealthSweepState::Finished { .. });
        if ran || !matches!(scope, SweepScope::Installed(_)) {
            self.record_health_sweep(state);
        }

        if ran || scope.pressed() {
            self.events().emit(BackendEvent::ModHealthVerdictsUpdated);
            self.events()
                .emit(BackendEvent::HealthSweepFinished(report.clone()));
        }
        report
    }

    /// Fill the shared hashtable cache, for the sweep that is about to read it.
    ///
    /// A cache that is empty or behind the published release is fetched first,
    /// because a check with no tables to name a mod's content with is not a
    /// check the sweep may run at all - see
    /// [`hashtables_ready`](ModLibrary::hashtables_ready). A sync that fails is
    /// logged and stepped over, and the sweep behind it then stands down.
    ///
    /// Answers whether new tables landed, which is the caller's cue to reopen
    /// everything it read out of the old ones.
    pub(in crate::mods) fn fill_hashtables(&self) -> bool {
        let cache = match HashtableCache::shared() {
            Ok(cache) => cache,
            Err(e) => {
                tracing::warn!("No hashtable cache to fill before the library sweep: {e}");
                return false;
            }
        };

        let report = match cache.sync(false, &self.user_agent(), self.events().as_ref()) {
            Ok(report) => report,
            Err(e) => {
                tracing::warn!("Could not sync the hashtables before the library sweep: {e}");
                return false;
            }
        };
        if report.installed.is_empty() {
            return false;
        }

        tracing::info!(
            "Installed {} hashtables before the library sweep: {}",
            report.installed.len(),
            report.installed.join(", ")
        );
        self.wad_resolver.invalidate();
        BinNames::invalidate_game_index();
        true
    }

    /// Fetch the meta schema database, for the sweep that is about to read it.
    ///
    /// Its own sync beside the hashtables', since the two publishers can be
    /// down independently. A failure is logged and stepped over, leaving every
    /// check on the shipped snapshot.
    ///
    /// Answers whether a newer database landed - see
    /// [`HealthCheckBasis::schema`].
    pub(in crate::mods) fn fill_meta_schema(&self) -> bool {
        let cache = match MetaSchemaCache::discover() {
            Ok(cache) => cache,
            Err(e) => {
                tracing::warn!("No meta schema cache to fill before the library sweep: {e}");
                return false;
            }
        };

        let fetch = match PublishedDb::new(&self.user_agent()) {
            Ok(fetch) => fetch,
            Err(e) => {
                tracing::warn!("Could not build the meta schema client: {e}");
                return false;
            }
        };

        match cache.refresh(&fetch) {
            Ok(report) => report.installed,
            Err(e) => {
                tracing::warn!("Could not sync the meta schema database: {e}");
                false
            }
        }
    }

    pub(in crate::mods) fn user_agent(&self) -> String {
        format!("ltk-manager/{}", self.app_version())
    }

    /// What the library sweep has to say for itself this launch.
    #[must_use]
    pub fn health_sweep_state(&self) -> HealthSweepState {
        self.health_sweep.lock().clone()
    }

    pub(in crate::mods) fn record_health_sweep(&self, state: HealthSweepState) {
        *self.health_sweep.lock() = state;
    }

    /// Forget the verdicts of mods the library no longer holds, and answer with
    /// the ones that survived.
    ///
    /// Nothing else drops a verdict, so without this the file grows for the
    /// life of the library. The survivors come back rather than being read
    /// again, since deciding what is due is the next thing that wants them.
    fn prune_verdicts(
        &self,
        storage_dir: &Path,
        entries: &[LibraryModEntry],
    ) -> AppResult<BTreeMap<String, ModHealthVerdict>> {
        let _lock = self.verdict_lock().lock();
        drop_legacy_verdicts(storage_dir);

        let mut file = VerdictFile::load(storage_dir);
        let before = file.verdicts.len();
        file.verdicts
            .retain(|mod_id, _| entries.iter().any(|entry| &entry.id == mod_id));

        let dropped = before - file.verdicts.len();
        if dropped > 0 {
            tracing::debug!("Dropped {dropped} verdicts for mods no longer in the library");
            file.save(storage_dir)?;
        }
        Ok(file.verdicts)
    }

    /// What every remembered verdict says, as one report.
    ///
    /// Over the whole library rather than only the mods this run checked: a mod
    /// skipped as already current is still broken, and a surface asking for this
    /// is asking what is wrong with the library rather than what the run did.
    fn health_report(
        &self,
        storage_dir: &Path,
        basis: HealthCheckBasis,
        checked: usize,
        skipped: usize,
    ) -> HealthSweepReport {
        let verdicts = VerdictFile::load(storage_dir).verdicts;
        let with_health = |health: ModHealth| -> Vec<String> {
            verdicts
                .values()
                .filter(|verdict| verdict.health == health)
                .map(|verdict| verdict.mod_id.clone())
                .collect()
        };

        HealthSweepReport {
            basis,
            checked,
            skipped,
            repairable: with_health(ModHealth::Repairable),
            unrepairable: with_health(ModHealth::Unrepairable),
        }
    }
}

/// How far the sweep has got, as its workers report it.
///
/// The same shape as a repair's progress, and its own type because the two run
/// at different moments: a surface drawing one must not be driven by the other.
#[derive(Debug)]
struct SweepProgress {
    total: usize,
    completed: std::sync::atomic::AtomicUsize,
    in_flight: parking_lot::Mutex<Vec<String>>,
}

impl SweepProgress {
    fn new(total: usize) -> Self {
        Self {
            total,
            completed: std::sync::atomic::AtomicUsize::new(0),
            in_flight: parking_lot::Mutex::new(Vec::new()),
        }
    }

    fn begin(&self, mod_id: &str, library: &ModLibrary) {
        self.in_flight.lock().push(mod_id.to_owned());
        self.announce(library);
    }

    fn end(&self, mod_id: &str, library: &ModLibrary) {
        self.completed
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        {
            // `announce` takes the same lock, so the guard goes out of scope first.
            let mut open = self.in_flight.lock();
            if let Some(at) = open.iter().position(|held| held == mod_id) {
                open.remove(at);
            }
        }
        self.announce(library);
    }

    fn announce(&self, library: &ModLibrary) {
        let completed = self
            .completed
            .load(std::sync::atomic::Ordering::Relaxed)
            .min(self.total);
        library.record_health_sweep(HealthSweepState::Running {
            completed,
            total: self.total,
        });
        library
            .events()
            .emit(BackendEvent::HealthSweepProgress(HealthSweepProgress {
                completed,
                total: self.total,
                in_flight: self.in_flight.lock().clone(),
            }));
    }
}

/// Delete the verdict cache written under its pre-rename name.
///
/// Nothing is carried across. Every verdict it holds names a basis no manager
/// that can read this file was built with, so the sweep is about to take all of
/// them again anyway.
fn drop_legacy_verdicts(storage_dir: &Path) {
    let legacy = storage_dir.join(LEGACY_VERDICTS_FILENAME);
    if !legacy.is_file() {
        return;
    }
    if let Err(e) = fs::remove_file(&legacy) {
        tracing::debug!("Could not remove {LEGACY_VERDICTS_FILENAME}: {e}");
    }
}

#[cfg(test)]
mod tests;
