//! Hexshade, the game's DXBC shaders as GLSL ES 3.00 programs a WebGL renderer binds.
//!
//! One blob goes DXBC to SPIR-V through dxbc-spirv, through the word patches of `spirv`,
//! to GLSL through SPIRV-Cross, and through the text patches of `glsl`. The `RDEF`,
//! `ISGN` and `OSGN` chunks of the blob become the [`Sidecar`]: uniform blocks with member
//! offsets, textures with their combined-sampler names, and attributes.
//!
//! [`bundle`] finds a blob in `ShaderCache.dx11.wad.client` by object path and defines,
//! [`ShaderCache`] reads a whole program through a [`ShaderSource`], and
//! [`TranslationCache`] keeps each translation on disk by the blob's hash.

pub mod bundle;
mod cache;
mod defines;
pub mod dxbc;
mod glsl;
mod program;
mod reflection;
mod spirv;
mod translate;

use std::fmt;

use serde::{Deserialize, Serialize};

pub use crate::cache::TranslationCache;
pub use crate::defines::Defines;
pub use crate::glsl::Applied;
pub use crate::program::{
    Program, ProgramError, ShaderCache, ShaderPath, ShaderSource, SourceError, StageProgram,
};
pub use crate::reflection::{
    Attribute, BlockMember, MemberScalar, SamplerBinding, Sidecar, TextureBinding,
    TextureDimension, UniformBlock,
};
pub use crate::spirv::SpirvError;
pub use crate::translate::{TranslateError, Translated, translate};

/// Bumped with any change to the patches, so a disk cache keyed on it refills.
pub const PIPELINE_VERSION: u32 = 3;

/// Which stage a blob is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Stage {
    Vertex,
    Pixel,
}

impl Stage {
    /// The short name the engine's paths use, `vs` or `ps`.
    #[must_use]
    pub const fn abbreviation(self) -> &'static str {
        match self {
            Self::Vertex => "vs",
            Self::Pixel => "ps",
        }
    }

    /// The GL block a cbuffer of this stage is declared as, suffixed so the two stages'
    /// `$Globals` do not collide in one program.
    pub(crate) fn block_name(self, ident: &str) -> String {
        format!("{ident}_{}", self.abbreviation())
    }
}

impl fmt::Display for Stage {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Vertex => "vertex",
            Self::Pixel => "pixel",
        })
    }
}
