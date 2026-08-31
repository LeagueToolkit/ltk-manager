//! The installed game as content a rule can ask about.
//!
//! A run already carries three facts about the world outside the mod - the
//! installed build, the hash tables and the budget - and none of them reaches a
//! byte of the game. A rule that has to know whether removing a file leaves a
//! request unanswered needs one that does.
//!
//! The interface is two questions, and both are asked to *compare against* the
//! install rather than to take parts out of it. Reading it for parts is a
//! different decision again, recorded where it is made rather than assumed
//! here.
//!
//! **The hash tables are not this.** Mimir's tables are a superset across
//! patches, so a path Riot removed two patches ago is a path they still name.
//! Being wrong in that direction means deleting a file whose backing is gone,
//! which is the crash the question exists to avoid. The answer has to come from
//! the install.

use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;

use ltk_wad::{Wad, WadHash};

use crate::config::Config;
use crate::game_wads::{GameArchives, WadCache};

/// What the installed game holds, for a rule that has to ask.
///
/// A run takes one of these rather than building one, so a sweep over a library
/// asks one index rather than building a new one for every mod.
pub trait GameContent: std::fmt::Debug + Send + Sync {
    /// Whether an archive of the install holds this chunk.
    fn holds(&self, path: WadHash) -> bool;

    /// The chunk's bytes, decompressed, or `None` where no archive holds it.
    ///
    /// For a rule comparing what a mod ships against what it overrides. What a
    /// rule does with the answer is its own business, and reading the install
    /// for parts to graft into a repair is not this.
    ///
    /// # Errors
    ///
    /// Reports an archive that would not mount, or a chunk that would not
    /// decompress, as one sentence a panel can draw.
    fn read(&self, path: WadHash) -> Result<Option<Vec<u8>>, String>;
}

/// The installed game's archives, indexed by chunk hash the first time a rule
/// asks.
///
/// Built lazily because most runs never ask: a walk of every archive's table of
/// contents costs seconds, and a mod that ships nothing worth asking about
/// should pay none of them.
#[derive(Debug)]
pub struct InstalledContent {
    archives: GameArchives,
    held: OnceLock<HeldChunks>,
    mounts: WadCache,
}

/// Which archive of the install holds each chunk.
///
/// The names sit apart from the map because an install holds a few hundred
/// archives and a few hundred thousand chunks, so naming each chunk's archive
/// by its own string would store those few hundred names over and over.
#[derive(Debug, Default)]
struct HeldChunks {
    /// Every archive the walk read, in the order it listed them.
    names: Vec<String>,
    /// Which of those holds each chunk, as an index into `names`.
    ///
    /// A path more than one archive holds keeps the last walked. Two copies
    /// that differ at all is a defect of its own rather than a choice to make
    /// here.
    at: HashMap<WadHash, usize>,
}

impl InstalledContent {
    /// The install `config` points at, or `None` where it points at none.
    #[must_use]
    pub fn resolve(config: &Config) -> Option<Self> {
        GameArchives::resolve(config).ok().map(Self::over)
    }

    /// An already-resolved set of archives.
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

    /// Which archive holds each chunk of the install, walked once.
    ///
    /// Only the tables of contents are read, so an install of hundreds of
    /// gigabytes costs the few megabytes its chunk tables come to. An archive
    /// that will not mount is logged and skipped, because one damaged archive
    /// is no reason to answer nothing about the rest - the cost of skipping one
    /// is a removal refused, which is the safe direction.
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

    /// The chunk hashes one archive's table of contents lists.
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

    /// Read through a mount the cache keeps, so a rule reading a mod's worth of
    /// chunks out of one archive parses its table of contents once.
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

/// An install holding exactly the chunks a test built it with.
///
/// The second adapter, and what makes [`GameContent`] a seam rather than a
/// layer: a unit test cannot depend on a League install, and every rule is
/// tested through the analysis entry point.
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

    /// A machine whose install holds nothing at all.
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
