//! Where a batch goes, and the two places it can go.

mod posthog;
mod recording;

#[cfg(test)]
mod tests;

pub use posthog::{ApiKey, PostHogSink};
pub use recording::RecordingSink;

use crate::event::Event;

/// Why a batch did not leave the machine.
///
/// Nothing a caller does with this reaches a user. It exists so the log line says
/// which of the two failures happened.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum SinkError {
    /// The endpoint could not be reached, or answered too slowly.
    #[error("the diagnostics endpoint could not be reached")]
    Transport(#[source] reqwest::Error),

    /// The endpoint answered, and refused the batch.
    #[error("the diagnostics endpoint answered {status}")]
    Status {
        /// The HTTP status the endpoint answered with.
        status: u16,
    },
}

/// Where a batch of events is delivered.
///
/// One implementation posts to the vendor and one records what it was given, and
/// the second is the seam every test in this epic is written against.
pub trait Sink: std::fmt::Debug + Send + Sync {
    /// Deliver `batch`, oldest event first.
    ///
    /// # Errors
    ///
    /// Fails when the endpoint cannot be reached or refuses the batch. A caller
    /// keeps the batch spooled and tries again later.
    fn send(&self, batch: &[Event]) -> Result<(), SinkError>;
}
