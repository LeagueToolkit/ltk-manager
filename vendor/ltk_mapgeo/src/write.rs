//! Writing `.mapgeo` files
//!
//! The writer produces [`WRITE_VERSION`] only. Assets read from older versions are written in
//! the newest layout, and fields that layout does not store are dropped.

use std::io::Write;

use byteorder::{WriteBytesExt, LE};
use ltk_io_ext::WriterExt;
use ltk_mesh::mem::VertexBufferDescription;

use crate::{
    scene_graph::BucketedGeometryFlags, BucketedGeometry, EnvironmentAsset,
    EnvironmentAssetChannel, EnvironmentMesh, EnvironmentSubmesh, GeometryBucket, PlanarReflector,
    WriteError, MAGIC,
};

/// The version [`EnvironmentAsset::to_writer`] writes.
pub const WRITE_VERSION: u32 = 18;

/// Vertex declarations hold this many element slots, used or not.
const DECLARATION_SLOTS: usize = 15;

/// What shipped files write in an unused declaration slot: `Position` as `XYZ_Float32`.
const UNUSED_SLOT: (u32, u32) = (0, 3);

type Result<T> = std::result::Result<T, WriteError>;

impl EnvironmentAsset {
    /// Writes the asset as a version [`WRITE_VERSION`] `.mapgeo`.
    ///
    /// An asset read from a version 18 file is written back byte for byte. The vertex
    /// declaration table and the visibility byte of each buffer are derived from the meshes, so
    /// meshes may be added, removed or changed freely. Scene graphs are written as they are;
    /// re-bake them with [`EnvironmentAsset::bake_scene_graphs`] after changing geometry.
    ///
    /// Fields that version 18 does not store are dropped: mesh names, spherical harmonics, point
    /// lights, and the texture of the baked paint channel.
    ///
    /// # Errors
    ///
    /// - [`WriteError::MissingVertexBuffer`] or [`WriteError::MissingIndexBuffer`] if a mesh
    ///   refers to a buffer the asset does not have.
    /// - [`WriteError::VertexCountMismatch`] if a vertex buffer does not hold exactly the
    ///   vertex count of a mesh that uses it.
    /// - [`WriteError::IndexCountOutOfBounds`] if a mesh uses more indices than its index
    ///   buffer holds.
    /// - [`WriteError::UnreferencedVertexBuffer`] if no mesh uses a vertex buffer. Readers
    ///   take a buffer's layout from the meshes, so they could not read it back.
    /// - [`WriteError::TooManyVertexElements`] if a vertex layout has more than 15 elements.
    /// - [`WriteError::DisabledSceneGraph`] if a scene graph is disabled, which the client
    ///   refuses to load.
    /// - [`WriteError::TooLarge`] if a count or size does not fit its field.
    /// - [`WriteError::Io`] if writing fails.
    pub fn to_writer<W: Write + ?Sized>(&self, writer: &mut W) -> Result<()> {
        self.check_buffers()?;
        let (declarations, bases) = self.declaration_table()?;
        for (index, graph) in self.scene_graphs().iter().enumerate() {
            if graph.is_disabled() {
                return Err(WriteError::DisabledSceneGraph { index });
            }
        }

        writer.write_all(MAGIC)?;
        writer.write_u32::<LE>(WRITE_VERSION)?;

        write_count(
            writer,
            self.shader_texture_overrides().len(),
            "shader texture overrides",
        )?;
        for o in self.shader_texture_overrides() {
            writer.write_u32::<LE>(o.sampler_index())?;
            write_string(writer, o.sampler_name())?;
        }

        write_count(writer, declarations.len(), "vertex declarations")?;
        for declaration in &declarations {
            write_declaration(writer, declaration)?;
        }

        let (vertex_visibility, index_visibility) = self.buffer_visibility();
        write_count(writer, self.vertex_buffers().len(), "vertex buffers")?;
        for (buffer, visibility) in self.vertex_buffers().iter().zip(vertex_visibility) {
            writer.write_u8(visibility)?;
            write_bytes(writer, buffer.as_bytes(), "vertex buffer")?;
        }
        write_count(writer, self.index_buffers().len(), "index buffers")?;
        for (buffer, visibility) in self.index_buffers().iter().zip(index_visibility) {
            writer.write_u8(visibility)?;
            write_bytes(writer, buffer.as_bytes(), "index buffer")?;
        }

        write_count(writer, self.meshes().len(), "meshes")?;
        for (mesh, base) in self.meshes().iter().zip(bases) {
            mesh.write(writer, base)?;
        }

        write_count(writer, self.scene_graphs().len(), "scene graphs")?;
        for graph in self.scene_graphs() {
            graph.write(writer)?;
        }

        write_count(writer, self.planar_reflectors().len(), "planar reflectors")?;
        for reflector in self.planar_reflectors() {
            reflector.write(writer)?;
        }
        Ok(())
    }

