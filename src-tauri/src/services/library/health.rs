//! Mod health over IPC: check one mod, repair it, and read the badges.
//!
//! Checking and repairing both walk a mod's content — unpacking an
//! archive-storage mod into staging to do it — so they run off the UI thread.
//! Reading the remembered verdicts is a file read the library view makes on
//! every render, and stays synchronous.

use crate::error::{AppResult, IpcResult};
use crate::mods::{ModHealthVerdict, ModLibrary, ModLibraryState};
use crate::patcher::PatcherState;
use crate::services::shared::off_thread;
use crate::services::shared::Library;
use crate::state::SettingsState;
use ltk_manager_core::config::Config;
use ltk_manager_core::mods::{
    HealthCheckReadiness, HealthSweepReport, HealthSweepState, LibraryRepairReport, SweepScope,
};
use ltk_manager_core::problems::FixReport;
use std::collections::BTreeMap;
use tauri::{AppHandle, Manager, State};

/// Check one mod and return the verdict its badge reads.
#[tauri::command]
#[specta::specta]
pub async fn check_mod_health(
    mod_id: String,
    app_handle: AppHandle,
) -> IpcResult<ModHealthVerdict> {
    let (config, library) = match library_setup(&app_handle, PatcherGuard::Allow) {
        Ok(v) => v,
        Err(e) => return IpcResult::from(Err::<ModHealthVerdict, _>(e)),
    };

    off_thread(move || library.check_mod_health(&config, &mod_id)).await
}

/// Re-check `mod_ids`, or every mod in the library where none are named.
///
/// The library's counterpart of one card's Check Health, so it takes the
/// verdicts again whatever their basis says. Reports through the sweep's own
/// progress events, which is what makes one run at a time the rule.
#[tauri::command]
#[specta::specta]
pub async fn sweep_mod_health(
    mod_ids: Option<Vec<String>>,
    app_handle: AppHandle,
) -> IpcResult<HealthSweepReport> {
    let (config, library) = match library_setup(&app_handle, PatcherGuard::Allow) {
        Ok(v) => v,
        Err(e) => return IpcResult::from(Err::<HealthSweepReport, _>(e)),
    };

    let scope = mod_ids.map_or(SweepScope::All, SweepScope::Only);
    off_thread(move || library.sweep_mod_health(&config, &scope)).await
}

/// Repair what a machine can repair in one mod.
#[tauri::command]
#[specta::specta]
pub async fn repair_mod(mod_id: String, app_handle: AppHandle) -> IpcResult<FixReport> {
    let (config, library) = match library_setup(&app_handle, PatcherGuard::Reject) {
        Ok(v) => v,
        Err(e) => return IpcResult::from(Err::<FixReport, _>(e)),
    };

    off_thread(move || {
        let report = library.repair_mod(&config, &mod_id)?;
        library.announce_change();
        Ok(report)
    })
    .await
}

/// Repair what a machine can repair in each of `mod_ids`.
///
/// The one button behind the sweep's banner. One mod that cannot be repaired is
/// recorded in the report rather than failing the call.
#[tauri::command]
#[specta::specta]
pub async fn repair_mods(
    mod_ids: Vec<String>,
    app_handle: AppHandle,
) -> IpcResult<LibraryRepairReport> {
    let (config, library) = match library_setup(&app_handle, PatcherGuard::Reject) {
        Ok(v) => v,
        Err(e) => return IpcResult::from(Err::<LibraryRepairReport, _>(e)),
    };

    off_thread(move || {
        let report = library.repair_mods(&config, &mod_ids)?;
        library.announce_change();
        Ok(report)
    })
    .await
}

/// Time a health pass over the real library, into the dev console.
///
/// Debug builds only, and the trigger for the measurement loop the repair was
/// tuned in: a synthetic fixture cannot produce the numbers a 25MB mod of real
/// bins does. `repair` runs the real repair, which rewrites the mods it can fix
/// and keeps no way back, so the default pass only reads.
#[cfg(debug_assertions)]
#[tauri::command]
#[specta::specta]
pub async fn time_mod_health(
    repair: bool,
    app_handle: AppHandle,
) -> IpcResult<ltk_manager_core::mods::HealthTiming> {
    let guard = if repair {
        PatcherGuard::Reject
    } else {
        PatcherGuard::Allow
    };
    let (config, library) = match library_setup(&app_handle, guard) {
        Ok(v) => v,
        Err(e) => {
            return IpcResult::from(Err::<ltk_manager_core::mods::HealthTiming, _>(e));
        }
    };

    off_thread(move || library.time_mod_health(&config, repair)).await
}

/// Call off the check or repair now running, if one is.
///
/// A mod the run had not finished records no verdict, so the next sweep picks
/// it up. Synchronous: it sets a flag the workers read.
#[tauri::command]
#[specta::specta]
pub fn cancel_mod_health_run(library: State<ModLibraryState>) -> IpcResult<()> {
    library.0.cancel_mod_health_run();
    let result: AppResult<()> = Ok(());
    result.into()
}

/// Whether a check can run now, for the controls that offer one.
///
/// Off the UI thread because the first caller of a launch is the one that opens
/// the tables, which reads a manifest and maps two files.
#[tauri::command]
#[specta::specta]
pub async fn get_health_check_readiness(app_handle: AppHandle) -> IpcResult<HealthCheckReadiness> {
    let library = app_handle.state::<ModLibraryState>().0.clone();
    off_thread(move || Ok(library.health_check_readiness())).await
}

/// What the mod health sweep has to say for itself this launch.
#[tauri::command]
#[specta::specta]
pub fn get_health_sweep(library: State<ModLibraryState>) -> IpcResult<HealthSweepState> {
    let result: AppResult<HealthSweepState> = Ok(library.0.health_sweep_state());
    result.into()
}

/// Every verdict the library remembers, by mod id.
#[tauri::command]
#[specta::specta]
pub fn get_mod_health_verdicts(library: Library) -> IpcResult<BTreeMap<String, ModHealthVerdict>> {
    library.with(|library, config| library.mod_health_verdicts(config))
}

/// Whether a command must refuse to run while the patcher does.
///
/// A check only reads mod content, so it may run alongside a patch session. A
/// repair rewrites it under the overlay's feet, so it may not.
enum PatcherGuard {
    Allow,
    Reject,
}

/// The config and library an off-thread mod-health command moves into its
/// closure, gathered on the UI thread where managed state lives.
fn library_setup(app_handle: &AppHandle, guard: PatcherGuard) -> AppResult<(Config, ModLibrary)> {
    if matches!(guard, PatcherGuard::Reject) {
        app_handle.state::<PatcherState>().reject_if_running()?;
    }
    let config = app_handle.state::<SettingsState>().config();
    let library = app_handle.state::<ModLibraryState>().0.clone();
    Ok((config, library))
}
