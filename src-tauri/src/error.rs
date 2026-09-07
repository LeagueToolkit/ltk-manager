//! How a domain error reaches the frontend.
//!
//! [`AppError`] itself lives in core and says only what went wrong. This module
//! owns the IPC representation of it: the [`AppErrorResponse`] payload, tagged
//! on a stable `code` the frontend matches on and carrying the fields it
//! translates over, and the [`IpcResult`] envelope every command returns. The
//! `From<AppError>` mapping below is the single place that decides which
//! variants collapse to the same code and which fields each carries.

use serde::{Deserialize, Serialize};
use specta::datatype::{DataType, Enum, Field, Variant};
use ts_rs::TS;

use ltk_manager_core::bin_document::BinDocumentError;
pub use ltk_manager_core::error::{AppError, AppResult, OverlayErrorCategory, Utf8PathExt};
use ltk_manager_core::launcher::LauncherError;
use ltk_manager_core::patcher::PatcherError;
use ltk_manager_core::workshop::WorkshopError;

use crate::github::{GitHubError, GitHubErrorKind};

/// What went wrong, as the fields the frontend translates over.
///
/// The frontend owns every sentence a user reads (ADR-0017), so no variant
/// carries one. A `detail` is prose from outside the app, such as an OS or
/// crate error, which the frontend draws as data under a title of its own.
#[derive(Debug, Clone, Serialize, Deserialize, TS, specta::Type)]
#[ts(export, rename = "AppError")]
#[serde(
    tag = "code",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase"
)]
pub enum AppErrorResponse {
    /// File system I/O failed.
    Io { detail: String },
    /// JSON could not be read or written.
    Serialization { detail: String },
    /// A `.modpkg` could not be processed.
    Modpkg { detail: String },
    /// No League of Legends installation is configured.
    LeagueNotFound,
    /// A file or directory path cannot be used.
    InvalidPath { path: String },
    /// No installed mod has this id.
    ModNotFound { mod_id: String },
    /// Input failed validation.
    ValidationFailed { detail: String },
    /// Internal state was not what the operation needed.
    InternalState { detail: String },
    /// A failure with no code of its own.
    Unknown { detail: String },
    /// No workshop directory is configured.
    WorkshopNotConfigured,
    /// No workshop project has this name.
    ProjectNotFound { project_name: String },
    /// A workshop project with this name already exists.
    ProjectAlreadyExists { project_name: String },
    /// A workshop project could not be packed.
    PackFailed { detail: String },
    /// A `.fantome` could not be processed.
    Fantome { detail: String },
    /// A WAD could not be read or built.
    Wad { detail: String },
    /// The patcher refused or a start failed. The variant says which.
    ///
    /// One code, not one per [`PatcherError`] variant: the whole error travels,
    /// so a code per variant would put the same discriminant on the wire twice.
    Patcher { error: PatcherError },
    /// A ZIP archive could not be processed.
    Zip { detail: String },
    /// The library index was written by a newer app version.
    SchemaVersionTooNew {
        file_version: u32,
        max_supported: u32,
    },
    /// A workshop operation failed. The variant says which.
    Workshop { error: WorkshopError },
    /// A launch failed. The variant says which and carries its remedy's inputs.
    Launcher { error: LauncherError },
    /// A hashtable cache operation failed.
    ///
    /// `HashtableError` is not `Serialize`, so the detail is where the
    /// variant's own words ride.
    Hashtable { detail: String },
    /// An asset could not be previewed.
    Preview { detail: String },
    /// The bytes are not a bin the toolkit reads.
    BinUnreadable { detail: String },
    /// No open bin document has the id. A close and an eviction both remove one.
    BinNotOpen,
    /// No node of the open bin has the address.
    BinNodeNotFound { address: String },
    /// A projected read asked for more rows than one call answers.
    BinReadTooWide { rows: usize, cap: usize },
    /// An overlay build or analysis failed.
    ///
    /// One code with a category, not one per category: `ltk_overlay::Error`
    /// is `#[non_exhaustive]`, so a new category arrives as
    /// [`OverlayErrorCategory::Other`] rather than as a code the frontend has
    /// never heard of.
    Overlay {
        category: OverlayErrorCategory,
        detail: String,
    },
    /// A download was asked for from a domain the trusted providers list omits.
    UntrustedDomain { domain: String },
    /// Something GitHub publishes could not be read. The kind says which
    /// remedy applies, and the feed says what was being read.
    #[serde(rename = "GITHUB")]
    GitHub {
        feed: GitHubFeed,
        kind: GitHubErrorKind,
        detail: String,
    },
}

/// Which of the things GitHub publishes a read was after.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS, specta::Type)]
#[ts(export)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GitHubFeed {
    Releases,
    Announcements,
    Notices,
}

impl AppErrorResponse {
    /// A failed read of `feed`, as the remedy the frontend translates over.
    pub fn github(feed: GitHubFeed, error: GitHubError) -> Self {
        Self::GitHub {
            feed,
            kind: error.kind(),
            detail: error.to_string(),
        }
    }
}

/// Result type for IPC commands.
///
/// ```rust
/// #[tauri::command]
/// pub fn my_command() -> IpcResult<String> {
///     my_command_inner().into()
/// }
///
/// fn my_command_inner() -> AppResult<String> {
///     Ok("value".to_string())
/// }
/// ```
///
/// Serializes to: `{ "ok": true, "value": T }` or `{ "ok": false, "error": ... }`
#[derive(Debug, Clone)]
pub enum IpcResult<T> {
    Ok { value: T },
    Err { error: AppErrorResponse },
}

