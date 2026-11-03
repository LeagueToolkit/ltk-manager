//! The skin bins and base skin models the mods below a built-in mod ship, read once per mod
//! content and layer selection.

use super::game_skins::GameSkins;
use super::skin_bin::SkinBin;
use camino::{Utf8Path, Utf8PathBuf};
use fs_err as fs;
use ltk_manager_base::error::AppResult;
use ltk_overlay::{ContentHash, EnabledMod};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, btree_map};
use std::path::Path;

/// The file in a built-in mod's cache directory holding what each mod held when last read.
const CACHE_FILE: &str = "shipped-skins.json";

/// Changes when [`Held`] changes, so a cache that an older build wrote is read again.
const CACHE_VERSION: u32 = 2;

/// The extensions of a skin's mesh and textures.
const MODEL_EXTENSIONS: [&str; 3] = [".skn", ".tex", ".dds"];

/// The skin bins the mods below a built-in mod ship, per ADR-0043, readable out of the mod.
///
/// A mod ships a skin bin when a layer it has turned on holds the bin with bytes other than the
/// game's. A bin two mods ship is the first one's, as in the overlay. A base model file ships
/// the same way.
pub(super) struct ModSkins<'m> {
    mods: &'m mut [EnabledMod],
    shipped: BTreeMap<SkinBin, Shipped>,
    /// Each character for which a mod ships a base model file.
    remodeled: BTreeSet<String>,
    /// Each character mesh a mod holds, by its lowercased chunk path, the first mod's where two
    /// hold one.
    meshes: BTreeMap<String, (ContentHash, Shipped)>,
}

/// Where one mod holds a skin bin it ships.
struct Shipped {
    /// The mod's index in the mods the skin bins were read out of.
    mod_index: usize,
    file: ModFile,
}

/// Where a mod holds a file, to read it again.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
enum ModFile {
    Layer {
        layer: String,
        wad: String,
        rel_path: Utf8PathBuf,
    },
    Raw {
        rel_path: Utf8PathBuf,
    },
}

/// What each mod held when last read, under any profile, named against that read's roster.
#[derive(Debug, Default, Serialize, Deserialize)]
struct Cache {
    #[serde(default)]
    version: u32,
    roster: Vec<String>,
    mods: BTreeMap<String, CachedMod>,
}

#[derive(Debug, Serialize, Deserialize)]
struct CachedMod {
    fingerprint: u64,
    held: Held,
}

/// The skin bins and base model files one mod holds.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Held {
    skin_bins: Vec<(SkinBin, ContentHash, ModFile)>,
    base_models: Vec<(BaseModel, ContentHash)>,
    /// Each `.skn` under `assets/characters/`, by its lowercased chunk path.
    meshes: Vec<(String, ContentHash, ModFile)>,
}

impl Held {
    fn keep(&mut self, named: Named, content: ContentHash, file: ModFile) {
        match named {
            Named::SkinBin(bin) => self.skin_bins.push((bin, content, file)),
            Named::BaseModel(model) => {
                if is_mesh(&model.path) {
                    self.meshes.push((model.path.clone(), content, file));
                }
                self.base_models.push((model, content));
            }
            Named::Mesh(path) => self.meshes.push((path, content, file)),
        }
    }
}

/// Whether the lowercased chunk path `path` is a character mesh.
fn is_mesh(path: &str) -> bool {
    path.starts_with("assets/characters/") && path.ends_with(".skn")
}

/// A mesh or texture of a character's base skin, directly in
/// `assets/characters/<character>/skins/base/`.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub(super) struct BaseModel {
    pub(super) character: String,
    /// The chunk path, lowercased.
    path: String,
}

impl BaseModel {
    /// The base model file at the chunk path `path`, where it is one.
    pub(super) fn parse(path: &str) -> Option<Self> {
        let path = path.replace('\\', "/").to_ascii_lowercase();
        let (character, file) = path
            .strip_prefix("assets/characters/")?
            .split_once("/skins/base/")?;
        let model = MODEL_EXTENSIONS
            .iter()
            .any(|extension| file.ends_with(extension));
        if character.is_empty() || character.contains('/') || file.contains('/') || !model {
            return None;
        }

        let character = character.to_owned();
        Some(Self { character, path })
    }
}

