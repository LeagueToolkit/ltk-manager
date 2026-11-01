//! Where a write a document asks for lands in its project.

use ltk_manager_assets::preview::AssetRef;
use ltk_manager_bin::bin_document::{BinDocumentError, BinDocumentId, BinDocuments};
use ltk_manager_bin::sandbox::SandboxRef;

use crate::error::{AppError, AppResult};

/// Where an edit of the document `document` writes: the project it opens in, the layer it writes
/// to, and its own asset.
pub(crate) struct WriteTarget {
    pub(crate) project: String,
    pub(crate) layer: String,
    pub(crate) asset: AssetRef,
}

impl WriteTarget {
    /// The target of `document`.
    ///
    /// # Errors
    ///
    /// Fails when the document is closed, opens in no project or writes to no layer.
    pub(crate) fn of(documents: &BinDocuments, document: BinDocumentId) -> AppResult<Self> {
        let project = project_of(documents, document)?;
        let asset = documents
            .asset_of(document)
            .ok_or(BinDocumentError::NotOpen(document))?;
        let layer = layer_of(documents, document, &asset)?;

        Ok(Self {
            project,
            layer,
            asset,
        })
    }

    /// The archive folder the document's own asset sits under.
    ///
    /// # Errors
    ///
    /// Fails for a document in no archive.
    pub(crate) fn archive(&self) -> AppResult<String> {
        archive_of(&self.asset)
            .ok_or_else(|| AppError::ValidationFailed("The document is in no archive".to_owned()))
    }
}

/// The layer an edit of the document `document` writes to: the one it declares into, else the
/// layer its own file sits in.
fn layer_of(
    documents: &BinDocuments,
    document: BinDocumentId,
    asset: &AssetRef,
) -> AppResult<String> {
    match (documents.declared_state(document)?, asset) {
        (Some(declared), _) => Ok(declared.layer),
        (None, AssetRef::Layer { layer, .. }) => Ok(layer.clone()),
        (None, _) => Err(AppError::ValidationFailed(
            "The document writes to no layer".to_owned(),
        )),
    }
}

/// The project the document `document` opens in.
///
/// # Errors
///
/// Fails when the document is closed or opens in no project.
pub(crate) fn project_of(documents: &BinDocuments, document: BinDocumentId) -> AppResult<String> {
    match documents.sandbox_of(document) {
        Some(SandboxRef::Project { project } | SandboxRef::Layers { project, .. }) => Ok(project),
        Some(SandboxRef::Game) => Err(AppError::ValidationFailed(
            "The document opens in no project".to_owned(),
        )),
        None => Err(BinDocumentError::NotOpen(document).into()),
    }
}

/// The archive folder a layer keeps an asset's archive under: a game chunk's archive file name,
/// or the first folder of a layer file's path.
pub(crate) fn archive_of(asset: &AssetRef) -> Option<String> {
    match asset {
        AssetRef::GameChunk { wad, .. } => {
            wad.replace('\\', "/").rsplit('/').next().map(str::to_owned)
        }
        AssetRef::Layer { path, .. } => path
            .replace('\\', "/")
            .split('/')
            .next()
            .filter(|archive| archive.contains(".wad"))
            .map(str::to_owned),
        AssetRef::File { .. } => None,
        AssetRef::LcuChunk { .. } => unreachable!("the bin store holds no client chunk"),
    }
}
