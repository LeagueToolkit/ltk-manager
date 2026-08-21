//! Lifecycle state shared between a patching session and its callers.

use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::thread::JoinHandle;

use serde::{Deserialize, Serialize};

/// Current phase of the patcher lifecycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub enum PatcherPhase {
    Idle,
    Building,
    Patching,
}

/// Patcher configuration stashed so hot-reload can restart with the same
/// options.
#[derive(Debug, Clone)]
pub struct StoredPatcherConfig {
    pub flags: Option<u64>,
    pub workshop_projects: Option<Vec<String>>,
}

impl StoredPatcherConfig {
    /// What a session started from this config covers.
    pub fn origin(&self) -> SessionOrigin {
        match self.workshop_projects.as_deref() {
            Some(projects) if !projects.is_empty() => SessionOrigin::Workshop {
                projects: projects.to_vec(),
            },
            _ => SessionOrigin::Library,
        }
    }
}

/// What a patching session was started for, and what it covers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum SessionOrigin {
    /// The library's enabled mods.
    Library,
    /// A workshop test over these project directories.
    Workshop {
        /// Absolute paths to the project directories under test.
        projects: Vec<String>,
    },
}

impl SessionOrigin {
    /// Whether the session is a workshop test rather than a library run.
    pub fn is_workshop(&self) -> bool {
        matches!(self, Self::Workshop { .. })
    }
}

/// A patching session, from the moment it is asked for until the thread exits.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct PatcherSession {
    /// What the session was started for.
    pub origin: SessionOrigin,
    /// The overlay root the session patches against, with a trailing separator.
    ///
    /// `None` until the build phase produces one.
    pub overlay_prefix: Option<String>,
}

pub struct PatcherStateInner {
    /// Flag to signal the patcher thread to stop.
    pub stop_flag: Arc<AtomicBool>,
    /// Handle to the patcher thread.
    pub thread_handle: Option<JoinHandle<()>>,
    /// The session in flight. `None` while idle.
    pub session: Option<PatcherSession>,
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
            session: None,
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

    /// Open a session and enter the build phase.
    pub fn begin_session(&mut self, origin: SessionOrigin) {
        self.phase = PatcherPhase::Building;
        self.session = Some(PatcherSession {
            origin,
            overlay_prefix: None,
        });
    }

    /// Enter the patching phase against the overlay the build produced.
    pub fn enter_patching(&mut self, overlay_prefix: String) {
        self.phase = PatcherPhase::Patching;
        if let Some(session) = self.session.as_mut() {
            session.overlay_prefix = Some(overlay_prefix);
        }
    }

    /// Close the session and return to idle.
    pub fn end_session(&mut self) {
        self.phase = PatcherPhase::Idle;
        self.session = None;
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
        assert!(inner.session.is_none());
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
}
