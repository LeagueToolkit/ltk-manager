use super::{
    AddFilesReport, ProjectDir, Workshop, WorkshopError, WorkshopLayerInfo, WorkshopProject,
    is_valid_project_name,
};
use crate::error::{AppError, AppResult};
use crate::hashtables::WadPathResolver;
use camino::Utf8Path;
use indexmap::IndexMap;
use ltk_mod_project::ModProjectLayer;
use ltk_wad::{NamingPolicy, PathResolver, Wad, WadExtractor};
use std::collections::HashMap;
use std::fs;
use std::io::BufReader;
use std::path::{Component, Path, PathBuf};
use std::time::Instant;

impl ProjectDir {
    /// Create a new layer.
    pub fn create_layer(
        &self,
        name: &str,
        display_name: Option<String>,
        description: Option<String>,
    ) -> AppResult<WorkshopProject> {
        let name = name.trim().to_string();

        if !is_valid_project_name(&name) {
            return Err(AppError::ValidationFailed(
                "Layer name must be lowercase alphanumeric with hyphens only".to_string(),
            ));
        }

        let mut mod_project = self.config()?;

        if mod_project.layers.iter().any(|l| l.name == name) {
            return Err(AppError::ValidationFailed(format!(
                "A layer named '{}' already exists",
                name
            )));
        }

        let max_priority = mod_project
            .layers
            .iter()
            .map(|l| l.priority)
            .max()
            .unwrap_or(-1);

        mod_project.layers.push(ModProjectLayer {
            name: name.clone(),
            display_name,
            priority: max_priority + 1,
            description,
            string_overrides: IndexMap::new(),
        });

        self.write_config(&mod_project)?;

        let layer_content_dir = self.path().join("content").join(&name);
        fs::create_dir_all(&layer_content_dir)?;

        self.load()
    }

    /// Delete a layer and its content directory.
    pub fn delete_layer(&self, layer_name: &str) -> AppResult<WorkshopProject> {
        if layer_name == "base" {
            return Err(AppError::ValidationFailed(
                "Cannot delete the base layer".to_string(),
            ));
        }

        let mut mod_project = self.config()?;

        let layer_index = mod_project
            .layers
            .iter()
            .position(|l| l.name == layer_name)
            .ok_or_else(|| {
                AppError::ValidationFailed(format!("Layer '{}' not found in project", layer_name))
            })?;

        mod_project.layers.remove(layer_index);

        self.write_config(&mod_project)?;

        let layer_content_dir = self.path().join("content").join(layer_name);
        if layer_content_dir.exists() {
            let _ = fs::remove_dir_all(&layer_content_dir);
        }

        self.load()
    }

    /// Update a layer's description.
    pub fn update_layer_description(
        &self,
        layer_name: &str,
        description: Option<String>,
    ) -> AppResult<WorkshopProject> {
        let mut mod_project = self.config()?;

        let layer = mod_project
            .layers
            .iter_mut()
            .find(|l| l.name == layer_name)
            .ok_or_else(|| {
                AppError::ValidationFailed(format!("Layer '{}' not found in project", layer_name))
            })?;

        layer.description = description;

        self.write_config(&mod_project)?;

        self.load()
    }

