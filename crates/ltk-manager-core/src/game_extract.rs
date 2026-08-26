//! Writing chunks of the installed game's archives out to a folder on disk.
//!
//! The browser's second output, beside a copy into a layer. It reads the same
//! rows the tree shows - a file, a directory, a whole archive - expands them
//! into chunk hashes, groups those by the archive that holds them, and drives
//! [`ltk_wad::WadExtractor`] once per archive.
//!
//! The naming rules, the skip-or-replace policy and the parallel decompress
//! belong to `ltk_wad`. What lives here is everything the crate has no way to
//! know: which chunks a directory row stands for, which archive each one comes
//! out of, that the destination must not be inside the League install, and how
//! to report progress to a UI without one event per chunk.

use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use camino::Utf8Path;
use ltk_file::LeagueFileKind;
use ltk_wad::{
    ExistingFilePolicy, ExtractLayout as WadExtractLayout, ExtractReport, NameRecovery,
    NamingPolicy, PathResolver, RecoveredNames, Wad, WadExtractor, WadHash,
};
use serde::{Deserialize, Serialize};

use crate::config::Config;
use crate::error::{AppError, AppResult};
use crate::events::{BackendEvent, EventSink, ExtractProgress};
use crate::game_index::GameIndex;
use crate::game_wads::GameArchives;
use crate::hashtables::WadPathResolver;
use crate::utils::game::GameDir;
use crate::workshop::WorkshopFileKind;

/// How often the run may emit an [`ExtractProgress`].
///
/// The extractor calls back once per chunk, which is 2,646 times for
/// `Aatrox.wad.client` and around 30,000 for `Map11`. A Tauri emit serialises
/// JSON per event, so a bar that updates ten times a second costs nothing and
/// one that updates thirty thousand times costs more than the extraction.
const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

/// One row of the browser, as a thing to extract.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
pub enum ExtractTarget {
    /// One chunk, as a file row of the browser holds it.
    ///
    /// `path_hash` is what gets extracted. `path` and `size_bytes` are the
    /// row's own copy, and only shape the summary and the kind filter, so a
    /// stale row costs an off-by-one in a count rather than the wrong bytes.
    File {
        wad: String,
        path_hash: String,
        path: Option<String>,
        /* The tree holds this as a JS number, and a chunk size never reaches
        the range where that loses a digit. Binding it as `bigint` would only
        make every call site build one that `JSON.stringify` then refuses. */
        #[cfg_attr(feature = "ts", ts(type = "number"))]
        size_bytes: u64,
    },
    /// Every file at or below one directory of the folded index.
    Dir { path: String },
    /// Every chunk of one archive.
    ///
    /// Read out of the archive rather than out of the index, because the fold
    /// keeps one copy of a chunk that several archives carry and drops the
    /// rest. An archive row means the archive, not the part of it the index
    /// happens to attribute to it.
    Archive { wad: String },
}

/// Where each file of an extract lands under the destination.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub enum ExtractLayout {
    /// Each file at its game path, which is what a repack reads back.
    #[default]
    Paths,
    /// Every file in the destination by its name alone.
    Flat,
}

impl From<ExtractLayout> for WadExtractLayout {
    fn from(value: ExtractLayout) -> Self {
        match value {
            ExtractLayout::Paths => Self::Paths,
            ExtractLayout::Flat => Self::Flat,
        }
    }
}

/// What an extract does about a file already sitting where one would land.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub enum ExistingFiles {
    /// Leave it, and count it. The dialog's default, and not the crate's.
    #[default]
    Skip,
    /// Write over it.
    Replace,
}

impl From<ExistingFiles> for ExistingFilePolicy {
    fn from(value: ExistingFiles) -> Self {
        match value {
            ExistingFiles::Skip => Self::Skip,
            ExistingFiles::Replace => Self::Overwrite,
        }
    }
}

/// Everything one extract needs beyond the targets themselves.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct ExtractOptions {
    /// The folder to write into. Made if it is not there.
    pub destination: String,
    #[serde(default)]
    pub layout: ExtractLayout,
    /// Put each archive's files under a folder of the archive's own name,
    /// which is the layout a layer holds.
    #[serde(default)]
    pub per_archive_folder: bool,
    #[serde(default)]
    pub existing: ExistingFiles,
    /// Read the archive's own bins for names no hash table holds.
    ///
    /// Off, because a synced cache already names a game archive, and the scan
    /// reads every bin in one to find the handful it does not. Worth its cost
    /// where the cache is missing and the bins are the only names there are.
    #[serde(default)]
    pub recover_names: bool,
    /// The browser's filter chips. `None` writes every kind.
    #[serde(default)]
    pub kinds: Option<Vec<WorkshopFileKind>>,
}

