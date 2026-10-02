//! The bin object index: warm it, drop it, and search it.

use crate::error::{AppError, AppErrorResponse, AppResult, IpcResult};
use crate::events::TauriEventSink;
use crate::services::game::index::{built_game_index, find_query};
use crate::services::shared::document_assets;
use crate::services::shared::off_thread;
use crate::services::shared::overtaken;
use crate::state::SettingsState;
use ltk_hash::BinHash;
use ltk_manager_core::bin_document::{BinDocumentId, BinDocuments, BinObjectHeader};
use ltk_manager_core::config::Config;
use ltk_manager_core::events::{BackendEvent, EventSink as _};
use ltk_manager_core::game_wads::GameArchives;
use ltk_manager_core::generation::line;
use ltk_manager_core::hashing::HexBinHash;
use ltk_manager_core::hashtables::{
    BinHashTablesState, HashtableCache, WadPathResolver, WadPathResolverState,
};
use ltk_manager_core::object_index::{
    self, layer_bins, parse_hash, BuildTicket, CacheNames, DeclaredObject, FileTarget,
    ObjectDirListing, ObjectFindResult, ObjectIndex, ObjectIndexSnapshot, ObjectSearchResult,
    ReferenceResult, WalkRequest, WalkTarget,
};
use ltk_manager_core::preview::AssetRef;
use ltk_manager_core::problems::budget::files_at_once;
use ltk_manager_core::problems::Budget;
use ltk_manager_core::sandbox::SandboxRef;
use ltk_manager_game::spell::{self, SpellCatalog};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

/// The managed object index, keeping a failed build as the error the frontend reads.
pub type ObjectIndexState = object_index::ObjectIndexState<AppErrorResponse>;

/// What a search answers, given the slot the index is in.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ObjectSearch {
    /// Nothing has warmed the index, or the switch that gates it is off.
    Absent,
    /// A build is running, so the rows are on their way.
    Building,
    /// The last build failed, and the next warm retries it.
    Failed { error: AppErrorResponse },
    /// The index answered.
    Ready(ObjectSearchResult),
}

/// Build the object index, unless one is built or building.
///
/// The game index is built first when it is not, because the object build is
/// fed by it. The call returns once the build lands, and a build that fails
/// leaves the failure in the state for a search to report.
#[tauri::command]
#[specta::specta]
pub async fn warm_object_index(app_handle: AppHandle) -> IpcResult<()> {
    let config = app_handle.state::<SettingsState>().config();

    off_thread(move || {
        let state = app_handle.state::<ObjectIndexState>();
        let Some(ticket) = state.begin() else {
            return Ok(());
        };
        let built = build(&app_handle, &config, &state, ticket);
        state.finish(ticket, built.map_err(AppErrorResponse::from));
        Ok(())
    })
    .await
}

/// The index over the install `config` names, named through the shared tables.
///
/// A cache the machine never synced names nothing, and the index is built
/// unnamed rather than not at all: a search then says so.
fn build(
    app: &AppHandle,
    config: &Config,
    state: &ObjectIndexState,
    ticket: BuildTicket,
) -> AppResult<ObjectIndex> {
    let (game, archives) = built_game_index(app, config)?;
    let index = ObjectIndex::build(&game, &archives, files_at_once(), &|| {
        !state.is_current(ticket)
    })?;

    let cache = match HashtableCache::shared() {
        Ok(cache) => cache,
        Err(e) => {
            tracing::debug!("No hashtable cache to name the object index from: {e}");
            return Ok(index);
        }
    };
    let wad = app.state::<Arc<WadPathResolverState>>().get();
    Ok(index.named(&CacheNames::new(&cache.bin_tables(), &wad)))
}

/// Drop the object index, and the result of any build still running.
#[tauri::command]
#[specta::specta]
pub async fn drop_object_index(app_handle: AppHandle) -> IpcResult<()> {
    app_handle.state::<ObjectIndexState>().clear();
    IpcResult::ok(())
}

