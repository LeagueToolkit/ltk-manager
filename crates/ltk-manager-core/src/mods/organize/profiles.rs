use crate::config::Config;
use crate::error::{AppError, AppResult};
use crate::mods::StorageLayout as _;
use chrono::Utc;
use fs_err as fs;
use std::collections::HashMap;
use uuid::Uuid;

use crate::mods::ModLibrary;
use crate::mods::index::{get_active_profile, get_profile_by_id, resolve_profile_dirs};
use crate::mods::types::{Profile, ProfileSlug};

impl ModLibrary {
    /// Create a new profile.
    pub fn create_profile(&self, config: &Config, name: String) -> AppResult<Profile> {
        self.mutate_index(config, |storage_dir, index| {
            let name = name.trim().to_string();
            if name.is_empty() {
                return Err(AppError::Other("Profile name cannot be empty".to_string()));
            }

            if index.profiles.iter().any(|p| p.name == name) {
                return Err(AppError::Other(format!(
                    "Profile '{}' already exists",
                    name
                )));
            }

            let slug = ProfileSlug::from_name(&name).ok_or_else(|| {
                AppError::Other(
                    "Profile name must contain at least one alphanumeric character".to_string(),
                )
            })?;
            if !slug.is_unique_in(index, None) {
                return Err(AppError::Other(format!(
                    "Profile '{}' already exists",
                    name
                )));
            }

            let mod_order: Vec<String> = index.mods.iter().map(|m| m.id.clone()).collect();

            let profile = Profile {
                id: Uuid::new_v4().to_string(),
                name,
                slug,
                enabled_mods: Vec::new(),
                mod_order,
                layer_states: HashMap::new(),
                created_at: Utc::now(),
                last_used: Utc::now(),
            };

            let (overlay_dir, cache_dir) = resolve_profile_dirs(storage_dir, &profile.slug);
            fs::create_dir_all(&overlay_dir)?;
            fs::create_dir_all(&cache_dir)?;

            index.profiles.push(profile.clone());

            tracing::info!("Created profile: {} (id={})", profile.name, profile.id);
            Ok(profile)
        })
    }

    /// Delete a profile by ID.
    pub fn delete_profile(&self, config: &Config, profile_id: String) -> AppResult<()> {
        self.mutate_index(config, |storage_dir, index| {
            let profile = get_profile_by_id(index, &profile_id)?;

            if profile.name == "Default" {
                return Err(AppError::Other("Cannot delete Default profile".to_string()));
            }

            if profile_id == index.active_profile_id {
                return Err(AppError::Other(
                    "Cannot delete active profile. Switch to another profile first.".to_string(),
                ));
            }

            let profile_slug = profile.slug.clone();
            index.profiles.retain(|p| p.id != profile_id);

            let profile_dir = storage_dir.profile_dir(profile_slug.as_str());
            if profile_dir.exists() {
                fs::remove_dir_all(&profile_dir)?;
                tracing::info!("Deleted profile directory: {}", profile_dir.display());
            }

            tracing::info!("Deleted profile: {}", profile_id);
            Ok(())
        })
    }

    /// Switch to a different profile.
    pub fn switch_profile(&self, config: &Config, profile_id: String) -> AppResult<Profile> {
        self.mutate_index(config, |_storage_dir, index| {
            get_profile_by_id(index, &profile_id)?;
            index.active_profile_id = profile_id.clone();

            let profile = index
                .profiles
                .iter_mut()
                .find(|p| p.id == profile_id)
                .ok_or_else(|| AppError::Other("Profile not found after validation".to_string()))?;

            profile.last_used = Utc::now();
            let result = profile.clone();

            tracing::info!("Switched to profile: {} (id={})", result.name, result.id);
            Ok(result)
        })
    }

    /// Get all profiles.
    pub fn get_profiles(&self, config: &Config) -> AppResult<Vec<Profile>> {
        self.with_index(config, |_storage_dir, index| Ok(index.profiles.clone()))
    }

    /// Rename a profile.
    pub fn rename_profile(
        &self,
        config: &Config,
        profile_id: String,
        new_name: String,
    ) -> AppResult<Profile> {
        self.mutate_index(config, |storage_dir, index| {
            let new_name = new_name.trim().to_string();
            if new_name.is_empty() {
                return Err(AppError::Other("Profile name cannot be empty".to_string()));
            }

            let new_slug = ProfileSlug::from_name(&new_name).ok_or_else(|| {
                AppError::Other(
                    "Profile name must contain at least one alphanumeric character".to_string(),
                )
            })?;

            if index
                .profiles
                .iter()
                .any(|p| p.id != profile_id && p.name == new_name)
            {
                return Err(AppError::Other(format!(
                    "Profile '{}' already exists",
                    new_name
                )));
            }

            if !new_slug.is_unique_in(index, Some(&profile_id)) {
                return Err(AppError::Other(format!(
                    "Profile directory name '{}' conflicts with another profile",
                    new_slug
                )));
            }

            let profile = index
                .profiles
                .iter_mut()
                .find(|p| p.id == profile_id)
                .ok_or_else(|| AppError::Other("Profile not found".to_string()))?;

            if profile.name == "Default" {
                return Err(AppError::Other("Cannot rename Default profile".to_string()));
            }

            // Rename directory on disk if slug changed — done before index update
            // so that if rename fails, the closure returns Err and the index is NOT saved.
            if profile.slug != new_slug {
                let old_dir = storage_dir.profile_dir(profile.slug.as_str());
                let new_dir = storage_dir.profile_dir(new_slug.as_str());
                if old_dir.exists() {
                    fs::rename(&old_dir, &new_dir)?;
                    tracing::info!(
                        "Renamed profile dir: {} -> {}",
                        old_dir.display(),
                        new_dir.display()
                    );
                }
            }

            profile.name = new_name;
            profile.slug = new_slug;
            let result = profile.clone();

            tracing::info!("Renamed profile {} to: {}", profile_id, result.name);
            Ok(result)
        })
    }

    /// Get the active profile.
    pub fn get_active_profile_info(&self, config: &Config) -> AppResult<Profile> {
        self.with_index(config, |_storage_dir, index| {
            let profile = get_active_profile(index)?;
            Ok(profile.clone())
        })
    }
}
