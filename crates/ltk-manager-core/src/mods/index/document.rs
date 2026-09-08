//! The on-disk library index and the locked accessors that guard it.
//!
//! `library.json` is a single document holding every mod entry, profile, and
//! folder. Every read or write goes through [`ModLibrary::with_index`] or
//! [`ModLibrary::mutate_index`], which serialize access through the library's
//! index lock — concurrent commands would otherwise clobber each other's
//! writes, since each one rewrites the whole document.

use super::layout_migration::LayoutMigrationState;
use super::schema_migration;
use crate::config::Config;
use crate::error::{AppError, AppResult};
use crate::mods::ModLibrary;
use crate::mods::index::reconcile::reconcile_library_index;
use crate::mods::slug::ModSlug;
use crate::mods::types::{LibraryFolder, Profile, ProfileSlug, ROOT_FOLDER_ID};
use crate::utils::fs::atomic_write;
use chrono::{DateTime, Utc};
use fs_err as fs;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

impl ModLibrary {
    /// Resolve storage directory from the config snapshot.
    pub fn storage_dir(&self, config: &Config) -> AppResult<PathBuf> {
        config
            .mod_storage_path
            .clone()
            .or_else(|| self.default_storage_dir.clone())
            .ok_or_else(|| AppError::Other("Failed to resolve mod storage directory".to_string()))
    }

    /// Where the archive of `mod_id` lies, for a mod the library keeps packed.
    ///
    /// `None` for a mod stored unpacked, which has no one file to point at, and
    /// for an id the index does not carry.
    pub(crate) fn archive_path_of(&self, config: &Config, mod_id: &str) -> Option<PathBuf> {
        self.with_index(config, |storage_dir, index| {
            Ok(index
                .mods
                .iter()
                .find(|entry| entry.id == mod_id)
                .filter(|entry| entry.is_packed())
                .map(|entry| entry.archive_path(storage_dir)))
        })
        .ok()
        .flatten()
    }

    /// Run reconciliation to clean up orphaned entries, discover new archives,
    /// and refresh stale metadata.
    /// Returns `true` if the index was modified.
    pub fn reconcile_index(&self, config: &Config) -> AppResult<bool> {
        // Stand down until the startup migration pass has reported, or a
        // watcher wakeup could read a mod mid-move as an orphan — ADR-0008.
        if matches!(self.layout_migration_state(), LayoutMigrationState::Pending) {
            tracing::info!("Skipping reconciliation: the layout migration has not reported yet");
            return Ok(false);
        }

        let resolver = self.wad_resolver();
        let context = crate::mods::archive::install::InstallContext {
            resolver: resolver.as_ref(),
        };

        let _lock = self.index_lock.lock();
        let storage_dir = self.storage_dir(config)?;
        let mut index = load_library_index(&storage_dir)?;
        let mut refreshed_ids: Vec<String> = Vec::new();
        let reconciled =
            reconcile_library_index(&storage_dir, &mut index, &mut refreshed_ids, &context);
        if reconciled {
            save_library_index(&storage_dir, &index)?;
            self.stamp_mutation();
        }
        // Flag any cached WAD reports for mods whose archives were re-extracted
        // (content fingerprint drift) and prune entries for mods no longer present.
        let mut store = self.wad_reports.0.lock();
        let _ = store.invalidate_by_content(&refreshed_ids);
        let valid_ids: std::collections::HashSet<String> =
            index.mods.iter().map(|m| m.id.clone()).collect();
        let _ = store.prune_orphans(&valid_ids);
        Ok(reconciled)
    }

    /// Read-only index access: acquire lock, load index, run closure.
    pub(crate) fn with_index<T>(
        &self,
        config: &Config,
        f: impl FnOnce(&Path, &LibraryIndex) -> AppResult<T>,
    ) -> AppResult<T> {
        let _lock = self.index_lock.lock();
        let storage_dir = self.storage_dir(config)?;
        let index = load_library_index(&storage_dir)?;
        f(&storage_dir, &index)
    }

