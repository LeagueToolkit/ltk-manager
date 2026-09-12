//! One mesh as the vertex buffer a viewport uploads.
//!
//! `.skn`, `.scb` and `.sco` read through `ltk_mesh`. `.tmesh` and `.gmesh` are named
//! rather than read, so an emitter on one says what is missing instead of drawing
//! nothing.
//!
//! Positions keep the engine's own space and units. The axis mirror is the viewport's,
//! in `src/modules/workshop/bin/vfx/world.ts`.
//!
//! # The buffer
//!
//! Little-endian throughout, with no padding between blocks.
//!
//! ```text
//! magic        u32   0x474B544C, `LTKG`
//! version      u32   2
//! flags        u32   bit 0 normals present, bit 1 uvs present, bit 2 skin present
//! vertexCount  u32
//! indexCount   u32
//! submeshCount u32
//! positions    f32 * vertexCount * 3
//! normals      f32 * vertexCount * 3   only under bit 0
//! uvs          f32 * vertexCount * 2   only under bit 1
//! skinIndices  u8  * vertexCount * 4   only under bit 2
//! skinWeights  f32 * vertexCount * 4   only under bit 2
//! indices      u32 * indexCount
//! submeshes    submeshCount * { nameLen u32, name utf8[nameLen], startIndex u32, indexCount u32 }
//! ```
//!
//! A skin index names a shader joint, which is a slot of the `.skl`'s influence table
//! rather than a joint.

use std::io::Cursor;

use glam::{Vec2, Vec3, Vec4};
use indexmap::IndexMap;
use ltk_file::LeagueFileKind;
use ltk_mesh::mem::vertex::ElementName;
use ltk_mesh::{SkinnedMesh, StaticMesh, StaticMeshFace};

use super::{PreviewError, count_of};

/// The word a geometry buffer opens with, `LTKG` in the order the buffer is written in.
const MAGIC: u32 = 0x474B_544C;

/// The layout this module writes.
const VERSION: u32 = 2;

/// The `flags` bit under which a normal block follows the positions.
const HAS_NORMALS: u32 = 1 << 0;

/// The `flags` bit under which a UV block follows the normals.
const HAS_UVS: u32 = 1 << 1;

/// The `flags` bit under which the skin's index and weight blocks follow the UVs.
const HAS_SKIN: u32 = 1 << 2;

/// Read a mesh into the buffer a viewport uploads.
///
/// The bytes name their own format, because a chunk read out of an archive has a path
/// hash for a name and no extension to go on.
///
/// # Errors
///
/// Fails with [`PreviewError::UnsupportedMesh`] for the two formats this build names but
/// does not read, with [`PreviewError::Unsupported`] for bytes that are no mesh at all,
/// with [`PreviewError::MeshRead`] where the file does not parse, and with
/// [`PreviewError::MeshOutOfBounds`] where a face names a vertex the file does not hold.
pub fn render(bytes: &[u8]) -> Result<Vec<u8>, PreviewError> {
    let geometry = match LeagueFileKind::identify_from_bytes(bytes) {
        LeagueFileKind::SimpleSkin => {
            Geometry::of_skinned(&SkinnedMesh::from_reader(&mut Cursor::new(bytes))?)?
        }
        LeagueFileKind::StaticMeshBinary => {
            Geometry::of_static(&StaticMesh::from_reader(&mut Cursor::new(bytes))?)?
        }
        LeagueFileKind::StaticMeshAscii => {
            Geometry::of_static(&StaticMesh::from_ascii(&mut Cursor::new(bytes))?)?
        }
        kind => {
            return Err(match unread_format(bytes) {
                Some(format) => PreviewError::UnsupportedMesh(format),
                None => PreviewError::Unsupported(kind),
            });
        }
    };

    geometry.encode()
}

/// The format `bytes` opens with, of the two this build names but does not read.
///
/// `GMSH` is attested and `TMSH` is a guess. Guessing wrong costs the caller a vaguer
/// message and nothing else.
fn unread_format(bytes: &[u8]) -> Option<&'static str> {
    match bytes.get(..4)? {
        b"GMSH" => Some(".gmesh"),
        b"TMSH" => Some(".tmesh"),
        _ => None,
    }
}

/// One mesh's geometry, in the blocks the buffer holds it in.
struct Geometry {
    /// Three per vertex.
    positions: Vec<f32>,
    /// Three per vertex, for a format that carries them.
    normals: Option<Vec<f32>>,
    /// Two per vertex, for a format that carries them.
    uvs: Option<Vec<f32>>,
    /// Each vertex's joint influences, for a format that carries them.
    skin: Option<Skin>,
    indices: Vec<u32>,
    submeshes: Vec<Submesh>,
}

/// Four joint influences per vertex, as a `.skn` stores them.
struct Skin {
    /// Four per vertex, each a shader joint of the skeleton.
    indices: Vec<u8>,
    /// Four per vertex.
    weights: Vec<f32>,
}

/// One drawable run of a mesh's indices.
struct Submesh {
    name: String,
    start_index: u32,
    index_count: u32,
}

