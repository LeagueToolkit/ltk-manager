//! Switching one mod between its archive and an unpacked project.
//!
//! ADR-0003 left both storage modes live at once, and ADR-0007 made the
//! archive the install default. This is the switch between them, per mod,
//! after the fact.
//!
//! Unpacking consumes the archive —
//! [`ProjectImporter`](ltk_mod_project::ProjectImporter) writes a fresh project
//! into staging, the user's own metadata is carried across, the two directories
//! swap, and the archive is deleted: the tree carries everything it did, and
//! keeping both would double the mod on disk. Repacking is the way back —
//! [`ProjectPacker`](ltk_mod_project::ProjectPacker) packs the tree into a
//! fresh archive, the same way a repair of an `archive` mod does, and the
//! `content/` tree goes. What the fantome format can carry back is the pack
//! format's contract, not decided here.
//!
//! Exactly one of the two — the tree or the archive — is the mod at any
//! moment, so neither direction needs the other's leftovers to exist.

use crate::config::Config;
use crate::error::{AppError, AppResult, IoContext, Utf8PathExt};
use crate::events::{
    BackendEvent, EventSink, FantomeImportProgress, FantomeImportStage, ModStorageProgress,
};
use crate::mods::ModLibrary;
use crate::mods::StorageLayout as _;
use crate::mods::archive::install::STAGING_PREFIX;
use crate::mods::archive::metadata::{load_mod_project, read_installed_mod};
use crate::mods::index::{LibraryIndex, LibraryModEntry, ModStorage, get_active_profile};
use crate::mods::long_paths;
use crate::mods::types::InstalledMod;
use crate::utils::fs::replace_keeping_old;
use fs_err as fs;
use ltk_mod_project::fantome::{FantomeFormat, FantomeImporter};
use ltk_mod_project::{ModProject, ProjectImporter, ProjectPacker};
use std::collections::HashMap;
use std::io::BufWriter;
use std::path::{Path, PathBuf};
use uuid::Uuid;

impl ModLibrary {
    /// Read one mod's content from the other place from now on.
    ///
    /// Unpacking materializes the archive as a mod project and deletes the
    /// archive, repacking packs the tree back into a fresh archive and throws
    /// the tree away. Either way the mod keeps its id, its slug, its place in
    /// every profile, and the metadata the user edited.
    ///
    /// A mod already stored the way `storage` asks for is returned untouched.
    ///
    /// # Errors
    ///
    /// Fails when the mod is not in the library, is still in the legacy layout, is a modpkg
    /// (whose content only exists inside its archive), or asks to unpack with
    /// no archive to read.
    pub fn set_mod_storage(
        &self,
        config: &Config,
        mod_id: &str,
        storage: ModStorage,
    ) -> AppResult<InstalledMod> {
        let storage_dir = self.storage_dir(config)?;
        let entry = self.with_index(config, |_storage_dir, index| {
            index
                .mods
                .iter()
                .find(|m| m.id == mod_id)
                .cloned()
                .ok_or_else(|| AppError::ModNotFound(mod_id.to_string()))
        })?;

        if entry.storage == storage {
            return self.read_one_mod(config, mod_id);
        }

        // Ahead of any report, so a mod that cannot convert at all fails through
        // the call's own error rather than through a toast that opened and then
        // said nothing. Only an unpack needs the archive on disk — a repack
        // builds a fresh one from the tree.
        match storage {
            ModStorage::Project => drop(entry.convertible_archive(&storage_dir)?),
            ModStorage::Archive => entry.convertible()?,
        }

        let report = ConversionReport {
            events: self.events().as_ref(),
            mod_id,
            storage,
        };

        if let Err(e) = self.convert(config, &storage_dir, &entry, &report) {
            report.stage(FantomeImportStage::Error);
            return Err(e);
        }

        report.stage(FantomeImportStage::Complete);
        self.invalidate_overlay_for(&storage_dir, &[mod_id.to_string()]);
        tracing::info!("Mod {mod_id} now reads from its {storage:?}");

        self.read_one_mod(config, mod_id)
    }

