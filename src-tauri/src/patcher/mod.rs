pub mod backend;
pub mod host;
pub mod injector;

use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use serde::Serialize;
use ts_rs::TS;

/// Current phase of the patcher lifecycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum PatcherPhase {
    Idle,
    Building,
    WaitingForGame,
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
    /// Active platform backend.
    pub backend: Option<String>,
    /// Human-readable backend state.
    pub message: Option<String>,
}

impl PatcherStateInner {
    pub fn new() -> Self {
        Self {
            stop_flag: Arc::new(AtomicBool::new(false)),
            thread_handle: None,
            config_path: None,
            phase: PatcherPhase::Idle,
            last_config: None,
            backend: None,
            message: None,
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
            serde_json::to_string(&PatcherPhase::WaitingForGame).unwrap(),
            "\"waitingForGame\""
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
