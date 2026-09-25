//! Submesh parsing

use std::io::Read;

use byteorder::{ReadBytesExt, LE};
use ltk_io_ext::ReaderExt as _;

use crate::{EnvironmentSubmesh, Result};

impl EnvironmentSubmesh {
    /// Reads a submesh from a binary stream
    pub(crate) fn read<R: Read>(reader: &mut R) -> Result<Self> {
        let material_hash = reader.read_u32::<LE>()?;
        let material = reader.read_sized_string_u32::<LE>()?;
        let start_index = reader.read_i32::<LE>()?;
        let index_count = reader.read_i32::<LE>()?;
        let min_vertex = reader.read_i32::<LE>()?;
        let max_vertex = reader.read_i32::<LE>()?;

        Ok(Self::with_hash(
            material_hash,
            material,
            start_index,
            index_count,
            min_vertex,
            max_vertex,
        ))
    }
}