/// Rank every bin object of the install against `query`, best first.
///
/// Answers for the slot the index is in, so a query that arrives while the
/// build runs reads as building rather than as nothing. The scan carries a
/// generation of its own, apart from the game scan's, so a keystroke gives up
/// only the object scan it overtakes.
#[tauri::command]
#[specta::specta]
pub async fn search_object_index(query: String, app_handle: AppHandle) -> IpcResult<ObjectSearch> {
    let overtaken = overtaken::<line::ObjectSearch>(&app_handle);

    off_thread(move || {
        let index = match app_handle.state::<ObjectIndexState>().snapshot() {
            ObjectIndexSnapshot::Absent => return Ok(ObjectSearch::Absent),
            ObjectIndexSnapshot::Building => return Ok(ObjectSearch::Building),
            ObjectIndexSnapshot::Failed(error) => return Ok(ObjectSearch::Failed { error }),
            ObjectIndexSnapshot::Ready(index) => index,
        };

        let result = index.search(&query, overtaken);
        tracing::debug!(
            query = %query,
            hits = result.hits.len(),
            total = result.total,
            superseded = result.superseded,
            "Searched the bin object index"
        );
        Ok(ObjectSearch::Ready(result))
    })
    .await
}

/// What one prefix of the object tree holds, given the slot the index is in.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ObjectDir {
    /// Nothing has warmed the index, or the switch that gates it is off.
    Absent,
    /// A build is running. The listing follows it.
    Building,
    /// The last build failed, and the next warm retries it.
    Failed { error: AppErrorResponse },
    /// The index answered.
    Ready(ObjectDirListing),
}

/// The character spell catalog and the index state supplying it.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum CharacterSpells {
    /// Nothing has warmed the index.
    Absent,
    /// The catalog is waiting for an index build.
    Building,
    /// The last index build failed.
    Failed { error: AppErrorResponse },
    /// Every named spell for the requested character.
    Ready(SpellCatalog),
}

/// The install's spells below `Characters/{character}/Spells`.
#[tauri::command]
#[specta::specta]
pub async fn character_spells(
    character: String,
    app_handle: AppHandle,
) -> IpcResult<CharacterSpells> {
    off_thread(move || {
        let index = match app_handle.state::<ObjectIndexState>().snapshot() {
            ObjectIndexSnapshot::Absent => return Ok(CharacterSpells::Absent),
            ObjectIndexSnapshot::Building => return Ok(CharacterSpells::Building),
            ObjectIndexSnapshot::Failed(error) => return Ok(CharacterSpells::Failed { error }),
            ObjectIndexSnapshot::Ready(index) => index,
        };
        Ok(CharacterSpells::Ready(spell::character_spells(
            &index, &character,
        )))
    })
    .await
}

/// What one prefix of the object tree holds.
///
/// `prefix` is `""` for the root, `?` for the objects no table names, and otherwise a
/// path a listing gave. A prefix no object path runs through reports `INVALID_PATH`.
/// "Objects browser" in `docs/ux/PROJECT_EDITOR.md`.
#[tauri::command]
#[specta::specta]
pub async fn object_dir(prefix: String, app_handle: AppHandle) -> IpcResult<ObjectDir> {
    off_thread(move || {
        let index = match app_handle.state::<ObjectIndexState>().snapshot() {
            ObjectIndexSnapshot::Absent => return Ok(ObjectDir::Absent),
            ObjectIndexSnapshot::Building => return Ok(ObjectDir::Building),
            ObjectIndexSnapshot::Failed(error) => return Ok(ObjectDir::Failed { error }),
            ObjectIndexSnapshot::Ready(index) => index,
        };
        let listing = index.object_dir(&prefix).ok_or_else(|| {
            AppError::InvalidPath(format!("No such prefix in the object index: {prefix}"))
        })?;
        Ok(ObjectDir::Ready(listing))
    })
    .await
}

/// How many objects of the install declare a class, given the slot the index is in.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ClassObjectCount {
    /// Nothing has warmed the index, or the switch that gates it is off.
    Absent,
    /// A build is running. The count follows it.
    Building,
    /// The last build failed, and the next warm retries it.
    Failed { error: AppErrorResponse },
    /// The index answered.
    Ready { count: u32 },
}

