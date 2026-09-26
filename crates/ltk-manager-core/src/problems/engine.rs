//! One pass of every rule over one project.
//!
//! A run lists each layer's files, hands them to each rule and collects what
//! the rules report. A rule that throws does not take the run with it: a
//! project with one unreadable `.bin` still gets every problem in the other
//! forty, and the panel names the file it could not read.
//!
//! Where those files are is [`LayerFiles`]'s business alone. A project's are a
//! directory, and an archive's are the archive - read where it lies, never
//! unpacked. Everything above [`LayerSource`] is written once for both.

mod archive;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use chrono::Utc;
use fs_err as fs;
use ltk_file::LeagueFileKind;
use ltk_hash::Hash as _;
use ltk_wad::{PathResolver, WadChunk, WadChunkCompression, WadHash, is_hex_chunk_path};
use walkdir::WalkDir;

use crate::config::Config;
use crate::error::AppResult;
use crate::workshop::layer;
use crate::workshop::{ProjectDir, WorkshopFileKind};

use archive::ArchiveFiles;

use super::budget::{self, Budget};
use super::game::GameContent;
use super::pass::Fact;
use super::{BinNames, GameBuild, ObjectInfo, Report, Rule, RuleState, Run};

/// The directory a project keeps its layers under.
const CONTENT_DIR: &str = "content";

/// The suffix naming a layer directory that is one of the mod's WADs.
///
/// A file under one is a chunk the game addresses by hash, whether the mod is
/// stored as a tree or as an archive. Anything else - a `RAW/` entry, say -
/// reaches the game another way and has no chunk hash at all.
const WAD_DIR_SUFFIX: &str = ".wad.client";

/// The files of one project, and what else a run hands every rule.
///
/// Built once for a run and shared by every rule, because listing the content
/// is the one cost worth paying exactly once. Reading a file's bytes is the
/// pass's business, on a rule's subscription.
///
/// The installed build, the hash tables and the installed game's content ride
/// here too. A rule needs all of them to decide what it has to say, and each
/// costs the same whichever rule reads it.
///
/// The build and the names are read from the project. The game is handed in,
/// because it is an index over a whole install and building one per mod would
/// make a sweep pay for it once a mod.
#[derive(Debug)]
pub struct ProjectFiles {
    root: PathBuf,
    layers: Vec<LayerFiles>,
    build: Option<GameBuild>,
    names: Arc<BinNames>,
    budget: Budget,
    game: Option<Arc<dyn GameContent>>,
}

impl ProjectFiles {
    /// Walk `project_root`'s content directory, in every layer.
    ///
    /// `game` is what the installed game holds, for the rules that ask it a
    /// question. `None` is a machine with no install, and a rule that needs one
    /// says so rather than guessing.
    ///
    /// # Errors
    ///
    /// Reports a project whose `content/` directory cannot be read at all. An
    /// unreadable file inside it is skipped and logged, never fatal.
    pub fn read(
        project_root: &Path,
        config: &Config,
        game: Option<Arc<dyn GameContent>>,
    ) -> AppResult<Self> {
        Self::within(project_root, config, Budget::repair(), game)
    }

    /// [`read`](Self::read) under a caller's own budget.
    ///
    /// # Errors
    ///
    /// The same as [`read`](Self::read).
    pub fn within(
        project_root: &Path,
        config: &Config,
        budget: Budget,
        game: Option<Arc<dyn GameContent>>,
    ) -> AppResult<Self> {
        let content_dir = project_root.join(CONTENT_DIR);
        let layers = if content_dir.exists() {
            layer::dirs_in(&content_dir)?
                .iter()
                .map(|dir| {
                    let name = dir
                        .file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or_default();
                    LayerFiles::read(dir, name)
                })
                .collect()
        } else {
            Vec::new()
        };

        Ok(Self {
            root: project_root.to_path_buf(),
            layers,
            build: GameBuild::installed(config),
            names: Arc::new(BinNames::open(project_root)),
            budget,
            game,
        })
    }

