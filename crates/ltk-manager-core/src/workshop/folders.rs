//! Opening a folder anywhere on disk as a workshop project.
//!
//! Per "Open any folder" in docs/ux/WORKSHOP.md.

use super::layers::{extract_wad_into_dir, is_wad_entry};
use super::registry::{OpenedProjectFolder, ProjectKey};
use super::text_files::write_default_readme;
use super::{
    ProjectDir, ProjectLocation, Workshop, WorkshopProject, find_config_file, is_valid_project_name,
};
use crate::config::Config;
use crate::error::{AppError, AppResult};
use crate::hashtables::WadPathResolver;
use crate::utils::fs::copy_dir_all;
use crate::utils::natural_order::compare_names;
use fs_err as fs;
use ltk_fantome::FantomeInfo;
use ltk_mod_project::{ModProject, ModProjectLayer};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// The fantome layout's metadata directory, as cslol-manager installs a mod.
const META_DIR: &str = "META";
/// The fantome layout's WAD directory.
const WAD_DIR: &str = "WAD";
/// The fantome layout's loose-file directory.
const RAW_DIR: &str = "RAW";

/// What a folder picked with Open folder holds.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FolderInspection {
    /// Nothing at the path.
    Missing,
    /// A folder with a project config, ready to open.
    Project { project: Box<WorkshopProject> },
    /// A mod in fantome layout, such as a cslol-manager install.
    Fantome { layout: FantomeFolder },
    /// A folder whose subfolders are projects or fantome mods.
    Parent {
        projects: Vec<String>,
        fantome: Vec<String>,
    },
    /// A folder with none of the above, which can become an empty project.
    #[serde(rename_all = "camelCase")]
    Plain {
        suggested_name: String,
        display_name: String,
    },
}

/// A fantome-layout folder, as the conversion would read it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct FantomeFolder {
    pub display_name: String,
    pub suggested_name: String,
    pub author: Option<String>,
    pub version: Option<String>,
    /// Whether `META/info.json` was there to read the metadata from.
    pub has_info: bool,
    pub wads: Vec<FolderWad>,
    /// Whether a `RAW/` directory holds loose files.
    pub has_raw: bool,
}

/// One entry of a fantome folder's `WAD/` directory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct FolderWad {
    pub name: String,
    /// A packed archive, which the conversion unpacks, rather than a directory it moves.
    pub packed: bool,
}

/// Where a converted folder's project lives.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub enum ConvertPlacement {
    /// The folder itself becomes the project.
    InPlace,
    /// A copy in the workshop folder becomes the project, and the folder is left alone.
    Copy,
}

/// Arguments for turning a folder into a project.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct ConvertFolderArgs {
    pub path: String,
    pub name: String,
    pub display_name: String,
    pub placement: ConvertPlacement,
}

/// What adding a folder of mods did with each one.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct AddFoldersReport {
    pub added: Vec<WorkshopProject>,
    pub failed: Vec<FolderFailure>,
}

/// A folder the batch could not add, and why.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct FolderFailure {
    pub path: String,
    pub message: String,
}

impl Workshop {
    /// Classify the folder at `path` for the Open folder flow.
    ///
    /// # Errors
    ///
    /// Returns an error if the folder or a subfolder cannot be listed.
    pub fn inspect_folder(&self, config: &Config, path: &str) -> AppResult<FolderInspection> {
        let path = Path::new(path);
        if !path.is_dir() {
            return Ok(FolderInspection::Missing);
        }

        if find_config_file(path).is_some() {
            let project = self.describe(config, ProjectDir::open(path)?.load()?);
            return Ok(FolderInspection::Project {
                project: Box::new(project),
            });
        }

        if let Some(layout) = read_fantome_folder(path)? {
            return Ok(FolderInspection::Fantome { layout });
        }

        let mut projects = Vec::new();
        let mut fantome = Vec::new();
        for entry in fs::read_dir(path)? {
            let child = entry?.path();
            if !child.is_dir() {
                continue;
            }

            if find_config_file(&child).is_some() {
                projects.push(child.display().to_string());
            } else if is_fantome_folder(&child) {
                fantome.push(child.display().to_string());
            }
        }

        if !projects.is_empty() || !fantome.is_empty() {
            projects.sort_by(|a, b| compare_names(a, b));
            fantome.sort_by(|a, b| compare_names(a, b));
            return Ok(FolderInspection::Parent { projects, fantome });
        }

        let display_name = folder_name(path);
        Ok(FolderInspection::Plain {
            suggested_name: slug::slugify(&display_name),
            display_name,
        })
    }

