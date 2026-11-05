//! The check that no external program controls this manager.

use super::error::PatcherError;
use crate::diagnostics::tamper::{TamperSignal, signals};

/// Fails if a live launcher, debug endpoint, or bridge is present.
pub fn check_untampered(launcher_environment: bool) -> Result<(), PatcherError> {
    let mut signals = signals();
    if launcher_environment {
        signals.push(TamperSignal::LauncherEnvironment);
    }
    if signals.is_empty() {
        return Ok(());
    }

    tracing::warn!(
        ?signals,
        "Refusing to start the patcher: external launcher artifacts are present"
    );
    Err(PatcherError::Tampered)
}