    /// Rename a layer.
    ///
    /// Updates the display name and derives a new slug from it.
    /// Also renames the layer's content directory.
    pub fn rename_layer(
        &self,
        layer_name: &str,
        new_display_name: &str,
    ) -> AppResult<WorkshopProject> {
        if layer_name == "base" {
            return Err(AppError::ValidationFailed(
                "Cannot rename the base layer".to_string(),
            ));
        }

        let new_display_name = new_display_name.trim().to_string();
        if new_display_name.is_empty() {
            return Err(AppError::ValidationFailed(
                "Display name cannot be empty".to_string(),
            ));
        }

        let new_name = slug::slugify(&new_display_name);
        if new_name.is_empty() {
            return Err(AppError::ValidationFailed(
                "Display name must produce a valid slug".to_string(),
            ));
        }

        let mut mod_project = self.config()?;

        if new_name != layer_name && mod_project.layers.iter().any(|l| l.name == new_name) {
            return Err(AppError::ValidationFailed(format!(
                "A layer named '{}' already exists",
                new_name
            )));
        }

        let layer = mod_project
            .layers
            .iter_mut()
            .find(|l| l.name == layer_name)
            .ok_or_else(|| {
                AppError::ValidationFailed(format!("Layer '{}' not found in project", layer_name))
            })?;

        layer.display_name = Some(new_display_name);
        layer.name = new_name.clone();

        if new_name != layer_name {
            let old_dir = self.path().join("content").join(layer_name);
            let new_dir = self.path().join("content").join(&new_name);
            if old_dir.exists() {
                fs::rename(&old_dir, &new_dir)?;
            }
        }

        self.write_config(&mod_project)?;

        self.load()
    }

    /// Reorder layers by reassigning priorities.
    pub fn reorder_layers(&self, layer_names: Vec<String>) -> AppResult<WorkshopProject> {
        let mut mod_project = self.config()?;

        if layer_names.contains(&"base".to_string()) {
            return Err(AppError::ValidationFailed(
                "Base layer cannot be reordered".to_string(),
            ));
        }

        let mut current_non_base: Vec<String> = mod_project
            .layers
            .iter()
            .filter(|l| l.name != "base")
            .map(|l| l.name.clone())
            .collect();
        let mut provided_names = layer_names.clone();
        current_non_base.sort();
        provided_names.sort();

        if current_non_base != provided_names {
            return Err(AppError::ValidationFailed(
                "Provided layer names must match exactly the existing non-base layers".to_string(),
            ));
        }

        let mut reordered = Vec::with_capacity(mod_project.layers.len());
        if let Some(mut base) = mod_project
            .layers
            .iter()
            .find(|l| l.name == "base")
            .cloned()
        {
            base.priority = 0;
            reordered.push(base);
        }
        for (i, name) in layer_names.iter().enumerate() {
            let mut layer = mod_project
                .layers
                .iter()
                .find(|l| &l.name == name)
                .cloned()
                .expect("layer existence validated above");
            layer.priority = (i + 1) as i32;
            reordered.push(layer);
        }
        mod_project.layers = reordered;

        self.write_config(&mod_project)?;

        self.load()
    }

    /// Save string overrides for a specific layer.
    pub fn save_layer_string_overrides(
        &self,
        layer_name: &str,
        string_overrides: IndexMap<String, IndexMap<String, String>>,
    ) -> AppResult<WorkshopProject> {
        let mut mod_project = self.config()?;

        let layer = mod_project
            .layers
            .iter_mut()
            .find(|l| l.name == layer_name)
            .ok_or_else(|| {
                AppError::ValidationFailed(format!("Layer '{}' not found in project", layer_name))
            })?;

        layer.string_overrides = string_overrides;

        self.write_config(&mod_project)?;

        self.load()
    }

    /// The absolute path to a layer's content directory, creating it if needed.
    pub fn layer_content_path(&self, layer_name: &str) -> AppResult<PathBuf> {
        let layer_dir = self.path().join("content").join(layer_name);
        if !layer_dir.exists() {
            fs::create_dir_all(&layer_dir)?;
        }
        Ok(layer_dir)
    }
}

fn is_wad_entry(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".wad.client") || lower.ends_with(".wad") || lower.ends_with(".wad.mobile")
}

