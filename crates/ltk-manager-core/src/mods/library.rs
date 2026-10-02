//! Library reads and per-profile mod state.
//!
//! Everything here is a view of, or an edit to, what the active profile says
//! about its mods — which are enabled, in what order, with which layers, and
//! what metadata they carry. The install pipeline lives in [`super::install`],
//! archive parsing in [`super::metadata`], and overlay conversion in
//! [`super::overlay_content`].

use crate::config::Config;
use crate::error::{AppError, AppResult};
use crate::mods::ModLibrary;
use crate::mods::archive::documents::{ModDocument, entry_of, read_license, read_readme};
use crate::mods::archive::metadata::{load_mod_project, read_installed_mod};
use crate::mods::archive::reader::ModArchive;
use crate::mods::index::LibraryModEntry;
use crate::mods::index::get_active_profile;
use crate::mods::types::{EditModMetadataArgs, InstalledMod};
use crate::utils::thumbnail::{THUMBNAIL_FILE, write_thumbnail};
use fs_err as fs;
use std::collections::HashMap;
use std::path::Path;

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
    ///
    /// The provided `mod_ids` must exactly match the active profile's mod
    /// order. The order is written into the folders rather than onto the
    /// profile, which is what makes it survive the next sync, and
    /// `mod_order` and `enabled_mods` are re-derived from there.
    pub fn reorder_mods(&self, config: &Config, mod_ids: Vec<String>) -> AppResult<()> {
        self.mutate_index(config, |_storage_dir, index| {
            let active_profile_id = index.active_profile_id.clone();

            let matches_profile = {
                let profile = index
                    .profiles
                    .iter()
                    .find(|p| p.id == active_profile_id)
                    .ok_or_else(|| AppError::Other("Active profile not found".to_string()))?;

                let mut expected_sorted: Vec<&str> =
                    profile.mod_order.iter().map(|s| s.as_str()).collect();
                expected_sorted.sort_unstable();
                let mut new_sorted: Vec<&str> = mod_ids.iter().map(|s| s.as_str()).collect();
                new_sorted.sort_unstable();

                expected_sorted == new_sorted
            };

            if !matches_profile {
                return Err(AppError::ValidationFailed(
                    "Provided mod IDs do not match the profile's mod order".to_string(),
                ));
            }

            index.apply_flat_mod_order(&mod_ids);

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

            if !enabled {
                profile.enabled_mods.retain(|id| id != mod_id);
                return Ok(());
            }

            if !profile.enabled_mods.iter().any(|id| id == mod_id) {
                profile.enabled_mods.push(mod_id.to_string());
            }
            if config.promote_enabled_mods {
                index.promote_mod_to_folder_front(mod_id);
            } else {
                index.sync_profile_orders();
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

            if !profile.enabled_mods.iter().any(|id| id == mod_id) {
                profile.enabled_mods.push(mod_id.to_string());
            }

            profile
                .layer_states
                .insert(mod_id.to_string(), layer_states);

            if config.promote_enabled_mods {
                index.promote_mod_to_folder_front(mod_id);
            } else {
                index.sync_profile_orders();
            }

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

            let mod_dir = entry.mod_dir(storage_dir);
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
                write_thumbnail(Path::new(&image_path), &mod_dir)?;
                project.thumbnail = Some(THUMBNAIL_FILE.to_owned());
            }

            let config_path = mod_dir.join("mod.config.json");
            fs::write(config_path, serde_json::to_string_pretty(&project)?)?;

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
    ///
    /// # Errors
    ///
    /// Returns [`AppError::ModNotFound`] when no mod carries `mod_id`.
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

            thumbnail_path(storage_dir, entry)
        })
    }

    /// Get the cached thumbnail path of each of `mod_ids` that has one.
    ///
    /// The whole list under one index read, which is what a grid of cards asks
    /// for. A mod with no thumbnail, and an id no mod carries, are both absent
    /// from the answer rather than an error, so one unreadable archive does not
    /// cost the grid every other thumbnail.
    pub fn get_mod_thumbnail_paths(
        &self,
        config: &Config,
        mod_ids: &[String],
    ) -> AppResult<HashMap<String, String>> {
        self.with_index(config, |storage_dir, index| {
            let mut paths = HashMap::with_capacity(mod_ids.len());

            for mod_id in mod_ids {
                let Some(entry) = index.mods.iter().find(|m| &m.id == mod_id) else {
                    continue;
                };

                match thumbnail_path(storage_dir, entry) {
                    Ok(Some(path)) => {
                        paths.insert(mod_id.clone(), path);
                    }
                    Ok(None) => {}
                    Err(error) => {
                        tracing::warn!(mod_id, %error, "thumbnail unreadable");
                    }
                }
            }

            Ok(paths)
        })
    }

    /// One installed mod's readme, whichever format it was installed from.
    ///
    /// # Errors
    ///
    /// Fails when the index cannot be read, or when no mod carries `mod_id`.
    /// An archive that will not open is [`ModDocument::Unreadable`] rather than
    /// an error.
    pub fn get_mod_readme(&self, config: &Config, mod_id: &str) -> AppResult<ModDocument> {
        self.with_index(config, |storage_dir, index| {
            Ok(read_readme(storage_dir, entry_of(index, mod_id)?))
        })
    }

    /// One installed mod's license text, read out of its archive and not kept.
    ///
    /// # Errors
    ///
    /// Fails on the same two counts [`get_mod_readme`](Self::get_mod_readme)
    /// does.
    pub fn get_mod_license_text(&self, config: &Config, mod_id: &str) -> AppResult<ModDocument> {
        self.with_index(config, |storage_dir, index| {
            Ok(read_license(storage_dir, entry_of(index, mod_id)?))
        })
    }
}

/// One mod's cached thumbnail, extracted from its archive if it is not there yet.
fn thumbnail_path(storage_dir: &Path, entry: &LibraryModEntry) -> AppResult<Option<String>> {
    let mod_dir = entry.mod_dir(storage_dir);

    for filename in ["thumbnail.webp", "thumbnail.png"] {
        let cached = mod_dir.join(filename);
        if cached.exists() {
            return Ok(Some(cached.display().to_string()));
        }
    }

    // Nothing cached: a mod whose archive is still around can still be
    // asked. A fantome installed with archive retention off has none,
    // and simply has no thumbnail.
    let archive_path = entry.archive_path(storage_dir);
    if !archive_path.exists() {
        return Ok(None);
    }

    let cached_path = ModArchive::open(&archive_path, entry.format)?.write_thumbnail(&mod_dir)?;

    Ok(cached_path.map(|p| p.display().to_string()))
}

#[cfg(test)]
mod tests;
