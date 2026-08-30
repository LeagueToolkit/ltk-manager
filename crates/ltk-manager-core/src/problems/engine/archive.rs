//! A fantome archive as files a rule can read, without unpacking it.
//!
//! A packed WAD is read chunk by chunk where the archive keeps it, and a WAD
//! kept as a directory of entries is read entry by entry. Either way nothing
//! is written: the check that used to unpack a gigabyte of staging to read a
//! few bins now costs the bins.
//!
//! Reads open the archive again rather than sharing one handle. Bins are read
//! on a pool - see [`Budget::map`](crate::problems::Budget::map) - and a zip
//! entry borrows its archive mutably, so one shared handle would serialize the
//! pool. Reopening a stored entry costs the archive's entry table and the
//! WAD's, which is kilobytes.
//!
//! A deflated entry is the exception, and the reason [`ArchiveFiles`] holds
//! bytes at all. Deflate has no random access, so reaching any one chunk costs
//! inflating the whole entry - which reopening would pay once per bin. Such a
//! WAD is inflated once at the scan and kept for the run.
//! [`normalize_archive`](ltk_fantome::normalize_archive) is what stops an
//! archive needing that.

use std::collections::HashMap;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use ltk_fantome::{FantomeEntry, FantomeReader, classify_entry};
use ltk_file::{LeagueFileKind, MAX_MAGIC_SIZE};
use ltk_hashtable::{GameResolver, Hashtable, HashtableEntry, HashtableSet};
use ltk_wad::{ChunkDecoder, NameRecovery, PathResolver, Wad, WadChunk, WadHash, hex_name};
use zip::{CompressionMethod, ZipArchive};

use crate::error::{AppError, AppResult};
use crate::workshop::WorkshopFileKind;

use super::{ChunkInfo, LayerFiles, ProjectFile};

/// The layer every fantome's content lands in, packed or loose.
///
/// The format has no layers of its own, and the tree an unpack writes puts all
/// of it under `base`, which is the name a site has to keep reading.
const ARCHIVE_LAYER: &str = "base";

/// Where an unpack puts a fantome's `RAW/` entries inside the layer.
const RAW_DIR: &str = "raw";

/// One fantome archive, and the bytes of the files inside it on demand.
#[derive(Debug)]
pub(super) struct ArchiveFiles {
    archive: PathBuf,
    /// The WADs this archive deflated, inflated once and held for the run,
    /// under their lower-cased names. A stored WAD is not here: it is read
    /// where it lies.
    inflated: HashMap<String, Arc<[u8]>>,
}

/// What one scan of an archive found.
///
/// The layer and the tables come back together because both are read in the
/// same pass, and a caller wanting one always wants the other: the tables are
/// what name the hashes the layer's bins hold.
#[derive(Debug)]
pub(super) struct ArchiveScan {
    /// The one layer the archive holds, reading back through the archive.
    pub layer: LayerFiles,
    /// The tables the archive declares, for the names it alone holds.
    pub tables: Vec<(HashtableEntry, Hashtable)>,
}

/// One packed WAD entry, and whether it can be read where it lies.
struct PackedWad {
    name: String,
    /// Taken from the entry's own record, so deciding costs no decompression.
    stored: bool,
}

