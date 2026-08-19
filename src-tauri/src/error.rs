//! How a domain error reaches the frontend.
//!
//! [`AppError`] itself lives in core and says only what went wrong. This module
//! owns the IPC representation of it: a stable [`ErrorCode`] the frontend can
//! match on, the [`AppErrorResponse`] payload, and the [`IpcResult`] envelope
//! every command returns. The `From<AppError>` mapping below is the single place
//! that decides which variants collapse to the same code and which carry context.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub use ltk_manager_core::error::{AppError, AppResult, MutexResultExt, Utf8PathExt};
use ltk_manager_core::hashtables::HashtableError;
use ltk_manager_core::launcher::LauncherError;

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
    /// Patcher domain error. The specific variant is in `context.kind`.
    Patcher,
    /// ZIP error
    Zip,
    /// Library index was written by a newer app version
    SchemaVersionTooNew,
    /// Workshop domain error. The specific variant is in `context.kind`.
    Workshop,
    /// No Riot Client owns the configured League installation.
    RiotClientNotFound,
    /// A Riot Client is running but did not accept the launch request.
    RiotClientUnreachable,
    /// The Riot Client understood the launch request and refused it. The remedy
    /// is the player's to apply, and `context.riotErrorCode` says which one.
    LaunchRefused,
    /// The launch failed for a reason with no specific remedy.
    LaunchFailed,
    /// No platform directory for the hashtable cache could be resolved.
    HashtableCacheDirUnavailable,
    /// The hashtable cache manifest exists but is unreadable or corrupt.
    HashtableManifestInvalid,
    /// Another process is already syncing the hashtable cache.
    HashtableSyncLocked,
    /// A hashtable sync failed while downloading or installing tables.
    HashtableSyncFailed,
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

            AppError::Patcher(patcher_err) => {
                let mut response =
                    AppErrorResponse::new(ErrorCode::Patcher, patcher_err.to_string());
                response.context = serde_json::to_value(&patcher_err).ok();
                response
            }

            // Unlike the patcher, each launcher failure gets its own code: the
            // frontend offers a different remedy for each, so collapsing them
            // into one code plus a `kind` would just move the switch.
            AppError::Launcher(launcher_err) => {
                let code = match launcher_err {
                    LauncherError::RiotClientNotFound { .. } => ErrorCode::RiotClientNotFound,
                    LauncherError::RiotClientUnreachable { .. } => ErrorCode::RiotClientUnreachable,
                    LauncherError::LaunchRefused { .. } => ErrorCode::LaunchRefused,
                    LauncherError::SpawnFailed { .. } | LauncherError::UnsupportedPlatform => {
                        ErrorCode::LaunchFailed
                    }
                };
                let mut response = AppErrorResponse::new(code, launcher_err.to_string());
                response.context = serde_json::to_value(&launcher_err).ok();
                response
            }

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

            AppError::Hashtable(hashtable_err) => {
                let code = match &hashtable_err {
                    HashtableError::NoCacheDir(_) => ErrorCode::HashtableCacheDirUnavailable,
                    HashtableError::Manifest(_) => ErrorCode::HashtableManifestInvalid,
                    HashtableError::SyncLocked => ErrorCode::HashtableSyncLocked,
                    HashtableError::Http(_) | HashtableError::Sync(_) => {
                        ErrorCode::HashtableSyncFailed
                    }
                };
                AppErrorResponse::new(code, hashtable_err.to_string())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ltk_manager_core::patcher::injector::InjectorError;
    use ltk_manager_core::patcher::session::SessionError;
    use ltk_manager_core::patcher::{InjectionStage, PatcherError};

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
            serde_json::to_string(&ErrorCode::Patcher).unwrap(),
            "\"PATCHER\""
        );
        assert_eq!(
            serde_json::to_string(&ErrorCode::HashtableSyncLocked).unwrap(),
            "\"HASHTABLE_SYNC_LOCKED\""
        );
    }

    #[test]
    fn hashtable_sync_locked_gets_its_own_code() {
        let resp: AppErrorResponse = AppError::Hashtable(HashtableError::SyncLocked).into();
        assert_eq!(resp.code, ErrorCode::HashtableSyncLocked);
        assert!(resp.message.contains("already syncing"));
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
            ErrorCode::Patcher,
            ErrorCode::Zip,
            ErrorCode::SchemaVersionTooNew,
            ErrorCode::Workshop,
            ErrorCode::RiotClientNotFound,
            ErrorCode::RiotClientUnreachable,
            ErrorCode::LaunchRefused,
            ErrorCode::LaunchFailed,
            ErrorCode::HashtableCacheDirUnavailable,
            ErrorCode::HashtableManifestInvalid,
            ErrorCode::HashtableSyncLocked,
            ErrorCode::HashtableSyncFailed,
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
    fn app_error_to_response_patcher_carries_the_variant_in_context() {
        let resp: AppErrorResponse = AppError::Patcher(PatcherError::Busy).into();
        assert_eq!(resp.code, ErrorCode::Patcher);
        assert_eq!(resp.context.unwrap()["kind"], "BUSY");
    }

    /// Every patcher failure shares one code, so `context.kind` is the only
    /// thing separating them - it must survive the mapping for each variant.
    #[test]
    fn every_patcher_variant_reaches_the_frontend_distinguishable() {
        let kinds = [
            (PatcherError::Busy, "BUSY"),
            (PatcherError::AlreadyRunning, "ALREADY_RUNNING"),
            (PatcherError::NotRunning, "NOT_RUNNING"),
            (PatcherError::UnsupportedPlatform, "UNSUPPORTED_PLATFORM"),
            (
                PatcherError::InjectionFailed {
                    stage: InjectionStage::Host,
                    message: "host died".to_string(),
                },
                "INJECTION_FAILED",
            ),
        ];
        for (error, expected) in kinds {
            let resp: AppErrorResponse = AppError::Patcher(error).into();
            assert_eq!(resp.code, ErrorCode::Patcher);
            assert_eq!(resp.context.unwrap()["kind"], expected);
        }
    }

    #[test]
    fn injection_failure_context_keeps_the_stage_and_the_reason() {
        let error = PatcherError::from(SessionError::Injector(InjectorError::Failed(
            "DLL never attached after 60s".to_string(),
        )));
        let resp: AppErrorResponse = AppError::Patcher(error).into();

        assert!(resp.message.contains("DLL never attached"));
        let context = resp.context.unwrap();
        assert_eq!(context["kind"], "INJECTION_FAILED");
        assert_eq!(context["stage"], "INJECTION");
    }

    /// Each launcher failure has its own remedy in the UI, so each must arrive
    /// under its own code rather than sharing one with a discriminating field.
    #[test]
    fn every_launcher_variant_gets_its_own_code() {
        let cases = [
            (
                LauncherError::RiotClientNotFound {
                    installs_path: "C:/ProgramData/…/RiotClientInstalls.json".to_string(),
                },
                ErrorCode::RiotClientNotFound,
            ),
            (
                LauncherError::RiotClientUnreachable {
                    reason: "HTTP 404".to_string(),
                },
                ErrorCode::RiotClientUnreachable,
            ),
            (
                LauncherError::SpawnFailed {
                    reason: "access denied".to_string(),
                },
                ErrorCode::LaunchFailed,
            ),
            (LauncherError::UnsupportedPlatform, ErrorCode::LaunchFailed),
        ];

        for (error, expected) in cases {
            let resp: AppErrorResponse = AppError::Launcher(error).into();
            assert_eq!(resp.code, expected);
        }
    }

    #[test]
    fn riot_client_not_found_carries_the_path_it_tried() {
        let resp: AppErrorResponse = AppError::Launcher(LauncherError::RiotClientNotFound {
            installs_path: "C:/ProgramData/Riot Games/RiotClientInstalls.json".to_string(),
        })
        .into();

        let context = resp.context.unwrap();
        assert_eq!(context["kind"], "RIOT_CLIENT_NOT_FOUND");
        assert_eq!(
            context["installsPath"],
            "C:/ProgramData/Riot Games/RiotClientInstalls.json"
        );
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
    fn app_error_response_context_skipped_when_none() {
        let resp = AppErrorResponse::new(ErrorCode::Io, "err");
        let json = serde_json::to_value(&resp).unwrap();
        assert!(json.get("context").is_none());
    }
}
