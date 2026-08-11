//! Library reads and per-profile mod state.
//!
//! Everything here is a view of, or an edit to, what the active profile says
//! about its mods — which are enabled, in what order, with which layers, and
//! what metadata they carry. The install pipeline lives in [`super::install`],
//! archive parsing in [`super::metadata`], and overlay conversion in
//! [`super::overlay_content`].

use crate::config::Config;
use crate::error::{AppError, AppResult};
use crate::events::BackendEvent;
use crate::mods::ModLibrary;
use crate::mods::archive::metadata::{
    extract_fantome_thumbnail, extract_modpkg_thumbnail, load_mod_project, read_installed_mod,
};
use crate::mods::index::ModArchiveFormat;
use crate::mods::index::get_active_profile;
use crate::mods::types::{EditModMetadataArgs, InstalledMod};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;

impl ModLibrary {
    pub fn get_installed_mods(&self, config: &Config) -> AppResult<Vec<InstalledMod>> {
        self.with_index(config, |storage_dir, index| {
            let active_profile_id = index.active_profile_id.clone();
            let active_profile = index
                .profiles
                .iter()
                .find(|p| p.id == active_profile_id)
                .ok_or_else(|| AppError::Other("Active profile not found".to_string()))?;

            let enabled_set: std::collections::HashSet<&str> = active_profile
                .enabled_mods
                .iter()
                .map(|s| s.as_str())
                .collect();

            // Build mod→folder ID lookup
            let mut mod_folder_map: std::collections::HashMap<&str, &str> =
                std::collections::HashMap::new();
            for folder in &index.folders {
                for mid in &folder.mod_ids {
                    mod_folder_map.insert(mid.as_str(), folder.id.as_str());
                }
            }

            let mut result = Vec::new();
            for mod_id in &active_profile.mod_order {
                let Some(entry) = index.mods.iter().find(|m| &m.id == mod_id) else {
                    continue;
                };
                let enabled = enabled_set.contains(mod_id.as_str());
                let mod_layer_states = active_profile.layer_states.get(mod_id.as_str());
                match read_installed_mod(entry, enabled, storage_dir, mod_layer_states) {
                    Ok(mut m) => {
                        if let Some(&fid) = mod_folder_map.get(mod_id.as_str()) {
                            m.folder_id = Some(fid.to_string());
                        }
                        result.push(m);
                    }
                    Err(e) => {
                        tracing::warn!("Skipping broken mod entry {}: {}", entry.id, e);
                    }
                }
            }

            Ok(result)
        })
    }

    /// Reorder all mods for the active profile.
    /// The provided `mod_ids` must exactly match the active profile's mod order.
    /// The `enabled_mods` order is derived from the new display order.
    pub fn reorder_mods(&self, config: &Config, mod_ids: Vec<String>) -> AppResult<()> {
        self.mutate_index(config, |_storage_dir, index| {
            let active_profile_id = index.active_profile_id.clone();
            let profile = index
                .profiles
                .iter_mut()
                .find(|p| p.id == active_profile_id)
                .ok_or_else(|| AppError::Other("Active profile not found".to_string()))?;

            // Validate that the provided IDs exactly match the profile's mod order
            let mut expected_sorted: Vec<&str> =
                profile.mod_order.iter().map(|s| s.as_str()).collect();
            expected_sorted.sort();
            let mut new_sorted: Vec<&str> = mod_ids.iter().map(|s| s.as_str()).collect();
            new_sorted.sort();

            if expected_sorted != new_sorted {
                return Err(AppError::ValidationFailed(
                    "Provided mod IDs do not match the profile's mod order".to_string(),
                ));
            }

            // Derive enabled_mods order from new display order
            let enabled_set: std::collections::HashSet<&str> =
                profile.enabled_mods.iter().map(|s| s.as_str()).collect();
            profile.enabled_mods = mod_ids
                .iter()
                .filter(|id| enabled_set.contains(id.as_str()))
                .cloned()
                .collect();

            profile.mod_order = mod_ids;

            Ok(())
        })
    }

