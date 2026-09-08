//! Anonymous diagnostics transport for LTK Manager.
//!
//! The crate knows a spool, a batch, a rotating identity, scrubbing, sampling
//! and one wire format. It knows nothing about mods, incidents or game sessions,
//! and it does not depend on `ltk-manager-core`.
//!
//! [`Telemetry::track`] writes the event down and answers, which is what lets a
//! panic hook record the event explaining the panic before it unwinds.
//! [`Telemetry::flush`] posts what the spool holds. The crate owns no thread and
//! no timer, so when a flush happens is the caller's to decide.
//!
//! ```
//! use ltk_telemetry::{Config, Properties, Secret, Telemetry};
//! use ltk_telemetry::sink::RecordingSink;
//! use std::sync::Arc;
//!
//! let sink = Arc::new(RecordingSink::new());
//! let spool_dir = tempfile::tempdir()?;
//! let telemetry = Telemetry::new(Config::new(
//!     Secret::generate(),
//!     spool_dir.path(),
//!     sink.clone(),
//! ));
//!
//! telemetry.track("game_session_ended", Properties::new().with("outcome", "clean"));
//! telemetry.flush();
//!
//! assert_eq!(sink.events().len(), 1);
//! # Ok::<(), Box<dyn std::error::Error>>(())
//! ```

#![warn(missing_docs)]

pub mod clock;
pub mod event;
pub mod identity;
pub mod sampling;
pub mod scrub;
pub mod sink;
pub mod spool;

#[cfg(test)]
mod tests;

use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::Mutex;
use tracing::{debug, trace, warn};

pub use crate::clock::{Clock, FixedClock, SystemClock};
pub use crate::event::{Event, Properties};
pub use crate::identity::{Identity, Secret};
pub use crate::sampling::{SampleRate, Sampling};
pub use crate::scrub::Scrubber;
pub use crate::sink::{Sink, SinkError};
pub use crate::spool::{Batch, Spool, SpoolCaps, SpoolMark};

/// Everything a handle is built from, with the replaceable parts defaulted.
///
/// The secret, the spool directory and the sink have no sensible default and are
/// handed in. The clock, the sampling, the scrubber and the caps have one, and a
/// test replaces the ones it drives.
#[derive(Debug)]
pub struct Config {
    secret: Secret,
    spool_dir: PathBuf,
    sink: Arc<dyn Sink>,
    clock: Arc<dyn Clock>,
    sampling: Sampling,
    scrubber: Scrubber,
    spool_caps: SpoolCaps,
}

impl Config {
    /// A configuration on the system clock, no sampling and the running user's
    /// profile directory scrubbed.
    #[must_use]
    pub fn new(secret: Secret, spool_dir: impl Into<PathBuf>, sink: Arc<dyn Sink>) -> Self {
        Self {
            secret,
            spool_dir: spool_dir.into(),
            sink,
            clock: Arc::new(SystemClock),
            sampling: Sampling::all(),
            scrubber: Scrubber::from_env(),
            spool_caps: SpoolCaps::default(),
        }
    }

    /// The same configuration reading the time from `clock`.
    #[must_use]
    pub fn with_clock(mut self, clock: Arc<dyn Clock>) -> Self {
        self.clock = clock;
        self
    }

    /// The same configuration drawing installs against `sampling`.
    #[must_use]
    pub fn with_sampling(mut self, sampling: Sampling) -> Self {
        self.sampling = sampling;
        self
    }

    /// The same configuration scrubbing through `scrubber`.
    #[must_use]
    pub fn with_scrubber(mut self, scrubber: Scrubber) -> Self {
        self.scrubber = scrubber;
        self
    }

    /// The same configuration holding at most `caps`.
    #[must_use]
    pub fn with_spool_caps(mut self, caps: SpoolCaps) -> Self {
        self.spool_caps = caps;
        self
    }
}

/// What everything shares, held behind the handle's clone.
#[derive(Debug)]
struct Inner {
    secret: Secret,
    sink: Arc<dyn Sink>,
    clock: Arc<dyn Clock>,
    sampling: Sampling,
    scrubber: Scrubber,
    spool: Mutex<Spool>,
    flushing: Mutex<()>,
}

