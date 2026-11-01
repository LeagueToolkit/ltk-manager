//! Files two enabled mods both replace, and which mod the reader picked for each group.
//!
//! The overlay merges by priority, so the first enabled mod wins every shared
//! file. A pick overrides that per group: the losing mods are wrapped in
//! [`WithoutFiles`] at build time, so their copies never reach the overlay.

use crate::mods::ModLibrary;
use camino::{Utf8Path, Utf8PathBuf};
use ltk_manager_base::config::Config;
use ltk_manager_base::error::{AppError, AppResult};
use ltk_mod_project::ModProject;
use ltk_overlay::{CompressedChunk, ContentHash, ModContentProvider};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::Path;

const CHOICES_FILE: &str = "conflicts.json";
const SCAN_FILE: &str = "conflict_scan.json";

/// One group of shared files: the same kind of asset, claimed by the same mods.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ConflictGroup {
    pub key: String,
    pub label: String,
    pub files: usize,
    /// The competing mods, highest priority first.
    pub mods: Vec<ConflictMod>,
    pub winner: String,
    /// Whether `winner` is the reader's pick rather than the priority default.
    pub chosen: bool,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ConflictMod {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Choices {
    /// Group key to the mod that wins it.
    picks: BTreeMap<String, String>,
    /// Chunk hashes each losing mod is built without, derived from `picks`.
    dropped: BTreeMap<String, BTreeSet<u64>>,
}

/// One override file of a mod, as the overlay keys it.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ScannedFile {
    hash: u64,
    content: u64,
    path: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct ScanCache {
    mods: HashMap<String, CachedScan>,
}

#[derive(Debug, Serialize, Deserialize)]
struct CachedScan {
    fingerprint: u64,
    files: Vec<ScannedFile>,
}

fn read_json<T: Default + for<'de> Deserialize<'de>>(path: &Path) -> T {
    std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn write_json(path: &Path, value: &impl Serialize) -> AppResult<()> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec(value)?)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// The chunk hashes each mod is built without, keyed by mod id.
pub(crate) fn load_dropped(storage_dir: &Path) -> HashMap<String, HashSet<u64>> {
    read_json::<Choices>(&storage_dir.join(CHOICES_FILE))
        .dropped
        .into_iter()
        .map(|(id, hashes)| (id, hashes.into_iter().collect()))
        .collect()
}

/// What kind of asset a WAD path is, for grouping.
pub(crate) fn asset_kind(path: &str) -> &'static str {
    let p = path.to_ascii_lowercase().replace('\\', "/");
    let ext = p.rsplit('.').next().unwrap_or("");
    if p.contains("/hud/") || p.contains("icons2d") {
        "Ability icons"
    } else if p.contains("loadscreen") {
        "Loading screen"
    } else if matches!(ext, "bnk" | "wpk") || p.contains("/sounds/") {
        "Sounds"
    } else if p.contains("/particles/") {
        "VFX"
    } else if ext == "bin" {
        "Skin data"
    } else if matches!(ext, "skn" | "skl" | "anm" | "scb" | "sco") || p.contains("/skins/") {
        "Model & textures"
    } else {
        "Other files"
    }
}

/// The champion a path belongs to, from its `characters/<name>/` segment.
fn champion(path: &str) -> Option<String> {
    let p = path.to_ascii_lowercase().replace('\\', "/");
    let rest = &p[p.find("characters/")? + "characters/".len()..];
    let name = rest
        .split('/')
        .next()
        .filter(|n| !n.is_empty() && !n.contains('.'))?;
    let mut chars = name.chars();
    Some(chars.next()?.to_uppercase().chain(chars).collect())
}

fn is_hashed(path: &str) -> bool {
    Utf8Path::new(path)
        .file_stem()
        .is_some_and(|s| s.len() == 16 && s.chars().all(|c| c.is_ascii_hexdigit()))
}

fn scan(content: &mut dyn ModContentProvider) -> ltk_overlay::Result<Vec<ScannedFile>> {
    let mut seen = HashSet::new();
    let mut files = Vec::new();
    let mut push = |rel: Utf8PathBuf, bytes: Vec<u8>| -> ltk_overlay::Result<()> {
        let hash = ltk_overlay::utils::resolve_chunk_hash(&rel, &bytes)?.0;
        if seen.insert(hash) {
            files.push(ScannedFile {
                hash,
                content: ContentHash::of(&bytes).0,
                path: rel.into_string(),
            });
        }
        Ok(())
    };
    let project = content.mod_project()?;
    for layer in &project.layers {
        for wad in content.list_layer_wads(&layer.name)? {
            content.visit_wad_override(&layer.name, &wad, &mut |r, b| push(r, b))?;
        }
    }
    content.visit_raw_override(&mut |r, b| push(r, b))?;
    Ok(files)
}

