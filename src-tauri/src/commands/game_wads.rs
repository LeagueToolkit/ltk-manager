//! Read-only browsing of the game's WAD archives.

use crate::error::{AppError, AppResult, IpcResult};
use crate::state::SettingsState;
use ltk_manager_core::game_wads::{GameArchives, GameWadEntry, GameWadSummary};
use ltk_manager_core::hashtables::HashtableCache;
use tauri::{AppHandle, Manager};

/// List the game's WAD archives under `DATA/FINAL`, sorted by name.
#[tauri::command]
pub async fn get_game_wads(app_handle: AppHandle) -> IpcResult<Vec<GameWadSummary>> {
    let config = match app_handle.state::<SettingsState>().config() {
        Ok(config) => config,
        Err(e) => return IpcResult::from(Err::<Vec<GameWadSummary>, _>(e)),
    };
    tauri::async_runtime::spawn_blocking(move || GameArchives::resolve(&config)?.list())
        .await
        .unwrap_or_else(|e| Err(AppError::Other(e.to_string())))
        .into()
}

/// Read the chunk list of one game WAD archive.
///
/// Path hashes resolve through the shared hashtable cache when it is
/// populated. Otherwise every path comes back null.
#[tauri::command]
pub async fn read_game_wad(
    wad_name: String,
    app_handle: AppHandle,
) -> IpcResult<Vec<GameWadEntry>> {
    let config = match app_handle.state::<SettingsState>().config() {
        Ok(config) => config,
        Err(e) => return IpcResult::from(Err::<Vec<GameWadEntry>, _>(e)),
    };
    tauri::async_runtime::spawn_blocking(move || -> AppResult<Vec<GameWadEntry>> {
        let archives = GameArchives::resolve(&config)?;
        let resolver = match HashtableCache::discover() {
            Ok(cache) => cache.wad_tables(),
            Err(e) => {
                tracing::debug!("Hashtable cache unavailable, chunk paths unresolved: {e}");
                Default::default()
            }
        };
        archives.read(&wad_name, &resolver)
    })
    .await
    .unwrap_or_else(|e| Err(AppError::Other(e.to_string())))
    .into()
}
