//! The domain error type shared by every backend operation.
//!
//! [`AppError`] describes *what went wrong*, not how to report it. Rendering it
//! for a consumer is the frontend's job: the Tauri shell maps it to an IPC
//! response with a machine-readable code, and a CLI would map the same variants
//! to exit codes and stderr. Keeping that mapping out of core is what lets both
//! exist without one dictating the other's vocabulary.

use camino::{Utf8Path, Utf8PathBuf};
use serde::{Deserialize, Serialize};
use std::fmt;
use std::path::{Path, PathBuf};
use thiserror::Error;

use crate::hashtables::HashtableError;
use crate::launcher::LauncherError;
use crate::patcher::PatcherError;
use crate::preview::PreviewError;
use crate::workshop::WorkshopError;

/// Which [`AppError`] a failure was, as a name that outlives its message.
///
/// A message is for a reader and can be empty. This is the part a consumer
/// switches on, so it survives being recorded, stored and read back long after
/// the error value is gone. The Tauri shell maps it to its own `ErrorCode`, and
/// a CLI could map the same names to exit codes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[non_exhaustive]
pub enum ErrorKind {
    Io,
    Serialization,
    Modpkg,
    LeagueNotFound,
    InvalidPath,
    ModNotFound,
    ValidationFailed,
    InternalState,
    MutexLockFailed,
    Other,
    WorkshopNotConfigured,
    ProjectNotFound,
    ProjectAlreadyExists,
    PackFailed,
    Fantome,
    WadError,
    WadBuilderError,
    Patcher,
    Launcher,
    ZipError,
    SchemaVersionTooNew,
    Workshop,
    Hashtable,
    Preview,
}

impl fmt::Display for ErrorKind {
    /// The variant's own name, which is what a report and an evidence line show.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let name = serde_json::to_string(self).map_err(|_| fmt::Error)?;
        f.pad(name.trim_matches('"'))
    }
}

impl AppError {
    /// Which variant this is, without its message.
    pub fn kind(&self) -> ErrorKind {
        match self {
            AppError::Io { .. } => ErrorKind::Io,
            AppError::Serialization { .. } => ErrorKind::Serialization,
            AppError::Modpkg { .. } => ErrorKind::Modpkg,
            AppError::LeagueNotFound => ErrorKind::LeagueNotFound,
            AppError::InvalidPath { .. } => ErrorKind::InvalidPath,
            AppError::ModNotFound { .. } => ErrorKind::ModNotFound,
            AppError::ValidationFailed { .. } => ErrorKind::ValidationFailed,
            AppError::InternalState { .. } => ErrorKind::InternalState,
            AppError::MutexLockFailed => ErrorKind::MutexLockFailed,
            AppError::Other { .. } => ErrorKind::Other,
            AppError::WorkshopNotConfigured => ErrorKind::WorkshopNotConfigured,
            AppError::ProjectNotFound { .. } => ErrorKind::ProjectNotFound,
            AppError::ProjectAlreadyExists { .. } => ErrorKind::ProjectAlreadyExists,
            AppError::PackFailed { .. } => ErrorKind::PackFailed,
            AppError::Fantome { .. } => ErrorKind::Fantome,
            AppError::WadError { .. } => ErrorKind::WadError,
            AppError::WadBuilderError { .. } => ErrorKind::WadBuilderError,
            AppError::Patcher { .. } => ErrorKind::Patcher,
            AppError::Launcher { .. } => ErrorKind::Launcher,
            AppError::ZipError { .. } => ErrorKind::ZipError,
            AppError::SchemaVersionTooNew { .. } => ErrorKind::SchemaVersionTooNew,
            AppError::Workshop { .. } => ErrorKind::Workshop,
            AppError::Hashtable { .. } => ErrorKind::Hashtable,
            AppError::Preview { .. } => ErrorKind::Preview,
        }
    }
}