    /// Mutate index: acquire lock, load, run closure, save.
    ///
    /// Records the completion timestamp so the file watcher ignores filesystem
    /// notifications caused by our own writes for [`WATCHER_SUPPRESS_SECS`].
    pub(crate) fn mutate_index<T>(
        &self,
        config: &Config,
        f: impl FnOnce(&Path, &mut LibraryIndex) -> AppResult<T>,
    ) -> AppResult<T> {
        let _lock = self.index_lock.lock();
        let storage_dir = self.storage_dir(config)?;
        let mut index = load_library_index(&storage_dir)?;
        let result = f(&storage_dir, &mut index)?;
        save_library_index(&storage_dir, &index)?;
        // Drop WAD report cache entries for mods that are no longer in the
        // library after this mutation (e.g. uninstall paths).
        let valid_ids: std::collections::HashSet<String> =
            index.mods.iter().map(|m| m.id.clone()).collect();
        let _ = self.wad_reports.0.lock().prune_orphans(&valid_ids);
        self.stamp_mutation();
        Ok(result)
    }

    pub(super) fn stamp_mutation(&self) {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        self.last_mutation_epoch_ms.store(now_ms, Ordering::SeqCst);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryIndex {
    /// Schema version for forward/backward compatibility.
    /// Missing in pre-versioning files (deserializes as 0).
    #[serde(default)]
    pub(crate) version: u32,
    pub(crate) mods: Vec<LibraryModEntry>,
    pub(crate) profiles: Vec<Profile>,
    pub(crate) active_profile_id: String,
    #[serde(default)]
    pub(crate) folders: Vec<LibraryFolder>,
    /// Top-level display order — a list of folder IDs.
    /// All mods belong to a folder; the root folder (ID "root") holds ungrouped mods.
    #[serde(default)]
    pub(crate) folder_order: Vec<String>,
}

impl Default for LibraryIndex {
    fn default() -> Self {
        let default_profile = Profile {
            id: Uuid::new_v4().to_string(),
            name: "Default".to_string(),
            slug: ProfileSlug::from("default".to_string()),
            enabled_mods: Vec::new(),
            mod_order: Vec::new(),
            layer_states: HashMap::new(),
            created_at: Utc::now(),
            last_used: Utc::now(),
        };
        let active_profile_id = default_profile.id.clone();

        Self {
            version: schema_migration::CURRENT_VERSION,
            mods: Vec::new(),
            profiles: vec![default_profile],
            active_profile_id,
            folders: vec![LibraryFolder {
                id: ROOT_FOLDER_ID.to_string(),
                name: String::new(),
                mod_ids: Vec::new(),
            }],
            folder_order: vec![ROOT_FOLDER_ID.to_string()],
        }
    }
}

/// The file a mod arrived as. Provenance only — [`ModStorage`] is what decides
/// how it is read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "lowercase")]
pub enum ModArchiveFormat {
    Modpkg,
    Fantome,
    /// A mod project found under `mods/` that nothing here installed, so no
    /// archive it came from is known.
    ///
    /// Every match on this enum groups it with [`Fantome`](Self::Fantome),
    /// which is the only other format with an unpacked form to read.
    Unknown,
}

impl ModArchiveFormat {
    /// Whether a mod of this format can be stored either packed or unpacked.
    ///
    /// A modpkg cannot: its archive is where its content is, and there is no
    /// unpacked form of it. An `Unknown` never has an archive to read.
    pub(crate) fn is_convertible(self) -> bool {
        matches!(self, ModArchiveFormat::Fantome)
    }

    /// File extension for this format.
    pub(crate) fn extension(self) -> &'static str {
        match self {
            ModArchiveFormat::Modpkg => "modpkg",
            ModArchiveFormat::Fantome => "fantome",
            ModArchiveFormat::Unknown => "unknown",
        }
    }

    /// Parse from a file extension string (case-insensitive).
    pub(crate) fn from_extension(ext: &str) -> Option<Self> {
        match ext.to_ascii_lowercase().as_str() {
            "modpkg" => Some(Self::Modpkg),
            "fantome" | "zip" => Some(Self::Fantome),
            _ => None,
        }
    }

    /// How installing this format leaves the mod on disk: ADR-0007.
    ///
    /// `Unknown` records a discovered project directory, which has no archive
    /// for the mod to read out of.
    pub(crate) fn installed_storage(self) -> ModStorage {
        match self {
            ModArchiveFormat::Modpkg | ModArchiveFormat::Fantome => ModStorage::Archive,
            ModArchiveFormat::Unknown => ModStorage::Project,
        }
    }
}

/// Where a mod's content is, which is what picks its content provider.
///
/// Recorded rather than derived: a fantome installs as
/// [`Archive`](Self::Archive) but the user can unpack it after the fact, and a
/// future sanitized-fantome mode would be another value here rather than
/// another guess from the layout.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "lowercase")]
pub enum ModStorage {
    /// An unpacked mod project: `mod.config.json` plus a `content/` tree.
    #[default]
    Project,
    /// Inside the mod's archive, which the provider reads without unpacking.
    Archive,
}

/// What preserving a mod's names at import found.
///
/// Recorded on the entry rather than only logged: `unharvestable` is what
/// tells a mod that preserved cleanly from one that arrived already lossy,
/// and that distinction should outlive a log rotation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct HarvestSummary {
    /// Names the archive gained on the way in. Zero means every recoverable
    /// name was already declared or covered by the community tables.
    pub names_added: usize,
    /// Chunks with no recoverable name: hex-named, and named by nothing the
    /// harvest could read.
    pub unharvestable: usize,
}

