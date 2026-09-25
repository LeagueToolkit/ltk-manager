//! Baking bucketed geometry from triangles.
//!
//! [`BucketedGeometry::bake`] packs triangles into a grid the same way the
//! baker that produced the shipped `.mapgeo` files does. Given the same faces
//! in the same order, its output equals the shipped grid bit for bit.
//!
//! The layout rules:
//!
//! - The grid bounds are the XZ bounds of every face's *min corner* (the
//!   component-wise minimum of its three vertices), padded by
//!   [`BOUNDS_PADDING`] on each side.
//! - A face goes to the bucket that contains its min corner.
//! - A face is *inside* its bucket when every vertex is strictly below the
//!   bucket's upper X and Z edges. Inside faces come first, then the faces
//!   that stick out, each group in input order.
//! - Vertices are deduplicated per bucket by their exact bit pattern, in
//!   first-use order.
//! - A bucket's upper edge is `min + index * bucket_size + bucket_size`,
//!   rounded as [`EdgeRounding`] says.
//! - Empty buckets keep the running `start_index` and `base_vertex`.
//! - Per-face visibility flags are written only when the faces carry at least
//!   two distinct values.

use std::collections::HashMap;

use glam::{Vec2, Vec3};

use crate::{EnvironmentMesh, EnvironmentVisibility};

use super::bucketed_geometry::{BucketedGeometryBuilder, BucketedGeometryFlags};
use super::{BucketedGeometry, GeometryBucket};

/// Distance the grid bounds extend past the outermost face min corner.
pub const BOUNDS_PADDING: f32 = 10.0;

/// Starting value of the bounds fold. A grid with no faces keeps it, so its
/// bounds are `(+EMPTY_BOUND, -EMPTY_BOUND)`.
const EMPTY_BOUND: f32 = f32::MAX / 10.0;

/// Identifies one scene graph in an [`EnvironmentAsset`](crate::EnvironmentAsset).
///
/// A mesh feeds the scene graph whose key equals its own
/// `(visibility_controller_path_hash, region_path_hash)` pair.
/// [`SceneGraphKey::MAIN`] is the map's main grid.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub struct SceneGraphKey {
    visibility_controller_path_hash: u32,
    region_path_hash: u32,
}

impl SceneGraphKey {
    /// The main grid: no visibility controller and no region.
    pub const MAIN: Self = Self::new(0, 0);

    /// Creates a key from a visibility controller path hash and a region path hash.
    pub const fn new(visibility_controller_path_hash: u32, region_path_hash: u32) -> Self {
        Self {
            visibility_controller_path_hash,
            region_path_hash,
        }
    }

    /// The key of the scene graph that `mesh` feeds.
    pub fn of_mesh(mesh: &EnvironmentMesh) -> Self {
        Self::new(
            mesh.visibility_controller_path_hash(),
            mesh.region_path_hash(),
        )
    }

    /// The key of `graph`.
    pub fn of_graph(graph: &BucketedGeometry) -> Self {
        Self::new(
            graph.visibility_controller_path_hash(),
            graph.region_path_hash(),
        )
    }

    /// Hash of the visibility controller path.
    #[inline]
    pub fn visibility_controller_path_hash(&self) -> u32 {
        self.visibility_controller_path_hash
    }

    /// Hash of the region placeable path.
    #[inline]
    pub fn region_path_hash(&self) -> u32 {
        self.region_path_hash
    }

    /// Sort key for the order of scene graphs in a file: the main grid
    /// first, then ascending by the non-zero hash.
    pub(crate) fn file_order(&self) -> (u32, u32, u32) {
        (
            self.visibility_controller_path_hash | self.region_path_hash,
            self.visibility_controller_path_hash,
            self.region_path_hash,
        )
    }
}

/// How a bucket's upper edge, `min + index * bucket_size + bucket_size`, is rounded.
///
/// The edge decides which faces are inside a bucket and how far the others
/// stick out.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub enum EdgeRounding {
    /// Each operation is rounded to `f32`. Every map in the current client
    /// is baked this way.
    #[default]
    PerOperation,
    /// `min + index * bucket_size` is a fused multiply-add, rounded once.
    /// Some older maps are baked this way.
    FusedMultiplyAdd,
}

