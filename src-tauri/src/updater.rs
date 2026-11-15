//! The app's own update, from the check that finds it to the installer that applies it.
//!
//! The installer downloads ahead of the press, so installing is a restart, and one the user
//! never pressed for runs as the app quits. Per ADR-0046.

#[cfg(windows)]
use fs_err as fs;
use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::error::{AppError, AppResult};

/// The event a download reports its percentage on.
pub const DOWNLOAD_PROGRESS_EVENT: &str = "update-download-progress";

/// The event that asks the frontend to show the update dialog.
pub const REQUESTED_EVENT: &str = "update-requested";

/// A release newer than the running build.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PendingUpdate {
    /// The release on offer.
    pub version: String,
    /// The build that is running.
    pub current_version: String,
    /// The release notes, in markdown.
    pub body: Option<String>,
}

impl From<&Update> for PendingUpdate {
    fn from(update: &Update) -> Self {
        Self {
            version: update.version.clone(),
            current_version: update.current_version.clone(),
            body: update.body.clone(),
        }
    }
}

/// The update the last check found, and its installer once downloaded.
#[derive(Default)]
pub struct UpdaterState(Mutex<Option<Staged>>);

struct Staged {
    update: Update,
    installer: Option<Vec<u8>>,
}

impl UpdaterState {
    /// Keep what a check found, and an installer already downloaded for the same release.
    fn offer(&self, found: Option<Update>) {
        let mut staged = self.0.lock();
        match found {
            Some(update)
                if staged
                    .as_ref()
                    .is_some_and(|s| s.update.version == update.version) => {}
            Some(update) => {
                *staged = Some(Staged {
                    update,
                    installer: None,
                })
            }
            None => *staged = None,
        }
    }

    /// The update on offer while its installer is still to download.
    fn awaiting_download(&self) -> AppResult<Option<Update>> {
        match self.0.lock().as_ref() {
            None => Err(nothing_on_offer()),
            Some(Staged {
                installer: Some(_), ..
            }) => Ok(None),
            Some(Staged { update, .. }) => Ok(Some(update.clone())),
        }
    }

    /// Keep `installer` for `version`, unless a later check replaced that release.
    fn keep_installer(&self, version: &str, installer: Vec<u8>) {
        if let Some(staged) = self.0.lock().as_mut() {
            if staged.update.version == version {
                staged.installer = Some(installer);
            }
        }
    }

    /// Drop a downloaded installer, so quitting installs nothing.
    pub fn discard_installer(&self) {
        if let Some(staged) = self.0.lock().as_mut() {
            staged.installer = None;
        }
    }

    /// Returns the version of the release that the last check found. Returns `None` if the
    /// last check found no newer release, or if no check has run.
    pub fn offered_version(&self) -> Option<String> {
        self.0
            .lock()
            .as_ref()
            .map(|staged| staged.update.version.clone())
    }

    fn take_installer(&self) -> Option<(Update, Vec<u8>)> {
        let mut staged = self.0.lock();
        let installer = staged.as_mut()?.installer.take()?;
        staged.take().map(|s| (s.update, installer))
    }
}

/// Bytes received against the download's length, and the percentage last reported.
#[derive(Debug, Default)]
struct Progress {
    received: u64,
    reported: Option<u8>,
}

impl Progress {
    /// Count `chunk` more bytes, answering the percentage when it moved.
    fn advance(&mut self, chunk: usize, total: Option<u64>) -> Option<u8> {
        self.received = self
            .received
            .saturating_add(u64::try_from(chunk).unwrap_or(u64::MAX));
        let total = total.filter(|&total| total > 0)?;
        let percent = u8::try_from((self.received.saturating_mul(100) / total).min(100))
            .expect("a percentage clamped to 100 fits in a u8");
        if self.reported == Some(percent) {
            return None;
        }
        self.reported = Some(percent);
        Some(percent)
    }
}

