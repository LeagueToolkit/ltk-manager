use super::{
    is_valid_project_name, load_workshop_project, AddFilesReport, Workshop, WorkshopError,
    WorkshopLayerInfo, WorkshopProject,
};
use crate::error::{AppError, AppResult};
use camino::Utf8Path;
use ltk_mod_project::ModProject;
use ltk_mod_project::ModProjectLayer;
use ltk_wad::{HexPathResolver, Wad, WadExtractor};
use std::collections::HashMap;
use std::fs;
use std::io::BufReader;
use std::path::{Path, PathBuf};

/// Create a new layer in a project at the given path.
pub(crate) fn create_layer_at_path(
    path: &Path,
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

    let mut mod_project = ModProject::load(path)?;

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
        string_overrides: HashMap::new(),
    });

    let json_config_path = path.join("mod.config.json");
    let config_content = serde_json::to_string_pretty(&mod_project)?;
    fs::write(&json_config_path, config_content)?;

    let layer_content_dir = path.join("content").join(&name);
    fs::create_dir_all(&layer_content_dir)?;

    load_workshop_project(path)
}

/// Delete a layer from a project at the given path.
pub(crate) fn delete_layer_at_path(path: &Path, layer_name: &str) -> AppResult<WorkshopProject> {
    if layer_name == "base" {
        return Err(AppError::ValidationFailed(
            "Cannot delete the base layer".to_string(),
        ));
    }

    let mut mod_project = ModProject::load(path)?;

    let layer_index = mod_project
        .layers
        .iter()
        .position(|l| l.name == layer_name)
        .ok_or_else(|| {
            AppError::ValidationFailed(format!("Layer '{}' not found in project", layer_name))
        })?;

    mod_project.layers.remove(layer_index);

    let json_config_path = path.join("mod.config.json");
    let config_content = serde_json::to_string_pretty(&mod_project)?;
    fs::write(&json_config_path, config_content)?;

    let layer_content_dir = path.join("content").join(layer_name);
    if layer_content_dir.exists() {
        let _ = fs::remove_dir_all(&layer_content_dir);
    }

    load_workshop_project(path)
}

/// Update a layer's description in a project at the given path.
pub(crate) fn update_layer_description_at_path(
    path: &Path,
    layer_name: &str,
    description: Option<String>,
) -> AppResult<WorkshopProject> {
    let mut mod_project = ModProject::load(path)?;

    let layer = mod_project
        .layers
        .iter_mut()
        .find(|l| l.name == layer_name)
        .ok_or_else(|| {
            AppError::ValidationFailed(format!("Layer '{}' not found in project", layer_name))
        })?;

    layer.description = description;

    let json_config_path = path.join("mod.config.json");
    let config_content = serde_json::to_string_pretty(&mod_project)?;
    fs::write(&json_config_path, config_content)?;

    load_workshop_project(path)
}

/// Rename a layer in a project at the given path.
///
/// Updates the display name and derives a new slug from it.
/// Also renames the layer's content directory.
pub(crate) fn rename_layer_at_path(
    path: &Path,
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

    let mut mod_project = ModProject::load(path)?;

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
        let old_dir = path.join("content").join(layer_name);
        let new_dir = path.join("content").join(&new_name);
        if old_dir.exists() {
            fs::rename(&old_dir, &new_dir)?;
        }
    }

    let json_config_path = path.join("mod.config.json");
    let config_content = serde_json::to_string_pretty(&mod_project)?;
    fs::write(&json_config_path, config_content)?;

    load_workshop_project(path)
}

/// Reorder layers in a project at the given path by reassigning priorities.
pub(crate) fn reorder_layers_at_path(
    path: &Path,
    layer_names: Vec<String>,
) -> AppResult<WorkshopProject> {
    let mut mod_project = ModProject::load(path)?;

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

    let json_config_path = path.join("mod.config.json");
    let config_content = serde_json::to_string_pretty(&mod_project)?;
    fs::write(&json_config_path, config_content)?;

    load_workshop_project(path)
}

/// Save string overrides for a specific layer in a project at the given path.
pub(crate) fn save_layer_string_overrides_at_path(
    path: &Path,
    layer_name: &str,
    string_overrides: HashMap<String, HashMap<String, String>>,
) -> AppResult<WorkshopProject> {
    let mut mod_project = ModProject::load(path)?;

    let layer = mod_project
        .layers
        .iter_mut()
        .find(|l| l.name == layer_name)
        .ok_or_else(|| {
            AppError::ValidationFailed(format!("Layer '{}' not found in project", layer_name))
        })?;

    layer.string_overrides = string_overrides;

    let json_config_path = path.join("mod.config.json");
    let config_content = serde_json::to_string_pretty(&mod_project)?;
    fs::write(&json_config_path, config_content)?;

    load_workshop_project(path)
}

