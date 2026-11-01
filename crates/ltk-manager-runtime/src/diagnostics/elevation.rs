//! Reads how this process is elevated, and the cause that the facts point to.

use serde::Serialize;

/// Integrity RID of a high-integrity token, which an elevated process runs at.
pub const HIGH_INTEGRITY: u32 = 0x3000;

/// Integrity RID of a medium-integrity token, which a plain process runs at.
pub const MEDIUM_INTEGRITY: u32 = 0x2000;

/// Relative id of the built-in Administrator account, which UAC does not filter.
#[cfg(target_os = "windows")]
const ADMINISTRATOR_RID: u32 = 500;

/// Executable name of the Windows shell.
const SHELL_EXE: &str = "explorer.exe";

/// How the token of this process relates to User Account Control.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, strum::Display)]
#[serde(rename_all = "kebab-case")]
#[strum(serialize_all = "kebab-case")]
pub enum ElevationType {
    /// The token is not split: UAC is off, or the account is exempt from filtering.
    Default,
    /// The elevated half of a split token.
    Full,
    /// The filtered half of a split token.
    Limited,
    /// The token could not be read.
    #[default]
    Unknown,
}

/// Why this process runs elevated.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, strum::Display)]
#[serde(rename_all = "kebab-case")]
#[strum(serialize_all = "kebab-case")]
pub enum ElevationCause {
    /// User Account Control is off, so every process runs elevated.
    UacDisabled,
    /// The account is the built-in Administrator, which UAC does not filter.
    BuiltinAdministrator,
    /// The manager executable carries a `RUNASADMIN` compatibility layer.
    CompatLayer,
    /// The shell that starts programs is elevated itself.
    ElevatedShell,
    /// An elevated process other than the shell started the manager.
    ElevatedParent,
    /// The reader chose Run as administrator, or a shortcut did.
    RunAsAdministrator,
    /// The facts do not single out a cause.
    Unknown,
}

/// The facts about the token and the start of this process.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize)]
pub struct ElevationFacts {
    /// Whether the token is elevated.
    pub elevated: bool,
    /// How the token relates to User Account Control.
    pub elevation_type: ElevationType,
    /// The integrity RID of the token, such as [`HIGH_INTEGRITY`].
    pub integrity: Option<u32>,
    /// Whether the shell process is elevated, if its token could be read.
    pub shell_elevated: Option<bool>,
    /// Executable name of the parent process, if it still runs.
    pub parent: Option<String>,
    /// Whether User Account Control is on.
    pub uac_enabled: bool,
    /// Whether the token's user is the built-in Administrator account.
    pub builtin_administrator: bool,
    /// Registry root of a `RUNASADMIN` layer on the manager executable.
    pub compat_layer: Option<String>,
}

impl ElevationFacts {
    /// Returns the cause of the elevation, or `None` if the process is not elevated.
    ///
    /// The first rule that matches wins: a disabled UAC and the built-in Administrator
    /// account elevate everything, a compatibility layer elevates this executable, an
    /// elevated shell or parent elevates what it starts, and a full token with none of those
    /// is a start the reader elevated by hand.
    pub fn cause(&self) -> Option<ElevationCause> {
        if !self.elevated {
            return None;
        }
        if !self.uac_enabled {
            return Some(ElevationCause::UacDisabled);
        }
        if self.builtin_administrator {
            return Some(ElevationCause::BuiltinAdministrator);
        }
        if self.compat_layer.is_some() {
            return Some(ElevationCause::CompatLayer);
        }
        if self.shell_elevated == Some(true) {
            return Some(ElevationCause::ElevatedShell);
        }
        if self
            .parent
            .as_deref()
            .is_some_and(|parent| !parent.eq_ignore_ascii_case(SHELL_EXE))
        {
            return Some(ElevationCause::ElevatedParent);
        }
        if self.elevation_type == ElevationType::Full {
            return Some(ElevationCause::RunAsAdministrator);
        }

        Some(ElevationCause::Unknown)
    }

    /// Returns the integrity level as a word, or the RID in hex if it is not a known level.
    pub fn integrity_name(&self) -> Option<String> {
        self.integrity.map(|rid| match rid {
            HIGH_INTEGRITY => "high".to_string(),
            MEDIUM_INTEGRITY => "medium".to_string(),
            other => format!("{other:#x}"),
        })
    }
}

