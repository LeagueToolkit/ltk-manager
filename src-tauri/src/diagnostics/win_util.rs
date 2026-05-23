//! Small Windows-only helpers shared across diagnostic checks.
//!
//! Wraps registry reads/enumeration and a couple of file-attribute queries.
//! Kept narrow: these are diagnostic conveniences, not a general-purpose API.

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::ptr;

use windows_sys::Win32::Foundation::{
    ERROR_MORE_DATA, ERROR_SUCCESS, HANDLE, INVALID_HANDLE_VALUE,
};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, GetFileAttributesW, FILE_ATTRIBUTE_OFFLINE, FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS,
    FILE_GENERIC_READ, INVALID_FILE_ATTRIBUTES, OPEN_EXISTING,
};
use windows_sys::Win32::System::Registry::{
    RegCloseKey, RegEnumValueW, RegGetValueW, RegOpenKeyExW, HKEY, KEY_QUERY_VALUE, REG_VALUE_TYPE,
    RRF_RT_REG_DWORD, RRF_RT_REG_QWORD, RRF_RT_REG_SZ, RRF_ZEROONFAILURE,
};

pub use windows_sys::Win32::System::Registry::{
    HKEY_CURRENT_USER as HKCU, HKEY_LOCAL_MACHINE as HKLM,
};

