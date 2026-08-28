//! Unit tests for what the budget lets through, and what it makes wait.

use super::*;

use std::sync::mpsc;
use std::time::Duration;

/// Long enough that a thread which should have been blocked has had every
/// chance to run, short enough not to stall the suite.
const A_MOMENT: Duration = Duration::from_millis(250);

#[test]
fn two_jobs_inside_the_budget_run_at_once() {
    let budget = Budget::of(100);
    let first = budget.reserve(40).expect("inside the budget");

    let (done, ran) = mpsc::channel();
    let second = budget.clone();
    std::thread::spawn(move || {
        let _held = second.reserve(40).expect("inside the budget");
        done.send(()).expect("the receiver outlives the send");
    });

    assert!(ran.recv_timeout(A_MOMENT).is_ok());
    drop(first);
}

#[test]
fn a_job_that_would_overspend_waits_for_one_to_finish() {
    let budget = Budget::of(100);
    let first = budget.reserve(80).expect("inside the budget");

    let (done, ran) = mpsc::channel();
    let second = budget.clone();
    let waiting = std::thread::spawn(move || {
        let _held = second.reserve(80).expect("the first one finished");
        done.send(()).expect("the receiver outlives the send");
    });

    assert!(
        ran.recv_timeout(A_MOMENT).is_err(),
        "the second job must not run while the first holds the budget"
    );

    drop(first);
    assert!(ran.recv_timeout(A_MOMENT).is_ok());
    waiting.join().expect("the thread finishes");
}

/// Story: a mod larger than the whole budget is still repaired. Refusing it
/// would leave it permanently broken for being big.
#[test]
fn a_job_larger_than_the_budget_runs_alone_rather_than_never() {
    let budget = Budget::of(100);

    let held = budget.reserve(4096).expect("an oversized job still runs");
    drop(held);

    let (done, ran) = mpsc::channel();
    let other = budget.clone();
    std::thread::spawn(move || {
        let _held = other.reserve(50).expect("the bytes came back");
        done.send(()).expect("the receiver outlives the send");
    });
    assert!(ran.recv_timeout(A_MOMENT).is_ok(), "the bytes came back");
}

#[test]
fn a_budget_starts_uncancelled_and_every_clone_sees_the_cancel() {
    let budget = Budget::of(100);
    let watcher = budget.clone();
    assert!(!watcher.is_cancelled());

    budget.cancel();

    assert!(watcher.is_cancelled());
}

/// Story: a worker parked on the budget has to come back, or a cancel is only
/// noticed by the workers that happened to be running.
///
/// A cancel frees no bytes, so a wait loop that only re-read the byte count
/// would wake, find the same shortfall, and park again for good.
#[test]
fn a_cancel_releases_a_worker_parked_on_the_budget() {
    let budget = Budget::of(100);
    let held = budget.reserve(100).expect("the whole budget");

    let (done, ran) = mpsc::channel();
    let waiting = budget.clone();
    let parked = std::thread::spawn(move || {
        done.send(waiting.reserve(80).is_some())
            .expect("the receiver outlives the send");
    });

    assert!(
        ran.recv_timeout(A_MOMENT).is_err(),
        "nothing is free, so the second job must be parked"
    );

    budget.cancel();

    assert_eq!(
        ran.recv_timeout(A_MOMENT),
        Ok(false),
        "the cancel releases it, and it does not get to run"
    );
    parked.join().expect("the thread finishes");
    drop(held);
}
