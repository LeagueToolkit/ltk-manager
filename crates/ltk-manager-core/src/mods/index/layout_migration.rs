//! Moving every mod off the uuid layout and onto its slug.
//!
//! A library written before this release stores each mod as
//! `archives/<uuid>.<ext>` plus a near-empty `mods/<uuid>/`. This is the one
//! pass that moves it: the metadata directory becomes `mods/<slug>/` and the
//! archive becomes `mods/<slug>.<ext>` beside it. Two renames per mod, no
//! unpack — ADR-0003.
//!
//! It runs unasked, at startup, because two renames per mod is nothing to
//! decide about. Nothing reads a half-moved library because the whole run holds
//! the index lock, which every other reader takes first.
//!
//! A mod that cannot be moved stays whole in the legacy layout, keeps working
//! out of it, and is tried again next launch — the work set is recomputed from
//! the entries still without a slug.

use crate::config::Config;
use crate::error::{AppError, AppResult, IoContext, io_context};
use crate::events::{BackendEvent, LayoutMigrationProgress};
use crate::mods::ModLibrary;
use crate::mods::StorageLayout as _;
use crate::mods::archive::metadata::{extract_metadata, fantome_layers, load_mod_project};
use crate::mods::archive::reader::open_modpkg;
use crate::mods::index::document::{archive_path, load_library_index, save_library_index};
use crate::mods::index::{LibraryModEntry, ModArchiveFormat, ModStorage};
use crate::mods::slug::{ModSlug, TakenSlugs};

use fs_err as fs;
use serde::Serialize;
use std::path::Path;

/// One mod the migration could not convert.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct FailedConversion {
    /// The mod's index id, which is also the directory the uuid layout gave it.
    pub id: String,
    /// What to call the mod in the failure list, falling back to its id.
    pub display_name: String,
    /// Why it could not be moved, in the words the user reads.
    pub error: String,
}

/// What one migration run did.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct LayoutMigrationReport {
    /// How many mods reached the slug layout.
    pub migrated: usize,
    /// The mods that did not, each naming where its files went instead.
    pub failed: Vec<FailedConversion>,
}

/// What the layout migration has to say for itself this launch.
///
/// The run starts with the app, so a window that opens afterwards has no
/// [`LayoutMigrationFinished`](crate::events::BackendEvent) event to catch. It
/// asks instead, and [`Pending`](Self::Pending) is what tells it to ask again.
#[derive(Debug, Clone, Default, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum LayoutMigrationState {
    /// The startup pass has not reported yet, so the answer is still coming.
    #[default]
    Pending,
    /// It ran and had nothing to move, which is every launch after the first.
    Idle,
    /// It moved mods, and this is what became of them.
    #[serde(rename_all = "camelCase")]
    Finished { report: LayoutMigrationReport },
}

impl ModLibrary {
    /// Move every mod still in the uuid layout onto its slug, one at a time.
    ///
    /// A library with nothing pending is a no-op that announces nothing. The
    /// index is saved after every mod, so a run interrupted halfway resumes
    /// where it stopped rather than starting over.
    ///
    /// # Errors
    ///
    /// Fails only before the run starts, for an unreadable index or a storage
    /// directory that cannot be resolved. Once it is under way it always
    /// reports: a mod that could not be moved is in
    /// [`LayoutMigrationReport::failed`], and a run cut short by an unwritable
    /// index is a report covering what did move.
    pub(crate) fn migrate_library_layout(
        &self,
        config: &Config,
    ) -> AppResult<LayoutMigrationReport> {
        let _lock = self.index_lock.lock();
        let storage_dir = self.storage_dir(config)?;
        let mut index = load_library_index(&storage_dir)?;

        let pending: Vec<String> = index
            .mods
            .iter()
            .filter(|entry| entry.slug.is_none())
            .map(|entry| entry.id.clone())
            .collect();

        let total = pending.len();
        let mut report = LayoutMigrationReport {
            migrated: 0,
            failed: Vec::new(),
        };
        if total == 0 {
            self.record_layout_migration(LayoutMigrationState::Idle);
            return Ok(report);
        }

        let mut migrated_ids = Vec::new();
        let mut taken = TakenSlugs::collect(&index, &storage_dir.mods_dir());

        for (i, mod_id) in pending.iter().enumerate() {
            let Some(position) = index.mods.iter().position(|m| &m.id == mod_id) else {
                continue;
            };
            let entry = index.mods[position].clone();
            let display_name = display_name_of(&entry, &storage_dir);

            self.events().emit(BackendEvent::LayoutMigrationProgress(
                LayoutMigrationProgress {
                    current: i + 1,
                    total,
                    current_mod: display_name.clone(),
                },
            ));

            match convert_entry(&storage_dir, &entry, &taken) {
                Ok(slug) => {
                    taken.insert(&slug);
                    index.mods[position].slug = Some(slug);
                    // The archive it already read from is now beside it, so
                    // nothing was unpacked and its content is still in there.
                    index.mods[position].storage = ModStorage::Archive;

                    report.migrated += 1;
                    migrated_ids.push(entry.id.clone());
                }
                Err(e) => {
                    // The entry keeps its legacy layout and its place in the
                    // work set, so the next launch tries it again.
                    let error = e.to_string();
                    tracing::warn!(
                        "Failed to move mod {}, leaving it in the legacy layout: {}",
                        entry.id,
                        error
                    );
                    report.failed.push(FailedConversion {
                        id: entry.id.clone(),
                        display_name,
                        error,
                    });
                }
            }

            // Saved per mod, so a run interrupted halfway resumes where it
            // stopped. An index that cannot be written stops the run rather
            // than failing it: what has already moved is on disk either way,
            // and the report is what tells the user so.
            if let Err(e) = save_library_index(&storage_dir, &index) {
                tracing::error!("Stopping the layout migration: {}", e);
                break;
            }
        }

        self.invalidate_overlay_for(&storage_dir, &migrated_ids);

        // The run wrote every file in `mods/`, and the watcher is pointed at
        // it. Without this it would wake and reconcile against our own writes.
        self.stamp_mutation();

        tracing::info!(
            "Moved {} mods onto the slug layout, {} failed",
            report.migrated,
            report.failed.len()
        );
        self.record_layout_migration(LayoutMigrationState::Finished {
            report: report.clone(),
        });
        self.events()
            .emit(BackendEvent::LayoutMigrationFinished(report.clone()));

        Ok(report)
    }
}

