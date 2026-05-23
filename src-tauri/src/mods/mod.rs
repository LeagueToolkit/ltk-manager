mod folders;
mod inspect;
mod library;
mod migration;
mod profiles;
mod schema_migration;
mod wad_reports;
pub(crate) mod watcher;

pub use migration::*;

pub use inspect::{inspect_modpkg_file, ModpkgInfo};
pub use wad_reports::{ModWadReport, WadReportState};

use crate::error::{AppError, AppResult, MutexResultExt};
use crate::state::{get_app_data_dir, Settings};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use ts_rs::TS;
use uuid::Uuid;

/// Cooldown period after a mutation during which the watcher ignores events.
/// Must be longer than the debouncer window (2 s) plus margin for delayed
/// Windows filesystem notifications.
pub(crate) const WATCHER_SUPPRESS_SECS: i64 = 10;

/// Managed struct that encapsulates mod library operations.
///
/// All index operations are serialized through `index_lock` to prevent
/// concurrent reads/writes from clobbering each other.
/// Settings are passed per-call since they can change at runtime.
pub struct ModLibrary {
    app_handle: AppHandle,
    index_lock: Arc<Mutex<()>>,
    /// Epoch-millis timestamp of the last `mutate_index` completion.
    /// The file watcher skips events that arrive within [`WATCHER_SUPPRESS_SECS`]
    /// of this timestamp.
    pub(crate) last_mutation_epoch_ms: Arc<AtomicI64>,
}

impl Clone for ModLibrary {
    fn clone(&self) -> Self {
        Self {
            app_handle: self.app_handle.clone(),
            index_lock: Arc::clone(&self.index_lock),
            last_mutation_epoch_ms: Arc::clone(&self.last_mutation_epoch_ms),
        }
    }
}

/// Tauri managed state wrapper for `ModLibrary`.
pub struct ModLibraryState(pub ModLibrary);

impl ModLibrary {
    pub fn new(app_handle: &AppHandle) -> Self {
        Self {
            app_handle: app_handle.clone(),
            index_lock: Arc::new(Mutex::new(())),
            last_mutation_epoch_ms: Arc::new(AtomicI64::new(0)),
        }
    }

    /// Expose the inner AppHandle (needed by overlay module for emitting events).
    pub fn app_handle(&self) -> &AppHandle {
        &self.app_handle
    }

    /// Resolve storage directory from settings snapshot.
    pub(crate) fn storage_dir(&self, settings: &Settings) -> AppResult<PathBuf> {
        settings
            .mod_storage_path
            .clone()
            .or_else(|| get_app_data_dir(&self.app_handle))
            .ok_or_else(|| AppError::Other("Failed to resolve mod storage directory".to_string()))
    }

    /// Run reconciliation to clean up orphaned entries, discover new archives,
    /// and refresh stale metadata.
    /// Returns `true` if the index was modified.
    pub fn reconcile_index(&self, settings: &Settings) -> AppResult<bool> {
        let _lock = self.index_lock.lock().mutex_err()?;
        let storage_dir = self.storage_dir(settings)?;
        let mut index = load_library_index(&storage_dir)?;
        let mut refreshed_ids: Vec<String> = Vec::new();
        let reconciled = reconcile_library_index(&storage_dir, &mut index, &mut refreshed_ids);
        if reconciled {
            save_library_index(&storage_dir, &index)?;
            self.stamp_mutation();
        }
        // Flag any cached WAD reports for mods whose archives were re-extracted
        // (content fingerprint drift) and prune entries for mods no longer present.
        if let Some(state) = self
            .app_handle
            .try_state::<crate::mods::wad_reports::WadReportState>()
        {
            if let Ok(mut store) = state.0.lock() {
                let _ = store.invalidate_by_content(&refreshed_ids);
                let valid_ids: std::collections::HashSet<String> =
                    index.mods.iter().map(|m| m.id.clone()).collect();
                let _ = store.prune_orphans(&valid_ids);
            }
        }
        Ok(reconciled)
    }

    /// Read-only index access: acquire lock, load index, run closure.
    fn with_index<T>(
        &self,
        settings: &Settings,
        f: impl FnOnce(&Path, &LibraryIndex) -> AppResult<T>,
    ) -> AppResult<T> {
        let _lock = self.index_lock.lock().mutex_err()?;
        let storage_dir = self.storage_dir(settings)?;
        let index = load_library_index(&storage_dir)?;
        f(&storage_dir, &index)
    }

    /// Mutate index: acquire lock, load, run closure, save.
    ///
    /// Records the completion timestamp so the file watcher ignores filesystem
    /// notifications caused by our own writes for [`WATCHER_SUPPRESS_SECS`].
    fn mutate_index<T>(
        &self,
        settings: &Settings,
        f: impl FnOnce(&Path, &mut LibraryIndex) -> AppResult<T>,
    ) -> AppResult<T> {
        let _lock = self.index_lock.lock().mutex_err()?;
        let storage_dir = self.storage_dir(settings)?;
        let mut index = load_library_index(&storage_dir)?;
        let result = f(&storage_dir, &mut index)?;
        save_library_index(&storage_dir, &index)?;
        // Drop WAD report cache entries for mods that are no longer in the
        // library after this mutation (e.g. uninstall paths).
        if let Some(state) = self
            .app_handle
            .try_state::<crate::mods::wad_reports::WadReportState>()
        {
            if let Ok(mut store) = state.0.lock() {
                let valid_ids: std::collections::HashSet<String> =
                    index.mods.iter().map(|m| m.id.clone()).collect();
                let _ = store.prune_orphans(&valid_ids);
            }
        }
        self.stamp_mutation();
        Ok(result)
    }

    fn stamp_mutation(&self) {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        self.last_mutation_epoch_ms.store(now_ms, Ordering::SeqCst);
    }
}

/// Slugified profile name used as the filesystem directory name.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(transparent)]
pub struct ProfileSlug(pub String);

impl ProfileSlug {
    /// Create a slug from a profile name. Returns `None` if the name produces an empty slug.
    pub fn from_name(name: &str) -> Option<Self> {
        let s = slug::slugify(name);
        if s.is_empty() {
            None
        } else {
            Some(Self(s))
        }
    }

