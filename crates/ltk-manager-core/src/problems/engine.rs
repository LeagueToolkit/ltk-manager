//! One pass of every rule over one project.
//!
//! A run lists each layer's files, hands them to each rule and collects what
//! the rules report. A rule that fails does not stop the run. The other files
//! still get their problems, and the panel names the file that could not be
//! read.
//!
//! Only [`LayerFiles`] knows where the files are. A project's files are in a
//! directory, and an archive's files are read from the archive without
//! unpacking it. The code above [`LayerSource`] is the same for both.

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
/// stored as a tree or as an archive. Any other file, such as a `RAW/` entry,
/// reaches the game another way and has no chunk hash.
const WAD_DIR_SUFFIX: &str = ".wad.client";

/// The files of one project, and what else a run hands every rule.
///
/// Built once per run and shared by every rule, so the content is listed only
/// once. The pass reads a file's bytes when a rule subscribes to them.
///
/// It also holds the installed build, the hash tables and the installed game's
/// content. Any rule may need them, and each costs the same whichever rule
/// reads it.
///
/// The build and the names are read when the files are listed. The caller
/// passes the game in, because it indexes a whole install, and building it per
/// mod would rebuild it for every mod of a sweep.
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
    /// question. `None` means no game is installed, and a rule that needs one
    /// reports that instead of guessing.
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

    /// List a fantome archive's files, one layer per layer the archive holds.
    ///
    /// The base layer is `WAD/` plus `RAW/`, and each other layer is a
    /// `WAD_<layer>/` directory.
    ///
    /// The archive is not unpacked. A packed WAD is read chunk by chunk, and a
    /// WAD stored as a directory of entries is read entry by entry, so a check
    /// reads only the bins it parses.
    ///
    /// `resolver` names a packed WAD's chunks the same way an unpack does, so a
    /// site has the same path in both cases. The archive's declared hash tables
    /// are read from its `hashes/` directory, where a project also keeps them.
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
            layers: scan.layers,
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
    /// `None` when no game is installed. A rule must not guess what the install
    /// holds in that case.
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
    /// A rule processes its files in parallel through this budget instead of
    /// its own pool, so all rules of all mods in progress share one allowance.
    #[must_use]
    pub fn budget(&self) -> &Budget {
        &self.budget
    }

    /// Every file of every layer, as something a rule can read.
    ///
    /// Each item is a handle rather than the bytes, so only [`FileHandle`]
    /// knows which layer source holds the file. A rule does not.
    pub fn files(&self) -> impl Iterator<Item = FileHandle<'_>> {
        self.layers.iter().flat_map(|layer| {
            layer
                .files
                .iter()
                .map(move |file| FileHandle { layer, file })
        })
    }

    /// The file at `path` in `layer`, where the project holds one.
    #[must_use]
    pub fn file(&self, layer: &str, path: &str) -> Option<FileHandle<'_>> {
        self.files()
            .find(|handle| handle.layer() == layer && handle.path() == path)
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

    /// Replace the file at `path` of `layer` with `bytes` for every later read.
    ///
    /// The file's size is set to the length of `bytes`, so a budget charges
    /// what a reader will hold. `false` for a file the project does not list,
    /// because a write cannot add a file.
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

    /// Remove the file at `path` of `layer` from the listing, after a removal.
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
    /// What a fix run wrote over this layer's files, by path, read before the
    /// source.
    ///
    /// A run over an archive cannot write to disk, so the bytes stay here
    /// until the archive is edited. A rule that runs after the writing rule
    /// reads them from here.
    written: HashMap<String, Arc<[u8]>>,
}

