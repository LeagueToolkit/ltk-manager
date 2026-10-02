//! Read-only browsing of an install's WAD archives: the game's under `DATA/FINAL` and the
//! League client's under `Plugins`.

use fs_err as fs;
use std::fmt;
use std::io::{BufReader, Read, Seek};
use std::num::NonZeroUsize;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use lru::LruCache;
use ltk_hashdb::LayeredHashDb;
use ltk_wad::{ChunkDecoder, Wad, WadChunk, WadError, WadHash};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use crate::config::Config;
use crate::error::{AppError, AppResult};
use crate::utils::game::GameDir;
use crate::utils::natural_order::compare_names;
use crate::utils::path::resolve_within;

/// Which set of an install's archives a reader browses.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum WadSource {
    /// The game's `*.wad.client` archives under `Game/DATA/FINAL`.
    #[default]
    Game,
    /// The League client's `*.wad` archives under `Plugins`.
    Lcu,
}

impl WadSource {
    /// The lowercase file name ending an archive of this source carries.
    fn extension(self) -> &'static str {
        match self {
            Self::Game => ".wad.client",
            Self::Lcu => ".wad",
        }
    }
}

/// One WAD archive in a game install.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct GameWadSummary {
    /// Path relative to the source's archive root with forward slashes, e.g.
    /// `Champions/Aatrox.wad.client` or `rcp-fe-lol-loot/assets.wad`.
    pub name: String,
    /// Archive file size on disk, or 0 when it cannot be read.
    pub size_bytes: u64,
}

/// One chunk of a WAD archive.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct GameWadEntry {
    /// Chunk path hash as 16 lowercase hex digits.
    pub path_hash: String,
    /// Resolved chunk path, or `None` when no hashtable knows the hash.
    pub path: Option<String>,
    /// Uncompressed chunk size.
    pub size_bytes: u64,
}

/// Read-only view of one source's WAD archives in an install.
///
/// An archive name is relative to the source's root: `DATA/FINAL` for the game and `Plugins`
/// for the League client.
#[derive(Debug, Clone)]
pub struct GameArchives {
    root: PathBuf,
    source: WadSource,
}

impl GameArchives {
    /// Resolve the game's archives from the configured League path.
    ///
    /// # Errors
    ///
    /// Fails with [`AppError::LeagueNotFound`] when no League path is
    /// configured, and with [`AppError::ValidationFailed`] when the configured
    /// path does not look like an install.
    pub fn resolve(config: &Config) -> AppResult<Self> {
        Self::resolve_source(config, WadSource::Game)
    }

    /// Resolve one source's archives from the configured League path.
    ///
    /// # Errors
    ///
    /// The same conditions as [`resolve`](Self::resolve).
    pub fn resolve_source(config: &Config, source: WadSource) -> AppResult<Self> {
        if config.league_path.is_none() {
            return Err(AppError::LeagueNotFound);
        }

        let game_dir = GameDir::resolve(config)?;
        Ok(match source {
            WadSource::Game => Self::at(game_dir.path()),
            WadSource::Lcu => Self::lcu_at(&game_dir.lcu_plugins_dir()),
        })
    }

    /// View an already-resolved game directory (the one containing `DATA`).
    pub fn at(game_dir: &Path) -> Self {
        Self {
            root: game_dir.join("DATA").join("FINAL"),
            source: WadSource::Game,
        }
    }

    /// View the League client's archives under an already-resolved `Plugins` directory.
    pub fn lcu_at(plugins_dir: &Path) -> Self {
        Self {
            root: plugins_dir.to_path_buf(),
            source: WadSource::Lcu,
        }
    }

    /// The set of archives this view reads.
    #[must_use]
    pub fn source(&self) -> WadSource {
        self.source
    }