    /// Write the mod's content into the shape `report.storage` names, and record
    /// it on the entry.
    ///
    /// Split from [`set_mod_storage`](Self::set_mod_storage) so every failure
    /// past the point a conversion was announced leaves through one arm, which
    /// is what the closing report hangs off.
    fn convert(
        &self,
        config: &Config,
        storage_dir: &Path,
        entry: &LibraryModEntry,
        report: &ConversionReport<'_>,
    ) -> AppResult<()> {
        let mod_id = entry.id.as_str();
        let storage = report.storage;
        let archive = entry.archive_path(storage_dir);

        // Either direction's slow half runs outside the index lock: unpacking
        // writes a whole content tree, repacking reads one back into an
        // archive. Staging first is the same split the install path makes,
        // for the same reason.
        let staged = match storage {
            ModStorage::Project => Staged::Tree(stage_unpacked(
                storage_dir,
                &archive,
                &entry.mod_dir(storage_dir),
                self.wad_resolver().as_ref(),
                report,
            )?),
            ModStorage::Archive => {
                // The pack has no per-unit count to give, so it reports the
                // one step it is.
                report.stage(FantomeImportStage::Finalizing);
                Staged::Archive(stage_packed(storage_dir, &entry.mod_dir(storage_dir))?)
            }
        };

        // Only the move and the field it makes true belong in here. Reading the
        // mod back is a separate call because a failure to read it must not
        // roll back a save: the files have moved by then, and an index that
        // still names the other mode would send the provider to the wrong one.
        let moved = self.mutate_index(config, |storage_dir, index| {
            let Some(entry) = index.mods.iter_mut().find(|m| m.id == mod_id) else {
                return Err(AppError::ModNotFound(mod_id.to_string()));
            };

            let mod_dir = entry.mod_dir(storage_dir);
            match &staged {
                Staged::Tree(staging_dir) => swap_in_unpacked(staging_dir, &mod_dir)?,
                Staged::Archive(staged_archive) => {
                    swap_in_packed(staged_archive, &archive)?;
                    drop_unpacked_content(&mod_dir)?;
                }
            }
            entry.storage = storage;
            Ok(())
        });

        if let Err(e) = moved {
            staged.discard();
            return Err(e);
        }

        // The tree is the mod now, and the archive would be a second copy of
        // it on disk. Best-effort: a copy that survives is stale bytes the
        // next repack replaces.
        if storage == ModStorage::Project
            && let Err(e) = fs::remove_file(&archive)
        {
            tracing::warn!(
                "Failed to remove the unpacked mod's archive at {}: {}",
                archive.display(),
                e
            );
        }

        Ok(())
    }

    /// One mod as the library shows it, under the active profile.
    fn read_one_mod(&self, config: &Config, mod_id: &str) -> AppResult<InstalledMod> {
        self.with_index(config, |storage_dir, index| {
            let entry = index
                .mods
                .iter()
                .find(|m| m.id == mod_id)
                .ok_or_else(|| AppError::ModNotFound(mod_id.to_string()))?;
            let (enabled, layer_states) = index.profile_state(mod_id);
            read_installed_mod(entry, enabled, storage_dir, layer_states)
        })
    }
}

/// What a conversion's slow half left beside the index, per direction.
#[derive(Debug)]
enum Staged {
    /// An unpacked project at `mods/.staging-<uuid>/`.
    Tree(PathBuf),
    /// A packed archive at `mods/.staging-<uuid>.fantome`.
    Archive(PathBuf),
}

impl Staged {
    /// Delete what staging left, for a swap that could not finish.
    fn discard(&self) {
        let _ = match self {
            Staged::Tree(dir) => fs::remove_dir_all(dir),
            Staged::Archive(file) => fs::remove_file(file),
        };
    }
}

/// Announces one conversion as it runs.
///
/// Carries the mod and the direction so the steps that report do not each take
/// them as arguments, and so nothing halfway down can announce the wrong mod.
struct ConversionReport<'a> {
    events: &'a dyn EventSink,
    mod_id: &'a str,
    storage: ModStorage,
}

