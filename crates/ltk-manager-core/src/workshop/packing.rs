use super::ignore_rules::{ignore_error, project_relative};
use super::{
    IgnoredEntry, PackFormat, PackProjectArgs, PackResult, ProjectDir, ValidationResult, Workshop,
    WorkshopProject, is_valid_project_name,
};
use crate::error::{AppError, AppResult};
use camino::{Utf8Path, Utf8PathBuf};
use fs_err as fs;
use ltk_mod_project::fantome::FantomeFormat;
use ltk_mod_project::modpkg::ModpkgFormat;
use ltk_mod_project::{ModIgnore, ModProject, PackError, PackReport, PackageFormat, ProjectPacker};
use std::io::BufWriter;
use std::path::{Path, PathBuf};

impl ProjectDir {
    /// Check the project for problems that would break packing.
    pub fn validate(&self) -> AppResult<ValidationResult> {
        let mut errors = Vec::new();
        let mut warnings = Vec::new();

        let mod_project = match self.config() {
            Ok(p) => p,
            Err(AppError::ProjectNotFound(_)) => {
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
            errors
                .push("Project name must be lowercase alphanumeric with hyphens only".to_string());
        }

        if semver::Version::parse(&mod_project.version).is_err() {
            errors.push(format!(
                "Invalid version format: {} (expected semver like 1.0.0)",
                mod_project.version
            ));
        }

        let content_dir = self.path().join("content");
        if !content_dir.exists() {
            errors.push("content/ directory not found".to_string());
        } else {
            /* The filter the pack itself would build, so a layer the rules
            empty is warned about here rather than found in the package. */
            let ignore = match self.ignore_filter() {
                Ok(ignore) => Some(ignore),
                Err(e) => {
                    errors.push(e.to_string());
                    None
                }
            };

            for layer in &mod_project.layers {
                let layer_dir = content_dir.join(&layer.name);
                if !layer_dir.exists() {
                    errors.push(format!("Layer directory content/{} not found", layer.name));
                    continue;
                }

                match layer_contents(&layer_dir, ignore.as_ref()) {
                    LayerContents::Files => {}
                    LayerContents::Empty => {
                        warnings.push(format!("Layer content/{} is empty", layer.name));
                    }
                    LayerContents::EmptiedByRules => {
                        warnings.push(format!(
                            "Layer content/{} is empty after ignore rules",
                            layer.name
                        ));
                    }
                }
            }
        }

        if !mod_project.layers.iter().any(|l| l.name == "base") {
            warnings.push("No 'base' layer defined".to_string());
        }

        if !self.path().join("thumbnail.webp").exists()
            && !self.path().join("thumbnail.png").exists()
        {
            warnings.push("No thumbnail found (thumbnail.webp or thumbnail.png)".to_string());
        }

        Ok(ValidationResult {
            valid: errors.is_empty(),
            errors,
            warnings,
        })
    }
}

/// What a layer directory holds once the rules have had it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LayerContents {
    /// At least one entry a pack would take.
    Files,
    /// Nothing to pack and nothing excluded.
    Empty,
    /// Nothing to pack, because the rules took everything there was.
    EmptiedByRules,
}

/// What `layer_dir` holds, through `ignore` where the project has rules.
fn layer_contents(layer_dir: &Path, ignore: Option<&ModIgnore>) -> LayerContents {
    let filtered = ignore.zip(Utf8Path::from_path(layer_dir));
    let Some((ignore, layer_dir)) = filtered else {
        return match fs::read_dir(layer_dir).map(|entries| entries.count() == 0) {
            Ok(false) => LayerContents::Files,
            Ok(true) | Err(_) => LayerContents::Empty,
        };
    };

    /* `skipped` is only complete once the walk is, which is why the first
    entry returns before it is read. An entry that failed to read counts, since
    a directory nothing can read is not one a warning should call empty. */
    let mut walk = ignore.walk(layer_dir);
    if walk.by_ref().next().is_some() {
        return LayerContents::Files;
    }

    if walk.skipped().is_empty() {
        LayerContents::Empty
    } else {
        LayerContents::EmptiedByRules
    }
}

