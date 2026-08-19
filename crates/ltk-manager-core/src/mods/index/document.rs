//! The on-disk library index and the locked accessors that guard it.
//!
//! `library.json` is a single document holding every mod entry, profile, and
//! folder. Every read or write goes through [`ModLibrary::with_index`] or
//! [`ModLibrary::mutate_index`], which serialize access through the library's
//! index lock — concurrent commands would otherwise clobber each other's
//! writes, since each one rewrites the whole document.

use super::schema_migration;
use crate::config::Config;
use crate::error::{AppError, AppResult, MutexResultExt};
use crate::events::BackendEvent;
use crate::mods::ModLibrary;
use crate::mods::index::reconcile::reconcile_library_index;
use crate::mods::types::{LibraryFolder, Profile, ProfileSlug, ROOT_FOLDER_ID};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
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

    /// Run reconciliation to clean up orphaned entries, discover new archives,
    /// and refresh stale metadata.
    /// Returns `true` if the index was modified.
    pub fn reconcile_index(&self, config: &Config) -> AppResult<bool> {
        let _lock = self.index_lock.lock().mutex_err()?;
        let storage_dir = self.storage_dir(config)?;
        let mut index = load_library_index(&storage_dir)?;
        let mut refreshed_ids: Vec<String> = Vec::new();
        let reconciled = reconcile_library_index(&storage_dir, &mut index, &mut refreshed_ids);
        if reconciled {
            save_library_index(&storage_dir, &index)?;
            self.stamp_mutation();
        }
        // Flag any cached WAD reports for mods whose archives were re-extracted
        // (content fingerprint drift) and prune entries for mods no longer present.
        if let Ok(mut store) = self.wad_reports.0.lock() {
            let _ = store.invalidate_by_content(&refreshed_ids);
            let valid_ids: std::collections::HashSet<String> =
                index.mods.iter().map(|m| m.id.clone()).collect();
            let _ = store.prune_orphans(&valid_ids);
        }
        Ok(reconciled)
    }

    /// Run [`reconcile_index`](Self::reconcile_index) on a detached background
    /// thread so the Tauri event loop starts immediately and IPC stays
    /// responsive during startup instead of blocking on a disk scan.
    ///
    /// Emits `library-changed` when the index is modified so the frontend
    /// refreshes its queries. [`WadReportState`] must already be managed before
    /// calling this, since reconciliation reads it via `try_state`.
    pub fn reconcile_in_background(&self, config: Config) {
        let library = self.clone();
        std::thread::spawn(move || match library.reconcile_index(&config) {
            Ok(true) => {
                tracing::info!("Library index reconciled on startup");
                library.events.emit(BackendEvent::LibraryChanged);
            }
            Ok(false) => {}
            Err(e) => tracing::warn!("Failed to reconcile library on startup: {}", e),
        });
    }

    /// Read-only index access: acquire lock, load index, run closure.
    pub(crate) fn with_index<T>(
        &self,
        config: &Config,
        f: impl FnOnce(&Path, &LibraryIndex) -> AppResult<T>,
    ) -> AppResult<T> {
        let _lock = self.index_lock.lock().mutex_err()?;
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
        let _lock = self.index_lock.lock().mutex_err()?;
        let storage_dir = self.storage_dir(config)?;
        let mut index = load_library_index(&storage_dir)?;
        let result = f(&storage_dir, &mut index)?;
        save_library_index(&storage_dir, &index)?;
        // Drop WAD report cache entries for mods that are no longer in the
        // library after this mutation (e.g. uninstall paths).
        if let Ok(mut store) = self.wad_reports.0.lock() {
            let valid_ids: std::collections::HashSet<String> =
                index.mods.iter().map(|m| m.id.clone()).collect();
            let _ = store.prune_orphans(&valid_ids);
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ModArchiveFormat {
    Modpkg,
    Fantome,
}

impl ModArchiveFormat {
    /// File extension for this format.
    pub(crate) fn extension(self) -> &'static str {
        match self {
            ModArchiveFormat::Modpkg => "modpkg",
            ModArchiveFormat::Fantome => "fantome",
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryModEntry {
    pub(crate) id: String,
    pub(crate) installed_at: DateTime<Utc>,
    pub(crate) format: ModArchiveFormat,
}

impl LibraryModEntry {
    /// Directory containing extracted metadata (mod.config.json, thumbnail, etc).
    pub(crate) fn metadata_dir(&self, storage_dir: &Path) -> PathBuf {
        storage_dir.join("mods").join(&self.id)
    }

    /// Path to the stored mod archive file.
    pub(crate) fn archive_path(&self, storage_dir: &Path) -> PathBuf {
        storage_dir
            .join("archives")
            .join(format!("{}.{}", self.id, self.format.extension()))
    }
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
    atomic_write_json(&path, &contents)?;
    Ok(())
}

/// Write `contents` to `path` atomically via a sibling `.json.tmp` file.
///
/// A plain `fs::write` can leave `path` empty if the process is killed
/// mid-write; the rename is atomic on all supported platforms so the
/// destination is either the old version or the new version, never partial.
pub(crate) fn atomic_write_json(path: &Path, contents: &str) -> AppResult<()> {
    let tmp = path.with_extension("json.tmp");

    fs::write(&tmp, contents)?;
    fs::rename(&tmp, path)?;

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
mod tests {
    use super::*;

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

    #[test]
    fn get_profile_by_id_not_found() {
        let index = LibraryIndex::default();
        assert!(get_profile_by_id(&index, "nonexistent-id").is_err());
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
    fn mod_archive_format_extension() {
        assert_eq!(ModArchiveFormat::Fantome.extension(), "fantome");
        assert_eq!(ModArchiveFormat::Modpkg.extension(), "modpkg");
    }

    #[test]
    fn mod_archive_format_from_extension() {
        assert_eq!(
            ModArchiveFormat::from_extension("modpkg"),
            Some(ModArchiveFormat::Modpkg)
        );
        assert_eq!(
            ModArchiveFormat::from_extension("FANTOME"),
            Some(ModArchiveFormat::Fantome)
        );
        assert_eq!(
            ModArchiveFormat::from_extension("zip"),
            Some(ModArchiveFormat::Fantome)
        );
        assert_eq!(ModArchiveFormat::from_extension("rar"), None);
    }

    #[test]
    fn library_mod_entry_paths() {
        let storage_dir = Path::new("/storage");
        let entry = LibraryModEntry {
            id: "abc-123".to_string(),
            installed_at: Utc::now(),
            format: ModArchiveFormat::Fantome,
        };

        let metadata_dir = entry.metadata_dir(storage_dir);
        assert!(metadata_dir.ends_with("mods/abc-123"));

        let archive_path = entry.archive_path(storage_dir);
        assert!(archive_path.ends_with("archives/abc-123.fantome"));
    }
}
