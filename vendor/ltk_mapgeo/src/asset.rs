//! Environment asset definition

use ltk_mesh::mem::{IndexBuffer, VertexBuffer, VertexBufferDescription};

use crate::{BucketedGeometry, EnvironmentMesh, PlanarReflector, ShaderTextureOverride};

/// An environment asset contains all geometry data for a League of Legends map.
///
/// This is the primary type for working with `.mapgeo` files. It contains:
/// - Environment meshes (renderable geometry)
/// - Shared vertex and index buffers
/// - Bucketed geometry for spatial queries
/// - Planar reflectors for reflection rendering
///
/// # Buffer Sharing
///
/// Multiple meshes can reference the same vertex/index buffers. The asset owns
/// all buffers, and meshes store indices into these buffer arrays.
///
/// # Example
///
/// ```ignore
/// use ltk_mapgeo::EnvironmentAsset;
/// use std::fs::File;
///
/// let mut file = File::open("base.mapgeo")?;
/// let asset = EnvironmentAsset::from_reader(&mut file)?;
///
/// for (mesh, vertex_buffers, _index_buffer) in asset.meshes_with_buffers() {
///     // A submesh names the material, as the bin entry path of a StaticMaterialDef.
///     for submesh in mesh.submeshes() {
///         println!("{} -> {}", mesh.name(), submesh.material());
///     }
///     println!("  Vertices: {}", vertex_buffers[0].count());
/// }
/// ```
#[derive(Debug, Clone)]
pub struct EnvironmentAsset {
    /// Shader texture overrides (global sampler replacements)
    shader_texture_overrides: Vec<ShaderTextureOverride>,

    /// Environment meshes (renderable geometry)
    meshes: Vec<EnvironmentMesh>,

    /// Bucketed geometry scene graphs (spatial acceleration)
    scene_graphs: Vec<BucketedGeometry>,

    /// Planar reflectors
    planar_reflectors: Vec<PlanarReflector>,

    /// Shared vertex buffers (meshes reference by index)
    vertex_buffers: Vec<VertexBuffer>,

    /// Shared index buffers (meshes reference by index)
    index_buffers: Vec<IndexBuffer<u16>>,

    /// The vertex declaration table as read, which the writer keeps the order of
    pub(crate) vertex_declarations: Vec<VertexBufferDescription>,
}

impl EnvironmentAsset {
    /// Creates a new environment asset builder
    pub(crate) fn builder() -> EnvironmentAssetBuilder {
        EnvironmentAssetBuilder::default()
    }

    /// The shader texture overrides
    #[inline]
    pub fn shader_texture_overrides(&self) -> &[ShaderTextureOverride] {
        &self.shader_texture_overrides
    }

    /// The environment meshes
    #[inline]
    pub fn meshes(&self) -> &[EnvironmentMesh] {
        &self.meshes
    }

    /// The environment meshes, for editing in place
    #[inline]
    pub fn meshes_mut(&mut self) -> &mut [EnvironmentMesh] {
        &mut self.meshes
    }

    /// The bucketed geometry scene graphs
    #[inline]
    pub fn scene_graphs(&self) -> &[BucketedGeometry] {
        &self.scene_graphs
    }

    /// Replaces the scene graphs, typically with those of
    /// [`EnvironmentAsset::bake_scene_graphs`].
    ///
    /// Returns the previous scene graphs.
    pub fn replace_scene_graphs(
        &mut self,
        scene_graphs: Vec<BucketedGeometry>,
    ) -> Vec<BucketedGeometry> {
        std::mem::replace(&mut self.scene_graphs, scene_graphs)
    }

    /// The planar reflectors
    #[inline]
    pub fn planar_reflectors(&self) -> &[PlanarReflector] {
        &self.planar_reflectors
    }

    /// The shared vertex buffers
    #[inline]
    pub fn vertex_buffers(&self) -> &[VertexBuffer] {
        &self.vertex_buffers
    }

