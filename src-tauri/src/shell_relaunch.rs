//! Restarts the manager as a child of the Windows shell.
//!
//! If another process, such as the installer or a browser, starts the manager, the process
//! starts a copy through `IShellDispatch2::ShellExecute` and exits. That call runs inside
//! explorer, so the copy runs as the signed-in user, as if it was clicked on the desktop, with
//! explorer's environment rather than the starter's.

use std::mem::{size_of, zeroed};
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::ptr::null_mut;

use windows::core::{Interface, BSTR};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, IDispatch, IServiceProvider,
    CLSCTX_LOCAL_SERVER, COINIT_APARTMENTTHREADED,
};
use windows::Win32::System::Variant::VARIANT;
use windows::Win32::UI::Shell::{
    IShellBrowser, IShellDispatch2, IShellFolderViewDual, IShellWindows, SID_STopLevelBrowser,
    ShellWindows, CSIDL_DESKTOP, SVGIO_BACKGROUND, SWC_DESKTOP, SWFO_NEEDDISPATCH,
};
use windows_sys::Wdk::System::Threading::{NtQueryInformationProcess, ProcessBasicInformation};
use windows_sys::Win32::System::Environment::GetCommandLineW;
use windows_sys::Win32::System::Threading::{GetCurrentProcess, PROCESS_BASIC_INFORMATION};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetShellWindow, GetWindowThreadProcessId, SW_SHOWNORMAL,
};

use crate::webview_args::Inherited;

/// Appended to the copy's arguments, so a copy never restarts again.
const RELAUNCHED_ARG: &str = "--shell-relaunched";

/// Starts a copy of the manager through the shell if the shell is not this process's parent, or
/// if `inherited` says a launcher tried to debug the frontend.
///
/// A launcher can start the manager under explorer as a seeded parent, so a debugging launcher
/// is restarted whatever the parent looks like. A copy never restarts, whatever its
/// environment: a variable the shell itself carries would otherwise restart it forever.
///
/// Returns `true` if the copy started and this process must exit. Returns `false` if no shell
/// runs, if this process is already a copy, or if the start fails.
pub fn relaunch_if_needed(inherited: &Inherited) -> bool {
    if std::env::args_os().any(|arg| arg == RELAUNCHED_ARG) {
        return false;
    }

    let Some(shell) = shell_pid() else {
        return false;
    };
    let parent = parent_pid();
    let debugging = inherited.is_debugging();
    if parent == Some(shell) && !debugging {
        return false;
    }

    let (Ok(exe), Ok(dir)) = (std::env::current_exe(), std::env::current_dir()) else {
        return false;
    };
    let mut args = arguments();
    if !args.is_empty() {
        args.push(u16::from(b' '));
    }
    args.extend(RELAUNCHED_ARG.encode_utf16());

    match shell_execute(&exe, &args, &dir) {
        Ok(()) => {
            tracing::info!(
                ?parent,
                shell,
                debugging,
                "Restarted the manager as a child of the shell"
            );
            true
        }
        Err(error) => {
            tracing::warn!(%error, ?parent, "The manager could not restart through the shell");
            false
        }
    }
}

/// The pid of the process that owns the desktop window, or `None` if no shell runs.
fn shell_pid() -> Option<u32> {
    // SAFETY: both calls take no pointer other than the out parameter.
    let window = unsafe { GetShellWindow() };
    if window.is_null() {
        return None;
    }

    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(window, &mut pid) };
    (pid != 0).then_some(pid)
}

/// The parent pid recorded for this process.
fn parent_pid() -> Option<u32> {
    // SAFETY: `info` is plain data of the size passed, and the pseudo-handle needs no close.
    let mut info: PROCESS_BASIC_INFORMATION = unsafe { zeroed() };
    let status = unsafe {
        NtQueryInformationProcess(
            GetCurrentProcess(),
            ProcessBasicInformation,
            (&raw mut info).cast(),
            size_of::<PROCESS_BASIC_INFORMATION>() as u32,
            null_mut(),
        )
    };

    (status >= 0).then_some(info.InheritedFromUniqueProcessId as u32)
}

/// This process's command line after the program name, unchanged.
fn arguments() -> Vec<u16> {
    // SAFETY: the command line is a null-terminated string that lives as long as the process.
    let line = unsafe {
        let start = GetCommandLineW();
        let len = (0..).take_while(|&i| *start.add(i) != 0).count();
        std::slice::from_raw_parts(start, len)
    };

    skip_program_name(line).to_vec()
}

/// `line` after its first token, by the `CommandLineToArgvW` rule for the program name.
fn skip_program_name(line: &[u16]) -> &[u16] {
    let is_blank = |&c: &u16| c == u16::from(b' ') || c == u16::from(b'\t');

    let end = if line.first() == Some(&u16::from(b'"')) {
        line[1..]
            .iter()
            .position(|&c| c == u16::from(b'"'))
            .map_or(line.len(), |quote| quote + 2)
    } else {
        line.iter().position(is_blank).unwrap_or(line.len())
    };

    let rest = &line[end..];
    let start = rest.iter().position(|c| !is_blank(c)).unwrap_or(rest.len());
    &rest[start..]
}

/// Runs `exe` with `args` in `dir` from inside the shell process.
fn shell_execute(exe: &Path, args: &[u16], dir: &Path) -> windows::core::Result<()> {
    let wide = |path: &Path| path.as_os_str().encode_wide().collect::<Vec<_>>();

    // SAFETY: COM is initialized for the calls between `CoInitializeEx` and `CoUninitialize`.
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;

        let result = desktop_shell().and_then(|shell| {
            shell.ShellExecute(
                &BSTR::from_wide(&wide(exe)),
                &VARIANT::from(BSTR::from_wide(args)),
                &VARIANT::from(BSTR::from_wide(&wide(dir))),
                &VARIANT::from(""),
                &VARIANT::from(SW_SHOWNORMAL),
            )
        });

        CoUninitialize();
        result
    }
}

/// The desktop's `Shell.Application` object, which belongs to the explorer process.
///
/// The steps follow <https://devblogs.microsoft.com/oldnewthing/20131118-00/?p=2643>.
unsafe fn desktop_shell() -> windows::core::Result<IShellDispatch2> {
    unsafe {
        let windows: IShellWindows = CoCreateInstance(&ShellWindows, None, CLSCTX_LOCAL_SERVER)?;

        let mut hwnd = 0;
        let desktop = windows.FindWindowSW(
            &VARIANT::from(CSIDL_DESKTOP as i32),
            &VARIANT::default(),
            SWC_DESKTOP,
            &mut hwnd,
            SWFO_NEEDDISPATCH,
        )?;

        let browser: IShellBrowser = desktop
            .cast::<IServiceProvider>()?
            .QueryService(&SID_STopLevelBrowser)?;
        // The view marshals only `IDispatch`, so the dual interface comes from a cast.
        let view: IShellFolderViewDual = browser
            .QueryActiveShellView()?
            .GetItemObject::<IDispatch>(SVGIO_BACKGROUND)?
            .cast()?;

        view.Application()?.cast()
    }
}

#[cfg(test)]
mod tests;
