//! The check that a patcher session runs unelevated.

use super::error::PatcherError;
use crate::diagnostics;

/// Fails if the session would need or inherit high integrity.
///
/// Probes the running system, and the rule itself is `elevation_refusal`.
pub fn check_unelevated() -> Result<(), PatcherError> {
    let manager_elevated = diagnostics::manager_is_elevated();
    let league_admin = diagnostics::league_configured_as_admin();

    match elevation_refusal(league_admin, manager_elevated) {
        Some(refusal) => {
            tracing::warn!(%refusal, "Refusing to start the patcher");
            Err(refusal)
        }
        None => Ok(()),
    }
}

/// Returns the error for an elevated session, or `None` if the session is unelevated.
///
/// The delivered DLL sits in a directory that the user can write, so a high-integrity host
/// must not load it, per `docs/adr/0074-every-session-runs-a-delivered-patcher-dll.md`.
fn elevation_refusal(league_admin: bool, manager_elevated: bool) -> Option<PatcherError> {
    if manager_elevated {
        return Some(PatcherError::ManagerElevated);
    }
    if league_admin {
        return Some(PatcherError::LeagueElevated);
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use assert_matches::assert_matches;

    #[test]
    fn elevation_refusal_is_none_if_nothing_is_elevated() {
        assert!(elevation_refusal(false, false).is_none());
    }

    #[test]
    fn elevation_refusal_names_league_if_only_league_is_elevated() {
        assert_matches!(
            elevation_refusal(true, false),
            Some(PatcherError::LeagueElevated)
        );
    }

    #[test]
    fn elevation_refusal_names_manager_if_manager_is_elevated() {
        for league_admin in [false, true] {
            assert_matches!(
                elevation_refusal(league_admin, true),
                Some(PatcherError::ManagerElevated)
            );
        }
    }
}
