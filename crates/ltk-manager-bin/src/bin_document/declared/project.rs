//! A project's game data declarations, applied to any chunk of the game's copy as the build
//! applies them. ADR-0042.

use std::io::Cursor;
use std::sync::Arc;

use ltk_game_data::{Edit, ObjectEdit, Selector, Target, apply};
use ltk_hash::BinHash;
use ltk_mod_project::ModProjectLayer;
use ltk_mod_project::game_data::{LayerDeclarations, load_layer};

use super::diagnostics::Raised;
use super::{GameCopy, edits_on, read_entry};
use crate::meta_schema::PatchSchema;
use crate::sandbox::layer_chunk_hash;
use ltk_manager_assets::preview::AssetRef;
use ltk_manager_base::error::{AppError, AppResult, Utf8PathRefExt as _};
use ltk_manager_workshop::ProjectDir;

/// Every layer's declarations of a project, each read once, in build order.
pub struct ProjectDeclarations {
    layers: Vec<(String, LayerDeclarations)>,
    schema: PatchSchema,
    game: Arc<dyn GameCopy>,
}

impl ProjectDeclarations {
    /// The declarations of every layer of `project`, with `game` reading the objects a
    /// reference names.
    ///
    /// # Errors
    ///
    /// Fails where the project's config or ignore rules cannot be read.
    pub fn load(
        project: &ProjectDir,
        schema: PatchSchema,
        game: Arc<dyn GameCopy>,
    ) -> AppResult<Self> {
        Self::load_chosen(project, None, schema, game)
    }

    /// The declarations of the `chosen` layers of `project`, or of every layer with `None`.
    ///
    /// # Errors
    ///
    /// Fails where the project's config or ignore rules cannot be read.
    pub fn load_chosen(
        project: &ProjectDir,
        chosen: Option<&[String]>,
        schema: PatchSchema,
        game: Arc<dyn GameCopy>,
    ) -> AppResult<Self> {
        let root = project.path().try_as_utf8("project directory")?;
        let ignore = project.ignore_filter()?;

        let mut layers = project.config()?.layers;
        layers.retain(|layer| chosen.is_none_or(|chosen| chosen.contains(&layer.name)));
        layers.sort_by(ModProjectLayer::apply_order);
        let layers = layers
            .into_iter()
            .map(|layer| {
                let loaded = load_layer(root, &layer.name, &ignore);
                (layer.name, loaded)
            })
            .collect();

        Ok(Self {
            layers,
            schema,
            game,
        })
    }

    /// The names of the layers, in build order.
    pub(super) fn layers(&self) -> impl Iterator<Item = &str> {
        self.layers.iter().map(|(name, _)| name.as_str())
    }

    /// Returns the target of each module that creates the object `entry`, in build order.
    ///
    /// An object that a project creates is in no chunk of the game, so the object index does
    /// not find it, and a read looks for it in these targets.
    #[must_use]
    pub fn creating_targets(&self, entry: BinHash) -> Vec<&Target> {
        self.layers
            .iter()
            .filter_map(|(_, loaded)| match &loaded.declarations {
                Ok(Some(declarations)) => Some(declarations),
                _ => None,
            })
            .flat_map(|declarations| &declarations.modules)
            .filter_map(|module| match &module.selector {
                Selector::Target { target, edits }
                    if edits.iter().any(|edit| creates(edit, entry)) =>
                {
                    Some(target)
                }
                _ => None,
            })
            .collect()
    }

    /// The chunk `chunk_hash`, whose copy is `game`, with every layer's declarations applied.
    /// None where no declaration reaches it.
    ///
    /// # Errors
    ///
    /// Fails where a declaration does not apply.
    pub fn apply(&self, game: &[u8], chunk_hash: u64) -> AppResult<Option<Vec<u8>>> {
        let selects_entries = self.layers.iter().any(|(_, loaded)| {
            matches!(&loaded.declarations, Ok(Some(declarations))
                if declarations.modules.iter().any(|module| matches!(module.selector, Selector::Entries(_))))
        });
        let entries = if selects_entries {
            chunk_entries(game)
        } else {
            Vec::new()
        };

        let reaches = self.layers.iter().any(|(_, loaded)| {
            matches!(&loaded.declarations, Ok(Some(declarations))
                if declarations.modules.iter().any(|module| !edits_on(module, chunk_hash, &entries).is_empty()))
        });
        if !reaches {
            return Ok(None);
        }

        self.apply_chunk(game, chunk_hash, &entries, &mut Vec::new())
            .map(Some)
    }

