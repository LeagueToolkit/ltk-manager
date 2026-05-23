mod content;
mod layers;
mod packing;
mod projects;

pub use content::ContentTree;

use crate::error::{AppError, AppResult};
use crate::state::Settings;
use chrono::{DateTime, Utc};
use ltk_mod_project::{ModProject, ModProjectAuthor};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use thiserror::Error;
use ts_rs::TS;

/// Domain errors specific to workshop operations.
///
/// Sent over IPC as the `context` payload of an `AppError` with code `WORKSHOP`.
/// Frontend code can switch on `kind` to handle each variant.
#[derive(Debug, Clone, Serialize, Deserialize, Error, TS)]
#[ts(export)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WorkshopError {
    /// One or more files already exist in the target layer directory.
    #[error("File(s) already exist in target layer: {conflicts:?}")]
    LayerFileConflict { conflicts: Vec<String> },
}

/// Managed struct that encapsulates workshop operations.
///
/// Holds the `AppHandle` for consistency with `ModLibrary`.
/// Settings are passed per-call since they can change at runtime.
pub struct Workshop {
    app_handle: AppHandle,
}

/// Tauri managed state wrapper for `Workshop`.
pub struct WorkshopState(pub Workshop);

impl Workshop {
    pub fn new(app_handle: &AppHandle) -> Self {
        Self {
            app_handle: app_handle.clone(),
        }
    }

    /// Resolve the workshop directory from settings.
    pub(crate) fn workshop_dir(&self, settings: &Settings) -> AppResult<PathBuf> {
        settings
            .workshop_path
            .clone()
            .ok_or(AppError::WorkshopNotConfigured)
    }
}

/// A workshop project displayed in the UI.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct WorkshopProject {
    /// Absolute path to the project directory
    pub path: String,
    /// Project slug name (directory name)
    pub name: String,
    /// Human-readable display name
    pub display_name: String,
    /// Semantic version string
    pub version: String,
    /// Project description
    pub description: String,
    /// List of authors
    pub authors: Vec<WorkshopAuthor>,
    /// Categorization tags
    pub tags: Vec<String>,
    /// Champion names this mod applies to
    pub champions: Vec<String>,
    /// Map identifiers this mod applies to
    pub maps: Vec<String>,
    /// Project layers
    pub layers: Vec<WorkshopLayer>,
    /// Path to thumbnail image if exists
    pub thumbnail_path: Option<String>,
    /// Last modification time
    pub last_modified: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct WorkshopAuthor {
    pub name: String,
    pub role: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct WorkshopLayer {
    pub name: String,
    pub display_name: String,
    pub priority: i32,
    pub description: Option<String>,
    #[serde(default)]
    pub string_overrides: HashMap<String, HashMap<String, String>>,
}

/// Runtime info about a layer's content directory, fetched separately from config.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct WorkshopLayerInfo {
    pub wad_files: Vec<String>,
}

/// Derive a human-readable display name from a slug.
///
/// Splits on hyphens and capitalizes the first letter of each word.
/// Example: `"high-res"` → `"High Res"`, `"base"` → `"Base"`
pub(crate) fn slug_to_display_name(slug: &str) -> String {
    slug.split('-')
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(c) => {
                    let upper: String = c.to_uppercase().collect();
                    format!("{}{}", upper, chars.as_str())
                }
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Metadata peeked from a .fantome archive without extracting content.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FantomePeekResult {
    pub name: String,
    pub author: String,
    pub version: String,
    pub description: String,
    pub wad_files: Vec<String>,
    pub suggested_name: String,
}

/// Arguments for importing a .fantome archive.
#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ImportFantomeArgs {
    pub file_path: String,
    pub name: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum FantomeImportStage {
    Extracting,
    Finalizing,
    Complete,
    Error,
}

/// Progress event emitted during fantome import.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FantomeImportProgress {
    pub stage: FantomeImportStage,
    pub current_wad: Option<String>,
    pub current: u32,
    pub total: u32,
}

/// Arguments for importing a project from a GitHub repository.
#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ImportGitRepoArgs {
    pub url: String,
    #[ts(optional)]
    pub branch: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum GitImportStage {
    Downloading,
    Extracting,
    Complete,
    Error,
}

/// Progress event emitted during git repo import.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GitImportProgress {
    pub stage: GitImportStage,
    pub message: Option<String>,
}

/// Arguments for creating a new project.
#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectArgs {
    pub name: String,
    pub display_name: String,
    pub description: String,
    pub authors: Vec<String>,
}

/// Arguments for saving project configuration changes.
#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SaveProjectConfigArgs {
    pub project_path: String,
    pub display_name: String,
    pub version: String,
    pub description: String,
    pub authors: Vec<WorkshopAuthor>,
    pub tags: Vec<String>,
    pub champions: Vec<String>,
    pub maps: Vec<String>,
}

/// Arguments for packing a project.
#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PackProjectArgs {
    pub project_path: String,
    #[ts(optional)]
    pub output_dir: Option<String>,
    pub format: PackFormat,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum PackFormat {
    Modpkg,
    Fantome,
}

