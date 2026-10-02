//! The bin editor's document: open it, read the rows under one node, edit a leaf, save
//! it, close it.
//!
//! The tree stays in [`BinDocuments`] (ADR-0026), one per asset, shared by the file
//! tab and the object tabs over it (ADR-0028). A call carries the id the open answered
//! and an address in the wire form of ADR-0027.

use std::sync::Arc;

use crate::error::{AppError, AppResult, IpcResult};
use crate::services::shared::document_assets;
use crate::services::shared::document_assets::{parse_class, parse_entry, with_cache_names};
use crate::services::shared::installed::{installed_schema, InstalledGame};
use crate::services::shared::off_thread;
use crate::services::shared::read_asset;
use ltk_game_data::Target;
use ltk_hash::{BinHash, WadHash};
use ltk_manager_core::bin_document::{
    BinChange, BinDocument, BinDocumentHandle, BinDocumentId, BinDocuments, BinEdit, BinFindResult,
    BinRow, BinRows, ChangeBaseline, ChoiceQuery, Choices, DeclareContext, DeclaredModuleChoice,
    DeclaredState, Declaring, Dependency, EditOutcome, HistoryStep, LayerOverride, ReadOnly,
    Reshape, RowDeclaration, RowNames, VariantSource,
};
use ltk_manager_core::hashing::HexBinHash;
use ltk_manager_core::meta_schema::SchemaAt;
use ltk_manager_core::meta_schema::{ClassSchema, PatchSchema, SchemaNames};
use ltk_manager_core::preview::AssetRef;
use ltk_manager_core::sandbox::{layer_chunk_hash, Opening, SandboxRef};
use ltk_manager_core::workshop::{ModuleAction, ProjectDir};
use tauri::{AppHandle, Manager};

/// The window an object open reads its properties under: every one of them. A class
/// declares tens of fields, and a page is for a container.
const WHOLE: usize = usize::MAX;

/// Hold `asset` open as a bin in `sandbox`, answering the header and the rows at depth zero.
///
/// A game chunk a layer of the sandbox ships opens as that layer's file, and one no layer
/// ships opens as a declared document of the project (ADR-0042, ADR-0056). With no `entry`,
/// the rows are one per object. With one, `0x` and eight hex digits, the rows are that
/// object's properties and the answer carries its header facts.
#[tauri::command]
#[specta::specta]
pub async fn bin_open(
    sandbox: SandboxRef,
    asset: AssetRef,
    entry: Option<String>,
    app_handle: AppHandle,
) -> IpcResult<BinDocumentHandle> {
    off_thread(move || {
        let entry = entry.as_deref().map(parse_entry).transpose()?;
        let store = app_handle.state::<BinDocuments>();
        let (document, opened) = match document_assets::sandbox(&app_handle, &sandbox)
            .opening(asset)?
        {
            Opening::File(file) => {
                let document =
                    store.open(&sandbox, file.clone(), || read_asset(&app_handle, &file))?;
                (document, file)
            }
            Opening::Declared { asset, chunk_hash } => {
                let project = sandbox.project().ok_or_else(|| {
                    AppError::ValidationFailed("The game sandbox declares nothing".to_owned())
                })?;
                let document = store.open_declared(&sandbox, asset.clone(), chunk_hash, || {
                    Ok((
                        read_asset(&app_handle, &asset)?,
                        declare_context(&app_handle, project)?,
                    ))
                })?;
                (document, asset)
            }
        };

        handle_of(&app_handle, document, opened, entry)
    })
    .await
}

