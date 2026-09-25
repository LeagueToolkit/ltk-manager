//! Which mesh faces feed the scene graphs.
//!
//! Every face in a shipped grid is a face of a mesh with the grid's
//! [`SceneGraphKey`], with the same positions in the same vertex order. The
//! baker does not store which faces it picked, and the rule it used cannot be
//! fully recovered from the file. [`EnvironmentAsset::scene_graph_selection`]
//! reads the choice back from the grids instead, so that
//! [`EnvironmentAsset::bake_scene_graphs`] reproduces them exactly.

use std::collections::HashMap;

use glam::{Mat4, Vec3};
use ltk_mesh::mem::vertex::ElementName;

use crate::{BucketedGeometry, EnvironmentAsset};

use super::{BakeFace, BuildError, EdgeRounding, GridLayout, SceneGraphKey};

/// Grid size of the main scene graph in every shipped map.
pub const MAIN_BUCKETS_PER_SIDE: u16 = 128;

/// Grid size of every shipped visibility controller scene graph.
pub const VISIBILITY_CONTROLLER_BUCKETS_PER_SIDE: u16 = 32;

/// Grid size used for a region scene graph with no recorded size.
///
/// Shipped region grids use 4 to 33 buckets per side, and no rule that picks
/// the size is known. This value is a convention, not a measurement.
pub const REGION_BUCKETS_PER_SIDE: u16 = 16;

/// The faces of one mesh that feed its scene graph, one flag per triangle in
/// index buffer order.
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash)]
pub struct FaceMask(Vec<bool>);

impl FaceMask {
    /// A mask of `len` faces, all selected.
    pub fn all(len: usize) -> Self {
        Self(vec![true; len])
    }

    /// A mask of `len` faces, none selected.
    pub fn none(len: usize) -> Self {
        Self(vec![false; len])
    }

    /// Number of faces the mask covers.
    #[inline]
    pub fn len(&self) -> usize {
        self.0.len()
    }

    /// Whether the mask covers no faces.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// Whether face `face` is selected, or `None` past the end.
    #[inline]
    pub fn get(&self, face: usize) -> Option<bool> {
        self.0.get(face).copied()
    }

    /// Selects or deselects face `face`.
    ///
    /// # Panics
    ///
    /// If `face` is not less than [`len`](Self::len).
    #[inline]
    pub fn set(&mut self, face: usize, selected: bool) {
        self.0[face] = selected;
    }

    /// Number of selected faces.
    pub fn count(&self) -> usize {
        self.0.iter().filter(|&&s| s).count()
    }

    /// Iterates over the per-face flags.
    pub fn iter(&self) -> impl Iterator<Item = bool> + '_ {
        self.0.iter().copied()
    }
}

impl FromIterator<bool> for FaceMask {
    fn from_iter<I: IntoIterator<Item = bool>>(iter: I) -> Self {
        Self(iter.into_iter().collect())
    }
}

/// The faces that feed the scene graphs of an asset, and the grid layout of
/// each scene graph.
///
/// Holds one [`FaceMask`] per mesh, in the asset's mesh order. Keep it in
/// step when meshes are added or removed.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SceneGraphSelection {
    meshes: Vec<FaceMask>,
    layouts: HashMap<SceneGraphKey, GridLayout>,
}

impl SceneGraphSelection {
    /// An empty selection with no meshes and no recorded layouts.
    pub fn new() -> Self {
        Self::default()
    }

    /// The masks, one per mesh.
    #[inline]
    pub fn meshes(&self) -> &[FaceMask] {
        &self.meshes
    }

    /// The mask of mesh `mesh`.
    #[inline]
    pub fn mesh(&self, mesh: usize) -> Option<&FaceMask> {
        self.meshes.get(mesh)
    }

    /// The mask of mesh `mesh`, to edit.
    #[inline]
    pub fn mesh_mut(&mut self, mesh: usize) -> Option<&mut FaceMask> {
        self.meshes.get_mut(mesh)
    }

    /// Appends the mask of a mesh added at the end of the asset.
    pub fn push_mesh(&mut self, mask: FaceMask) {
        self.meshes.push(mask);
    }

    /// Inserts the mask of a mesh inserted at `mesh`.
    ///
    /// # Panics
    ///
    /// If `mesh` is greater than the number of masks.
    pub fn insert_mesh(&mut self, mesh: usize, mask: FaceMask) {
        self.meshes.insert(mesh, mask);
    }

    /// Removes the mask of mesh `mesh`.
    ///
    /// # Panics
    ///
    /// If `mesh` is out of bounds.
    pub fn remove_mesh(&mut self, mesh: usize) -> FaceMask {
        self.meshes.remove(mesh)
    }