/// Move one legacy entry's files onto its slug.
///
/// Two renames: `mods/<uuid>/` becomes `mods/<slug>/`, and
/// `archives/<uuid>.<ext>` becomes `mods/<slug>.<ext>` beside it. Nothing is
/// unpacked and nothing is copied, so a mod reads afterwards exactly as it read
/// before — see ADR-0003.
fn convert_entry(
    storage_dir: &Path,
    entry: &LibraryModEntry,
    taken: &TakenSlugs,
) -> AppResult<ModSlug> {
    let old_dir = entry.mod_dir(storage_dir);
    let old_archive = entry.archive_path(storage_dir);
    if !old_archive.is_file() {
        return Err(AppError::InvalidPath(format!(
            "Source archive missing: {}",
            old_archive.display()
        )));
    }

    // The slug and every card in the library come out of this config, so a
    // metadata directory the user deleted is rebuilt rather than fatal.
    let project = match load_mod_project(&old_dir) {
        Ok(project) => refresh_config_from_archive(&old_dir, &old_archive, entry.format, project)?,
        Err(_) => {
            rebuild_metadata(&old_dir, &old_archive, entry.format)?;
            load_mod_project(&old_dir)?
        }
    };

    let slug = ModSlug::assign(&project.name, taken);
    let new_dir = storage_dir.mods_dir().join(slug.as_str());
    let new_archive = archive_path(storage_dir, &slug, entry.format);

    fs::rename(&old_dir, &new_dir).context("Failed to move the mod into the new layout")?;

    if let Err(e) = fs::rename(&old_archive, &new_archive) {
        // Put the directory back, so the entry stays wholly in the old layout
        // and the next run has something intact to try again with.
        let _ = fs::rename(&new_dir, &old_dir);
        return Err(io_context(
            e,
            "Failed to move the archive into the new layout",
        ));
    }

    Ok(slug)
}

/// Write back what the cached config lost, which is the migration's one look
/// inside the archive. Returns the config as it now stands.
///
/// Two things come of it. An archive that cannot be opened fails here, in a
/// list the user can act on, rather than at patch time — the only check the
/// move would otherwise skip. And a fantome's cached config gets its layer
/// table back: the pre-slug layout wrote that config through
/// `ModProject::from(FantomeInfo)`, which resets the table to
/// `ModProjectLayer::default_table()`, so a mod that declares layers reads as
/// single-layer and every string override on them is invisible. Nothing reads
/// the archive's metadata again afterwards, so this is the last chance to fix
/// it.
///
/// A modpkg's config was written from its own header and is already faithful,
/// so mounting it proves it opens and nothing is rewritten.
fn refresh_config_from_archive(
    dir: &Path,
    archive: &Path,
    format: ModArchiveFormat,
    mut project: ltk_mod_project::ModProject,
) -> AppResult<ltk_mod_project::ModProject> {
    if matches!(format, ModArchiveFormat::Modpkg) {
        open_modpkg(archive)?;
        return Ok(project);
    }

    let Some(layers) = fantome_layers(archive)? else {
        return Ok(project);
    };
    if layers == project.layers {
        return Ok(project);
    }

    tracing::info!(
        "Restoring {} layers from {}",
        layers.len(),
        archive.display()
    );
    project.layers = layers;
    fs::write(
        dir.join("mod.config.json"),
        serde_json::to_string_pretty(&project)?,
    )?;

    Ok(project)
}

/// Write the metadata directory the old layout should have held.
///
/// Reads the archive's own metadata and nothing else: `META/info.json` for a
/// fantome, the header for a modpkg. Mounting a modpkg here is also what makes
/// a corrupt one fail rather than move silently.
fn rebuild_metadata(dir: &Path, archive: &Path, format: ModArchiveFormat) -> AppResult<()> {
    tracing::info!("Rebuilding missing metadata for {}", dir.display());
    extract_metadata(archive, format, dir)
}

/// What to call this mod in progress and failure lines, falling back to its id
/// when its config cannot be read — which is one reason a conversion fails.
fn display_name_of(entry: &LibraryModEntry, storage_dir: &Path) -> String {
    load_mod_project(&entry.mod_dir(storage_dir))
        .map(|project| project.display_name)
        .unwrap_or_else(|_| entry.id.clone())
}

#[cfg(test)]
mod tests;
