use super::layer::LayersExt;
use super::{
    CreateProjectArgs, FantomePeekResult, ImportFantomeArgs, ImportGitRepoArgs,
    SaveProjectConfigArgs, Workshop, WorkshopProject, find_config_file, is_valid_project_name,
    load_workshop_project,
};
use crate::config::Config;
use crate::error::{AppError, AppResult, Utf8PathRefExt};
use crate::events::{
    BackendEvent, FantomeImportProgress, FantomeImportStage, GitImportProgress, GitImportStage,
};
use crate::hashtables::WadPathResolver;
use crate::utils::natural_order::compare_names;
use ltk_mod_project::{
    ModMap, ModProject, ModProjectAuthor, ModProjectLayer, ModTag, default_layers,
};
use ltk_modpkg::{Modpkg, ModpkgExtractor};
use std::collections::HashSet;
use std::fs;
use std::io::{Cursor, Read, Seek};
use std::path::PathBuf;
use zip::ZipArchive;

use camino::Utf8Path;
use ltk_wad::{PathResolver, WadExtractor};

impl Workshop {
    /// Get all workshop projects from the configured workshop directory.
    pub fn get_projects(&self, config: &Config) -> AppResult<Vec<WorkshopProject>> {
        let workshop_path = self.workshop_dir(config)?;

        if !workshop_path.exists() {
            return Ok(Vec::new());
        }

        let mut projects = Vec::new();

        for entry in fs::read_dir(&workshop_path)? {
            let entry = entry?;
            let path = entry.path();

            if !path.is_dir() {
                continue;
            }

            if find_config_file(&path).is_none() {
                continue;
            }

            match load_workshop_project(&path) {
                Ok(project) => projects.push(project),
                Err(e) => {
                    tracing::warn!("Skipping invalid project at {}: {}", path.display(), e);
                }
            }
        }

        // Sort by last modified (newest first)
        projects.sort_by_key(|p| std::cmp::Reverse(p.last_modified));

        Ok(projects)
    }

    /// Create a new workshop project.
    pub fn create_project(
        &self,
        config: &Config,
        args: CreateProjectArgs,
    ) -> AppResult<WorkshopProject> {
        let workshop_path = self.workshop_dir(config)?;

        if !is_valid_project_name(&args.name) {
            return Err(AppError::ValidationFailed(
                "Project name must be lowercase alphanumeric with hyphens only".to_string(),
            ));
        }

        let project_dir = workshop_path.join(&args.name);

        if project_dir.exists() {
            return Err(AppError::ProjectAlreadyExists(args.name));
        }

        // Create project structure
        fs::create_dir_all(&project_dir)?;
        fs::create_dir_all(project_dir.join("content").join("base"))?;

        let authors: Vec<ModProjectAuthor> = args
            .authors
            .into_iter()
            .map(ModProjectAuthor::Name)
            .collect();

        let mod_project = ModProject {
            name: args.name.clone(),
            display_name: args.display_name,
            version: "1.0.0".to_string(),
            description: args.description,
            authors,
            license: None,
            tags: Vec::new(),
            champions: Vec::new(),
            maps: Vec::new(),
            transformers: Vec::new(),
            layers: default_layers(),
            thumbnail: None,
        };

        let config_path = project_dir.join("mod.config.json");
        let config_content = serde_json::to_string_pretty(&mod_project)?;
        fs::write(&config_path, config_content)?;

        let readme_content = format!(
            "# {}\n\n{}\n",
            mod_project.display_name, mod_project.description
        );
        fs::write(project_dir.join("README.md"), readme_content)?;

        load_workshop_project(&project_dir)
    }

    /// Get a single workshop project by path.
    pub fn get_project(&self, project_path: &str) -> AppResult<WorkshopProject> {
        let path = PathBuf::from(project_path);
        if !path.exists() {
            return Err(AppError::ProjectNotFound(project_path.to_string()));
        }
        load_workshop_project(&path)
    }

