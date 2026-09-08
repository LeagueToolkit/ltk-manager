//! The sink a test reads back.

use parking_lot::Mutex;
use serde_json::Value;

use crate::event::Event;
use crate::sink::{Sink, SinkError};

/// The sink that keeps every batch it is given instead of sending it.
///
/// [`RecordingSink::payloads`] answers with the exact JSON the vendor would have
/// been handed, which is what an assertion over the schema reads.
#[derive(Debug, Default)]
pub struct RecordingSink {
    batches: Mutex<Vec<Vec<Event>>>,
    failing: bool,
}

impl RecordingSink {
    /// A sink that accepts every batch.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// A sink that records every batch and refuses all of them.
    #[must_use]
    pub fn failing() -> Self {
        Self {
            batches: Mutex::new(Vec::new()),
            failing: true,
        }
    }

    /// Every batch the sink was given, in the order it was given them.
    #[must_use]
    pub fn batches(&self) -> Vec<Vec<Event>> {
        self.batches.lock().clone()
    }

    /// Every event the sink was given, with the batch boundaries dropped.
    #[must_use]
    pub fn events(&self) -> Vec<Event> {
        self.batches.lock().iter().flatten().cloned().collect()
    }

    /// Every event as the vendor would have read it.
    #[must_use]
    pub fn payloads(&self) -> Vec<Value> {
        self.batches
            .lock()
            .iter()
            .flatten()
            .map(Event::to_payload)
            .collect()
    }
}

impl Sink for RecordingSink {
    fn send(&self, batch: &[Event]) -> Result<(), SinkError> {
        self.batches.lock().push(batch.to_vec());
        if self.failing {
            return Err(SinkError::Status { status: 503 });
        }
        Ok(())
    }
}