/// Internal application error type with rich error information.
#[derive(Debug, Error)]
#[allow(dead_code)]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Modpkg error: {0}")]
    Modpkg(#[from] ltk_modpkg::error::ModpkgError),

    #[error("League installation not found")]
    LeagueNotFound,

    #[error("Invalid path: {0}")]
    InvalidPath(String),

    #[error("Mod not found: {0}")]
    ModNotFound(String),

    #[error("Validation failed: {0}")]
    ValidationFailed(String),

    #[error("Internal state error: {0}")]
    InternalState(String),

    #[error("Failed to acquire mutex lock")]
    MutexLockFailed,

    #[error("{0}")]
    Other(String),

    #[error("Workshop directory not configured")]
    WorkshopNotConfigured,

    #[error("Project not found: {0}")]
    ProjectNotFound(String),

    #[error("Project already exists: {0}")]
    ProjectAlreadyExists(String),

    #[error("Failed to pack project: {0}")]
    PackFailed(String),

    #[error("Fantome error: {0}")]
    Fantome(String),

    #[error("WAD error: {0}")]
    WadError(#[from] ltk_wad::WadError),

    #[error("WAD builder error: {0}")]
    WadBuilderError(#[from] ltk_wad::WadBuilderError),

    #[error(transparent)]
    Patcher(#[from] PatcherError),

    #[error(transparent)]
    Launcher(#[from] LauncherError),

    #[error("ZIP error: {0}")]
    ZipError(#[from] zip::result::ZipError),

    #[error(
        "Library index schema version {file_version} is newer than supported version {max_supported}"
    )]
    SchemaVersionTooNew {
        file_version: u32,
        max_supported: u32,
    },

    #[error(transparent)]
    Workshop(#[from] WorkshopError),

    #[error(transparent)]
    Hashtable(#[from] HashtableError),

    #[error(transparent)]
    Preview(#[from] PreviewError),
}

impl From<ltk_mod_project::ModProjectError> for AppError {
    fn from(error: ltk_mod_project::ModProjectError) -> Self {
        use ltk_mod_project::ModProjectError;

        match error {
            ModProjectError::ConfigNotFound(path) => AppError::ProjectNotFound(path.into_string()),
            ModProjectError::Io { source, .. } => AppError::Io(source),
            ModProjectError::Json { source, .. } => AppError::Serialization(source),
            other => AppError::Other(other.to_string()),
        }
    }
}

/// Convenience type alias for internal Result usage
pub type AppResult<T> = Result<T, AppError>;

/// Extension trait for converting `Result<T, PoisonError>` to `AppResult<T>`.
pub trait MutexResultExt<T> {
    fn mutex_err(self) -> AppResult<T>;
}

impl<T, E> MutexResultExt<T> for Result<T, std::sync::PoisonError<E>> {
    fn mutex_err(self) -> AppResult<T> {
        self.map_err(|_| AppError::MutexLockFailed)
    }
}

/// Extension trait for converting an owned `PathBuf` into a `Utf8PathBuf`,
/// mapping a non-UTF-8 path to an [`AppError::InvalidPath`] labeled with what
/// the path represents (e.g. `"game directory"`).
pub trait Utf8PathExt {
    fn try_into_utf8(self, label: &str) -> AppResult<Utf8PathBuf>;
}

impl Utf8PathExt for PathBuf {
    fn try_into_utf8(self, label: &str) -> AppResult<Utf8PathBuf> {
        Utf8PathBuf::from_path_buf(self)
            .map_err(|p| AppError::InvalidPath(format!("Non-UTF-8 {label}: {}", p.display())))
    }
}

/// The borrowing counterpart to [`Utf8PathExt`], for the many `&Path` values
/// the workshop still holds while the mod-project crates speak camino.
pub trait Utf8PathRefExt {
    fn try_as_utf8(&self, label: &str) -> AppResult<&Utf8Path>;
}

impl Utf8PathRefExt for Path {
    fn try_as_utf8(&self, label: &str) -> AppResult<&Utf8Path> {
        Utf8Path::from_path(self)
            .ok_or_else(|| AppError::InvalidPath(format!("Non-UTF-8 {label}: {}", self.display())))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mutex_result_ext_ok() {
        let mutex = std::sync::Mutex::new(42);
        let guard = mutex.lock().mutex_err().unwrap();
        assert_eq!(*guard, 42);
    }

    #[test]
    fn utf8_path_ext_converts_valid_path() {
        let utf8 = PathBuf::from("/tmp/foo/bar")
            .try_into_utf8("test path")
            .unwrap();
        assert_eq!(utf8.as_str(), "/tmp/foo/bar");
    }
}
