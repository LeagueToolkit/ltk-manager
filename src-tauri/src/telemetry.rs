//! The diagnostics handle the app reports through.
//!
//! The transport is `ltk-telemetry`. What lives here is the decision of whether
//! to report at all, which is the setting, the build profile, the published
//! configuration and the presence of a project key, and where the spool sits.

pub mod config;

use std::path::PathBuf;
use std::sync::Arc;

use ltk_telemetry::sink::{ApiKey, PostHogSink};
use ltk_telemetry::{Config, Secret, Telemetry};
use parking_lot::Mutex;
use tauri::{AppHandle, Manager};
use tracing::{info, warn};

use crate::state::{get_app_data_dir, Settings, SettingsState};
use crate::telemetry::config::Remote;

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

/// Where the last readable published configuration is kept.
pub fn config_path(app_handle: &AppHandle) -> PathBuf {
    spool_dir(app_handle).join("config.json")
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

/// Why nothing is collected, when nothing is collected.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Refusal {
    Setting,
    DebugBuild,
    Document,
    NoKey,
}

impl std::fmt::Display for Refusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let reason = match self {
            Self::Setting => "the setting is off",
            Self::DebugBuild => "this is a debug build",
            Self::Document => "the published configuration says so",
            Self::NoKey => "this build carries no project key",
        };
        f.write_str(reason)
    }
}

/// What stops collection, taking the reader's answer before anything else.
///
/// The document is advisory over the setting and can only narrow what is
/// collected, so a published `enabled` never reaches a reader who refused.
fn refusal(settings: &Settings, remote: &Remote) -> Option<Refusal> {
    if !settings.telemetry_enabled {
        return Some(Refusal::Setting);
    }
    if !REPORTS {
        return Some(Refusal::DebugBuild);
    }
    if !remote.enabled {
        return Some(Refusal::Document);
    }
    if API_KEY.is_none() {
        return Some(Refusal::NoKey);
    }
    None
}

/// The handle `settings` and `remote` allow, which reports nothing unless the
/// setting, the build profile, the document and the key all allow it.
pub fn build(
    app_handle: &AppHandle,
    settings: &Settings,
    secret: Secret,
    remote: &Remote,
) -> Telemetry {
    if let Some(reason) = refusal(settings, remote) {
        info!(%reason, "Diagnostics are off");
        return Telemetry::disabled();
    }
    let Some(api_key) = API_KEY else {
        return Telemetry::disabled();
    };

    let sink = match PostHogSink::new(ApiKey::new(api_key), remote.endpoint.clone()) {
        Ok(sink) => Arc::new(sink),
        Err(error) => {
            warn!(%error, "Diagnostics are off, the client could not be built");
            return Telemetry::disabled();
        }
    };

    Telemetry::new(
        Config::new(secret, spool_dir(app_handle), sink).with_sampling(remote.sampling.clone()),
    )
}

/// Read the published configuration and rebuild the handle from what it says.
///
/// Spawned rather than waited on, because the read is blocking and a boot that
/// reports under the cached answer beats a window that waits for the network.
/// A reader who turned diagnostics off is not asked about, so their install does
/// not fetch the document at all.
pub fn refresh_from_document(app_handle: &AppHandle) {
    let app_handle = app_handle.clone();
    std::thread::spawn(move || {
        {
            let settings: tauri::State<'_, SettingsState> = app_handle.state();
            if !settings.0.lock().telemetry_enabled {
                return;
            }
        }

        let remote = config::fetch(&config_path(&app_handle));

        let telemetry: tauri::State<'_, TelemetryState> = app_handle.state();
        if telemetry.remote() == remote {
            return;
        }
        info!(
            enabled = remote.enabled,
            rate = remote.sampling.global.as_f64(),
            "The published telemetry configuration changed"
        );

        let rebuilt = {
            let settings: tauri::State<'_, SettingsState> = app_handle.state();
            let mut held = settings.0.lock();
            let (secret, _) = ensure_secret(&mut held);
            build(&app_handle, &held, secret, &remote)
        };
        telemetry.apply(remote, rebuilt);
    });
}

/// Tauri-managed diagnostics handle, replaced when what allows it changes.
pub struct TelemetryState {
    telemetry: Mutex<Telemetry>,
    remote: Mutex<Remote>,
}

impl TelemetryState {
    /// The state holding `telemetry`, which `remote` allowed.
    pub fn new(telemetry: Telemetry, remote: Remote) -> Self {
        Self {
            telemetry: Mutex::new(telemetry),
            remote: Mutex::new(remote),
        }
    }

    /// A handle to report through, taken by clone so no caller holds the lock.
    pub fn handle(&self) -> Telemetry {
        self.telemetry.lock().clone()
    }

    /// What the published configuration allows, so a rebuild does not wait on
    /// the network to learn it.
    pub fn remote(&self) -> Remote {
        self.remote.lock().clone()
    }

    /// Drop what is spooled without sending it.
    pub fn discard(&self) {
        self.telemetry.lock().discard();
    }

    /// Report through `telemetry` from now on, dropping whatever the old handle
    /// had spooled when the new one collects nothing.
    ///
    /// Turning collection off is a request for it to stop, so what was written
    /// down before the switch is cleared rather than sent later.
    pub fn replace(&self, telemetry: Telemetry) {
        let mut held = self.telemetry.lock();
        if held.is_enabled() && !telemetry.is_enabled() {
            held.discard();
        }
        *held = telemetry;
    }

    /// Report through `telemetry`, and remember the `remote` that built it.
    fn apply(&self, remote: Remote, telemetry: Telemetry) {
        *self.remote.lock() = remote;
        self.replace(telemetry);
    }
}

#[cfg(test)]
mod tests;