/// How many objects of the install declare the class `class_hash`, for the class card.
#[tauri::command]
#[specta::specta]
pub async fn class_object_count(
    class_hash: HexBinHash,
    app_handle: AppHandle,
) -> IpcResult<ClassObjectCount> {
    off_thread(move || {
        let index = match app_handle.state::<ObjectIndexState>().snapshot() {
            ObjectIndexSnapshot::Absent => return Ok(ClassObjectCount::Absent),
            ObjectIndexSnapshot::Building => return Ok(ClassObjectCount::Building),
            ObjectIndexSnapshot::Failed(error) => return Ok(ClassObjectCount::Failed { error }),
            ObjectIndexSnapshot::Ready(index) => index,
        };

        let count = u32::try_from(index.class_object_count(class_hash.get())).unwrap_or(u32::MAX);
        Ok(ClassObjectCount::Ready { count })
    })
    .await
}

/// What a full search of the objects found, given the slot the index is in.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ObjectFind {
    /// Nothing has warmed the index, or the switch that gates it is off.
    Absent,
    /// A build is running. The hits follow it.
    Building,
    /// The last build failed, and the next warm retries it.
    Failed { error: AppErrorResponse },
    /// The index answered.
    Ready(ObjectFindResult),
}

/// Every object of the install matching `pattern`, in path order.
///
/// The full-results twin of [`search_object_index`], the way [`find_in_game_index`]
/// is the game search's. `regex` reads the pattern as a regular expression, and
/// either way the match is case-insensitive. `class_term` is the `class:` term's value,
/// a name prefix or a hash, which narrows the objects to the classes it opens.
///
/// An empty pattern with no class matches nothing. A pattern that does not parse
/// reports `VALIDATION_FAILED` with the parser's own message.
///
/// [`find_in_game_index`]: crate::services::game::index::find_in_game_index
#[tauri::command]
#[specta::specta]
pub async fn find_objects(
    pattern: String,
    regex: bool,
    class_term: Option<String>,
    app_handle: AppHandle,
) -> IpcResult<ObjectFind> {
    let query = match find_query(&pattern, regex) {
        Ok(query) => query,
        Err(e) => return IpcResult::from(Err::<ObjectFind, _>(e)),
    };

    let overtaken = overtaken::<line::ObjectFind>(&app_handle);

    off_thread(move || {
        let index = match app_handle.state::<ObjectIndexState>().snapshot() {
            ObjectIndexSnapshot::Absent => return Ok(ObjectFind::Absent),
            ObjectIndexSnapshot::Building => return Ok(ObjectFind::Building),
            ObjectIndexSnapshot::Failed(error) => return Ok(ObjectFind::Failed { error }),
            ObjectIndexSnapshot::Ready(index) => index,
        };

        let result = index.find(query.as_ref(), class_term.as_deref(), overtaken);
        tracing::debug!(
            pattern = %pattern,
            regex,
            class = class_term.as_deref().unwrap_or(""),
            hits = result.hits.len(),
            total = result.total,
            superseded = result.superseded,
            "Ran a full search of the bin object index"
        );
        Ok(ObjectFind::Ready(result))
    })
    .await
}

/// What a reference query asks for.
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ReferenceQuery {
    /// Every object of one class, from the index.
    #[serde(rename_all = "camelCase")]
    Class {
        /// The class hash, `0x` and eight hex digits.
        class_hash: String,
    },
    /// Every `pointer` or `embed` value of one class, from the walk.
    #[serde(rename_all = "camelCase")]
    Embedded {
        /// The class hash, `0x` and eight hex digits.
        class_hash: String,
    },
    /// Every `link` or `hash` value naming one object, from the walk.
    #[serde(rename_all = "camelCase")]
    Object {
        /// The object's path hash, `0x` and eight hex digits.
        object_hash: String,
    },
    /// Every `hash`, `file` or `string` value naming one file, from the walk.
    #[serde(rename_all = "camelCase")]
    File {
        /// The chunk path, as the tables spell it.
        path: String,
    },
    /// Every `file` value naming one chunk no table names, from the walk.
    #[serde(rename_all = "camelCase")]
    Chunk {
        /// The chunk's path hash, sixteen hex digits.
        path_hash: String,
    },
}

/// A reference query resolved to its lookup: a class in the index, or a walk.
#[derive(Debug)]
enum ReferenceLookup {
    Class(BinHash),
    Walk(WalkTarget),
}

