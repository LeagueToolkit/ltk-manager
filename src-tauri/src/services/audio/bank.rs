//! The open event banks that take edits: their edits, undo, save, and the copy of a game bank
//! into a project layer on its first edit. "Editing" in `docs/ux/AUDIO.md`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use fs_err as fs;
use ltk_manager_assets::game_wads::WadCache;
use ltk_manager_assets::preview::AssetRef;
use ltk_manager_audio::{
    AudioFile, AudioIndex, BankEdit, BankNode, EditContext, EventBankDocument, MediaReplacement,
    NodeParent, ObjectId, OpenedBank, OpenedFile, SoundCache,
};
use ltk_manager_base::utils::fs::atomic_write;
use ltk_manager_bin::bin_document::{BinDocuments, HistoryStep, BASE_LAYER};
use ltk_manager_bin::sandbox::{SandboxRef, SandboxState};
use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Manager};

use super::convert::wem_of;
use super::events::{game_path, with_edit_context, with_event_bank, BankSource};
use super::index::{game_audio_index, project_audio_index};
use super::linked::{follow_events, save_bins, step_bins, LinkedBins, Step};
use super::references::with_site_names;
use crate::error::{AppError, AppResult, IpcResult};
use crate::services::shared::{archive_of, off_thread};
use crate::state::SettingsState;

/// The id of an open event bank. Ids are never reused.
pub type AudioBankId = u32;

/// One open event bank, the asset that it reads from and saves to, and its sandbox.
struct OpenBank {
    document: EventBankDocument,
    /// The layer file, loose file or game chunk of the bank. A game chunk becomes a layer file on
    /// the first edit.
    asset: AssetRef,
    sandbox: SandboxRef,
    /// The game path of the bank, which its bank units name it by.
    path: String,
    /// The bin documents that the bank's edits change, and the steps of the history.
    linked: LinkedBins,
    /// The file name of each WEM file that an import added, by the source ID of its media.
    imported: HashMap<u32, String>,
}

/// Every open event bank, by id.
#[derive(Default)]
pub struct AudioBankDocuments {
    open: Mutex<HashMap<AudioBankId, Arc<Mutex<OpenBank>>>>,
    next: AtomicU32,
}

impl AudioBankDocuments {
    fn get(&self, id: AudioBankId) -> AppResult<Arc<Mutex<OpenBank>>> {
        self.open
            .lock()
            .get(&id)
            .cloned()
            .ok_or_else(|| AppError::ValidationFailed(format!("No event bank is open as {id}")))
    }

    /// Returns the bank open under `id` with its edits, as the first file of a bank set.
    pub(super) fn opened(&self, id: AudioBankId) -> AppResult<OpenedBank> {
        let open = self.get(id)?;
        let open = open.lock();
        Ok(opened_of(&open))
    }

    /// Returns the bytes of the media file `asset` as an open document holds them, with the
    /// media that it imported, or `None` if no open document holds the file.
    pub(crate) fn media_bytes(&self, asset: &AssetRef) -> Option<Vec<u8>> {
        let open: Vec<_> = self.open.lock().values().cloned().collect();
        open.iter().find_map(|open| {
            let open = open.lock();
            open.document
                .media()
                .iter()
                .find(|file| file.asset() == asset)
                .map(|file| file.bytes().to_vec())
        })
    }
}

fn opened_of(open: &OpenBank) -> OpenedBank {
    OpenedBank {
        path: open.path.clone(),
        file: AudioFile {
            asset: open.asset.clone(),
            contents: open.document.bytes().to_vec(),
        },
        media: open
            .document
            .media()
            .iter()
            .map(|file| OpenedFile {
                path: file.path().to_owned(),
                file: AudioFile {
                    asset: file.asset().clone(),
                    contents: file.bytes().to_vec(),
                },
            })
            .collect(),
        names: open.document.created_names().to_vec(),
    }
}

