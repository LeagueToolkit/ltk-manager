//! The repository's published releases, as the changelog pages through them.
//!
//! The feed is `api.github.com`, which GitHub allows sixty unauthenticated
//! reads of an hour per address.

use reqwest::Url;
use reqwest::header::{ACCEPT, LINK};
use semver::Version;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::github::{self, GitHubError};

/// Where the releases the changelog reads are published.
const FEED_URL: &str = "https://api.github.com/repos/LeagueToolkit/ltk-manager/releases";

/// How many releases one page of the changelog holds.
const PER_PAGE: u32 = 10;

/// One published release, as the changelog reads it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ReleaseNote {
    /// The tag without its leading `v`.
    pub version: String,
    pub tag: String,
    pub body: String,
    /// RFC 3339, as GitHub publishes it.
    pub published_at: Option<String>,
    pub prerelease: bool,
    /// The release's page on GitHub.
    pub url: String,
}

/// A page of the release feed, and where the next one starts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ReleasePage {
    pub releases: Vec<ReleaseNote>,
    /// `None` once the feed has no page after this one.
    pub next_page: Option<u32>,
}

/// Read page `page` of the release feed, one-based as GitHub numbers it, as the `running` build.
///
/// Blocking, so it belongs on a thread that does not draw the window.
///
/// # Errors
///
/// Fails when GitHub cannot be reached, when the address has spent its
/// unauthenticated quota, or when the answer is not a page of the feed.
pub fn fetch_page(running: &Version, page: u32) -> Result<ReleasePage, GitHubError> {
    let request = github::client(running)?
        .get(format!("{FEED_URL}?per_page={PER_PAGE}&page={page}"))
        .header(ACCEPT, "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");
    let response = github::send(request)?;

    let link = response
        .headers()
        .get(LINK)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let body = response.text().map_err(GitHubError::Http)?;
    let feed = serde_json::from_str(&body).map_err(GitHubError::malformed)?;

    Ok(feed_page(&feed, link.as_deref()))
}

/// The page `body` holds, and the one its `link` header says follows it.
fn feed_page(body: &Value, link: Option<&str>) -> ReleasePage {
    let releases = body
        .as_array()
        .map(|entries| entries.iter().filter_map(release_note).collect())
        .unwrap_or_default();

    ReleasePage {
        releases,
        next_page: next_page(link),
    }
}

/// The release `entry` describes, when it is one the changelog lists.
///
/// A tag that is not a version is not a release the changelog has a place
/// for, which is what drops the pinned `updater` tag the updater reads.
fn release_note(entry: &Value) -> Option<ReleaseNote> {
    if entry["draft"].as_bool().unwrap_or(false) {
        return None;
    }

    let tag = entry["tag_name"].as_str()?;
    let version = tag.strip_prefix('v').unwrap_or(tag);
    semver::Version::parse(version).ok()?;

    Some(ReleaseNote {
        version: version.to_owned(),
        tag: tag.to_owned(),
        body: entry["body"].as_str().unwrap_or_default().to_owned(),
        published_at: entry["published_at"].as_str().map(str::to_owned),
        prerelease: entry["prerelease"].as_bool().unwrap_or(false),
        url: entry["html_url"].as_str().unwrap_or_default().to_owned(),
    })
}

/// The page a `Link` header points at as `rel="next"`.
///
/// The header is the cursor rather than the entry count, because the version
/// filter can leave a page shorter than the one GitHub served.
fn next_page(link: Option<&str>) -> Option<u32> {
    link?.split(',').find_map(|entry| {
        let mut parts = entry.split(';').map(str::trim);
        let target = parts.next()?;
        parts.any(is_next).then(|| page_query(target)).flatten()
    })
}

/// Whether a `Link` parameter is the relation naming the following page.
fn is_next(param: &str) -> bool {
    param
        .strip_prefix("rel=")
        .is_some_and(|relation| relation.trim_matches('"') == "next")
}

/// The `page` a `<...>` link target asks for.
fn page_query(target: &str) -> Option<u32> {
    let url = target.strip_prefix('<')?.strip_suffix('>')?;
    Url::parse(url)
        .ok()?
        .query_pairs()
        .find(|(key, _)| key == "page")
        .and_then(|(_, value)| value.parse().ok())
}

#[cfg(test)]
mod tests;
