//! The diagnostics handle the app reports through.
//!
//! The transport is `ltk-telemetry`. What lives here is the decision of whether
//! to report at all, which is the setting, the build profile and the presence of
//! a project key, and where the spool sits.

use std::path::PathBuf;
use std::sync::Arc;

use ltk_telemetry::sink::{ApiKey, PostHogSink};
use ltk_telemetry::{Config, Secret, Telemetry};
use parking_lot::Mutex;
use tauri::AppHandle;
use tracing::{info, warn};

use crate::state::{get_app_data_dir, Settings};

/// The project key the vendor accepts a batch under, supplied at build time.
///
/// A build without it reports nothing, so a fork and a local release build stay
/// out of the project's data. It is public by the vendor's design, and it is not
/// the local secret an identity is salted with.
const API_KEY: Option<&str> = option_env!("LTK_POSTHOG_API_KEY");

/// Whether a build of this profile reports at all.
///
/// A debug build reports nothing whatever the setting says, so a development run
/// does not land in production data. Written as `cfg!` rather than the `#[cfg]`
/// this crate uses elsewhere, so the reporting path is still compiled and linted
/// in a debug build.
const REPORTS: bool = !cfg!(debug_assertions);

/// Where the spool sits, beside the logs and the incidents.
fn spool_dir(app_handle: &AppHandle) -> PathBuf {
    match get_app_data_dir(app_handle) {
        Some(dir) => dir.join("telemetry"),
        None => {
            warn!("No app data directory, keeping the telemetry spool under the temp directory");
            std::env::temp_dir()
                .join("dev.leaguetoolkit.manager")
                .join("telemetry")
        }
    }
}

/// The secret `settings` carries, generating one when it has none.
///
/// Answers whether the settings changed, which is what tells the caller to
/// persist them.
pub fn ensure_secret(settings: &mut Settings) -> (Secret, bool) {
    match &settings.telemetry_secret {
        Some(stored) => (Secret::from_stored(stored.clone()), false),
        None => {
            let secret = Secret::generate();
            settings.telemetry_secret = Some(secret.as_str().to_owned());
            (secret, true)
        }
    }
}

/// The handle `settings` asks for, which reports nothing unless all three of the
/// setting, the build profile and the project key allow it.
pub fn build(app_handle: &AppHandle, settings: &Settings, secret: Secret) -> Telemetry {
    if !settings.telemetry_enabled {
        info!("Diagnostics are off by the setting");
        return Telemetry::disabled();
    }
    if !REPORTS {
        info!("Diagnostics are off in a debug build");
        return Telemetry::disabled();
    }
    let Some(api_key) = API_KEY else {
        info!("Diagnostics are off, this build carries no project key");
        return Telemetry::disabled();
    };

    let sink = match PostHogSink::new(ApiKey::new(api_key), PostHogSink::ENDPOINT_EU) {
        Ok(sink) => Arc::new(sink),
        Err(error) => {
            warn!(%error, "Diagnostics are off, the client could not be built");
            return Telemetry::disabled();
        }
    };

    Telemetry::new(Config::new(secret, spool_dir(app_handle), sink))
}

/// Tauri-managed diagnostics handle, replaced when the setting changes.
pub struct TelemetryState(pub Mutex<Telemetry>);

impl TelemetryState {
    /// The state holding `telemetry`.
    pub fn new(telemetry: Telemetry) -> Self {
        Self(Mutex::new(telemetry))
    }

    /// A handle to report through, taken by clone so no caller holds the lock.
    pub fn handle(&self) -> Telemetry {
        self.0.lock().clone()
    }

    /// Report through `telemetry` from now on, dropping whatever the old handle
    /// had spooled when the new one collects nothing.
    ///
    /// Turning the setting off is a request for collection to stop, so what was
    /// written down before the switch is cleared rather than sent later.
    pub fn replace(&self, telemetry: Telemetry) {
        let mut held = self.0.lock();
        if held.is_enabled() && !telemetry.is_enabled() {
            held.discard();
        }
        *held = telemetry;
    }
}

#[cfg(test)]
mod tests;