    /// The vertex declarations to write, and the base declaration of each mesh.
    ///
    /// A mesh reads one declaration per vertex buffer, from consecutive entries. Entries of the
    /// table as read are reused where they still match, in their order; entries no mesh uses
    /// are dropped, and layouts the table lacks are appended.
    fn declaration_table(&self) -> Result<(Vec<VertexBufferDescription>, Vec<usize>)> {
        let recorded = &self.vertex_declarations;
        let mut appended: Vec<VertexBufferDescription> = Vec::new();
        // Each mesh's run, as (in the recorded table, start).
        let mut runs = Vec::with_capacity(self.meshes().len());
        for (mesh_index, mesh) in self.meshes().iter().enumerate() {
            let streams = mesh
                .vertex_buffer_ids()
                .iter()
                .map(|&index| {
                    self.vertex_buffers()
                        .get(index)
                        .map(|b| b.description().clone())
                        .ok_or(WriteError::MissingVertexBuffer {
                            mesh: mesh_index,
                            index,
                        })
                })
                .collect::<Result<Vec<_>>>()?;
            let base = mesh.base_vertex_declaration_id();
            let run = if recorded.get(base..base + streams.len()) == Some(&streams[..]) {
                (true, base)
            } else if let Some(start) = find_run(recorded, &streams) {
                (true, start)
            } else if let Some(start) = find_run(&appended, &streams) {
                (false, start)
            } else {
                appended.extend(streams.iter().cloned());
                (false, appended.len() - streams.len())
            };
            runs.push((run, streams.len()));
        }

        let mut used = vec![false; recorded.len()];
        for &((in_recorded, start), len) in &runs {
            if in_recorded {
                used[start..start + len].fill(true);
            }
        }
        let mut new_index = vec![0; recorded.len()];
        let mut table = Vec::with_capacity(recorded.len() + appended.len());
        for (i, declaration) in recorded.iter().enumerate() {
            if used[i] {
                new_index[i] = table.len();
                table.push(declaration.clone());
            }
        }
        let appended_at = table.len();
        table.extend(appended);

        let bases = runs
            .iter()
            .map(|&((in_recorded, start), len)| match (in_recorded, len) {
                // A mesh with no vertex buffers reads no declaration; keep it in range.
                (_, 0) => 0,
                (true, _) => new_index[start],
                (false, _) => appended_at + start,
            })
            .collect();
        Ok((table, bases))
    }

    /// Checks that every buffer a mesh uses exists and fits it.
    fn check_buffers(&self) -> Result<()> {
        let mut referenced = vec![false; self.vertex_buffers().len()];
        for (mesh_index, mesh) in self.meshes().iter().enumerate() {
            for &index in mesh.vertex_buffer_ids() {
                let buffer =
                    self.vertex_buffers()
                        .get(index)
                        .ok_or(WriteError::MissingVertexBuffer {
                            mesh: mesh_index,
                            index,
                        })?;
                referenced[index] = true;
                if buffer.count() != mesh.vertex_count() as usize {
                    return Err(WriteError::VertexCountMismatch {
                        mesh: mesh_index,
                        buffer: index,
                        expected: mesh.vertex_count() as usize,
                        actual: buffer.count(),
                    });
                }
            }
            let index = mesh.index_buffer_id();
            let buffer = self
                .index_buffers()
                .get(index)
                .ok_or(WriteError::MissingIndexBuffer {
                    mesh: mesh_index,
                    index,
                })?;
            if mesh.index_count() as usize > buffer.count() {
                return Err(WriteError::IndexCountOutOfBounds {
                    mesh: mesh_index,
                    index_count: mesh.index_count() as usize,
                    buffer_len: buffer.count(),
                });
            }
        }
        match referenced.iter().position(|&r| !r) {
            Some(index) => Err(WriteError::UnreferencedVertexBuffer { index }),
            None => Ok(()),
        }
    }

