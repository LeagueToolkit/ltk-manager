//! AppCompatFlags scan — critical check for patcher issues.
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

use super::{Category, Check, CheckSpec, Severity};

#[cfg(target_os = "windows")]
use std::path::Path;

#[cfg(target_os = "windows")]
use super::CheckDetail;
#[cfg(target_os = "windows")]
use ltk_manager_base::platform::windows::{ROOTS, reg_list_value_names, reg_read_str};
#[cfg(target_os = "windows")]
use winreg::HKEY;

const LAYERS: CheckSpec = CheckSpec::new(
    "compat_flags.layers",
    "League/Riot compatibility flags",
    Category::League,
);

#[cfg(target_os = "windows")]
const COMPAT_KEY: &str = "Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers";

#[cfg(target_os = "windows")]
const BAD_PREFIXES: &[&str] = &["League", "Riot"];

#[cfg(target_os = "windows")]
const SUS_PREFIXES: &[&str] = &["cslol-", "ltk_patcher", "ltk-manager"];

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
            if !SUS_PREFIXES.iter().any(|p| name.starts_with(p)) {
                continue;
            }

            // A manager or patcher binary that runs as administrator refuses a start, so it
            // joins the fix command. Any other layer on them is only suspicious.
            if has_run_as_admin_layer(*root, &value_name) {
                bad.push((root_label.to_string(), value_name));
            } else {
                sus.push((root_label.to_string(), value_name));
            }
        }
    }

    if bad.is_empty() && sus.is_empty() {
        return LAYERS.ok("No League or Riot compatibility entries found");
    }

    let severity = if !bad.is_empty() {
        Severity::Bad
    } else {
        Severity::Warn
    };

    let summary = if !bad.is_empty() {
        format!(
            "{} entr{} forcing compatibility mode on League, Riot or LTK binaries",
            bad.len(),
            if bad.len() == 1 { "y" } else { "ies" }
        )
    } else {
        format!("{} ltk-manager/patcher entries (suspicious)", sus.len())
    };

    let mut c = LAYERS.result(severity, summary);

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
            "Found compatibility-mode entries on League, Riot or LTK executables. \"Run as administrator\" or any compatibility flag on League's binaries breaks the patcher's process injection, and one on ltk-manager.exe refuses the patcher start. Remove every entry below: right-click the .exe, Properties, Compatibility, uncheck everything, or run the command as administrator."
                .into(),
        );
        // `reg.exe` accepts `HKCU\...` / `HKLM\...` — the `HKCU:\` form is a
        // PowerShell PSDrive convention and is rejected by reg.exe with
        // "Invalid key name". Stick to the universal syntax. No leading
        // comment line: cmd-style `::` is a parse error in PowerShell and
        // PowerShell-style `#` is a parse error in cmd, so we ship the bare
        // commands and rely on the UI to label them.
        c.fix_command = Some(reg_delete_script(&bad));
    }
    c
}

/// Returns the `reg delete` commands that remove the layer entries `(root, path)`.
#[cfg(target_os = "windows")]
pub(crate) fn reg_delete_script(entries: &[(String, String)]) -> String {
    entries
        .iter()
        .map(|(root, path)| format!("reg delete \"{root}\\{COMPAT_KEY}\" /v \"{path}\" /f"))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Returns `true` if the layer entry `value_name` under `root` contains `RUNASADMIN`.
#[cfg(target_os = "windows")]
fn has_run_as_admin_layer(root: HKEY, value_name: &str) -> bool {
    reg_read_str(root, COMPAT_KEY, value_name)
        .is_some_and(|layers| layers.to_ascii_uppercase().contains("RUNASADMIN"))
}

/// Returns the entries `(root, path)` of League/Riot executables with a `RUNASADMIN` layer.
///
/// Unlike [`check_compat_flags`], this reads each entry's layer data, not only its name.
#[cfg(target_os = "windows")]
fn run_as_admin_entries() -> Vec<(String, String)> {
    let mut entries = Vec::new();

    for (root, label) in ROOTS {
        for value_name in reg_list_value_names(*root, COMPAT_KEY) {
            let name = basename(&value_name);
            if !BAD_PREFIXES.iter().any(|p| name.starts_with(p)) {
                continue;
            }

            if has_run_as_admin_layer(*root, &value_name) {
                entries.push((label.to_string(), value_name));
            }
        }
    }

    entries
}

/// Returns the registry root label of a `RUNASADMIN` layer on `exe`, or `None` if it has none.
///
/// The layer value is named by the full path of the executable, compared without case.
#[cfg(target_os = "windows")]
pub(crate) fn run_as_admin_layer(exe: &Path) -> Option<String> {
    let exe = exe.to_string_lossy();

    ROOTS.iter().find_map(|(root, label)| {
        reg_list_value_names(*root, COMPAT_KEY)
            .into_iter()
            .find(|value_name| value_name.eq_ignore_ascii_case(&exe))
            .filter(|value_name| has_run_as_admin_layer(*root, value_name))
            .map(|_| (*label).to_string())
    })
}

/// Returns `true` if any League/Riot executable carries a `RUNASADMIN` layer.
#[cfg(target_os = "windows")]
pub(crate) fn league_runs_as_admin() -> bool {
    !run_as_admin_entries().is_empty()
}

/// Returns the commands that remove every `RUNASADMIN` entry of League/Riot executables.
///
/// Returns `None` if no entry has that layer.
#[cfg(target_os = "windows")]
pub(crate) fn run_as_admin_fix_command() -> Option<String> {
    let entries = run_as_admin_entries();

    (!entries.is_empty()).then(|| reg_delete_script(&entries))
}

#[cfg(not(target_os = "windows"))]
pub fn check_compat_flags() -> Check {
    LAYERS.result(Severity::Info, "Not applicable")
}

#[cfg(test)]
#[cfg(target_os = "windows")]
mod tests {
    use super::*;

    #[test]
    fn reg_delete_script_writes_one_command_per_entry() {
        let script = reg_delete_script(&[
            (
                "HKCU".to_string(),
                r"C:\Riot\League of Legends.exe".to_string(),
            ),
            (
                "HKLM".to_string(),
                r"C:\Riot\RiotClientServices.exe".to_string(),
            ),
        ]);

        assert_eq!(
            script,
            format!(
                "reg delete \"HKCU\\{COMPAT_KEY}\" /v \"C:\\Riot\\League of Legends.exe\" /f\n\
                 reg delete \"HKLM\\{COMPAT_KEY}\" /v \"C:\\Riot\\RiotClientServices.exe\" /f"
            )
        );
    }

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
