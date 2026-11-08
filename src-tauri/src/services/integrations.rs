//! The integrations service: installing, changing and removing the external tools the settings
//! offer, and the mod file types Explorer opens with the app.

use ltk_manager_runtime::integrations::file_types::{self, FileTypeStatus};
use ltk_manager_runtime::integrations::{
    self, IntegrationAction, IntegrationError, IntegrationRelease, IntegrationStatus, Integrations,
    MenuConflictPolicy, Tool,
};
use tauri::{AppHandle, Manager};

use crate::error::IpcResult;
use crate::services::shared::integration;

/// Where the installer puts the `.ico` files, under the resource directory.
const FILE_ICONS: &str = "file-icons";

/// Local executable and Explorer state for each tool.
#[tauri::command]
#[specta::specta]
pub async fn integration_status() -> IpcResult<Vec<IntegrationStatus>> {
    integration(|| Integrations::discover()?.status()).await
}

/// Latest stable release available for a tool.
#[tauri::command]
#[specta::specta]
pub async fn integration_release(tool: Tool) -> IpcResult<IntegrationRelease> {
    integration(move || Integrations::discover()?.check_release(tool)).await
}

/// Apply an explicit installation or context-menu change.
#[tauri::command]
#[specta::specta]
pub async fn change_integration(
    tool: Tool,
    action: IntegrationAction,
    conflicts: MenuConflictPolicy,
) -> IpcResult<()> {
    integration(move || Integrations::discover()?.change(tool, action, conflicts)).await
}

/// Cancel a matching download before registration begins.
#[tauri::command]
#[specta::specta]
pub fn cancel_integration_download(operation_id: String) -> IpcResult<()> {
    integrations::cancel_download(&operation_id);
    IpcResult::ok(())
}

/// Which program Explorer opens each mod file type with.
#[tauri::command]
#[specta::specta]
pub async fn file_type_status() -> IpcResult<Vec<FileTypeStatus>> {
    integration(|| Ok(file_types::status(&std::env::current_exe()?))).await
}

/// Open the app's page in Windows' Default apps settings.
#[tauri::command]
#[specta::specta]
pub async fn open_default_apps() -> IpcResult<()> {
    integration(file_types::open_default_apps).await
}

/// Register or remove the mod file types to match `enabled`, logging a failure.
///
/// A debug build changes nothing, so it never takes the types from the installed app.
pub(crate) fn apply_file_types(app_handle: &AppHandle, enabled: bool) {
    if cfg!(debug_assertions) || !cfg!(windows) {
        return;
    }

    let result = (|| {
        let executable = std::env::current_exe()?;
        if !enabled {
            return file_types::unregister(&executable);
        }

        let resources =
            app_handle
                .path()
                .resource_dir()
                .map_err(|error| IntegrationError::Operation {
                    detail: error.to_string(),
                })?;
        file_types::register(&executable, &resources.join(FILE_ICONS))
    })();

    if let Err(error) = result {
        tracing::warn!(%error, enabled, "Could not apply the mod file types");
    }
}

/// The integrations service's row of `services/table.rs`.
pub struct Table;

/// The plugin answering the integration commands.
pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    super::plugin::<Table>().build()
}
