//! Repairing an archive-storage fantome in place.
//!
//! A mod stored as its archive has no tree the Problems engine can write to,
//! so a repair goes the long way round: unpack the archive into staging, run
//! the rules there, apply every fix they derive, and pack the staged project
//! back into a fantome that takes the archive's place. The library keeps
//! reading the same path, and the mod stays in Archive storage throughout.
//! Replacing the archive, and keeping no copy of the original, is ADR-0005.

use crate::config::Config;
use crate::error::{AppError, AppResult, Utf8PathExt};
use crate::events::{BackendEvent, ModRepairProgress};
use crate::mods::ModLibrary;
use crate::mods::archive::install::STAGING_PREFIX;
use crate::mods::archive::metadata::load_mod_project;
use crate::mods::health::cancelled;
use crate::mods::index::ModStorage;
use crate::problems::{self, Budget, FixReport, budget};
use ltk_mod_project::ProjectImporter;
use ltk_mod_project::fantome::{FantomeFormat, FantomeImporter};
use serde::Serialize;
use std::fs;
use std::io::BufWriter;
use std::path::Path;
use uuid::Uuid;

/// What one repair over several mods became of each of them.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct LibraryRepairReport {
    /// Mods a repair wrote to, by id.
    pub repaired: Vec<String>,
    /// Mods the rules found nothing left to apply to, by id.
    pub unchanged: Vec<String>,
    /// Mods that could not be repaired, and why.
    pub failed: Vec<ModRepairFailure>,
    /// Mods the run was called off before it finished, by id.
    ///
    /// Neither repaired nor failed: nothing was concluded about them, and the
    /// next sweep picks them up.
    pub cancelled: Vec<String>,
    /// Findings repaired across every mod.
    pub applied: u32,
}

/// One mod a repair could not finish, and what stopped it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct ModRepairFailure {
    pub mod_id: String,
    pub error: String,
}

impl ModLibrary {
    /// Repair what a machine can repair in one library mod.
    ///
    /// A Project-storage mod is repaired in its own tree, which leaves a
    /// restore point behind. An Archive-storage mod has no tree to write to,
    /// so its archive is unpacked into staging, fixed there, repacked, and
    /// swapped back in place. Either way, a mod with nothing to fix is left
    /// untouched.
    ///
    /// # Errors
    ///
    /// Fails when the mod is not in the library, has faulted, or is stored as
    /// an archive it does not have or that has no unpacked form.
    pub fn repair_mod(&self, config: &Config, mod_id: &str) -> AppResult<FixReport> {
        let budget = self.begin_health_run(Budget::repair());
        let repaired = self.repair_mod_within(config, mod_id, &budget);
        self.end_health_run();
        repaired
    }

    /// [`repair_mod`](Self::repair_mod) under a caller's own budget.
    ///
    /// # Errors
    ///
    /// The same as [`repair_mod`](Self::repair_mod), plus a run called off
    /// before this mod was finished.
    fn repair_mod_within(
        &self,
        config: &Config,
        mod_id: &str,
        budget: &Budget,
    ) -> AppResult<FixReport> {
        let started = std::time::Instant::now();
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

        let (report, checked) = match entry.storage {
            ModStorage::Project => {
                let mod_dir = entry.mod_dir(&storage_dir);
                let run = problems::analyze_within(&mod_dir, config, budget.clone())?;
                let wanted = run.live_fixable();
                let resolver = self.wad_resolver();
                let report =
                    problems::apply(&mod_dir, &run, &wanted, config, Some(resolver.as_ref()))?;
                let checked = verified(run, &wanted, &report);
                (report, checked)
            }
            ModStorage::Archive => {
                let archive = entry.convertible_archive(&storage_dir)?;
                let staging = storage_dir
                    .join("mods")
                    .join(format!("{STAGING_PREFIX}{}", Uuid::new_v4()));
                fs::create_dir_all(&staging)?;
                let outcome = self.repair_in_staging(config, &staging, &archive, budget);
                let _ = fs::remove_dir_all(&staging);
                outcome?
            }
        };

        // A run called off part way read only some of the mod's bins, so the
        // verdict it would record is a claim about a check that did not happen.
        if budget.is_cancelled() {
            return Err(cancelled(mod_id));
        }

        // The repair just analyzed the mod either way, so the verdict the
        // badge reads is refreshed here rather than by a second scan.
        if let Err(e) = self.record_health_check(config, &storage_dir, mod_id, &checked) {
            tracing::warn!("Repaired mod {mod_id} but could not store its verdict: {e}");
        }

        if report.applied > 0 {
            self.invalidate_overlay_for(&storage_dir, &[mod_id.to_string()]);
        }

        // Led by the slug, because a uuid in a log is a name nobody can map
        // back to a mod they installed.
        tracing::debug!(
            "{} repaired in {:?}: {} files, {} applied, {} skipped, {} names kept, {} left",
            entry.slug.as_ref().map_or(mod_id, |slug| slug.as_str()),
            started.elapsed(),
            report.files.len(),
            report.applied,
            report.skipped,
            report.names_kept,
            report.remaining.len()
        );

        Ok(report)
    }

