use super::*;

fn at(version: &str) -> Version {
    Version::parse(version).expect("the test names a semver version")
}

#[test]
fn a_document_on_another_schema_is_ignored() {
    let body = r#"{ "schema": 2, "enabled": false }"#;

    assert_eq!(read(body, &at("1.0.0")), None);
}

#[test]
fn a_malformed_document_is_ignored() {
    assert_eq!(read("{ not a document", &at("1.0.0")), None);
}

#[test]
fn an_absent_document_leaves_collection_enabled() {
    let missing = std::env::temp_dir().join("ltk-manager-telemetry-config-that-is-not-there.json");

    assert_eq!(cached(&missing), Remote::default());
    assert!(cached(&missing).enabled);
}

#[test]
fn a_document_that_disables_collection_stops_it() {
    let body = r#"{ "schema": 1, "enabled": false }"#;

    let remote = read(body, &at("1.0.0")).expect("the document is on this schema");

    assert!(!remote.enabled);
}

#[test]
fn a_build_below_the_minimum_collects_nothing() {
    let body = r#"{ "schema": 1, "minVersion": "1.16.0" }"#;

    assert!(!read(body, &at("1.15.9")).expect("readable").enabled);
    assert!(read(body, &at("1.16.0")).expect("readable").enabled);
    assert!(read(body, &at("1.16.1")).expect("readable").enabled);
}

#[test]
fn a_minimum_version_that_does_not_parse_is_no_minimum() {
    let body = r#"{ "schema": 1, "minVersion": "the next one" }"#;

    assert!(read(body, &at("1.0.0")).expect("readable").enabled);
}

#[test]
fn a_per_event_rate_overrides_the_global_one_for_that_event_only() {
    let body = r#"{ "schema": 1, "sampleRate": 0.5, "events": { "app_error": 0.25 } }"#;

    let remote = read(body, &at("1.0.0")).expect("readable");

    assert_eq!(remote.sampling.global, SampleRate::new(0.5));
    assert_eq!(
        remote.sampling.per_event.get("app_error"),
        Some(&SampleRate::new(0.25))
    );
    assert_eq!(remote.sampling.per_event.get("game_session_ended"), None);
}

#[test]
fn a_document_that_names_no_rate_keeps_the_compiled_one() {
    let body = r#"{ "schema": 1 }"#;

    let remote = read(body, &at("1.0.0")).expect("readable");

    assert_eq!(remote, Remote::default());
}

#[test]
fn a_named_endpoint_replaces_the_compiled_one() {
    let body = r#"{ "schema": 1, "endpoint": "https://example.invalid/batch/" }"#;

    let remote = read(body, &at("1.0.0")).expect("readable");

    assert_eq!(remote.endpoint, "https://example.invalid/batch/");
}
