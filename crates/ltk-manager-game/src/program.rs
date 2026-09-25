//! A material's passes with the game's own shaders translated for the viewport.
//!
//! Each pass is resolved as the engine builds it, and Hexshade picks its permutation out
//! of the shipped `ShaderCache.dx11.wad.client` by the same define list and translates
//! the two blobs, per section 4.1 of docs/research/static-material-studio-rendering.md.

use hexshade::bundle::chunk_hash;
use hexshade::{
    Defines, ShaderCache, ShaderPath, ShaderSource, SourceError, StageProgram, TranslationCache,
};
use ltk_hash::{BinHash, WadHash};
use ltk_manager_core::bin_document::{AssetLookup, BinDocument, RowNames};
use ltk_manager_core::error::AppResult;
use ltk_manager_core::material::MaterialWarning;
use ltk_manager_core::material::pass::{
    Define, DefineSource, MaterialKind, PassState, PassTexture, ResolvedPass, SamplerState,
    TextureSource, resolve_passes,
};
use ltk_manager_core::preview::AssetRef;
use serde::{Deserialize, Serialize};

/// The defines a studio adds to every pass, off the engine's global list. The pass wins
/// on a conflict.
const STUDIO_DEFINES: [(&str, &str); 2] = [("DISABLE_FOW", "1"), ("DISABLE_SHADOWS", "1")];
/// The blend weights a skinned mesh's vertices carry, which the studio's geometry has.
const SKINNED_DEFINES: [(&str, &str); 1] = [("NUM_BLEND_WEIGHTS", "4")];
const LOW_QUALITY_DEFINES: [(&str, &str); 1] = [("LOW_QUALITY_MODE", "1")];

/// `LIT_UBER`, the engine's shader for a skinned submesh its skin covers with no
/// `StaticMaterialDef`.
const LIT_UBER: ShaderPath<'static> = ShaderPath::Hlsl {
    vertex: "ASSETS/Shaders/HLSL/SkinnedMesh/LIT_UBER_VS.vs",
    pixel: "ASSETS/Shaders/HLSL/SkinnedMesh/LIT_UBER_PS.ps",
};

/// The shader name of the `LIT_UBER` pass.
pub const LIT_UBER_NAME: &str = "SkinnedMesh/LIT_UBER";

/// The submesh's colour texture, `DIFFUSE_MAP__TX` in the bytecode.
pub const LIT_UBER_DIFFUSE: &str = "DIFFUSE_MAP";

/// The skin's emissive texture. Its green channel replaces the grid light of a texel.
pub const LIT_UBER_EMISSIVE: &str = "EMISSIVE_MAP";

/// An engine particle shader pair, which the mesh an emitter resolves and its uv mode pick.
///
/// The `particle_shaders` example finds each file in an installed shader cache.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum ParticleShader {
    /// `quad_vs` and `quad_ps`, for every emitter without a mesh.
    Quad,
    /// A quad under `uvMode` 2, `LOCK_ALPHA`.
    QuadFixedAlphaUv,
    /// A quad under `uvMode` 1, `SCREEN_SPACE`.
    QuadScreenSpaceUv,
    /// A quad with a `SLICE_RANGE`, `quad_vs` with `quad_ps_slice`.
    QuadSlice,
    /// `mesh_vs` and `mesh_ps`, for a mesh emitter and a `REFLECTIVE` quad.
    Mesh,
    /// A mesh with a `SLICE_RANGE`, `mesh_vs` with `mesh_ps_slice`.
    MeshSlice,
    /// `skinnedmesh/particle_vs` and `particle_ps`, for a mesh attached to a character.
    AttachedMesh,
    /// An attached mesh with a `SLICE_RANGE`, `particle_vs` with `particle_ps_slice`.
    AttachedMeshSlice,
    /// `distortion_vs` and `distortion_ps`, for a distorting emitter without a mesh.
    Distortion,
    /// `distortion_mesh_vs` and `distortion_mesh_ps`, for a distorting mesh emitter.
    DistortionMesh,
    /// `skinnedmesh/particle_distortion_vs` and `particle_distortion_ps`, for a distorting
    /// attached mesh.
    DistortionAttachedMesh,
}

