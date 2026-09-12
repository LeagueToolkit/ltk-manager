//! Turning the hashes a bin addresses things by back into names.
//!
//! A bin stores hashes, and two sources turn them back. Four mimir tables -
//! `binentries` names an object's path, `bintypes` a class, `binfields` a
//! property and `binhashes` the string behind a `Hash` value - and the tables
//! the mod itself declares under `hashes/`, for the names only it holds.
//!
//! **Each kind is looked up in its own table.** All four are `FNV1a32`, and 32
//! bits over that many rows collide freely, so asking one shared lookup would
//! answer a property with an object's path. A wrong name is worse than a
//! number, so a miss is a number.
//!
//! A name is mostly for reading, and one repair also turns on it: a `Hash`
//! value the game now wants as `File` can only be rewritten from the path
//! behind it. [`path_value`](BinNames::path_value) is that repair's lookup,
//! and it reaches further than the reading ones: past `binhashes` it asks the
//! game hashtables - whose names are paths keyed by `XXH64` - by hashing
//! their names under `FNV1a32`. Mimir's half of that index answers the same
//! question for every mod and takes seconds to build over millions of names,
//! so it is built once for the process. Only the names a mod declares itself
//! are indexed per run. A [`Site`](super::Site) still addresses a property by
//! hash, so a cache that arrives or leaves between a run and a fix cannot
//! change what a repair matches - only what a row draws, and whether that one
//! conversion applies.

use std::collections::HashMap;
use std::collections::hash_map::Entry;
use std::path::Path;
use std::sync::{Arc, OnceLock};

use ltk_hash::{BinHash, Hash as _};
use ltk_hashdb::LayeredHashDb;
use ltk_hashtable::{Category, Hashtable, HashtableEntry, HashtableSet};
use ltk_mod_project::ModProject;
use parking_lot::Mutex;

use crate::hashtables::{BinHashTables, HashtableCache};

/// The names a bin's hashes can be given, out of the shared mimir cache and
/// the mod's own declared tables.
pub struct BinNames {
    cache: BinHashTables,
    /// What the mod's own `hashes/` tables resolve, empty where it declares
    /// none. The same `FNV1a32` universe as the cache, consulted per category
    /// for the same reason the cache is.
    declared: HashtableSet,
    /// The names of the mod's own game-category tables, for the FNV index.
    declared_game: Vec<String>,
    /// The mimir WAD tables, whose names feed the FNV index.
    wad: LayeredHashDb,
    /// `FNV1a32` over the mod's own game-table names, by position in
    /// [`declared_game`](Self::declared_game).
    ///
    /// Per instance because this is the half that differs between mods, and it
    /// is a few hundred names where mimir's is millions.
    declared_fnv: OnceLock<FnvIndex<u32>>,
}

/// `FNV1a32` to whatever reads the name back, be that a key or a position.
///
/// The index stores that rather than the name so millions of entries cost a
/// number each instead of a string each. `None` marks a hash two different
/// names collide on, which a repair must refuse rather than guess about.
type FnvIndex<T> = HashMap<u32, Option<T>>;

/// `FNV1a32` over the mimir game-table names, under their `XXH64` keys.
///
/// Built once for the process rather than once per [`BinNames`]: every mod
/// asks the same question of the same tables, and hashing two and a half
/// million names takes seconds. A sync writes new tables under new names, so
/// it ends with [`BinNames::invalidate_game_index`].
static GAME_FNV: Mutex<Option<Arc<FnvIndex<u64>>>> = Mutex::new(None);

impl BinNames {
    /// Open the bin tables of the shared cache, and `project_root`'s own.
    ///
    /// A cache that is not there names nothing, which reads the same way a hash
    /// no table holds does: the row prints the number. A project declaring no
    /// tables, or one whose tables cannot be read, contributes nothing the same
    /// way.
    #[must_use]
    pub fn open(project_root: &Path) -> Self {
        let tables = camino::Utf8Path::from_path(project_root)
            .and_then(|root| ModProject::load(root).ok())
            .map_or_else(Vec::new, |project| {
                super::preserve::read_tables(project_root, &project.hashtables)
            });

        Self::with_declared(tables)
    }

    /// The shared cache's tables, plus `declared`.
    ///
    /// What [`open`](Self::open) is once a project's own tables have been
    /// read, and the way in for a caller that read them somewhere other than a
    /// directory - an archive declares its tables inside itself.
    #[must_use]
    pub fn with_declared(declared: Vec<(HashtableEntry, Hashtable)>) -> Self {
        let (cache, wad) = match HashtableCache::shared() {
            Ok(cache) => (cache.bin_tables(), cache.wad_tables()),
            Err(e) => {
                tracing::debug!("No hashtable cache to name bin hashes with: {e}");
                (BinHashTables::default(), LayeredHashDb::new())
            }
        };

        let declared_game = declared
            .iter()
            .filter(|(entry, _)| *entry.category() == Category::Game)
            .flat_map(|(_, table)| table.names().map(str::to_owned))
            .collect();

        Self {
            cache,
            declared: HashtableSet::build(declared),
            declared_game,
            wad,
            declared_fnv: OnceLock::new(),
        }
    }

    /// Drop the process-wide mimir index, so the next ask reads what a sync
    /// just wrote.
    pub fn invalidate_game_index() {
        *GAME_FNV.lock() = None;
    }

    /// Name nothing, which is what a run with no cache does.
    #[must_use]
    pub fn none() -> Self {
        Self::default()
    }

    /// The name of a property, for a segment of a property path.
    #[must_use]
    pub fn field(&self, hash: BinHash) -> Option<String> {
        self.cache.field(hash)
    }

