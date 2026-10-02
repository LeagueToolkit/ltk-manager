use crate::error::IpcResult;
use crate::state::SettingsState;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub log_file_path: Option<String>,
    pub os: String,
    pub arch: String,
}

/// Get basic app information.
#[tauri::command]
#[specta::specta]
pub fn get_app_info() -> IpcResult<AppInfo> {
    let log_file_path = crate::logging::default_log_dir()
        .map(|p: std::path::PathBuf| p.to_string_lossy().into_owned());

    IpcResult::ok(AppInfo {
        name: "LTK Manager".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        log_file_path,
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    })
}

/// Reveal the main window once the frontend has finished its initial render.
///
/// The window is created hidden (`visible: false` in `tauri.conf.json`) to avoid a
/// white flash while the WebView loads. The frontend calls this after it mounts.
/// When the user has opted to start in the tray, the window stays hidden — the tray
/// icon (or an available update, handled in the UI) reveals it later.
#[tauri::command]
#[specta::specta]
pub fn show_main_window(app: AppHandle, settings: State<SettingsState>) -> IpcResult<()> {
    let start_hidden = {
        let settings = settings.0.lock();
        settings.start_in_tray || settings.start_in_tray_unless_update
    };

    if !start_hidden {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }

    IpcResult::ok(())
}
