//! Builds the patcher delivery client of this manager build and runs its syncs.

use std::path::Path;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::Utc;
use ltk_manager_base::advisory::{Advisories, Advisory, AdvisoryCode};
use ltk_manager_base::config::Config;
use ltk_manager_runtime::patcher::delivery::{
    attested_build, Channel, DeliveryError, DeliveryFailure, PatcherDelivery, StagedPatcher,
};
use parking_lot::Mutex;
use semver::{Prerelease, Version};

/// Base URL and base64 minisign manifest key of the staging delivery service.
const STAGING: (&str, &str) = (
    "https://patcher-staging.leaguetoolkit.dev",
    "RWRHh5bl7JOIscd3lf1Sw2xqd5qcoSeau1GmXjBm7C4KA4YSB0DOf+Kx",
);
/// Base URL and base64 minisign manifest key of the production delivery service.
const PRODUCTION: (&str, &str) = (
    "https://patcher.leaguetoolkit.dev",
    "RWSk74swcHfkZfLblm3iSk9RLVHJ1xjtqn/zySIPaCBM1hecnlFy1Bxi",
);

/// Build attestation that the release workflow signed for this manager version.
///
/// Read by `option_env!` at compile time. A build without it reads the staged DLLs only.
const ATTESTATION: Option<&str> = option_env!("LTK_PATCHER_ATTESTATION");

/// Delivery environment that the attestation is for. `staging` selects staging, and any
/// other value or no value selects production.
///
/// Read by `option_env!` at compile time, beside [`ATTESTATION`].
const DELIVERY: Option<&str> = option_env!("LTK_PATCHER_DELIVERY");

/// Host protocol of `resources/ltk_patcher_host.exe`, as decimal text.
///
/// The release workflow reads the same file into the build attestation, so the file must
/// change together with the binary.
const BUNDLED_HOST_PROTOCOL: &str = include_str!("../../host-protocol");

/// Tauri-managed delivery client, and the lock that allows one sync at a time.
#[derive(Clone)]
pub struct PatcherDeliveryState {
    delivery: Option<Arc<PatcherDelivery>>,
    syncing: Arc<Mutex<()>>,
    /// Why the patcher that the service offers is not used: the build attestation was
    /// rejected, or the last sync failed a check. `None` if the last sync passed.
    failed_check: Arc<Mutex<Option<String>>>,
}

impl PatcherDeliveryState {
    /// Builds the client with its state under `data_dir`.
    ///
    /// Removes the staged builds that no cached manifest offers, before any session can
    /// select one. Returns a state without a client if the target is not Windows or if
    /// `data_dir` is `None`. The client has no attestation if the build has none or if its
    /// attestation names another manager version or host protocol.
    pub fn new(data_dir: Option<&Path>) -> Self {
        let state = Self::without_cleanup(data_dir);
        if let Some(delivery) = state.delivery() {
            delivery.remove_unused();
        }
        state
    }

    /// Builds the client with its state under `data_dir`, and removes no staged build.
    ///
    /// For a process that reads the staged builds and starts no session. Returns the same
    /// client as [`Self::new`].
    pub fn without_cleanup(data_dir: Option<&Path>) -> Self {
        let manager = Version {
            pre: Prerelease::EMPTY,
            ..Version::parse(env!("CARGO_PKG_VERSION")).expect("CARGO_PKG_VERSION is semver")
        };
        let release = manager.to_string();
        let protocol: u32 = BUNDLED_HOST_PROTOCOL
            .trim()
            .parse()
            .expect("src-tauri/host-protocol holds a decimal protocol number");
        let (url, public_key) = match DELIVERY {
            Some("staging") => STAGING,
            _ => PRODUCTION,
        };
        let attestation = ATTESTATION.filter(|attestation| {
            attested_build(attestation)
                .is_some_and(|build| build.version == release && build.protocol == protocol)
        });
        let rejected = ATTESTATION.is_some() && attestation.is_none();
        if rejected {
            tracing::warn!(
                %release,
                protocol,
                "The build attestation does not name this manager version and host protocol. The patcher DLL is not downloaded"
            );
        }
        let failed_check = rejected.then(|| {
            "the build attestation does not name this manager version and host protocol".to_owned()
        });

        let delivery = data_dir.filter(|_| cfg!(windows)).map(|dir| {
            Arc::new(PatcherDelivery {
                root: dir.join(crate::data_location::PATCHER),
                url: url.to_string(),
                public_key: public_key.to_string(),
                attestation: attestation.map(str::to_string),
                manager,
                protocol,
            })
        });

        Self {
            delivery,
            syncing: Arc::new(Mutex::new(())),
            failed_check: Arc::new(Mutex::new(failed_check)),
        }
    }

