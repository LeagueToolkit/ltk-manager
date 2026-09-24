//! The cached documentation and the conditional request that refreshes it.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use fs_err as fs;
use serde::{Deserialize, Serialize};

use crate::{MetaDocs, ParseDocsError};

/// How long a fetched copy is used before the documentation is requested again.
///
/// The documentation changes when a documentation pull request is merged, usually days apart,
/// and the publisher asks clients to cache responses.
pub const REFRESH_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

/// The result of one conditional request.
#[derive(Debug)]
pub enum Fetched {
    /// The published copy matches the cached one.
    Unchanged,
    /// A payload, and the tag identifying it.
    Body { json: Vec<u8>, etag: Option<String> },
}

/// Why the published documentation could not be fetched.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum FetchDocsError {
    /// The request failed or returned an error status.
    #[error("requesting {DOCS_URL}")]
    Request(#[source] reqwest::Error),

    /// The response body could not be read completely.
    #[error("reading the body of {DOCS_URL}")]
    Body(#[source] reqwest::Error),
}

/// A source of the published documentation.
pub trait FetchDocs {
    /// Fetch the documentation, unless `known` still matches the published tag.
    ///
    /// # Errors
    ///
    /// Fails when the publisher cannot be reached or returns an error - see
    /// [`FetchDocsError`].
    fn fetch(&self, known: Option<&str>) -> Result<Fetched, FetchDocsError>;
}

/// Why a refresh failed.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum RefreshError {
    /// The publisher could not be reached, or returned an error.
    #[error(transparent)]
    Fetch(#[from] FetchDocsError),

    /// The cache directory or the payload itself could not be written.
    #[error("writing the meta wiki documentation")]
    Write(#[from] std::io::Error),

    /// The response body is not documentation this build can parse.
    #[error("the meta wiki documentation that was served is not one this build reads")]
    Unusable(#[from] ParseDocsError),
}

/// The outcome of one refresh.
#[derive(Debug)]
pub enum Refresh {
    /// The cached copy was checked less than [`REFRESH_INTERVAL`] ago, so no request was sent.
    NotDue,
    /// The published copy matches the cached one.
    Unchanged,
    /// A new copy was installed.
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

    /// The cached documentation. `None` when none was fetched yet or the copy does not parse.
    #[must_use]
    pub fn load(&self) -> Option<MetaDocs> {
        let json = fs::read(self.docs_path()).ok()?;
        MetaDocs::parse(&json)
            .inspect_err(|e| tracing::warn!("Unreadable cached meta wiki documentation: {e}"))
            .ok()
    }

    /// Bring the cached documentation up to date with the published copy.
    ///
    /// **At most one request is sent per [`REFRESH_INTERVAL`]**, with the cached tag as
    /// `If-None-Match`, so an unchanged copy returns `304` and no body. A body is parsed before
    /// it is installed, and a body that does not parse leaves the cache and its tag unchanged.
    ///
    /// # Errors
    ///
    /// Fails when the documentation cannot be fetched, when the response is not documentation
    /// this build can parse, and when the cache cannot be written - see [`RefreshError`].
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

/// The cached copy's tag and the time of the last request.
///
/// A separate file, so the payload file stays identical to the published copy.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stamp {
    /// The entity tag the cached copy was served with.
    etag: Option<String>,
    /// Seconds since the Unix epoch.
    checked_at: u64,
}

impl Stamp {
    /// Whether a refresh at `now` sends a request.
    ///
    /// A clock set back before the last check counts as due, so a copy is never kept
    /// indefinitely.
    fn is_due(&self, now: SystemTime) -> bool {
        let checked = UNIX_EPOCH + Duration::from_secs(self.checked_at);
        now.duration_since(checked)
            .map_or(true, |elapsed| elapsed >= REFRESH_INTERVAL)
    }

    /// Best-effort. A missing stamp causes one extra request on the next refresh, so a write
    /// failure does not fail a refresh that already installed the payload.
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

/// The published documentation, fetched over HTTP.
///
/// Sends a conditional GET with the cached tag as `If-None-Match`. It does not check the body,
/// and the cache parses it.
#[derive(Debug)]
pub struct PublishedDocs {
    client: reqwest::blocking::Client,
}

impl PublishedDocs {
    /// A client that sends `user_agent` with every request.
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

/// All class documentation in one payload, the endpoint the API guide recommends for tools that
/// bundle it.
const DOCS_URL: &str = "https://meta-api.leaguetoolkit.dev/v1/docs/all";

/// Timeout for the whole request. The payload is a few hundred kilobytes.
const FETCH_TIMEOUT: Duration = Duration::from_secs(30);

/// Timeout for establishing the connection.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// The payload as fetched, unmodified.
const DOCS_FILENAME: &str = "meta-docs.json";

/// The tag of that copy and the time of the last check.
const STAMP_FILENAME: &str = "meta-docs.stamp.json";

#[cfg(test)]
mod tests;