    /// Check whether this slug is unique among profiles in the index.
    pub fn is_unique_in(&self, index: &LibraryIndex, exclude_id: Option<&str>) -> bool {
        !index
            .profiles
            .iter()
            .any(|p| p.slug == *self && exclude_id.is_none_or(|id| p.id != id))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for ProfileSlug {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

impl From<String> for ProfileSlug {
    fn from(s: String) -> Self {
        Self(s)
    }
}

/// A mod profile for organizing different mod configurations.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    /// Unique identifier (UUID)
    pub id: String,
    /// User-friendly name
    pub name: String,
    /// Slugified name used as the filesystem directory name
    #[serde(default)]
    pub slug: ProfileSlug,
    /// List of mod IDs enabled in this profile (maintains overlay priority order)
    pub enabled_mods: Vec<String>,
    /// Display order of all mods (enabled and disabled) in the UI
    pub mod_order: Vec<String>,
    /// Per-mod layer enabled/disabled states: mod_id → (layer_name → enabled).
    /// Missing entries default to all layers enabled.
    #[serde(default)]
    pub layer_states: HashMap<String, HashMap<String, bool>>,
    /// Creation timestamp
    pub created_at: DateTime<Utc>,
    /// Last time this profile was used/switched to
    pub last_used: DateTime<Utc>,
}

/// A mod layer shown in the UI.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ModLayer {
    pub name: String,
    #[serde(default)]
    pub display_name: String,
    pub priority: i32,
    pub enabled: bool,
}

/// A mod entry shown in the UI Library.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct InstalledMod {
    pub id: String,
    pub name: String,
    pub display_name: String,
    pub version: String,
    pub description: Option<String>,
    pub authors: Vec<String>,
    pub enabled: bool,
    pub installed_at: DateTime<Utc>,
    pub layers: Vec<ModLayer>,
    pub tags: Vec<String>,
    pub champions: Vec<String>,
    pub maps: Vec<String>,
    /// Directory where the mod is installed
    pub mod_dir: String,
    /// ID of the containing folder, or None if ungrouped.
    pub folder_id: Option<String>,
}

/// A named folder for grouping mods in the library.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFolder {
    pub id: String,
    pub name: String,
    pub mod_ids: Vec<String>,
}

/// Sentinel ID for the implicit root folder that holds ungrouped mods.
pub const ROOT_FOLDER_ID: &str = "root";

/// Result of a bulk mod install operation.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BulkInstallResult {
    pub installed: Vec<InstalledMod>,
    pub failed: Vec<BulkInstallError>,
}

/// Error info for a single file that failed during bulk install.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BulkInstallError {
    pub file_path: String,
    pub file_name: String,
    pub message: String,
}

/// Progress event emitted per-file during bulk mod install.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    pub current: usize,
    pub total: usize,
    pub current_file: String,
}

/// Progress event emitted during cslol migration (both packaging and installing phases).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MigrationProgress {
    pub phase: MigrationPhase,
    pub current: usize,
    pub total: usize,
    pub current_file: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum MigrationPhase {
    Packaging,
    Installing,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryIndex {
    /// Schema version for forward/backward compatibility.
    /// Missing in pre-versioning files (deserializes as 0).
    #[serde(default)]
    pub(crate) version: u32,
    pub(super) mods: Vec<LibraryModEntry>,
    pub(super) profiles: Vec<Profile>,
    pub(crate) active_profile_id: String,
    #[serde(default)]
    pub(super) folders: Vec<LibraryFolder>,
    /// Top-level display order — a list of folder IDs.
    /// All mods belong to a folder; the root folder (ID "root") holds ungrouped mods.
    #[serde(default)]
    pub(super) folder_order: Vec<String>,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum ModArchiveFormat {
    Modpkg,
    Fantome,
}

impl ModArchiveFormat {
    /// File extension for this format.
    pub(super) fn extension(self) -> &'static str {
        match self {
            ModArchiveFormat::Modpkg => "modpkg",
            ModArchiveFormat::Fantome => "fantome",
        }
    }

    /// Parse from a file extension string (case-insensitive).
    pub(super) fn from_extension(ext: &str) -> Option<Self> {
        match ext.to_ascii_lowercase().as_str() {
            "modpkg" => Some(Self::Modpkg),
            "fantome" => Some(Self::Fantome),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LibraryModEntry {
    pub(super) id: String,
    pub(super) installed_at: DateTime<Utc>,
    pub(super) format: ModArchiveFormat,
}

impl LibraryModEntry {
    /// Directory containing extracted metadata (mod.config.json, thumbnail, etc).
    pub(super) fn metadata_dir(&self, storage_dir: &Path) -> PathBuf {
        storage_dir.join("mods").join(&self.id)
    }

    /// Path to the stored mod archive file.
    pub(super) fn archive_path(&self, storage_dir: &Path) -> PathBuf {
        storage_dir
            .join("archives")
            .join(format!("{}.{}", self.id, self.format.extension()))
    }
}

pub(super) fn library_index_path(storage_dir: &Path) -> PathBuf {
    storage_dir.join("library.json")
}

/// Load the library index from disk.
///
/// Returns a default index if the file doesn't exist. For existing files,
/// detects the schema version and applies any needed migrations via
/// [`LibraryIndex::load_and_migrate`].
pub(super) fn load_library_index(storage_dir: &Path) -> AppResult<LibraryIndex> {
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

pub(super) fn save_library_index(storage_dir: &Path, index: &LibraryIndex) -> AppResult<()> {
    fs::create_dir_all(storage_dir)?;
    let path = library_index_path(storage_dir);
    let mut to_save = index.clone();
    to_save.version = schema_migration::CURRENT_VERSION;
    let contents = serde_json::to_string_pretty(&to_save)?;
    atomic_write_json(&path, &contents)?;
    Ok(())
}

/// Write `contents` to `path` atomically via a sibling `.json.tmp` file.
///
/// A plain `fs::write` can leave `path` empty if the process is killed
/// mid-write; the rename is atomic on all supported platforms so the
/// destination is either the old version or the new version, never partial.
pub(super) fn atomic_write_json(path: &Path, contents: &str) -> AppResult<()> {
    let tmp = path.with_extension("json.tmp");

    fs::write(&tmp, contents)?;
    fs::rename(&tmp, path)?;

    Ok(())
}

/// Reconcile the library index against the filesystem.
///
/// 1. Remove orphaned mod entries (missing files on disk)
/// 2. Sync profile mod_order lists with the valid mod set
/// 3. Discover and register unrecognised archives
/// 4. Re-extract metadata when an archive is newer than its cached config
///
/// Returns `true` if changes were made.
fn reconcile_library_index(
    storage_dir: &Path,
    index: &mut LibraryIndex,
    refreshed_ids: &mut Vec<String>,
) -> bool {
    let mut changed = false;
    changed |= remove_orphaned_entries(storage_dir, index);
    changed |= sync_profile_mod_orders(index);
    changed |= discover_new_archives(storage_dir, index);
    changed |= refresh_stale_metadata(storage_dir, index, refreshed_ids);
    changed
}

/// Remove mod entries whose metadata or archive files no longer exist on disk
/// and clean up stale references in all profiles.
fn remove_orphaned_entries(storage_dir: &Path, index: &mut LibraryIndex) -> bool {
    let orphaned_ids: Vec<String> = index
        .mods
        .iter()
        .filter(|entry| {
            let metadata_ok = entry
                .metadata_dir(storage_dir)
                .join("mod.config.json")
                .exists();
            let archive_ok = entry.archive_path(storage_dir).exists();
            !metadata_ok || !archive_ok
        })
        .map(|entry| entry.id.clone())
        .collect();

    if orphaned_ids.is_empty() {
        return false;
    }

    let orphaned_set: std::collections::HashSet<&str> =
        orphaned_ids.iter().map(|s| s.as_str()).collect();

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

/// Ensure all profiles contain all valid mods in their `mod_order` and
/// that `item_order` + folders are consistent with the mod set.
fn sync_profile_mod_orders(index: &mut LibraryIndex) -> bool {
    let mut changed = false;

    // Sync folders and folder_order with valid mods
    changed |= folders::sync_folders(index);

    // Derive flat mod order from folder_order + folder contents
    let flat = folders::flatten_folder_order(index);
    let valid_ids: std::collections::HashSet<&str> =
        index.mods.iter().map(|m| m.id.as_str()).collect();

    for profile in &mut index.profiles {
        let before = profile.mod_order.len() + profile.enabled_mods.len();
        profile
            .enabled_mods
            .retain(|id| valid_ids.contains(id.as_str()));

        // Replace mod_order with the flattened item_order
        if profile.mod_order != flat {
            profile.mod_order = flat.clone();
            changed = true;
        }

        // Re-derive enabled_mods order from the new flat order
        let enabled_set: std::collections::HashSet<&str> =
            profile.enabled_mods.iter().map(|s| s.as_str()).collect();
        let new_enabled: Vec<String> = flat
            .iter()
            .filter(|id| enabled_set.contains(id.as_str()))
            .cloned()
            .collect();
        if profile.enabled_mods != new_enabled {
            profile.enabled_mods = new_enabled;
        }

        if profile.mod_order.len() + profile.enabled_mods.len() != before {
            changed = true;
        }
    }

    changed
}

/// Scan `archives/` for mod files not registered in the index and install them.
fn discover_new_archives(storage_dir: &Path, index: &mut LibraryIndex) -> bool {
    let archives_dir = storage_dir.join("archives");
    if !archives_dir.is_dir() {
        return false;
    }

    let known_ids: std::collections::HashSet<&str> =
        index.mods.iter().map(|m| m.id.as_str()).collect();

    let unknown_archives: Vec<PathBuf> = fs::read_dir(&archives_dir)
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| ModArchiveFormat::from_extension(ext).is_some())
        })
        .filter(|p| {
            p.file_stem()
                .and_then(|s| s.to_str())
                .is_none_or(|stem| !known_ids.contains(stem))
        })
        .collect();

    let mut changed = false;
    for path in unknown_archives {
        let path_str = path.display().to_string();
        match library::install_single_mod_to_index(storage_dir, index, &path_str) {
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
                cleanup_failed_discovery(&path, storage_dir);
            }
        }
    }

    changed
}

/// Remove a corrupt/invalid archive that failed discovery so it doesn't
/// get retried on every subsequent reconciliation cycle.
fn cleanup_failed_discovery(original_path: &Path, storage_dir: &Path) {
    if let Err(e) = fs::remove_file(original_path) {
        tracing::warn!(
            "Failed to remove invalid archive {}: {}",
            original_path.display(),
            e
        );
    }

    let archives_dir = storage_dir.join("archives");
    let mods_dir = storage_dir.join("mods");

    // Clean up any partial artifacts left by the failed install (UUID-named copies).
    // install_single_mod_to_index copies the archive to {uuid}.{ext} and creates mods/{uuid}/
    // before it can fail during metadata extraction.
    if let Ok(entries) = fs::read_dir(&archives_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            let is_archive = p
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| ModArchiveFormat::from_extension(ext).is_some());
            if !is_archive {
                continue;
            }
            if let Some(stem) = p.file_stem().and_then(|s| s.to_str()) {
                let metadata_dir = mods_dir.join(stem);
                let config_path = metadata_dir.join("mod.config.json");
                if metadata_dir.is_dir() && !config_path.exists() {
                    tracing::info!("Cleaning up partial install artifacts for {}", stem);
                    let _ = fs::remove_file(&p);
                    let _ = fs::remove_dir_all(&metadata_dir);
                }
            }
        }
    }
}