    /// Returns `true` if no layer of the project holds a declaration.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.layers
            .iter()
            .all(|(_, loaded)| !matches!(&loaded.declarations, Ok(Some(_))))
    }

    /// Returns `bytes`, the file at `asset`, with every layer's declarations applied if `asset`
    /// is a game bin chunk or a layer bin that a declaration reaches, as the build applies them.
    ///
    /// Returns `bytes` unchanged for any other asset. If a declaration does not apply, logs a
    /// warning and returns `bytes`, as the declared document raises it where it is edited.
    #[must_use]
    pub fn declared_asset(&self, asset: &AssetRef, bytes: Vec<u8>) -> Vec<u8> {
        if !(bytes.starts_with(b"PROP") || bytes.starts_with(b"PTCH")) {
            return bytes;
        }
        let chunk_hash = match asset {
            AssetRef::GameChunk { .. } => asset.chunk_hash().map(|hash| hash.0),
            AssetRef::Layer { .. } => layer_chunk_hash(asset),
            AssetRef::File { .. } | AssetRef::LcuChunk { .. } => None,
        };
        let Some(chunk_hash) = chunk_hash else {
            return bytes;
        };

        match self.apply(&bytes, chunk_hash) {
            Ok(Some(applied)) => applied,
            Ok(None) => bytes,
            Err(error) => {
                tracing::warn!(?asset, %error, "A preview draws a bin undeclared");
                bytes
            }
        }
    }

    /// `game`, the chunk `chunk_hash` whose objects are `entries`, with every layer's
    /// declarations applied in build order. What each apply raises joins `raised`.
    pub(super) fn apply_chunk(
        &self,
        game: &[u8],
        chunk_hash: u64,
        entries: &[BinHash],
        raised: &mut Vec<Raised>,
    ) -> AppResult<Vec<u8>> {
        let mut bytes = game.to_vec();
        for (layer, loaded) in &self.layers {
            let Ok(Some(declarations)) = &loaded.declarations else {
                continue;
            };
            let edits: Vec<Edit> = declarations
                .modules
                .iter()
                .flat_map(|module| edits_on(module, chunk_hash, entries))
                .collect();
            if edits.is_empty() {
                continue;
            }

            let applied = apply(
                &bytes,
                &edits,
                |path| {
                    let file = loaded
                        .override_files()
                        .iter()
                        .find(|file| file.path == *path)
                        .ok_or_else(|| {
                            ltk_game_data::Error::in_document(
                                ltk_game_data::ErrorKind::InputMissing,
                                path.as_str(),
                            )
                        })?;
                    fs_err::read(&file.source)
                        .map_err(|error| ltk_game_data::Error::io(path.as_str(), &error))
                },
                |entry| read_entry(self.game.as_ref(), entry),
                &self.schema,
            )
            .map_err(|error| AppError::Other(format!("The declarations do not apply: {error}")))?;
            raised.extend(Raised::of(layer, &edits, applied.diagnostics));
            bytes = applied.bytes;
        }
        Ok(bytes)
    }
}

/// `true` if `edit` creates the object `entry`.
fn creates(edit: &Edit, entry: BinHash) -> bool {
    edit.objects
        .iter()
        .any(|(name, object)| name.object_hash() == entry && !matches!(object, ObjectEdit::Remove))
}

/// The objects a chunk declares, none where it does not mount as a bin.
fn chunk_entries(bytes: &[u8]) -> Vec<BinHash> {
    let Ok(mut stream) = ltk_meta::BinStream::mount(Cursor::new(bytes)) else {
        return Vec::new();
    };
    stream.toc().map_or_else(
        |_| Vec::new(),
        |toc| toc.entries().iter().map(|entry| entry.path_hash).collect(),
    )
}

#[cfg(test)]
mod tests;
