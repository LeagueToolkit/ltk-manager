//! Getting mods into and out of the library.
//!
//! Installing copies the archive into storage under a fresh UUID and extracts
//! its metadata beside it; uninstalling reverses both and scrubs the mod from
//! every profile and folder. Both run inside `mutate_index`, so a bulk install
//! takes the index lock once rather than once per file.

use crate::config::Config;
use crate::error::{AppError, AppResult};
use crate::events::{BackendEvent, InstallProgress};
use crate::mods::ModLibrary;
use crate::mods::archive::metadata::{
    extract_fantome_metadata, extract_modpkg_metadata, load_mod_project, read_installed_mod,
};
use crate::mods::index::{LibraryIndex, LibraryModEntry, ModArchiveFormat};
use crate::mods::types::{BulkInstallError, BulkInstallResult, InstalledMod, ROOT_FOLDER_ID};
use chrono::Utc;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use uuid::Uuid;

impl ModLibrary {
    pub fn install_mod_from_package(
        &self,
        config: &Config,
        file_path: &str,
    ) -> AppResult<InstalledMod> {
        self.mutate_index(config, |storage_dir, index| {
            let (_entry, installed_mod) =
                install_single_mod_to_index(storage_dir, index, file_path)?;
            Ok(installed_mod)
        })
    }

    /// Install multiple mods in a single batch operation.
    ///
    /// Acquires the index lock once, installs each mod, saves once, and invalidates
    /// the overlay once. Emits `"install-progress"` events per file.
    pub fn install_mods_from_packages(
        &self,
        config: &Config,
        file_paths: &[String],
    ) -> AppResult<BulkInstallResult> {
        if file_paths.is_empty() {
            return Ok(BulkInstallResult {
                installed: Vec::new(),
                failed: Vec::new(),
            });
        }

        let events = Arc::clone(self.events());
        let file_paths = file_paths.to_vec();

        self.mutate_index(config, |storage_dir, index| {
            let total = file_paths.len();
            let mut installed = Vec::new();
            let mut failed = Vec::new();

            for (i, file_path) in file_paths.iter().enumerate() {
                let file_name = Path::new(file_path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(file_path)
                    .to_string();

                events.emit(BackendEvent::InstallProgress(InstallProgress {
                    current: i + 1,
                    total,
                    current_file: file_name.clone(),
                }));

                match install_single_mod_to_index(storage_dir, index, file_path) {
                    Ok((_entry, mod_info)) => {
                        installed.push(mod_info);
                    }
                    Err(e) => {
                        tracing::warn!("Failed to install {}: {}", file_path, e);
                        failed.push(BulkInstallError {
                            file_path: file_path.clone(),
                            file_name,
                            message: e.to_string(),
                        });
                    }
                }
            }

            Ok(BulkInstallResult { installed, failed })
        })
    }

    pub fn uninstall_mod_by_id(&self, config: &Config, mod_id: &str) -> AppResult<()> {
        self.mutate_index(config, |storage_dir, index| {
            let Some(pos) = index.mods.iter().position(|m| m.id == mod_id) else {
                return Err(AppError::ModNotFound(mod_id.to_string()));
            };

            let entry = index.mods.remove(pos);

            // Remove from all folders
            for folder in &mut index.folders {
                folder.mod_ids.retain(|id| id != mod_id);
            }

            // Remove from all profiles' mod_order and enabled_mods
            for profile in &mut index.profiles {
                profile.mod_order.retain(|id| id != mod_id);
                profile.enabled_mods.retain(|id| id != mod_id);
                profile.layer_states.remove(mod_id);
            }

            // Delete metadata directory
            let metadata_dir = entry.metadata_dir(storage_dir);
            if metadata_dir.exists() {
                fs::remove_dir_all(&metadata_dir)?;
            }

            // Delete archive file
            let archive_path = entry.archive_path(storage_dir);
            if archive_path.exists() {
                fs::remove_file(&archive_path)?;
                tracing::info!("Deleted mod archive at {}", archive_path.display());
            }

            Ok(())
        })
    }
}

/// Core install logic for a single mod file.
///
/// Copies the archive, extracts metadata, and adds the mod to the index.
/// Does NOT load/save the index or invalidate the overlay.
pub(crate) fn install_single_mod_to_index(
    storage_dir: &Path,
    index: &mut LibraryIndex,
    file_path: &str,
) -> AppResult<(LibraryModEntry, InstalledMod)> {
    let file_path = PathBuf::from(file_path);
    if !file_path.exists() {
        return Err(AppError::InvalidPath(file_path.display().to_string()));
    }

    let archives_dir = storage_dir.join("archives");
    let metadata_dir = storage_dir.join("mods");
    fs::create_dir_all(&archives_dir)?;
    fs::create_dir_all(&metadata_dir)?;

    let id = Uuid::new_v4().to_string();

    let format = file_path
        .extension()
        .and_then(|ext| ext.to_str())
        .and_then(ModArchiveFormat::from_extension)
        .unwrap_or(ModArchiveFormat::Modpkg);

    let installed_at = Utc::now();

    // Copy archive to archives directory
    let archive_filename = format!("{}.{}", id, format.extension());
    let archive_path = archives_dir.join(&archive_filename);
    fs::copy(&file_path, &archive_path)?;
    tracing::info!(
        "Copied mod archive from {} to {}",
        file_path.display(),
        archive_path.display()
    );

    // Extract only metadata to metadata directory
    let mod_metadata_dir = metadata_dir.join(&id);
    fs::create_dir_all(&mod_metadata_dir)?;

    match format {
        ModArchiveFormat::Fantome => extract_fantome_metadata(&archive_path, &mod_metadata_dir)?,
        ModArchiveFormat::Modpkg => extract_modpkg_metadata(&archive_path, &mod_metadata_dir)?,
    }

    let entry = LibraryModEntry {
        id: id.clone(),
        installed_at,
        format,
    };
    index.mods.push(entry.clone());

    // Add to root folder
    if let Some(root) = index.folders.iter_mut().find(|f| f.id == ROOT_FOLDER_ID) {
        root.mod_ids.insert(0, id.clone());
    }

    // Enable in active profile and add to display order
    let active_profile_id = index.active_profile_id.clone();
    if let Some(profile) = index
        .profiles
        .iter_mut()
        .find(|p| p.id == active_profile_id)
    {
        profile.enabled_mods.insert(0, id.clone());
        profile.mod_order.insert(0, id.clone());
    }

    // Reconcile layer_states across all profiles for this mod ID.
    // When a mod is re-installed with a different set of layers, remove stale entries.
    if let Ok(project) = load_mod_project(&mod_metadata_dir) {
        let new_layer_names: std::collections::HashSet<&str> =
            project.layers.iter().map(|l| l.name.as_str()).collect();
        for profile in &mut index.profiles {
            if let Some(states) = profile.layer_states.get_mut(&id) {
                states.retain(|name, _| new_layer_names.contains(name.as_str()));
            }
        }
    }

    let installed_mod = read_installed_mod(&entry, true, storage_dir, None)?;
    Ok((entry, installed_mod))
}

#[cfg(test)]
mod tests {
    use super::*;
    use assert_matches::assert_matches;
    use std::collections::HashMap;
    use std::io::Write;