/// What an extract will write, before it writes anything.
///
/// The dialog's summary line reads this, so a user sees the count, the size
/// and the archives before choosing a destination.
#[derive(Debug, Clone, Default, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct ExtractPlan {
    pub files: u32,
    /// Uncompressed bytes, which is what lands on disk.
    pub bytes: u64,
    /// The `DATA/FINAL`-relative archives the run reads, in the order it does.
    pub archives: Vec<String>,
}

/// One kind of file an extract wrote, and how many.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct ExtractKindCount {
    pub kind: WorkshopFileKind,
    pub count: u32,
}

/// What an extract did, summed over every archive it read.
#[derive(Debug, Clone, Default, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct ExtractSummary {
    pub extracted: u32,
    pub skipped_existing: u32,
    pub skipped_by_filter: u32,
    /// Chunks the index named that the archive turned out not to hold, which
    /// means the two disagree rather than that anything failed.
    pub missing: u32,
    pub bytes_written: u64,
    /// Written files by the kind their bytes identify as, most first.
    pub by_kind: Vec<ExtractKindCount>,
    /// The cancel flag was set, so this is a part of what was asked for.
    pub cancelled: bool,
    /// Names the archives' own bins gave chunks no hash table knew.
    pub recovered: u32,
    /// Chunks written under a name their resolved path did not give, because a
    /// directory held that name or another chunk claimed it first.
    pub renamed: u32,
    /// Chunks whose resolved path the extraction refused to write, so nothing
    /// landed for them. A hash table naming a path that escapes the output
    /// directory is the usual cause.
    pub rejected: u32,
    /// Chunks another chunk's path claimed first that went unwritten. Zero
    /// under a lossless naming policy, which renames them instead.
    pub duplicates: u32,
    /// The folder written into, for the report's **Open folder**.
    pub destination: String,
}

/// One archive's share of an extract.
#[derive(Debug)]
struct ArchiveWork {
    /// `DATA/FINAL`-relative name, as [`GameArchives::list`] gives it.
    wad: String,
    /// Chunks a hash table names, already past the kind filter.
    named: Vec<WadHash>,
    /// Chunks nothing names, which only their own bytes can be filtered by.
    unnamed: Vec<WadHash>,
}

impl ArchiveWork {
    fn len(&self) -> usize {
        self.named.len() + self.unnamed.len()
    }
}

/// The targets of one extract, expanded and grouped by archive.
#[derive(Debug, Default)]
pub struct ExtractJob {
    archives: Vec<ArchiveWork>,
    files: u32,
    bytes: u64,
}

