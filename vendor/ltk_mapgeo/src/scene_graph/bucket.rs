//! Geometry bucket definition

use glam::Vec2;

/// A single bucket in the spatial partitioning grid.
///
/// Each bucket represents a cell in the 2D grid and contains references
/// to triangles that fall within or extend from this cell.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GeometryBucket {
    /// Maximum distance geometry extends beyond bucket bounds on X axis
    max_stick_out_x: f32,
    /// Maximum distance geometry extends beyond bucket bounds on Z axis
    max_stick_out_z: f32,
    /// Starting index in the shared index buffer
    start_index: u32,
    /// Base vertex offset for indexed drawing
    base_vertex: u32,
    /// Number of faces fully contained within this bucket
    inside_face_count: u16,
    /// Number of faces that extend beyond this bucket's bounds
    sticking_out_face_count: u16,
}

impl GeometryBucket {
    /// Creates a new geometry bucket
    pub fn new(
        max_stick_out_x: f32,
        max_stick_out_z: f32,
        start_index: u32,
        base_vertex: u32,
        inside_face_count: u16,
        sticking_out_face_count: u16,
    ) -> Self {
        Self {
            max_stick_out_x,
            max_stick_out_z,
            start_index,
            base_vertex,
            inside_face_count,
            sticking_out_face_count,
        }
    }

    /// Maximum stick-out distance as a 2D vector (X, Z)
    #[inline]
    pub fn max_stick_out(&self) -> Vec2 {
        Vec2::new(self.max_stick_out_x, self.max_stick_out_z)
    }

    /// Maximum distance geometry extends beyond bucket bounds on X axis
    #[inline]
    pub fn max_stick_out_x(&self) -> f32 {
        self.max_stick_out_x
    }

    /// Maximum distance geometry extends beyond bucket bounds on Z axis
    #[inline]
    pub fn max_stick_out_z(&self) -> f32 {
        self.max_stick_out_z
    }

    /// Starting index in the shared index buffer
    #[inline]
    pub fn start_index(&self) -> u32 {
        self.start_index
    }

    /// Base vertex offset for indexed drawing
    #[inline]
    pub fn base_vertex(&self) -> u32 {
        self.base_vertex
    }

    /// Number of faces fully contained within this bucket
    #[inline]
    pub fn inside_face_count(&self) -> u16 {
        self.inside_face_count
    }

    /// Number of faces that extend beyond this bucket's bounds
    #[inline]
    pub fn sticking_out_face_count(&self) -> u16 {
        self.sticking_out_face_count
    }

    /// Total number of faces in this bucket
    #[inline]
    pub fn total_face_count(&self) -> u32 {
        self.inside_face_count as u32 + self.sticking_out_face_count as u32
    }

    /// Total number of indices for this bucket (face_count * 3)
    #[inline]
    pub fn index_count(&self) -> u32 {
        self.total_face_count() * 3
    }
}