    /// Repair each of `mod_ids`, and report what became of each.
    ///
    /// One mod that cannot be repaired is recorded and stepped over rather than
    /// ending the run.
    pub fn repair_mods(&self, config: &Config, mod_ids: &[String]) -> LibraryRepairReport {
        let started = std::time::Instant::now();
        tracing::info!("Repairing {} mods", mod_ids.len());

        let budget = self.begin_health_run(Budget::repair());
        let progress = RunProgress::new(mod_ids.len());
        // Weightless at this level: what a mod costs is what its bins cost, and
        // the inner pool is what reserves for those. This bound is how many
        // mods are open at once.
        let outcomes = budget.map(
            mod_ids,
            budget::MODS_AT_ONCE,
            |_| 0,
            |mod_id| {
                progress.begin(mod_id, |at| {
                    self.events().emit(BackendEvent::ModRepairProgress(at));
                });
                let repaired = self.repair_mod_within(config, mod_id, &budget);
                progress.end(mod_id, |at| {
                    self.events().emit(BackendEvent::ModRepairProgress(at));
                });
                repaired
            },
        );
        self.end_health_run();

        let mut report = LibraryRepairReport::default();
        for (mod_id, outcome) in mod_ids.iter().zip(outcomes) {
            match outcome {
                Some(Ok(fixes)) if fixes.applied > 0 => {
                    report.applied += fixes.applied;
                    report.repaired.push(mod_id.clone());
                }
                Some(Ok(_)) => report.unchanged.push(mod_id.clone()),
                Some(Err(_)) if budget.is_cancelled() => report.cancelled.push(mod_id.clone()),
                Some(Err(e)) => {
                    tracing::warn!("Could not repair mod {mod_id}: {e}");
                    report.failed.push(ModRepairFailure {
                        mod_id: mod_id.clone(),
                        error: e.to_string(),
                    });
                }
                None => report.cancelled.push(mod_id.clone()),
            }
        }

        tracing::info!(
            "Repaired {} of {} mods in {:?}: {} findings applied, {} unchanged, {} failed, {} cancelled",
            report.repaired.len(),
            mod_ids.len(),
            started.elapsed(),
            report.applied,
            report.unchanged.len(),
            report.failed.len(),
            report.cancelled.len()
        );
        report
    }

    /// Unpack `archive` into `staging`, fix what the rules find, and put the
    /// repacked result where the archive was.
    ///
    /// A run that applies nothing leaves the archive alone: repacking would
    /// rewrite the same content into different bytes for no reader's benefit.
    fn repair_in_staging(
        &self,
        config: &Config,
        staging: &Path,
        archive: &Path,
        budget: &Budget,
    ) -> AppResult<(FixReport, problems::Run)> {
        let staging_utf8 = self.unpack_for_rules(staging, archive)?;
        let run = problems::analyze_within(staging, config, budget.clone())?;
        let wanted = run.live_fixable();
        let resolver = self.wad_resolver();
        let report = problems::apply(staging, &run, &wanted, config, Some(resolver.as_ref()))?;
        if report.applied == 0 {
            return Ok((report, run));
        }

        let project = load_mod_project(staging)?;
        let repacked = archive.with_extension("repacked");
        let writer = BufWriter::new(fs::File::create(&repacked)?);
        ltk_mod_project::ProjectPacker::new(project, staging_utf8)
            .pack(FantomeFormat::new(writer))
            .map_err(|e| AppError::PackFailed(e.to_string()))?;

        swap_in_repacked(&repacked, archive)?;

        let checked = verified(run, &wanted, &report);
        Ok((report, checked))
    }