impl ConversionReport<'_> {
    /// Report a step that has no count of its own.
    fn stage(&self, stage: FantomeImportStage) {
        self.emit(ModStorageProgress::new(self.mod_id, self.storage, stage));
    }

    /// Forward one of the importer's own reports, naming this conversion.
    ///
    /// Its `Complete` is dropped rather than forwarded: the importer is done
    /// once the tree is written, and the conversion only once the directories
    /// have swapped.
    fn imported(&self, progress: FantomeImportProgress) {
        if progress.stage == FantomeImportStage::Complete {
            return;
        }

        self.emit(ModStorageProgress {
            current_item: progress.current_item,
            ..ModStorageProgress::new(self.mod_id, self.storage, progress.stage)
                .at(progress.current, progress.total)
        });
    }

    fn emit(&self, progress: ModStorageProgress) {
        self.events.emit(BackendEvent::ModStorageProgress(progress));
    }
}

impl LibraryIndex {
    /// What the active profile says about one mod: enabled, and its layer states.
    ///
    /// An index with no active profile reports the mod disabled with no layer
    /// states, which is what a conversion carries across when there is no
    /// profile to read.
    pub(in crate::mods) fn profile_state(
        &self,
        mod_id: &str,
    ) -> (bool, Option<&HashMap<String, bool>>) {
        match get_active_profile(self) {
            Ok(profile) => (
                profile.enabled_mods.iter().any(|id| id == mod_id),
                profile.layer_states.get(mod_id),
            ),
            Err(_) => (false, None),
        }
    }
}

impl LibraryModEntry {
    /// Whether this mod can change storage at all, whatever is on disk.
    ///
    /// # Errors
    ///
    /// Fails with [`AppError::ValidationFailed`] carrying what the user should
    /// do about it: a mod still in the legacy layout, or a format with no
    /// unpacked form.
    pub(in crate::mods) fn convertible(&self) -> AppResult<()> {
        // "Legacy is transient": ADR-0008.
        if self.slug.is_none() {
            return Err(AppError::ValidationFailed(
                "This mod has not moved to the new library layout yet. It will be retried at the next launch.".to_string(),
            ));
        }

        if !self.format.is_convertible() {
            return Err(AppError::ValidationFailed(
                "A .modpkg is read straight out of its archive and has no unpacked form."
                    .to_string(),
            ));
        }

        Ok(())
    }

    /// The archive an unpack reads from, or why this mod has none.
    ///
    /// # Errors
    ///
    /// As [`convertible`](Self::convertible), plus a mod whose archive is not
    /// on disk.
    pub(in crate::mods) fn convertible_archive(&self, storage_dir: &Path) -> AppResult<PathBuf> {
        self.convertible()?;

        let archive = self.archive_path(storage_dir);
        if !archive.is_file() {
            return Err(AppError::ValidationFailed(
                "This mod has no archive beside it, so there is nothing to read. \
                 Install it again to get one."
                    .to_string(),
            ));
        }

        Ok(archive)
    }
}

/// Unpack `archive` into a staging directory, carrying `mod_dir`'s edits across.
///
/// Returns the staging directory, which the caller renames into place under the
/// index lock.
fn stage_unpacked(
    storage_dir: &Path,
    archive: &Path,
    mod_dir: &Path,
    resolver: &dyn ltk_wad::PathResolver,
    report: &ConversionReport<'_>,
) -> AppResult<PathBuf> {
    let staging_dir = storage_dir
        .mods_dir()
        .join(format!("{STAGING_PREFIX}{}", Uuid::new_v4()));
    fs::create_dir_all(&staging_dir)?;

    unpack_into(&staging_dir, archive, mod_dir, resolver, report).inspect_err(|_| {
        let _ = fs::remove_dir_all(&staging_dir);
    })?;

    Ok(staging_dir)
}

fn unpack_into(
    staging_dir: &Path,
    archive: &Path,
    mod_dir: &Path,
    resolver: &dyn ltk_wad::PathResolver,
    report: &ConversionReport<'_>,
) -> AppResult<()> {
    // Both guards answer for `mod_dir`, which is where the staged tree is
    // renamed onto once the index lock is held.
    long_paths::preflight_fantome_import(archive, mod_dir, long_paths::ImportRoot::ModStorage)?;

    let utf8_staging = staging_dir
        .to_path_buf()
        .try_into_utf8("staging directory")?;
    let current = load_mod_project(mod_dir).ok();

    ProjectImporter::new(&utf8_staging)
        .with_config(|imported| {
            if let Some(current) = current {
                carry_over_edits(imported, current);
            }
        })
        .import_with_progress(
            FantomeImporter::new(fs::File::open(archive)?).with_path_resolver(resolver),
            &mut |progress| report.imported(progress.into()),
        )
        .map_err(|e| AppError::Other(format!("Failed to import fantome archive: {e}")))?;

    long_paths::verify_staged(staging_dir, mod_dir, long_paths::ImportRoot::ModStorage)?;

    carry_over_files(mod_dir, staging_dir);

    Ok(())
}

