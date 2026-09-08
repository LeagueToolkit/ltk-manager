//! The sink that posts to the vendor.

use std::time::Duration;

use reqwest::blocking::Client;
use serde_json::json;

use crate::event::Event;
use crate::sink::{Sink, SinkError};

/// How long a batch waits before it is a dropped batch.
const TIMEOUT: Duration = Duration::from_secs(10);

/// What the endpoint is told is asking.
const USER_AGENT: &str = concat!("ltk-telemetry/", env!("CARGO_PKG_VERSION"));

/// The project key the vendor accepts a batch under.
///
/// Public by the vendor's design rather than a secret, and separate from the
/// local secret an identity is salted with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiKey(String);

impl ApiKey {
    /// The key a caller holds, taken verbatim.
    #[must_use]
    pub fn new(key: impl Into<String>) -> Self {
        Self(key.into())
    }

    /// The key as the body writes it.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// The sink that posts a batch to PostHog.
#[derive(Debug)]
pub struct PostHogSink {
    client: Client,
    endpoint: String,
    api_key: ApiKey,
}

impl PostHogSink {
    /// The batch endpoint of the vendor's EU region.
    pub const ENDPOINT_EU: &'static str = "https://eu.i.posthog.com/batch/";

    /// A sink posting to `endpoint` under `api_key`.
    ///
    /// # Errors
    ///
    /// Fails only when the HTTP client cannot be built, which no caller can act
    /// on beyond leaving telemetry off for the run.
    pub fn new(api_key: ApiKey, endpoint: impl Into<String>) -> Result<Self, SinkError> {
        let client = Client::builder()
            .user_agent(USER_AGENT)
            .timeout(TIMEOUT)
            .build()
            .map_err(SinkError::Client)?;
        Ok(Self {
            client,
            endpoint: endpoint.into(),
            api_key,
        })
    }
}

impl Sink for PostHogSink {
    fn send(&self, batch: &[Event]) -> Result<(), SinkError> {
        let body = json!({
            "api_key": self.api_key.as_str(),
            "batch": batch.iter().map(Event::to_payload).collect::<Vec<_>>(),
        });

        let response = self
            .client
            .post(&self.endpoint)
            .json(&body)
            .send()
            .map_err(SinkError::Transport)?;

        let status = response.status();
        if status.is_success() {
            Ok(())
        } else {
            Err(SinkError::Status {
                status: status.as_u16(),
            })
        }
    }
}
