//! The bin viewer's document: open it, read the rows under one node, close it.
//!
//! The tree stays in [`BinDocuments`] (ADR-0026), one per asset, shared by the file
//! tab and the object tabs over it (ADR-0028). A call carries the id the open answered
//! and an address in the wire form of ADR-0027.

use std::sync::Arc;

use super::off_thread;
use crate::error::{AppError, IpcResult};
use crate::state::SettingsState;
use ltk_manager_core::bin_document::{
    BinDocumentHandle, BinDocumentId, BinDocuments, BinRows, ProjectNames,
};
use ltk_manager_core::game_wads::WadCache;
use ltk_manager_core::hashtables::{BinHashTablesState, WadPathResolverState};
use ltk_manager_core::meta_schema::{self, ClassSchema, MetaSchema};
use ltk_manager_core::object_index::{parse_hash, CacheNames};
use ltk_manager_core::preview::AssetRef;
use ltk_manager_core::problems::GameBuild;
use tauri::{AppHandle, Manager};

/// The window an object open reads its properties under: every one of them. A class
/// declares tens of fields, and a page is for a container.
const WHOLE: usize = usize::MAX;

/// Hold `asset` open as a bin, answering the header and the rows at depth zero.
///
/// With no `entry`, the rows are one per object. With one, `0x` and eight hex digits,
/// the rows are that object's properties and the answer carries its header facts.
#[tauri::command]
#[specta::specta]
pub async fn bin_open(
    asset: AssetRef,
    entry: Option<String>,
    app_handle: AppHandle,
) -> IpcResult<BinDocumentHandle> {
    off_thread(move || {
        let entry = entry
            .map(|text| {
                parse_hash(&text).ok_or_else(|| {
                    AppError::ValidationFailed(format!("Not an object hash: {text}"))
                })
            })
            .transpose()?;

        let config = app_handle.state::<SettingsState>().config();
        let store = app_handle.state::<BinDocuments>();
        let document = store.open(asset.clone(), || {
            asset.read(&config, &app_handle.state::<WadCache>())
        })?;

        let bin = app_handle.state::<BinHashTablesState>().get();
        let wad = app_handle.state::<Arc<WadPathResolverState>>().get();
        let cache = CacheNames::new(&bin, &wad);
        let chunks = store.chunks_of(document);
        let names = ProjectNames::new(&cache, &chunks);
        let schema = entry.map(|_| installed_schema(&app_handle));
        store.read(document, |open| {
            let (rows, object) = match (entry, &schema) {
                (Some(entry), Some((schema, build))) => (
                    open.children(entry, "", 0, WHOLE, &names, Some(schema.at(*build)))?
                        .rows,
                    Some(open.object(entry, &names)?),
                ),
                _ => (open.roots(&names), None),
            };
            Ok(BinDocumentHandle {
                document,
                header: open.header(),
                rows,
                object,
            })
        })
    })
    .await
}

/// The rows under one node of an open document, `offset` in and at most `limit` of them.
///
/// `entry` is the object's hash as `0x` and eight hex digits. `path` is the wire form
/// of the property path, empty for the object itself. Every row carries what the meta
/// schema declares for its field at the install's build.
#[tauri::command]
#[specta::specta]
pub async fn bin_children(
    document: BinDocumentId,
    entry: String,
    path: String,
    offset: usize,
    limit: usize,
    app_handle: AppHandle,
) -> IpcResult<BinRows> {
    off_thread(move || {
        let entry = parse_hash(&entry)
            .ok_or_else(|| AppError::ValidationFailed(format!("Not an object hash: {entry}")))?;
        let bin = app_handle.state::<BinHashTablesState>().get();
        let wad = app_handle.state::<Arc<WadPathResolverState>>().get();
        let cache = CacheNames::new(&bin, &wad);
        let chunks = app_handle.state::<BinDocuments>().chunks_of(document);
        let names = ProjectNames::new(&cache, &chunks);
        let (schema, build) = installed_schema(&app_handle);
        app_handle.state::<BinDocuments>().read(document, |open| {
            Ok(open.children(entry, &path, offset, limit, &names, Some(schema.at(build)))?)
        })
    })
    .await
}

/// The rows under each of several nodes of an open document, in the order asked.
///
/// The projected read of "The projected read" in docs/ux/BIN_EDITOR.md, which a class
/// layout and a value row use in place of one [`bin_children`] call per node. Each path
/// answers one page, a path reaching nothing answers an empty one, and a call past the
/// row cap is refused so the caller batches.
#[tauri::command]
#[specta::specta]
pub async fn bin_read(
    document: BinDocumentId,
    entry: String,
    paths: Vec<String>,
    app_handle: AppHandle,
) -> IpcResult<Vec<BinRows>> {
    off_thread(move || {
        let entry = parse_hash(&entry)
            .ok_or_else(|| AppError::ValidationFailed(format!("Not an object hash: {entry}")))?;
        let bin = app_handle.state::<BinHashTablesState>().get();
        let wad = app_handle.state::<Arc<WadPathResolverState>>().get();
        let cache = CacheNames::new(&bin, &wad);
        let chunks = app_handle.state::<BinDocuments>().chunks_of(document);
        let names = ProjectNames::new(&cache, &chunks);
        let (schema, build) = installed_schema(&app_handle);
        app_handle.state::<BinDocuments>().read(document, |open| {
            Ok(open.children_each(entry, &paths, &names, Some(schema.at(build)))?)
        })
    })
    .await
}

/// One class's fields and their declared kinds at the install's build.
///
/// Read out of the meta schema. `None` for a class the schema does not describe.
/// `class_hash` is `0x` and eight hex digits.
#[tauri::command]
#[specta::specta]
pub async fn class_schema(
    class_hash: String,
    app_handle: AppHandle,
) -> IpcResult<Option<ClassSchema>> {
    off_thread(move || {
        let class = parse_hash(&class_hash)
            .ok_or_else(|| AppError::ValidationFailed(format!("Not a class hash: {class_hash}")))?;
        let (schema, build) = installed_schema(&app_handle);
        Ok(schema.class_schema(class, build))
    })
    .await
}

/// The shared meta schema and the installed game's content build, which keys every
/// answer read out of it.
fn installed_schema(app_handle: &AppHandle) -> (Arc<MetaSchema>, Option<GameBuild>) {
    let config = app_handle.state::<SettingsState>().config();
    let build = GameBuild::installed(&config);
    (meta_schema::shared(build), build)
}

/// Drop one id. Its asset leaves the store with its last id.
#[tauri::command]
#[specta::specta]
pub fn bin_close(document: BinDocumentId, app_handle: AppHandle) -> IpcResult<()> {
    app_handle.state::<BinDocuments>().close(document);
    IpcResult::ok(())
}
