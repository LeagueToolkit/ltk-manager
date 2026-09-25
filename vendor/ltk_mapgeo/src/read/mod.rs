//! Map geometry file parsing implementation
//!
//! This module contains the parsing logic for `.mapgeo` files.

mod version;
pub(crate) use version::MapGeoVersion;

mod channel;
mod mesh;
mod reflector;
mod scene_graph;
mod submesh;

use std::io::{Read, Seek, SeekFrom};

use byteorder::{ReadBytesExt, LE};
use ltk_io_ext::ReaderExt;
use ltk_mesh::mem::vertex::{ElementFormat, ElementName};
use ltk_mesh::mem::{
    IndexBuffer, VertexBuffer, VertexBufferDescription, VertexBufferUsage, VertexElement,
};

use crate::{
    BucketedGeometry, EnvironmentAsset, EnvironmentMesh, ParseError, PlanarReflector, Result,
    ShaderTextureOverride, MAGIC, SUPPORTED_VERSIONS,
};

const MAX_VERTEX_ELEMENTS_IN_DECL: usize = 15;

impl EnvironmentAsset {
    /// Reads an environment asset from a binary stream.
    ///
    /// The reader drops a vertex buffer that no mesh references. The meshes' buffer ids index
    /// the buffers that remain.
    ///
    /// # Arguments
    ///
    /// * `reader` - A reader that implements `Read` and `Seek`
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - The file signature is invalid (expected "OEGM")
    /// - The file version is not supported
    /// - Any IO error occurs during reading
    ///
    /// # Example
    ///
    /// ```ignore
    /// use ltk_mapgeo::EnvironmentAsset;
    /// use std::fs::File;
    ///
    /// let mut file = File::open("base.mapgeo")?;
    /// let asset = EnvironmentAsset::from_reader(&mut file)?;
    /// ```
    pub fn from_reader<R: Read + Seek>(reader: &mut R) -> Result<Self> {
        let mut magic = [0u8; 4];
        reader.read_exact(&mut magic)?;
        if &magic != MAGIC {
            return Err(ParseError::InvalidFileSignature);
        }

        // Read version
        let version = reader.read_u32::<LE>()?;

        if !SUPPORTED_VERSIONS.contains(&version) {
            return Err(ParseError::UnsupportedVersion(version));
        }

        let version = MapGeoVersion(version);

        // Version < 7 has an extra flag in the header
        let use_separate_point_lights = if version.has_separate_point_lights_flag() {
            reader.read_u8()? != 0
        } else {
            false
        };

        let shader_texture_overrides = Self::read_shader_texture_overrides(reader, version)?;
        let vertex_declarations = Self::read_vertex_declarations(reader)?;

        // Vertex buffers: we record offsets/sizes and defer reading until meshes provide declarations.
        let vertex_buffer_count = reader.read_u32::<LE>()? as usize;
        let mut vertex_buffer_offsets = Vec::with_capacity(vertex_buffer_count);
        let mut vertex_buffer_sizes = Vec::with_capacity(vertex_buffer_count);

        for _ in 0..vertex_buffer_count {
            // visibility flags exist for >= 13, but we don't currently persist them
            if version.has_early_visibility_flags() {
                let _ = reader.read_u8()?;
            }
            let buffer_size = reader.read_u32::<LE>()? as u64;

            let offset = reader.stream_position()?;
            vertex_buffer_offsets.push(offset);
            vertex_buffer_sizes.push(buffer_size);
            reader.seek(SeekFrom::Current(buffer_size as i64))?;
        }

        let index_buffers = Self::read_index_buffers(reader, version)?;
        let mut meshes = Self::read_meshes(reader, version, use_separate_point_lights)?;
        let scene_graphs = Self::read_scene_graphs(reader, version)?;
        let reflection_planes = if version.has_planar_reflectors() {
            Self::read_reflection_planes(reader)?
        } else {
            vec![]
        };

        // Validate mesh buffer indices & infer vertex-buffer declarations from mesh references
        let mut vb_plan: Vec<Option<(VertexBufferDescription, usize)>> =
            vec![None; vertex_buffer_count];

        let vb_max = vertex_buffer_count.saturating_sub(1);
        let ib_len = index_buffers.len();
        let ib_max = ib_len.saturating_sub(1);
        let vd_max = vertex_declarations.len().saturating_sub(1);

        for mesh in &meshes {
            // Validate index buffer
            let ib_id = mesh.index_buffer_id();
            if ib_id >= ib_len {
                return Err(ParseError::IndexBufferIndexOutOfBounds {
                    index: ib_id,
                    max: ib_max,
                });
            }

            let base_decl = mesh.base_vertex_declaration_id();
            for (stream_idx, &vb_id) in mesh.vertex_buffer_ids().iter().enumerate() {
                if vb_id >= vertex_buffer_count {
                    return Err(ParseError::VertexBufferIndexOutOfBounds {
                        index: vb_id,
                        max: vb_max,
                    });
                }

                let decl_index = base_decl + stream_idx;
                if decl_index >= vertex_declarations.len() {
                    return Err(ParseError::VertexDeclarationIndexOutOfBounds {
                        index: decl_index,
                        max: vd_max,
                    });
                }

                let desc = vertex_declarations[decl_index].clone();
                let vcount = mesh.vertex_count() as usize;

                match &vb_plan[vb_id] {
                    None => vb_plan[vb_id] = Some((desc, vcount)),
                    Some((existing_desc, existing_vcount)) => {
                        if existing_desc != &desc || *existing_vcount != vcount {
                            return Err(ParseError::AmbiguousVertexBufferDeclaration {
                                index: vb_id,
                            });
                        }
                    }
                }
            }
        }

        // Materialize vertex buffers from their offsets/sizes using the inferred declarations.
        // A buffer no mesh references has no declaration, and the client never draws it. The
        // reader drops the buffer and renumbers the meshes' buffer ids past it.
        let mut vertex_buffers = Vec::with_capacity(vertex_buffer_count);
        let mut renumbered = vec![usize::MAX; vertex_buffer_count];
        for vb_id in 0..vertex_buffer_count {
            let Some((desc, expected_vertex_count)) = vb_plan[vb_id].clone() else {
                continue;
            };
            renumbered[vb_id] = vertex_buffers.len();

            reader.seek(SeekFrom::Start(vertex_buffer_offsets[vb_id]))?;
            let size = vertex_buffer_sizes[vb_id] as usize;
            let mut buf = vec![0u8; size];
            reader.read_exact(&mut buf)?;

            let vb = VertexBuffer::new(desc, buf);
            let decoded = vb.count();
            if decoded != expected_vertex_count {
                return Err(ParseError::VertexBufferVertexCountMismatch {
                    index: vb_id,
                    decoded,
                    expected: expected_vertex_count,
                });
            }

            vertex_buffers.push(vb);
        }

        if vertex_buffers.len() != vertex_buffer_count {
            for mesh in &mut meshes {
                for id in mesh.vertex_buffer_ids_mut() {
                    *id = renumbered[*id];
                }
            }
        }

        Ok(EnvironmentAsset::builder()
            .shader_texture_overrides(shader_texture_overrides)
            .meshes(meshes)
            .scene_graphs(scene_graphs)
            .planar_reflectors(reflection_planes)
            .vertex_buffers(vertex_buffers)
            .index_buffers(index_buffers)
            .vertex_declarations(vertex_declarations)
            .build())
    }