fn to_wide(s: &str) -> Vec<u16> {
    OsStr::new(s)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

/// Encode a `Path` as a null-terminated UTF-16 buffer suitable for Win32
/// `*W` calls. Goes via `OsStr::encode_wide` so non-UTF-8 paths (rare but
/// possible on NTFS) round-trip without lossy conversion through `display()`.
pub fn path_to_wide(path: &Path) -> Vec<u16> {
    path.as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

/// Read a `REG_DWORD` or `REG_QWORD` value from the registry. Returns `None`
/// on any failure (missing key, wrong type, access denied).
pub fn reg_read_num(root: HKEY, subkey: &str, value: &str) -> Option<u64> {
    let subkey_w = to_wide(subkey);
    let value_w = to_wide(value);
    let mut buf: u64 = 0;
    let mut size = std::mem::size_of::<u64>() as u32;
    // SAFETY: pointers are valid for the supplied lengths; RegGetValueW writes
    // at most `size` bytes into `buf`.
    let status = unsafe {
        RegGetValueW(
            root,
            subkey_w.as_ptr(),
            value_w.as_ptr(),
            RRF_RT_REG_DWORD | RRF_RT_REG_QWORD | RRF_ZEROONFAILURE,
            ptr::null_mut(),
            &mut buf as *mut _ as *mut _,
            &mut size,
        )
    };
    if status == ERROR_SUCCESS {
        Some(buf)
    } else {
        None
    }
}

/// Read a `REG_SZ` value as a UTF-16 string. Returns `None` on failure.
#[allow(dead_code)] // used in future fix-action code
pub fn reg_read_str(root: HKEY, subkey: &str, value: &str) -> Option<String> {
    let subkey_w = to_wide(subkey);
    let value_w = to_wide(value);
    let mut size: u32 = 0;
    // First call: probe the required size.
    // SAFETY: passing null buffer with size=0 is the documented probe pattern.
    let status = unsafe {
        RegGetValueW(
            root,
            subkey_w.as_ptr(),
            value_w.as_ptr(),
            RRF_RT_REG_SZ,
            ptr::null_mut(),
            ptr::null_mut(),
            &mut size,
        )
    };
    if status != ERROR_SUCCESS && status != ERROR_MORE_DATA {
        return None;
    }
    if size == 0 {
        return Some(String::new());
    }
    let mut buf: Vec<u16> = vec![0; (size as usize).div_ceil(2)];
    let mut size_out = (buf.len() * 2) as u32;
    // SAFETY: buf has capacity for at least `size_out` bytes.
    let status = unsafe {
        RegGetValueW(
            root,
            subkey_w.as_ptr(),
            value_w.as_ptr(),
            RRF_RT_REG_SZ | RRF_ZEROONFAILURE,
            ptr::null_mut(),
            buf.as_mut_ptr() as *mut _,
            &mut size_out,
        )
    };
    if status != ERROR_SUCCESS {
        return None;
    }
    let chars = (size_out as usize) / 2;
    let trimmed = if chars > 0 && buf[chars - 1] == 0 {
        &buf[..chars - 1]
    } else {
        &buf[..chars]
    };
    Some(String::from_utf16_lossy(trimmed))
}

/// Enumerate the value names under a registry key. Returns an empty Vec on
/// any failure or if the key doesn't exist.
pub fn reg_list_value_names(root: HKEY, subkey: &str) -> Vec<String> {
    let subkey_w = to_wide(subkey);
    let mut hkey: HKEY = ptr::null_mut();
    // SAFETY: standard RegOpenKeyExW pattern.
    let status = unsafe { RegOpenKeyExW(root, subkey_w.as_ptr(), 0, KEY_QUERY_VALUE, &mut hkey) };
    if status != ERROR_SUCCESS {
        return Vec::new();
    }
    let mut names = Vec::new();
    let mut idx: u32 = 0;
    let mut buf: Vec<u16> = vec![0; 1024];
    loop {
        let mut name_len = buf.len() as u32;
        let mut value_type: REG_VALUE_TYPE = 0;
        // SAFETY: buf has name_len capacity. RegEnumValueW writes at most
        // name_len wchars into buf and updates name_len with the actual count.
        let st = unsafe {
            RegEnumValueW(
                hkey,
                idx,
                buf.as_mut_ptr(),
                &mut name_len,
                ptr::null_mut(),
                &mut value_type,
                ptr::null_mut(),
                ptr::null_mut(),
            )
        };
        if st == ERROR_MORE_DATA {
            buf.resize((buf.len() * 2).max(2048), 0);
            continue;
        }
        if st != ERROR_SUCCESS {
            break;
        }
        let name = String::from_utf16_lossy(&buf[..name_len as usize]);
        names.push(name);
        idx += 1;
    }
    // SAFETY: hkey was returned by RegOpenKeyExW above.
    unsafe { RegCloseKey(hkey) };
    names
}

/// Returns true if any of the supplied OneDrive / cloud-sync attributes are
/// set on `path`. Returns false if the path doesn't exist or attrs can't be
/// read — diagnostics treat that as "not flagged".
pub fn has_cloud_sync_attrs(path: &Path) -> bool {
    let wide = path_to_wide(path);
    // SAFETY: null-terminated wide string.
    let attrs = unsafe { GetFileAttributesW(wide.as_ptr()) };
    if attrs == INVALID_FILE_ATTRIBUTES {
        return false;
    }
    (attrs & (FILE_ATTRIBUTE_OFFLINE | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS)) != 0
}

/// Try to open `path` for reading with no sharing. If the call fails with
/// ERROR_SHARING_VIOLATION (or any failure where the file otherwise exists),
/// return true — somebody else holds a handle.
///
/// This is a coarse "is anything else holding it open?" probe. We can't tell
/// *who* without phase-2 NT handle enumeration.
pub fn is_file_locked(path: &Path) -> bool {
    if !path.exists() {
        return false;
    }
    let wide = path_to_wide(path);
    // SAFETY: null-terminated wide string. Zero share mode forces exclusive
    // open; failure is the signal we want.
    let h: HANDLE = unsafe {
        CreateFileW(
            wide.as_ptr(),
            FILE_GENERIC_READ,
            0,
            ptr::null_mut(),
            OPEN_EXISTING,
            0,
            ptr::null_mut(),
        )
    };
    if h == INVALID_HANDLE_VALUE || h.is_null() {
        return true;
    }
    // SAFETY: h came from CreateFileW.
    unsafe { windows_sys::Win32::Foundation::CloseHandle(h) };
    false
}

/// Re-export commonly used roots so check files don't need to depend on
/// windows-sys directly.
pub const ROOTS: &[(HKEY, &str)] = &[(HKCU, "HKCU"), (HKLM, "HKLM")];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reg_read_num_handles_missing_key() {
        let v = reg_read_num(
            HKLM,
            "SOFTWARE\\__ltk_diag_test_definitely_missing__",
            "value",
        );
        assert!(v.is_none());
    }

    #[test]
    fn reg_list_handles_missing_key() {
        let v = reg_list_value_names(HKLM, "SOFTWARE\\__ltk_diag_test_definitely_missing__");
        assert!(v.is_empty());
    }
}
