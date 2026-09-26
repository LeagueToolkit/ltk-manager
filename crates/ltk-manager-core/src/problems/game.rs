//! Installed game content, for a rule to compare a mod against.
//!
//! Compare against, never take parts out of. Reading the install for parts is a
//! separate decision, recorded where it is made.
//!
//! **The hash tables are not this.** Mimir's tables are a superset across
//! patches, so they still name a path Riot removed. Trusting them here deletes
//! a file whose backing is gone.

use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;

use fs_err as fs;
use ltk_wad::{Wad, WadHash};

use crate::config::Config;
use crate::game_wads::{GameArchives, WadCache};

/// The chunks of the installed game.
///
/// Taken by a run rather than built by one, so a library sweep shares one
/// index.
pub trait GameContent: std::fmt::Debug + Send + Sync {
    /// Whether any installed archive contains this chunk.
    fn contains(&self, path: WadHash) -> bool;

    /// The chunk's decompressed size, or `None` where no archive contains it.
    ///
    /// Read from the table of contents, without decompressing the chunk.
    fn size(&self, path: WadHash) -> Option<u64>;

    /// The chunk's decompressed bytes, or `None` where no archive contains it.
    ///
    /// For comparing what a mod ships against what it overrides. Not a parts
    /// source for a repair.
    ///
    /// # Errors
    ///
    /// An archive that would not mount, or a chunk that would not decompress,
    /// as one sentence a panel can draw.
    fn read(&self, path: WadHash) -> Result<Option<Vec<u8>>, String>;

    /// Build whatever the content keeps lazily, ahead of the first ask.
    ///
    /// The default builds nothing. Content that builds an index keeps it for
    /// later calls.
    fn warm(&self) {}
}

/// The installed game's archives, indexed by chunk hash on first use.
///
/// Lazy because most runs never ask, and the walk costs seconds.
#[derive(Debug)]
pub struct InstalledContent {
    archives: GameArchives,
    chunks: OnceLock<ChunkIndex>,
    mounts: WadCache,
}

/// The archive and decompressed size of each installed chunk.
///
/// Names sit apart from the map: a few hundred archives against a few hundred
/// thousand chunks, so a string per chunk would store each name over and
/// over.
#[derive(Debug, Default)]
struct ChunkIndex {
    /// Every archive the walk read, in walk order.
    names: Vec<String>,
    /// Each chunk's entry, by hash.
    ///
    /// A path in more than one archive keeps the last archive walked. Two
    /// copies that differ are a separate defect.
    entries: HashMap<WadHash, ChunkEntry>,
}

/// One chunk from an installed archive's table of contents.
#[derive(Debug, Clone, Copy)]
struct ChunkEntry {
    /// The archive that contains the chunk, as an index into `ChunkIndex::names`.
    archive: usize,
    /// The decompressed size.
    size: u64,
}

impl InstalledContent {
    /// The install `config` points at, or `None` for no install.
    #[must_use]
    pub fn resolve(config: &Config) -> Option<Self> {
        GameArchives::resolve(config).ok().map(Self::over)
    }

    /// An index over already-resolved archives.
    #[must_use]
    pub fn over(archives: GameArchives) -> Self {
        Self {
            archives,
            chunks: OnceLock::new(),
            mounts: WadCache::default(),
        }
    }

    /// The install rooted at `game_dir`, the directory that contains `DATA`.
    #[must_use]
    pub fn at(game_dir: &Path) -> Self {
        Self::over(GameArchives::at(game_dir))
    }

