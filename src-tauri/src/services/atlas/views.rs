//! Atlas's reads of a view controller: what it draws, the sample loadout and tooltips it is
//! filled with, and its fonts.

use atlas::{
    font_catalog, read_character_tooltips, read_characters, read_loadout, resolve_font,
    resolve_scene_bin, resolve_view, UiCharacter, UiFont, UiFontCatalog, UiLoadout, UiSpellTooltip,
    UiView, VariantChoice, FONTS_PATH,
};
use ltk_manager_core::bin_document::{
    BinDocument, BinDocumentError, BinDocumentId, BinDocuments, RowNames,
};
use ltk_manager_core::object_index::ObjectIndexSnapshot;
use ltk_manager_core::preview::AssetRef;
use ltk_manager_core::sandbox::SandboxRef;
use ltk_manager_core::strings::StringKeyIndexState;
use serde::Deserialize;
use tauri::{AppHandle, Manager};

use crate::error::{AppError, IpcResult};
use crate::services::objects::ObjectIndexState;
use crate::services::shared::document_assets::{parse_entry, read_resolved};
use crate::services::shared::installed::ProjectGame;
use crate::services::shared::off_thread;
use crate::state::SettingsState;

/// A variant a view draws over its base: the override slot, and its open document where one is.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(specta::Type)]
pub struct ViewVariant {
    pub slot: String,
    pub document: Option<BinDocumentId>,
}

/// The view controller at `entry` in the open document `document`, with its base scene bin,
/// its manifest and every sprite resolved through the document's sandbox.
///
/// `scene` is the open document of the base scene bin, which the view draws as it stands in
/// place of the file. `variant` is laid over that base as the client lays an override.
///
/// # Errors
///
/// Fails when `entry` is no object hash or the document has no object under it. A file or
/// sprite the view cannot reach is a warning on the answer.
#[tauri::command]
#[specta::specta]
pub async fn read_ui_view(
    document: BinDocumentId,
    entry: String,
    scene: Option<BinDocumentId>,
    variant: Option<ViewVariant>,
    app_handle: AppHandle,
) -> IpcResult<UiView> {
    off_thread(move || {
        let entry = parse_entry(&entry)?;
        let documents = app_handle.state::<BinDocuments>();
        let scene = scene.map(|scene| documents.document(scene)).transpose()?;
        let variant_open = variant
            .as_ref()
            .and_then(|variant| variant.document)
            .map(|open| documents.document(open))
            .transpose()?;
        let choice = variant.as_ref().map(|variant| VariantChoice {
            slot: &variant.slot,
            open: variant_open.as_deref(),
        });

        let game = project_game(&app_handle, document);
        read_resolved(&app_handle, document, |open, names, assets| {
            let mut read = |asset: &AssetRef| game.read(asset);
            resolve_view(
                open,
                entry,
                scene.as_deref(),
                choice,
                names,
                assets,
                &game,
                &mut read,
            )
            .map_err(|e| AppError::ValidationFailed(e.to_string()))
        })
    })
    .await
}

/// The scene bin open as `document`, drawn as a view of its own for the element at `entry`: its
/// scenes and elements as they stand, with the manifest of the folder the file sits in.
///
/// # Errors
///
/// Fails when `entry` is no object hash, the document is closed or it has no object under it.
#[tauri::command]
#[specta::specta]
pub async fn read_ui_scene_view(
    document: BinDocumentId,
    entry: String,
    app_handle: AppHandle,
) -> IpcResult<UiView> {
    off_thread(move || {
        let entry = parse_entry(&entry)?;
        let asset = app_handle
            .state::<BinDocuments>()
            .asset_of(document)
            .ok_or(BinDocumentError::NotOpen(document))?;
        let game = project_game(&app_handle, document);
        read_resolved(&app_handle, document, |open, names, assets| {
            let mut read = |asset: &AssetRef| game.read(asset);
            let path = chunk_path(&asset, names);
            resolve_scene_bin(
                open,
                entry,
                &path,
                Some(asset.clone()),
                names,
                assets,
                &mut read,
            )
            .map_err(|e| AppError::ValidationFailed(e.to_string()))
        })
    })
    .await
}

/// The sample champion, summoner spells, runes and items a preview fills a controller's elements
/// with, read through the sandbox `document` opens in.
///
/// An object the index has not reached, or a texture no archive holds, is absent from the answer.
///
/// # Errors
///
/// Fails when the document is closed.
#[tauri::command]
#[specta::specta]
pub async fn read_ui_loadout(
    document: BinDocumentId,
    app_handle: AppHandle,
) -> IpcResult<UiLoadout> {
    off_thread(move || {
        let game = project_game(&app_handle, document);
        read_resolved(&app_handle, document, |_, names, assets| {
            Ok(read_loadout(&game, assets, names))
        })
    })
    .await
}

