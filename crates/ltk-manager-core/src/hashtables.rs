//! Status and sync for the shared mimir hashtable cache.
//!
//! The cache is one directory of versioned `.lhdb` tables plus a
//! `manifest.json`, shared by every mimir-backed tool on the machine. This
//! module reports what the cache holds, refreshes it from the published
//! GitHub release, and opens the WAD path tables for chunk resolution.

use std::fmt;
use std::io::{self, Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError};
use std::time::Duration;

use ltk_hash::BinHash;
use ltk_mimir_cache::{
    CheckError, CheckReport, Fetch, FetchError, HashStore, LockHolder, ManifestError,
    NoCacheDirError, PlannedTable, TableStatus, UpdateError, UpdateObserver, UpdateOptions,
    UpdateOutcome,
};
use ltk_wad::{PathResolver, WadHash};
use serde::Serialize;
use thiserror::Error;

use crate::error::{AppResult, MutexResultExt};
use crate::events::{BackendEvent, EventSink, HashtableSyncProgress};

pub use ltk_hashdb::{HashDb, LayeredHashDb, PathRef};
pub use ltk_mimir_cache::Table;

/// Download base for the published hashtable release assets.
const RELEASE_BASE_URL: &str = "https://github.com/LeagueToolkit/mimir/releases/latest/download";

/// The tables that name a WAD chunk, in the order a lookup consults them.
///
/// One hash universe, which is what lets them be layered at all.
const WAD_TABLES: [Table; 2] = [Table::Game, Table::Lcu];

/// Whole-request budget per asset. The largest tables are tens of megabytes,
/// so this allows even slow connections to finish one download.
const SYNC_TIMEOUT: Duration = Duration::from_secs(300);

/// Budget for establishing each connection, separate from the download itself.
const SYNC_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// Whole-request budget for the manifest a check reads.
///
/// Far below [`SYNC_TIMEOUT`] because the file is small and a check runs
/// unasked, where a request that hangs for minutes is worse than one that
/// gives up and says nothing.
const CHECK_TIMEOUT: Duration = Duration::from_secs(20);

/// Read size for a streaming download, so a table is a few hundred round trips.
const DOWNLOAD_CHUNK: usize = 64 * 1024;

/// How much of a run lands between progress events.
///
/// A full sync is over a hundred megabytes, so this is a hundred events across
/// it rather than one per chunk the transport delivers.
const PROGRESS_STEP: u64 = 1 << 20;

/// The one cache handle the app reads through, resolved on first use.
static SHARED: OnceLock<Option<HashtableCache>> = OnceLock::new();

