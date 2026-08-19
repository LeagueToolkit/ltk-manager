use crate::error::{AppError, AppResult, IpcResult};
use crate::state::SettingsState;
use crate::workshop::{
    AddFilesReport, ContentTree, CreateProjectArgs, FantomePeekResult, ImportFantomeArgs,
    ImportGitRepoArgs, PackProjectArgs, PackResult, SaveProjectConfigArgs, ValidationResult,
    WorkshopLayerInfo, WorkshopProject, WorkshopState,
};
use indexmap::IndexMap;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

#[tauri::command]
pub fn get_workshop_projects(
    workshop: State<WorkshopState>,
    settings: State<SettingsState>,
) -> IpcResult<Vec<WorkshopProject>> {
    let result: AppResult<Vec<WorkshopProject>> = (|| {
        let config = settings.config()?;
        workshop.0.get_projects(&config)
    })();
    result.into()
}

#[tauri::command]
pub fn create_workshop_project(
    args: CreateProjectArgs,
    workshop: State<WorkshopState>,
    settings: State<SettingsState>,
) -> IpcResult<WorkshopProject> {
    let result: AppResult<WorkshopProject> = (|| {
        let config = settings.config()?;
        workshop.0.create_project(&config, args)
    })();
    result.into()
}

#[tauri::command]
pub fn get_workshop_project(
    project_path: String,
    workshop: State<WorkshopState>,
) -> IpcResult<WorkshopProject> {
    workshop.0.get_project(&project_path).into()
}

#[tauri::command]
pub fn get_project_content_tree(
    project_path: String,
    workshop: State<WorkshopState>,
) -> IpcResult<ContentTree> {
    workshop.0.get_project_content_tree(&project_path).into()
}

#[tauri::command]
pub fn save_project_config(
    args: SaveProjectConfigArgs,
    workshop: State<WorkshopState>,
) -> IpcResult<WorkshopProject> {
    workshop.0.save_config(args).into()
}

#[tauri::command]
pub fn rename_workshop_project(
    project_path: String,
    new_name: String,
    workshop: State<WorkshopState>,
) -> IpcResult<WorkshopProject> {
    workshop.0.rename_project(&project_path, &new_name).into()
}

#[tauri::command]
pub fn delete_workshop_project(
    project_path: String,
    workshop: State<WorkshopState>,
) -> IpcResult<()> {
    workshop.0.delete_project(&project_path).into()
}

#[tauri::command]
pub fn pack_workshop_project(
    args: PackProjectArgs,
    workshop: State<WorkshopState>,
) -> IpcResult<PackResult> {
    workshop.0.pack_project(args).into()
}

#[tauri::command]
pub fn import_from_modpkg(
    file_path: String,
    workshop: State<WorkshopState>,
    settings: State<SettingsState>,
) -> IpcResult<WorkshopProject> {
    let result: AppResult<WorkshopProject> = (|| {
        let config = settings.config()?;
        workshop.0.import_from_modpkg(&config, &file_path)
    })();
    result.into()
}

#[tauri::command]
pub fn peek_fantome(
    file_path: String,
    workshop: State<WorkshopState>,
) -> IpcResult<FantomePeekResult> {
    workshop.0.peek_fantome(&file_path).into()
}

#[tauri::command]
pub fn import_from_fantome(
    args: ImportFantomeArgs,
    workshop: State<WorkshopState>,
    settings: State<SettingsState>,
) -> IpcResult<WorkshopProject> {
    let result: AppResult<WorkshopProject> = (|| {
        let config = settings.config()?;
        workshop.0.import_from_fantome(&config, args)
    })();
    result.into()
}

#[tauri::command]
pub fn import_from_git_repo(
    args: ImportGitRepoArgs,
    workshop: State<WorkshopState>,
    settings: State<SettingsState>,
) -> IpcResult<WorkshopProject> {
    let result: AppResult<WorkshopProject> = (|| {
        let config = settings.config()?;
        workshop.0.import_from_git_repo(&config, args)
    })();
    result.into()
}

#[tauri::command]
pub fn validate_project(
    project_path: String,
    workshop: State<WorkshopState>,
) -> IpcResult<ValidationResult> {
    workshop.0.validate_project(&project_path).into()
}

#[tauri::command]
pub fn set_project_thumbnail(
    project_path: String,
    image_path: String,
    workshop: State<WorkshopState>,
) -> IpcResult<WorkshopProject> {
    workshop.0.set_thumbnail(&project_path, &image_path).into()
}

#[tauri::command]
pub fn remove_project_thumbnail(
    project_path: String,
    workshop: State<WorkshopState>,
) -> IpcResult<WorkshopProject> {
    workshop.0.remove_thumbnail(&project_path).into()
}

#[tauri::command]
pub fn get_project_thumbnail(
    thumbnail_path: String,
    workshop: State<WorkshopState>,
) -> IpcResult<String> {
    workshop.0.get_thumbnail(&thumbnail_path).into()
}

#[tauri::command]
pub fn save_layer_string_overrides(
    project_path: String,
    layer_name: String,
    string_overrides: IndexMap<String, IndexMap<String, String>>,
    workshop: State<WorkshopState>,
) -> IpcResult<WorkshopProject> {
    workshop
        .0
        .save_layer_string_overrides(&project_path, &layer_name, string_overrides)
        .into()
}