/// Reads the facts of this process.
///
/// Every fact that cannot be read keeps its default. Off Windows, every fact is its default.
pub fn facts() -> ElevationFacts {
    #[cfg(target_os = "windows")]
    {
        let token = probe::current_token();
        let shell_elevated = probe::shell_pid()
            .and_then(probe::process_token)
            .and_then(|token| probe::elevated(&token));
        let compat_layer = std::env::current_exe()
            .ok()
            .and_then(|exe| super::compat_flags::run_as_admin_layer(&exe));

        ElevationFacts {
            elevated: token.as_ref().and_then(probe::elevated).unwrap_or(false),
            elevation_type: token
                .as_ref()
                .and_then(probe::elevation_type)
                .unwrap_or_default(),
            integrity: token.as_ref().and_then(probe::integrity_rid),
            shell_elevated,
            parent: probe::parent_name(),
            uac_enabled: super::windows::uac_enabled(),
            builtin_administrator: token.as_ref().and_then(probe::user_rid)
                == Some(ADMINISTRATOR_RID),
            compat_layer,
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        ElevationFacts::default()
    }
}

/// Reads the facts of this process, and logs them with their cause.
pub fn log_facts() -> ElevationFacts {
    let facts = facts();
    let cause = facts.cause().map(|cause| cause.to_string());
    tracing::info!(?facts, cause, "Process elevation");
    facts
}

/// Returns `true` if the token of this process is elevated.
#[cfg(target_os = "windows")]
pub(crate) fn current_process_elevated() -> bool {
    probe::current_token()
        .as_ref()
        .and_then(probe::elevated)
        .unwrap_or(false)
}

/// Returns whether the process `pid` is elevated, or `None` if its token cannot be read.
#[cfg(target_os = "windows")]
pub(crate) fn process_elevated(pid: u32) -> Option<bool> {
    probe::process_token(pid).and_then(|token| probe::elevated(&token))
}

#[cfg(target_os = "windows")]
mod probe {
    use std::mem::size_of;
    use std::os::windows::io::{AsRawHandle, OwnedHandle};
    use std::ptr;

    use ltk_manager_base::platform::windows::owned_handle;
    use windows_sys::Win32::Foundation::{ERROR_INSUFFICIENT_BUFFER, GetLastError};
    use windows_sys::Win32::Security::{
        GetSidSubAuthority, GetSidSubAuthorityCount, GetTokenInformation, PSID, TOKEN_ELEVATION,
        TOKEN_ELEVATION_TYPE, TOKEN_INFORMATION_CLASS, TOKEN_MANDATORY_LABEL, TOKEN_QUERY,
        TOKEN_USER, TokenElevation, TokenElevationType, TokenElevationTypeDefault,
        TokenElevationTypeFull, TokenElevationTypeLimited, TokenIntegrityLevel, TokenUser,
    };
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::Threading::{
        GetCurrentProcess, GetCurrentProcessId, OpenProcess, OpenProcessToken,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetShellWindow, GetWindowThreadProcessId};

    use super::ElevationType;

    /// Opens the token of this process for queries.
    pub fn current_token() -> Option<OwnedHandle> {
        let mut token = ptr::null_mut();
        // SAFETY: GetCurrentProcess is a pseudo-handle that needs no closing.
        let ok = unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) };
        if ok == 0 {
            return None;
        }

        // SAFETY: the token came from OpenProcessToken and nothing else holds it.
        unsafe { owned_handle(token) }
    }

    /// Opens the token of the process `pid` for queries.
    ///
    /// Returns `None` if the process or its token refuses the open, which a process of
    /// another user or at a higher integrity level does.
    pub fn process_token(pid: u32) -> Option<OwnedHandle> {
        // SAFETY: the call takes no pointer.
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        // SAFETY: the handle came from OpenProcess and nothing else holds it.
        let process = unsafe { owned_handle(process) }?;

        let mut token = ptr::null_mut();
        // SAFETY: `process` is open for the whole call.
        let ok = unsafe { OpenProcessToken(process.as_raw_handle(), TOKEN_QUERY, &mut token) };
        if ok == 0 {
            return None;
        }

        // SAFETY: the token came from OpenProcessToken and nothing else holds it.
        unsafe { owned_handle(token) }
    }

    /// Reads whether `token` is elevated.
    pub fn elevated(token: &OwnedHandle) -> Option<bool> {
        let bytes = token_bytes(token, TokenElevation)?;
        // SAFETY: the call wrote a TOKEN_ELEVATION into a buffer of at least its size.
        let elevation: TOKEN_ELEVATION = unsafe { ptr::read_unaligned(bytes.as_ptr().cast()) };

        Some(elevation.TokenIsElevated != 0)
    }

    /// Reads how `token` relates to UAC.
    pub fn elevation_type(token: &OwnedHandle) -> Option<ElevationType> {
        let bytes = token_bytes(token, TokenElevationType)?;
        // SAFETY: the call wrote a TOKEN_ELEVATION_TYPE into a buffer of at least its size.
        let raw: TOKEN_ELEVATION_TYPE = unsafe { ptr::read_unaligned(bytes.as_ptr().cast()) };

        Some(if raw == TokenElevationTypeDefault {
            ElevationType::Default
        } else if raw == TokenElevationTypeFull {
            ElevationType::Full
        } else if raw == TokenElevationTypeLimited {
            ElevationType::Limited
        } else {
            ElevationType::Unknown
        })
    }

    /// Reads the integrity RID of `token`.
    pub fn integrity_rid(token: &OwnedHandle) -> Option<u32> {
        let bytes = token_bytes(token, TokenIntegrityLevel)?;
        // SAFETY: the call wrote a self-relative TOKEN_MANDATORY_LABEL into `bytes`.
        let label: TOKEN_MANDATORY_LABEL = unsafe { ptr::read_unaligned(bytes.as_ptr().cast()) };

        // SAFETY: the SID points into `bytes`, which lives to the end of this function.
        unsafe { last_sub_authority(label.Label.Sid) }
    }

    /// Reads the last relative id of the user SID of `token`.
    pub fn user_rid(token: &OwnedHandle) -> Option<u32> {
        let bytes = token_bytes(token, TokenUser)?;
        // SAFETY: the call wrote a self-relative TOKEN_USER into `bytes`.
        let user: TOKEN_USER = unsafe { ptr::read_unaligned(bytes.as_ptr().cast()) };

        // SAFETY: the SID points into `bytes`, which lives to the end of this function.
        unsafe { last_sub_authority(user.User.Sid) }
    }

    /// Reads the pid of the process that owns the desktop window.
    pub fn shell_pid() -> Option<u32> {
        // SAFETY: the call takes no pointer.
        let window = unsafe { GetShellWindow() };
        if window.is_null() {
            return None;
        }

        let mut pid = 0;
        // SAFETY: `pid` outlives the call.
        unsafe { GetWindowThreadProcessId(window, &mut pid) };
        (pid != 0).then_some(pid)
    }

    /// Reads the executable name of the parent of this process, if it still runs.
    pub fn parent_name() -> Option<String> {
        let processes = snapshot()?;
        // SAFETY: the call takes no pointer.
        let own_pid = unsafe { GetCurrentProcessId() };
        let parent_pid = processes
            .iter()
            .find(|(pid, _, _)| *pid == own_pid)
            .map(|(_, parent, _)| *parent)?;

        processes
            .into_iter()
            .find(|(pid, _, _)| *pid == parent_pid)
            .map(|(_, _, name)| name)
    }

    /// Lists every process as `(pid, parent pid, executable name)`.
    fn snapshot() -> Option<Vec<(u32, u32, String)>> {
        // SAFETY: the call takes no pointer.
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        // SAFETY: the handle came from CreateToolhelp32Snapshot and nothing else holds it.
        let snapshot = unsafe { owned_handle(snapshot) }?;

        // SAFETY: PROCESSENTRY32W is plain data, and `dwSize` tells the walker its layout.
        let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
        entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
        // SAFETY: `entry` outlives the call and carries its size.
        if unsafe { Process32FirstW(snapshot.as_raw_handle(), &mut entry) } == 0 {
            return None;
        }

        let mut processes = Vec::new();
        loop {
            let name_len = entry
                .szExeFile
                .iter()
                .position(|&unit| unit == 0)
                .unwrap_or(entry.szExeFile.len());
            processes.push((
                entry.th32ProcessID,
                entry.th32ParentProcessID,
                String::from_utf16_lossy(&entry.szExeFile[..name_len]),
            ));

            // SAFETY: `entry` outlives the call and carries its size.
            if unsafe { Process32NextW(snapshot.as_raw_handle(), &mut entry) } == 0 {
                break;
            }
        }

        Some(processes)
    }

    /// Reads the variable-size information `class` of `token`.
    fn token_bytes(token: &OwnedHandle, class: TOKEN_INFORMATION_CLASS) -> Option<Vec<u8>> {
        let mut len = 0u32;
        // SAFETY: a null buffer of length 0 asks for the length alone.
        let ok = unsafe {
            GetTokenInformation(token.as_raw_handle(), class, ptr::null_mut(), 0, &mut len)
        };
        // SAFETY: GetLastError reads the error of this thread's last call.
        if ok != 0 || unsafe { GetLastError() } != ERROR_INSUFFICIENT_BUFFER || len == 0 {
            return None;
        }

        let mut bytes = vec![0u8; len as usize];
        // SAFETY: `bytes` holds `len` bytes, the length the first call asked for.
        let ok = unsafe {
            GetTokenInformation(
                token.as_raw_handle(),
                class,
                bytes.as_mut_ptr().cast(),
                len,
                &mut len,
            )
        };

        (ok != 0).then_some(bytes)
    }

    /// Reads the last sub-authority of `sid`.
    ///
    /// # Safety
    ///
    /// `sid` is null or points to a valid SID.
    unsafe fn last_sub_authority(sid: PSID) -> Option<u32> {
        if sid.is_null() {
            return None;
        }

        // SAFETY: the caller guarantees a valid SID, whose count and sub-authorities the
        // two calls return pointers into.
        unsafe {
            let count = *GetSidSubAuthorityCount(sid);
            if count == 0 {
                return None;
            }
            Some(*GetSidSubAuthority(sid, u32::from(count) - 1))
        }
    }
}

#[cfg(test)]
mod tests;
