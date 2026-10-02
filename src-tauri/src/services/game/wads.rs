//! Read-only browsing of an install's WAD archives.

use crate::error::IpcResult;
use crate::services::shared::off_thread;
use crate::state::SettingsState;
use ltk_manager_core::game_wads::{GameArchives, GameWadEntry, GameWadSummary, WadSource};
use ltk_manager_core::hashtables::WadPathResolverState;
use tauri::{AppHandle, Manager};

/// List the WAD archives of `source`, sorted by name.
#[tauri::command]
#[specta::specta]
pub async fn get_game_wads(
    source: WadSource,
    app_handle: AppHandle,
) -> IpcResult<Vec<GameWadSummary>> {
    let config = app_handle.state::<SettingsState>().config();
    off_thread(move || GameArchives::resolve_source(&config, source)?.list()).await
}

/// Read the chunk list of one WAD archive of `source`.
///
/// Path hashes resolve through the shared hashtable cache when it is
/// populated. Otherwise every path comes back null.
#[tauri::command]
#[specta::specta]
pub async fn read_game_wad(
    wad_name: String,
    source: WadSource,
    app_handle: AppHandle,
) -> IpcResult<Vec<GameWadEntry>> {
    let config = app_handle.state::<SettingsState>().config();
    off_thread(move || {
        let archives = GameArchives::resolve_source(&config, source)?;
        let resolver = app_handle
            .state::<std::sync::Arc<WadPathResolverState>>()
            .get();
        archives.read(&wad_name, resolver.tables())
    })
    .await
}