    /// The visibility byte of each vertex and index buffer: the union of the visibility of
    /// the meshes that use it.
    fn buffer_visibility(&self) -> (Vec<u8>, Vec<u8>) {
        let mut vertex = vec![0u8; self.vertex_buffers().len()];
        let mut index = vec![0u8; self.index_buffers().len()];
        for mesh in self.meshes() {
            let bits = mesh.visibility().bits();
            for &id in mesh.vertex_buffer_ids() {
                vertex[id] |= bits;
            }
            index[mesh.index_buffer_id()] |= bits;
        }
        (vertex, index)
    }
}

/// Where `run` sits as consecutive entries of `table`.
fn find_run(table: &[VertexBufferDescription], run: &[VertexBufferDescription]) -> Option<usize> {
    if run.is_empty() {
        return Some(0);
    }
    table.windows(run.len()).position(|w| w == run)
}

fn write_count<W: Write + ?Sized>(writer: &mut W, count: usize, what: &'static str) -> Result<()> {
    let count = u32::try_from(count).map_err(|_| WriteError::TooLarge(what))?;
    writer.write_u32::<LE>(count)?;
    Ok(())
}

fn write_i32<W: Write + ?Sized>(writer: &mut W, value: usize, what: &'static str) -> Result<()> {
    let value = i32::try_from(value).map_err(|_| WriteError::TooLarge(what))?;
    writer.write_i32::<LE>(value)?;
    Ok(())
}

fn write_string<W: Write + ?Sized>(writer: &mut W, value: &str) -> Result<()> {
    write_bytes(writer, value.as_bytes(), "string")
}

fn write_bytes<W: Write + ?Sized>(writer: &mut W, bytes: &[u8], what: &'static str) -> Result<()> {
    write_count(writer, bytes.len(), what)?;
    writer.write_all(bytes)?;
    Ok(())
}

fn write_declaration<W: Write + ?Sized>(
    writer: &mut W,
    declaration: &VertexBufferDescription,
) -> Result<()> {
    let elements = declaration.elements();
    if elements.len() > DECLARATION_SLOTS {
        return Err(WriteError::TooManyVertexElements {
            count: elements.len(),
        });
    }
    writer.write_u32::<LE>(declaration.usage().into())?;
    writer.write_u32::<LE>(elements.len() as u32)?;
    for element in elements {
        writer.write_u32::<LE>(element.name as u32)?;
        writer.write_u32::<LE>(element.format as u32)?;
    }
    for _ in elements.len()..DECLARATION_SLOTS {
        writer.write_u32::<LE>(UNUSED_SLOT.0)?;
        writer.write_u32::<LE>(UNUSED_SLOT.1)?;
    }
    Ok(())
}

fn write_channel<W: Write + ?Sized>(
    writer: &mut W,
    channel: &EnvironmentAssetChannel,
) -> Result<()> {
    write_string(writer, channel.texture())?;
    writer.write_vec2::<LE>(channel.scale())?;
    writer.write_vec2::<LE>(channel.offset())?;
    Ok(())
}

