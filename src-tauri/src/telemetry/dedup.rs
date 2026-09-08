//! How often one failure is allowed to report.
//!
//! A crash loop is one machine sending the same failure thousands of times. It
//! would drown every other machine in the data and spend the exception allowance
//! on one reader, so a fingerprint reports once a window and is silent after.

use std::collections::HashMap;

use chrono::{DateTime, Duration, Utc};
use parking_lot::Mutex;

/// How long one fingerprint stays quiet once it has reported, in minutes.
///
/// An hour is short enough that a failure a reader hits across a session is
/// still counted more than once, and long enough that a loop reports single
/// figures rather than thousands.
const WINDOW_MINUTES: i64 = 60;

/// How many fingerprints are remembered before the record is dropped whole.
///
/// A loop whose fingerprint varies would otherwise grow the map without bound.
/// Dropping the record lets a few duplicates through, which is the cheaper
/// mistake of the two.
const MAX_TRACKED: usize = 512;

/// What has reported recently, so the same failure is not sent twice.
#[derive(Debug, Default)]
pub struct Dedup {
    seen: Mutex<HashMap<String, DateTime<Utc>>>,
}

impl Dedup {
    /// Whether `fingerprint` may report at `now`, recording it when it may.
    pub fn admits(&self, fingerprint: &str, now: DateTime<Utc>) -> bool {
        let window = Duration::minutes(WINDOW_MINUTES);
        let mut seen = self.seen.lock();

        seen.retain(|_, reported| now.signed_duration_since(*reported) < window);
        if seen.contains_key(fingerprint) {
            return false;
        }
        if seen.len() >= MAX_TRACKED {
            seen.clear();
        }
        seen.insert(fingerprint.to_owned(), now);
        true
    }

    /// Forget everything, so a reader who reset their identity starts over.
    pub fn clear(&self) {
        self.seen.lock().clear();
    }
}

#[cfg(test)]
mod tests;