impl Geometry {
    /// A `.skn`'s shared vertex buffer, and one submesh per range.
    ///
    /// The vertices are the bind pose the file stores, and the skin block is what a
    /// skeleton poses them by. Nothing here reads `.skl`.
    ///
    /// # Errors
    ///
    /// Fails with [`PreviewError::MeshOutOfBounds`] where a range names a vertex the
    /// buffer does not hold.
    fn of_skinned(mesh: &SkinnedMesh) -> Result<Self, PreviewError> {
        let vertices = mesh.vertex_buffer();
        let count = vertices.count();
        let position = vertices
            .accessor::<Vec3>(ElementName::Position)
            .expect("every .skn vertex layout carries positions");
        let normal = vertices.accessor::<Vec3>(ElementName::Normal);
        let uv = vertices.accessor::<Vec2>(ElementName::Texcoord0);
        let joints = vertices.accessor::<[u8; 4]>(ElementName::BlendIndex);
        let weights = vertices.accessor::<Vec4>(ElementName::BlendWeight);

        let mut indices = Vec::with_capacity(mesh.index_buffer().count());
        let mut submeshes = Vec::with_capacity(mesh.ranges().len());
        for range in mesh.ranges() {
            let start_index = count_of(indices.len())?;
            /* Absolute rather than the file's normalized indices, because one flat
            index block addresses one flat vertex list. A range carries its own
            `start_vertex`, so an index inside the buffer can still name a vertex outside
            it once it is made absolute. */
            for index in mesh.range_indices(range) {
                if index as usize >= count {
                    return Err(PreviewError::MeshOutOfBounds);
                }
                indices.push(index);
            }
            submeshes.push(Submesh {
                name: range.material.clone(),
                start_index,
                index_count: count_of(indices.len())? - start_index,
            });
        }

        Ok(Self {
            positions: (0..count)
                .flat_map(|v| position.get(v).to_array())
                .collect(),
            normals: normal.map(|block| (0..count).flat_map(|v| block.get(v).to_array()).collect()),
            uvs: uv.map(|block| (0..count).flat_map(|v| block.get(v).to_array()).collect()),
            skin: joints.zip(weights).map(|(joints, weights)| Skin {
                indices: (0..count).flat_map(|v| joints.get(v)).collect(),
                weights: (0..count).flat_map(|v| weights.get(v).to_array()).collect(),
            }),
            indices,
            submeshes,
        })
    }

    /// A `.scb` or `.sco`, one vertex per face corner and one submesh per material.
    ///
    /// A static mesh keys its UVs and its material per face corner rather than per
    /// vertex, so the shared vertex list can carry neither. Grouping the corners by
    /// material is what leaves a submesh one contiguous run.
    ///
    /// Neither format carries a normal.
    fn of_static(mesh: &StaticMesh) -> Result<Self, PreviewError> {
        let mut by_material: IndexMap<&str, Vec<&StaticMeshFace>> = IndexMap::new();
        for face in mesh.faces() {
            by_material
                .entry(face.material.as_str())
                .or_default()
                .push(face);
        }

        let corners = mesh.faces().len() * 3;
        let mut positions = Vec::with_capacity(corners * 3);
        let mut uvs = Vec::with_capacity(corners * 2);
        let mut submeshes = Vec::with_capacity(by_material.len());

        for (material, faces) in by_material {
            let start_index = count_of(positions.len() / 3)?;
            for face in faces {
                for corner in 0..3 {
                    let vertex = mesh
                        .vertices()
                        .get(face.indices[corner] as usize)
                        .ok_or(PreviewError::MeshOutOfBounds)?;
                    positions.extend(vertex.to_array());
                    uvs.extend(face.uvs[corner].to_array());
                }
            }
            submeshes.push(Submesh {
                name: material.to_owned(),
                start_index,
                index_count: count_of(positions.len() / 3)? - start_index,
            });
        }

        Ok(Self {
            indices: (0..count_of(positions.len() / 3)?).collect(),
            positions,
            normals: None,
            uvs: Some(uvs),
            skin: None,
            submeshes,
        })
    }

    /// The geometry as the buffer this module documents.
    fn encode(&self) -> Result<Vec<u8>, PreviewError> {
        let mut flags = 0;
        if self.normals.is_some() {
            flags |= HAS_NORMALS;
        }
        if self.uvs.is_some() {
            flags |= HAS_UVS;
        }
        if self.skin.is_some() {
            flags |= HAS_SKIN;
        }

        let header = [
            MAGIC,
            VERSION,
            flags,
            count_of(self.positions.len() / 3)?,
            count_of(self.indices.len())?,
            count_of(self.submeshes.len())?,
        ];
        let blocks = [
            Some(&self.positions),
            self.normals.as_ref(),
            self.uvs.as_ref(),
        ];

        let floats: usize = blocks.iter().flatten().map(|block| block.len()).sum();
        let skin = self
            .skin
            .as_ref()
            .map_or(0, |skin| skin.indices.len() + 4 * skin.weights.len());
        let mut buffer =
            Vec::with_capacity(4 * (header.len() + floats + self.indices.len()) + skin);

        for word in header {
            buffer.extend(word.to_le_bytes());
        }
        for block in blocks.into_iter().flatten() {
            for value in block {
                buffer.extend(value.to_le_bytes());
            }
        }
        if let Some(skin) = &self.skin {
            buffer.extend(&skin.indices);
            for weight in &skin.weights {
                buffer.extend(weight.to_le_bytes());
            }
        }
        for index in &self.indices {
            buffer.extend(index.to_le_bytes());
        }
        for submesh in &self.submeshes {
            buffer.extend(count_of(submesh.name.len())?.to_le_bytes());
            buffer.extend(submesh.name.as_bytes());
            buffer.extend(submesh.start_index.to_le_bytes());
            buffer.extend(submesh.index_count.to_le_bytes());
        }

        Ok(buffer)
    }
}

#[cfg(test)]
mod tests;
