//! The data source an editor reads from and writes to. ADR-0056.
//!
//! A sandbox is the installed game alone, or a project's layers stacked over it in the
//! order the overlay applies them. A document opens in one sandbox, and the names and files
//! its reads resolve come from that sandbox.

use std::collections::HashMap;
use std::fmt;
use std::io::BufReader;
use std::path::Path;
use std::sync::{Arc, OnceLock};

use fs_err as fs;
use ltk_hash::{BinHash, Hash as _, WadHash};
use ltk_wad::is_hex_chunk_path;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use crate::bin_document::{AssetLookup, BinDocumentError, ProjectNames, RowNames, hex};
use crate::error::{AppError, AppResult};
use crate::game_index::GameIndex;
use crate::object_index::{DeclaredObject, ObjectDeclaration, for_each_declaration};
use crate::preview::AssetRef;
use crate::workshop::LayerChunks;

/// Which sandbox a document opens in, as it crosses IPC.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SandboxRef {
    /// The installed game alone, which takes no edit.
    Game,
    /// Every layer of a project over the game.
    Project {
        /// The project directory.
        project: String,
    },
    /// One layer of a project over the game. Reserved: nothing opens one yet.
    Layer {
        /// The project directory.
        project: String,
        /// The layer's name.
        layer: String,
    },
}

impl SandboxRef {
    /// The project directory the sandbox reads, or `None` for the game.
    #[must_use]
    pub fn project(&self) -> Option<&str> {
        match self {
            Self::Game => None,
            Self::Project { project } | Self::Layer { project, .. } => Some(project),
        }
    }

    /// Whether this is the game alone.
    #[must_use]
    pub fn is_game(&self) -> bool {
        matches!(self, Self::Game)
    }

    /// The sandbox that holds a document of `asset` opened in this sandbox.
    ///
    /// A layer file is always held in its own project's sandbox, so every sandbox that opens
    /// it shares one tree and one save. A loose file is held in the game sandbox.
    ///
    /// # Panics
    ///
    /// Panics on a League client chunk, which the bin store refuses before asking.
    #[must_use]
    pub fn holding(&self, asset: &AssetRef) -> Self {
        match asset {
            AssetRef::Layer { project, .. } => Self::Project {
                project: project.clone(),
            },
            AssetRef::File { .. } => Self::Game,
            AssetRef::LcuChunk { .. } => unreachable!("a sandbox holds no client chunk"),
            AssetRef::GameChunk { .. } => self.clone(),
        }
    }
}

impl fmt::Display for SandboxRef {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Game => f.write_str("the game"),
            Self::Project { project } => write!(f, "the project {project}"),
            Self::Layer { project, layer } => write!(f, "the layer {layer} of {project}"),
        }
    }
}

/// How a document of one asset opens in a sandbox.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Opening {
    /// Open the file itself: a layer file, a loose file, or a game chunk in the game sandbox.
    File(AssetRef),
    /// A game chunk no layer ships, with the project's declarations applied. ADR-0042.
    Declared {
        /// The game chunk.
        asset: AssetRef,
        /// The chunk's path hash.
        chunk_hash: u64,
    },
}

/// One object a layer file of a sandbox declares.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LayerObject {
    /// The declaring layer file.
    pub asset: AssetRef,
    /// The object's class hash.
    pub class: BinHash,
}

/// A snapshot of one sandbox, read from disk: its layer stack and the names the project
/// defines. [`SandboxState`] reads a new one after the project changes on disk.
#[derive(Debug)]
pub struct Sandbox {
    reference: SandboxRef,
    chunks: LayerChunks,
    /// The objects the stack's bins declare, read the first time they are requested.
    objects: OnceLock<HashMap<BinHash, Vec<LayerObject>>>,
}

impl Sandbox {
    /// Read the sandbox `reference` from disk.
    ///
    /// Best-effort, like [`LayerChunks::scan`]: a project that cannot be read has no layers.
    #[must_use]
    pub fn open(reference: SandboxRef) -> Self {
        let chunks = match &reference {
            SandboxRef::Game => LayerChunks::default(),
            SandboxRef::Project { project } => LayerChunks::scan(Path::new(project)),
            SandboxRef::Layer { project, layer } => {
                LayerChunks::scan_layer(Path::new(project), layer)
            }
        };

        Self {
            reference,
            chunks,
            objects: OnceLock::new(),
        }
    }

    /// The installed game alone.
    #[must_use]
    pub fn game() -> Self {
        Self {
            reference: SandboxRef::Game,
            chunks: LayerChunks::default(),
            objects: OnceLock::new(),
        }
    }

    /// Which sandbox this is.
    #[must_use]
    pub fn reference(&self) -> &SandboxRef {
        &self.reference
    }