impl EdgeRounding {
    /// The upper edge of bucket `index` on one axis.
    pub(crate) fn upper_edge(self, min: f32, index: usize, size: f32) -> f32 {
        match self {
            Self::PerOperation => min + index as f32 * size + size,
            Self::FusedMultiplyAdd => (index as f32).mul_add(size, min) + size,
        }
    }
}

/// The shape of a grid: how many buckets per side, and how bucket edges round.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct GridLayout {
    buckets_per_side: u16,
    edge_rounding: EdgeRounding,
}

impl GridLayout {
    /// A grid of `buckets_per_side` x `buckets_per_side` buckets with
    /// [`EdgeRounding::PerOperation`].
    pub const fn new(buckets_per_side: u16) -> Self {
        Self {
            buckets_per_side,
            edge_rounding: EdgeRounding::PerOperation,
        }
    }

    /// The same layout with `edge_rounding`.
    pub const fn with_edge_rounding(self, edge_rounding: EdgeRounding) -> Self {
        Self {
            edge_rounding,
            ..self
        }
    }

    /// Number of buckets per side.
    #[inline]
    pub fn buckets_per_side(&self) -> u16 {
        self.buckets_per_side
    }

    /// How bucket edges round.
    #[inline]
    pub fn edge_rounding(&self) -> EdgeRounding {
        self.edge_rounding
    }
}

/// One triangle to bake into a grid.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BakeFace {
    positions: [Vec3; 3],
    visibility: EnvironmentVisibility,
}

impl BakeFace {
    /// Creates a face from its three positions (in winding order) and the
    /// visibility layers of the mesh it comes from.
    pub fn new(positions: [Vec3; 3], visibility: EnvironmentVisibility) -> Self {
        Self {
            positions,
            visibility,
        }
    }

    /// The three positions, in winding order.
    #[inline]
    pub fn positions(&self) -> [Vec3; 3] {
        self.positions
    }

    /// The visibility layers of the face.
    #[inline]
    pub fn visibility(&self) -> EnvironmentVisibility {
        self.visibility
    }

    /// Component-wise XZ minimum of the three vertices.
    fn min_corner(&self) -> Vec2 {
        let [a, b, c] = self.positions;
        Vec2::new(a.x.min(b.x).min(c.x), a.z.min(b.z).min(c.z))
    }
}

/// Errors from baking bucketed geometry.
#[derive(Debug, thiserror::Error)]
pub enum BuildError {
    /// `buckets_per_side` is zero.
    #[error("buckets_per_side must be greater than 0")]
    ZeroBucketsPerSide,

    /// A face has a NaN or infinite position.
    #[error("face {face} has a non-finite position")]
    NonFinitePosition {
        /// Index of the face in the input.
        face: usize,
    },

    /// The faces need more indices than a `u32` can address.
    #[error("{faces} faces need more than u32::MAX indices")]
    TooManyFaces {
        /// Number of faces given.
        faces: usize,
    },

    /// A bucket needs more distinct vertices than its `u16` indices can address.
    #[error("bucket ({bucket_x}, {bucket_z}) has {count} unique vertices, more than u16 indices address")]
    BucketVertexOverflow {
        /// Bucket column.
        bucket_x: usize,
        /// Bucket row.
        bucket_z: usize,
        /// Distinct vertices the bucket needs.
        count: usize,
    },

    /// A bucket has more inside or sticking-out faces than a `u16` counts.
    #[error("bucket ({bucket_x}, {bucket_z}) has {count} faces in one group, more than u16::MAX")]
    BucketFaceOverflow {
        /// Bucket column.
        bucket_x: usize,
        /// Bucket row.
        bucket_z: usize,
        /// Faces in the group that overflows.
        count: usize,
    },

    /// A selection has a different number of meshes than the asset.
    #[error("the selection has {selection} meshes, the asset has {asset}")]
    MeshCountMismatch {
        /// Meshes in the selection.
        selection: usize,
        /// Meshes in the asset.
        asset: usize,
    },