    fn read_shader_texture_overrides<R: Read + Seek>(
        reader: &mut R,
        version: MapGeoVersion,
    ) -> Result<Vec<ShaderTextureOverride>> {
        let mut overrides = Vec::new();

        // Mirrors LeagueToolkit's EnvironmentAsset.ReadSamplerDefs(...)
        if version.has_new_shader_override_format() {
            let count = reader.read_i32::<LE>()? as usize;
            overrides.reserve(count);
            for _ in 0..count {
                let sampler_index = reader.read_u32::<LE>()?;
                let sampler_name = reader.read_sized_string_u32::<LE>()?;
                overrides.push(ShaderTextureOverride::new(sampler_index, sampler_name));
            }
            return Ok(overrides);
        }

        if version.has_first_shader_override() {
            let sampler_name = reader.read_sized_string_u32::<LE>()?;
            overrides.push(ShaderTextureOverride::new(0, sampler_name));
        }

        if version.has_second_shader_override() {
            let sampler_name = reader.read_sized_string_u32::<LE>()?;
            overrides.push(ShaderTextureOverride::new(1, sampler_name));
        }

        Ok(overrides)
    }

    fn read_vertex_declarations<R: Read + Seek>(
        reader: &mut R,
    ) -> Result<Vec<VertexBufferDescription>> {
        let vertex_declaration_count = reader.read_u32::<LE>()? as usize;
        let mut vertex_declarations = Vec::with_capacity(vertex_declaration_count);
        for _ in 0..vertex_declaration_count {
            vertex_declarations.push(Self::read_vertex_buffer_description(reader)?);
        }
        Ok(vertex_declarations)
    }