/// The one thing a caller holds to report anything.
///
/// Cloning is cheap and every clone reports through the same spool, so the handle
/// is passed around rather than rebuilt.
#[derive(Debug, Clone)]
pub struct Telemetry(Option<Arc<Inner>>);

impl Telemetry {
    /// A handle reporting through `config`.
    #[must_use]
    pub fn new(config: Config) -> Self {
        let spool = Spool::open(&config.spool_dir, config.spool_caps);
        debug!(
            spool = %spool.path().display(),
            spooled = spool.len(),
            "Telemetry is on"
        );
        Self(Some(Arc::new(Inner {
            secret: config.secret,
            sink: config.sink,
            clock: config.clock,
            sampling: config.sampling,
            scrubber: config.scrubber,
            spool: Mutex::new(spool),
            flushing: Mutex::new(()),
        })))
    }

    /// A handle that collects nothing and writes nothing down.
    ///
    /// Every method answers without gathering, spooling or sending, so a caller
    /// holding this one reports nothing rather than reporting it later.
    #[must_use]
    pub fn disabled() -> Self {
        Self(None)
    }

    /// Whether anything this handle is told is collected at all.
    #[must_use]
    pub fn is_enabled(&self) -> bool {
        self.0.is_some()
    }

    /// The identity this handle reports under today, if it reports at all.
    ///
    /// Exposed so a caller can show a user what travels, and so a reset of the
    /// secret can be seen to have taken effect.
    #[must_use]
    pub fn identity(&self) -> Option<Identity> {
        let inner = self.0.as_ref()?;
        Some(Identity::for_day(&inner.secret, inner.clock.now()))
    }

    /// Write down that `name` happened, described by `properties`.
    ///
    /// The event is scrubbed, stamped, given the day's identity and appended to
    /// the spool. Nothing is sent here and nothing fails here, so a call site pays
    /// one file append and never an error.
    pub fn track(&self, name: &str, mut properties: Properties) {
        let Some(inner) = &self.0 else {
            return;
        };

        let now = inner.clock.now();
        let identity = Identity::for_day(&inner.secret, now);
        if !inner.sampling.admits(&identity, name) {
            trace!(event = name, "Sampled out of telemetry");
            return;
        }

        inner.scrubber.scrub_properties(&mut properties);
        properties.insert(Event::DISTINCT_ID, identity.as_str());
        properties.insert(Event::PROCESS_PERSON_PROFILE, false);

        inner
            .spool
            .lock()
            .append(&Event::new(name, properties, now));
    }

    /// Drop everything written down and not yet sent.
    ///
    /// What a caller reaches for when the reader turns collection off, because an
    /// event spooled under the old answer is one the reader has since refused.
    pub fn discard(&self) {
        let Some(inner) = &self.0 else {
            return;
        };
        inner.spool.lock().clear();
        debug!("Discarded what telemetry had spooled");
    }

    /// Post what the spool holds, and drop what was delivered.
    ///
    /// The post is synchronous, so this belongs on a thread the user is not
    /// waiting on. A batch that fails stays spooled for the next flush, and two
    /// flushes cannot overlap, so a timer and an exit hook firing together
    /// deliver a batch once. An event tracked while a batch is in the air keeps
    /// a higher mark than the batch acknowledges and survives it.
    pub fn flush(&self) {
        let Some(inner) = &self.0 else {
            return;
        };
        let Some(_guard) = inner.flushing.try_lock() else {
            trace!("A telemetry flush is already in the air");
            return;
        };

        let batch = inner.spool.lock().batch();
        let (Some(mark), false) = (batch.mark(), batch.is_empty()) else {
            return;
        };

        match inner.sink.send(batch.events()) {
            Ok(()) => {
                inner.spool.lock().remove_through(mark);
                debug!(events = batch.len(), "Sent a telemetry batch");
            }
            Err(error) => {
                warn!(%error, events = batch.len(), "Dropped a telemetry batch");
            }
        }
    }
}