    /// List a fantome archive's files, reading them where the archive keeps
    /// them.
    ///
    /// The archive is never unpacked. A packed WAD is read chunk by chunk and
    /// a WAD kept as a directory of entries entry by entry, so a check costs
    /// the bins it parses rather than the tree an unpack would have written.
    ///
    /// `resolver` names a packed WAD's chunks, the same resolver an unpack
    /// would have named them with, so a site addresses the same path either
    /// way. The archive's own declared tables are read from inside it, which
    /// is where a project keeps them under `hashes/`.
    ///
    /// # Errors
    ///
    /// Reports an archive that cannot be opened or whose entry table cannot be
    /// read. A single WAD that will not mount is logged and skipped.
    pub fn in_archive(
        archive: &Path,
        config: &Config,
        budget: Budget,
        resolver: &dyn PathResolver,
        game: Option<Arc<dyn GameContent>>,
    ) -> AppResult<Self> {
        let scan = ArchiveFiles::scan(archive, resolver)?;

        Ok(Self {
            root: archive.to_path_buf(),
            layers: vec![scan.layer],
            build: GameBuild::installed(config),
            names: Arc::new(BinNames::with_declared(scan.tables)),
            budget,
            game,
        })
    }

    /// Where the content was read from: a project's directory, or an archive.
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The layers, in the order the content directory lists them.
    #[must_use]
    pub fn layers(&self) -> &[LayerFiles] {
        &self.layers
    }

    /// The installed game's content build, where one could be read.
    #[must_use]
    pub fn build(&self) -> Option<GameBuild> {
        self.build
    }

    /// What the installed game holds, where there is an install to ask.
    ///
    /// `None` on a machine with no game, which is the honest answer to a
    /// question about the install rather than a reason to guess at one.
    #[must_use]
    pub fn game(&self) -> Option<&dyn GameContent> {
        self.game.as_deref()
    }

    /// The names a row can give the hashes a bin holds.
    #[must_use]
    pub fn names(&self) -> &BinNames {
        &self.names
    }

    /// The same names, shared, for a fix run that holds them across its
    /// writes.
    pub(crate) fn names_shared(&self) -> Arc<BinNames> {
        Arc::clone(&self.names)
    }

    /// The memory this run may hold parsed at once, and its cancel flag.
    ///
    /// A rule fans its own files out through this rather than over a pool of
    /// its own, so every rule of every mod in flight spends one allowance.
    #[must_use]
    pub fn budget(&self) -> &Budget {
        &self.budget
    }