impl ParticleShader {
    /// Every pair, in declaration order.
    pub const ALL: [Self; 11] = [
        Self::Quad,
        Self::QuadFixedAlphaUv,
        Self::QuadScreenSpaceUv,
        Self::QuadSlice,
        Self::Mesh,
        Self::MeshSlice,
        Self::AttachedMesh,
        Self::AttachedMeshSlice,
        Self::Distortion,
        Self::DistortionMesh,
        Self::DistortionAttachedMesh,
    ];

    /// The HLSL file of each stage in the shader cache.
    #[must_use]
    pub const fn path(self) -> ShaderPath<'static> {
        let (vertex, pixel) = match self {
            Self::Quad => (QUAD_VS, "ASSETS/Shaders/HLSL/ParticleSystem/QUAD_PS.ps"),
            Self::QuadFixedAlphaUv => (
                "ASSETS/Shaders/HLSL/ParticleSystem/QUAD_VS_FixedAlphaUV.vs",
                "ASSETS/Shaders/HLSL/ParticleSystem/QUAD_PS_FixedAlphaUV.ps",
            ),
            Self::QuadScreenSpaceUv => (
                "ASSETS/Shaders/HLSL/ParticleSystem/QUAD_ScreenSpaceUV.vs",
                "ASSETS/Shaders/HLSL/ParticleSystem/QUAD_ScreenSpaceUV.ps",
            ),
            Self::QuadSlice => (
                QUAD_VS,
                "ASSETS/Shaders/HLSL/ParticleSystem/QUAD_PS_Slice.ps",
            ),
            Self::Mesh => (MESH_VS, "ASSETS/Shaders/HLSL/ParticleSystem/MESH_PS.ps"),
            Self::MeshSlice => (
                MESH_VS,
                "ASSETS/Shaders/HLSL/ParticleSystem/MESH_PS_Slice.ps",
            ),
            Self::AttachedMesh => (
                ATTACHED_MESH_VS,
                "ASSETS/Shaders/HLSL/SkinnedMesh/PARTICLE_PS.ps",
            ),
            Self::AttachedMeshSlice => (
                ATTACHED_MESH_VS,
                "ASSETS/Shaders/HLSL/SkinnedMesh/PARTICLE_PS_Slice.ps",
            ),
            Self::Distortion => (
                "ASSETS/Shaders/HLSL/ParticleSystem/DISTORTION_VS.vs",
                "ASSETS/Shaders/HLSL/ParticleSystem/DISTORTION_PS.ps",
            ),
            Self::DistortionMesh => (
                "ASSETS/Shaders/HLSL/ParticleSystem/DISTORTION_MESH_VS.vs",
                "ASSETS/Shaders/HLSL/ParticleSystem/DISTORTION_MESH_PS.ps",
            ),
            Self::DistortionAttachedMesh => (
                "ASSETS/Shaders/HLSL/SkinnedMesh/PARTICLE_DISTORTION_VS.vs",
                "ASSETS/Shaders/HLSL/SkinnedMesh/PARTICLE_DISTORTION_PS.ps",
            ),
        };
        ShaderPath::Hlsl { vertex, pixel }
    }

    /// The shader name a pass of the pair carries, such as `ParticleSystem/QUAD`.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::Quad => "ParticleSystem/QUAD",
            Self::QuadFixedAlphaUv => "ParticleSystem/QUAD_FixedAlphaUV",
            Self::QuadScreenSpaceUv => "ParticleSystem/QUAD_ScreenSpaceUV",
            Self::QuadSlice => "ParticleSystem/QUAD_Slice",
            Self::Mesh => "ParticleSystem/MESH",
            Self::MeshSlice => "ParticleSystem/MESH_Slice",
            Self::AttachedMesh => "SkinnedMesh/PARTICLE",
            Self::AttachedMeshSlice => "SkinnedMesh/PARTICLE_Slice",
            Self::Distortion => "ParticleSystem/DISTORTION",
            Self::DistortionMesh => "ParticleSystem/DISTORTION_MESH",
            Self::DistortionAttachedMesh => "SkinnedMesh/PARTICLE_DISTORTION",
        }
    }
}