impl ReferenceQuery {
    /// The lookup the query resolves to.
    ///
    /// # Errors
    ///
    /// Fails when the hash the query names does not parse.
    fn resolve(&self) -> AppResult<ReferenceLookup> {
        let object_hash = |text: &str| {
            parse_hash(text).ok_or_else(|| {
                AppError::ValidationFailed(format!("Not an object index hash: {text}"))
            })
        };
        Ok(match self {
            Self::Class { class_hash } => ReferenceLookup::Class(object_hash(class_hash)?),
            Self::Embedded { class_hash } => {
                ReferenceLookup::Walk(WalkTarget::Embedded(object_hash(class_hash)?))
            }
            Self::Object { object_hash: text } => {
                ReferenceLookup::Walk(WalkTarget::Linked(object_hash(text)?))
            }
            Self::File { path } => ReferenceLookup::Walk(WalkTarget::File(FileTarget::named(path))),
            Self::Chunk { path_hash } => {
                let chunk = path_hash.parse().map_err(|_| {
                    AppError::ValidationFailed(format!("Not a chunk path hash: {path_hash}"))
                })?;
                ReferenceLookup::Walk(WalkTarget::File(FileTarget::unnamed(chunk)))
            }
        })
    }
}

/// What a reference query found, given the slot the index is in.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ObjectReferences {
    /// Nothing has warmed the index, or the switch that gates it is off.
    Absent,
    /// A build is running. The groups follow it.
    Building,
    /// The last build failed, and the next warm retries it.
    Failed { error: AppErrorResponse },
    /// The index or the walk answered.
    Ready(ReferenceResult),
}

/// The walk in flight, whose budget a cancel calls off.
///
/// One at a time, because the References document asks one question. A newer query
/// overtakes the walk through its generation, and a cancel reaches only this one.
#[derive(Debug, Default)]
pub struct ReferenceWalkState(Mutex<Option<Budget>>);

/// How often a walk reports how far it has read.
const WALK_PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

/// What `query` names, grouped by the file that holds it.
///
/// A class answers from the index with every object the install declares as it. An
/// embedded class, an object and a file answer from a walk of `project`'s layers and
/// the install, reporting `reference-walk-progress` as it reads. The scan carries a
/// generation of its own, so a re-run gives up only the reference scan it overtakes.
///
/// "The References document" in `docs/ux/PROJECT_EDITOR.md`.
#[tauri::command]
#[specta::specta]
pub async fn find_references(
    query: ReferenceQuery,
    project: Option<String>,
    app_handle: AppHandle,
) -> IpcResult<ObjectReferences> {
    let lookup = match query.resolve() {
        Ok(lookup) => lookup,
        Err(e) => return IpcResult::from(Err::<ObjectReferences, _>(e)),
    };

    let overtaken = overtaken::<line::References>(&app_handle);

    off_thread(move || {
        let index = match app_handle.state::<ObjectIndexState>().snapshot() {
            ObjectIndexSnapshot::Absent => return Ok(ObjectReferences::Absent),
            ObjectIndexSnapshot::Building => return Ok(ObjectReferences::Building),
            ObjectIndexSnapshot::Failed(error) => return Ok(ObjectReferences::Failed { error }),
            ObjectIndexSnapshot::Ready(index) => index,
        };

        let result = match lookup {
            ReferenceLookup::Class(class) => index.class_references(class, overtaken),
            ReferenceLookup::Walk(target) => {
                walk(&app_handle, &index, target, project.as_deref(), overtaken)?
            }
        };
        tracing::debug!(
            query = ?query,
            groups = result.groups.len(),
            total = result.total,
            superseded = result.superseded,
            cancelled = result.cancelled,
            "Answered a reference query"
        );
        Ok(ObjectReferences::Ready(result))
    })
    .await
}