impl ArchiveFiles {
    /// Every file of `archive` a rule can see, and the names it declares.
    ///
    /// `resolver` names the chunks of a packed WAD, exactly as it does for an
    /// unpack, so a site addresses the same path either way. A chunk it does
    /// not name is listed under its hash and identified by its magic, because
    /// a bin the panel cannot name is still a bin the panel has to report.
    ///
    /// # Errors
    ///
    /// Reports an archive that cannot be opened or whose entry table cannot be
    /// read. A single WAD that cannot be mounted is logged and skipped, since
    /// one damaged WAD is no reason to say nothing about the rest.
    pub(super) fn scan(archive: &Path, resolver: &dyn PathResolver) -> AppResult<ArchiveScan> {
        let (mut files, packed) = Self::loose_files(archive)?;
        let mut reader = FantomeReader::new(std::fs::File::open(archive)?)
            .map_err(|e| AppError::Fantome(e.to_string()))?;

        // Read before the WADs are scanned, and propagated rather than shrugged
        // off: the mod's own tables name its chunks ahead of the caller's
        // resolver, exactly as they do for an unpack, so an archive whose
        // manifest names a table it does not hold resolves to names neither
        // side can reproduce. The import refuses such an archive; so does this.
        let declared = reader
            .read_hashtables()
            .map_err(|e| AppError::Fantome(e.to_string()))?;
        let own_names = HashtableSet::build(declared.iter().cloned());
        let chained = Chained {
            own: GameResolver::new(&own_names),
            fallback: resolver,
        };

        let mut inflated = HashMap::new();
        for wad in packed {
            match Self::packed_files(&mut reader, &wad, &chained, &mut inflated) {
                Ok(found) => files.extend(found),
                Err(e) => tracing::warn!(
                    "Skipping {} of {}, which would not mount: {e}",
                    wad.name,
                    archive.display()
                ),
            }
        }

        // The walk sorts each layer, and a site's order is what the panel draws
        // in, so an archive has to arrive sorted too.
        files.sort_by(|a, b| a.path.cmp(&b.path));

        let tables = declared;

        let source = Self {
            archive: archive.to_path_buf(),
            inflated,
        };
        Ok(ArchiveScan {
            layer: LayerFiles::in_archive(ARCHIVE_LAYER, files, source),
            tables,
        })
    }

    /// The bytes of one file the scan listed.
    ///
    /// # Errors
    ///
    /// Reports the file it could not read, as one sentence a panel can draw.
    pub(super) fn read(&self, file: &ProjectFile) -> Result<Vec<u8>, String> {
        self.bytes_of(file, None)
    }

    /// At most `limit` bytes from the start of one file the scan listed.
    ///
    /// A packed chunk is decompressed only that far, which is the whole point:
    /// a rule that judges a 44MB chunk from its header pays for its header.
    ///
    /// # Errors
    ///
    /// Reports the file it could not read, as one sentence a panel can draw.
    pub(super) fn head(&self, file: &ProjectFile, limit: usize) -> Result<Vec<u8>, String> {
        self.bytes_of(file, Some(limit))
    }

    /// One file the scan listed, whole for `None` and bounded otherwise.
    fn bytes_of(&self, file: &ProjectFile, limit: Option<usize>) -> Result<Vec<u8>, String> {
        match &file.chunk {
            Some(chunk) => self.read_chunk(&file.path, chunk.hash, limit),
            None => self.read_entry(&file.path, limit),
        }
        .map_err(|e| format!("{}: {e}", self.archive.display()))
    }

    /// Every file the archive holds loose, and its packed WAD entries.
    ///
    /// Only the entry table is read, so listing an archive costs no
    /// decompression however much content it holds.
    fn loose_files(archive: &Path) -> AppResult<(Vec<ProjectFile>, Vec<PackedWad>)> {
        let mut zip = open_zip(archive)?;

        let mut files = Vec::new();
        let mut packed = Vec::new();
        for index in 0..zip.len() {
            let entry = zip.by_index_raw(index)?;
            let (name, size) = (entry.name().to_owned(), entry.size());

            if let Some(FantomeEntry::PackedWad(wad_name)) = classify_entry(&name) {
                packed.push(PackedWad {
                    name: wad_name.to_owned(),
                    stored: entry.compression() == CompressionMethod::Stored,
                });
                continue;
            }
            if let Some(path) = layer_path(&name) {
                files.push(ProjectFile {
                    kind: kind_of_path(&path),
                    path,
                    size_bytes: size,
                    chunk: None,
                });
            }
        }

        Ok((files, packed))
    }

