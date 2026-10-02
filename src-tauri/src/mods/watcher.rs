use std::path::PathBuf;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use fs_err as fs;
use ltk_manager_core::mods::StorageLayout as _;
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use tauri::{AppHandle, Emitter, Manager};

use crate::state::SettingsState;

use super::{ModLibraryState, WATCHER_SUPPRESS_SECS};

/// Start a background thread that watches the `archives` and `mods` directories
/// for changes and reconciles the library index when files are added or removed externally.
///
/// Emits a `library-changed` event to the frontend so it can invalidate queries.
pub fn start_library_watcher(app_handle: &AppHandle) {
    let handle = app_handle.clone();

    thread::spawn(move || {
        if let Err(e) = run_watcher(&handle) {
            tracing::error!("Library watcher failed: {}", e);
        }
    });
}

fn resolve_watch_dirs(app_handle: &AppHandle) -> Option<(PathBuf, PathBuf)> {
    let settings_state: tauri::State<'_, SettingsState> = app_handle.state();
    let settings = settings_state.0.lock();
    let mod_library_state: tauri::State<'_, ModLibraryState> = app_handle.state();
    let storage_dir = mod_library_state.0.storage_dir(&settings.config).ok()?;

    let archives_dir = storage_dir.archives_dir();
    let mods_dir = storage_dir.mods_dir();

    Some((archives_dir, mods_dir))
}

fn epoch_ms_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn is_within_suppress_window(last_mutation: &Arc<AtomicI64>) -> bool {
    let last = last_mutation.load(Ordering::SeqCst);
    if last == 0 {
        return false;
    }
    let elapsed_ms = (epoch_ms_now() - last).max(0);
    elapsed_ms < WATCHER_SUPPRESS_SECS * 1000
}

fn run_watcher(app_handle: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let (archives_dir, mods_dir) =
        resolve_watch_dirs(app_handle).ok_or("Failed to resolve watch directories")?;

    let last_mutation = {
        let mod_library_state: tauri::State<'_, ModLibraryState> = app_handle.state();
        Arc::clone(mod_library_state.0.last_mutation_epoch_ms())
    };

    fs::create_dir_all(&archives_dir)?;
    fs::create_dir_all(&mods_dir)?;

    tracing::info!(
        "Starting library watcher on: {}, {}",
        archives_dir.display(),
        mods_dir.display()
    );

    let handle = app_handle.clone();
    let (tx, rx) = std::sync::mpsc::channel();

    let mut debouncer = new_debouncer(Duration::from_secs(2), tx)?;

    debouncer
        .watcher()
        .watch(&archives_dir, notify::RecursiveMode::NonRecursive)?;
    debouncer
        .watcher()
        .watch(&mods_dir, notify::RecursiveMode::NonRecursive)?;

    loop {
        match rx.recv() {
            Ok(Ok(events)) => {
                if is_within_suppress_window(&last_mutation) {
                    tracing::debug!("Library watcher suppressed (recent internal mutation)");
                    continue;
                }

                let all_json_events = events.iter().all(|e| match e.kind {
                    DebouncedEventKind::Any | DebouncedEventKind::AnyContinuous => {
                        e.path.extension().is_some_and(|ext| ext == "json")
                    }
                    _ => false,
                });
                if all_json_events {
                    continue;
                }

                tracing::debug!("Library watcher detected changes, reconciling...");
                handle_change(&handle);
            }
            Ok(Err(error)) => {
                tracing::warn!("Library watcher error: {:?}", error);
            }
            Err(_) => {
                tracing::debug!("Library watcher channel closed, stopping");
                break;
            }
        }
    }

    Ok(())
}

fn handle_change(app_handle: &AppHandle) {
    let settings_state: tauri::State<'_, SettingsState> = app_handle.state();
    let mod_library_state: tauri::State<'_, ModLibraryState> = app_handle.state();

    let config = settings_state.0.lock().config.clone();

    match mod_library_state.0.reconcile_index(&config) {
        Ok(true) => {
            tracing::info!("Watcher: library index reconciled after file change");
            let _ = app_handle.emit("library-changed", ());
        }
        Ok(false) => {
            tracing::debug!("Watcher: no reconciliation needed");
        }
        Err(e) => {
            tracing::warn!("Watcher: reconciliation failed: {}", e);
        }
    }
}
