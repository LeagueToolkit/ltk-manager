use serde_json::json;

use super::*;
use crate::diagnostics::incident::fixtures;

fn environment() -> Environment {
    Environment {
        app_version: "1.17.0".to_string(),
        os_build: Some("10.0.26100".to_string()),
        arch: "x86_64".to_string(),
        locale: Some("en_GB".to_string()),
    }
}

fn facts() -> SessionFacts {
    SessionFacts {
        duration_secs: Some(20 * 60),
        enabled_count: 4,
        injected: true,
        launch: LaunchKind::Match,
        origin: OriginKind::Library,
        scan: Some(ScanMode::Eager),
        overlay: OverlayOutcome::Live,
        game_patch: Some("16.16.804.9184".to_string()),
    }
}

#[test]
fn a_duration_falls_in_the_bucket_that_holds_it() {
    assert_eq!(duration_bucket(0), "under-1m");
    assert_eq!(duration_bucket(59), "under-1m");
    assert_eq!(duration_bucket(60), "1-5m");
    assert_eq!(duration_bucket(14 * 60), "5-15m");
    assert_eq!(duration_bucket(29 * 60), "15-30m");
    assert_eq!(duration_bucket(44 * 60), "30-45m");
    assert_eq!(duration_bucket(60 * 60), "over-45m");
}

#[test]
fn a_clean_session_says_so_and_carries_no_verdict() {
    let properties = clean_session(&environment(), &facts());

    assert_eq!(properties.get("outcome"), Some(&json!("clean")));
    assert_eq!(properties.get("duration_bucket"), Some(&json!("15-30m")));
    assert_eq!(properties.get("enabled_mods"), Some(&json!(4)));
    assert_eq!(properties.get("injected"), Some(&json!(true)));
    assert_eq!(properties.get("origin"), Some(&json!("library")));
    assert_eq!(properties.get("launch_kind"), Some(&json!("match")));
    assert_eq!(properties.get("overlay_outcome"), Some(&json!("live")));
    assert_eq!(properties.get("scan_mode"), Some(&json!("eager")));
    assert_eq!(properties.get("game_patch"), Some(&json!("16.16.804.9184")));

    for absent in [
        "verdict_kind",
        "consequence",
        "incident_token",
        "suspects",
        "evidence_codes",
        "scan_status",
        "game_phase",
    ] {
        assert_eq!(
            properties.get(absent),
            None,
            "{absent} is a verdict's alone"
        );
    }
}

#[test]
fn every_event_says_what_the_machine_is() {
    let properties = clean_session(&environment(), &facts());

    assert_eq!(properties.get("app_version"), Some(&json!("1.17.0")));
    assert_eq!(properties.get("os_build"), Some(&json!("10.0.26100")));
    assert_eq!(properties.get("arch"), Some(&json!("x86_64")));
    assert_eq!(properties.get("locale"), Some(&json!("en_GB")));
}

#[test]
fn a_session_that_reports_no_length_omits_the_bucket() {
    let mut facts = facts();
    facts.duration_secs = None;

    let properties = clean_session(&environment(), &facts);

    assert_eq!(properties.get("duration_bucket"), None);
}

#[test]
fn a_verdict_session_carries_the_verdict_the_consequence_and_the_token() {
    let incident = fixtures::incident("abc123", "2026-09-08T12:00:00Z");

    let properties = verdict_session(
        &environment(),
        &facts(),
        &incident,
        "DIAG1-abcdef".to_string(),
        &[],
    );

    assert_eq!(properties.get("outcome"), Some(&json!("verdict")));
    assert_eq!(properties.get("verdict_kind"), Some(&json!("missing-data")));
    assert_eq!(properties.get("consequence"), Some(&json!("game-stopped")));
    assert_eq!(properties.get("game_phase"), Some(&json!("loading")));
    assert_eq!(
        properties.get("incident_token"),
        Some(&json!("DIAG1-abcdef"))
    );
}

#[test]
fn a_verdict_session_carries_its_evidence_codes() {
    let incident = fixtures::incident("abc123", "2026-09-08T12:00:00Z");

    let properties = verdict_session(&environment(), &facts(), &incident, String::new(), &[]);

    let codes = properties
        .get("evidence_codes")
        .and_then(serde_json::Value::as_array)
        .expect("the codes travel as a list");
    assert!(
        codes.contains(&json!("ALE-9B39AA45")),
        "expected the fixture's code, got {codes:?}"
    );
}

#[test]
fn a_suspect_travels_as_a_digest_and_a_reason() {
    let incident = fixtures::incident("abc123", "2026-09-08T12:00:00Z");
    let suspects = [SuspectIdentity {
        digest: "2cf24dba5fb0a30e".to_string(),
        reason: Because::HoldsThePath,
    }];

    let properties = verdict_session(
        &environment(),
        &facts(),
        &incident,
        String::new(),
        &suspects,
    );

    assert_eq!(properties.get("suspect_count"), Some(&json!(1)));
    assert_eq!(
        properties.get("suspects"),
        Some(&json!([{ "digest": "2cf24dba5fb0a30e", "reason": "holds-the-path" }]))
    );
}

#[test]
fn no_name_or_path_reaches_the_payload() {
    let incident = fixtures::incident("abc123", "2026-09-08T12:00:00Z");
    let suspects = [SuspectIdentity {
        digest: "2cf24dba5fb0a30e".to_string(),
        reason: Because::HoldsThePath,
    }];

    let properties = verdict_session(
        &environment(),
        &facts(),
        &incident,
        String::new(),
        &suspects,
    );

    // The token is the one property that folds an incident whole, and it is
    // already free of names and paths by its own construction.
    let mut payload = properties.as_map().clone();
    payload.remove("incident_token");
    let rendered = serde_json::to_string(&payload).expect("the payload encodes");

    for forbidden in ["Aatrox Justicar", "aatrox-justicar", "C:\\", "/Users/"] {
        assert!(
            !rendered.contains(forbidden),
            "{forbidden} reached the payload: {rendered}"
        );
    }
}

#[test]
fn the_same_wads_digest_the_same_whatever_their_order_or_case() {
    let one = wad_paths_digest(&[
        "DATA/FINAL/Champions/Aatrox.wad.client".to_string(),
        "DATA/FINAL/UI.wad.client".to_string(),
    ]);
    let other = wad_paths_digest(&[
        "data/final/ui.wad.client".to_string(),
        "data/final/champions/aatrox.wad.client".to_string(),
    ]);

    assert_eq!(one, other);
}

#[test]
fn different_wads_digest_differently() {
    let one = wad_paths_digest(&["DATA/FINAL/Champions/Aatrox.wad.client".to_string()]);
    let other = wad_paths_digest(&["DATA/FINAL/Champions/Ahri.wad.client".to_string()]);

    assert_ne!(one, other);
}
