//! Bringing the index back in line with what is actually on disk.
//!
//! The index and the filesystem drift apart whenever something happens outside
//! the app: a user deletes a mod directory, drops an archive into `archives/`
//! by hand, or restores a storage folder without its `library.json`.
//! Reconciliation runs on startup and on watcher wakeups to repair that drift.

use crate::mods::StorageLayout as _;
use crate::mods::archive::install::{self, InstallContext, STAGING_PREFIX};
use crate::mods::archive::metadata;
use crate::mods::index::document::archive_path;
use crate::mods::index::{LibraryIndex, LibraryModEntry, ModArchiveFormat, ModStorage};
use crate::mods::slug::{ModSlug, TakenSlugs};
use crate::mods::types::ROOT_FOLDER_ID;
use fs_err as fs;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// Reconcile the library index against the filesystem.
///
/// 1. Remove orphaned mod entries (missing files on disk)
/// 2. Register mod directories the index doesn't know about
/// 3. Install archives dropped into `archives/`
/// 4. Reconcile the folders, then re-derive every profile order from them
/// 5. Re-extract modpkg metadata when the archive is newer than its cached config
///
/// Returns `true` if changes were made.
pub(crate) fn reconcile_library_index(
    storage_dir: &Path,
    index: &mut LibraryIndex,
    refreshed_ids: &mut Vec<String>,
    context: &InstallContext<'_>,
) -> bool {
    let mut changed = false;
    changed |= remove_orphaned_entries(storage_dir, index);
    changed |= discover_mod_directories(storage_dir, index);
    changed |= discover_new_archives(storage_dir, index, context);
    changed |= index.sync_folders();
    changed |= index.sync_profile_orders();
    changed |= refresh_stale_modpkg_metadata(storage_dir, index, refreshed_ids);
    changed
}

/// Remove mod entries whose files no longer exist on disk and clean up stale
/// references in all profiles.
fn remove_orphaned_entries(storage_dir: &Path, index: &mut LibraryIndex) -> bool {
    let orphaned_ids: Vec<String> = index
        .mods
        .iter()
        .filter(|entry| !entry.is_present(storage_dir))
        .map(|entry| entry.id.clone())
        .collect();

    if orphaned_ids.is_empty() {
        return false;
    }

    let orphaned_set: HashSet<&str> = orphaned_ids.iter().map(|s| s.as_str()).collect();

    for id in &orphaned_ids {
        tracing::warn!(
            "Removing orphaned mod entry {} (files missing from disk)",
            id
        );
    }

    index.mods.retain(|m| !orphaned_set.contains(m.id.as_str()));

    for profile in &mut index.profiles {
        profile
            .mod_order
            .retain(|id| !orphaned_set.contains(id.as_str()));
        profile
            .enabled_mods
            .retain(|id| !orphaned_set.contains(id.as_str()));
        profile
            .layer_states
            .retain(|id, _| !orphaned_set.contains(id.as_str()));
    }

    tracing::info!(
        "Reconciled library index: removed {} orphaned mod entries",
        orphaned_ids.len()
    );
    true
}

/// Register mod project directories under `mods/` that no entry claims.
///
/// A user can put a project directory there by hand, and a library.json that
/// was lost leaves every one of them unclaimed. Either way the directory is
/// adopted as a new mod: `library.json` is the only record of which mod is
/// which, so the id it had before is not recoverable — see ADR-0002.
fn discover_mod_directories(storage_dir: &Path, index: &mut LibraryIndex) -> bool {
    let mods_dir = storage_dir.mods_dir();
    let Ok(entries) = fs::read_dir(&mods_dir) else {
        return false;
    };

    // Keyed on the directory each entry actually occupies: the slug, or the
    // uuid for a legacy entry the migration could not move. Missing the
    // latter would register a mod's own directory as a second mod.
    let claimed: HashSet<String> = index
        .mods
        .iter()
        .map(|entry| {
            entry
                .slug
                .as_ref()
                .map_or(entry.id.as_str(), ModSlug::as_str)
                .to_ascii_lowercase()
        })
        .collect();

    let mut discovered = Vec::new();
    for dir_entry in entries.flatten() {
        let path = dir_entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = dir_entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        // Dot directories are the manager's own: staging, and anything a later
        // release keeps beside it.
        if name.starts_with('.') || claimed.contains(&name.to_ascii_lowercase()) {
            continue;
        }

        if let Some(entry) = adopt_mod_directory(storage_dir, &path, &name) {
            discovered.push(entry);
        }
    }

    if discovered.is_empty() {
        return false;
    }

    for entry in discovered {
        tracing::info!(
            "Registered mod directory {} as {}",
            entry.mod_dir(storage_dir).display(),
            entry.id
        );
        if let Some(root) = index.folders.iter_mut().find(|f| f.id == ROOT_FOLDER_ID) {
            root.mod_ids.push(entry.id.clone());
        }
        index.mods.push(entry);
    }

    true
}