    pub fn toggle_mod_enabled(
        &self,
        config: &Config,
        mod_id: &str,
        enabled: bool,
    ) -> AppResult<()> {
        self.mutate_index(config, |_storage_dir, index| {
            // Validate mod exists
            if !index.mods.iter().any(|m| m.id == mod_id) {
                return Err(AppError::ModNotFound(mod_id.to_string()));
            }

            // Update active profile's enabled mods
            let active_profile_id = index.active_profile_id.clone();
            let profile = index
                .profiles
                .iter_mut()
                .find(|p| p.id == active_profile_id)
                .ok_or_else(|| AppError::Other("Active profile not found".to_string()))?;

            if enabled {
                if !profile.enabled_mods.contains(&mod_id.to_string()) {
                    // Insert at position preserving relative order from mod_order
                    let insert_pos = if let Some(order_pos) =
                        profile.mod_order.iter().position(|id| id == mod_id)
                    {
                        profile
                            .enabled_mods
                            .iter()
                            .position(|id| {
                                profile
                                    .mod_order
                                    .iter()
                                    .position(|oid| oid == id)
                                    .is_none_or(|p| p > order_pos)
                            })
                            .unwrap_or(profile.enabled_mods.len())
                    } else {
                        0
                    };
                    profile.enabled_mods.insert(insert_pos, mod_id.to_string());
                }
            } else {
                profile.enabled_mods.retain(|id| id != mod_id);
            }

            Ok(())
        })
    }

    /// Set several mods to the same enabled state in one index transaction.
    ///
    /// Bulk toolbar actions must not call [`Self::toggle_mod_enabled`] once per
    /// mod: every call reloads and atomically rewrites the complete library
    /// document. This validates the complete request first, then performs one
    /// ordered update and one write.
    pub fn set_mods_enabled(
        &self,
        config: &Config,
        mod_ids: &[String],
        enabled: bool,
    ) -> AppResult<()> {
        if mod_ids.is_empty() {
            return Ok(());
        }

        self.mutate_index(config, |_storage_dir, index| {
            let requested: HashSet<&str> = mod_ids.iter().map(String::as_str).collect();
            if let Some(missing) = requested
                .iter()
                .find(|id| !index.mods.iter().any(|entry| entry.id == **id))
            {
                return Err(AppError::ModNotFound((*missing).to_string()));
            }

            let active_profile_id = index.active_profile_id.clone();
            let profile = index
                .profiles
                .iter_mut()
                .find(|profile| profile.id == active_profile_id)
                .ok_or_else(|| AppError::Other("Active profile not found".to_string()))?;

            if enabled {
                let previously_enabled: HashSet<&str> =
                    profile.enabled_mods.iter().map(String::as_str).collect();
                let mut enabled_mods: Vec<String> = profile
                    .mod_order
                    .iter()
                    .filter(|id| {
                        previously_enabled.contains(id.as_str()) || requested.contains(id.as_str())
                    })
                    .cloned()
                    .collect();
                let mut included: HashSet<String> = enabled_mods.iter().cloned().collect();

                // A repaired or legacy profile may omit an installed mod from
                // `mod_order`. Preserve already-enabled entries and still honor
                // the complete request instead of silently dropping either.
                for id in profile.enabled_mods.iter().chain(mod_ids) {
                    if included.insert(id.clone()) {
                        enabled_mods.push(id.clone());
                    }
                }

                profile.enabled_mods = enabled_mods;
            } else {
                profile
                    .enabled_mods
                    .retain(|id| !requested.contains(id.as_str()));
            }

            Ok(())
        })
    }

    /// Set the enabled/disabled state of individual layers for a mod in the active profile.
    pub fn set_mod_layers(
        &self,
        config: &Config,
        mod_id: &str,
        layer_states: HashMap<String, bool>,
    ) -> AppResult<()> {
        self.mutate_index(config, |_storage_dir, index| {
            if !index.mods.iter().any(|m| m.id == mod_id) {
                return Err(AppError::ModNotFound(mod_id.to_string()));
            }

            let active_profile_id = index.active_profile_id.clone();
            let profile = index
                .profiles
                .iter_mut()
                .find(|p| p.id == active_profile_id)
                .ok_or_else(|| AppError::Other("Active profile not found".to_string()))?;

            profile
                .layer_states
                .insert(mod_id.to_string(), layer_states);

            Ok(())
        })
    }

