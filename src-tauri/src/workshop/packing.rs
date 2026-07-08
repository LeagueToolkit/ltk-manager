use super::{
    find_config_file, is_valid_project_name, load_workshop_project, PackFormat, PackProjectArgs,
    PackResult, ValidationResult, Workshop, WorkshopProject,
};
use crate::error::{AppError, AppResult};
use camino::Utf8PathBuf;
use ltk_mod_project::ModProject;
use std::fs;
use std::path::{Path, PathBuf};

/// Validate a project at the given path.
pub(crate) fn validate_project_at_path(path: &Path) -> AppResult<ValidationResult> {
    if !path.exists() {
        return Err(AppError::ProjectNotFound(path.display().to_string()));
    }

    let mut errors = Vec::new();
    let mut warnings = Vec::new();

    let mod_project = match ModProject::load(path) {
        Ok(p) => p,
        Err(ltk_mod_project::ModProjectError::ConfigNotFound(_)) => {
            errors.push("No mod.config.json or mod.config.toml found".to_string());
            return Ok(ValidationResult {
                valid: false,
                errors,
                warnings,
            });
        }
        Err(e) => {
            errors.push(format!("Failed to parse config: {}", e));
            return Ok(ValidationResult {
                valid: false,
                errors,
                warnings,
            });
        }
    };

    if !is_valid_project_name(&mod_project.name) {
        errors.push("Project name must be lowercase alphanumeric with hyphens only".to_string());
    }

    if semver::Version::parse(&mod_project.version).is_err() {
        errors.push(format!(
            "Invalid version format: {} (expected semver like 1.0.0)",
            mod_project.version
        ));
    }

    let content_dir = path.join("content");
    if !content_dir.exists() {
        errors.push("content/ directory not found".to_string());
    } else {
        for layer in &mod_project.layers {
            let layer_dir = content_dir.join(&layer.name);
            if !layer_dir.exists() {
                errors.push(format!("Layer directory content/{} not found", layer.name));
            } else if layer_dir.read_dir().map(|d| d.count() == 0).unwrap_or(true) {
                warnings.push(format!("Layer content/{} is empty", layer.name));
            }
        }
    }

    if !mod_project.layers.iter().any(|l| l.name == "base") {
        warnings.push("No 'base' layer defined".to_string());
    }

    if !path.join("thumbnail.webp").exists() && !path.join("thumbnail.png").exists() {
        warnings.push("No thumbnail found (thumbnail.webp or thumbnail.png)".to_string());
    }

    Ok(ValidationResult {
        valid: errors.is_empty(),
        errors,
        warnings,
    })
}

impl Workshop {
    /// Pack a workshop project to .modpkg or .fantome format.
    pub fn pack_project(&self, args: PackProjectArgs) -> AppResult<PackResult> {
        let project_path = PathBuf::from(&args.project_path);
        if !project_path.exists() {
            return Err(AppError::ProjectNotFound(args.project_path));
        }

        let project_path_utf8 = Utf8PathBuf::try_from(project_path.clone())
            .map_err(|_| AppError::InvalidPath("Project path is not valid UTF-8".to_string()))?;

        let mut mod_project = ModProject::load(&project_path)?;

        // Resolve thumbnail path so packers (fantome/modpkg) can include it
        if mod_project.thumbnail.is_none() {
            if project_path.join("thumbnail.webp").exists() {
                mod_project.thumbnail = Some("thumbnail.webp".to_string());
            } else if project_path.join("thumbnail.png").exists() {
                mod_project.thumbnail = Some("thumbnail.png".to_string());
            }
        }

        // Determine output directory
        let output_dir = args
            .output_dir
            .map(Utf8PathBuf::from)
            .unwrap_or_else(|| project_path_utf8.join("build"));

        // Create output directory if needed
        fs::create_dir_all(output_dir.as_std_path())?;

        match args.format {
            PackFormat::Modpkg => {
                let file_name = ltk_modpkg::project::create_file_name(&mod_project, None);
                let output_path = output_dir.join(&file_name);

                ltk_modpkg::project::pack_from_project_with_config(
                    &project_path_utf8,
                    &output_path,
                    &mod_project,
                )
                .map_err(|e| AppError::PackFailed(e.to_string()))?;

                Ok(PackResult {
                    output_path: output_path.to_string(),
                    file_name,
                    format: "modpkg".to_string(),
                })
            }
            PackFormat::Fantome => {
                let file_name = ltk_fantome::create_file_name(&mod_project, None);
                let output_path = output_dir.join(&file_name);

                let file = fs::File::create(output_path.as_std_path())?;
                let writer = std::io::BufWriter::new(file);

                ltk_fantome::pack_to_fantome(writer, &mod_project, project_path_utf8.as_std_path())
                    .map_err(|e| AppError::PackFailed(e.to_string()))?;

                Ok(PackResult {
                    output_path: output_path.to_string(),
                    file_name,
                    format: "fantome".to_string(),
                })
            }
        }
    }

