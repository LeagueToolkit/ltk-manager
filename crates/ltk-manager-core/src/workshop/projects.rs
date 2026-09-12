use super::{
    CreateProjectArgs, FantomePeekResult, ImportFantomeArgs, ImportGitRepoArgs, ProjectDir,
    SaveProjectConfigArgs, Workshop, WorkshopProject, is_valid_project_name,
};
use crate::config::Config;
use crate::error::{AppError, AppResult, Utf8PathExt, Utf8PathRefExt};
use crate::events::{
    BackendEvent, FantomeImportProgress, FantomeImportStage, GitImportProgress, GitImportStage,
};
use crate::hashtables::WadPathResolver;
use crate::mods::long_paths::{self, ImportRoot};
use crate::utils::natural_order::compare_names;
use fs_err as fs;
use ltk_fantome::FantomeReader;
use ltk_mod_project::fantome::FantomeImporter;
use ltk_mod_project::modpkg::{ModpkgImportError, ModpkgImporter, read_project};
use ltk_mod_project::{
    ImportError, ModMap, ModProject, ModProjectAuthor, ModProjectLayer, ModTag, ProjectImporter,
};
use ltk_modpkg::Modpkg;
use std::path::Path;

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

            let Ok(project_dir) = ProjectDir::open(&path) else {
                continue;
            };
            if project_dir.config_file().is_none() {
                continue;
            }

            match project_dir.load() {
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
            layers: ModProjectLayer::default_table(),
            thumbnail: None,
            hashtables: Vec::new(),
        };

        let config_path = project_dir.join("mod.config.json");
        let config_content = serde_json::to_string_pretty(&mod_project)?;
        fs::write(&config_path, config_content)?;

        let readme_content = format!(
            "# {}\n\n{}\n",
            mod_project.display_name, mod_project.description
        );
        fs::write(project_dir.join("README.md"), readme_content)?;

        start_project(project_dir)
    }

    /// Get a single workshop project by path.
    pub fn get_project(&self, project_path: &str) -> AppResult<WorkshopProject> {
        ProjectDir::open(project_path)?.load()
    }

    /// Save project configuration changes.
    pub fn save_config(&self, args: SaveProjectConfigArgs) -> AppResult<WorkshopProject> {
        let project_dir = ProjectDir::open(&args.project_path)?;
        let mut mod_project = project_dir.config()?;

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

        project_dir.write_config(&mod_project)?;

        project_dir.load()
    }

    /// Rename a workshop project (change its slug/directory name).
    pub fn rename_project(&self, project_path: &str, new_name: &str) -> AppResult<WorkshopProject> {
        let new_name = new_name.trim().to_string();

        if !is_valid_project_name(&new_name) {
            return Err(AppError::ValidationFailed(
                "Project name must be lowercase alphanumeric with hyphens only".to_string(),
            ));
        }

        let old_dir = ProjectDir::open(project_path)?;
        if old_dir.config_file().is_none() {
            return Err(AppError::ProjectNotFound(project_path.to_string()));
        }

        let parent_dir = old_dir.path().parent().ok_or_else(|| {
            AppError::InvalidPath("Cannot determine parent directory".to_string())
        })?;
        let new_path = parent_dir.join(&new_name);

        if old_dir.path() == new_path {
            return old_dir.load();
        }

        if new_path.exists() {
            return Err(AppError::ProjectAlreadyExists(new_name));
        }

        fs::rename(old_dir.path(), &new_path)?;

        let new_dir = ProjectDir::open(new_path)?;
        let mut mod_project = new_dir.config()?;
        mod_project.name = new_name;
        new_dir.write_config(&mod_project)?;

        new_dir.load()
    }

    /// Delete a workshop project.
    pub fn delete_project(&self, project_path: &str) -> AppResult<()> {
        let project_dir = ProjectDir::open(project_path)?;
        if project_dir.config_file().is_none() {
            return Err(AppError::ValidationFailed(
                "Directory does not appear to be a mod project".to_string(),
            ));
        }

        fs::remove_dir_all(project_dir.path())?;
        Ok(())
    }

    /// Peek into a .fantome archive and return metadata without extracting content.
    pub fn peek_fantome(&self, file_path: &str) -> AppResult<FantomePeekResult> {
        let mut reader = open_fantome(Path::new(file_path))?;
        let info = reader
            .read_info()
            .map_err(|e| AppError::Fantome(format!("Failed to read META/info.json: {e}")))?;

        let mut wad_files = reader.wad_names();
        wad_files.sort_by(|a, b| compare_names(a, b));

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

        // Ahead of the import rather than inside it, so an archive that cannot
        // land at all fails through the call's own error instead of through a
        // progress bar that opened and then reported an error with no reason.
        long_paths::preflight_fantome_import(
            Path::new(&args.file_path),
            &project_dir,
            ImportRoot::Workshop,
        )?;

        let result = self.run_fantome_import(&project_dir, &args, resolver);

        if result.is_err() {
            self.emit_fantome_progress(FantomeImportProgress {
                stage: FantomeImportStage::Error,
                current_item: None,
                current: 0,
                total: 0,
            });
            let _ = fs::remove_dir_all(&project_dir);
        }

        result
    }

    /// Unpack the archive into `project_dir` and load what landed there.
    ///
    /// Split out so the caller owns the one cleanup path: every failure past
    /// this point leaves a part-written directory to remove.
    fn run_fantome_import(
        &self,
        project_dir: &Path,
        args: &ImportFantomeArgs,
        resolver: &WadPathResolver,
    ) -> AppResult<WorkshopProject> {
        let utf8_project_dir = project_dir
            .to_path_buf()
            .try_into_utf8("project directory")?;

        ProjectImporter::new(&utf8_project_dir)
            .with_config(|project| {
                project.name = args.name.clone();
                project.display_name = args.display_name.clone();
            })
            .import_with_progress(
                FantomeImporter::new(fs::File::open(&args.file_path)?).with_path_resolver(resolver),
                &mut |progress| self.emit_fantome_progress(progress.into()),
            )
            .map_err(|e| AppError::Fantome(format!("Failed to import fantome archive: {e}")))?;

        long_paths::verify_unpacked(project_dir, ImportRoot::Workshop)?;

        start_project(project_dir)
    }

    fn emit_fantome_progress(&self, progress: FantomeImportProgress) {
        self.events()
            .emit(BackendEvent::FantomeImportProgress(progress));
    }

    /// Import a .modpkg file as a new workshop project.
    pub fn import_from_modpkg(
        &self,
        config: &Config,
        file_path: &str,
    ) -> AppResult<WorkshopProject> {
        let workshop_path = self.workshop_dir(config)?;

        // The package names the project and the name names the directory, so
        // the metadata is read before the import has anywhere to write. Mounting
        // decompresses that chunk alone, which is why reading it twice is cheap.
        let mut modpkg = Modpkg::mount_from_reader(fs::File::open(file_path)?)?;
        let name = read_project(&mut modpkg)?.name;

        let project_dir = workshop_path.join(&name);
        if project_dir.exists() {
            return Err(AppError::ProjectAlreadyExists(name));
        }

        // The destination is the package's own name rather than a slug this
        // side chose, so how long it is only becomes knowable here.
        long_paths::preflight_modpkg_import(&modpkg, &project_dir, ImportRoot::Workshop)?;
        drop(modpkg);

        if let Err(e) = ProjectImporter::new(project_dir.try_as_utf8("project directory")?)
            .import(ModpkgImporter::new(fs::File::open(file_path)?))
        {
            // The driver created the directory before the package failed to
            // decode, and removing what it half-wrote is the caller's.
            let _ = fs::remove_dir_all(&project_dir);
            return Err(modpkg_import_error(e));
        }

        start_project(project_dir)
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
            ProjectDir::open(project_dir)?.load()
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

/// Give a project this side just made its starter files, and read it back.
///
/// A git import does not come here. The repository carries whatever its author
/// chose, including no ignore rules at all.
fn start_project(project_dir: impl AsRef<Path>) -> AppResult<WorkshopProject> {
    let dir = ProjectDir::open(project_dir.as_ref())?;
    dir.write_default_ignore_rules()?;
    dir.load()
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

/// Keep a failed modpkg import reading as a modpkg failure.
///
/// The driver wraps the format's own error, and flattening the whole thing to
/// [`AppError::Other`] would cost the frontend the error kind it routes on.
fn modpkg_import_error(error: ImportError<ModpkgImportError>) -> AppError {
    match error {
        ImportError::Format(ModpkgImportError::Modpkg(e)) => AppError::Modpkg(e),
        other => AppError::Other(format!("Failed to import modpkg archive: {other}")),
    }
}

/// Open a `.fantome` for reading, naming the archive in the failure.
fn open_fantome(path: &Path) -> AppResult<FantomeReader<fs::File>> {
    FantomeReader::new(fs::File::open(path)?)
        .map_err(|e| AppError::Fantome(format!("Failed to open {}: {e}", path.display())))
}

#[cfg(test)]
mod tests;