    /// Enable a mod and set its initial layer configuration in a single atomic operation.
    pub fn enable_mod_with_layers(
        &self,
        config: &Config,
        mod_id: &str,
        layer_states: HashMap<String, bool>,
    ) -> AppResult<()> {
        self.mutate_index(config, |_storage_dir, index| {
            if !index.mods.iter().any(|m| m.id == mod_id) {
                return Err(AppError::ModNotFound(mod_id.to_string()));
            }

            let active_profile_id = index.active_profile_id.clone();
            let profile = index
                .profiles
                .iter_mut()
                .find(|p| p.id == active_profile_id)
                .ok_or_else(|| AppError::Other("Active profile not found".to_string()))?;

            if !profile.enabled_mods.contains(&mod_id.to_string()) {
                let insert_pos =
                    if let Some(order_pos) = profile.mod_order.iter().position(|id| id == mod_id) {
                        profile
                            .enabled_mods
                            .iter()
                            .position(|id| {
                                profile
                                    .mod_order
                                    .iter()
                                    .position(|oid| oid == id)
                                    .is_none_or(|p| p > order_pos)
                            })
                            .unwrap_or(profile.enabled_mods.len())
                    } else {
                        0
                    };
                profile.enabled_mods.insert(insert_pos, mod_id.to_string());
            }

            profile
                .layer_states
                .insert(mod_id.to_string(), layer_states);

            Ok(())
        })
    }

