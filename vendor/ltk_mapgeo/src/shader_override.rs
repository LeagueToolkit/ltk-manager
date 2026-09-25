//! Shader texture override definition

/// A binding for one shader texture sampler, applied to every material in the map.
///
/// The client binds the slot by a literal `strcmp` of the name against the shader's own
/// sampler names, not by hash. A live v17 or v18 map carries names such as
/// `BAKED_DIFFUSE_TEXTURE` and `BAKED_DIFFUSE_TEXTURE_ALPHA` at sampler indices 0 and 1.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShaderTextureOverride {
    /// The sampler index to bind
    sampler_index: u32,
    /// The name of the sampler slot to bind
    sampler_name: String,
}

impl ShaderTextureOverride {
    /// Pairs a sampler index with the name of the slot it binds.
    pub fn new(sampler_index: u32, sampler_name: String) -> Self {
        Self {
            sampler_index,
            sampler_name,
        }
    }

    /// The sampler index this binding applies to
    #[inline]
    pub fn sampler_index(&self) -> u32 {
        self.sampler_index
    }

    /// The name of the sampler slot this binds.
    ///
    /// This is a sampler name, not a texture path. A consumer resolving a texture reads the
    /// material's own `samplerValues` out of the sibling `.materials.bin`.
    #[inline]
    pub fn sampler_name(&self) -> &str {
        &self.sampler_name
    }
}