    /// A face mask has a different length than its mesh has faces.
    #[error("the face mask of mesh {mesh} has {mask} faces, the mesh has {faces}")]
    FaceMaskLength {
        /// Mesh index.
        mesh: usize,
        /// Faces in the mask.
        mask: usize,
        /// Faces in the mesh.
        faces: usize,
    },

    /// A mesh has no `XYZ_Float32` position element.
    #[error("mesh {mesh} has no XYZ_Float32 position element")]
    MissingPositions {
        /// Mesh index.
        mesh: usize,
    },

    /// A mesh's index or vertex buffer id does not exist in the asset.
    #[error("mesh {mesh} refers to a buffer the asset does not have")]
    MissingBuffer {
        /// Mesh index.
        mesh: usize,
    },

    /// A mesh's index buffer refers past the end of its vertices.
    #[error("mesh {mesh} index {index} is out of bounds for {vertex_count} vertices")]
    IndexOutOfBounds {
        /// Mesh index.
        mesh: usize,
        /// The index value.
        index: u32,
        /// Vertices in the mesh.
        vertex_count: usize,
    },

    /// A scene graph's buckets refer past its vertices or indices.
    #[error("the scene graph {0:?} refers past its vertices or indices")]
    CorruptSceneGraph(SceneGraphKey),

    /// Two scene graphs in the asset have the same key.
    #[error("the asset has two scene graphs for {0:?}")]
    DuplicateSceneGraph(SceneGraphKey),

    /// A scene graph has faces that no mesh with its key contains, so its
    /// selection cannot be recovered.
    #[error("{count} faces of the scene graph {key:?} are in no mesh with that key")]
    UnmatchedFaces {
        /// The scene graph.
        key: SceneGraphKey,
        /// Faces not found.
        count: usize,
    },
}