    /// Enumerate every archive of the source under its root, sorted by name.
    ///
    /// The extension match is case-insensitive. Unreadable subdirectories are
    /// logged and skipped.
    ///
    /// # Errors
    ///
    /// Fails with [`AppError::ValidationFailed`] when the root itself does not
    /// exist.
    pub fn list(&self) -> AppResult<Vec<GameWadSummary>> {
        if !self.root.is_dir() {
            return Err(AppError::ValidationFailed(format!(
                "Archive directory does not exist: {}",
                self.root.display()
            )));
        }

        let extension = self.source.extension();
        let mut out = Vec::new();
        for entry in walkdir::WalkDir::new(&self.root).follow_links(false) {
            let entry = match entry {
                Ok(entry) => entry,
                Err(e) => {
                    tracing::warn!("Skipping unreadable game data entry: {e}");
                    continue;
                }
            };
            if !entry.file_type().is_file() {
                continue;
            }
            let Ok(relative) = entry.path().strip_prefix(&self.root) else {
                continue;
            };
            let name = relative
                .components()
                .filter_map(|c| match c {
                    Component::Normal(part) => Some(part.to_string_lossy()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("/");
            if !name.to_ascii_lowercase().ends_with(extension) {
                continue;
            }
            let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
            out.push(GameWadSummary { name, size_bytes });
        }

        out.sort_by(|a, b| compare_names(&a.name, &b.name));
        Ok(out)
    }

    /// Read the chunk list of one archive, resolving path hashes via
    /// `resolver`.
    ///
    /// `wad_name` is a root-relative name as returned by [`list`](Self::list).
    /// An empty resolver is fine: every path is then `None`. Entries come back
    /// in the archive's chunk order.
    ///
    /// # Errors
    ///
    /// Fails with [`AppError::InvalidPath`] when `wad_name` escapes the root,
    /// and with I/O or WAD errors when the archive cannot be read.
    pub fn read(&self, wad_name: &str, resolver: &LayeredHashDb) -> AppResult<Vec<GameWadEntry>> {
        let mut out = Vec::new();
        self.for_each_chunk(wad_name, resolver, |path_hash, path, size_bytes| {
            out.push(GameWadEntry {
                path_hash: format!("{path_hash:016x}"),
                path: path.map(str::to_owned),
                size_bytes,
            });
        })?;
        Ok(out)
    }

    /// Visit every chunk of one archive as `(path hash, resolved path, size)`.
    ///
    /// The same read as [`read`](Self::read) without the owned per-chunk shape,
    /// for callers that walk every archive of an install and keep only a part
    /// of what they see.
    ///
    /// # Errors
    ///
    /// The same conditions as [`read`](Self::read).
    pub fn for_each_chunk(
        &self,
        wad_name: &str,
        resolver: &LayeredHashDb,
        mut visit: impl FnMut(u64, Option<&str>, u64),
    ) -> AppResult<()> {
        let wad = mount_wad(&self.archive_path(wad_name)?)?;

        let chunks = wad.chunks().as_slice();
        let hashes: Vec<u64> = chunks.iter().map(|c| c.path_hash().0).collect();
        resolver.for_each_batch(&hashes, |index, path_hash, path| {
            visit(path_hash, path, chunks[index].uncompressed_size() as u64);
        });
        Ok(())
    }

    /// Join `wad_name` under the root, rejecting anything that escapes it.
    ///
    /// # Errors
    ///
    /// Fails with [`AppError::InvalidPath`] when the name is absolute, or
    /// climbs out of the root, and with an I/O error when neither it nor the
    /// directory it sits in can be resolved.
    pub fn archive_path(&self, wad_name: &str) -> AppResult<PathBuf> {
        resolve_within(&self.root, wad_name)
    }
}

/// An archive mounted over its file.
pub type ArchiveFile = Wad<BufReader<fs::File>>;

/// Mount the archive at `path`.
///
/// # Errors
///
/// Fails when the file does not open or holds no archive.
pub fn mount_wad(path: &Path) -> AppResult<ArchiveFile> {
    Ok(Wad::mount(BufReader::new(fs::File::open(path)?))?)
}

/// The decompressed chunk `hash` of `wad`, and `None` where the archive holds none.
///
/// # Errors
///
/// Fails when the chunk does not read or decompress.
pub fn chunk_bytes<R: Read + Seek>(
    wad: &mut Wad<R>,
    hash: WadHash,
) -> Result<Option<Box<[u8]>>, WadError> {
    let Some(chunk) = wad.chunks().get(hash).copied() else {
        return Ok(None);
    };

    wad.load_chunk_decompressed(&chunk).map(Some)
}

/// One mounted archive, shared by every reader the cache handed it to.
///
/// The mount carries its own lock rather than sitting under the cache's. A
/// chunk read seeks and decompresses, so holding the cache across one would
/// queue every other archive's readers behind a single slow file.
type MountedWad = Arc<Mutex<ArchiveFile>>;

/// How many archives stay mounted at once.
///
/// A mount holds an open handle and the archive's whole chunk table, so the
/// cache trades memory for not re-reading that table. Sized for one map rather
/// than for a champion: a map preview reads its geometry, its materials, 183
/// textures and every structure skin it stands, which reach across the map's own
/// archive, the shared asset archives and one per champion-shaped prop. At four
/// those evicted each other mid-load and every eviction re-read a whole table.
const MOUNT_CAPACITY: NonZeroUsize = NonZeroUsize::new(16).unwrap();

/// A bounded cache of mounted WAD archives.
///
/// [`Wad::mount`] reads an archive's chunk table end to end, which a browser
/// opening one preview after another out of the same archive would otherwise
/// pay on every chunk. Keyed on the resolved archive path, so pointing the app
/// at another install cannot serve a chunk out of the old one's mount.
///
/// Least-recently-used eviction is what bounds it. Releasing a mount with the
/// tab that wanted it would need the webview to report every close, and would
/// still drop the archive the next tab is about to ask for.
pub struct WadCache {
    mounted: Mutex<LruCache<PathBuf, MountedWad>>,
}

impl Default for WadCache {
    fn default() -> Self {
        Self::new(MOUNT_CAPACITY)
    }
}

impl fmt::Debug for WadCache {
    /// Reports how many archives are mounted, a mount being a file handle and a
    /// chunk table rather than anything worth printing.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("WadCache")
            .field("mounted", &self.mounted.lock().len())
            .finish()
    }
}

impl WadCache {
    /// A cache that keeps `capacity` archives mounted.
    #[must_use]
    pub fn new(capacity: NonZeroUsize) -> Self {
        Self {
            mounted: Mutex::new(LruCache::new(capacity)),
        }
    }

    /// Read one chunk of one archive, decompressed, mounting it if it is not.
    ///
    /// `wad_name` is a root-relative name as returned by [`GameArchives::list`],
    /// and `path_hash` names one of its chunks.
    ///
    /// # Errors
    ///
    /// Fails with [`AppError::InvalidPath`] when `wad_name` escapes the root or
    /// when the archive holds no such chunk, and with I/O or WAD errors when
    /// the archive cannot be read.
    pub fn read_chunk(
        &self,
        archives: &GameArchives,
        wad_name: &str,
        path_hash: WadHash,
    ) -> AppResult<Vec<u8>> {
        let mounted = self.mount(archives.archive_path(wad_name)?)?;
        let mut wad = mounted.lock();

        let bytes = chunk_bytes(&mut wad, path_hash)?.ok_or_else(|| {
            AppError::InvalidPath(format!("No chunk {path_hash:016x} in {wad_name}"))
        })?;
        Ok(bytes.into_vec())
    }

    /// How many archives are mounted right now.
    #[must_use]
    pub fn mounted(&self) -> usize {
        self.mounted.lock().len()
    }

    /// Unmount everything, so the next read opens the archive again.
    pub fn clear(&self) {
        self.mounted.lock().clear();
    }

    /// The mount for `path`, opening the archive when the cache lacks one.
    ///
    /// The cache lock is dropped before the file is opened, so two callers
    /// racing for one archive can both mount it. That costs a duplicate read
    /// and settles on whichever landed last, which is cheaper than holding the
    /// whole cache across an open.
    fn mount(&self, path: PathBuf) -> AppResult<MountedWad> {
        if let Some(mounted) = self.mounted.lock().get(&path) {
            return Ok(Arc::clone(mounted));
        }

        let mounted = Arc::new(Mutex::new(mount_wad(&path)?));
        self.mounted.lock().put(path, Arc::clone(&mounted));
        Ok(mounted)
    }
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
/// The one place the escalation is written. The problems scan calls it with
/// the WAD it is already walking, a rule calls it through a remount, and the
/// object index's sniff calls it from its own mount - so it takes a mounted
/// WAD rather than knowing how to find one.
///
/// A chunk holding fewer than `want` bytes answers with what it holds, and so
/// does one whose first block will not decode past that.
///
/// # Errors
///
/// Fails when the chunk's raw bytes cannot be read or its first block will
/// not decode.
pub fn chunk_head<S: std::io::Read + std::io::Seek>(
    wad: &mut Wad<S>,
    chunk: &WadChunk,
    decoder: &mut ChunkDecoder,
    want: usize,
) -> Result<Vec<u8>, WadError> {
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

#[cfg(test)]
mod tests;