    /// The shared index buffers
    #[inline]
    pub fn index_buffers(&self) -> &[IndexBuffer<u16>] {
        &self.index_buffers
    }

    /// Gets a vertex buffer by index
    #[inline]
    pub fn vertex_buffer(&self, index: usize) -> Option<&VertexBuffer> {
        self.vertex_buffers.get(index)
    }

    /// Gets an index buffer by index
    #[inline]
    pub fn index_buffer(&self, index: usize) -> Option<&IndexBuffer<u16>> {
        self.index_buffers.get(index)
    }

    /// Returns the total number of meshes
    #[inline]
    pub fn mesh_count(&self) -> usize {
        self.meshes.len()
    }

    /// Returns the total number of vertex buffers
    #[inline]
    pub fn vertex_buffer_count(&self) -> usize {
        self.vertex_buffers.len()
    }

    /// Returns the total number of index buffers
    #[inline]
    pub fn index_buffer_count(&self) -> usize {
        self.index_buffers.len()
    }

    /// Finds a mesh by name
    pub fn find_mesh(&self, name: &str) -> Option<&EnvironmentMesh> {
        self.meshes.iter().find(|m| m.name() == name)
    }

    /// Iterates over meshes with their vertex and index buffers
    pub fn meshes_with_buffers(
        &self,
    ) -> impl Iterator<Item = (&EnvironmentMesh, Vec<&VertexBuffer>, &IndexBuffer<u16>)> {
        self.meshes.iter().filter_map(|mesh| {
            let vertex_buffers: Vec<_> = mesh
                .vertex_buffer_ids()
                .iter()
                .filter_map(|&id| self.vertex_buffers.get(id))
                .collect();

            let index_buffer = self.index_buffers.get(mesh.index_buffer_id())?;

            Some((mesh, vertex_buffers, index_buffer))
        })
    }
}

/// Builder for constructing [`EnvironmentAsset`] instances
#[derive(Default)]
pub(crate) struct EnvironmentAssetBuilder {
    shader_texture_overrides: Vec<ShaderTextureOverride>,
    meshes: Vec<EnvironmentMesh>,
    scene_graphs: Vec<BucketedGeometry>,
    planar_reflectors: Vec<PlanarReflector>,
    vertex_buffers: Vec<VertexBuffer>,
    index_buffers: Vec<IndexBuffer<u16>>,
    vertex_declarations: Vec<VertexBufferDescription>,
}

impl EnvironmentAssetBuilder {
    pub fn shader_texture_overrides(mut self, overrides: Vec<ShaderTextureOverride>) -> Self {
        self.shader_texture_overrides = overrides;
        self
    }

    pub fn meshes(mut self, meshes: Vec<EnvironmentMesh>) -> Self {
        self.meshes = meshes;
        self
    }

    pub fn scene_graphs(mut self, scene_graphs: Vec<BucketedGeometry>) -> Self {
        self.scene_graphs = scene_graphs;
        self
    }

    pub fn planar_reflectors(mut self, reflectors: Vec<PlanarReflector>) -> Self {
        self.planar_reflectors = reflectors;
        self
    }

    pub fn vertex_buffers(mut self, buffers: Vec<VertexBuffer>) -> Self {
        self.vertex_buffers = buffers;
        self
    }

    pub fn index_buffers(mut self, buffers: Vec<IndexBuffer<u16>>) -> Self {
        self.index_buffers = buffers;
        self
    }

    pub fn vertex_declarations(mut self, declarations: Vec<VertexBufferDescription>) -> Self {
        self.vertex_declarations = declarations;
        self
    }

    pub fn build(self) -> EnvironmentAsset {
        EnvironmentAsset {
            shader_texture_overrides: self.shader_texture_overrides,
            meshes: self.meshes,
            scene_graphs: self.scene_graphs,
            planar_reflectors: self.planar_reflectors,
            vertex_buffers: self.vertex_buffers,
            index_buffers: self.index_buffers,
            vertex_declarations: self.vertex_declarations,
        }
    }
}