/// Errors from reading or syncing the hashtable cache.
#[derive(Debug, Error)]
pub enum HashtableError {
    /// No platform cache directory could be resolved.
    #[error(transparent)]
    NoCacheDir(#[from] NoCacheDirError),

    /// The cache manifest exists but could not be read or parsed.
    #[error("hashtable cache manifest: {0}")]
    Manifest(#[from] ManifestError),

    /// Another process already holds the cache's update lock.
    #[error("{0} is already syncing the hashtables")]
    SyncLocked(SyncHolder),

    /// The HTTP client for a sync could not be built.
    #[error("hashtable sync client: {0}")]
    Http(#[from] reqwest::Error),

    /// A sync run failed while downloading, verifying, or installing tables.
    #[error("hashtable sync: {0}")]
    Sync(#[from] UpdateError<DownloadError>),

    /// The published release could not be compared against the cache.
    #[error("hashtable update check: {0}")]
    Check(#[from] CheckError<DownloadError>),
}

/// Why one release asset could not be fetched.
///
/// Two halves rather than one, because a request that never answered and a body
/// that stopped part-way are different things to tell a user.
#[derive(Debug, Error)]
pub enum DownloadError {
    /// The request never produced a usable response.
    #[error("requesting {url}")]
    Request {
        /// The asset URL that was asked for.
        url: String,
        #[source]
        source: reqwest::Error,
    },

    /// The response started and then stopped part-way through the body.
    #[error("reading the body of {url}")]
    Body {
        /// The asset URL that was being read.
        url: String,
        #[source]
        source: io::Error,
    },
}

/// Which process is syncing the cache, as far as the cache can say.
///
/// The lock records its holder, but that record can be unreadable while the lock
/// itself is plainly held, so the answer is allowed to be "someone".
#[derive(Debug, Clone)]
pub struct SyncHolder(Option<LockHolder>);

impl SyncHolder {
    /// A holder the cache could not put a name to.
    #[must_use]
    pub fn unknown() -> Self {
        Self(None)
    }
}

impl fmt::Display for SyncHolder {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.0 {
            Some(holder) => write!(
                f,
                "another process (pid {}, since {})",
                holder.pid, holder.since
            ),
            None => f.write_str("another process"),
        }
    }
}

/// One present table in a [`HashtableCacheStatus`].
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct HashtableStatus {
    /// Stable table id, e.g. `game`.
    pub id: String,
    /// Active `.lhdb` filename from the manifest.
    pub file: String,
    /// The release this table was published in, e.g. `2026-07-10`.
    ///
    /// Per table rather than per cache: a sync only installs what changed, so
    /// two tables in one cache can be of different vintages.
    pub version: String,
    /// Entry count recorded in the manifest.
    pub entries: u64,
    /// On-disk size of the active file, or 0 when it cannot be read.
    pub size_bytes: u64,
    /// Repository this table's inputs came from, e.g. `CommunityDragon/Data`.
    pub source_repo: Option<String>,
    /// Commit of that repository the inputs were taken at.
    pub source_commit: Option<String>,
}

/// What the shared hashtable cache currently holds.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct HashtableCacheStatus {
    /// Absolute cache directory.
    pub dir: String,
    /// Manifest generation time (RFC 3339), or `None` when the cache is empty.
    pub generated_at: Option<String>,
    /// Present tables, in [`Table::ALL`] order.
    pub tables: Vec<HashtableStatus>,
    /// Ids from [`Table::ALL`] absent from the manifest.
    pub missing: Vec<String>,
}

/// One table the published release has a version of that this cache does not.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct HashtableUpdate {
    /// Stable table id, e.g. `game`.
    pub id: String,
    /// The version the cache holds, absent when it holds none.
    pub have: Option<String>,
    /// The version the release publishes.
    pub want: String,
}

/// What a sync would install, asked without installing anything.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct HashtableUpdateCheck {
    /// True when a sync would install nothing.
    pub up_to_date: bool,
    /// The tables a sync would download, in manifest order.
    pub behind: Vec<HashtableUpdate>,
    /// How many bytes those add up to, absent against a release that recorded
    /// no sizes.
    pub download_bytes: Option<u64>,
    /// Remote table ids this build does not know. A sync skips them.
    pub unknown_tables: Vec<String>,
    /// Ids published in a `.hashdb` format this build cannot open. Named apart
    /// from [`behind`](Self::behind) because syncing cannot install them, so
    /// counting them as pending updates would promise a fix that is not there.
    pub unsupported_tables: Vec<String>,
}

impl From<CheckReport> for HashtableUpdateCheck {
    fn from(report: CheckReport) -> Self {
        Self {
            up_to_date: report.is_up_to_date(),
            download_bytes: report.download_bytes(),
            behind: report
                .tables
                .iter()
                .filter(|diff| diff.status.needs_update())
                .map(|diff| HashtableUpdate {
                    id: diff.table.id().to_owned(),
                    have: diff.local.as_ref().map(|local| local.version.clone()),
                    want: diff.remote.version.clone(),
                })
                .collect(),
            unsupported_tables: report
                .tables
                .iter()
                .filter(|diff| diff.status == TableStatus::Unsupported)
                .map(|diff| diff.table.id().to_owned())
                .collect(),
            unknown_tables: report.unknown_tables,
        }
    }
}

/// What a completed sync run changed.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct HashtableSyncReport {
    /// True when nothing needed installing.
    pub up_to_date: bool,
    /// Ids of the tables installed by this run.
    pub installed: Vec<String>,
    /// Remote table ids this build does not know. Skipped, never fatal.
    pub unknown_tables: Vec<String>,
    /// Ids published in a `.hashdb` format this build cannot open. Skipped, so
    /// the cache keeps serving what it already holds and only a newer app can
    /// install these.
    pub unsupported_tables: Vec<String>,
}

/// The shared mimir hashtable cache on this machine.
#[derive(Debug, Clone)]
pub struct HashtableCache {
    store: HashStore,
}

impl HashtableCache {
    /// Resolve the platform cache directory without touching the filesystem.
    ///
    /// # Errors
    ///
    /// Fails with [`HashtableError::NoCacheDir`] when no platform data
    /// directory can be determined.
    pub fn discover() -> Result<Self, HashtableError> {
        Ok(Self {
            store: HashStore::discover()?,
        })
    }

