use super::*;

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
