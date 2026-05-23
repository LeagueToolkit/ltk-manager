//! Patcher DLL diagnostics: presence, Authenticode signature, file lock.
//!
//! Vanguard / unrelated processes occasionally leave file handles open on
//! `cslol-dll.dll`. When that happens, the patcher's next start either fails
//! to load the DLL or silently runs against a stale image. The lock-probe
//! check here is the phase-1 detector; phase 2 will add full handle-owner
//! enumeration via NtQuerySystemInformation.

use super::{check, check_ok, Category, Check, CheckCtx, CheckDetail, Severity};

#[cfg(target_os = "windows")]
use super::win_util::is_file_locked;

pub fn check_dll_present(ctx: &CheckCtx) -> Check {
    match ctx.patcher_dll_path.as_ref() {
        Some(p) if p.exists() => {
            let mut c = check_ok(
                "patcher.dll.present",
                "Patcher DLL present",
                Category::Patcher,
                &p.display().to_string(),
            );
            if let Ok(meta) = std::fs::metadata(p) {
                c.details
                    .push(CheckDetail::new("size", meta.len().to_string()));
            }
            c
        }
        Some(p) => {
            let mut c = check(
                "patcher.dll.present",
                "Patcher DLL present",
                Category::Patcher,
                Severity::Bad,
                "cslol-dll.dll not found at resolved path",
            );
            c.details
                .push(CheckDetail::new("path", p.display().to_string()));
            c.suggestion = Some(
                "The patcher's bundled DLL is missing. Reinstall LTK Manager from the latest release."
                    .into(),
            );
            c
        }
        None => check(
            "patcher.dll.present",
            "Patcher DLL present",
            Category::Patcher,
            Severity::Bad,
            "Could not resolve resource directory",
        ),
    }
}

#[cfg(target_os = "windows")]
pub fn check_dll_signature(ctx: &CheckCtx) -> Check {
    let Some(path) = ctx.patcher_dll_path.as_ref().filter(|p| p.exists()) else {
        return check(
            "patcher.dll.signature",
            "Patcher DLL signature",
            Category::Patcher,
            Severity::Info,
            "DLL not present, skipped",
        );
    };
    let result = verify_authenticode(path);
    match result {
        Ok(0) => check_ok(
            "patcher.dll.signature",
            "Patcher DLL signature",
            Category::Patcher,
            "Valid Authenticode signature",
        ),
        Ok(code) => {
            let mut c = check(
                "patcher.dll.signature",
                "Patcher DLL signature",
                Category::Patcher,
                Severity::Warn,
                format!("Unsigned or invalid signature (0x{:08x})", code as u32),
            );
            c.details
                .push(CheckDetail::new("path", path.display().to_string()));
            c.suggestion = Some(
                "The bundled DLL is unsigned or its signature didn't validate. This is informational — official builds may not be signed yet — but if you downloaded from somewhere other than the official GitHub release, redownload from there."
                    .into(),
            );
            c
        }
        Err(e) => {
            let mut c = check(
                "patcher.dll.signature",
                "Patcher DLL signature",
                Category::Patcher,
                Severity::Info,
                "Could not verify (system call failed)",
            );
            c.details.push(CheckDetail::new("error", e));
            c
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn check_dll_signature(_ctx: &CheckCtx) -> Check {
    check(
        "patcher.dll.signature",
        "Patcher DLL signature",
        Category::Patcher,
        Severity::Info,
        "Not applicable",
    )
}

pub fn check_dll_not_locked(ctx: &CheckCtx) -> Check {
    #[cfg(target_os = "windows")]
    {
        let Some(path) = ctx.patcher_dll_path.as_ref().filter(|p| p.exists()) else {
            return check(
                "patcher.dll.not_locked",
                "Patcher DLL not locked",
                Category::Patcher,
                Severity::Info,
                "DLL not present, skipped",
            );
        };
        if is_file_locked(path) {
            let mut c = check(
                "patcher.dll.not_locked",
                "Patcher DLL not locked",
                Category::Patcher,
                Severity::Warn,
                "Another process is holding cslol-dll.dll open",
            );
            c.details
                .push(CheckDetail::new("path", path.display().to_string()));
            c.suggestion = Some(
                "An external process — most often Vanguard's vgc.exe or a previous patcher run that didn't clean up — has a handle on cslol-dll.dll. The patcher won't be able to swap in a fresh copy until the lock is released. Try: stop the patcher, close the manager, restart your PC, then start the manager again before launching League. (We'll add a per-handle 'who's holding this?' view in a future release.)"
                    .into(),
            );
            c
        } else {
            check_ok(
                "patcher.dll.not_locked",
                "Patcher DLL not locked",
                Category::Patcher,
                "Not locked",
            )
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = ctx;
        check(
            "patcher.dll.not_locked",
            "Patcher DLL not locked",
            Category::Patcher,
            Severity::Info,
            "Not applicable",
        )
    }
}

/// Verify the Authenticode signature on `path`. Returns:
/// - `Ok(0)` — valid trust chain
/// - `Ok(code)` — `WinVerifyTrust` returned a non-zero (HRESULT-style) status
/// - `Err(msg)` — the call itself couldn't be made
#[cfg(target_os = "windows")]
fn verify_authenticode(path: &std::path::Path) -> Result<i32, String> {
    use std::ptr;
    use windows_sys::Win32::Security::WinTrust::{
        WinVerifyTrust, WINTRUST_ACTION_GENERIC_VERIFY_V2, WINTRUST_DATA, WINTRUST_DATA_0,
        WINTRUST_FILE_INFO, WTD_CHOICE_FILE, WTD_REVOKE_NONE, WTD_STATEACTION_CLOSE,
        WTD_STATEACTION_VERIFY, WTD_UI_NONE,
    };

    let wide = super::win_util::path_to_wide(path);

    let mut file = WINTRUST_FILE_INFO {
        cbStruct: std::mem::size_of::<WINTRUST_FILE_INFO>() as u32,
        pcwszFilePath: wide.as_ptr(),
        hFile: ptr::null_mut(),
        pgKnownSubject: ptr::null_mut(),
    };

    let mut data: WINTRUST_DATA = unsafe { std::mem::zeroed() };
    data.cbStruct = std::mem::size_of::<WINTRUST_DATA>() as u32;
    data.dwUIChoice = WTD_UI_NONE;
    data.fdwRevocationChecks = WTD_REVOKE_NONE;
    data.dwUnionChoice = WTD_CHOICE_FILE;
    data.Anonymous = WINTRUST_DATA_0 {
        pFile: &mut file as *mut _,
    };
    data.dwStateAction = WTD_STATEACTION_VERIFY;

    let mut guid = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    // SAFETY: `data` and `guid` are valid for the duration of the call.
    let result =
        unsafe { WinVerifyTrust(ptr::null_mut(), &mut guid, &mut data as *mut _ as *mut _) };
    // Release the trust-state allocation. Per WinVerifyTrust docs, every
    // VERIFY must be paired with a CLOSE — otherwise we leak per call.
    data.dwStateAction = WTD_STATEACTION_CLOSE;
    // SAFETY: same `data` / `guid` lifetime as above.
    unsafe {
        WinVerifyTrust(ptr::null_mut(), &mut guid, &mut data as *mut _ as *mut _);
    }
    Ok(result)
}
