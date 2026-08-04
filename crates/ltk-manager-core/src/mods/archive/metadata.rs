//! Reading a mod's metadata out of its archive and back off disk.
//!
//! An installed mod is stored twice: the archive itself, and an extracted
//! `mod.config.json` beside it. Extraction happens once at install time so the
//! library view never has to mount every archive just to render a list. Both
//! fantome and modpkg archives are normalized into the same [`ModProject`]
//! shape here, which is why nothing downstream needs to know which format a
//! mod came in as.

use crate::error::{AppError, AppResult};
use crate::mods::index::LibraryModEntry;
use crate::mods::types::{InstalledMod, ModLayer};
use ltk_mod_project::{ModMap, ModProject, ModProjectLayer, ModTag};
use ltk_modpkg::Modpkg;
use regex::Regex;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

pub(crate) fn read_installed_mod(
    entry: &LibraryModEntry,
    enabled: bool,
    storage_dir: &Path,
    layer_states: Option<&HashMap<String, bool>>,
) -> AppResult<InstalledMod> {
    let mod_dir = entry.metadata_dir(storage_dir);
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
        folder_id: None,
    })
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

pub(crate) fn parse_fantome_info(
    content: &str,
) -> Result<ltk_fantome::FantomeInfo, serde_json::Error> {
    static UNQUOTED_VERSION: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r#"("Version"\s*:\s*)([0-9]+(?:\.[0-9A-Za-z+-]+)+)"?(\s*[,}])"#)
            .expect("unquoted Fantome version regex must be valid")
    });

    let normalized = UNQUOTED_VERSION.replace(content, r#"${1}"${2}"${3}"#);
    let content = normalized.as_ref();

    match serde_json::from_str(content) {
        Ok(info) => Ok(info),
        Err(original_error) => {
            let Ok(mut value) = serde_json::from_str::<serde_json::Value>(content) else {
                return Err(original_error);
            };
            let Some(version) = value.get_mut("Version") else {
                return Err(original_error);
            };
            let serde_json::Value::Number(version_number) = version else {
                return Err(original_error);
            };

            *version = serde_json::Value::String(version_number.to_string());
            serde_json::from_value(value)
        }
    }
}

pub(crate) fn extract_fantome_metadata(file_path: &Path, metadata_dir: &Path) -> AppResult<()> {
    use std::io::Read;
    use zip::ZipArchive;

    let file = std::fs::File::open(file_path)?;
    let mut archive = ZipArchive::new(file)
        .map_err(|e| AppError::Other(format!("Failed to open fantome archive: {}", e)))?;

    // Read metadata from info.json
    let mut info_content = String::new();
    let mut found_metadata = false;

    for i in 0..archive.len() {
        let file = archive
            .by_index(i)
            .map_err(|e| AppError::Other(format!("Failed to read archive entry: {}", e)))?;
        let name = file.name().to_lowercase();

        if name == "meta/info.json" {
            drop(file);
            let mut info_file = archive
                .by_index(i)
                .map_err(|e| AppError::Other(format!("Failed to read info.json: {}", e)))?;
            info_file
                .read_to_string(&mut info_content)
                .map_err(|e| AppError::Other(format!("Failed to read info.json content: {}", e)))?;
            found_metadata = true;
            break;
        }
    }

    if !found_metadata {
        return Err(AppError::Other(
            "Missing META/info.json in fantome archive".to_string(),
        ));
    }

    // Parse metadata
    let info_content = info_content.trim_start_matches('\u{feff}').trim();
    let info = parse_fantome_info(info_content)
        .map_err(|e| AppError::Other(format!("Failed to parse info.json: {}", e)))?;

    // Build layers from Fantome info, preserving string overrides
    let layers = if info.layers.is_empty() {
        ltk_mod_project::default_layers()
    } else {
        let mut layers: Vec<ltk_mod_project::ModProjectLayer> = info
            .layers
            .into_values()
            .map(|layer_info| ltk_mod_project::ModProjectLayer {
                name: layer_info.name,
                display_name: layer_info.display_name,
                priority: layer_info.priority,
                description: None,
                string_overrides: layer_info.string_overrides,
            })
            .collect();
        // Ensure base layer exists
        if !layers.iter().any(|l| l.name == "base") {
            layers.insert(0, ltk_mod_project::ModProjectLayer::base());
        }
        layers.sort_by(|a, b| {
            a.priority
                .cmp(&b.priority)
                .then_with(|| a.name.cmp(&b.name))
        });
        layers
    };

    // Create mod.config.json from metadata
    let project = ModProject {
        name: slug::slugify(&info.name),
        display_name: info.name,
        version: info.version,
        description: info.description,
        authors: vec![ltk_mod_project::ModProjectAuthor::Name(info.author)],
        license: None,
        tags: info.tags.into_iter().map(ModTag::from).collect(),
        champions: info.champions,
        maps: info.maps.into_iter().map(ModMap::from).collect(),
        transformers: Vec::new(),
        layers,
        thumbnail: None,
    };

    let config_path = metadata_dir.join("mod.config.json");
    fs::write(config_path, serde_json::to_string_pretty(&project)?)?;

    // Extract README and thumbnail if present
    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| AppError::Other(format!("Failed to read archive entry: {}", e)))?;
        let name = file.name().to_string();
        let name_lower = name.to_lowercase();

        if name.eq_ignore_ascii_case("META/readme.md") || name.eq_ignore_ascii_case("readme.md") {
            let mut contents = String::new();
            file.read_to_string(&mut contents)?;
            fs::write(metadata_dir.join("README.md"), contents)?;
        } else if name_lower == "meta/image.png" {
            let mut buffer = Vec::new();
            file.read_to_end(&mut buffer)?;
            let _ = fs::write(metadata_dir.join("thumbnail.png"), &buffer);
        }
    }

    tracing::info!("Extracted fantome metadata to {}", metadata_dir.display());
    Ok(())
}