    /// Every file of every layer, as something a rule can read.
    ///
    /// The seam a rule reads through: it names the files and hands back a
    /// handle rather than the bytes, so which layer source is underneath is
    /// [`FileHandle`]'s business and never a rule's.
    pub fn files(&self) -> impl Iterator<Item = FileHandle<'_>> {
        self.layers.iter().flat_map(|layer| {
            layer
                .files
                .iter()
                .map(move |file| FileHandle { layer, file })
        })
    }

    /// Every file of every layer that reports `kind`.
    pub fn of_kind(&self, kind: WorkshopFileKind) -> impl Iterator<Item = FileHandle<'_>> {
        self.files().filter(move |handle| handle.kind() == kind)
    }

    /// Every property bin of every layer, override bins included.
    pub fn bins(&self) -> impl Iterator<Item = FileHandle<'_>> {
        self.of_kind(WorkshopFileKind::PropertyBin)
            .chain(self.of_kind(WorkshopFileKind::PropertyBinOverride))
    }

    /// How many files the whole project holds.
    fn file_count(&self) -> usize {
        self.layers.iter().map(|layer| layer.files.len()).sum()
    }

    /// Remove every property bin whose bytes equal the installed game's copy.
    ///
    /// The overlay does not ship such a file, so a finding in it has no effect
    /// in game. A bin whose size differs from the game's table of contents is
    /// kept without reading either copy. A bin not compared before the run was
    /// cancelled is kept.
    #[must_use]
    pub(crate) fn without_game_copies(mut self) -> Self {
        let Some(installed) = self.game.clone() else {
            return self;
        };
        let game = installed.as_ref();

        let candidates: Vec<(usize, usize, WadHash)> = self
            .layers
            .iter()
            .enumerate()
            .flat_map(|(at_layer, layer)| {
                layer
                    .files
                    .iter()
                    .enumerate()
                    .filter_map(move |(at_file, file)| {
                        if file.kind != WorkshopFileKind::PropertyBin {
                            return None;
                        }
                        let hash = FileHandle { layer, file }.wad_hash()?;
                        (game.size(hash) == Some(file.size_bytes))
                            .then_some((at_layer, at_file, hash))
                    })
            })
            .collect();

        let copies = self.budget.map(
            &candidates,
            budget::files_at_once(),
            |&(at_layer, at_file, _)| 2 * self.layers[at_layer].files[at_file].size_bytes,
            |&(at_layer, at_file, hash)| {
                let layer = &self.layers[at_layer];
                let handle = FileHandle {
                    layer,
                    file: &layer.files[at_file],
                };
                handle.bytes().is_ok_and(|ours| {
                    game.read(hash)
                        .is_ok_and(|theirs| theirs.is_some_and(|theirs| theirs == ours))
                })
            },
        );

        let mut dropped = vec![Vec::new(); self.layers.len()];
        for (&(at_layer, at_file, _), copy) in candidates.iter().zip(copies) {
            if copy == Some(true) {
                dropped[at_layer].push(at_file);
            }
        }

        let count: usize = dropped.iter().map(Vec::len).sum();
        for (layer, dropped) in self.layers.iter_mut().zip(dropped) {
            let mut at_file = 0;
            layer.files.retain(|_| {
                let keep = dropped.binary_search(&at_file).is_err();
                at_file += 1;
                keep
            });
        }

        if count > 0 {
            tracing::debug!(
                "Skipping {count} bins of {} equal to the installed game's copy",
                self.root.display()
            );
        }
        self
    }

    /// Lay `bytes` over the file at `path` of `layer`, for every read after.
    ///
    /// The file's size follows the bytes, so a budget charges what a reader
    /// will hold. `false` for a file the project does not list, which a write
    /// cannot add.
    pub(crate) fn wrote(&mut self, layer: &str, path: &str, bytes: Arc<[u8]>) -> bool {
        let Some(layer) = self.layers.iter_mut().find(|held| held.name == layer) else {
            return false;
        };
        let Some(file) = layer.files.iter_mut().find(|file| file.path == path) else {
            return false;
        };
        file.size_bytes = bytes.len() as u64;
        layer.written.insert(path.to_owned(), bytes);
        true
    }

    /// Drop the file at `path` of `layer` from the listing, as a removal
    /// leaves it.
    ///
    /// `false` for a file the project does not list.
    pub(crate) fn dropped(&mut self, layer: &str, path: &str) -> bool {
        let Some(layer) = self.layers.iter_mut().find(|held| held.name == layer) else {
            return false;
        };
        let listed = layer.files.len();
        layer.files.retain(|file| file.path != path);
        layer.written.remove(path);
        layer.files.len() != listed
    }
}

/// The files of one layer, and where to read one.
#[derive(Debug, Clone)]
pub struct LayerFiles {
    /// The layer's own name, such as `base`.
    pub name: String,
    pub files: Vec<ProjectFile>,
    source: LayerSource,
    /// What a fix run wrote over this layer's files, by path, read ahead of
    /// the source.
    ///
    /// A run over an archive has nowhere on disk to put a write, so the bytes
    /// stay here until the edit, and a rule that runs after the one that wrote
    /// reads them here.
    written: HashMap<String, Arc<[u8]>>,
}

/// Where a layer's files are.
///
/// The seam between "which files a run sees" and "what a file's bytes are".
/// Everything above it - the rules, the sites they report, the budget they
/// spend - is written once and reads both.
#[derive(Debug, Clone)]
enum LayerSource {
    /// A directory on disk, holding each file at its own path under this root.
    Directory(PathBuf),
    /// A fantome archive, shared by every handle that reads out of it.
    Archive(Arc<ArchiveFiles>),
}

impl LayerSource {
    /// The bytes of one of the layer's files.
    fn read(&self, file: &ProjectFile) -> Result<Vec<u8>, String> {
        match self {
            Self::Directory(root) => fs::read(absolute(root, file)).map_err(|e| e.to_string()),
            Self::Archive(archive) => archive.read(file),
        }
    }

