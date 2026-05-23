use serde::{Deserialize, Serialize};
use thiserror::Error;
use ts_rs::TS;

/// Error codes that can be communicated across the IPC boundary.
/// These are serialized as SCREAMING_SNAKE_CASE for TypeScript consumption.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    /// File system I/O error
    Io,
    /// JSON serialization/deserialization error
    Serialization,
    /// Error processing a .modpkg file
    Modpkg,
    /// League of Legends installation not found
    LeagueNotFound,
    /// Invalid file or directory path
    InvalidPath,
    /// Requested mod was not found
    ModNotFound,
    /// Validation failed (e.g., invalid settings)
    ValidationFailed,
    /// Internal state error (e.g., mutex poisoned)
    InternalState,
    /// Mutex lock failed (poisoned)
    MutexLockFailed,
    /// Unknown/unclassified error
    Unknown,
    /// Workshop directory not configured
    WorkshopNotConfigured,
    /// Workshop project not found
    ProjectNotFound,
    /// Workshop project already exists
    ProjectAlreadyExists,
    /// Failed to pack workshop project
    PackFailed,
    /// Error processing a .fantome file
    Fantome,
    /// WAD file error
    Wad,
    /// Operation blocked because the patcher is running
    PatcherRunning,
    /// ZIP error
    Zip,
    /// Library index was written by a newer app version
    SchemaVersionTooNew,
    /// Workshop domain error. The specific variant is in `context.kind`.
    Workshop,
}

/// Structured error response sent over IPC.
/// This provides rich error information to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, rename = "AppError")]
#[serde(rename_all = "camelCase")]
pub struct AppErrorResponse {
    /// Machine-readable error code for pattern matching
    pub code: ErrorCode,
    /// Human-readable error message
    pub message: String,
    /// Optional contextual data (e.g., the invalid path, missing mod ID)
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "unknown")]
    pub context: Option<serde_json::Value>,
}

