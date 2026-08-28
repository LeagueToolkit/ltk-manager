//! Keeping the names a repair is about to hash away.
//!
//! A `File` property holds the XXH64 of a path and not the path. Once a fix
//! has written the hash the string is gone from the bin, and nothing can
//! derive it back - which is why a repair writes every path it hashes into the
//! project's own `hashes/` table first, under [`Category::Game`]. The mod then
//! carries what it needs to be read, and the repair is lossless rather than
//! reversible.
//!
//! A name the community tables already resolve is not embedded. It costs size
//! and buys nothing: the reader that would consult the mod's table can already
//! answer from its own.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use ltk_hashtable::{Algorithm, Category, Hashtable, HashtableSet, Key, KeyWidth};
use ltk_mod_project::{ConfigFormat, HASHES_DIR_NAME, ModProject, ModProjectHashtable};
use ltk_wad::{PathResolver, WadHash};

use crate::error::{AppError, AppResult, Utf8PathRefExt};

/// Where a fresh table lands when the project declares none.
const GAME_TABLE_PATH: &str = "hashes/game.hashes.txt";

/// Whether a name a repair is about to hash away can still be read back.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Preserved {
    /// The name reads back: this run embeds it, or a table already holds it.
    Kept,
    /// Another name already claims its key, so hashing this one would lose it.
    ///
    /// [`Category::Game`] keys at the full 64 bits, so this is a defensive
    /// path rather than one a real mod reaches. The caller leaves that one
    /// property alone and repairs the rest.
    Collides,
}

/// The names one fix run keeps, and the project table it merges them into.
///
/// Opened over the project's declared tables, so a name they already resolve
/// is not added twice and a key two different names claim is caught before
/// either is written.
pub struct PreservedNames<'a> {
    project_root: PathBuf,
    /// What the project's own tables already resolve.
    declared: HashtableSet,
    /// The shape the project's [`Category::Game`] table keys at, which is its
    /// own where it declares one and the registry's where it does not.
    shape: (Algorithm, KeyWidth),
    /// Names this run adds, by the key they take.
    fresh: BTreeMap<u64, String>,
    /// What a reader can name without the mod's help, in practice the
    /// community hashtables.
    exclusions: Option<&'a dyn PathResolver>,
}

impl std::fmt::Debug for PreservedNames<'_> {
    /// The exclusions are someone else's tables and have no `Debug`, so what
    /// this run itself holds is what it prints.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PreservedNames")
            .field("project_root", &self.project_root)
            .field("added", &self.fresh.len())
            .finish_non_exhaustive()
    }
}

impl<'a> PreservedNames<'a> {
    /// Read what `project_root` already declares, ready to merge into.
    ///
    /// A project whose tables cannot be read starts empty and merge-only, so a
    /// damaged `hashes/` costs a name rather than the repair.
    #[must_use]
    pub fn open(project_root: &Path, exclusions: Option<&'a dyn PathResolver>) -> Self {
        let project = project_root
            .try_as_utf8("project root")
            .ok()
            .and_then(|root| ModProject::load(root).ok());
        let declared = project.as_ref().map_or_else(Vec::new, |project| {
            read_tables(project_root, &project.hashtables)
        });

        let shape = project
            .as_ref()
            .and_then(|project| game_shape(&project.hashtables))
            .or_else(|| Category::Game.default_shape())
            .expect("the registry lists a shape for the game category");

        Self {
            project_root: project_root.to_path_buf(),
            declared: HashtableSet::build(declared),
            shape,
            fresh: BTreeMap::new(),
            exclusions,
        }
    }

    /// Keep `name` readable once the fix has hashed it.
    ///
    /// # Errors
    ///
    /// Never fails. Reports [`Preserved::Collides`] for the one case a caller
    /// has to act on, which is a key another name already claims.
    pub fn keep(&mut self, name: &str) -> Preserved {
        let (algorithm, width) = &self.shape;
        let Some(key) = Key::of(name, algorithm, *width) else {
            /* An algorithm this build cannot compute keys the table by nothing,
            so embedding the name would not make it findable. */
            return Preserved::Kept;
        };

        if self
            .exclusions
            .is_some_and(|tables| tables.is_known(WadHash(key.value())))
        {
            return Preserved::Kept;
        }

        // Owned only on the collision path, which no real mod reaches: this
        // runs once per path of every repaired property.
        let claimed = match self.claimant(key) {
            Some(held) if held.eq_ignore_ascii_case(name) => return Preserved::Kept,
            Some(held) => Some(held.to_owned()),
            None => None,
        };
        if let Some(held) = claimed {
            tracing::warn!(
                "Not repairing a path whose hash another name already claims: '{name}' collides with '{held}'"
            );
            return Preserved::Collides;
        }

        self.fresh.insert(key.value(), name.to_owned());
        Preserved::Kept
    }

    /// How many names this run added, before any of them is written.
    #[must_use]
    pub fn added(&self) -> usize {
        self.fresh.len()
    }

