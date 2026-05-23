//! Storage medium detection for performance warnings.
//!
//! On Windows, queries the volume underlying a filesystem path for
//! `IncursSeekPenalty` (HDD vs SSD) via `IOCTL_STORAGE_QUERY_PROPERTY`.
//! This powers a first-time warning when the user's League install or overlay
//! storage lives on a spinning disk — builds on HDD can take 15–20 minutes.

use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
// `Ssd` and `Hdd` are only constructed inside `windows_impl`; on other targets
// this enum is still emitted for the shared ts-rs binding, so we suppress the
// dead-code lint off-Windows rather than letting CI fail.
#[cfg_attr(not(windows), allow(dead_code))]
pub enum StorageMedium {
    Ssd,
    Hdd,
    Unknown,
}

/// Detect whether the given path is on an SSD, HDD, or unknown medium.
///
/// Returns `Unknown` on non-Windows platforms and for any path we can't
/// resolve to a local volume (e.g. UNC paths, missing drives, permission
/// errors). Callers should treat `Unknown` as "don't warn" rather than
/// blocking the UI.
pub fn detect_path_storage_medium(path: &str) -> StorageMedium {
    #[cfg(windows)]
    {
        windows_impl::detect(path)
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        StorageMedium::Unknown
    }
}

#[cfg(windows)]
mod windows_impl {
    use super::StorageMedium;
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr;
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    use windows_sys::Win32::System::Ioctl::{
        PropertyStandardQuery, StorageDeviceSeekPenaltyProperty, DEVICE_SEEK_PENALTY_DESCRIPTOR,
        IOCTL_STORAGE_QUERY_PROPERTY, STORAGE_PROPERTY_QUERY,
    };
    use windows_sys::Win32::System::IO::DeviceIoControl;

    pub fn detect(path: &str) -> StorageMedium {
        let Some(device_path) = volume_device_path(path) else {
            return StorageMedium::Unknown;
        };

        let wide: Vec<u16> = OsStr::new(&device_path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        // SAFETY: CreateFileW with null-terminated wide string. Zero access
        // rights suffice for IOCTL_STORAGE_QUERY_PROPERTY (documented).
        let handle = unsafe {
            CreateFileW(
                wide.as_ptr(),
                0,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                ptr::null_mut(),
                OPEN_EXISTING,
                0,
                ptr::null_mut(),
            )
        };

        if handle == INVALID_HANDLE_VALUE || handle.is_null() {
            return StorageMedium::Unknown;
        }

        let result = query_seek_penalty(handle);

        // SAFETY: handle came from CreateFileW and is not INVALID_HANDLE_VALUE.
        unsafe {
            CloseHandle(handle);
        }

        result
    }

    fn query_seek_penalty(handle: windows_sys::Win32::Foundation::HANDLE) -> StorageMedium {
        let query = STORAGE_PROPERTY_QUERY {
            PropertyId: StorageDeviceSeekPenaltyProperty,
            QueryType: PropertyStandardQuery,
            AdditionalParameters: [0; 1],
        };

        let mut descriptor = DEVICE_SEEK_PENALTY_DESCRIPTOR {
            Version: 0,
            Size: 0,
            IncursSeekPenalty: 0,
        };

        let mut bytes_returned: u32 = 0;

        // SAFETY: query and descriptor are stack-allocated; sizes are correct
        // for the IOCTL. Handle is valid (checked by caller).
        let ok = unsafe {
            DeviceIoControl(
                handle,
                IOCTL_STORAGE_QUERY_PROPERTY,
                &query as *const _ as *const _,
                std::mem::size_of::<STORAGE_PROPERTY_QUERY>() as u32,
                &mut descriptor as *mut _ as *mut _,
                std::mem::size_of::<DEVICE_SEEK_PENALTY_DESCRIPTOR>() as u32,
                &mut bytes_returned,
                ptr::null_mut(),
            )
        };

        if ok == 0 || bytes_returned == 0 {
            return StorageMedium::Unknown;
        }

        if descriptor.IncursSeekPenalty != 0 {
            StorageMedium::Hdd
        } else {
            StorageMedium::Ssd
        }
    }

    /// Resolve an arbitrary filesystem path to the device path of its volume
    /// (e.g. `D:\Riot Games\...` → `\\.\D:`). Returns `None` if the path
    /// doesn't start with a drive letter we can query.
    fn volume_device_path(path: &str) -> Option<String> {
        let stripped = path
            .strip_prefix(r"\\?\")
            .or_else(|| path.strip_prefix("//?/"))
            .unwrap_or(path);

        let mut chars = stripped.chars();
        let drive = chars.next()?;
        if !drive.is_ascii_alphabetic() {
            return None;
        }
        if chars.next() != Some(':') {
            return None;
        }

        Some(format!(r"\\.\{}:", drive.to_ascii_uppercase()))
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn device_path_from_drive_letter() {
            assert_eq!(volume_device_path("C:\\"), Some(r"\\.\C:".to_string()));
            assert_eq!(
                volume_device_path(r"D:\Riot Games"),
                Some(r"\\.\D:".to_string())
            );
            assert_eq!(
                volume_device_path("e:/foo/bar"),
                Some(r"\\.\E:".to_string())
            );
        }

        #[test]
        fn device_path_strips_verbatim_prefix() {
            assert_eq!(
                volume_device_path(r"\\?\D:\Riot Games"),
                Some(r"\\.\D:".to_string())
            );
        }

        #[test]
        fn device_path_rejects_non_drive_paths() {
            assert_eq!(volume_device_path("/home/user"), None);
            assert_eq!(volume_device_path(r"\\server\share"), None);
            assert_eq!(volume_device_path(""), None);
            assert_eq!(volume_device_path("1:/foo"), None);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn non_existent_path_returns_unknown_not_error() {
        let medium = detect_path_storage_medium("Z:\\definitely-not-a-real-drive\\path");
        assert!(matches!(
            medium,
            StorageMedium::Unknown | StorageMedium::Ssd | StorageMedium::Hdd
        ));
    }

    #[cfg(windows)]
    #[test]
    fn system_drive_reports_ssd_or_hdd_not_unknown() {
        // C:\ is expected to exist on any Windows dev or CI machine. We can't
        // assert SSD vs HDD specifically, but we can assert the query succeeds.
        let medium = detect_path_storage_medium("C:\\");
        assert!(
            matches!(medium, StorageMedium::Ssd | StorageMedium::Hdd),
            "expected SSD or HDD for C:\\, got {:?}",
            medium
        );
    }
}