    /// The handle every feature of the app reads the cache through.
    ///
    /// One handle is one register of open tables, so a table two features both
    /// want is mapped once between them and the frames it decompresses are
    /// cached for both. [`discover`](Self::discover) opens its own register,
    /// which is what a test wants and what a feature does not.
    ///
    /// # Errors
    ///
    /// Fails with [`HashtableError::NoCacheDir`] when no platform data
    /// directory can be determined, settled once on the first call.
    pub fn shared() -> Result<Self, HashtableError> {
        SHARED
            .get_or_init(|| Self::discover().ok())
            .clone()
            // The error carries nothing, so naming it again loses nothing over
            // holding a copy of the one the first call built.
            .ok_or(HashtableError::NoCacheDir(NoCacheDirError))
    }

    /// Use an explicit cache directory (tests, overrides).
    pub fn at(dir: impl Into<PathBuf>) -> Self {
        Self {
            store: HashStore::at(dir),
        }
    }

    /// Report the manifest's view of the cache plus on-disk file sizes.
    ///
    /// A cache that was never populated is not an error: the report then has
    /// no `generated_at` and lists every table as missing.
    ///
    /// # Errors
    ///
    /// Fails with [`HashtableError::Manifest`] when a manifest exists but
    /// cannot be read or parsed.
    pub fn status(&self) -> Result<HashtableCacheStatus, HashtableError> {
        let manifest = match self.store.manifest() {
            Ok(manifest) => Some(manifest),
            Err(ManifestError::Missing(_)) => None,
            Err(e) => return Err(e.into()),
        };

        let mut tables = Vec::new();
        let mut missing = Vec::new();
        for &table in Table::ALL {
            let Some(entry) = manifest.as_ref().and_then(|m| m.entry(table)) else {
                missing.push(table.id().to_owned());
                continue;
            };
            let size_bytes = std::fs::metadata(self.store.dir().join(&entry.file))
                .map(|m| m.len())
                .unwrap_or(0);
            tables.push(HashtableStatus {
                id: table.id().to_owned(),
                file: entry.file.clone(),
                version: entry.version.clone(),
                entries: entry.entries,
                size_bytes,
                source_repo: entry.source.as_ref().and_then(|s| s.repo.clone()),
                source_commit: entry.source.as_ref().and_then(|s| s.commit.clone()),
            });
        }

        Ok(HashtableCacheStatus {
            dir: self.store.dir().display().to_string(),
            generated_at: manifest.as_ref().map(|m| m.generated_at.clone()),
            tables,
            missing,
        })
    }

    /// Bring the cache up to date with the latest published release.
    ///
    /// Emits [`BackendEvent::HashtableSyncProgress`] through `events` as the
    /// tables stream in, counting the run rather than each file, so a reader
    /// can draw one bar for the whole sync. `force` reinstalls every table
    /// even when the local copy already matches.
    ///
    /// The run's shape comes from mimir's own plan rather than from a check
    /// this makes first, so the count cannot disagree with what is downloaded.
    ///
    /// # Errors
    ///
    /// Fails with [`HashtableError::SyncLocked`] when another process is
    /// already syncing, and with [`HashtableError::Sync`] when a download,
    /// checksum, or install step fails.
    pub fn sync(
        &self,
        force: bool,
        user_agent: &str,
        events: &dyn EventSink,
    ) -> Result<HashtableSyncReport, HashtableError> {
        let fetch = ReleaseFetch::new(Self::client(user_agent, SYNC_TIMEOUT)?);
        let progress = SyncProgress::new(events);

        let mut options = UpdateOptions::default().observed_by(&progress);
        options.force = force;

        match self.store.update(&fetch, options)? {
            UpdateOutcome::Locked => Err(HashtableError::SyncLocked(self.sync_holder())),
            UpdateOutcome::Completed(report) => {
                for table in &report.unsupported_tables {
                    tracing::warn!(
                        "Hashtable `{}` is published in .hashdb format {}, which this build \
                         cannot open. Keeping the version already in the cache.",
                        table.table,
                        table.format_version
                    );
                }
                for path in &report.gc.retained {
                    tracing::debug!(
                        "Superseded table still in use, left for a later sync: {}",
                        path.display()
                    );
                }

                Ok(HashtableSyncReport {
                    up_to_date: report.is_up_to_date(),
                    installed: report.installed.iter().map(|t| t.id().to_owned()).collect(),
                    unknown_tables: report.unknown_tables,
                    unsupported_tables: report
                        .unsupported_tables
                        .iter()
                        .map(|t| t.table.id().to_owned())
                        .collect(),
                })
            }
        }
    }

