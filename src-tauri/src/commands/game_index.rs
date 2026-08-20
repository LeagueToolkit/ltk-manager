//! Read-only browsing of the game's archives folded into one tree.

use crate::error::{AppError, AppResult, IpcResult};
use crate::state::SettingsState;
use ltk_manager_core::game_index::{GameDirListing, GameIndex, GameIndexState, GameIndexStats};
use ltk_manager_core::game_wads::{GameArchives, WadCache};
use ltk_manager_core::hashtables::HashtableCache;
use tauri::{AppHandle, Manager};

/// Report what the folded game index holds, building it on first use.
#[tauri::command]
pub async fn get_game_index(app_handle: AppHandle) -> IpcResult<GameIndexStats> {
    with_index(app_handle, |index| Ok(index.stats())).await
}

/// List one directory of the folded game index.
///
/// `path` is `""` for the root, and otherwise a path a previous listing
/// returned. Path hashes resolve through the shared hashtable cache when it is
/// populated. Otherwise every file reads as its hash.
#[tauri::command]
pub async fn read_game_dir(path: String, app_handle: AppHandle) -> IpcResult<GameDirListing> {
    with_index(app_handle, move |index| {
        index.read_dir(&path).ok_or_else(|| {
            AppError::InvalidPath(format!("No such directory in the game index: {path}"))
        })
    })
    .await
}

/// Drop the built index, so the next read walks the install again.
///
/// Unmounts the cached archives with it. Asking for a fresh index is the one
/// signal the app gets that the install changed under it, and a mount taken
/// before a patch would keep answering from the chunk table it read then.
#[tauri::command]
pub async fn refresh_game_index(app_handle: AppHandle) -> IpcResult<()> {
    app_handle
        .state::<GameIndexState>()
        .clear()
        .and_then(|()| app_handle.state::<WadCache>().clear())
        .into()
}

/// Run `read` against the index, building it when this is the first call.
///
/// The build walks every archive of the install, so it runs on a blocking
/// thread and the state it lands in keeps it for every reader after this one.
async fn with_index<T, F>(app_handle: AppHandle, read: F) -> IpcResult<T>
where
    T: Send + 'static,
    F: FnOnce(&GameIndex) -> AppResult<T> + Send + 'static,
{
    let config = match app_handle.state::<SettingsState>().config() {
        Ok(config) => config,
        Err(e) => return IpcResult::from(Err::<T, _>(e)),
    };

    tauri::async_runtime::spawn_blocking(move || -> AppResult<T> {
        let archives = GameArchives::resolve(&config)?;
        let index = app_handle
            .state::<GameIndexState>()
            .get_or_build(&archives, || match HashtableCache::discover() {
                Ok(cache) => cache.wad_tables(),
                Err(e) => {
                    tracing::debug!("Hashtable cache unavailable, chunk paths unresolved: {e}");
                    Default::default()
                }
            })?;
        read(&index)
    })
    .await
    .unwrap_or_else(|e| Err(AppError::Other(e.to_string())))
    .into()
}
