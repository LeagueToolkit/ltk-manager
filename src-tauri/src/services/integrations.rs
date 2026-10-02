//! The integrations service: installing, changing and removing the external tools the settings
//! offer.

use ltk_manager_core::integrations::{
    self, IntegrationAction, IntegrationRelease, IntegrationStatus, Integrations,
    MenuConflictPolicy, Tool,
};

use crate::error::IpcResult;
use crate::services::shared::integration;

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

/// The integrations service's row of `services/table.rs`.
pub struct Table;

/// The plugin answering the integration commands.
pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    super::plugin::<Table>().build()
}