/// Shared files grouped by asset kind and competing mods, for mods in priority order.
fn group(mods: &[(ConflictMod, Vec<ScannedFile>)]) -> Vec<(String, String, Vec<usize>, Vec<u64>)> {
    let mut owners: HashMap<u64, Vec<(usize, &ScannedFile)>> = HashMap::new();
    for (idx, (_, files)) in mods.iter().enumerate() {
        for f in files {
            owners.entry(f.hash).or_default().push((idx, f));
        }
    }

    let mut groups: BTreeMap<String, (String, Vec<usize>, Vec<u64>)> = BTreeMap::new();
    for (hash, claims) in owners {
        if claims.len() < 2 || claims.iter().all(|(_, f)| f.content == claims[0].1.content) {
            continue;
        }
        let path = claims
            .iter()
            .map(|(_, f)| f.path.as_str())
            .find(|p| !is_hashed(p))
            .unwrap_or(&claims[0].1.path);
        let kind = asset_kind(path);
        let label = match champion(path) {
            Some(c) => format!("{c} · {kind}"),
            None => kind.to_string(),
        };
        let idxs: Vec<usize> = claims.iter().map(|(i, _)| *i).collect();
        let mut ids: Vec<&str> = idxs.iter().map(|&i| mods[i].0.id.as_str()).collect();
        ids.sort_unstable();
        let key = format!("{label}|{}", ids.join(","));
        groups
            .entry(key)
            .or_insert_with(|| (label, idxs, Vec::new()))
            .2
            .push(hash);
    }
    groups
        .into_iter()
        .map(|(key, (label, idxs, hashes))| (key, label, idxs, hashes))
        .collect()
}

impl ModLibrary {
    /// Shared files between the active profile's enabled mods, with each group's winner.
    ///
    /// # Errors
    ///
    /// Fails when the library cannot be read or a mod's content cannot be opened.
    pub fn mod_conflicts(&self, config: &Config) -> AppResult<Vec<ConflictGroup>> {
        self.resolve_conflicts(config, None)
    }

    /// Make `winner` win the group `key`, or hand it back to priority with `None`.
    ///
    /// # Errors
    ///
    /// Fails as [`mod_conflicts`](Self::mod_conflicts) does, or when the pick cannot be saved.
    pub fn set_conflict_winner(
        &self,
        config: &Config,
        key: String,
        winner: Option<String>,
    ) -> AppResult<Vec<ConflictGroup>> {
        self.resolve_conflicts(config, Some((key, winner)))
    }

    fn resolve_conflicts(
        &self,
        config: &Config,
        pick: Option<(String, Option<String>)>,
    ) -> AppResult<Vec<ConflictGroup>> {
        let storage_dir = self.storage_dir(config)?;
        let names: HashMap<String, String> = self
            .get_installed_mods(config)?
            .into_iter()
            .map(|m| (m.id, m.display_name))
            .collect();
        let enabled = self.with_index(config, |_, index| {
            let profile = index
                .profiles
                .iter()
                .find(|p| p.id == index.active_profile_id)
                .ok_or_else(|| AppError::Other("Active profile not found".to_string()))?;
            Ok(profile.enabled_mods.clone())
        })?;

        let scan_path = storage_dir.join(SCAN_FILE);
        let mut cache: ScanCache = read_json(&scan_path);
        let mut mods = Vec::new();
        for id in enabled {
            let Some(name) = names.get(&id) else { continue };
            let (_, mut enabled_mod) = match self.build_single_mod_provider(config, &id) {
                Ok(m) => m,
                Err(e) => {
                    tracing::warn!("Conflict scan skipped {id}: {e}");
                    continue;
                }
            };
            let fingerprint = enabled_mod.content.content_fingerprint().ok().flatten();
            let files = match (fingerprint, cache.mods.get(&id)) {
                (Some(fp), Some(hit)) if hit.fingerprint == fp => hit.files.clone(),
                _ => {
                    let files = scan(enabled_mod.content.as_mut()).map_err(AppError::Overlay)?;
                    if let Some(fp) = fingerprint {
                        cache.mods.insert(
                            id.clone(),
                            CachedScan {
                                fingerprint: fp,
                                files: files.clone(),
                            },
                        );
                    }
                    files
                }
            };
            mods.push((
                ConflictMod {
                    id,
                    name: name.clone(),
                },
                files,
            ));
        }
        let live: HashSet<&str> = mods.iter().map(|(m, _)| m.id.as_str()).collect();
        cache.mods.retain(|id, _| live.contains(id.as_str()));
        if let Err(e) = write_json(&scan_path, &cache) {
            tracing::warn!("Could not save the conflict scan: {e}");
        }

        let choices_path = storage_dir.join(CHOICES_FILE);
        let mut choices: Choices = read_json(&choices_path);
        match pick {
            Some((key, Some(winner))) => {
                choices.picks.insert(key, winner);
            }
            Some((key, None)) => {
                choices.picks.remove(&key);
            }
            None => {}
        }

        let mut out = Vec::new();
        let mut dropped: BTreeMap<String, BTreeSet<u64>> = BTreeMap::new();
        for (key, label, idxs, hashes) in group(&mods) {
            let members: Vec<ConflictMod> = idxs.iter().map(|&i| mods[i].0.clone()).collect();
            let picked = choices
                .picks
                .get(&key)
                .filter(|w| members.iter().any(|m| &m.id == *w))
                .cloned();
            if let Some(winner) = &picked {
                for m in members.iter().filter(|m| &m.id != winner) {
                    dropped
                        .entry(m.id.clone())
                        .or_default()
                        .extend(hashes.iter().copied());
                }
            }
            out.push(ConflictGroup {
                winner: picked.clone().unwrap_or_else(|| members[0].id.clone()),
                chosen: picked.is_some(),
                key,
                label,
                files: hashes.len(),
                mods: members,
            });
        }
        choices.dropped = dropped;
        write_json(&choices_path, &choices)?;
        Ok(out)
    }
}