/// Walk `project`'s layers and the install for `target`, as the one walk in flight.
///
/// A project whose layers cannot be listed is walked without them, and logged.
fn walk(
    app: &AppHandle,
    index: &ObjectIndex,
    target: WalkTarget,
    project: Option<&str>,
    overtaken: impl Fn() -> bool + Sync,
) -> AppResult<ReferenceResult> {
    let config = app.state::<SettingsState>().config();
    let archives = GameArchives::resolve(&config)?;
    let layers = match project.map(layer_bins).transpose() {
        Ok(layers) => layers.unwrap_or_default(),
        Err(e) => {
            tracing::warn!("Walking the install without the project's layers: {e}");
            Vec::new()
        }
    };

    let budget = Budget::sweep();
    let walks = app.state::<ReferenceWalkState>();
    *walks.0.lock() = Some(budget.clone());

    let bin = app.state::<BinHashTablesState>().get();
    let wad = app.state::<Arc<WadPathResolverState>>().get();
    let names = CacheNames::new(&bin, &wad);
    let (schema, build) = crate::services::shared::installed::installed_schema(app);

    let events = TauriEventSink::new(app.clone());
    let last_report = Mutex::new(None::<Instant>);
    let request = WalkRequest {
        target,
        layers: &layers,
        archives: &archives,
        budget: &budget,
        workers: files_at_once(),
    };
    let result = index.walk(
        &request,
        &names,
        Some(schema.at(build)),
        overtaken,
        |progress| {
            let now = Instant::now();
            let mut last = last_report.lock();
            let due = last.is_none_or(|at| now.duration_since(at) >= WALK_PROGRESS_INTERVAL);
            if !due && progress.walked < progress.total {
                return;
            }
            *last = Some(now);
            drop(last);
            events.emit(BackendEvent::ReferenceWalkProgress(progress));
        },
    );

    let mut in_flight = walks.0.lock();
    if in_flight.as_ref().is_some_and(|walk| walk.is(&budget)) {
        *in_flight = None;
    }
    Ok(result)
}

/// Call off the walk in flight, if there is one.
///
/// Answers `false` when nothing was walking, which is what a Cancel pressed as the
/// walk finished looks like. The walk answers with what it found.
#[tauri::command]
#[specta::specta]
pub fn cancel_reference_walk(app_handle: AppHandle) -> IpcResult<bool> {
    let walks = app_handle.state::<ReferenceWalkState>();
    let in_flight = walks.0.lock();
    let Some(budget) = in_flight.as_ref() else {
        return IpcResult::ok(false);
    };
    budget.cancel();
    IpcResult::ok(true)
}

/// The slot the index is in, as an answer reports it.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ObjectIndexStatus {
    /// Nothing has warmed the index, or the switch that gates it is off.
    Absent,
    /// A build is running. The answer follows it.
    Building,
    /// The last build failed, and the next warm retries it.
    Failed { error: AppErrorResponse },
    /// The index answered.
    Ready,
}

/// What declares each of a set of object hashes, beside the slot the index is in.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DeclaredObjects {
    /// Off `Ready`, only the open document's own objects are in `objects`.
    pub index: ObjectIndexStatus,
    /// By the object's hash, `0x` and eight hex digits. A hash nothing declares is absent.
    pub objects: HashMap<String, DeclaredObject>,
}

/// Every declaration of each of `object_hashes` in `sandbox`, by hash.
///
/// The install's declarations come from the index, in the slot it is in. The declarations
/// in the sandbox's layer files go before them (ADR-0056), and an install declaration in a
/// chunk a layer ships is removed, because the build packs the layer's copy instead. With
/// `document` open, the document's own declarations are added and every list is ordered as a
/// link resolves it (ADR-0028): this file, then a file the bin depends on, then the rest.
#[tauri::command]
#[specta::specta]
pub async fn declared_objects(
    sandbox: SandboxRef,
    object_hashes: Vec<String>,
    document: Option<BinDocumentId>,
    app_handle: AppHandle,
) -> IpcResult<DeclaredObjects> {
    off_thread(move || {
        let (index, status) = match app_handle.state::<ObjectIndexState>().snapshot() {
            ObjectIndexSnapshot::Absent => (None, ObjectIndexStatus::Absent),
            ObjectIndexSnapshot::Building => (None, ObjectIndexStatus::Building),
            ObjectIndexSnapshot::Failed(error) => (None, ObjectIndexStatus::Failed { error }),
            ObjectIndexSnapshot::Ready(index) => (Some(index), ObjectIndexStatus::Ready),
        };
        let mut objects: HashMap<String, DeclaredObject> = object_hashes
            .iter()
            .filter_map(|text| {
                let declared = index.as_ref()?.declared(parse_hash(text)?)?;
                Some((text.clone(), declared))
            })
            .collect();

        fold_layer_declarations(&app_handle, &sandbox, &object_hashes, &mut objects);
        if let Some(document) = document {
            fold_own_declarations(&app_handle, document, &object_hashes, &mut objects)?;
        }
        Ok(DeclaredObjects {
            index: status,
            objects,
        })
    })
    .await
}