    /// Every chunk of one packed WAD, under the paths `resolver` names.
    ///
    /// A WAD the archive deflated is inflated here and left in `inflated`, so
    /// the reads that follow do not each inflate it again.
    fn packed_files(
        reader: &mut FantomeReader<std::fs::File>,
        wad: &PackedWad,
        resolver: &dyn PathResolver,
        inflated: &mut HashMap<String, Arc<[u8]>>,
    ) -> AppResult<Vec<ProjectFile>> {
        if wad.stored {
            tracing::debug!("Reading {} where the archive stores it", wad.name);
            let Some(source) = reader
                .packed_wad_source(&wad.name)
                .map_err(|e| AppError::Fantome(e.to_string()))?
            else {
                return Ok(Vec::new());
            };
            return scan_wad(&mut mounted(source)?, &wad.name, resolver);
        }

        let Some(bytes) = reader
            .read_packed_wad(&wad.name)
            .map_err(|e| AppError::Fantome(e.to_string()))?
        else {
            return Ok(Vec::new());
        };
        // The size is the run's to hold until it ends, so it is worth saying.
        tracing::debug!(
            "Holding {} inflated, {} MB, which the archive deflated",
            wad.name,
            bytes.len() / (1024 * 1024)
        );

        let bytes: Arc<[u8]> = Arc::from(bytes);
        let found = scan_wad(
            &mut mounted(Cursor::new(Arc::clone(&bytes)))?,
            &wad.name,
            resolver,
        )?;
        inflated.insert(wad.name.to_ascii_lowercase(), bytes);
        Ok(found)
    }

    /// One chunk of the packed WAD the first segment of `path` names.
    fn read_chunk(&self, path: &str, hash: WadHash, limit: Option<usize>) -> AppResult<Vec<u8>> {
        let wad_name = path.split('/').next().unwrap_or(path);

        if let Some(bytes) = self.inflated.get(&wad_name.to_ascii_lowercase()) {
            return chunk_of(
                &mut mounted(Cursor::new(Arc::clone(bytes)))?,
                wad_name,
                hash,
                limit,
            );
        }

        let mut reader = FantomeReader::new(std::fs::File::open(&self.archive)?)
            .map_err(|e| AppError::Fantome(e.to_string()))?;
        let mut wad = reader
            .mount_packed_wad(wad_name)
            .map_err(|e| AppError::Fantome(e.to_string()))?
            .ok_or_else(|| AppError::Fantome(format!("{wad_name} is no longer packed")))?;
        chunk_of(&mut wad, wad_name, hash, limit)
    }

    /// One loose entry, found the same way the scan placed it.
    ///
    /// Through [`layer_path`] rather than by rebuilding a prefix, so an entry
    /// is read back under whatever casing and whichever of the two prefixes
    /// the archive spelled it with.
    fn read_entry(&self, path: &str, limit: Option<usize>) -> AppResult<Vec<u8>> {
        let mut zip = open_zip(&self.archive)?;
        let name = zip
            .file_names()
            .find(|name| layer_path(name).is_some_and(|at| at.eq_ignore_ascii_case(path)))
            .map(str::to_owned)
            .ok_or_else(|| AppError::Fantome(format!("{path} is no longer in the archive")))?;

        let entry = zip.by_name(&name)?;
        let mut bytes = Vec::new();
        match limit {
            Some(limit) => std::io::Read::read_to_end(
                &mut std::io::Read::take(entry, limit as u64),
                &mut bytes,
            ),
            None => {
                std::io::Read::read_to_end(&mut std::io::Read::take(entry, u64::MAX), &mut bytes)
            }
        }?;
        Ok(bytes)
    }
}

fn open_zip(archive: &Path) -> AppResult<ZipArchive<std::fs::File>> {
    ZipArchive::new(std::fs::File::open(archive)?).map_err(|e| AppError::Fantome(e.to_string()))
}

/// A WAD over `source`, with its own error mapped onto the app's.
fn mounted<S: std::io::Read + std::io::Seek>(source: S) -> AppResult<Wad<S>> {
    Wad::mount(source).map_err(|e| AppError::Fantome(e.to_string()))
}

