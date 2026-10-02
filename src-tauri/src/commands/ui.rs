//! Atlas's reads: a view controller resolved into what it draws, a font, and the UI programs.

use crate::error::{AppError, AppResult, IpcResult};
use crate::services::game::index::game_file;
use crate::services::objects::ObjectIndexState;
use crate::services::preview::material::{shader_defs, translations};
use crate::services::shared::document_assets::{parse_entry, read_resolved, with_resolution};
use crate::services::shared::installed::ProjectGame;
use crate::services::shared::off_thread;
use crate::services::shared::{asset_reader, read_asset};
use crate::state::SettingsState;
use atlas::{
    font_catalog, import_font_file, import_sprite, import_surface, patch_sprite, patchable,
    png_pixels, read_character_tooltips, read_characters, read_loadout, read_sheet, resolve_font,
    resolve_scene_bin, resolve_view, sprite_pixels, sprite_png, PagePatch, PatchTarget,
    SheetImport, SheetSpec, SheetTarget, UiCharacter, UiFont, UiFontCatalog, UiLoadout, UiShader,
    UiSpellTooltip, UiView, VariantChoice, FONTS_PATH,
};
use ltk_hash::{BinHash, Hash as _};
use ltk_manager_core::bin_document::GameCopy as _;
use ltk_manager_core::bin_document::{BinDocument, BinDocumentId, BinDocuments, RowNames};
use ltk_manager_core::object_index::parse_hash;
use ltk_manager_core::object_index::ObjectIndexSnapshot;
use ltk_manager_core::preview::AssetRef;
use ltk_manager_core::sandbox::{SandboxRef, SandboxState};
use ltk_manager_core::strings::StringKeyIndexState;
use ltk_manager_game::program::{
    read_programs, MaterialProgram, ProgramOptions, ProgramRead, Resolution,
};
use serde::Deserialize;
use std::path::Path;
use tauri::{AppHandle, Manager};

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
            .ok_or_else(|| {
                AppError::ValidationFailed(format!("Document {document} is not open"))
            })?;
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
        let characters = index.characters();
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

/// Import the PNG at `source` into the sheet `sheet` of the project `document` opens in, or put
/// it in place of the sprite `replace`, per section 5 of docs/plans/atlas-ui-editor.md.
///
/// A new sheet's page lands in the layer the document declares into, and in the archive folder
/// its own bin comes from.
///
/// # Errors
///
/// Fails when the document is closed or opens in no project, when the image cannot be read, and
/// when the sheet would outgrow one page.
#[tauri::command]
#[specta::specta]
pub async fn atlas_import_sprite(
    document: BinDocumentId,
    sheet: String,
    source: String,
    replace: Option<String>,
    app_handle: AppHandle,
) -> IpcResult<SheetImport> {
    off_thread(move || {
        let documents = app_handle.state::<BinDocuments>();
        let project = project_of(&documents, document)?;
        let asset = documents
            .asset_of(document)
            .ok_or_else(|| not_open(document))?;
        let layer = layer_of(&documents, document, &asset)?;
        let archive = archive_of(&asset).ok_or_else(|| {
            AppError::ValidationFailed("The document is in no archive".to_owned())
        })?;

        let target = SheetTarget {
            project: Path::new(&project),
            sheet: &sheet,
            layer: &layer,
            archive: &archive,
        };
        let imported = import_sprite(&target, Path::new(&source), replace.as_deref())?;
        app_handle.state::<SandboxState>().invalidate(&project);
        Ok(imported)
    })
    .await
}

/// Copy the `.ttf` or `.otf` at `source` into the layer and archive the document `document`
/// writes to, answering the path a `FontType` names it by.
///
/// # Errors
///
/// Fails when the document opens in no project or writes to no layer, for a file of another
/// type, and when the copy cannot be written.
#[tauri::command]
#[specta::specta]
pub async fn atlas_import_font_file(
    document: BinDocumentId,
    source: String,
    app_handle: AppHandle,
) -> IpcResult<String> {
    off_thread(move || {
        let documents = app_handle.state::<BinDocuments>();
        let project = project_of(&documents, document)?;
        let asset = documents
            .asset_of(document)
            .ok_or_else(|| not_open(document))?;
        let layer = layer_of(&documents, document, &asset)?;
        let archive = archive_of(&asset).ok_or_else(|| {
            AppError::ValidationFailed("The document is in no archive".to_owned())
        })?;

        let named = import_font_file(Path::new(&project), &layer, &archive, Path::new(&source))?;
        app_handle.state::<SandboxState>().invalidate(&project);
        Ok(named)
    })
    .await
}

