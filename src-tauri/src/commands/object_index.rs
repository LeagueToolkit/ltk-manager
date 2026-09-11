//! The bin object index: warm it, drop it, and search it.

use super::game_index::{built_game_index, find_query};
use super::off_thread;
use crate::error::{AppError, AppErrorResponse, AppResult, IpcResult};
use crate::state::SettingsState;
use ltk_manager_core::bin_document::{BinDocumentId, BinDocuments, BinObjectHeader};
use ltk_manager_core::config::Config;
use ltk_manager_core::hashtables::{
    BinHashTablesState, HashtableCache, WadPathResolver, WadPathResolverState,
};
use ltk_manager_core::object_index::{
    self, parse_hash, BuildTicket, CacheNames, DeclaredObject, ObjectDirListing,
    ObjectFindGeneration, ObjectFindResult, ObjectIndex, ObjectIndexSnapshot,
    ObjectReferenceGeneration, ObjectSearchGeneration, ObjectSearchResult, ReferenceResult,
};
use ltk_manager_core::preview::AssetRef;
use ltk_manager_core::problems::budget::files_at_once;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use ts_rs::TS;

/// The managed object index, keeping a failed build as the error the frontend reads.
pub type ObjectIndexState = object_index::ObjectIndexState<AppErrorResponse>;

/// What a search answers, given the slot the index is in.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
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
pub async fn search_object_index(query: String, app_handle: AppHandle) -> IpcResult<ObjectSearch> {
    let ticket = app_handle.state::<ObjectSearchGeneration>().claim();
    let overtaken = {
        let app_handle = app_handle.clone();
        move || {
            app_handle
                .state::<ObjectSearchGeneration>()
                .overtook(ticket)
        }
    };

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
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
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

/// What one prefix of the object tree holds.
///
/// `prefix` is `""` for the root, `?` for the objects no table names, and otherwise a
/// path a listing gave. A prefix no object path runs through reports `INVALID_PATH`.
/// "Objects browser" in `docs/ux/PROJECT_EDITOR.md`.
#[tauri::command]
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

/// What a full search of the objects found, given the slot the index is in.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
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
/// either way the match is case-insensitive. `class` is the `class:` term's value,
/// a name prefix or a hash, which narrows the objects to the classes it opens.
///
/// An empty pattern with no class matches nothing. A pattern that does not parse
/// reports `VALIDATION_FAILED` with the parser's own message.
///
/// [`find_in_game_index`]: super::game_index::find_in_game_index
#[tauri::command]
pub async fn find_objects(
    pattern: String,
    regex: bool,
    class: Option<String>,
    app_handle: AppHandle,
) -> IpcResult<ObjectFind> {
    let query = match find_query(&pattern, regex) {
        Ok(query) => query,
        Err(e) => return IpcResult::from(Err::<ObjectFind, _>(e)),
    };

    let ticket = app_handle.state::<ObjectFindGeneration>().claim();
    let overtaken = {
        let app_handle = app_handle.clone();
        move || app_handle.state::<ObjectFindGeneration>().overtook(ticket)
    };

    off_thread(move || {
        let index = match app_handle.state::<ObjectIndexState>().snapshot() {
            ObjectIndexSnapshot::Absent => return Ok(ObjectFind::Absent),
            ObjectIndexSnapshot::Building => return Ok(ObjectFind::Building),
            ObjectIndexSnapshot::Failed(error) => return Ok(ObjectFind::Failed { error }),
            ObjectIndexSnapshot::Ready(index) => index,
        };

        let result = index.find(query.as_ref(), class.as_deref(), overtaken);
        tracing::debug!(
            pattern = %pattern,
            regex,
            class = class.as_deref().unwrap_or(""),
            hits = result.hits.len(),
            total = result.total,
            superseded = result.superseded,
            "Ran a full search of the bin object index"
        );
        Ok(ObjectFind::Ready(result))
    })
    .await
}

/// What a reference query asks the index for.
#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ReferenceQuery {
    /// Every object of one class.
    #[serde(rename_all = "camelCase")]
    Class {
        /// The class hash, `0x` and eight hex digits.
        class_hash: String,
    },
    /// Every declaration of one object.
    #[serde(rename_all = "camelCase")]
    Object {
        /// The object's path hash, `0x` and eight hex digits.
        object_hash: String,
    },
}

impl ReferenceQuery {
    /// The hash the query names, whichever it names.
    fn hash_text(&self) -> &str {
        let (Self::Class { class_hash: text } | Self::Object { object_hash: text }) = self;
        text
    }
}

/// What a reference query found, given the slot the index is in.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ObjectReferences {
    /// Nothing has warmed the index, or the switch that gates it is off.
    Absent,
    /// A build is running. The groups follow it.
    Building,
    /// The last build failed, and the next warm retries it.
    Failed { error: AppErrorResponse },
    /// The index answered.
    Ready(ReferenceResult),
}

/// What `query` names, grouped by the file that declares it.
///
/// A class answers with every object the install declares as it, and an object with
/// every file declaring that object. The scan carries a generation of its own, so a
/// re-run gives up only the reference scan it overtakes.
///
/// "The References document" in `docs/ux/PROJECT_EDITOR.md`.
#[tauri::command]
pub async fn find_references(
    query: ReferenceQuery,
    app_handle: AppHandle,
) -> IpcResult<ObjectReferences> {
    let asked = query.hash_text().to_owned();
    let Some(hash) = parse_hash(&asked) else {
        let e = AppError::ValidationFailed(format!("Not an object index hash: {asked}"));
        return IpcResult::from(Err::<ObjectReferences, _>(e));
    };

    let ticket = app_handle.state::<ObjectReferenceGeneration>().claim();
    let overtaken = {
        let app_handle = app_handle.clone();
        move || {
            app_handle
                .state::<ObjectReferenceGeneration>()
                .overtook(ticket)
        }
    };

    off_thread(move || {
        let index = match app_handle.state::<ObjectIndexState>().snapshot() {
            ObjectIndexSnapshot::Absent => return Ok(ObjectReferences::Absent),
            ObjectIndexSnapshot::Building => return Ok(ObjectReferences::Building),
            ObjectIndexSnapshot::Failed(error) => return Ok(ObjectReferences::Failed { error }),
            ObjectIndexSnapshot::Ready(index) => index,
        };

        let result = match query {
            ReferenceQuery::Class { .. } => index.class_references(hash, overtaken),
            ReferenceQuery::Object { .. } => index.object_references(hash),
        };
        tracing::debug!(
            hash = %asked,
            groups = result.groups.len(),
            total = result.total,
            superseded = result.superseded,
            "Answered a reference query from the bin object index"
        );
        Ok(ObjectReferences::Ready(result))
    })
    .await
}

/// The slot the index is in, as an answer reports it.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
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
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DeclaredObjects {
    /// Off `Ready`, only the open document's own objects are in `objects`.
    pub index: ObjectIndexStatus,
    /// By the object's hash, `0x` and eight hex digits. A hash nothing declares is absent.
    pub objects: HashMap<String, DeclaredObject>,
}

/// Every declaration of each of `object_hashes`, by hash.
///
/// The install's declarations come from the index, in the slot it is in. With
/// `document` open, the document's own declarations join them and every list
/// is ordered as a link resolves it (ADR-0028): this file, then a file the bin
/// depends on, then archive order.
#[tauri::command]
pub async fn declared_objects(
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
    let (schema, build) = super::bin::installed_schema(app);

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
