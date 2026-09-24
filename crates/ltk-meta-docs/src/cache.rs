//! The documentation as last fetched, and the conditional fetch that refreshes it.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use fs_err as fs;
use serde::{Deserialize, Serialize};

use crate::{MetaDocs, ParseDocsError};

/// How long a fetched copy is trusted before the publisher is asked again.
///
/// The prose moves when a documentation pull request merges, which is days apart, and the
/// publisher asks every client to cache what it fetches.
pub const REFRESH_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

/// What one conditional fetch came back with.
#[derive(Debug)]
pub enum Fetched {
    /// The publisher's copy is the one already cached.
    Unchanged,
    /// A payload, and the tag identifying it.
    Body { json: Vec<u8>, etag: Option<String> },
}

/// Why the published documentation could not be fetched.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum FetchDocsError {
    /// The request never produced a usable response.
    #[error("requesting {DOCS_URL}")]
    Request(#[source] reqwest::Error),

    /// The response started and then stopped part-way through the body.
    #[error("reading the body of {DOCS_URL}")]
    Body(#[source] reqwest::Error),
}

/// Where the published documentation is read from.
pub trait FetchDocs {
    /// Fetch it, unless `known` is still the tag the publisher serves.
    ///
    /// # Errors
    ///
    /// Fails when the publisher cannot be reached or answers with an error - see
    /// [`FetchDocsError`].
    fn fetch(&self, known: Option<&str>) -> Result<Fetched, FetchDocsError>;
}

/// Why a refresh could not leave the cache better than it found it.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum RefreshError {
    /// The publisher could not be reached, or did not answer.
    #[error(transparent)]
    Fetch(#[from] FetchDocsError),

    /// The cache directory or the payload itself could not be written.
    #[error("writing the meta wiki documentation")]
    Write(#[from] std::io::Error),

    /// The body arrived and is not documentation this build reads.
    #[error("the meta wiki documentation that was served is not one this build reads")]
    Unusable(#[from] ParseDocsError),
}

/// What one refresh did.
#[derive(Debug)]
pub enum Refresh {
    /// The cached copy was checked less than [`REFRESH_INTERVAL`] ago, so nothing was asked.
    NotDue,
    /// The publisher still serves the cached copy.
    Unchanged,
    /// A new copy landed, parsed.
    Installed(MetaDocs),
}

/// The cached documentation on this machine.
#[derive(Debug, Clone)]
pub struct DocsCache {
    dir: PathBuf,
}

impl DocsCache {
    /// The cache kept in `dir`.
    pub fn at(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    /// The directory the documentation is cached in.
    #[must_use]
    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// The cached documentation. `None` where none was fetched yet or the copy does not read.
    #[must_use]
    pub fn load(&self) -> Option<MetaDocs> {
        let json = fs::read(self.docs_path()).ok()?;
        MetaDocs::parse(&json)
            .inspect_err(|e| tracing::warn!("Unreadable cached meta wiki documentation: {e}"))
            .ok()
    }

    /// Bring the cached documentation up to date with the published copy.
    ///
    /// **The publisher is asked at most once per [`REFRESH_INTERVAL`]**, and then with the
    /// cached tag, so an unchanged copy costs a `304` and no body. A body is parsed before it
    /// is installed, and a refused one leaves the cache and its tag alone.
    ///
    /// # Errors
    ///
    /// Fails when the documentation cannot be fetched, when what arrives is not documentation
    /// this build reads, and when the cache cannot be written - see [`RefreshError`].
    pub fn refresh(&self, fetch: &dyn FetchDocs, now: SystemTime) -> Result<Refresh, RefreshError> {
        let cached = self.docs_path().is_file();
        let stamp = self.stamp().filter(|_| cached);
        if stamp.as_ref().is_some_and(|stamp| !stamp.is_due(now)) {
            return Ok(Refresh::NotDue);
        }

        let known = stamp.as_ref().and_then(|stamp| stamp.etag.as_deref());
        let Fetched::Body { json, etag } = fetch.fetch(known)? else {
            Stamp {
                etag: known.map(str::to_owned),
                checked_at: seconds(now),
            }
            .write(&self.stamp_path());
            return Ok(Refresh::Unchanged);
        };

        let installed = MetaDocs::parse(&json)?;
        fs::create_dir_all(&self.dir)?;
        atomic_write(&self.docs_path(), &json)?;
        Stamp {
            etag,
            checked_at: seconds(now),
        }
        .write(&self.stamp_path());
        tracing::info!(
            "Installed the meta wiki documentation of {} classes",
            installed.class_count()
        );
        Ok(Refresh::Installed(installed))
    }

    fn docs_path(&self) -> PathBuf {
        self.dir.join(DOCS_FILENAME)
    }

    fn stamp_path(&self) -> PathBuf {
        self.dir.join(STAMP_FILENAME)
    }

    fn stamp(&self) -> Option<Stamp> {
        let json = fs::read(self.stamp_path()).ok()?;
        serde_json::from_slice(&json).ok()
    }
}

/// What the cached copy is and when the publisher was last asked about it.
///
/// Its own file because the payload is the publisher's copy byte for byte.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stamp {
    /// The entity tag the publisher served the cached copy under.
    etag: Option<String>,
    /// Seconds since the Unix epoch.
    checked_at: u64,
}

impl Stamp {
    /// A clock that moved back past the check reads as due, so it cannot hold a copy forever.
    fn is_due(&self, now: SystemTime) -> bool {
        let checked = UNIX_EPOCH + Duration::from_secs(self.checked_at);
        now.duration_since(checked)
            .map_or(true, |elapsed| elapsed >= REFRESH_INTERVAL)
    }

    /// Best-effort: an unwritten stamp costs the next refresh a request, which is not worth
    /// failing one that has already installed the payload.
    fn write(&self, path: &Path) {
        let stamped = serde_json::to_vec_pretty(self)
            .map_err(std::io::Error::from)
            .and_then(|json| atomic_write(path, &json));
        if let Err(e) = stamped {
            tracing::debug!("Could not stamp the meta wiki documentation cache: {e}");
        }
    }
}

fn seconds(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs())
}

fn atomic_write(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    let mut temporary = path.as_os_str().to_os_string();
    temporary.push(".tmp");
    fs::write(&temporary, contents)?;
    fs::rename(&temporary, path)
}

/// The published documentation, over HTTP.
///
/// A conditional GET: the cached tag goes out as `If-None-Match`. Only a transport - a body
/// it hands back is still the cache's to find readable.
#[derive(Debug)]
pub struct PublishedDocs {
    client: reqwest::blocking::Client,
}

impl PublishedDocs {
    /// Talk to the publisher as `user_agent`.
    ///
    /// # Errors
    ///
    /// Fails when the HTTP client cannot be built.
    pub fn new(user_agent: &str) -> Result<Self, reqwest::Error> {
        Ok(Self {
            client: reqwest::blocking::Client::builder()
                .user_agent(user_agent)
                .timeout(FETCH_TIMEOUT)
                .connect_timeout(CONNECT_TIMEOUT)
                .build()?,
        })
    }
}

impl FetchDocs for PublishedDocs {
    fn fetch(&self, known: Option<&str>) -> Result<Fetched, FetchDocsError> {
        let mut request = self.client.get(DOCS_URL);
        if let Some(tag) = known {
            request = request.header(reqwest::header::IF_NONE_MATCH, tag);
        }

        let response = request
            .send()
            .and_then(reqwest::blocking::Response::error_for_status)
            .map_err(FetchDocsError::Request)?;
        if response.status() == reqwest::StatusCode::NOT_MODIFIED {
            return Ok(Fetched::Unchanged);
        }

        let etag = response
            .headers()
            .get(reqwest::header::ETAG)
            .and_then(|tag| tag.to_str().ok())
            .map(str::to_owned);
        let json = response.bytes().map_err(FetchDocsError::Body)?.to_vec();
        Ok(Fetched::Body { json, etag })
    }
}

/// Every documented class's prose in one payload, per the publisher's guide for tools that
/// bundle it.
const DOCS_URL: &str = "https://meta-api.leaguetoolkit.dev/v1/docs/all";

/// Whole-request budget. The payload is a few hundred kilobytes.
const FETCH_TIMEOUT: Duration = Duration::from_secs(30);

/// Budget for establishing the connection, separate from the download.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// The payload as it was fetched, byte for byte.
const DOCS_FILENAME: &str = "meta-docs.json";

/// The tag of that copy and when it was last checked.
const STAMP_FILENAME: &str = "meta-docs.stamp.json";

#[cfg(test)]
mod tests;
