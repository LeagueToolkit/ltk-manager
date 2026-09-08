use chrono::{TimeZone, Utc};

use super::*;
use crate::identity::Secret;

const EVENT: &str = "game_session_ended";

fn identity_on(secret: &str, day: u32) -> Identity {
    let now = Utc
        .with_ymd_and_hms(2026, 9, day, 12, 0, 0)
        .single()
        .expect("September 2026 has the days these tests name");
    Identity::for_day(&Secret::from_stored(secret), now)
}

/// How many distinct secrets a share is measured over.
const POPULATION: u32 = 400;

fn share_admitted(sampling: &Sampling, event: &str) -> f64 {
    let admitted = (0..POPULATION)
        .filter(|index| sampling.admits(&identity_on(&format!("secret-{index}"), 8), event))
        .count();
    f64::from(u32::try_from(admitted).expect("the count fits")) / f64::from(POPULATION)
}

#[test]
fn everything_is_admitted_at_the_default_rate() {
    let sampling = Sampling::all();

    assert!(sampling.admits(&identity_on("a-secret", 8), EVENT));
    assert!((share_admitted(&sampling, EVENT) - 1.0).abs() < f64::EPSILON);
}

#[test]
fn nothing_is_admitted_at_no_rate() {
    let sampling = Sampling::none();

    assert!(!sampling.admits(&identity_on("a-secret", 8), EVENT));
}

#[test]
fn the_draw_is_stable_for_one_identity_within_a_day() {
    let sampling = Sampling::at(SampleRate::new(0.5));
    let identity = identity_on("a-secret", 8);

    let first = sampling.admits(&identity, EVENT);

    for _ in 0..16 {
        assert_eq!(sampling.admits(&identity, EVENT), first);
    }
}

#[test]
fn the_draw_varies_across_identities() {
    let sampling = Sampling::at(SampleRate::new(0.5));

    let share = share_admitted(&sampling, EVENT);

    assert!(
        (0.4..0.6).contains(&share),
        "half the population should be admitted, {share} were"
    );
}

#[test]
fn the_draw_is_redrawn_when_the_identity_rotates() {
    let sampling = Sampling::at(SampleRate::new(0.5));

    let days: Vec<bool> = (1..=20)
        .map(|day| sampling.admits(&identity_on("a-secret", day), EVENT))
        .collect();

    assert!(
        days.iter().any(|admitted| *admitted) && days.iter().any(|admitted| !admitted),
        "one secret should be in on some days and out on others, got {days:?}"
    );
}

#[test]
fn a_per_event_rate_narrows_the_global_one() {
    let sampling = Sampling::at(SampleRate::ALL).with_event(EVENT, SampleRate::NONE);

    assert!(!sampling.admits(&identity_on("a-secret", 8), EVENT));
    assert!(sampling.admits(&identity_on("a-secret", 8), "app_error"));
}

#[test]
fn the_global_rate_shuts_a_named_event_out() {
    let sampling = Sampling::at(SampleRate::NONE).with_event(EVENT, SampleRate::ALL);

    assert!(!sampling.admits(&identity_on("a-secret", 8), EVENT));
}

#[test]
fn a_rate_outside_zero_to_one_is_clamped() {
    assert_eq!(SampleRate::new(2.0), SampleRate::ALL);
    assert_eq!(SampleRate::new(-1.0), SampleRate::NONE);
    assert_eq!(SampleRate::new(f64::NAN), SampleRate::NONE);
}

#[test]
fn rates_are_read_from_the_document_shape() {
    let sampling: Sampling =
        serde_json::from_str(r#"{ "global": 0.25, "perEvent": { "game_session_ended": 0.5 } }"#)
            .expect("the document shape parses");

    assert_eq!(sampling.global, SampleRate::new(0.25));
    assert_eq!(sampling.per_event.get(EVENT), Some(&SampleRate::new(0.5)));
}
