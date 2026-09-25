//! Bucketed geometry scene graph

use glam::{Vec2, Vec3};

use crate::EnvironmentVisibility;

use super::GeometryBucket;

/// Bucketed geometry provides spatial partitioning for efficient queries.
///
/// The map is divided into a uniform 2D grid on the XZ plane. Each cell (bucket)
/// contains simplified geometry data for spatial queries like collision detection,
/// raycasting, and visibility determination.
///
/// # Grid Layout
///
/// ```text
/// ┌─────┬─────┬─────┬─────┐
/// │ 0,3 │ 1,3 │ 2,3 │ 3,3 │   ← Top-down view (XZ plane)
/// ├─────┼─────┼─────┼─────┤
/// │ 0,2 │ 1,2 │ 2,2 │ 3,2 │
/// ├─────┼─────┼─────┼─────┤
/// │ 0,1 │ 1,1 │ 2,1 │ 3,1 │
/// ├─────┼─────┼─────┼─────┤
/// │ 0,0 │ 1,0 │ 2,0 │ 3,0 │
/// └─────┴─────┴─────┴─────┘
/// ```
#[derive(Debug, Clone)]
pub struct BucketedGeometry {
    /// Hash of a region placeable this graph is anchored to (version >= 18)
    region_path_hash: u32,

    /// Hash of the visibility controller path
    visibility_controller_path_hash: u32,

    /// Minimum X bound of the grid
    min_x: f32,
    /// Minimum Z bound of the grid
    min_z: f32,
    /// Maximum X bound of the grid
    max_x: f32,
    /// Maximum Z bound of the grid
    max_z: f32,

    /// Maximum stick-out distance on X axis (global)
    max_stick_out_x: f32,
    /// Maximum stick-out distance on Z axis (global)
    max_stick_out_z: f32,

    /// Size of each bucket on X axis
    bucket_size_x: f32,
    /// Size of each bucket on Z axis
    bucket_size_z: f32,

    /// Number of buckets per side (grid is NxN)
    buckets_per_side: u16,

    /// Whether the bucket grid is disabled
    is_disabled: bool,

    /// Flags for this bucketed geometry
    flags: BucketedGeometryFlags,

    /// Simplified vertex positions for spatial queries
    vertices: Vec<Vec3>,

    /// Triangle indices into the vertex array
    indices: Vec<u16>,

    /// Bucket grid (row-major order: buckets[z * buckets_per_side + x])
    buckets: Vec<GeometryBucket>,

    /// Per-face visibility flags (optional)
    face_visibility_flags: Option<Vec<EnvironmentVisibility>>,
}

bitflags::bitflags! {
    /// Flags for bucketed geometry
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
    pub struct BucketedGeometryFlags: u8 {
        /// Face visibility flags are present
        const HAS_FACE_VISIBILITY_FLAGS = 1 << 0;
    }
}

impl BucketedGeometry {
    /// Creates a new empty (disabled) bucketed geometry
    pub fn empty() -> Self {
        Self {
            region_path_hash: 0,
            visibility_controller_path_hash: 0,
            min_x: 0.0,
            min_z: 0.0,
            max_x: 0.0,
            max_z: 0.0,
            max_stick_out_x: 0.0,
            max_stick_out_z: 0.0,
            bucket_size_x: 0.0,
            bucket_size_z: 0.0,
            buckets_per_side: 0,
            is_disabled: true,
            flags: BucketedGeometryFlags::empty(),
            vertices: Vec::new(),
            indices: Vec::new(),
            buckets: Vec::new(),
            face_visibility_flags: None,
        }
    }

    /// Hash of the visibility controller path
    #[inline]
    pub fn visibility_controller_path_hash(&self) -> u32 {
        self.visibility_controller_path_hash
    }

    /// Hash of a map region placeable this graph is anchored to (version >= 18).
    ///
    /// Container-key ("path") hash of an item in the map's
    /// `MapPlaceableContainer` (materials.bin), like
    /// [`visibility_controller_path_hash`](Self::visibility_controller_path_hash).
    /// When non-zero, the game positions the graph's bounds via the referenced
    /// region entity instead of the static world origin. `0` means not anchored.
    #[inline]
    pub fn region_path_hash(&self) -> u32 {
        self.region_path_hash
    }

    /// Minimum bounds of the grid (X, Z)
    #[inline]
    pub fn min_bounds(&self) -> Vec2 {
        Vec2::new(self.min_x, self.min_z)
    }

    /// Maximum bounds of the grid (X, Z)
    #[inline]
    pub fn max_bounds(&self) -> Vec2 {
        Vec2::new(self.max_x, self.max_z)
    }

    /// Maximum stick-out distance (X, Z)
    #[inline]
    pub fn max_stick_out(&self) -> Vec2 {
        Vec2::new(self.max_stick_out_x, self.max_stick_out_z)
    }

    /// Bucket size (X, Z)
    #[inline]
    pub fn bucket_size(&self) -> Vec2 {
        Vec2::new(self.bucket_size_x, self.bucket_size_z)
    }

    /// Number of buckets per side (grid is NxN)
    #[inline]
    pub fn buckets_per_side(&self) -> u16 {
        self.buckets_per_side
    }