    fn make_test_fantome_zip(dir: &Path, include_thumbnail: bool, include_readme: bool) -> PathBuf {
        let info = ltk_fantome::FantomeInfo {
            name: "Test Mod".to_string(),
            author: "Author".to_string(),
            version: "1.0.0".to_string(),
            description: "Description".to_string(),
            license: None,
            tags: Vec::new(),
            champions: Vec::new(),
            maps: Vec::new(),
            layers: HashMap::new(),
        };

        let zip_path = dir.join("test.fantome");
        let file = std::fs::File::create(&zip_path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();

        zip.start_file("META/info.json", options).unwrap();
        zip.write_all(serde_json::to_string_pretty(&info).unwrap().as_bytes())
            .unwrap();

        if include_thumbnail {
            zip.start_file("META/image.png", options).unwrap();
            zip.write_all(b"fake png data").unwrap();
        }

        if include_readme {
            zip.start_file("META/readme.md", options).unwrap();
            zip.write_all(b"# Test Mod\nReadme content").unwrap();
        }

        zip.finish().unwrap();
        zip_path
    }

    #[test]

    fn install_single_mod_to_index_missing_file() {
        let storage = tempfile::tempdir().unwrap();
        let mut index = LibraryIndex::default();
        let result =
            install_single_mod_to_index(storage.path(), &mut index, "/nonexistent/file.fantome");
        assert_matches!(result, Err(AppError::InvalidPath(_)));
    }

    #[test]
    fn install_single_mod_to_index_adds_to_index() {
        let storage = tempfile::tempdir().unwrap();
        let source = tempfile::tempdir().unwrap();
        let archive_path = make_test_fantome_zip(source.path(), false, false);
        let mut index = LibraryIndex::default();
        assert!(index.mods.is_empty());

        let (_entry, installed) =
            install_single_mod_to_index(storage.path(), &mut index, archive_path.to_str().unwrap())
                .unwrap();

        assert_eq!(index.mods.len(), 1);
        assert_eq!(installed.display_name, "Test Mod");
        assert!(installed.enabled);

        let profile = index
            .profiles
            .iter()
            .find(|p| p.id == index.active_profile_id)
            .unwrap();
        assert_eq!(profile.mod_order[0], index.mods[0].id);
        assert_eq!(profile.enabled_mods[0], index.mods[0].id);
    }

    #[test]
    fn install_single_mod_format_detection_fantome() {
        let storage = tempfile::tempdir().unwrap();
        let source = tempfile::tempdir().unwrap();
        let archive_path = make_test_fantome_zip(source.path(), false, false);
        let mut index = LibraryIndex::default();

        let (entry, _) =
            install_single_mod_to_index(storage.path(), &mut index, archive_path.to_str().unwrap())
                .unwrap();

        assert_eq!(entry.format, ModArchiveFormat::Fantome);
    }
}