    /// Save project configuration changes.
    pub fn save_config(&self, args: SaveProjectConfigArgs) -> AppResult<WorkshopProject> {
        let path = PathBuf::from(&args.project_path);
        if !path.exists() {
            return Err(AppError::ProjectNotFound(args.project_path));
        }

        let mut mod_project = ModProject::load(path.try_as_utf8("project directory")?)?;

        mod_project.display_name = args.display_name;
        mod_project.version = args.version;
        mod_project.description = args.description;
        mod_project.authors = args
            .authors
            .into_iter()
            .map(|a| match a.role {
                Some(role) => ModProjectAuthor::Role { name: a.name, role },
                None => ModProjectAuthor::Name(a.name),
            })
            .collect();
        mod_project.tags = args.tags.into_iter().map(ModTag::from).collect();
        mod_project.champions = args.champions;
        mod_project.maps = args.maps.into_iter().map(ModMap::from).collect();

        let json_config_path = path.join("mod.config.json");
        let config_content = serde_json::to_string_pretty(&mod_project)?;
        fs::write(&json_config_path, config_content)?;

        load_workshop_project(&path)
    }

    /// Rename a workshop project (change its slug/directory name).
    pub fn rename_project(&self, project_path: &str, new_name: &str) -> AppResult<WorkshopProject> {
        let new_name = new_name.trim().to_string();

        if !is_valid_project_name(&new_name) {
            return Err(AppError::ValidationFailed(
                "Project name must be lowercase alphanumeric with hyphens only".to_string(),
            ));
        }

        let old_path = PathBuf::from(project_path);
        if !old_path.exists() {
            return Err(AppError::ProjectNotFound(project_path.to_string()));
        }

        // Verify it's a valid project
        if find_config_file(&old_path).is_none() {
            return Err(AppError::ProjectNotFound(project_path.to_string()));
        }

        let parent_dir = old_path.parent().ok_or_else(|| {
            AppError::InvalidPath("Cannot determine parent directory".to_string())
        })?;
        let new_path = parent_dir.join(&new_name);

        // Check if old name is the same as new name
        if old_path == new_path {
            return load_workshop_project(&old_path);
        }

        if new_path.exists() {
            return Err(AppError::ProjectAlreadyExists(new_name));
        }

        // Rename the directory
        fs::rename(&old_path, &new_path)?;

        let mut mod_project = ModProject::load(new_path.try_as_utf8("project directory")?)?;
        mod_project.name = new_name;

        let json_config_path = new_path.join("mod.config.json");
        let config_content = serde_json::to_string_pretty(&mod_project)?;
        fs::write(&json_config_path, config_content)?;

        load_workshop_project(&new_path)
    }

    /// Delete a workshop project.
    pub fn delete_project(&self, project_path: &str) -> AppResult<()> {
        let path = PathBuf::from(project_path);
        if !path.exists() {
            return Err(AppError::ProjectNotFound(project_path.to_string()));
        }

        // Safety check: ensure it contains a mod.config file
        if find_config_file(&path).is_none() {
            return Err(AppError::ValidationFailed(
                "Directory does not appear to be a mod project".to_string(),
            ));
        }

        fs::remove_dir_all(&path)?;
        Ok(())
    }

    /// Peek into a .fantome archive and return metadata without extracting content.
    pub fn peek_fantome(&self, file_path: &str) -> AppResult<FantomePeekResult> {
        let file = fs::File::open(file_path)?;
        let mut archive = ZipArchive::new(file)?;

        let info = read_fantome_info(&mut archive)?;
        let wad_files = scan_fantome_wad_names(&mut archive)?;

        Ok(FantomePeekResult {
            suggested_name: slug::slugify(&info.name),
            name: info.name,
            author: info.author,
            version: info.version,
            description: info.description,
            wad_files,
        })
    }

