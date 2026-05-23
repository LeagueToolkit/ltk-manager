use crate::error::{AppResult, IpcResult, MutexResultExt};
use crate::state::SettingsState;
use crate::workshop::{
    AddFilesReport, ContentTree, CreateProjectArgs, FantomePeekResult, ImportFantomeArgs,
    ImportGitRepoArgs, PackProjectArgs, PackResult, SaveProjectConfigArgs, ValidationResult,
    WorkshopLayerInfo, WorkshopProject, WorkshopState,
};
use std::collections::HashMap;
use tauri::State;

#[tauri::command]
pub fn get_workshop_projects(
    workshop: State<WorkshopState>,
    settings: State<SettingsState>,
) -> IpcResult<Vec<WorkshopProject>> {
    let result: AppResult<Vec<WorkshopProject>> = (|| {
        let settings = settings.0.lock().mutex_err()?.clone();
        workshop.0.get_projects(&settings)
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
        let settings = settings.0.lock().mutex_err()?.clone();
        workshop.0.create_project(&settings, args)
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
        let settings = settings.0.lock().mutex_err()?.clone();
        workshop.0.import_from_modpkg(&settings, &file_path)
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
        let settings = settings.0.lock().mutex_err()?.clone();
        workshop.0.import_from_fantome(&settings, args)
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
        let settings = settings.0.lock().mutex_err()?.clone();
        workshop.0.import_from_git_repo(&settings, args)
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
    string_overrides: HashMap<String, HashMap<String, String>>,
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
