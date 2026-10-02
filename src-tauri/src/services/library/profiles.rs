use crate::error::{AppError, IpcResult};
use crate::mods::{ModLibraryState, Profile};
use crate::patcher::PatcherState;
use crate::services::shared::Library;
use crate::state::SettingsState;
use tauri::State;

/// Get all profiles.
#[tauri::command]
#[specta::specta]
pub fn list_mod_profiles(library: Library) -> IpcResult<Vec<Profile>> {
    library.with(|library, config| library.get_profiles(config))
}

/// Get the currently active profile.
#[tauri::command]
#[specta::specta]
pub fn get_active_mod_profile(library: Library) -> IpcResult<Profile> {
    library.with(|library, config| library.get_active_profile_info(config))
}

/// Create a new profile with the given name.
#[tauri::command]
#[specta::specta]
pub fn create_mod_profile(name: String, library: Library) -> IpcResult<Profile> {
    library.with(|library, config| library.create_profile(config, name))
}

/// Delete a profile by ID.
#[tauri::command]
#[specta::specta]
pub fn delete_mod_profile(profile_id: String, library: Library) -> IpcResult<()> {
    library.with(|library, config| library.delete_profile(config, profile_id))
}

/// Switch to a different profile.
#[tauri::command]
#[specta::specta]
pub fn switch_mod_profile(profile_id: String, library: Library) -> IpcResult<Profile> {
    library.with_refresh(|library, config| library.switch_profile(config, profile_id))
}

/// Rename a profile.
/// Returns an error if the patcher is currently running (rename touches the filesystem).
#[tauri::command]
#[specta::specta]
pub fn rename_mod_profile(
    profile_id: String,
    new_name: String,
    library: State<ModLibraryState>,
    settings: State<SettingsState>,
    patcher_state: State<PatcherState>,
) -> IpcResult<Profile> {
    if patcher_state.is_running() {
        return IpcResult::err(AppError::Other(
            "Cannot rename profiles while patcher is running. Please stop the patcher first."
                .to_string(),
        ));
    }

    let config = settings.config();
    library
        .0
        .rename_profile(&config, profile_id, new_name)
        .into()
}