impl AppErrorResponse {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            context: None,
        }
    }

    pub fn with_context(mut self, context: impl Serialize) -> Self {
        self.context = serde_json::to_value(context).ok();
        self
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

impl<T> IpcResult<T> {
    pub fn ok(value: T) -> Self {
        IpcResult::Ok { value }
    }

    #[allow(dead_code)]
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

/// Internal application error type with rich error information.
/// This is converted to `AppErrorResponse` when crossing the IPC boundary.
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

    #[error("Cannot modify mods while the patcher is running")]
    PatcherRunning,

    #[error("ZIP error: {0}")]
    ZipError(#[from] zip::result::ZipError),

    #[error("Library index schema version {file_version} is newer than supported version {max_supported}")]
    SchemaVersionTooNew {
        file_version: u32,
        max_supported: u32,
    },

    #[error(transparent)]
    Workshop(#[from] crate::workshop::WorkshopError),
}

impl From<AppError> for AppErrorResponse {
    fn from(error: AppError) -> Self {
        match error {
            AppError::Io(e) => AppErrorResponse::new(ErrorCode::Io, e.to_string()),

            AppError::Serialization(e) => {
                AppErrorResponse::new(ErrorCode::Serialization, e.to_string())
            }

            AppError::Modpkg(e) => AppErrorResponse::new(ErrorCode::Modpkg, e.to_string()),

            AppError::LeagueNotFound => {
                AppErrorResponse::new(ErrorCode::LeagueNotFound, "League installation not found")
            }

            AppError::InvalidPath(path) => {
                AppErrorResponse::new(ErrorCode::InvalidPath, format!("Invalid path: {}", path))
                    .with_context(serde_json::json!({ "path": path }))
            }

            AppError::ModNotFound(id) => {
                AppErrorResponse::new(ErrorCode::ModNotFound, format!("Mod not found: {}", id))
                    .with_context(serde_json::json!({ "modId": id }))
            }

            AppError::ValidationFailed(msg) => {
                AppErrorResponse::new(ErrorCode::ValidationFailed, msg)
            }

            AppError::InternalState(msg) => AppErrorResponse::new(ErrorCode::InternalState, msg),

            AppError::MutexLockFailed => {
                AppErrorResponse::new(ErrorCode::MutexLockFailed, "Failed to acquire mutex lock")
            }

            AppError::Other(msg) => AppErrorResponse::new(ErrorCode::Unknown, msg),

            AppError::WorkshopNotConfigured => AppErrorResponse::new(
                ErrorCode::WorkshopNotConfigured,
                "Workshop directory not configured",
            ),

            AppError::ProjectNotFound(name) => AppErrorResponse::new(
                ErrorCode::ProjectNotFound,
                format!("Project not found: {}", name),
            )
            .with_context(serde_json::json!({ "projectName": name })),

            AppError::ProjectAlreadyExists(name) => AppErrorResponse::new(
                ErrorCode::ProjectAlreadyExists,
                format!("Project already exists: {}", name),
            )
            .with_context(serde_json::json!({ "projectName": name })),

            AppError::PackFailed(msg) => AppErrorResponse::new(ErrorCode::PackFailed, msg),

            AppError::Fantome(msg) => AppErrorResponse::new(ErrorCode::Fantome, msg),

            AppError::WadError(e) => AppErrorResponse::new(ErrorCode::Wad, e.to_string()),

            AppError::WadBuilderError(e) => AppErrorResponse::new(ErrorCode::Wad, e.to_string()),

            AppError::PatcherRunning => AppErrorResponse::new(
                ErrorCode::PatcherRunning,
                "Stop the patcher before modifying mods",
            ),

            AppError::ZipError(e) => AppErrorResponse::new(ErrorCode::Zip, e.to_string()),

            AppError::SchemaVersionTooNew { file_version, max_supported } => AppErrorResponse::new(
                ErrorCode::SchemaVersionTooNew,
                format!(
                    "Your mod library was created by a newer version of the app (schema v{}). This version only supports up to v{}.",
                    file_version, max_supported
                ),
            )
            .with_context(serde_json::json!({ "fileVersion": file_version, "maxSupported": max_supported })),

            AppError::Workshop(workshop_err) => {
                let mut response = AppErrorResponse::new(ErrorCode::Workshop, workshop_err.to_string());
                response.context = serde_json::to_value(&workshop_err).ok();
                response
            }
        }
    }
}

impl From<ltk_mod_project::ModProjectError> for AppError {
    fn from(error: ltk_mod_project::ModProjectError) -> Self {
        match error {
            ltk_mod_project::ModProjectError::ConfigNotFound(path) => {
                AppError::ProjectNotFound(path.display().to_string())
            }
            ltk_mod_project::ModProjectError::Io(e) => AppError::Io(e),
            ltk_mod_project::ModProjectError::Json(e) => AppError::Serialization(e),
            ltk_mod_project::ModProjectError::Toml(e) => AppError::Other(e.to_string()),
            ltk_mod_project::ModProjectError::UnsupportedExtension(ext) => {
                AppError::Other(format!("Unsupported config file extension: {}", ext))
            }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_code_serializes_as_screaming_snake_case() {
        assert_eq!(serde_json::to_string(&ErrorCode::Io).unwrap(), "\"IO\"");
        assert_eq!(
            serde_json::to_string(&ErrorCode::LeagueNotFound).unwrap(),
            "\"LEAGUE_NOT_FOUND\""
        );
        assert_eq!(
            serde_json::to_string(&ErrorCode::ModNotFound).unwrap(),
            "\"MOD_NOT_FOUND\""
        );
        assert_eq!(
            serde_json::to_string(&ErrorCode::InvalidPath).unwrap(),
            "\"INVALID_PATH\""
        );
        assert_eq!(
            serde_json::to_string(&ErrorCode::WorkshopNotConfigured).unwrap(),
            "\"WORKSHOP_NOT_CONFIGURED\""
        );
        assert_eq!(
            serde_json::to_string(&ErrorCode::ProjectAlreadyExists).unwrap(),
            "\"PROJECT_ALREADY_EXISTS\""
        );
        assert_eq!(
            serde_json::to_string(&ErrorCode::PatcherRunning).unwrap(),
            "\"PATCHER_RUNNING\""
        );
    }

    #[test]
    fn error_code_round_trips() {
        for code in [
            ErrorCode::Io,
            ErrorCode::Serialization,
            ErrorCode::Modpkg,
            ErrorCode::LeagueNotFound,
            ErrorCode::InvalidPath,
            ErrorCode::ModNotFound,
            ErrorCode::ValidationFailed,
            ErrorCode::InternalState,
            ErrorCode::MutexLockFailed,
            ErrorCode::Unknown,
            ErrorCode::WorkshopNotConfigured,
            ErrorCode::ProjectNotFound,
            ErrorCode::ProjectAlreadyExists,
            ErrorCode::PackFailed,
            ErrorCode::Fantome,
            ErrorCode::Wad,
            ErrorCode::PatcherRunning,
            ErrorCode::Zip,
            ErrorCode::SchemaVersionTooNew,
            ErrorCode::Workshop,
        ] {
            let json = serde_json::to_string(&code).unwrap();
            let deserialized: ErrorCode = serde_json::from_str(&json).unwrap();
            assert_eq!(deserialized, code);
        }
    }

    #[test]
    fn app_error_response_new() {
        let resp = AppErrorResponse::new(ErrorCode::Io, "disk full");
        assert_eq!(resp.code, ErrorCode::Io);
        assert_eq!(resp.message, "disk full");
        assert!(resp.context.is_none());
    }

    #[test]
    fn app_error_response_with_context() {
        let resp = AppErrorResponse::new(ErrorCode::InvalidPath, "bad path")
            .with_context(serde_json::json!({ "path": "/foo" }));
        assert_eq!(resp.context.unwrap()["path"], "/foo");
    }

    #[test]
    fn app_error_to_response_invalid_path_preserves_context() {
        let error = AppError::InvalidPath("/bad/path".to_string());
        let resp: AppErrorResponse = error.into();
        assert_eq!(resp.code, ErrorCode::InvalidPath);
        assert_eq!(resp.context.unwrap()["path"], "/bad/path");
    }

    #[test]
    fn app_error_to_response_mod_not_found_preserves_context() {
        let error = AppError::ModNotFound("mod123".to_string());
        let resp: AppErrorResponse = error.into();
        assert_eq!(resp.code, ErrorCode::ModNotFound);
        assert_eq!(resp.context.unwrap()["modId"], "mod123");
    }

    #[test]
    fn app_error_to_response_project_not_found_preserves_context() {
        let error = AppError::ProjectNotFound("my-project".to_string());
        let resp: AppErrorResponse = error.into();
        assert_eq!(resp.code, ErrorCode::ProjectNotFound);
        assert_eq!(resp.context.unwrap()["projectName"], "my-project");
    }

    #[test]
    fn app_error_to_response_patcher_running() {
        let error = AppError::PatcherRunning;
        let resp: AppErrorResponse = error.into();
        assert_eq!(resp.code, ErrorCode::PatcherRunning);
        assert!(resp.context.is_none());
    }

    #[test]
    fn ipc_result_ok_serialization() {
        let result: IpcResult<String> = IpcResult::ok("hello".to_string());
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["ok"], true);
        assert_eq!(json["value"], "hello");
    }

    #[test]
    fn ipc_result_err_serialization() {
        let resp = AppErrorResponse::new(ErrorCode::Io, "disk full");
        let result: IpcResult<String> = IpcResult::err(resp);
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["ok"], false);
        assert_eq!(json["error"]["code"], "IO");
        assert_eq!(json["error"]["message"], "disk full");
    }

    #[test]
    fn ipc_result_from_ok() {
        let result: IpcResult<i32> = Ok::<i32, AppErrorResponse>(42).into();
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["ok"], true);
        assert_eq!(json["value"], 42);
    }

    #[test]
    fn ipc_result_from_err() {
        let err = AppErrorResponse::new(ErrorCode::Unknown, "oops");
        let result: IpcResult<i32> = Err::<i32, AppErrorResponse>(err).into();
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["ok"], false);
        assert_eq!(json["error"]["code"], "UNKNOWN");
    }

    #[test]
    fn mutex_result_ext_ok() {
        let mutex = std::sync::Mutex::new(42);
        let guard = mutex.lock().mutex_err().unwrap();
        assert_eq!(*guard, 42);
    }

    #[test]
    fn app_error_response_context_skipped_when_none() {
        let resp = AppErrorResponse::new(ErrorCode::Io, "err");
        let json = serde_json::to_value(&resp).unwrap();
        assert!(json.get("context").is_none());
    }
}