    /// Import a .fantome archive as a new workshop project.
    pub fn import_from_fantome(
        &self,
        config: &Config,
        args: ImportFantomeArgs,
        resolver: &WadPathResolver,
    ) -> AppResult<WorkshopProject> {
        let workshop_path = self.workshop_dir(config)?;

        if !is_valid_project_name(&args.name) {
            return Err(AppError::ValidationFailed(
                "Project name must be lowercase alphanumeric with hyphens only".to_string(),
            ));
        }

        let project_dir = workshop_path.join(&args.name);
        if project_dir.exists() {
            return Err(AppError::ProjectAlreadyExists(args.name));
        }

        let file = fs::File::open(&args.file_path)?;
        let mut archive = ZipArchive::new(file)?;

        let info = read_fantome_info(&mut archive)?;
        let wad_names = scan_fantome_wad_names(&mut archive)?;
        let total_wads = wad_names.len() as u32;

        fs::create_dir_all(&project_dir)?;

        let result = (|| -> AppResult<WorkshopProject> {
            let base_dir = project_dir.join("content").join("base");
            fs::create_dir_all(&base_dir)?;

            for (idx, wad_name) in wad_names.iter().enumerate() {
                self.emit_fantome_progress(
                    FantomeImportStage::Extracting,
                    Some(wad_name),
                    idx as u32,
                    total_wads,
                );
                extract_fantome_wad(&mut archive, wad_name, &base_dir, resolver)?;
            }

            self.emit_fantome_progress(
                FantomeImportStage::Finalizing,
                None,
                total_wads,
                total_wads,
            );

            let readme_path = project_dir.join("README.md");
            extract_fantome_file(&mut archive, "meta/readme.md", &readme_path);
            if !readme_path.exists() {
                extract_fantome_file(&mut archive, "readme.md", &readme_path);
            }

            // Extract thumbnail
            extract_fantome_file(
                &mut archive,
                "meta/image.png",
                &project_dir.join("thumbnail.png"),
            );

            // Build layers from fantome info
            let layers = if info.layers.is_empty() {
                default_layers()
            } else {
                let mut layers: Vec<ModProjectLayer> = info
                    .layers
                    .into_values()
                    .map(|layer_info| ModProjectLayer {
                        name: layer_info.name,
                        display_name: layer_info.display_name,
                        priority: layer_info.priority,
                        description: None,
                        string_overrides: layer_info.string_overrides,
                    })
                    .collect();
                layers.ensure_base();
                layers.sort_for_display();
                layers
            };

            let mod_project = ModProject {
                name: args.name.clone(),
                display_name: args.display_name,
                version: info.version,
                description: info.description,
                authors: vec![ModProjectAuthor::Name(info.author)],
                license: None,
                tags: info.tags.into_iter().map(ModTag::from).collect(),
                champions: info.champions,
                maps: info.maps.into_iter().map(ModMap::from).collect(),
                transformers: Vec::new(),
                layers,
                thumbnail: None,
            };

            let config_path = project_dir.join("mod.config.json");
            fs::write(&config_path, serde_json::to_string_pretty(&mod_project)?)?;

            self.emit_fantome_progress(FantomeImportStage::Complete, None, total_wads, total_wads);

            load_workshop_project(&project_dir)
        })();

        if result.is_err() {
            self.emit_fantome_progress(FantomeImportStage::Error, None, 0, total_wads);
            let _ = fs::remove_dir_all(&project_dir);
        }

        result
    }

    fn emit_fantome_progress(
        &self,
        stage: FantomeImportStage,
        current_wad: Option<&str>,
        current: u32,
        total: u32,
    ) {
        self.events()
            .emit(BackendEvent::FantomeImportProgress(FantomeImportProgress {
                stage,
                current_wad: current_wad.map(String::from),
                current,
                total,
            }));
    }