/// Where an open event bank stands after a change.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AudioBankState {
    pub id: AudioBankId,
    /// Counts every change.
    pub revision: u64,
    /// The document holds changes that no save wrote.
    pub dirty: bool,
    /// The bank is version 145 with a hierarchy, so it takes edits.
    pub editable: bool,
    /// The version of the bank.
    pub version: u32,
    /// The file that a save writes. A game chunk's copy in the project after the first edit.
    pub asset: AssetRef,
    /// The IDs of the objects whose bytes differ from the bank as it was opened, in file order.
    pub edited: Vec<u32>,
    /// The source IDs of the media that a replacement changed.
    pub replaced: Vec<u32>,
    /// The media that the document imported from a file, by source ID. The list keeps a media
    /// that an undo removed, so a redo names it again.
    pub imported: Vec<ImportedMedia>,
}

/// A media that an open event bank imported, and the file name of the WEM file it came from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportedMedia {
    /// The source ID of the media.
    pub source: u32,
    /// The file name of the WEM file, with its extension.
    pub file: String,
}

fn state_of(id: AudioBankId, open: &OpenBank) -> AudioBankState {
    let mut imported: Vec<ImportedMedia> = open
        .imported
        .iter()
        .map(|(&source, file)| ImportedMedia {
            source,
            file: file.clone(),
        })
        .collect();
    imported.sort_unstable_by_key(|media| media.source);

    AudioBankState {
        id,
        revision: open.document.revision(),
        dirty: open.document.is_dirty() || open.linked.is_dirty(),
        editable: open.document.is_editable(),
        version: open.document.version(),
        asset: open.asset.clone(),
        edited: open.document.edited().into_iter().map(|id| id.0).collect(),
        replaced: open.document.replaced(),
        imported,
    }
}

/// Opens the event bank `asset` in `sandbox` as a document that takes edits.
///
/// # Errors
///
/// Fails if the asset cannot be read or is not a bank.
#[tauri::command]
#[specta::specta]
pub async fn audio_bank_open(
    sandbox: SandboxRef,
    asset: AssetRef,
    app_handle: AppHandle,
) -> IpcResult<AudioBankState> {
    off_thread(move || {
        let config = app_handle.state::<SettingsState>().config();
        let bytes = asset.read(&config, &app_handle.state::<WadCache>())?;
        let document = EventBankDocument::parse(bytes)?;
        let path = with_site_names(&app_handle, &sandbox, |_, rows| game_path(&asset, rows))?;

        let documents = app_handle.state::<AudioBankDocuments>();
        let id = documents.next.fetch_add(1, Ordering::Relaxed);
        let open = OpenBank {
            document,
            asset,
            sandbox,
            path,
            linked: LinkedBins::default(),
            imported: HashMap::new(),
        };
        let state = state_of(id, &open);
        documents.open.lock().insert(id, Arc::new(Mutex::new(open)));
        Ok(state)
    })
    .await
}

/// Closes the event bank open under `id`, dropping its unsaved changes.
#[tauri::command]
#[specta::specta]
pub async fn audio_bank_close(id: AudioBankId, app_handle: AppHandle) -> IpcResult<()> {
    let closed = app_handle
        .state::<AudioBankDocuments>()
        .open
        .lock()
        .remove(&id);
    if let Some(open) = closed {
        open.lock()
            .linked
            .close(&app_handle.state::<BinDocuments>());
    }
    IpcResult::ok(())
}

/// Applies `edit` to the event bank open under `id` as one undo step.
///
/// The bank set of the bank checks every new target, child and source, and a new ID avoids
/// every ID of the set and of the audio indexes. The first edit of a game chunk writes the chunk
/// into the project layer of the sandbox, the selected layer or the base layer, and the document
/// saves there after.
///
/// # Errors
///
/// Fails if the document refuses the edit, if a game chunk opens in no project, if the project
/// already has a file at the chunk's path, or if the copy cannot be written.
#[tauri::command]
#[specta::specta]
pub async fn audio_bank_edit(
    id: AudioBankId,
    edit: BankEdit,
    app_handle: AppHandle,
) -> IpcResult<AudioBankState> {
    off_thread(move || {
        change(&app_handle, id, |document, context| {
            Ok(document.edit(&edit, context)?)
        })
    })
    .await
}

