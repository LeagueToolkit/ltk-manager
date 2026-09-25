//! Planar reflector parsing

use std::io::Read;

use byteorder::LE;
use ltk_io_ext::ReaderExt;

use crate::{PlanarReflector, Result};

impl PlanarReflector {
    /// Reads a planar reflector from a binary stream
    pub(crate) fn read<R: Read>(reader: &mut R) -> Result<Self> {
        let transform = reader.read_mat4_col_major::<LE>()?;
        let plane = reader.read_aabb::<LE>()?;
        let normal = reader.read_vec3::<LE>()?;

        Ok(Self::new(transform, plane, normal))
    }
}