    /// Ask the published release what this cache is missing, changing neither.
    ///
    /// Reads the remote manifest and diffs it. Nothing is downloaded, nothing
    /// is installed, and the update lock is never taken, so this is safe on a
    /// timer and safe while another process is midway through a sync - which
    /// is the whole reason it is not [`sync`](Self::sync) with the installing
    /// switched off.
    ///
    /// # Errors
    ///
    /// Fails with [`HashtableError::Http`] when the client cannot be built and
    /// with [`HashtableError::Check`] when the remote manifest cannot be
    /// fetched or either manifest cannot be read. A cache that was never
    /// populated is not an error: every table comes back in
    /// [`behind`](HashtableUpdateCheck::behind).
    pub fn check(&self, user_agent: &str) -> Result<HashtableUpdateCheck, HashtableError> {
        let fetch = ReleaseFetch::new(Self::client(user_agent, CHECK_TIMEOUT)?);
        Ok(self.store.check(&fetch)?.into())
    }

    /// Who is syncing, for the error that says someone already is.
    fn sync_holder(&self) -> SyncHolder {
        SyncHolder(self.store.lock_holder().ok().flatten())
    }

    /// The HTTP client both release calls talk to GitHub through.
    fn client(
        user_agent: &str,
        timeout: Duration,
    ) -> Result<reqwest::blocking::Client, reqwest::Error> {
        reqwest::blocking::Client::builder()
            .user_agent(user_agent)
            .timeout(timeout)
            .connect_timeout(SYNC_CONNECT_TIMEOUT)
            .build()
    }

    /// Open the `game` and `lcu` tables layered for WAD chunk resolution.
    ///
    /// Best-effort by design: tables absent from the cache are logged at debug
    /// and skipped, so their hashes simply miss.
    ///
    /// # Panics
    ///
    /// Panics if `WAD_TABLES` ever names two hash universes, which is the one
    /// way a layered lookup can answer confidently and wrongly.
    pub fn wad_tables(&self) -> LayeredHashDb {
        let (db, errors) = self
            .store
            .open_layered(&WAD_TABLES)
            .expect("`game` and `lcu` are two halves of one WAD path space");
        for (table, e) in errors {
            tracing::debug!("Hashtable `{table}` unavailable: {e}");
        }
        db
    }

    /// The same tables as [`wad_tables`](Self::wad_tables), as a resolver.
    pub fn wad_path_resolver(&self) -> WadPathResolver {
        WadPathResolver::new(self.wad_tables())
    }

    /// Open the four tables that name what a bin addresses by hash.
    ///
    /// Best-effort in the same way [`wad_tables`](Self::wad_tables) is: a table
    /// absent from the cache is logged at debug and its hashes simply miss.
    pub fn bin_tables(&self) -> BinHashTables {
        let mut tables = BinHashTables::default();
        for table in BinHashTables::TABLES {
            match self.store.open_shared(table) {
                Ok(db) => tables.put(table, db),
                Err(e) => tracing::debug!("Hashtable `{table}` unavailable: {e}"),
            }
        }
        tables
    }

    /// Every stringtable field name the `rst-xxh3` table holds, with its hash.
    ///
    /// Alphabetical, which is the order the table stores its strings in.
    ///
    /// Best-effort in the same way [`wad_tables`](Self::wad_tables) is: a cache
    /// the table is absent from names nothing, and the caller's index is empty
    /// rather than an error.
    #[must_use]
    pub fn string_keys(&self) -> Vec<(u64, String)> {
        match self.store.open_shared(Table::RstXxh3) {
            Ok(db) => {
                let mut keys = Vec::with_capacity(db.len());
                keys.extend(db.iter().map(|(hash, key)| (hash, key.into_owned())));
                keys
            }
            Err(e) => {
                tracing::debug!("Hashtable `{}` unavailable: {e}", Table::RstXxh3);
                Vec::new()
            }
        }
    }
}

