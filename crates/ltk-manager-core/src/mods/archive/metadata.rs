//! Reading a mod's metadata out of its archive and back off disk.
//!
//! Every installed mod has a `mod.config.json` in its directory, whatever format
//! it arrived in. A fantome gets one from its importer and a modpkg gets one
//! written here, both in the same [`ModProject`] shape. Code downstream does
//! not depend on the archive format, and the library view lists mods without
//! mounting an archive.

use crate::error::{AppError, AppResult, IoContext};
use crate::mods::archive::reader::{ModArchive, open_fantome};
use crate::mods::index::{LibraryModEntry, ModArchiveFormat};
use crate::mods::types::{InstalledMod, ModLayer, ModLicense};
use fs_err as fs;
use ltk_mod_project::{ModProject, ModProjectLayer};
use std::collections::HashMap;
use std::path::Path;

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

/// The layer table of a fantome archive: the layers `META/info.json` declares,
/// plus one for each undeclared `WAD_<layer>/` directory. `None` when the
/// archive has no layers.
///
/// Only the layout migration reads this. Every other path gets the table from
/// the importer. A config written by an older version of the app may lack the
/// table, and repairing it means reading the archive again. `None` means the
/// config is left unchanged.
///
/// Derived through the same conversion the importer uses, so the migration and
/// the importer agree on layer order. Both order through
/// [`ModProjectLayer::normalize_table`].
///
/// # Errors
///
/// Fails when the archive cannot be opened or its `META/info.json` cannot be
/// read.
pub(crate) fn fantome_layers(archive: &Path) -> AppResult<Option<Vec<ModProjectLayer>>> {
    let layers = ModArchive::Fantome(open_fantome(archive)?)
        .project()?
        .layers;
    Ok((!layers.is_empty()).then_some(layers))
}

pub(crate) fn load_mod_project(mod_dir: &Path) -> AppResult<ModProject> {
    let config_path = mod_dir.join("mod.config.json");
    let contents = fs::read_to_string(&config_path)
        .context(format!("Failed to read {}", config_path.display()))?;
    serde_json::from_str(&contents).map_err(AppError::from)
}

/// Write an archive's own metadata out as a mod project config, with its thumbnail and a
/// modpkg's readme.
///
/// Reads the metadata and no WAD content, so it costs a few small reads where an import costs
/// an unpack. A mod kept in its archive reads its card and slug from this config.
///
/// # Errors
///
/// Fails when the archive cannot be opened, its metadata cannot be read, or the config
/// cannot be written.
pub(crate) fn extract_metadata(
    archive: &Path,
    format: ModArchiveFormat,
    metadata_dir: &Path,
) -> AppResult<()> {
    let mut opened = ModArchive::open(archive, format)?;
    let project = opened.project()?;

    fs::create_dir_all(metadata_dir)?;
    fs::write(
        metadata_dir.join("mod.config.json"),
        serde_json::to_string_pretty(&project)?,
    )?;
    if let ModArchive::Modpkg(modpkg) = &mut opened
        && let Ok(readme) = modpkg.load_readme()
    {
        let _ = fs::write(metadata_dir.join("README.md"), readme);
    }
    let _ = opened.write_thumbnail(metadata_dir);

    tracing::info!(
        "Extracted {} metadata to {}",
        format.extension(),
        metadata_dir.display()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mods::StorageLayout as _;
    use crate::mods::test_support::make_slugged_entry;
    use std::io::Write;
    use std::path::PathBuf;

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
        let mods_dir = storage.path().mods_dir().join(id);
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
        let mods_dir = storage.path().mods_dir().join(id);
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

        let result = ModArchive::open(&archive_path, ModArchiveFormat::Fantome)
            .unwrap()
            .write_thumbnail(&metadata_dir)
            .unwrap();
        assert!(result.is_some());
        assert!(result.unwrap().exists());
    }

    #[test]
    fn extract_fantome_thumbnail_without_image() {
        let dir = tempfile::tempdir().unwrap();
        let archive_path = make_test_fantome_zip(dir.path(), false, false);
        let metadata_dir = dir.path().join("metadata");
        fs::create_dir_all(&metadata_dir).unwrap();

        let result = ModArchive::open(&archive_path, ModArchiveFormat::Fantome)
            .unwrap()
            .write_thumbnail(&metadata_dir)
            .unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn extracted_metadata_gives_an_undeclared_layer_directory_a_layer() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = tmp.path().join("layers.fantome");
        let bin = crate::mods::test_support::stale_bin();
        crate::mods::test_support::make_layer_wads_fantome_zip(&archive, &bin, &bin);

        extract_metadata(
            &archive,
            ModArchiveFormat::Fantome,
            &tmp.path().join("meta"),
        )
        .unwrap();

        let project = load_mod_project(&tmp.path().join("meta")).unwrap();
        let mut names: Vec<&str> = project.layers.iter().map(|l| l.name.as_str()).collect();
        names.sort_unstable();
        assert_eq!(names, ["Chroma", "base", "zeta"]);
    }
}
