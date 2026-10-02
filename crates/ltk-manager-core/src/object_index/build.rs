//! The read of every bin chunk of the install, one job per archive.
//!
//! Fed by the built [`GameIndex`], which already folded the install's chunks and
//! numbered its archives, so no table of contents is walked twice.

use std::io::{Cursor, Read, Seek};
use std::sync::Arc;
use std::time::Instant;

use ltk_file::{LeagueFileKind, MAX_MAGIC_SIZE};
use ltk_hash::BinHash;
use ltk_wad::{ChunkDecoder, WadHash, hex_name};
use rayon::prelude::*;

use crate::bin_source::BinSource;
use crate::error::{AppError, AppResult};
use crate::game_index::GameIndex;
use crate::game_wads::{ArchiveFile, GameArchives, chunk_bytes, chunk_head, mount_wad};

use super::{Declarations, DeclaringFile, Names, ObjectIndex, ObjectIndexStats, Row};

/// One archive's share of the build: its named `.bin` chunks, and the chunks
/// a bare name or no name leaves to sniff.
#[derive(Debug)]
struct ArchiveJob<'a> {
    ordinal: u32,
    name: &'a str,
    named: Vec<(WadHash, Box<str>)>,
    /// Named chunks with no extension, which is how Riot ships a UI scene's bin.
    bare: Vec<(WadHash, Box<str>)>,
    unnamed: Vec<WadHash>,
}

/// What one archive job read.
#[derive(Debug, Default)]
struct ArchiveRead {
    rows: Vec<Row>,
    files: Vec<DeclaringFile>,
    skipped: u32,
    sniffed: u32,
    unnamed_bins: u32,
    bare_bins: u32,
    bytes: u64,
}

impl ArchiveJob<'_> {
    /// Mount the archive and read every chunk of the job for its declarations.
    ///
    /// The named chunks first, in the order given, then the bare and the
    /// unnamed ones that sniff as a bin.
    ///
    /// # Errors
    ///
    /// Fails when the archive cannot be opened or mounted. A chunk that will
    /// not read is skipped and counted rather than failing the job.
    fn read(&self, archives: &GameArchives) -> AppResult<ArchiveRead> {
        let path = archives.archive_path(self.name)?;
        let mut wad = mount_wad(&path)?;
        let mut read = ArchiveRead::default();

        for (path_hash, chunk_path) in &self.named {
            read.files.push(DeclaringFile {
                path_hash: *path_hash,
                path: Some(chunk_path.clone()),
                wad: self.ordinal,
            });
            self.read_chunk(&mut wad, *path_hash, chunk_path, &mut read);
        }

        let mut decoder = ChunkDecoder::new();
        for (path_hash, chunk_path) in &self.bare {
            if !self.sniffs_as_bin(&mut wad, *path_hash, &mut decoder) {
                continue;
            }
            read.bare_bins += 1;
            read.files.push(DeclaringFile {
                path_hash: *path_hash,
                path: Some(chunk_path.clone()),
                wad: self.ordinal,
            });
            self.read_chunk(&mut wad, *path_hash, chunk_path, &mut read);
        }

        for path_hash in &self.unnamed {
            read.sniffed += 1;
            if !self.sniffs_as_bin(&mut wad, *path_hash, &mut decoder) {
                continue;
            }
            read.unnamed_bins += 1;
            read.files.push(DeclaringFile {
                path_hash: *path_hash,
                path: None,
                wad: self.ordinal,
            });
            self.read_chunk(&mut wad, *path_hash, &hex_name(*path_hash), &mut read);
        }
        Ok(read)
    }

    /// Whether the first bytes of `path_hash` are a bin's magic.
    ///
    /// The head alone is decoded, so a chunk of any other kind costs a prefix
    /// read and nothing more. A chunk that will not decode that far is not a
    /// bin the build could read either.
    fn sniffs_as_bin(
        &self,
        wad: &mut ArchiveFile,
        path_hash: WadHash,
        decoder: &mut ChunkDecoder,
    ) -> bool {
        let Some(chunk) = wad.chunks().get(path_hash).copied() else {
            return false;
        };
        let head = match chunk_head(wad, &chunk, decoder, MAX_MAGIC_SIZE) {
            Ok(head) => head,
            Err(e) => {
                tracing::debug!("Not sniffing {}/{}: {e}", self.name, hex_name(path_hash));
                return false;
            }
        };
        matches!(
            LeagueFileKind::identify_from_bytes(&head),
            LeagueFileKind::PropertyBin | LeagueFileKind::PropertyBinOverride
        )
    }

    /// Read one chunk whole and push a row for every object it declares.
    ///
    /// A chunk that is missing or will not read is skipped and counted, with
    /// `label` naming it in the log.
    fn read_chunk(
        &self,
        wad: &mut ArchiveFile,
        path_hash: WadHash,
        label: &str,
        read: &mut ArchiveRead,
    ) {
        let bytes = match chunk_bytes(wad, path_hash) {
            Ok(Some(bytes)) => bytes,
            Ok(None) => {
                read.skipped += 1;
                tracing::debug!("Skipping {}/{label}: not in the archive", self.name);
                return;
            }
            Err(e) => {
                read.skipped += 1;
                tracing::debug!("Skipping {}/{label}: {e}", self.name);
                return;
            }
        };
        read.bytes += bytes.len() as u64;

        let before = read.rows.len();
        if let Err(e) = declarations(&bytes, path_hash, &mut read.rows) {
            read.rows.truncate(before);
            read.skipped += 1;
            tracing::debug!("Skipping {}/{label}: {e}", self.name);
        }
    }
}

