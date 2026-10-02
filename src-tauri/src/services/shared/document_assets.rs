//! What a read of one open document resolves against: the names its hashes carry, and
//! where the files it names live. Both come from the sandbox it is open in (ADR-0056).

use std::sync::Arc;

use crate::error::{AppError, AppResult};
use crate::services::game::index::built_game_index;
use crate::state::SettingsState;
use ltk_hash::BinHash;
use ltk_manager_core::bin_document::{
    AssetLookup, BinDocument, BinDocumentId, BinDocuments, RowNames,
};
use ltk_manager_core::game_index::GameIndex;
use ltk_manager_core::hashtables::{BinHashTablesState, WadPathResolverState};
use ltk_manager_core::object_index::{parse_hash, CacheNames};
use ltk_manager_core::sandbox::{Sandbox, SandboxRef, SandboxState};
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

/// Run `read` over the open document `document`, with the names and the asset lookup it
/// resolves against, and with the document store unlocked.
///
/// A name field resolves against the document's own sandbox first and the install's
/// game index second, and a read is the first to build that index where nothing has. An
/// install the index cannot be built over leaves every asset unplaced rather than failing
/// the read.
pub(crate) fn read_resolved<T>(
    app: &AppHandle,
    document: BinDocumentId,
    read: impl FnOnce(&BinDocument, &dyn RowNames, &dyn AssetLookup) -> AppResult<T>,
) -> AppResult<T> {
    with_resolution(app, Some(document), |names, assets| {
        let open = app.state::<BinDocuments>().document(document)?;
        read(&open, names, assets)
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
    let reference = document
        .and_then(|document| app.state::<BinDocuments>().sandbox_of(document))
        .unwrap_or(SandboxRef::Game);
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