const QUAD_VS: &str = "ASSETS/Shaders/HLSL/ParticleSystem/QUAD_VS.vs";
const MESH_VS: &str = "ASSETS/Shaders/HLSL/ParticleSystem/MESH_VS.vs";
const ATTACHED_MESH_VS: &str = "ASSETS/Shaders/HLSL/SkinnedMesh/PARTICLE_VS.vs";

/// A define the engine sets on a particle shader from the emitter's fields, as `NAME=1`.
///
/// `DISABLE_FOW` is the studio's, and `MASKED` and `COLORPALETTE_COLORBLIND` are never set
/// in a preview, so none of the three is here.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum ParticleDefine {
    /// `alphaRef` is not zero.
    AlphaTest,
    /// An erosion definition is present.
    AlphaErosion,
    /// The mult layer is present.
    MultPass,
    /// A mesh under `uvMode` 2, `LOCK_ALPHA`.
    SeparateAlphaUv,
    /// A mesh under `uvMode` 1, `SCREEN_SPACE`.
    ScreenSpaceUv,
    /// A mesh under `uvMode` 3, 4 or 5, the local-space modes.
    LocalSpaceUv,
    /// A palette definition is present.
    PalettizeTextures,
    /// A soft particle definition is present.
    SoftParticles,
    /// A reflection definition is present.
    Reflective,
    /// A mesh reads its vertex colours.
    UseVertexColors,
}

impl ParticleDefine {
    /// Every define, in declaration order.
    pub const ALL: [Self; 10] = [
        Self::AlphaTest,
        Self::AlphaErosion,
        Self::MultPass,
        Self::SeparateAlphaUv,
        Self::ScreenSpaceUv,
        Self::LocalSpaceUv,
        Self::PalettizeTextures,
        Self::SoftParticles,
        Self::Reflective,
        Self::UseVertexColors,
    ];

    /// The define's name in the bytecode's TOC.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::AlphaTest => "ALPHA_TEST",
            Self::AlphaErosion => "ALPHA_EROSION",
            Self::MultPass => "MULT_PASS",
            Self::SeparateAlphaUv => "SEPARATE_ALPHA_UV",
            Self::ScreenSpaceUv => "SCREEN_SPACE_UV",
            Self::LocalSpaceUv => "LOCAL_SPACE_UV",
            Self::PalettizeTextures => "PALETTIZE_TEXTURES",
            Self::SoftParticles => "SOFT_PARTICLES",
            Self::Reflective => "REFLECTIVE",
            Self::UseVertexColors => "USE_VERTEX_COLORS",
        }
    }
}

/// What the studio adds to a pass's define list.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct ProgramOptions {
    /// `LOW_QUALITY_MODE`, the game's own low setting.
    pub low_quality: bool,
}

/// One material with a program per pass, as the viewport binds it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct MaterialProgram {
    /// The material's path hash, `0x` and eight hex digits.
    pub hash: String,
    /// The material's path, where a table names it.
    pub name: Option<String>,
    /// `dynamicMaterial` is set, so the passes hold the static values of an animated
    /// material.
    pub animated: bool,
    pub kind: MaterialKind,
    /// The passes of the `normal` technique, in draw order.
    pub passes: Vec<PassProgram>,
    /// Every drop, miss and fallback the read made, in the order it made them.
    pub warnings: Vec<MaterialWarning>,
}

/// One pass with its shader, or with why it has none.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct PassProgram {
    pub pass: ResolvedPass,
    pub program: ProgramRead,
}