/// An entry for a directory the index does not know about, when it reads as a
/// mod at all.
///
/// What sits beside the directory says how to read it — ADR-0002. A `.modpkg`
/// keeps its content in the archive, and for anything else a `content/` tree is
/// what makes the directory itself the mod.
fn adopt_mod_directory(storage_dir: &Path, path: &Path, dir_name: &str) -> Option<LibraryModEntry> {
    if !path.join("mod.config.json").exists() {
        return None;
    }

    let slug = ModSlug::from_dir_name(dir_name);
    let beside = |format| archive_path(storage_dir, &slug, format).is_file();
    let archive_format = [ModArchiveFormat::Modpkg, ModArchiveFormat::Fantome]
        .into_iter()
        .find(|&format| beside(format));

    let unpacked = path.join("content").is_dir();
    let (format, storage) = match archive_format {
        // A modpkg is read out of its archive whatever the directory holds, so
        // a `content/` tree beside one is leftovers rather than the mod.
        Some(ModArchiveFormat::Modpkg) => (ModArchiveFormat::Modpkg, ModStorage::Archive),
        // The archive is a keepsake. The tree is what the overlay reads.
        Some(format) if unpacked => (format, ModStorage::Project),
        Some(format) => (format, ModStorage::Archive),
        None if unpacked => (ModArchiveFormat::Unknown, ModStorage::Project),
        None => return None,
    };

    Some(LibraryModEntry {
        id: uuid::Uuid::new_v4().to_string(),
        installed_at: directory_created_at(path),
        format,
        storage,
        // The directory keeps the name it already has: paths outside the index
        // point at it, and re-slugging would break them for no gain.
        slug: Some(slug),
        harvest: None,
    })
}

/// When a discovered directory arrived, as close as the filesystem can say.
fn directory_created_at(path: &Path) -> chrono::DateTime<chrono::Utc> {
    fs::metadata(path)
        .and_then(|meta| meta.created().or_else(|_| meta.modified()))
        .map_or_else(|_| chrono::Utc::now(), Into::into)
}

/// Install mod files a user dropped into `archives/`, which is a drop folder
/// and nothing else now that installed archives live inside their mod.
fn discover_new_archives(
    storage_dir: &Path,
    index: &mut LibraryIndex,
    context: &InstallContext<'_>,
) -> bool {
    let archives_dir = storage_dir.archives_dir();
    if !archives_dir.is_dir() {
        return false;
    }

    let known_ids: HashSet<String> = index
        .mods
        .iter()
        .map(|m| m.id.to_ascii_lowercase())
        .collect();

    let dropped: Vec<PathBuf> = fs::read_dir(&archives_dir)
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| ModArchiveFormat::from_extension(ext).is_some())
        })
        // A file named for a mod the index already holds is not a drop. It is
        // the archive of a legacy entry the layout migration could not move,
        // and installing it would duplicate the mod and then consume its only
        // copy.
        .filter(|p| {
            p.file_stem()
                .and_then(|stem| stem.to_str())
                .is_none_or(|stem| !known_ids.contains(&stem.to_ascii_lowercase()))
        })
        .collect();

    if dropped.is_empty() {
        return false;
    }

    let mut taken = TakenSlugs::collect(index, &storage_dir.mods_dir());
    let mut changed = false;
    for path in dropped {
        let path_str = path.display().to_string();
        match install::install_single_mod_to_index(
            storage_dir,
            index,
            &path_str,
            context,
            &mut taken,
        ) {
            Ok((_entry, installed)) => {
                tracing::info!(
                    "Discovered and registered archive: {} as {}",
                    path.display(),
                    installed.id
                );
                if let Err(e) = fs::remove_file(&path) {
                    tracing::warn!(
                        "Failed to delete original archive {}: {}",
                        path.display(),
                        e
                    );
                }
                changed = true;
            }
            Err(e) => {
                tracing::warn!("Skipping invalid archive {}: {}", path.display(), e);
                cleanup_failed_discovery(&path);
            }
        }
    }

    changed
}