#[tauri::command]
pub fn create_project_layer(
    project_path: String,
    name: String,
    display_name: Option<String>,
    description: Option<String>,
    workshop: State<WorkshopState>,
) -> IpcResult<WorkshopProject> {
    workshop
        .0
        .create_layer(&project_path, &name, display_name, description)
        .into()
}

#[tauri::command]
pub fn rename_project_layer(
    project_path: String,
    layer_name: String,
    new_display_name: String,
    workshop: State<WorkshopState>,
) -> IpcResult<WorkshopProject> {
    workshop
        .0
        .rename_layer(&project_path, &layer_name, &new_display_name)
        .into()
}

#[tauri::command]
pub fn delete_project_layer(
    project_path: String,
    layer_name: String,
    workshop: State<WorkshopState>,
) -> IpcResult<WorkshopProject> {
    workshop.0.delete_layer(&project_path, &layer_name).into()
}

#[tauri::command]
pub fn update_layer_description(
    project_path: String,
    layer_name: String,
    description: Option<String>,
    workshop: State<WorkshopState>,
) -> IpcResult<WorkshopProject> {
    workshop
        .0
        .update_layer_description(&project_path, &layer_name, description)
        .into()
}

#[tauri::command]
pub fn get_layer_content_path(
    project_path: String,
    layer_name: String,
    workshop: State<WorkshopState>,
) -> IpcResult<String> {
    workshop
        .0
        .get_layer_content_path(&project_path, &layer_name)
        .into()
}

#[tauri::command]
pub fn get_layer_info(
    project_path: String,
    layer_names: Vec<String>,
    workshop: State<WorkshopState>,
) -> IpcResult<HashMap<String, WorkshopLayerInfo>> {
    workshop.0.get_layer_info(&project_path, layer_names).into()
}

#[tauri::command]
pub fn reorder_project_layers(
    project_path: String,
    layer_names: Vec<String>,
    workshop: State<WorkshopState>,
) -> IpcResult<WorkshopProject> {
    workshop.0.reorder_layers(&project_path, layer_names).into()
}

#[tauri::command]
pub fn add_files_to_layer(
    project_path: String,
    layer_name: String,
    sources: Vec<String>,
    workshop: State<WorkshopState>,
) -> IpcResult<AddFilesReport> {
    workshop
        .0
        .add_files_to_layer(&project_path, &layer_name, sources)
        .into()
}

/// Read the frontend-owned editor state at `<project>/.ltk/editor.json`.
///
/// The content is opaque here - the frontend versions and interprets it. A
/// missing file reads as `None`, and only a genuine IO failure is an error.
#[tauri::command]
pub fn get_project_editor_state(project_path: String) -> IpcResult<Option<String>> {
    get_project_editor_state_inner(&project_path).into()
}

fn get_project_editor_state_inner(project_path: &str) -> AppResult<Option<String>> {
    match fs::read_to_string(editor_state_path(project_path)) {
        Ok(content) => Ok(Some(content)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(AppError::Io(e)),
    }
}

/// Write the frontend-owned editor state to `<project>/.ltk/editor.json`.
///
/// Creates `.ltk/` on first write, and lands through a temp file in the same
/// directory so a crash mid-write never leaves a truncated file behind.
#[tauri::command]
pub fn save_project_editor_state(project_path: String, content: String) -> IpcResult<()> {
    save_project_editor_state_inner(&project_path, &content).into()
}

fn save_project_editor_state_inner(project_path: &str, content: &str) -> AppResult<()> {
    let dest = editor_state_path(project_path);
    let dir = dest
        .parent()
        .expect("editor state path always ends in .ltk/editor.json");
    fs::create_dir_all(dir)?;

    let temp = dir.join(".editor.json.tmp");
    fs::write(&temp, content)?;
    if let Err(e) = fs::rename(&temp, &dest) {
        let _ = fs::remove_file(&temp);
        return Err(AppError::Io(e));
    }
    Ok(())
}

fn editor_state_path(project_path: &str) -> PathBuf {
    Path::new(project_path).join(".ltk").join("editor.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_reports_a_missing_file_as_none() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().to_string_lossy();

        assert_eq!(get_project_editor_state_inner(&project).unwrap(), None);
    }

    #[test]
    fn save_creates_the_ltk_directory_and_reads_back() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().to_string_lossy();

        save_project_editor_state_inner(&project, r#"{"version":1}"#).unwrap();

        assert_eq!(
            get_project_editor_state_inner(&project).unwrap().as_deref(),
            Some(r#"{"version":1}"#)
        );
    }

    #[test]
    fn save_replaces_an_existing_file_and_leaves_no_temp() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().to_string_lossy();

        save_project_editor_state_inner(&project, "first").unwrap();
        save_project_editor_state_inner(&project, "second").unwrap();

        assert_eq!(
            get_project_editor_state_inner(&project).unwrap().as_deref(),
            Some("second")
        );
        assert!(!dir.path().join(".ltk").join(".editor.json.tmp").exists());
    }
}
