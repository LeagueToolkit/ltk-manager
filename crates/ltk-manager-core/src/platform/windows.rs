//! Windows-only helpers: registry reads, file attribute queries and handles that close on drop.

use std::os::windows::ffi::OsStrExt;
use std::os::windows::io::{FromRawHandle, OwnedHandle};
use std::path::Path;
use std::ptr;

use windows_sys::Win32::Foundation::{HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, FILE_ATTRIBUTE_OFFLINE, FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS, FILE_GENERIC_READ,
    GetFileAttributesW, INVALID_FILE_ATTRIBUTES, OPEN_EXISTING,
};
use winreg::HKEY;
use winreg::RegKey;

pub use winreg::enums::{HKEY_CURRENT_USER as HKCU, HKEY_LOCAL_MACHINE as HKLM};

/// The registry roots a check reads, beside the label it prints for each.
pub const ROOTS: &[(HKEY, &str)] = &[(HKCU, "HKCU"), (HKLM, "HKLM")];

/// `path` as a null-terminated UTF-16 buffer for a Win32 `*W` call.
///
/// Encoded through `OsStr::encode_wide`, so a path that is not UTF-8 keeps every unit.
pub fn path_to_wide(path: &Path) -> Vec<u16> {
    path.as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

/// A handle a Win32 call returned, closed on drop, or `None` for a failed call.
///
/// # Safety
///
/// `handle` is a handle this process owns and nothing else closes.
pub unsafe fn owned_handle(handle: HANDLE) -> Option<OwnedHandle> {
    if handle.is_null() || handle == INVALID_HANDLE_VALUE {
        return None;
    }

    // SAFETY: the caller owns the handle, and it is neither null nor invalid.
    Some(unsafe { OwnedHandle::from_raw_handle(handle) })
}

/// A `REG_DWORD` or `REG_QWORD` value, or `None` on any failure.
pub fn reg_read_num(root: HKEY, subkey: &str, value: &str) -> Option<u64> {
    let key = RegKey::predef(root).open_subkey(subkey).ok()?;
    key.get_value::<u32, _>(value)
        .map(u64::from)
        .or_else(|_| key.get_value::<u64, _>(value))
        .ok()
}

/// A string value, or `None` on any failure.
pub fn reg_read_str(root: HKEY, subkey: &str, value: &str) -> Option<String> {
    RegKey::predef(root)
        .open_subkey(subkey)
        .ok()?
        .get_value(value)
        .ok()
}

/// The value names under a key, and none where the key does not open.
pub fn reg_list_value_names(root: HKEY, subkey: &str) -> Vec<String> {
    let Ok(key) = RegKey::predef(root).open_subkey(subkey) else {
        return Vec::new();
    };

    key.enum_values()
        .map_while(Result::ok)
        .map(|(name, _)| name)
        .collect()
}

/// Whether `path` carries a OneDrive or cloud-sync attribute. A path that does not exist or
/// whose attributes do not read is not flagged.
pub fn has_cloud_sync_attrs(path: &Path) -> bool {
    let wide = path_to_wide(path);
    // SAFETY: null-terminated wide string.
    let attrs = unsafe { GetFileAttributesW(wide.as_ptr()) };
    if attrs == INVALID_FILE_ATTRIBUTES {
        return false;
    }
    (attrs & (FILE_ATTRIBUTE_OFFLINE | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS)) != 0
}

/// Whether another process holds `path` open, by opening it with no sharing.
///
/// A coarse probe. It cannot tell which process holds the file without enumerating NT handles.
pub fn is_file_locked(path: &Path) -> bool {
    if !path.exists() {
        return false;
    }
    let wide = path_to_wide(path);
    // SAFETY: null-terminated wide string. Zero share mode forces an exclusive open, and its
    // failure is the signal.
    let handle = unsafe {
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
    // SAFETY: the handle came from CreateFileW and nothing else holds it.
    unsafe { owned_handle(handle) }.is_none()
}

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
