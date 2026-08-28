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
use crate::mods::index::ModStorage;
use crate::problems::{self, FixReport};
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
                let run = problems::analyze(&mod_dir, config)?;
                let wanted = run.live_fixable();
                let report = problems::apply(&mod_dir, &run, &wanted, config)?;
                let checked = verified(&mod_dir, run, &wanted, &report, config)?;
                (report, checked)
            }
            ModStorage::Archive => {
                let archive = entry.convertible_archive(&storage_dir)?;
                let staging = storage_dir
                    .join("mods")
                    .join(format!("{STAGING_PREFIX}{}", Uuid::new_v4()));
                fs::create_dir_all(&staging)?;
                let outcome = self.repair_in_staging(config, &staging, &archive);
                let _ = fs::remove_dir_all(&staging);
                outcome?
            }
        };

        // The repair just analyzed the mod either way, so the verdict the
        // badge reads is refreshed here rather than by a second scan.
        if let Err(e) = self.record_health_check(config, &storage_dir, mod_id, &checked) {
            tracing::warn!("Repaired mod {mod_id} but could not store its verdict: {e}");
        }

        if report.applied > 0 {
            self.invalidate_overlay_for(&storage_dir, &[mod_id.to_string()]);
            tracing::info!("Repaired mod {mod_id}: {} fixes applied", report.applied);
        }

        Ok(report)
    }

    /// Repair each of `mod_ids`, and report what became of each.
    ///
    /// One mod that cannot be repaired is recorded and stepped over rather than
    /// ending the run.
    pub fn repair_mods(&self, config: &Config, mod_ids: &[String]) -> LibraryRepairReport {
        let mut report = LibraryRepairReport::default();

        for (i, mod_id) in mod_ids.iter().enumerate() {
            self.events()
                .emit(BackendEvent::ModRepairProgress(ModRepairProgress {
                    current: i + 1,
                    total: mod_ids.len(),
                    mod_id: mod_id.clone(),
                }));

            match self.repair_mod(config, mod_id) {
                Ok(fixes) if fixes.applied > 0 => {
                    report.applied += fixes.applied;
                    report.repaired.push(mod_id.clone());
                }
                Ok(_) => report.unchanged.push(mod_id.clone()),
                Err(e) => {
                    tracing::warn!("Could not repair mod {mod_id}: {e}");
                    report.failed.push(ModRepairFailure {
                        mod_id: mod_id.clone(),
                        error: e.to_string(),
                    });
                }
            }
        }

        tracing::info!(
            "Repaired {} of {} mods, {} findings applied",
            report.repaired.len(),
            mod_ids.len(),
            report.applied
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
    ) -> AppResult<(FixReport, problems::Run)> {
        let staging_utf8 = self.unpack_for_rules(staging, archive)?;
        let run = problems::analyze(staging, config)?;
        let wanted = run.live_fixable();
        let report = problems::apply(staging, &run, &wanted, config)?;
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

        let checked = verified(staging, run, &wanted, &report, config)?;
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

/// What the project reads as once `report` has landed, for the verdict.
///
/// A repair that applied every problem it named left exactly those gone, so the
/// run it would produce is derivable and re-parsing every bin to discover it is
/// a second full analyze for nothing. Anything less than all of them - a rule
/// that stopped, a file that no longer matched - is re-read, because the
/// arithmetic cannot say which ones survived.
fn verified(
    project_root: &Path,
    run: problems::Run,
    wanted: &[problems::ProblemId],
    report: &FixReport,
    config: &Config,
) -> AppResult<problems::Run> {
    if report.applied as usize == wanted.len() {
        return Ok(run.without(wanted));
    }
    problems::analyze(project_root, config)
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
