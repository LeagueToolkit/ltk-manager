//! The support service: building a support report, showing it and writing it as a zip, and
//! the panic of the run before this one.
//!
//! `build_support_report` builds a report and keeps it. `save_support_report` writes the
//! report that was built, so the zip holds the files that the dialog showed. Per "The support
//! report" in docs/ux/SUPPORT_REPORTS.md.
//!
//! [`ReportSources`] holds what a report reads. The commands take it from the running app,
//! and a process without a window opens it from the files of the app.

use std::{path::PathBuf, sync::Arc};

use fs_err as fs;
use ltk_manager_assets::hashtables::WadPathResolverState;
use ltk_manager_base::events::NullEventSink;
use ltk_manager_core::{
    known_issues::{self, KnownIssue},
    log_dir::{LogDir, PanicRecord},
    support_report::{
        AppIdentity, BuiltReport, ReportDescription, ReportPreview, Startup, SupportReport,
    },
};
use ltk_manager_runtime::diagnostics::store::IncidentStore;
use parking_lot::Mutex;
use serde::Deserialize;
use tauri::{AppHandle, Manager, State};

use super::desktop::shell::reveal_in_explorer_inner;
use crate::error::{AppError, GitHubFeed, IpcResult};
use crate::mods::{ChecksumMismatchState, ModLibrary, ModLibraryState, WadReportState};
use crate::patcher::PatcherDeliveryState;
use crate::running_version;
use crate::services::shared::{github_feed, off_thread};
use crate::state::{IncidentStoreState, Settings, SettingsState, SETTINGS_FILE};
use crate::updater::UpdaterState;

/// The report that `build_support_report` built last.
#[derive(Default)]
pub struct SupportReportState(Mutex<Option<BuiltReport>>);

/// The panic that closed the run before this one, until the user dismisses it.
pub struct PreviousPanicState(Mutex<Option<PanicRecord>>);

impl PreviousPanicState {
    /// Takes the panic record out of `log_dir`. Holds no panic if `log_dir` is `None` or
    /// holds no record.
    pub fn take_from(log_dir: Option<&LogDir>) -> Self {
        Self(Mutex::new(log_dir.and_then(LogDir::take_panic)))
    }
}

/// What the user chose in the `Get help` dialog.
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ReportRequest {
    pub description: ReportDescription,
    /// The incident that the report is about. The newest incident if `None`.
    pub incident_id: Option<String>,
    /// Whether the report holds the game log of that incident.
    pub include_game_log: bool,
}

/// Returns the panic that closed the run before this one.
///
/// Returns `None` if that run exited normally, or after `dismiss_previous_panic`.
#[tauri::command]
#[specta::specta]
pub fn previous_panic(panic: State<PreviousPanicState>) -> IpcResult<Option<PanicRecord>> {
    IpcResult::ok(panic.0.lock().clone())
}

/// Forgets the panic that closed the run before this one.
#[tauri::command]
#[specta::specta]
pub fn dismiss_previous_panic(panic: State<PreviousPanicState>) -> IpcResult<()> {
    *panic.0.lock() = None;
    IpcResult::ok(())
}

/// Reads the known issues that the maintainers publish for this build.
#[tauri::command]
#[specta::specta]
pub async fn list_known_issues() -> IpcResult<Vec<KnownIssue>> {
    github_feed(GitHubFeed::KnownIssues, || {
        known_issues::fetch(&running_version())
    })
    .await
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
        let report = ReportSources::of_app(&app_handle).build(request);
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

/// What a support report reads: the settings, the library, the incidents and the patcher
/// builds.
pub struct ReportSources {
    settings: Settings,
    /// The data directory that the settings select.
    data_dir: Option<PathBuf>,
    library: ModLibrary,
    incidents: Arc<IncidentStore>,
    delivery: PatcherDeliveryState,
    /// The manager release that the updater offers.
    latest: Option<String>,
    /// The start that opened no window. `None` in a running manager.
    startup: Option<Startup>,
}

impl ReportSources {
    /// Takes the sources from the state of the running app.
    fn of_app(app_handle: &AppHandle) -> Self {
        let settings = app_handle.state::<SettingsState>().0.lock().clone();
        Self {
            data_dir: crate::data_location::data_dir(app_handle, &settings.config),
            library: app_handle.state::<ModLibraryState>().0.clone(),
            incidents: Arc::clone(&app_handle.state::<IncidentStoreState>().0),
            delivery: app_handle.state::<PatcherDeliveryState>().inner().clone(),
            latest: app_handle.state::<UpdaterState>().offered_version(),
            startup: None,
            settings,
        }
    }

    /// Opens the sources from the files of the app, for a process that has no app and
    /// reports `startup`.
    ///
    /// Reads the settings file, which registers the private values with the redactor. Uses
    /// the default settings if the file cannot be read. Writes no file and deletes none.
    pub fn from_disk(startup: Startup) -> Self {
        let app_data = crate::state::app_data_dir_without_app();
        let settings = app_data
            .as_deref()
            .map(|dir| crate::state::load_settings(&dir.join(SETTINGS_FILE)))
            .unwrap_or_default();
        let data_dir = crate::data_location::data_dir_under(app_data.clone(), &settings.config);
        let library = ModLibrary::new(
            Arc::new(NullEventSink),
            app_data,
            env!("CARGO_PKG_VERSION"),
            Arc::new(ChecksumMismatchState::default()),
            Arc::new(WadReportState::new(data_dir.as_deref())),
            Arc::new(WadPathResolverState::default()),
        );
        Self {
            library,
            incidents: IncidentStoreState::under(data_dir.as_deref(), &settings.config).0,
            delivery: PatcherDeliveryState::without_cleanup(data_dir.as_deref()),
            latest: None,
            startup: Some(startup),
            data_dir,
            settings,
        }
    }

    /// Builds the report that `request` describes. A builder that fails leaves its file out.
    pub fn build(self, request: ReportRequest) -> BuiltReport {
        let config = &self.settings.config;
        let app = AppIdentity {
            identifier: crate::IDENTIFIER.to_owned(),
            version: env!("CARGO_PKG_VERSION").to_owned(),
            release_build: !cfg!(debug_assertions),
        };
        let mut report = SupportReport::new(app, request.description, chrono::Utc::now());
        if let Some(latest) = self.latest {
            report.note_update(latest);
        }
        if let Some(startup) = self.startup {
            report.add_startup(startup);
        }

        if let Some(log_dir) = crate::logging::default_log_dir() {
            report.add_log(&log_dir);
        }
        if let Ok(settings) = serde_json::to_value(&self.settings) {
            report.add_settings(&settings);
        }
        report.add_system_checks(&super::diagnostics::check_ctx(
            config,
            self.data_dir,
            &self.delivery,
        ));
        report.add_library(&self.library, config);

        let subject = report.add_incidents(&self.incidents, request.incident_id.as_deref());
        if let Some(incident) = subject.filter(|_| request.include_game_log) {
            report.add_game_log(&incident, config);
        }

        let channel = crate::patcher::delivery::channel(config);
        let staged = self
            .delivery
            .delivery()
            .and_then(|delivery| delivery.staged(channel, crate::patcher::delivery::now()));
        report.add_patcher(channel, staged.as_ref());

        report.finish()
    }
}

/// The support service's row of `services/table.rs`.
pub struct Table;

/// The plugin answering the support commands.
pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    super::plugin::<Table>().build()
}
