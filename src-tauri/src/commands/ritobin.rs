//! Opening an asset as ritobin text, in the VS Code the extension registered.
//!
//! The integration is a Windows Explorer verb, so both commands are a registry
//! read away from answering. See [`ltk_manager_core::ritobin`].

use ltk_manager_core::game_wads::WadCache;
use ltk_manager_core::preview::AssetRef;
use ltk_manager_core::ritobin::RitobinVerb;
use tauri::{AppHandle, Manager};

use crate::error::{AppError, IpcResult};
use crate::state::SettingsState;

/// What to do about a machine where the extension has registered nothing.
const NOT_INSTALLED: &str = "VS Code has registered no ritobin file association. \
     Install the ritobin-lsp extension, then run 'ritobin-lsp: Install Windows Explorer \
     Integration' from its command palette.";

/// Report whether the ritobin VS Code integration is installed.
#[tauri::command]
pub fn detect_ritobin_integration() -> IpcResult<bool> {
    IpcResult::ok(RitobinVerb::installed().is_some())
}

/// Open one asset as ritobin text in VS Code.
///
/// `name` is what a hash table made of a game chunk's hash, which the reference
/// itself cannot carry. It names the copy the chunk is opened from.
#[tauri::command]
pub async fn open_asset_in_ritobin(
    asset: AssetRef,
    name: Option<String>,
    app_handle: AppHandle,
) -> IpcResult<()> {
    let config = match app_handle.state::<SettingsState>().config() {
        Ok(config) => config,
        Err(e) => return IpcResult::from(Err::<(), _>(e)),
    };

    tauri::async_runtime::spawn_blocking(move || {
        let verb =
            RitobinVerb::installed().ok_or_else(|| AppError::Other(NOT_INSTALLED.to_owned()))?;

        verb.open_asset(
            &asset,
            name.as_deref(),
            &config,
            &app_handle.state::<WadCache>(),
        )
    })
    .await
    .unwrap_or_else(|e| Err(AppError::Other(e.to_string())))
    .into()
}
