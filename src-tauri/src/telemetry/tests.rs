use std::sync::Arc;

use ltk_telemetry::sink::RecordingSink;
use ltk_telemetry::{Config, Scrubber, Secret, Telemetry};

use super::*;

/// A profile directory that is nobody's, so a fixture carries no real path.
const PROFILE_DIR: &str = r"C:\Users\someone";

/// A state reporting into a sink a test can read, on its own spool.
fn recording() -> (Arc<TelemetryState>, Arc<RecordingSink>, tempfile::TempDir) {
    let sink = Arc::new(RecordingSink::new());
    let spool = tempfile::tempdir().expect("a temporary directory");
    let telemetry = Telemetry::new(
        Config::new(Secret::generate(), spool.path(), sink.clone())
            .with_scrubber(Scrubber::for_profile_dir(PROFILE_DIR)),
    );

    (
        Arc::new(TelemetryState::new(telemetry, Remote::default())),
        sink,
        spool,
    )
}

#[test]
fn a_secret_is_minted_once_and_then_reused() {
    let mut settings = Settings::default();

    let (first, minted) = ensure_secret(&mut settings);
    let (second, minted_again) = ensure_secret(&mut settings);

    assert!(minted, "the first call mints one");
    assert!(!minted_again, "the second call reuses it");
    assert_eq!(first.as_str(), second.as_str());
    assert_eq!(settings.telemetry_secret.as_deref(), Some(first.as_str()));
}

#[test]
fn clearing_the_secret_mints_a_different_one() {
    let mut settings = Settings::default();
    let (before, _) = ensure_secret(&mut settings);

    settings.telemetry_secret = None;
    let (after, minted) = ensure_secret(&mut settings);

    assert!(minted);
    assert_ne!(before.as_str(), after.as_str());
}

#[test]
fn diagnostics_are_on_and_unannounced_by_default() {
    let settings = Settings::default();

    assert!(settings.telemetry_enabled);
    assert!(!settings.has_seen_diagnostics_notice);
    assert_eq!(settings.telemetry_secret, None);
}

#[test]
fn a_debug_build_reports_nothing() {
    assert_eq!(REPORTS, !cfg!(debug_assertions));
}

#[test]
fn the_setting_off_beats_a_document_that_allows_collection() {
    let settings = Settings {
        telemetry_enabled: false,
        ..Settings::default()
    };

    let allowed = Remote {
        enabled: true,
        ..Remote::default()
    };

    assert_eq!(refusal(&settings, &allowed), Some(Refusal::Setting));
}

#[test]
fn a_document_that_stops_collection_stops_a_reader_who_allowed_it() {
    let settings = Settings::default();
    let stopped = Remote {
        enabled: false,
        ..Remote::default()
    };

    let expected = if REPORTS {
        Refusal::Document
    } else {
        Refusal::DebugBuild
    };
    assert_eq!(refusal(&settings, &stopped), Some(expected));
}

#[test]
fn a_backend_error_reports_its_code_and_no_profile_path() {
    let (state, sink, _spool) = recording();

    state.report_app_error(
        "IO",
        r"reading C:\Users\someone\mods\a.wad: the file is not there",
    );
    state.handle().flush();

    let events = sink.events();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].name(), errors::APP_ERROR);
    assert_eq!(
        events[0]
            .properties()
            .get("error_code")
            .and_then(|code| code.as_str()),
        Some("IO")
    );

    let payload = serde_json::to_string(&events[0].to_payload()).expect("a payload");
    assert!(!payload.contains("someone"), "the profile path travelled");
    assert!(payload.contains("USERPROFILE"), "nothing was scrubbed");
}

#[test]
fn one_failure_reports_once_however_often_it_happens() {
    let (state, sink, _spool) = recording();

    for _ in 0..50 {
        state.report_app_error("IO", "reading a.wad: the file is not there");
    }
    state.handle().flush();

    assert_eq!(sink.events().len(), 1);
}

#[test]
fn a_panic_reports_as_an_exception_carrying_its_location() {
    let (state, sink, _spool) = recording();

    state.report_panic("index out of bounds", Some("src/mods/mod.rs"), Some(42));
    state.handle().flush();

    let events = sink.events();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].name(), errors::EXCEPTION);
    assert_eq!(
        events[0].properties().get("kind").and_then(|k| k.as_str()),
        Some(errors::KIND_APP_PANIC)
    );
}

#[test]
fn a_frontend_crash_reports_as_an_exception() {
    let (state, sink, _spool) = recording();

    state.report_ui_error(&UiError {
        name: "TypeError".to_owned(),
        message: "x is not a function".to_owned(),
        stack: None,
        component_stack: Some("in Card".to_owned()),
        route: Some("/mods".to_owned()),
        handled: true,
    });
    state.handle().flush();

    let events = sink.events();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].name(), errors::EXCEPTION);
    assert_eq!(
        events[0].properties().get("kind").and_then(|k| k.as_str()),
        Some(errors::KIND_UI_ERROR)
    );
}

#[test]
fn the_three_seams_do_not_silence_each_other() {
    let (state, sink, _spool) = recording();

    state.report_app_error("IO", "reading a.wad: the file is not there");
    state.report_panic("index out of bounds", Some("src/mods/mod.rs"), Some(42));
    state.report_ui_error(&UiError {
        name: "TypeError".to_owned(),
        message: "x is not a function".to_owned(),
        stack: None,
        component_stack: None,
        route: Some("/mods".to_owned()),
        handled: false,
    });
    state.handle().flush();

    assert_eq!(sink.events().len(), 3);
}

#[test]
fn a_handle_that_collects_nothing_reports_no_failure() {
    let state = TelemetryState::new(Telemetry::disabled(), Remote::default());

    state.report_app_error("IO", "reading a.wad: the file is not there");
    state.report_panic("index out of bounds", Some("src/mods/mod.rs"), Some(42));

    assert!(!state.handle().is_enabled());
}
