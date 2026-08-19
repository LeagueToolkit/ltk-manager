//! Hashtable cache commands: status and sync.

use crate::error::{AppError, AppResult, IpcResult};
use crate::events::TauriEventSink;
use ltk_manager_core::hashtables::{HashtableCache, HashtableCacheStatus, HashtableSyncReport};
use tauri::AppHandle;

/// User agent sent with hashtable release downloads.
const SYNC_USER_AGENT: &str = concat!("ltk-manager/", env!("CARGO_PKG_VERSION"));

/// Report what the shared hashtable cache currently holds.
///
/// A cache that was never synced is a normal report, not an error.
#[tauri::command]
pub async fn get_hashtable_cache_status() -> IpcResult<HashtableCacheStatus> {
    tauri::async_runtime::spawn_blocking(|| -> AppResult<HashtableCacheStatus> {
        Ok(HashtableCache::discover()?.status()?)
    })
    .await
    .unwrap_or_else(|e| Err(AppError::Other(e.to_string())))
    .into()
}

/// Download the latest published hashtables into the shared cache.
///
/// Emits `hashtable-sync-progress` once per asset download. `force`
/// re-downloads every table even when the local copy already matches.
#[tauri::command]
pub async fn sync_hashtables(force: bool, app: AppHandle) -> IpcResult<HashtableSyncReport> {
    tauri::async_runtime::spawn_blocking(move || -> AppResult<HashtableSyncReport> {
        let events = TauriEventSink::new(app);
        Ok(HashtableCache::discover()?.sync(force, SYNC_USER_AGENT, &events)?)
    })
    .await
    .unwrap_or_else(|e| Err(AppError::Other(e.to_string())))
    .into()
}
