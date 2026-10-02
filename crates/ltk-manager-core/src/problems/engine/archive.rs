//! A fantome archive's files, read for the rules without unpacking it.
//!
//! A packed WAD is read chunk by chunk from the archive, and a WAD stored as a
//! directory of entries is read entry by entry. Nothing is written to disk.
//!
//! Each read opens the archive again instead of sharing one handle. Bins are
//! read on a pool - see [`Budget::map`](crate::problems::Budget::map) - and a
//! zip entry borrows its archive mutably, so a shared handle would serialize the
//! pool. Reopening a stored entry reads the archive's entry table and the WAD's,
//! which is a few kilobytes.
//!
//! A deflated entry is the exception, and the reason [`ArchiveFiles`] holds
//! bytes. Deflate has no random access, so reading one chunk inflates the whole
//! entry, and reopening would repeat that for every bin. The scan inflates such
//! a WAD once and keeps it for the run.
//! [`normalize_archive`](ltk_fantome::normalize_archive) stores an archive's
//! WADs uncompressed, which avoids this.

use std::collections::HashMap;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use fs_err as fs;
use ltk_fantome::{BASE_LAYER, FantomeEntry, FantomeReader, classify_entry};
use ltk_file::{LeagueFileKind, MAX_MAGIC_SIZE};
use ltk_hashtable::{GameResolver, Hashtable, HashtableEntry, HashtableSet};
use ltk_wad::{ChunkDecoder, NameRecovery, PathResolver, Wad, WadChunk, WadHash, hex_name};
use zip::{CompressionMethod, ZipArchive};

use crate::error::{AppError, AppResult};
use crate::game_wads::chunk_head;
use crate::mods::fantome_layer::unpacked_layer_name;
use crate::mods::open_fantome;
use crate::utils::natural_order::compare_names;
use crate::workshop::WorkshopFileKind;

use super::{ChunkInfo, LayerFiles, ProjectFile};

/// Where an unpack puts a fantome's `RAW/` entries inside the base layer.
const RAW_DIR: &str = "raw";

/// One layer of a fantome archive, and the bytes of the files inside it on
/// demand.
#[derive(Debug)]
pub(super) struct ArchiveFiles {
    archive: PathBuf,
    /// The layer, as its WAD directory spells it: [`BASE_LAYER`] for `WAD/`.
    layer: String,
    /// The layer's deflated WADs, inflated once and kept for the run, keyed by
    /// lower-cased name. A stored WAD is read from the archive and is not held
    /// here.
    inflated: HashMap<String, Arc<[u8]>>,
}

/// What one scan of an archive found.
///
/// Both come from one pass over the archive. The tables name the hashes the
/// layers' bins hold.
#[derive(Debug)]
pub(super) struct ArchiveScan {
    /// Every layer the archive holds, base first and the rest by name.
    pub layers: Vec<LayerFiles>,
    /// The hashtables the archive declares.
    pub tables: Vec<(HashtableEntry, Hashtable)>,
}

/// The entries of one layer, as the archive's entry table lists them.
#[derive(Default)]
struct LayerEntries {
    /// The layer, as its WAD directory first spells it.
    layer: String,
    files: Vec<ProjectFile>,
    packed: Vec<PackedWad>,
}

/// One packed WAD entry, and whether it can be read where it lies.
struct PackedWad {
    name: String,
    /// Read from the entry's record, without decompressing it.
    stored: bool,
}

impl ArchiveFiles {
    /// Every file of `archive` a rule can read, by layer, and the hashtables it
    /// declares.
    ///
    /// `resolver` names a packed WAD's chunks the same way an unpack does, so a
    /// site has the same path either way. A chunk it does not name is listed
    /// under its hash, and its kind is read from its magic so the panel still
    /// reports it.
    ///
    /// # Errors
    ///
    /// Reports an archive that cannot be opened or whose entry table cannot be
    /// read. A WAD that cannot be mounted is logged and skipped, and the rest
    /// are still scanned.
    pub(super) fn scan(archive: &Path, resolver: &dyn PathResolver) -> AppResult<ArchiveScan> {
        let entries = Self::layer_entries(archive)?;
        let mut reader = open_fantome(archive)?;

        // Read before the WADs and propagated as an error. The mod's own tables
        // name its chunks before the caller's resolver does, as in an unpack,
        // so an archive whose manifest lists a table it does not hold would get
        // names an unpack cannot reproduce. The import refuses such an archive,
        // and so does the scan.
        let declared = reader.read_hashtables()?;
        let own_names = HashtableSet::build(declared.iter().cloned());
        let chained = Chained {
            own: GameResolver::new(&own_names),
            fallback: resolver,
        };

        let info = reader.read_info().unwrap_or_default();

        let mut layers = Vec::with_capacity(entries.len());
        for LayerEntries {
            layer,
            mut files,
            packed,
        } in entries
        {
            let mut inflated = HashMap::new();
            for wad in packed {
                match Self::packed_files(&mut reader, &layer, &wad, &chained, &mut inflated) {
                    Ok(found) => files.extend(found),
                    Err(e) => tracing::warn!(
                        "Skipping {} of layer {layer} of {}, which would not mount: {e}",
                        wad.name,
                        archive.display()
                    ),
                }
            }

            // The panel draws sites in file order, and the tree walk sorts each
            // layer, so the archive's files are sorted the same way.
            files.sort_by(|a, b| a.path.cmp(&b.path));

            let name = unpacked_layer_name(&info, &layer);
            let source = Self {
                archive: archive.to_path_buf(),
                layer,
                inflated,
            };
            layers.push(LayerFiles::in_archive(&name, files, source));
        }

        // The order `layer::dirs_in` reads a tree's layers in.
        layers.sort_by(|a, b| {
            (b.name == BASE_LAYER)
                .cmp(&(a.name == BASE_LAYER))
                .then_with(|| compare_names(&a.name, &b.name))
        });

        Ok(ArchiveScan {
            layers,
            tables: declared,
        })
    }

