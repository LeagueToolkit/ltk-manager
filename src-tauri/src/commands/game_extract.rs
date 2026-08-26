//! Writing chunks of the game's archives out to a folder the user picked.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use tauri::{AppHandle, Manager, State};

use super::off_thread;
use crate::error::{AppResult, IpcResult, MutexResultExt};
use crate::events::TauriEventSink;
use crate::state::SettingsState;
use ltk_manager_core::game_extract::{
    ExtractJob, ExtractOptions, ExtractPlan, ExtractSummary, ExtractTarget,
};
use ltk_manager_core::game_index::{GameIndex, GameIndexState};
use ltk_manager_core::game_wads::GameArchives;
use ltk_manager_core::hashtables::{WadPathResolver, WadPathResolverState};
use ltk_manager_core::workshop::WorkshopFileKind;

/// Keeps one extract in flight at a time, and holds the flag that calls it off.
///
/// One at a time because the toast that shows the bar is one toast with one
/// **Cancel**, and because a second run would fight the first for the same disk
/// - each already spreads its decompression over up to eight threads.
///
/// The flag is per run rather than per app: a cancelled extract stays
/// cancelled, and must not pre-cancel the next one.
#[derive(Default)]
pub struct ExtractState(Mutex<Option<Arc<AtomicBool>>>);

impl ExtractState {
    /// Claim the in-flight slot with a fresh cancel flag, or `None` when an
    /// extract is already running.
    fn acquire(&self) -> AppResult<Option<(ExtractGuard<'_>, Arc<AtomicBool>)>> {
        let mut in_flight = self.0.lock().mutex_err()?;
        if in_flight.is_some() {
            return Ok(None);
        }

        let cancel = Arc::new(AtomicBool::new(false));
        *in_flight = Some(Arc::clone(&cancel));
        Ok(Some((ExtractGuard { state: self }, cancel)))
    }

    /// Call the extract in flight off, reporting whether there was one.
    fn cancel(&self) -> AppResult<bool> {
        let in_flight = self.0.lock().mutex_err()?;
        let Some(cancel) = in_flight.as_ref() else {
            return Ok(false);
        };

        cancel.store(true, Ordering::Relaxed);
        Ok(true)
    }
}

/// Releases the in-flight slot however the run ends.
struct ExtractGuard<'a> {
    state: &'a ExtractState,
}

impl Drop for ExtractGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut in_flight) = self.state.0.lock() {
            *in_flight = None;
        }
    }
}

/// What extracting `targets` would write, before anything is written.
///
/// The dialog's summary line reads this, so a user sees the count, the size and
/// the archives before choosing a destination. `kinds` are the browser's filter
/// chips, and `null` means every kind.
#[tauri::command]
pub async fn plan_game_extract(
    targets: Vec<ExtractTarget>,
    kinds: Option<Vec<WorkshopFileKind>>,
    app_handle: AppHandle,
) -> IpcResult<ExtractPlan> {
    with_index(app_handle, move |index, archives, resolver| {
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
pub async fn extract_game_files(
    targets: Vec<ExtractTarget>,
    options: ExtractOptions,
    app_handle: AppHandle,
) -> IpcResult<Option<ExtractSummary>> {
    let events = TauriEventSink::new(app_handle.clone());

    let result = with_index(app_handle.clone(), move |index, archives, resolver| {
        let extract = app_handle.state::<ExtractState>();
        let Some((_guard, cancel)) = extract.acquire()? else {
            tracing::debug!("Extract already in flight, ignoring the request");
            return Ok(None);
        };

        let config = app_handle.state::<SettingsState>().config()?;
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
    })
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
pub fn cancel_extract(extract: State<ExtractState>) -> IpcResult<bool> {
    extract.cancel().into()
}

/// Run `work` against the game index, the install's archives and the tables
/// that name their chunks.
///
/// The same shape as `game_index.rs::with_index`, and separate from it because
/// an extract needs the archives and the resolver beside the index, and runs
/// for seconds rather than for one directory read.
async fn with_index<T, F>(app_handle: AppHandle, work: F) -> IpcResult<T>
where
    T: Send + 'static,
    F: FnOnce(&GameIndex, &GameArchives, &WadPathResolver) -> AppResult<T> + Send + 'static,
{
    let config = match app_handle.state::<SettingsState>().config() {
        Ok(config) => config,
        Err(e) => return IpcResult::from(Err::<T, _>(e)),
    };

    off_thread(move || {
        let archives = GameArchives::resolve(&config)?;
        let resolver = app_handle.state::<WadPathResolverState>().get()?;
        let index = app_handle
            .state::<GameIndexState>()
            .get_or_build(&archives, resolver.tables())?;
        work(&index, &archives, &resolver)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A double-clicked Extract button must produce one run, not two.
    #[test]
    fn only_one_extract_is_in_flight_at_a_time() {
        let state = ExtractState::default();

        let first = state.acquire().unwrap();
        assert!(first.is_some());
        assert!(state.acquire().unwrap().is_none());

        drop(first);
        assert!(state.acquire().unwrap().is_some());
    }

    /// A cancel on one run must not pre-cancel the next.
    #[test]
    fn the_cancel_flag_is_per_run() {
        let state = ExtractState::default();

        let (guard, first) = state.acquire().unwrap().unwrap();
        assert!(state.cancel().unwrap());
        assert!(first.load(Ordering::Relaxed));
        drop(guard);

        let (_guard, second) = state.acquire().unwrap().unwrap();
        assert!(!second.load(Ordering::Relaxed));
    }

    /// A Cancel that lands after the run finished says so rather than failing.
    #[test]
    fn cancelling_nothing_reports_nothing() {
        assert!(!ExtractState::default().cancel().unwrap());
    }
}
