//! The library sweep: every mod re-checked when a check's premises moved.
//!
//! Per "The library sweep" in docs/ux/MOD_HEALTH.md.

use super::{HealthCheckBasis, LEGACY_VERDICTS_FILENAME, ModHealth, ModHealthVerdict, VerdictFile};
use crate::config::Config;
use crate::error::{AppResult, MutexResultExt};
use crate::events::{BackendEvent, HealthSweepProgress};
use crate::mods::ModLibrary;
use crate::mods::index::LibraryModEntry;
use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
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
    /// Mods whose stored verdict already named [`HealthSweepReport::basis`].
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
    Running { current: usize, total: usize },
    /// It finished, and this is what the library looks like.
    #[serde(rename_all = "camelCase")]
    Finished { report: HealthSweepReport },
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
    /// reports.
    pub fn sweep_mod_health(&self, config: &Config) -> AppResult<HealthSweepReport> {
        let basis = self.health_check_basis(config);
        let entries = self.with_index(config, |_storage_dir, index| Ok(index.mods.clone()))?;
        let storage_dir = self.storage_dir(config)?;

        let kept = self.prune_verdicts(&storage_dir, &entries)?;
        let checkable = entries.iter().filter(|entry| entry.is_checkable()).count();
        let due = due_for_check(&entries, &kept, &basis);
        let (total, skipped) = (due.len(), checkable - due.len());

        if total == 0 {
            let report = self.health_report(&storage_dir, basis, 0, skipped);
            self.record_health_sweep(HealthSweepState::Idle);
            return Ok(report);
        }

        tracing::info!("Sweeping mod health: {total} to check, {skipped} already current");
        let mut checked = 0;
        for (i, mod_id) in due.iter().enumerate() {
            self.record_health_sweep(HealthSweepState::Running {
                current: i + 1,
                total,
            });
            self.events()
                .emit(BackendEvent::HealthSweepProgress(HealthSweepProgress {
                    current: i + 1,
                    total,
                    mod_id: mod_id.clone(),
                }));

            match self.check_mod_health(config, mod_id) {
                Ok(_) => checked += 1,
                Err(e) => {
                    tracing::warn!("Could not check mod {mod_id} during the library sweep: {e}")
                }
            }
        }

        let report = self.health_report(&storage_dir, basis, checked, skipped);
        tracing::info!(
            "Swept mod health: {} repairable, {} unrepairable",
            report.repairable.len(),
            report.unrepairable.len()
        );
        self.record_health_sweep(HealthSweepState::Finished {
            report: report.clone(),
        });
        self.events().emit(BackendEvent::ModHealthVerdictsUpdated);
        self.events()
            .emit(BackendEvent::HealthSweepFinished(report.clone()));

        Ok(report)
    }

    /// What the library sweep has to say for itself this launch.
    #[must_use]
    pub fn health_sweep_state(&self) -> HealthSweepState {
        self.health_sweep
            .lock()
            .map(|state| state.clone())
            .unwrap_or_default()
    }

    pub(in crate::mods) fn record_health_sweep(&self, state: HealthSweepState) {
        if let Ok(mut held) = self.health_sweep.lock() {
            *held = state;
        }
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
        let _lock = self.verdict_lock().lock().mutex_err()?;
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

/// The checkable mods of `entries` whose verdict in `kept` is not a claim about
/// `basis`.
///
/// A mod never checked is due by the same test, since it has no verdict to
/// disagree with.
fn due_for_check(
    entries: &[LibraryModEntry],
    kept: &BTreeMap<String, ModHealthVerdict>,
    basis: &HealthCheckBasis,
) -> Vec<String> {
    entries
        .iter()
        .filter(|entry| entry.is_checkable())
        .filter(|entry| kept.get(&entry.id).is_none_or(|held| &held.basis != basis))
        .map(|entry| entry.id.clone())
        .collect()
}

#[cfg(test)]
mod tests;
