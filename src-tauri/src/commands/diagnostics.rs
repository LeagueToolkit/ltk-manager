//! Tauri commands for the diagnostic suite and for League diagnostics.
//!
//! `run_diagnostics` resolves the bundled hook DLL the injector loads into the
//! game, snapshots settings, and runs every check in
//! [`ltk_manager_core::diagnostics::run_all`]. It never returns an error, since
//! checks that fail to gather data report `Severity::Warn` or `Severity::Bad`
//! instead. The incident commands read the store the patcher thread writes.

use crate::commands::shell::reveal_in_explorer_inner;
use crate::error::{AppError, AppResult, IpcResult};
use crate::mods::ModLibraryState;
use crate::patcher::host::HOOK_DLL_NAME;
use crate::state::{get_app_data_dir, IncidentStoreState, SettingsState};
use ltk_manager_core::diagnostics::incident::Incident;
use ltk_manager_core::diagnostics::token::{IncidentToken, PREFIX as TOKEN_PREFIX};
use ltk_manager_core::diagnostics::{run_all, CheckCtx, DiagnosticReport};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

/// Same lookup chain as `commands::patcher::resolve_resource`, but returns
/// `None` instead of an error so we can still report the rest of the
/// diagnostics when the DLL is missing.
fn resolve_patcher_dll(app_handle: &AppHandle) -> Option<PathBuf> {
    if let Ok(dir) = app_handle.path().resource_dir() {
        let p = dir.join(HOOK_DLL_NAME);
        if p.exists() {
            return Some(p);
        }
    }
    if let Some(dev) = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .map(|p| p.join(HOOK_DLL_NAME))
    {
        if dev.exists() {
            return Some(dev);
        }
    }
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join(HOOK_DLL_NAME);
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
    let snapshot = settings.config()?;
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

/// Every incident the store holds, newest first.
#[tauri::command]
pub fn list_incidents(incidents: State<IncidentStoreState>) -> IpcResult<Vec<Incident>> {
    incidents.0.list().into()
}

/// Marks an incident dismissed. The verdict line goes, and the row dims.
#[tauri::command]
pub fn dismiss_incident(id: String, incidents: State<IncidentStoreState>) -> IpcResult<()> {
    incidents.0.dismiss(&id).into()
}

/// Reveals the incident's game log in the file manager.
#[tauri::command]
pub fn reveal_game_log(id: String, incidents: State<IncidentStoreState>) -> IpcResult<()> {
    reveal_game_log_inner(&id, &incidents).into()
}

fn reveal_game_log_inner(id: &str, incidents: &State<IncidentStoreState>) -> AppResult<()> {
    let incident = find_incident(incidents, id)?;
    let Some(game) = incident.game else {
        return Err(AppError::Other(
            "This incident has no game log to open".to_string(),
        ));
    };
    reveal_in_explorer_inner(&game.log_path)
}

/// The incident as the text a support thread wants, with its token on the
/// second line.
#[tauri::command]
pub fn incident_report(
    id: String,
    incidents: State<IncidentStoreState>,
    library: State<ModLibraryState>,
    settings: State<SettingsState>,
) -> IpcResult<String> {
    incident_report_inner(&id, &incidents, &library, &settings).into()
}

fn incident_report_inner(
    id: &str,
    incidents: &State<IncidentStoreState>,
    library: &State<ModLibraryState>,
    settings: &State<SettingsState>,
) -> AppResult<String> {
    let incident = find_incident(incidents, id)?;
    let token = token_for(&incident, library, settings)?;
    Ok(incident.report_text(env!("CARGO_PKG_VERSION"), Some(&token)))
}

/// The incident folded into one short string, for a URL or a chat.
#[tauri::command]
pub fn incident_token(
    id: String,
    incidents: State<IncidentStoreState>,
    library: State<ModLibraryState>,
    settings: State<SettingsState>,
) -> IpcResult<String> {
    incident_token_inner(&id, &incidents, &library, &settings).into()
}

fn incident_token_inner(
    id: &str,
    incidents: &State<IncidentStoreState>,
    library: &State<ModLibraryState>,
    settings: &State<SettingsState>,
) -> AppResult<String> {
    let incident = find_incident(incidents, id)?;
    token_for(&incident, library, settings)
}

/// Reads a token back, from the token alone or from a pasted report or URL
/// that carries one.
#[tauri::command]
pub fn decode_incident_token(token: String) -> IpcResult<IncidentToken> {
    decode_incident_token_inner(&token).into()
}

fn decode_incident_token_inner(text: &str) -> AppResult<IncidentToken> {
    let token = extract_token(text).ok_or_else(|| {
        AppError::ValidationFailed("The text holds no LTK incident token".to_string())
    })?;
    IncidentToken::decode(token).map_err(|e| AppError::ValidationFailed(e.to_string()))
}

/// The first token in `text`: the prefix and the `base64url` run after it.
fn extract_token(text: &str) -> Option<&str> {
    let start = text.find(TOKEN_PREFIX)?;
    let body_start = start + TOKEN_PREFIX.len();
    let body_len = text[body_start..]
        .find(|c: char| !(c.is_ascii_alphanumeric() || c == '-' || c == '_'))
        .unwrap_or(text.len() - body_start);
    Some(&text[start..body_start + body_len])
}

fn find_incident(incidents: &State<IncidentStoreState>, id: &str) -> AppResult<Incident> {
    incidents
        .0
        .get(id)?
        .ok_or_else(|| AppError::Other(format!("Incident {id} not found")))
}

/// The token carries the enabled-mod count, which is not on the incident.
fn token_for(
    incident: &Incident,
    library: &State<ModLibraryState>,
    settings: &State<SettingsState>,
) -> AppResult<String> {
    let config = settings.config()?;
    let enabled = library
        .0
        .get_installed_mods(&config)?
        .iter()
        .filter(|m| m.enabled)
        .count();
    let enabled = u16::try_from(enabled).unwrap_or(u16::MAX);
    Ok(IncidentToken::from_incident(incident, env!("CARGO_PKG_VERSION"), enabled).encode())
}

#[cfg(test)]
mod tests {
    use super::extract_token;

    #[test]
    fn a_token_is_found_in_a_report_and_in_a_url() {
        let report = "# LTK Manager\nIncident: x\nToken: LTK1-eNpVjsEK_gz-AQ\n\nVerdict: y";
        assert_eq!(extract_token(report), Some("LTK1-eNpVjsEK_gz-AQ"));
        let url = "https://example.test/issues/new?diagnostic=LTK1-eNpVjsEK&labels=bug";
        assert_eq!(extract_token(url), Some("LTK1-eNpVjsEK"));
        assert_eq!(extract_token("LTK1-abc"), Some("LTK1-abc"));
        assert_eq!(extract_token("nothing here"), None);
    }
}