/// Hold the UI variant `asset` open in `sandbox` laid over its base scene bin `base`,
/// answering the header and one row per object.
///
/// In a project, a variant no layer ships opens as a declared variant: the base and the variant
/// with the project's declarations of each, and an edit landing in a `target` module of `path`,
/// the variant chunk's path (league-mod ADR-0035). Any other variant opens as its file.
#[tauri::command]
#[specta::specta]
pub async fn bin_open_variant(
    sandbox: SandboxRef,
    asset: AssetRef,
    base: AssetRef,
    path: String,
    app_handle: AppHandle,
) -> IpcResult<BinDocumentHandle> {
    off_thread(move || {
        let store = app_handle.state::<BinDocuments>();
        let sandboxed = document_assets::sandbox(&app_handle, &sandbox);

        let (document, opened) = match sandboxed.opening(asset)? {
            Opening::File(file) => {
                let document =
                    store.open(&sandbox, file.clone(), || read_asset(&app_handle, &file))?;
                (document, file)
            }
            Opening::Declared { asset, chunk_hash } => {
                let project = sandbox.project().ok_or_else(|| {
                    AppError::ValidationFailed("The game sandbox declares nothing".to_owned())
                })?;
                let target = Target::try_from(path.as_str())
                    .ok()
                    .filter(|target| target.chunk_hash() == chunk_hash)
                    .ok_or_else(|| {
                        AppError::ValidationFailed(format!("{path} is not the variant's chunk"))
                    })?;
                let (base, base_hash) = match sandboxed.opening(base)? {
                    Opening::Declared { asset, chunk_hash } => (asset, chunk_hash),
                    Opening::File(file) => {
                        let hash = chunk_hash_of(&file).ok_or_else(|| {
                            AppError::ValidationFailed("The base is no chunk".to_owned())
                        })?;
                        (file, hash)
                    }
                };

                let document =
                    store.open_declared_variant(&sandbox, asset.clone(), chunk_hash, || {
                        Ok(VariantSource {
                            game: read_asset(&app_handle, &asset)?,
                            target,
                            base: read_asset(&app_handle, &base)?,
                            base_hash,
                            context: declare_context(&app_handle, project)?,
                        })
                    })?;
                (document, asset)
            }
        };

        handle_of(&app_handle, document, opened, None)
    })
    .await
}

/// The path hash of the chunk `asset` stands for: a game chunk's own, or a layer file's
/// packed path.
fn chunk_hash_of(asset: &AssetRef) -> Option<u64> {
    match asset {
        AssetRef::GameChunk { path_hash, .. } => {
            path_hash.parse::<WadHash>().ok().map(|hash| hash.0)
        }
        AssetRef::Layer { .. } => layer_chunk_hash(asset),
        AssetRef::File { .. } => None,
        AssetRef::LcuChunk { .. } => unreachable!("the bin store holds no client chunk"),
    }
}

/// The handle of the open `document` over `opened`: its header, and the rows of `entry`, or one
/// row per object with no `entry`.
fn handle_of(
    app_handle: &AppHandle,
    document: BinDocumentId,
    opened: AssetRef,
    entry: Option<BinHash>,
) -> AppResult<BinDocumentHandle> {
    let store = app_handle.state::<BinDocuments>();
    let (schema, build) = installed_schema(app_handle);
    let read_only = store.read_only(document)?;
    with_document_names(app_handle, document, |names| {
        store.read(document, |open| {
            let at = Some(schema.at(build));
            let (rows, object) = match entry {
                Some(entry) => (
                    open.children(entry, "", 0, WHOLE, names, at)?.rows,
                    Some(open.object(entry, names, at)?),
                ),
                None => (open.roots(names, at), None),
            };
            Ok(BinDocumentHandle {
                document,
                sandbox: store.sandbox_of(document).unwrap_or(SandboxRef::Game),
                read_only,
                asset: opened.clone(),
                header: open.header(names),
                rows,
                object,
                declared: open.declared_state(),
            })
        })
    })
}