/// A pack failure as the frontend reads it.
///
/// A refused pattern is the one case with a field to carry, since
/// `to_string` alone drops the line the matcher counted.
fn pack_error<E: std::error::Error>(error: PackError<E>, project_root: &Utf8Path) -> AppError {
    match error {
        PackError::Ignore(ignore) => ignore_error(ignore, project_root),
        other => AppError::PackFailed(other.to_string()),
    }
}

/// `report`'s exclusions as the dialog lists them.
///
/// Relative to `content/` rather than to the project, because that is where a
/// rule's own path starts, and forward-slashed so both platforms read alike.
fn ignored_entries(report: &PackReport, content_dir: &Utf8Path) -> Vec<IgnoredEntry> {
    report
        .ignored_files()
        .iter()
        .map(|path| IgnoredEntry {
            /* The report says what was left out and not what shape it is, so
            the shape is read off disk, where the entry still sits. */
            pruned: path.is_dir(),
            path: project_relative(path, content_dir),
        })
        .collect()
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

        let mut mod_project = ModProject::load(&project_path_utf8)?;

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

        let project_root = project_path_utf8.clone();
        let content_dir = project_root.join("content");

        let (file_name, output_path, format, report) = match args.format {
            PackFormat::Modpkg => {
                let file_name = mod_project.package_file_name(None, PackageFormat::Modpkg);
                let output_path = output_dir.join(&file_name);
                let writer = BufWriter::new(fs::File::create(output_path.as_std_path())?);

                let report = ProjectPacker::new(mod_project, project_path_utf8)
                    .pack(ModpkgFormat::new(writer))
                    .map_err(|e| pack_error(e, &project_root))?;

                (file_name, output_path, "modpkg", report)
            }
            PackFormat::Fantome => {
                let file_name = mod_project.package_file_name(None, PackageFormat::Fantome);
                let output_path = output_dir.join(&file_name);
                let writer = BufWriter::new(fs::File::create(output_path.as_std_path())?);

                let report = ProjectPacker::new(mod_project, project_path_utf8)
                    .pack(FantomeFormat::new(writer))
                    .map_err(|e| pack_error(e, &project_root))?;

                (file_name, output_path, "fantome", report)
            }
        };

        Ok(PackResult {
            output_path: output_path.to_string(),
            file_name,
            format: format.to_string(),
            ignored: ignored_entries(&report, &content_dir),
        })
    }

    /// Validate a project before packing.
    pub fn validate_project(&self, project_path: &str) -> AppResult<ValidationResult> {
        self.project(project_path)?.validate()
    }

    /// Set a project's thumbnail image.
    pub fn set_thumbnail(
        &self,
        project_path: &str,
        image_path: &str,
    ) -> AppResult<WorkshopProject> {
        let project = self.project(project_path)?;
        if project.config_file().is_none() {
            return Err(AppError::ProjectNotFound(project_path.to_string()));
        }
        let project_dir = project.path();

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

        let mut mod_project = project.config()?;
        mod_project.thumbnail = Some("thumbnail.webp".to_string());
        project.write_config(&mod_project)?;

        project.load()
    }

    /// Remove a project's thumbnail image.
    pub fn remove_thumbnail(&self, project_path: &str) -> AppResult<WorkshopProject> {
        let project = self.project(project_path)?;
        if project.config_file().is_none() {
            return Err(AppError::ProjectNotFound(project_path.to_string()));
        }

        let _ = fs::remove_file(project.path().join("thumbnail.webp"));
        let _ = fs::remove_file(project.path().join("thumbnail.png"));

        let mut mod_project = project.config()?;
        mod_project.thumbnail = None;
        project.write_config(&mod_project)?;

        project.load()
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
mod tests;
