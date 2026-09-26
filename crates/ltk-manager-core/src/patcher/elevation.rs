//! Whether an injection host needs the UAC bridge.

use crate::config::Config;
#[cfg(not(target_os = "macos"))]
use crate::diagnostics;

/// Whether to spawn the host with `--elevate`.
///
/// Probes the running system, so it can only be called for real; the rule
/// itself is [`elevation_decision`].
#[cfg_attr(target_os = "macos", allow(unused_variables))]
pub fn should_elevate(config: &Config) -> bool {
    // On macOS, reading and writing the game's memory (`task_for_pid`) needs
    // root, so the host always takes the elevation bridge unless the manager is
    // already root — in which case the spawned host inherits root and skips the
    // prompt on its own. The Windows opt-in/admin heuristic does not apply.
    #[cfg(target_os = "macos")]
    {
        let manager_elevated = manager_is_root();
        let should_elevate = !manager_elevated;
        tracing::info!(
            "Injector elevation = {should_elevate} (macOS; manager_root={manager_elevated})"
        );
        return should_elevate;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let manager_elevated = diagnostics::manager_is_elevated();
        let league_admin = diagnostics::league_configured_as_admin();
        let should_elevate =
            elevation_decision(config.elevate_injector, league_admin, manager_elevated);
        tracing::info!(
            "Injector elevation = {should_elevate} (opt_in={}, league_admin={league_admin}, manager_elevated={manager_elevated})",
            config.elevate_injector
        );
        should_elevate
    }
}

/// Whether the manager process itself is running as root (macOS).
#[cfg(target_os = "macos")]
fn manager_is_root() -> bool {
    // SAFETY: `geteuid` is always safe to call and has no preconditions.
    unsafe { libc::geteuid() == 0 }
}

/// Elevate when the user opts in or League runs as admin, but never when the
/// manager is already elevated: a host it spawns inherits high integrity, so the
/// UAC bridge would only add a redundant prompt.
#[cfg_attr(target_os = "macos", allow(dead_code))]
fn elevation_decision(opt_in: bool, league_admin: bool, manager_elevated: bool) -> bool {
    !manager_elevated && (opt_in || league_admin)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unelevated_manager_elevates_on_opt_in_or_an_admin_league() {
        assert!(!elevation_decision(false, false, false));
        assert!(elevation_decision(true, false, false));
        assert!(elevation_decision(false, true, false));
        assert!(elevation_decision(true, true, false));
    }

    /// An elevated manager already spawns high-integrity hosts, so the bridge
    /// would only cost the user a second UAC prompt for nothing.
    #[test]
    fn an_elevated_manager_never_elevates_the_host() {
        for opt_in in [false, true] {
            for league_admin in [false, true] {
                assert!(
                    !elevation_decision(opt_in, league_admin, true),
                    "opt_in={opt_in} league_admin={league_admin}"
                );
            }
        }
    }
}
