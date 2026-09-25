//! Environment mesh definition

use glam::{Mat4, Vec2, Vec3};
use ltk_primitives::AABB;

use crate::{
    EnvironmentAssetChannel, EnvironmentMeshRenderFlags, EnvironmentQuality, EnvironmentSubmesh,
    EnvironmentVisibility, MeshTextureOverride, VisibilityTransitionBehavior,
};

/// An environment mesh represents a single renderable object within the map.
///
/// Meshes reference shared vertex and index buffers stored in the parent
/// [`EnvironmentAsset`](crate::EnvironmentAsset). The actual geometry data
/// is accessed through the asset's buffer accessors.
#[derive(Debug, Clone)]
pub struct EnvironmentMesh {
    /// Unique name/identifier for this mesh
    name: String,

    /// Number of vertices used by this mesh
    vertex_count: u32,

    /// Indices into the parent asset's vertex buffer array
    vertex_buffer_ids: Vec<usize>,

    /// Index into the parent asset's index buffer array
    index_buffer_id: usize,

    /// Number of indices used by this mesh
    index_count: u32,

    /// Base vertex buffer description index
    base_vertex_declaration_id: usize,

    /// Draw ranges within this mesh
    submeshes: Vec<EnvironmentSubmesh>,

    /// Hash of the visibility controller path (scene graph)
    visibility_controller_path_hash: u32,

    /// Hash of a region placeable this mesh is anchored to (version >= 18)
    region_path_hash: u32,

    /// Whether to disable backface culling
    disable_backface_culling: bool,

    /// Axis-aligned bounding box
    bounding_box: AABB,

    /// World transform matrix
    transform: Mat4,

    /// Quality level flags
    quality: EnvironmentQuality,

    /// Visibility layer flags
    visibility: EnvironmentVisibility,

    /// Layer transition behavior
    layer_transition_behavior: VisibilityTransitionBehavior,

    /// Render flags
    render_flags: EnvironmentMeshRenderFlags,

    /// Point light position (version < 7 only)
    point_light: Option<Vec3>,

    /// Spherical harmonics coefficients for light probes (version < 9 only)
    spherical_harmonics: Option<[Vec3; 9]>,

    /// Stationary light channel (diffuse texture)
    stationary_light: EnvironmentAssetChannel,

    /// Baked light channel (lightmap texture)
    baked_light: EnvironmentAssetChannel,

    /// Baked paint channel
    baked_paint: EnvironmentAssetChannel,

    /// Texture overrides
    texture_overrides: Vec<MeshTextureOverride>,
}

/// Sampler indices for texture overrides
pub mod sampler {
    /// Diffuse/albedo texture sampler (typically overridden by baked paint)
    pub const DIFFUSE: u32 = 0;
}

/// Resolved diffuse texture information for a mesh.
///
/// When rendering a mesh, use this to determine which texture and UV channel
/// to use for the diffuse/albedo pass.
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedDiffuseTexture<'a> {
    /// The texture path to use
    pub texture: &'a str,
    /// Which UV channel to use (0 = primary, 1 = secondary/baked paint)
    pub uv_channel: u8,
    /// UV scale to apply (only meaningful when using baked paint)
    pub uv_scale: Vec2,
    /// UV offset/bias to apply (only meaningful when using baked paint)
    pub uv_offset: Vec2,
    /// Whether this is using a baked paint override
    pub is_baked_paint: bool,
}

impl EnvironmentMesh {
    /// Maximum number of submeshes (primitives) per mesh
    pub const MAX_SUBMESH_COUNT: usize = 64;

    /// Creates a name for a mesh with the given ID
    pub fn create_name(id: usize) -> String {
        format!("MapGeo_Instance_{}", id)
    }

    /// The unique name/identifier for this mesh
    #[inline]
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Number of vertices used by this mesh
    #[inline]
    pub fn vertex_count(&self) -> u32 {
        self.vertex_count
    }

    /// Indices into the parent asset's vertex buffer array
    #[inline]
    pub fn vertex_buffer_ids(&self) -> &[usize] {
        &self.vertex_buffer_ids
    }

    /// The buffer ids, which the reader renumbers past a dropped buffer.
    pub(crate) fn vertex_buffer_ids_mut(&mut self) -> &mut [usize] {
        &mut self.vertex_buffer_ids
    }

    /// Index into the parent asset's index buffer array
    #[inline]
    pub fn index_buffer_id(&self) -> usize {
        self.index_buffer_id
    }

    /// Number of indices used by this mesh
    #[inline]
    pub fn index_count(&self) -> u32 {
        self.index_count
    }

