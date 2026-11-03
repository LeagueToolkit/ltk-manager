//! What character inking reads out of each skin bin and mesh, cached by chunk checksum.

use super::super::game_skins::GameSkins;
use super::super::mod_skins::ModSkins;
use super::super::skin_bin::SkinBin;
use fs_err as fs;
use ltk_hash::BinHash;
use ltk_manager_base::error::AppResult;
use ltk_manager_base::utils::fs::atomic_write;
use ltk_mesh::{SKN_MAGIC, SkinnedMeshRange};
use ltk_meta::{Bin, PropertyValueEnum};
use ltk_overlay::ContentHash;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};

/// The file in the mod's cache directory that holds the facts of every skin and mesh read.
const CACHE_FILE: &str = "inking-skins.json";

/// Changes when [`SkinFacts`] or the mesh read changes, so an older cache is read again.
const CACHE_VERSION: u32 = 1;

/// The `SkinMeshDataProperties` field that lists the outlined submeshes.
pub(super) const OUTLINE_LIST: &str = "OutlineCategorySubmeshes";

/// What a skin bin holds that character inking reads.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct SkinFacts {
    /// `true` if the skin already lists an outline category.
    pub(super) listed: bool,
    /// `skinMeshProperties.simpleSkin`, lowercased.
    pub(super) mesh: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Cache {
    version: u32,
    /// Each skin's facts, by `g` and the game chunk checksum or `m` and the mod content hash.
    skins: BTreeMap<String, SkinFacts>,
    /// Each mesh's submesh names in mesh order, keyed as `skins` is.
    meshes: BTreeMap<String, Vec<String>>,
}

/// The skin and mesh reads of one build, through a cache that the build rewrites.
///
/// The cache keeps only the entries the build used, so it holds one patch's worth of keys.
pub(super) struct SkinReads {
    path: PathBuf,
    cached: Cache,
    used: Cache,
}

impl SkinReads {
    /// Opens the cache in `cache_dir`. An unreadable or older cache starts empty.
    pub(super) fn open(cache_dir: &Path) -> Self {
        let path = cache_dir.join(CACHE_FILE);
        let cached = fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Cache>(&bytes).ok())
            .filter(|cache| cache.version == CACHE_VERSION)
            .unwrap_or_default();
        Self {
            path,
            cached,
            used: Cache {
                version: CACHE_VERSION,
                ..Cache::default()
            },
        }
    }

    /// Reads the facts of `source`, the bin that the game loads, out of the mod that ships it or
    /// the game. Returns `None` if neither holds a bin that reads.
    ///
    /// `source` is the skin whose objects the loaded bin holds. A stand-in holds skin 0's.
    pub(super) fn skin(
        &mut self,
        source: &SkinBin,
        game: &mut GameSkins<'_>,
        mods: &mut ModSkins<'_>,
    ) -> Option<SkinFacts> {
        let (key, bytes) = if mods.ships(source) {
            let bytes = mods.read(source)?;
            (format!("m{}", ContentHash::of(&bytes)), Some(bytes))
        } else {
            (format!("g{:016x}", game.checksum(&source.path())?), None)
        };
        if let Some(facts) = self.cached.skins.get(&key) {
            self.used.skins.insert(key, facts.clone());
            return Some(facts.clone());
        }

        let bytes = match bytes {
            Some(bytes) => bytes,
            None => game.read(source)?,
        };
        let facts = skin_facts(source, &bytes);
        self.used.skins.insert(key, facts.clone());
        Some(facts)
    }

    /// Reads the submesh names of the mesh at the lowercased chunk path `path`, out of the mod
    /// that holds it or the game. Returns `None` if neither holds a mesh that reads.
    pub(super) fn submeshes(
        &mut self,
        path: &str,
        game: &mut GameSkins<'_>,
        mods: &mut ModSkins<'_>,
    ) -> Option<Vec<String>> {
        let from_mod = mods.mesh(path);
        let key = match from_mod {
            Some(content) => format!("m{content}"),
            None => format!("g{:016x}", game.checksum(path)?),
        };
        if let Some(names) = self.cached.meshes.get(&key) {
            self.used.meshes.insert(key, names.clone());
            return Some(names.clone());
        }

        let bytes = match from_mod {
            Some(_) => mods.read_mesh(path)?,
            None => game.read_chunk(path)?,
        };
        let names = submesh_names(&bytes)
            .inspect_err(|e| tracing::warn!("Built-in mods: cannot read {path}: {e}"))
            .ok()?;
        self.used.meshes.insert(key, names.clone());
        Some(names)
    }

    /// Writes the entries this build used. A cache that does not write is logged, since the next
    /// build reads the chunks again.
    pub(super) fn save(self) {
        let write = || -> AppResult<()> {
            if let Some(parent) = self.path.parent() {
                fs::create_dir_all(parent)?;
            }
            atomic_write(&self.path, &serde_json::to_vec(&self.used)?)?;
            Ok(())
        };
        if let Err(e) = write() {
            tracing::warn!("Built-in mods: cannot cache {}: {e}", self.path.display());
        }
    }
}

