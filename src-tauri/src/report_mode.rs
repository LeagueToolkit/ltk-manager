//! The support report of a manager that opens no window.
//!
//! `--report` builds a report, asks for the destination in a native save dialog, writes the
//! zip and reveals it. A start that fails starts a copy of the manager with `--report` and
//! the error, and the copy shows the error in a native dialog that offers `Save report`. Per
//! "When the manager does not start" in docs/ux/SUPPORT_REPORTS.md.

use std::{ffi::OsString, fmt::Display, io, path::Path, process::Command};

use fs_err as fs;
use ltk_manager_core::{
    log_dir::LogDir,
    support_report::{BuiltReport, ReportDescription, ReportOrigin, ReportProblem, Startup},
};
use rfd::{FileDialog, MessageButtons, MessageDialog, MessageDialogResult, MessageLevel};

use crate::services::{
    desktop::shell::reveal_in_explorer_inner,
    support::{ReportRequest, ReportSources},
};

#[cfg(test)]
mod tests;

/// The argument that asks for a report without a window.
const REPORT_ARG: &str = "--report";

/// The argument before the error of a start that failed.
const FAILURE_ARG: &str = "--start-failure";

/// The title of each native dialog.
const TITLE: &str = "LTK Manager";

/// The label of the button that saves a report after a start that failed.
const SAVE_REPORT: &str = "Save report";

/// A request for a support report from a process that opens no window.
#[derive(Debug, PartialEq, Eq)]
pub struct ReportMode {
    /// The error of the start that failed. `None` if the user asked for the report.
    failure: Option<String>,
}

impl ReportMode {
    /// Reads the request from `args`, the arguments of the process without the program name.
    ///
    /// Returns `None` if `args` do not hold `--report`. The failure is the argument after
    /// `--start-failure`.
    pub fn from_args(args: impl IntoIterator<Item = OsString>) -> Option<Self> {
        let mut requested = false;
        let mut failure = None;
        let mut args = args.into_iter();
        while let Some(arg) = args.next() {
            if arg == REPORT_ARG {
                requested = true;
            } else if arg == FAILURE_ARG {
                failure = args
                    .next()
                    .map(|error| error.to_string_lossy().into_owned());
            }
        }
        requested.then_some(Self { failure })
    }

    /// Runs the request.
    ///
    /// Shows the failure first, if the request holds one, and stops unless the user chooses
    /// `Save report`. Builds the report, asks for the destination in a native save dialog,
    /// writes the zip and reveals it. Stops if the user cancels the save dialog. Shows the
    /// error in a native dialog if the zip cannot be written.
    pub fn run(self) {
        if let Some(failure) = &self.failure {
            if !confirm_report(failure) {
                return;
            }
        }

        tracing::info!("Building a support report without a window");
        let report = self.build();
        let Some(path) = destination(&report) else {
            return;
        };
        if let Err(error) = save(&report, &path) {
            tracing::error!("Could not save the support report: {error}");
            alert(&format!("Couldn't save the report.\n\n{error}"));
        }
    }

    /// Builds the report from the files of the app.
    ///
    /// The report states the panic record of the log directory as its trigger, and leaves
    /// the record in place for the next start of the manager.
    fn build(self) -> BuiltReport {
        let panic = crate::logging::default_log_dir()
            .as_ref()
            .and_then(LogDir::panic_record);
        let description = ReportDescription {
            problem: Some(ReportProblem::Manager),
            origin: panic.map(|panic| ReportOrigin::Panic { panic }),
            ..ReportDescription::default()
        };
        let startup = Startup {
            webview: tauri::webview_version().map_err(|error| error.to_string()),
            failure: self.failure,
        };
        ReportSources::from_disk(startup).build(ReportRequest {
            description,
            incident_id: None,
            include_game_log: false,
        })
    }
}

/// Starts a copy of the manager that shows `error` and offers `Save report`.
///
/// The caller is a start that failed. The copy is another process, so its dialog stays open
/// after this process ends. Logs a warning if the copy cannot be started.
pub fn offer_report(error: &dyn Display) {
    let started = std::env::current_exe().and_then(|exe| {
        Command::new(exe)
            .args([REPORT_ARG, FAILURE_ARG])
            .arg(error.to_string())
            .spawn()
    });
    if let Err(error) = started {
        tracing::warn!("Could not start the report dialog: {error}");
    }
}

/// Shows `failure` in a native dialog. Returns `true` if the user chooses `Save report`.
fn confirm_report(failure: &str) -> bool {
    let choice = MessageDialog::new()
        .set_level(MessageLevel::Error)
        .set_title(TITLE)
        .set_description(format!("LTK Manager did not start.\n\n{failure}"))
        .set_buttons(MessageButtons::OkCancelCustom(
            SAVE_REPORT.to_owned(),
            "Close".to_owned(),
        ))
        .show();
    choice == MessageDialogResult::Custom(SAVE_REPORT.to_owned())
}

/// Shows `text` in a native error dialog.
fn alert(text: &str) {
    MessageDialog::new()
        .set_level(MessageLevel::Error)
        .set_title(TITLE)
        .set_description(text)
        .show();
}

/// Asks for the path of the zip in a native save dialog, which opens in the Downloads folder
/// with the report's own file name. Returns `None` if the user cancels the dialog.
fn destination(report: &BuiltReport) -> Option<std::path::PathBuf> {
    let mut dialog = FileDialog::new()
        .set_title("Save support report")
        .set_file_name(report.file_name())
        .add_filter("Zip archive", &["zip"]);
    if let Some(downloads) = dirs::download_dir() {
        dialog = dialog.set_directory(downloads);
    }
    dialog.save_file()
}

/// Writes `report` as a zip at `path` and reveals it in the file manager.
///
/// Logs a warning if the file manager cannot be opened.
///
/// # Errors
///
/// Returns the error of the write.
fn save(report: &BuiltReport, path: &Path) -> io::Result<()> {
    report.write_zip(fs::File::create(path)?)?;
    if let Err(error) = reveal_in_explorer_inner(&path.to_string_lossy()) {
        tracing::warn!("Could not reveal the support report: {error}");
    }
    Ok(())
}