/// Every character the object index holds a record for, with its name and icon, read through
/// the sandbox `document` opens in and the game's stringtable.
///
/// An index that is not ready reads as no characters.
///
/// # Errors
///
/// Fails when the document is closed.
#[tauri::command]
#[specta::specta]
pub async fn read_ui_characters(
    document: BinDocumentId,
    app_handle: AppHandle,
) -> IpcResult<Vec<UiCharacter>> {
    off_thread(move || {
        let ObjectIndexSnapshot::Ready(index) = app_handle.state::<ObjectIndexState>().snapshot()
        else {
            return Ok(Vec::new());
        };
        let characters = ltk_manager_game::character::characters(&index);
        let config = app_handle.state::<SettingsState>().config();
        let strings = app_handle
            .state::<StringKeyIndexState>()
            .get_or_build(&config);
        let strings = |key: &str| strings.text(key).map(str::to_owned);
        let game = project_game(&app_handle, document);
        read_resolved(&app_handle, document, |_, names, assets| {
            Ok(read_characters(&game, assets, names, &strings, &characters))
        })
    })
    .await
}

/// The tooltips of the passive and abilities of the character `character`, such as `Ahri`, at
/// `level` and each spell at `rank`, read through the sandbox `document` opens in and the game's
/// stringtable. Level 0 reads as no character at all, per `read_character_tooltips`.
///
/// A character the index has not reached reads as no tooltips.
///
/// # Errors
///
/// Fails when the document is closed.
#[tauri::command]
#[specta::specta]
pub async fn read_ui_tooltips(
    document: BinDocumentId,
    character: String,
    level: u8,
    rank: u8,
    app_handle: AppHandle,
) -> IpcResult<Vec<UiSpellTooltip>> {
    off_thread(move || {
        let config = app_handle.state::<SettingsState>().config();
        let index = app_handle
            .state::<StringKeyIndexState>()
            .get_or_build(&config);
        let strings = |key: &str| index.text(key).map(str::to_owned);
        let game = project_game(&app_handle, document);
        read_resolved(&app_handle, document, |_, names, assets| {
            Ok(read_character_tooltips(
                &game, assets, names, &strings, &character, level, rank,
            ))
        })
    })
    .await
}

/// The `GameFontDescription` at `entry` in the open document `document`, its links followed
/// into the document and then into the `ux/fonts` its sandbox resolves.
///
/// # Errors
///
/// Fails when `entry` is no object hash or neither bin holds an object under it.
#[tauri::command]
#[specta::specta]
pub async fn read_ui_font(
    document: BinDocumentId,
    entry: String,
    app_handle: AppHandle,
) -> IpcResult<UiFont> {
    off_thread(move || {
        let entry = parse_entry(&entry)?;
        let game = project_game(&app_handle, document);
        read_resolved(&app_handle, document, |open, names, assets| {
            let fonts = assets
                .locate(FONTS_PATH)
                .and_then(|asset| game.read(&asset).ok())
                .and_then(|bytes| BinDocument::parse(bytes).ok());
            resolve_font(open, entry, fonts.as_ref(), names, assets)
                .map_err(|e| AppError::ValidationFailed(e.to_string()))
        })
    })
    .await
}

/// The fonts and faces a text in the open document `document` can draw with: the document's
/// own, then those of the `ux/fonts` its sandbox resolves.
///
/// # Errors
///
/// Fails when the names or the project chunks the resolution reads are unavailable.
#[tauri::command]
#[specta::specta]
pub async fn read_ui_font_catalog(
    document: BinDocumentId,
    app_handle: AppHandle,
) -> IpcResult<UiFontCatalog> {
    off_thread(move || {
        let game = project_game(&app_handle, document);
        read_resolved(&app_handle, document, |open, names, assets| {
            let fonts = assets
                .locate(FONTS_PATH)
                .and_then(|asset| game.read(&asset).ok())
                .and_then(|bytes| BinDocument::parse(bytes).ok());
            Ok(font_catalog(open, fonts.as_ref(), names))
        })
    })
    .await
}

/// The game as the project `document` opens in builds it.
fn project_game(app_handle: &AppHandle, document: BinDocumentId) -> ProjectGame {
    let sandbox = app_handle
        .state::<BinDocuments>()
        .sandbox_of(document)
        .unwrap_or(SandboxRef::Game);
    ProjectGame::new(app_handle, &sandbox)
}

/// The chunk path an asset stands for, which names the folder its manifest sits under: a game
/// chunk's by its hash, and a project or disk file's own.
fn chunk_path(asset: &AssetRef, names: &dyn RowNames) -> String {
    match asset {
        AssetRef::GameChunk { path_hash, .. } => asset
            .chunk_hash()
            .and_then(|hash| names.chunk_name(hash))
            .unwrap_or_else(|| path_hash.clone()),
        AssetRef::Layer { path, .. } | AssetRef::File { path } => path.replace('\\', "/"),
        AssetRef::LcuChunk { .. } => unreachable!("the bin store holds no client chunk"),
    }
}
