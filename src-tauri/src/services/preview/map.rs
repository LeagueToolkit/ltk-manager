//! The map backdrop's reads: one map's materials, placed against a project first, and
//! the particles its open `.materials.bin` stands.

use crate::services::shared::document_assets::{
    parse_entry, read_resolved, with_assets_in, with_resolution,
};
use crate::services::shared::read_bin;
use std::collections::HashMap;

use super::material::shader_defs;
use crate::error::IpcResult;
use crate::services::shared::off_thread;
use ltk_manager_core::bin_document::{BinDocumentId, BinDocuments};
use ltk_manager_core::preview::AssetRef;
use ltk_manager_core::sandbox::SandboxRef;
use ltk_manager_game::map::{
    map_characters, map_outline, map_particles, map_variants, resolve_map, unresolved_map,
    MapCharacter, MapChunk, MapFiles, MapModel, MapParticle, MapPath, MapVariant,
};
use tauri::{AppHandle, Manager};

/// The materials a map's submeshes name, and its lighting and screen effects.
///
/// `map` is `MapContainer.mapPath`, an entry path such as
/// `Maps/MapGeometry/Map11/Base_SRX`, and `materials` are the entry paths the map's own
/// `LTKM` buffer carries, answered one for one and in that order. `document` names any
/// open document of the project whose layer answers first, and none resolves against the
/// install alone.
///
/// A map nothing holds a `.materials.bin` for leaves every material unresolved rather
/// than failing the read, which draws the map flat. One whose file is there but will not
/// read is reported, because the caller keeps this answer for the app's life and a flat
/// map cached over a momentary failure is a map that never draws again.
#[tauri::command]
#[specta::specta]
pub async fn read_map(
    document: Option<BinDocumentId>,
    map: MapPath,
    materials: Vec<String>,
    app_handle: AppHandle,
) -> IpcResult<MapModel> {
    off_thread(move || {
        with_resolution(&app_handle, document, |names, assets| {
            let read = |asset: &AssetRef| read_bin(&app_handle, asset);
            let Some(source) = assets.locate(&map.materials()) else {
                return Ok(unresolved_map(&materials));
            };
            let bin = read(&source)?;
            /* The shader defs only decide which slot a texture came from, so a map draws
            without them. */
            let shaders = shader_defs(&app_handle, assets);
            Ok(resolve_map(
                &bin,
                &map,
                &materials,
                names,
                assets,
                shaders.as_deref(),
            ))
        })
    })
    .await
}

/// Every particle the open `.materials.bin` under `document` stands in its map.
///
/// The systems they link are objects of the same document, so `read_vfx_system` answers
/// each against the handle this was asked with.
#[tauri::command]
#[specta::specta]
pub async fn read_map_particles(
    document: BinDocumentId,
    app_handle: AppHandle,
) -> IpcResult<Vec<MapParticle>> {
    off_thread(move || {
        let open = app_handle.state::<BinDocuments>().document(document)?;
        Ok(map_particles(&open))
    })
    .await
}

/// Every character the open `.materials.bin` under `document` stands in its map.
///
/// Each names its skin by entry path, which lives in the character's own skin bin rather
/// than in this document.
#[tauri::command]
#[specta::specta]
pub async fn read_map_characters(
    document: BinDocumentId,
    app_handle: AppHandle,
) -> IpcResult<Vec<MapCharacter>> {
    off_thread(move || {
        let open = app_handle.state::<BinDocuments>().document(document)?;
        Ok(map_characters(&open))
    })
    .await
}

/// The maps the `Map`, `MapSkin` or `MapContainer` at `entry` draws.
///
/// Empty for a skin that links no container and for an object of any other class.
#[tauri::command]
#[specta::specta]
pub async fn read_map_variants(
    document: BinDocumentId,
    entry: String,
    app_handle: AppHandle,
) -> IpcResult<Vec<MapVariant>> {
    off_thread(move || {
        let entry = parse_entry(&entry)?;
        let open = app_handle.state::<BinDocuments>().document(document)?;
        Ok(map_variants(&open, entry))
    })
    .await
}

/// Every chunk the open `.materials.bin` under `document` declares, and what each holds.
#[tauri::command]
#[specta::specta]
pub async fn read_map_outline(
    document: BinDocumentId,
    app_handle: AppHandle,
) -> IpcResult<Vec<MapChunk>> {
    off_thread(move || {
        read_resolved(&app_handle, document, |open, names, _| {
            Ok(map_outline(open, names))
        })
    })
    .await
}

/// Where the two files of `map` live in `sandbox`, its layers checked before the install.
///
/// So a mod that ships its own geometry draws it, and one that ships only materials draws
/// the install's geometry under them.
#[tauri::command]
#[specta::specta]
pub async fn locate_map_files(
    sandbox: SandboxRef,
    map: MapPath,
    app_handle: AppHandle,
) -> IpcResult<MapFiles> {
    off_thread(move || {
        with_assets_in(&app_handle, &sandbox, |assets| MapFiles {
            geometry: assets.locate(&map.geometry()),
            materials: assets.locate(&map.materials()),
        })
    })
    .await
}

/// Where each of `paths` lives in `sandbox`, its layers checked before the install.
///
/// One call for every file a scene is about to open. A path nothing holds is absent.
#[tauri::command]
#[specta::specta]
pub async fn locate_files_near(
    sandbox: SandboxRef,
    paths: Vec<String>,
    app_handle: AppHandle,
) -> IpcResult<HashMap<String, AssetRef>> {
    off_thread(move || {
        with_assets_in(&app_handle, &sandbox, |assets| {
            paths
                .into_iter()
                .filter_map(|path| {
                    let asset = assets.locate(&path)?;
                    Some((path, asset))
                })
                .collect()
        })
    })
    .await
}
