//! Reading a mod's metadata out of its archive and back off disk.
//!
//! Every installed mod, whatever it arrived as, has a `mod.config.json` in its
//! directory. A fantome gets one from its importer and a modpkg gets one
//! written here, both normalized into the same [`ModProject`] shape, which is
//! why nothing downstream needs to know which format a mod came in as — and
//! why the library view never mounts an archive just to render a list.

use crate::error::{AppError, AppResult};
use crate::mods::index::LibraryModEntry;
use crate::mods::types::{InstalledMod, ModLayer, ModLicense};
use fs_err as fs;
use ltk_mod_project::{ModProject, ModProjectLayer};
use ltk_modpkg::Modpkg;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub(crate) fn read_installed_mod(
    entry: &LibraryModEntry,
    enabled: bool,
    storage_dir: &Path,
    layer_states: Option<&HashMap<String, bool>>,
) -> AppResult<InstalledMod> {
    let mod_dir = entry.mod_dir(storage_dir);
    let project = load_mod_project(&mod_dir)?;

    let authors = project
        .authors
        .iter()
        .map(|a| match a {
            ltk_mod_project::ModProjectAuthor::Name(name) => name.clone(),
            ltk_mod_project::ModProjectAuthor::Role { name, role: _ } => name.clone(),
        })
        .collect::<Vec<_>>();

    let layers = project
        .layers
        .iter()
        .map(|l| {
            let display_name = l
                .display_name
                .clone()
                .unwrap_or_else(|| crate::workshop::slug_to_display_name(&l.name));
            ModLayer {
                name: l.name.clone(),
                display_name,
                priority: l.priority,
                enabled: layer_states
                    .and_then(|states| states.get(&l.name))
                    .copied()
                    .unwrap_or(l.name == "base"),
            }
        })
        .collect::<Vec<_>>();

    Ok(InstalledMod {
        id: entry.id.clone(),
        name: project.name,
        display_name: project.display_name,
        version: project.version,
        description: Some(project.description).filter(|s| !s.is_empty()),
        authors,
        enabled,
        installed_at: entry.installed_at,
        layers,
        tags: project.tags.iter().map(|t| t.to_string()).collect(),
        champions: project.champions.clone(),
        maps: project.maps.iter().map(|m| m.to_string()).collect(),
        mod_dir: mod_dir.display().to_string(),
        format: entry.format,
        storage: entry.storage,
        has_archive: entry.archive_path(storage_dir).is_file(),
        folder_id: None,
        license: project.license.as_ref().map(ModLicense::from),
        slug: entry.slug.as_ref().map(|slug| slug.as_str().to_string()),
        harvest: entry.harvest,
    })
}

/// The layer table a fantome archive declares, or `None` when it declares none.
///
/// Only the layout migration reads this. Every other path gets the table from
/// the importer, which keeps what `META/info.json` carries — but a config an
/// older version of the app wrote does not, and repairing one means reading the
/// archive again. `None` is what says to leave such a config alone.
///
/// Derived through the same conversion the importer uses, so the migration
/// cannot decide a config needs rewriting over an ordering only this disagreed
/// about. Both sides order through [`ModProjectLayer::normalize_table`].
///
/// # Errors
///
/// Fails when the archive cannot be opened or its `META/info.json` cannot be
/// read.
pub(crate) fn fantome_layers(archive: &Path) -> AppResult<Option<Vec<ModProjectLayer>>> {
    let mut reader = ltk_fantome::FantomeReader::new(fs::File::open(archive)?)
        .map_err(|e| AppError::Other(format!("Failed to open fantome archive: {e}")))?;
    let info = reader
        .read_info()
        .map_err(|e| AppError::Other(format!("Failed to read META/info.json: {e}")))?;

    if info.layers.is_empty() {
        return Ok(None);
    }

    Ok(Some(ModProject::from(info).layers))
}

pub(crate) fn load_mod_project(mod_dir: &Path) -> AppResult<ModProject> {
    let config_path = mod_dir.join("mod.config.json");
    let contents = fs::read_to_string(&config_path).map_err(|e| {
        AppError::Io(std::io::Error::new(
            e.kind(),
            format!("Failed to read {}: {}", config_path.display(), e),
        ))
    })?;
    serde_json::from_str(&contents).map_err(AppError::from)
}

