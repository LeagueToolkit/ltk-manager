//! What every read of GitHub shares: one client, and how a failed read is told.
//!
//! The webview reaches `'self'` and `ipc:` only, so the release feed, the
//! announcements feed and the notices document are each read here and handed
//! over IPC. Every read is unauthenticated and blocking.

use std::time::Duration;

use reqwest::StatusCode;
use reqwest::blocking::{Client, RequestBuilder, Response};
use reqwest::header::HeaderMap;
use semver::Version;
use serde::{Deserialize, Serialize};

const FETCH_TIMEOUT: Duration = Duration::from_secs(10);

/// The header GitHub reports the address's remaining quota in.
const REMAINING: &str = "x-ratelimit-remaining";

/// Which way a read of GitHub failed, as the remedy it has.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GitHubErrorKind {
    /// GitHub was never reached. Waiting for a connection is the remedy.
    Offline,
    /// The address has spent its unauthenticated quota. Waiting is the remedy.
    RateLimited,
    /// The request went out and what came back is not what was asked for.
    Http,
}

/// Why something GitHub publishes could not be read.
#[derive(Debug, thiserror::Error)]
pub enum GitHubError {
    /// The request never reached GitHub.
    #[error("reaching GitHub: {0}")]
    Offline(#[source] reqwest::Error),

    /// GitHub turned the request away for exhausting the quota.
    #[error("the GitHub request quota is spent")]
    RateLimited,

    /// The request or the body it answered with failed.
    #[error("reading from GitHub: {0}")]
    Http(#[source] reqwest::Error),

    /// GitHub answered, with a status nothing can be read from.
    #[error("GitHub answered with status {0}")]
    Status(u16),

    /// The body arrived and is not written in the shape it was asked for.
    #[error("GitHub's answer is not what was asked for: {0}")]
    Malformed(#[source] Box<dyn std::error::Error + Send + Sync>),

    /// The blocking thread carrying the request did not finish.
    #[error("the GitHub request did not finish: {0}")]
    Interrupted(String),
}

impl GitHubError {
    /// Which remedy this failure has.
    pub fn kind(&self) -> GitHubErrorKind {
        match self {
            Self::Offline(_) => GitHubErrorKind::Offline,
            Self::RateLimited => GitHubErrorKind::RateLimited,
            Self::Http(_) | Self::Status(_) | Self::Malformed(_) | Self::Interrupted(_) => {
                GitHubErrorKind::Http
            }
        }
    }

    /// A body that is not what the read expected, whatever parser said so.
    pub fn malformed(error: impl std::error::Error + Send + Sync + 'static) -> Self {
        Self::Malformed(Box::new(error))
    }
}

/// A client for one read, on the timeout every read shares and a user agent naming the
/// `running` build, since GitHub refuses a request that names no client.
///
/// # Errors
///
/// Fails only when the TLS backend cannot be set up, which is an `Http` kind.
pub fn client(running: &Version) -> Result<Client, GitHubError> {
    Client::builder()
        .user_agent(format!("ltk-manager/{running}"))
        .timeout(FETCH_TIMEOUT)
        .build()
        .map_err(GitHubError::Http)
}

/// Send `request`, and answer only once GitHub has said yes to it.
///
/// # Errors
///
/// Fails when GitHub cannot be reached, when the address has spent its quota,
/// or when the answer carries a status nothing can be read from.
pub fn send(request: RequestBuilder) -> Result<Response, GitHubError> {
    let response = request.send().map_err(transport_failure)?;

    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    Err(if is_rate_limited(status, response.headers()) {
        GitHubError::RateLimited
    } else {
        GitHubError::Status(status.as_u16())
    })
}

/// A send's failure, as the variant carrying the remedy it leaves.
fn transport_failure(error: reqwest::Error) -> GitHubError {
    if error.is_connect() || error.is_timeout() {
        GitHubError::Offline(error)
    } else {
        GitHubError::Http(error)
    }
}

/// Whether a refusal is the quota running out rather than the request.
fn is_rate_limited(status: StatusCode, headers: &HeaderMap) -> bool {
    (status == StatusCode::FORBIDDEN || status == StatusCode::TOO_MANY_REQUESTS)
        && headers
            .get(REMAINING)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|remaining| remaining.trim() == "0")
}

#[cfg(test)]
mod tests;