/// Extract a packed WAD file into `dst`, naming chunks through `resolver`.
fn extract_wad_into_dir(src: &Path, dst: &Path, resolver: &impl PathResolver) -> AppResult<()> {
    fs::create_dir_all(dst)?;

    let file = fs::File::open(src)?;
    let mut wad = Wad::mount(BufReader::new(file))?;

    let mut extractor = WadExtractor::new(resolver)
        .with_naming_policy(NamingPolicy::Lossless)
        .with_name_recovery();
    let utf8_dst = Utf8Path::from_path(dst).ok_or_else(|| {
        AppError::Other(format!(
            "WAD output path is not valid UTF-8: {}",
            dst.display()
        ))
    })?;
    let started = Instant::now();
    let report = extractor.extract_all(&mut wad, utf8_dst)?;

    tracing::debug!(
        wad = %src.display(),
        extracted = report.extracted,
        recovered = report.recovered.names.len(),
        bins_scanned = report.recovered.bins_scanned,
        renamed = report.renamed(),
        rejected = report.rejected(),
        duplicates = report.duplicates(),
        elapsed_ms = started.elapsed().as_millis(),
        "Extracted packed WAD into layer"
    );

    Ok(())
}

/// Recursively copy `src` directory into `dst`, skipping symlinks.
fn copy_dir_recursive(src: &Path, dst: &Path) -> AppResult<()> {
    fs::create_dir_all(dst)?;
    for entry in walkdir::WalkDir::new(src).follow_links(false).into_iter() {
        let entry = entry.map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))?;
        let file_type = entry.file_type();
        if file_type.is_symlink() {
            continue;
        }
        let rel = entry
            .path()
            .strip_prefix(src)
            .map_err(|e| AppError::Other(e.to_string()))?;
        let target = dst.join(rel);
        if file_type.is_dir() {
            fs::create_dir_all(&target)?;
        } else if file_type.is_file() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// Resolve a layer-relative path to somewhere the layer genuinely holds.
///
/// Deleting is permanent, so this is deliberately stricter than joining. Every
/// segment has to be one plain name, which rejects `..` and an absolute path
/// before anything reaches the disk, and the directory the entry sits in is
/// then canonicalized and checked against the layer - which is what a symlink
/// partway down the path cannot get past.
fn resolve_in_layer(layer_dir: &Path, relative_path: &str) -> AppResult<PathBuf> {
    let reject = || {
        AppError::ValidationFailed(format!(
            "'{}' is not a path inside this layer",
            relative_path
        ))
    };

    let mut target = layer_dir.to_path_buf();
    let mut depth = 0usize;
    for segment in relative_path.split('/').filter(|s| !s.is_empty()) {
        let mut parts = Path::new(segment).components();
        match (parts.next(), parts.next()) {
            (Some(Component::Normal(name)), None) => target.push(name),
            _ => return Err(reject()),
        }
        depth += 1;
    }

    // The layer itself is not one of its own entries.
    if depth == 0 {
        return Err(reject());
    }

    let parent = target.parent().ok_or_else(&reject)?;
    if !fs::canonicalize(parent)?.starts_with(fs::canonicalize(layer_dir)?) {
        return Err(reject());
    }

    Ok(target)
}

/// Remove the directories a delete just emptied, up to the layer root.
///
/// A listing is built from files, so a directory holding none has no row and no
/// size. Leaving one behind means the layer keeps offering an archive the tree
/// shows as gone. `remove_dir` refuses a directory that still holds anything,
/// which is both the stop condition and the reason this cannot overreach.
fn prune_empty_parents(layer_dir: &Path, deleted: &Path) {
    let mut cursor = deleted.parent();
    while let Some(dir) = cursor {
        if dir == layer_dir || fs::remove_dir(dir).is_err() {
            return;
        }
        cursor = dir.parent();
    }
}

