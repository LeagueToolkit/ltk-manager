//! The identity on the wire, and the local secret it is derived from.

use std::fmt;

use chrono::{DateTime, Utc};
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[cfg(test)]
mod tests;

/// How much of the digest travels. Sixteen bytes put a collision out of reach
/// at this volume, and keep the identity short enough to read in a log line.
const IDENTITY_BYTES: usize = 16;

/// The random value an identity is salted with, held by the caller and never sent.
///
/// A caller generates one on first run, stores it, and hands the same value back
/// on every later run. Replacing it breaks the link to everything sent before.
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);

impl Secret {
    /// A new secret, from the platform's random source.
    #[must_use]
    pub fn generate() -> Self {
        Self(Uuid::new_v4().simple().to_string())
    }

    /// The secret a caller has stored, taken back verbatim.
    #[must_use]
    pub fn from_stored(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    /// The value to store, which is the only form that may be written down.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

// The secret is what makes the identity irreversible, so it never reaches a log.
impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(<redacted>)")
    }
}

/// The pseudonym one install carries for one UTC day.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Identity(String);

impl Identity {
    /// The identity `secret` carries on the UTC day `now` falls in.
    ///
    /// It rotates at midnight UTC and cannot be reversed to the secret, which is
    /// the whole of what makes the data anonymous. Two installs sharing a day
    /// share nothing else.
    #[must_use]
    pub fn for_day(secret: &Secret, now: DateTime<Utc>) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(secret.as_str().as_bytes());
        hasher.update(b":");
        hasher.update(now.date_naive().to_string().as_bytes());

        const HEX: [u8; 16] = *b"0123456789abcdef";
        let digest = hasher.finalize();
        let mut rendered = String::with_capacity(IDENTITY_BYTES * 2);
        for byte in &digest[..IDENTITY_BYTES] {
            rendered.push(char::from(HEX[usize::from(byte >> 4)]));
            rendered.push(char::from(HEX[usize::from(byte & 0x0f)]));
        }
        Self(rendered)
    }

    /// The identity as the wire and the sampler read it.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for Identity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}
