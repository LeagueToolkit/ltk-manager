use crate::error::IpcResult;
use serde::Serialize;

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PlatformSupport {
    pub os: String,
    pub patcher_available: bool,
    pub hotkeys_available: bool,
}

/// Get platform-specific feature flags.
#[tauri::command]
#[specta::specta]
pub fn get_platform_support() -> IpcResult<PlatformSupport> {
    IpcResult::ok(PlatformSupport {
        os: std::env::consts::OS.to_string(),
        patcher_available: cfg!(target_os = "windows"),
        hotkeys_available: cfg!(target_os = "windows"),
    })
}