/// A pass's two stages translated, or the reason the viewport draws it as an error.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum ProgramRead {
    Ready {
        /// The define list the permutation was picked by, `NAME=VALUE` sorted by name,
        /// with the studio's own entries added.
        defines: Vec<String>,
        vertex: Box<StageProgram>,
        pixel: Box<StageProgram>,
    },
    /// The TOC is not on this machine, the define list names no permutation of it, or a
    /// blob did not translate. Never a guess.
    Failed { reason: String },
}

/// What the materials of one read resolve against.
#[derive(Clone, Copy)]
pub struct Resolution<'a> {
    /// The bin declaring the materials.
    pub document: &'a BinDocument,
    pub names: &'a dyn RowNames,
    /// Where the textures and the shader cache chunks live.
    pub assets: &'a dyn AssetLookup,
    /// `data/shaders/shaders.bin`, without which no pass has a shader path and every
    /// program fails.
    pub shaders: Option<&'a BinDocument>,
}

/// The programs of the materials `entries` name, one for one and in that order, none
/// where the document declares no object under the entry.
///
/// `read` answers the bytes of an asset the resolution locates, which is how the TOC and
/// bundle chunks of the shader cache are reached.
pub fn read_programs(
    resolution: Resolution<'_>,
    entries: &[BinHash],
    options: ProgramOptions,
    translations: &TranslationCache,
    read: &mut dyn FnMut(&AssetRef) -> AppResult<Vec<u8>>,
) -> Vec<Option<MaterialProgram>> {
    let Resolution {
        document,
        names,
        assets,
        shaders,
    } = resolution;
    let mut source = AssetChunks { assets, read };
    let mut cache = ShaderCache::new(&mut source, translations);

    entries
        .iter()
        .map(|entry| {
            let material = resolve_passes(document, *entry, names, assets, shaders)
                .inspect_err(|e| tracing::debug!(?entry, "Passed over a material: {e}"))
                .ok()?;
            let passes = material
                .passes
                .into_iter()
                .enumerate()
                .map(|(index, pass)| {
                    let program = program_of(&pass, material.kind, options, &mut cache);
                    if let ProgramRead::Failed { reason } = &program {
                        tracing::warn!(
                            material = %material.hash,
                            pass = index,
                            shader = ?pass.shader,
                            "No program for the pass: {reason}"
                        );
                    }
                    PassProgram { pass, program }
                })
                .collect();
            Some(MaterialProgram {
                hash: material.hash,
                name: material.name,
                animated: material.animated,
                kind: material.kind,
                passes,
                warnings: material.warnings,
            })
        })
        .collect()
}

/// The pass the engine draws a skinned submesh with where its skin names no material,
/// with its program.
///
/// The pass is `LIT_UBER`'s base permutation, without the normal, gloss or roughness maps
/// that select its other features. Its textures name no asset. Each submesh binds its
/// colour texture and the skin's emissive texture by name.
pub fn read_default_skinned_program(
    assets: &dyn AssetLookup,
    options: ProgramOptions,
    translations: &TranslationCache,
    read: &mut dyn FnMut(&AssetRef) -> AppResult<Vec<u8>>,
) -> PassProgram {
    let pass = ResolvedPass {
        shader: Some(LIT_UBER_NAME.to_owned()),
        defines: Vec::new(),
        runtime_switches: Vec::new(),
        textures: [LIT_UBER_DIFFUSE, LIT_UBER_EMISSIVE]
            .into_iter()
            .map(|name| PassTexture {
                name: name.to_owned(),
                texture: None,
                source: TextureSource::Fallback,
                sampler: SamplerState::default(),
            })
            .collect(),
        params: Vec::new(),
        state: PassState::default(),
        schema: None,
    };

    let mut source = AssetChunks { assets, read };
    let mut cache = ShaderCache::new(&mut source, translations);
    let program = translated(
        LIT_UBER,
        &pass,
        MaterialKind::SkinnedMesh,
        options,
        &mut cache,
    );
    PassProgram { pass, program }
}

