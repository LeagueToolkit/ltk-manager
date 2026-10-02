//! The project's announcements, as the Discussions category publishes them.
//!
//! The category has an Atom feed served by `github.com`, outside the API's
//! quota and needing no token. Only what the news card draws is read out of
//! an entry: the title, the page it opens, and when it was posted.

use chrono::{DateTime, FixedOffset};
use quick_xml::escape::unescape;
use quick_xml::events::{BytesStart, Event};
use quick_xml::{Reader, XmlVersion};
use semver::Version;
use serde::{Deserialize, Serialize};

use crate::github::{self, GitHubError};

/// The Announcements category's feed.
const FEED_URL: &str =
    "https://github.com/LeagueToolkit/ltk-manager/discussions/categories/announcements.atom";

/// How many posts are handed over, newest first.
const CAP: usize = 10;

/// One post in the Announcements category.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Announcement {
    /// The feed's own id for the post.
    pub id: String,
    pub title: String,
    /// The post's page on GitHub.
    pub url: String,
    /// RFC 3339, as GitHub publishes it, or `None` for an entry without one.
    pub published_at: Option<String>,
}

/// Read the newest announcements, at most [`CAP`] of them, as the `running` build.
///
/// Blocking, so it belongs on a thread that does not draw the window.
///
/// # Errors
///
/// Fails when GitHub cannot be reached, when the address has spent its
/// quota, or when the answer is not an Atom feed.
pub fn fetch(running: &Version) -> Result<Vec<Announcement>, GitHubError> {
    let response = github::send(github::client(running)?.get(FEED_URL))?;
    let body = response.text().map_err(GitHubError::Http)?;
    let mut posts = parse_feed(&body).map_err(GitHubError::malformed)?;
    posts.sort_by_key(|post| std::cmp::Reverse(posted_at(post)));
    posts.truncate(CAP);
    Ok(posts)
}

/// When a post went up, for ordering. An entry without a date sorts last.
fn posted_at(post: &Announcement) -> Option<DateTime<FixedOffset>> {
    let stamp = post.published_at.as_deref()?;
    DateTime::parse_from_rfc3339(stamp).ok()
}

/// Every entry of the feed `text`, in the order the feed lists them.
fn parse_feed(text: &str) -> Result<Vec<Announcement>, quick_xml::Error> {
    let mut reader = Reader::from_str(text);
    let mut posts = Vec::new();

    loop {
        match reader.read_event()? {
            Event::Start(start) if start.local_name().as_ref() == b"entry" => {
                posts.extend(read_entry(&mut reader)?);
            }
            Event::Eof => return Ok(posts),
            _ => {}
        }
    }
}

/// The entry the reader stands at the start of, or `None` for one the card
/// could not draw: no title, or no page to open.
fn read_entry(reader: &mut Reader<&[u8]>) -> Result<Option<Announcement>, quick_xml::Error> {
    let mut id = None;
    let mut title = None;
    let mut url = None;
    let mut published_at = None;

    loop {
        match reader.read_event()? {
            Event::Start(start) => match start.local_name().as_ref() {
                b"id" => id = Some(text_of(reader, &start)?),
                b"title" => title = Some(text_of(reader, &start)?),
                b"published" => published_at = Some(text_of(reader, &start)?),
                _ => {
                    reader.read_to_end(start.name())?;
                }
            },
            Event::Empty(start) if start.local_name().as_ref() == b"link" => {
                if is_alternate(&start) {
                    url = href(&start)?;
                }
            }
            Event::End(end) if end.local_name().as_ref() == b"entry" => break,
            Event::Eof => break,
            _ => {}
        }
    }

    let (Some(title), Some(url)) = (title.filter(|t| !t.is_empty()), url) else {
        return Ok(None);
    };
    Ok(Some(Announcement {
        id: id.unwrap_or_else(|| url.clone()),
        title,
        url,
        published_at: published_at.filter(|stamp| !stamp.is_empty()),
    }))
}

/// The text inside `start`, unescaped and trimmed of the feed's indentation.
fn text_of(reader: &mut Reader<&[u8]>, start: &BytesStart) -> Result<String, quick_xml::Error> {
    let raw = reader.read_text(start.name())?;
    let decoded = raw.decode()?;
    Ok(unescape(&decoded)?.trim().to_owned())
}

/// Whether a `<link>` is the entry's own page rather than an enclosure.
///
/// Atom reads a link with no `rel` as `alternate`.
fn is_alternate(link: &BytesStart) -> bool {
    link.try_get_attribute("rel")
        .ok()
        .flatten()
        .is_none_or(|rel| rel.value.as_ref() == b"alternate")
}

/// Where a `<link>` points.
fn href(link: &BytesStart) -> Result<Option<String>, quick_xml::Error> {
    let Some(href) = link.try_get_attribute("href")? else {
        return Ok(None);
    };
    Ok(Some(
        href.normalized_value(XmlVersion::default())?.into_owned(),
    ))
}

#[cfg(test)]
mod tests;