    /// Import a .modpkg file as a new workshop project.
    pub fn import_from_modpkg(
        &self,
        config: &Config,
        file_path: &str,
    ) -> AppResult<WorkshopProject> {
        let workshop_path = self.workshop_dir(config)?;

        let file = fs::File::open(file_path)?;
        let mut modpkg = Modpkg::mount_from_reader(file)?;

        let metadata = modpkg.load_metadata()?;

        // Check if project already exists
        let project_dir = workshop_path.join(&metadata.name);
        if project_dir.exists() {
            return Err(AppError::ProjectAlreadyExists(metadata.name));
        }

        // Create project directory
        fs::create_dir_all(&project_dir)?;

        // Extract content
        let content_dir = project_dir.join("content");
        fs::create_dir_all(&content_dir)?;

        let mut extractor = ModpkgExtractor::new(&mut modpkg);
        extractor.extract_all(&content_dir)?;

        // Build layers from header, preserving string overrides from metadata
        let mut layers: Vec<ModProjectLayer> = modpkg
            .layers()
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
        layers.ensure_base();
        layers.sort_for_display();

        // Create mod project config
        let mod_project = ModProject {
            name: metadata.name,
            display_name: metadata.display_name,
            version: metadata.version.to_string(),
            description: metadata.description.unwrap_or_default(),
            authors: metadata
                .authors
                .into_iter()
                .map(|a| ModProjectAuthor::Name(a.name))
                .collect(),
            license: None,
            tags: metadata
                .tags
                .into_iter()
                .map(ltk_mod_project::ModTag::from)
                .collect(),
            champions: metadata.champions,
            maps: metadata
                .maps
                .into_iter()
                .map(ltk_mod_project::ModMap::from)
                .collect(),
            transformers: Vec::new(),
            layers,
            thumbnail: None,
        };

        let config_path = project_dir.join("mod.config.json");
        fs::write(&config_path, serde_json::to_string_pretty(&mod_project)?)?;

        // Extract README and thumbnail
        if let Ok(readme_bytes) = modpkg.load_readme() {
            let _ = fs::write(project_dir.join("README.md"), readme_bytes);
        }
        if let Ok(thumbnail_bytes) = modpkg.load_thumbnail() {
            let _ = fs::write(project_dir.join("thumbnail.webp"), thumbnail_bytes);
        }

        load_workshop_project(&project_dir)
    }