    /// The layers bottom first, in `ModProjectLayer::apply_order`. Empty for the game.
    #[must_use]
    pub fn layers(&self) -> &[String] {
        self.chunks.layers()
    }

    /// The names and files the sandbox's layers hold.
    #[must_use]
    pub fn chunks(&self) -> &LayerChunks {
        &self.chunks
    }

    /// The objects the layer bins of the stack declare, by object hash.
    ///
    /// Only the copy of each path that a build packs is read, so an object that a higher
    /// layer's copy of the file removes is absent. Read the first time it is requested. A
    /// bin that cannot be read adds nothing.
    #[must_use]
    pub fn objects(&self) -> &HashMap<BinHash, Vec<LayerObject>> {
        self.objects.get_or_init(|| self.read_objects())
    }

    fn read_objects(&self) -> HashMap<BinHash, Vec<LayerObject>> {
        let mut objects: HashMap<BinHash, Vec<LayerObject>> = HashMap::new();
        for asset in self.chunks.files() {
            let AssetRef::Layer { path, .. } = asset else {
                continue;
            };
            if !path.to_ascii_lowercase().ends_with(".bin") {
                continue;
            }
            let Some(Ok(file)) = asset.layer_file() else {
                continue;
            };

            let read = fs::File::open(&file)
                .map_err(ltk_meta::Error::from)
                .and_then(|file| {
                    for_each_declaration(BufReader::new(file), |declared| {
                        objects
                            .entry(declared.object)
                            .or_default()
                            .push(LayerObject {
                                asset: asset.clone(),
                                class: declared.class,
                            });
                    })
                });
            if let Err(e) = read {
                tracing::debug!("Skipping the objects of {}: {e}", file.display());
            }
        }

        objects
    }

    /// Add the layer files' declarations of `object_hashes` to `objects`, the install's
    /// declarations by hash, ahead of the install's. ADR-0056.
    ///
    /// An install declaration in a chunk a layer ships is removed, because the build packs
    /// the layer's copy instead. `names` names the layer objects, after the project's own
    /// tables.
    pub fn join_declared<N: RowNames>(
        &self,
        object_hashes: &[String],
        names: &N,
        objects: &mut HashMap<String, DeclaredObject>,
    ) {
        let names = self.names(names);
        for declared in objects.values_mut() {
            declared
                .declarations
                .retain(|declaration| !self.ships(&declaration.asset));
        }

        for text in object_hashes {
            let Some(hash) = crate::object_index::parse_hash(text) else {
                continue;
            };
            let Some(declaring) = self.objects().get(&hash) else {
                continue;
            };
            let layers = declaring.iter().filter_map(|object| {
                let AssetRef::Layer { path, .. } = &object.asset else {
                    return None;
                };
                Some(ObjectDeclaration {
                    asset: object.asset.clone(),
                    file: path.clone(),
                    class_hash: hex(object.class),
                    class: names
                        .class_name(object.class)
                        .unwrap_or_else(|| hex(object.class)),
                })
            });

            let declared = objects
                .entry(text.clone())
                .or_insert_with(|| DeclaredObject {
                    path: names.entry_name(hash).unwrap_or_else(|| text.clone()),
                    declarations: Vec::new(),
                });
            declared.declarations.splice(0..0, layers);
        }

        objects.retain(|_, declared| !declared.declarations.is_empty());
    }

    /// Whether a layer ships the game chunk `asset`, so the build packs the layer's copy.
    fn ships(&self, asset: &AssetRef) -> bool {
        asset
            .chunk_hash()
            .is_some_and(|hash| self.chunks.asset_of_chunk(hash).is_some())
    }

    /// How a document of `asset` opens here. A game chunk a layer ships opens as that
    /// layer's file, the copy the build uses.
    ///
    /// # Errors
    ///
    /// [`AppError::InvalidPath`] for a chunk whose path hash is not hex, and
    /// [`BinDocumentError::LcuChunk`] for a League client chunk, which no document of the
    /// game opens.
    pub fn opening(&self, asset: AssetRef) -> AppResult<Opening> {
        if matches!(asset, AssetRef::LcuChunk { .. }) {
            return Err(BinDocumentError::LcuChunk.into());
        }

        let AssetRef::GameChunk { path_hash, .. } = &asset else {
            return Ok(Opening::File(asset));
        };
        if self.reference.is_game() {
            return Ok(Opening::File(asset));
        }

        let chunk_hash = asset
            .chunk_hash()
            .ok_or_else(|| AppError::InvalidPath(format!("Not a chunk path hash: {path_hash}")))?;
        if let Some(file) = self.chunks.asset_of_chunk(chunk_hash) {
            return Ok(Opening::File(file.clone()));
        }

        Ok(Opening::Declared {
            asset,
            chunk_hash: chunk_hash.0,
        })
    }

