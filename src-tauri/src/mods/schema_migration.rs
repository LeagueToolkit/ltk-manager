use crate::error::{AppError, AppResult};
use serde_json::Value;
use std::fs;
use std::path::Path;

use super::{atomic_write_json, library_index_path, LibraryIndex, ROOT_FOLDER_ID};

/// Current schema version for the library index.
/// Increment this when making breaking changes to the schema and add a
/// corresponding `vN_to_vN+1` migration function.
pub(crate) const CURRENT_VERSION: u32 = 1;

impl LibraryIndex {
    /// Load a library index from disk, migrating from older schema versions
    /// if needed.
    ///
    /// Reads the raw JSON, detects the schema version, backs up the file if
    /// migration is needed, applies sequential migrations (v0→v1, v1→v2, etc.),
    /// persists the result, and deserializes into the typed `LibraryIndex`.
    ///
    /// Returns `AppError::SchemaVersionTooNew` if the file was written by a
    /// newer app version.
    pub(super) fn load_and_migrate(storage_dir: &Path) -> AppResult<Self> {
        let path = library_index_path(storage_dir);

        let raw = fs::read_to_string(&path)?;
        let mut value: Value = serde_json::from_str(&raw).map_err(AppError::from)?;
        let file_version = Self::extract_version(&value);

        if file_version > CURRENT_VERSION {
            return Err(AppError::SchemaVersionTooNew {
                file_version,
                max_supported: CURRENT_VERSION,
            });
        }

        let migrated = file_version < CURRENT_VERSION;
        if migrated {
            Self::backup(storage_dir, file_version)?;

            if file_version < 1 {
                value = Self::migrate_v0_to_v1(value)?;
            }

            // Future migrations chain here:
            // if file_version < 2 { value = Self::migrate_v1_to_v2(value)?; }
        }

        let index: Self = serde_json::from_value(value).map_err(AppError::from)?;

        if migrated {
            let contents = serde_json::to_string_pretty(&index)?;
            atomic_write_json(&path, &contents)?;
        }

        Ok(index)
    }

    /// Extract the schema version from raw library index JSON.
    /// Returns 0 if the `version` field is absent (pre-versioning files).
    fn extract_version(value: &Value) -> u32 {
        value.get("version").and_then(|v| v.as_u64()).unwrap_or(0) as u32
    }

    /// Back up the library index file before migrating from the given version.
    /// Copies `library.json` to `library.v{from_version}.json.bak`.
    fn backup(storage_dir: &Path, from_version: u32) -> AppResult<()> {
        let src = library_index_path(storage_dir);
        let dst = storage_dir.join(format!("library.v{}.json.bak", from_version));
        fs::copy(&src, &dst)?;
        tracing::info!(
            "Backed up library index (v{}) to {}",
            from_version,
            dst.display()
        );
        Ok(())
    }