    /// The grid layout of scene graph `key`.
    ///
    /// Returns the recorded layout, or else a layout of
    /// [`MAIN_BUCKETS_PER_SIDE`], [`VISIBILITY_CONTROLLER_BUCKETS_PER_SIDE`] or
    /// [`REGION_BUCKETS_PER_SIDE`] by the kind of key.
    pub fn layout(&self, key: SceneGraphKey) -> GridLayout {
        if let Some(&layout) = self.layouts.get(&key) {
            layout
        } else if key.region_path_hash() != 0 {
            GridLayout::new(REGION_BUCKETS_PER_SIDE)
        } else if key.visibility_controller_path_hash() != 0 {
            GridLayout::new(VISIBILITY_CONTROLLER_BUCKETS_PER_SIDE)
        } else {
            GridLayout::new(MAIN_BUCKETS_PER_SIDE)
        }
    }

    /// Records the grid layout of scene graph `key`.
    pub fn set_layout(&mut self, key: SceneGraphKey, layout: GridLayout) {
        self.layouts.insert(key, layout);
    }
}

/// Bit pattern of a face, for exact matching.
type FaceBits = [[u32; 3]; 3];

fn face_bits(face: &[Vec3; 3]) -> FaceBits {
    face.map(|p| [p.x.to_bits(), p.y.to_bits(), p.z.to_bits()])
}

/// Faces of a scene graph, as stored, bucket by bucket.
fn graph_faces(graph: &BucketedGeometry) -> Result<Vec<Vec<[Vec3; 3]>>, BuildError> {
    let (vertices, indices) = (graph.vertices(), graph.indices());
    let corrupt = || BuildError::CorruptSceneGraph(SceneGraphKey::of_graph(graph));
    graph
        .buckets()
        .iter()
        .map(|bucket| {
            let base = bucket.base_vertex() as usize;
            let start = bucket.start_index() as usize;
            (0..bucket.total_face_count() as usize)
                .map(|face| {
                    let mut out = [Vec3::ZERO; 3];
                    for (j, p) in out.iter_mut().enumerate() {
                        let index = *indices.get(start + face * 3 + j).ok_or_else(corrupt)?;
                        *p = *vertices.get(base + index as usize).ok_or_else(corrupt)?;
                    }
                    Ok(out)
                })
                .collect()
        })
        .collect()
}

/// The edge rounding that reproduces the stored stick-out of every bucket.
fn edge_rounding(graph: &BucketedGeometry, faces: &[Vec<[Vec3; 3]>]) -> EdgeRounding {
    let n = graph.buckets_per_side() as usize;
    let (min, size) = (graph.min_bounds(), graph.bucket_size());
    let fits = |edge: EdgeRounding| {
        graph
            .buckets()
            .iter()
            .zip(faces)
            .enumerate()
            .all(|(i, (bucket, faces))| {
                let hi_x = edge.upper_edge(min.x, i % n, size.x);
                let hi_z = edge.upper_edge(min.y, i / n, size.y);
                let (mut x, mut z) = (0f32, 0f32);
                for p in faces.iter().flatten() {
                    x = x.max(p.x - hi_x);
                    z = z.max(p.z - hi_z);
                }
                x.to_bits() == bucket.max_stick_out_x().to_bits()
                    && z.to_bits() == bucket.max_stick_out_z().to_bits()
            })
    };
    if !fits(EdgeRounding::PerOperation) && fits(EdgeRounding::FusedMultiplyAdd) {
        EdgeRounding::FusedMultiplyAdd
    } else {
        EdgeRounding::PerOperation
    }
}

impl EnvironmentAsset {
    /// The faces of mesh `mesh`, in index buffer order, with untransformed positions.
    ///
    /// # Errors
    ///
    /// [`BuildError::MissingBuffer`], [`BuildError::MissingPositions`] or
    /// [`BuildError::IndexOutOfBounds`] if the mesh's buffers do not hold
    /// its faces.
    ///
    /// # Panics
    ///
    /// If `mesh` is out of bounds.
    pub fn mesh_faces(&self, mesh: usize) -> Result<Vec<[Vec3; 3]>, BuildError> {
        let m = &self.meshes()[mesh];
        let positions = m
            .vertex_buffer_ids()
            .iter()
            .map(|&id| {
                self.vertex_buffer(id)
                    .ok_or(BuildError::MissingBuffer { mesh })
            })
            .find_map(|vb| match vb {
                Ok(vb) => vb.accessor::<Vec3>(ElementName::Position).map(Ok),
                Err(e) => Some(Err(e)),
            })
            .ok_or(BuildError::MissingPositions { mesh })??;
        let indices = self
            .index_buffer(m.index_buffer_id())
            .ok_or(BuildError::MissingBuffer { mesh })?;

        let vertex_count = positions.len();
        let index_count = (m.index_count() as usize).min(indices.count());
        (0..index_count / 3)
            .map(|face| {
                let mut out = [Vec3::ZERO; 3];
                for (j, p) in out.iter_mut().enumerate() {
                    let index = indices.get(face * 3 + j) as usize;
                    if index >= vertex_count {
                        return Err(BuildError::IndexOutOfBounds {
                            mesh,
                            index: index as u32,
                            vertex_count,
                        });
                    }
                    *p = positions.get(index);
                }
                Ok(out)
            })
            .collect()
    }