    /// Validate a project before packing.
    pub fn validate_project(&self, project_path: &str) -> AppResult<ValidationResult> {
        validate_project_at_path(&PathBuf::from(project_path))
    }

    /// Set a project's thumbnail image.
    pub fn set_thumbnail(
        &self,
        project_path: &str,
        image_path: &str,
    ) -> AppResult<WorkshopProject> {
        let project_dir = PathBuf::from(project_path);
        if !project_dir.exists() {
            return Err(AppError::ProjectNotFound(project_path.to_string()));
        }

        // Verify it's a valid project
        if find_config_file(&project_dir).is_none() {
            return Err(AppError::ProjectNotFound(project_path.to_string()));
        }

        let source_path = PathBuf::from(image_path);
        if !source_path.exists() {
            return Err(AppError::InvalidPath(image_path.to_string()));
        }

        let extension = source_path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();

        let supported_formats = [
            "webp", "png", "jpg", "jpeg", "gif", "bmp", "tiff", "tif", "ico",
        ];
        if !supported_formats.contains(&extension.as_str()) {
            return Err(AppError::ValidationFailed(format!(
                "Unsupported image format: {}. Supported formats: {}",
                extension,
                supported_formats.join(", ")
            )));
        }

        let webp_data = if extension == "webp" {
            image::open(&source_path)
                .map_err(|e| AppError::ValidationFailed(format!("Failed to open image: {}", e)))?;
            fs::read(&source_path)?
        } else {
            // Encode as lossy WebP to avoid lossless bloat (the image crate's
            // WebP encoder is lossless-only and can inflate a 1 MB JPEG to 5+ MB)
            let img = image::open(&source_path)
                .map_err(|e| AppError::ValidationFailed(format!("Failed to open image: {}", e)))?;
            let encoder = webp::Encoder::from_image(&img)
                .map_err(|e| AppError::ValidationFailed(format!("Failed to encode WebP: {}", e)))?;
            encoder.encode(90.0).to_vec()
        };

        let target_path = project_dir.join("thumbnail.webp");
        let tmp_path = project_dir.join("thumbnail.webp.tmp");

        fs::write(&tmp_path, webp_data)?;

        if target_path.exists() {
            let _ = fs::remove_file(&target_path);
        }
        fs::rename(&tmp_path, &target_path)?;

        let _ = fs::remove_file(project_dir.join("thumbnail.png"));

        let mut mod_project = ModProject::load(&project_dir)?;
        mod_project.thumbnail = Some("thumbnail.webp".to_string());
        let json_config_path = project_dir.join("mod.config.json");
        fs::write(
            &json_config_path,
            serde_json::to_string_pretty(&mod_project)?,
        )?;

        load_workshop_project(&project_dir)
    }