    /// Import a project from a GitHub repository by downloading and extracting its tarball.
    pub fn import_from_git_repo(
        &self,
        config: &Config,
        args: ImportGitRepoArgs,
    ) -> AppResult<WorkshopProject> {
        let workshop_path = self.workshop_dir(config)?;
        let (owner, repo) = parse_github_url(&args.url)?;
        let branch = args.branch.unwrap_or_else(|| "main".to_string());

        let tarball_url = format!(
            "https://github.com/{}/{}/archive/refs/heads/{}.tar.gz",
            owner, repo, branch
        );

        self.emit_git_progress(GitImportStage::Downloading, None);

        let response = reqwest::blocking::get(&tarball_url)
            .map_err(|e| AppError::Other(format!("Failed to download repository: {}", e)))?;

        if !response.status().is_success() {
            return Err(AppError::Other(format!(
                "Failed to download repository (HTTP {}). Check the URL and branch name.",
                response.status()
            )));
        }

        let bytes = response
            .bytes()
            .map_err(|e| AppError::Other(format!("Failed to read response: {}", e)))?;

        self.emit_git_progress(GitImportStage::Extracting, None);

        let temp_dir = workshop_path.join(format!(".git-import-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&temp_dir)?;

        let result = (|| -> AppResult<WorkshopProject> {
            let decoder = flate2::read::GzDecoder::new(std::io::Cursor::new(&bytes));
            let mut archive = tar::Archive::new(decoder);
            archive.unpack(&temp_dir)?;

            // GitHub tarballs extract to "{repo}-{branch}/" — find the single top-level directory
            let mut entries = fs::read_dir(&temp_dir)?;
            let extracted_dir = entries
                .next()
                .ok_or_else(|| AppError::Other("Archive is empty".to_string()))??
                .path();

            if !extracted_dir.is_dir() {
                return Err(AppError::Other(
                    "Archive does not contain a directory".to_string(),
                ));
            }

            let mod_project =
                ModProject::load(extracted_dir.try_as_utf8("extracted project directory")?)
                    .map_err(|e| match e {
                        ltk_mod_project::ModProjectError::ConfigNotFound(_) => {
                            AppError::ValidationFailed(
                                "Repository does not contain a mod.config.json or mod.config.toml"
                                    .to_string(),
                            )
                        }
                        other => AppError::from(other),
                    })?;

            let project_name = &mod_project.name;
            if !is_valid_project_name(project_name) {
                return Err(AppError::ValidationFailed(format!(
                    "Project name '{}' in config is invalid. Must be lowercase alphanumeric with hyphens only.",
                    project_name
                )));
            }

            let project_dir = workshop_path.join(project_name);
            if project_dir.exists() {
                return Err(AppError::ProjectAlreadyExists(project_name.clone()));
            }

            fs::rename(&extracted_dir, &project_dir)?;

            self.emit_git_progress(GitImportStage::Complete, None);
            load_workshop_project(&project_dir)
        })();

        if result.is_err() {
            self.emit_git_progress(GitImportStage::Error, None);
        }

        if temp_dir.exists() {
            let _ = fs::remove_dir_all(&temp_dir);
        }
        result
    }

    fn emit_git_progress(&self, stage: GitImportStage, message: Option<&str>) {
        self.events()
            .emit(BackendEvent::GitImportProgress(GitImportProgress {
                stage,
                message: message.map(String::from),
            }));
    }
}

/// Parse a GitHub URL and extract the owner and repo name.
fn parse_github_url(url: &str) -> AppResult<(String, String)> {
    let url = url.trim().trim_end_matches('/');
    let url = url.strip_suffix(".git").unwrap_or(url);

    let path = url
        .strip_prefix("https://github.com/")
        .or_else(|| url.strip_prefix("http://github.com/"))
        .ok_or_else(|| {
            AppError::ValidationFailed(
                "URL must be a GitHub repository (https://github.com/owner/repo)".to_string(),
            )
        })?;

    let parts: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    if parts.len() < 2 {
        return Err(AppError::ValidationFailed(
            "URL must include owner and repository name (https://github.com/owner/repo)"
                .to_string(),
        ));
    }
    if parts.len() > 2 {
        return Err(AppError::ValidationFailed(
            "URL must not contain extra path segments beyond owner and repository name (https://github.com/owner/repo)"
                .to_string(),
        ));
    }

    Ok((parts[0].to_string(), parts[1].to_string()))
}

// ============================================================================
// Fantome helpers
// ============================================================================

fn is_wad_file_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".wad.client") || lower.ends_with(".wad") || lower.ends_with(".wad.mobile")
}

/// Read and parse META/info.json from a fantome ZIP archive.
fn read_fantome_info<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
) -> AppResult<ltk_fantome::FantomeInfo> {
    let mut info_content = String::new();
    let mut found = false;

    for i in 0..archive.len() {
        let file = archive.by_index(i)?;
        let name = file.name().to_lowercase();
        if name == "meta/info.json" {
            drop(file);
            let mut info_file = archive.by_index(i)?;
            info_file.read_to_string(&mut info_content)?;
            found = true;
            break;
        }
    }

    if !found {
        return Err(AppError::Fantome(
            "Missing META/info.json in fantome archive".to_string(),
        ));
    }

    let info_content = info_content.trim_start_matches('\u{feff}').trim();
    crate::mods::parse_fantome_info(info_content)
        .map_err(|e| AppError::Fantome(format!("Failed to parse info.json: {}", e)))
}

