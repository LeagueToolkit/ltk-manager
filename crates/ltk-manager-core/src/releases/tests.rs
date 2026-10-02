//! Unit tests for what one page of the feed reads as, without the network.

use super::*;
use serde_json::json;

/// A `Link` header of the shape GitHub serves mid-feed.
const NEXT_AND_LAST: &str = concat!(
    "<https://api.github.com/repositories/1/releases?per_page=10&page=3>; rel=\"next\", ",
    "<https://api.github.com/repositories/1/releases?per_page=10&page=9>; rel=\"last\""
);

/// A published entry on `tag`, with the fields GitHub sends.
fn entry(tag: &str) -> Value {
    json!({
        "tag_name": tag,
        "body": "### Fixed\n- something",
        "published_at": "2026-08-01T12:00:00Z",
        "prerelease": false,
        "draft": false,
        "html_url": format!("https://github.com/LeagueToolkit/ltk-manager/releases/tag/{tag}"),
    })
}

#[test]
fn the_link_header_names_the_page_that_comes_next() {
    assert_eq!(next_page(Some(NEXT_AND_LAST)), Some(3));
}

#[test]
fn the_last_page_has_no_next_relation_to_follow() {
    let link = concat!(
        "<https://api.github.com/repositories/1/releases?per_page=10&page=8>; rel=\"prev\", ",
        "<https://api.github.com/repositories/1/releases?per_page=10&page=9>; rel=\"last\""
    );

    assert_eq!(next_page(Some(link)), None);
}

#[test]
fn a_feed_that_sends_no_link_header_ends_the_scroll() {
    assert_eq!(next_page(None), None);
}

#[test]
fn a_draft_is_not_a_published_release() {
    let mut draft = entry("v9.9.9");
    draft["draft"] = json!(true);

    assert_eq!(release_note(&draft), None);
}

#[test]
fn the_updater_tag_is_not_a_release_the_changelog_lists() {
    assert_eq!(release_note(&entry("updater")), None);
}

#[test]
fn a_version_tag_becomes_a_release_without_its_leading_v() {
    let note = release_note(&entry("v1.15.3")).expect("v1.15.3 parses as a version");

    assert_eq!(note.version, "1.15.3");
    assert_eq!(note.tag, "v1.15.3");
}

#[test]
fn a_prerelease_stays_in_the_feed_and_says_so() {
    let mut candidate = entry("v2.0.0-rc.1");
    candidate["prerelease"] = json!(true);

    let note = release_note(&candidate).expect("a release candidate parses as a version");

    assert_eq!(note.version, "2.0.0-rc.1");
    assert!(note.prerelease);
}

#[test]
fn a_page_filtered_down_to_nothing_still_says_where_the_next_one_starts() {
    let body = json!([entry("updater")]);

    let page = feed_page(&body, Some(NEXT_AND_LAST));

    assert!(page.releases.is_empty());
    assert_eq!(page.next_page, Some(3));
}
