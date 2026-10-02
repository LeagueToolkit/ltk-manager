//! The programs Atlas draws with: an icon material's, and the client's UI and font pairs.

use atlas::UiShader;
use ltk_hash::{BinHash, Hash as _};
use ltk_manager_core::bin_document::GameCopy as _;
use ltk_manager_core::bin_document::{BinDocument, BinDocumentId, BinDocuments};
use ltk_manager_core::object_index::parse_hash;
use ltk_manager_core::preview::AssetRef;
use ltk_manager_core::sandbox::SandboxRef;
use ltk_manager_game::program::{
    read_programs, MaterialProgram, ProgramOptions, ProgramRead, Resolution,
};
use tauri::{AppHandle, Manager};

use crate::error::IpcResult;
use crate::services::preview::material::{shader_defs, translations};
use crate::services::shared::document_assets::with_resolution;
use crate::services::shared::installed::ProjectGame;
use crate::services::shared::{asset_reader, off_thread};

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
