//! Repairing an archive-storage fantome in place.
//!
//! A mod stored as its archive has no tree the Problems engine can write to,
//! so a repair reads the archive where it lies, as the check does, holds every
//! fix the rules derive, and edits what changed back into the archive. The
//! library keeps reading the same path, and the mod stays in Archive storage
//! throughout. An archive the edit refuses goes the long way round instead:
//! unpacked into staging, fixed there, and repacked whole - ADR-0025.
//! Replacing the archive, and keeping no copy of the original, is ADR-0005.
//!
//! A modpkg has no edit, so a repair writes the package again from its own
//! chunks, with the fixed files in place of the chunks they replace - ADR-0075.

use crate::mods::ModLibrary;
use crate::mods::StorageLayout as _;
use crate::mods::archive::install::STAGING_PREFIX;
use crate::mods::archive::metadata::load_mod_project;
use crate::mods::health::{Refused, cancelled};
use crate::mods::index::ModArchiveFormat;
use camino::Utf8Path;
use delta::RepairEdit;
use fs_err as fs;
use ltk_fantome::DeltaReport;
use ltk_hashtable::{Hashtable, HashtableEntry};
use ltk_manager_assets::mod_archive::{open_fantome, open_modpkg};
use ltk_manager_base::budget::{self, Budget};
use ltk_manager_base::config::Config;
use ltk_manager_base::error::{AppError, AppResult, Utf8PathExt, Utf8PathRefExt};
use ltk_manager_base::events::ModStorage;
use ltk_manager_base::events::{BackendEvent, ModRepairProgress};
use ltk_manager_base::utils::fs::replace_keeping_old;
use ltk_manager_problems::{self as problems, FixReport, GameContent, HeldWrites, ProjectFiles};
use ltk_mod_project::ProjectImporter;
use ltk_mod_project::fantome::{FantomeFormat, FantomeImporter};
use ltk_wad::PathResolver;
use serde::Serialize;
use std::io::BufWriter;
use std::path::Path;
use std::sync::Arc;
use uuid::Uuid;

mod delta;
mod modpkg;

/// What one repair over several mods became of each of them.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
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
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct ModRepairFailure {
    pub mod_id: String,
    pub error: String,
}

impl ModLibrary {
    /// Repair what a machine can repair in one library mod.
    ///
    /// A Project-storage mod is repaired in its own tree. An Archive-storage
    /// fantome is fixed in its archive, and an Archive-storage modpkg is
    /// written again from its own chunks. Either way, a mod with nothing to
    /// fix is left untouched, and no repair is reversible - what a repair
    /// keeps is the names it hashed away, per ADR-0006.
    ///
    /// # Errors
    ///
    /// Fails when the mod is not in the library, when it is stored as an
    /// archive it does not have, and when the hashtables are not there - see
    /// [`hashtables_ready`](Self::hashtables_ready).
    pub fn repair_mod(&self, config: &Config, mod_id: &str) -> AppResult<FixReport> {
        /* A budget of its own, and not the run's: one mod from a row can be
        pressed while the startup sweep is going, and taking the run's handle
        would leave the sweep's cancel reaching nothing. */
        self.repair_mod_within(config, mod_id, Repair::Fixes, &Budget::repair())
    }

