use super::*;

fn at(minute: i64) -> DateTime<Utc> {
    DateTime::from_timestamp(minute * 60, 0).expect("the test names a timestamp")
}

#[test]
fn one_failure_reports_once_inside_the_window() {
    let dedup = Dedup::default();

    assert!(dedup.admits("app_panic:mod.rs:42", at(0)));
    assert!(!dedup.admits("app_panic:mod.rs:42", at(1)));
    assert!(!dedup.admits("app_panic:mod.rs:42", at(59)));
}

#[test]
fn the_same_failure_reports_again_once_the_window_has_passed() {
    let dedup = Dedup::default();

    assert!(dedup.admits("app_panic:mod.rs:42", at(0)));
    assert!(dedup.admits("app_panic:mod.rs:42", at(WINDOW_MINUTES)));
}

#[test]
fn two_failures_do_not_silence_each_other() {
    let dedup = Dedup::default();

    assert!(dedup.admits("app_panic:mod.rs:42", at(0)));
    assert!(dedup.admits("app_panic:mod.rs:43", at(0)));
    assert!(dedup.admits("ui_error:TypeError:/mods", at(0)));
}

#[test]
fn a_reset_lets_every_failure_report_again() {
    let dedup = Dedup::default();
    assert!(dedup.admits("app_panic:mod.rs:42", at(0)));

    dedup.clear();

    assert!(dedup.admits("app_panic:mod.rs:42", at(1)));
}

#[test]
fn a_loop_whose_fingerprint_varies_does_not_grow_without_bound() {
    let dedup = Dedup::default();

    for index in 0..(MAX_TRACKED * 2) {
        assert!(dedup.admits(&format!("ui_error:TypeError:/mods/{index}"), at(0)));
    }

    assert!(dedup.seen.lock().len() <= MAX_TRACKED);
}