    /// The string behind a `Hash` value, for a map key or a `Hash` property.
    ///
    /// The cache answers first and the mod's own tables fill what it misses,
    /// which is the same order the repair embeds names in: a mod's table holds
    /// what the community's do not.
    #[must_use]
    pub fn value(&self, hash: BinHash) -> Option<String> {
        self.cache
            .value(hash)
            .or_else(|| self.resolve_declared(&Category::BinHashes, hash))
    }

    /// The path behind a `Hash` value, for the repair that rewrites it as
    /// `File`.
    ///
    /// Everything [`value`](Self::value) reads, and then the game hashtables -
    /// mimir's and the mod's own - whose names are the paths themselves,
    /// checked under `FNV1a32`. A hash two game-table names collide on stays
    /// unresolved: a repair writing the wrong path is worse than no repair.
    #[must_use]
    pub fn path_value(&self, hash: BinHash) -> Option<String> {
        if let Some(name) = self.value(hash) {
            return Some(name);
        }
        self.game_name(hash.0)
    }

    /// The path of an object, for the entry a site names.
    #[must_use]
    pub fn entry(&self, hash: BinHash) -> Option<String> {
        self.cache
            .entry(hash)
            .or_else(|| self.resolve_declared(&Category::BinEntries, hash))
    }

    /// The name of a class.
    #[must_use]
    pub fn class(&self, hash: BinHash) -> Option<String> {
        self.cache.class(hash)
    }

    fn resolve_declared(&self, category: &Category, hash: BinHash) -> Option<String> {
        self.declared
            .resolve_value(category, u64::from(hash.0))
            .map(str::to_owned)
    }

    /// One mimir game-table name, read back under its `XXH64` key.
    fn wad_name(&self, key: u64) -> Option<String> {
        Some(self.wad.get(key)?.into_owned())
    }

    /// One of the mod's own game-table names, by position.
    fn declared_name(&self, at: u32) -> Option<String> {
        self.declared_game.get(at as usize).cloned()
    }

    /// The game-table path one `FNV1a32` hash names, across both sources.
    ///
    /// Mimir answers where both hold the hash, which is the order one merged
    /// index resolved them in. Two sources naming different paths poison the
    /// hash exactly as two names inside one source do.
    fn game_name(&self, fnv: u32) -> Option<String> {
        let mimir = self.game_index();
        let mimir = mimir.as_ref().and_then(|index| index.get(&fnv)).copied();
        let declared = self.declared_index().get(&fnv).copied();

        match (mimir, declared) {
            (None, None) => None,
            (Some(mimir), None) => self.wad_name(mimir?),
            (None, Some(declared)) => self.declared_name(declared?),
            (Some(mimir), Some(declared)) => {
                let mimir = self.wad_name(mimir?)?;
                let declared = self.declared_name(declared?)?;
                mimir.eq_ignore_ascii_case(&declared).then_some(mimir)
            }
        }
    }

    /// The process-wide mimir index, built by whichever run asks first.
    ///
    /// `None` where this instance opened no game tables, which is a run with
    /// no cache: it has nothing to put in the index and nothing to read back
    /// out of it, and building an empty one would answer for every run after.
    fn game_index(&self) -> Option<Arc<FnvIndex<u64>>> {
        if self.wad.base_len() == 0 && self.wad.overlay_len() == 0 {
            return None;
        }

        // Held across the build so a second run waits for the first rather
        // than indexing the same tables beside it.
        let mut held = GAME_FNV.lock();
        if let Some(index) = held.as_ref() {
            return Some(Arc::clone(index));
        }

        let started = std::time::Instant::now();
        let mut index = FnvIndex::new();
        for (key, path) in self.wad.iter() {
            insert_name(&mut index, path.as_str(), key, |kept| self.wad_name(kept));
        }
        tracing::debug!(
            "Indexed {} mimir game-table names under FNV1a32 in {:?}",
            index.len(),
            started.elapsed()
        );

        let index = Arc::new(index);
        *held = Some(Arc::clone(&index));
        Some(index)
    }

    /// The index over the mod's own game-table names, built on the first ask.
    fn declared_index(&self) -> &FnvIndex<u32> {
        self.declared_fnv.get_or_init(|| {
            let mut index = FnvIndex::new();
            for (at, name) in self.declared_game.iter().enumerate() {
                insert_name(&mut index, name, at as u32, |kept| self.declared_name(kept));
            }
            index
        })
    }
}

/// Index `name` under its `FNV1a32`, poisoning a hash two paths land on.
///
/// `read_back` names whatever the index already holds for that hash, because
/// deciding between a duplicate and a collision means comparing the paths
/// rather than the keys.
fn insert_name<T: Copy>(
    index: &mut FnvIndex<T>,
    name: &str,
    key: T,
    read_back: impl Fn(T) -> Option<String>,
) {
    match index.entry(BinHash::hash_str(name).0) {
        Entry::Vacant(slot) => {
            slot.insert(Some(key));
        }
        Entry::Occupied(mut held) => {
            /* The same path twice keeps the first. Two different paths poison
            the hash for good, because a repair must not pick one. */
            let same = (*held.get())
                .and_then(&read_back)
                .is_some_and(|kept| kept.eq_ignore_ascii_case(name));
            if !same {
                held.insert(None);
            }
        }
    }
}

impl Default for BinNames {
    fn default() -> Self {
        Self {
            cache: BinHashTables::default(),
            declared: HashtableSet::build(std::iter::empty()),
            declared_game: Vec::new(),
            wad: LayeredHashDb::new(),
            declared_fnv: OnceLock::new(),
        }
    }
}

impl std::fmt::Debug for BinNames {
    /// The sources hold no `Debug` of their own, so the cache stands in.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("BinNames")
            .field("cache", &self.cache)
            .finish_non_exhaustive()
    }
}

#[cfg(test)]
mod tests;