    /// The names a read in this sandbox resolves: the project's own, then `inner`'s.
    #[must_use]
    pub fn names<'a, N: RowNames>(&'a self, inner: &'a N) -> ProjectNames<'a, N> {
        ProjectNames::new(inner, &self.chunks)
    }

    /// The asset lookup for the paths a document names, in this sandbox. `index` is the
    /// install's game index. Without it, only layer files are found.
    #[must_use]
    pub fn assets<'a>(&'a self, index: Option<&'a GameIndex>) -> SandboxAssets<'a> {
        SandboxAssets {
            chunks: &self.chunks,
            index,
        }
    }
}

/// The chunk path hash of a layer file, as the overlay reads it: the hex name an unpack
/// gave it, or its path inside the archive directory, lowercased.
///
/// `None` for an asset of another source, and for a path with no archive directory.
#[must_use]
pub fn layer_chunk_hash(asset: &AssetRef) -> Option<u64> {
    let AssetRef::Layer { path, .. } = asset else {
        return None;
    };
    let (_, inside) = path.split_once('/')?;

    let named = camino::Utf8Path::new(inside);
    if is_hex_chunk_path(named) {
        return named
            .file_stem()?
            .parse::<WadHash>()
            .ok()
            .map(|hash| hash.0);
    }

    Some(WadHash::hash_str(inside.to_lowercase()).0)
}

/// Finds the file behind a path a document names, in one sandbox.
///
/// A layer's copy is found before the install's, which is the order a `file` link is
/// decided in ("Links" in docs/ux/BIN_EDITOR.md).
#[derive(Debug, Clone, Copy)]
pub struct SandboxAssets<'a> {
    chunks: &'a LayerChunks,
    index: Option<&'a GameIndex>,
}

impl AssetLookup for SandboxAssets<'_> {
    /// The game index finds a path the hash tables name by its path, and any other path by
    /// its hash, which is how the game finds a chunk.
    fn locate(&self, path: &str) -> Option<AssetRef> {
        if let Some(asset) = self.chunks.asset_at(path) {
            return Some(asset.clone());
        }

        /* Lowercase because that is the one spelling a resolved WAD path has. */
        let index = self.index?;
        let file = index
            .file_at(&path.to_lowercase())
            .or_else(|| index.unnamed_at(WadHash::hash_str(path).0))?;

        Some(AssetRef::GameChunk {
            wad: file.wad,
            path_hash: file.path_hash,
        })
    }

    fn locate_chunk(&self, hash: WadHash) -> Option<AssetRef> {
        if let Some(asset) = self.chunks.asset_of_chunk(hash) {
            return Some(asset.clone());
        }

        let file = self.index?.unnamed_at(hash.0)?;
        Some(AssetRef::GameChunk {
            wad: file.wad,
            path_hash: file.path_hash,
        })
    }
}

/// Cached sandbox snapshots, one per [`SandboxRef`], read again after a project changes on
/// disk. A clone shares the cache, so the layer watcher and the commands use one store.
#[derive(Debug, Clone, Default)]
pub struct SandboxState {
    cache: Arc<Mutex<Cache>>,
}

#[derive(Debug, Default)]
struct Cache {
    snapshots: HashMap<SandboxRef, Arc<Sandbox>>,
    /// Counts invalidations, so a read that started before one does not cache what it read.
    generation: u64,
}

impl SandboxState {
    /// The snapshot of `reference`, read from disk when none is cached.
    ///
    /// The read runs with the cache unlocked. Two concurrent reads of one sandbox both scan,
    /// and one snapshot is kept. A caller keeps the snapshot it got after an invalidation.
    #[must_use]
    pub fn get(&self, reference: &SandboxRef) -> Arc<Sandbox> {
        self.get_with(reference, || Sandbox::open(reference.clone()))
    }

    /// [`SandboxState::get`], reading a missing snapshot with `read`.
    ///
    /// A snapshot read while an invalidation ran is returned but not cached, because the
    /// files it read may predate the change.
    fn get_with(&self, reference: &SandboxRef, read: impl FnOnce() -> Sandbox) -> Arc<Sandbox> {
        let generation = {
            let cache = self.cache.lock();
            if let Some(snapshot) = cache.snapshots.get(reference) {
                return Arc::clone(snapshot);
            }
            cache.generation
        };

        let fresh = Arc::new(read());
        let mut cache = self.cache.lock();
        if cache.generation != generation {
            return fresh;
        }
        Arc::clone(cache.snapshots.entry(reference.clone()).or_insert(fresh))
    }

    /// Drop every snapshot of `project`, whose layers or config changed.
    pub fn invalidate(&self, project: &str) {
        let mut cache = self.cache.lock();
        cache
            .snapshots
            .retain(|reference, _| reference.project() != Some(project));
        cache.generation += 1;
    }
}

#[cfg(test)]
mod tests;
