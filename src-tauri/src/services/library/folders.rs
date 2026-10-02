use crate::error::IpcResult;
use crate::mods::LibraryFolder;
use crate::services::shared::Library;

#[tauri::command]
#[specta::specta]
pub fn get_folders(library: Library) -> IpcResult<Vec<LibraryFolder>> {
    library.with(|library, config| library.get_folders(config))
}

#[tauri::command]
#[specta::specta]
pub fn get_folder_order(library: Library) -> IpcResult<Vec<String>> {
    library.with(|library, config| library.get_folder_order(config))
}

#[tauri::command]
#[specta::specta]
pub fn create_folder(name: String, library: Library) -> IpcResult<LibraryFolder> {
    library.with(|library, config| library.create_folder(config, &name))
}

#[tauri::command]
#[specta::specta]
pub fn rename_folder(folder_id: String, new_name: String, library: Library) -> IpcResult<()> {
    library.with(|library, config| library.rename_folder(config, &folder_id, &new_name))
}

#[tauri::command]
#[specta::specta]
pub fn delete_folder(folder_id: String, library: Library) -> IpcResult<()> {
    library.with_refresh(|library, config| library.delete_folder(config, &folder_id))
}

#[tauri::command]
#[specta::specta]
pub fn move_mod_to_folder(mod_id: String, folder_id: String, library: Library) -> IpcResult<()> {
    library.with_refresh(|library, config| library.move_mod_to_folder(config, &mod_id, &folder_id))
}

#[tauri::command]
#[specta::specta]
pub fn toggle_folder(folder_id: String, enabled: bool, library: Library) -> IpcResult<()> {
    library.with_refresh(|library, config| library.toggle_folder(config, &folder_id, enabled))
}

#[tauri::command]
#[specta::specta]
pub fn reorder_folder_mods(
    folder_id: String,
    mod_ids: Vec<String>,
    library: Library,
) -> IpcResult<()> {
    library.with_refresh(|library, config| library.reorder_folder_mods(config, &folder_id, mod_ids))
}

#[tauri::command]
#[specta::specta]
pub fn reorder_folders(folder_order: Vec<String>, library: Library) -> IpcResult<()> {
    library.with_refresh(|library, config| library.reorder_folders(config, folder_order))
}
