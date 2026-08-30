//! The problems panel's IPC: analyze, fix, undo, and a project's restore points.
//!
//! A run is held in memory rather than returned and forgotten, because a fix
//! names the problems of a run the backend made. Anything that writes
//! invalidates that state, so the panel's next read re-runs the rules over the
//! files as they are now.

use super::off_thread;
use crate::error::{AppError, AppResult, IpcResult};
use crate::mods::ModLibraryState;
use crate::state::SettingsState;
use ltk_manager_core::hashtables::WadPathResolverState;
use ltk_manager_core::problems;
use ltk_manager_core::problems::{FixReport, ProblemId, ProblemsState};
use std::path::Path;
use tauri::{AppHandle, Manager};

/// Run every rule over one project.
///
/// The run answers inside its budget, 2ms on a skin mod and a few hundred on a
/// 60MB map overhaul, so it needs no progress events and no cancel. A few
/// hundred milliseconds is still a frame budget the window does not have, and
/// the first run of a session also pays for the hashtable cache, so the walk
/// happens off the UI thread. See `docs/ux/PROJECT_PROBLEMS.md`.
#[tauri::command]
pub async fn analyze_project(
    project_path: String,
    app_handle: AppHandle,
) -> IpcResult<problems::Run> {
    off_thread(move || {
        analyze_project_inner(
            &project_path,
            &app_handle.state::<ProblemsState>(),
            &app_handle.state::<SettingsState>(),
            &app_handle.state::<ModLibraryState>(),
        )
    })
    .await
}

fn analyze_project_inner(
    project_path: &str,
    runs: &ProblemsState,
    settings: &SettingsState,
    library: &ModLibraryState,
) -> AppResult<problems::Run> {
    let root = Path::new(project_path);
    let config = settings.config()?;

    let run = problems::analyze(root, &config, library.0.game_content(&config))?;
    runs.record(root, run.clone())?;
    Ok(run)
}

/// Apply the fixes of the named problems, and write a restore point first.
///
/// Fix on a row, Fix on a group and Fix on the panel are this one call with a
/// different list.
///
/// # Errors
///
/// Reports a project the backend holds no run for, because the ids name
/// problems only a run can have produced.
#[tauri::command]
pub async fn fix_problems(
    project_path: String,
    problems: Vec<ProblemId>,
    app_handle: AppHandle,
) -> IpcResult<FixReport> {
    off_thread(move || {
        fix_problems_inner(
            &project_path,
            &problems,
            &app_handle.state::<ProblemsState>(),
            &app_handle.state::<SettingsState>(),
            &app_handle.state::<std::sync::Arc<WadPathResolverState>>(),
            &app_handle.state::<ModLibraryState>(),
        )
    })
    .await
}

fn fix_problems_inner(
    project_path: &str,
    chosen: &[ProblemId],
    runs: &ProblemsState,
    settings: &SettingsState,
    resolvers: &WadPathResolverState,
    library: &ModLibraryState,
) -> AppResult<FixReport> {
    let root = Path::new(project_path);
    let run = runs.last(root)?.ok_or_else(|| {
        AppError::ValidationFailed(format!(
            "no analysis is held for {project_path}, run the analysis first"
        ))
    })?;
    let config = settings.config()?;

    // A path the community tables already name is not embedded in the mod.
    // Tables that cannot be opened exclude nothing, which costs size and never
    // correctness, so a fix is not refused over them.
    let resolver = resolvers.get().ok();
    let report = problems::apply(
        root,
        &run,
        chosen,
        &config,
        resolver.as_deref().map(|resolver| resolver as _),
        library.0.game_content(&config),
    );

    runs.invalidate(root)?;
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    /// A library that announces nothing and stores nothing, for a test that
    /// fails before it reaches either.
    fn library() -> ModLibraryState {
        ModLibraryState(ltk_manager_core::mods::ModLibrary::new(
            Arc::new(ltk_manager_core::events::NullEventSink),
            None,
            "0.0.0",
            Arc::default(),
            Arc::default(),
            Arc::new(ltk_manager_core::mods::WadReportState::new(None)),
            Arc::default(),
        ))
    }

    #[test]
    fn a_fix_without_a_recorded_run_is_a_validation_error() {
        let error = fix_problems_inner(
            "X:/lol-mods/charizard-smolder-x",
            &[],
            &ProblemsState::default(),
            &SettingsState::default(),
            &WadPathResolverState::default(),
            &library(),
        )
        .expect_err("a project the backend never analyzed has no run to fix from");

        assert!(matches!(error, AppError::ValidationFailed(_)));
        assert!(error.to_string().contains("run the analysis first"));
    }
}