/// Scan a fantome archive for WAD file names under WAD/.
fn scan_fantome_wad_names<R: Read + Seek>(archive: &mut ZipArchive<R>) -> AppResult<Vec<String>> {
    let mut dir_wads: HashSet<String> = HashSet::new();
    let mut file_wads: HashSet<String> = HashSet::new();

    for i in 0..archive.len() {
        let file = archive.by_index(i)?;
        let name = file.name().to_string();

        let Some(relative) = name.strip_prefix("WAD/") else {
            continue;
        };
        if relative.is_empty() {
            continue;
        }

        if !relative.contains('/') && !file.is_dir() && is_wad_file_name(relative) {
            file_wads.insert(relative.to_string());
        } else if let Some(wad_name) = relative.split('/').next()
            && is_wad_file_name(wad_name)
        {
            dir_wads.insert(wad_name.to_string());
        }
    }

    let mut wads: Vec<String> = dir_wads.into_iter().collect();
    for wad_name in file_wads {
        if !wads.contains(&wad_name) {
            wads.push(wad_name);
        }
    }
    wads.sort_by(|a, b| compare_names(a, b));

    Ok(wads)
}

/// Extract a single WAD (directory-style or packed) from a fantome archive into the target dir.
fn extract_fantome_wad<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    wad_name: &str,
    base_dir: &std::path::Path,
    resolver: &impl PathResolver,
) -> AppResult<()> {
    let dir_prefix = format!("WAD/{}/", wad_name);
    let packed_path = format!("WAD/{}", wad_name);
    let mut has_dir_entries = false;

    let wad_output_dir = base_dir.join(wad_name);

    // Try directory-style WAD first
    for i in 0..archive.len() {
        let file = archive.by_index(i)?;
        let name = file.name().to_string();

        if name.starts_with(&dir_prefix) && !file.is_dir() {
            let rel = name.strip_prefix(&dir_prefix).unwrap_or(&name);
            if rel.is_empty() {
                continue;
            }

            if rel.contains("..") || std::path::Path::new(rel).is_absolute() {
                return Err(AppError::Fantome(format!(
                    "Zip entry contains unsafe path: {}",
                    name
                )));
            }

            has_dir_entries = true;
            drop(file);

            let mut entry = archive.by_index(i)?;
            let target_path = wad_output_dir.join(rel);
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut out = fs::File::create(&target_path)?;
            std::io::copy(&mut entry, &mut out)?;
        }
    }

    if has_dir_entries {
        return Ok(());
    }

    // Try packed WAD — use WadExtractor for proper extraction
    for i in 0..archive.len() {
        let file = archive.by_index(i)?;
        let name = file.name().to_string();

        if name == packed_path && !file.is_dir() {
            drop(file);

            let mut entry = archive.by_index(i)?;
            let mut wad_data = Vec::new();
            entry.read_to_end(&mut wad_data)?;

            let cursor = Cursor::new(wad_data);
            let mut wad = ltk_wad::Wad::mount(cursor)?;

            let wad_dir = base_dir.join(wad_name);
            fs::create_dir_all(&wad_dir)?;

            let mut extractor = WadExtractor::new(resolver).with_name_recovery();
            let report = extractor.extract_all(
                &mut wad,
                Utf8Path::from_path(&wad_dir).ok_or_else(|| {
                    AppError::Fantome("WAD output path is not valid UTF-8".to_string())
                })?,
            )?;

            tracing::debug!(
                wad = wad_name,
                extracted = report.extracted,
                recovered = report.recovered.names.len(),
                bins_scanned = report.recovered.bins_scanned,
                "Extracted packed WAD from fantome archive"
            );

            return Ok(());
        }
    }

    Err(AppError::Fantome(format!(
        "Failed to locate or extract WAD '{}' from Fantome archive",
        wad_name
    )))
}