/// Write a fantome's own metadata out as a mod project config.
///
/// Reads `META/info.json` and the thumbnail, never the content, so this costs
/// one seek where importing the archive costs an unpack. It is what gives a
/// mod kept in its archive the config every card and every slug is read from.
///
/// # Errors
///
/// Fails when the archive cannot be opened, its `META/info.json` cannot be
/// read, or the config cannot be written.
pub(crate) fn extract_fantome_metadata(archive: &Path, metadata_dir: &Path) -> AppResult<()> {
    let mut reader = ltk_fantome::FantomeReader::new(fs::File::open(archive)?)
        .map_err(|e| AppError::Other(format!("Failed to open fantome archive: {e}")))?;
    let info = reader
        .read_info()
        .map_err(|e| AppError::Other(format!("Failed to read META/info.json: {e}")))?;

    let project = ModProject::from(info);

    fs::create_dir_all(metadata_dir)?;
    fs::write(
        metadata_dir.join("mod.config.json"),
        serde_json::to_string_pretty(&project)?,
    )?;
    let _ = extract_fantome_thumbnail(archive, metadata_dir);

    tracing::info!("Extracted fantome metadata to {}", metadata_dir.display());

    Ok(())
}

/// Write a modpkg's own metadata out as a mod project config.
///
/// It is what gives a mod kept in its archive the config every card and every
/// slug is read from.
///
/// # Errors
///
/// Fails when the package cannot be mounted or read, or the config cannot be
/// written.
pub(crate) fn extract_modpkg_metadata(file_path: &Path, metadata_dir: &Path) -> AppResult<()> {
    let file = fs::File::open(file_path)?;
    let mut modpkg = Modpkg::mount_from_reader(file)?;

    let project = ltk_mod_project::modpkg::read_project(&mut modpkg)?;

    let config_path = metadata_dir.join("mod.config.json");
    fs::write(config_path, serde_json::to_string_pretty(&project)?)?;

    if let Ok(readme_bytes) = modpkg.load_readme() {
        let _ = fs::write(metadata_dir.join("README.md"), readme_bytes);
    }

    if let Ok(thumbnail_bytes) = modpkg.load_thumbnail() {
        let _ = fs::write(metadata_dir.join("thumbnail.webp"), thumbnail_bytes);
    }

    tracing::info!("Extracted modpkg metadata to {}", metadata_dir.display());

    Ok(())
}

/// Extract thumbnail from a fantome archive and save to the metadata directory.
/// Returns the path to the saved file, or `None` if the archive has no thumbnail.
///
/// # Errors
///
/// Fails when the archive cannot be opened or its thumbnail cannot be written.
pub(crate) fn extract_fantome_thumbnail(
    archive_path: &Path,
    metadata_dir: &Path,
) -> AppResult<Option<PathBuf>> {
    let mut reader = ltk_fantome::FantomeReader::new(fs::File::open(archive_path)?)
        .map_err(|e| AppError::Other(format!("Failed to open fantome archive: {e}")))?;
    let Some(png) = reader
        .read_image_png()
        .map_err(|e| AppError::Other(format!("Failed to read the thumbnail: {e}")))?
    else {
        return Ok(None);
    };

    let dest = metadata_dir.join("thumbnail.png");
    fs::write(&dest, png)?;
    Ok(Some(dest))
}

