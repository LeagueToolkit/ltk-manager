//! Process-level diagnostics: manager-not-admin, riot-not-admin, league-not-running.
//!
//! The supported configuration is an unelevated manager and an unelevated League. A patcher
//! start refuses an elevated manager, and an elevated game cannot be injected from an
//! unelevated host.

use super::{Category, Check, CheckSpec, Severity};

#[cfg(target_os = "windows")]
use super::CheckDetail;
#[cfg(target_os = "windows")]
use super::elevation::{self, ElevationCause, ElevationFacts};

const MANAGER_NOT_ADMIN: CheckSpec = CheckSpec::new(
    "process.manager_not_admin",
    "LTK Manager not running as admin",
    Category::Manager,
);
const RIOT_NOT_ADMIN: CheckSpec = CheckSpec::new(
    "process.riot_not_admin",
    "League and Riot Client not running as admin",
    Category::League,
);
const LEAGUE_NOT_RUNNING: CheckSpec = CheckSpec::new(
    "process.league_not_running",
    "League is not currently running",
    Category::Manager,
);

/// Executables of the Riot Client and League that a session injects into or launches from.
///
/// Vanguard is left out, because its service runs as SYSTEM by design.
#[cfg(target_os = "windows")]
const RIOT_EXES: &[&str] = &[
    ritoclient::processes::RIOT_CLIENT_EXE,
    "riotclientux.exe",
    crate::launcher::LEAGUE_CLIENT_EXE,
    "leagueclientux.exe",
    crate::launcher::LEAGUE_GAME_EXE,
];

#[cfg(target_os = "windows")]
pub fn check_manager_not_admin() -> Check {
    let facts = elevation::facts();
    if !facts.elevated {
        let mut c = MANAGER_NOT_ADMIN.ok("Not elevated");
        push_facts(&mut c, &facts);
        return c;
    }

    let cause = facts.cause().unwrap_or(ElevationCause::Unknown);
    let mut c = MANAGER_NOT_ADMIN.result(
        Severity::Bad,
        format!("LTK Manager is running elevated: {}", cause_summary(cause)),
    );
    c.details.push(CheckDetail::new("cause", cause.to_string()));
    push_facts(&mut c, &facts);
    c.suggestion = Some(cause_suggestion(cause, &facts));

    if cause == ElevationCause::CompatLayer
        && let (Some(root), Ok(exe)) = (&facts.compat_layer, std::env::current_exe())
    {
        c.fix_command = Some(super::compat_flags::reg_delete_script(&[(
            root.clone(),
            exe.to_string_lossy().into_owned(),
        )]));
    }

    c
}

#[cfg(not(target_os = "windows"))]
pub fn check_manager_not_admin() -> Check {
    MANAGER_NOT_ADMIN.result(Severity::Info, "Not applicable")
}

/// Adds every fact as a detail row, so a copied report carries them.
#[cfg(target_os = "windows")]
fn push_facts(check: &mut Check, facts: &ElevationFacts) {
    let details = &mut check.details;
    details.push(CheckDetail::new(
        "elevation type",
        facts.elevation_type.to_string(),
    ));
    if let Some(integrity) = facts.integrity_name() {
        details.push(CheckDetail::new("integrity", integrity));
    }
    details.push(CheckDetail::new(
        "shell elevated",
        facts
            .shell_elevated
            .map_or("unknown".to_string(), |elevated| elevated.to_string()),
    ));
    details.push(CheckDetail::new(
        "parent",
        facts
            .parent
            .clone()
            .unwrap_or_else(|| "unknown".to_string()),
    ));
    details.push(CheckDetail::new("UAC", facts.uac_enabled.to_string()));
    details.push(CheckDetail::new(
        "built-in Administrator",
        facts.builtin_administrator.to_string(),
    ));
    if let Some(root) = &facts.compat_layer {
        details.push(CheckDetail::new("RUNASADMIN layer", root.clone()));
    }
}

#[cfg(target_os = "windows")]
fn cause_summary(cause: ElevationCause) -> &'static str {
    match cause {
        ElevationCause::UacDisabled => "User Account Control is off",
        ElevationCause::BuiltinAdministrator => "the built-in Administrator account",
        ElevationCause::CompatLayer => "Run this program as an administrator is on",
        ElevationCause::ElevatedShell => "the Windows shell is elevated",
        ElevationCause::ElevatedParent => "started by an elevated program",
        ElevationCause::RunAsAdministrator => "started with Run as administrator",
        ElevationCause::Unknown => "cause unknown",
    }
}

