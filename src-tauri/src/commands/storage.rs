use crate::error::IpcResult;
use crate::storage::{detect_path_storage_medium, StorageMedium};

/// Detect whether the given path is on an SSD, HDD, or unknown medium.
///
/// Returns `Unknown` on non-Windows platforms and for any path we can't
/// resolve to a local volume (e.g. UNC paths, missing drives, permission
/// errors). Callers should treat `Unknown` as "don't warn" rather than
/// blocking the UI.
#[tauri::command]
pub fn detect_storage_medium(path: String) -> IpcResult<StorageMedium> {
    IpcResult::ok(detect_path_storage_medium(&path))
}
