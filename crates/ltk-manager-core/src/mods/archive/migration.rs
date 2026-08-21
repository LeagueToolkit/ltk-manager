use crate::config::Config;
use crate::error::{AppError, AppResult};
use crate::events::{BackendEvent, MigrationPhase, MigrationProgress};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::path::Path;

use crate::mods::ModLibrary;
use crate::mods::types::BulkInstallResult;

/// Metadata for a discovered cslol-manager mod, shown in the UI selection step.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct CslolModInfo {
    pub folder_name: String,
    pub name: String,
    pub author: String,
    pub version: String,
    pub description: String,
}

/// Scan a cslol-manager directory for installed mods.
///
/// Expects `dir` to contain an `installed/` subdirectory where each child folder
/// has the standard fantome layout (`META/info.json`, `WAD/`, etc.).
pub fn scan_cslol_directory(dir: &Path) -> AppResult<Vec<CslolModInfo>> {
    let installed_dir = dir.join("installed");
    if !installed_dir.is_dir() {
        return Err(AppError::InvalidPath(format!(
            "No 'installed' directory found in {}",
            dir.display()
        )));
    }

    let mut mods = Vec::new();

    for entry in fs::read_dir(&installed_dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let folder_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };

        let info_path = path.join("META").join("info.json");
        if !info_path.exists() {
            tracing::warn!(
                "Skipping cslol mod '{}': missing META/info.json",
                folder_name
            );
            continue;
        }

        match read_cslol_info(&info_path) {
            Ok(info) => {
                mods.push(CslolModInfo {
                    folder_name,
                    name: info.name,
                    author: info.author,
                    version: info.version,
                    description: info.description,
                });
            }
            Err(e) => {
                tracing::warn!("Skipping cslol mod '{}': {}", folder_name, e);
            }
        }
    }

    mods.sort_by_key(|m| m.name.to_lowercase());
    Ok(mods)
}

/// Import selected cslol-manager mods by creating temporary `.fantome` ZIPs
/// and piping them through the existing install pipeline.
///
/// Emits `"migration-progress"` events during both the packaging and installing phases.
pub fn import_cslol_mods(
    library: &ModLibrary,
    config: &Config,
    cslol_dir: &Path,
    folders: &[String],
) -> AppResult<BulkInstallResult> {
    let installed_dir = cslol_dir.join("installed");
    let temp_dir = std::env::temp_dir().join("ltk-migration");
    fs::create_dir_all(&temp_dir)?;

    let total = folders.len();
    let mut temp_paths: Vec<String> = Vec::new();

    for (i, folder) in folders.iter().enumerate() {
        library
            .events()
            .emit(BackendEvent::MigrationProgress(MigrationProgress {
                phase: MigrationPhase::Packaging,
                current: i + 1,
                total,
                current_file: folder.clone(),
            }));

        let mod_dir = installed_dir.join(folder);
        if !mod_dir.is_dir() {
            tracing::warn!("Skipping missing folder: {}", folder);
            continue;
        }

        let output_path = temp_dir.join(format!("{}.fantome", folder));
        match create_fantome_zip(&mod_dir, &output_path) {
            Ok(()) => {
                temp_paths.push(output_path.display().to_string());
            }
            Err(e) => {
                tracing::warn!("Failed to create fantome zip for '{}': {}", folder, e);
            }
        }
    }

    let result = library.install_mods_from_packages(config, &temp_paths);

    for path in &temp_paths {
        let _ = fs::remove_file(path);
    }
    let _ = fs::remove_dir(&temp_dir);

    result
}

/// Create a `.fantome` ZIP archive from a cslol mod directory.
fn create_fantome_zip(mod_dir: &Path, output_path: &Path) -> AppResult<()> {
    let file = fs::File::create(output_path)?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    add_dir_to_zip(&mut zip, mod_dir, mod_dir, options)?;
    zip.finish().map_err(AppError::ZipError)?;

    Ok(())
}

/// Recursively add directory contents to a ZIP archive.
fn add_dir_to_zip<W: Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    base_dir: &Path,
    current_dir: &Path,
    options: zip::write::SimpleFileOptions,
) -> AppResult<()> {
    for entry in fs::read_dir(current_dir)? {
        let entry = entry?;
        let path = entry.path();

        let relative = path
            .strip_prefix(base_dir)
            .map_err(|e| AppError::Other(e.to_string()))?;
        let name = relative.to_string_lossy().replace('\\', "/");

        if path.is_dir() {
            zip.add_directory(format!("{}/", name), options)
                .map_err(AppError::ZipError)?;
            add_dir_to_zip(zip, base_dir, &path, options)?;
        } else {
            zip.start_file(&name, options).map_err(AppError::ZipError)?;
            let mut f = fs::File::open(&path)?;
            let mut buffer = Vec::new();
            f.read_to_end(&mut buffer)?;
            zip.write_all(&buffer)?;
        }
    }

    Ok(())
}

/// Read and parse a cslol-manager `META/info.json` file.
fn read_cslol_info(path: &Path) -> AppResult<ltk_fantome::FantomeInfo> {
    let content = fs::read_to_string(path)?;
    let content = content.trim_start_matches('\u{feff}').trim();

    serde_json::from_str(content).map_err(AppError::Serialization)
}