    fn read_vertex_buffer_description<R: Read + Seek>(
        reader: &mut R,
    ) -> Result<VertexBufferDescription> {
        let usage = VertexBufferUsage::try_from(reader.read_u32::<LE>()?)
            .unwrap_or(VertexBufferUsage::Static);

        let element_count = reader.read_u32::<LE>()? as usize;
        if element_count > MAX_VERTEX_ELEMENTS_IN_DECL {
            return Err(ParseError::InvalidVertexElementCount {
                count: element_count as u32,
            });
        }

        let mut elements = Vec::with_capacity(element_count);
        for _ in 0..element_count {
            let name_raw = reader.read_u32::<LE>()?;
            let format_raw = reader.read_u32::<LE>()?;

            let name = ElementName::try_from(name_raw)
                .map_err(|_| ParseError::InvalidElementName(name_raw))?;
            let format = ElementFormat::try_from(format_raw)
                .map_err(|_| ParseError::InvalidElementFormat(format_raw))?;

            elements.push(VertexElement { name, format });
        }

        // Skip past unused default elements (15 total, each element = 8 bytes)
        let remaining = MAX_VERTEX_ELEMENTS_IN_DECL - element_count;
        reader.seek(SeekFrom::Current((8 * remaining) as i64))?;

        Ok(VertexBufferDescription::new(usage, elements))
    }

    fn read_index_buffers<R: Read>(
        reader: &mut R,
        version: MapGeoVersion,
    ) -> Result<Vec<IndexBuffer<u16>>> {
        let index_buffer_count = reader.read_u32::<LE>()? as usize;
        let mut index_buffers = Vec::with_capacity(index_buffer_count);
        for _ in 0..index_buffer_count {
            if version.has_early_visibility_flags() {
                let _ = reader.read_u8()?;
            }

            let buffer_size = reader.read_i32::<LE>()? as usize;
            let mut buf = vec![0u8; buffer_size];
            reader.read_exact(&mut buf)?;
            index_buffers.push(IndexBuffer::<u16>::new(buf));
        }
        Ok(index_buffers)
    }

    fn read_meshes<R: Read>(
        reader: &mut R,
        version: MapGeoVersion,
        use_separate_point_lights: bool,
    ) -> Result<Vec<EnvironmentMesh>> {
        let mesh_count = reader.read_u32::<LE>()? as usize;
        let mut meshes = Vec::with_capacity(mesh_count);
        for id in 0..mesh_count {
            meshes.push(crate::EnvironmentMesh::read(
                reader,
                id,
                version,
                use_separate_point_lights,
            )?);
        }
        Ok(meshes)
    }

    fn read_scene_graphs<R: Read>(
        reader: &mut R,
        version: MapGeoVersion,
    ) -> Result<Vec<BucketedGeometry>> {
        if !version.has_multiple_scene_graphs() {
            return Ok(vec![BucketedGeometry::read(reader, true, version)?]);
        }

        let count = reader.read_u32::<LE>()? as usize;
        let mut graphs = Vec::with_capacity(count);
        for _ in 0..count {
            graphs.push(BucketedGeometry::read(reader, false, version)?);
        }
        Ok(graphs)
    }

    fn read_reflection_planes<R: Read>(reader: &mut R) -> Result<Vec<PlanarReflector>> {
        let count = reader.read_u32::<LE>()? as usize;
        let mut planes = Vec::with_capacity(count);
        for _ in 0..count {
            planes.push(PlanarReflector::read(reader)?);
        }
        Ok(planes)
    }
}
