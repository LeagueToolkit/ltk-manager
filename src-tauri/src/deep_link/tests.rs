//! Unit tests for how a deep link waits for the frontend to listen.

use ltk_manager_core::deep_link::DeepLinkSettingsRequest;

use super::*;

#[test]
fn holds_a_link_that_arrives_before_the_frontend_listens() {
    let state = DeepLinkState::new();
    let request = DeepLinkRequest::Settings(DeepLinkSettingsRequest {
        focus: "appearance.theme".into(),
    });

    state.handoff.lock().pending = Some(request.clone());

    assert_eq!(state.take_pending(), Some(request));
    assert_eq!(state.take_pending(), None);
}

#[test]
fn take_pending_marks_the_frontend_listening() {
    let state = DeepLinkState::new();
    assert!(!state.handoff.lock().listening);

    state.take_pending();

    assert!(state.handoff.lock().listening);
}

#[test]
fn rate_limiter_blocks_rapid_calls() {
    let state = DeepLinkState::new();
    assert!(!state.should_rate_limit());
    assert!(state.should_rate_limit());
}
