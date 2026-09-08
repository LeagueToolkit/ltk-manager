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

/// How many bytes one event takes as a spool line, which the byte cap counts.
fn line_len(seq: u64, event: Event) -> u64 {
    serde_json::to_string(&Entry { seq, event })
        .expect("the fixture encodes")
        .len() as u64
        + 1
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
    let one = line_len(0, padded_event(0, 512));
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
fn a_delivered_batch_is_dropped_whole() {
    let dir = TempDir::new().expect("a temporary directory");
    let mut spool = spool(&dir, SpoolCaps::default());
    for index in 0..4 {
        spool.append(&event(index));
    }

    let batch = spool.batch();
    spool.remove_through(batch.mark().expect("a batch of four is marked"));

    assert_eq!(batch.len(), 4);
    assert!(spool.is_empty());
    assert!(spool.read().is_empty());
}

#[test]
fn an_event_tracked_while_a_batch_was_in_the_air_survives_it() {
    let dir = TempDir::new().expect("a temporary directory");
    let mut spool = spool(&dir, SpoolCaps::default());
    for index in 0..2 {
        spool.append(&event(index));
    }

    let batch = spool.batch();
    spool.append(&event(2));
    spool.remove_through(batch.mark().expect("a batch of two is marked"));

    assert_eq!(indices(&spool.read()), vec![2]);
    assert_eq!(spool.len(), 1);
}

// The count of a delivered batch stops naming the same entries once eviction
// shifts the front, so a delivery acknowledges a mark instead.
#[test]
fn eviction_during_a_delivery_does_not_drop_an_unsent_event() {
    let dir = TempDir::new().expect("a temporary directory");
    let mut spool = spool(
        &dir,
        SpoolCaps {
            entries: 3,
            bytes: u64::MAX,
        },
    );
    for index in 0..3 {
        spool.append(&event(index));
    }

    let batch = spool.batch();
    spool.append(&event(3));
    spool.remove_through(batch.mark().expect("a batch of three is marked"));

    assert_eq!(indices(&spool.read()), vec![3]);
}

#[test]
fn a_mark_older_than_everything_left_drops_nothing() {
    let dir = TempDir::new().expect("a temporary directory");
    let mut spool = spool(&dir, SpoolCaps::default());
    spool.append(&event(0));
    let batch = spool.batch();
    spool.remove_through(batch.mark().expect("a batch of one is marked"));
    spool.append(&event(1));

    spool.remove_through(batch.mark().expect("a batch of one is marked"));

    assert_eq!(indices(&spool.read()), vec![1]);
}

#[test]
fn an_empty_spool_yields_an_unmarked_batch() {
    let dir = TempDir::new().expect("a temporary directory");

    let batch = spool(&dir, SpoolCaps::default()).batch();

    assert!(batch.is_empty());
    assert_eq!(batch.mark(), None);
}

#[test]
fn a_restart_replays_what_survived_and_not_what_was_sent() {
    let dir = TempDir::new().expect("a temporary directory");

    let mut before = spool(&dir, SpoolCaps::default());
    before.append(&event(0));
    let delivered = before.batch().mark().expect("a batch of one is marked");
    for index in 1..3 {
        before.append(&event(index));
    }
    before.remove_through(delivered);
    drop(before);

    let after = spool(&dir, SpoolCaps::default());

    assert_eq!(indices(&after.read()), vec![1, 2]);
    assert_eq!(after.len(), 2);
}

#[test]
fn a_restart_does_not_reuse_a_mark_it_already_handed_out() {
    let dir = TempDir::new().expect("a temporary directory");
    let mut before = spool(&dir, SpoolCaps::default());
    before.append(&event(0));
    let first = before.batch().mark().expect("a batch of one is marked");
    drop(before);

    let mut after = spool(&dir, SpoolCaps::default());
    after.append(&event(1));

    let second = after.batch().mark().expect("a batch of two is marked");
    assert!(second > first);
}

#[test]
fn an_unreadable_line_is_skipped_rather_than_stranding_the_rest() {
    let dir = TempDir::new().expect("a temporary directory");
    let mut spool = spool(&dir, SpoolCaps::default());
    spool.append(&event(0));
    fs::write(
        spool.path(),
        format!(
            "{{ not an entry }}\n{}\n",
            serde_json::to_string(&Entry {
                seq: 1,
                event: event(1)
            })
            .expect("the fixture encodes")
        ),
    )
    .expect("the spool file is writable");

    assert_eq!(indices(&spool.read()), vec![1]);
}
