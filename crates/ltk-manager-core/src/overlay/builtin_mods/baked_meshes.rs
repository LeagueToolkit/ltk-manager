//! Moving a map's baked decoration meshes under a visibility controller, per ADR-0053.

use crate::error::{AppError, AppResult};
use ltk_mapgeo::{EnvironmentAsset, EnvironmentMesh};
use std::io::Cursor;

/// `bytes`, a `.mapgeo`, with each mesh that has no controller and draws a material `is_moved`
/// accepts put under `controller`, and none when no mesh moves.
///
/// The scene graphs are baked again, since a mesh's faces belong to its controller's graph.
///
/// # Errors
///
/// Fails when `bytes` does not read as a `.mapgeo`, or the result cannot be baked or written.
pub(super) fn move_under(
    bytes: &[u8],
    controller: u32,
    is_moved: impl Fn(&str) -> bool,
) -> AppResult<Option<Vec<u8>>> {
    let mut asset = EnvironmentAsset::from_reader(&mut Cursor::new(bytes)).map_err(failed)?;
    let selection = asset.scene_graph_selection().map_err(failed)?;

    let mut moved = 0;
    for mesh in asset.meshes_mut() {
        if mesh.visibility_controller_path_hash() == 0 && draws(mesh, &is_moved) {
            mesh.set_visibility_controller_path_hash(controller);
            moved += 1;
        }
    }
    if moved == 0 {
        return Ok(None);
    }

    let graphs = asset.bake_scene_graphs(&selection).map_err(failed)?;
    asset.replace_scene_graphs(graphs);

    let mut written = Vec::with_capacity(bytes.len());
    asset.to_writer(&mut written).map_err(failed)?;
    Ok(Some(written))
}

/// Whether a submesh of `mesh` draws a material `is_moved` accepts.
fn draws(mesh: &EnvironmentMesh, is_moved: &impl Fn(&str) -> bool) -> bool {
    mesh.submeshes()
        .iter()
        .any(|submesh| is_moved(submesh.material()))
}

/// The file name of a material path, `HoL_TristanaStatue_A_MAT` of
/// `Maps/KitPieces/SRS/Base/Materials/Default/HoL_TristanaStatue_A_MAT`.
pub(super) fn material_name(material: &str) -> &str {
    material.rsplit('/').next().unwrap_or(material)
}

fn failed(error: impl std::fmt::Display) -> AppError {
    AppError::Other(format!("map geometry: {error}"))
}

#[cfg(test)]
mod tests;
