//! Unit tests for which notices a build draws, without the network.

use super::*;
use serde_json::{Value, json};

/// A build in the middle of the range every fixture reasons about.
fn running() -> Version {
    Version::parse("1.15.4").unwrap()
}

/// Patch day, well inside every fixture's expiry.
fn now() -> DateTime<Utc> {
    "2026-09-03T12:00:00Z".parse().unwrap()
}

fn document(notices: Vec<Value>) -> Document {
    serde_json::from_value(json!({ "schema": 1, "notices": notices })).unwrap()
}

/// A warning notice, with every optional field left for the test to add.
fn notice(id: &str) -> Value {
    json!({
        "id": id,
        "severity": "warning",
        "title": "Patch 26.9: the patcher takes longer to hook",
        "publishedAt": "2026-09-01T12:00:00Z",
    })
}

fn ids(notices: &[Notice]) -> Vec<&str> {
    notices.iter().map(|notice| notice.id.as_str()).collect()
}

#[test]
fn a_notice_with_no_conditions_concerns_every_build() {
    let notices = current(document(vec![notice("plain")]), &running(), now());

    assert_eq!(ids(&notices), ["plain"]);
    assert_eq!(notices[0].severity, NoticeSeverity::Warning);
    assert_eq!(notices[0].url, None);
}

#[test]
fn a_range_the_build_is_in_keeps_the_notice() {
    let mut ranged = notice("ranged");
    ranged["versions"] = json!("<1.16.0");

    assert_eq!(
        ids(&current(document(vec![ranged]), &running(), now())),
        ["ranged"]
    );
}

#[test]
fn a_range_the_build_is_outside_drops_the_notice() {
    let mut ranged = notice("ranged");
    ranged["versions"] = json!(">=1.16.0");

    assert!(current(document(vec![ranged]), &running(), now()).is_empty());
}

#[test]
fn a_range_that_does_not_parse_drops_the_notice() {
    let mut ranged = notice("ranged");
    ranged["versions"] = json!("not a range");

    assert!(current(document(vec![ranged]), &running(), now()).is_empty());
}

#[test]
fn an_expired_notice_is_not_drawn() {
    let mut expired = notice("expired");
    expired["expiresAt"] = json!("2026-09-02T00:00:00Z");
    let mut live = notice("live");
    live["expiresAt"] = json!("2026-09-20T00:00:00Z");

    let notices = current(document(vec![expired, live]), &running(), now());

    assert_eq!(ids(&notices), ["live"]);
}

#[test]
fn the_newest_notice_comes_first() {
    let mut older = notice("older");
    older["publishedAt"] = json!("2026-08-01T12:00:00Z");
    let mut newer = notice("newer");
    newer["publishedAt"] = json!("2026-09-02T12:00:00Z");

    let notices = current(document(vec![older, newer]), &running(), now());

    assert_eq!(ids(&notices), ["newer", "older"]);
}

#[test]
fn a_document_on_an_unknown_schema_is_silence() {
    let document: Document =
        serde_json::from_value(json!({ "schema": 2, "notices": [notice("future")] })).unwrap();

    assert!(current(document, &running(), now()).is_empty());
}

#[test]
fn a_malformed_document_is_an_error_rather_than_silence() {
    let malformed = serde_json::from_str::<Document>(r#"{ "notices": "nope" }"#);

    assert!(malformed.is_err());
}

#[test]
fn a_notice_carries_its_link_when_it_has_one() {
    let mut linked = notice("linked");
    linked["url"] = json!("https://github.com/LeagueToolkit/ltk-manager/discussions/220");

    let notices = current(document(vec![linked]), &running(), now());

    assert_eq!(
        notices[0].url.as_deref(),
        Some("https://github.com/LeagueToolkit/ltk-manager/discussions/220")
    );
}
