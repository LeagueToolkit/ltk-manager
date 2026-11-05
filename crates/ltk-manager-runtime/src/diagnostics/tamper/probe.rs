//! The Windows half of the launcher probe.

use std::ptr;

use windows_sys::Wdk::System::Threading::{
    NtQueryInformationProcess, ProcessCommandLineInformation,
};
use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE, NO_ERROR, UNICODE_STRING};
use windows_sys::Win32::NetworkManagement::IpHelper::{
    GetExtendedTcpTable, MIB_TCPTABLE_OWNER_PID, TCP_TABLE_OWNER_PID_LISTENER,
};
use windows_sys::Win32::Networking::WinSock::AF_INET;
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::Threading::{
    GetCurrentProcessId, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
};

use super::{TamperSignal, has_debug_switch};

/// A launcher that starts the manager and injects a module.
const LAUNCHER_EXE: &str = "ltk_launcher.exe";

/// The WebView2 browser process that serves the debug endpoint.
const WEBVIEW_EXE: &str = "msedgewebview2.exe";

/// How far up the process tree a WebView2 process may sit.
const MAX_PARENT_DEPTH: usize = 64;

/// A row of the process table.
struct Process {
    name: String,
    pid: u32,
    parent: u32,
}

/// Returns the live artifacts of the external launcher.
pub fn signals() -> Vec<TamperSignal> {
    let mut signals = Vec::new();

    if launcher_running() {
        signals.push(TamperSignal::LauncherProcess);
    }
    if debug_webview() {
        signals.push(TamperSignal::DebugWebView);
    }
    if bridge_listening() {
        signals.push(TamperSignal::BridgeListener);
    }

    signals
}

/// Whether a launcher that injects into the manager is running.
fn launcher_running() -> bool {
    processes()
        .iter()
        .any(|process| process.name.eq_ignore_ascii_case(LAUNCHER_EXE))
}

/// Whether a WebView2 child of this process carries a debug switch.
fn debug_webview() -> bool {
    let processes = processes();
    // SAFETY: the call takes no pointer.
    let current = unsafe { GetCurrentProcessId() };

    processes
        .iter()
        .filter(|process| process.name.eq_ignore_ascii_case(WEBVIEW_EXE))
        .filter(|process| is_descendant(process.pid, current, &processes))
        .any(|process| command_line(process.pid).is_some_and(|line| has_debug_switch(&line)))
}

/// Whether `pid` sits below `ancestor` in `processes`.
fn is_descendant(pid: u32, ancestor: u32, processes: &[Process]) -> bool {
    let mut current = pid;

    for _ in 0..MAX_PARENT_DEPTH {
        let Some(process) = processes.iter().find(|process| process.pid == current) else {
            return false;
        };

        if process.parent == ancestor {
            return true;
        }
        if process.parent == 0 || process.parent == current {
            return false;
        }

        current = process.parent;
    }

    false
}

/// The command line of `pid`, or `None` if it cannot be read.
fn command_line(pid: u32) -> Option<String> {
    // SAFETY: the call takes no pointer.
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if process.is_null() {
        return None;
    }

    let mut size = 0u32;
    // SAFETY: the first call asks for the required buffer size.
    unsafe {
        NtQueryInformationProcess(
            process,
            ProcessCommandLineInformation,
            ptr::null_mut(),
            0,
            &mut size,
        );
    }
    if size < std::mem::size_of::<UNICODE_STRING>() as u32 {
        // SAFETY: `process` came from OpenProcess.
        unsafe { CloseHandle(process) };
        return None;
    }

    let mut buffer = vec![0u8; size as usize];
    // SAFETY: the buffer is `size` bytes.
    let status = unsafe {
        NtQueryInformationProcess(
            process,
            ProcessCommandLineInformation,
            buffer.as_mut_ptr().cast(),
            size,
            &mut size,
        )
    };
    // SAFETY: `process` came from OpenProcess.
    unsafe { CloseHandle(process) };
    if status < 0 {
        return None;
    }

    // SAFETY: the call wrote a UNICODE_STRING at the start of `buffer`.
    let text: UNICODE_STRING = unsafe { ptr::read_unaligned(buffer.as_ptr().cast()) };
    if text.Buffer.is_null() || text.Length == 0 || text.Length % 2 != 0 {
        return None;
    }

    let length = usize::from(text.Length);
    let buffer_start = buffer.as_ptr() as usize;
    let text_start = text.Buffer as usize;
    let text_end = text_start.checked_add(length)?;
    if text_start < buffer_start + std::mem::size_of::<UNICODE_STRING>()
        || text_end > buffer_start + buffer.len()
    {
        return None;
    }

    // SAFETY: the range checked above lies inside `buffer`.
    let units = unsafe { std::slice::from_raw_parts(text.Buffer, length / 2) };
    Some(String::from_utf16_lossy(units))
}

/// Whether this process listens on a TCP port.
///
/// An injected bridge has to open a listener to accept commands from the
/// launcher. LTK Manager itself listens on none.
fn bridge_listening() -> bool {
    // SAFETY: the call takes no pointer.
    let current = unsafe { GetCurrentProcessId() };
    listening_pids().contains(&current)
}

/// Every process id that owns an IPv4 listener.
fn listening_pids() -> Vec<u32> {
    let mut size = 0u32;
    // SAFETY: the first call asks for the required buffer size.
    unsafe {
        GetExtendedTcpTable(
            ptr::null_mut(),
            &mut size,
            0,
            u32::from(AF_INET),
            TCP_TABLE_OWNER_PID_LISTENER,
            0,
        );
    }
    if size == 0 {
        return Vec::new();
    }

    let mut buffer = vec![0u32; (size as usize).div_ceil(4)];
    // SAFETY: the buffer is at least `size` bytes.
    let status = unsafe {
        GetExtendedTcpTable(
            buffer.as_mut_ptr().cast(),
            &mut size,
            0,
            u32::from(AF_INET),
            TCP_TABLE_OWNER_PID_LISTENER,
            0,
        )
    };
    if status != NO_ERROR {
        return Vec::new();
    }

    // SAFETY: the table starts at the buffer and holds `dwNumEntries` rows.
    let table = unsafe { &*buffer.as_ptr().cast::<MIB_TCPTABLE_OWNER_PID>() };
    let rows =
        unsafe { std::slice::from_raw_parts(table.table.as_ptr(), table.dwNumEntries as usize) };

    rows.iter().map(|row| row.dwOwningPid).collect()
}

/// Every running process.
fn processes() -> Vec<Process> {
    // SAFETY: the snapshot call takes no pointer.
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE || snapshot.is_null() {
        return Vec::new();
    }

    // SAFETY: a zeroed entry is valid before `dwSize` is set.
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

    let mut processes = Vec::new();
    // SAFETY: `entry` is correctly sized.
    if unsafe { Process32FirstW(snapshot, &mut entry) } != 0 {
        loop {
            processes.push(Process {
                name: wide_z(&entry.szExeFile),
                pid: entry.th32ProcessID,
                parent: entry.th32ParentProcessID,
            });

            // SAFETY: `entry` is correctly sized.
            if unsafe { Process32NextW(snapshot, &mut entry) } == 0 {
                break;
            }
        }
    }

    // SAFETY: `snapshot` came from CreateToolhelp32Snapshot.
    unsafe { CloseHandle(snapshot) };
    processes
}

/// A null-terminated UTF-16 buffer as a string.
fn wide_z(buffer: &[u16]) -> String {
    let length = buffer
        .iter()
        .position(|&unit| unit == 0)
        .unwrap_or(buffer.len());

    String::from_utf16_lossy(&buffer[..length])
}