#[cfg(target_os = "windows")]
fn cause_suggestion(cause: ElevationCause, facts: &ElevationFacts) -> String {
    match cause {
        ElevationCause::UacDisabled => {
            "Every program runs as administrator while User Account Control is off, so the patcher cannot start. Turn it on under User Accounts, Change User Account Control settings, then restart Windows.".to_string()
        }
        ElevationCause::BuiltinAdministrator => {
            "The built-in Administrator account runs every program elevated. Sign in with a normal account, or turn on Admin Approval Mode for the built-in Administrator account in Local Security Policy.".to_string()
        }
        ElevationCause::CompatLayer => {
            "Open the properties of ltk-manager.exe, Compatibility tab, and untick Run this program as an administrator. Or run the command below as administrator, then open LTK Manager again.".to_string()
        }
        ElevationCause::ElevatedShell => {
            "explorer.exe runs as administrator, so every program it starts does too. Sign out and in again, or restart Windows, then open LTK Manager normally.".to_string()
        }
        ElevationCause::ElevatedParent => format!(
            "{} runs as administrator and started LTK Manager. Close LTK Manager and open it from the Start menu or the desktop instead.",
            facts.parent.as_deref().unwrap_or("An elevated program")
        ),
        ElevationCause::RunAsAdministrator => {
            "Close LTK Manager and open it with a plain double-click, not Run as administrator. If a shortcut starts it, untick Run as administrator under its Advanced properties.".to_string()
        }
        ElevationCause::Unknown => {
            "Close LTK Manager and open it normally. If this check stays red, copy this report into a bug report.".to_string()
        }
    }
}

/// Reports a running League or Riot Client process that is elevated.
///
/// Reads the token of each process. A token that refuses the read counts as unknown, which
/// is what an elevated process of the same user answers with.
#[cfg(target_os = "windows")]
pub fn check_riot_not_admin() -> Check {
    let running = ritoclient::processes::list_matching(RIOT_EXES);
    if running.is_empty() {
        return RIOT_NOT_ADMIN.result(Severity::Info, "Not running");
    }

    let mut elevated = Vec::new();
    let mut unknown = Vec::new();
    for (name, pid) in &running {
        match elevation::process_elevated(*pid) {
            Some(true) => elevated.push((name.clone(), *pid)),
            Some(false) => {}
            None => unknown.push((name.clone(), *pid)),
        }
    }

    if !elevated.is_empty() {
        let mut c = RIOT_NOT_ADMIN.result(
            Severity::Bad,
            format!("{} elevated process(es)", elevated.len()),
        );
        for (name, pid) in &elevated {
            c.details.push(CheckDetail::new(name, format!("PID {pid}")));
        }
        c.suggestion = Some(
            "The patcher cannot inject into an elevated game. Close League and the Riot Client, check that neither executable has Run this program as an administrator on, and start the Riot Client normally.".to_string(),
        );
        return c;
    }

    if !unknown.is_empty() {
        let mut c = RIOT_NOT_ADMIN.result(
            Severity::Warn,
            format!(
                "{} process(es) refused the token read, which an elevated process does",
                unknown.len()
            ),
        );
        for (name, pid) in &unknown {
            c.details.push(CheckDetail::new(name, format!("PID {pid}")));
        }
        c.suggestion = Some(
            "A process of the same user that refuses the read is most likely elevated. Close League and the Riot Client and start the Riot Client normally.".to_string(),
        );
        return c;
    }

    RIOT_NOT_ADMIN.ok(format!("{} process(es), none elevated", running.len()))
}

#[cfg(not(target_os = "windows"))]
pub fn check_riot_not_admin() -> Check {
    RIOT_NOT_ADMIN.result(Severity::Info, "Not applicable")
}

/// Whether the current (manager) process is running with an elevated token.
#[cfg(target_os = "windows")]
pub(crate) fn is_running_as_admin() -> bool {
    elevation::current_process_elevated()
}

/// Diagnostic that flags running League/Vanguard processes.
///
/// Currently NOT included in the default suite - see [`super::run_all`]. The
/// problem it tries to surface ("close League before re-running") was noisy
/// for every user who ran diagnostics mid-session, while none of the other
/// checks actually require League to be closed. Kept here so the phase-2
/// Vanguard handle-correlation work can call it and present a more specific
/// signal ("vgc.exe holds a handle on the patcher DLL") instead.
#[cfg(target_os = "windows")]
#[allow(dead_code)]
pub fn check_league_not_running() -> Check {
    let running = ritoclient::processes::list_matching(
        &[
            ritoclient::processes::RIOT_PROCESS_NAMES,
            &[
                "league of legends.exe",
                crate::launcher::LEAGUE_CLIENT_EXE,
                "leagueclientux.exe",
                "leagueclientuxrender.exe",
            ],
        ]
        .concat(),
    );
    if running.is_empty() {
        return LEAGUE_NOT_RUNNING.ok("League is closed");
    }
    let mut c = LEAGUE_NOT_RUNNING.result(
        Severity::Warn,
        format!(
            "{} League/Riot process(es) running - close the game before re-running diagnostics",
            running.len()
        ),
    );
    for (name, pid) in &running {
        c.details
            .push(CheckDetail::new(name, format!("PID {}", pid)));
    }
    c.suggestion = Some(
        "Some checks (especially the patcher DLL lock probe) give cleaner results when League and Vanguard are not running. Close the client and any running game, then re-run diagnostics."
            .into(),
    );
    c
}

#[cfg(not(target_os = "windows"))]
#[allow(dead_code)]
pub fn check_league_not_running() -> Check {
    LEAGUE_NOT_RUNNING.result(Severity::Info, "Not applicable")
}