impl EnvironmentMesh {
    fn write<W: Write + ?Sized>(&self, writer: &mut W, base_declaration: usize) -> Result<()> {
        write_i32(writer, self.vertex_count() as usize, "mesh vertex count")?;
        write_count(
            writer,
            self.vertex_buffer_ids().len(),
            "mesh vertex buffers",
        )?;
        write_i32(writer, base_declaration, "vertex declaration index")?;
        for &id in self.vertex_buffer_ids() {
            write_i32(writer, id, "vertex buffer index")?;
        }
        writer.write_u32::<LE>(self.index_count())?;
        write_i32(writer, self.index_buffer_id(), "index buffer index")?;
        writer.write_u8(self.visibility().bits())?;
        writer.write_u32::<LE>(self.region_path_hash())?;
        writer.write_u32::<LE>(self.visibility_controller_path_hash())?;

        write_count(writer, self.submeshes().len(), "submeshes")?;
        for submesh in self.submeshes() {
            submesh.write(writer)?;
        }

        writer.write_u8(self.disable_backface_culling().into())?;
        writer.write_aabb::<LE>(self.bounding_box())?;
        writer.write_mat4_col_major::<LE>(*self.transform())?;
        writer.write_u8(self.quality().bits())?;
        writer.write_u8(self.layer_transition_behavior() as u8)?;
        writer.write_u16::<LE>(self.render_flags().bits())?;

        write_channel(writer, self.baked_light())?;
        write_channel(writer, self.stationary_light())?;
        write_count(writer, self.texture_overrides().len(), "texture overrides")?;
        for o in self.texture_overrides() {
            writer.write_u32::<LE>(o.sampler_index())?;
            write_string(writer, o.texture())?;
        }
        writer.write_vec2::<LE>(self.baked_paint().scale())?;
        writer.write_vec2::<LE>(self.baked_paint().offset())?;
        Ok(())
    }
}

impl EnvironmentSubmesh {
    fn write<W: Write + ?Sized>(&self, writer: &mut W) -> Result<()> {
        writer.write_u32::<LE>(self.material_hash())?;
        write_string(writer, self.material())?;
        writer.write_i32::<LE>(self.start_index())?;
        writer.write_i32::<LE>(self.index_count())?;
        writer.write_i32::<LE>(self.min_vertex())?;
        writer.write_i32::<LE>(self.max_vertex())?;
        Ok(())
    }
}

impl BucketedGeometry {
    fn write<W: Write + ?Sized>(&self, writer: &mut W) -> Result<()> {
        writer.write_u32::<LE>(self.region_path_hash())?;
        writer.write_u32::<LE>(self.visibility_controller_path_hash())?;
        writer.write_vec2::<LE>(self.min_bounds())?;
        writer.write_vec2::<LE>(self.max_bounds())?;
        writer.write_vec2::<LE>(self.max_stick_out())?;
        writer.write_vec2::<LE>(self.bucket_size())?;
        writer.write_u16::<LE>(self.buckets_per_side())?;
        writer.write_u8(0)?;

        let mut flags = self.flags();
        flags.set(
            BucketedGeometryFlags::HAS_FACE_VISIBILITY_FLAGS,
            self.face_visibility_flags().is_some(),
        );
        writer.write_u8(flags.bits())?;

        write_count(writer, self.vertices().len(), "scene graph vertices")?;
        write_count(writer, self.indices().len(), "scene graph indices")?;
        for vertex in self.vertices() {
            writer.write_vec3::<LE>(vertex)?;
        }
        for &index in self.indices() {
            writer.write_u16::<LE>(index)?;
        }
        for bucket in self.buckets() {
            bucket.write(writer)?;
        }
        if let Some(flags) = self.face_visibility_flags() {
            for flag in flags {
                writer.write_u8(flag.bits())?;
            }
        }
        Ok(())
    }
}

impl GeometryBucket {
    fn write<W: Write + ?Sized>(&self, writer: &mut W) -> Result<()> {
        writer.write_vec2::<LE>(self.max_stick_out())?;
        writer.write_u32::<LE>(self.start_index())?;
        writer.write_u32::<LE>(self.base_vertex())?;
        writer.write_u16::<LE>(self.inside_face_count())?;
        writer.write_u16::<LE>(self.sticking_out_face_count())?;
        Ok(())
    }
}

impl PlanarReflector {
    fn write<W: Write + ?Sized>(&self, writer: &mut W) -> Result<()> {
        writer.write_mat4_col_major::<LE>(*self.transform())?;
        writer.write_aabb::<LE>(self.plane())?;
        writer.write_vec3::<LE>(self.normal())?;
        Ok(())
    }
}