/// Add the declarations of `object_hashes` in the layer files of `sandbox` to `objects`, per
/// [`Sandbox::join_declared`].
fn fold_layer_declarations(
    app: &AppHandle,
    sandbox: &SandboxRef,
    object_hashes: &[String],
    objects: &mut HashMap<String, DeclaredObject>,
) {
    if sandbox.is_game() {
        return;
    }
    document_assets::with_cache_names(app, |cache| {
        document_assets::sandbox(app, sandbox).join_declared(object_hashes, cache, objects);
    });
}

/// Join the open document's own declarations of `hashes` into `objects`, and order
/// every list as a link resolves it.
///
/// A document that closed or was evicted leaves `objects` as the index answered it.
fn fold_own_declarations(
    app: &AppHandle,
    document: BinDocumentId,
    object_hashes: &[String],
    objects: &mut HashMap<String, DeclaredObject>,
) -> AppResult<()> {
    let store = app.state::<BinDocuments>();
    let Some(asset) = store.asset_of(document) else {
        return Ok(());
    };
    let bin = app.state::<BinHashTablesState>().get();
    let wad = app.state::<Arc<WadPathResolverState>>().get();
    let names = CacheNames::new(&bin, &wad);
    let file = own_file_name(&asset, &wad);
    let (schema, build) = crate::services::shared::installed::installed_schema(app);

    let (dependencies, own) = store.read(document, |open| {
        let own: Vec<(&str, BinObjectHeader)> = object_hashes
            .iter()
            .filter_map(|text| {
                let header = open
                    .object(parse_hash(text)?, &names, Some(schema.at(build)))
                    .ok()?;
                Some((text.as_str(), header))
            })
            .collect();
        Ok((open.dependency_hashes(), own))
    })?;

    for (text, header) in own {
        let declaration = header.declared_in(&asset, &file);
        let declared = objects
            .entry(text.to_owned())
            .or_insert_with(|| DeclaredObject {
                path: header.name,
                declarations: Vec::new(),
            });
        if !declared
            .declarations
            .iter()
            .any(|known| known.asset == asset)
        {
            declared.declarations.push(declaration);
        }
    }
    for declared in objects.values_mut() {
        declared.resolve_for(&asset, &dependencies);
    }
    Ok(())
}

/// The path an open document's own declaration names its file by.
///
/// A layer file and a loose file carry theirs. A game chunk reads as the path the WAD
/// tables give it, or its hash where they give none.
fn own_file_name(asset: &AssetRef, wad: &WadPathResolver) -> String {
    match asset {
        AssetRef::Layer { path, .. } | AssetRef::File { path } => path.clone(),
        AssetRef::GameChunk { path_hash, .. } => {
            let mut name = path_hash.clone();
            if let Ok(hash) = path_hash.parse() {
                wad.resolve_each(&[hash], |_, path| {
                    if let Some(path) = path {
                        name = path.to_owned();
                    }
                });
            }
            name
        }
        AssetRef::LcuChunk { .. } => unreachable!("the bin store holds no client chunk"),
    }
}

/// Resolve the index's names again out of the tables a sync just installed.
///
/// The rows are the install's and stay. A slot that holds no ready index is
/// left alone.
pub fn rename_after_sync(app: &AppHandle) {
    let cache = match HashtableCache::shared() {
        Ok(cache) => cache,
        Err(e) => {
            tracing::debug!("No hashtable cache to rename the object index from: {e}");
            return;
        }
    };
    let wad = app.state::<Arc<WadPathResolverState>>().get();
    let bin = cache.bin_tables();
    let names = CacheNames::new(&bin, &wad);
    app.state::<ObjectIndexState>()
        .rename(|index| index.named(&names));
}

#[cfg(test)]
mod tests;