/// The rows of an open layer file that the declarations of its project override, or every
/// layer's declarations on a declared document. Empty for every other document. ADR-0056.
#[tauri::command]
#[specta::specta]
pub async fn bin_overrides(
    document: BinDocumentId,
    app_handle: AppHandle,
) -> IpcResult<Vec<LayerOverride>> {
    off_thread(move || {
        let store = app_handle.state::<BinDocuments>();
        let Some(asset) = store.asset_of(document) else {
            return Ok(Vec::new());
        };
        let (AssetRef::Layer { project, .. }, Some(chunk_hash)) =
            (&asset, layer_chunk_hash(&asset))
        else {
            return store.read(document, |open| Ok(open.declared_overrides()));
        };

        let project = ProjectDir::open(project)?;
        let (schema, _) = installed_schema(&app_handle);

        with_document_names(&app_handle, document, |names| {
            let names = SchemaNames::new(names, &schema);
            store.read(document, |open| {
                Ok(open.overrides(chunk_hash, &project, &names))
            })
        })
    })
    .await
}

/// Run `read` over the open `document`, with the names of its sandbox and the meta schema at
/// the install's build.
fn read_named<T>(
    app_handle: &AppHandle,
    document: BinDocumentId,
    read: impl FnOnce(&BinDocument, &dyn RowNames, SchemaAt<'_>) -> AppResult<T>,
) -> AppResult<T> {
    let (schema, build) = installed_schema(app_handle);
    with_document_names(app_handle, document, |names| {
        app_handle
            .state::<BinDocuments>()
            .read(document, |open| read(open, names, schema.at(build)))
    })
}

/// What a declared document of `project` reads its declarations against.
fn declare_context(app_handle: &AppHandle, project: &str) -> AppResult<DeclareContext> {
    let (schema, build) = installed_schema(app_handle);

    Ok(DeclareContext {
        project: ProjectDir::open(project)?,
        schema: PatchSchema::new(schema, build),
        game: Arc::new(InstalledGame(app_handle.clone())),
    })
}

/// Run `read` with the names of the sandbox `document` is held in.
fn with_document_names<T>(
    app_handle: &AppHandle,
    document: BinDocumentId,
    read: impl FnOnce(&dyn RowNames) -> T,
) -> T {
    let reference = app_handle
        .state::<BinDocuments>()
        .sandbox_of(document)
        .unwrap_or(SandboxRef::Game);

    document_assets::with_names_in(app_handle, &reference, read)
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
        let entry = parse_entry(&entry)?;
        read_named(&app_handle, document, |open, names, at| {
            Ok(open.children(entry, &path, offset, limit, names, Some(at))?)
        })
    })
    .await
}