    /// One of the layer's files, open for reading and seeking.
    fn open(&self, file: &ProjectFile) -> Result<Opened, String> {
        match self {
            Self::Directory(root) => {
                let at = absolute(root, file);
                fs::File::open(&at)
                    .map(Opened::File)
                    .map_err(|e| format!("{}: {e}", at.display()))
            }
            Self::Archive(archive) => archive
                .read(file)
                .map(|bytes| Opened::Memory(std::io::Cursor::new(bytes))),
        }
    }

    /// At most `limit` bytes from the start of one of the layer's files.
    ///
    /// A file shorter than `limit` answers with what it has. An archive-backed
    /// file decompresses only the prefix, which is what keeps a rule judging
    /// from a header off the whole of a chunk.
    fn head(&self, file: &ProjectFile, limit: usize) -> Result<Vec<u8>, String> {
        match self {
            Self::Directory(root) => {
                let at = absolute(root, file);
                let mut bytes = Vec::new();
                fs::File::open(&at)
                    .and_then(|opened| {
                        std::io::Read::read_to_end(
                            &mut std::io::Read::take(opened, limit as u64),
                            &mut bytes,
                        )
                    })
                    .map_err(|e| format!("{}: {e}", at.display()))?;
                Ok(bytes)
            }
            Self::Archive(archive) => archive.head(file, limit),
        }
    }
}

/// A project file open for reading, wherever its layer keeps it.
#[derive(Debug)]
pub enum Opened {
    /// A file of a directory layer, read from disk as it is asked for, so a
    /// reader that seeks holds only what it asked for.
    File(fs::File),
    /// An archive's entry, decompressed whole: the smallest unit its
    /// compression hands out.
    Memory(std::io::Cursor<Vec<u8>>),
}

impl std::io::Read for Opened {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        match self {
            Self::File(file) => file.read(buf),
            Self::Memory(bytes) => bytes.read(buf),
        }
    }
}

impl std::io::Seek for Opened {
    fn seek(&mut self, pos: std::io::SeekFrom) -> std::io::Result<u64> {
        match self {
            Self::File(file) => file.seek(pos),
            Self::Memory(bytes) => bytes.seek(pos),
        }
    }
}

/// Where `file` sits under a directory layer's `root`.
fn absolute(root: &Path, file: &ProjectFile) -> PathBuf {
    root.join(file.path.replace('/', std::path::MAIN_SEPARATOR_STR))
}

/// What one file of a tree is, by its extension or by its first bytes.
///
/// An extension is what names a file, so it decides wherever there is one to
/// read, which leaves a file whose extension disagrees with its content read as
/// what it claims to be. The exception is the bare hex an unpack writes a chunk
/// as when nothing named it: that name says only which chunk, never what, so
/// the file is opened for the eight bytes that do say - a bin the tables could
/// not name is still a bin the rules have to read.
///
/// `at` is where the file is, and `relative` the path a site names it by.
fn kind_in_tree(at: &Path, relative: &str) -> WorkshopFileKind {
    let extension = at.extension().and_then(|extension| extension.to_str());
    let named = LeagueFileKind::from_extension(extension.unwrap_or_default());
    if named != LeagueFileKind::Unknown {
        return WorkshopFileKind::from(named);
    }

    /* A file with no extension at all, or one an unpack named by its hash.
    Riot ships bins under a bare name - `UX/FloatingText` is one - and an
    extension is the only thing a walk has to go on, so without one the
    first bytes are what says whether a rule should read it. A file whose
    extension simply names nothing is left alone: it is not content. */
    if extension.is_some() && !is_hex_chunk_path(camino::Utf8Path::new(relative)) {
        return WorkshopFileKind::from(named);
    }

    let sniffed = fs::File::open(at)
        .and_then(|mut file| LeagueFileKind::identify_from_reader(&mut file))
        .unwrap_or_else(|e| {
            tracing::debug!("Could not read the first bytes of {}: {e}", at.display());
            LeagueFileKind::Unknown
        });
    WorkshopFileKind::from(sniffed)
}