/// A file of a mod the skins read, named by its path.
enum Named {
    SkinBin(SkinBin),
    BaseModel(BaseModel),
    /// A character mesh outside the base skin, by its lowercased chunk path.
    Mesh(String),
}

impl Named {
    fn parse(path: &str) -> Option<Self> {
        SkinBin::parse(path)
            .map(Self::SkinBin)
            .or_else(|| BaseModel::parse(path).map(Self::BaseModel))
            .or_else(|| {
                let path = path.replace('\\', "/").to_ascii_lowercase();
                is_mesh(&path).then_some(Self::Mesh(path))
            })
    }
}

impl<'m> ModSkins<'m> {
    /// Every skin bin one of `mods` ships over `game`, caching what each mod holds in
    /// `cache_dir`.
    ///
    /// A mod whose [`EnabledMod::cache_fingerprint`] matches the cache is not read again, and a
    /// mod that cannot be read is passed over, since the overlay build reports it.
    pub(super) fn load(
        mods: &'m mut [EnabledMod],
        game: &mut GameSkins<'_>,
        cache_dir: &Path,
    ) -> Self {
        let path = cache_dir.join(CACHE_FILE);
        let mut cache = read_cache(&path)
            .filter(|cache| cache.version == CACHE_VERSION && cache.roster == game.roster())
            .unwrap_or_else(|| Cache {
                version: CACHE_VERSION,
                roster: game.roster().to_vec(),
                mods: BTreeMap::new(),
            });
        let mut changed = false;

        let mut held = BTreeMap::new();
        let mut held_models = BTreeMap::new();
        let mut meshes = BTreeMap::new();
        for (mod_index, enabled_mod) in mods.iter_mut().enumerate() {
            let fingerprint = enabled_mod.cache_fingerprint();
            let cached = fingerprint.and_then(|fingerprint| {
                cache
                    .mods
                    .get(&enabled_mod.id)
                    .filter(|cached| cached.fingerprint == fingerprint)
            });
            let holds = match cached {
                Some(cached) => cached.held.clone(),
                None => match held_by(enabled_mod, game) {
                    Ok(holds) => holds,
                    Err(e) => {
                        tracing::warn!("Built-in mods: passing over mod {}: {e}", enabled_mod.id);
                        continue;
                    }
                },
            };

            for (bin, content, file) in &holds.skin_bins {
                if let btree_map::Entry::Vacant(entry) = held.entry(bin.clone()) {
                    entry.insert((
                        *content,
                        Shipped {
                            mod_index,
                            file: file.clone(),
                        },
                    ));
                }
            }
            for (model, content) in &holds.base_models {
                held_models.entry(model.clone()).or_insert(*content);
            }
            for (mesh, content, file) in &holds.meshes {
                meshes.entry(mesh.clone()).or_insert_with(|| {
                    let file = file.clone();
                    (*content, Shipped { mod_index, file })
                });
            }

            if cached.is_none() {
                changed = true;
                match fingerprint {
                    Some(fingerprint) => cache.mods.insert(
                        enabled_mod.id.clone(),
                        CachedMod {
                            fingerprint,
                            held: holds,
                        },
                    ),
                    None => cache.mods.remove(&enabled_mod.id),
                };
            }
        }

        if changed && let Err(e) = write_cache(&path, &cache) {
            tracing::warn!("Built-in mods: cannot cache {}: {e}", path.display());
        }

        let shipped = held
            .into_iter()
            .filter(|(bin, (content, _))| {
                game.read(bin)
                    .is_none_or(|bytes| ContentHash::of(&bytes) != *content)
            })
            .map(|(bin, (_, shipped))| (bin, shipped))
            .collect();
        let remodeled = held_models
            .into_iter()
            .filter(|(model, content)| {
                game.read_chunk(&model.path)
                    .is_none_or(|bytes| ContentHash::of(&bytes) != *content)
            })
            .map(|(model, _)| model.character)
            .collect();

        Self {
            mods,
            shipped,
            remodeled,
            meshes,
        }
    }

    pub(super) fn ships(&self, bin: &SkinBin) -> bool {
        self.shipped.contains_key(bin)
    }

    /// Each character whose base skin a mod changes, by its skin bin or a base model file.
    pub(super) fn reskinned(&self) -> BTreeSet<&str> {
        self.shipped
            .keys()
            .filter(|bin| bin.is_base())
            .map(|bin| bin.character.as_str())
            .chain(self.remodeled.iter().map(String::as_str))
            .collect()
    }

