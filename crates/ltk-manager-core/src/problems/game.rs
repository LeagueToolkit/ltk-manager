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

use ltk_wad::{Wad, WadHash};

use crate::config::Config;
use crate::game_wads::{GameArchives, WadCache};

/// What the installed game holds.
///
/// Taken by a run rather than built by one, so a library sweep shares one
/// index.
pub trait GameContent: std::fmt::Debug + Send + Sync {
    /// Whether any installed archive holds this chunk.
    fn holds(&self, path: WadHash) -> bool;

    /// The chunk's decompressed bytes, or `None` where no archive holds it.
    ///
    /// For comparing what a mod ships against what it overrides. Not a parts
    /// source for a repair.
    ///
    /// # Errors
    ///
    /// An archive that would not mount, or a chunk that would not decompress,
    /// as one sentence a panel can draw.
    fn read(&self, path: WadHash) -> Result<Option<Vec<u8>>, String>;
}

/// The installed game's archives, indexed by chunk hash on first use.
///
/// Lazy because most runs never ask, and the walk costs seconds.
#[derive(Debug)]
pub struct InstalledContent {
    archives: GameArchives,
    held: OnceLock<HeldChunks>,
    mounts: WadCache,
}

/// Which installed archive holds each chunk.
///
/// Names sit apart from the map: a few hundred archives against a few hundred
/// thousand chunks, so a string per chunk would store each name over and
/// over.
#[derive(Debug, Default)]
struct HeldChunks {
    /// Every archive the walk read, in walk order.
    names: Vec<String>,
    /// Each chunk's archive, as an index into `names`.
    ///
    /// A path in more than one archive keeps the last walked. Two copies that
    /// differ is a defect of its own, not a choice made here.
    at: HashMap<WadHash, usize>,
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
            held: OnceLock::new(),
            mounts: WadCache::default(),
        }
    }

    /// The install rooted at `game_dir`, the directory holding `DATA`.
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
    fn index(&self) -> &HeldChunks {
        self.held.get_or_init(|| {
            let started = std::time::Instant::now();
            let mut held = HeldChunks::default();

            let archives = match self.archives.list() {
                Ok(archives) => archives,
                Err(e) => {
                    tracing::warn!("Could not list the installed game's archives: {e}");
                    return held;
                }
            };

            for archive in &archives {
                match self.hashes_in(&archive.name) {
                    Ok(hashes) => {
                        let at = held.names.len();
                        held.names.push(archive.name.clone());
                        held.at.extend(hashes.into_iter().map(|hash| (hash, at)));
                    }
                    Err(e) => {
                        tracing::warn!("Skipping {}, which would not mount: {e}", archive.name)
                    }
                }
            }

            tracing::debug!(
                "Indexed {} chunks across {} game archives in {:?}",
                held.at.len(),
                archives.len(),
                started.elapsed()
            );
            held
        })
    }

    /// The chunk hashes in one archive's table of contents.
    fn hashes_in(&self, wad_name: &str) -> crate::error::AppResult<Vec<WadHash>> {
        let path = self.archives.archive_path(wad_name)?;
        let file = std::io::BufReader::new(std::fs::File::open(&path)?);
        let wad = Wad::mount(file)?;
        Ok(wad
            .chunks()
            .as_slice()
            .iter()
            .map(|chunk| chunk.path_hash)
            .collect())
    }
}

impl GameContent for InstalledContent {
    fn holds(&self, path: WadHash) -> bool {
        self.index().at.contains_key(&path)
    }

    /// Read through a cached mount.
    ///
    /// One table of contents parse per archive, not per chunk.
    fn read(&self, path: WadHash) -> Result<Option<Vec<u8>>, String> {
        let held = self.index();
        let Some(name) = held.at.get(&path).and_then(|at| held.names.get(*at)) else {
            return Ok(None);
        };

        self.mounts
            .read_chunk(&self.archives, name, path)
            .map(Some)
            .map_err(|e| e.to_string())
    }
}

/// An install holding exactly the chunks a test gave it.
///
/// The second adapter, which is what makes [`GameContent`] a seam: a unit test
/// cannot depend on a League install.
#[cfg(test)]
#[derive(Debug, Default)]
pub(crate) struct FakeContent(HashMap<WadHash, Vec<u8>>);

#[cfg(test)]
impl FakeContent {
    /// An install holding `paths`, each with no bytes worth reading.
    pub(crate) fn holding(paths: &[&str]) -> std::sync::Arc<dyn GameContent> {
        Self::of(paths.iter().map(|path| (*path, [].as_slice())))
    }

    /// An install holding `entries`, each with the bytes a rule will read.
    pub(crate) fn holding_bytes(entries: &[(&str, &[u8])]) -> std::sync::Arc<dyn GameContent> {
        Self::of(entries.iter().copied())
    }

    /// An install holding nothing.
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
    fn holds(&self, path: WadHash) -> bool {
        self.0.contains_key(&path)
    }

    fn read(&self, path: WadHash) -> Result<Option<Vec<u8>>, String> {
        Ok(self.0.get(&path).cloned())
    }
}
