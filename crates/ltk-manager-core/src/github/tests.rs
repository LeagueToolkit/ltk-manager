//! Unit tests for how a refusal from GitHub is read, without the network.

use super::*;

#[test]
fn a_refusal_is_the_spent_quota_only_when_none_is_left() {
    let mut spent = HeaderMap::new();
    spent.insert(REMAINING, "0".parse().unwrap());
    let mut left = HeaderMap::new();
    left.insert(REMAINING, "42".parse().unwrap());

    assert!(is_rate_limited(StatusCode::FORBIDDEN, &spent));
    assert!(is_rate_limited(StatusCode::TOO_MANY_REQUESTS, &spent));
    assert!(!is_rate_limited(StatusCode::FORBIDDEN, &left));
    assert!(!is_rate_limited(StatusCode::NOT_FOUND, &spent));
}

#[test]
fn every_failure_names_its_remedy() {
    assert_eq!(
        GitHubError::RateLimited.kind(),
        GitHubErrorKind::RateLimited
    );
    assert_eq!(GitHubError::Status(404).kind(), GitHubErrorKind::Http);
    assert_eq!(
        GitHubError::malformed(serde_json::from_str::<serde_json::Value>("{").unwrap_err()).kind(),
        GitHubErrorKind::Http
    );
    assert_eq!(
        GitHubError::Interrupted("cancelled".into()).kind(),
        GitHubErrorKind::Http
    );
}
