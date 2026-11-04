//! The map editor's open `.mapgeo` files: their meshes, edits, undo and save. "Meshes" and
//! "Saving geometry" in docs/ux/MAP_EDITOR.md.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use fs_err as fs;
use ltk_hash::{BinHash, Hash as _};
use ltk_manager_assets::game_wads::WadCache;
use ltk_manager_assets::map_export::{write_glb, ExportMesh, ExportTexture};
use ltk_manager_assets::map_geometry::{
    MapGeometryDocument, MapGeometryEdit, MapGeometryMesh, MeshDelta,
};
use ltk_manager_assets::map_import::{read_model, reimport_source, ModelSummary, ReimportTarget};
use ltk_manager_assets::preview::{AssetRef, Preview, PreviewRequest};
use ltk_manager_base::utils::fs::atomic_write;
use ltk_manager_bin::bin_document::{BinDocumentId, BinDocuments};
use ltk_manager_bin::sandbox::SandboxState;
use ltk_manager_game::map::MapPath;
use ltk_manager_game::material::resolve_material;
use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Manager};

use super::material::shader_defs;
use crate::error::{AppError, AppResult, IpcResult};
use crate::services::shared::document_assets::with_resolution;
use crate::services::shared::{archive_of, off_thread, read_bin, WriteTarget};
use crate::state::SettingsState;

/// The id of an open `.mapgeo`. Ids are never reused.
pub type MapGeometryId = u32;

/// One open `.mapgeo` and the asset it was read from.
struct OpenGeometry {
    document: MapGeometryDocument,
    asset: AssetRef,
}

/// Every open `.mapgeo`, by id.
#[derive(Default)]
pub struct MapGeometryDocuments {
    open: Mutex<HashMap<MapGeometryId, Arc<Mutex<OpenGeometry>>>>,
    next: AtomicU32,
}

impl MapGeometryDocuments {
    fn get(&self, id: MapGeometryId) -> AppResult<Arc<Mutex<OpenGeometry>>> {
        self.open
            .lock()
            .get(&id)
            .cloned()
            .ok_or_else(|| AppError::ValidationFailed(format!("No map geometry is open as {id}")))
    }

    /// Encodes the open `.mapgeo` under `id` as the buffer a viewport draws.
    ///
    /// # Errors
    ///
    /// Fails if no `.mapgeo` is open under `id` or the buffer cannot be built.
    pub fn preview(&self, id: MapGeometryId) -> AppResult<Vec<u8>> {
        Ok(self.get(id)?.lock().document.preview()?)
    }

    /// Runs `read` over the open `.mapgeo` under `id` while its lock is held.
    ///
    /// # Errors
    ///
    /// Fails if no `.mapgeo` is open under `id`.
    pub fn read<T>(
        &self,
        id: MapGeometryId,
        read: impl FnOnce(&MapGeometryDocument) -> T,
    ) -> AppResult<T> {
        Ok(read(&self.get(id)?.lock().document))
    }

    /// Encodes the meshes at `meshes` of the open `.mapgeo` under `id`, in that order.
    ///
    /// # Errors
    ///
    /// Fails if no `.mapgeo` is open under `id` or the buffer cannot be built.
    pub fn preview_meshes(&self, id: MapGeometryId, meshes: &[usize]) -> AppResult<Vec<u8>> {
        Ok(self.get(id)?.lock().document.preview_meshes(meshes)?)
    }
}

/// Where an open `.mapgeo` stands after a change.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MapGeometryState {
    pub id: MapGeometryId,
    /// Counts every change.
    pub revision: u64,
    /// The document holds changes that no save wrote.
    pub dirty: bool,
}

/// An open `.mapgeo` after a change, and what the change did to the meshes a viewport draws.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MapGeometryChange {
    pub state: MapGeometryState,
    pub deltas: Vec<MeshDelta>,
}

fn state_of(id: MapGeometryId, open: &OpenGeometry) -> MapGeometryState {
    MapGeometryState {
        id,
        revision: open.document.revision(),
        dirty: open.document.is_dirty(),
    }
}