/// Push a row for every object `bytes` declares.
fn declarations(bytes: &[u8], file: WadHash, out: &mut Vec<Row>) -> Result<(), ltk_meta::Error> {
    for_each_declaration(Cursor::new(bytes), |declared| {
        out.push(Row {
            object: declared.object,
            class: declared.class,
            file,
        });
    })
}

/// One object a bin declares, and the class it declares it as.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Declaration {
    pub object: BinHash,
    pub class: BinHash,
}

/// Visit every object the bin in `source` declares, in file order, by its magic.
///
/// A `PROP` is swept through the object table, one 8-byte hop an object. A
/// `PTCH` is read whole, which is the fallback the problems pass carries too
/// while the streaming form of a patch waits upstream, and its patch records
/// declare nothing.
///
/// # Errors
///
/// Fails when `source` cannot be read or is not a bin the toolkit reads.
/// Objects before the failure were visited.
pub fn for_each_declaration<R: Read + Seek>(
    source: R,
    mut visit: impl FnMut(Declaration),
) -> Result<(), ltk_meta::Error> {
    let mut stream = match BinSource::open(source)? {
        BinSource::Patch(patch) => {
            for object in patch.objects.values() {
                visit(Declaration {
                    object: object.path_hash,
                    class: object.class_hash,
                });
            }
            return Ok(());
        }
        BinSource::Stream(stream) => stream,
    };
    for entry in stream.entries() {
        let entry = entry?;
        visit(Declaration {
            object: entry.path_hash,
            class: entry.class_hash,
        });
    }
    Ok(())
}

/// Run `job` over every item of `work` on at most `workers` threads.
///
/// Results come back in `work`'s own order. An item is `None` where the run
/// was called off before reaching it. The shape of `Budget::map` without the
/// budget, because the build is decompression and the budget's weight rule
/// is sized for the eager reader.
fn map_bounded<T, R>(
    work: &[T],
    workers: usize,
    called_off: &(impl Fn() -> bool + Sync),
    job: impl Fn(&T) -> R + Sync,
) -> Vec<Option<R>>
where
    T: Sync,
    R: Send,
{
    let run = || {
        work.par_iter()
            .map(|item| (!called_off()).then(|| job(item)))
            .collect()
    };

    match rayon::ThreadPoolBuilder::new()
        .num_threads(workers.max(1))
        .build()
    {
        Ok(pool) => pool.install(run),
        // A pool that will not build costs the run its bound, not its answer.
        Err(_) => run(),
    }
}

/// Whether a chunk path names a bin by its extension.
fn is_bin(path: &str) -> bool {
    path.len() >= 4
        && path
            .get(path.len() - 4..)
            .is_some_and(|tail| tail.eq_ignore_ascii_case(".bin"))
}

/// Whether a chunk path's last segment carries no extension to judge it by.
fn is_bare(path: &str) -> bool {
    camino::Utf8Path::new(path).extension().is_none()
}