impl LayerFiles {
    /// Walk one layer's content directory, recursively.
    ///
    /// An entry the walk cannot read is logged and skipped, because one
    /// unreadable directory is no reason to report nothing about the rest.
    fn read(dir: &Path, name: &str) -> Self {
        let walk = WalkDir::new(dir)
            .follow_links(false)
            .into_iter()
            .filter_entry(|entry| {
                // The walk starts at the layer root, whose basename is out of
                // the project's hands - a temp directory may begin with a dot.
                entry.depth() == 0
                    || entry
                        .file_name()
                        .to_str()
                        .is_some_and(|name| !name.starts_with('.'))
            });

        let mut files = Vec::new();
        for entry in walk {
            let entry = match entry {
                Ok(entry) => entry,
                Err(e) => {
                    tracing::warn!("Skipping unreadable entry in {}: {e}", dir.display());
                    continue;
                }
            };

            if !entry.file_type().is_file() {
                continue;
            }

            let path = entry
                .path()
                .strip_prefix(dir)
                .unwrap_or_else(|_| entry.path())
                .components()
                .filter_map(|part| part.as_os_str().to_str())
                .collect::<Vec<_>>()
                .join("/");

            files.push(ProjectFile {
                kind: kind_in_tree(entry.path(), &path),
                path,
                size_bytes: entry.metadata().map(|meta| meta.len()).unwrap_or(0),
                chunk: None,
            });
        }

        files.sort_by(|a, b| a.path.cmp(&b.path));

        Self {
            name: name.to_owned(),
            files,
            source: LayerSource::Directory(dir.to_path_buf()),
            written: HashMap::new(),
        }
    }

    /// The layer an archive holds, reading back through `source`.
    fn in_archive(name: &str, files: Vec<ProjectFile>, source: ArchiveFiles) -> Self {
        Self {
            name: name.to_owned(),
            files,
            source: LayerSource::Archive(Arc::new(source)),
            written: HashMap::new(),
        }
    }

    /// Where one of this layer's files is on disk, for a layer on disk.
    ///
    /// `None` for a layer read out of an archive, whose files have no path of
    /// their own - which is what [`FileHandle::bytes`] exists to spare a rule
    /// having to know.
    #[must_use]
    pub fn absolute(&self, file: &ProjectFile) -> Option<PathBuf> {
        match &self.source {
            LayerSource::Directory(root) => Some(absolute(root, file)),
            LayerSource::Archive(_) => None,
        }
    }
}

/// One file of one layer, not yet read.
///
/// Names where the file is and opens it on demand. A rule holds one per file
/// and reads at most once, which is what keeps a check and the repair that
/// follows it to a single read.
#[derive(Debug, Clone, Copy)]
pub struct FileHandle<'a> {
    layer: &'a LayerFiles,
    file: &'a ProjectFile,
}