/// Opens `asset` as a `.mapgeo` that takes edits.
#[tauri::command]
#[specta::specta]
pub async fn map_geometry_open(
    asset: AssetRef,
    app_handle: AppHandle,
) -> IpcResult<MapGeometryState> {
    off_thread(move || {
        let config = app_handle.state::<SettingsState>().config();
        let bytes = asset.read(&config, &app_handle.state::<WadCache>())?;
        let document = MapGeometryDocument::parse(&bytes)?;

        let documents = app_handle.state::<MapGeometryDocuments>();
        let id = documents.next.fetch_add(1, Ordering::Relaxed);
        let open = OpenGeometry { document, asset };
        let state = state_of(id, &open);
        documents.open.lock().insert(id, Arc::new(Mutex::new(open)));
        Ok(state)
    })
    .await
}

/// Closes the `.mapgeo` open under `id`, dropping its unsaved changes.
#[tauri::command]
#[specta::specta]
pub async fn map_geometry_close(id: MapGeometryId, app_handle: AppHandle) -> IpcResult<()> {
    app_handle
        .state::<MapGeometryDocuments>()
        .open
        .lock()
        .remove(&id);
    IpcResult::ok(())
}

/// Every mesh of the `.mapgeo` open under `id`, in file order.
#[tauri::command]
#[specta::specta]
pub async fn map_geometry_meshes(
    id: MapGeometryId,
    app_handle: AppHandle,
) -> IpcResult<Vec<MapGeometryMesh>> {
    off_thread(move || {
        let open = app_handle.state::<MapGeometryDocuments>().get(id)?;
        let meshes = open.lock().document.meshes();
        Ok(meshes)
    })
    .await
}

/// Applies `edit` to the `.mapgeo` open under `id` as one undo step.
#[tauri::command]
#[specta::specta]
pub async fn map_geometry_edit(
    id: MapGeometryId,
    edit: MapGeometryEdit,
    app_handle: AppHandle,
) -> IpcResult<MapGeometryChange> {
    off_thread(move || {
        let open = app_handle.state::<MapGeometryDocuments>().get(id)?;
        let mut open = open.lock();
        let deltas = open.document.edit(edit)?;
        Ok(MapGeometryChange {
            state: state_of(id, &open),
            deltas,
        })
    })
    .await
}

/// Reverts the last edit of the `.mapgeo` open under `id`, or redoes the last undone one.
///
/// Returns `None` if the history holds no step to take.
#[tauri::command]
#[specta::specta]
pub async fn map_geometry_step(
    id: MapGeometryId,
    undo: bool,
    app_handle: AppHandle,
) -> IpcResult<Option<MapGeometryChange>> {
    off_thread(move || {
        let open = app_handle.state::<MapGeometryDocuments>().get(id)?;
        let mut open = open.lock();
        let stepped = if undo {
            open.document.undo()?
        } else {
            open.document.redo()?
        };
        Ok(stepped.map(|deltas| MapGeometryChange {
            state: state_of(id, &open),
            deltas,
        }))
    })
    .await
}

/// Writes the `.mapgeo` open under `id` and returns the layer file it now reads from.
///
/// A layer file is written in place. A game file is written to `path` in the archive folder
/// of the layer that the open bin `materials` writes to, which is where the map's other edits
/// land. The write goes through a temporary file.
///
/// # Errors
///
/// Fails if the layer file changed on disk since it was read, if the game file has no
/// project layer to land in, or if the bake or the write fails.
#[tauri::command]
#[specta::specta]
pub async fn map_geometry_save(
    id: MapGeometryId,
    materials: BinDocumentId,
    path: String,
    app_handle: AppHandle,
) -> IpcResult<AssetRef> {
    off_thread(move || {
        let open = app_handle.state::<MapGeometryDocuments>().get(id)?;
        let mut open = open.lock();

        let (target, saved, project) = match &open.asset {
            AssetRef::Layer { project, .. } => {
                let target = open
                    .asset
                    .layer_file()
                    .expect("a layer asset names a layer file")?;
                let on_disk = fs::read(&target)?;
                if !open.document.is_base(&on_disk) {
                    return Err(AppError::ValidationFailed(format!(
                        "{} changed on disk since it was opened. Reopen the map to edit it.",
                        target.display()
                    )));
                }
                (target, open.asset.clone(), project.clone())
            }
            game => {
                let write = WriteTarget::of(&app_handle.state::<BinDocuments>(), materials)?;
                let archive = archive_of(game).ok_or_else(|| {
                    AppError::ValidationFailed("The map geometry is in no archive".to_owned())
                })?;
                let relative = format!("{archive}/{}", path.to_lowercase());
                let saved = AssetRef::Layer {
                    project: write.project.clone(),
                    layer: write.layer.clone(),
                    path: relative,
                };
                let target = saved
                    .layer_file()
                    .expect("a layer asset names a layer file")?;
                (target, saved, write.project)
            }
        };

        let bytes = open.document.to_bytes()?;
        write_file(&target, &bytes)?;
        open.document.saved_as(&bytes);
        open.asset = saved.clone();

        app_handle.state::<SandboxState>().invalidate(&project);
        Ok(saved)
    })
    .await
}

