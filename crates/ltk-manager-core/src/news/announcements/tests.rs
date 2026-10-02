//! Unit tests for what the Announcements feed reads as, without the network.

use super::*;

/// The feed as GitHub serves it: a category header, then one entry per post.
const FEED: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/" xml:lang="en-US">
  <id>tag:github.com,2008:/LeagueToolkit/ltk-manager/discussions/categories/announcements</id>
  <link type="text/html" rel="alternate" href="https://github.com/LeagueToolkit/ltk-manager/discussions/categories/announcements"/>
  <link type="application/atom+xml" rel="self" href="https://github.com/LeagueToolkit/ltk-manager/discussions/categories/announcements.atom"/>
  <title>Recent discussions in LeagueToolkit/ltk-manager, category: announcements</title>
  <updated>2026-06-03T05:06:46+00:00</updated>
  <entry>
    <id>tag:github.com,2008:10174672</id>
    <link type="text/html" rel="alternate" href="https://github.com/orgs/LeagueToolkit/discussions/220"/>
    <title>
      [IMPORTANT] Patch 26.9 - Patcher Issues FAQ
    </title>
    <published>2026-06-01T05:44:14+00:00</published>
    <updated>2026-06-03T05:06:46+00:00</updated>
    <media:thumbnail height="30" width="30" url="https://avatars.githubusercontent.com/u/18646077?s=30&amp;v=4"/>
    <author>
      <name>Crauzer</name>
      <uri>https://github.com/Crauzer</uri>
    </author>
    <content type="html">
      &lt;h1 dir=&quot;auto&quot;&gt;Patch 26.9 Patcher Issues FAQ&lt;/h1&gt;
    </content>
  </entry>
  <entry>
    <id>tag:github.com,2008:10000001</id>
    <link type="text/html" rel="alternate" href="https://github.com/orgs/LeagueToolkit/discussions/100"/>
    <title>Mods &amp; the new manager</title>
    <published>2026-05-15T10:00:00+00:00</published>
    <updated>2026-05-15T10:00:00+00:00</updated>
    <author>
      <name>Crauzer</name>
    </author>
    <content type="html">&lt;p&gt;Hello&lt;/p&gt;</content>
  </entry>
</feed>
"#;

#[test]
fn every_entry_becomes_a_post_with_its_title_page_and_date() {
    let posts = parse_feed(FEED).unwrap();

    assert_eq!(
        posts,
        vec![
            Announcement {
                id: "tag:github.com,2008:10174672".into(),
                title: "[IMPORTANT] Patch 26.9 - Patcher Issues FAQ".into(),
                url: "https://github.com/orgs/LeagueToolkit/discussions/220".into(),
                published_at: Some("2026-06-01T05:44:14+00:00".into()),
            },
            Announcement {
                id: "tag:github.com,2008:10000001".into(),
                title: "Mods & the new manager".into(),
                url: "https://github.com/orgs/LeagueToolkit/discussions/100".into(),
                published_at: Some("2026-05-15T10:00:00+00:00".into()),
            },
        ]
    );
}

#[test]
fn an_entry_with_no_date_is_still_a_post() {
    let feed = r#"<feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <id>tag:github.com,2008:1</id>
        <link rel="alternate" href="https://github.com/orgs/LeagueToolkit/discussions/1"/>
        <title>Undated</title>
      </entry>
    </feed>"#;

    let posts = parse_feed(feed).unwrap();

    assert_eq!(posts.len(), 1);
    assert_eq!(posts[0].title, "Undated");
    assert_eq!(posts[0].published_at, None);
}

#[test]
fn an_entry_with_no_page_to_open_is_left_out() {
    let feed = r#"<feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <id>tag:github.com,2008:1</id>
        <title>Nowhere to go</title>
      </entry>
    </feed>"#;

    assert!(parse_feed(feed).unwrap().is_empty());
}

#[test]
fn an_empty_feed_is_no_posts() {
    let feed = r#"<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <title>Recent discussions</title>
      <updated>2026-06-03T05:06:46+00:00</updated>
    </feed>"#;

    assert_eq!(parse_feed(feed).unwrap(), vec![]);
}

#[test]
fn a_body_that_is_not_xml_is_malformed() {
    assert!(parse_feed("<feed><entry><title>unclosed</feed>").is_err());
}