    /// Remove a project's thumbnail image.
    pub fn remove_thumbnail(&self, project_path: &str) -> AppResult<WorkshopProject> {
        let project_dir = PathBuf::from(project_path);
        if !project_dir.exists() {
            return Err(AppError::ProjectNotFound(project_path.to_string()));
        }

        if find_config_file(&project_dir).is_none() {
            return Err(AppError::ProjectNotFound(project_path.to_string()));
        }

        let _ = fs::remove_file(project_dir.join("thumbnail.webp"));
        let _ = fs::remove_file(project_dir.join("thumbnail.png"));

        let mut mod_project = ModProject::load(&project_dir)?;
        mod_project.thumbnail = None;
        let json_config_path = project_dir.join("mod.config.json");
        fs::write(
            &json_config_path,
            serde_json::to_string_pretty(&mod_project)?,
        )?;

        load_workshop_project(&project_dir)
    }

    /// Get a project's thumbnail path (validates it exists).
    pub fn get_thumbnail(&self, thumbnail_path: &str) -> AppResult<String> {
        let path = PathBuf::from(thumbnail_path);
        if !path.exists() {
            return Err(AppError::InvalidPath(thumbnail_path.to_string()));
        }
        Ok(thumbnail_path.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use indexmap::IndexMap;

    fn make_valid_project(dir: &std::path::Path) {
        let mod_project = ltk_mod_project::ModProject {
            name: "test-mod".to_string(),
            display_name: "Test Mod".to_string(),
            version: "1.0.0".to_string(),
            description: "A valid test mod".to_string(),
            authors: vec![ltk_mod_project::ModProjectAuthor::Name(
                "Author".to_string(),
            )],
            license: None,
            tags: Vec::new(),
            champions: Vec::new(),
            maps: Vec::new(),
            transformers: Vec::new(),
            layers: ltk_mod_project::default_layers(),
            thumbnail: None,
        };
        fs::write(
            dir.join("mod.config.json"),
            serde_json::to_string_pretty(&mod_project).unwrap(),
        )
        .unwrap();
        fs::create_dir_all(dir.join("content").join("base")).unwrap();
        fs::write(
            dir.join("content").join("base").join("test.wad.client"),
            b"data",
        )
        .unwrap();
        fs::write(dir.join("thumbnail.webp"), b"fake thumbnail").unwrap();
    }

    #[test]
    fn validate_missing_config_file() {
        let dir = tempfile::tempdir().unwrap();
        let result = validate_project_at_path(dir.path()).unwrap();
        assert!(!result.valid);
        assert!(result.errors.iter().any(|e| e.contains("mod.config.json")));
    }

    #[test]
    fn validate_invalid_config() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("mod.config.json"), "invalid json").unwrap();
        let result = validate_project_at_path(dir.path()).unwrap();
        assert!(!result.valid);
        assert!(result.errors.iter().any(|e| e.contains("parse config")));
    }

    #[test]
    fn validate_invalid_project_name() {
        let dir = tempfile::tempdir().unwrap();
        let mod_project = ltk_mod_project::ModProject {
            name: "BadName".to_string(),
            display_name: "Bad".to_string(),
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
        };
        fs::write(
            dir.path().join("mod.config.json"),
            serde_json::to_string_pretty(&mod_project).unwrap(),
        )
        .unwrap();
        fs::create_dir_all(dir.path().join("content").join("base")).unwrap();

        let result = validate_project_at_path(dir.path()).unwrap();
        assert!(!result.valid);
        assert!(result.errors.iter().any(|e| e.contains("lowercase")));
    }

    #[test]
    fn validate_invalid_version() {
        let dir = tempfile::tempdir().unwrap();
        let mod_project = ltk_mod_project::ModProject {
            name: "test-mod".to_string(),
            display_name: "Test".to_string(),
            version: "not-semver".to_string(),
            description: "".to_string(),
            authors: Vec::new(),
            license: None,
            tags: Vec::new(),
            champions: Vec::new(),
            maps: Vec::new(),
            transformers: Vec::new(),
            layers: ltk_mod_project::default_layers(),
            thumbnail: None,
        };
        fs::write(
            dir.path().join("mod.config.json"),
            serde_json::to_string_pretty(&mod_project).unwrap(),
        )
        .unwrap();
        fs::create_dir_all(dir.path().join("content").join("base")).unwrap();

        let result = validate_project_at_path(dir.path()).unwrap();
        assert!(!result.valid);
        assert!(result.errors.iter().any(|e| e.contains("version")));
    }

