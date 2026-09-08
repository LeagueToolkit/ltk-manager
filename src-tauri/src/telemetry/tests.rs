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