impl<'a> FileHandle<'a> {
    /// The layer this file sits in, such as `base`.
    #[must_use]
    pub fn layer(&self) -> &'a str {
        &self.layer.name
    }

    /// The file's path, POSIX-style and relative to the layer root.
    #[must_use]
    pub fn path(&self) -> &'a str {
        &self.file.path
    }

    /// What the file is, by its extension or by its first bytes.
    #[must_use]
    pub fn kind(&self) -> WorkshopFileKind {
        self.file.kind
    }

    /// The file's size unpacked, which is what a budget is spent in.
    #[must_use]
    pub fn size_bytes(&self) -> u64 {
        self.file.size_bytes
    }

    /// What the packed WAD holding this file records about it.
    ///
    /// See [`ProjectFile::chunk`] for the `None`.
    #[must_use]
    pub fn chunk(&self) -> Option<&'a ChunkInfo> {
        self.file.chunk.as_ref()
    }

    /// The hash the WAD holding this file addresses it by.
    ///
    /// Read off the chunk where a packed WAD is where the file lives, and
    /// derived from the path otherwise - so a mod unpacked into a tree answers
    /// the same hash as the archive it came from, which is what lets a rule ask
    /// the installed game about either.
    ///
    /// `None` for a file that is not inside one of the mod's WADs, which is a
    /// file the game addresses no other way.
    #[must_use]
    pub fn wad_hash(&self) -> Option<WadHash> {
        if let Some(chunk) = self.chunk() {
            return Some(chunk.hash);
        }

        let (wad, inside) = self.path().split_once('/')?;
        if !wad.to_ascii_lowercase().ends_with(WAD_DIR_SUFFIX) {
            return None;
        }

        // An unpack writes a chunk no table named as the hex of its hash, which
        // is the hash itself rather than a path to hash.
        let relative = camino::Utf8Path::new(inside);
        if is_hex_chunk_path(relative) {
            return relative
                .file_stem()
                .and_then(|hex| u64::from_str_radix(hex, 16).ok())
                .map(WadHash);
        }
        Some(WadHash::hash_str(inside))
    }

    /// Where the file sits on disk, where it sits on disk at all.
    ///
    /// See [`LayerFiles::absolute`] for the `None`.
    #[must_use]
    pub fn absolute(&self) -> Option<PathBuf> {
        self.layer.absolute(self.file)
    }

    /// At most `limit` bytes from the start of the file.
    ///
    /// A file shorter than `limit` answers with what it has, because a rule
    /// judging from a header has nothing to require of the rest.
    ///
    /// # Errors
    ///
    /// Reports the file it could not open, as one sentence a panel can draw.
    pub fn head(&self, limit: usize) -> Result<Vec<u8>, String> {
        if let Some(written) = self.written() {
            return Ok(written[..written.len().min(limit)].to_vec());
        }
        self.layer.source.head(self.file, limit)
    }

    /// The whole file.
    ///
    /// # Errors
    ///
    /// Reports the file it could not open, as one sentence a panel can draw.
    pub fn bytes(&self) -> Result<Vec<u8>, String> {
        if let Some(written) = self.written() {
            return Ok(written.to_vec());
        }
        self.layer.source.read(self.file)
    }

    /// The file, open for a reader that seeks, such as a streaming bin reader.
    ///
    /// # Errors
    ///
    /// Reports the file it could not open, as one sentence a panel can draw.
    pub fn open(&self) -> Result<Opened, String> {
        if let Some(written) = self.written() {
            return Ok(Opened::Memory(std::io::Cursor::new(written.to_vec())));
        }
        self.layer.source.open(self.file)
    }

    /// What a fix run wrote over this file, where it wrote anything.
    fn written(&self) -> Option<&'a Arc<[u8]>> {
        self.layer.written.get(&self.file.path)
    }

    /// Parse the file as a bin of either kind.
    ///
    /// A `PTCH` is as much a bin as a `PROP` and carries objects of its own, so
    /// a rule that walks objects reads both and never has to ask which it got.
    ///
    /// # Errors
    ///
    /// Reports the file it could not open or parse, as one sentence a panel
    /// can draw.
    pub fn bin(&self) -> Result<ltk_meta::BinFile, String> {
        let bytes = self.bytes()?;
        ltk_meta::BinFile::from_reader(&mut std::io::Cursor::new(&bytes)).map_err(|e| e.to_string())
    }
}

/// One file of one layer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectFile {
    /// Relative to the layer root, always POSIX-style.
    pub path: String,
    pub kind: WorkshopFileKind,
    pub size_bytes: u64,
    /// What the packed WAD holding this file records about it, where a packed
    /// WAD is where it lives.
    ///
    /// Absent for a file of a directory layer and for an archive's loose
    /// entries. That absence is a normal state rather than an error: it is the
    /// one difference between the two layer sources a rule can see.
    pub chunk: Option<ChunkInfo>,
}

/// What a packed WAD's table of contents records about one chunk.
///
/// Read off the table the scan already walks, so a rule about how a mod was
/// packed costs no decompression at all.
///
/// The hash rides here rather than beside it, because it is a fact about the
/// chunk like the rest of them and because two `Option`s that must always agree
/// is an invariant an interface cannot state. A chunk is addressed by hash, and
/// its path is only what a hashtable made of that hash - so the hash cannot be
/// read back out of the path, and a chunk no table names has no path to read it
/// out of at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChunkInfo {
    pub hash: WadHash,
    pub compression: WadChunkCompression,
    /// What the chunk occupies inside the WAD.
    pub compressed_size: u64,
    /// What it occupies once decompressed, which is [`ProjectFile::size_bytes`].
    pub uncompressed_size: u64,
    /// The checksum the WAD stores for the chunk.
    pub checksum: u64,
}