    /// Unpack `archive` into `staging` as the project the rules read.
    ///
    /// Shared by repair and check, which both have to materialize an
    /// archive-storage mod before a rule can see inside it.
    pub(in crate::mods) fn unpack_for_rules(
        &self,
        staging: &Path,
        archive: &Path,
    ) -> AppResult<camino::Utf8PathBuf> {
        let staging_utf8 = staging.to_path_buf().try_into_utf8("staging directory")?;
        ProjectImporter::new(&staging_utf8)
            .import(
                FantomeImporter::new(fs::File::open(archive)?)
                    .with_path_resolver(self.wad_resolver().as_ref()),
            )
            .map_err(|e| AppError::Other(format!("Failed to import fantome archive: {e}")))?;
        Ok(staging_utf8)
    }
}

/// How far a run over several mods has got, as its workers report it.
///
/// A concurrent run has no single "current mod" to name, so what it reports is
/// what is finished and what is open right now.
#[derive(Debug)]
struct RunProgress {
    total: usize,
    completed: std::sync::atomic::AtomicUsize,
    in_flight: std::sync::Mutex<Vec<String>>,
}

impl RunProgress {
    fn new(total: usize) -> Self {
        Self {
            total,
            completed: std::sync::atomic::AtomicUsize::new(0),
            in_flight: std::sync::Mutex::new(Vec::new()),
        }
    }

    /// Report that `mod_id` has been picked up.
    fn begin(&self, mod_id: &str, emit: impl FnOnce(ModRepairProgress)) {
        if let Ok(mut open) = self.in_flight.lock() {
            open.push(mod_id.to_owned());
        }
        emit(self.at());
    }

    /// Report that `mod_id` is done, however it turned out.
    fn end(&self, mod_id: &str, emit: impl FnOnce(ModRepairProgress)) {
        self.completed
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        if let Ok(mut open) = self.in_flight.lock()
            && let Some(at) = open.iter().position(|held| held == mod_id)
        {
            open.remove(at);
        }
        emit(self.at());
    }

    fn at(&self) -> ModRepairProgress {
        ModRepairProgress {
            completed: self
                .completed
                .load(std::sync::atomic::Ordering::Relaxed)
                .min(self.total),
            total: self.total,
            in_flight: self
                .in_flight
                .lock()
                .map(|open| open.clone())
                .unwrap_or_default(),
        }
    }
}

/// What the project reads as once `report` has landed, for the verdict.
///
/// The rules re-check what they wrote before the bytes leave them, so
/// [`FixReport::remaining`] is what a second analyze would find and re-parsing
/// every bin to discover it would be a full pass for nothing.
fn verified(
    run: problems::Run,
    wanted: &[problems::ProblemId],
    report: &FixReport,
) -> problems::Run {
    let repaired: Vec<problems::ProblemId> = wanted
        .iter()
        .filter(|id| !report.remaining.contains(id))
        .cloned()
        .collect();
    run.without(&repaired)
}

/// Put the repacked archive where the original was, keeping the original until
/// the repacked one is in place.
fn swap_in_repacked(repacked: &Path, archive: &Path) -> AppResult<()> {
    let replaced = archive.with_extension("replaced");
    fs::rename(archive, &replaced).map_err(|e| {
        AppError::Io(std::io::Error::new(
            e.kind(),
            format!("Failed to move {} aside: {e}", archive.display()),
        ))
    })?;

    if let Err(e) = fs::rename(repacked, archive) {
        let _ = fs::rename(&replaced, archive);
        return Err(AppError::Io(std::io::Error::new(
            e.kind(),
            format!(
                "Failed to move the repaired archive into {}: {e}",
                archive.display()
            ),
        )));
    }

    let _ = fs::remove_file(&replaced);
    Ok(())
}

#[cfg(test)]
mod tests;
