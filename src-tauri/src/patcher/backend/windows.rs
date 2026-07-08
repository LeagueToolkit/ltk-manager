//! Windows backend driving the external `cslol-host.exe` injection host over
//! its stdin/stdout line protocol (see [`crate::patcher::host`] and
//! [`crate::patcher::injector`]). The host owns all injection logic; we never
//! load the patcher DLL into the manager process.

use super::{
    BackendError, BackendResult, PatcherAvailability, PatcherBackend, PatcherContext,
    PatcherEventSink, PatcherPreflight,
};
use crate::commands::patcher::{WadScanFailedPayload, WadScanFailureInfo};
use crate::error::{AppError, AppResult};
use crate::patcher::host::{HostConfig, HostLogLevel};
use crate::patcher::injector::{Injector, InjectorEvent, INJECTOR_EXE_NAME};
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

pub struct WindowsHostBackend {
    app_handle: AppHandle,
}

impl WindowsHostBackend {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }

    /// Resolve the bundled host executable: resource dir, then next to the
    /// manager executable, then the crate's checked-in `resources/` folder
    /// (`resource_dir()` during `tauri dev` often points at `target/debug/`,
    /// where resources may not be copied).
    fn resolve_host_exe(&self) -> AppResult<PathBuf> {
        let resource_path = self
            .app_handle
            .path()
            .resource_dir()
            .map_err(|error| AppError::Other(format!("Failed to get resource directory: {error}")))?
            .join(INJECTOR_EXE_NAME);
        if resource_path.exists() {
            return Ok(resource_path);
        }

        if let Some(path) = std::env::current_exe()
            .ok()
            .and_then(|path| path.parent().map(|parent| parent.join(INJECTOR_EXE_NAME)))
            .filter(|path| path.exists())
        {
            return Ok(path);
        }

        let manifest_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(INJECTOR_EXE_NAME);
        if manifest_path.exists() {
            return Ok(manifest_path);
        }

        Err(AppError::Other(format!(
            "{} not found. Tried:\n - {}\n - {}",
            INJECTOR_EXE_NAME,
            resource_path.display(),
            manifest_path.display(),
        )))
    }
}

impl PatcherBackend for WindowsHostBackend {
    fn name(&self) -> &'static str {
        "windows-host"
    }

    fn availability(&self) -> PatcherAvailability {
        match self.resolve_host_exe() {
            Ok(_) => PatcherAvailability {
                supported: true,
                ready: true,
                reason: None,
                requires_setup: false,
                permission_required: false,
                helper_version: None,
            },
            Err(error) => PatcherAvailability {
                supported: true,
                ready: false,
                reason: Some(error.to_string()),
                requires_setup: true,
                permission_required: false,
                helper_version: None,
            },
        }
    }

    fn preflight(&self, _context: &PatcherContext) -> AppResult<PatcherPreflight> {
        self.resolve_host_exe()?;
        Ok(PatcherPreflight {
            compatible: true,
            backend: self.name().into(),
            architecture: std::env::consts::ARCH.into(),
            signature: None,
            reason: None,
        })
    }

    fn run(
        &self,
        context: PatcherContext,
        stop: Arc<AtomicBool>,
        events: PatcherEventSink,
    ) -> BackendResult<()> {
        let host_exe = self
            .resolve_host_exe()
            .map_err(|error| BackendError::Failed {
                code: "HOST_MISSING".into(),
                detail: error.to_string(),
            })?;

        let mut overlay_prefix = context.overlay_root.display().to_string();
        if !overlay_prefix.ends_with(std::path::MAIN_SEPARATOR) {
            overlay_prefix.push(std::path::MAIN_SEPARATOR);
        }

        let host_config = HostConfig {
            prefix: overlay_prefix.clone(),
            log_level: HostLogLevel::Info,
            flags: context.flags as u32,
        };

        events(super::BackendEvent {
            event: "waitingForGame".into(),
            pid: None,
            architecture: Some(std::env::consts::ARCH.into()),
            signature: None,
            detail: None,
        });

        // The injector emits WAD-scan failures through this callback (and then
        // auto-stops via the shared stop flag). The frontend contract is the
        // `patcher-wad-scan-failed` event, so translate it here instead of
        // routing through the generic backend-event sink.
        let event_app = self.app_handle.clone();
        let run_result = Injector::new(host_exe)
            .with_elevate(context.elevate)
            .on_event(move |event| match event {
                InjectorEvent::WadScanFailed { failures } => {
                    let payload = WadScanFailedPayload {
                        failures: failures
                            .into_iter()
                            .map(|failure| WadScanFailureInfo {
                                wad: failure.wad,
                                status: failure.status,
                            })
                            .collect(),
                    };
                    let _ = event_app.emit("patcher-wad-scan-failed", payload);
                }
            })
            .run(&overlay_prefix, &stop, &host_config);

        match run_result {
            Ok(()) => Ok(()),
            Err(error) => Err(BackendError::Failed {
                code: "WINDOWS_PATCHER_FAILED".into(),
                detail: error.to_string(),
            }),
        }
    }
}