    pub fn edit_mod_metadata(
        &self,
        config: &Config,
        mod_id: &str,
        args: EditModMetadataArgs,
    ) -> AppResult<InstalledMod> {
        self.mutate_index(config, |storage_dir, index| {
            let entry = index
                .mods
                .iter()
                .find(|m| m.id == mod_id)
                .ok_or_else(|| AppError::ModNotFound(mod_id.to_string()))?;

            let mod_dir = entry.metadata_dir(storage_dir);
            let mut project = load_mod_project(&mod_dir)?;

            if let Some(dn) = args.display_name {
                project.display_name = dn;
            }
            if let Some(t) = args.tags {
                project.tags = t.into_iter().map(ltk_mod_project::ModTag::from).collect();
            }
            if let Some(c) = args.champions {
                project.champions = c;
            }
            if let Some(m) = args.maps {
                project.maps = m.into_iter().map(ltk_mod_project::ModMap::from).collect();
            }

            if let Some(true) = args.remove_thumbnail {
                let _ = fs::remove_file(mod_dir.join("thumbnail.webp"));
                let _ = fs::remove_file(mod_dir.join("thumbnail.png"));
                project.thumbnail = None;
            } else if let Some(image_path) = args.set_thumbnail_path {
                let source_path = PathBuf::from(&image_path);
                if !source_path.exists() {
                    return Err(AppError::InvalidPath(image_path));
                }

                let extension = source_path
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.to_lowercase())
                    .unwrap_or_default();

                let supported_formats = [
                    "webp", "png", "jpg", "jpeg", "gif", "bmp", "tiff", "tif", "ico",
                ];
                if !supported_formats.contains(&extension.as_str()) {
                    return Err(AppError::ValidationFailed(format!(
                        "Unsupported image format: {}. Supported formats: {}",
                        extension,
                        supported_formats.join(", ")
                    )));
                }

                let webp_data = if extension == "webp" {
                    image::open(&source_path).map_err(|e| {
                        AppError::ValidationFailed(format!("Failed to open image: {}", e))
                    })?;
                    fs::read(&source_path)?
                } else {
                    let img = image::open(&source_path).map_err(|e| {
                        AppError::ValidationFailed(format!("Failed to open image: {}", e))
                    })?;
                    let encoder = webp::Encoder::from_image(&img).map_err(|e| {
                        AppError::ValidationFailed(format!("Failed to encode WebP: {}", e))
                    })?;
                    encoder.encode(90.0).to_vec()
                };

                let target_path = mod_dir.join("thumbnail.webp");
                let tmp_path = mod_dir.join("thumbnail.webp.tmp");

                fs::write(&tmp_path, webp_data)?;

                if target_path.exists() {
                    let _ = fs::remove_file(&target_path);
                }
                fs::rename(&tmp_path, &target_path)?;

                let _ = fs::remove_file(mod_dir.join("thumbnail.png"));
                project.thumbnail = Some("thumbnail.webp".to_string());
            }

            let config_path = mod_dir.join("mod.config.json");
            std::fs::write(config_path, serde_json::to_string_pretty(&project)?)?;

            // Determine if enabled
            let mut enabled = false;
            let mut layer_states = None;
            if let Ok(active_profile) = get_active_profile(index) {
                enabled = active_profile.enabled_mods.contains(&mod_id.to_string());
                layer_states = active_profile.layer_states.get(mod_id);
            }

            read_installed_mod(entry, enabled, storage_dir, layer_states)
        })
    }

    /// Get a mod's cached thumbnail path, extracting from the archive on first access.
    /// Returns `None` if the mod has no thumbnail.
    pub fn get_mod_thumbnail_path(
        &self,
        config: &Config,
        mod_id: &str,
    ) -> AppResult<Option<String>> {
        self.with_index(config, |storage_dir, index| {
            let entry = index
                .mods
                .iter()
                .find(|m| m.id == mod_id)
                .ok_or_else(|| AppError::ModNotFound(mod_id.to_string()))?;

            let metadata_dir = entry.metadata_dir(storage_dir);

            // Check for already-cached thumbnail
            for filename in ["thumbnail.webp", "thumbnail.png"] {
                let cached = metadata_dir.join(filename);
                if cached.exists() {
                    return Ok(Some(cached.display().to_string()));
                }
            }

            // Lazy migration: extract from archive and cache
            let archive_path = entry.archive_path(storage_dir);
            if !archive_path.exists() {
                return Err(AppError::InvalidPath(archive_path.display().to_string()));
            }

            let cached_path = match entry.format {
                ModArchiveFormat::Fantome => {
                    extract_fantome_thumbnail(&archive_path, &metadata_dir)?
                }
                ModArchiveFormat::Modpkg => extract_modpkg_thumbnail(&archive_path, &metadata_dir)?,
            };

            Ok(cached_path.map(|p| p.display().to_string()))
        })
    }

    /// Validate and cache image bytes as a mod's local WebP thumbnail.
    ///
    /// This is used by source-aware installers when an archive does not embed
    /// artwork. The decoded image is re-encoded so untrusted downloads cannot
    /// be persisted under a misleading image extension.
    pub fn cache_mod_thumbnail(
        &self,
        config: &Config,
        mod_id: &str,
        image_bytes: &[u8],
    ) -> AppResult<String> {
        let path = self.with_index(config, |storage_dir, index| {
            let entry = index
                .mods
                .iter()
                .find(|entry| entry.id == mod_id)
                .ok_or_else(|| AppError::ModNotFound(mod_id.to_string()))?;
            let metadata_dir = entry.metadata_dir(storage_dir);

            let image = image::load_from_memory(image_bytes).map_err(|error| {
                AppError::ValidationFailed(format!("Failed to decode thumbnail: {error}"))
            })?;
            let encoder = webp::Encoder::from_image(&image).map_err(|error| {
                AppError::ValidationFailed(format!("Failed to encode thumbnail: {error}"))
            })?;
            let encoded = encoder.encode(90.0);

            let destination = metadata_dir.join("thumbnail.webp");
            let temporary = metadata_dir.join("thumbnail.webp.tmp");
            fs::write(&temporary, &*encoded)?;
            if destination.exists() {
                fs::remove_file(&destination)?;
            }
            fs::rename(&temporary, &destination)?;
            let _ = fs::remove_file(metadata_dir.join("thumbnail.png"));

            Ok(destination.display().to_string())
        })?;
        self.events.emit(BackendEvent::LibraryChanged);
        Ok(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::NullEventSink;
    use crate::mods::index::document::{load_library_index, save_library_index};
    use crate::mods::index::{LibraryIndex, LibraryModEntry};
    use crate::mods::{LinkedBinState, WadReportState};
    use chrono::Utc;
    use std::sync::Arc;

    fn fixture() -> (tempfile::TempDir, Config, ModLibrary) {
        let dir = tempfile::tempdir().unwrap();
        let config = Config {
            mod_storage_path: Some(dir.path().to_path_buf()),
            ..Config::default()
        };
        let library = ModLibrary::new(
            Arc::new(NullEventSink),
            Some(dir.path().to_path_buf()),
            "test",
            Arc::new(LinkedBinState::default()),
            Arc::new(WadReportState::new(Some(dir.path()))),
        );

        let mut index = LibraryIndex::default();
        for id in ["a", "b", "c"] {
            index.mods.push(LibraryModEntry {
                id: id.to_string(),
                installed_at: Utc::now(),
                format: ModArchiveFormat::Modpkg,
            });
        }
        let profile = index.profiles.first_mut().unwrap();
        profile.mod_order = ["a", "b", "c"].map(String::from).to_vec();
        profile.enabled_mods = vec!["b".to_string()];
        save_library_index(dir.path(), &index).unwrap();
        (dir, config, library)
    }

    #[test]
    fn set_mods_enabled_preserves_profile_order() {
        let (dir, config, library) = fixture();

        library
            .set_mods_enabled(&config, &["c".to_string(), "a".to_string()], true)
            .unwrap();
        let index = load_library_index(dir.path()).unwrap();
        assert_eq!(
            index.profiles[0].enabled_mods,
            ["a", "b", "c"].map(String::from)
        );

        library
            .set_mods_enabled(&config, &["a".to_string(), "c".to_string()], false)
            .unwrap();
        let index = load_library_index(dir.path()).unwrap();
        assert_eq!(index.profiles[0].enabled_mods, vec!["b"]);
    }

    #[test]
    fn set_mods_enabled_validates_before_changing_anything() {
        let (dir, config, library) = fixture();

        let error = library
            .set_mods_enabled(&config, &["a".to_string(), "missing".to_string()], true)
            .unwrap_err();
        assert!(matches!(error, AppError::ModNotFound(_)));
        let index = load_library_index(dir.path()).unwrap();
        assert_eq!(index.profiles[0].enabled_mods, vec!["b"]);
    }

    #[test]
    fn set_mods_enabled_handles_mod_missing_from_profile_order() {
        let (dir, config, library) = fixture();
        let mut index = load_library_index(dir.path()).unwrap();
        index.profiles[0].mod_order.retain(|id| id != "c");
        save_library_index(dir.path(), &index).unwrap();

        library
            .set_mods_enabled(&config, &["c".to_string()], true)
            .unwrap();

        let index = load_library_index(dir.path()).unwrap();
        assert_eq!(index.profiles[0].enabled_mods, ["b", "c"].map(String::from));
    }

    #[test]
    fn cache_mod_thumbnail_validates_and_writes_webp() {
        let (dir, config, library) = fixture();
        let metadata_dir = dir.path().join("mods").join("a");
        fs::create_dir_all(&metadata_dir).unwrap();

        let mut png = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgba8(2, 2)
            .write_to(&mut png, image::ImageFormat::Png)
            .unwrap();

        let path = library
            .cache_mod_thumbnail(&config, "a", png.get_ref())
            .unwrap();
        assert_eq!(PathBuf::from(path), metadata_dir.join("thumbnail.webp"));
        assert!(image::open(metadata_dir.join("thumbnail.webp")).is_ok());

        let error = library
            .cache_mod_thumbnail(&config, "a", b"not an image")
            .unwrap_err();
        assert!(matches!(error, AppError::ValidationFailed(_)));
    }
}