impl ProjectDir {
    /// Add files or directories (`.wad`, `.wad.client`, `.wad.mobile`) into a layer's content
    /// directory.
    ///
    /// Packed WAD files are extracted into a same-named directory, with chunk
    /// paths named from the shared mimir hashtables and anything they do not
    /// know left under its hex name. Directory sources are copied as-is. If
    /// any source conflicts with an existing entry, no source is imported.
    pub fn add_files_to_layer(
        &self,
        layer_name: &str,
        sources: Vec<PathBuf>,
        resolver: &WadPathResolver,
    ) -> AppResult<AddFilesReport> {
        let layer_dir = self.layer_content_path(layer_name)?;

        let mut canonical_seen = std::collections::HashSet::<PathBuf>::new();
        let mut prepared: Vec<(PathBuf, String)> = Vec::with_capacity(sources.len());

        for src in sources {
            if !src.exists() {
                return Err(AppError::ValidationFailed(format!(
                    "Source does not exist: {}",
                    src.display()
                )));
            }

            let canonical = fs::canonicalize(&src).unwrap_or_else(|_| src.clone());
            if !canonical_seen.insert(canonical.clone()) {
                continue;
            }

            let basename = canonical
                .file_name()
                .and_then(|s| s.to_str())
                .ok_or_else(|| {
                    AppError::ValidationFailed(format!(
                        "Source has no usable file name: {}",
                        src.display()
                    ))
                })?
                .to_string();

            if !is_wad_entry(&basename) {
                return Err(AppError::ValidationFailed(format!(
                    "'{}' is not a WAD file or folder (must end in .wad, .wad.client, or .wad.mobile)",
                    basename
                )));
            }

            prepared.push((canonical, basename));
        }

        let conflicts: Vec<String> = prepared
            .iter()
            .filter(|(_, name)| layer_dir.join(name).exists())
            .map(|(_, name)| name.clone())
            .collect();
        if !conflicts.is_empty() {
            return Err(WorkshopError::LayerFileConflict { conflicts }.into());
        }

        let mut added: Vec<String> = Vec::with_capacity(prepared.len());
        for (src, basename) in prepared {
            let dest = layer_dir.join(&basename);
            let temp = layer_dir.join(format!(".{}.tmp", basename));

            if temp.exists() {
                if temp.is_dir() {
                    let _ = fs::remove_dir_all(&temp);
                } else {
                    let _ = fs::remove_file(&temp);
                }
            }

            let was_packed = src.is_file();
            let result = if was_packed {
                extract_wad_into_dir(&src, &temp, resolver)
            } else {
                copy_dir_recursive(&src, &temp)
            };

            if let Err(e) = result {
                let _ = fs::remove_dir_all(&temp);
                return Err(e);
            }

            if let Err(e) = fs::rename(&temp, &dest) {
                let _ = fs::remove_dir_all(&temp);
                return Err(AppError::Io(e));
            }

            tracing::info!(
                layer = %layer_name,
                file = %basename,
                extracted = was_packed,
                "Added WAD entry to layer"
            );
            added.push(basename);
        }

        Ok(AddFilesReport { added })
    }

