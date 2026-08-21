//! Diagnostics: the system checks, and League diagnostics for the game.
//!
//! The system checks are pure functions that each return a [`Check`], and the
//! report is the ordered list of them. They are read-only, and fixes are shown
//! as commands the user runs in an elevated terminal.
//!
//! League diagnostics is the minute after a game goes wrong while the patcher
//! runs. The [`game_log`] reader turns the game's own log into facts, the
//! [`log_codes`] table names what it can, the [`incident`] classifier reaches a
//! verdict, the [`store`] keeps it, and [`token`] folds it into one string.

use serde::Serialize;
use std::path::PathBuf;

pub mod binary_id;
mod compat_flags;
pub mod exit_status;
pub mod game_log;
pub mod incident;
mod library_index;
pub mod log_codes;
mod patcher_dll;
mod paths;
pub(crate) mod processes;
pub mod report;
mod storage_medium;
pub mod store;
pub mod token;
mod windows;

#[cfg(target_os = "windows")]
pub(crate) mod win_util;

/// Severity of a diagnostic check result.
///
/// Variants are declared best-to-worst (`Ok < Info < Warn < Bad`). The
/// frontend re-sorts to display worst-first; do not derive `Ord` from this
/// declaration order without revisiting the UI sort logic in
/// `DiagnosticsReport.tsx`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    /// Check passed.
    Ok,
    /// Informational - no action needed (e.g. CPU model, language).
    Info,
    /// Suspicious - may cause problems, worth investigating.
    Warn,
    /// Known to break the patcher, should be fixed.
    Bad,
}

/// Coarse grouping for the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "lowercase")]
pub enum Category {
    /// OS-level checks (Windows version, UAC, long paths).
    System,
    /// League installation checks (path, writability, compat flags).
    League,
    /// LTK Manager checks (admin status, install path).
    Manager,
    /// Patcher / DLL checks (presence, signature, locked-by handles).
    Patcher,
    /// Storage / mod-storage path checks.
    Storage,
    /// Mod library state checks (index integrity).
    Library,
}

/// A single key/value detail row attached to a check.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct CheckDetail {
    pub key: String,
    pub value: String,
}

impl CheckDetail {
    pub fn new(key: impl Into<String>, value: impl Into<String>) -> Self {
        Self {
            key: key.into(),
            value: value.into(),
        }
    }
}

/// Result of a single diagnostic check.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct Check {
    /// Stable identifier (e.g. `"windows.long_paths"`). Survives label changes.
    pub id: String,
    /// Human-readable label.
    pub label: String,
    pub category: Category,
    pub severity: Severity,
    /// One-line summary of the result, shown next to the label.
    pub summary: String,
    /// Optional structured details, shown when the row is expanded.
    #[serde(default)]
    pub details: Vec<CheckDetail>,
    /// Optional plain-text guidance for the user.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub suggestion: Option<String>,
    /// Optional command (PowerShell / cmd / shell) to run as a fix. Shown
    /// alongside the suggestion with a copy button.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub fix_command: Option<String>,
}

/// Full diagnostic report returned by `run_diagnostics`.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticReport {
    /// ISO-8601 UTC timestamp.
    pub generated_at: String,
    /// Manager version (matches `Cargo.toml`).
    pub app_version: String,
    /// All checks in display order.
    pub checks: Vec<Check>,
}

/// Context passed to each check. Keeps individual checks free of `tauri`
/// dependencies so they remain unit-testable.
pub struct CheckCtx {
    /// League install root (e.g. `C:\Riot Games\League of Legends`).
    pub league_path: Option<PathBuf>,
    /// Resolved mod storage directory - the path the rest of the app actually
    /// uses, with the `app_data_dir` fallback already applied. Only `None` if
    /// even the fallback could not be resolved (no Tauri app-data dir).
    pub mod_storage_path: Option<PathBuf>,
    /// True when [`mod_storage_path`] came from the fallback (user has not
    /// configured a custom path in Settings).
    pub mod_storage_is_default: bool,
    /// Resource directory containing the patcher DLL. None if it could not be resolved.
    pub patcher_dll_path: Option<PathBuf>,
    /// Manager executable path. Unused by phase-1 checks but kept for the
    /// future handle-leak / signature checks on the manager itself.
    #[allow(dead_code)]
    pub manager_exe: Option<PathBuf>,
}

/// Whether League/Riot is configured to launch elevated (an AppCompatFlags
/// `RUNASADMIN` layer on its executable). The patcher uses this to auto-enable
/// host elevation, since an elevated game can only be injected by an elevated
/// host. Always `false` off Windows.
pub fn league_configured_as_admin() -> bool {
    #[cfg(target_os = "windows")]
    {
        compat_flags::league_runs_as_admin()
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

/// Whether the manager process itself is running elevated. When it is, any host
/// it spawns inherits high integrity, so the `--elevate` UAC bridge is
/// unnecessary. Always `false` off Windows.
pub fn manager_is_elevated() -> bool {
    #[cfg(target_os = "windows")]
    {
        processes::is_running_as_admin()
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

/// Build a [`Check`] for a quick OK result with no details.
pub(crate) fn check_ok(id: &str, label: &str, category: Category, summary: &str) -> Check {
    Check {
        id: id.into(),
        label: label.into(),
        category,
        severity: Severity::Ok,
        summary: summary.into(),
        details: Vec::new(),
        suggestion: None,
        fix_command: None,
    }
}

/// Build a [`Check`] for a non-OK result. Use the builder helpers to attach
/// details / suggestions.
pub(crate) fn check(
    id: &str,
    label: &str,
    category: Category,
    severity: Severity,
    summary: impl Into<String>,
) -> Check {
    Check {
        id: id.into(),
        label: label.into(),
        category,
        severity,
        summary: summary.into(),
        details: Vec::new(),
        suggestion: None,
        fix_command: None,
    }
}

/// Run the full suite of diagnostics. Each check is independent and infallible
/// at this layer - checks that fail to gather data report a `Warn` or `Bad`
/// severity rather than propagating an error.
pub fn run_all(ctx: &CheckCtx) -> Vec<Check> {
    vec![
        // System
        windows::check_version(),
        windows::check_long_paths_enabled(),
        windows::check_uac_enabled(),
        // Manager
        processes::check_manager_not_admin(),
        // League
        paths::check_league_path(ctx),
        paths::check_league_writability(ctx),
        compat_flags::check_compat_flags(),
        // Storage
        paths::check_storage_path(ctx),
        paths::check_storage_writability(ctx),
        paths::check_storage_in_league(ctx),
        paths::check_free_space(ctx),
        storage_medium::check_storage_medium(ctx),
        // Patcher
        patcher_dll::check_dll_present(ctx),
        patcher_dll::check_dll_signature(ctx),
        patcher_dll::check_dll_not_locked(ctx),
        // Library
        library_index::check_library_index(ctx),
    ]
}
