//! The patcher's domain errors.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::injector::InjectorError;
use super::session::SessionError;

/// Which stage of a start failed, for [`PatcherError::InjectionFailed`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum InjectionStage {
    /// The host process never came up - it could not be spawned, configured, or
    /// told to start. Antivirus, a missing binary or a declined UAC prompt are
    /// the usual causes, so diagnostics are the useful response.
    Host,
    /// The host ran, but the game was never patched.
    Injection,
}

impl std::fmt::Display for InjectionStage {
    /// The stage as an evidence line names it.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.pad(match self {
            Self::Host => "host startup",
            Self::Injection => "DLL injection",
        })
    }
}

/// Domain errors specific to the patcher.
///
/// Sent over IPC as the `context` payload of an `AppError` with code `PATCHER`.
/// Frontend code can switch on `kind` to handle each variant.
#[derive(Debug, Clone, Serialize, Deserialize, Error)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
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

    /// One injection session failed. `stage` separates a host that never came up
    /// from a game that was never patched, since they call for different advice.
    #[error("{message}")]
    InjectionFailed {
        stage: InjectionStage,
        message: String,
    },
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