    /// Index of the first vertex declaration this mesh read, one per vertex buffer.
    ///
    /// The writer derives the declarations from the vertex buffers, and keeps this index
    /// where the declarations it names still match.
    #[inline]
    pub fn base_vertex_declaration_id(&self) -> usize {
        self.base_vertex_declaration_id
    }

    /// The draw ranges (submeshes) within this mesh
    #[inline]
    pub fn submeshes(&self) -> &[EnvironmentSubmesh] {
        &self.submeshes
    }

    /// Hash of the visibility controller path (scene graph this mesh belongs to)
    #[inline]
    pub fn visibility_controller_path_hash(&self) -> u32 {
        self.visibility_controller_path_hash
    }

    /// Sets the visibility controller path hash; `0` means none.
    ///
    /// The mesh's faces belong to the scene graph of this hash, so re-bake the scene graphs
    /// with [`EnvironmentAsset::bake_scene_graphs`](crate::EnvironmentAsset::bake_scene_graphs)
    /// if the mesh has faces in one.
    #[inline]
    pub fn set_visibility_controller_path_hash(&mut self, hash: u32) {
        self.visibility_controller_path_hash = hash;
    }

    /// Hash of a map region placeable this mesh is anchored to (version >= 18).
    ///
    /// This is the container-key ("path") hash of an item in the map's
    /// `MapPlaceableContainer` (materials.bin) — the same referencing scheme as
    /// [`visibility_controller_path_hash`](Self::visibility_controller_path_hash).
    /// When non-zero, the game positions this mesh via the referenced region
    /// entity instead of the static world origin, and may substitute `|flipped`
    /// material variants for mirrored placement. `0` means the mesh is not
    /// anchored to a region.
    #[inline]
    pub fn region_path_hash(&self) -> u32 {
        self.region_path_hash
    }

    /// Whether backface culling is disabled
    #[inline]
    pub fn disable_backface_culling(&self) -> bool {
        self.disable_backface_culling
    }

    /// The axis-aligned bounding box
    #[inline]
    pub fn bounding_box(&self) -> &AABB {
        &self.bounding_box
    }

    /// The world transform, ready to multiply a position by.
    ///
    /// The matrix is affine and carries its translation in `w_axis`. A vertex read out of
    /// this mesh's buffers is in model space; `transform * vertex` puts it in world space,
    /// inside [`bounding_box`](Self::bounding_box).
    #[inline]
    pub fn transform(&self) -> &Mat4 {
        &self.transform
    }

    /// The quality level flags
    #[inline]
    pub fn quality(&self) -> EnvironmentQuality {
        self.quality
    }

    /// The visibility layer flags
    #[inline]
    pub fn visibility(&self) -> EnvironmentVisibility {
        self.visibility
    }

    /// Sets the visibility layer flags
    #[inline]
    pub fn set_visibility(&mut self, visibility: EnvironmentVisibility) {
        self.visibility = visibility;
    }

    /// The layer transition behavior
    #[inline]
    pub fn layer_transition_behavior(&self) -> VisibilityTransitionBehavior {
        self.layer_transition_behavior
    }

    /// The render flags
    #[inline]
    pub fn render_flags(&self) -> EnvironmentMeshRenderFlags {
        self.render_flags
    }

    /// Point light position (only present in version < 7)
    #[inline]
    pub fn point_light(&self) -> Option<Vec3> {
        self.point_light
    }

    /// Spherical harmonics coefficients (only present in version < 9)
    #[inline]
    pub fn spherical_harmonics(&self) -> Option<&[Vec3; 9]> {
        self.spherical_harmonics.as_ref()
    }

    /// The stationary light channel (diffuse texture)
    #[inline]
    pub fn stationary_light(&self) -> &EnvironmentAssetChannel {
        &self.stationary_light
    }

    /// The baked light channel (lightmap texture)
    #[inline]
    pub fn baked_light(&self) -> &EnvironmentAssetChannel {
        &self.baked_light
    }

    /// Per-mesh texture overrides
    #[inline]
    pub fn texture_overrides(&self) -> &[MeshTextureOverride] {
        &self.texture_overrides
    }

    /// The baked paint channel
    #[inline]
    pub fn baked_paint(&self) -> &EnvironmentAssetChannel {
        &self.baked_paint
    }

    // ========================================================================
    // Texture Resolution API
    // ========================================================================

    /// Returns whether this mesh has a baked paint texture override.
    ///
    /// When true, the mesh's diffuse texture should be replaced with the
    /// baked paint texture, using the secondary UV channel with scale/bias.
    #[inline]
    pub fn has_baked_paint_override(&self) -> bool {
        // Check texture overrides first (version 17+)
        if let Some(override_tex) = self.find_texture_override(sampler::DIFFUSE) {
            return !override_tex.texture().is_empty();
        }
        // Fall back to baked_paint channel (version 12-16)
        !self.baked_paint.texture().is_empty()
    }

