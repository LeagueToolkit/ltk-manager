//! Hashtable cache commands: status and sync.

use super::off_thread;
use crate::error::IpcResult;
use crate::events::TauriEventSink;
use crate::mods::ModLibraryState;
use crate::state::SettingsState;
use ltk_manager_core::game_index::GameIndexState;
use ltk_manager_core::hashtables::{
    BinHashTablesState, HashtableCache, HashtableCacheStatus, HashtableSyncReport,
    HashtableUpdateCheck, WadPathResolverState,
};
use ltk_manager_core::meta_schema::{
    self,
    cache::{MetaSchemaCache, PublishedDb},
    MetaSchemaVersion,
};
use ltk_manager_core::mods::{HealthSweepState, SweepScope};
use ltk_manager_core::problems::BinNames;
use ltk_manager_core::strings::StringKeyIndexState;
use tauri::{AppHandle, Manager};

/// User agent sent with hashtable release downloads.
const SYNC_USER_AGENT: &str = concat!("ltk-manager/", env!("CARGO_PKG_VERSION"));

/// Report what the shared hashtable cache currently holds.
///
/// A cache that was never synced is a normal report, not an error.
#[tauri::command]
pub async fn get_hashtable_cache_status() -> IpcResult<HashtableCacheStatus> {
    off_thread(|| {
        let tables = HashtableCache::shared()?.status()?;
        Ok(tables.with_schema(meta_schema::shared(None).version()))
    })
    .await
}

/// Report what the latest published release has that the cache does not.
///
/// Reads the remote manifest and nothing else: no download, no install, and no
/// update lock, so this is safe to run unasked and safe while another process
/// is midway through a sync. The meta schema database is asked the same
/// question, and answers for itself.
#[tauri::command]
pub async fn check_hashtable_updates() -> IpcResult<HashtableUpdateCheck> {
    off_thread(|| {
        let tables = HashtableCache::shared()?.check(SYNC_USER_AGENT)?;
        Ok(tables.with_schema(check_meta_schema()))
    })
    .await
}

/// The meta schema database that is published, when it is not the cached one.
///
/// Best-effort, so a publisher that is down costs the card a line rather than
/// its whole answer.
fn check_meta_schema() -> Option<MetaSchemaVersion> {
    let cache = MetaSchemaCache::discover()
        .inspect_err(|e| tracing::debug!("No meta schema cache to check: {e}"))
        .ok()?;
    let fetch = PublishedDb::new(SYNC_USER_AGENT)
        .inspect_err(|e| tracing::warn!("Could not build the meta schema client: {e}"))
        .ok()?;

    cache
        .check(&fetch)
        .inspect_err(|e| tracing::warn!("Could not check the meta schema database: {e}"))
        .ok()
        .flatten()
}

/// Download the latest published hashtables into the shared cache.
///
/// Emits `hashtable-sync-progress` once per asset download. `force`
/// re-downloads every table even when the local copy already matches.
///
/// A run that installed something drops everything read out of the old tables,
/// so the next caller sees the names the new ones give.
#[tauri::command]
pub async fn sync_hashtables(force: bool, app: AppHandle) -> IpcResult<HashtableSyncReport> {
    off_thread(move || {
        let events = TauriEventSink::new(app.clone());
        let tables = HashtableCache::shared()?.sync(force, SYNC_USER_AGENT, &events)?;
        let report = tables.with_schema(sync_meta_schema());

        if !report.up_to_date {
            reopen_after_sync(&app);
            sweep_after_sync(&app);
        }
        Ok(report)
    })
    .await
}

/// Bring the cached meta schema database up to date, and say whether it moved.
///
/// The counterpart of `ModLibrary::fill_meta_schema`, which the startup pass
/// runs. A failure is logged and stepped over.
fn sync_meta_schema() -> bool {
    let Ok(cache) = MetaSchemaCache::discover()
        .inspect_err(|e| tracing::warn!("No meta schema cache to sync: {e}"))
    else {
        return false;
    };
    let Ok(fetch) = PublishedDb::new(SYNC_USER_AGENT)
        .inspect_err(|e| tracing::warn!("Could not build the meta schema client: {e}"))
    else {
        return false;
    };

    match cache.refresh(&fetch) {
        Ok(report) => report.installed,
        Err(e) => {
            tracing::warn!("Could not sync the meta schema database: {e}");
            false
        }
    }
}

/// Drop everything read out of the tables a sync has just replaced.
///
/// The next caller opens what the sync wrote. Shared by the Settings sync and
/// by the one the startup sweep runs in front of itself, so the two cannot
/// forget different halves of it.
pub fn reopen_after_sync(app: &AppHandle) {
    app.state::<std::sync::Arc<WadPathResolverState>>()
        .invalidate();
    app.state::<BinHashTablesState>().invalidate();
    app.state::<StringKeyIndexState>().clear();
    app.state::<GameIndexState>().clear();
    BinNames::invalidate_game_index();
    super::object_index::rename_after_sync(app);
}

/// Re-check the library against the tables the sync just installed.
///
/// A verdict's basis names the cache it was taken against, so every stored one
/// is now stale - and a badge that waited for the next launch to say so would
/// leave the user reading a verdict this press has already disproved. On a
/// thread of its own, because a sweep reads every mod and the press it answers
/// is a table download.
///
/// One sweep at a time. Two would share a verdict file, a progress event and
/// one cancel between them, so the reader would watch two runs' counters fight
/// over the status bar while the ✕ stopped whichever started last.
fn sweep_after_sync(app: &AppHandle) {
    let library = app.state::<ModLibraryState>().0.clone();
    if let HealthSweepState::Running { .. } = library.health_sweep_state() {
        tracing::info!("A library sweep is already running, so the sync leaves it to that one");
        return;
    }

    let settings = app.state::<SettingsState>().0.lock().clone();

    std::thread::spawn(move || {
        if let Err(e) = library.sweep_mod_health(&settings.config, &SweepScope::Due) {
            tracing::warn!("Could not sweep mod health after a hashtable sync: {e}");
        }
    });
}
