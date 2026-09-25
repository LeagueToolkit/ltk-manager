//! Scene graph parsing

use std::io::Read;

use byteorder::{ReadBytesExt, LE};
use ltk_io_ext::ReaderExt;

use super::MapGeoVersion;
use crate::{
    scene_graph::{BucketedGeometryBuilder, BucketedGeometryFlags},
    BucketedGeometry, EnvironmentVisibility, GeometryBucket, Result,
};

impl BucketedGeometry {
    /// Reads a bucketed geometry from a binary stream
    pub(crate) fn read<R: Read>(
        reader: &mut R,
        legacy: bool,
        version: MapGeoVersion,
    ) -> Result<Self> {
        let region_path_hash = if !legacy && version.has_region_path_hash() {
            reader.read_u32::<LE>()?
        } else {
            0
        };
        let visibility_controller_path_hash = if legacy { 0 } else { reader.read_u32::<LE>()? };

        let min_x = reader.read_f32::<LE>()?;
        let min_z = reader.read_f32::<LE>()?;
        let max_x = reader.read_f32::<LE>()?;
        let max_z = reader.read_f32::<LE>()?;

        let max_stick_out_x = reader.read_f32::<LE>()?;
        let max_stick_out_z = reader.read_f32::<LE>()?;

        let bucket_size_x = reader.read_f32::<LE>()?;
        let bucket_size_z = reader.read_f32::<LE>()?;

        let buckets_per_side = reader.read_u16::<LE>()?;
        let is_disabled = reader.read_u8()? != 0;
        let flags = BucketedGeometryFlags::from_bits_retain(reader.read_u8()?);

        let vertex_count = reader.read_u32::<LE>()? as usize;
        let index_count = reader.read_u32::<LE>()? as usize;

        if is_disabled {
            return Ok(BucketedGeometryBuilder::default()
                .region_path_hash(region_path_hash)
                .visibility_controller_path_hash(visibility_controller_path_hash)
                .bounds(min_x, min_z, max_x, max_z)
                .max_stick_out(max_stick_out_x, max_stick_out_z)
                .bucket_size(bucket_size_x, bucket_size_z)
                .buckets_per_side(buckets_per_side)
                .set_disabled(true)
                .flags(flags)
                .build());
        }

        let mut vertices = Vec::with_capacity(vertex_count);
        for _ in 0..vertex_count {
            vertices.push(reader.read_vec3::<LE>()?);
        }

        let mut indices = Vec::with_capacity(index_count);
        for _ in 0..index_count {
            indices.push(reader.read_u16::<LE>()?);
        }

        let bucket_count = (buckets_per_side as usize) * (buckets_per_side as usize);
        let mut buckets = Vec::with_capacity(bucket_count);
        for _ in 0..bucket_count {
            buckets.push(GeometryBucket::read(reader)?);
        }

        let face_visibility_flags =
            if flags.contains(BucketedGeometryFlags::HAS_FACE_VISIBILITY_FLAGS) {
                let face_count = index_count / 3;
                let mut flags = Vec::with_capacity(face_count);
                for _ in 0..face_count {
                    flags.push(EnvironmentVisibility::from_bits_truncate(reader.read_u8()?));
                }
                Some(flags)
            } else {
                None
            };

        Ok(BucketedGeometryBuilder::default()
            .region_path_hash(region_path_hash)
            .visibility_controller_path_hash(visibility_controller_path_hash)
            .bounds(min_x, min_z, max_x, max_z)
            .max_stick_out(max_stick_out_x, max_stick_out_z)
            .bucket_size(bucket_size_x, bucket_size_z)
            .buckets_per_side(buckets_per_side)
            .set_disabled(false)
            .flags(flags)
            .vertices(vertices)
            .indices(indices)
            .buckets(buckets)
            .face_visibility_flags(face_visibility_flags)
            .build())
    }
}

impl GeometryBucket {
    /// Reads a geometry bucket from a binary stream
    pub(crate) fn read<R: Read>(reader: &mut R) -> Result<Self> {
        let max_stick_out_x = reader.read_f32::<LE>()?;
        let max_stick_out_z = reader.read_f32::<LE>()?;
        let start_index = reader.read_u32::<LE>()?;
        let base_vertex = reader.read_u32::<LE>()?;
        let inside_face_count = reader.read_u16::<LE>()?;
        let sticking_out_face_count = reader.read_u16::<LE>()?;

        Ok(Self::new(
            max_stick_out_x,
            max_stick_out_z,
            start_index,
            base_vertex,
            inside_face_count,
            sticking_out_face_count,
        ))
    }
}