    /// Finds a texture override by sampler index.
    #[inline]
    pub fn find_texture_override(&self, sampler_index: u32) -> Option<&MeshTextureOverride> {
        self.texture_overrides
            .iter()
            .find(|o| o.sampler_index() == sampler_index)
    }

    /// Resolves the diffuse texture for this mesh, accounting for baked paint overrides.
    ///
    /// This method implements the texture resolution logic used when exporting to
    /// formats like GLTF:
    ///
    /// - If the mesh has a baked paint override (sampler index 0), returns the
    ///   override texture with UV channel 1 and scale/bias applied
    /// - Otherwise, returns the default diffuse texture path with UV channel 0
    ///
    /// # Arguments
    ///
    /// * `default_diffuse` - The default diffuse texture path from the material
    ///
    /// # Example
    ///
    /// ```ignore
    /// let resolved = mesh.resolve_diffuse_texture("textures/ground.dds");
    ///
    /// if resolved.is_baked_paint {
    ///     // Use UV channel 1 with scale/offset transforms
    ///     let uv = uv1 * resolved.uv_scale + resolved.uv_offset;
    /// } else {
    ///     // Use UV channel 0 directly
    ///     let uv = uv0;
    /// }
    /// ```
    pub fn resolve_diffuse_texture<'a>(
        &'a self,
        default_diffuse: &'a str,
    ) -> ResolvedDiffuseTexture<'a> {
        // Check for texture override at diffuse sampler (version 17+)
        if let Some(override_tex) = self.find_texture_override(sampler::DIFFUSE) {
            if !override_tex.texture().is_empty() {
                return ResolvedDiffuseTexture {
                    texture: override_tex.texture(),
                    uv_channel: 1,
                    uv_scale: self.baked_paint.scale(),
                    uv_offset: self.baked_paint.offset(),
                    is_baked_paint: true,
                };
            }
        }

        // Check baked_paint channel (version 12-16)
        if !self.baked_paint.texture().is_empty() {
            return ResolvedDiffuseTexture {
                texture: self.baked_paint.texture(),
                uv_channel: 1,
                uv_scale: self.baked_paint.scale(),
                uv_offset: self.baked_paint.offset(),
                is_baked_paint: true,
            };
        }

        // No override, use default diffuse with primary UV
        ResolvedDiffuseTexture {
            texture: default_diffuse,
            uv_channel: 0,
            uv_scale: Vec2::ONE,
            uv_offset: Vec2::ZERO,
            is_baked_paint: false,
        }
    }

    /// Returns the UV scale/bias for baked paint, if applicable.
    ///
    /// Returns `None` if the mesh doesn't use baked paint.
    /// Returns `Some((scale, offset))` with the UV transformation parameters.
    #[inline]
    pub fn baked_paint_uv_transform(&self) -> Option<(Vec2, Vec2)> {
        if self.has_baked_paint_override() {
            Some((self.baked_paint.scale(), self.baked_paint.offset()))
        } else {
            None
        }
    }
}

/// Builder for constructing [`EnvironmentMesh`] instances
pub(crate) struct EnvironmentMeshBuilder {
    name: String,
    vertex_count: u32,
    vertex_buffer_ids: Vec<usize>,
    index_buffer_id: usize,
    index_count: u32,
    base_vertex_declaration_id: usize,
    submeshes: Vec<EnvironmentSubmesh>,
    visibility_controller_path_hash: u32,
    region_path_hash: u32,
    disable_backface_culling: bool,
    bounding_box: AABB,
    transform: Mat4,
    quality: EnvironmentQuality,
    visibility: EnvironmentVisibility,
    layer_transition_behavior: VisibilityTransitionBehavior,
    render_flags: EnvironmentMeshRenderFlags,
    point_light: Option<Vec3>,
    spherical_harmonics: Option<[Vec3; 9]>,
    stationary_light: EnvironmentAssetChannel,
    baked_light: EnvironmentAssetChannel,
    baked_paint: EnvironmentAssetChannel,
    texture_overrides: Vec<MeshTextureOverride>,
}

