//! The skin bins a set of the game's archives hold, mounted to read.

use super::skin_bin::SkinBin;
use crate::error::AppResult;
use crate::game_wads::{chunk_bytes, mount_wad};
use crate::utils::game::{GameDir, archive_stem};
use fs_err as fs;
use ltk_wad::{PathResolver, Wad, WadHash};
use std::cell::OnceCell;
use std::collections::HashMap;
use std::io::BufReader;
use std::path::PathBuf;

/// The skin bins a set of the game's archives hold, named by the roster and the WAD path tables.
///
/// The roster names each champion's own skin bins with no table open. The tables name the rest,
/// such as a champion's companion characters. An archive that does not mount is passed over, as
/// the overlay build passes over it.
pub(super) struct GameSkins<'t> {
    archives: Vec<Archive>,
    /// The lowercased champion each champion archive is named after.
    roster: Vec<String>,
    tables: &'t dyn PathResolver,
    /// Every skin bin of the roster by chunk hash, built on the first lookup.
    roster_bins: OnceCell<HashMap<WadHash, SkinBin>>,
}

/// A game archive, mounted to read its chunks.
struct Archive {
    name: String,
    wad: Wad<BufReader<fs::File>>,
}

impl<'t> GameSkins<'t> {
    /// The unlocalized archives in `DATA/FINAL/Champions` under `game_dir`.
    ///
    /// # Errors
    ///
    /// Fails when the champions directory cannot be listed.
    pub(super) fn champions(game_dir: &GameDir, tables: &'t dyn PathResolver) -> AppResult<Self> {
        let found = game_dir.champion_archives()?;
        let roster = found
            .iter()
            .map(|(name, _)| archive_stem(name).to_ascii_lowercase())
            .collect();
        Ok(Self::mount(found, roster, tables))
    }

    /// The archives in `DATA/FINAL/Maps/Shipping` under `game_dir`.
    ///
    /// # Errors
    ///
    /// Fails when the maps directory cannot be listed.
    pub(super) fn maps(game_dir: &GameDir, tables: &'t dyn PathResolver) -> AppResult<Self> {
        Ok(Self::mount(game_dir.map_archives()?, Vec::new(), tables))
    }

    fn mount(
        found: Vec<(String, PathBuf)>,
        roster: Vec<String>,
        tables: &'t dyn PathResolver,
    ) -> Self {
        let archives = found
            .into_iter()
            .filter_map(|(name, path)| match mount_wad(&path) {
                Ok(wad) => Some(Archive { name, wad }),
                Err(e) => {
                    tracing::warn!("Built-in mods: passing over {}: {e}", path.display());
                    None
                }
            })
            .collect();
        Self {
            archives,
            roster,
            tables,
            roster_bins: OnceCell::new(),
        }
    }

    /// The lowercased champions the archives are named after, which name skin bins by hash.
    pub(super) fn roster(&self) -> &[String] {
        &self.roster
    }

    /// Every skin bin past the base the archives hold, with the archive holding it.
    pub(super) fn past_base(&self) -> Vec<(&str, SkinBin)> {
        self.archives
            .iter()
            .flat_map(|archive| {
                let hashes: Vec<WadHash> = archive
                    .wad
                    .chunks()
                    .iter()
                    .map(|chunk| chunk.path_hash)
                    .collect();
                self.resolve_all(&hashes)
                    .into_iter()
                    .flatten()
                    .filter(|bin| !bin.is_base())
                    .map(|bin| (archive.name.as_str(), bin))
            })
            .collect()
    }

    /// Each skin bin of `character` past its base the archives hold, with the archive holding it.
    ///
    /// Ids are matched against each archive's chunk table, so no table is needed.
    pub(super) fn past_base_of(&self, character: &str) -> Vec<(&str, SkinBin)> {
        let bins: Vec<(WadHash, SkinBin)> = SkinBin::past_base(character)
            .map(|bin| (bin.hash(), bin))
            .collect();
        self.archives
            .iter()
            .flat_map(|archive| {
                bins.iter()
                    .filter(|(hash, _)| archive.wad.chunks().contains(*hash))
                    .map(|(_, bin)| (archive.name.as_str(), bin.clone()))
            })
            .collect()
    }

    /// The bytes of `bin` in the first archive holding it, where it reads.
    pub(super) fn read(&mut self, bin: &SkinBin) -> Option<Vec<u8>> {
        self.read_chunk(&bin.path())
    }

    /// The bytes of the chunk at `path` in the first archive holding it, where it reads.
    pub(super) fn read_chunk(&mut self, path: &str) -> Option<Vec<u8>> {
        let hash = WadHash::from(path);
        let archive = self
            .archives
            .iter_mut()
            .find(|archive| archive.wad.chunks().contains(hash))?;
        chunk_bytes(&mut archive.wad, hash)
            .inspect_err(|e| tracing::warn!("Built-in mods: cannot read {path}: {e}"))
            .ok()
            .flatten()
            .map(Vec::from)
    }

    /// The skin bin at each of `hashes`, where one is, in one pass over the tables.
    pub(super) fn resolve_all(&self, hashes: &[WadHash]) -> Vec<Option<SkinBin>> {
        self.name_all(hashes)
            .into_iter()
            .map(|name| SkinBin::parse(&name?))
            .collect()
    }

    /// The chunk path at each of `hashes`, where the roster or the tables name one, in one pass
    /// over the tables.
    pub(super) fn name_all(&self, hashes: &[WadHash]) -> Vec<Option<String>> {
        let roster = self.roster_bins();
        self.tables
            .resolve_all(hashes)
            .into_iter()
            .zip(hashes)
            .map(|(name, hash)| roster.get(hash).map(SkinBin::path).or(name))
            .collect()
    }

    fn roster_bins(&self) -> &HashMap<WadHash, SkinBin> {
        self.roster_bins.get_or_init(|| {
            self.roster
                .iter()
                .flat_map(|character| {
                    std::iter::once(SkinBin::new(character, 0)).chain(SkinBin::past_base(character))
                })
                .map(|bin| (bin.hash(), bin))
                .collect()
        })
    }
}