/// A mod's content minus the files it lost to another mod's pick.
pub(crate) struct WithoutFiles {
    pub(crate) inner: Box<dyn ModContentProvider>,
    pub(crate) dropped: HashSet<u64>,
}

impl WithoutFiles {
    fn keeps(&self, rel: &Utf8Path, bytes: &[u8]) -> bool {
        ltk_overlay::utils::resolve_chunk_hash(rel, bytes)
            .map_or(true, |h| !self.dropped.contains(&h.0))
    }
}

impl ModContentProvider for WithoutFiles {
    fn mod_project(&mut self) -> ltk_overlay::Result<ModProject> {
        self.inner.mod_project()
    }

    fn list_layer_wads(&mut self, layer: &str) -> ltk_overlay::Result<Vec<String>> {
        self.inner.list_layer_wads(layer)
    }

    fn read_wad_overrides(
        &mut self,
        layer: &str,
        wad_name: &str,
    ) -> ltk_overlay::Result<Vec<(Utf8PathBuf, Vec<u8>)>> {
        let all = self.inner.read_wad_overrides(layer, wad_name)?;
        Ok(all.into_iter().filter(|(r, b)| self.keeps(r, b)).collect())
    }

    fn visit_wad_override(
        &mut self,
        layer: &str,
        wad_name: &str,
        visit: &mut dyn FnMut(Utf8PathBuf, Vec<u8>) -> ltk_overlay::Result<()>,
    ) -> ltk_overlay::Result<()> {
        let dropped = &self.dropped;
        self.inner.visit_wad_override(layer, wad_name, &mut |r, b| {
            let keep = ltk_overlay::utils::resolve_chunk_hash(&r, &b)
                .map_or(true, |h| !dropped.contains(&h.0));
            if keep { visit(r, b) } else { Ok(()) }
        })
    }

    fn read_raw_overrides(&mut self) -> ltk_overlay::Result<Vec<(Utf8PathBuf, Vec<u8>)>> {
        let all = self.inner.read_raw_overrides()?;
        Ok(all.into_iter().filter(|(r, b)| self.keeps(r, b)).collect())
    }

    fn visit_raw_override(
        &mut self,
        visit: &mut dyn FnMut(Utf8PathBuf, Vec<u8>) -> ltk_overlay::Result<()>,
    ) -> ltk_overlay::Result<()> {
        let dropped = &self.dropped;
        self.inner.visit_raw_override(&mut |r, b| {
            let keep = ltk_overlay::utils::resolve_chunk_hash(&r, &b)
                .map_or(true, |h| !dropped.contains(&h.0));
            if keep { visit(r, b) } else { Ok(()) }
        })
    }

    /// The inner fingerprint salted with the dropped set, so a new pick invalidates the cache.
    fn content_fingerprint(&self) -> ltk_overlay::Result<Option<u64>> {
        let mut sorted: Vec<u64> = self.dropped.iter().copied().collect();
        sorted.sort_unstable();
        let mut h = DefaultHasher::new();
        sorted.hash(&mut h);
        Ok(self.inner.content_fingerprint()?.map(|fp| fp ^ h.finish()))
    }

    fn read_wad_override_file(
        &mut self,
        layer: &str,
        wad_name: &str,
        rel_path: &Utf8Path,
    ) -> ltk_overlay::Result<Vec<u8>> {
        self.inner.read_wad_override_file(layer, wad_name, rel_path)
    }

    fn read_raw_override_file(&mut self, rel_path: &Utf8Path) -> ltk_overlay::Result<Vec<u8>> {
        self.inner.read_raw_override_file(rel_path)
    }

    fn read_wad_override_compressed(
        &mut self,
        layer: &str,
        wad_name: &str,
        rel_path: &Utf8Path,
    ) -> ltk_overlay::Result<Option<CompressedChunk>> {
        self.inner
            .read_wad_override_compressed(layer, wad_name, rel_path)
    }
}

#[cfg(test)]
mod tests;