impl Default for EnvironmentMeshBuilder {
    fn default() -> Self {
        Self {
            name: String::new(),
            vertex_count: 0,
            vertex_buffer_ids: Vec::new(),
            index_buffer_id: 0,
            index_count: 0,
            base_vertex_declaration_id: 0,
            submeshes: Vec::new(),
            visibility_controller_path_hash: 0,
            region_path_hash: 0,
            disable_backface_culling: false,
            bounding_box: AABB::default(),
            transform: Mat4::IDENTITY,
            quality: EnvironmentQuality::ALL,
            visibility: EnvironmentVisibility::ALL_LAYERS,
            layer_transition_behavior: VisibilityTransitionBehavior::default(),
            render_flags: EnvironmentMeshRenderFlags::default(),
            point_light: None,
            spherical_harmonics: None,
            stationary_light: EnvironmentAssetChannel::empty(),
            baked_light: EnvironmentAssetChannel::empty(),
            baked_paint: EnvironmentAssetChannel::empty(),
            texture_overrides: Vec::new(),
        }
    }
}

impl EnvironmentMeshBuilder {
    pub fn name(mut self, name: String) -> Self {
        self.name = name;
        self
    }

    pub fn vertex_count(mut self, count: u32) -> Self {
        self.vertex_count = count;
        self
    }

    pub fn vertex_buffer_ids(mut self, ids: Vec<usize>) -> Self {
        self.vertex_buffer_ids = ids;
        self
    }

    pub fn index_buffer_id(mut self, id: usize) -> Self {
        self.index_buffer_id = id;
        self
    }

    pub fn index_count(mut self, count: u32) -> Self {
        self.index_count = count;
        self
    }

    pub fn base_vertex_declaration_id(mut self, id: usize) -> Self {
        self.base_vertex_declaration_id = id;
        self
    }

    pub fn submeshes(mut self, submeshes: Vec<EnvironmentSubmesh>) -> Self {
        self.submeshes = submeshes;
        self
    }

    pub fn visibility_controller_path_hash(mut self, hash: u32) -> Self {
        self.visibility_controller_path_hash = hash;
        self
    }

    pub fn region_path_hash(mut self, hash: u32) -> Self {
        self.region_path_hash = hash;
        self
    }

    pub fn disable_backface_culling(mut self, disable: bool) -> Self {
        self.disable_backface_culling = disable;
        self
    }

    pub fn bounding_box(mut self, aabb: AABB) -> Self {
        self.bounding_box = aabb;
        self
    }

    pub fn transform(mut self, transform: Mat4) -> Self {
        self.transform = transform;
        self
    }

    pub fn quality(mut self, quality: EnvironmentQuality) -> Self {
        self.quality = quality;
        self
    }

    pub fn visibility(mut self, visibility: EnvironmentVisibility) -> Self {
        self.visibility = visibility;
        self
    }

    pub fn layer_transition_behavior(mut self, behavior: VisibilityTransitionBehavior) -> Self {
        self.layer_transition_behavior = behavior;
        self
    }

    pub fn render_flags(mut self, flags: EnvironmentMeshRenderFlags) -> Self {
        self.render_flags = flags;
        self
    }

    pub fn point_light(mut self, light: Option<Vec3>) -> Self {
        self.point_light = light;
        self
    }

    pub fn spherical_harmonics(mut self, sh: Option<[Vec3; 9]>) -> Self {
        self.spherical_harmonics = sh;
        self
    }

    pub fn stationary_light(mut self, channel: EnvironmentAssetChannel) -> Self {
        self.stationary_light = channel;
        self
    }

    pub fn baked_light(mut self, channel: EnvironmentAssetChannel) -> Self {
        self.baked_light = channel;
        self
    }

    pub fn texture_overrides(mut self, overrides: Vec<MeshTextureOverride>) -> Self {
        self.texture_overrides = overrides;
        self
    }

    pub fn baked_paint(mut self, channel: EnvironmentAssetChannel) -> Self {
        self.baked_paint = channel;
        self
    }

    pub fn build(self) -> EnvironmentMesh {
        EnvironmentMesh {
            name: self.name,
            vertex_count: self.vertex_count,
            vertex_buffer_ids: self.vertex_buffer_ids,
            index_buffer_id: self.index_buffer_id,
            index_count: self.index_count,
            base_vertex_declaration_id: self.base_vertex_declaration_id,
            submeshes: self.submeshes,
            visibility_controller_path_hash: self.visibility_controller_path_hash,
            region_path_hash: self.region_path_hash,
            disable_backface_culling: self.disable_backface_culling,
            bounding_box: self.bounding_box,
            transform: self.transform,
            quality: self.quality,
            visibility: self.visibility,
            layer_transition_behavior: self.layer_transition_behavior,
            render_flags: self.render_flags,
            point_light: self.point_light,
            spherical_harmonics: self.spherical_harmonics,
            stationary_light: self.stationary_light,
            baked_light: self.baked_light,
            baked_paint: self.baked_paint,
            texture_overrides: self.texture_overrides,
        }
    }
}
