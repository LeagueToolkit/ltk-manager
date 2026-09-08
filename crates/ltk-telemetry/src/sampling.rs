//! Which installs report, decided once a day rather than once an event.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::identity::Identity;

#[cfg(test)]
mod tests;

/// The share of installs that report, as a fraction of one.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SampleRate(f64);

impl SampleRate {
    /// Every install reports.
    pub const ALL: Self = Self(1.0);

    /// No install reports.
    pub const NONE: Self = Self(0.0);

    /// A rate clamped into zero to one, so a bad document cannot widen it.
    #[must_use]
    pub fn new(rate: f64) -> Self {
        if rate.is_nan() {
            return Self::NONE;
        }
        Self(rate.clamp(0.0, 1.0))
    }

    /// The rate as a fraction of one.
    #[must_use]
    pub fn as_f64(self) -> f64 {
        self.0
    }
}

impl Default for SampleRate {
    fn default() -> Self {
        Self::ALL
    }
}

/// The rates an install is drawn against, globally and per event name.
///
/// The draw is over the identity rather than the event, so an install is in or
/// out for a whole UTC day and a sampled session is never half reported.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sampling {
    /// The draw every event passes first.
    #[serde(default)]
    pub global: SampleRate,

    /// The draw one event name passes after the global one, when it has one.
    #[serde(default)]
    pub per_event: HashMap<String, SampleRate>,
}

impl Sampling {
    /// Rates that let everything through.
    #[must_use]
    pub fn all() -> Self {
        Self::default()
    }

    /// Rates that let nothing through.
    #[must_use]
    pub fn none() -> Self {
        Self {
            global: SampleRate::NONE,
            per_event: HashMap::new(),
        }
    }

    /// Rates at one global share, with no event named on its own.
    #[must_use]
    pub fn at(global: SampleRate) -> Self {
        Self {
            global,
            per_event: HashMap::new(),
        }
    }

    /// The same rates with `event` drawn at `rate` of its own.
    #[must_use]
    pub fn with_event(mut self, event: impl Into<String>, rate: SampleRate) -> Self {
        self.per_event.insert(event.into(), rate);
        self
    }

    /// Whether `identity` reports `event` today.
    #[must_use]
    pub fn admits(&self, identity: &Identity, event: &str) -> bool {
        if !draw(identity, "", self.global) {
            return false;
        }
        match self.per_event.get(event) {
            Some(rate) => draw(identity, event, *rate),
            None => true,
        }
    }
}

/// Whether `identity` falls inside `rate` for one draw, named by `event`.
///
/// The draw is the first four bytes of a digest over the identity and the draw's
/// name, so it is stable for a day, independent between draws, and needs no
/// state anywhere.
fn draw(identity: &Identity, event: &str, rate: SampleRate) -> bool {
    if rate == SampleRate::ALL {
        return true;
    }
    if rate == SampleRate::NONE {
        return false;
    }

    let mut hasher = Sha256::new();
    hasher.update(identity.as_str().as_bytes());
    hasher.update(b":");
    hasher.update(event.as_bytes());
    let digest = hasher.finalize();

    let bucket = u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]]);
    f64::from(bucket) / f64::from(u32::MAX) < rate.as_f64()
}
