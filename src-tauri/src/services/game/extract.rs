//! Writing chunks of the game's archives out to a folder the user picked.

use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Instant;

use tauri::{AppHandle, Manager, State};

use crate::error::{AppResult, IpcResult};
use crate::events::TauriEventSink;
use crate::services::shared::off_thread;
use crate::services::shared::InFlight;
use crate::state::SettingsState;
use ltk_manager_core::game_extract::{
    ExtractJob, ExtractOptions, ExtractPlan, ExtractSummary, ExtractTarget,
};
use ltk_manager_core::game_index::GameIndex;
use ltk_manager_core::game_wads::{GameArchives, WadSource};
use ltk_manager_core::hashtables::{WadPathResolver, WadPathResolverState};
use ltk_manager_core::workshop::WorkshopFileKind;

/// Keeps one extract in flight at a time, and holds the flag that calls it off.
///
/// One at a time because the toast that shows the bar is one toast with one
/// **Cancel**, and because a second run would fight the first for the same disk
/// - each already spreads its decompression over up to eight threads.
#[derive(Default)]
pub struct ExtractState(InFlight<Arc<AtomicBool>>);

/// What extracting `targets` would write, before anything is written.
///
/// The dialog's summary line reads this, so a user sees the count, the size and
/// the archives before choosing a destination. `kinds` are the browser's filter
/// chips, and `null` means every kind.
#[tauri::command]
#[specta::specta]
pub async fn plan_game_extract(
    targets: Vec<ExtractTarget>,
    kinds: Option<Vec<WorkshopFileKind>>,
    source: WadSource,
    app_handle: AppHandle,
) -> IpcResult<ExtractPlan> {
    with_index(app_handle, source, move |index, archives, resolver| {
        let job = ExtractJob::plan(&targets, kinds.as_deref(), index, archives, resolver)?;
        Ok(job.summary())
    })
    .await
}

/// Write every chunk the targets name into `options.destination`.
///
/// Progress arrives as `extract-progress`, throttled rather than one event per
/// chunk. Answers `None` when an extract is already running, which is what a
/// double-clicked Extract button looks like.
#[tauri::command]
#[specta::specta]
pub async fn extract_game_files(
    targets: Vec<ExtractTarget>,
    options: ExtractOptions,
    source: WadSource,
    app_handle: AppHandle,
) -> IpcResult<Option<ExtractSummary>> {
    let events = TauriEventSink::new(app_handle.clone());

    let result = with_index(
        app_handle.clone(),
        source,
        move |index, archives, resolver| {
            let extract = app_handle.state::<ExtractState>();
            let Some((_guard, cancel)) = extract.0.acquire() else {
                tracing::debug!("Extract already in flight, ignoring the request");
                return Ok(None);
            };

            let config = app_handle.state::<SettingsState>().config();
            let job = ExtractJob::plan(
                &targets,
                options.kinds.as_deref(),
                index,
                archives,
                resolver,
            )?;

            if job.is_empty() {
                return Ok(Some(ExtractSummary {
                    destination: options.destination.clone(),
                    ..ExtractSummary::default()
                }));
            }

            let started = Instant::now();
            let summary = job.run(&options, &config, archives, resolver, &events, &cancel)?;
            tracing::info!(
                extracted = summary.extracted,
                skipped = summary.skipped_existing,
                bytes = summary.bytes_written,
                elapsed_ms = started.elapsed().as_millis(),
                cancelled = summary.cancelled,
                destination = %summary.destination,
                "Extracted game files"
            );
            Ok(Some(summary))
        },
    )
    .await;

    if let IpcResult::Err { ref error } = result {
        tracing::error!(error = ?error, "Extract game files failed");
    }
    result
}

/// Call off the extract that is in flight, if there is one.
///
/// Answers `false` when nothing was running, which is what a Cancel pressed
/// just as the run finished looks like. The files written so far stay, because
/// each one was written whole.
#[tauri::command]
#[specta::specta]
pub fn cancel_extract(extract: State<ExtractState>) -> IpcResult<bool> {
    IpcResult::ok(extract.0.cancel())
}

/// Run `work` against the index of `source`, its archives and the tables that
/// name their chunks.
///
/// The same shape as `game_index.rs::with_index`, and separate from it because
/// an extract needs the archives and the resolver beside the index, and runs
/// for seconds rather than for one directory read.
async fn with_index<T, F>(app_handle: AppHandle, source: WadSource, work: F) -> IpcResult<T>
where
    T: Send + 'static,
    F: FnOnce(&GameIndex, &GameArchives, &WadPathResolver) -> AppResult<T> + Send + 'static,
{
    let config = app_handle.state::<SettingsState>().config();

    off_thread(move || {
        let (index, archives) = super::index::built_index(&app_handle, &config, source)?;
        let resolver = app_handle
            .state::<std::sync::Arc<WadPathResolverState>>()
            .get();
        work(&index, &archives, &resolver)
    })
    .await
}
