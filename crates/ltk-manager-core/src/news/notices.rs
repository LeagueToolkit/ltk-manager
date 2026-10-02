//! The notices the project publishes, read raw from the repository.
//!
//! A notice is one line that has to be seen: a game patch broke the patcher,
//! an update is required, a build has a bug worth knowing about. The document
//! lives at `news/notices.json` on the default branch, and its URL is the
//! contract. `news/README.md` names the schema.

use chrono::{DateTime, Utc};
use semver::{Version, VersionReq};
use serde::{Deserialize, Serialize};

use crate::github::{self, GitHubError};

/// The document, read raw so a notice is a reviewed change.
const DOCUMENT_URL: &str =
    "https://raw.githubusercontent.com/LeagueToolkit/ltk-manager/main/news/notices.json";

/// The one schema this build reads. A document on another is silence.
const SCHEMA: u32 = 1;

/// How loudly a notice is drawn.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum NoticeSeverity {
    Info,
    Warning,
    Danger,
}

/// One notice that concerns the running build, and has not expired.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    /// Stable across edits, which is what a dismissal is kept by.
    pub id: String,
    pub severity: NoticeSeverity,
    pub title: String,
    /// Where "What to do" opens, when the notice has somewhere to send a reader.
    pub url: Option<String>,
    /// RFC 3339.
    pub published_at: String,
}

/// The document as published, before the filter.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Document {
    schema: u32,
    #[serde(default)]
    notices: Vec<PublishedNotice>,
}

/// A notice as the document writes it, with the conditions the filter reads.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublishedNotice {
    id: String,
    severity: NoticeSeverity,
    title: String,
    #[serde(default)]
    url: Option<String>,
    published_at: String,
    /// RFC 3339. Past it, the notice is not drawn.
    #[serde(default)]
    expires_at: Option<String>,
    /// A semver range. Outside it, the notice is not drawn.
    #[serde(default)]
    versions: Option<String>,
}

/// Read the notices that concern the `running` build right now, newest first.
///
/// Blocking, so it belongs on a thread that does not draw the window.
///
/// # Errors
///
/// Fails when GitHub cannot be reached, when the address has spent its
/// quota, or when the answer is not a notices document.
pub fn fetch(running: &Version) -> Result<Vec<Notice>, GitHubError> {
    let response = github::send(github::client(running)?.get(DOCUMENT_URL))?;
    let body = response.text().map_err(GitHubError::Http)?;
    let document = serde_json::from_str(&body).map_err(GitHubError::malformed)?;

    Ok(current(document, running, Utc::now()))
}

/// The notices in `document` that concern `running` and are live at `now`.
fn current(document: Document, running: &Version, now: DateTime<Utc>) -> Vec<Notice> {
    if document.schema != SCHEMA {
        tracing::warn!(
            schema = document.schema,
            "The notices document is on a schema this build does not read"
        );
        return Vec::new();
    }

    let mut notices: Vec<Notice> = document
        .notices
        .into_iter()
        .filter(|notice| notice.concerns(running, now))
        .map(PublishedNotice::into_notice)
        .collect();
    notices.sort_by_key(|notice| std::cmp::Reverse(published_at(notice)));
    notices
}

/// When a notice went up, for ordering. One whose stamp does not parse sorts last.
fn published_at(notice: &Notice) -> Option<DateTime<chrono::FixedOffset>> {
    DateTime::parse_from_rfc3339(&notice.published_at).ok()
}

impl PublishedNotice {
    /// Whether the notice is for `running`, and still live at `now`.
    ///
    /// A condition that cannot be read keeps the notice off the page: a
    /// range that names no build is not one this build is in.
    fn concerns(&self, running: &Version, now: DateTime<Utc>) -> bool {
        if let Some(range) = &self.versions {
            match VersionReq::parse(range) {
                Ok(range) if range.matches(running) => {}
                Ok(_) => return false,
                Err(error) => {
                    tracing::warn!(id = %self.id, range, %error, "A notice names a range that does not parse");
                    return false;
                }
            }
        }
        if let Some(stamp) = &self.expires_at {
            match DateTime::parse_from_rfc3339(stamp) {
                Ok(expires_at) if expires_at > now => {}
                Ok(_) => return false,
                Err(error) => {
                    tracing::warn!(id = %self.id, stamp, %error, "A notice names an expiry that does not parse");
                    return false;
                }
            }
        }
        true
    }

    fn into_notice(self) -> Notice {
        Notice {
            id: self.id,
            severity: self.severity,
            title: self.title,
            url: self.url,
            published_at: self.published_at,
        }
    }
}

#[cfg(test)]
mod tests;