/// Every row of an open document whose name or value holds `query`, in tree order.
///
/// `entry`, `0x` and eight hex digits, narrows the search to one object, which is what
/// an object tab draws. The project bar's `@` scope asks this of the active tab.
#[tauri::command]
#[specta::specta]
pub async fn bin_find(
    document: BinDocumentId,
    entry: Option<String>,
    query: String,
    app_handle: AppHandle,
) -> IpcResult<BinFindResult> {
    off_thread(move || {
        let entry = entry.as_deref().map(parse_entry).transpose()?;
        read_named(&app_handle, document, |open, names, at| {
            Ok(open.find(entry, &query, names, Some(at)))
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
        let entry = parse_entry(&entry)?;
        read_named(&app_handle, document, |open, names, at| {
            Ok(open.children_each(entry, &paths, names, Some(at))?)
        })
    })
    .await
}

/// Apply one edit to an open document, answering what the edit reports beside the change.
///
/// Every id over the asset reads the edit, and nothing reaches the disk before [`bin_save`].
/// ADR-0051.
#[tauri::command]
#[specta::specta]
pub async fn bin_edit(
    document: BinDocumentId,
    edit: BinEdit,
    app_handle: AppHandle,
) -> IpcResult<EditOutcome> {
    off_thread(move || {
        let (schema, build) = installed_schema(&app_handle);
        app_handle
            .state::<BinDocuments>()
            .apply(document, edit, schema.at(build))
    })
    .await
}

/// What an add line of an open document offers, out of the meta schema at the install's
/// build. ADR-0051.
#[tauri::command]
#[specta::specta]
pub async fn bin_choices(
    document: BinDocumentId,
    query: ChoiceQuery,
    app_handle: AppHandle,
) -> IpcResult<Choices> {
    off_thread(move || {
        let (schema, build) = installed_schema(&app_handle);
        app_handle
            .state::<BinDocuments>()
            .choices(document, query, schema.at(build))
    })
    .await
}

/// The value at `path` under the object `entry` of an open document, as clipboard text.
#[tauri::command]
#[specta::specta]
pub async fn bin_copy_value(
    document: BinDocumentId,
    entry: String,
    path: String,
    app_handle: AppHandle,
) -> IpcResult<String> {
    off_thread(move || {
        let (schema, build) = installed_schema(&app_handle);
        app_handle
            .state::<BinDocuments>()
            .copy_value(document, &entry, &path, schema.at(build))
    })
    .await
}

/// The header's dependencies of an open document, as its rows draw them.
#[tauri::command]
#[specta::specta]
pub async fn bin_dependencies(
    document: BinDocumentId,
    app_handle: AppHandle,
) -> IpcResult<Vec<Dependency>> {
    off_thread(move || {
        app_handle
            .state::<BinDocuments>()
            .read(document, |open| Ok(open.dependency_rows()))
    })
    .await
}

/// The rows at depth zero of an open file, one per object, read again after an edit.
#[tauri::command]
#[specta::specta]
pub async fn bin_roots(document: BinDocumentId, app_handle: AppHandle) -> IpcResult<Vec<BinRow>> {
    off_thread(move || {
        read_named(&app_handle, document, |open, names, at| {
            Ok(open.roots(names, Some(at)))
        })
    })
    .await
}

/// Write an open document's edits to its layer file, as a delta over the bytes it opened.
///
/// A document no patch touched writes nothing. ADR-0040.
#[tauri::command]
#[specta::specta]
pub async fn bin_save(document: BinDocumentId, app_handle: AppHandle) -> IpcResult<()> {
    off_thread(move || app_handle.state::<BinDocuments>().save(document)).await
}

/// Move an open document's tree one `step` through its history, answering how its rows
/// moved, or null where that stack is empty.
///
/// The file tab and the object tabs over one asset share the tree and its stacks.
#[tauri::command]
#[specta::specta]
pub async fn bin_history(
    document: BinDocumentId,
    step: HistoryStep,
    app_handle: AppHandle,
) -> IpcResult<Option<Reshape>> {
    off_thread(move || Ok(app_handle.state::<BinDocuments>().step(document, step)?)).await
}

/// Every property and object of an open document that differs from `baseline`: the file as
/// it was opened, or the installed game's copy of each object.
#[tauri::command]
#[specta::specta]
pub async fn bin_changes(
    document: BinDocumentId,
    baseline: ChangeBaseline,
    app_handle: AppHandle,
) -> IpcResult<Vec<BinChange>> {
    off_thread(move || {
        let game = InstalledGame(app_handle.clone());
        app_handle
            .state::<BinDocuments>()
            .changes(document, baseline, &game)
    })
    .await
}

/// Put the property at `path` under `entry` back to what `baseline` holds, as one undoable
/// edit. `entry` is `0x` and eight hex digits.
#[tauri::command]
#[specta::specta]
pub async fn bin_revert(
    document: BinDocumentId,
    entry: String,
    path: String,
    baseline: ChangeBaseline,
    app_handle: AppHandle,
) -> IpcResult<()> {
    off_thread(move || {
        let entry = parse_entry(&entry)?;
        let game = InstalledGame(app_handle.clone());
        app_handle
            .state::<BinDocuments>()
            .revert(document, entry, &path, baseline, &game)
    })
    .await
}

/// Read an open document's file again, dropping the edits its tree held.
///
/// Every id over the asset reads the file as it is on disk.
#[tauri::command]
#[specta::specta]
pub async fn bin_reload(document: BinDocumentId, app_handle: AppHandle) -> IpcResult<()> {
    off_thread(move || {
        app_handle
            .state::<BinDocuments>()
            .reload(document, |asset| read_asset(&app_handle, asset))
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
        let class = parse_class(&class_hash)?;
        let (schema, build) = installed_schema(&app_handle);
        Ok(schema.class_schema(class, build))
    })
    .await
}

/// Every class deriving from `class_hash` at the install's build, through any number of
/// bases. `class_hash` is `0x` and eight hex digits.
#[tauri::command]
#[specta::specta]
pub async fn derived_classes(
    class_hash: String,
    app_handle: AppHandle,
) -> IpcResult<Vec<HexBinHash>> {
    off_thread(move || {
        let class = parse_class(&class_hash)?;
        let (schema, build) = installed_schema(&app_handle);
        Ok(schema
            .derived_classes(class, build)
            .into_iter()
            .map(HexBinHash::from)
            .collect())
    })
    .await
}

/// What the document says beside its rows: the layer it declares into, the project's
/// layers, and the rows a declaration of that layer touches. `None` for a document that
/// declares nothing. ADR-0042.
#[tauri::command]
#[specta::specta]
pub async fn bin_declared(
    document: BinDocumentId,
    app_handle: AppHandle,
) -> IpcResult<Option<DeclaredState>> {
    off_thread(move || {
        Ok(app_handle
            .state::<BinDocuments>()
            .declared_state(document)?)
    })
    .await
}

/// Write the edits that follow on a declared document to `module` of `layer`. ADR-0042,
/// ADR-0048.
#[tauri::command]
#[specta::specta]
pub async fn bin_declare_into(
    document: BinDocumentId,
    layer: String,
    module: DeclaredModuleChoice,
    app_handle: AppHandle,
) -> IpcResult<DeclaredState> {
    off_thread(move || {
        Ok(app_handle
            .state::<BinDocuments>()
            .declare_into(document, &layer, module)?)
    })
    .await
}

/// Apply a module action to the manifest of `layer` of the project at `project_path`, with no
/// document to undo it. ADR-0048.
#[tauri::command]
#[specta::specta]
pub async fn declarations_module_action(
    project_path: String,
    layer: String,
    action: ModuleAction,
) -> IpcResult<()> {
    off_thread(move || {
        ProjectDir::open(&project_path)?.apply_module_action(&layer, &action)?;
        Ok(())
    })
    .await
}

/// Take edits on a declared document as declarations, or refuse them, answering the gate
/// it then stands behind. The project's "Use game data declarations". ADR-0042.
#[tauri::command]
#[specta::specta]
pub async fn bin_set_declaring(
    document: BinDocumentId,
    declaring: Declaring,
    app_handle: AppHandle,
) -> IpcResult<Option<ReadOnly>> {
    off_thread(move || {
        Ok(app_handle
            .state::<BinDocuments>()
            .set_declaring(document, declaring)?)
    })
    .await
}

/// The row at `path` under `entry` as the declaration and the game-copy reference an author
/// would write for it, from any open bin. ADR-0042.
#[tauri::command]
#[specta::specta]
pub async fn bin_row_declaration(
    document: BinDocumentId,
    entry: String,
    path: String,
    app_handle: AppHandle,
) -> IpcResult<RowDeclaration> {
    off_thread(move || {
        let entry = parse_entry(&entry)?;
        with_cache_names(&app_handle, |names| {
            app_handle.state::<BinDocuments>().read(document, |open| {
                Ok(open.row_declaration(entry, &path, names)?)
            })
        })
    })
    .await
}

/// Drop one id. Its asset leaves the store with its last id.
#[tauri::command]
#[specta::specta]
pub fn bin_close(document: BinDocumentId, app_handle: AppHandle) -> IpcResult<()> {
    app_handle.state::<BinDocuments>().close(document);
    IpcResult::ok(())
}