/// Every chunk of `wad` as a file of the layer, under `wad_name`.
///
/// The paths are what an unpack would have written the chunks to, which is
/// what a site's path has always named.
fn scan_wad<S: std::io::Read + std::io::Seek>(
    wad: &mut Wad<S>,
    wad_name: &str,
    resolver: &dyn PathResolver,
) -> AppResult<Vec<ProjectFile>> {
    // The names a mod's own bins spell for its chunks, which no table holds:
    // the author invented those paths, and an unpack recovers them before it
    // writes. A scan skipping this lists under a hash what the tree lists
    // under a path.
    let recovered = NameRecovery::new()
        .run(wad, resolver)
        .map_err(|e| AppError::Fantome(e.to_string()))?;
    let resolver = recovered.over(resolver);

    let chunks: Vec<WadChunk> = wad.chunks().iter().copied().collect();
    let hashes: Vec<WadHash> = chunks.iter().map(|chunk| chunk.path_hash).collect();
    let named = resolver.resolve_all(&hashes);

    let mut decoder = ChunkDecoder::new();
    let mut files = Vec::with_capacity(chunks.len());
    for (chunk, name) in chunks.iter().zip(named) {
        // Sixteen hex digits and no extension, which is what the import writes
        // a nameless chunk as: it runs under NamingPolicy::Lossless, and that
        // policy invents none. The path stays that, whatever the magic says -
        // the tree has no file under any other name, and a site the repair
        // cannot find is a problem raised on every sweep forever.
        let (path, kind) = match name {
            Some(named) => {
                let kind = kind_of_path(&named);
                (named, kind)
            }
            None => (
                hex_name(chunk.path_hash),
                sniffed_kind(wad, chunk, &mut decoder),
            ),
        };

        files.push(ProjectFile {
            kind,
            path: format!("{wad_name}/{path}"),
            size_bytes: chunk.uncompressed_size as u64,
            chunk: Some(ChunkInfo::from(chunk)),
        });
    }

    Ok(files)
}

/// Raw bytes a bounded read takes from a chunk first.
///
/// The first block of nearly every chunk fits, and one whose block does not
/// gets a second read of [`HEAD_MAX_RAW`]. Both are `ltk_wad`'s own numbers:
/// its name recovery makes the same read over the same chunks.
const HEAD_FIRST_RAW: usize = 16 * 1024;

/// Most raw bytes a bounded read takes from one chunk.
///
/// A zstd block decodes to at most 128 KiB and an incompressible block is no
/// larger than that, so this always holds the first block and its headers.
const HEAD_MAX_RAW: usize = 256 * 1024;

/// At most `want` bytes from the start of `chunk`, decompressing no further.
///
/// The one place the escalation is written. The scan calls it with the WAD it
/// is already walking and a rule calls it through
/// [`ArchiveFiles::head`](ArchiveFiles::head), which remounts - so it takes a
/// mounted WAD rather than knowing how to find one.
///
/// A chunk holding fewer than `want` bytes answers with what it holds, and so
/// does one whose first block will not decode past that.
fn chunk_head<S: std::io::Read + std::io::Seek>(
    wad: &mut Wad<S>,
    chunk: &WadChunk,
    decoder: &mut ChunkDecoder,
    want: usize,
) -> Result<Vec<u8>, ltk_wad::WadError> {
    let want = want.min(chunk.uncompressed_size);
    let ceiling = HEAD_MAX_RAW.max(want);
    let mut raw_limit = HEAD_FIRST_RAW.max(want);
    loop {
        let raw = wad.load_chunk_raw_prefix(chunk, raw_limit)?;
        /* The prefix cut the first block short, and the chunk holds more. */
        let cut_short = raw.len() == raw_limit && raw_limit < ceiling;
        match decoder.decompress_chunk_prefix(&raw, chunk, wad.subchunk_toc(), want) {
            Ok(head) if head.len() >= want || !cut_short => return Ok(head),
            Err(e) if !cut_short => return Err(e),
            _ => raw_limit = ceiling,
        }
    }
}

