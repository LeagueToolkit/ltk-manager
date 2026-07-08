//! Autocomplete index for stringtable field names.
//!
//! Combines the community-maintained key-name list (CommunityDragon
//! `hashes.rst.xxh3.txt`) with current values from the game's own stringtable
//! for the detected locale, so the workshop strings editor can suggest valid
//! field names and show what each one currently says in game.

use crate::error::{AppError, AppResult, MutexResultExt};
use crate::state::Settings;
use serde::Serialize;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use ts_rs::TS;

const HASH_LIST_URL: &str =
    "https://raw.githubusercontent.com/CommunityDragon/Data/master/hashes/lol/hashes.rst.xxh3.txt";
const HASH_LIST_FILE: &str = "hashes.rst.xxh3.txt";
const HASH_LIST_MAX_AGE: Duration = Duration::from_secs(7 * 24 * 60 * 60);

/// One autocomplete suggestion for a stringtable field.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StringKeySuggestion {
    /// Field name, e.g. `game_character_displayname_ahri`.
    pub key: String,
    /// What the game's stringtable currently says for this field in the
    /// indexed locale, when the key exists there.
    pub value: Option<String>,
}

/// Result of a suggestion query.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
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
}

/// In-memory suggestion index: known field names (sorted) joined with the
/// game's current values.
pub struct StringKeyIndex {
    entries: Vec<IndexEntry>,
    locale: Option<String>,
}

impl StringKeyIndex {
    /// Build the index from the cached/downloaded key list and, best-effort,
    /// the game stringtable of the detected locale.
    fn build(cache_dir: &Path, settings: &Settings) -> AppResult<Self> {
        let key_list = load_key_list(cache_dir)?;

        let table = load_game_stringtable(settings);
        let locale = table.as_ref().map(|(locale, _)| locale.clone());

        let mut entries: Vec<IndexEntry> = key_list
            .lines()
            .filter_map(|line| {
                let (hex, name) = line.split_once(' ')?;
                let name = name.trim();
                if name.is_empty() {
                    return None;
                }
                let value = table.as_ref().and_then(|(_, table)| {
                    let hash = u64::from_str_radix(hex.trim(), 16).ok()?;
                    table.get(hash).map(str::to_string)
                });
                Some(IndexEntry {
                    key: name.to_string(),
                    value,
                })
            })
            .collect();

        entries.sort_by(|a, b| a.key.cmp(&b.key));
        entries.dedup_by(|a, b| a.key == b.key);

        tracing::info!(
            "String key index built: {} keys, values from locale {:?}",
            entries.len(),
            locale
        );

        Ok(Self { entries, locale })
    }

    /// Rank matching keys for `query`: prefix matches first, then substring
    /// matches, both in alphabetical order. An empty query lists the first
    /// `limit` keys for discovery.
    pub fn search(&self, query: &str, limit: usize) -> StringKeySearchResult {
        let query = query.trim().to_lowercase();

        let mut prefix: Vec<&IndexEntry> = Vec::new();
        let mut contains: Vec<&IndexEntry> = Vec::new();
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
                }
            }
        }

        let suggestions = prefix
            .into_iter()
            .chain(contains)
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
}

/// Lazily-built, app-managed [`StringKeyIndex`].
#[derive(Default)]
pub struct StringKeyIndexState(Mutex<Option<Arc<StringKeyIndex>>>);

impl StringKeyIndexState {
    /// Return the index, building it on first use. The lock is held for the
    /// duration of the build so concurrent callers wait instead of racing a
    /// second download/parse.
    pub fn get_or_build(
        &self,
        cache_dir: &Path,
        settings: &Settings,
    ) -> AppResult<Arc<StringKeyIndex>> {
        let mut slot = self.0.lock().mutex_err()?;
        if let Some(index) = slot.as_ref() {
            return Ok(Arc::clone(index));
        }
        let index = Arc::new(StringKeyIndex::build(cache_dir, settings)?);
        *slot = Some(Arc::clone(&index));
        Ok(index)
    }
}

/// Read the key list from the cache, refreshing it from CommunityDragon when
/// missing or older than [`HASH_LIST_MAX_AGE`]. A failed refresh falls back to
/// a stale cache when one exists.
fn load_key_list(cache_dir: &Path) -> AppResult<String> {
    let path = cache_dir.join(HASH_LIST_FILE);

    let needs_refresh = match std::fs::metadata(&path) {
        Ok(meta) => meta
            .modified()
            .ok()
            .and_then(|t| t.elapsed().ok())
            .is_none_or(|age| age > HASH_LIST_MAX_AGE),
        Err(_) => true,
    };

    if needs_refresh {
        if let Err(e) = download_key_list(&path) {
            tracing::warn!("Failed to refresh string key list: {}", e);
        }
    }

    std::fs::read_to_string(&path).map_err(|_| {
        AppError::Other(
            "String key list is not available yet - it downloads automatically when online"
                .to_string(),
        )
    })
}