    /// Open the project folder at `path`, adding it to the list when it is outside the workshop folder.
    ///
    /// # Errors
    ///
    /// [`AppError::ProjectNotFound`] when the folder has no project config.
    pub fn open_folder(&self, config: &Config, path: &str) -> AppResult<WorkshopProject> {
        let dir = ProjectDir::open(path)?;
        if dir.config_file().is_none() {
            return Err(AppError::ProjectNotFound(path.to_string()));
        }

        let project = dir.load()?;
        if !is_in_workshop_folder(config, dir.path()) {
            self.registry().add(dir.path(), &project.display_name)?;
        }
        self.registry().touch(dir.path())?;

        Ok(self.describe(config, project))
    }

    /// Record that the project at `path` was opened, for the recent order.
    ///
    /// # Errors
    ///
    /// Returns an error if the registry file cannot be written.
    pub fn record_opened(&self, path: &str) -> AppResult<()> {
        self.registry().touch(Path::new(path))
    }

    /// The folders opened from outside the workshop folder, including the ones that are gone.
    pub fn opened_folders(&self) -> Vec<OpenedProjectFolder> {
        self.registry().opened_folders()
    }

    /// Remove the folder at `path` from the list. Its files are untouched.
    ///
    /// # Errors
    ///
    /// Returns an error if the registry file cannot be written.
    pub fn forget_folder(&self, path: &str) -> AppResult<()> {
        self.registry().forget(Path::new(path))
    }

    /// Point the list entry for a moved folder at where it is now.
    ///
    /// # Errors
    ///
    /// [`AppError::ProjectNotFound`] when `new_path` has no project config.
    pub fn relocate_folder(
        &self,
        config: &Config,
        old_path: &str,
        new_path: &str,
    ) -> AppResult<WorkshopProject> {
        let dir = ProjectDir::open(new_path)?;
        if dir.config_file().is_none() {
            return Err(AppError::ProjectNotFound(new_path.to_string()));
        }

        let project = dir.load()?;
        self.registry()
            .relocate(Path::new(old_path), dir.path(), &project.display_name)?;
        self.registry().touch(dir.path())?;

        Ok(self.describe(config, project))
    }

    /// Turn a folder without a config into a project, where it is or as a copy in the workshop folder.
    ///
    /// # Errors
    ///
    /// - [`AppError::ValidationFailed`] for an invalid project name.
    /// - [`AppError::ProjectAlreadyExists`] when the folder is a project already, or the copy's
    ///   destination exists.
    /// - [`AppError::WorkshopNotConfigured`] for a copy with no workshop folder set.
    pub fn convert_folder(
        &self,
        config: &Config,
        args: ConvertFolderArgs,
        resolver: &WadPathResolver,
    ) -> AppResult<WorkshopProject> {
        if !is_valid_project_name(&args.name) {
            return Err(AppError::ValidationFailed(
                "Project name must be lowercase alphanumeric with hyphens only".to_string(),
            ));
        }

        let source = PathBuf::from(&args.path);
        if find_config_file(&source).is_some() {
            return Err(AppError::ProjectAlreadyExists(args.name));
        }

        let target = match args.placement {
            ConvertPlacement::InPlace => source,
            ConvertPlacement::Copy => {
                let destination = self.workshop_dir(config)?.join(&args.name);
                if destination.exists() {
                    return Err(AppError::ProjectAlreadyExists(args.name));
                }

                copy_dir_all(&source, &destination)?;
                destination
            }
        };

        if let Err(error) = convert_in_place(&target, &args.name, &args.display_name, resolver) {
            if args.placement == ConvertPlacement::Copy {
                let _ = fs::remove_dir_all(&target);
            }
            return Err(error);
        }

        self.open_folder(config, &target.display().to_string())
    }

