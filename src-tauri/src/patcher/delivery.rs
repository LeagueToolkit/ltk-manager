//! Builds the patcher delivery client of this manager build and runs its syncs.

use std::path::Path;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use ltk_manager_base::config::Config;
use ltk_manager_runtime::patcher::delivery::{
    attested_manager, Channel, DeliveryError, PatcherDelivery, StagedPatcher,
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

/// Host protocol of `resources/ltk_patcher_host.exe`. It must change together with the binary.
const BUNDLED_HOST_PROTOCOL: u32 = 3;

/// Tauri-managed delivery client, and the lock that allows one sync at a time.
#[derive(Clone)]
pub struct PatcherDeliveryState {
    delivery: Option<Arc<PatcherDelivery>>,
    syncing: Arc<Mutex<()>>,
}

impl PatcherDeliveryState {
    /// Builds the client with its state under `data_dir`.
    ///
    /// Removes the staged builds that no cached manifest offers, before any session can
    /// select one. Returns a state without a client if the target is not Windows or if
    /// `data_dir` is `None`. The client has no attestation if the build has none or if its
    /// attestation names another manager version.
    pub fn new(data_dir: Option<&Path>) -> Self {
        let manager = Version {
            pre: Prerelease::EMPTY,
            ..Version::parse(env!("CARGO_PKG_VERSION")).expect("CARGO_PKG_VERSION is semver")
        };
        let release = manager.to_string();
        let (url, public_key) = match DELIVERY {
            Some("staging") => STAGING,
            _ => PRODUCTION,
        };
        let attestation = ATTESTATION.filter(|attestation| {
            attested_manager(attestation).as_deref() == Some(release.as_str())
        });
        if ATTESTATION.is_some() && attestation.is_none() {
            tracing::warn!(
                %release,
                "The build attestation does not name this manager version. The patcher DLL is not downloaded"
            );
        }

        let delivery = data_dir.filter(|_| cfg!(windows)).map(|dir| {
            Arc::new(PatcherDelivery {
                root: dir.join(crate::data_location::PATCHER),
                url: url.to_string(),
                public_key: public_key.to_string(),
                attestation: attestation.map(str::to_string),
                manager,
                protocol: BUNDLED_HOST_PROTOCOL,
            })
        });
        if let Some(delivery) = &delivery {
            delivery.remove_unused();
        }

        Self {
            delivery,
            syncing: Arc::new(Mutex::new(())),
        }
    }

    /// Returns the client, or `None` if this target does not use delivery.
    pub fn delivery(&self) -> Option<&PatcherDelivery> {
        self.delivery.as_deref()
    }

    /// Syncs the channel of `config` on a background thread, after any running sync.
    ///
    /// Skips the sync if the build has no attestation.
    pub fn sync_in_background(&self, config: &Config) {
        let Some(delivery) = self
            .delivery
            .clone()
            .filter(|delivery| delivery.attestation.is_some())
        else {
            return;
        };

        let syncing = Arc::clone(&self.syncing);
        let channel = channel(config);
        std::thread::spawn(move || {
            let _guard = syncing.lock();
            sync(&delivery, channel);
        });
    }

    /// Selects the build that a session on `channel` runs, downloading it if needed.
    ///
    /// Returns the staged build at once if it is within its end of life. Otherwise waits
    /// for any running sync, then syncs. This blocks on the network, so it must not run on
    /// the main thread.
    ///
    /// # Errors
    ///
    /// Fails if no usable build is staged after the sync, or if the host cannot be copied
    /// beside the DLL.
    pub fn prepare(
        &self,
        channel: Channel,
        bundled_host: &Path,
    ) -> Result<StagedPatcher, DeliveryError> {
        let Some(delivery) = self.delivery() else {
            return Err(DeliveryError::NoRelease);
        };

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_secs());
        if let Some(staged) = delivery
            .select(channel, bundled_host)?
            .filter(|staged| !staged.is_expired(now))
        {
            return Ok(staged);
        }

        let _guard = self.syncing.lock();
        delivery.refresh(channel, bundled_host, now)
    }
}

/// Returns the delivery channel that `config` selects.
pub fn channel(config: &Config) -> Channel {
    if config.beta_patcher {
        Channel::Beta
    } else {
        Channel::Stable
    }
}

/// Syncs `channel`, and logs and reports a failure.
fn sync(delivery: &PatcherDelivery, channel: Channel) {
    if let Err(error) = delivery.sync(channel) {
        tracing::warn!(%channel, %error, "Patcher delivery sync failed");
        crate::telemetry::report_delivery_sync_failed(channel.as_str(), error.kind());
    }
}