    /// The bytes of `bin` out of the mod shipping it, where one does and it reads.
    pub(super) fn read(&mut self, bin: &SkinBin) -> Option<Vec<u8>> {
        let shipped = self.shipped.get(bin)?;
        read_file(self.mods, shipped, &bin.path())
    }

    /// The content hash of the mesh at the lowercased chunk path `path`, where a mod holds it.
    pub(super) fn mesh(&self, path: &str) -> Option<ContentHash> {
        self.meshes.get(path).map(|(content, _)| *content)
    }

    /// The bytes of the mesh at the lowercased chunk path `path` out of the mod holding it,
    /// where one does and it reads.
    pub(super) fn read_mesh(&mut self, path: &str) -> Option<Vec<u8>> {
        let (_, shipped) = self.meshes.get(path)?;
        read_file(self.mods, shipped, path)
    }
}

/// The bytes of `shipped` out of its mod in `mods`. Returns `None` and logs if it does not read.
fn read_file(mods: &mut [EnabledMod], shipped: &Shipped, chunk_path: &str) -> Option<Vec<u8>> {
    let content = &mut mods[shipped.mod_index].content;
    let bytes = match &shipped.file {
        ModFile::Layer {
            layer,
            wad,
            rel_path,
        } => content.read_wad_override_file(layer, wad, rel_path),
        ModFile::Raw { rel_path } => content.read_raw_override_file(rel_path),
    };
    bytes
        .inspect_err(|e| tracing::warn!("Built-in mods: cannot read {chunk_path}: {e}"))
        .ok()
}

/// The skin bins and base model files `enabled_mod` holds, read out of each layer it has turned
/// on and its raw files.
fn held_by(enabled_mod: &mut EnabledMod, game: &GameSkins<'_>) -> ltk_overlay::Result<Held> {
    let project = enabled_mod.content.mod_project()?;
    let mut files = Files::default();
    for layer in &project.layers {
        if !enabled_mod.is_layer_active(&layer.name) {
            continue;
        }
        for wad in enabled_mod.content.list_layer_wads(&layer.name)? {
            enabled_mod
                .content
                .visit_wad_override(&layer.name, &wad, &mut |rel_path, bytes| {
                    let file = ModFile::Layer {
                        layer: layer.name.clone(),
                        wad: wad.clone(),
                        rel_path: rel_path.clone(),
                    };
                    files.push(&rel_path, &bytes, file)
                })?;
        }
    }
    enabled_mod
        .content
        .visit_raw_override(&mut |rel_path, bytes| {
            let file = ModFile::Raw {
                rel_path: rel_path.clone(),
            };
            files.push(&rel_path, &bytes, file)
        })?;
    Ok(files.into_held(game))
}

/// The files of one mod as they are read, named by path or kept by hash to name in one pass.
#[derive(Default)]
struct Files {
    held: Held,
    hashed: Vec<(ltk_wad::WadHash, ContentHash, ModFile)>,
}

impl Files {
    fn push(
        &mut self,
        rel_path: &Utf8Path,
        bytes: &[u8],
        file: ModFile,
    ) -> ltk_overlay::Result<()> {
        let content = ContentHash::of(bytes);
        match Named::parse(rel_path.as_str()) {
            Some(named) => self.held.keep(named, content, file),
            None => self.hashed.push((
                ltk_overlay::utils::resolve_chunk_hash(rel_path, bytes)?,
                content,
                file,
            )),
        }
        Ok(())
    }

    fn into_held(mut self, game: &GameSkins<'_>) -> Held {
        let hashes: Vec<_> = self.hashed.iter().map(|(hash, _, _)| *hash).collect();
        let names = game.name_all(&hashes);
        for (name, (_, content, file)) in names.into_iter().zip(self.hashed) {
            if let Some(named) = name.as_deref().and_then(Named::parse) {
                self.held.keep(named, content, file);
            }
        }
        self.held
    }
}

fn read_cache(path: &Path) -> Option<Cache> {
    let bytes = fs::read(path).ok()?;
    serde_json::from_slice(&bytes)
        .inspect_err(|e| tracing::warn!("Built-in mods: ignoring {}: {e}", path.display()))
        .ok()
}

fn write_cache(path: &Path, cache: &Cache) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_vec(cache)?)?;
    Ok(())
}