    /// Delete one file or directory from a layer's content directory.
    ///
    /// `relative_path` addresses it from the layer root, the way the content
    /// listing names its entries, and a directory goes with everything below
    /// it. The entry itself is removed without being followed, so a symlink
    /// costs the link rather than what it points at.
    pub fn delete_layer_content(&self, layer_name: &str, relative_path: &str) -> AppResult<()> {
        let layer_dir = self.layer_content_path(layer_name)?;
        let target = resolve_in_layer(&layer_dir, relative_path)?;

        let metadata = fs::symlink_metadata(&target).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::ValidationFailed(format!(
                    "'{}' is no longer in this layer",
                    relative_path
                ))
            } else {
                AppError::Io(e)
            }
        })?;

        let is_dir = metadata.is_dir();
        if is_dir {
            fs::remove_dir_all(&target)?;
        } else {
            fs::remove_file(&target)?;
        }
        prune_empty_parents(&layer_dir, &target);

        tracing::info!(
            layer = %layer_name,
            path = %relative_path,
            directory = is_dir,
            "Deleted layer content"
        );

        Ok(())
    }

    /// Collect runtime info about each layer's content directory.
    pub fn layer_info(
        &self,
        layer_names: &[String],
    ) -> AppResult<HashMap<String, WorkshopLayerInfo>> {
        let content_dir = self.path().join("content");
        let mut result = HashMap::new();

        for name in layer_names {
            let layer_dir = content_dir.join(name);
            let wad_files = if layer_dir.is_dir() {
                fs::read_dir(&layer_dir)
                    .map(|entries| {
                        entries
                            .filter_map(|e| e.ok())
                            .filter_map(|e| {
                                let file_name = e.file_name().to_string_lossy().to_string();
                                if is_wad_entry(&file_name) {
                                    Some(file_name)
                                } else {
                                    None
                                }
                            })
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default()
            } else {
                Vec::new()
            };
            result.insert(name.clone(), WorkshopLayerInfo { wad_files });
        }

        Ok(result)
    }
}

impl Workshop {
    /// Get runtime info for each layer in a project.
    pub fn get_layer_info(
        &self,
        project_path: &str,
        layer_names: Vec<String>,
    ) -> AppResult<HashMap<String, WorkshopLayerInfo>> {
        self.project(project_path)?.layer_info(&layer_names)
    }

    /// Get the absolute path to a layer's content directory.
    pub fn get_layer_content_path(
        &self,
        project_path: &str,
        layer_name: &str,
    ) -> AppResult<String> {
        let layer_dir = self.project(project_path)?.layer_content_path(layer_name)?;
        Ok(layer_dir.display().to_string())
    }

    /// Save string overrides for a specific layer in a workshop project.
    pub fn save_layer_string_overrides(
        &self,
        project_path: &str,
        layer_name: &str,
        string_overrides: IndexMap<String, IndexMap<String, String>>,
    ) -> AppResult<WorkshopProject> {
        self.project(project_path)?
            .save_layer_string_overrides(layer_name, string_overrides)
    }

    /// Create a new layer in a workshop project.
    pub fn create_layer(
        &self,
        project_path: &str,
        name: &str,
        display_name: Option<String>,
        description: Option<String>,
    ) -> AppResult<WorkshopProject> {
        self.project(project_path)?
            .create_layer(name, display_name, description)
    }

    /// Rename a layer in a workshop project.
    pub fn rename_layer(
        &self,
        project_path: &str,
        layer_name: &str,
        new_display_name: &str,
    ) -> AppResult<WorkshopProject> {
        self.project(project_path)?
            .rename_layer(layer_name, new_display_name)
    }

    /// Delete a layer from a workshop project.
    pub fn delete_layer(&self, project_path: &str, layer_name: &str) -> AppResult<WorkshopProject> {
        self.project(project_path)?.delete_layer(layer_name)
    }

    /// Update a layer's description in a workshop project.
    pub fn update_layer_description(
        &self,
        project_path: &str,
        layer_name: &str,
        description: Option<String>,
    ) -> AppResult<WorkshopProject> {
        self.project(project_path)?
            .update_layer_description(layer_name, description)
    }

    /// Reorder layers in a workshop project by reassigning priorities.
    pub fn reorder_layers(
        &self,
        project_path: &str,
        layer_names: Vec<String>,
    ) -> AppResult<WorkshopProject> {
        self.project(project_path)?.reorder_layers(layer_names)
    }

    /// Add files or folders to a layer's content directory.
    pub fn add_files_to_layer(
        &self,
        project_path: &str,
        layer_name: &str,
        sources: Vec<String>,
        resolver: &WadPathResolver,
    ) -> AppResult<AddFilesReport> {
        let source_paths = sources.into_iter().map(PathBuf::from).collect();
        self.project(project_path)?
            .add_files_to_layer(layer_name, source_paths, resolver)
    }

    /// Delete one file or directory from a layer's content directory.
    pub fn delete_layer_content(
        &self,
        project_path: &str,
        layer_name: &str,
        relative_path: &str,
    ) -> AppResult<()> {
        self.project(project_path)?
            .delete_layer_content(layer_name, relative_path)
    }
}

#[cfg(test)]
mod tests;
