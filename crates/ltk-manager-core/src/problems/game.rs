//! The installed game as content a rule can ask about.
//!
//! A run already carries three facts about the world outside the mod - the
//! installed build, the hash tables and the budget - and none of them reaches a
//! byte of the game. A rule that has to know whether removing a file leaves a
//! request unanswered needs one that does.
//!
//! The interface is one question, because one rule asks it. Widening it is for
//! the day a second rule needs more, and reading the install for *parts* rather
//! than to compare against is a different decision again.
//!
//! **The hash tables are not this.** Mimir's tables are a superset across
//! patches, so a path Riot removed two patches ago is a path they still name.
//! Being wrong in that direction means deleting a file whose backing is gone,
//! which is the crash the question exists to avoid. The answer has to come from
//! the install.

use std::collections::HashSet;
use std::path::Path;
use std::sync::OnceLock;

use ltk_wad::{Wad, WadHash};

use crate::config::Config;
use crate::game_wads::GameArchives;

/// What the installed game holds, for a rule that has to ask.
///
/// A run takes one of these rather than building one, so a sweep over a library
/// asks one index rather than building a new one for every mod.
pub trait GameContent: std::fmt::Debug + Send + Sync {
    /// Whether an archive of the install holds this chunk.
    fn holds(&self, path: WadHash) -> bool;
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
    held: OnceLock<HashSet<WadHash>>,
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
        }
    }

    /// The install rooted at `game_dir`, the directory holding `DATA`.
    #[must_use]
    pub fn at(game_dir: &Path) -> Self {
        Self::over(GameArchives::at(game_dir))
    }

    /// Every chunk hash the install holds, walked once.
    ///
    /// Only the tables of contents are read, so an install of hundreds of
    /// gigabytes costs the few megabytes its chunk tables come to. An archive
    /// that will not mount is logged and skipped, because one damaged archive
    /// is no reason to answer nothing about the rest - the cost of skipping one
    /// is a removal refused, which is the safe direction.
    fn index(&self) -> &HashSet<WadHash> {
        self.held.get_or_init(|| {
            let started = std::time::Instant::now();
            let mut held = HashSet::new();

            let archives = match self.archives.list() {
                Ok(archives) => archives,
                Err(e) => {
                    tracing::warn!("Could not list the installed game's archives: {e}");
                    return held;
                }
            };

            for archive in &archives {
                match self.hashes_in(&archive.name) {
                    Ok(hashes) => held.extend(hashes),
                    Err(e) => {
                        tracing::warn!("Skipping {}, which would not mount: {e}", archive.name)
                    }
                }
            }

            tracing::debug!(
                "Indexed {} chunks across {} game archives in {:?}",
                held.len(),
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
        self.index().contains(&path)
    }
}
