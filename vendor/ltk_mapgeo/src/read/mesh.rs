//! Environment mesh parsing

use std::io::Read;

use byteorder::{ReadBytesExt, LE};
use ltk_io_ext::ReaderExt;

use super::MapGeoVersion;
use crate::{
    mesh::EnvironmentMeshBuilder, EnvironmentAssetChannel, EnvironmentMesh,
    EnvironmentMeshRenderFlags, EnvironmentQuality, EnvironmentSubmesh, EnvironmentVisibility,
    MeshTextureOverride, Result, VisibilityTransitionBehavior,
};

impl EnvironmentMesh {
    /// Reads an environment mesh from a binary stream
    pub(crate) fn read<R: Read>(
        reader: &mut R,
        id: usize,
        version: MapGeoVersion,
        use_separate_point_lights: bool,
    ) -> Result<Self> {
        // Read name (version <= 11) or generate from ID
        let name = if version.has_mesh_names() {
            reader.read_sized_string_u32::<LE>()?
        } else {
            Self::create_name(id)
        };

        // Read vertex buffer references
        let vertex_count = reader.read_i32::<LE>()? as u32;
        let vertex_declaration_count = reader.read_u32::<LE>()?;
        let base_vertex_declaration_id = reader.read_i32::<LE>()? as usize;

        let mut vertex_buffer_ids = Vec::with_capacity(vertex_declaration_count as usize);
        for _ in 0..vertex_declaration_count {
            vertex_buffer_ids.push(reader.read_i32::<LE>()? as usize);
        }

        // Read index buffer reference
        let index_count = reader.read_u32::<LE>()?;
        let index_buffer_id = reader.read_i32::<LE>()? as usize;

        // Read visibility flags (version >= 13, early position)
        let mut visibility = EnvironmentVisibility::ALL_LAYERS;
        if version.has_early_visibility_flags() {
            visibility = EnvironmentVisibility::from_bits_truncate(reader.read_u8()?);
        }

        // Read region path hash (version >= 18); references a region placeable
        // in the map's MapPlaceableContainer by container-key hash
        let region_path_hash = if version.has_region_path_hash() {
            reader.read_u32::<LE>()?
        } else {
            0
        };

        // Read visibility controller path hash (version >= 15)
        let visibility_controller_path_hash = if version.has_visibility_controller_path_hash() {
            reader.read_u32::<LE>()?
        } else {
            0
        };

        // Read submeshes
        let submesh_count = reader.read_u32::<LE>()?;
        let mut submeshes = Vec::with_capacity(submesh_count as usize);
        for _ in 0..submesh_count {
            submeshes.push(EnvironmentSubmesh::read(reader)?);
        }

        // Read backface culling flag (all versions except 5)
        let disable_backface_culling = if version.has_backface_culling_flag() {
            reader.read_u8()? != 0
        } else {
            false
        };

        // Read bounding box and transform. The file stores the matrix's columns in order,
        // which is glam's own storage order — translation sits in floats 12 to 14.
        let bounding_box = reader.read_aabb::<LE>()?;
        let transform = reader.read_mat4_col_major::<LE>()?;

        // Read quality filter
        let quality = EnvironmentQuality::from_bits_retain(reader.read_u8()?);

        // Read visibility flags (version >= 7 && <= 12, mid position)
        if version.has_mid_visibility_flags() {
            visibility = EnvironmentVisibility::from_bits_truncate(reader.read_u8()?);
        }

        // Read render flags and transition behavior
        let mut render_flags = EnvironmentMeshRenderFlags::default();
        let mut layer_transition_behavior = VisibilityTransitionBehavior::default();

        if version.has_old_render_flags() {
            render_flags = EnvironmentMeshRenderFlags::from_bits_retain(reader.read_u8()? as u16);
            layer_transition_behavior =
                if render_flags.contains(EnvironmentMeshRenderFlags::IS_DECAL) {
                    VisibilityTransitionBehavior::TurnVisibleDoesMatchNewLayerFilter
                } else {
                    VisibilityTransitionBehavior::Unaffected
                };
        } else if version.has_new_render_flags() {
            layer_transition_behavior =
                VisibilityTransitionBehavior::try_from(reader.read_u8()?).unwrap_or_default();

            render_flags = if version.has_u16_render_flags() {
                EnvironmentMeshRenderFlags::from_bits_retain(reader.read_u16::<LE>()?)
            } else {
                EnvironmentMeshRenderFlags::from_bits_retain(reader.read_u8()? as u16)
            };
        }

        // Read point light (version < 7 with separate point lights)
        let point_light = if use_separate_point_lights && version.has_separate_point_lights_flag() {
            Some(reader.read_vec3::<LE>()?)
        } else {
            None
        };

        // Read spherical harmonics and lighting channels
        let spherical_harmonics;
        let baked_light;
        let stationary_light;
        let mut baked_paint;
        let mut texture_overrides = Vec::new();

        if version.has_spherical_harmonics() {
            // Version < 9: spherical harmonics + baked light only
            let mut sh = [glam::Vec3::ZERO; 9];
            for coeff in &mut sh {
                *coeff = reader.read_vec3::<LE>()?;
            }
            spherical_harmonics = Some(sh);
            baked_light = EnvironmentAssetChannel::read(reader)?;
            stationary_light = EnvironmentAssetChannel::empty();
            baked_paint = EnvironmentAssetChannel::empty();
        } else {
            // Version >= 9: baked light + stationary light
            spherical_harmonics = None;
            baked_light = EnvironmentAssetChannel::read(reader)?;
            stationary_light = EnvironmentAssetChannel::read(reader)?;

            // Version 12-16: old baked paint format
            if version.has_old_baked_paint() {
                baked_paint = EnvironmentAssetChannel::read(reader)?;
            } else {
                baked_paint = EnvironmentAssetChannel::empty();
            }

            // Version 17+: new texture overrides format
            if version.has_texture_overrides() {
                let override_count = reader.read_i32::<LE>()? as usize;
                texture_overrides.clear();
                texture_overrides.reserve(override_count);
                for _ in 0..override_count {
                    texture_overrides.push(MeshTextureOverride::read(reader)?);
                }

                let baked_paint_scale = reader.read_vec2::<LE>()?;
                let baked_paint_bias = reader.read_vec2::<LE>()?;
                baked_paint = EnvironmentAssetChannel::new(
                    String::new(),
                    baked_paint_scale,
                    baked_paint_bias,
                );
            }
        }

        // Unshipped versions add more per-mesh data here: v19 a single dead
        // u8, v20 a length-prefixed MapGeoExtension reflection blob. The game
        // client parses and discards both, so we don't read them — see the
        // module docs in `read/version.rs` for the full layout.

        Ok(EnvironmentMeshBuilder::default()
            .name(name)
            .vertex_count(vertex_count)
            .vertex_buffer_ids(vertex_buffer_ids)
            .index_buffer_id(index_buffer_id)
            .index_count(index_count)
            .base_vertex_declaration_id(base_vertex_declaration_id)
            .submeshes(submeshes)
            .visibility_controller_path_hash(visibility_controller_path_hash)
            .region_path_hash(region_path_hash)
            .disable_backface_culling(disable_backface_culling)
            .bounding_box(bounding_box)
            .transform(transform)
            .quality(quality)
            .visibility(visibility)
            .layer_transition_behavior(layer_transition_behavior)
            .render_flags(render_flags)
            .point_light(point_light)
            .spherical_harmonics(spherical_harmonics)
            .stationary_light(stationary_light)
            .baked_light(baked_light)
            .baked_paint(baked_paint)
            .texture_overrides(texture_overrides)
            .build())
    }
}
