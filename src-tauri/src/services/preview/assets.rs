//! Reading what a previewable asset holds.
//!
//! The pixels do not come this way. They come over the `ltk-asset` protocol, so
//! that an `<img>` can draw them. What an `<img>` cannot report is the
//! container, the block format and the mipmap count, which is what this reads.

use fs_err as fs;
use std::path::PathBuf;

use crate::error::IpcResult;
use crate::services::shared::off_thread;
use crate::services::shared::read_asset;
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
#[specta::specta]
pub async fn read_asset_info(asset: AssetRef, app_handle: AppHandle) -> IpcResult<AssetInfo> {
    let config = app_handle.state::<SettingsState>().config();

    off_thread(move || asset.info(&config, &app_handle.state::<WadCache>())).await
}

/// Write one previewed asset to a path the user picked.
///
/// The extract of a single file, and not through the extractor: the user named
/// the file in a save dialog, so none of the naming rules apply and there is no
/// archive to walk. One chunk, read and written.
///
/// The archive stays mounted afterwards, because the modder saving a copy of a
/// texture is looking through that archive.
#[tauri::command]
#[specta::specta]
pub async fn save_asset_copy(
    asset: AssetRef,
    destination: String,
    app_handle: AppHandle,
) -> IpcResult<()> {
    off_thread(move || {
        let bytes = read_asset(&app_handle, &asset)?;
        let path = PathBuf::from(&destination);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&path, bytes)?;
        tracing::info!(destination = %destination, "Saved a copy of an asset");
        Ok(())
    })
    .await
}