/// Ask the update endpoint for a release newer than this build, and keep what it offers.
///
/// # Errors
///
/// When the endpoint cannot be reached or answers with a manifest the updater rejects.
pub async fn check(app: &AppHandle) -> AppResult<Option<PendingUpdate>> {
    let found = app
        .updater()
        .map_err(updater_error)?
        .check()
        .await
        .map_err(updater_error)?;
    let pending = found.as_ref().map(PendingUpdate::from);
    app.state::<UpdaterState>().offer(found);
    crate::tray::show_update(app, pending.as_ref().map(|p| p.version.as_str()));
    Ok(pending)
}

/// Download the installer for the update on offer, emitting [`DOWNLOAD_PROGRESS_EVENT`].
///
/// # Errors
///
/// When no update is on offer, or the download or its signature check fails.
pub async fn download(app: &AppHandle) -> AppResult<()> {
    let Some(update) = app.state::<UpdaterState>().awaiting_download()? else {
        return Ok(());
    };
    let mut progress = Progress::default();
    let installer = update
        .download(
            |chunk, total| {
                if let Some(percent) = progress.advance(chunk, total) {
                    let _ = app.emit(DOWNLOAD_PROGRESS_EVENT, percent);
                }
            },
            || {},
        )
        .await
        .map_err(updater_error)?;
    app.state::<UpdaterState>()
        .keep_installer(&update.version, installer);
    Ok(())
}

/// Stop the patcher and hand over to the downloaded installer, which relaunches the app.
///
/// On Windows the installer takes the process over, so this returns only on failure.
///
/// # Errors
///
/// When nothing is downloaded, or the installer cannot be started.
pub fn install(app: &AppHandle) -> AppResult<()> {
    let state = app.state::<UpdaterState>();
    let staged = state.0.lock();
    let Some(Staged {
        update,
        installer: Some(installer),
    }) = staged.as_ref()
    else {
        return Err(AppError::Other("the update is not downloaded".to_string()));
    };
    crate::patcher::shutdown_resources(app);
    update.install(installer).map_err(updater_error)?;
    drop(staged);
    app.restart()
}

/// Run a downloaded installer as the app quits, with no relaunch after it.
pub fn install_on_quit(app: &AppHandle) {
    let Some((update, installer)) = app.state::<UpdaterState>().take_installer() else {
        return;
    };
    match run_installer(&update, &installer) {
        Ok(()) => {
            tracing::info!(version = %update.version, "Installing the update as the app quits")
        }
        Err(error) => tracing::warn!(%error, "The downloaded update could not be run"),
    }
}

/// Passive, and an update so the installer keeps the user's shortcuts. No `/R`, so the app
/// stays closed.
#[cfg(windows)]
const QUIT_INSTALLER_ARGS: [&str; 2] = ["/P", "/UPDATE"];

#[cfg(windows)]
fn run_installer(update: &Update, installer: &[u8]) -> AppResult<()> {
    if !is_executable(installer) {
        return Err(AppError::Other(
            "the downloaded update is not an installer".to_string(),
        ));
    }
    let dir = std::env::temp_dir().join("ltk-manager-update");
    fs::create_dir_all(&dir)?;
    let path = dir.join(format!("ltk-manager-{}-setup.exe", update.version));
    fs::write(&path, installer)?;
    std::process::Command::new(&path)
        .args(QUIT_INSTALLER_ARGS)
        .spawn()?;
    Ok(())
}

#[cfg(not(windows))]
fn run_installer(update: &Update, installer: &[u8]) -> AppResult<()> {
    update.install(installer).map_err(updater_error)
}

/// Whether `bytes` open with the `MZ` signature of a Windows executable.
#[cfg_attr(
    all(not(windows), not(test)),
    expect(dead_code, reason = "only Windows runs the installer itself")
)]
fn is_executable(bytes: &[u8]) -> bool {
    bytes.starts_with(b"MZ")
}

fn nothing_on_offer() -> AppError {
    AppError::Other("no update is on offer".to_string())
}

fn updater_error(error: tauri_plugin_updater::Error) -> AppError {
    AppError::Other(error.to_string())
}

#[cfg(test)]
mod tests;