/// The summary of a model file and the index of the mesh that replaces a map mesh in a reimport.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ReimportInspection {
    pub summary: ModelSummary,
    /// The index of the matching mesh. `None` if no mesh matches and the user picks one.
    pub source: Option<u32>,
}

/// Reads the model file at `path` and matches its meshes against the mesh at `mesh` of the
/// `.mapgeo` open under `id`, whose container is `container`.
#[tauri::command]
#[specta::specta]
pub async fn map_geometry_reimport_inspect(
    id: MapGeometryId,
    mesh: u32,
    container: String,
    path: String,
    app_handle: AppHandle,
) -> IpcResult<ReimportInspection> {
    off_thread(move || {
        let summary = read_model(Path::new(&path))?.summary();
        let open = app_handle.state::<MapGeometryDocuments>().get(id)?;
        let (name, vertices) = open.lock().document.identity(mesh)?;

        let target = ReimportTarget {
            index: mesh,
            name: &name,
            container: &container,
            vertices,
        };
        let source = reimport_source(&summary.meshes, target);
        Ok(ReimportInspection { summary, source })
    })
    .await
}

/// Writes the meshes at `meshes` of the `.mapgeo` open under `id` to `path` as a binary glTF
/// file. Writes every mesh if `meshes` is `None`.
///
/// Resolves the materials through the `.materials.bin` of `map` in the project of `document`.
/// Writes a material without a texture if its base texture fails to read.
#[tauri::command]
#[specta::specta]
pub async fn map_geometry_export(
    id: MapGeometryId,
    meshes: Option<Vec<u32>>,
    document: Option<BinDocumentId>,
    map: MapPath,
    path: String,
    app_handle: AppHandle,
) -> IpcResult<()> {
    off_thread(move || {
        let open = app_handle.state::<MapGeometryDocuments>().get(id)?;
        let indices: Option<Vec<usize>> =
            meshes.map(|meshes| meshes.into_iter().map(|mesh| mesh as usize).collect());
        let exported = open.lock().document.export(indices.as_deref())?;

        let textures = export_textures(&app_handle, document, &map, &exported)?;
        let bytes = write_glb(&exported, map.as_str(), &textures)?;
        write_file(Path::new(&path), &bytes)
    })
    .await
}

/// Reads the base color texture of each material that `meshes` draw with, as an image file.
fn export_textures(
    app_handle: &AppHandle,
    document: Option<BinDocumentId>,
    map: &MapPath,
    meshes: &[ExportMesh],
) -> AppResult<HashMap<String, ExportTexture>> {
    let paths: HashSet<&str> = meshes
        .iter()
        .flat_map(|mesh| &mesh.parts)
        .map(|part| part.material.as_str())
        .collect();
    let config = app_handle.state::<SettingsState>().config();
    let wads = app_handle.state::<WadCache>();

    with_resolution(app_handle, document, |names, assets| {
        let Some(source) = assets.locate(&map.materials()) else {
            return Ok(HashMap::new());
        };
        let bin = read_bin(app_handle, &source)?;
        let shaders = shader_defs(app_handle, assets);

        let mut textures = HashMap::new();
        for path in paths {
            let preview = resolve_material(
                &bin,
                BinHash::hash_str(path),
                names,
                assets,
                shaders.as_deref(),
            );
            let asset = preview
                .ok()
                .and_then(|preview| preview.base)
                .and_then(|base| base.texture.asset);
            let image = asset.and_then(|asset| {
                asset
                    .preview(PreviewRequest::Image { min_width: None }, &config, &wads)
                    .ok()
            });
            if let Some(Preview::Image(image)) = image {
                textures.insert(
                    path.to_owned(),
                    ExportTexture {
                        bytes: image.bytes,
                        mime: image.mime.to_owned(),
                    },
                );
            }
        }
        Ok(textures)
    })
}

fn write_file(target: &Path, bytes: &[u8]) -> AppResult<()> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    atomic_write(target, bytes)?;
    Ok(())
}