    /// Applies one alternative of one problem in one library mod.
    ///
    /// The alternative goes through the same fix run as [`repair_mod`](Self::repair_mod),
    /// for both storages, and the verdict is recorded the same way. A problem that the
    /// mod's fresh check does not report with the alternative is not applied.
    ///
    /// # Errors
    ///
    /// The same as [`repair_mod`](Self::repair_mod).
    pub fn repair_mod_alternative(
        &self,
        config: &Config,
        mod_id: &str,
        chosen: problems::ChosenAlternative<'_>,
    ) -> AppResult<FixReport> {
        self.repair_mod_within(
            config,
            mod_id,
            Repair::Alternative(chosen),
            &Budget::repair(),
        )
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
        repair: Repair<'_>,
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
                let wanted = repair.wanted(&run);
                let resolver = self.wad_resolver();
                let report = repair.apply(
                    &mod_dir,
                    &run,
                    &wanted,
                    config,
                    Some(resolver.as_ref()),
                    game.clone(),
                )?;
                let checked = verified(run, &wanted, &report, || {
                    problems::analyze(&mod_dir, config, game)
                })?;
                (report, checked)
            }
            ModStorage::Archive if entry.format == ModArchiveFormat::Modpkg => {
                let archive = entry.present_archive(&storage_dir)?;
                self.repair_in_modpkg(config, &archive, repair, budget)?
            }
            ModStorage::Archive => {
                let archive = entry.convertible_archive(&storage_dir)?;
                match self.repair_in_archive(config, &archive, repair, budget)? {
                    Some(outcome) => outcome,
                    None => {
                        let staging = storage_dir
                            .mods_dir()
                            .join(format!("{STAGING_PREFIX}{}", Uuid::new_v4()));
                        fs::create_dir_all(&staging)?;
                        let outcome =
                            self.repair_in_staging(config, &staging, &archive, repair, budget);
                        let _ = fs::remove_dir_all(&staging);
                        outcome?
                    }
                }
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
                let repaired = self.repair_mod_within(config, mod_id, Repair::Fixes, &budget);
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

    /// Fix what the rules find in `archive` where it lies, and edit the fixed
    /// files back in.
    ///
    /// `None` where the edit refused the archive, which is the fallback's cue
    /// and comes before anything is written - ADR-0025. A run that applies
    /// nothing leaves the archive alone: rewriting would turn the same content
    /// into different bytes for no reader's benefit.
    fn repair_in_archive(
        &self,
        config: &Config,
        archive: &Path,
        repair: Repair<'_>,
        budget: &Budget,
    ) -> AppResult<Option<(FixReport, problems::Run)>> {
        let game = self.game_content(config);
        let resolver = self.wad_resolver();
        let project = ProjectFiles::in_archive(
            archive,
            config,
            budget.clone(),
            resolver.as_ref(),
            game.clone(),
        )?;
        let run = project.checked();
        let wanted = repair.wanted(&run);
        let declared = open_fantome(archive)?.read_hashtables()?;
        let (report, writes) = repair.apply_held(
            project,
            declared,
            &run,
            &wanted,
            config,
            Some(resolver.as_ref()),
            game.clone(),
        )?;
        if report.applied == 0 {
            return Ok(Some((report, run)));
        }

        let archive_utf8 = archive.try_as_utf8("mod archive")?;
        let edited = RepairEdit::held(&writes, archive_utf8, &report)
            .and_then(|edit| edit.apply(archive_utf8));
        match edited {
            Ok(written) => report_edit(archive_utf8, &written),
            Err(error) => {
                tracing::info!(
                    "Unpacking {archive_utf8} to repair it, since the edit refused it: {error}"
                );
                return Ok(None);
            }
        }

        let checked = verified(run, &wanted, &report, || {
            problems::analyze_archive(archive, config, budget.clone(), resolver.as_ref(), game)
        })?;
        Ok(Some((report, checked)))
    }

    /// Fix what the rules find in the modpkg at `archive`, and write the
    /// package again with the fixed files in place.
    ///
    /// A run that applies nothing leaves the package alone, as
    /// [`repair_in_archive`](Self::repair_in_archive) does. The new package is
    /// written beside the old one and swapped in once it is whole - ADR-0005.
    fn repair_in_modpkg(
        &self,
        config: &Config,
        archive: &Path,
        repair: Repair<'_>,
        budget: &Budget,
    ) -> AppResult<(FixReport, problems::Run)> {
        let game = self.game_content(config);
        let resolver = self.wad_resolver();
        let project = ProjectFiles::in_modpkg(archive, config, budget.clone(), game.clone())?;
        let run = project.checked();
        let wanted = repair.wanted(&run);
        let declared = open_modpkg(archive)?.load_hashtables()?;
        let (report, writes) = repair.apply_held(
            project,
            declared,
            &run,
            &wanted,
            config,
            Some(resolver.as_ref()),
            game.clone(),
        )?;
        if report.applied == 0 {
            return Ok((report, run));
        }

        let repacked = archive.with_extension("repacked");
        modpkg::rewrite(archive, &repacked, &writes, &report).inspect_err(|_| {
            let _ = fs::remove_file(&repacked);
        })?;
        swap_in_repacked(&repacked, archive)?;
        tracing::debug!(
            "Rewrote {} with {} files repaired",
            archive.display(),
            report.files.len()
        );

        let checked = verified(run, &wanted, &report, || {
            problems::analyze_modpkg(archive, config, budget.clone(), game)
        })?;
        Ok((report, checked))
    }

    /// Unpack `archive` into `staging`, fix what the rules find, and put the
    /// repaired result where the archive was.
    ///
    /// The long way round, for an archive the edit refuses. A run that applies
    /// nothing leaves the archive alone, as
    /// [`repair_in_archive`](Self::repair_in_archive) does.
    fn repair_in_staging(
        &self,
        config: &Config,
        staging: &Path,
        archive: &Path,
        repair: Repair<'_>,
        budget: &Budget,
    ) -> AppResult<(FixReport, problems::Run)> {
        let staging_utf8 = self.unpack_for_rules(staging, archive)?;
        let game = self.game_content(config);
        let run = problems::analyze_within(staging, config, budget.clone(), game.clone())?;
        let wanted = repair.wanted(&run);
        let resolver = self.wad_resolver();
        let report = repair.apply(
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

        let checked = verified(run, &wanted, &report, || {
            problems::analyze(staging, config, game)
        })?;
        Ok((report, checked))
    }

    /// Unpack `archive` into `staging` as the project the rules read.
    ///
    /// The long way round, for an archive the edit refuses - ADR-0025. A
    /// repair the edit takes reads the archive where it lies, as a check does.
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

/// What a repair of one mod applies.
#[derive(Debug, Clone, Copy)]
pub(in crate::mods) enum Repair<'a> {
    /// Every live fix, as "Repair" and "Repair all" apply.
    Fixes,
    /// One alternative of one problem, which only a press of the alternative applies.
    Alternative(problems::ChosenAlternative<'a>),
}

impl Repair<'_> {
    /// Returns the problems of `run` that the repair names.
    fn wanted(self, run: &problems::Run) -> Vec<problems::ProblemId> {
        match self {
            Self::Fixes => run.live_fixable(),
            Self::Alternative(chosen) => vec![chosen.problem.clone()],
        }
    }

    /// Applies the repair over the tree at `root`.
    fn apply(
        self,
        root: &Path,
        run: &problems::Run,
        wanted: &[problems::ProblemId],
        config: &Config,
        exclusions: Option<&dyn PathResolver>,
        game: Option<Arc<dyn GameContent>>,
    ) -> AppResult<FixReport> {
        match self {
            Self::Fixes => problems::apply(root, run, wanted, config, exclusions, game),
            Self::Alternative(chosen) => {
                problems::apply_alternative(root, run, chosen, config, exclusions, game)
            }
        }
    }

    /// Applies the repair over the files a check read where they lie, and keeps every write in memory.
    #[expect(
        clippy::too_many_arguments,
        reason = "the arguments of `problems::apply_held` and the repair itself"
    )]
    fn apply_held(
        self,
        project: ProjectFiles,
        declared: Vec<(HashtableEntry, Hashtable)>,
        run: &problems::Run,
        wanted: &[problems::ProblemId],
        config: &Config,
        exclusions: Option<&dyn PathResolver>,
        game: Option<Arc<dyn GameContent>>,
    ) -> AppResult<(FixReport, HeldWrites)> {
        match self {
            Self::Fixes => {
                problems::apply_held(project, declared, run, wanted, config, exclusions, game)
            }
            Self::Alternative(chosen) => problems::apply_alternative_held(
                project, declared, run, chosen, config, exclusions, game,
            ),
        }
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
    in_flight: parking_lot::Mutex<Vec<String>>,
}

impl RunProgress {
    fn new(total: usize) -> Self {
        Self {
            total,
            completed: std::sync::atomic::AtomicUsize::new(0),
            in_flight: parking_lot::Mutex::new(Vec::new()),
        }
    }

