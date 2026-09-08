use chrono::{TimeZone, Utc};

use super::*;

fn at(hour: u32, minute: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 9, 8, hour, minute, 0)
        .single()
        .expect("2026-09-08 is a real date")
}

#[test]
fn identity_is_stable_across_one_utc_day() {
    let secret = Secret::from_stored("a-secret");

    let midnight = identity(&secret, at(0, 0));
    let noon = identity(&secret, at(12, 0));
    let last_minute = identity(&secret, at(23, 59));

    assert_eq!(midnight, noon);
    assert_eq!(noon, last_minute);
}

#[test]
fn identity_changes_across_a_utc_date_boundary() {
    let secret = Secret::from_stored("a-secret");

    let before = identity(&secret, at(23, 59));
    let after = identity(
        &secret,
        Utc.with_ymd_and_hms(2026, 9, 9, 0, 0, 0)
            .single()
            .expect("2026-09-09 is a real date"),
    );

    assert_ne!(before, after);
}

#[test]
fn identity_changes_when_the_secret_is_replaced() {
    let now = at(12, 0);

    let before = identity(&Secret::from_stored("the-first-secret"), now);
    let after = identity(&Secret::from_stored("the-second-secret"), now);

    assert_ne!(before, after);
}

#[test]
fn identity_is_thirty_two_hex_characters() {
    let rendered = identity(&Secret::generate(), at(12, 0));

    assert_eq!(rendered.as_str().len(), IDENTITY_BYTES * 2);
    assert!(rendered.as_str().chars().all(|c| c.is_ascii_hexdigit()));
}

#[test]
fn identity_does_not_carry_the_secret() {
    let secret = Secret::from_stored("a-secret-worth-keeping");

    let rendered = identity(&secret, at(12, 0));

    assert!(!rendered.as_str().contains(secret.as_str()));
}

#[test]
fn a_generated_secret_differs_from_the_last_one() {
    assert_ne!(Secret::generate(), Secret::generate());
}

#[test]
fn a_secret_does_not_print_itself() {
    let secret = Secret::from_stored("a-secret-worth-keeping");

    let printed = format!("{secret:?}");

    assert!(!printed.contains("a-secret-worth-keeping"));
}