impl BucketedGeometry {
    /// Bakes `faces` into a grid with `layout`.
    ///
    /// `faces` must be in source order: mesh order, then index buffer order.
    /// The order decides the face and vertex order inside each bucket.
    /// Positions are used as given, with no transform applied.
    ///
    /// With no faces, the result is the empty layout the game ships: one
    /// bucket and inverted sentinel bounds. `layout` is ignored in that case.
    ///
    /// # Errors
    ///
    /// - [`BuildError::ZeroBucketsPerSide`] if the layout has 0 buckets per side.
    /// - [`BuildError::NonFinitePosition`] if a position is NaN or infinite.
    /// - [`BuildError::TooManyFaces`], [`BuildError::BucketVertexOverflow`] or
    ///   [`BuildError::BucketFaceOverflow`] if the result does not fit the format.
    ///
    /// # Example
    ///
    /// ```
    /// use glam::Vec3;
    /// use ltk_mapgeo::{
    ///     BakeFace, BucketedGeometry, EnvironmentVisibility, GridLayout, SceneGraphKey,
    /// };
    ///
    /// let face = BakeFace::new(
    ///     [Vec3::ZERO, Vec3::new(0.0, 0.0, 50.0), Vec3::new(50.0, 0.0, 0.0)],
    ///     EnvironmentVisibility::all(),
    /// );
    /// let grid = BucketedGeometry::bake(SceneGraphKey::MAIN, GridLayout::new(4), &[face])?;
    /// assert_eq!(grid.indices().len(), 3);
    /// # Ok::<(), ltk_mapgeo::BuildError>(())
    /// ```
    pub fn bake(
        key: SceneGraphKey,
        layout: GridLayout,
        faces: &[BakeFace],
    ) -> Result<BucketedGeometry, BuildError> {
        if layout.buckets_per_side == 0 {
            return Err(BuildError::ZeroBucketsPerSide);
        }
        if faces.len() > (u32::MAX / 3) as usize {
            return Err(BuildError::TooManyFaces { faces: faces.len() });
        }
        if let Some(face) = faces
            .iter()
            .position(|f| !f.positions.iter().all(|p| p.is_finite()))
        {
            return Err(BuildError::NonFinitePosition { face });
        }

        let buckets_per_side = if faces.is_empty() {
            1
        } else {
            layout.buckets_per_side
        };
        let n = buckets_per_side as usize;

        let mut lo = Vec2::splat(EMPTY_BOUND);
        let mut hi = Vec2::splat(-EMPTY_BOUND);
        for face in faces {
            let corner = face.min_corner();
            lo = lo.min(corner);
            hi = hi.max(corner);
        }
        let min = lo - Vec2::splat(BOUNDS_PADDING);
        let max = hi + Vec2::splat(BOUNDS_PADDING);
        let bucket_size = (max - min) / buckets_per_side as f32;

        let mut bucket_faces: Vec<Vec<usize>> = vec![Vec::new(); n * n];
        for (i, face) in faces.iter().enumerate() {
            let t = (face.min_corner() - min) / bucket_size;
            let x = (t.x as i64).clamp(0, n as i64 - 1) as usize;
            let z = (t.y as i64).clamp(0, n as i64 - 1) as usize;
            bucket_faces[z * n + x].push(i);
        }

        let mut vertices: Vec<Vec3> = Vec::new();
        let mut indices: Vec<u16> = Vec::with_capacity(faces.len() * 3);
        let mut buckets = Vec::with_capacity(n * n);
        let mut face_flags = Vec::with_capacity(faces.len());
        let mut max_stick_out = Vec2::ZERO;
        let mut local: HashMap<[u32; 3], u16> = HashMap::new();

        for (bucket, list) in bucket_faces.iter().enumerate() {
            let (x, z) = (bucket % n, bucket / n);
            let edge = layout.edge_rounding;
            let bucket_hi = Vec2::new(
                edge.upper_edge(min.x, x, bucket_size.x),
                edge.upper_edge(min.y, z, bucket_size.y),
            );
            let is_inside = |f: &BakeFace| {
                f.positions
                    .iter()
                    .all(|p| p.x < bucket_hi.x && p.z < bucket_hi.y)
            };

            let (inside, sticking_out): (Vec<usize>, Vec<usize>) =
                list.iter().partition(|&&i| is_inside(&faces[i]));
            let face_count = |count: usize| {
                u16::try_from(count).map_err(|_| BuildError::BucketFaceOverflow {
                    bucket_x: x,
                    bucket_z: z,
                    count,
                })
            };
            let inside_count = face_count(inside.len())?;
            let sticking_out_count = face_count(sticking_out.len())?;

            let start_index = indices.len() as u32;
            let base_vertex = vertices.len();
            let mut stick_out = Vec2::ZERO;
            local.clear();

            for &i in inside.iter().chain(&sticking_out) {
                for p in faces[i].positions {
                    let key = [p.x.to_bits(), p.y.to_bits(), p.z.to_bits()];
                    let index = match local.get(&key) {
                        Some(&index) => index,
                        None => {
                            let count = vertices.len() - base_vertex;
                            let index = u16::try_from(count).map_err(|_| {
                                BuildError::BucketVertexOverflow {
                                    bucket_x: x,
                                    bucket_z: z,
                                    count: count + 1,
                                }
                            })?;
                            local.insert(key, index);
                            vertices.push(p);
                            index
                        }
                    };
                    indices.push(index);
                    stick_out = stick_out.max(Vec2::new(p.x, p.z) - bucket_hi);
                }
                face_flags.push(faces[i].visibility);
            }

            max_stick_out = max_stick_out.max(stick_out);
            buckets.push(GeometryBucket::new(
                stick_out.x,
                stick_out.y,
                start_index,
                base_vertex as u32,
                inside_count,
                sticking_out_count,
            ));
        }

        let has_face_flags = face_flags.iter().any(|&f| f != face_flags[0]);
        let flags = if has_face_flags {
            BucketedGeometryFlags::HAS_FACE_VISIBILITY_FLAGS
        } else {
            BucketedGeometryFlags::empty()
        };

        Ok(BucketedGeometryBuilder::default()
            .visibility_controller_path_hash(key.visibility_controller_path_hash)
            .region_path_hash(key.region_path_hash)
            .bounds(min.x, min.y, max.x, max.y)
            .max_stick_out(max_stick_out.x, max_stick_out.y)
            .bucket_size(bucket_size.x, bucket_size.y)
            .buckets_per_side(buckets_per_side)
            .set_disabled(false)
            .flags(flags)
            .vertices(vertices)
            .indices(indices)
            .buckets(buckets)
            .face_visibility_flags(has_face_flags.then_some(face_flags))
            .build())
    }
}