    /// The bytes of one file the scan listed.
    ///
    /// # Errors
    ///
    /// Reports the file it could not read, as a one-line message for the panel.
    pub(super) fn read(&self, file: &ProjectFile) -> Result<Vec<u8>, String> {
        self.bytes_of(file, None)
    }

    /// At most `limit` bytes from the start of one file the scan listed.
    ///
    /// A packed chunk is decompressed only up to `limit`, so a rule that reads
    /// the header of a 44MB chunk decompresses only the header.
    ///
    /// # Errors
    ///
    /// Reports the file it could not read, as a one-line message for the panel.
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

    /// The archive's loose files and packed WAD entries, by layer.
    ///
    /// The base layer is always listed, even when empty. A file's kind comes
    /// from its extension in the entry table, without decompression. An entry
    /// with no extension has only its head inflated, to read its magic.
    fn layer_entries(archive: &Path) -> AppResult<Vec<LayerEntries>> {
        let mut zip = open_zip(archive)?;

        let mut layers = vec![LayerEntries {
            layer: BASE_LAYER.to_owned(),
            ..LayerEntries::default()
        }];
        let mut nameless: Vec<(usize, usize, usize)> = Vec::new();
        for index in 0..zip.len() {
            let entry = zip.by_index_raw(index)?;
            let (name, size) = (entry.name().to_owned(), entry.size());

            if let Some(FantomeEntry::PackedWad {
                layer,
                name: wad_name,
            }) = classify_entry(&name)
            {
                let at = position_of(&mut layers, layer);
                layers[at].packed.push(PackedWad {
                    name: wad_name.to_owned(),
                    stored: entry.compression() == CompressionMethod::Stored,
                });
                continue;
            }
            if let Some((layer, path)) = layer_path(&name) {
                let at = position_of(&mut layers, layer);
                let files = &mut layers[at].files;
                if !has_extension(&path) {
                    nameless.push((index, at, files.len()));
                }
                files.push(ProjectFile {
                    kind: kind_of_path(&path),
                    path,
                    size_bytes: size,
                    chunk: None,
                });
            }
        }

        /* A second pass, because this one decompresses and the first reads
        only the entry table. */
        for (index, layer, slot) in nameless {
            let Ok(mut entry) = zip.by_index(index) else {
                continue;
            };
            let mut head = [0u8; MAX_MAGIC_SIZE];
            let read = read_head(&mut entry, &mut head);
            layers[layer].files[slot].kind =
                WorkshopFileKind::from(LeagueFileKind::identify_from_bytes(&head[..read]));
        }

        Ok(layers)
    }

    /// Every chunk of one packed WAD of `layer`, under the paths `resolver`
    /// gives.
    ///
    /// A deflated WAD is inflated here and kept in `inflated`, so later reads
    /// do not inflate it again.
    fn packed_files(
        reader: &mut FantomeReader<fs::File>,
        layer: &str,
        wad: &PackedWad,
        resolver: &dyn PathResolver,
        inflated: &mut HashMap<String, Arc<[u8]>>,
    ) -> AppResult<Vec<ProjectFile>> {
        if wad.stored {
            tracing::debug!("Reading {} where the archive stores it", wad.name);
            let Some(source) = reader.packed_wad_source(layer, &wad.name)? else {
                return Ok(Vec::new());
            };
            return scan_wad(&mut mounted(source)?, &wad.name, resolver);
        }

        let Some(bytes) = reader.read_packed_wad(layer, &wad.name)? else {
            return Ok(Vec::new());
        };
        // Logged because the run holds these bytes until it ends.
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

    /// One chunk of the layer's packed WAD the first segment of `path` names.
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

        let mut reader = open_fantome(&self.archive)?;
        let mut wad = reader
            .mount_packed_wad(&self.layer, wad_name)?
            .ok_or_else(|| AppError::Fantome(format!("{wad_name} is no longer packed")))?;
        chunk_of(&mut wad, wad_name, hash, limit)
    }

