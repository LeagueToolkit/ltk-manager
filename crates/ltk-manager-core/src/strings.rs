//! Autocomplete index for stringtable field names.
//!
//! Combines the key names of the shared cache's `rst-xxh3` table with current
//! values from the game's own stringtable for the detected locale, so the
//! workshop strings editor can suggest valid field names and show what each one
//! currently says in game.

use crate::config::Config;
use crate::game_wads::{chunk_bytes, mount_wad};
use crate::hashtables::HashtableCache;
use crate::utils::lazy_slot::LazySlot;
use serde::Serialize;
use std::collections::HashMap;
use std::io::Cursor;
use std::sync::Arc;

/// One autocomplete suggestion for a stringtable field.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct StringKeySuggestion {
    /// Field name, e.g. `game_character_displayname_ahri`.
    pub key: String,
    /// What the game's stringtable currently says for this field in the
    /// indexed locale, when the key exists there.
    pub value: Option<String>,
}

/// Result of a suggestion query.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct StringKeySearchResult {
    pub suggestions: Vec<StringKeySuggestion>,
    /// Total number of known field names in the index.
    pub total_keys: u32,
    /// Locale whose stringtable supplied the `value` previews, when available.
    pub locale: Option<String>,
}

struct IndexEntry {
    key: String,
    value: Option<String>,
    /// Lowercased copy of `value`, so a search can match the in-game text
    /// without re-lowercasing the whole table on every keystroke.
    value_lower: Option<String>,
}

/// In-memory suggestion index: known field names (sorted) joined with the
/// game's current values.
pub struct StringKeyIndex {
    entries: Vec<IndexEntry>,
    locale: Option<String>,
    /// The game's stringtable, which answers a key the name list does not hold.
    table: Option<ltk_rst::Stringtable>,
}

impl StringKeyIndex {
    /// Build the index from the shared cache's key names and, best-effort, the
    /// game stringtable of the detected locale.
    ///
    /// A cache that holds no `rst-xxh3` table indexes nothing, so the editor
    /// offers no suggestions rather than failing.
    fn from_cache(config: &Config) -> Self {
        let keys = match HashtableCache::shared() {
            Ok(cache) => cache.string_keys(),
            Err(e) => {
                tracing::warn!("No hashtable cache to read field names from: {e}");
                Vec::new()
            }
        };
        Self::from_keys(keys, config)
    }

    /// Join field names with what the game's stringtable currently says for
    /// each, keyed by the hash the table stores them under.
    fn from_keys(keys: Vec<(u64, String)>, config: &Config) -> Self {
        let (locale, table) = load_game_stringtable(config).unzip();

        let mut entries: Vec<IndexEntry> = keys
            .into_iter()
            .filter(|(_, key)| !key.trim().is_empty())
            .map(|(hash, key)| {
                let value = table
                    .as_ref()
                    .and_then(|table| table.get(hash).map(str::to_string));
                IndexEntry {
                    value_lower: value.as_deref().map(str::to_lowercase),
                    value,
                    key,
                }
            })
            .collect();

        entries.sort_by(|a, b| a.key.cmp(&b.key));
        entries.dedup_by(|a, b| a.key == b.key);

        tracing::info!(
            "String key index built: {} keys, values from locale {:?}",
            entries.len(),
            locale
        );

        Self {
            entries,
            locale,
            table,
        }
    }

    /// The game's text for `key`, found by its hash whether or not the name list holds it.
    #[must_use]
    pub fn text(&self, key: &str) -> Option<&str> {
        self.table.as_ref()?.get_key(key)
    }

    /// Rank matches for `query`: key prefix first, then key substring, then
    /// in-game text substring, each bucket in alphabetical order. An empty
    /// query lists the first `limit` keys for discovery.
    pub fn search(&self, query: &str, limit: usize) -> StringKeySearchResult {
        let query = query.trim().to_lowercase();

        let mut prefix: Vec<&IndexEntry> = Vec::new();
        let mut contains: Vec<&IndexEntry> = Vec::new();
        let mut texts: Vec<&IndexEntry> = Vec::new();
        if query.is_empty() {
            prefix.extend(self.entries.iter().take(limit));
        } else {
            for entry in &self.entries {
                if prefix.len() >= limit {
                    break;
                }
                if entry.key.starts_with(&query) {
                    prefix.push(entry);
                } else if contains.len() < limit && entry.key.contains(&query) {
                    contains.push(entry);
                } else if texts.len() < limit
                    && entry
                        .value_lower
                        .as_deref()
                        .is_some_and(|value| value.contains(&query))
                {
                    texts.push(entry);
                }
            }
        }

        let suggestions = prefix
            .into_iter()
            .chain(contains)
            .chain(texts)
            .take(limit)
            .map(|entry| StringKeySuggestion {
                key: entry.key.clone(),
                value: entry.value.clone(),
            })
            .collect();

        StringKeySearchResult {
            suggestions,
            total_keys: self.entries.len() as u32,
            locale: self.locale.clone(),
        }
    }

    /// Current in-game text for each of `keys`, matched case-insensitively.
    ///
    /// The map is keyed by the strings as the caller wrote them. A key the
    /// index cannot resolve to a value is absent, so a miss reads as "nothing
    /// known" rather than as an empty string.
    pub fn lookup(&self, keys: &[String]) -> HashMap<String, String> {
        keys.iter()
            .filter_map(|key| {
                let wanted = key.trim().to_lowercase();
                // `build` sorts the entries by key, so a binary search holds.
                let found = self
                    .entries
                    .binary_search_by(|entry| entry.key.as_str().cmp(wanted.as_str()))
                    .ok()?;
                let value = self.entries[found].value.clone()?;
                Some((key.clone(), value))
            })
            .collect()
    }
}

/// Lazily-built, app-managed [`StringKeyIndex`].
#[derive(Default)]
pub struct StringKeyIndexState(LazySlot<StringKeyIndex>);

impl StringKeyIndexState {
    /// Return the index, building it on first use.
    #[must_use]
    pub fn get_or_build(&self, config: &Config) -> Arc<StringKeyIndex> {
        self.0.get_or_init(|| StringKeyIndex::from_cache(config))
    }

    /// Drop the built index, so the next caller reads what a sync just wrote.
    pub fn clear(&self) {
        self.0.clear();
    }
}

/// Best-effort load of the game's `lol.stringtable` for the detected locale.
/// Any failure (unset league path, missing WAD/chunk, parse error) just means
/// suggestions come without value previews.
fn load_game_stringtable(config: &Config) -> Option<(String, ltk_rst::Stringtable)> {
    let game_dir = match crate::utils::game::GameDir::resolve(config) {
        Ok(dir) => dir,
        Err(e) => {
            tracing::debug!("String index: game dir unavailable: {}", e);
            return None;
        }
    };
    let locale = game_dir.locale().unwrap_or_else(|| "en_us".into());

    let wad_path = game_dir.localized_global_wad(&locale)?;
    let mut wad = mount_wad(&wad_path).ok()?;

    let chunk_path = format!("data/menu/{locale}/lol.stringtable");
    let chunk_hash = ltk_modpkg::ChunkPath::new(&chunk_path).hash().value();
    let bytes = chunk_bytes(&mut wad, ltk_wad::WadHash(chunk_hash)).ok()??;

    match ltk_rst::Stringtable::from_reader(&mut Cursor::new(&bytes[..])) {
        Ok(table) => Some((locale, table)),
        Err(e) => {
            tracing::warn!("String index: failed to parse {}: {}", chunk_path, e);
            None
        }
    }
}

#[cfg(test)]
mod tests;