/// Keep what the user set on a mod, over what its archive says about itself.
///
/// A fresh import describes the archive, so without this an unpack silently
/// reverts every rename and every category the user typed. Layers are not among
/// them: they came from the archive in the first place, and the tree just
/// written is what carries them.
fn carry_over_edits(imported: &mut ModProject, current: ModProject) {
    imported.display_name = current.display_name;
    imported.tags = current.tags;
    imported.champions = current.champions;
    imported.maps = current.maps;
}

/// Move across every file sitting beside the mod's config, over anything the
/// import wrote under the same name.
///
/// The directory is what the mod is showing right now — the thumbnail the user
/// chose, the readme they wrote — and the archive is where all of it came from
/// in the first place. Losing one to a conversion of the same mod would be a
/// deletion the user did not ask for. `mod.config.json` is the exception: the
/// merged one is already written.
fn carry_over_files(mod_dir: &Path, staging_dir: &Path) {
    let Ok(entries) = fs::read_dir(mod_dir) else {
        return;
    };

    for entry in entries.flatten() {
        let name = entry.file_name();
        if name == "mod.config.json" || !entry.path().is_file() {
            continue;
        }
        if let Err(e) = fs::copy(entry.path(), staging_dir.join(&name)) {
            tracing::warn!(
                "Failed to carry {} into the unpacked mod: {}",
                name.display(),
                e
            );
        }
    }
}

/// Put the unpacked project where the old directory was, keeping the old one
/// until the new one is in place.
///
/// The directory moved aside keeps the staging prefix, so a crash between the
/// two renames leaves something the startup sweep clears and directory
/// discovery ignores, rather than a second copy of the mod to adopt.
fn swap_in_unpacked(staging_dir: &Path, mod_dir: &Path) -> AppResult<()> {
    replace_keeping_old(
        staging_dir,
        mod_dir,
        &staging_dir.with_extension("replaced"),
        ("mod directory", "unpacked mod"),
    )
}

/// Pack the mod's tree into a staged archive, for the swap under the lock.
///
/// Each `.wad.client` directory becomes one stored WAD entry, which is the
/// shape distributed mods have and the one a repair can edit in place rather
/// than pack again.
fn stage_packed(storage_dir: &Path, mod_dir: &Path) -> AppResult<PathBuf> {
    let staged = storage_dir
        .mods_dir()
        .join(format!("{STAGING_PREFIX}{}.fantome", Uuid::new_v4()));

    let project = load_mod_project(mod_dir)?;
    let root = mod_dir.to_path_buf().try_into_utf8("mod directory")?;
    let writer = BufWriter::new(fs::File::create(&staged)?);
    ProjectPacker::new(project, root)
        .pack(FantomeFormat::new(writer))
        .map_err(|e| AppError::PackFailed(e.to_string()))
        .inspect_err(|_| {
            let _ = fs::remove_file(&staged);
        })?;

    Ok(staged)
}

/// Put the packed archive where the mod's archive belongs, keeping whatever
/// was there until the new one is in place.
///
/// A leftover archive can be standing there — one an unpack failed to delete —
/// and a fresh repack usually finds nothing at all.
fn swap_in_packed(staged: &Path, archive: &Path) -> AppResult<()> {
    replace_keeping_old(
        staged,
        archive,
        &staged.with_extension("replaced"),
        ("archive", "packed archive"),
    )
}

/// Delete the unpacked tree, leaving the config and thumbnail the library reads.
fn drop_unpacked_content(mod_dir: &Path) -> AppResult<()> {
    let content = mod_dir.join("content");
    if content.is_dir() {
        fs::remove_dir_all(&content).context("Failed to remove the unpacked content")?;
    }

    Ok(())
}

#[cfg(test)]
mod tests;