    /// Add every project and fantome mod directly under `paths` to the list.
    ///
    /// A fantome mod is converted in place under the name its metadata suggests.
    /// A folder that fails is reported and the batch carries on.
    pub fn add_folders(
        &self,
        config: &Config,
        paths: Vec<String>,
        resolver: &WadPathResolver,
    ) -> AddFoldersReport {
        let mut added = Vec::with_capacity(paths.len());
        let mut failed = Vec::new();

        for path in paths {
            let result = self.add_one_folder(config, &path, resolver);

            match result {
                Ok(project) => added.push(project),
                Err(error) => {
                    tracing::warn!(%error, path, "Could not add folder to the workshop");
                    failed.push(FolderFailure {
                        path,
                        message: error.to_string(),
                    });
                }
            }
        }

        AddFoldersReport { added, failed }
    }

    fn add_one_folder(
        &self,
        config: &Config,
        path: &str,
        resolver: &WadPathResolver,
    ) -> AppResult<WorkshopProject> {
        if find_config_file(Path::new(path)).is_some() {
            return self.open_folder(config, path);
        }

        let layout = read_fantome_folder(Path::new(path))?.ok_or_else(|| {
            AppError::ValidationFailed(format!("{path} is not a mod project or a fantome mod"))
        })?;

        self.convert_folder(
            config,
            ConvertFolderArgs {
                path: path.to_string(),
                name: layout.suggested_name,
                display_name: layout.display_name,
                placement: ConvertPlacement::InPlace,
            },
            resolver,
        )
    }

    /// Fill in what a project's place in the workshop decides: where it lives and when it was opened.
    pub fn describe(&self, config: &Config, mut project: WorkshopProject) -> WorkshopProject {
        let path = PathBuf::from(&project.path);

        project.location = match is_in_workshop_folder(config, &path) {
            true => ProjectLocation::Workshop,
            false => ProjectLocation::Opened,
        };
        project.last_opened = self.registry().last_opened(&ProjectKey::of(&path));

        project
    }
}

/// Whether `path` is inside the configured workshop folder.
pub(crate) fn is_in_workshop_folder(config: &Config, path: &Path) -> bool {
    config
        .workshop_path
        .as_deref()
        .is_some_and(|root| ProjectKey::of(path).is_within(&ProjectKey::of(root)))
}

/// Whether `path` has the fantome layout's `META/info.json` or `WAD/` directory.
fn is_fantome_folder(path: &Path) -> bool {
    path.join(META_DIR).join("info.json").is_file() || path.join(WAD_DIR).is_dir()
}

fn folder_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

fn read_info(path: &Path) -> AppResult<Option<FantomeInfo>> {
    let info_path = path.join(META_DIR).join("info.json");
    if !info_path.is_file() {
        return Ok(None);
    }

    let text = fs::read_to_string(&info_path)?;
    let info = serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|error| {
        AppError::Fantome(format!("{} does not parse: {error}", info_path.display()))
    })?;

    Ok(Some(info))
}

/// Read the folder at `path` as a fantome mod, or `None` when it has no fantome layout.
fn read_fantome_folder(path: &Path) -> AppResult<Option<FantomeFolder>> {
    if !is_fantome_folder(path) {
        return Ok(None);
    }

    let info = read_info(path)?;
    let display_name = info
        .as_ref()
        .map(|info| info.name.trim().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| folder_name(path));

    let mut wads = Vec::new();
    let wad_dir = path.join(WAD_DIR);
    if wad_dir.is_dir() {
        for entry in fs::read_dir(&wad_dir)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if !is_wad_entry(&name) {
                continue;
            }

            wads.push(FolderWad {
                packed: entry.path().is_file(),
                name,
            });
        }
    }
    wads.sort_by(|a, b| compare_names(&a.name, &b.name));

    let non_empty = |value: &str| Some(value.trim().to_string()).filter(|v| !v.is_empty());

    Ok(Some(FantomeFolder {
        suggested_name: slug::slugify(&display_name),
        author: info.as_ref().and_then(|info| non_empty(&info.author)),
        version: info.as_ref().and_then(|info| non_empty(&info.version)),
        has_info: info.is_some(),
        has_raw: path.join(RAW_DIR).is_dir(),
        display_name,
        wads,
    }))
}

