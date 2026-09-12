//! The cached copy of the published meta schema database.

use std::path::PathBuf;

use fs_err as fs;
use serde::{Deserialize, Serialize};

use super::{MetaSchema, MetaSchemaError, MetaSchemaVersion};
use crate::hashtables::HashtableCache;
use crate::problems::GameBuild;
use crate::utils::fs::atomic_write;

pub use ltk_mimir_cache::NoCacheDirError;

/// What one conditional fetch came back with.
#[derive(Debug)]
pub enum Fetched {
    /// The publisher's copy is the one already cached.
    Unchanged,
    /// A database, and the tag identifying it.
    Body { json: Vec<u8>, etag: Option<String> },
}

/// Why the published database could not be fetched.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum FetchDbError {
    /// The request never produced a usable response.
    #[error("requesting {DB_URL}")]
    Request(#[source] reqwest::Error),

    /// The response started and then stopped part-way through the body.
    #[error("reading the body of {DB_URL}")]
    Body(#[source] reqwest::Error),
}

/// Where the published database is read from.
pub trait FetchDb {
    /// Fetch it, unless `known` is still the tag the publisher serves.
    fn fetch(&self, known: Option<&str>) -> Result<Fetched, FetchDbError>;
}

/// Why a refresh could not leave the cache better than it found it.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum RefreshError {
    /// The publisher could not be reached, or did not answer.
    #[error(transparent)]
    Fetch(#[from] FetchDbError),

    /// The cache directory or the database itself could not be written.
    #[error("writing the meta schema database")]
    Write(#[from] std::io::Error),

    /// The body arrived and is not a database this build can read.
    #[error("the meta schema database that was served is not one this build reads")]
    Unusable(#[from] MetaSchemaError),
}

/// What one refresh run changed.
#[derive(Debug)]
pub struct MetaSchemaSyncReport {
    /// Whether this run replaced the cached database.
    pub installed: bool,
}

/// The cached meta schema database on this machine.
#[derive(Debug, Clone)]
pub struct MetaSchemaCache {
    dir: PathBuf,
}

impl MetaSchemaCache {
    /// The cache directory this machine keeps the database in.
    ///
    /// Derived from where the tables landed rather than resolved again, so the
    /// two cannot drift apart.
    ///
    /// # Errors
    ///
    /// Fails when no platform data directory can be determined.
    pub fn discover() -> Result<Self, NoCacheDirError> {
        let tables = HashtableCache::discover()
            .map_err(|_| NoCacheDirError)?
            .dir()
            .to_path_buf();
        let beside = tables.parent().ok_or(NoCacheDirError)?;
        Ok(Self::at(beside.join(CACHE_DIR)))
    }

    /// Use an explicit cache directory (tests, overrides).
    pub fn at(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    /// The directory the database is cached in.
    #[must_use]
    pub fn dir(&self) -> &std::path::Path {
        &self.dir
    }

    /// Bring the cached database up to date with the published one.
    ///
    /// **The body is parsed before it is installed, and a refused one leaves
    /// the tag alone.** Otherwise a truncated download replaces a copy that
    /// reads, and the next run asks with its tag and is told nothing moved.
    /// The write is atomic for the same reason, and a stamp is only written
    /// behind a database that landed whole.
    ///
    /// # Errors
    ///
    /// Fails when the database cannot be fetched, when what arrives is not a
    /// database this build reads, and when the cache cannot be written - see
    /// [`RefreshError`].
    pub fn refresh(&self, fetch: &dyn FetchDb) -> Result<MetaSchemaSyncReport, RefreshError> {
        let held = self.stamp();
        let Fetched::Body { json, etag } = fetch.fetch(held.as_ref().and_then(Stamp::tag))? else {
            return Ok(MetaSchemaSyncReport { installed: false });
        };

        let installed = MetaSchema::parse(&json)?;
        fs::create_dir_all(&self.dir)?;
        atomic_write(&self.db_path(), &json)?;
        Stamp {
            etag,
            generation: Some(installed.generation().to_owned()),
        }
        .write(&self.stamp_path());
        tracing::info!(
            "Installed the meta schema database of {}, describing {} classes up to build {}",
            installed.generation(),
            installed.class_count(),
            installed.latest()
        );
        /* Here rather than at the call sites, which cannot each be trusted to
        remember what a landed database makes stale. */
        super::invalidate();
        Ok(MetaSchemaSyncReport { installed: true })
    }

    /// The published database's version, when it is not the cached one.
    ///
    /// Installs nothing, like [`HashtableCache::check`]. Costs the body when it
    /// has moved, since the tag is the only exact signal the publisher gives.
    ///
    /// [`HashtableCache::check`]: crate::hashtables::HashtableCache::check
    ///
    /// # Errors
    ///
    /// Fails when the publisher cannot be reached - see [`RefreshError`].
    pub fn check(&self, fetch: &dyn FetchDb) -> Result<Option<MetaSchemaVersion>, RefreshError> {
        let held = self.stamp();
        let Fetched::Body { json, .. } = fetch.fetch(held.as_ref().and_then(Stamp::tag))? else {
            return Ok(None);
        };
        Ok(Some(MetaSchema::parse(&json)?.version()))
    }

    /// What the cached database is, as the publisher stamped it.
    ///
    /// Off the stamp rather than the database, so asking costs no parse.
    #[must_use]
    pub fn generation(&self) -> Option<String> {
        self.stamp()?.generation
    }

    /// The schema a check on `build` reads, preferring the cached copy.
    ///
    /// **A cached copy the game has outrun loses to one that covers `build`.**
    /// A database is silent past its newest revision, so reading it there would
    /// stand every check down while the shipped snapshot could still answer.
    ///
    /// A cache that is missing or damaged falls back to
    /// [`MetaSchema::shipped`], never an error.
    #[must_use]
    pub fn load(&self, build: Option<GameBuild>) -> MetaSchema {
        let Ok(json) = fs::read(self.db_path()) else {
            return MetaSchema::shipped();
        };

        if let Some(build) = build
            && !covers(&json, build)
        {
            let shipped = MetaSchema::shipped();
            if shipped.describes(build) {
                tracing::debug!(
                    "The cached meta schema database does not describe build {build}, \
                     reading the shipped one instead"
                );
                return shipped;
            }
        }

        MetaSchema::parse(&json).unwrap_or_else(|e| {
            tracing::warn!("Unreadable cached meta schema database, using the shipped one: {e}");
            MetaSchema::shipped()
        })
    }

    fn db_path(&self) -> PathBuf {
        self.dir.join(DB_FILENAME)
    }

    fn stamp_path(&self) -> PathBuf {
        self.dir.join(STAMP_FILENAME)
    }

    fn stamp(&self) -> Option<Stamp> {
        let json = fs::read(self.stamp_path()).ok()?;
        serde_json::from_slice(&json).ok()
    }
}

/// What the cached database is, beside the database itself.
///
/// Its own file because the database is the publisher's copy byte for byte.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stamp {
    /// The entity tag the publisher served the cached copy under.
    etag: Option<String>,
    /// What that copy is, for [`MetaSchemaCache::generation`].
    #[serde(default)]
    generation: Option<String>,
}

impl Stamp {
    fn tag(&self) -> Option<&str> {
        self.etag.as_deref()
    }

    /// Best-effort: an unwritten stamp costs the next sync a download, which is
    /// not worth failing a refresh that has already installed the database.
    fn write(&self, path: &std::path::Path) {
        let stamped = serde_json::to_vec_pretty(self)
            .map_err(std::io::Error::from)
            .and_then(|json| atomic_write(path, &json));
        if let Err(e) = stamped {
            tracing::debug!("Could not stamp the meta schema cache: {e}");
        }
    }
}

/// Whether a published database in hand describes `build`.
///
/// Reads the head alone, so choosing between two copies does not parse the
/// loser. Bytes that are not the database cover nothing, and the full parse
/// below is what reports them.
fn covers(json: &[u8], build: GameBuild) -> bool {
    #[derive(Deserialize)]
    struct Head {
        latest: u32,
    }

    serde_json::from_slice::<Head>(json).is_ok_and(|head| build.content() <= head.latest)
}

/// The published database, over HTTP.
///
/// A conditional GET: the cached tag goes out as `If-None-Match`. Only a
/// transport - a body it hands back is still the cache's to find readable.
#[derive(Debug)]
pub struct PublishedDb {
    client: reqwest::blocking::Client,
}

impl PublishedDb {
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

impl FetchDb for PublishedDb {
    fn fetch(&self, known: Option<&str>) -> Result<Fetched, FetchDbError> {
        let mut request = self.client.get(DB_URL);
        if let Some(tag) = known {
            request = request.header(reqwest::header::IF_NONE_MATCH, tag);
        }

        let response = request
            .send()
            .and_then(reqwest::blocking::Response::error_for_status)
            .map_err(FetchDbError::Request)?;
        if response.status() == reqwest::StatusCode::NOT_MODIFIED {
            return Ok(Fetched::Unchanged);
        }

        let etag = response
            .headers()
            .get(reqwest::header::ETAG)
            .and_then(|tag| tag.to_str().ok())
            .map(str::to_owned);
        let json = response.bytes().map_err(FetchDbError::Body)?.to_vec();
        Ok(Fetched::Body { json, etag })
    }
}

/// Where the LTK Meta Wiki publishes the database.
const DB_URL: &str = "https://meta-api.leaguetoolkit.dev/v1/db";

/// Whole-request budget, well below the hashtables' - the body is under a
/// megabyte compressed.
const FETCH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

/// Budget for establishing the connection, separate from the download.
const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

/// The database's own directory beside the tables.
const CACHE_DIR: &str = "meta";

/// The database as it was fetched, byte for byte.
const DB_FILENAME: &str = "meta-schema.json";

/// The tag and generation of that copy.
const STAMP_FILENAME: &str = "meta-schema.stamp.json";

#[cfg(test)]
mod tests;