/// Result of a successful pack operation.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PackResult {
    pub output_path: String,
    pub file_name: String,
    pub format: String,
}

/// Result of adding files/folders to a layer.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AddFilesReport {
    /// Basenames of items added to the layer directory.
    pub added: Vec<String>,
}

/// Validation result for a project.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ValidationResult {
    pub valid: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

// ============================================================================
// Helpers
// ============================================================================

pub(crate) fn find_config_file(project_dir: &Path) -> Option<PathBuf> {
    let json_path = project_dir.join("mod.config.json");
    if json_path.exists() {
        return Some(json_path);
    }

    let toml_path = project_dir.join("mod.config.toml");
    if toml_path.exists() {
        return Some(toml_path);
    }

    None
}

pub(crate) fn load_workshop_project(project_dir: &Path) -> AppResult<WorkshopProject> {
    let config_path = find_config_file(project_dir)
        .ok_or_else(|| AppError::ProjectNotFound(project_dir.display().to_string()))?;

    let mod_project = ModProject::load_from_file(&config_path)?;

    let metadata = fs::metadata(&config_path)?;
    let last_modified = metadata
        .modified()
        .map(DateTime::<Utc>::from)
        .unwrap_or_else(|_| Utc::now());

    let thumbnail_path = if project_dir.join("thumbnail.webp").exists() {
        Some(project_dir.join("thumbnail.webp").display().to_string())
    } else if project_dir.join("thumbnail.png").exists() {
        Some(project_dir.join("thumbnail.png").display().to_string())
    } else {
        None
    };

    let authors = mod_project
        .authors
        .iter()
        .map(|a| match a {
            ModProjectAuthor::Name(name) => WorkshopAuthor {
                name: name.clone(),
                role: None,
            },
            ModProjectAuthor::Role { name, role } => WorkshopAuthor {
                name: name.clone(),
                role: Some(role.clone()),
            },
        })
        .collect();

    let layers = mod_project
        .layers
        .iter()
        .map(|l| WorkshopLayer {
            display_name: l
                .display_name
                .clone()
                .unwrap_or_else(|| slug_to_display_name(&l.name)),
            name: l.name.clone(),
            priority: l.priority,
            description: l.description.clone(),
            string_overrides: l.string_overrides.clone(),
        })
        .collect();

    let tags = mod_project.tags.iter().map(|t| t.to_string()).collect();
    let champions = mod_project.champions.clone();
    let maps = mod_project.maps.iter().map(|m| m.to_string()).collect();

    Ok(WorkshopProject {
        path: project_dir.display().to_string(),
        name: mod_project.name,
        display_name: mod_project.display_name,
        version: mod_project.version,
        description: mod_project.description,
        authors,
        tags,
        champions,
        maps,
        layers,
        thumbnail_path,
        last_modified,
    })
}

pub(crate) fn is_valid_project_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !name.starts_with('-')
        && !name.ends_with('-')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_project_name_simple() {
        assert!(is_valid_project_name("my-mod"));
    }

    #[test]
    fn valid_project_name_with_numbers() {
        assert!(is_valid_project_name("mod-v2"));
    }

    #[test]
    fn valid_project_name_single_char() {
        assert!(is_valid_project_name("a"));
    }

    #[test]
    fn invalid_project_name_empty() {
        assert!(!is_valid_project_name(""));
    }

    #[test]
    fn invalid_project_name_uppercase() {
        assert!(!is_valid_project_name("MyMod"));
    }

    #[test]
    fn invalid_project_name_spaces() {
        assert!(!is_valid_project_name("my mod"));
    }

    #[test]
    fn invalid_project_name_leading_dash() {
        assert!(!is_valid_project_name("-my-mod"));
    }

    #[test]
    fn invalid_project_name_trailing_dash() {
        assert!(!is_valid_project_name("my-mod-"));
    }

    #[test]
    fn invalid_project_name_special_chars() {
        assert!(!is_valid_project_name("my_mod"));
        assert!(!is_valid_project_name("my.mod"));
        assert!(!is_valid_project_name("my@mod"));
    }

    #[test]
    fn find_config_file_json() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("mod.config.json"), "{}").unwrap();
        let result = find_config_file(dir.path());
        assert!(result.is_some());
        assert!(result.unwrap().ends_with("mod.config.json"));
    }

    #[test]
    fn find_config_file_toml() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("mod.config.toml"), "").unwrap();
        let result = find_config_file(dir.path());
        assert!(result.is_some());
        assert!(result.unwrap().ends_with("mod.config.toml"));
    }

    #[test]
    fn find_config_file_prefers_json() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("mod.config.json"), "{}").unwrap();
        std::fs::write(dir.path().join("mod.config.toml"), "").unwrap();
        let result = find_config_file(dir.path());
        assert!(result.unwrap().ends_with("mod.config.json"));
    }

    #[test]
    fn find_config_file_none_when_empty() {
        let dir = tempfile::tempdir().unwrap();
        assert!(find_config_file(dir.path()).is_none());
    }
}