impl ExtractJob {
    /// Expand `targets` into the chunks each archive owes, in archive order.
    ///
    /// A [`Dir`](ExtractTarget::Dir) row expands through the index, and an
    /// [`Archive`](ExtractTarget::Archive) row through the archive's own chunk
    /// table, which costs a header and a table read. A chunk named twice - once
    /// on its own row and once under a directory - is extracted once.
    ///
    /// # Errors
    ///
    /// Fails with [`AppError::InvalidPath`] when a target names a directory the
    /// index does not hold or a hash that is not sixteen hex digits, and with
    /// I/O or WAD errors when an archive row's archive cannot be read.
    pub fn plan(
        targets: &[ExtractTarget],
        kinds: Option<&[WorkshopFileKind]>,
        index: &GameIndex,
        archives: &GameArchives,
        resolver: &WadPathResolver,
    ) -> AppResult<Self> {
        let kinds: Option<HashSet<WorkshopFileKind>> =
            kinds.map(|kinds| kinds.iter().copied().collect());

        /* Grouped by archive rather than gathered flat: the run mounts each
        archive once, and a `BTreeMap` also settles the order the dialog lists
        them in and the run reads them in. */
        let mut grouped: BTreeMap<String, ArchiveChunks> = BTreeMap::new();
        let mut job = Self::default();

        for target in targets {
            match target {
                ExtractTarget::File {
                    wad,
                    path_hash,
                    path,
                    size_bytes,
                } => {
                    let hash = parse_hash(path_hash)?;
                    grouped.entry(wad.clone()).or_default().push(
                        hash,
                        path.as_deref(),
                        *size_bytes,
                        kinds.as_ref(),
                        &mut job,
                    );
                }
                ExtractTarget::Dir { path } => {
                    let files = index.files_under(path).ok_or_else(|| {
                        AppError::InvalidPath(format!(
                            "No such directory in the game index: {path}"
                        ))
                    })?;
                    for file in files {
                        let hash = parse_hash(&file.path_hash)?;
                        grouped.entry(file.wad).or_default().push(
                            hash,
                            file.path.as_deref(),
                            file.size_bytes,
                            kinds.as_ref(),
                            &mut job,
                        );
                    }
                }
                ExtractTarget::Archive { wad } => {
                    let entry = grouped.entry(wad.clone()).or_default();
                    let path = archives.archive_path(wad)?;
                    let archive = Wad::mount(BufReader::new(fs::File::open(&path)?))?;
                    let chunks = archive.chunks().as_slice();
                    let hashes: Vec<WadHash> =
                        chunks.iter().map(|chunk| chunk.path_hash()).collect();
                    resolver.resolve_each(&hashes, |index, name| {
                        let chunk = &chunks[index];
                        entry.push(
                            chunk.path_hash(),
                            name,
                            chunk.uncompressed_size() as u64,
                            kinds.as_ref(),
                            &mut job,
                        );
                    });
                }
            }
        }

        job.archives = grouped
            .into_iter()
            .map(|(wad, chunks)| ArchiveWork {
                wad,
                named: chunks.named,
                unnamed: chunks.unnamed,
            })
            .filter(|work| work.len() > 0)
            .collect();
        Ok(job)
    }

    /// What this job will write, for the dialog's summary line.
    #[must_use]
    pub fn summary(&self) -> ExtractPlan {
        ExtractPlan {
            files: self.files,
            bytes: self.bytes,
            archives: self.archives.iter().map(|w| w.wad.clone()).collect(),
        }
    }

