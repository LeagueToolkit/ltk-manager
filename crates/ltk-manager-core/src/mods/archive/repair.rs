//! Repairing an archive-storage fantome in place.
//!
//! A mod stored as its archive has no tree the Problems engine can write to,
//! so a repair goes the long way round: unpack the archive into staging, run
//! the rules there, apply every fix they derive, and write what changed back
//! into the archive. The library keeps reading the same path, and the mod stays
//! in Archive storage throughout. Replacing the archive, and keeping no copy of
//! the original, is ADR-0005.

use crate::config::Config;
use crate::error::{AppError, AppResult, Utf8PathExt, Utf8PathRefExt};
use crate::events::{BackendEvent, ModRepairProgress};
use crate::mods::ModLibrary;
use crate::mods::archive::install::STAGING_PREFIX;
use crate::mods::archive::metadata::load_mod_project;
use crate::mods::health::{Refused, cancelled};
use crate::mods::index::ModStorage;
use crate::problems::{self, Budget, FixReport, budget};
use camino::Utf8Path;
use delta::RepairEdit;
use ltk_mod_project::ProjectImporter;
use ltk_mod_project::fantome::{FantomeFormat, FantomeImporter};
use serde::Serialize;
use std::fs;
use std::io::BufWriter;
use std::path::Path;
use uuid::Uuid;

