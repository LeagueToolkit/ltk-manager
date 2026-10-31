//! The patcher's domain errors.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::injector::InjectorError;
use super::session::SessionError;
use ltk_manager_base::error::{AppError, DomainError, ErrorKind};

/// Which stage of a start failed, for [`PatcherError::InjectionFailed`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, strum::Display)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum InjectionStage {
    /// The host process never came up - it could not be spawned, configured, or
    /// told to start. Antivirus or a missing binary are the usual causes, so
    /// diagnostics are the useful response.
    #[strum(to_string = "host startup")]
    Host,
    /// The host ran, but the game was never patched.
    #[strum(to_string = "DLL injection")]
    Injection,
}

/// Domain errors specific to the patcher.
///
/// Sent over IPC as the `context` payload of an `AppError` with code `PATCHER`.
/// Frontend code can switch on `kind` to handle each variant.
#[derive(Debug, Clone, Serialize, Deserialize, Error)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PatcherError {
    /// Something that mutates the mod library was rejected because a session is
    /// live and pointed at the very files it would rewrite. The caller has to
    /// stop the patcher first - unlike [`Self::AlreadyRunning`], this is not a
    /// stale-status problem.
    #[error("Stop the patcher before modifying mods")]
    Busy,

    /// A start was requested while a session is already live. Benign: it usually
    /// just means the caller's view of the status is stale.
    #[error("The patcher is already running")]
    AlreadyRunning,

    /// A stop was requested while nothing was running.
    #[error("The patcher is not running")]
    NotRunning,

    #[error("The patcher is not yet available on this platform")]
    UnsupportedPlatform,

    /// League is set to run as administrator, and a session runs unelevated.
    #[error("League is set to run as administrator. Turn that off, then start the patcher again")]
    LeagueElevated,

    /// LTK Manager runs as administrator, and a session runs unelevated.
    #[error(
        "LTK Manager is running as administrator. Reopen it normally, or turn on User Account \
         Control if it is off, to start the patcher"
    )]
    ManagerElevated,

    /// No patcher DLL could be selected for the session. `message` says why.
    #[error("{message}")]
    DllUnavailable { message: String },

    /// One injection session failed. `stage` separates a host that never came up
    /// from a game that was never patched, since they call for different advice.
    #[error("{message}")]
    InjectionFailed {
        stage: InjectionStage,
        message: String,
    },
}

impl From<PatcherError> for AppError {
    fn from(error: PatcherError) -> Self {
        Self::Domain(DomainError::new(ErrorKind::Patcher, error))
    }
}

impl From<SessionError> for PatcherError {
    fn from(error: SessionError) -> Self {
        // Classified by the innermost error, not by how deep it nested: a
        // `HostError` reaching us through the injector is still a host failure.
        let stage = match &error {
            SessionError::Host(_) | SessionError::Injector(InjectorError::Host(_)) => {
                InjectionStage::Host
            }
            SessionError::Injector(InjectorError::Failed(_)) => InjectionStage::Injection,
        };
        Self::InjectionFailed {
            stage,
            message: error.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::patcher::host::HostError;

    #[test]
    fn a_host_that_never_came_up_is_a_host_stage_failure() {
        let error = PatcherError::from(SessionError::Host(HostError::StdoutClosed));
        assert!(matches!(
            error,
            PatcherError::InjectionFailed {
                stage: InjectionStage::Host,
                ..
            }
        ));
    }

    /// A `HostError` reaching us through the injector is still a host failure -
    /// the stage is decided by the innermost error, not by the nesting.
    #[test]
    fn a_host_error_through_the_injector_is_still_a_host_stage_failure() {
        let error = PatcherError::from(SessionError::Injector(InjectorError::Host(
            HostError::StdinClosed,
        )));
        assert!(matches!(
            error,
            PatcherError::InjectionFailed {
                stage: InjectionStage::Host,
                ..
            }
        ));
    }

    #[test]
    fn a_dll_that_never_attached_is_an_injection_stage_failure() {
        let error = PatcherError::from(SessionError::Injector(InjectorError::Failed(
            "DLL never attached after 60s".to_string(),
        )));
        assert!(matches!(
            error,
            PatcherError::InjectionFailed {
                stage: InjectionStage::Injection,
                message
            } if message.contains("DLL never attached")
        ));
    }

    /// The `kind` tag is the frontend's switch; unit variants must carry it too.
    #[test]
    fn variants_serialize_with_a_kind_tag() {
        let json = serde_json::to_value(PatcherError::AlreadyRunning).unwrap();
        assert_eq!(json["kind"], "ALREADY_RUNNING");

        let json = serde_json::to_value(PatcherError::InjectionFailed {
            stage: InjectionStage::Host,
            message: "host died".to_string(),
        })
        .unwrap();
        assert_eq!(json["kind"], "INJECTION_FAILED");
        assert_eq!(json["stage"], "HOST");
        assert_eq!(json["message"], "host died");
    }
}
