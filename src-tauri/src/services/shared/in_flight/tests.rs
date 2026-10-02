use super::*;

/// A double-clicked Play button must produce one request, not two.
#[test]
fn only_one_run_is_in_flight_at_a_time() {
    let state = InFlight::<StopFlag>::default();

    let first = state.acquire();
    assert!(first.is_some());
    assert!(state.acquire().is_none());

    drop(first);
    assert!(state.acquire().is_some());
}

/// Cancel reaches the flag the run is watching, and says so - the UI needs to tell
/// "cancelling" apart from "there was nothing to cancel".
#[test]
fn cancelling_stops_the_flag_the_run_holds() {
    let state = InFlight::<StopFlag>::default();
    assert!(!state.cancel());

    let (_guard, stop) = state.acquire().unwrap();
    assert!(!stop.is_stopped());

    assert!(state.cancel());
    assert!(stop.is_stopped());
}

/// A stopped flag stays stopped, so the next run has to get its own or it would be
/// cancelled before it started.
#[test]
fn each_run_gets_a_fresh_flag() {
    let state = InFlight::<Arc<AtomicBool>>::default();

    let (guard, first) = state.acquire().unwrap();
    state.cancel();
    drop(guard);

    let (_guard, second) = state.acquire().unwrap();
    assert!(first.load(Ordering::Relaxed));
    assert!(!second.load(Ordering::Relaxed));
}