impl ObjectIndex {
    /// Read every bin chunk of the install for what it declares.
    ///
    /// One job per archive in the game index's order, each mounting its
    /// archive itself, on at most `workers` threads, with the rows landing in
    /// that order. A named chunk is a bin by its extension. One with a bare
    /// name, and one no table names, is decoded far enough to read its magic,
    /// and read whole only when the magic is a bin's. A chunk that will not
    /// read is skipped and counted.
    ///
    /// `called_off` is tested before each archive, so a build nobody wants
    /// stops at the next one rather than decompressing the rest.
    ///
    /// The index comes back unnamed. [`named`](Self::named) resolves it.
    ///
    /// # Errors
    ///
    /// Fails when the build was called off, and when the archives cannot be
    /// resolved. An archive that will not mount is skipped and logged.
    pub fn build(
        game: &GameIndex,
        archives: &GameArchives,
        workers: usize,
        called_off: &(impl Fn() -> bool + Sync),
    ) -> AppResult<Self> {
        let started = Instant::now();
        let wads = game.wads().to_vec();

        let mut named: Vec<Vec<(WadHash, Box<str>)>> =
            (0..wads.len()).map(|_| Vec::new()).collect();
        let mut bare: Vec<Vec<(WadHash, Box<str>)>> = (0..wads.len()).map(|_| Vec::new()).collect();
        game.for_each_named_file(|hash, path, wad| {
            if is_bin(path) {
                named[wad as usize].push((WadHash(hash), path.into()));
            } else if is_bare(path) {
                bare[wad as usize].push((WadHash(hash), path.into()));
            }
        });
        let mut unnamed: Vec<Vec<WadHash>> = (0..wads.len()).map(|_| Vec::new()).collect();
        game.for_each_unnamed_file(|hash, wad| unnamed[wad as usize].push(WadHash(hash)));

        let jobs: Vec<ArchiveJob<'_>> = named
            .into_iter()
            .zip(bare)
            .zip(unnamed)
            .enumerate()
            .filter(|(_, ((named, bare), unnamed))| {
                !named.is_empty() || !bare.is_empty() || !unnamed.is_empty()
            })
            .map(|(ordinal, ((named, bare), unnamed))| ArchiveJob {
                ordinal: ordinal as u32,
                name: &wads[ordinal],
                named,
                bare,
                unnamed,
            })
            .collect();
        let workers = workers.clamp(1, jobs.len().max(1));

        let outcomes = map_bounded(&jobs, workers, called_off, |job| job.read(archives));

        let mut declared = Declarations::default();
        let mut stats = ObjectIndexStats {
            archives: jobs.len() as u32,
            workers: workers as u32,
            ..ObjectIndexStats::default()
        };

        for (job, outcome) in jobs.iter().zip(outcomes) {
            let Some(outcome) = outcome else {
                return Err(AppError::Other(
                    "The object index build was called off".to_owned(),
                ));
            };
            stats.files += job.named.len() as u32;
            match outcome {
                Ok(read) => {
                    stats.files += read.bare_bins + read.unnamed_bins;
                    stats.sniffed += read.sniffed;
                    stats.unnamed_bins += read.unnamed_bins;
                    stats.rows += read.rows.len() as u32;
                    stats.skipped += read.skipped;
                    stats.bytes += read.bytes;
                    declared.rows.extend(read.rows);
                    for file in read.files {
                        declared
                            .by_file
                            .insert(file.path_hash, declared.files.len() as u32);
                        declared.files.push(file);
                    }
                }
                Err(e) => {
                    stats.skipped += job.named.len() as u32;
                    tracing::warn!("Skipping unreadable game archive {}: {e}", job.name);
                }
            }
        }
        drop(jobs);

        let mut objects: Vec<BinHash> = declared.rows.iter().map(|row| row.object).collect();
        objects.sort_unstable();
        objects.dedup();
        declared.objects = objects.into_boxed_slice();
        let mut by_object: Vec<u32> = (0..declared.rows.len() as u32).collect();
        by_object.sort_by_key(|&at| declared.rows[at as usize].object);
        declared.by_object = by_object.into_boxed_slice();

        stats.elapsed = started.elapsed();
        tracing::info!(
            archives = stats.archives,
            files = stats.files,
            sniffed = stats.sniffed,
            unnamed_bins = stats.unnamed_bins,
            rows = stats.rows,
            objects = declared.objects.len(),
            skipped = stats.skipped,
            bytes = stats.bytes,
            elapsed_ms = stats.elapsed.as_millis() as u64,
            workers = stats.workers,
            "Built the bin object index"
        );

        declared.wads = wads;
        declared.stats = stats;
        Ok(Self {
            declared: Arc::new(declared),
            names: Names::default(),
        })
    }
}