    /// Migrate a v0 (pre-versioning) index to v1.
    ///
    /// Ensures the root folder exists with all mods assigned, populates
    /// `folderOrder`, and sets `version` to 1. This absorbs the ad-hoc
    /// migration that previously lived in `load_library_index`.
    fn migrate_v0_to_v1(mut value: Value) -> AppResult<Value> {
        let obj = value
            .as_object_mut()
            .ok_or_else(|| AppError::Other("Library index is not a JSON object".to_string()))?;

        if !obj.contains_key("folders") {
            obj.insert("folders".to_string(), Value::Array(Vec::new()));
        }

        let has_root = obj
            .get("folders")
            .and_then(|f| f.as_array())
            .is_some_and(|arr| {
                arr.iter()
                    .any(|f| f.get("id").and_then(|id| id.as_str()) == Some(ROOT_FOLDER_ID))
            });

        if !has_root {
            let active_profile_id = obj
                .get("activeProfileId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let mod_ids: Vec<Value> = obj
                .get("profiles")
                .and_then(|p| p.as_array())
                .and_then(|profiles| {
                    profiles.iter().find(|p| {
                        p.get("id").and_then(|id| id.as_str()) == Some(&active_profile_id)
                    })
                })
                .and_then(|profile| profile.get("modOrder"))
                .and_then(|mo| mo.as_array())
                .cloned()
                .unwrap_or_else(|| {
                    obj.get("mods")
                        .and_then(|m| m.as_array())
                        .map(|mods| mods.iter().filter_map(|m| m.get("id").cloned()).collect())
                        .unwrap_or_default()
                });

            let root_folder = serde_json::json!({
                "id": ROOT_FOLDER_ID,
                "name": "",
                "modIds": mod_ids
            });

            if let Some(folders) = obj.get_mut("folders").and_then(|f| f.as_array_mut()) {
                folders.insert(0, root_folder);
            }
        }

        if !obj.contains_key("folderOrder") {
            obj.insert("folderOrder".to_string(), Value::Array(Vec::new()));
        }

        let all_folder_ids: Vec<Value> = obj
            .get("folders")
            .and_then(|f| f.as_array())
            .map(|folders| {
                folders
                    .iter()
                    .filter_map(|f| f.get("id").cloned())
                    .collect()
            })
            .unwrap_or_default();

        if let Some(order) = obj.get_mut("folderOrder").and_then(|fo| fo.as_array_mut()) {
            let has_root_in_order = order.iter().any(|v| v.as_str() == Some(ROOT_FOLDER_ID));
            if !has_root_in_order {
                order.insert(0, Value::String(ROOT_FOLDER_ID.to_string()));
            }

            if order.len() <= 1 && !all_folder_ids.is_empty() {
                *order = all_folder_ids;
            }
        }

        obj.insert("version".to_string(), Value::Number(1.into()));
        tracing::info!("Migrated library index from v0 to v1");

        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn make_legacy_json_no_folders() -> Value {
        serde_json::json!({
            "mods": [
                { "id": "mod-a", "installedAt": "2026-01-01T00:00:00Z", "format": "modpkg" },
                { "id": "mod-b", "installedAt": "2026-01-01T00:00:00Z", "format": "modpkg" }
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
        })
    }

    fn make_legacy_json_with_folders() -> Value {
        serde_json::json!({
            "mods": [
                { "id": "mod-a", "installedAt": "2026-01-01T00:00:00Z", "format": "modpkg" }
            ],
            "profiles": [{
                "id": "p1",
                "name": "Default",
                "slug": "default",
                "modOrder": ["mod-a"],
                "enabledMods": ["mod-a"],
                "layerStates": {},
                "createdAt": "2026-01-01T00:00:00Z",
                "lastUsed": "2026-01-01T00:00:00Z"
            }],
            "activeProfileId": "p1",
            "folders": [{
                "id": "root",
                "name": "",
                "modIds": ["mod-a"]
            }],
            "folderOrder": ["root"]
        })
    }

    fn make_current_version_json() -> Value {
        let mut json = make_legacy_json_with_folders();
        json.as_object_mut()
            .unwrap()
            .insert("version".to_string(), Value::Number(CURRENT_VERSION.into()));
        json
    }

    #[test]
    fn extract_version_missing_field_returns_zero() {
        let json = make_legacy_json_no_folders();
        assert_eq!(LibraryIndex::extract_version(&json), 0);
    }

    #[test]
    fn extract_version_present_field() {
        let json = make_current_version_json();
        assert_eq!(LibraryIndex::extract_version(&json), CURRENT_VERSION);
    }

    #[test]
    fn migrate_v0_to_v1_creates_root_folder_and_assigns_mods() {
        let json = make_legacy_json_no_folders();
        let result = LibraryIndex::migrate_v0_to_v1(json).unwrap();

        let folders = result["folders"].as_array().unwrap();
        let root = folders.iter().find(|f| f["id"] == ROOT_FOLDER_ID).unwrap();
        let mod_ids: Vec<&str> = root["modIds"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect();
        assert_eq!(mod_ids, vec!["mod-a", "mod-b"]);

        let folder_order: Vec<&str> = result["folderOrder"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect();
        assert!(folder_order.contains(&ROOT_FOLDER_ID));

        assert_eq!(result["version"], 1);
    }

    #[test]
    fn migrate_v0_to_v1_with_existing_folders_preserves_them() {
        let json = make_legacy_json_with_folders();
        let result = LibraryIndex::migrate_v0_to_v1(json).unwrap();

        let folders = result["folders"].as_array().unwrap();
        assert_eq!(folders.len(), 1);
        assert_eq!(folders[0]["id"], ROOT_FOLDER_ID);
        assert_eq!(result["version"], 1);
    }

    #[test]
    fn migrate_v0_to_v1_result_deserializes_into_library_index() {
        let json = make_legacy_json_no_folders();
        let migrated = LibraryIndex::migrate_v0_to_v1(json).unwrap();
        let index: LibraryIndex = serde_json::from_value(migrated).unwrap();

        assert_eq!(index.version, 1);
        assert_eq!(index.mods.len(), 2);
        assert_eq!(index.profiles.len(), 1);
        assert!(index.folders.iter().any(|f| f.id == ROOT_FOLDER_ID));
    }

    #[test]
    fn load_and_migrate_current_version_no_migration() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.json");
        let json = make_current_version_json();
        fs::write(&path, serde_json::to_string_pretty(&json).unwrap()).unwrap();

        let index = LibraryIndex::load_and_migrate(dir.path()).unwrap();
        assert_eq!(index.version, CURRENT_VERSION);

        let backup = dir
            .path()
            .join(format!("library.v{}.json.bak", CURRENT_VERSION));
        assert!(!backup.exists());
    }

    #[test]
    fn load_and_migrate_v0_creates_backup_and_migrates() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.json");
        let json = make_legacy_json_no_folders();
        let original_content = serde_json::to_string_pretty(&json).unwrap();
        fs::write(&path, &original_content).unwrap();

        let index = LibraryIndex::load_and_migrate(dir.path()).unwrap();
        assert_eq!(index.version, CURRENT_VERSION);
        assert!(index.folders.iter().any(|f| f.id == ROOT_FOLDER_ID));

        let backup = dir.path().join("library.v0.json.bak");
        assert!(backup.exists());
        assert_eq!(fs::read_to_string(&backup).unwrap(), original_content);
    }

    #[test]
    fn load_and_migrate_rejects_future_version() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.json");
        let mut json = make_current_version_json();
        json.as_object_mut()
            .unwrap()
            .insert("version".to_string(), Value::Number(99.into()));
        fs::write(&path, serde_json::to_string_pretty(&json).unwrap()).unwrap();

        let result = LibraryIndex::load_and_migrate(dir.path());
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::SchemaVersionTooNew {
                file_version,
                max_supported,
            } => {
                assert_eq!(file_version, 99);
                assert_eq!(max_supported, CURRENT_VERSION);
            }
            other => panic!("Expected SchemaVersionTooNew, got: {:?}", other),
        }

        let backup = dir.path().join("library.v99.json.bak");
        assert!(!backup.exists());
    }

    #[test]
    fn load_and_migrate_v0_with_folders_preserves_data() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.json");
        let json = make_legacy_json_with_folders();
        fs::write(&path, serde_json::to_string_pretty(&json).unwrap()).unwrap();

        let index = LibraryIndex::load_and_migrate(dir.path()).unwrap();
        assert_eq!(index.version, CURRENT_VERSION);
        assert_eq!(index.mods.len(), 1);
        assert_eq!(index.folders.len(), 1);
        assert_eq!(index.folders[0].id, ROOT_FOLDER_ID);
        assert_eq!(index.folders[0].mod_ids, vec!["mod-a"]);
    }
}