/// What a chunk no table names is, from as little of it as decodes.
///
/// A header read rather than a decompression, because the scan is what a health
/// check costs and a mod runs to hundreds of megabytes. A chunk that will not
/// decode keeps [`WorkshopFileKind::Unknown`], which is all its name said
/// either way.
fn sniffed_kind<S: std::io::Read + std::io::Seek>(
    wad: &mut Wad<S>,
    chunk: &WadChunk,
    decoder: &mut ChunkDecoder,
) -> WorkshopFileKind {
    let wanted = MAX_MAGIC_SIZE.min(chunk.uncompressed_size);
    match chunk_head(wad, chunk, decoder, MAX_MAGIC_SIZE) {
        Ok(head) if head.len() >= wanted => {
            WorkshopFileKind::from(LeagueFileKind::identify_from_bytes(&head))
        }
        _ => WorkshopFileKind::Unknown,
    }
}

/// The archive's own declared tables, then whatever the caller supplied.
///
/// The order an unpack resolves in: a mod's tables are the record of the paths
/// its author invented, and the caller's resolver holds the game's. Naming a
/// chunk differently from the unpack puts a problem at a site the repair
/// cannot find.
struct Chained<'a> {
    own: GameResolver<'a>,
    fallback: &'a dyn PathResolver,
}

impl PathResolver for Chained<'_> {
    fn resolve(&self, path_hash: WadHash) -> Option<String> {
        self.own
            .resolve(path_hash)
            .or_else(|| self.fallback.resolve(path_hash))
    }

    fn is_known(&self, path_hash: WadHash) -> bool {
        self.own.is_known(path_hash) || self.fallback.is_known(path_hash)
    }
}

/// The decompressed bytes of one chunk of `wad`, whole or bounded.
fn chunk_of<S: std::io::Read + std::io::Seek>(
    wad: &mut Wad<S>,
    wad_name: &str,
    hash: WadHash,
    limit: Option<usize>,
) -> AppResult<Vec<u8>> {
    let chunk = *wad
        .chunks()
        .get(hash)
        .ok_or_else(|| AppError::Fantome(format!("{wad_name} holds no chunk {hash}")))?;
    match limit {
        Some(limit) => chunk_head(wad, &chunk, &mut ChunkDecoder::new(), limit),
        None => wad.load_chunk_decompressed(&chunk).map(Vec::from),
    }
    .map_err(|e| AppError::Fantome(e.to_string()))
}

/// Where the entry named `entry_name` lands inside the layer, or `None` for
/// an entry that is not the layer's content at all.
///
/// The one place the mapping is written, so a scan and a read cannot disagree
/// about which entry a site's path names. It follows `ltk_mod_project`'s own
/// fantome layout, because the tree an unpack writes is what a site's path has
/// always named - `RAW/` entries included, which land under the layer rather
/// than beside it.
fn layer_path(entry_name: &str) -> Option<String> {
    let path = match classify_entry(entry_name)? {
        FantomeEntry::WadFile(relative) => relative.to_owned(),
        FantomeEntry::Raw(relative) => format!("{RAW_DIR}/{relative}"),
        _ => return None,
    };

    // The walk filters every entry under the layer root whose name begins with
    // a dot, so an archive listing one lists a file the tree does not - and a
    // problem raised against it is one the repair, reading the tree, can never
    // apply a fix to.
    let hidden = path.split('/').any(|part| part.starts_with('.'));
    (!hidden).then_some(path)
}

/// The kind a path's extension claims, which is what the walk reads too.
fn kind_of_path(path: &str) -> WorkshopFileKind {
    let extension = camino::Utf8Path::new(path).extension().unwrap_or_default();
    WorkshopFileKind::from(LeagueFileKind::from_extension(extension))
}
