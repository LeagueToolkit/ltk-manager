use chrono::{TimeZone, Utc};
use serde_json::{Value, json};
use tempfile::TempDir;

use super::*;
use crate::sink::RecordingSink;

const EVENT: &str = "game_session_ended";

struct Harness {
    telemetry: Telemetry,
    sink: Arc<RecordingSink>,
    clock: Arc<FixedClock>,
    _spool_dir: TempDir,
}

impl Harness {
    fn new() -> Self {
        Self::with(RecordingSink::new(), Sampling::all())
    }

    fn with(sink: RecordingSink, sampling: Sampling) -> Self {
        let sink = Arc::new(sink);
        let clock = Arc::new(FixedClock::at_midnight(2026, 9, 8));
        let spool_dir = TempDir::new().expect("a temporary directory");
        let telemetry = Telemetry::new(
            Config::new(
                Secret::from_stored("a-secret"),
                spool_dir.path(),
                sink.clone(),
            )
            .with_clock(clock.clone())
            .with_sampling(sampling)
            .with_scrubber(Scrubber::for_profile_dir(r"C:\Users\someone")),
        );
        Self {
            telemetry,
            sink,
            clock,
            _spool_dir: spool_dir,
        }
    }

    fn payload(&self) -> Value {
        let mut payloads = self.sink.payloads();
        assert_eq!(payloads.len(), 1, "expected exactly one event");
        payloads.remove(0)
    }
}

#[test]
fn a_tracked_event_reaches_the_sink_on_a_flush() {
    let harness = Harness::new();

    harness
        .telemetry
        .track(EVENT, Properties::new().with("outcome", "clean"));
    harness.telemetry.flush();

    assert_eq!(
        harness.payload(),
        json!({
            "event": "game_session_ended",
            "properties": {
                "outcome": "clean",
                "distinct_id": harness.telemetry.identity().expect("the handle reports").as_str(),
                "$process_person_profile": false,
            },
            "timestamp": "2026-09-08T00:00:00+00:00",
        })
    );
}

#[test]
fn nothing_reaches_the_sink_before_a_flush() {
    let harness = Harness::new();

    harness.telemetry.track(EVENT, Properties::new());

    assert!(harness.sink.events().is_empty());
}

#[test]
fn a_flush_with_nothing_spooled_sends_no_batch() {
    let harness = Harness::new();

    harness.telemetry.flush();

    assert!(harness.sink.batches().is_empty());
}

#[test]
fn one_flush_carries_everything_tracked_since_the_last() {
    let harness = Harness::new();

    harness.telemetry.track(EVENT, Properties::new());
    harness.telemetry.track("app_error", Properties::new());
    harness.telemetry.flush();

    assert_eq!(harness.sink.batches().len(), 1);
    assert_eq!(harness.sink.events().len(), 2);
}

#[test]
fn a_delivered_batch_is_not_sent_twice() {
    let harness = Harness::new();

    harness.telemetry.track(EVENT, Properties::new());
    harness.telemetry.flush();
    harness.telemetry.flush();

    assert_eq!(harness.sink.events().len(), 1);
}

#[test]
fn a_refused_batch_stays_spooled_for_the_next_flush() {
    let harness = Harness::with(RecordingSink::failing(), Sampling::all());

    harness.telemetry.track(EVENT, Properties::new());
    harness.telemetry.flush();
    harness.telemetry.flush();

    assert_eq!(harness.sink.batches().len(), 2);
}

#[test]
fn a_property_carrying_the_profile_path_is_scrubbed_before_it_is_spooled() {
    let harness = Harness::new();

    harness.telemetry.track(
        "app_panic",
        Properties::new().with(
            "message",
            r"failed to open C:\Users\someone\mods\one.fantome",
        ),
    );
    harness.telemetry.flush();

    assert_eq!(
        harness.payload()["properties"]["message"],
        json!(r"failed to open %USERPROFILE%\mods\one.fantome")
    );
}

#[test]
fn an_identity_rotating_at_midnight_reaches_the_wire() {
    let harness = Harness::new();

    harness.telemetry.track(EVENT, Properties::new());
    let before = harness.telemetry.identity().expect("the handle reports");

    harness.clock.set(
        Utc.with_ymd_and_hms(2026, 9, 9, 0, 0, 0)
            .single()
            .expect("2026-09-09 is a real date"),
    );
    harness.telemetry.track(EVENT, Properties::new());
    harness.telemetry.flush();

    let after = harness.telemetry.identity().expect("the handle reports");
    let identities: Vec<Value> = harness
        .sink
        .payloads()
        .iter()
        .map(|payload| payload["properties"]["distinct_id"].clone())
        .collect();

    assert_ne!(before, after);
    assert_eq!(
        identities,
        vec![json!(before.as_str()), json!(after.as_str())]
    );
}

#[test]
fn a_sampled_out_install_writes_nothing_down() {
    let harness = Harness::with(RecordingSink::new(), Sampling::none());

    harness.telemetry.track(EVENT, Properties::new());
    harness.telemetry.flush();

    assert!(harness.sink.batches().is_empty());
}

#[test]
fn a_disabled_handle_collects_nothing() {
    let telemetry = Telemetry::disabled();

    telemetry.track(EVENT, Properties::new().with("outcome", "clean"));
    telemetry.flush();

    assert!(!telemetry.is_enabled());
    assert!(telemetry.identity().is_none());
}

#[test]
fn a_restart_sends_what_the_spool_survived_with() {
    let spool_dir = TempDir::new().expect("a temporary directory");
    let clock = Arc::new(FixedClock::at_midnight(2026, 9, 8));

    let before = Telemetry::new(
        Config::new(
            Secret::from_stored("a-secret"),
            spool_dir.path(),
            Arc::new(RecordingSink::new()),
        )
        .with_clock(clock.clone()),
    );
    before.track(EVENT, Properties::new().with("outcome", "clean"));
    drop(before);

    let sink = Arc::new(RecordingSink::new());
    let after = Telemetry::new(
        Config::new(
            Secret::from_stored("a-secret"),
            spool_dir.path(),
            sink.clone(),
        )
        .with_clock(clock),
    );
    after.flush();

    assert_eq!(sink.events().len(), 1);
    assert_eq!(sink.events()[0].name(), EVENT);
}
