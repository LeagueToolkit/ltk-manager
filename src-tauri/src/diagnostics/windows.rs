//! OS-level diagnostic checks: Windows version, long-paths registry,
//! UAC enabled. These don't depend on any user paths and run on app launch.

use super::{check, Category, Check, Severity};

#[cfg(target_os = "windows")]
use super::win_util::{reg_read_num, HKLM};
#[cfg(target_os = "windows")]
use super::{check_ok, CheckDetail};

#[cfg(target_os = "windows")]
const MIN_OK_BUILD: u32 = 19045;
#[cfg(target_os = "windows")]
const KNOWN_BAD_BUILD: u32 = 22000;

/// Read OS major/minor/build from the kernel-shared user data page (KUSER_SHARED_DATA).
/// This is the same trick `cslol-diag` used and avoids `GetVersionExW` lying
/// when the manager isn't manifested for the current OS.
#[cfg(target_os = "windows")]
fn read_kuser_version() -> (u32, u32, u32) {
    // SAFETY: KUSER_SHARED_DATA is mapped read-only at 0x7FFE0000 on every
    // Windows process; reads from these documented offsets are well-defined.
    unsafe {
        let major = std::ptr::read_volatile((0x7ffe0000 + 0x26c) as *const u32);
        let minor = std::ptr::read_volatile((0x7ffe0000 + 0x270) as *const u32);
        let build = std::ptr::read_volatile((0x7ffe0000 + 0x260) as *const u32);
        (major, minor, build)
    }
}

#[cfg(target_os = "windows")]
pub fn check_version() -> Check {
    let (major, minor, build) = read_kuser_version();
    let display = format!("Windows {}.{}.{}", major, minor, build);
    if build < MIN_OK_BUILD || build == KNOWN_BAD_BUILD {
        let mut c = check(
            "windows.version",
            "Windows version",
            Category::System,
            Severity::Bad,
            display,
        );
        c.suggestion = Some(
            "Your Windows build is older than the minimum supported by League. Run Windows Update to install the latest cumulative update before troubleshooting further."
                .into(),
        );
        c.details.push(CheckDetail::new("major", major.to_string()));
        c.details.push(CheckDetail::new("minor", minor.to_string()));
        c.details.push(CheckDetail::new("build", build.to_string()));
        c
    } else {
        let mut c = check_ok(
            "windows.version",
            "Windows version",
            Category::System,
            &display,
        );
        c.details.push(CheckDetail::new("build", build.to_string()));
        c
    }
}

#[cfg(not(target_os = "windows"))]
pub fn check_version() -> Check {
    check(
        "windows.version",
        "Windows version",
        Category::System,
        Severity::Info,
        "Not running on Windows",
    )
}

#[cfg(target_os = "windows")]
pub fn check_long_paths_enabled() -> Check {
    let value = reg_read_num(
        HKLM,
        "SYSTEM\\CurrentControlSet\\Control\\FileSystem",
        "LongPathsEnabled",
    )
    .unwrap_or(0);
    if value == 0 {
        let mut c = check(
            "windows.long_paths",
            "Long paths enabled",
            Category::System,
            Severity::Warn,
            "Disabled — paths longer than 260 chars will fail",
        );
        c.suggestion = Some(
            "Mods stored deep in folders (especially under OneDrive) can hit the legacy 260-char path limit. Enable long-path support in the Windows registry."
                .into(),
        );
        c.fix_command = Some(
            r#"reg add "HKLM\SYSTEM\CurrentControlSet\Control\FileSystem" /v LongPathsEnabled /t REG_DWORD /d 1 /f"#
                .into(),
        );
        c
    } else {
        check_ok(
            "windows.long_paths",
            "Long paths enabled",
            Category::System,
            "Enabled",
        )
    }
}

#[cfg(not(target_os = "windows"))]
pub fn check_long_paths_enabled() -> Check {
    check(
        "windows.long_paths",
        "Long paths enabled",
        Category::System,
        Severity::Info,
        "Not applicable",
    )
}

#[cfg(target_os = "windows")]
pub fn check_uac_enabled() -> Check {
    let value = reg_read_num(
        HKLM,
        "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System",
        "EnableLUA",
    )
    .unwrap_or(1);
    if value == 0 {
        let mut c = check(
            "windows.uac",
            "User Account Control",
            Category::System,
            Severity::Bad,
            "Disabled — every process runs elevated",
        );
        c.suggestion = Some(
            "UAC is disabled, which means everything runs as administrator. League's anti-cheat and the patcher both rely on UAC being on. Re-enable it under User Accounts → Change User Account Control settings, then reboot."
                .into(),
        );
        c
    } else {
        check_ok(
            "windows.uac",
            "User Account Control",
            Category::System,
            "Enabled",
        )
    }
}

#[cfg(not(target_os = "windows"))]
pub fn check_uac_enabled() -> Check {
    check(
        "windows.uac",
        "User Account Control",
        Category::System,
        Severity::Info,
        "Not applicable",
    )
}