/// Extract thumbnail from a modpkg archive and save to the metadata directory.
/// Returns the path to the saved file, or `None` if the archive has no thumbnail.
pub(crate) fn extract_modpkg_thumbnail(
    archive_path: &Path,
    metadata_dir: &Path,
) -> AppResult<Option<PathBuf>> {
    let file = fs::File::open(archive_path)?;
    let mut modpkg = Modpkg::mount_from_reader(file)?;

    match modpkg.load_thumbnail() {
        Ok(thumbnail_bytes) => {
            let dest = metadata_dir.join("thumbnail.webp");
            fs::write(&dest, &thumbnail_bytes)?;
            Ok(Some(dest))
        }
        Err(_) => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mods::index::ModArchiveFormat;
    use crate::mods::test_support::make_slugged_entry;
    use std::io::Write;

    fn make_test_mod_config_json() -> String {
        serde_json::to_string_pretty(&ltk_mod_project::ModProject {
            name: "test-mod".to_string(),
            display_name: "Test Mod".to_string(),
            version: "1.0.0".to_string(),
            description: "A test mod".to_string(),
            authors: vec![ltk_mod_project::ModProjectAuthor::Name(
                "Author".to_string(),
            )],
            license: None,
            tags: Vec::new(),
            champions: vec!["Aatrox".to_string()],
            maps: Vec::new(),
            transformers: Vec::new(),
            layers: ltk_mod_project::ModProjectLayer::default_table(),
            thumbnail: None,
            hashtables: Vec::new(),
        })
        .unwrap()
    }

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
            ..Default::default()
        };

        let zip_path = dir.join("test.fantome");
        let file = fs::File::create(&zip_path).unwrap();
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
    fn load_mod_project_valid_json() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("mod.config.json"),
            make_test_mod_config_json(),
        )
        .unwrap();
        let project = load_mod_project(dir.path()).unwrap();
        assert_eq!(project.name, "test-mod");
        assert_eq!(project.version, "1.0.0");
        assert_eq!(project.display_name, "Test Mod");
    }

    #[test]
    fn load_mod_project_invalid_json() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("mod.config.json"), "not valid json").unwrap();
        assert!(load_mod_project(dir.path()).is_err());
    }

    #[test]
    fn load_mod_project_missing_file() {
        let dir = tempfile::tempdir().unwrap();
        assert!(load_mod_project(dir.path()).is_err());
    }

    #[test]
    fn read_installed_mod_populates_all_fields() {
        let storage = tempfile::tempdir().unwrap();
        let id = "test-id";
        let mods_dir = storage.path().join("mods").join(id);
        fs::create_dir_all(&mods_dir).unwrap();
        fs::write(
            mods_dir.join("mod.config.json"),
            make_test_mod_config_json(),
        )
        .unwrap();

        let entry = make_slugged_entry(id, id, ModArchiveFormat::Fantome);

        let result = read_installed_mod(&entry, true, storage.path(), None).unwrap();
        assert_eq!(result.id, id);
        assert_eq!(result.name, "test-mod");
        assert_eq!(result.display_name, "Test Mod");
        assert_eq!(result.version, "1.0.0");
        assert_eq!(result.description.as_deref(), Some("A test mod"));
        assert_eq!(result.authors, vec!["Author"]);
        assert!(result.enabled);
        assert!(!result.layers.is_empty());
        assert_eq!(result.champions, vec!["Aatrox"]);
    }

    #[test]
    fn read_installed_mod_empty_description_becomes_none() {
        let storage = tempfile::tempdir().unwrap();
        let id = "test-id-2";
        let mods_dir = storage.path().join("mods").join(id);
        fs::create_dir_all(&mods_dir).unwrap();

        let config = serde_json::to_string_pretty(&ltk_mod_project::ModProject {
            name: "test-mod".to_string(),
            display_name: "Test Mod".to_string(),
            version: "1.0.0".to_string(),
            description: "".to_string(),
            authors: Vec::new(),
            license: None,
            tags: Vec::new(),
            champions: Vec::new(),
            maps: Vec::new(),
            transformers: Vec::new(),
            layers: ltk_mod_project::ModProjectLayer::default_table(),
            thumbnail: None,
            hashtables: Vec::new(),
        })
        .unwrap();
        fs::write(mods_dir.join("mod.config.json"), config).unwrap();

        let entry = make_slugged_entry(id, id, ModArchiveFormat::Fantome);

        let result = read_installed_mod(&entry, false, storage.path(), None).unwrap();
        assert!(result.description.is_none());
        assert!(!result.enabled);
    }

    #[test]
    fn read_installed_mod_missing_config_returns_error() {
        let storage = tempfile::tempdir().unwrap();
        let entry = make_slugged_entry("nonexistent", "nonexistent", ModArchiveFormat::Fantome);
        assert!(read_installed_mod(&entry, true, storage.path(), None).is_err());
    }

    #[test]
    fn extract_fantome_thumbnail_with_image() {
        let dir = tempfile::tempdir().unwrap();
        let archive_path = make_test_fantome_zip(dir.path(), true, false);
        let metadata_dir = dir.path().join("metadata");
        fs::create_dir_all(&metadata_dir).unwrap();

        let result = extract_fantome_thumbnail(&archive_path, &metadata_dir).unwrap();
        assert!(result.is_some());
        assert!(result.unwrap().exists());
    }

    #[test]
    fn extract_fantome_thumbnail_without_image() {
        let dir = tempfile::tempdir().unwrap();
        let archive_path = make_test_fantome_zip(dir.path(), false, false);
        let metadata_dir = dir.path().join("metadata");
        fs::create_dir_all(&metadata_dir).unwrap();

        let result = extract_fantome_thumbnail(&archive_path, &metadata_dir).unwrap();
        assert!(result.is_none());
    }
}