    /// Whether the job would write nothing at all.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.files == 0
    }

    /// Extract every chunk of the job, one archive at a time.
    ///
    /// Each archive is mounted for the run and dropped after it. The
    /// [`WadCache`](crate::game_wads::WadCache) is deliberately not used: a
    /// mount is a header and a chunk table, milliseconds, where an extraction
    /// holding the cache's lock would block every preview of that archive for
    /// the seconds the run takes.
    ///
    /// One archive at a time, because each run already spreads over up to
    /// eight threads and the install sits on one disk.
    ///
    /// # Errors
    ///
    /// Fails with [`AppError::ValidationFailed`] when `destination` is inside
    /// the League install, with [`AppError::InvalidPath`] when it is not valid
    /// UTF-8, and with I/O or WAD errors from the archives themselves. The
    /// first failing chunk fails the run, and the files written before it stay.
    pub fn run(
        &self,
        options: &ExtractOptions,
        config: &Config,
        archives: &GameArchives,
        resolver: &WadPathResolver,
        events: &dyn EventSink,
        cancel: &AtomicBool,
    ) -> AppResult<ExtractSummary> {
        let destination = PathBuf::from(&options.destination);
        reject_the_install(config, &destination)?;
        fs::create_dir_all(&destination)?;

        let kinds: Option<Vec<LeagueFileKind>> = options.kinds.as_ref().map(|kinds| {
            kinds
                .iter()
                .copied()
                .map(LeagueFileKind::from)
                .collect::<Vec<_>>()
        });

        let mut state = RunState {
            done: 0,
            total: self.files,
            bytes: 0,
            last_emit: None,
        };
        let mut totals = ExtractReport::default();

        for work in &self.archives {
            let out_dir = if options.per_archive_folder {
                destination.join(archive_folder(&work.wad))
            } else {
                destination.clone()
            };
            let out_dir = Utf8Path::from_path(&out_dir)
                .ok_or_else(|| {
                    AppError::InvalidPath(format!(
                        "Extract destination is not valid UTF-8: {}",
                        out_dir.display()
                    ))
                })?
                .to_owned();

            let path = archives.archive_path(&work.wad)?;
            let mut archive = Wad::mount(BufReader::new(fs::File::open(&path)?))?;

            let recovered = if !options.recover_names || work.unnamed.is_empty() {
                RecoveredNames::default()
            } else {
                NameRecovery::new()
                    .with_cancel_flag(cancel)
                    .run(&mut archive, resolver)?
            };
            let resolver = recovered.over(resolver);

            /* Two runs when a kind filter is on and the archive holds chunks
            nothing names. The named ones were filtered by their extension when
            the job was planned, and only the bytes can say what an unnamed one
            is - which is what `with_type_filter` reads, and it reads it for
            every chunk it is given. */
            if !work.named.is_empty() {
                let report = self.extract_some(
                    &mut archive,
                    &work.named,
                    &out_dir,
                    &work.wad,
                    None,
                    options,
                    &resolver,
                    events,
                    cancel,
                    &mut state,
                )?;
                totals.merge(report);
            }
            if !work.unnamed.is_empty() {
                let report = self.extract_some(
                    &mut archive,
                    &work.unnamed,
                    &out_dir,
                    &work.wad,
                    kinds.as_deref(),
                    options,
                    &resolver,
                    events,
                    cancel,
                    &mut state,
                )?;
                totals.merge(report);
            }
            totals.recovered.merge(recovered);

            if cancel.load(Ordering::Relaxed) {
                totals.cancelled = true;
                break;
            }
        }

        if !totals.missing.is_empty() {
            tracing::warn!(
                missing = totals.missing.len(),
                "Extract asked for chunks the archives do not hold, so the index and the install disagree"
            );
        }

        Ok(ExtractSummary {
            extracted: totals.extracted as u32,
            skipped_existing: totals.skipped_existing as u32,
            skipped_by_filter: totals.skipped_by_filter as u32,
            missing: totals.missing.len() as u32,
            bytes_written: totals.bytes_written,
            by_kind: by_kind(&totals.by_kind),
            cancelled: totals.cancelled,
            recovered: totals.recovered.len() as u32,
            renamed: totals.renamed() as u32,
            rejected: totals.rejected() as u32,
            duplicates: totals.duplicates() as u32,
            destination: options.destination.clone(),
        })
    }

    /// One extractor run over one archive's share of the chunks.
    #[allow(clippy::too_many_arguments)]
    fn extract_some<S: std::io::Read + std::io::Seek>(
        &self,
        archive: &mut Wad<S>,
        hashes: &[WadHash],
        out_dir: &Utf8Path,
        wad: &str,
        kinds: Option<&[LeagueFileKind]>,
        options: &ExtractOptions,
        resolver: &dyn PathResolver,
        events: &dyn EventSink,
        cancel: &AtomicBool,
        state: &mut RunState,
    ) -> AppResult<ExtractReport> {
        let mut extractor = WadExtractor::new(resolver)
            .with_layout(options.layout.into())
            .with_naming_policy(NamingPolicy::Lossless)
            .with_existing_file_policy(options.existing.into())
            .with_cancel_flag(cancel)
            .on_progress(|progress| state.advance(wad, progress, events));

        if let Some(kinds) = kinds {
            extractor = extractor.with_type_filter(kinds.iter().copied());
        }

        Ok(extractor.extract_chunks(archive, hashes.iter().copied(), out_dir)?)
    }
}

/// The counters an emit reads, carried across every archive of one run.
struct RunState {
    done: u32,
    total: u32,
    bytes: u64,
    last_emit: Option<Instant>,
}

impl RunState {
    /// Count one finished chunk, and emit if the throttle allows it.
    ///
    /// Always emits the last chunk of the run, so a bar that stopped short of
    /// the end is a run that stopped short of the end.
    fn advance(
        &mut self,
        wad: &str,
        progress: &ltk_wad::ExtractProgress<'_>,
        events: &dyn EventSink,
    ) {
        self.done += 1;
        self.bytes += progress.bytes();

        let now = Instant::now();
        let due = match self.last_emit {
            Some(last) => now.duration_since(last) >= PROGRESS_INTERVAL,
            None => true,
        };
        if !due && self.done < self.total {
            return;
        }
        self.last_emit = Some(now);

        events.emit(BackendEvent::ExtractProgress(ExtractProgress {
            current: self.done,
            total: self.total,
            current_path: Some(progress.path().to_owned()),
            bytes: self.bytes,
            archive: wad.to_owned(),
        }));
    }
}

