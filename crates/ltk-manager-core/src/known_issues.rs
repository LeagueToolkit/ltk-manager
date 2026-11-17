//! The known issues that the project publishes, read raw from the repository.
//!
//! A known issue is the maintainers' answer to a failure that many installs hit, such as a
//! game patch that stops every mod. The document is `config/known-issues.json` on the default
//! branch. Its URL is the contract, and `config/README.md` documents the schema. A maintainer
//! publishes or withdraws an entry by merging a pull request, without a release.

use chrono::{DateTime, Utc};
use semver::{Version, VersionReq};
use serde::{Deserialize, Serialize};

use crate::github::{self, GitHubError};

const DOCUMENT_URL: &str =
    "https://raw.githubusercontent.com/LeagueToolkit/ltk-manager/main/config/known-issues.json";

/// The schema that this build reads. A document on another schema yields no issue.
const SCHEMA: u32 = 1;

/// One known issue that applies to the running build and has not expired.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct KnownIssue {
    pub id: String,
    /// The verdict kinds that the issue explains, such as `missing-data`.
    pub verdicts: Vec<String>,
    /// The advisory codes that the issue explains, such as `overlay-refused`.
    pub advisories: Vec<String>,
    /// The maintainers' message, in English.
    pub message: String,
    /// The page that `Read more` opens.
    pub url: Option<String>,
}

/// The document as published, before the filter.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Document {
    schema: u32,
    #[serde(default)]
    issues: Vec<PublishedIssue>,
}

/// A known issue as the document holds it, with the conditions that the filter reads.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublishedIssue {
    id: String,
    #[serde(default)]
    verdicts: Vec<String>,
    #[serde(default)]
    advisories: Vec<String>,
    message: String,
    #[serde(default)]
    url: Option<String>,
    /// A semver range. The issue applies to a build inside the range only.
    #[serde(default)]
    versions: Option<String>,
    /// RFC 3339. The issue is withdrawn after this time.
    #[serde(default)]
    expires_at: Option<String>,
}

/// Reads the known issues that apply to the `running` build now, in the order of the
/// document.
///
/// The call blocks on the network.
///
/// # Errors
///
/// Fails if GitHub cannot be reached, if the address is rate limited, or if the answer is not
/// a known issues document.
pub fn fetch(running: &Version) -> Result<Vec<KnownIssue>, GitHubError> {
    let response = github::send(github::client(running)?.get(DOCUMENT_URL))?;
    let body = response.text().map_err(GitHubError::Http)?;
    let document = serde_json::from_str(&body).map_err(GitHubError::malformed)?;

    Ok(current(document, running, Utc::now()))
}

/// Returns the issues of `document` that apply to `running` and have not expired at `now`.
///
/// Returns no issue if the document is on another schema.
fn current(document: Document, running: &Version, now: DateTime<Utc>) -> Vec<KnownIssue> {
    if document.schema != SCHEMA {
        tracing::warn!(
            schema = document.schema,
            "The known issues document is on a schema that this build does not read"
        );
        return Vec::new();
    }

    document
        .issues
        .into_iter()
        .filter(|issue| issue.applies(running, now))
        .map(|issue| KnownIssue {
            id: issue.id,
            verdicts: issue.verdicts,
            advisories: issue.advisories,
            message: issue.message,
            url: issue.url,
        })
        .collect()
}

impl PublishedIssue {
    /// Returns whether the issue applies to `running` and has not expired at `now`.
    ///
    /// Returns `false` if the version range or the expiry time does not parse.
    fn applies(&self, running: &Version, now: DateTime<Utc>) -> bool {
        if let Some(range) = &self.versions {
            match VersionReq::parse(range) {
                Ok(range) if range.matches(running) => {}
                Ok(_) => return false,
                Err(error) => {
                    tracing::warn!(id = %self.id, range, %error, "A known issue has a version range that does not parse");
                    return false;
                }
            }
        }
        if let Some(stamp) = &self.expires_at {
            match DateTime::parse_from_rfc3339(stamp) {
                Ok(expires_at) if expires_at > now => {}
                Ok(_) => return false,
                Err(error) => {
                    tracing::warn!(id = %self.id, stamp, %error, "A known issue has an expiry time that does not parse");
                    return false;
                }
            }
        }
        true
    }
}

#[cfg(test)]
mod tests;