/// What a surface is made from: an image file, or a sprite an element already draws.
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SurfaceSource {
    File { path: String },
    Sprite { texture: AssetRef, uv: [f32; 4] },
}

/// Make a surface named `name` on the sheet `sheet` of the project `document` opens in, per
/// section 5 of docs/plans/atlas-ui-editor.md: the image of `source`, its slice lines found in it,
/// so it stretches to any element's size.
///
/// # Errors
///
/// Fails when the document is closed or opens in no project, when the image cannot be read, and
/// when the sheet would outgrow one page.
#[tauri::command]
#[specta::specta]
pub async fn atlas_make_surface(
    document: BinDocumentId,
    sheet: String,
    name: String,
    source: SurfaceSource,
    app_handle: AppHandle,
) -> IpcResult<SheetImport> {
    off_thread(move || {
        let documents = app_handle.state::<BinDocuments>();
        let project = project_of(&documents, document)?;
        let asset = documents
            .asset_of(document)
            .ok_or_else(|| not_open(document))?;
        let layer = layer_of(&documents, document, &asset)?;
        let archive = archive_of(&asset).ok_or_else(|| {
            AppError::ValidationFailed("The document is in no archive".to_owned())
        })?;

        let image = match source {
            SurfaceSource::File { path } => png_pixels(Path::new(&path))?,
            SurfaceSource::Sprite { texture, uv } => {
                sprite_pixels(&read_asset(&app_handle, &texture)?, uv)?
            }
        };
        let target = SheetTarget {
            project: Path::new(&project),
            sheet: &sheet,
            layer: &layer,
            archive: &archive,
        };
        let made = import_surface(&target, &name, image)?;
        app_handle.state::<SandboxState>().invalidate(&project);
        Ok(made)
    })
    .await
}