/// Re-extract metadata for mods whose archive is newer than the cached `mod.config.json`.
/// Also collects the ids of mods whose archive changed, so the caller can flag
/// any cached WAD reports as stale.
fn refresh_stale_metadata(
    storage_dir: &Path,
    index: &LibraryIndex,
    refreshed_ids: &mut Vec<String>,
) -> bool {
    let mut changed = false;

    for entry in &index.mods {
        let archive_path = entry.archive_path(storage_dir);
        let config_path = entry.metadata_dir(storage_dir).join("mod.config.json");

        let archive_mtime = match fs::metadata(&archive_path).and_then(|m| m.modified()) {
            Ok(t) => t,
            Err(_) => continue,
        };
        let config_mtime = match fs::metadata(&config_path).and_then(|m| m.modified()) {
            Ok(t) => t,
            Err(_) => continue,
        };

        if archive_mtime > config_mtime {
            let metadata_dir = entry.metadata_dir(storage_dir);
            let result = match entry.format {
                ModArchiveFormat::Fantome => {
                    library::extract_fantome_metadata(&archive_path, &metadata_dir)
                }
                ModArchiveFormat::Modpkg => {
                    library::extract_modpkg_metadata(&archive_path, &metadata_dir)
                }
            };

            match result {
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
    }

    changed
}

pub(super) fn get_active_profile(index: &LibraryIndex) -> AppResult<&Profile> {
    index
        .profiles
        .iter()
        .find(|p| p.id == index.active_profile_id)
        .ok_or_else(|| AppError::Other("Active profile not found".to_string()))
}

pub(super) fn get_profile_by_id<'a>(
    index: &'a LibraryIndex,
    profile_id: &str,
) -> AppResult<&'a Profile> {
    index
        .profiles
        .iter()
        .find(|p| p.id == profile_id)
        .ok_or_else(|| AppError::Other(format!("Profile {} not found", profile_id)))
}