/// Remove a corrupt archive that failed discovery so it isn't retried on every
/// reconciliation cycle.
///
/// Whatever staging the failed install created is already gone:
/// [`stage_mod_package`](install::stage_mod_package) removes its own.
fn cleanup_failed_discovery(original_path: &Path) {
    if let Err(e) = fs::remove_file(original_path) {
        tracing::warn!(
            "Failed to remove invalid archive {}: {}",
            original_path.display(),
            e
        );
    }
}

/// Delete what a crashed install left staging under `mods/`.
///
/// Both halves go: the staging directory and the archive copy beside it, which
/// share the prefix.
///
/// Only safe to call when nothing can be staging *now* — staging happens
/// outside the index lock, so a pass triggered by the watcher (which the
/// staging writes themselves wake) would delete a directory an install is
/// still filling. Startup is where that holds, and a crashed staging
/// directory is by definition from a process that has already ended.
pub(crate) fn sweep_stale_staging(storage_dir: &Path) {
    let Ok(entries) = fs::read_dir(storage_dir.mods_dir()) else {
        return;
    };

    for entry in entries.flatten() {
        let is_staging = entry
            .file_name()
            .to_str()
            .is_some_and(|name| name.starts_with(STAGING_PREFIX));
        if !is_staging {
            continue;
        }

        let path = entry.path();
        tracing::info!("Sweeping stale staging entry {}", path.display());

        let removed = if path.is_dir() {
            fs::remove_dir_all(&path)
        } else {
            fs::remove_file(&path)
        };
        if let Err(e) = removed {
            tracing::warn!("Failed to sweep {}: {}", path.display(), e);
        }
    }
}

/// Re-extract a modpkg's metadata when its archive is newer than the cached
/// `mod.config.json`, and collect the ids so the caller can flag stale WAD
/// reports.
///
/// Modpkg only: an unpacked mod's config is written once at import and then
/// edited in place, so an archive newer than it means nothing there.
fn refresh_stale_modpkg_metadata(
    storage_dir: &Path,
    index: &LibraryIndex,
    refreshed_ids: &mut Vec<String>,
) -> bool {
    let mut changed = false;

    let is_modpkg = |e: &&LibraryModEntry| matches!(e.format, ModArchiveFormat::Modpkg);
    for entry in index.mods.iter().filter(is_modpkg) {
        let archive_path = entry.archive_path(storage_dir);
        let mod_dir = entry.mod_dir(storage_dir);
        let config_path = mod_dir.join("mod.config.json");

        let (Ok(archive_mtime), Ok(config_mtime)) = (
            fs::metadata(&archive_path).and_then(|m| m.modified()),
            fs::metadata(&config_path).and_then(|m| m.modified()),
        ) else {
            continue;
        };

        if archive_mtime <= config_mtime {
            continue;
        }

        match metadata::extract_metadata(&archive_path, ModArchiveFormat::Modpkg, &mod_dir) {
            Ok(()) => {
                tracing::info!("Re-extracted stale metadata for mod {}", entry.id);
                refreshed_ids.push(entry.id.clone());
                changed = true;
            }
            Err(e) => {
                tracing::warn!("Failed to re-extract metadata for mod {}: {}", entry.id, e);
            }
        }
    }

    changed
}

#[cfg(test)]
mod tests;