/// Adds the WEM file at `file` as a new media of the bank set and a new sound under `parent` of
/// the event bank open under `id`, as one undo step.
///
/// The media goes into the media bank or the package of the set, which the first import of a
/// game file copies into the project layer as an edit copies the event bank. "New objects" in
/// `docs/ux/AUDIO.md`.
///
/// # Errors
///
/// Fails if the file cannot be read, if it is not a Wwise Vorbis WEM that decodes, and for the
/// reasons of [`audio_bank_edit`].
#[tauri::command]
#[specta::specta]
pub async fn audio_bank_import(
    id: AudioBankId,
    parent: NodeParent,
    file: String,
    app_handle: AppHandle,
) -> IpcResult<AudioBankState> {
    off_thread(move || {
        let wem = fs::read(&file)?;
        let mut imported = None;
        change(&app_handle, id, |document, context| {
            imported = Some(document.import(&parent, wem, context)?);
            Ok(())
        })?;

        let open = app_handle.state::<AudioBankDocuments>().get(id)?;
        let mut open = open.lock();
        let name = Path::new(&file)
            .file_name()
            .map(|name| name.to_string_lossy().into_owned());
        if let (Some(imported), Some(name)) = (imported, name) {
            open.imported.insert(imported.source, name);
        }
        Ok(state_of(id, &open))
    })
    .await
}

/// Returns what replacing the media `source` of the bank set of the event bank open under `id`
/// with the file at `file` writes: the media before and after, and the sounds that play it.
///
/// A `.wem` is read as it is. A `.wav`, `.ogg` or `.flac` converts through the Wwise console of
/// the settings. "Replacing media" in `docs/ux/AUDIO.md`.
///
/// # Errors
///
/// Fails if the file gives no Vorbis WEM, and for the reasons of [`audio_bank_replace`].
#[tauri::command]
#[specta::specta]
pub async fn audio_bank_replace_preview(
    id: AudioBankId,
    source: u32,
    file: String,
    app_handle: AppHandle,
) -> IpcResult<MediaReplacement> {
    off_thread(move || {
        let config = app_handle.state::<SettingsState>().config();
        let wem = wem_of(Path::new(&file), &config.audio)?;
        let documents = app_handle.state::<AudioBankDocuments>();
        let open = documents.get(id)?;
        let open = open.lock();

        let (game, _) = game_audio_index(&app_handle);
        with_edit_context(
            &app_handle,
            &open.sandbox,
            BankSource::Opened(opened_of(&open)),
            game.as_deref(),
            |_, context| Ok(open.document.replacement(source, &wem, context)?),
        )
    })
    .await
}

/// Replaces the media `source` of the bank set of the event bank open under `id` with the file
/// at `file`, at the same source ID, as one undo step.
///
/// The media file that holds the media joins the document, and a game file is copied into the
/// project layer as an edit copies the event bank. Each sound of the bank that plays the media
/// takes the new size.
///
/// # Errors
///
/// Fails if the file gives no Vorbis WEM, if the document refuses the replacement, and for the
/// reasons of [`audio_bank_edit`].
#[tauri::command]
#[specta::specta]
pub async fn audio_bank_replace(
    id: AudioBankId,
    source: u32,
    file: String,
    app_handle: AppHandle,
) -> IpcResult<AudioBankState> {
    off_thread(move || {
        let config = app_handle.state::<SettingsState>().config();
        let wem = wem_of(Path::new(&file), &config.audio)?;
        change(&app_handle, id, |document, context| {
            document.replace(source, wem, context)?;
            Ok(())
        })
    })
    .await
}

