use std::io::Read;

use byteorder::{ReadBytesExt, LE};
use ltk_io_ext::ReaderExt;

use crate::{EnvironmentAssetChannel, MeshTextureOverride, Result};

impl EnvironmentAssetChannel {
    pub(crate) fn read<R: Read>(reader: &mut R) -> Result<Self> {
        let texture = reader.read_sized_string_u32::<LE>()?;
        let scale = reader.read_vec2::<LE>()?;
        let offset = reader.read_vec2::<LE>()?;

        Ok(Self::new(texture, scale, offset))
    }
}

impl MeshTextureOverride {
    pub(crate) fn read<R: Read>(reader: &mut R) -> Result<Self> {
        let sampler_index = reader.read_u32::<LE>()?;
        let texture = reader.read_sized_string_u32::<LE>()?;

        Ok(Self::new(sampler_index, texture))
    }
}
