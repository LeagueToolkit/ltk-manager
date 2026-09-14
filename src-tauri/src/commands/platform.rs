use crate::error::IpcResult;
use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PlatformSupport {
    pub os: String,
    pub patcher_available: bool,
    pub hotkeys_available: bool,
}

/// Get platform-specific feature flags.
#[tauri::command]
pub fn get_platform_support() -> IpcResult<PlatformSupport> {
    IpcResult::ok(PlatformSupport {
        os: std::env::consts::OS.to_string(),
        patcher_available: cfg!(any(target_os = "windows", target_os = "macos")),
        hotkeys_available: cfg!(target_os = "windows"),
    })
}
