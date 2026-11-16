use serde_json::{Value, json};

use super::*;

fn running() -> Version {
    Version::parse("1.34.0").unwrap()
}

fn now() -> DateTime<Utc> {
    "2026-11-15T12:00:00Z".parse().unwrap()
}

fn document(issues: Vec<Value>) -> Document {
    serde_json::from_value(json!({ "schema": 1, "issues": issues })).unwrap()
}

fn issue(id: &str) -> Value {
    json!({
        "id": id,
        "verdicts": ["missing-data"],
        "message": "Patch 16.23 moved the skin data. Update the manager.",
    })
}

fn ids(issues: &[KnownIssue]) -> Vec<&str> {
    issues.iter().map(|issue| issue.id.as_str()).collect()
}

#[test]
fn current_keeps_an_issue_with_no_condition_in_the_order_of_the_document() {
    let issues = current(
        document(vec![issue("first"), issue("second")]),
        &running(),
        now(),
    );

    assert_eq!(ids(&issues), ["first", "second"]);
    assert_eq!(issues[0].verdicts, ["missing-data"]);
    assert_eq!(issues[0].url, None);
}

#[test]
fn current_drops_an_issue_for_another_version_range() {
    let mut fixed = issue("fixed-in-1.34");
    fixed["versions"] = json!("<1.34.0");
    let mut open = issue("open");
    open["versions"] = json!(">=1.30.0");

    let issues = current(document(vec![fixed, open]), &running(), now());

    assert_eq!(ids(&issues), ["open"]);
}

#[test]
fn current_drops_an_issue_past_its_expiry() {
    let mut withdrawn = issue("withdrawn");
    withdrawn["expiresAt"] = json!("2026-11-14T00:00:00Z");
    let mut live = issue("live");
    live["expiresAt"] = json!("2026-12-01T00:00:00Z");

    let issues = current(document(vec![withdrawn, live]), &running(), now());

    assert_eq!(ids(&issues), ["live"]);
}

#[test]
fn current_drops_an_issue_with_a_condition_that_does_not_parse() {
    let mut range = issue("range");
    range["versions"] = json!("not a range");
    let mut expiry = issue("expiry");
    expiry["expiresAt"] = json!("tomorrow");

    assert!(current(document(vec![range, expiry]), &running(), now()).is_empty());
}

#[test]
fn current_returns_no_issue_for_another_schema() {
    let document: Document =
        serde_json::from_value(json!({ "schema": 2, "issues": [issue("later")] })).unwrap();

    assert!(current(document, &running(), now()).is_empty());
}

/// The document in the repository is what every install reads, so it has to parse.
#[test]
fn published_document_parses() {
    let published = include_str!("../../../../config/known-issues.json");
    let document: Document = serde_json::from_str(published).unwrap();

    assert_eq!(document.schema, SCHEMA);
}