    /// Whether the bucket grid is disabled
    #[inline]
    pub fn is_disabled(&self) -> bool {
        self.is_disabled
    }

    /// The flags as read
    #[inline]
    pub(crate) fn flags(&self) -> BucketedGeometryFlags {
        self.flags
    }

    /// The simplified vertex positions
    #[inline]
    pub fn vertices(&self) -> &[Vec3] {
        &self.vertices
    }

    /// The triangle indices
    #[inline]
    pub fn indices(&self) -> &[u16] {
        &self.indices
    }

    /// The bucket grid (flattened, row-major order)
    #[inline]
    pub fn buckets(&self) -> &[GeometryBucket] {
        &self.buckets
    }

    /// Gets a bucket at the given grid coordinates
    #[inline]
    pub fn bucket_at(&self, x: usize, z: usize) -> Option<&GeometryBucket> {
        if x >= self.buckets_per_side as usize || z >= self.buckets_per_side as usize {
            return None;
        }
        let index = z * self.buckets_per_side as usize + x;
        self.buckets.get(index)
    }

    /// Per-face visibility flags (if present)
    #[inline]
    pub fn face_visibility_flags(&self) -> Option<&[EnvironmentVisibility]> {
        self.face_visibility_flags.as_deref()
    }

    /// Converts world coordinates to bucket grid coordinates
    pub fn world_to_bucket(&self, world_x: f32, world_z: f32) -> Option<(usize, usize)> {
        if self.is_disabled || self.bucket_size_x <= 0.0 || self.bucket_size_z <= 0.0 {
            return None;
        }

        let bucket_x = ((world_x - self.min_x) / self.bucket_size_x) as usize;
        let bucket_z = ((world_z - self.min_z) / self.bucket_size_z) as usize;

        if bucket_x >= self.buckets_per_side as usize || bucket_z >= self.buckets_per_side as usize
        {
            return None;
        }

        Some((bucket_x, bucket_z))
    }
}

/// Builder for constructing [`BucketedGeometry`] instances
#[derive(Default)]
pub(crate) struct BucketedGeometryBuilder {
    region_path_hash: u32,
    visibility_controller_path_hash: u32,
    min_x: f32,
    min_z: f32,
    max_x: f32,
    max_z: f32,
    max_stick_out_x: f32,
    max_stick_out_z: f32,
    bucket_size_x: f32,
    bucket_size_z: f32,
    buckets_per_side: u16,
    is_disabled: bool,
    flags: BucketedGeometryFlags,
    vertices: Vec<Vec3>,
    indices: Vec<u16>,
    buckets: Vec<GeometryBucket>,
    face_visibility_flags: Option<Vec<EnvironmentVisibility>>,
}

impl BucketedGeometryBuilder {
    pub fn visibility_controller_path_hash(mut self, hash: u32) -> Self {
        self.visibility_controller_path_hash = hash;
        self
    }

    pub fn region_path_hash(mut self, hash: u32) -> Self {
        self.region_path_hash = hash;
        self
    }

    pub fn bounds(mut self, min_x: f32, min_z: f32, max_x: f32, max_z: f32) -> Self {
        self.min_x = min_x;
        self.min_z = min_z;
        self.max_x = max_x;
        self.max_z = max_z;
        self
    }

    pub fn max_stick_out(mut self, x: f32, z: f32) -> Self {
        self.max_stick_out_x = x;
        self.max_stick_out_z = z;
        self
    }

    pub fn bucket_size(mut self, x: f32, z: f32) -> Self {
        self.bucket_size_x = x;
        self.bucket_size_z = z;
        self
    }

    pub fn buckets_per_side(mut self, count: u16) -> Self {
        self.buckets_per_side = count;
        self
    }

    pub fn set_disabled(mut self, disabled: bool) -> Self {
        self.is_disabled = disabled;
        self
    }

    pub fn flags(mut self, flags: BucketedGeometryFlags) -> Self {
        self.flags = flags;
        self
    }

    pub fn vertices(mut self, vertices: Vec<Vec3>) -> Self {
        self.vertices = vertices;
        self
    }

    pub fn indices(mut self, indices: Vec<u16>) -> Self {
        self.indices = indices;
        self
    }

    pub fn buckets(mut self, buckets: Vec<GeometryBucket>) -> Self {
        self.buckets = buckets;
        self
    }

    pub fn face_visibility_flags(mut self, flags: Option<Vec<EnvironmentVisibility>>) -> Self {
        self.face_visibility_flags = flags;
        self
    }

    pub fn build(self) -> BucketedGeometry {
        BucketedGeometry {
            region_path_hash: self.region_path_hash,
            visibility_controller_path_hash: self.visibility_controller_path_hash,
            min_x: self.min_x,
            min_z: self.min_z,
            max_x: self.max_x,
            max_z: self.max_z,
            max_stick_out_x: self.max_stick_out_x,
            max_stick_out_z: self.max_stick_out_z,
            bucket_size_x: self.bucket_size_x,
            bucket_size_z: self.bucket_size_z,
            buckets_per_side: self.buckets_per_side,
            is_disabled: self.is_disabled,
            flags: self.flags,
            vertices: self.vertices,
            indices: self.indices,
            buckets: self.buckets,
            face_visibility_flags: self.face_visibility_flags,
        }
    }
}