// Custom serialization to use actual boolean values for the `ok` field
impl<T: Serialize> Serialize for IpcResult<T> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        match self {
            IpcResult::Ok { value } => {
                let mut state = serializer.serialize_struct("IpcResult", 2)?;
                state.serialize_field("ok", &true)?;
                state.serialize_field("value", value)?;
                state.end()
            }
            IpcResult::Err { error } => {
                let mut state = serializer.serialize_struct("IpcResult", 2)?;
                state.serialize_field("ok", &false)?;
                state.serialize_field("error", error)?;
                state.end()
            }
        }
    }
}

/// The same two objects the `Serialize` above writes, as the exporter reads them.
///
/// Hand-written for the same reason that impl is: `ok` is the literal `true` or
/// `false`, which no derive expresses. The pair is one edit.
impl<T: specta::Type> specta::Type for IpcResult<T> {
    fn definition(types: &mut specta::Types) -> DataType {
        let mut shape = Enum::default();
        shape.variants = vec![
            (
                "Ok".into(),
                Variant::named()
                    .field("ok", literal("true"))
                    .field("value", Field::new(T::definition(types)))
                    .build(),
            ),
            (
                "Err".into(),
                Variant::named()
                    .field("ok", literal("false"))
                    .field("error", Field::new(AppErrorResponse::definition(types)))
                    .build(),
            ),
        ];
        /* A union of the two, rather than one object per variant name. The key is
        `specta_serde`'s, which is where an exporter reads the representation from. */
        shape.attributes.insert("serde:container:untagged", true);
        DataType::Enum(shape)
    }
}

/// A field holding one TypeScript literal, which specta has no datatype for.
fn literal(value: &'static str) -> Field {
    Field::new(DataType::Reference(specta_typescript::define(value)))
}

impl<T> IpcResult<T> {
    pub fn ok(value: T) -> Self {
        IpcResult::Ok { value }
    }

    pub fn err(error: impl Into<AppErrorResponse>) -> Self {
        IpcResult::Err {
            error: error.into(),
        }
    }
}

impl<T, E: Into<AppErrorResponse>> From<Result<T, E>> for IpcResult<T> {
    fn from(result: Result<T, E>) -> Self {
        match result {
            Ok(value) => IpcResult::Ok { value },
            Err(e) => IpcResult::Err { error: e.into() },
        }
    }
}

impl From<AppError> for AppErrorResponse {
    fn from(error: AppError) -> Self {
        match error {
            AppError::Io(e) => Self::Io {
                detail: e.to_string(),
            },
            AppError::Serialization(e) => Self::Serialization {
                detail: e.to_string(),
            },
            AppError::Modpkg(e) => Self::Modpkg {
                detail: e.to_string(),
            },
            AppError::LeagueNotFound => Self::LeagueNotFound,
            AppError::InvalidPath(path) => Self::InvalidPath { path },
            AppError::ModNotFound(mod_id) => Self::ModNotFound { mod_id },
            AppError::ValidationFailed(detail) => Self::ValidationFailed { detail },
            AppError::InternalState(detail) => Self::InternalState { detail },
            AppError::Other(detail) => Self::Unknown { detail },
            AppError::WorkshopNotConfigured => Self::WorkshopNotConfigured,
            AppError::ProjectNotFound(project_name) => Self::ProjectNotFound { project_name },
            AppError::ProjectAlreadyExists(project_name) => {
                Self::ProjectAlreadyExists { project_name }
            }
            AppError::PackFailed(detail) => Self::PackFailed { detail },
            AppError::Fantome(detail) => Self::Fantome { detail },
            AppError::WadError(e) => Self::Wad {
                detail: e.to_string(),
            },
            AppError::WadBuilderError(e) => Self::Wad {
                detail: e.to_string(),
            },
            AppError::Patcher(error) => Self::Patcher { error },
            AppError::Launcher(error) => Self::Launcher { error },
            AppError::ZipError(e) => Self::Zip {
                detail: e.to_string(),
            },
            AppError::SchemaVersionTooNew {
                file_version,
                max_supported,
            } => Self::SchemaVersionTooNew {
                file_version,
                max_supported,
            },
            AppError::Workshop(error) => Self::Workshop { error },
            AppError::Hashtable(e) => Self::Hashtable {
                detail: e.to_string(),
            },
            AppError::Preview(e) => Self::Preview {
                detail: e.to_string(),
            },
            AppError::BinDocument(BinDocumentError::Unreadable(e)) => Self::BinUnreadable {
                detail: e.to_string(),
            },
            AppError::BinDocument(BinDocumentError::NotOpen(_)) => Self::BinNotOpen,
            AppError::BinDocument(BinDocumentError::NodeNotFound { address }) => {
                Self::BinNodeNotFound { address }
            }
            AppError::BinDocument(BinDocumentError::ReadTooWide { rows, cap }) => {
                Self::BinReadTooWide { rows, cap }
            }
            AppError::Overlay(e) => Self::Overlay {
                category: OverlayErrorCategory::from(&e),
                detail: e.to_string(),
            },
            AppError::UntrustedDomain(domain) => Self::UntrustedDomain { domain },
        }
    }
}

#[cfg(test)]
mod tests;
