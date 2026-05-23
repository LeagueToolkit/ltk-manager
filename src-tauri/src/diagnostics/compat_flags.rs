//! AppCompatFlags scan — the load-bearing check from cslol-diag.
//!
//! Windows stores per-executable compatibility-mode settings under
//! `Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers` in
//! both HKCU and HKLM. The value name is the executable's full path; the
//! value itself is a space-separated list of layer tokens (e.g. `RUNASADMIN`,
//! `WIN8RTM`, `~`).
//!
//! When users right-click `League of Legends.exe` → Properties → Compatibility
//! → "Run as administrator", an entry lands here. League being elevated then
//! breaks the patcher's process-injection: handles can't cross the integrity
//! boundary. This is, by far, the #1 cause of "patcher running but mods don't
//! load" in the wild.
//!
//! Phase 1 is read-only. We list every offending entry as a [`CheckDetail`]
//! so the user can copy paths and remove them manually, and we ship a
//! `reg delete` command for each. Phase 3 will add a one-click fix gated
//! behind explicit confirmation.

use super::{check, Category, Check, Severity};

#[cfg(target_os = "windows")]
use super::win_util::{reg_list_value_names, ROOTS};
#[cfg(target_os = "windows")]
use super::{check_ok, CheckDetail};

#[cfg(target_os = "windows")]
const COMPAT_KEY: &str = "Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers";

#[cfg(target_os = "windows")]
const BAD_PREFIXES: &[&str] = &["League", "Riot"];

#[cfg(target_os = "windows")]
const SUS_PREFIXES: &[&str] = &["cslol-", "ltk-manager"];

/// Returns the basename of a value name (path) for matching against prefix
/// lists. Compat-flag value names are full paths like
/// `C:\Riot Games\League of Legends\League of Legends.exe`.
#[cfg(target_os = "windows")]
fn basename(path: &str) -> &str {
    match path.rfind(['\\', '/']) {
        Some(i) => &path[i + 1..],
        None => path,
    }
}

#[cfg(target_os = "windows")]
pub fn check_compat_flags() -> Check {
    let mut bad = Vec::<(String, String)>::new(); // (root, path)
    let mut sus = Vec::<(String, String)>::new();

    for (root, root_label) in ROOTS {
        for value_name in reg_list_value_names(*root, COMPAT_KEY) {
            let name = basename(&value_name);
            if BAD_PREFIXES.iter().any(|p| name.starts_with(p)) {
                bad.push((root_label.to_string(), value_name.clone()));
                continue;
            }
            if SUS_PREFIXES.iter().any(|p| name.starts_with(p)) {
                sus.push((root_label.to_string(), value_name));
            }
        }
    }

    if bad.is_empty() && sus.is_empty() {
        return check_ok(
            "compat_flags.layers",
            "League/Riot compatibility flags",
            Category::League,
            "No League or Riot compatibility entries found",
        );
    }

    let severity = if !bad.is_empty() {
        Severity::Bad
    } else {
        Severity::Warn
    };

    let summary = if !bad.is_empty() {
        format!(
            "{} League/Riot entr{} forcing compatibility mode",
            bad.len(),
            if bad.len() == 1 { "y" } else { "ies" }
        )
    } else {
        format!("{} cslol/ltk-manager entries (suspicious)", sus.len())
    };

    let mut c = check(
        "compat_flags.layers",
        "League/Riot compatibility flags",
        Category::League,
        severity,
        summary,
    );

    for (root, path) in &bad {
        c.details
            .push(CheckDetail::new(format!("{} (BAD)", root), path.clone()));
    }
    for (root, path) in &sus {
        c.details.push(CheckDetail::new(
            format!("{} (suspicious)", root),
            path.clone(),
        ));
    }

    if !bad.is_empty() {
        c.suggestion = Some(
            "Found compatibility-mode entries on League/Riot executables. \"Run as administrator\" or any compatibility flag on League's binaries breaks the patcher's process injection. Remove every entry below — right-click the .exe → Properties → Compatibility → uncheck everything, OR run the command as administrator."
                .into(),
        );
        // `reg.exe` accepts `HKCU\...` / `HKLM\...` — the `HKCU:\` form is a
        // PowerShell PSDrive convention and is rejected by reg.exe with
        // "Invalid key name". Stick to the universal syntax. No leading
        // comment line: cmd-style `::` is a parse error in PowerShell and
        // PowerShell-style `#` is a parse error in cmd, so we ship the bare
        // commands and rely on the UI to label them.
        let mut script = String::new();
        for (root, path) in &bad {
            script.push_str(&format!(
                "reg delete \"{}\\{}\" /v \"{}\" /f\n",
                root, COMPAT_KEY, path
            ));
        }
        c.fix_command = Some(script.trim_end().to_string());
    }
    c
}

#[cfg(not(target_os = "windows"))]
pub fn check_compat_flags() -> Check {
    check(
        "compat_flags.layers",
        "League/Riot compatibility flags",
        Category::League,
        Severity::Info,
        "Not applicable",
    )
}

#[cfg(test)]
#[cfg(target_os = "windows")]
mod tests {
    use super::*;

    #[test]
    fn basename_strips_drive_path() {
        assert_eq!(
            basename(r"C:\Riot Games\League of Legends\League of Legends.exe"),
            "League of Legends.exe"
        );
    }

    #[test]
    fn basename_handles_no_separator() {
        assert_eq!(basename("League of Legends.exe"), "League of Legends.exe");
    }
}