/// Streams release assets into the cache.
///
/// A [`Fetch`] built from a closure can only hand back a whole asset, which
/// means a 38 MiB table in memory and then a copy into place. Writing into the
/// sink mimir supplies puts those bytes straight into the file it will install.
///
/// Only a transport: progress is [`SyncProgress`]'s job, because
/// [`fetch_to`](Fetch::fetch_to) is handed one filename at a time and never
/// learns how many follow.
struct ReleaseFetch {
    client: reqwest::blocking::Client,
}

impl ReleaseFetch {
    fn new(client: reqwest::blocking::Client) -> Self {
        Self { client }
    }
}

impl Fetch for ReleaseFetch {
    type Error = DownloadError;

    fn fetch_to(
        &self,
        filename: &str,
        sink: &mut (dyn Write + Send),
    ) -> Result<u64, FetchError<DownloadError>> {
        let url = format!("{RELEASE_BASE_URL}/{filename}");
        let request = |source| {
            FetchError::Transport(DownloadError::Request {
                url: url.clone(),
                source,
            })
        };

        let mut response = self
            .client
            .get(&url)
            .send()
            .map_err(request)?
            .error_for_status()
            .map_err(request)?;

        let mut buf = vec![0u8; DOWNLOAD_CHUNK];
        let mut written = 0;
        loop {
            let read = response.read(&mut buf).map_err(|source| {
                FetchError::Transport(DownloadError::Body {
                    url: url.clone(),
                    source,
                })
            })?;
            if read == 0 {
                return Ok(written);
            }

            sink.write_all(&buf[..read]).map_err(FetchError::Sink)?;
            written += read as u64;
        }
    }
}

/// Turns an update run into [`BackendEvent::HashtableSyncProgress`].
///
/// The run hands over its plan before it opens a connection, so every event
/// describes the whole sync - which table of how many, and how far through its
/// bytes - rather than the file in flight. Throttled to [`PROGRESS_STEP`],
/// because the run reports every chunk its transport delivers.
struct SyncProgress<'a> {
    events: &'a dyn EventSink,
    run: Mutex<Run>,
}

/// What the run has fetched so far, as the observer's callbacks fold it in.
#[derive(Default)]
struct Run {
    /// Tables the run will download.
    tables: u32,

    /// Tables it has finished.
    finished: u32,

    /// Bytes the whole run writes, `None` against a release that recorded no
    /// sizes - which is the reader's cue to draw a bar with no end.
    total_bytes: Option<u64>,

    /// Bytes of the tables already finished, so a per-table count folds into a
    /// run-wide one.
    done_bytes: u64,

    /// Bytes of the table streaming now, kept to fold into `done_bytes` when
    /// it lands.
    current_bytes: u64,

    /// Run bytes at the last event, for the throttle.
    announced: u64,
}

impl<'a> SyncProgress<'a> {
    fn new(events: &'a dyn EventSink) -> Self {
        Self {
            events,
            run: Mutex::new(Run::default()),
        }
    }

    /// A poisoned counter is not worth failing a sync over: the state is
    /// tallies, and the worst a stale one costs is a mis-drawn bar.
    fn run(&self) -> MutexGuard<'_, Run> {
        self.run.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The event for where the run stands, with `table` the one in flight.
    fn event(run: &Run, table: Table) -> HashtableSyncProgress {
        HashtableSyncProgress {
            table: table.id().to_owned(),
            current: run.finished + 1,
            total: run.tables,
            downloaded: run.done_bytes + run.current_bytes,
            total_bytes: run.total_bytes,
        }
    }
}

impl UpdateObserver for SyncProgress<'_> {
    fn planned(&self, tables: &[PlannedTable]) {
        let mut run = self.run();
        run.tables = tables.len() as u32;
        // `Option` sums to `None` if any table is missing a size, which is what
        // a release published before the field existed looks like.
        run.total_bytes = tables.iter().map(|table| table.size_bytes).sum();
    }

    fn progressed(&self, table: Table, done: u64, _total: Option<u64>) {
        let mut run = self.run();
        run.current_bytes = done;

        // The zero-byte call opens a table, and is worth an event whatever the
        // throttle says: it is what names the table now in flight.
        let run_bytes = run.done_bytes + done;
        if done != 0 && run_bytes - run.announced < PROGRESS_STEP {
            return;
        }
        run.announced = run_bytes;

        let event = Self::event(&run, table);
        drop(run);
        self.events.emit(BackendEvent::HashtableSyncProgress(event));
    }

    fn downloaded(&self, table: Table) {
        let mut run = self.run();
        run.done_bytes += run.current_bytes;
        run.current_bytes = 0;

        /* The boundary event, so a table whose tail was shorter than a step
        still leaves the bar where that table ends. Built before `finished`
        moves on, because the table this names is the one that just landed,
        and skipped when the throttle happened to land on the boundary itself. */
        let mut event = None;
        if run.announced != run.done_bytes {
            run.announced = run.done_bytes;
            event = Some(Self::event(&run, table));
        }
        run.finished += 1;
        drop(run);

        if let Some(event) = event {
            self.events.emit(BackendEvent::HashtableSyncProgress(event));
        }
    }
}