pub(super) fn resolve_profile_dirs(
    storage_dir: &Path,
    profile_slug: &ProfileSlug,
) -> (PathBuf, PathBuf) {
    let profile_dir = storage_dir.join("profiles").join(profile_slug.as_str());
    let overlay_dir = profile_dir.join("overlay");
    let cache_dir = profile_dir.join("cache");
    (overlay_dir, cache_dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_slug_from_name_normal() {
        let slug = ProfileSlug::from_name("My Profile").unwrap();
        assert_eq!(slug.as_str(), "my-profile");
    }

    #[test]
    fn profile_slug_from_name_special_chars() {
        let slug = ProfileSlug::from_name("Test & Profile #1").unwrap();
        assert!(!slug.as_str().is_empty());
        assert!(slug
            .as_str()
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'));
    }

    #[test]
    fn profile_slug_from_name_empty_returns_none() {
        assert!(ProfileSlug::from_name("").is_none());
    }

    #[test]
    fn profile_slug_from_name_whitespace_only_returns_none() {
        assert!(ProfileSlug::from_name("   ").is_none());
    }

    #[test]
    fn profile_slug_from_name_symbols_only_returns_none() {
        assert!(ProfileSlug::from_name("!!!").is_none());
    }

    #[test]
    fn profile_slug_is_unique_in_no_profiles() {
        let index = LibraryIndex {
            version: 0,
            mods: Vec::new(),
            profiles: Vec::new(),
            active_profile_id: String::new(),
            folders: vec![LibraryFolder {
                id: ROOT_FOLDER_ID.to_string(),
                name: String::new(),
                mod_ids: Vec::new(),
            }],
            folder_order: vec![ROOT_FOLDER_ID.to_string()],
        };
        let slug = ProfileSlug("test".to_string());
        assert!(slug.is_unique_in(&index, None));
    }

    #[test]
    fn profile_slug_is_unique_in_with_different_slugs() {
        let index = LibraryIndex {
            version: 0,
            mods: Vec::new(),
            profiles: vec![Profile {
                id: "p1".to_string(),
                name: "Default".to_string(),
                slug: ProfileSlug("default".to_string()),
                enabled_mods: Vec::new(),
                mod_order: Vec::new(),
                layer_states: HashMap::new(),
                created_at: Utc::now(),
                last_used: Utc::now(),
            }],
            active_profile_id: "p1".to_string(),
            folders: vec![LibraryFolder {
                id: ROOT_FOLDER_ID.to_string(),
                name: String::new(),
                mod_ids: Vec::new(),
            }],
            folder_order: vec![ROOT_FOLDER_ID.to_string()],
        };
        let slug = ProfileSlug("my-profile".to_string());
        assert!(slug.is_unique_in(&index, None));
    }

    #[test]
    fn profile_slug_is_not_unique_when_duplicate() {
        let index = LibraryIndex {
            version: 0,
            mods: Vec::new(),
            profiles: vec![Profile {
                id: "p1".to_string(),
                name: "Default".to_string(),
                slug: ProfileSlug("default".to_string()),
                enabled_mods: Vec::new(),
                mod_order: Vec::new(),
                layer_states: HashMap::new(),
                created_at: Utc::now(),
                last_used: Utc::now(),
            }],
            active_profile_id: "p1".to_string(),
            folders: vec![LibraryFolder {
                id: ROOT_FOLDER_ID.to_string(),
                name: String::new(),
                mod_ids: Vec::new(),
            }],
            folder_order: vec![ROOT_FOLDER_ID.to_string()],
        };
        let slug = ProfileSlug("default".to_string());
        assert!(!slug.is_unique_in(&index, None));
    }

    #[test]
    fn profile_slug_is_unique_when_excluded() {
        let index = LibraryIndex {
            version: 0,
            mods: Vec::new(),
            profiles: vec![Profile {
                id: "p1".to_string(),
                name: "Default".to_string(),
                slug: ProfileSlug("default".to_string()),
                enabled_mods: Vec::new(),
                mod_order: Vec::new(),
                layer_states: HashMap::new(),
                created_at: Utc::now(),
                last_used: Utc::now(),
            }],
            active_profile_id: "p1".to_string(),
            folders: vec![LibraryFolder {
                id: ROOT_FOLDER_ID.to_string(),
                name: String::new(),
                mod_ids: Vec::new(),
            }],
            folder_order: vec![ROOT_FOLDER_ID.to_string()],
        };
        let slug = ProfileSlug("default".to_string());
        assert!(slug.is_unique_in(&index, Some("p1")));
    }

    #[test]
    fn library_index_default_has_one_profile() {
        let index = LibraryIndex::default();
        assert_eq!(index.profiles.len(), 1);
        assert_eq!(index.profiles[0].name, "Default");
        assert_eq!(index.profiles[0].slug.as_str(), "default");
        assert_eq!(index.active_profile_id, index.profiles[0].id);
        assert!(index.mods.is_empty());
    }

    #[test]
    fn library_index_save_and_load_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let index = LibraryIndex::default();
        save_library_index(dir.path(), &index).unwrap();
        let loaded = load_library_index(dir.path()).unwrap();
        assert_eq!(loaded.profiles.len(), 1);
        assert_eq!(loaded.profiles[0].name, "Default");
        assert_eq!(loaded.active_profile_id, loaded.profiles[0].id);
    }

    #[test]
    fn load_library_index_returns_default_when_no_file() {
        let dir = tempfile::tempdir().unwrap();
        let index = load_library_index(dir.path()).unwrap();
        assert_eq!(index.profiles.len(), 1);
        assert_eq!(index.profiles[0].name, "Default");
    }

    #[test]
    fn get_active_profile_finds_profile() {
        let index = LibraryIndex::default();
        let profile = get_active_profile(&index).unwrap();
        assert_eq!(profile.name, "Default");
    }

    #[test]
    fn get_active_profile_returns_error_when_missing() {
        let index = LibraryIndex {
            version: 0,
            mods: Vec::new(),
            profiles: Vec::new(),
            active_profile_id: "nonexistent".to_string(),
            folders: vec![LibraryFolder {
                id: ROOT_FOLDER_ID.to_string(),
                name: String::new(),
                mod_ids: Vec::new(),
            }],
            folder_order: vec![ROOT_FOLDER_ID.to_string()],
        };
        assert!(get_active_profile(&index).is_err());
    }

    #[test]
    fn resolve_profile_dirs_produces_correct_paths() {
        let storage_dir = Path::new("/storage");
        let slug = ProfileSlug("my-profile".to_string());
        let (overlay_dir, cache_dir) = resolve_profile_dirs(storage_dir, &slug);
        assert!(overlay_dir.ends_with("profiles/my-profile/overlay"));
        assert!(cache_dir.ends_with("profiles/my-profile/cache"));
    }

    // ── Profile slug and lookup ──

    #[test]
    fn create_profile_slug_generation() {
        let slug = ProfileSlug::from_name("My Test Profile").unwrap();
        assert_eq!(slug.as_str(), "my-test-profile");
    }

    #[test]
    fn create_profile_symbols_only_name_rejected() {
        assert!(ProfileSlug::from_name("!!!").is_none());
    }

    #[test]
    fn profile_slug_uniqueness_check() {
        let mut index = LibraryIndex::default();
        index.profiles.push(Profile {
            id: "p2".to_string(),
            name: "My Profile".to_string(),
            slug: ProfileSlug::from_name("My Profile").unwrap(),
            enabled_mods: Vec::new(),
            mod_order: Vec::new(),
            layer_states: HashMap::new(),
            created_at: Utc::now(),
            last_used: Utc::now(),
        });

        let slug = ProfileSlug::from_name("My Profile").unwrap();
        assert!(!slug.is_unique_in(&index, None));
        assert!(slug.is_unique_in(&index, Some("p2")));
    }

    #[test]
    fn get_profile_by_id_not_found() {
        let index = LibraryIndex::default();
        assert!(get_profile_by_id(&index, "nonexistent-id").is_err());
    }

    // ── Reconciliation ──

    fn make_test_entry(id: &str, format: ModArchiveFormat) -> LibraryModEntry {
        LibraryModEntry {
            id: id.to_string(),
            installed_at: Utc::now(),
            format,
        }
    }

    fn make_test_profile(
        id: &str,
        name: &str,
        mod_order: Vec<&str>,
        enabled: Vec<&str>,
    ) -> Profile {
        Profile {
            id: id.to_string(),
            name: name.to_string(),
            slug: ProfileSlug::from_name(name)
                .unwrap_or_else(|| ProfileSlug("default".to_string())),
            mod_order: mod_order.into_iter().map(String::from).collect(),
            enabled_mods: enabled.into_iter().map(String::from).collect(),
            layer_states: HashMap::new(),
            created_at: Utc::now(),
            last_used: Utc::now(),
        }
    }

    /// Place the required metadata + archive files on disk so the mod is considered valid.
    fn place_mod_files(storage_dir: &Path, id: &str, format: ModArchiveFormat) {
        let meta_dir = storage_dir.join("mods").join(id);
        fs::create_dir_all(&meta_dir).unwrap();
        fs::write(meta_dir.join("mod.config.json"), "{}").unwrap();

        let archive_dir = storage_dir.join("archives");
        fs::create_dir_all(&archive_dir).unwrap();
        fs::write(
            archive_dir.join(format!("{}.{}", id, format.extension())),
            b"fake",
        )
        .unwrap();
    }

    #[test]
    fn reconcile_no_changes_returns_false() {
        let dir = tempfile::tempdir().unwrap();
        let entry = make_test_entry("mod-a", ModArchiveFormat::Modpkg);
        place_mod_files(dir.path(), "mod-a", ModArchiveFormat::Modpkg);

        let mut index = LibraryIndex {
            version: 0,
            mods: vec![entry],
            profiles: vec![make_test_profile(
                "p1",
                "Default",
                vec!["mod-a"],
                vec!["mod-a"],
            )],
            active_profile_id: "p1".to_string(),
            folders: vec![LibraryFolder {
                id: ROOT_FOLDER_ID.to_string(),
                name: String::new(),
                mod_ids: vec!["mod-a".to_string()],
            }],
            folder_order: vec![ROOT_FOLDER_ID.to_string()],
        };

        assert!(!reconcile_library_index(
            dir.path(),
            &mut index,
            &mut Vec::new()
        ));
        assert_eq!(index.mods.len(), 1);
        assert_eq!(index.profiles[0].mod_order, vec!["mod-a"]);
        assert_eq!(index.profiles[0].enabled_mods, vec!["mod-a"]);
    }

    #[test]
    fn reconcile_removes_orphaned_mod_missing_archive() {
        let dir = tempfile::tempdir().unwrap();
        let entry = make_test_entry("mod-a", ModArchiveFormat::Modpkg);

        // Only place metadata, no archive
        let meta_dir = dir.path().join("mods").join("mod-a");
        fs::create_dir_all(&meta_dir).unwrap();
        fs::write(meta_dir.join("mod.config.json"), "{}").unwrap();

        let mut index = LibraryIndex {
            version: 0,
            mods: vec![entry],
            profiles: vec![make_test_profile(
                "p1",
                "Default",
                vec!["mod-a"],
                vec!["mod-a"],
            )],
            active_profile_id: "p1".to_string(),
            folders: vec![LibraryFolder {
                id: ROOT_FOLDER_ID.to_string(),
                name: String::new(),
                mod_ids: vec!["mod-a".to_string()],
            }],
            folder_order: vec![ROOT_FOLDER_ID.to_string()],
        };

        assert!(reconcile_library_index(
            dir.path(),
            &mut index,
            &mut Vec::new()
        ));
        assert!(index.mods.is_empty());
        assert!(index.profiles[0].mod_order.is_empty());
        assert!(index.profiles[0].enabled_mods.is_empty());
    }

    #[test]
    fn reconcile_removes_orphaned_mod_missing_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let entry = make_test_entry("mod-a", ModArchiveFormat::Modpkg);

        // Only place archive, no metadata
        let archive_dir = dir.path().join("archives");
        fs::create_dir_all(&archive_dir).unwrap();
        fs::write(archive_dir.join("mod-a.modpkg"), b"fake").unwrap();

        let mut index = LibraryIndex {
            version: 0,
            mods: vec![entry],
            profiles: vec![make_test_profile(
                "p1",
                "Default",
                vec!["mod-a"],
                vec!["mod-a"],
            )],
            active_profile_id: "p1".to_string(),
            folders: vec![LibraryFolder {
                id: ROOT_FOLDER_ID.to_string(),
                name: String::new(),
                mod_ids: vec!["mod-a".to_string()],
            }],
            folder_order: vec![ROOT_FOLDER_ID.to_string()],
        };

        assert!(reconcile_library_index(
            dir.path(),
            &mut index,
            &mut Vec::new()
        ));
        assert!(index.mods.is_empty());
    }

    #[test]
    fn reconcile_removes_orphaned_mod_missing_both() {
        let dir = tempfile::tempdir().unwrap();

        let mut index = LibraryIndex {
            version: 0,
            mods: vec![make_test_entry("ghost", ModArchiveFormat::Fantome)],
            profiles: vec![make_test_profile(
                "p1",
                "Default",
                vec!["ghost"],
                vec!["ghost"],
            )],
            active_profile_id: "p1".to_string(),
            folders: vec![LibraryFolder {
                id: ROOT_FOLDER_ID.to_string(),
                name: String::new(),
                mod_ids: vec!["ghost".to_string()],
            }],
            folder_order: vec![ROOT_FOLDER_ID.to_string()],
        };

        assert!(reconcile_library_index(
            dir.path(),
            &mut index,
            &mut Vec::new()
        ));
        assert!(index.mods.is_empty());
        assert!(index.profiles[0].mod_order.is_empty());
        assert!(index.profiles[0].enabled_mods.is_empty());
    }

    #[test]
    fn reconcile_keeps_valid_mods_removes_orphans() {
        let dir = tempfile::tempdir().unwrap();
        place_mod_files(dir.path(), "valid", ModArchiveFormat::Modpkg);
        // "orphan" has no files on disk

        let mut index = LibraryIndex {
            version: 0,
            mods: vec![
                make_test_entry("valid", ModArchiveFormat::Modpkg),
                make_test_entry("orphan", ModArchiveFormat::Modpkg),
            ],
            profiles: vec![make_test_profile(
                "p1",
                "Default",
                vec!["valid", "orphan"],
                vec!["valid", "orphan"],
            )],
            active_profile_id: "p1".to_string(),
            folders: vec![LibraryFolder {
                id: ROOT_FOLDER_ID.to_string(),
                name: String::new(),
                mod_ids: vec!["valid".to_string(), "orphan".to_string()],
            }],
            folder_order: vec![ROOT_FOLDER_ID.to_string()],
        };

        assert!(reconcile_library_index(
            dir.path(),
            &mut index,
            &mut Vec::new()
        ));
        assert_eq!(index.mods.len(), 1);
        assert_eq!(index.mods[0].id, "valid");
        assert_eq!(index.profiles[0].mod_order, vec!["valid"]);
        assert_eq!(index.profiles[0].enabled_mods, vec!["valid"]);
    }

    #[test]
    fn reconcile_cleans_multiple_orphans() {
        let dir = tempfile::tempdir().unwrap();

        let mut index = LibraryIndex {
            version: 0,
            mods: vec![
                make_test_entry("ghost-1", ModArchiveFormat::Modpkg),
                make_test_entry("ghost-2", ModArchiveFormat::Fantome),
                make_test_entry("ghost-3", ModArchiveFormat::Modpkg),
            ],
            profiles: vec![make_test_profile(
                "p1",
                "Default",
                vec!["ghost-1", "ghost-2", "ghost-3"],
                vec!["ghost-1"],
            )],
            active_profile_id: "p1".to_string(),
            folders: vec![LibraryFolder {
                id: ROOT_FOLDER_ID.to_string(),
                name: String::new(),
                mod_ids: vec![
                    "ghost-1".to_string(),
                    "ghost-2".to_string(),
                    "ghost-3".to_string(),
                ],
            }],
            folder_order: vec![ROOT_FOLDER_ID.to_string()],
        };

        assert!(reconcile_library_index(
            dir.path(),
            &mut index,
            &mut Vec::new()
        ));
        assert!(index.mods.is_empty());
        assert!(index.profiles[0].mod_order.is_empty());
        assert!(index.profiles[0].enabled_mods.is_empty());
    }

    #[test]
    fn reconcile_adds_missing_mods_to_profile_mod_order() {
        let dir = tempfile::tempdir().unwrap();
        place_mod_files(dir.path(), "mod-a", ModArchiveFormat::Modpkg);
        place_mod_files(dir.path(), "mod-b", ModArchiveFormat::Modpkg);

        // Profile only knows about mod-a, but mod-b exists in index
        let mut index = LibraryIndex {
            version: 0,
            mods: vec![
                make_test_entry("mod-a", ModArchiveFormat::Modpkg),
                make_test_entry("mod-b", ModArchiveFormat::Modpkg),
            ],
            profiles: vec![make_test_profile(
                "p1",
                "Default",
                vec!["mod-a"],
                vec!["mod-a"],
            )],
            active_profile_id: "p1".to_string(),
            folders: vec![LibraryFolder {
                id: ROOT_FOLDER_ID.to_string(),
                name: String::new(),
                mod_ids: vec!["mod-a".to_string(), "mod-b".to_string()],
            }],
            folder_order: vec![ROOT_FOLDER_ID.to_string()],
        };

        assert!(reconcile_library_index(
            dir.path(),
            &mut index,
            &mut Vec::new()
        ));
        assert_eq!(index.profiles[0].mod_order, vec!["mod-a", "mod-b"]);
        // enabled_mods should be unchanged — missing mods are added disabled
        assert_eq!(index.profiles[0].enabled_mods, vec!["mod-a"]);
    }

    #[test]
    fn reconcile_adds_missing_mods_to_multiple_profiles() {
        let dir = tempfile::tempdir().unwrap();
        place_mod_files(dir.path(), "mod-a", ModArchiveFormat::Modpkg);
        place_mod_files(dir.path(), "mod-b", ModArchiveFormat::Fantome);

        let mut index = LibraryIndex {
            version: 0,
            mods: vec![
                make_test_entry("mod-a", ModArchiveFormat::Modpkg),
                make_test_entry("mod-b", ModArchiveFormat::Fantome),
            ],
            profiles: vec![
                make_test_profile("p1", "Default", vec!["mod-a"], vec![]),
                make_test_profile("p2", "Ranked", vec!["mod-b"], vec!["mod-b"]),
            ],
            active_profile_id: "p1".to_string(),
            folders: vec![LibraryFolder {
                id: ROOT_FOLDER_ID.to_string(),
                name: String::new(),
                mod_ids: vec!["mod-a".to_string(), "mod-b".to_string()],
            }],
            folder_order: vec![ROOT_FOLDER_ID.to_string()],
        };

        assert!(reconcile_library_index(
            dir.path(),
            &mut index,
            &mut Vec::new()
        ));
        assert_eq!(index.profiles[0].mod_order, vec!["mod-a", "mod-b"]);
        assert_eq!(index.profiles[1].mod_order, vec!["mod-a", "mod-b"]);
    }

    #[test]
    fn reconcile_removes_stale_profile_references() {
        let dir = tempfile::tempdir().unwrap();
        place_mod_files(dir.path(), "mod-a", ModArchiveFormat::Modpkg);

        // Profile references "deleted-mod" which isn't in index.mods at all
        let mut index = LibraryIndex {
            version: 0,
            mods: vec![make_test_entry("mod-a", ModArchiveFormat::Modpkg)],
            profiles: vec![make_test_profile(
                "p1",
                "Default",
                vec!["mod-a", "deleted-mod"],
                vec!["mod-a", "deleted-mod"],
            )],
            active_profile_id: "p1".to_string(),
            folders: vec![LibraryFolder {
                id: ROOT_FOLDER_ID.to_string(),
                name: String::new(),
                mod_ids: vec!["mod-a".to_string()],
            }],
            folder_order: vec![ROOT_FOLDER_ID.to_string()],
        };

        assert!(reconcile_library_index(
            dir.path(),
            &mut index,
            &mut Vec::new()
        ));
        assert_eq!(index.profiles[0].mod_order, vec!["mod-a"]);
        assert_eq!(index.profiles[0].enabled_mods, vec!["mod-a"]);
    }

    #[test]
    fn reconcile_handles_orphan_removal_and_missing_mod_order_together() {
        let dir = tempfile::tempdir().unwrap();
        place_mod_files(dir.path(), "mod-a", ModArchiveFormat::Modpkg);
        place_mod_files(dir.path(), "mod-b", ModArchiveFormat::Modpkg);
        // "orphan" has no files

        // Profile 1 has orphan + mod-a, missing mod-b
        // Profile 2 has only orphan
        let mut index = LibraryIndex {
            version: 0,
            mods: vec![
                make_test_entry("mod-a", ModArchiveFormat::Modpkg),
                make_test_entry("mod-b", ModArchiveFormat::Modpkg),
                make_test_entry("orphan", ModArchiveFormat::Fantome),
            ],
            profiles: vec![
                make_test_profile("p1", "Default", vec!["orphan", "mod-a"], vec!["orphan"]),
                make_test_profile("p2", "Ranked", vec!["orphan"], vec!["orphan"]),
            ],
            active_profile_id: "p1".to_string(),
            folders: vec![LibraryFolder {
                id: ROOT_FOLDER_ID.to_string(),
                name: String::new(),
                mod_ids: vec![
                    "mod-a".to_string(),
                    "mod-b".to_string(),
                    "orphan".to_string(),
                ],
            }],
            folder_order: vec![ROOT_FOLDER_ID.to_string()],
        };

        assert!(reconcile_library_index(
            dir.path(),
            &mut index,
            &mut Vec::new()
        ));
        assert_eq!(index.mods.len(), 2);

        // Profile 1: orphan removed, mod-b added
        assert_eq!(index.profiles[0].mod_order, vec!["mod-a", "mod-b"]);
        assert!(index.profiles[0].enabled_mods.is_empty());

        // Profile 2: orphan removed, both mods added
        assert_eq!(index.profiles[1].mod_order, vec!["mod-a", "mod-b"]);
        assert!(index.profiles[1].enabled_mods.is_empty());
    }

    #[test]
    fn reconcile_empty_index_returns_false() {
        let dir = tempfile::tempdir().unwrap();
        let mut index = LibraryIndex {
            version: 0,
            mods: Vec::new(),
            profiles: vec![make_test_profile("p1", "Default", vec![], vec![])],
            active_profile_id: "p1".to_string(),
            folders: vec![LibraryFolder {
                id: ROOT_FOLDER_ID.to_string(),
                name: String::new(),
                mod_ids: Vec::new(),
            }],
            folder_order: vec![ROOT_FOLDER_ID.to_string()],
        };

        assert!(!reconcile_library_index(
            dir.path(),
            &mut index,
            &mut Vec::new()
        ));
    }

    #[test]
    fn load_library_index_reconciles_orphaned_entries() {
        let dir = tempfile::tempdir().unwrap();

        // Save an index with a mod that has no files on disk
        let index = LibraryIndex {
            version: 0,
            mods: vec![make_test_entry("ghost", ModArchiveFormat::Modpkg)],
            profiles: vec![make_test_profile(
                "p1",
                "Default",
                vec!["ghost"],
                vec!["ghost"],
            )],
            active_profile_id: "p1".to_string(),
            folders: vec![LibraryFolder {
                id: ROOT_FOLDER_ID.to_string(),
                name: String::new(),
                mod_ids: vec!["ghost".to_string()],
            }],
            folder_order: vec![ROOT_FOLDER_ID.to_string()],
        };
        save_library_index(dir.path(), &index).unwrap();

        let mut loaded = load_library_index(dir.path()).unwrap();
        let reconciled = reconcile_library_index(dir.path(), &mut loaded, &mut Vec::new());
        assert!(reconciled);
        assert!(loaded.mods.is_empty());
        assert!(loaded.profiles[0].mod_order.is_empty());
        assert!(loaded.profiles[0].enabled_mods.is_empty());
    }

    // ── Archive discovery ──

    fn make_fantome_zip(path: &Path) {
        use std::io::Write;
        let info = ltk_fantome::FantomeInfo {
            name: "Test Mod".to_string(),
            author: "Author".to_string(),
            version: "1.0.0".to_string(),
            description: "Description".to_string(),
            tags: Vec::new(),
            champions: Vec::new(),
            maps: Vec::new(),
            layers: std::collections::HashMap::new(),
        };
        let file = std::fs::File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        zip.start_file("META/info.json", options).unwrap();
        zip.write_all(serde_json::to_string_pretty(&info).unwrap().as_bytes())
            .unwrap();
        zip.finish().unwrap();
    }

    #[test]
    fn reconcile_discovers_unregistered_archive() {
        let dir = tempfile::tempdir().unwrap();
        let archives_dir = dir.path().join("archives");
        fs::create_dir_all(&archives_dir).unwrap();

        make_fantome_zip(&archives_dir.join("cool-skin.fantome"));

        let mut index = LibraryIndex {
            version: 0,
            mods: Vec::new(),
            profiles: vec![make_test_profile("p1", "Default", vec![], vec![])],
            active_profile_id: "p1".to_string(),
            folders: vec![LibraryFolder {
                id: ROOT_FOLDER_ID.to_string(),
                name: String::new(),
                mod_ids: Vec::new(),
            }],
            folder_order: vec![ROOT_FOLDER_ID.to_string()],
        };

        assert!(reconcile_library_index(
            dir.path(),
            &mut index,
            &mut Vec::new()
        ));
        assert_eq!(index.mods.len(), 1);
        assert_eq!(index.mods[0].format, ModArchiveFormat::Fantome);
        assert_eq!(index.profiles[0].mod_order.len(), 1);
        assert_eq!(index.profiles[0].enabled_mods.len(), 1);
        // Original file should be deleted
        assert!(!archives_dir.join("cool-skin.fantome").exists());
        // UUID-named file should exist
        let uuid_archive = index.mods[0].archive_path(dir.path());
        assert!(uuid_archive.exists());
    }

    #[test]
    fn reconcile_skips_known_archive_stems() {
        let dir = tempfile::tempdir().unwrap();
        place_mod_files(dir.path(), "mod-a", ModArchiveFormat::Fantome);

        let mut index = LibraryIndex {
            version: 0,
            mods: vec![make_test_entry("mod-a", ModArchiveFormat::Fantome)],
            profiles: vec![make_test_profile(
                "p1",
                "Default",
                vec!["mod-a"],
                vec!["mod-a"],
            )],
            active_profile_id: "p1".to_string(),
            folders: vec![LibraryFolder {
                id: ROOT_FOLDER_ID.to_string(),
                name: String::new(),
                mod_ids: vec!["mod-a".to_string()],
            }],
            folder_order: vec![ROOT_FOLDER_ID.to_string()],
        };

        assert!(!reconcile_library_index(
            dir.path(),
            &mut index,
            &mut Vec::new()
        ));
        assert_eq!(index.mods.len(), 1);
    }

    #[test]
    fn reconcile_skips_corrupt_archive() {
        let dir = tempfile::tempdir().unwrap();
        let archives_dir = dir.path().join("archives");
        fs::create_dir_all(&archives_dir).unwrap();

        // Write invalid data with .fantome extension
        fs::write(archives_dir.join("corrupt.fantome"), b"not a zip").unwrap();

        let mut index = LibraryIndex {
            version: 0,
            mods: Vec::new(),
            profiles: vec![make_test_profile("p1", "Default", vec![], vec![])],
            active_profile_id: "p1".to_string(),
            folders: vec![LibraryFolder {
                id: ROOT_FOLDER_ID.to_string(),
                name: String::new(),
                mod_ids: Vec::new(),
            }],
            folder_order: vec![ROOT_FOLDER_ID.to_string()],
        };

        // Should not crash, the corrupt file is cleaned up to prevent retry loops
        assert!(!reconcile_library_index(
            dir.path(),
            &mut index,
            &mut Vec::new()
        ));
        assert!(index.mods.is_empty());
        assert!(!archives_dir.join("corrupt.fantome").exists());
    }

    #[test]
    fn reconcile_reextracts_stale_metadata() {
        let dir = tempfile::tempdir().unwrap();
        place_mod_files(dir.path(), "mod-a", ModArchiveFormat::Fantome);

        // Replace the fake archive with a real fantome zip
        let archive_path = dir.path().join("archives").join("mod-a.fantome");
        make_fantome_zip(&archive_path);

        // Backdate the config so the archive appears newer
        let config_path = dir
            .path()
            .join("mods")
            .join("mod-a")
            .join("mod.config.json");
        let past = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_000_000);
        filetime::set_file_mtime(&config_path, filetime::FileTime::from_system_time(past)).unwrap();

        let mut index = LibraryIndex {
            version: 0,
            mods: vec![make_test_entry("mod-a", ModArchiveFormat::Fantome)],
            profiles: vec![make_test_profile(
                "p1",
                "Default",
                vec!["mod-a"],
                vec!["mod-a"],
            )],
            active_profile_id: "p1".to_string(),
            folders: vec![LibraryFolder {
                id: ROOT_FOLDER_ID.to_string(),
                name: String::new(),
                mod_ids: vec!["mod-a".to_string()],
            }],
            folder_order: vec![ROOT_FOLDER_ID.to_string()],
        };

        assert!(reconcile_library_index(
            dir.path(),
            &mut index,
            &mut Vec::new()
        ));

        // Metadata should have been re-extracted with real data
        let config_content = fs::read_to_string(&config_path).unwrap();
        let project: ltk_mod_project::ModProject = serde_json::from_str(&config_content).unwrap();
        assert_eq!(project.display_name, "Test Mod");
    }

    #[test]
    fn reconcile_skips_fresh_metadata() {
        let dir = tempfile::tempdir().unwrap();
        place_mod_files(dir.path(), "mod-a", ModArchiveFormat::Fantome);

        // Backdate the archive so config is newer
        let archive_path = dir.path().join("archives").join("mod-a.fantome");
        let past = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_000_000);
        filetime::set_file_mtime(&archive_path, filetime::FileTime::from_system_time(past))
            .unwrap();

        let mut index = LibraryIndex {
            version: 0,
            mods: vec![make_test_entry("mod-a", ModArchiveFormat::Fantome)],
            profiles: vec![make_test_profile(
                "p1",
                "Default",
                vec!["mod-a"],
                vec!["mod-a"],
            )],
            active_profile_id: "p1".to_string(),
            folders: vec![LibraryFolder {
                id: ROOT_FOLDER_ID.to_string(),
                name: String::new(),
                mod_ids: vec!["mod-a".to_string()],
            }],
            folder_order: vec![ROOT_FOLDER_ID.to_string()],
        };

        assert!(!reconcile_library_index(
            dir.path(),
            &mut index,
            &mut Vec::new()
        ));
    }

    #[test]
    fn load_library_index_migrates_legacy_without_folders() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.json");

        // Write a legacy JSON without folders or folder_order fields
        let legacy_json = serde_json::json!({
            "mods": [
                {
                    "id": "mod-a",
                    "installedAt": "2026-01-01T00:00:00Z",
                    "format": "modpkg"
                },
                {
                    "id": "mod-b",
                    "installedAt": "2026-01-01T00:00:00Z",
                    "format": "modpkg"
                }
            ],
            "profiles": [{
                "id": "p1",
                "name": "Default",
                "slug": "default",
                "modOrder": ["mod-a", "mod-b"],
                "enabledMods": ["mod-a"],
                "layerStates": {},
                "createdAt": "2026-01-01T00:00:00Z",
                "lastUsed": "2026-01-01T00:00:00Z"
            }],
            "activeProfileId": "p1"
        });
        fs::write(&path, serde_json::to_string_pretty(&legacy_json).unwrap()).unwrap();

        let index = load_library_index(dir.path()).unwrap();

        // Root folder should exist with all mods
        let root = index.folders.iter().find(|f| f.id == ROOT_FOLDER_ID);
        assert!(
            root.is_some(),
            "Root folder should be created during migration"
        );
        let root = root.unwrap();
        assert_eq!(root.mod_ids, vec!["mod-a", "mod-b"]);

        // folder_order should contain root
        assert_eq!(index.folder_order, vec![ROOT_FOLDER_ID]);
    }

    #[test]
    fn load_library_index_no_reconciliation_when_clean() {
        let dir = tempfile::tempdir().unwrap();
        place_mod_files(dir.path(), "mod-a", ModArchiveFormat::Modpkg);

        let index = LibraryIndex {
            version: 0,
            mods: vec![make_test_entry("mod-a", ModArchiveFormat::Modpkg)],
            profiles: vec![make_test_profile(
                "p1",
                "Default",
                vec!["mod-a"],
                vec!["mod-a"],
            )],
            active_profile_id: "p1".to_string(),
            folders: vec![LibraryFolder {
                id: ROOT_FOLDER_ID.to_string(),
                name: String::new(),
                mod_ids: vec!["mod-a".to_string()],
            }],
            folder_order: vec![ROOT_FOLDER_ID.to_string()],
        };
        save_library_index(dir.path(), &index).unwrap();

        let mut loaded = load_library_index(dir.path()).unwrap();
        let reconciled = reconcile_library_index(dir.path(), &mut loaded, &mut Vec::new());
        assert!(!reconciled);
        assert_eq!(loaded.mods.len(), 1);
        assert_eq!(loaded.profiles[0].mod_order, vec!["mod-a"]);
    }
}