    /// Reads back which faces feed the scene graphs this asset was read with.
    ///
    /// A face is selected when its scene graph holds a face with the same
    /// positions in the same order. When several faces match one stored
    /// face, the first in source order is selected, as the baker keeps
    /// every copy it is given. The [`GridLayout`] is recorded for every scene
    /// graph that has faces.
    ///
    /// For an unedited asset, [`bake_scene_graphs`](Self::bake_scene_graphs)
    /// with this selection gives back [`scene_graphs`](Self::scene_graphs).
    ///
    /// # Errors
    ///
    /// - [`BuildError::DuplicateSceneGraph`] if two scene graphs share a key.
    /// - [`BuildError::CorruptSceneGraph`] if a scene graph's buckets refer
    ///   past its vertices or indices.
    /// - [`BuildError::UnmatchedFaces`] if a scene graph holds faces that no
    ///   mesh with its key has.
    /// - The errors of [`mesh_faces`](Self::mesh_faces).
    pub fn scene_graph_selection(&self) -> Result<SceneGraphSelection, BuildError> {
        let mut selection = SceneGraphSelection::new();
        let mut wanted: HashMap<SceneGraphKey, HashMap<FaceBits, usize>> = HashMap::new();

        for graph in self.scene_graphs() {
            let key = SceneGraphKey::of_graph(graph);
            let stored = graph_faces(graph)?;
            let mut faces = HashMap::new();
            for face in stored.iter().flatten() {
                *faces.entry(face_bits(face)).or_insert(0) += 1;
            }
            if !faces.is_empty() {
                let layout = GridLayout::new(graph.buckets_per_side())
                    .with_edge_rounding(edge_rounding(graph, &stored));
                selection.set_layout(key, layout);
            }
            if wanted.insert(key, faces).is_some() {
                return Err(BuildError::DuplicateSceneGraph(key));
            }
        }

        for (index, mesh) in self.meshes().iter().enumerate() {
            let faces = self.mesh_faces(index)?;
            let mask = match wanted.get_mut(&SceneGraphKey::of_mesh(mesh)) {
                Some(counts) if !counts.is_empty() => faces
                    .iter()
                    .map(|face| match counts.get_mut(&face_bits(face)) {
                        Some(count) if *count > 0 => {
                            *count -= 1;
                            true
                        }
                        _ => false,
                    })
                    .collect(),
                _ => FaceMask::none(faces.len()),
            };
            selection.push_mesh(mask);
        }

        for graph in self.scene_graphs() {
            let key = SceneGraphKey::of_graph(graph);
            let count: usize = wanted[&key].values().sum();
            if count > 0 {
                return Err(BuildError::UnmatchedFaces { key, count });
            }
        }

        Ok(selection)
    }