    /// Returns the client, or `None` if this target does not use delivery.
    pub fn delivery(&self) -> Option<&PatcherDelivery> {
        self.delivery.as_deref()
    }

    /// Raises `dll-unattested` on `advisories` if the patcher that the service offers is
    /// not used because it failed a check. A session then runs an older staged build.
    pub fn raise_failed_check(&self, advisories: &mut Advisories) {
        if let Some(reason) = self.failed_check.lock().as_deref() {
            advisories
                .raise(Advisory::new(AdvisoryCode::DllUnattested, Utc::now()).with_detail(reason));
        }
    }

    /// Syncs the channel of `config` on a background thread, after any running sync.
    ///
    /// Skips the sync if the build has no attestation.
    pub fn sync_in_background(&self, config: &Config) {
        let attested = self
            .delivery
            .as_ref()
            .is_some_and(|delivery| delivery.attestation.is_some());
        if !attested {
            return;
        }

        let state = self.clone();
        let channel = channel(config);
        std::thread::spawn(move || {
            let _guard = state.syncing.lock();
            state.sync(channel);
        });
    }

    /// Syncs `channel`, and logs and reports a failure. Keeps the failure of a check of
    /// the offered patcher for [`Self::raise_failed_check`], and forgets it after a sync
    /// that passes.
    fn sync(&self, channel: Channel) {
        let Some(delivery) = self.delivery() else {
            return;
        };
        match delivery.sync(channel) {
            Ok(_) => *self.failed_check.lock() = None,
            Err(error) => {
                tracing::warn!(%channel, %error, "Patcher delivery sync failed");
                crate::telemetry::report_delivery_sync_failed(
                    channel.as_str(),
                    error.kind().as_str(),
                );
                if matches!(
                    error.kind(),
                    DeliveryFailure::Integrity | DeliveryFailure::Signature
                ) {
                    *self.failed_check.lock() = Some(error.to_string());
                }
            }
        }
    }

    /// Selects the build that a session on `channel` runs, downloading it if needed.
    ///
    /// Returns the staged build at once if it is within its end of life. Otherwise calls
    /// `on_wait`, waits for any running sync, then syncs. This blocks on the network, so it
    /// must not run on the main thread.
    ///
    /// # Errors
    ///
    /// Fails if no usable build is staged after the sync, or if the host cannot be copied
    /// beside the DLL.
    pub fn prepare(
        &self,
        channel: Channel,
        bundled_host: &Path,
        on_wait: impl FnOnce(),
    ) -> Result<StagedPatcher, DeliveryError> {
        let Some(delivery) = self.delivery() else {
            return Err(DeliveryError::NoRelease);
        };

        let now = now();
        if let Some(staged) = delivery
            .select(channel, bundled_host, now)?
            .filter(|staged| !staged.is_expired(now))
        {
            return Ok(staged);
        }

        on_wait();
        let _guard = self.syncing.lock();
        delivery.refresh(channel, bundled_host, now)
    }
}

/// Returns the current time in Unix seconds, or 0 if the clock is before the epoch.
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs())
}

/// Returns the delivery channel that `config` selects.
pub fn channel(config: &Config) -> Channel {
    if config.beta_patcher {
        Channel::Beta
    } else {
        Channel::Stable
    }
}
