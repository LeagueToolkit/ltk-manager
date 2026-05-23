//! Process-level diagnostics: manager-not-admin, league-not-running.
//!
//! Both are deliberately worded as positive ("X should be true"). The supported
//! configuration is *non-elevated* manager + *non-elevated* League; running
//! either as administrator breaks the patcher's process-injection.

use super::{check, Category, Check, Severity};

#[cfg(target_os = "windows")]
use super::{check_ok, CheckDetail};

#[cfg(target_os = "windows")]
pub fn check_manager_not_admin() -> Check {
    if is_running_as_admin() {
        let mut c = check(
            "process.manager_not_admin",
            "LTK Manager not running as admin",
            Category::Manager,
            Severity::Bad,
            "LTK Manager is running elevated",
        );
        c.suggestion = Some(
            "Running the manager as administrator is the single most common cause of \"patcher running but mods don't load\". Close LTK Manager and relaunch it normally (double-click — do NOT \"Run as administrator\"). If you have a compatibility flag on ltk-manager.exe forcing elevation, remove it from Properties → Compatibility."
                .into(),
        );
        c
    } else {
        check_ok(
            "process.manager_not_admin",
            "LTK Manager not running as admin",
            Category::Manager,
            "Not elevated",
        )
    }
}

#[cfg(not(target_os = "windows"))]
pub fn check_manager_not_admin() -> Check {
    check(
        "process.manager_not_admin",
        "LTK Manager not running as admin",
        Category::Manager,
        Severity::Info,
        "Not applicable",
    )
}

#[cfg(target_os = "windows")]
fn is_running_as_admin() -> bool {
    use std::mem::size_of;
    use std::ptr;
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::Security::{
        GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
    };
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    let mut token = ptr::null_mut();
    // SAFETY: GetCurrentProcess is a pseudo-handle that needs no closing.
    let ok = unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) };
    if ok == 0 {
        return false;
    }
    let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
    let mut ret_len: u32 = 0;
    // SAFETY: token is valid; struct sizes match.
    let ok = unsafe {
        GetTokenInformation(
            token,
            TokenElevation,
            &mut elevation as *mut _ as *mut _,
            size_of::<TOKEN_ELEVATION>() as u32,
            &mut ret_len,
        )
    };
    // SAFETY: token came from OpenProcessToken.
    unsafe { CloseHandle(token) };
    ok != 0 && elevation.TokenIsElevated != 0
}

/// Diagnostic that flags running League/Vanguard processes.
///
/// Currently NOT included in the default suite — see [`super::run_all`]. The
/// problem it tries to surface ("close League before re-running") was noisy
/// for every user who ran diagnostics mid-session, while none of the other
/// checks actually require League to be closed. Kept here so the phase-2
/// Vanguard handle-correlation work can call it and present a more specific
/// signal ("vgc.exe holds a handle on cslol-dll.dll") instead.
#[cfg(target_os = "windows")]
#[allow(dead_code)]
pub fn check_league_not_running() -> Check {
    let running = list_running_league();
    if running.is_empty() {
        return check_ok(
            "process.league_not_running",
            "League is not currently running",
            Category::Manager,
            "League is closed",
        );
    }
    let mut c = check(
        "process.league_not_running",
        "League is not currently running",
        Category::Manager,
        Severity::Warn,
        format!(
            "{} League/Riot process(es) running — close the game before re-running diagnostics",
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
    check(
        "process.league_not_running",
        "League is not currently running",
        Category::Manager,
        Severity::Info,
        "Not applicable",
    )
}

/// Lowercase basenames considered League / Riot / Vanguard processes.
#[cfg(target_os = "windows")]
#[allow(dead_code)]
const LEAGUE_PROCESS_NAMES: &[&str] = &[
    "league of legends.exe",
    "leagueclient.exe",
    "leagueclientux.exe",
    "leagueclientuxrender.exe",
    "riotclientservices.exe",
    "riotclientux.exe",
    "riotclientuxrender.exe",
    "riotclientcrashhandler.exe",
    "vgc.exe",
    "vgtray.exe",
];

#[cfg(target_os = "windows")]
#[allow(dead_code)]
fn list_running_league() -> Vec<(String, u32)> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    let mut out = Vec::new();
    // SAFETY: documented snapshot creation.
    let snap = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snap == INVALID_HANDLE_VALUE || snap.is_null() {
        return out;
    }
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    // SAFETY: entry is correctly sized.
    if unsafe { Process32FirstW(snap, &mut entry) } == 0 {
        unsafe { CloseHandle(snap) };
        return out;
    }
    loop {
        let len = entry
            .szExeFile
            .iter()
            .position(|&c| c == 0)
            .unwrap_or(entry.szExeFile.len());
        let name = String::from_utf16_lossy(&entry.szExeFile[..len]);
        if LEAGUE_PROCESS_NAMES.contains(&name.to_lowercase().as_str()) {
            out.push((name, entry.th32ProcessID));
        }
        // SAFETY: entry is correctly sized; loop terminates on Process32NextW returning 0.
        if unsafe { Process32NextW(snap, &mut entry) } == 0 {
            break;
        }
    }
    // SAFETY: snap came from CreateToolhelp32Snapshot.
    unsafe { CloseHandle(snap) };
    out
}