/// The four tables that name what a bin addresses by hash.
///
/// **Each is its own universe of `FNV1a32` keys and is queried on its own.**
/// Layering them into one lookup the way the WAD tables are layered would be
/// wrong: `game` and `lcu` are two halves of one WAD path space, while these
/// four hash four unrelated kinds of string into 32 bits. Across half a million
/// rows a shared lookup would answer a property hash with an object's path
/// often enough to be a certainty rather than a risk, and a wrong name is worse
/// than a number. `HashUniverse` is where mimir writes that down, and
/// `open_layered` refuses a set that spans two of them.
#[derive(Default)]
pub struct BinHashTables {
    /// `binentries` - an object's path.
    entries: Option<HashDb>,
    /// `bintypes` - a class.
    types: Option<HashDb>,
    /// `binfields` - a property.
    fields: Option<HashDb>,
    /// `binhashes` - the string behind a `Hash` value.
    hashes: Option<HashDb>,
}

impl BinHashTables {
    /// The tables this opens, and the only ones it knows where to put.
    const TABLES: [Table; 4] = [
        Table::BinEntries,
        Table::BinTypes,
        Table::BinFields,
        Table::BinHashes,
    ];

    fn put(&mut self, table: Table, db: HashDb) {
        match table {
            Table::BinEntries => self.entries = Some(db),
            Table::BinTypes => self.types = Some(db),
            Table::BinFields => self.fields = Some(db),
            Table::BinHashes => self.hashes = Some(db),
            other => tracing::debug!("`{}` is not a bin hash table", other.id()),
        }
    }

    /// The path of an object, out of `binentries`.
    #[must_use]
    pub fn entry(&self, hash: BinHash) -> Option<String> {
        Self::read(self.entries.as_ref(), hash)
    }

    /// The name of a class, out of `bintypes`.
    #[must_use]
    pub fn class(&self, hash: BinHash) -> Option<String> {
        Self::read(self.types.as_ref(), hash)
    }

    /// The name of a property, out of `binfields`.
    #[must_use]
    pub fn field(&self, hash: BinHash) -> Option<String> {
        Self::read(self.fields.as_ref(), hash)
    }

    /// The string behind a `Hash` value, out of `binhashes`.
    #[must_use]
    pub fn value(&self, hash: BinHash) -> Option<String> {
        Self::read(self.hashes.as_ref(), hash)
    }

    /// Owned, because a [`PathRef`] holds the frame it was read out of open,
    /// and every caller here keeps its name for a row it draws later.
    fn read(db: Option<&HashDb>, hash: BinHash) -> Option<String> {
        Some(db?.get(u64::from(hash.0))?.into_owned())
    }
}

impl fmt::Debug for BinHashTables {
    /// These hold hundreds of thousands of rows between them and print none.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("BinHashTables")
            .field("entries", &self.entries.is_some())
            .field("types", &self.types.is_some())
            .field("fields", &self.fields.is_some())
            .field("hashes", &self.hashes.is_some())
            .finish()
    }
}

/// Names WAD chunks from the shared mimir tables when extracting an archive.
///
/// A hash no table knows resolves to `None`, and the extractor writes that
/// chunk under its hex hash. So extraction names what it can and never fails
/// for want of a table.
#[derive(Debug)]
pub struct WadPathResolver {
    db: LayeredHashDb,

    /// Whether the damage warning has gone out, so a run over a hundred
    /// archives says it once.
    reported_damage: AtomicBool,
}

