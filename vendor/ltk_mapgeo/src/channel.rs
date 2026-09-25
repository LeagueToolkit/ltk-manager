//! Environment asset channel definitions
//!
//! Channels represent texture samplers with associated UV parameters.

use glam::Vec2;

/// An environment asset channel represents a texture sampler binding.
///
/// Used for lighting textures like "STATIONARY_LIGHT" and "BAKED_LIGHT".
#[derive(Debug, Clone, PartialEq)]
pub struct EnvironmentAssetChannel {
    /// Texture path (if known)
    texture: String,
    /// UV scale applied to this channel
    scale: Vec2,
    /// UV offset applied to this channel
    offset: Vec2,
}

impl EnvironmentAssetChannel {
    /// Creates a new channel
    pub fn new(texture: String, scale: Vec2, offset: Vec2) -> Self {
        Self {
            texture,
            scale,
            offset,
        }
    }

    /// Creates an empty/default channel
    pub fn empty() -> Self {
        Self {
            texture: String::new(),
            scale: Vec2::ONE,
            offset: Vec2::ZERO,
        }
    }

    /// The texture path
    #[inline]
    pub fn texture(&self) -> &str {
        &self.texture
    }

    /// UV scale for this channel
    #[inline]
    pub fn scale(&self) -> Vec2 {
        self.scale
    }

    /// UV offset for this channel
    #[inline]
    pub fn offset(&self) -> Vec2 {
        self.offset
    }
}

/// A per-mesh texture override.
///
/// Allows overriding specific sampler slots on individual meshes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MeshTextureOverride {
    /// Sampler index to override
    sampler_index: u32,
    /// Texture path
    texture: String,
}

impl MeshTextureOverride {
    /// Creates a new texture override
    pub fn new(sampler_index: u32, texture: String) -> Self {
        Self {
            sampler_index,
            texture,
        }
    }

    /// The sampler index this override applies to
    #[inline]
    pub fn sampler_index(&self) -> u32 {
        self.sampler_index
    }

    /// The texture path
    #[inline]
    pub fn texture(&self) -> &str {
        &self.texture
    }
}