/// An engine particle shader's pass for the defines an emitter sets, with its program.
///
/// The pass names no texture and keeps the class's default state. An emitter binds its
/// textures by the bytecode's names and blends by its `blendMode`.
pub fn read_particle_program(
    assets: &dyn AssetLookup,
    shader: ParticleShader,
    defines: &[ParticleDefine],
    options: ProgramOptions,
    translations: &TranslationCache,
    read: &mut dyn FnMut(&AssetRef) -> AppResult<Vec<u8>>,
) -> PassProgram {
    let pass = particle_pass(shader, defines);

    let mut source = AssetChunks { assets, read };
    let mut cache = ShaderCache::new(&mut source, translations);
    let program = translated(
        shader.path(),
        &pass,
        MaterialKind::Particles,
        options,
        &mut cache,
    );
    if let ProgramRead::Failed { reason } = &program {
        tracing::warn!(shader = shader.name(), "No particle program: {reason}");
    }
    PassProgram { pass, program }
}

fn particle_pass(shader: ParticleShader, defines: &[ParticleDefine]) -> ResolvedPass {
    let mut defines = defines.to_vec();
    defines.sort_unstable();
    defines.dedup();

    ResolvedPass {
        shader: Some(shader.name().to_owned()),
        defines: defines
            .into_iter()
            .map(|define| Define {
                name: define.name().to_owned(),
                value: "1".to_owned(),
                source: DefineSource::Emitter,
            })
            .collect(),
        runtime_switches: Vec::new(),
        textures: Vec::new(),
        params: Vec::new(),
        state: PassState::default(),
        schema: None,
    }
}

/// The shader cache's chunks as the resolution locates them, by hash first, since the
/// bundle chunks have no name any table carries, and by path where a table names it.
struct AssetChunks<'a> {
    assets: &'a dyn AssetLookup,
    read: &'a mut dyn FnMut(&AssetRef) -> AppResult<Vec<u8>>,
}

impl ShaderSource for AssetChunks<'_> {
    fn chunk(&mut self, path: &str) -> Result<Vec<u8>, SourceError> {
        let asset = self
            .assets
            .locate_chunk(WadHash(chunk_hash(path)))
            .or_else(|| self.assets.locate(path))
            .ok_or(SourceError::Missing)?;
        (self.read)(&asset).map_err(|e| SourceError::Unreadable(e.to_string()))
    }
}

/// The pass's define list with the studio's entries, where the pass sets no value.
fn define_list(pass: &ResolvedPass, kind: MaterialKind, options: ProgramOptions) -> Defines {
    let mut defines: Defines = pass
        .defines
        .iter()
        .map(|define| (define.name.as_str(), define.value.as_str()))
        .collect();

    let skinned = kind == MaterialKind::SkinnedMesh;
    let studio = STUDIO_DEFINES
        .iter()
        .chain(SKINNED_DEFINES.iter().filter(|_| skinned))
        .chain(LOW_QUALITY_DEFINES.iter().filter(|_| options.low_quality));
    for (name, value) in studio {
        defines.insert_missing(name, value);
    }
    defines
}

fn program_of(
    pass: &ResolvedPass,
    kind: MaterialKind,
    options: ProgramOptions,
    cache: &mut ShaderCache<'_>,
) -> ProgramRead {
    let Some(shader) = &pass.shader else {
        return ProgramRead::Failed {
            reason: "The pass links no shader the defs declare".to_owned(),
        };
    };
    translated(ShaderPath::Generated(shader), pass, kind, options, cache)
}

/// The program of `shader` that the define list of `pass` selects.
fn translated(
    shader: ShaderPath<'_>,
    pass: &ResolvedPass,
    kind: MaterialKind,
    options: ProgramOptions,
    cache: &mut ShaderCache<'_>,
) -> ProgramRead {
    let defines = define_list(pass, kind, options);

    match cache.program(shader, &defines) {
        Ok(program) => ProgramRead::Ready {
            defines: defines.to_entries(),
            vertex: Box::new(program.vertex),
            pixel: Box::new(program.pixel),
        },
        Err(e) => ProgramRead::Failed {
            reason: e.to_string(),
        },
    }
}

#[cfg(test)]
mod tests;
