use chrono::{TimeZone, Utc};
use serde_json::json;

use super::*;
use crate::event::Properties;

fn event() -> Event {
    let timestamp = Utc
        .with_ymd_and_hms(2026, 9, 8, 12, 30, 0)
        .single()
        .expect("2026-09-08 is a real date");
    Event::new(
        "game_session_ended",
        Properties::new()
            .with("outcome", "clean")
            .with(Event::DISTINCT_ID, "0123456789abcdef0123456789abcdef")
            .with(Event::PROCESS_PERSON_PROFILE, false),
        timestamp,
    )
}

#[test]
fn the_recording_sink_keeps_every_batch_it_is_given() {
    let sink = RecordingSink::new();

    sink.send(&[event()]).expect("the recording sink accepts");
    sink.send(&[event(), event()])
        .expect("the recording sink accepts");

    assert_eq!(sink.batches().len(), 2);
    assert_eq!(sink.events().len(), 3);
}

#[test]
fn the_recording_sink_observes_the_exact_wire_payload() {
    let sink = RecordingSink::new();

    sink.send(&[event()]).expect("the recording sink accepts");

    assert_eq!(
        sink.payloads(),
        vec![json!({
            "event": "game_session_ended",
            "properties": {
                "outcome": "clean",
                "distinct_id": "0123456789abcdef0123456789abcdef",
                "$process_person_profile": false,
            },
            "timestamp": "2026-09-08T12:30:00+00:00",
        })]
    );
}

#[test]
fn a_failing_recording_sink_still_records_what_it_refused() {
    let sink = RecordingSink::failing();

    let refused = sink.send(&[event()]);

    assert!(matches!(refused, Err(SinkError::Status { status: 503 })));
    assert_eq!(sink.events().len(), 1);
}

#[test]
fn the_posthog_sink_defaults_to_the_eu_endpoint() {
    assert_eq!(PostHogSink::ENDPOINT_EU, "https://eu.i.posthog.com/batch/");
}

#[test]
fn a_posthog_sink_is_built_without_reaching_the_network() {
    let sink = PostHogSink::new(ApiKey::new("phc_test"), PostHogSink::ENDPOINT_EU);

    assert!(sink.is_ok());
}