impl From<ltk_mod_project::HarvestReport> for HarvestSummary {
    fn from(report: ltk_mod_project::HarvestReport) -> Self {
        Self {
            names_added: match report.outcome {
                ltk_mod_project::PreserveOutcome::Unchanged => 0,
                ltk_mod_project::PreserveOutcome::Rewritten { names_added } => names_added,
            },
            unharvestable: report.unharvestable,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryModEntry {
    pub(crate) id: String,
    pub(crate) installed_at: DateTime<Utc>,
    /// The format this mod arrived as. Provenance only — [`storage`](Self::storage)
    /// is what the paths and the provider ask about.
    pub(crate) format: ModArchiveFormat,
    /// Where this mod's content is.
    ///
    /// Defaulted only for an index written before the field existed, and the
    /// schema migration fills those in — every mod in a v1 library kept its
    /// content in `archives/`.
    #[serde(default)]
    pub(crate) storage: ModStorage,
    /// The directory name under `mods/`.
    ///
    /// `None` means the entry still sits in the pre-slug uuid layout and the
    /// layout migration has not reached it. Every legacy branch below is keyed
    /// on that, and a release after the migration ships removes them.
    #[serde(default)]
    pub(crate) slug: Option<ModSlug>,
    /// What preserving the mod's names found, for a fantome installed since
    /// the preserve existed. `None` for a modpkg and for older entries.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) harvest: Option<HarvestSummary>,
}

impl LibraryModEntry {
    /// Whether this mod's content is read out of an archive rather than a tree.
    pub(crate) fn is_packed(&self) -> bool {
        matches!(self.storage, ModStorage::Archive)
    }

    /// The mod's own directory: `mods/<slug>`, or `mods/<uuid>` before the
    /// layout migration has reached it.
    pub(crate) fn mod_dir(&self, storage_dir: &Path) -> PathBuf {
        let name = self.slug.as_ref().map_or(self.id.as_str(), ModSlug::as_str);
        storage_dir.join("mods").join(name)
    }

    /// Path to the stored mod archive, beside the directory it belongs to.
    ///
    /// Every install keeps one — it is what the provider reads. In the legacy
    /// layout it is the shared `archives/` folder.
    pub(crate) fn archive_path(&self, storage_dir: &Path) -> PathBuf {
        match &self.slug {
            Some(slug) => archive_path(storage_dir, slug, self.format),
            // Legacy layout: one flat `archives/` folder keyed by uuid.
            None => storage_dir.join("archives").join(format!(
                "{}.{}",
                self.id,
                self.format.extension()
            )),
        }
    }

    /// Whether the files this entry names are still on disk.
    ///
    /// The config is what makes a mod readable, plus the archive for any mod
    /// whose content is still inside one. A converted fantome with no retained
    /// archive is present — its content is the unpacked tree, and the archive
    /// was only a keepsake.
    pub(crate) fn is_present(&self, storage_dir: &Path) -> bool {
        if !self.mod_dir(storage_dir).join("mod.config.json").exists() {
            return false;
        }

        !self.is_packed() || self.archive_path(storage_dir).exists()
    }

    /// Delete everything on disk this entry names.
    ///
    /// The two places [`is_present`](Self::is_present) looks: the mod
    /// directory and the archive beside it.
    ///
    /// # Errors
    ///
    /// Fails with [`AppError::Io`] on the first path that cannot be deleted,
    /// which leaves the rest in place.
    pub(crate) fn remove_files(&self, storage_dir: &Path) -> AppResult<()> {
        let mod_dir = self.mod_dir(storage_dir);
        if mod_dir.exists() {
            fs::remove_dir_all(&mod_dir)?;
        }

        let archive_path = self.archive_path(storage_dir);
        if archive_path.exists() {
            fs::remove_file(&archive_path)?;
            tracing::info!("Deleted mod archive at {}", archive_path.display());
        }

        Ok(())
    }
}

/// A mod's archive as `mods/<slug>.<ext>`, the sibling of `mods/<slug>/`.
///
/// Taken apart from [`LibraryModEntry::archive_path`] because an install names
/// the file before there is an entry to ask.
pub(crate) fn archive_path(
    storage_dir: &Path,
    slug: &ModSlug,
    format: ModArchiveFormat,
) -> PathBuf {
    storage_dir
        .join("mods")
        .join(format!("{slug}.{}", format.extension()))
}

pub(crate) fn library_index_path(storage_dir: &Path) -> PathBuf {
    storage_dir.join("library.json")
}

/// Load the library index from disk.
///
/// Returns a default index if the file doesn't exist. For existing files,
/// detects the schema version and applies any needed migrations via
/// [`LibraryIndex::load_and_migrate`].
pub(crate) fn load_library_index(storage_dir: &Path) -> AppResult<LibraryIndex> {
    fs::create_dir_all(storage_dir)?;

    let path = library_index_path(storage_dir);
    if !path.exists() {
        return Ok(LibraryIndex::default());
    }

    match LibraryIndex::load_and_migrate(storage_dir) {
        Ok(index) => Ok(index),
        // Version conflicts and IO errors must surface — the former is a user-visible
        // compatibility issue; the latter may indicate permissions or disk problems
        // that the user needs to address (and not silently overwrite).
        Err(e @ AppError::SchemaVersionTooNew { .. }) | Err(e @ AppError::Io(_)) => Err(e),
        Err(e) => {
            // JSON parse failure or structural mismatch means the file content is
            // corrupt (e.g. truncated mid-write). Back it up for diagnostics and
            // reset to defaults so the app can recover.
            tracing::warn!(
                "Library index content is corrupt ({}); resetting to defaults",
                e
            );
            let corrupt_path = path.with_extension("json.corrupt");
            if let Err(rename_err) = fs::rename(&path, &corrupt_path) {
                tracing::warn!(
                    "Failed to rename corrupt library index to {}: {}",
                    corrupt_path.display(),
                    rename_err
                );
            }
            Ok(LibraryIndex::default())
        }
    }
}

pub(crate) fn save_library_index(storage_dir: &Path, index: &LibraryIndex) -> AppResult<()> {
    fs::create_dir_all(storage_dir)?;
    let path = library_index_path(storage_dir);
    let mut to_save = index.clone();
    to_save.version = schema_migration::CURRENT_VERSION;
    let contents = serde_json::to_string_pretty(&to_save)?;
    atomic_write(&path, contents.as_bytes())?;
    Ok(())
}

pub(crate) fn get_active_profile(index: &LibraryIndex) -> AppResult<&Profile> {
    index
        .profiles
        .iter()
        .find(|p| p.id == index.active_profile_id)
        .ok_or_else(|| AppError::Other("Active profile not found".to_string()))
}

pub(crate) fn get_profile_by_id<'a>(
    index: &'a LibraryIndex,
    profile_id: &str,
) -> AppResult<&'a Profile> {
    index
        .profiles
        .iter()
        .find(|p| p.id == profile_id)
        .ok_or_else(|| AppError::Other(format!("Profile {} not found", profile_id)))
}

pub(crate) fn resolve_profile_dirs(
    storage_dir: &Path,
    profile_slug: &ProfileSlug,
) -> (PathBuf, PathBuf) {
    let profile_dir = storage_dir.join("profiles").join(profile_slug.as_str());
    let overlay_dir = profile_dir.join("overlay");
    let cache_dir = profile_dir.join("cache");
    (overlay_dir, cache_dir)
}

#[cfg(test)]
mod tests;
