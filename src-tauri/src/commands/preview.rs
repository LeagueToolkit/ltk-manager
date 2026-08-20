//! Reading what a previewable asset holds.
//!
//! The pixels do not come this way. They come over the `ltk-asset` protocol, so
//! that an `<img>` can draw them. What an `<img>` cannot report is the
//! container, the block format and the mipmap count, which is what this reads.

use crate::error::{AppError, IpcResult};
use crate::state::SettingsState;
use ltk_manager_core::game_wads::WadCache;
use ltk_manager_core::preview::{AssetInfo, AssetRef};
use tauri::{AppHandle, Manager};

/// Report what a previewable asset holds, without decoding it.
///
/// A file kind with no viewer comes back as [`AssetInfo::Unsupported`] rather
/// than an error, because a modder clicking through a tree meets one constantly
/// and the viewer draws it as a state.
#[tauri::command]
pub async fn read_asset_info(asset: AssetRef, app_handle: AppHandle) -> IpcResult<AssetInfo> {
    let config = match app_handle.state::<SettingsState>().config() {
        Ok(config) => config,
        Err(e) => return IpcResult::from(Err::<AssetInfo, _>(e)),
    };

    tauri::async_runtime::spawn_blocking(move || {
        asset.info(&config, &app_handle.state::<WadCache>())
    })
    .await
    .unwrap_or_else(|e| Err(AppError::Other(e.to_string())))
    .into()
}