    #[test]
    fn validate_missing_content_dir() {
        let dir = tempfile::tempdir().unwrap();
        let mod_project = ltk_mod_project::ModProject {
            name: "test-mod".to_string(),
            display_name: "Test".to_string(),
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
        };
        fs::write(
            dir.path().join("mod.config.json"),
            serde_json::to_string_pretty(&mod_project).unwrap(),
        )
        .unwrap();

        let result = validate_project_at_path(dir.path()).unwrap();
        assert!(!result.valid);
        assert!(result.errors.iter().any(|e| e.contains("content/")));
    }

    #[test]
    fn validate_empty_layer_dir_warns() {
        let dir = tempfile::tempdir().unwrap();
        let mod_project = ltk_mod_project::ModProject {
            name: "test-mod".to_string(),
            display_name: "Test".to_string(),
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
        };
        fs::write(
            dir.path().join("mod.config.json"),
            serde_json::to_string_pretty(&mod_project).unwrap(),
        )
        .unwrap();
        fs::create_dir_all(dir.path().join("content").join("base")).unwrap();

        let result = validate_project_at_path(dir.path()).unwrap();
        assert!(result.valid);
        assert!(result.warnings.iter().any(|w| w.contains("empty")));
    }

    #[test]
    fn validate_missing_thumbnail_warns() {
        let dir = tempfile::tempdir().unwrap();
        let mod_project = ltk_mod_project::ModProject {
            name: "test-mod".to_string(),
            display_name: "Test".to_string(),
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
        };
        fs::write(
            dir.path().join("mod.config.json"),
            serde_json::to_string_pretty(&mod_project).unwrap(),
        )
        .unwrap();
        fs::create_dir_all(dir.path().join("content").join("base")).unwrap();
        fs::write(
            dir.path().join("content").join("base").join("file"),
            b"data",
        )
        .unwrap();

        let result = validate_project_at_path(dir.path()).unwrap();
        assert!(result.valid);
        assert!(result.warnings.iter().any(|w| w.contains("thumbnail")));
    }

    #[test]
    fn validate_valid_project_passes() {
        let dir = tempfile::tempdir().unwrap();
        make_valid_project(dir.path());
        let result = validate_project_at_path(dir.path()).unwrap();
        assert!(
            result.valid,
            "errors: {:?}, warnings: {:?}",
            result.errors, result.warnings
        );
        assert!(result.errors.is_empty());
    }

    #[test]
    fn validate_no_base_layer_warns() {
        let dir = tempfile::tempdir().unwrap();
        let mod_project = ltk_mod_project::ModProject {
            name: "test-mod".to_string(),
            display_name: "Test".to_string(),
            version: "1.0.0".to_string(),
            description: "".to_string(),
            authors: Vec::new(),
            license: None,
            tags: Vec::new(),
            champions: Vec::new(),
            maps: Vec::new(),
            transformers: Vec::new(),
            layers: vec![ltk_mod_project::ModProjectLayer {
                name: "chroma".to_string(),
                display_name: Some("Chroma".to_string()),
                priority: 1,
                description: None,
                string_overrides: IndexMap::new(),
            }],
            thumbnail: None,
        };
        fs::write(
            dir.path().join("mod.config.json"),
            serde_json::to_string_pretty(&mod_project).unwrap(),
        )
        .unwrap();
        fs::create_dir_all(dir.path().join("content").join("chroma")).unwrap();
        fs::write(
            dir.path().join("content").join("chroma").join("file"),
            b"data",
        )
        .unwrap();

        let result = validate_project_at_path(dir.path()).unwrap();
        assert!(result.warnings.iter().any(|w| w.contains("base")));
    }

    #[test]
    fn pack_format_deserialization() {
        let modpkg: PackFormat = serde_json::from_str("\"modpkg\"").unwrap();
        assert_eq!(modpkg, PackFormat::Modpkg);
        let fantome: PackFormat = serde_json::from_str("\"fantome\"").unwrap();
        assert_eq!(fantome, PackFormat::Fantome);
    }
}