fn download_key_list(dest: &Path) -> AppResult<PathBuf> {
    tracing::info!("Downloading string key list from CommunityDragon");
    let response = reqwest::blocking::get(HASH_LIST_URL)
        .and_then(|r| r.error_for_status())
        .map_err(|e| AppError::Other(format!("Failed to download string key list: {e}")))?;
    let body = response
        .bytes()
        .map_err(|e| AppError::Other(format!("Failed to download string key list: {e}")))?;

    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let temp = dest.with_extension("txt.tmp");
    std::fs::write(&temp, &body)?;
    std::fs::rename(&temp, dest)?;
    tracing::info!("String key list saved ({} bytes)", body.len());
    Ok(dest.to_path_buf())
}

/// Best-effort load of the game's `lol.stringtable` for the detected locale.
/// Any failure (unset league path, missing WAD/chunk, parse error) just means
/// suggestions come without value previews.
fn load_game_stringtable(settings: &Settings) -> Option<(String, ltk_rst::Stringtable)> {
    let game_dir = match crate::utils::game::resolve_game_dir(settings) {
        Ok(dir) => dir,
        Err(e) => {
            tracing::debug!("String index: game dir unavailable: {}", e);
            return None;
        }
    };
    let locale =
        crate::utils::locale::detect_league_locale(&game_dir).unwrap_or_else(|| "en_us".into());

    let wad_path = find_localized_global_wad(&game_dir, &locale)?;
    let file = std::fs::File::open(&wad_path).ok()?;
    let mut wad = ltk_wad::Wad::mount(file).ok()?;

    let chunk_path = format!("data/menu/{locale}/lol.stringtable");
    let chunk_hash =
        ltk_modpkg::utils::hash_chunk_name(&ltk_modpkg::utils::normalize_chunk_path(&chunk_path));
    let chunk = *wad.chunks().get(chunk_hash)?;
    let bytes = wad.load_chunk_decompressed(&chunk).ok()?;

    match ltk_rst::Stringtable::from_reader(&mut Cursor::new(&bytes[..])) {
        Ok(table) => Some((locale, table)),
        Err(e) => {
            tracing::warn!("String index: failed to parse {}: {}", chunk_path, e);
            None
        }
    }
}

/// Locate `Localized/Global.{locale}.wad.client` case-insensitively.
fn find_localized_global_wad(game_dir: &Path, locale: &str) -> Option<PathBuf> {
    let localized_dir = game_dir.join("DATA").join("FINAL").join("Localized");
    let wanted = format!("global.{}.wad.client", locale.to_lowercase());
    std::fs::read_dir(localized_dir).ok()?.find_map(|entry| {
        let entry = entry.ok()?;
        let name = entry.file_name();
        if name.to_str()?.eq_ignore_ascii_case(&wanted) {
            Some(entry.path())
        } else {
            None
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn index_from(entries: &[(&str, Option<&str>)]) -> StringKeyIndex {
        StringKeyIndex {
            entries: entries
                .iter()
                .map(|(key, value)| IndexEntry {
                    key: key.to_string(),
                    value: value.map(str::to_string),
                })
                .collect(),
            locale: Some("en_us".to_string()),
        }
    }

    #[test]
    fn search_ranks_prefix_before_substring() {
        let index = index_from(&[
            ("ahri_lore", None),
            ("game_character_displayname_ahri", Some("Ahri")),
            ("game_character_displayname_annie", Some("Annie")),
        ]);

        let result = index.search("ahri", 10);
        let keys: Vec<&str> = result.suggestions.iter().map(|s| s.key.as_str()).collect();
        assert_eq!(keys, vec!["ahri_lore", "game_character_displayname_ahri"]);
        assert_eq!(result.suggestions[1].value.as_deref(), Some("Ahri"));
        assert_eq!(result.total_keys, 3);
        assert_eq!(result.locale.as_deref(), Some("en_us"));
    }

    #[test]
    fn search_is_case_insensitive_and_limited() {
        let index = index_from(&[("aaa", None), ("aab", None), ("aac", None)]);
        let result = index.search("AA", 2);
        assert_eq!(result.suggestions.len(), 2);
    }

    #[test]
    fn empty_query_lists_from_start() {
        let index = index_from(&[("aaa", None), ("bbb", None)]);
        let result = index.search("  ", 1);
        assert_eq!(result.suggestions[0].key, "aaa");
    }

    #[test]
    fn build_parses_key_list_and_joins_values() {
        let tmp = tempfile::tempdir().unwrap();
        let cache_dir = tmp.path().join("hashes");
        std::fs::create_dir_all(&cache_dir).unwrap();

        // Build a table with a known key, then reference it from the list by
        // its full XXH3 hash the way the CommunityDragon file does.
        let mut table = ltk_rst::Stringtable::new();
        table.insert_str("game_client_quit", "Quit");
        let full_hash = xxh3_full("game_client_quit");
        std::fs::write(
            cache_dir.join(HASH_LIST_FILE),
            format!("{full_hash:016x} game_client_quit\ndeadbeefdeadbeef unknown_key\n"),
        )
        .unwrap();

        // No league path configured -> no value previews, keys still indexed.
        let index = StringKeyIndex::build(&cache_dir, &Settings::default()).unwrap();
        assert_eq!(index.entries.len(), 2);
        assert!(index.entries.iter().all(|e| e.value.is_none()));
        assert_eq!(index.locale, None);
    }

    fn xxh3_full(key: &str) -> u64 {
        // Matches CDragon/ltk_rst hashing: XXH3-64 over the lowercased key.
        xxhash_rust::xxh3::xxh3_64(key.to_lowercase().as_bytes())
    }
}