    /// Bakes the scene graphs from the faces in `selection`.
    ///
    /// Gives one grid per [`SceneGraphKey`] with selected faces, plus the main
    /// grid, which is present whenever the asset has a mesh. The main grid
    /// comes first, then the others in ascending order of their non-zero
    /// hash, as in shipped files. An asset with no meshes gives no grids;
    /// files before version 15 hold exactly one grid, and ship
    /// `BucketedGeometry::bake(SceneGraphKey::MAIN, GridLayout::new(1), &[])` in that case.
    /// Each grid takes the selected faces of the meshes with its key, in
    /// source order, with untransformed positions and the mesh's visibility.
    ///
    /// # Errors
    ///
    /// - [`BuildError::MeshCountMismatch`] or [`BuildError::FaceMaskLength`]
    ///   if `selection` does not fit this asset's meshes.
    /// - The errors of [`mesh_faces`](Self::mesh_faces) and
    ///   [`BucketedGeometry::bake`].
    pub fn bake_scene_graphs(
        &self,
        selection: &SceneGraphSelection,
    ) -> Result<Vec<BucketedGeometry>, BuildError> {
        if selection.meshes().len() != self.meshes().len() {
            return Err(BuildError::MeshCountMismatch {
                selection: selection.meshes().len(),
                asset: self.meshes().len(),
            });
        }

        let mut groups: HashMap<SceneGraphKey, Vec<BakeFace>> = HashMap::new();
        if !self.meshes().is_empty() {
            groups.insert(SceneGraphKey::MAIN, Vec::new());
        }

        for (index, (mesh, mask)) in self.meshes().iter().zip(selection.meshes()).enumerate() {
            if mask.count() == 0 {
                continue;
            }
            let faces = self.mesh_faces(index)?;
            if mask.len() != faces.len() {
                return Err(BuildError::FaceMaskLength {
                    mesh: index,
                    mask: mask.len(),
                    faces: faces.len(),
                });
            }
            groups
                .entry(SceneGraphKey::of_mesh(mesh))
                .or_default()
                .extend(
                    faces
                        .into_iter()
                        .zip(mask.iter())
                        .filter(|(_, selected)| *selected)
                        .map(|(face, _)| BakeFace::new(face, mesh.visibility())),
                );
        }

        let mut groups: Vec<_> = groups.into_iter().collect();
        groups.sort_by_key(|(key, _)| key.file_order());
        groups
            .iter()
            .map(|(key, faces)| BucketedGeometry::bake(*key, selection.layout(*key), faces))
            .collect()
    }

    /// Picks the faces of mesh `mesh` that a scene graph would take, for a mesh
    /// with no recorded selection.
    ///
    /// The rule matches the shipped maps without missing a face, but it keeps
    /// some faces the baker dropped (about 8% of the main grid faces on
    /// Summoner's Rift, mostly outer scenery):
    ///
    /// - A mesh with a region path hash gives all its faces.
    /// - A mesh with a transform other than identity gives none.
    /// - Faces of submeshes whose material name contains `VertexDeform` are
    ///   left out.
    /// - Of the rest, a face is kept when its highest vertex is at or above
    ///   `min_top_y`. Each map has its own cutoff;
    ///   [`lowest_selected_top_y`](Self::lowest_selected_top_y) gives it for
    ///   an existing map.
    ///
    /// # Errors
    ///
    /// The errors of [`mesh_faces`](Self::mesh_faces).
    ///
    /// # Panics
    ///
    /// If `mesh` is out of bounds.
    pub fn default_face_mask(&self, mesh: usize, min_top_y: f32) -> Result<FaceMask, BuildError> {
        let m = &self.meshes()[mesh];
        let faces = self.mesh_faces(mesh)?;
        if m.region_path_hash() != 0 {
            return Ok(FaceMask::all(faces.len()));
        }
        if *m.transform() != Mat4::IDENTITY {
            return Ok(FaceMask::none(faces.len()));
        }

        let mut mask: FaceMask = faces
            .iter()
            .map(|face| face.iter().map(|p| p.y).fold(f32::MIN, f32::max) >= min_top_y)
            .collect();
        for submesh in m.submeshes() {
            if submesh.material().contains("VertexDeform") {
                let start = submesh.start_index().max(0) as usize / 3;
                let end = start + submesh.index_count().max(0) as usize / 3;
                for face in start..end.min(mask.len()) {
                    mask.set(face, false);
                }
            }
        }
        Ok(mask)
    }

    /// The lowest top Y (highest vertex Y) over the selected faces of meshes
    /// without a region, or `None` if there are none.
    ///
    /// Use it as `min_top_y` for [`default_face_mask`](Self::default_face_mask)
    /// to follow the cutoff of an existing map.
    ///
    /// # Errors
    ///
    /// [`BuildError::MeshCountMismatch`] if `selection` does not fit this
    /// asset, and the errors of [`mesh_faces`](Self::mesh_faces).
    pub fn lowest_selected_top_y(
        &self,
        selection: &SceneGraphSelection,
    ) -> Result<Option<f32>, BuildError> {
        if selection.meshes().len() != self.meshes().len() {
            return Err(BuildError::MeshCountMismatch {
                selection: selection.meshes().len(),
                asset: self.meshes().len(),
            });
        }
        let mut lowest: Option<f32> = None;
        for (index, (mesh, mask)) in self.meshes().iter().zip(selection.meshes()).enumerate() {
            if mesh.region_path_hash() != 0 || mask.count() == 0 {
                continue;
            }
            for (face, selected) in self.mesh_faces(index)?.iter().zip(mask.iter()) {
                if selected {
                    let top = face.iter().map(|p| p.y).fold(f32::MIN, f32::max);
                    lowest = Some(lowest.map_or(top, |l| l.min(top)));
                }
            }
        }
        Ok(lowest)
    }
}