/// Paste the PNG at `source` over the sprite at `uv` of the game texture `page`, and rebuild the
/// page into the layer the document `document` writes to, per section 5 of
/// docs/plans/atlas-ui-editor.md. Every element naming a sprite of the page keeps its rect.
///
/// Answers none, writing nothing, where the game holds no `.tex` at `page` or the image is not the
/// sprite's size, which an import onto the project's sheet takes instead.
///
/// # Errors
///
/// Fails when the document is closed or opens in no project, and when the page or the image
/// cannot be read or the page cannot be written.
#[tauri::command]
#[specta::specta]
pub async fn atlas_patch_sprite(
    document: BinDocumentId,
    page: String,
    uv: [f32; 4],
    source: String,
    app_handle: AppHandle,
) -> IpcResult<Option<PagePatch>> {
    off_thread(move || {
        if !patchable(&page) {
            return Ok(None);
        }

        let documents = app_handle.state::<BinDocuments>();
        let project = project_of(&documents, document)?;
        let asset = documents
            .asset_of(document)
            .ok_or_else(|| not_open(document))?;
        let layer = layer_of(&documents, document, &asset)?;
        let Some((base, bytes)) = game_file(&app_handle, &page)? else {
            return Ok(None);
        };
        let archive = archive_of(&base)
            .ok_or_else(|| AppError::ValidationFailed("The page is in no archive".to_owned()))?;

        let path = page.to_lowercase();
        let target = PatchTarget {
            project: Path::new(&project),
            path: &path,
            layer: &layer,
            archive: &archive,
        };
        let patched = patch_sprite(&target, &bytes, uv, Path::new(&source))?;
        if patched.is_some() {
            app_handle.state::<SandboxState>().invalidate(&project);
        }
        Ok(patched)
    })
    .await
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

/// The spec of the sheet `sheet` of the project `document` opens in, none where it has not made
/// that sheet.
///
/// # Errors
///
/// Fails when the document is closed or opens in no project, and when the spec cannot be read.
#[tauri::command]
#[specta::specta]
pub async fn atlas_sheet(
    document: BinDocumentId,
    sheet: String,
    app_handle: AppHandle,
) -> IpcResult<Option<SheetSpec>> {
    off_thread(move || {
        let project = project_of(&app_handle.state::<BinDocuments>(), document)?;
        read_sheet(Path::new(&project), &sheet)
    })
    .await
}

/// Write the sprite at `uv` on the page `texture` to `destination` as a PNG, at the page's own
/// resolution, for an image editor to open and the import to take back.
///
/// # Errors
///
/// Fails when the page cannot be read or decoded, when `uv` covers none of it, and when
/// `destination` cannot be written.
#[tauri::command]
#[specta::specta]
pub async fn atlas_export_sprite(
    texture: AssetRef,
    uv: [f32; 4],
    destination: String,
    app_handle: AppHandle,
) -> IpcResult<()> {
    off_thread(move || {
        let page = read_asset(&app_handle, &texture)?;
        let png = sprite_png(&page, uv)?;
        fs_err::write(&destination, png)?;
        tracing::info!(destination = %destination, "Exported a sprite");
        Ok(())
    })
    .await
}

fn project_of(documents: &BinDocuments, document: BinDocumentId) -> AppResult<String> {
    match documents.sandbox_of(document) {
        Some(SandboxRef::Project { project } | SandboxRef::Layer { project, .. }) => Ok(project),
        Some(SandboxRef::Game) => Err(AppError::ValidationFailed(
            "The document opens in no project".to_owned(),
        )),
        None => Err(not_open(document)),
    }
}

fn not_open(document: BinDocumentId) -> AppError {
    AppError::ValidationFailed(format!("Document {document} is not open"))
}

/// The archive folder a layer keeps an asset's archive under: a game chunk's archive file name,
/// or the first folder of a layer file's path.
fn archive_of(asset: &AssetRef) -> Option<String> {
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

/// The programs of the icon materials `entries`, one for one and in that order, and none where
/// nothing declares one.
///
/// A material is read out of the first of the open `documents` that declares it, which is how a
/// project's own material draws before its save, and otherwise out of the game chunk the object
/// index names for it. Names and assets resolve as the first document's do.
///
/// # Errors
///
/// Fails when the names or the project chunks the resolution reads are unavailable.
#[tauri::command]
#[specta::specta]
pub async fn read_ui_material_programs(
    documents: Vec<BinDocumentId>,
    entries: Vec<String>,
    app_handle: AppHandle,
) -> IpcResult<Vec<Option<MaterialProgram>>> {
    off_thread(move || {
        let hashes: Vec<BinHash> = entries
            .iter()
            .map(|entry| parse_hash(entry).unwrap_or_else(|| BinHash::hash_str(entry)))
            .collect();
        let translations = translations(&app_handle);
        let sandbox = documents
            .first()
            .and_then(|document| app_handle.state::<BinDocuments>().sandbox_of(*document))
            .unwrap_or(SandboxRef::Game);
        let game = ProjectGame::new(&app_handle, &sandbox);
        with_resolution(&app_handle, documents.first().copied(), |names, assets| {
            let mut read = |asset: &AssetRef| game.read(asset);
            let shaders = shader_defs(&app_handle, assets);
            let store = app_handle.state::<BinDocuments>();

            let mut program_of = |document: &BinDocument, hash: BinHash| {
                let resolution = Resolution {
                    document,
                    names,
                    assets,
                    shaders: shaders.as_deref(),
                };
                read_programs(
                    resolution,
                    &[hash],
                    ProgramOptions::default(),
                    &translations,
                    &mut read,
                )
                .pop()
                .flatten()
            };

            let mut parsed: Vec<BinDocument> = Vec::new();
            let mut programs = Vec::with_capacity(hashes.len());
            for &hash in &hashes {
                let open = documents
                    .iter()
                    .filter_map(|document| store.document(*document).ok())
                    .find(|document| document.object_at(hash).is_some());
                if let Some(open) = open {
                    programs.push(program_of(&open, hash));
                    continue;
                }

                if !parsed.iter().any(|each| each.object_at(hash).is_some()) {
                    if let Some(bytes) = game.declaring_chunk(hash)? {
                        parsed.push(BinDocument::parse(bytes)?);
                    }
                }
                let program = parsed
                    .iter()
                    .find(|each| each.object_at(hash).is_some())
                    .and_then(|document| program_of(document, hash));
                programs.push(program);
            }
            Ok(programs)
        })
    })
    .await
}

/// The programs of `shaders`, one for one and in that order, translated.
///
/// The shaders are the ones `document` resolves against, and the install's alone where it
/// is none. Translations are cached as `read_material_programs` caches them.
///
/// # Errors
///
/// Fails when the names or the project chunks the resolution reads are unavailable.
#[tauri::command]
#[specta::specta]
pub async fn read_ui_programs(
    document: Option<BinDocumentId>,
    shaders: Vec<UiShader>,
    app_handle: AppHandle,
) -> IpcResult<Vec<ProgramRead>> {
    off_thread(move || {
        let translations = translations(&app_handle);
        with_resolution(&app_handle, document, |_, assets| {
            let mut read = asset_reader(&app_handle);
            Ok(atlas::read_ui_programs(
                assets,
                &shaders,
                &translations,
                &mut read,
            ))
        })
    })
    .await
}
