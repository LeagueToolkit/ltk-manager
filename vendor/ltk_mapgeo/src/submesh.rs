//! Environment submesh definition

/// Default material name for submeshes without a material
pub const MISSING_MATERIAL: &str = "-missing@environment-";

/// A submesh (primitive) defines a draw range within an environment mesh.
///
/// Each submesh has its own material and represents a portion of the parent
/// mesh's geometry that can be drawn with different render states.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnvironmentSubmesh {
    /// Hash of the material name (Fnv1a)
    /// Note: This is always 0 in files as the game computes it at runtime
    material_hash: u32,
    /// Material name (references a StaticMaterialDef in .materials.bin)
    material: String,
    /// Starting index in the index buffer
    start_index: i32,
    /// Number of indices to draw
    index_count: i32,
    /// Minimum vertex index referenced
    min_vertex: i32,
    /// Maximum vertex index referenced
    max_vertex: i32,
}

impl EnvironmentSubmesh {
    /// Creates a new submesh with the given material and draw range
    pub fn new(
        material: String,
        start_index: i32,
        index_count: i32,
        min_vertex: i32,
        max_vertex: i32,
    ) -> Self {
        Self {
            material_hash: 0,
            material,
            start_index,
            index_count,
            min_vertex,
            max_vertex,
        }
    }

    /// Creates a new submesh with all fields including hash (used for parsing)
    pub(crate) fn with_hash(
        material_hash: u32,
        material: String,
        start_index: i32,
        index_count: i32,
        min_vertex: i32,
        max_vertex: i32,
    ) -> Self {
        Self {
            material_hash,
            material,
            start_index,
            index_count,
            min_vertex,
            max_vertex,
        }
    }

    /// Hash of the material name (Fnv1a)
    #[inline]
    pub fn material_hash(&self) -> u32 {
        self.material_hash
    }

    /// The material name (references a StaticMaterialDef)
    #[inline]
    pub fn material(&self) -> &str {
        &self.material
    }

    /// The starting index in the index buffer
    #[inline]
    pub fn start_index(&self) -> i32 {
        self.start_index
    }

    /// The number of indices to draw
    #[inline]
    pub fn index_count(&self) -> i32 {
        self.index_count
    }

    /// The minimum vertex index referenced by this submesh
    #[inline]
    pub fn min_vertex(&self) -> i32 {
        self.min_vertex
    }

    /// The maximum vertex index referenced by this submesh
    #[inline]
    pub fn max_vertex(&self) -> i32 {
        self.max_vertex
    }

    /// The number of vertices used by this submesh
    #[inline]
    pub fn vertex_count(&self) -> i32 {
        self.max_vertex - self.min_vertex + 1
    }

    /// The number of triangles in this submesh
    #[inline]
    pub fn triangle_count(&self) -> i32 {
        self.index_count / 3
    }
}