impl WadPathResolver {
    /// Open the shared cache's WAD tables.
    ///
    /// Best-effort: a machine whose cache is missing or never synced resolves
    /// nothing, and every chunk lands under its hex name.
    pub fn discover() -> Self {
        let db = match HashtableCache::shared() {
            Ok(cache) => cache.wad_tables(),
            Err(e) => {
                tracing::warn!("No hashtable cache to name WAD chunks with: {e}");
                LayeredHashDb::new()
            }
        };

        if db.bases().is_empty() {
            tracing::warn!("No hashtables loaded, WAD chunks will keep their hex names");
        }

        Self::new(db)
    }

    /// Resolve through tables the caller already opened.
    pub fn new(db: LayeredHashDb) -> Self {
        Self {
            db,
            reported_damage: AtomicBool::new(false),
        }
    }

    /// Name every chunk of one archive in a single pass over the tables.
    ///
    /// Calls `name` once per entry of `hashes`, with `None` where no table
    /// holds one. One call per archive rather than one per chunk, so the
    /// compressed frames an archive's paths share decompress once between them
    /// instead of once per name, and a name the caller only reads never
    /// becomes a `String`.
    ///
    /// The calls arrive in the order the tables hold the paths, which is what
    /// lets each frame decompress once, and hashes nothing names arrive last.
    /// The first argument is the hash's index in `hashes`, so a caller that
    /// needs the order it asked in reads that rather than the call order.
    pub fn resolve_each(&self, hashes: &[WadHash], mut name: impl FnMut(usize, Option<&str>)) {
        let keys: Vec<u64> = hashes.iter().map(|hash| hash.0).collect();
        self.db
            .for_each_batch(&keys, |index, _, path| name(index, path));
        self.report_damage();
    }

    /// The tables behind the resolver, for callers that read them directly.
    #[must_use]
    pub fn tables(&self) -> &LayeredHashDb {
        &self.db
    }

    /// Say once that a table stopped reading cleanly, which is the difference
    /// between a chunk nobody has named and one this machine can no longer read
    /// the name of.
    fn report_damage(&self) {
        if self.db.is_healthy() || self.reported_damage.swap(true, Ordering::Relaxed) {
            return;
        }

        tracing::warn!(
            "A hashtable stopped reading cleanly, so some chunks will keep their hex names. \
             Re-sync the hashtables to replace it."
        );
    }
}

/// Lazily-opened, app-managed [`WadPathResolver`] over the shared cache.
///
/// Opening the tables reads the manifest, maps two files and parses their seek
/// tables, which every browser action would otherwise repeat. A sync writes new
/// files under new names, so it ends with [`invalidate`](Self::invalidate) and
/// the next caller opens what it wrote.
#[derive(Debug, Default)]
pub struct WadPathResolverState(Mutex<Option<Arc<WadPathResolver>>>);

impl WadPathResolverState {
    /// The resolver, opening the tables on the first call.
    ///
    /// # Errors
    ///
    /// Fails when a previous holder of the lock panicked. Absent tables are not
    /// an error, because [`WadPathResolver::discover`] names nothing instead.
    pub fn get(&self) -> AppResult<Arc<WadPathResolver>> {
        let mut slot = self.0.lock().mutex_err()?;
        if let Some(resolver) = slot.as_ref() {
            return Ok(Arc::clone(resolver));
        }

        let resolver = Arc::new(WadPathResolver::discover());
        *slot = Some(Arc::clone(&resolver));
        Ok(resolver)
    }

    /// Drop the open tables, so the next caller opens what a sync just wrote.
    ///
    /// Readers already holding the old handle keep reading the old files, which
    /// stay on disk until a later sync's collection sweeps them.
    pub fn invalidate(&self) {
        match self.0.lock() {
            Ok(mut slot) => *slot = None,
            Err(_) => tracing::warn!("Hashtable handle lock poisoned, keeping the open tables"),
        }
    }
}

impl PathResolver for WadPathResolver {
    fn resolve(&self, path_hash: WadHash) -> Option<String> {
        self.db.get(path_hash.0).map(|path| path.into_owned())
    }

    /// Answered without building the string the chunk's name would need.
    fn is_known(&self, path_hash: WadHash) -> bool {
        self.db.contains(path_hash.0)
    }

    /// The whole archive in one pass over the tables, through
    /// [`resolve_each`](Self::resolve_each).
    fn resolve_all(&self, path_hashes: &[WadHash]) -> Vec<Option<String>> {
        let mut resolved = vec![None; path_hashes.len()];
        self.resolve_each(path_hashes, |index, path| {
            resolved[index] = path.map(String::from);
        });
        resolved
    }
}

#[cfg(test)]
mod tests;