    /// Every chunk's archive, walked once.
    ///
    /// Tables of contents only, so hundreds of gigabytes cost the few megabytes
    /// their chunk tables come to. An archive that will not mount is logged and
    /// skipped: skipping one costs a removal refused, which is the safe
    /// direction.
    fn index(&self) -> &ChunkIndex {
        self.chunks.get_or_init(|| {
            let started = std::time::Instant::now();
            let mut index = ChunkIndex::default();

            let archives = match self.archives.list() {
                Ok(archives) => archives,
                Err(e) => {
                    tracing::warn!("Could not list the installed game's archives: {e}");
                    return index;
                }
            };

            for archive in &archives {
                match self.chunks_in(&archive.name) {
                    Ok(chunks) => {
                        let at = index.names.len();
                        index.names.push(archive.name.clone());
                        index.entries.extend(
                            chunks
                                .into_iter()
                                .map(|(hash, size)| (hash, ChunkEntry { archive: at, size })),
                        );
                    }
                    Err(e) => {
                        tracing::warn!("Skipping {}, which would not mount: {e}", archive.name)
                    }
                }
            }

            tracing::debug!(
                "Indexed {} chunks across {} game archives in {:?}",
                index.entries.len(),
                archives.len(),
                started.elapsed()
            );
            index
        })
    }

    /// Each chunk's hash and decompressed size in one archive's table of
    /// contents.
    fn chunks_in(&self, wad_name: &str) -> crate::error::AppResult<Vec<(WadHash, u64)>> {
        let path = self.archives.archive_path(wad_name)?;
        let file = std::io::BufReader::new(fs::File::open(&path)?);
        let wad = Wad::mount(file)?;
        Ok(wad
            .chunks()
            .as_slice()
            .iter()
            .map(|chunk| (chunk.path_hash, chunk.uncompressed_size as u64))
            .collect())
    }
}

impl GameContent for InstalledContent {
    fn contains(&self, path: WadHash) -> bool {
        self.index().entries.contains_key(&path)
    }

    fn size(&self, path: WadHash) -> Option<u64> {
        self.index().entries.get(&path).map(|chunk| chunk.size)
    }

    fn warm(&self) {
        self.index();
    }

    /// Read through a cached mount.
    ///
    /// One table of contents parse per archive, not per chunk.
    fn read(&self, path: WadHash) -> Result<Option<Vec<u8>>, String> {
        let index = self.index();
        let Some(name) = index
            .entries
            .get(&path)
            .and_then(|chunk| index.names.get(chunk.archive))
        else {
            return Ok(None);
        };

        self.mounts
            .read_chunk(&self.archives, name, path)
            .map(Some)
            .map_err(|e| e.to_string())
    }
}

/// An install that contains only the chunks a test gives it.
///
/// The second adapter, which is what makes [`GameContent`] a seam: a unit test
/// cannot depend on a League install.
#[cfg(test)]
#[derive(Debug, Default)]
pub(crate) struct FakeContent(HashMap<WadHash, Vec<u8>>);

#[cfg(test)]
impl FakeContent {
    /// An install that contains `paths`, each with empty bytes.
    pub(crate) fn containing(paths: &[&str]) -> std::sync::Arc<dyn GameContent> {
        Self::of(paths.iter().map(|path| (*path, [].as_slice())))
    }

    /// An install that contains `entries`, each with the bytes a rule reads.
    pub(crate) fn containing_bytes(entries: &[(&str, &[u8])]) -> std::sync::Arc<dyn GameContent> {
        Self::of(entries.iter().copied())
    }

    /// An install with no chunks.
    pub(crate) fn empty() -> std::sync::Arc<dyn GameContent> {
        Self::of(std::iter::empty())
    }

    fn of<'e>(
        entries: impl Iterator<Item = (&'e str, &'e [u8])>,
    ) -> std::sync::Arc<dyn GameContent> {
        use ltk_hash::Hash as _;
        std::sync::Arc::new(Self(
            entries
                .map(|(path, bytes)| (WadHash::hash_str(path), bytes.to_vec()))
                .collect(),
        ))
    }
}

#[cfg(test)]
impl GameContent for FakeContent {
    fn contains(&self, path: WadHash) -> bool {
        self.0.contains_key(&path)
    }

    fn size(&self, path: WadHash) -> Option<u64> {
        self.0.get(&path).map(|bytes| bytes.len() as u64)
    }

    fn read(&self, path: WadHash) -> Result<Option<Vec<u8>>, String> {
        Ok(self.0.get(&path).cloned())
    }
}

#[cfg(test)]
mod tests;