impl From<&WadChunk> for ChunkInfo {
    fn from(chunk: &WadChunk) -> Self {
        Self {
            hash: chunk.path_hash,
            compression: chunk.compression_type,
            compressed_size: chunk.compressed_size as u64,
            uncompressed_size: chunk.uncompressed_size as u64,
            checksum: chunk.checksum,
        }
    }
}

/// Run every rule over one project.
///
/// # Errors
///
/// Reports a project that cannot be opened or whose content directory cannot
/// be read. A rule that fails is recorded in [`Run::failed`] rather than
/// failing the run.
pub fn analyze(
    project_root: &Path,
    config: &Config,
    game: Option<Arc<dyn GameContent>>,
) -> AppResult<Run> {
    analyze_within(project_root, config, Budget::repair(), game)
}

/// [`analyze`] under a caller's own budget.
///
/// # Errors
///
/// The same as [`analyze`].
pub fn analyze_within(
    project_root: &Path,
    config: &Config,
    budget: Budget,
    game: Option<Arc<dyn GameContent>>,
) -> AppResult<Run> {
    let project = ProjectDir::open(project_root)?;
    Ok(ProjectFiles::within(project.path(), config, budget, game)?.checked())
}

/// One pass of every rule over a fantome archive, read where it lies.
///
/// The archive is never unpacked, so a check costs the bins it parses rather
/// than the whole of the tree an unpack would have written. `resolver` names
/// a packed WAD's chunks, exactly as it does for an unpack, so a site
/// addresses the same path either way.
///
/// # Errors
///
/// Reports an archive that cannot be opened or whose entry table cannot be
/// read. A rule that fails is recorded in [`Run::failed`] rather than failing
/// the run.
pub fn analyze_archive(
    archive: &Path,
    config: &Config,
    budget: Budget,
    resolver: &dyn PathResolver,
    game: Option<Arc<dyn GameContent>>,
) -> AppResult<Run> {
    Ok(ProjectFiles::in_archive(archive, config, budget, resolver, game)?.checked())
}

impl ProjectFiles {
    /// Run every rule over these files, and collect what they report.
    #[must_use]
    pub(crate) fn checked(&self) -> Run {
        let started = Instant::now();
        let at = Utc::now();

        let all = super::rules::all();
        let rules = all
            .iter()
            .map(|rule| {
                let mut info = rule.info();
                if let Some(dormancy) = rule.dormant(self) {
                    info.state = RuleState::Dormant {
                        waiting: dormancy.waiting,
                        reason: dormancy.reason,
                    };
                }
                info
            })
            .collect();
        let subscribed: Vec<&dyn Rule> = all.iter().map(AsRef::as_ref).collect();
        let (mut problems, failed) = self.report(&subscribed).finish();

        // The panel draws this list in the order it arrives, so the order is
        // the engine's to decide: worst first, then by where the problem is.
        problems.sort_by(|a, b| {
            a.severity
                .cmp(&b.severity)
                .then_with(|| a.site.layer.cmp(&b.site.layer))
                .then_with(|| a.site.path.cmp(&b.site.path))
                .then_with(|| {
                    let a = a.site.node.as_ref().map(|node| node.path.as_str());
                    let b = b.site.node.as_ref().map(|node| node.path.as_str());
                    a.cmp(&b)
                })
        });

        let objects = ObjectInfo::catalogue(&problems, self.names());

        tracing::trace!(
            "Analyzed {} files of {}: {} problems, {} rule failures, in {:?}",
            self.file_count(),
            self.root.display(),
            problems.len(),
            failed.len(),
            started.elapsed()
        );

        Run {
            at,
            rules,
            objects,
            problems,
            failed,
        }
    }

    /// One pass of `rules` over these files, as the rules reported it.
    ///
    /// In file order and unsorted, which is what a test of one rule reads.
    /// [`checked`](Self::checked) sorts it into a run.
    #[must_use]
    pub(crate) fn report(&self, rules: &[&dyn Rule]) -> Report {
        super::pass::run(self, rules)
    }

    /// Compute one fact over these files, in a bin round of its own.
    ///
    /// For a repair, which reads the mod as it is now and cannot ride the
    /// check's pass.
    #[must_use]
    pub fn fact<F: Fact>(&self) -> F {
        super::pass::fact(self)
    }
}

#[cfg(test)]
mod tests;
