//! What a read of one open document resolves against: the names its hashes carry, and
//! where the files it names live. Both come from the sandbox it is open in (ADR-0056).

use std::sync::Arc;

use crate::error::{AppError, AppResult};
use crate::services::game::index::built_game_index;
use crate::services::preview::material::shader_defs;
use crate::services::shared::installed::{installed_schema, ProjectGame};
use crate::services::shared::GameBins;
use crate::state::SettingsState;
use ltk_hash::BinHash;
use ltk_manager_assets::game_index::GameIndex;
use ltk_manager_assets::hashtables::CacheNames;
use ltk_manager_assets::hashtables::{BinHashTablesState, WadPathResolverState};
use ltk_manager_assets::preview::AssetRef;
use ltk_manager_bin::bin_document::{
    AssetLookup, BinDocument, BinDocumentId, BinDocuments, RowNames,
};
use ltk_manager_bin::meta_schema::SchemaNames;
use ltk_manager_bin::object_index::parse_hash;
use ltk_manager_bin::sandbox::{Sandbox, SandboxRef, SandboxState};
use ltk_manager_game::lookup::ObjectLookup;
use tauri::{AppHandle, Manager};

/// An object hash a command was handed, `0x` and eight hex digits.
pub(crate) fn parse_entry(entry: &str) -> AppResult<BinHash> {
    parse_hash(entry)
        .ok_or_else(|| AppError::ValidationFailed(format!("Not an object hash: {entry}")))
}

/// A class hash a command was handed, `0x` and eight hex digits.
pub(crate) fn parse_class(class: &str) -> AppResult<BinHash> {
    parse_hash(class)
        .ok_or_else(|| AppError::ValidationFailed(format!("Not a class hash: {class}")))
}

/// The cached snapshot of the sandbox `reference`.
pub(crate) fn sandbox(app: &AppHandle, reference: &SandboxRef) -> Arc<Sandbox> {
    app.state::<SandboxState>().get(reference)
}

/// The sandbox `document` is held in, and the game sandbox for none or a closed one.
pub(crate) fn sandbox_of(app: &AppHandle, document: Option<BinDocumentId>) -> SandboxRef {
    document
        .and_then(|document| app.state::<BinDocuments>().sandbox_of(document))
        .unwrap_or(SandboxRef::Game)
}

/// Run `read` over the open document `document`, with the names and the asset lookup it
/// resolves against, and with the document store unlocked.
///
/// A name field resolves against the document's own sandbox first and the install's
/// game index second, and a read is the first to build that index where nothing has. An
/// install the index cannot be built over leaves every asset unplaced rather than failing
/// the read.
///
/// A layer file reads with the project's declarations applied, as the build writes it, so a
/// viewport draws the layers stacked.
pub(crate) fn read_resolved<T>(
    app: &AppHandle,
    document: BinDocumentId,
    read: impl FnOnce(&BinDocument, &dyn RowNames, &dyn AssetLookup) -> AppResult<T>,
) -> AppResult<T> {
    with_resolution(app, Some(document), |names, assets| {
        let documents = app.state::<BinDocuments>();
        let open = documents.document(document)?;

        let declared = documents
            .asset_of(document)
            .filter(|asset| matches!(asset, AssetRef::Layer { .. }))
            .and_then(|asset| {
                ProjectGame::new(app, &sandbox_of(app, Some(document))).declared_view(&asset, &open)
            });

        read(declared.as_ref().unwrap_or(&open), names, assets)
    })
}

/// Reads the bin `asset` of `reference` as its project builds it, for a read with no open tree.
pub(crate) fn read_declared_bin(
    app: &AppHandle,
    reference: &SandboxRef,
    asset: &AssetRef,
) -> AppResult<BinDocument> {
    let bytes = ProjectGame::new(app, reference).read(asset)?;

    Ok(BinDocument::parse(bytes)?)
}

/// Run `read` over the bins of the lookup over the open `document`, as [`read_resolved`] runs it.
///
/// Every read that resolves an object the document names goes through this, so a bin that
/// the document links is read once per call and no caller names it (ADR-0068). A class or
/// field that the hash tables leave unnamed takes the meta schema's name, and the shader defs
/// are read beside the document, the project's copy first.
pub(crate) fn read_lookup<T>(
    app: &AppHandle,
    document: BinDocumentId,
    read: impl FnOnce(&mut ObjectLookup<'_>) -> AppResult<T>,
) -> AppResult<T> {
    let (schema, _) = installed_schema(app);
    let sandbox = sandbox_of(app, Some(document));
    read_resolved(app, document, |open, names, assets| {
        let names = SchemaNames::new(names, &schema);
        let shaders = shader_defs(app, assets);
        let bins = GameBins::new(app, &sandbox);
        let mut lookup = ObjectLookup::new(open, &names, assets, shaders.as_deref(), bins.reader())
            .declared_by(bins.declaring(assets));
        read(&mut lookup)
    })
}

/// Run `resolve` with the names and the asset lookup a read of `document` resolves
/// against, and without the document store held.
///
/// For a read that also reads files the document names, which must not hold the store
/// while the archive is read. Without a document, or with a closed one, names resolve in the
/// game sandbox, which is what a viewport outside a project uses.
pub(crate) fn with_resolution<T>(
    app: &AppHandle,
    document: Option<BinDocumentId>,
    resolve: impl FnOnce(&dyn RowNames, &dyn AssetLookup) -> AppResult<T>,
) -> AppResult<T> {
    let reference = sandbox_of(app, document);
    let index = game_index(app);

    with_names_in(app, &reference, |names| {
        resolve(names, &sandbox(app, &reference).assets(index.as_deref()))
    })
}

/// Run `read` with the names of the sandbox `reference`, which builds no game index.
pub(crate) fn with_names_in<T>(
    app: &AppHandle,
    reference: &SandboxRef,
    read: impl FnOnce(&dyn RowNames) -> T,
) -> T {
    with_cache_names(app, |cache| read(&sandbox(app, reference).names(cache)))
}

/// Run `read` with the names the shared hash tables carry, outside any sandbox.
pub(crate) fn with_cache_names<T>(app: &AppHandle, read: impl FnOnce(&CacheNames<'_>) -> T) -> T {
    let bin = app.state::<BinHashTablesState>().get();
    let wad = app.state::<Arc<WadPathResolverState>>().get();

    read(&CacheNames::new(&bin, &wad))
}

/// Run `locate` with the asset lookup of the sandbox `reference`.
///
/// For a file a tab opens with no document open beside it, such as a map's geometry.
///
/// # Errors
///
/// Fails when the install's game index cannot be built, so a caller does not keep an empty
/// answer for a file the install holds.
pub(crate) fn with_assets_in<T>(
    app: &AppHandle,
    reference: &SandboxRef,
    locate: impl FnOnce(&dyn AssetLookup) -> T,
) -> AppResult<T> {
    let config = app.state::<SettingsState>().config();
    let (index, _) = built_game_index(app, &config)?;

    Ok(locate(&sandbox(app, reference).assets(Some(&index))))
}

fn game_index(app: &AppHandle) -> Option<Arc<GameIndex>> {
    let config = app.state::<SettingsState>().config();
    built_game_index(app, &config)
        .map(|(index, _)| index)
        .inspect_err(|e| tracing::debug!("No game index for a document's assets: {e}"))
        .ok()
}