/// Try to extract a file from the archive by case-insensitive name match.
fn extract_fantome_file<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    name_lower: &str,
    target: &std::path::Path,
) {
    for i in 0..archive.len() {
        let Ok(file) = archive.by_index(i) else {
            continue;
        };
        if file.name().to_lowercase() == name_lower && !file.is_dir() {
            drop(file);
            if let Ok(mut entry) = archive.by_index(i) {
                let mut bytes = Vec::new();
                if entry.read_to_end(&mut bytes).is_ok() {
                    let _ = fs::write(target, bytes);
                    return;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use assert_matches::assert_matches;

    // ── parse_github_url ──

    #[test]
    fn parse_github_url_valid_https() {
        let (owner, repo) = parse_github_url("https://github.com/owner/repo").unwrap();
        assert_eq!(owner, "owner");
        assert_eq!(repo, "repo");
    }

    #[test]
    fn parse_github_url_trailing_slash() {
        let (owner, repo) = parse_github_url("https://github.com/owner/repo/").unwrap();
        assert_eq!(owner, "owner");
        assert_eq!(repo, "repo");
    }

    #[test]
    fn parse_github_url_with_git_suffix() {
        let (owner, repo) = parse_github_url("https://github.com/owner/repo.git").unwrap();
        assert_eq!(owner, "owner");
        assert_eq!(repo, "repo");
    }

    #[test]
    fn parse_github_url_with_whitespace() {
        let (owner, repo) = parse_github_url("  https://github.com/owner/repo  ").unwrap();
        assert_eq!(owner, "owner");
        assert_eq!(repo, "repo");
    }

    #[test]
    fn parse_github_url_http_also_works() {
        let (owner, repo) = parse_github_url("http://github.com/owner/repo").unwrap();
        assert_eq!(owner, "owner");
        assert_eq!(repo, "repo");
    }

    #[test]
    fn parse_github_url_non_github_host_rejected() {
        let result = parse_github_url("https://gitlab.com/owner/repo");
        assert_matches!(result, Err(AppError::ValidationFailed(_)));
    }

    #[test]
    fn parse_github_url_missing_repo() {
        let result = parse_github_url("https://github.com/owner");
        assert_matches!(result, Err(AppError::ValidationFailed(_)));
    }

    #[test]
    fn parse_github_url_empty_string() {
        let result = parse_github_url("");
        assert_matches!(result, Err(AppError::ValidationFailed(_)));
    }

    #[test]
    fn parse_github_url_extra_path_segments_rejected() {
        let result = parse_github_url("https://github.com/owner/repo/tree/main");
        assert_matches!(result, Err(AppError::ValidationFailed(_)));
    }

    #[test]
    fn parse_github_url_trailing_slash_and_git() {
        let (owner, repo) = parse_github_url("https://github.com/owner/repo.git/").unwrap();
        assert_eq!(owner, "owner");
        assert_eq!(repo, "repo");
    }

    // ── is_wad_file_name ──

    #[test]
    fn is_wad_file_name_client() {
        assert!(is_wad_file_name("Aatrox.wad.client"));
    }

    #[test]
    fn is_wad_file_name_plain() {
        assert!(is_wad_file_name("Map1.wad"));
    }

    #[test]
    fn is_wad_file_name_mobile() {
        assert!(is_wad_file_name("Aatrox.wad.mobile"));
    }

    #[test]
    fn is_wad_file_name_case_insensitive() {
        assert!(is_wad_file_name("AATROX.WAD.CLIENT"));
        assert!(is_wad_file_name("Map1.WAD"));
    }

    #[test]
    fn is_wad_file_name_not_wad() {
        assert!(!is_wad_file_name("readme.txt"));
        assert!(!is_wad_file_name("mod.config.json"));
        assert!(!is_wad_file_name("thumbnail.png"));
    }

    #[test]
    fn is_wad_file_name_empty() {
        assert!(!is_wad_file_name(""));
    }
}
