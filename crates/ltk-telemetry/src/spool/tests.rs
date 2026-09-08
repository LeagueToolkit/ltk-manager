use chrono::{TimeZone, Utc};
use tempfile::TempDir;

use super::*;
use crate::event::Properties;

fn event(index: usize) -> Event {
    let timestamp = Utc
        .with_ymd_and_hms(2026, 9, 8, 12, 0, 0)
        .single()
        .expect("2026-09-08 is a real date");
    Event::new(
        "game_session_ended",
        Properties::new().with("index", index),
        timestamp,
    )
}

fn padded_event(index: usize, padding: usize) -> Event {
    let timestamp = Utc
        .with_ymd_and_hms(2026, 9, 8, 12, 0, 0)
        .single()
        .expect("2026-09-08 is a real date");
    Event::new(
        "game_session_ended",
        Properties::new()
            .with("index", index)
            .with("token", "x".repeat(padding)),
        timestamp,
    )
}

fn indices(events: &[Event]) -> Vec<u64> {
    events
        .iter()
        .map(|event| {
            event
                .properties()
                .get("index")
                .and_then(serde_json::Value::as_u64)
                .expect("every fixture carries its index")
        })
        .collect()
}

fn spool(dir: &TempDir, caps: SpoolCaps) -> Spool {
    Spool::open(dir.path(), caps)
}

#[test]
fn a_fresh_spool_holds_nothing() {
    let dir = TempDir::new().expect("a temporary directory");

    let spool = spool(&dir, SpoolCaps::default());

    assert!(spool.is_empty());
    assert!(spool.read().is_empty());
}

#[test]
fn appended_events_come_back_oldest_first() {
    let dir = TempDir::new().expect("a temporary directory");
    let mut spool = spool(&dir, SpoolCaps::default());

    for index in 0..3 {
        spool.append(&event(index));
    }

    assert_eq!(indices(&spool.read()), vec![0, 1, 2]);
    assert_eq!(spool.len(), 3);
}

#[test]
fn the_entry_cap_drops_the_oldest_first() {
    let dir = TempDir::new().expect("a temporary directory");
    let mut spool = spool(
        &dir,
        SpoolCaps {
            entries: 3,
            bytes: u64::MAX,
        },
    );

    for index in 0..5 {
        spool.append(&event(index));
    }

    assert_eq!(indices(&spool.read()), vec![2, 3, 4]);
    assert_eq!(spool.len(), 3);
}

#[test]
fn the_byte_cap_drops_the_oldest_first() {
    let dir = TempDir::new().expect("a temporary directory");
    let one = serde_json::to_string(&padded_event(0, 512))
        .expect("the fixture encodes")
        .len() as u64
        + 1;
    let mut spool = spool(
        &dir,
        SpoolCaps {
            entries: usize::MAX,
            bytes: one * 2,
        },
    );

    for index in 0..5 {
        spool.append(&padded_event(index, 512));
    }

    assert_eq!(indices(&spool.read()), vec![3, 4]);
}

#[test]
fn one_event_larger_than_the_byte_cap_is_still_kept() {
    let dir = TempDir::new().expect("a temporary directory");
    let mut spool = spool(
        &dir,
        SpoolCaps {
            entries: usize::MAX,
            bytes: 8,
        },
    );

    spool.append(&padded_event(0, 512));
    spool.append(&padded_event(1, 512));

    assert_eq!(indices(&spool.read()), vec![1]);
}

#[test]
fn what_was_sent_is_dropped_and_the_rest_survives() {
    let dir = TempDir::new().expect("a temporary directory");
    let mut spool = spool(&dir, SpoolCaps::default());
    for index in 0..4 {
        spool.append(&event(index));
    }

    spool.remove_first(2);

    assert_eq!(indices(&spool.read()), vec![2, 3]);
    assert_eq!(spool.len(), 2);
}

#[test]
fn removing_more_than_the_spool_holds_empties_it() {
    let dir = TempDir::new().expect("a temporary directory");
    let mut spool = spool(&dir, SpoolCaps::default());
    spool.append(&event(0));

    spool.remove_first(9);

    assert!(spool.is_empty());
    assert!(spool.read().is_empty());
}

#[test]
fn a_restart_replays_what_survived_and_not_what_was_sent() {
    let dir = TempDir::new().expect("a temporary directory");

    let mut before = spool(&dir, SpoolCaps::default());
    for index in 0..3 {
        before.append(&event(index));
    }
    before.remove_first(1);
    drop(before);

    let after = spool(&dir, SpoolCaps::default());

    assert_eq!(indices(&after.read()), vec![1, 2]);
    assert_eq!(after.len(), 2);
}

#[test]
fn an_unreadable_line_is_skipped_rather_than_stranding_the_rest() {
    let dir = TempDir::new().expect("a temporary directory");
    let mut spool = spool(&dir, SpoolCaps::default());
    spool.append(&event(0));
    fs::write(
        spool.path(),
        format!(
            "{{ not an event }}\n{}\n",
            serde_json::to_string(&event(1)).expect("the fixture encodes")
        ),
    )
    .expect("the spool file is writable");

    assert_eq!(indices(&spool.read()), vec![1]);
}