/// Turn the folder at `dir` into a project in its own place.
///
/// Packed WADs unpack into temporary directories first, so a failure there
/// leaves the folder as it was. Only then do the WADs and `RAW/` move into
/// `content/base`, the config land, and the packed originals go. `META/` stays.
fn convert_in_place(
    dir: &Path,
    name: &str,
    display_name: &str,
    resolver: &WadPathResolver,
) -> AppResult<()> {
    let info = read_info(dir)?;
    let base_dir = dir.join("content").join(ModProjectLayer::BASE_NAME);
    let wad_dir = dir.join(WAD_DIR);

    let mut moves: Vec<(PathBuf, PathBuf)> = Vec::new();
    let mut unpacks: Vec<(PathBuf, PathBuf)> = Vec::new();
    if wad_dir.is_dir() {
        for entry in fs::read_dir(&wad_dir)? {
            let source = entry?.path();
            let file_name = folder_name(&source);
            if !is_wad_entry(&file_name) {
                continue;
            }

            let destination = base_dir.join(&file_name);
            if destination.exists() {
                return Err(AppError::ValidationFailed(format!(
                    "{} already exists",
                    destination.display()
                )));
            }

            match source.is_file() {
                true => unpacks.push((source, destination)),
                false => moves.push((source, destination)),
            }
        }
    }

    fs::create_dir_all(&base_dir)?;

    for (index, (source, destination)) in unpacks.iter().enumerate() {
        if let Err(error) =
            extract_wad_into_dir(source, &unpack_temp(&base_dir, destination), resolver)
        {
            for (_, unpacked) in &unpacks[..=index] {
                let _ = fs::remove_dir_all(unpack_temp(&base_dir, unpacked));
            }
            return Err(error);
        }
    }

    for (_, destination) in &unpacks {
        fs::rename(unpack_temp(&base_dir, destination), destination)?;
    }
    for (source, destination) in &moves {
        fs::rename(source, destination)?;
    }

    let raw_dir = dir.join(RAW_DIR);
    let raw_target = ModProjectLayer::raw_content_path(camino::Utf8Path::new(""));
    let raw_target = dir.join(raw_target.as_std_path());
    if raw_dir.is_dir() && !raw_target.exists() {
        fs::rename(&raw_dir, &raw_target)?;
    }

    let mut project = match info {
        Some(info) => ModProject::from(info),
        None => blank_project(),
    };
    project.name = name.to_string();
    project.display_name = display_name.to_string();
    if project.layers.is_empty() {
        project.layers = ModProjectLayer::default_table();
    }
    fs::write(
        dir.join("mod.config.json"),
        serde_json::to_string_pretty(&project)?,
    )?;

    for (source, _) in &unpacks {
        fs::remove_file(source)?;
    }
    if wad_dir.is_dir() {
        let _ = fs::remove_dir(&wad_dir);
    }

    adopt_meta_files(dir)?;
    write_default_readme(dir, display_name)?;
    ProjectDir::open(dir)?.write_default_ignore_rules()?;

    Ok(())
}

fn unpack_temp(base_dir: &Path, destination: &Path) -> PathBuf {
    base_dir.join(format!(".{}.tmp", folder_name(destination)))
}

/// Copy the fantome layout's readme and image to where a project keeps them, when it has none.
fn adopt_meta_files(dir: &Path) -> AppResult<()> {
    let meta = dir.join(META_DIR);

    let readme = meta.join("README.md");
    if readme.is_file() && !dir.join("README.md").exists() {
        fs::copy(&readme, dir.join("README.md"))?;
    }

    let image = meta.join("image.png");
    if image.is_file()
        && !dir.join("thumbnail.png").exists()
        && !dir.join("thumbnail.webp").exists()
    {
        fs::copy(&image, dir.join("thumbnail.png"))?;
    }

    Ok(())
}

fn blank_project() -> ModProject {
    ModProject {
        name: String::new(),
        display_name: String::new(),
        version: "1.0.0".to_string(),
        description: String::new(),
        authors: Vec::new(),
        license: None,
        tags: Vec::new(),
        champions: Vec::new(),
        maps: Vec::new(),
        transformers: Vec::new(),
        layers: ModProjectLayer::default_table(),
        thumbnail: None,
        hashtables: Vec::new(),
    }
}

#[cfg(test)]
mod tests;