/// One archive's chunks, split by whether anything names them.
#[derive(Debug, Default)]
struct ArchiveChunks {
    named: Vec<WadHash>,
    unnamed: Vec<WadHash>,
    seen: HashSet<WadHash>,
}

impl ArchiveChunks {
    /// Take one chunk, unless the kind filter drops it or it is already in.
    fn push(
        &mut self,
        hash: WadHash,
        path: Option<&str>,
        size_bytes: u64,
        kinds: Option<&HashSet<WorkshopFileKind>>,
        job: &mut ExtractJob,
    ) {
        if !self.seen.insert(hash) {
            return;
        }

        match path {
            /* A named chunk is filtered here, by the extension the tree read
            its row's icon off, so the extract writes what the tree showed. */
            Some(path) => {
                if let Some(kinds) = kinds
                    && !kinds.contains(&kind_of(path))
                {
                    return;
                }
                self.named.push(hash);
            }
            None => self.unnamed.push(hash),
        }

        job.files += 1;
        job.bytes += size_bytes;
    }
}

/// The kind a path's extension names, the way the tree reads it.
fn kind_of(path: &str) -> WorkshopFileKind {
    let extension = path.rsplit_once('.').map_or("", |(_, ext)| ext);
    LeagueFileKind::from_extension(extension).into()
}

/// Sixteen hex digits into the hash they spell.
fn parse_hash(hex: &str) -> AppResult<WadHash> {
    hex.parse()
        .map_err(|_| AppError::InvalidPath(format!("Not a chunk path hash: {hex}")))
}

/// The folder one archive's files sit under with **One folder per archive**.
///
/// The archive's own file name and not its `DATA/FINAL`-relative path, because
/// that is the shape a layer holds and the point of the switch is that the
/// folder drops straight onto one.
fn archive_folder(wad: &str) -> &str {
    wad.rsplit_once('/').map_or(wad, |(_, name)| name)
}

/// The by-kind counts as the report shows them, most written first.
fn by_kind(counts: &BTreeMap<LeagueFileKind, usize>) -> Vec<ExtractKindCount> {
    let mut out: Vec<ExtractKindCount> = counts
        .iter()
        .map(|(&kind, &count)| ExtractKindCount {
            kind: kind.into(),
            count: count as u32,
        })
        .collect();
    out.sort_by_key(|entry| std::cmp::Reverse(entry.count));
    out
}

/// Refuse a destination inside the League install.
///
/// The manager never writes into the game directory, and an extract is not the
/// exception. An install that is not configured guards nothing, because there
/// is no directory to be inside of.
fn reject_the_install(config: &Config, destination: &Path) -> AppResult<()> {
    if config.league_path.is_none() {
        return Ok(());
    }
    let Ok(game_dir) = GameDir::resolve(config) else {
        return Ok(());
    };

    if is_within(game_dir.path(), destination) {
        return Err(AppError::ValidationFailed(format!(
            "Cannot extract into the League install: {}",
            destination.display()
        )));
    }
    Ok(())
}

/// Whether `path` is `root` or sits under it.
///
/// Compares what the file system resolves rather than the text of either, so a
/// `..` hop or a mapped drive cannot walk into the install unnoticed. A
/// destination that does not exist yet resolves through its deepest ancestor
/// that does, which is the directory it would be made under.
fn is_within(root: &Path, path: &Path) -> bool {
    let Ok(root) = fs::canonicalize(root) else {
        return false;
    };
    let Some(path) = canonicalize_existing(path) else {
        return false;
    };
    path.starts_with(&root)
}

/// `path` with its deepest existing ancestor resolved and the rest re-joined.
fn canonicalize_existing(path: &Path) -> Option<PathBuf> {
    let mut rest = Vec::new();
    let mut cursor = path;

    loop {
        if let Ok(resolved) = fs::canonicalize(cursor) {
            let mut out = resolved;
            for part in rest.iter().rev() {
                out.push(part);
            }
            return Some(out);
        }
        rest.push(cursor.file_name()?);
        cursor = cursor.parent()?;
    }
}

#[cfg(test)]
mod tests;
