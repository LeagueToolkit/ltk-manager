use crate::error::AppResult;
use crate::platform::LeagueInstall;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tauri::AppHandle;
use ts_rs::TS;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
mod unsupported;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "macos")]
pub use macos::{resolve_helper_path, MacOsBackend, MACOS_HELPER_VERSION};
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
use unsupported::UnsupportedBackend;
#[cfg(target_os = "windows")]
use windows::WindowsHostBackend;

#[derive(Debug, Clone)]
pub struct PatcherContext {
    pub overlay_root: PathBuf,
    pub allowed_root: PathBuf,
    pub league_install: LeagueInstall,
    pub log_file: Option<String>,
    pub timeout_ms: u32,
    pub flags: u64,
    /// Run the injection host elevated (UAC bridge). Windows-only concept;
    /// other backends ignore it.
    pub elevate: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PatcherAvailability {
    pub supported: bool,
    pub ready: bool,
    pub reason: Option<String>,
    pub requires_setup: bool,
    pub permission_required: bool,
    pub helper_version: Option<String>,
}

impl PatcherAvailability {
    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            ready: false,
            reason: Some(reason.into()),
            requires_setup: false,
            permission_required: false,
            helper_version: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PatcherPreflight {
    pub compatible: bool,
    pub backend: String,
    pub architecture: String,
    pub signature: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendEvent {
    pub event: String,
    pub pid: Option<u32>,
    pub architecture: Option<String>,
    pub signature: Option<String>,
    pub detail: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum BackendError {
    #[error("Patcher stopped by request")]
    Stopped,
    #[error("{code}: {detail}")]
    Failed { code: String, detail: String },
}

pub type BackendResult<T> = Result<T, BackendError>;
pub type PatcherEventSink = Arc<dyn Fn(BackendEvent) + Send + Sync>;

pub trait PatcherBackend: Send + Sync {
    fn name(&self) -> &'static str;
    fn availability(&self) -> PatcherAvailability;
    fn preflight(&self, context: &PatcherContext) -> AppResult<PatcherPreflight>;
    fn run(
        &self,
        context: PatcherContext,
        stop: Arc<AtomicBool>,
        events: PatcherEventSink,
    ) -> BackendResult<()>;
}

pub fn selected_backend(app_handle: &AppHandle) -> Box<dyn PatcherBackend> {
    #[cfg(target_os = "windows")]
    {
        Box::new(WindowsHostBackend::new(app_handle.clone()))
    }
    #[cfg(target_os = "macos")]
    {
        Box::new(MacOsBackend::new(app_handle.clone()))
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = app_handle;
        Box::new(UnsupportedBackend)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::league_install::LeaguePlatform;
    use std::sync::atomic::Ordering;
    use std::sync::Mutex;

    struct FakeBackend;

    impl PatcherBackend for FakeBackend {
        fn name(&self) -> &'static str {
            "fake"
        }

        fn availability(&self) -> PatcherAvailability {
            PatcherAvailability {
                supported: true,
                ready: true,
                reason: None,
                requires_setup: false,
                permission_required: false,
                helper_version: Some("test".into()),
            }
        }

        fn preflight(&self, _context: &PatcherContext) -> AppResult<PatcherPreflight> {
            Ok(PatcherPreflight {
                compatible: true,
                backend: self.name().into(),
                architecture: "test".into(),
                signature: Some("fixture".into()),
                reason: None,
            })
        }

        fn run(
            &self,
            _context: PatcherContext,
            stop: Arc<AtomicBool>,
            events: PatcherEventSink,
        ) -> BackendResult<()> {
            events(BackendEvent {
                event: "waitingForGame".into(),
                pid: None,
                architecture: Some("test".into()),
                signature: None,
                detail: None,
            });
            if stop.load(Ordering::SeqCst) {
                Err(BackendError::Stopped)
            } else {
                Ok(())
            }
        }
    }

    fn context() -> PatcherContext {
        PatcherContext {
            overlay_root: PathBuf::from("/tmp/overlay"),
            allowed_root: PathBuf::from("/tmp"),
            league_install: LeagueInstall {
                configured_path: PathBuf::from("/game"),
                install_root: PathBuf::from("/game"),
                game_dir: PathBuf::from("/game/Game"),
                client_lockfile: PathBuf::from("/game/lockfile"),
                game_executable: PathBuf::from("/game/Game/game"),
                game_bundle: None,
                platform: LeaguePlatform::Windows,
            },
            log_file: None,
            timeout_ms: 100,
            flags: 0,
            elevate: false,
        }
    }

    #[test]
    fn fake_backend_emits_events_and_honors_cancellation() {
        let backend = FakeBackend;
        assert!(backend.preflight(&context()).unwrap().compatible);

        let events = Arc::new(Mutex::new(Vec::new()));
        let captured = Arc::clone(&events);
        let sink: PatcherEventSink = Arc::new(move |event| {
            captured.lock().unwrap().push(event.event);
        });
        let stop = Arc::new(AtomicBool::new(true));

        assert!(matches!(
            backend.run(context(), stop, sink),
            Err(BackendError::Stopped)
        ));
        assert_eq!(
            events.lock().unwrap().as_slice(),
            ["waitingForGame".to_string()]
        );
    }
}