    /// Report that `mod_id` has been picked up.
    fn begin(&self, mod_id: &str, emit: impl FnOnce(ModRepairProgress)) {
        self.in_flight.lock().push(mod_id.to_owned());
        emit(self.at());
    }

    /// Report that `mod_id` is done, however it turned out.
    fn end(&self, mod_id: &str, emit: impl FnOnce(ModRepairProgress)) {
        self.completed
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        {
            // `at` takes the same lock, so the guard goes out of scope first.
            let mut open = self.in_flight.lock();
            if let Some(at) = open.iter().position(|held| held == mod_id) {
                open.remove(at);
            }
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
            in_flight: self.in_flight.lock().clone(),
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
/// That run re-reads the mod through `reread` rather than deriving anything.
fn verified(
    run: problems::Run,
    wanted: &[problems::ProblemId],
    report: &FixReport,
    reread: impl FnOnce() -> AppResult<problems::Run>,
) -> AppResult<problems::Run> {
    // A rule that skips records a count against the file and not a
    // `ProblemId`, because `FixRun::left` takes a bin node address a file-level
    // finding has none of. So `remaining` names bin properties and nothing
    // else, and `audio/bank-version` refusing at fix time - its guard re-reads
    // the install, which may answer differently than it did at check time -
    // would subtract as repaired. Re-read the mod whenever anything was
    // skipped, rather than guessing which kind of skip it was.
    if !report.failed.is_empty() || report.skipped > 0 {
        return reread();
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
            report_edit(archive_utf8, &written);
            Ok(())
        }
        Err(error) => {
            tracing::info!("Repacking {archive_utf8} rather than editing it: {error}");
            repack(staging, staging_utf8, archive)
        }
    }
}

/// Log what an edit of `archive` wrote.
fn report_edit(archive: &Utf8Path, written: &DeltaReport) {
    tracing::debug!(
        "Edited {archive} across {} WADs: {} chunks and {} entries written, {} chunks and {} entries removed",
        written.wads_rebased,
        written.chunks_replaced,
        written.entries_replaced,
        written.chunks_removed,
        written.entries_removed
    );
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
    replace_keeping_old(
        repacked,
        archive,
        &archive.with_extension("replaced"),
        ("archive", "repaired archive"),
    )
}

#[cfg(test)]
mod tests;