/// Get the absolute path to a layer's content directory, creating it if needed.
pub(crate) fn get_layer_content_path(path: &Path, layer_name: &str) -> AppResult<PathBuf> {
    let layer_dir = path.join("content").join(layer_name);
    if !layer_dir.exists() {
        fs::create_dir_all(&layer_dir)?;
    }
    Ok(layer_dir)
}

fn is_wad_entry(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".wad.client") || lower.ends_with(".wad") || lower.ends_with(".wad.mobile")
}

/// Extract a packed WAD file into `dst` using hex-named paths (no hashtable).
fn extract_wad_into_dir(src: &Path, dst: &Path) -> AppResult<()> {
    fs::create_dir_all(dst)?;

    let file = fs::File::open(src)?;
    let mut wad = Wad::mount(BufReader::new(file))?;

    let resolver = HexPathResolver;
    let extractor = WadExtractor::new(&resolver);
    let utf8_dst = Utf8Path::from_path(dst).ok_or_else(|| {
        AppError::Other(format!(
            "WAD output path is not valid UTF-8: {}",
            dst.display()
        ))
    })?;
    extractor.extract_all(&mut wad, utf8_dst)?;
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

/// Add files or directories (`.wad`, `.wad.client`, `.wad.mobile`) into a layer's content
/// directory. Packed WAD files are extracted into a same-named directory using hex-named
/// paths (no hashtable); directory sources are copied as-is. If any source conflicts with
/// an existing entry, no source is imported.
pub(crate) fn add_files_to_layer_at_path(
    project_path: &Path,
    layer_name: &str,
    sources: Vec<PathBuf>,
) -> AppResult<AddFilesReport> {
    let layer_dir = get_layer_content_path(project_path, layer_name)?;

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
            extract_wad_into_dir(&src, &temp)
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

/// Collect runtime info about each layer's content directory.
pub(crate) fn get_layer_info_at_path(
    path: &Path,
    layer_names: &[String],
) -> AppResult<HashMap<String, WorkshopLayerInfo>> {
    let content_dir = path.join("content");
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

impl Workshop {
    /// Get runtime info for each layer in a project.
    pub fn get_layer_info(
        &self,
        project_path: &str,
        layer_names: Vec<String>,
    ) -> AppResult<HashMap<String, WorkshopLayerInfo>> {
        let path = PathBuf::from(project_path);
        if !path.exists() {
            return Err(AppError::ProjectNotFound(project_path.to_string()));
        }
        get_layer_info_at_path(&path, &layer_names)
    }

    /// Get the absolute path to a layer's content directory.
    pub fn get_layer_content_path(
        &self,
        project_path: &str,
        layer_name: &str,
    ) -> AppResult<String> {
        let path = PathBuf::from(project_path);
        if !path.exists() {
            return Err(AppError::ProjectNotFound(project_path.to_string()));
        }
        let layer_dir = get_layer_content_path(&path, layer_name)?;
        Ok(layer_dir.display().to_string())
    }

    /// Save string overrides for a specific layer in a workshop project.
    pub fn save_layer_string_overrides(
        &self,
        project_path: &str,
        layer_name: &str,
        string_overrides: HashMap<String, HashMap<String, String>>,
    ) -> AppResult<WorkshopProject> {
        let path = PathBuf::from(project_path);
        if !path.exists() {
            return Err(AppError::ProjectNotFound(project_path.to_string()));
        }
        save_layer_string_overrides_at_path(&path, layer_name, string_overrides)
    }

    /// Create a new layer in a workshop project.
    pub fn create_layer(
        &self,
        project_path: &str,
        name: &str,
        display_name: Option<String>,
        description: Option<String>,
    ) -> AppResult<WorkshopProject> {
        let path = PathBuf::from(project_path);
        if !path.exists() {
            return Err(AppError::ProjectNotFound(project_path.to_string()));
        }
        create_layer_at_path(&path, name, display_name, description)
    }

    /// Rename a layer in a workshop project.
    pub fn rename_layer(
        &self,
        project_path: &str,
        layer_name: &str,
        new_display_name: &str,
    ) -> AppResult<WorkshopProject> {
        let path = PathBuf::from(project_path);
        if !path.exists() {
            return Err(AppError::ProjectNotFound(project_path.to_string()));
        }
        rename_layer_at_path(&path, layer_name, new_display_name)
    }

    /// Delete a layer from a workshop project.
    pub fn delete_layer(&self, project_path: &str, layer_name: &str) -> AppResult<WorkshopProject> {
        let path = PathBuf::from(project_path);
        if !path.exists() {
            return Err(AppError::ProjectNotFound(project_path.to_string()));
        }
        delete_layer_at_path(&path, layer_name)
    }

    /// Update a layer's description in a workshop project.
    pub fn update_layer_description(
        &self,
        project_path: &str,
        layer_name: &str,
        description: Option<String>,
    ) -> AppResult<WorkshopProject> {
        let path = PathBuf::from(project_path);
        if !path.exists() {
            return Err(AppError::ProjectNotFound(project_path.to_string()));
        }
        update_layer_description_at_path(&path, layer_name, description)
    }

    /// Reorder layers in a workshop project by reassigning priorities.
    pub fn reorder_layers(
        &self,
        project_path: &str,
        layer_names: Vec<String>,
    ) -> AppResult<WorkshopProject> {
        let path = PathBuf::from(project_path);
        if !path.exists() {
            return Err(AppError::ProjectNotFound(project_path.to_string()));
        }
        reorder_layers_at_path(&path, layer_names)
    }

    /// Add files or folders to a layer's content directory.
    pub fn add_files_to_layer(
        &self,
        project_path: &str,
        layer_name: &str,
        sources: Vec<String>,
    ) -> AppResult<AddFilesReport> {
        let path = PathBuf::from(project_path);
        if !path.exists() {
            return Err(AppError::ProjectNotFound(project_path.to_string()));
        }
        let source_paths = sources.into_iter().map(PathBuf::from).collect();
        add_files_to_layer_at_path(&path, layer_name, source_paths)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;
    use std::collections::HashMap;

    fn make_project_with_layers(dir: &std::path::Path, layers: Vec<ModProjectLayer>) {
        let mod_project = ltk_mod_project::ModProject {
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
            layers,
            thumbnail: None,
        };
        fs::write(
            dir.join("mod.config.json"),
            serde_json::to_string_pretty(&mod_project).unwrap(),
        )
        .unwrap();
    }

    fn load_layers(dir: &std::path::Path) -> Vec<ModProjectLayer> {
        ModProject::load(dir).unwrap().layers
    }

    #[test]
    fn create_layer_adds_to_config() {
        let dir = tempfile::tempdir().unwrap();
        make_project_with_layers(dir.path(), ltk_mod_project::default_layers());

        let project = create_layer_at_path(dir.path(), "chroma", None, None).unwrap();

        assert_eq!(project.layers.len(), 2);
        assert_eq!(project.layers[1].name, "chroma");
        assert_eq!(project.layers[1].priority, 1);

        let layers = load_layers(dir.path());
        assert_eq!(layers.len(), 2);
        assert_eq!(layers[1].name, "chroma");

        let chroma_content_dir = dir.path().join("content").join("chroma");
        assert!(chroma_content_dir.exists());
    }

    #[test]
    fn create_layer_invalid_name_rejected() {
        let dir = tempfile::tempdir().unwrap();
        make_project_with_layers(dir.path(), ltk_mod_project::default_layers());

        assert!(matches!(
            create_layer_at_path(dir.path(), "Bad Name", None, None),
            Err(AppError::ValidationFailed(_))
        ));
        assert!(matches!(
            create_layer_at_path(dir.path(), "UPPER", None, None),
            Err(AppError::ValidationFailed(_))
        ));
    }

    #[test]
    fn create_layer_duplicate_name_detected() {
        let dir = tempfile::tempdir().unwrap();
        make_project_with_layers(dir.path(), ltk_mod_project::default_layers());

        assert!(matches!(
            create_layer_at_path(dir.path(), "base", None, None),
            Err(AppError::ValidationFailed(msg)) if msg.contains("already exists")
        ));
    }

    #[test]
    fn delete_base_layer_rejected() {
        let dir = tempfile::tempdir().unwrap();
        make_project_with_layers(dir.path(), ltk_mod_project::default_layers());

        assert!(matches!(
            delete_layer_at_path(dir.path(), "base"),
            Err(AppError::ValidationFailed(msg)) if msg.contains("base")
        ));
    }

    #[test]
    fn delete_nonexistent_layer_detected() {
        let dir = tempfile::tempdir().unwrap();
        make_project_with_layers(dir.path(), ltk_mod_project::default_layers());

        assert!(matches!(
            delete_layer_at_path(dir.path(), "nonexistent"),
            Err(AppError::ValidationFailed(msg)) if msg.contains("not found")
        ));
    }

    #[test]
    fn delete_layer_removes_from_config() {
        let dir = tempfile::tempdir().unwrap();
        make_project_with_layers(
            dir.path(),
            vec![
                ModProjectLayer::base(),
                ModProjectLayer {
                    name: "chroma".to_string(),
                    display_name: None,
                    priority: 1,
                    description: None,
                    string_overrides: HashMap::new(),
                },
            ],
        );
        fs::create_dir_all(dir.path().join("content").join("chroma")).unwrap();

        let project = delete_layer_at_path(dir.path(), "chroma").unwrap();

        assert_eq!(project.layers.len(), 1);
        assert_eq!(project.layers[0].name, "base");

        let layers = load_layers(dir.path());
        assert_eq!(layers.len(), 1);
        assert_eq!(layers[0].name, "base");
    }

    #[test]
    fn reorder_layers_base_included_rejected() {
        let dir = tempfile::tempdir().unwrap();
        make_project_with_layers(
            dir.path(),
            vec![
                ModProjectLayer::base(),
                ModProjectLayer {
                    name: "chroma".to_string(),
                    display_name: None,
                    priority: 1,
                    description: None,
                    string_overrides: HashMap::new(),
                },
            ],
        );

        let result =
            reorder_layers_at_path(dir.path(), vec!["base".to_string(), "chroma".to_string()]);
        match result {
            Err(AppError::ValidationFailed(msg)) => {
                assert!(
                    msg.to_lowercase().contains("base"),
                    "expected 'base' in message, got: {msg}"
                );
            }
            other => panic!("expected ValidationFailed, got: {:?}", other),
        }
    }

    #[test]
    fn reorder_layers_wrong_set_rejected() {
        let dir = tempfile::tempdir().unwrap();
        make_project_with_layers(
            dir.path(),
            vec![
                ModProjectLayer::base(),
                ModProjectLayer {
                    name: "chroma".to_string(),
                    display_name: None,
                    priority: 1,
                    description: None,
                    string_overrides: HashMap::new(),
                },
                ModProjectLayer {
                    name: "vfx".to_string(),
                    display_name: None,
                    priority: 2,
                    description: None,
                    string_overrides: HashMap::new(),
                },
            ],
        );

        assert!(matches!(
            reorder_layers_at_path(dir.path(), vec!["chroma".to_string(), "wrong".to_string()]),
            Err(AppError::ValidationFailed(_))
        ));
    }

    #[test]
    fn reorder_layers_reassigns_priorities() {
        let dir = tempfile::tempdir().unwrap();
        make_project_with_layers(
            dir.path(),
            vec![
                ModProjectLayer::base(),
                ModProjectLayer {
                    name: "chroma".to_string(),
                    display_name: None,
                    priority: 1,
                    description: None,
                    string_overrides: HashMap::new(),
                },
                ModProjectLayer {
                    name: "vfx".to_string(),
                    display_name: None,
                    priority: 2,
                    description: None,
                    string_overrides: HashMap::new(),
                },
            ],
        );

        let project =
            reorder_layers_at_path(dir.path(), vec!["vfx".to_string(), "chroma".to_string()])
                .unwrap();

        assert_eq!(project.layers[0].name, "base");
        assert_eq!(project.layers[0].priority, 0);
        assert_eq!(project.layers[1].name, "vfx");
        assert_eq!(project.layers[1].priority, 1);
        assert_eq!(project.layers[2].name, "chroma");
        assert_eq!(project.layers[2].priority, 2);

        let layers = load_layers(dir.path());
        assert_eq!(layers[1].name, "vfx");
        assert_eq!(layers[1].priority, 1);
    }

    fn build_test_wad(path: &std::path::Path, chunk_paths: &[&str]) {
        use ltk_wad::{WadBuilder, WadChunkBuilder};
        use std::io::Write;

        let mut builder = WadBuilder::default();
        for chunk_path in chunk_paths {
            builder = builder.with_chunk(WadChunkBuilder::default().with_path(*chunk_path));
        }

        let mut file = fs::File::create(path).unwrap();
        builder
            .build_to_writer(&mut file, |_path_hash, cursor| {
                cursor.write_all(&[0xAA; 64])?;
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn add_files_to_layer_extracts_wad_file() {
        let dir = tempfile::tempdir().unwrap();
        make_project_with_layers(dir.path(), ltk_mod_project::default_layers());

        let src_dir = tempfile::tempdir().unwrap();
        let src_file = src_dir.path().join("Aatrox.wad.client");
        build_test_wad(&src_file, &["assets/test1.bin", "assets/test2.bin"]);

        let report = add_files_to_layer_at_path(dir.path(), "base", vec![src_file]).unwrap();

        assert_eq!(report.added, vec!["Aatrox.wad.client".to_string()]);
        let dest = dir
            .path()
            .join("content")
            .join("base")
            .join("Aatrox.wad.client");
        assert!(
            dest.is_dir(),
            "expected extracted directory at {}",
            dest.display()
        );

        let extracted: Vec<_> = fs::read_dir(&dest)
            .unwrap()
            .filter_map(|e| e.ok())
            .collect();
        assert!(
            !extracted.is_empty(),
            "expected at least one extracted entry under {}",
            dest.display()
        );
    }

    #[test]
    fn add_files_to_layer_copies_directory() {
        let dir = tempfile::tempdir().unwrap();
        make_project_with_layers(dir.path(), ltk_mod_project::default_layers());

        let src_dir = tempfile::tempdir().unwrap();
        let wad_dir = src_dir.path().join("Champion.wad.client");
        fs::create_dir_all(wad_dir.join("nested")).unwrap();
        fs::write(wad_dir.join("meta.json"), "{}").unwrap();
        fs::write(wad_dir.join("nested").join("a.bin"), b"x").unwrap();

        let report = add_files_to_layer_at_path(dir.path(), "base", vec![wad_dir]).unwrap();

        assert_eq!(report.added, vec!["Champion.wad.client".to_string()]);
        let dest = dir
            .path()
            .join("content")
            .join("base")
            .join("Champion.wad.client");
        assert!(dest.is_dir());
        assert!(dest.join("meta.json").is_file());
        assert!(dest.join("nested").join("a.bin").is_file());
    }

    #[test]
    fn add_files_to_layer_rejects_non_wad() {
        let dir = tempfile::tempdir().unwrap();
        make_project_with_layers(dir.path(), ltk_mod_project::default_layers());

        let src_dir = tempfile::tempdir().unwrap();
        let bad = src_dir.path().join("readme.txt");
        fs::write(&bad, b"hi").unwrap();

        let result = add_files_to_layer_at_path(dir.path(), "base", vec![bad]);
        assert!(matches!(result, Err(AppError::ValidationFailed(_))));
    }

    #[test]
    fn add_files_to_layer_aborts_on_conflict() {
        let dir = tempfile::tempdir().unwrap();
        make_project_with_layers(dir.path(), ltk_mod_project::default_layers());

        let layer_dir = dir.path().join("content").join("base");
        fs::create_dir_all(&layer_dir).unwrap();
        fs::write(layer_dir.join("Aatrox.wad.client"), b"existing").unwrap();

        let src_dir = tempfile::tempdir().unwrap();
        let new_a = src_dir.path().join("Aatrox.wad.client");
        let new_b = src_dir.path().join("Sona.wad.client");
        fs::write(&new_a, b"new").unwrap();
        fs::write(&new_b, b"new").unwrap();

        let result = add_files_to_layer_at_path(dir.path(), "base", vec![new_a, new_b]);
        match result {
            Err(AppError::Workshop(WorkshopError::LayerFileConflict { conflicts })) => {
                assert_eq!(conflicts, vec!["Aatrox.wad.client".to_string()]);
            }
            other => panic!("expected LayerFileConflict, got: {:?}", other),
        }

        // Sona.wad.client must not have been copied.
        assert!(!layer_dir.join("Sona.wad.client").exists());
        // Existing file untouched.
        assert_eq!(
            fs::read(layer_dir.join("Aatrox.wad.client")).unwrap(),
            b"existing"
        );
    }

    #[test]
    fn update_layer_description_persists() {
        let dir = tempfile::tempdir().unwrap();
        make_project_with_layers(dir.path(), ltk_mod_project::default_layers());

        let project = update_layer_description_at_path(
            dir.path(),
            "base",
            Some("Updated description".to_string()),
        )
        .unwrap();

        assert_eq!(
            project.layers[0].description.as_deref(),
            Some("Updated description")
        );

        let layers = load_layers(dir.path());
        assert_eq!(
            layers[0].description.as_deref(),
            Some("Updated description")
        );
    }
}