    /// One loose entry of the layer, located through [`layer_path`] as the scan
    /// located it.
    ///
    /// Matching through [`layer_path`] instead of rebuilding the prefix finds
    /// the entry whatever casing and prefix the archive uses.
    fn read_entry(&self, path: &str, limit: Option<usize>) -> AppResult<Vec<u8>> {
        let mut zip = open_zip(&self.archive)?;
        let name = zip
            .file_names()
            .find(|name| {
                layer_path(name).is_some_and(|(layer, at)| {
                    layer.eq_ignore_ascii_case(&self.layer) && at.eq_ignore_ascii_case(path)
                })
            })
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

fn open_zip(archive: &Path) -> AppResult<ZipArchive<fs::File>> {
    ZipArchive::new(fs::File::open(archive)?).map_err(|e| AppError::Fantome(e.to_string()))
}

/// A WAD over `source`, with its own error mapped onto the app's.
fn mounted<S: std::io::Read + std::io::Seek>(source: S) -> AppResult<Wad<S>> {
    Wad::mount(source).map_err(|e| AppError::Fantome(e.to_string()))
}

/// Every chunk of `wad` as a file of the layer, under `wad_name`.
///
/// Each path is the one an unpack writes the chunk to, which is the path a site
/// names.
fn scan_wad<S: std::io::Read + std::io::Seek>(
    wad: &mut Wad<S>,
    wad_name: &str,
    resolver: &dyn PathResolver,
) -> AppResult<Vec<ProjectFile>> {
    // Recover the paths the mod's own bins reference for its chunks. No
    // hashtable holds these author-made paths, and an unpack recovers them
    // before writing. Without this step the scan lists a chunk under its hash
    // where the tree lists it under a path.
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
        // A nameless chunk keeps the name the import writes it under: sixteen
        // hex digits and no extension, from NamingPolicy::Lossless, which
        // invents no names. The magic does not change the path, because the
        // tree holds the file under no other name and a repair cannot find a
        // site at a different path.
        let (path, kind) = match name {
            Some(named) => {
                let kind = match has_extension(&named) {
                    true => kind_of_path(&named),
                    /* Riot ships bins under names with no extension, so the
                    kind comes from the magic. */
                    false => sniffed_kind(wad, chunk, &mut decoder),
                };
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

/// The kind of a chunk, read from its decoded header.
///
/// Only the header is decoded, because a health check runs this scan over mods
/// of hundreds of megabytes. A chunk that does not decode is
/// [`WorkshopFileKind::Unknown`].
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

/// The archive's declared tables, then the caller's resolver.
///
/// This is the order an unpack resolves in. A mod's tables hold the paths its
/// author made up, and the caller's resolver holds the game's. A chunk named
/// differently from the unpack puts a problem at a site the repair cannot find.
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

/// The layer of the entry `entry_name`, as its WAD directory spells it, and the
/// entry's path inside that layer. `None` for an entry outside every layer.
///
/// The scan and the reads both use this mapping, so they agree on which entry a
/// site's path names. It follows `ltk_mod_project`'s fantome layout, the tree an
/// unpack writes, which puts `RAW/` entries under the base layer's `raw`
/// directory.
fn layer_path(entry_name: &str) -> Option<(&str, String)> {
    let (layer, path) = match classify_entry(entry_name)? {
        FantomeEntry::WadFile { layer, path } => (layer, path.to_owned()),
        FantomeEntry::Raw(relative) => (BASE_LAYER, format!("{RAW_DIR}/{relative}")),
        _ => return None,
    };

    // The tree walk skips names that begin with a dot. Listing one here would
    // raise a problem that the repair, which reads the tree, cannot fix.
    let hidden = path.split('/').any(|part| part.starts_with('.'));
    (!hidden).then_some((layer, path))
}

/// Where `layer` sits in `layers`, matched in any ASCII casing, appended when
/// no spelling of it is listed yet.
fn position_of(layers: &mut Vec<LayerEntries>, layer: &str) -> usize {
    if let Some(at) = layers
        .iter()
        .position(|held| held.layer.eq_ignore_ascii_case(layer))
    {
        return at;
    }

    layers.push(LayerEntries {
        layer: layer.to_owned(),
        ..LayerEntries::default()
    });
    layers.len() - 1
}

/// Whether a path's last segment has an extension.
///
/// A path with no extension may still be a bin.
fn has_extension(path: &str) -> bool {
    camino::Utf8Path::new(path).extension().is_some()
}

/// Fill `head` from the start of `reader`, and return the number of bytes read.
fn read_head<R: std::io::Read>(reader: &mut R, head: &mut [u8]) -> usize {
    let mut filled = 0;
    while filled < head.len() {
        match reader.read(&mut head[filled..]) {
            Ok(0) => break,
            Ok(n) => filled += n,
            Err(_) => break,
        }
    }
    filled
}

/// The kind a path's extension names, as the tree walk reads it.
fn kind_of_path(path: &str) -> WorkshopFileKind {
    let extension = camino::Utf8Path::new(path).extension().unwrap_or_default();
    WorkshopFileKind::from(LeagueFileKind::from_extension(extension))
}
