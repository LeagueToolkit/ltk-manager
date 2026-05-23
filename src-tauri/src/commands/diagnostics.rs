//! Tauri command for running the diagnostic suite.
//!
//! Resolves the patcher DLL path the same way `start_patcher` does, snapshots
//! settings, and runs every check in [`crate::diagnostics::run_all`]. The
//! command never returns an error — checks that fail to gather data report
//! `Severity::Warn` or `Severity::Bad` instead.

use crate::diagnostics::{run_all, CheckCtx, DiagnosticReport};
use crate::error::{AppError, AppResult, IpcResult, MutexResultExt};
use crate::legacy_patcher::api::PATCHER_DLL_NAME;
use crate::state::{get_app_data_dir, SettingsState};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

/// Same lookup chain as `commands::patcher::resolve_patcher_dll_path`, but
/// returns `None` instead of an error so we can still report the rest of the
/// diagnostics when the DLL is missing.
fn resolve_patcher_dll(app_handle: &AppHandle) -> Option<PathBuf> {
    if let Ok(dir) = app_handle.path().resource_dir() {
        let p = dir.join(PATCHER_DLL_NAME);
        if p.exists() {
            return Some(p);
        }
    }
    if let Some(dev) = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .map(|p| p.join(PATCHER_DLL_NAME))
    {
        if dev.exists() {
            return Some(dev);
        }
    }
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join(PATCHER_DLL_NAME);
    if manifest.exists() {
        return Some(manifest);
    }
    None
}

#[tauri::command]
pub fn run_diagnostics(
    app_handle: AppHandle,
    settings: State<SettingsState>,
) -> IpcResult<DiagnosticReport> {
    run_diagnostics_inner(&app_handle, &settings).into()
}

/// Launch an elevated PowerShell window so the user can run a fix command.
///
/// On click of a "Run as administrator" button in the diagnostics UI, the
/// frontend copies the command to the clipboard and then calls this command.
/// We `ShellExecuteW` PowerShell with the `runas` verb (UAC prompt), then
/// `-NoExit` so the window stays open. When `with_banner` is true a short
/// hint line is printed up front telling the user the command is on their
/// clipboard and they should paste (Ctrl+V or right-click) and press Enter.
///
/// Why not auto-execute the command? Auto-running registry deletes from a
/// freshly-elevated PowerShell with no review step is a footgun — the user
/// should at least see the command they're about to execute. Paste-then-Enter
/// is one extra keystroke and gives them a chance to bail out.
#[tauri::command]
pub fn open_elevated_terminal(with_banner: bool) -> IpcResult<()> {
    open_elevated_terminal_inner(with_banner).into()
}

#[cfg(target_os = "windows")]
fn open_elevated_terminal_inner(with_banner: bool) -> AppResult<()> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr;
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    fn to_wide(s: &str) -> Vec<u16> {
        OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    // Build a `-NoExit -Command "..."` argument string. With a banner we
    // print one cyan hint line, then return control to the prompt. The
    // command itself is on the clipboard (frontend put it there) and was
    // already visible in the diagnostics UI — re-printing it here only
    // creates noise.
    let args = if with_banner {
        "-NoExit -Command \"Write-Host 'LTK Manager: paste the fix command (Ctrl+V), review it, then press Enter.' -ForegroundColor Cyan; Write-Host ''\"".to_string()
    } else {
        "-NoExit".to_string()
    };

    let exe = to_wide("powershell.exe");
    let verb = to_wide("runas");
    let args_w = to_wide(&args);

    // SAFETY: all pointers are null-terminated wide strings owned by the
    // local Vec<u16>s above; ShellExecuteW returns a pseudo-HINSTANCE we
    // only use as an integer error code.
    let result = unsafe {
        ShellExecuteW(
            ptr::null_mut(),
            verb.as_ptr(),
            exe.as_ptr(),
            args_w.as_ptr(),
            ptr::null(),
            SW_SHOWNORMAL,
        )
    };

    // ShellExecuteW: values <= 32 indicate failure. Most common: 5 (access
    // denied — user clicked No on UAC) or 2 (file not found).
    if (result as usize) > 32 {
        Ok(())
    } else {
        Err(AppError::Other(format!(
            "Failed to launch elevated terminal (ShellExecute code {})",
            result as usize
        )))
    }
}

#[cfg(not(target_os = "windows"))]
fn open_elevated_terminal_inner(_with_banner: bool) -> AppResult<()> {
    Err(AppError::Other(
        "Elevated terminal launch is only supported on Windows".to_string(),
    ))
}

fn run_diagnostics_inner(
    app_handle: &AppHandle,
    settings: &State<SettingsState>,
) -> AppResult<DiagnosticReport> {
    let snapshot = settings.0.lock().mutex_err()?.clone();
    // Mirror `ModLibrary::storage_dir` — fall back to the Tauri app-data dir
    // when the user hasn't set a custom storage path. The diagnostics should
    // inspect whatever path the rest of the app actually uses.
    let storage_is_default = snapshot.mod_storage_path.is_none();
    let mod_storage_path = snapshot
        .mod_storage_path
        .clone()
        .or_else(|| get_app_data_dir(app_handle));
    let ctx = CheckCtx {
        league_path: snapshot.league_path.clone(),
        mod_storage_path,
        mod_storage_is_default: storage_is_default,
        patcher_dll_path: resolve_patcher_dll(app_handle),
        manager_exe: std::env::current_exe().ok(),
    };
    let checks = run_all(&ctx);
    let generated_at = chrono::Utc::now().to_rfc3339();
    Ok(DiagnosticReport {
        generated_at,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        checks,
    })
}