    /// Write the kept names into the project's table and manifest.
    ///
    /// Merge-only: every name the table already held stays, the manifest gains
    /// an entry rather than losing one, and a run that kept nothing writes
    /// nothing at all.
    ///
    /// # Errors
    ///
    /// Reports a project config or table file that could not be read or
    /// written.
    pub fn write(&self) -> AppResult<usize> {
        if self.fresh.is_empty() {
            return Ok(0);
        }

        let root = self.project_root.try_as_utf8("project root")?;
        let mut project = ModProject::load(root)
            .map_err(|e| AppError::Other(format!("Could not read the mod project: {e}")))?;

        let mut declared = false;
        let manifest = match game_manifest(&project.hashtables) {
            Some(manifest) => manifest.clone(),
            None => {
                declared = true;
                let (algorithm, width) = &self.shape;
                let manifest = ModProjectHashtable {
                    path: free_table_path(&project.hashtables),
                    category: Category::Game,
                    algorithm: algorithm.clone(),
                    bits: width.bits(),
                };
                project.hashtables.push(manifest.clone());
                manifest
            }
        };

        let path = root.join(&manifest.path);
        let held = read_table(path.as_std_path()).unwrap_or_default();
        let names = held.names().chain(self.fresh.values().map(String::as_str));
        let mut merged = Hashtable::from_names(names)
            .map_err(|e| AppError::Other(format!("Could not build the mod's hashtable: {e}")))?;
        merged.sort();

        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent.as_std_path())?;
        }
        let mut file = std::io::BufWriter::new(std::fs::File::create(path.as_std_path())?);
        merged.write_to(&mut file)?;
        std::io::Write::flush(&mut file)?;

        // Only where the manifest gained an entry. A project already declaring
        // its table needs no config write, and reserializing one costs it
        // anything `ModProject` does not round-trip.
        if declared {
            // Written back in the format it was read in, so a TOML project does
            // not gain a second config the loader would then prefer.
            let format = ConfigFormat::ALL
                .into_iter()
                .find(|format| root.join(format.file_name()).exists())
                .unwrap_or(ConfigFormat::Json);
            let config = project
                .to_config_string(format)
                .map_err(|e| AppError::Other(format!("Could not write the mod project: {e}")))?;
            std::fs::write(root.join(format.file_name()).as_std_path(), config)?;
        }

        Ok(self.fresh.len())
    }

    /// The name already standing at `key`, declared or kept by this run.
    fn claimant(&self, key: Key) -> Option<&str> {
        self.declared
            .resolve(&Category::Game, key)
            .or_else(|| self.fresh.get(&key.value()).map(String::as_str))
    }
}

/// The first [`Category::Game`] manifest entry whose keys this build computes.
fn game_manifest(manifests: &[ModProjectHashtable]) -> Option<&ModProjectHashtable> {
    manifests.iter().find(|manifest| {
        manifest.category == Category::Game
            && manifest
                .to_entry()
                .is_some_and(|entry| Key::of("", entry.algorithm(), entry.width()).is_some())
    })
}

fn game_shape(manifests: &[ModProjectHashtable]) -> Option<(Algorithm, KeyWidth)> {
    let entry = game_manifest(manifests)?.to_entry()?;
    Some((entry.algorithm().clone(), entry.width()))
}

/// A conventional table path no manifest entry has already claimed.
fn free_table_path(manifests: &[ModProjectHashtable]) -> String {
    let taken: Vec<String> = manifests
        .iter()
        .map(|manifest| manifest.path.to_ascii_lowercase())
        .collect();
    std::iter::once(GAME_TABLE_PATH.to_owned())
        .chain((1..).map(|attempt| format!("{HASHES_DIR_NAME}/game.repaired{attempt}.hashes.txt")))
        .find(|candidate| !taken.contains(&candidate.to_ascii_lowercase()))
        .expect("the candidate sequence is unbounded")
}

/// Every declared table that could be read, paired with its manifest entry.
///
/// A table that cannot be read is logged and left out. It is a name the mod
/// loses the benefit of, which is not a reason to refuse the repair.
fn read_tables(
    project_root: &Path,
    manifests: &[ModProjectHashtable],
) -> Vec<(ltk_hashtable::HashtableEntry, Hashtable)> {
    let mut tables = Vec::new();
    for manifest in manifests {
        let Some(entry) = manifest.to_entry() else {
            continue;
        };
        match read_table(&project_root.join(&manifest.path)) {
            Some(table) => tables.push((entry, table)),
            None => tracing::debug!("Skipping an unreadable hashtable: {}", manifest.path),
        }
    }
    tables
}

fn read_table(path: &Path) -> Option<Hashtable> {
    let file = std::fs::File::open(path).ok()?;
    Hashtable::from_reader(std::io::BufReader::new(file)).ok()
}

#[cfg(test)]
mod tests;