#[cfg(test)]
mod tests {
    use super::*;
    use assert_matches::assert_matches;
    use std::collections::HashMap;

    fn make_info_json_str(name: &str, author: &str) -> String {
        serde_json::to_string(&ltk_fantome::FantomeInfo {
            name: name.to_string(),
            author: author.to_string(),
            version: "1.0.0".to_string(),
            description: "Desc".to_string(),
            license: None,
            tags: Vec::new(),
            champions: Vec::new(),
            maps: Vec::new(),
            layers: HashMap::new(),
        })
        .unwrap()
    }

    #[test]
    fn read_cslol_info_valid_json() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("info.json");
        fs::write(&path, make_info_json_str("Test", "Author")).unwrap();
        let info = read_cslol_info(&path).unwrap();
        assert_eq!(info.name, "Test");
        assert_eq!(info.author, "Author");
    }

    #[test]
    fn read_cslol_info_bom_prefixed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("info.json");
        let content = format!("\u{feff}{}", make_info_json_str("BOM Test", "Author"));
        fs::write(&path, content).unwrap();
        let info = read_cslol_info(&path).unwrap();
        assert_eq!(info.name, "BOM Test");
    }

    #[test]
    fn read_cslol_info_invalid_json() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("info.json");
        fs::write(&path, "not json").unwrap();
        assert_matches!(read_cslol_info(&path), Err(AppError::Serialization(_)));
    }

    #[test]
    fn read_cslol_info_missing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nonexistent.json");
        assert_matches!(read_cslol_info(&path), Err(AppError::Io(_)));
    }

    #[test]
    fn scan_cslol_directory_missing_installed_dir() {
        let dir = tempfile::tempdir().unwrap();
        assert_matches!(
            scan_cslol_directory(dir.path()),
            Err(AppError::InvalidPath(_))
        );
    }

    #[test]
    fn scan_cslol_directory_empty_installed() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("installed")).unwrap();
        let mods = scan_cslol_directory(dir.path()).unwrap();
        assert!(mods.is_empty());
    }

    #[test]
    fn scan_cslol_directory_valid_mods_sorted() {
        let dir = tempfile::tempdir().unwrap();
        let installed = dir.path().join("installed");

        for (folder, name) in [("mod-b", "Zeta Mod"), ("mod-a", "Alpha Mod")] {
            let meta_dir = installed.join(folder).join("META");
            fs::create_dir_all(&meta_dir).unwrap();
            fs::write(
                meta_dir.join("info.json"),
                make_info_json_str(name, "Author"),
            )
            .unwrap();
        }

        let mods = scan_cslol_directory(dir.path()).unwrap();
        assert_eq!(mods.len(), 2);
        assert_eq!(mods[0].name, "Alpha Mod");
        assert_eq!(mods[1].name, "Zeta Mod");
    }

    #[test]
    fn scan_cslol_directory_skips_without_info_json() {
        let dir = tempfile::tempdir().unwrap();
        let installed = dir.path().join("installed");

        let good = installed.join("good-mod").join("META");
        fs::create_dir_all(&good).unwrap();
        fs::write(good.join("info.json"), make_info_json_str("Good", "Author")).unwrap();

        let bad = installed.join("bad-mod");
        fs::create_dir_all(&bad).unwrap();

        let mods = scan_cslol_directory(dir.path()).unwrap();
        assert_eq!(mods.len(), 1);
        assert_eq!(mods[0].name, "Good");
    }

    #[test]
    fn create_fantome_zip_creates_valid_archive() {
        let dir = tempfile::tempdir().unwrap();

        let mod_dir = dir.path().join("mod-source");
        let meta_dir = mod_dir.join("META");
        let wad_dir = mod_dir.join("WAD").join("test.wad.client");
        fs::create_dir_all(&meta_dir).unwrap();
        fs::create_dir_all(&wad_dir).unwrap();
        fs::write(
            meta_dir.join("info.json"),
            make_info_json_str("Test", "Author"),
        )
        .unwrap();
        fs::write(wad_dir.join("file.bin"), b"test data").unwrap();

        let output = dir.path().join("output.fantome");
        create_fantome_zip(&mod_dir, &output).unwrap();

        assert!(output.exists());
        let file = fs::File::open(&output).unwrap();
        let archive = zip::ZipArchive::new(file).unwrap();
        assert!(!archive.is_empty());
    }

    #[test]
    fn add_dir_to_zip_uses_forward_slashes() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source");
        let sub = source.join("sub").join("nested");
        fs::create_dir_all(&sub).unwrap();
        fs::write(sub.join("file.txt"), b"content").unwrap();

        let output = dir.path().join("test.zip");
        let file = fs::File::create(&output).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();

        add_dir_to_zip(&mut zip, &source, &source, options).unwrap();
        zip.finish().unwrap();

        let file = fs::File::open(&output).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        for i in 0..archive.len() {
            let entry = archive.by_index(i).unwrap();
            assert!(
                !entry.name().contains('\\'),
                "Entry name '{}' contains backslash",
                entry.name()
            );
        }
    }
}
