//! The support service: building a support report, showing it and writing it as a zip.
//!
//! `build_support_report` builds a report and keeps it. `save_support_report` writes the
//! report that was built, so the zip holds the files that the dialog showed. Per "The support
//! report" in docs/ux/SUPPORT_REPORTS.md.

use std::path::PathBuf;

use fs_err as fs;
use ltk_manager_core::support_report::{
    AppIdentity, BuiltReport, ReportDescription, ReportPreview, SupportReport,
};
use parking_lot::Mutex;
use serde::Deserialize;
use tauri::{AppHandle, Manager};

use super::desktop::shell::reveal_in_explorer_inner;
use crate::error::{AppError, IpcResult};
use crate::mods::ModLibraryState;
use crate::patcher::PatcherDeliveryState;
use crate::services::shared::off_thread;
use crate::state::{IncidentStoreState, SettingsState};

/// The report that `build_support_report` built last.
#[derive(Default)]
pub struct SupportReportState(Mutex<Option<BuiltReport>>);

/// What the user chose in the `Get help` dialog.
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ReportRequest {
    pub description: ReportDescription,
    /// Whether the report holds the game log of the newest incident.
    pub include_game_log: bool,
}

/// Builds a support report, keeps it for `save_support_report` and returns it for the
/// preview.
///
/// A file that cannot be built is left out of the report.
#[tauri::command]
#[specta::specta]
pub async fn build_support_report(
    request: ReportRequest,
    app_handle: AppHandle,
) -> IpcResult<ReportPreview> {
    off_thread(move || {
        let report = build(&app_handle, request);
        let preview = report.preview();
        *app_handle.state::<SupportReportState>().0.lock() = Some(report);
        Ok(preview)
    })
    .await
}

/// Writes the report `id` as a zip, reveals it in the file manager and returns its path.
///
/// Writes to `destination` if it is set, and to the Downloads folder under the report's own
/// file name otherwise. Fails if `id` is not the report that was built last, or if the zip
/// cannot be written.
#[tauri::command]
#[specta::specta]
pub async fn save_support_report(
    id: String,
    destination: Option<String>,
    app_handle: AppHandle,
) -> IpcResult<String> {
    off_thread(move || {
        let reports = app_handle.state::<SupportReportState>();
        let built = reports.0.lock();
        let Some(report) = built.as_ref().filter(|report| report.manifest().id == id) else {
            return Err(AppError::Other(
                "The support report was rebuilt. Build it again before saving it.".to_owned(),
            ));
        };

        let path = match destination {
            Some(destination) => PathBuf::from(destination),
            None => app_handle
                .path()
                .download_dir()
                .map_err(|e| AppError::Other(format!("No Downloads folder: {e}")))?
                .join(report.file_name()),
        };
        report.write_zip(fs::File::create(&path)?)?;

        let path = path.to_string_lossy().into_owned();
        reveal_in_explorer_inner(&path)?;
        Ok(path)
    })
    .await
}

/// Builds a report from the state of the app. A builder that fails leaves its file out.
fn build(app_handle: &AppHandle, request: ReportRequest) -> BuiltReport {
    let settings = app_handle.state::<SettingsState>();
    let config = settings.config();
    let app = AppIdentity {
        identifier: app_handle.config().identifier.clone(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
        release_build: !cfg!(debug_assertions),
    };
    let mut report = SupportReport::new(app, request.description, chrono::Utc::now());

    if let Some(log_dir) = crate::logging::default_log_dir() {
        report.add_log(&log_dir);
    }
    if let Ok(settings) = serde_json::to_value(&*settings.0.lock()) {
        report.add_settings(&settings);
    }
    report.add_system_checks(&super::diagnostics::check_ctx(app_handle, &config));
    report.add_library(&app_handle.state::<ModLibraryState>().0, &config);

    let incidents = app_handle.state::<IncidentStoreState>();
    report.add_incidents(&incidents.0);
    if request.include_game_log {
        let newest = incidents
            .0
            .list()
            .ok()
            .and_then(|all| all.into_iter().next());
        if let Some(incident) = newest {
            report.add_game_log(&incident, &config);
        }
    }

    let channel = crate::patcher::delivery::channel(&config);
    let staged = app_handle
        .state::<PatcherDeliveryState>()
        .delivery()
        .and_then(|delivery| delivery.staged(channel, crate::patcher::delivery::now()));
    report.add_patcher(channel, staged.as_ref());

    report.finish()
}

/// The support service's row of `services/table.rs`.
pub struct Table;

/// The plugin answering the support commands.
pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    super::plugin::<Table>().build()
}