/// Reads the facts of `bin`'s skin object out of `bytes`. A bin that does not read, or holds no
/// such object, has no mesh.
fn skin_facts(bin: &SkinBin, bytes: &[u8]) -> SkinFacts {
    let Ok(parsed) = Bin::from_reader(&mut Cursor::new(bytes)) else {
        tracing::warn!("Built-in mods: cannot read {}", bin.path());
        return SkinFacts::default();
    };
    let Some(skin) = parsed.objects.get(&skin_object(bin)) else {
        return SkinFacts::default();
    };
    let Some(PropertyValueEnum::Embedded(mesh_properties)) =
        skin.properties.get(&BinHash::from("skinMeshProperties"))
    else {
        return SkinFacts::default();
    };

    let properties = &mesh_properties.0.properties;
    let listed = match properties.get(&BinHash::from(OUTLINE_LIST)) {
        Some(PropertyValueEnum::Container(list)) => !list.items().is_empty(),
        Some(PropertyValueEnum::UnorderedContainer(list)) => !list.items().is_empty(),
        _ => false,
    };
    let mesh = match properties.get(&BinHash::from("simpleSkin")) {
        Some(PropertyValueEnum::String(path)) if !path.value.is_empty() => {
            Some(path.value.replace('\\', "/").to_ascii_lowercase())
        }
        _ => None,
    };
    SkinFacts { listed, mesh }
}

/// `Characters/<character>/Skins/Skin<id>`, the object of `bin` that holds the skin.
pub(super) fn skin_entry(bin: &SkinBin) -> String {
    format!("Characters/{}/Skins/Skin{}", bin.character, bin.id)
}

fn skin_object(bin: &SkinBin) -> BinHash {
    BinHash::from(skin_entry(bin).as_str())
}

/// Reads the submesh names in the header of the `.skn` in `bytes`, without its buffers.
///
/// # Errors
///
/// Fails if the bytes are not a `.skn`, its version is one with no submesh table, or the table
/// is cut short.
pub(super) fn submesh_names(bytes: &[u8]) -> Result<Vec<String>, String> {
    let mut reader = Cursor::new(bytes);
    let mut word = [0u8; 4];
    let mut read_word = |reader: &mut Cursor<&[u8]>| -> Result<[u8; 4], String> {
        reader.read_exact(&mut word).map_err(|e| e.to_string())?;
        Ok(word)
    };

    if u32::from_le_bytes(read_word(&mut reader)?) != SKN_MAGIC {
        return Err("not a skinned mesh".to_owned());
    }
    let version = read_word(&mut reader)?;
    let major = u16::from_le_bytes([version[0], version[1]]);
    if major == 0 {
        return Err("version 0 has no submesh table".to_owned());
    }

    let count = u32::from_le_bytes(read_word(&mut reader)?);
    (0..count)
        .map(|_| {
            SkinnedMeshRange::from_reader(&mut reader)
                .map(|range| range.material)
                .map_err(|e| e.to_string())
        })
        .collect()
}