/// Where a layer's files are.
///
/// Separates which files a run sees from how a file's bytes are read. The
/// rules, the sites they report and the budget use the same code for both
/// sources.
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
    /// A file shorter than `limit` returns all of its bytes. An archive-backed
    /// file decompresses only the prefix, so a rule that reads a header does
    /// not decompress the whole chunk.
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
    /// An archive's entry, decompressed whole, because its compression cannot
    /// decompress less.
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
/// A known extension decides the kind, even when the content disagrees with
/// it. The exception is a file an unpack named by the hex of its chunk hash
/// because no table named it. That name identifies the chunk but not its kind,
/// so the file's first eight bytes decide. A bin the tables could not name is
/// still a bin the rules must read.
///
/// `at` is where the file is, and `relative` the path a site names it by.
fn kind_in_tree(at: &Path, relative: &str) -> WorkshopFileKind {
    let extension = at.extension().and_then(|extension| extension.to_str());
    let named = LeagueFileKind::from_extension(extension.unwrap_or_default());
    if named != LeagueFileKind::Unknown {
        return WorkshopFileKind::from(named);
    }

    /* A file with no extension, or one an unpack named by its hash. Riot
    ships some bins without an extension, such as `UX/FloatingText`, so the
    first bytes decide whether a rule reads such a file. A file with an
    unknown extension is not content and stays unknown. */
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
    /// An entry the walk cannot read is logged and skipped, so the rest of the
    /// layer is still listed.
    fn read(dir: &Path, name: &str) -> Self {
        let walk = WalkDir::new(dir)
            .follow_links(false)
            .into_iter()
            .filter_entry(|entry| {
                // The walk starts at the layer root, whose name the project
                // does not control. A temp directory may begin with a dot.
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

    /// One layer of an archive, read through `source`.
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
    /// `None` for a layer read from an archive, whose files have no path on
    /// disk. A rule reads through [`FileHandle::bytes`] and does not need to
    /// know which case applies.
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
/// and reads it at most once, so a check and the repair that follows it read
/// the file only once.
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

    /// The file's unpacked size, the unit a budget is charged in.
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
    /// Read from the chunk when the file is in a packed WAD, and derived from
    /// the path otherwise. A mod unpacked into a tree then has the same hashes
    /// as the archive it came from, so a rule can look up either in the
    /// installed game.
    ///
    /// `None` for a file outside the mod's WADs, which the game does not
    /// address by hash.
    #[must_use]
    pub fn wad_hash(&self) -> Option<WadHash> {
        if let Some(chunk) = self.chunk() {
            return Some(chunk.hash);
        }

        let (wad, inside) = self.path().split_once('/')?;
        if !wad.to_ascii_lowercase().ends_with(WAD_DIR_SUFFIX) {
            return None;
        }

        // An unpack names a chunk no table named by the hex of its hash, so the
        // name is parsed as the hash rather than hashed as a path.
        let relative = camino::Utf8Path::new(inside);
        if is_hex_chunk_path(relative) {
            return relative
                .file_stem()
                .and_then(|hex| u64::from_str_radix(hex, 16).ok())
                .map(WadHash);
        }
        Some(WadHash::hash_str(inside))
    }

    /// Where the file is on disk, for a file on disk.
    ///
    /// See [`LayerFiles::absolute`] for the `None`.
    #[must_use]
    pub fn absolute(&self) -> Option<PathBuf> {
        self.layer.absolute(self.file)
    }

    /// At most `limit` bytes from the start of the file.
    ///
    /// A file shorter than `limit` returns all of its bytes without an error.
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
    /// A `PTCH` bin carries objects like a `PROP` bin, so a rule that walks
    /// objects reads both without checking which kind it has.
    ///
    /// # Errors
    ///
    /// Reports the file it could not open or parse, as one sentence a panel
    /// can draw.
    pub fn bin(&self) -> Result<ltk_meta::BinFile, String> {
        parse_bin(&self.bytes()?)
    }
}

/// Parse `bytes` as a bin of either kind, failing with one sentence a panel can draw.
pub(crate) fn parse_bin(bytes: &[u8]) -> Result<ltk_meta::BinFile, String> {
    ltk_meta::BinFile::from_reader(&mut std::io::Cursor::new(bytes)).map_err(|e| e.to_string())
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
    /// `None` for a file of a directory layer and for an archive's loose
    /// entries. This is a normal state, not an error, and it is the only
    /// difference between the two layer sources that a rule can see.
    pub chunk: Option<ChunkInfo>,
}

/// What a packed WAD's table of contents records about one chunk.
///
/// Read from the table the scan already walks, so a rule about how a mod was
/// packed decompresses nothing.
///
/// The hash is kept here rather than in its own field on [`ProjectFile`],
/// because two `Option`s that must always agree are an invariant the type
/// cannot enforce. A chunk is addressed by hash, and its path comes from a
/// hashtable lookup of that hash. So the hash cannot be recovered from the
/// path, and a chunk no table names has no path.
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
/// The archive is not unpacked, so a check reads only the bins it parses.
/// `resolver` names a packed WAD's chunks the same way an unpack does, so a
/// site has the same path in both cases.
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

        // The panel shows this list in the order it arrives, so the engine
        // sorts it: worst first, then by where the problem is.
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
    /// In file order and unsorted, for a test of one rule.
    /// [`checked`](Self::checked) sorts it into a run.
    #[must_use]
    pub(crate) fn report(&self, rules: &[&dyn Rule]) -> Report {
        super::pass::run(self, rules)
    }

    /// Compute one fact over these files, in a bin round of its own.
    ///
    /// For a repair, which reads the mod in its current state and cannot reuse
    /// the check's pass.
    #[must_use]
    pub fn fact<F: Fact>(&self) -> F {
        super::pass::fact(self)
    }
}

#[cfg(test)]
mod tests;