/// Runs `apply` on the document open under `id`, copies the game files that it changed into the
/// project layer, and makes the bank units follow the events that it created, renamed or
/// deleted. A failed copy undoes the change.
fn change(
    app: &AppHandle,
    id: AudioBankId,
    apply: impl FnOnce(&mut EventBankDocument, &EditContext<'_>) -> AppResult<()>,
) -> AppResult<AudioBankState> {
    let open = app.state::<AudioBankDocuments>().get(id)?;
    let mut open = open.lock();
    let copy = layer_copy(&open.sandbox, &open.asset, &open.path, BANK_EXTENSION)?;
    let before = open.document.revision();
    let base = copy.as_ref().map(|_| open.document.bytes().to_vec());
    let events = open.document.events();
    let replaced = open.document.replaced();

    let (game, _) = game_audio_index(app);
    let sandbox = open.sandbox.clone();
    let opened = opened_of(&open);
    with_edit_context(
        app,
        &sandbox,
        BankSource::Opened(opened),
        game.as_deref(),
        |_, context| apply(&mut open.document, context),
    )?;
    if open.document.revision() == before {
        return Ok(state_of(id, &open));
    }

    if let Err(error) = copy_changed(app, &mut open, copy, base.as_deref()) {
        open.document.undo()?;
        return Err(error);
    }

    let bins = follow_bank_events(app, &mut open, &events, game.as_deref());
    open.linked.push(Step { bank: true, bins });
    if replaced != open.document.replaced() || !replaced.is_empty() {
        forget_replaced(app, &open);
    }
    Ok(state_of(id, &open))
}

/// Makes the bank units of the bank follow the events that the last edit added and removed
/// against `before`, and returns the bin documents that took a step.
///
/// A unit that cannot be updated is logged, and the bank edit stays.
fn follow_bank_events(
    app: &AppHandle,
    open: &mut OpenBank,
    before: &[u32],
    game: Option<&AudioIndex>,
) -> Vec<ltk_manager_bin::bin_document::BinDocumentId> {
    let after = open.document.events();
    let project = open.sandbox.project().map(project_audio_index);
    let indexes: Vec<&AudioIndex> = project.iter().chain(game).collect();
    let created = open.document.created_names();
    let name_of = |id: u32| {
        created
            .iter()
            .rev()
            .find(|name| ObjectId::from_name(name).0 == id)
            .cloned()
            .or_else(|| {
                indexes
                    .iter()
                    .find_map(|index| index.name(ObjectId(id)).map(str::to_owned))
            })
    };
    let removed: Vec<String> = before
        .iter()
        .filter(|id| !after.contains(id))
        .filter_map(|&id| name_of(id))
        .collect();
    let added: Vec<String> = after
        .iter()
        .filter(|id| !before.contains(id))
        .filter_map(|&id| name_of(id))
        .collect();
    if removed.is_empty() && added.is_empty() {
        return Vec::new();
    }

    let sandbox = open.sandbox.clone();
    let path = open.path.clone();
    let followed = with_site_names(app, &sandbox, |names, _| {
        follow_events(
            app,
            &mut open.linked,
            &sandbox,
            &path,
            &indexes,
            names,
            &removed,
            &added,
        )
    });
    match followed {
        Ok(Ok(bins)) => bins,
        Ok(Err(error)) | Err(error) => {
            tracing::warn!(
                path,
                ?removed,
                ?added,
                %error,
                "Failed to update the events list of the bank units that name a bank"
            );
            Vec::new()
        }
    }
}

/// Drops the decoded media of the project of `open`, whose media at a replaced source ID changed.
fn forget_replaced(app: &AppHandle, open: &OpenBank) {
    if let Some(project) = open.sandbox.project() {
        app.state::<SoundCache>().invalidate_project(project);
    }
}

/// Writes the game bytes of each game file that the document changed into the project layer,
/// and points the document at the copies.
fn copy_changed(
    app: &AppHandle,
    open: &mut OpenBank,
    bank: Option<AssetRef>,
    base: Option<&[u8]>,
) -> AppResult<()> {
    if let (Some(target), Some(base)) = (bank, base) {
        write_copy(&target, base)?;
        tracing::info!(
            ?target,
            "Copied a game event bank into the project on its first edit"
        );
        invalidate(app, &target);
        open.asset = target;
    }

    let sandbox = open.sandbox.clone();
    for file in open.document.media_mut() {
        if !matches!(file.asset(), AssetRef::GameChunk { .. }) {
            continue;
        }

        let extension = if file.is_package() {
            PACKAGE_EXTENSION
        } else {
            BANK_EXTENSION
        };
        let Some(target) = layer_copy(&sandbox, file.asset(), file.path(), extension)? else {
            continue;
        };
        write_copy(&target, file.opened())?;
        tracing::info!(
            ?target,
            "Copied a game media file into the project on its first import"
        );
        invalidate(app, &target);
        file.set_asset(target);
    }
    Ok(())
}

/// Reverts the last edit of the event bank open under `id`, or redoes the last undone one.
///
/// Returns `None` if the history holds no step to take.
#[tauri::command]
#[specta::specta]
pub async fn audio_bank_step(
    id: AudioBankId,
    undo: bool,
    app_handle: AppHandle,
) -> IpcResult<Option<AudioBankState>> {
    off_thread(move || {
        let open = app_handle.state::<AudioBankDocuments>().get(id)?;
        let mut open = open.lock();
        let direction = if undo {
            HistoryStep::Undo
        } else {
            HistoryStep::Redo
        };
        let replaced = open.document.replaced();

        let Some(step) = open.linked.take(direction) else {
            return Ok(None);
        };
        if step.bank {
            let stepped = if undo {
                open.document.undo()?
            } else {
                open.document.redo()?
            };
            if !stepped {
                tracing::warn!(
                    id,
                    "The bank history held no step that its linked history took"
                );
            }
        }
        step_bins(&app_handle, &step, direction)?;

        if !replaced.is_empty() || !open.document.replaced().is_empty() {
            forget_replaced(&app_handle, &open);
        }
        Ok(Some(state_of(id, &open)))
    })
    .await
}

/// Writes the event bank open under `id` and every media file that it changed, each through a
/// temporary file.
///
/// # Errors
///
/// Fails, and writes no file, if a file is still a game chunk or changed on disk since it was
/// read or last saved. Fails if a write fails.
#[tauri::command]
#[specta::specta]
pub async fn audio_bank_save(id: AudioBankId, app_handle: AppHandle) -> IpcResult<AudioBankState> {
    off_thread(move || {
        let open = app_handle.state::<AudioBankDocuments>().get(id)?;
        let mut open = open.lock();
        if !open.document.is_dirty() {
            save_bins(&app_handle, &mut open.linked)?;
            return Ok(state_of(id, &open));
        }

        let mut writes: Vec<(PathBuf, &[u8])> = Vec::new();
        let document = &open.document;
        if !document.is_base(document.bytes()) {
            let target = saved_file(&open.asset)?;
            check_on_disk(&target, |bytes| document.is_base(bytes))?;
            writes.push((target, document.bytes()));
        }
        for file in document.media().iter().filter(|file| file.is_changed()) {
            let target = saved_file(file.asset())?;
            check_on_disk(&target, |bytes| file.is_base(bytes))?;
            writes.push((target, file.bytes()));
        }

        for (target, bytes) in writes {
            atomic_write(&target, bytes)?;
        }
        open.document.mark_saved();
        save_bins(&app_handle, &mut open.linked)?;
        invalidate(&app_handle, &open.asset);
        Ok(state_of(id, &open))
    })
    .await
}

/// Fails if the file `target` holds bytes other than those that `is_base` takes.
fn check_on_disk(target: &Path, is_base: impl FnOnce(&[u8]) -> bool) -> AppResult<()> {
    let on_disk = fs::read(target)?;
    if is_base(&on_disk) {
        return Ok(());
    }

    Err(AppError::ValidationFailed(format!(
        "{} changed on disk since it was opened. Reopen the bank to edit it.",
        target.display()
    )))
}

/// The extension of a bank that a chunk without a name is copied under.
const BANK_EXTENSION: &str = "bnk";

/// The extension of a package that a chunk without a name is copied under.
const PACKAGE_EXTENSION: &str = "wpk";

// Lists the sounds and containers of the bank set of the event bank open under `id`, which an
/// edit adds as a child or a Play target.
#[tauri::command]
#[specta::specta]
pub async fn audio_bank_nodes(id: AudioBankId, app_handle: AppHandle) -> IpcResult<Vec<BankNode>> {
    off_thread(move || {
        let documents = app_handle.state::<AudioBankDocuments>();
        let opened = documents.opened(id)?;
        let sandbox = documents.get(id)?.lock().sandbox.clone();
        let (game, _) = game_audio_index(&app_handle);

        with_event_bank(
            &app_handle,
            &sandbox,
            BankSource::Opened(opened),
            game.as_deref(),
            |bank| Ok(bank.nodes()),
        )
    })
    .await
}

/// Returns the layer file that the first edit of `asset` copies the file into, or `None` for an
/// asset that is a file already.
///
/// The layer is the one that `sandbox` names, else the base layer. The path is the chunk's game
/// path below its archive folder, or its hash and `extension` for a chunk without a name.
///
/// # Errors
///
/// Fails for a game chunk in the game sandbox and for a client chunk.
pub(super) fn layer_copy(
    sandbox: &SandboxRef,
    asset: &AssetRef,
    path: &str,
    extension: &str,
) -> AppResult<Option<AssetRef>> {
    match asset {
        AssetRef::Layer { .. } | AssetRef::File { .. } => Ok(None),
        AssetRef::LcuChunk { .. } => Err(AppError::ValidationFailed(
            "A League client file takes no edit".to_owned(),
        )),
        AssetRef::GameChunk { path_hash, .. } => {
            let (project, layer) = match sandbox {
                SandboxRef::Game => {
                    return Err(AppError::ValidationFailed(
                        "The game sandbox takes no edit. Open the bank in a project to edit it."
                            .to_owned(),
                    ));
                }
                SandboxRef::Layers { .. } => {
                    return Err(AppError::ValidationFailed(
                        "A layer subset takes no edit of a game file. Read from the project to edit it."
                            .to_owned(),
                    ));
                }
                SandboxRef::Project { project } => (project, BASE_LAYER),
            };
            let archive = archive_of(asset)
                .ok_or_else(|| AppError::ValidationFailed(format!("{path} is in no archive")))?;
            let file = if path == path_hash {
                format!("{path_hash}.{extension}")
            } else {
                path.to_lowercase()
            };

            Ok(Some(AssetRef::Layer {
                project: project.clone(),
                layer: layer.to_owned(),
                path: format!("{archive}/{file}"),
            }))
        }
    }
}

/// Returns the file on disk that a save of `asset` writes.
fn saved_file(asset: &AssetRef) -> AppResult<PathBuf> {
    match asset {
        AssetRef::Layer { .. } => asset
            .layer_file()
            .expect("a layer asset names a layer file"),
        AssetRef::File { path } => Ok(PathBuf::from(path)),
        AssetRef::GameChunk { .. } | AssetRef::LcuChunk { .. } => Err(AppError::ValidationFailed(
            "The bank is a game file with no edit, so there is nothing to save".to_owned(),
        )),
    }
}

/// Writes `bytes` as the layer file `target`, which must not exist yet.
pub(super) fn write_copy(target: &AssetRef, bytes: &[u8]) -> AppResult<()> {
    let file = saved_file(target)?;
    if file.exists() {
        return Err(AppError::ValidationFailed(format!(
            "The project already has {}. Open that file to edit the bank.",
            file.display()
        )));
    }
    if let Some(parent) = Path::new(&file).parent() {
        fs::create_dir_all(parent)?;
    }
    atomic_write(&file, bytes)?;
    Ok(())
}

/// Drops the sandbox snapshots of the project of `asset`, whose layer files changed.
fn invalidate(app: &AppHandle, asset: &AssetRef) {
    if let AssetRef::Layer { project, .. } = asset {
        app.state::<SandboxState>().invalidate(project);
    }
}