mod delta;

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
    /// A Project-storage mod is repaired in its own tree. An Archive-storage
    /// mod has no tree to write to, so its archive is unpacked into staging,
    /// fixed there, and written back over. Either way, a mod with nothing to
    /// fix is left untouched, and neither is reversible - what a repair keeps
    /// is the names it hashed away, per ADR-0006.
    ///
    /// # Errors
    ///
    /// Fails when the mod is not in the library, when it is stored as an
    /// archive it does not have or that has no unpacked form, and when the
    /// hashtables are not there - see
    /// [`hashtables_ready`](Self::hashtables_ready).
    pub fn repair_mod(&self, config: &Config, mod_id: &str) -> AppResult<FixReport> {
        /* A budget of its own, and not the run's: one mod from a row can be
        pressed while the startup sweep is going, and taking the run's handle
        would leave the sweep's cancel reaching nothing. */
        self.repair_mod_within(config, mod_id, &Budget::repair())
    }

    /// [`repair_mod`](Self::repair_mod) under a caller's own budget.
    ///
    /// # Errors
    ///
    /// The same as [`repair_mod`](Self::repair_mod), plus a run called off
    /// before this mod was finished.
    pub(in crate::mods) fn repair_mod_within(
        &self,
        config: &Config,
        mod_id: &str,
        budget: &Budget,
    ) -> AppResult<FixReport> {
        // The same precondition the check runs under, and for a stronger
        // reason: a repair with no names to derive from applies what it can,
        // withholds the rest, and then records a verdict calling the remainder
        // unrepairable. A press reaching here at all means a stored verdict
        // outlived the tables it was taken against.
        if !self.hashtables_ready() {
            return Err(self.no_hashtables(Refused::Repair));
        }

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

        let (report, checked) = match entry.storage {
            ModStorage::Project => {
                let mod_dir = entry.mod_dir(&storage_dir);
                let game = self.game_content(config);
                let run = problems::analyze_within(&mod_dir, config, budget.clone(), game.clone())?;
                let wanted = run.live_fixable();
                let resolver = self.wad_resolver();
                let report = problems::apply(
                    &mod_dir,
                    &run,
                    &wanted,
                    config,
                    Some(resolver.as_ref()),
                    game.clone(),
                )?;
                let checked = verified(&mod_dir, run, &wanted, &report, config, game)?;
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
        // The stored one is no better - the repair has already written - so it
        // goes, and the next sweep owes this mod a check.
        if budget.is_cancelled() {
            self.forget_health_check(&storage_dir, mod_id);
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
    ///
    /// # Errors
    ///
    /// Fails only for what stops the whole run before it starts: the hashtables
    /// not being there. Stated once here as well as per mod, because a reader
    /// who pressed Repair all is owed the one sentence that is true of every
    /// mod in it rather than the same failure counted back at them.
    pub fn repair_mods(
        &self,
        config: &Config,
        mod_ids: &[String],
    ) -> AppResult<LibraryRepairReport> {
        if !self.hashtables_ready() {
            return Err(self.no_hashtables(Refused::Repair));
        }

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
                // Classified here rather than after the run: a mod that failed
                // on its own at second one is not a mod the cancel at second
                // thirty stopped, and filing it under `cancelled` would lose it.
                match repaired {
                    Ok(report) => ModOutcome::Done(report),
                    Err(_) if budget.is_cancelled() => ModOutcome::Cancelled,
                    Err(e) => ModOutcome::Failed(e.to_string()),
                }
            },
        );
        self.end_health_run(&budget);

        let mut report = LibraryRepairReport::default();
        for (mod_id, outcome) in mod_ids.iter().zip(outcomes) {
            match outcome {
                Some(ModOutcome::Done(fixes)) if fixes.applied > 0 => {
                    report.applied += fixes.applied;
                    report.repaired.push(mod_id.clone());
                }
                Some(ModOutcome::Done(_)) => report.unchanged.push(mod_id.clone()),
                Some(ModOutcome::Failed(error)) => {
                    tracing::warn!("Could not repair mod {mod_id}: {error}");
                    report.failed.push(ModRepairFailure {
                        mod_id: mod_id.clone(),
                        error,
                    });
                }
                /* Cancelled while this mod ran, or before it was picked up. */
                Some(ModOutcome::Cancelled) | None => report.cancelled.push(mod_id.clone()),
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
        Ok(report)
    }

    /// Unpack `archive` into `staging`, fix what the rules find, and put the
    /// repaired result where the archive was.
    ///
    /// A run that applies nothing leaves the archive alone: rewriting would
    /// turn the same content into different bytes for no reader's benefit.
    fn repair_in_staging(
        &self,
        config: &Config,
        staging: &Path,
        archive: &Path,
        budget: &Budget,
    ) -> AppResult<(FixReport, problems::Run)> {
        let staging_utf8 = self.unpack_for_rules(staging, archive)?;
        let game = self.game_content(config);
        let run = problems::analyze_within(staging, config, budget.clone(), game.clone())?;
        let wanted = run.live_fixable();
        let resolver = self.wad_resolver();
        let report = problems::apply(
            staging,
            &run,
            &wanted,
            config,
            Some(resolver.as_ref()),
            game.clone(),
        )?;
        if report.applied == 0 {
            return Ok((report, run));
        }

        write_repaired(staging, &staging_utf8, archive, &report)?;

        let checked = verified(staging, run, &wanted, &report, config, game)?;
        Ok((report, checked))
    }

    /// Unpack `archive` into `staging` as the project the rules read.
    ///
    /// A repair writes through a project root, so an archive-storage mod has
    /// to be materialized before a fix can be applied to it. A check does not,
    /// and reads the archive where it lies.
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

/// What one mod of a library-wide repair became.
///
/// Its own type rather than a `Result`, because "called off" is neither a
/// success nor a failure and the run has to keep the three apart.
#[derive(Debug)]
enum ModOutcome {
    Done(FixReport),
    /// The run was called off before this mod finished.
    Cancelled,
    Failed(String),
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
/// [`FixReport::remaining`] is what a second analyze would find, and re-parsing
/// every bin to discover it would be a full pass for nothing.
///
/// A rule that stopped is the exception. It never reached the files after the
/// one it stopped on, so their problems are neither applied nor reported as
/// left, and subtracting them would call a mod healthy that was never touched.
/// That run re-reads the project rather than deriving anything.
fn verified(
    project_root: &Path,
    run: problems::Run,
    wanted: &[problems::ProblemId],
    report: &FixReport,
    config: &Config,
    game: Option<std::sync::Arc<dyn problems::GameContent>>,
) -> AppResult<problems::Run> {
    if !report.failed.is_empty() {
        return problems::analyze(project_root, config, game);
    }

    let repaired: Vec<problems::ProblemId> = wanted
        .iter()
        .filter(|id| !report.remaining.contains(id))
        .cloned()
        .collect();
    Ok(run.without(&repaired))
}

/// Put what the fix run wrote in `staging` back into `archive`.
///
/// An edit rewrites the fixed chunks and entries and raw-copies the rest, so it
/// costs what changed where a repack costs everything the mod holds. Refused
/// before anything is written for an archive `ltk_fantome` will not edit - most
/// often one shipping its WADs as loose files, which have no packed bytes to
/// rebase - and the repack is what answers for those.
fn write_repaired(
    staging: &Path,
    staging_utf8: &Utf8Path,
    archive: &Path,
    report: &FixReport,
) -> AppResult<()> {
    let archive_utf8 = archive.try_as_utf8("mod archive")?;
    let edited =
        RepairEdit::read(staging, archive_utf8, report).and_then(|edit| edit.apply(archive_utf8));

    match edited {
        Ok(written) => {
            tracing::debug!(
                "Edited {archive_utf8} across {} WADs: {} chunks and {} entries written, {} chunks and {} entries removed",
                written.wads_rebased,
                written.chunks_replaced,
                written.entries_replaced,
                written.chunks_removed,
                written.entries_removed
            );
            Ok(())
        }
        Err(error) => {
            tracing::info!("Repacking {archive_utf8} rather than editing it: {error}");
            repack(staging, staging_utf8, archive)
        }
    }
}

/// Pack the staged project over `archive`, whole.
fn repack(staging: &Path, staging_utf8: &Utf8Path, archive: &Path) -> AppResult<()> {
    let project = load_mod_project(staging)?;
    let repacked = archive.with_extension("repacked");
    let writer = BufWriter::new(fs::File::create(&repacked)?);
    ltk_mod_project::ProjectPacker::new(project, staging_utf8.to_path_buf())
        .pack(FantomeFormat::new(writer))
        .map_err(|e| AppError::PackFailed(e.to_string()))
        .inspect_err(|_| {
            let _ = fs::remove_file(&repacked);
        })?;

    swap_in_repacked(&repacked, archive)
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