pub(crate) fn extract_modpkg_metadata(file_path: &Path, metadata_dir: &Path) -> AppResult<()> {
    let file = std::fs::File::open(file_path)?;
    let mut modpkg = Modpkg::mount_from_reader(file)?;

    // Build a mod project config from metadata/header layers (no content extraction).
    let metadata = modpkg.load_metadata()?;

    // Use header layers as source of truth, preserving string overrides from metadata.
    let mut layers: Vec<ModProjectLayer> = modpkg
        .layers
        .values()
        .map(|l| {
            let meta_layer = metadata.layers.iter().find(|ml| ml.name == l.name);
            ModProjectLayer {
                name: l.name.clone(),
                display_name: meta_layer.and_then(|ml| ml.display_name.clone()),
                priority: l.priority,
                description: meta_layer.and_then(|ml| ml.description.clone()),
                string_overrides: meta_layer
                    .map(|ml| ml.string_overrides.clone())
                    .unwrap_or_default(),
            }
        })
        .collect();
    layers.sort_by(|a, b| a.priority.cmp(&b.priority).then(a.name.cmp(&b.name)));

    // Ensure base exists.
    if !layers.iter().any(|l| l.name == "base") {
        layers.insert(0, ModProjectLayer::base());
    }

    let project = ModProject {
        name: metadata.name,
        display_name: metadata.display_name,
        version: metadata.version.to_string(),
        description: metadata.description.unwrap_or_default(),
        authors: metadata
            .authors
            .into_iter()
            .map(|a| ltk_mod_project::ModProjectAuthor::Name(a.name))
            .collect(),
        license: None,
        tags: metadata.tags.into_iter().map(ModTag::from).collect(),
        champions: metadata.champions,
        maps: metadata.maps.into_iter().map(ModMap::from).collect(),
        transformers: Vec::new(),
        layers,
        thumbnail: None,
    };

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
pub(crate) fn extract_fantome_thumbnail(
    archive_path: &Path,
    metadata_dir: &Path,
) -> AppResult<Option<PathBuf>> {
    use std::io::Read;
    use zip::ZipArchive;

    let file = std::fs::File::open(archive_path)?;
    let mut archive = ZipArchive::new(file)
        .map_err(|e| AppError::Other(format!("Failed to open fantome archive: {}", e)))?;

    for i in 0..archive.len() {
        let name = archive
            .by_index(i)
            .map_err(|e| AppError::Other(format!("Failed to read archive entry: {}", e)))?
            .name()
            .to_lowercase();

        if name == "meta/image.png" {
            let mut file = archive
                .by_index(i)
                .map_err(|e| AppError::Other(format!("Failed to read thumbnail: {}", e)))?;
            let mut buffer = Vec::new();
            file.read_to_end(&mut buffer)?;

            let dest = metadata_dir.join("thumbnail.png");
            fs::write(&dest, &buffer)?;
            return Ok(Some(dest));
        }
    }

    Ok(None)
}

/// Extract thumbnail from a modpkg archive and save to the metadata directory.
/// Returns the path to the saved file, or `None` if the archive has no thumbnail.
pub(crate) fn extract_modpkg_thumbnail(
    archive_path: &Path,
    metadata_dir: &Path,
) -> AppResult<Option<PathBuf>> {
    let file = std::fs::File::open(archive_path)?;
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
    use chrono::Utc;
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
            layers: ltk_mod_project::default_layers(),
            thumbnail: None,
        })
        .unwrap()
    }

    fn make_test_fantome_zip(dir: &Path, include_thumbnail: bool, include_readme: bool) -> PathBuf {
        let info = ltk_fantome::FantomeInfo {
            name: "Test Mod".to_string(),
            author: "Author".to_string(),
            version: "1.0.0".to_string(),
            description: "Description".to_string(),
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
    fn parse_fantome_info_accepts_unquoted_decimal_version() {
        let content = r#"{
            "Name": "Sausage dog Naafiri",
            "Author": "Author",
            "Version": 1.1,
            "Description": "Description",
            "Tags": [],
            "Champions": [],
            "Maps": [],
            "Layers": {}
        }"#;

        let info = parse_fantome_info(content).unwrap();
        assert_eq!(info.version, "1.1");
    }

    #[test]
    fn parse_fantome_info_accepts_integer_version() {
        let content = r#"{
            "Name": "Test Mod",
            "Author": "Author",
            "Version": 2,
            "Description": "Description",
            "Tags": [],
            "Champions": [],
            "Maps": [],
            "Layers": {}
        }"#;

        let info = parse_fantome_info(content).unwrap();
        assert_eq!(info.version, "2");
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

        let entry = LibraryModEntry {
            id: id.to_string(),
            installed_at: Utc::now(),
            format: ModArchiveFormat::Fantome,
        };

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
            layers: ltk_mod_project::default_layers(),
            thumbnail: None,
        })
        .unwrap();
        fs::write(mods_dir.join("mod.config.json"), config).unwrap();

        let entry = LibraryModEntry {
            id: id.to_string(),
            installed_at: Utc::now(),
            format: ModArchiveFormat::Fantome,
        };

        let result = read_installed_mod(&entry, false, storage.path(), None).unwrap();
        assert!(result.description.is_none());
        assert!(!result.enabled);
    }

    #[test]
    fn read_installed_mod_missing_config_returns_error() {
        let storage = tempfile::tempdir().unwrap();
        let entry = LibraryModEntry {
            id: "nonexistent".to_string(),
            installed_at: Utc::now(),
            format: ModArchiveFormat::Fantome,
        };
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

    #[test]
    fn extract_fantome_metadata_valid() {
        let dir = tempfile::tempdir().unwrap();
        let archive_path = make_test_fantome_zip(dir.path(), false, false);
        let metadata_dir = dir.path().join("metadata");
        fs::create_dir_all(&metadata_dir).unwrap();

        extract_fantome_metadata(&archive_path, &metadata_dir).unwrap();

        let config_path = metadata_dir.join("mod.config.json");
        assert!(config_path.exists());
        let project = load_mod_project(&metadata_dir).unwrap();
        assert_eq!(project.display_name, "Test Mod");
    }

    #[test]
    fn extract_fantome_metadata_missing_info_json() {
        let dir = tempfile::tempdir().unwrap();

        let zip_path = dir.path().join("empty.fantome");
        let file = std::fs::File::create(&zip_path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        zip.start_file("WAD/test.wad.client/file.bin", options)
            .unwrap();
        zip.write_all(b"data").unwrap();
        zip.finish().unwrap();

        let metadata_dir = dir.path().join("metadata");
        fs::create_dir_all(&metadata_dir).unwrap();

        assert!(extract_fantome_metadata(&zip_path, &metadata_dir).is_err());
    }

    #[test]
    fn extract_fantome_metadata_with_bom() {
        let dir = tempfile::tempdir().unwrap();

        let info_json = format!(
            "\u{feff}{}",
            serde_json::to_string(&ltk_fantome::FantomeInfo {
                name: "BOM Mod".to_string(),
                author: "Author".to_string(),
                version: "2.0.0".to_string(),
                description: "Has BOM".to_string(),
                tags: Vec::new(),
                champions: Vec::new(),
                maps: Vec::new(),
                layers: HashMap::new(),
            })
            .unwrap()
        );

        let zip_path = dir.path().join("bom.fantome");
        let file = std::fs::File::create(&zip_path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        zip.start_file("META/info.json", options).unwrap();
        zip.write_all(info_json.as_bytes()).unwrap();
        zip.finish().unwrap();

        let metadata_dir = dir.path().join("metadata");
        fs::create_dir_all(&metadata_dir).unwrap();

        extract_fantome_metadata(&zip_path, &metadata_dir).unwrap();
        let project = load_mod_project(&metadata_dir).unwrap();
        assert_eq!(project.display_name, "BOM Mod");
    }

    #[test]
    fn extract_fantome_metadata_extracts_readme() {
        let dir = tempfile::tempdir().unwrap();
        let archive_path = make_test_fantome_zip(dir.path(), false, true);
        let metadata_dir = dir.path().join("metadata");
        fs::create_dir_all(&metadata_dir).unwrap();

        extract_fantome_metadata(&archive_path, &metadata_dir).unwrap();
        let readme = metadata_dir.join("README.md");
        assert!(readme.exists());
        let contents = fs::read_to_string(readme).unwrap();
        assert!(contents.contains("Test Mod"));
    }
}
