//! Send one event to the vendor, to prove a key, a region and the wire format.
//!
//! ```text
//! $env:LTK_POSTHOG_API_KEY = "phc_..."
//! cargo run -p ltk-telemetry --example send_one
//! ```
//!
//! `LTK_POSTHOG_ENDPOINT` points it at another region or a scratch project.
//!
//! The event is named `smoke_test` so it never reads as a real one, and it is
//! built through the same [`Telemetry`] handle the app uses, so the identity, the
//! profile suppression flag and the scrubber are all exercised. The batch is
//! handed to the sink directly rather than through
//! [`Telemetry::flush`](ltk_telemetry::Telemetry::flush), because a flush
//! swallows its failure by design and this wants the reason on stdout.

use std::process::ExitCode;
use std::sync::Arc;

use ltk_telemetry::sink::{ApiKey, PostHogSink};
use ltk_telemetry::{Config, Properties, Secret, Sink, Spool, SpoolCaps, Telemetry};

/// The event name, which is not one of the four the manager reports.
const EVENT: &str = "smoke_test";

fn main() -> ExitCode {
    let Ok(api_key) = std::env::var("LTK_POSTHOG_API_KEY") else {
        eprintln!("Set LTK_POSTHOG_API_KEY to the project key first.");
        return ExitCode::FAILURE;
    };
    let endpoint = std::env::var("LTK_POSTHOG_ENDPOINT")
        .unwrap_or_else(|_| PostHogSink::ENDPOINT_EU.to_string());

    let sink = match PostHogSink::new(ApiKey::new(api_key), endpoint.clone()) {
        Ok(sink) => Arc::new(sink),
        Err(error) => {
            eprintln!("The client could not be built: {error}");
            return ExitCode::FAILURE;
        }
    };

    let spool_dir = match tempfile::tempdir() {
        Ok(dir) => dir,
        Err(error) => {
            eprintln!("No temporary directory to spool into: {error}");
            return ExitCode::FAILURE;
        }
    };

    let telemetry = Telemetry::new(Config::new(
        Secret::generate(),
        spool_dir.path(),
        sink.clone(),
    ));
    telemetry.track(
        EVENT,
        Properties::new()
            .with("source", "send_one")
            .with("crate_version", env!("CARGO_PKG_VERSION")),
    );

    let batch = Spool::open(spool_dir.path(), SpoolCaps::default()).read();
    if batch.is_empty() {
        eprintln!("Nothing was written down, so there is nothing to send.");
        return ExitCode::FAILURE;
    }

    println!("Endpoint: {endpoint}");
    match telemetry.identity() {
        Some(identity) => println!("Identity: {identity}"),
        None => println!("Identity: none, the handle collects nothing"),
    }
    for event in &batch {
        match serde_json::to_string_pretty(&event.to_payload()) {
            Ok(payload) => println!("Sending:\n{payload}"),
            Err(error) => println!("Sending an event that will not print: {error}"),
        }
    }

    match sink.send(&batch) {
        Ok(()) => {
            println!("\nAccepted. Look for `{EVENT}` under the project's activity.");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("\nRefused: {error}");
            ExitCode::FAILURE
        }
    }
}
