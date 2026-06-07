pub mod api;
#[cfg(target_os = "macos")]
pub mod macos;
pub mod runner;

use crate::error::AppResult;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use serde::Serialize;
use tauri::AppHandle;
use ts_rs::TS;

#[cfg(target_os = "windows")]
use self::api::PATCHER_DLL_NAME;
#[cfg(target_os = "windows")]
use self::runner::{run_legacy_patcher_loop, LegacyPatcherLoopError, DEFAULT_HOOK_TIMEOUT_MS};
#[cfg(target_os = "windows")]
use crate::error::AppError;
#[cfg(target_os = "windows")]
use tauri::Manager;

/// Current phase of the patcher lifecycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum PatcherPhase {
    Idle,
    Building,
    Patching,
}

pub struct PatcherState(pub Arc<Mutex<PatcherStateInner>>);

impl PatcherState {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(PatcherStateInner::new())))
    }
}

impl Default for PatcherState {
    fn default() -> Self {
        Self::new()
    }
}

/// Stored patcher configuration for hot-reload (re-start with the same options).
#[derive(Debug, Clone)]
pub struct StoredPatcherConfig {
    pub log_file: Option<String>,
    pub timeout_ms: Option<u32>,
    pub flags: Option<u64>,
    pub workshop_projects: Option<Vec<String>>,
}

pub struct PatcherStateInner {
    /// Flag to signal the patcher thread to stop.
    pub stop_flag: Arc<AtomicBool>,
    /// Handle to the patcher thread.
    pub thread_handle: Option<JoinHandle<()>>,
    /// The config path used when starting.
    pub config_path: Option<String>,
    /// Current phase of the patcher lifecycle.
    pub phase: PatcherPhase,
    /// Last patcher config used, for hot-reload.
    pub last_config: Option<StoredPatcherConfig>,
}

impl PatcherStateInner {
    pub fn new() -> Self {
        Self {
            stop_flag: Arc::new(AtomicBool::new(false)),
            thread_handle: None,
            config_path: None,
            phase: PatcherPhase::Idle,
            last_config: None,
        }
    }

    pub fn is_running(&self) -> bool {
        self.thread_handle
            .as_ref()
            .map(|h| !h.is_finished())
            .unwrap_or(false)
    }
}

impl Default for PatcherStateInner {
    fn default() -> Self {
        Self::new()
    }
}

pub(crate) struct PlatformPatcherConfig<'a> {
    pub app_handle: &'a AppHandle,
    pub overlay_root: &'a Path,
    #[cfg(target_os = "windows")]
    pub overlay_root_str: &'a str,
    #[cfg(target_os = "windows")]
    pub log_file: Option<&'a str>,
    #[cfg(target_os = "windows")]
    pub timeout_ms: Option<u32>,
    #[cfg(target_os = "windows")]
    pub flags: Option<u64>,
    pub stop_flag: &'a AtomicBool,
}

#[cfg(target_os = "windows")]
pub(crate) fn run_platform_patcher_loop(config: PlatformPatcherConfig<'_>) -> AppResult<()> {
    let dll_path = resolve_patcher_dll_path(config.app_handle)?;
    tracing::info!("Using patcher DLL: {}", dll_path.display());

    match run_legacy_patcher_loop(
        &dll_path,
        config.overlay_root_str,
        config.log_file,
        config.timeout_ms.unwrap_or(DEFAULT_HOOK_TIMEOUT_MS),
        config.flags.unwrap_or(0),
        config.stop_flag,
    ) {
        Ok(()) => tracing::info!("Patcher loop completed successfully"),
        Err(LegacyPatcherLoopError::Stopped) => tracing::info!("Patcher stopped by request"),
        Err(e) => tracing::error!("Patcher loop error: {}", e),
    }

    Ok(())
}

#[cfg(target_os = "macos")]
pub(crate) fn run_platform_patcher_loop(config: PlatformPatcherConfig<'_>) -> AppResult<()> {
    macos::run_process_patcher_loop(config.app_handle, config.overlay_root, config.stop_flag)
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub(crate) fn run_platform_patcher_loop(_config: PlatformPatcherConfig<'_>) -> AppResult<()> {
    Err(crate::error::AppError::Other(
        "The patcher is not yet available on this platform".to_string(),
    ))
}

/// Resolve the path to the patcher DLL from bundled resources.
#[cfg(target_os = "windows")]
fn resolve_patcher_dll_path(app_handle: &AppHandle) -> AppResult<std::path::PathBuf> {
    let resource_path = app_handle
        .path()
        .resource_dir()
        .map_err(|e| AppError::Other(format!("Failed to get resource directory: {}", e)))?
        .join(PATCHER_DLL_NAME);

    if resource_path.exists() {
        tracing::info!(
            "Resolved patcher DLL from resource_dir: {}",
            resource_path.display()
        );
        return Ok(resource_path);
    }

    let dev_path = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .map(|p| p.join(PATCHER_DLL_NAME));

    if let Some(ref path) = dev_path {
        if path.exists() {
            tracing::info!(
                "Resolved patcher DLL next to executable: {}",
                path.display()
            );
            return Ok(path.clone());
        }
    }

    let manifest_resource_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join(PATCHER_DLL_NAME);
    if manifest_resource_path.exists() {
        tracing::info!(
            "Resolved patcher DLL from CARGO_MANIFEST_DIR resources: {}",
            manifest_resource_path.display()
        );
        return Ok(manifest_resource_path);
    }

    Err(AppError::Other(format!(
        "Patcher DLL not found. Tried:\n - {}\n - {}\n - {}",
        resource_path.display(),
        dev_path
            .as_ref()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| "<unavailable>".to_string()),
        manifest_resource_path.display(),
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patcher_state_inner_defaults_to_idle() {
        let inner = PatcherStateInner::new();
        assert_eq!(inner.phase, PatcherPhase::Idle);
        assert!(inner.thread_handle.is_none());
        assert!(inner.config_path.is_none());
    }

    #[test]
    fn is_running_false_when_no_thread() {
        let inner = PatcherStateInner::new();
        assert!(!inner.is_running());
    }

    #[test]
    fn patcher_phase_serialization() {
        assert_eq!(
            serde_json::to_string(&PatcherPhase::Idle).unwrap(),
            "\"idle\""
        );
        assert_eq!(
            serde_json::to_string(&PatcherPhase::Building).unwrap(),
            "\"building\""
        );
        assert_eq!(
            serde_json::to_string(&PatcherPhase::Patching).unwrap(),
            "\"patching\""
        );
    }

    #[test]
    fn patcher_state_new_creates_valid_state() {
        let state = PatcherState::new();
        let inner = state.0.lock().unwrap();
        assert!(!inner.is_running());
        assert_eq!(inner.phase, PatcherPhase::Idle);
    }
}
