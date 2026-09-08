//! What the project publishes about collection, read raw from the repository.
//!
//! The document is the kill switch and the volume dial. It lives at
//! `config/telemetry.json` on the default branch, and its URL is the contract,
//! so stopping collection or raising the sample rate is a merged pull request
//! rather than a release. `config/README.md` names the schema.
//!
//! The document is advisory over the user's setting and can only ever narrow
//! what is collected. A published `enabled` never turns collection back on for
//! somebody who turned it off.

use std::collections::HashMap;
use std::path::Path;

use fs_err as fs;
use ltk_telemetry::sink::PostHogSink;
use ltk_telemetry::{SampleRate, Sampling};
use semver::Version;
use serde::Deserialize;
use tracing::{info, warn};

use crate::github;

/// The document, read raw so a change to collection is a reviewed change.
const DOCUMENT_URL: &str =
    "https://raw.githubusercontent.com/LeagueToolkit/ltk-manager/main/config/telemetry.json";

/// The one schema this build reads. A document on another is no document.
const SCHEMA: u32 = 1;

/// The share of installs that report when no document can be read.
///
/// Mirrors the rate the published document carries, so an install that cannot
/// reach the document weighs the same in the data as one that can. Raising the
/// published rate deliberately leaves this one behind.
const DEFAULT_SAMPLE_RATE: f64 = 0.05;

/// What the published document allows this build to collect.
#[derive(Debug, Clone, PartialEq)]
pub struct Remote {
    /// Whether anything is collected at all.
    pub enabled: bool,

    /// The share of installs that report, globally and by event name.
    pub sampling: Sampling,

    /// Where a batch is posted, so a vendor change needs no release.
    pub endpoint: String,
}

impl Default for Remote {
    fn default() -> Self {
        Self {
            enabled: true,
            sampling: Sampling::at(SampleRate::new(DEFAULT_SAMPLE_RATE)),
            endpoint: PostHogSink::ENDPOINT_EU.to_owned(),
        }
    }
}

/// The document as published, before the running build is applied to it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Document {
    schema: u32,

    /// The switch that stops every build at once.
    #[serde(default = "collecting")]
    enabled: bool,

    #[serde(default)]
    sample_rate: Option<f64>,

    #[serde(default)]
    endpoint: Option<String>,

    /// A semver version. Below it, a build collects nothing.
    #[serde(default)]
    min_version: Option<String>,

    /// A rate for one event name, drawn after the global one.
    #[serde(default)]
    events: HashMap<String, f64>,
}

/// A document that says nothing about `enabled` is still collecting.
fn collecting() -> bool {
    true
}

/// Read the published configuration, writing it down for the next boot.
///
/// A read that fails and a document that cannot be understood both leave the
/// last one that could be, because a network failure must not read as a
/// deliberate stop. Blocking, so it belongs on a thread that does not draw the
/// window.
pub fn fetch(cache: &Path) -> Remote {
    let body = match download() {
        Ok(body) => body,
        Err(error) => {
            info!(%error, "The telemetry configuration could not be read, keeping the last one");
            return cached(cache);
        }
    };

    match read(&body, &running()) {
        Some(remote) => {
            store(cache, &body);
            remote
        }
        None => cached(cache),
    }
}

/// The configuration the last readable document left, or the compiled default.
pub fn cached(cache: &Path) -> Remote {
    fs::read_to_string(cache)
        .ok()
        .and_then(|body| read(&body, &running()))
        .unwrap_or_default()
}

/// The document's body, over the client every read of the repository shares.
fn download() -> Result<String, github::GitHubError> {
    let response = github::send(github::client()?.get(DOCUMENT_URL))?;
    response.text().map_err(github::GitHubError::Http)
}

/// Keep `body` for the next boot, which reads it before the network answers.
fn store(cache: &Path, body: &str) {
    if let Some(parent) = cache.parent() {
        if let Err(error) = fs::create_dir_all(parent) {
            warn!(%error, "The telemetry configuration could not be written down");
            return;
        }
    }
    if let Err(error) = fs::write(cache, body) {
        warn!(%error, "The telemetry configuration could not be written down");
    }
}

/// The version this build runs at, which the minimum is measured against.
fn running() -> Version {
    Version::parse(env!("CARGO_PKG_VERSION"))
        .expect("CARGO_PKG_VERSION is semver, since cargo refuses a manifest whose version is not")
}

/// What `body` allows `running` to collect, or nothing when it cannot be read.
///
/// Answers `None` for a document this build does not understand, which the
/// caller reads as no document rather than as a stop.
fn read(body: &str, running: &Version) -> Option<Remote> {
    let document: Document = match serde_json::from_str(body) {
        Ok(document) => document,
        Err(error) => {
            warn!(%error, "The telemetry configuration is not a configuration document");
            return None;
        }
    };

    if document.schema != SCHEMA {
        warn!(
            schema = document.schema,
            "The telemetry configuration is on a schema this build does not read"
        );
        return None;
    }

    let default = Remote::default();
    Some(Remote {
        enabled: document.enabled && above_floor(document.min_version.as_deref(), running),
        sampling: sampling(&document),
        endpoint: document.endpoint.unwrap_or(default.endpoint),
    })
}

/// Whether `running` is at or above the floor the document names.
///
/// A floor that does not parse is no floor. A typo in one field is not grounds
/// for cutting off every build that reads it.
fn above_floor(floor: Option<&str>, running: &Version) -> bool {
    let Some(floor) = floor else {
        return true;
    };
    match Version::parse(floor) {
        Ok(floor) => running >= &floor,
        Err(error) => {
            warn!(floor, %error, "The telemetry configuration names a minimum version that does not parse");
            true
        }
    }
}

/// The rates the document names, global first and then by event name.
fn sampling(document: &Document) -> Sampling {
    let global = document
        .sample_rate
        .map_or_else(|| Remote::default().sampling.global, SampleRate::new);

    document
        .events
        .iter()
        .fold(Sampling::at(global), |sampling, (event, rate)| {
            sampling.with_event(event.clone(), SampleRate::new(*rate))
        })
}

#[cfg(test)]
mod tests;
