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
use ltk_manager_assets::preview::AssetRef;
use ltk_manager_base::error::AppResult;
use ltk_manager_base::hashing::named;
use ltk_manager_bin::bin_document::{AssetLookup, BinDocument, RowNames, object_at};
use serde::{Deserialize, Serialize};

use crate::lookup::{Declared, ObjectLookup};
use crate::material::MaterialWarning;
use crate::material::pass::{
    Define, DefineSource, MaterialKind, PassState, PassTexture, ResolvedMaterial, ResolvedPass,
    SamplerState, TextureSource, resolve_embedded_passes, resolve_passes, resolve_shader_pass,
};

/// The class hash of a shader def, which a program read resolves with its own defaults.
const CUSTOM_SHADER_DEF: BinHash = named("CustomShaderDef");

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

/// The skin's `RoughnessMetallicAoTexture`, `RMA_MAP__TX` in the bytecode.
pub const LIT_UBER_RMA: &str = "RMA_MAP";

/// The skin's `normalMapTexture`, `NORMAL_MAP__TX` in the bytecode.
pub const LIT_UBER_NORMAL: &str = "NORMAL_MAP";

/// The `LIT_UBER` permutation that the maps of a skin select.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub enum SkinnedShading {
    /// A colour texture and an emissive mask.
    #[default]
    Base,
    /// `FEATURE_ROUGHNESS_METALLIC`, which samples no emissive mask.
    RoughnessMetallic,
    /// `FEATURE_ROUGHNESS_METALLIC` and `FEATURE_TANGENT`, which read the mesh's tangents.
    RoughnessMetallicNormal,
}

impl SkinnedShading {
    /// The defines that select the permutation.
    const fn features(self) -> &'static [&'static str] {
        match self {
            Self::Base => &[],
            Self::RoughnessMetallic => &["FEATURE_ROUGHNESS_METALLIC"],
            Self::RoughnessMetallicNormal => &["FEATURE_ROUGHNESS_METALLIC", "FEATURE_TANGENT"],
        }
    }

    /// The textures that the permutation samples by name.
    const fn textures(self) -> &'static [&'static str] {
        match self {
            Self::Base => &[LIT_UBER_DIFFUSE, LIT_UBER_EMISSIVE],
            Self::RoughnessMetallic => &[LIT_UBER_DIFFUSE, LIT_UBER_RMA],
            Self::RoughnessMetallicNormal => &[LIT_UBER_DIFFUSE, LIT_UBER_RMA, LIT_UBER_NORMAL],
        }
    }
}

/// An engine particle shader pair, which the mesh an emitter resolves and its uv mode pick.
///
/// The `particle_shaders` example finds each file in an installed shader cache.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
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
#[cfg_attr(feature = "ts", derive(specta::Type))]
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
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct ProgramOptions {
    /// `LOW_QUALITY_MODE`, the game's own low setting.
    pub low_quality: bool,
}

/// One material with a program per pass, as the viewport binds it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct MaterialProgram {
    /// The material's path hash, `0x` and eight hex digits.
    pub hash: String,
    /// The material's path, where a table names it.
    pub name: Option<String>,
    /// `dynamicMaterial` is set, so the passes hold the static values of an animated
    /// material.
    pub animated: bool,
    pub kind: MaterialKind,
    /// The index in `techniques` of the technique `passes` come from, which an edit of a
    /// pass's own entries is addressed under. None for a shader def's defaults.
    pub technique: Option<u32>,
    /// The passes of the `normal` technique, in draw order.
    pub passes: Vec<PassProgram>,
    /// Every drop, miss and fallback the read made, in the order it made them.
    pub warnings: Vec<MaterialWarning>,
}

/// One pass with its shader, or with why it has none.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
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
#[cfg_attr(feature = "ts", derive(specta::Type))]
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

/// A material that a program read names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProgramTarget {
    /// The material declared as the object.
    Object(BinHash),
    /// The material embedded at the property path `path` under the object `entry`.
    Embedded { entry: BinHash, path: String },
}

impl ProgramTarget {
    /// The object the material is declared under.
    fn entry(&self) -> BinHash {
        match self {
            Self::Object(entry) | Self::Embedded { entry, .. } => *entry,
        }
    }
}

impl ObjectLookup<'_> {
    /// Returns what a program read of the bin at `found` resolves against.
    pub fn resolution(&self, found: Declared) -> Resolution<'_> {
        Resolution {
            document: self.document(found),
            names: self.names(),
            assets: self.assets(),
            shaders: self.shaders(),
        }
    }

    /// Reads the programs of `targets`, one for one and in that order, each from the bin that
    /// [`ObjectLookup::find_anywhere`] finds its entry in.
    ///
    /// The answer is none where no bin declares the entry or an embedded path reaches no
    /// struct. `read` answers asset bytes as [`read_programs`] reads them.
    pub fn programs(
        &mut self,
        targets: &[ProgramTarget],
        options: ProgramOptions,
        translations: &TranslationCache,
        read: &mut dyn FnMut(&AssetRef) -> AppResult<Vec<u8>>,
    ) -> Vec<Option<MaterialProgram>> {
        let places: Vec<Option<Declared>> = targets
            .iter()
            .map(|target| self.find_anywhere(target.entry()))
            .collect();
        let mut bins: Vec<Declared> = Vec::new();
        for found in places.iter().flatten() {
            if !bins.contains(found) {
                bins.push(*found);
            }
        }

        let mut programs = vec![None; targets.len()];
        for found in bins {
            let resolution = self.resolution(found);
            let at: Vec<usize> = (0..targets.len())
                .filter(|index| places[*index] == Some(found))
                .collect();
            let objects: Vec<BinHash> = at
                .iter()
                .filter_map(|index| match &targets[*index] {
                    ProgramTarget::Object(entry) => Some(*entry),
                    ProgramTarget::Embedded { .. } => None,
                })
                .collect();

            let mut read_objects =
                read_programs(resolution, &objects, options, translations, read).into_iter();
            for index in at {
                programs[index] = match &targets[index] {
                    ProgramTarget::Object(_) => read_objects.next().flatten(),
                    ProgramTarget::Embedded { entry, path } => {
                        read_embedded_program(resolution, *entry, path, options, translations, read)
                    }
                };
            }
        }
        programs
    }
}

/// The programs of the materials `entries` name, one for one and in that order, none
/// where the document declares no object under the entry.
///
/// An entry of class `CustomShaderDef` is resolved as a material of one pass that sets
/// nothing, so its program uses the shader's own defaults.
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
            let shader_def = document
                .object_at(*entry)
                .is_some_and(|object| object.class_hash == CUSTOM_SHADER_DEF);
            let material = if shader_def {
                resolve_shader_pass(document, *entry, names, assets)
            } else {
                resolve_passes(document, *entry, names, assets, shaders)
            }
            .inspect_err(|e| tracing::debug!(?entry, "Passed over a material: {e}"))
            .ok()?;
            Some(material_program(material, options, &mut cache))
        })
        .collect()
}

/// The program of the material embedded at the property path `path` under `entry`, and none
/// where the path reaches no struct.
///
/// `read` answers asset bytes as [`read_programs`] reads them.
pub fn read_embedded_program(
    resolution: Resolution<'_>,
    entry: BinHash,
    path: &str,
    options: ProgramOptions,
    translations: &TranslationCache,
    read: &mut dyn FnMut(&AssetRef) -> AppResult<Vec<u8>>,
) -> Option<MaterialProgram> {
    let Resolution {
        document,
        names,
        assets,
        shaders,
    } = resolution;
    let material = resolve_embedded_passes(document, entry, path, names, assets, shaders)
        .inspect_err(|e| tracing::debug!(?entry, path, "Passed over a material: {e}"))
        .ok()?;
    let mut source = AssetChunks { assets, read };
    let mut cache = ShaderCache::new(&mut source, translations);
    Some(material_program(material, options, &mut cache))
}

/// A shader def's program, and the defines that select among its permutations.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct ShaderProgram {
    /// The program that the preview draws.
    pub program: MaterialProgram,
    /// The defines that the shader's two TOCs declare, sorted by name. Empty if a TOC cannot
    /// be read.
    pub declared: Vec<DeclaredDefine>,
}

/// One define a shader's TOCs declare, with every value they declare it with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct DeclaredDefine {
    /// The define name.
    pub name: String,
    /// Every value that the TOCs declare for the name, sorted.
    pub values: Vec<String>,
}

/// Reads the program of the `CustomShaderDef` at `entry` with the `preview` defines set over
/// its define list. Returns `None` if the document has no object at `entry`, or if the pass
/// does not resolve.
///
/// Without `material`, the def uses its own defaults. With it, the def is resolved through the
/// `StaticMaterialDef` at `material.1` of the bin `material.0`, with the resolution's document
/// as the shader defs, so an unsaved edit to the def is read. Each entry of `preview` is
/// `NAME=VALUE` and replaces the pass's value of the name. An entry without `=` is skipped.
/// `read` reads the bytes of an asset, as in [`read_programs`].
pub fn read_shader_program(
    resolution: Resolution<'_>,
    entry: BinHash,
    material: Option<(&BinDocument, BinHash)>,
    preview: &[String],
    options: ProgramOptions,
    translations: &TranslationCache,
    read: &mut dyn FnMut(&AssetRef) -> AppResult<Vec<u8>>,
) -> Option<ShaderProgram> {
    let Resolution {
        document,
        names,
        assets,
        ..
    } = resolution;
    object_at(document, entry)
        .inspect_err(|e| tracing::debug!(?entry, "Passed over a shader def: {e}"))
        .ok()?;

    let resolved = match material {
        Some((bin, at)) => resolve_passes(bin, at, names, assets, Some(document)),
        None => resolve_shader_pass(document, entry, names, assets),
    };
    let mut material = resolved
        .inspect_err(|e| tracing::debug!(?entry, "Passed over a shader preview: {e}"))
        .ok()?;
    for pass in &mut material.passes {
        with_preview(&mut pass.defines, preview);
    }
    let shader = material.passes.first().and_then(|pass| pass.shader.clone());

    let mut source = AssetChunks { assets, read };
    let mut cache = ShaderCache::new(&mut source, translations);
    let program = nearest_program(material, options, &mut cache);
    let declared = shader
        .and_then(|path| cache.declared(ShaderPath::Generated(&path)).ok())
        .map(grouped)
        .unwrap_or_default();

    Some(ShaderProgram { program, declared })
}

/// Returns the program of `material`. A pass whose define list selects no compiled
/// permutation uses the nearest list that does, and a warning lists the changed defines.
///
/// The search keeps the values of [`KEPT_DEFINES`] and of the preview's defines.
fn nearest_program(
    material: ResolvedMaterial,
    options: ProgramOptions,
    cache: &mut ShaderCache<'_>,
) -> MaterialProgram {
    let mut program = material_program(material, options, cache);

    for pass in &mut program.passes {
        if !matches!(pass.program, ProgramRead::Failed { .. }) {
            continue;
        }
        let Some(shader) = pass.pass.shader.clone() else {
            continue;
        };

        let path = ShaderPath::Generated(&shader);
        let requested = define_list(&pass.pass, program.kind, options);
        let picked = pass
            .pass
            .defines
            .iter()
            .filter(|define| define.source == DefineSource::Preview)
            .map(|define| define.name.as_str());
        let fixed: Vec<&str> = KEPT_DEFINES.into_iter().chain(picked).collect();
        let Ok(Some(found)) = cache.nearest(path, &requested, &fixed, NEAREST_CHANGES) else {
            continue;
        };
        if found == requested {
            continue;
        }

        pass.program = program_read(cache, path, &found);
        if matches!(pass.program, ProgramRead::Ready { .. }) {
            program.warnings.push(changes(&requested, &found));
        }
    }
    program
}

/// The defines that the nearest permutation search never changes: the studio defines, and
/// the engine defines that the studio does not set.
const KEPT_DEFINES: [&str; 8] = [
    "DISABLE_FOW",
    "DISABLE_SHADOWS",
    "NUM_BLEND_WEIGHTS",
    "LOW_QUALITY_MODE",
    "FORCE_MANTIS_LIGHTING",
    "USE_DYNAMIC_LIGHTING",
    "GENERATE_SHADOW_MAP",
    "IS_AROUND_GAME",
];

/// The maximum number of defines that the nearest permutation search changes. At 3, the
/// search tries fewer than 100,000 lists on the largest TOC.
const NEAREST_CHANGES: usize = 3;

/// Returns a warning that lists the defines that `found` sets and removes relative to
/// `requested`.
fn changes(requested: &Defines, found: &Defines) -> MaterialWarning {
    let set = found
        .iter()
        .filter(|(name, value)| requested.get(name) != Some(*value))
        .map(|(name, value)| format!("{name}={value}"))
        .collect();
    let unset = requested
        .iter()
        .filter(|(name, _)| found.get(name).is_none())
        .map(|(name, _)| name.to_owned())
        .collect();
    MaterialWarning::NearestPermutation { set, unset }
}

/// Sets each `NAME=VALUE` entry of `preview` over `defines` and sorts the list by name. An
/// entry without `=` is skipped.
fn with_preview(defines: &mut Vec<Define>, preview: &[String]) {
    for (name, value) in preview.iter().filter_map(|entry| entry.split_once('=')) {
        let define = Define {
            name: name.to_owned(),
            value: value.to_owned(),
            source: DefineSource::Preview,
        };
        match defines.iter_mut().find(|each| each.name == name) {
            Some(existing) => *existing = define,
            None => defines.push(define),
        }
    }
    defines.sort_by(|a, b| a.name.cmp(&b.name));
}

/// Groups sorted `(name, value)` pairs into one define per name.
fn grouped(pairs: Vec<(String, String)>) -> Vec<DeclaredDefine> {
    let mut declared: Vec<DeclaredDefine> = Vec::new();
    for (name, value) in pairs {
        match declared.last_mut() {
            Some(last) if last.name == name => last.values.push(value),
            _ => declared.push(DeclaredDefine {
                name,
                values: vec![value],
            }),
        }
    }
    declared
}

/// `material` with a program for each of its passes, a failed one logged.
fn material_program(
    material: ResolvedMaterial,
    options: ProgramOptions,
    cache: &mut ShaderCache<'_>,
) -> MaterialProgram {
    let passes = material
        .passes
        .into_iter()
        .enumerate()
        .map(|(index, pass)| {
            let program = program_of(&pass, material.kind, options, cache);
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
    MaterialProgram {
        hash: material.hash,
        name: material.name,
        animated: material.animated,
        kind: material.kind,
        technique: material.technique,
        passes,
        warnings: material.warnings,
    }
}

/// The pass the engine draws a skinned submesh with where its skin names no material,
/// with its program.
///
/// The pass is the `LIT_UBER` permutation that `shading` selects. Its textures name no asset.
/// Each submesh binds the permutation's textures by name.
pub fn read_default_skinned_program(
    assets: &dyn AssetLookup,
    shading: SkinnedShading,
    options: ProgramOptions,
    translations: &TranslationCache,
    read: &mut dyn FnMut(&AssetRef) -> AppResult<Vec<u8>>,
) -> PassProgram {
    let pass = ResolvedPass {
        shader: Some(LIT_UBER_NAME.to_owned()),
        defines: shading
            .features()
            .iter()
            .map(|name| Define {
                name: (*name).to_owned(),
                value: "1".to_owned(),
                source: DefineSource::Skin,
            })
            .collect(),
        runtime_switches: Vec::new(),
        textures: shading
            .textures()
            .iter()
            .map(|name| PassTexture {
                name: (*name).to_owned(),
                texture: None,
                source: TextureSource::Fallback,
                sampler: SamplerState::default(),
            })
            .collect(),
        params: Vec::new(),
        drivers: Vec::new(),
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
        drivers: Vec::new(),
        state: PassState::default(),
        schema: None,
    }
}

/// The shader cache's chunks as the resolution locates them, by hash first, since the
/// bundle chunks have no name any table carries, and by path where a table names it.
pub struct AssetChunks<'a> {
    /// Where each chunk of the cache lives.
    pub assets: &'a dyn AssetLookup,
    /// The bytes of a located chunk.
    pub read: &'a mut dyn FnMut(&AssetRef) -> AppResult<Vec<u8>>,
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
    program_read(cache, shader, &define_list(pass, kind, options))
}

/// The program `cache` builds of `shader` under `defines`, or why it could not.
pub fn program_read(
    cache: &mut ShaderCache<'_>,
    shader: ShaderPath<'_>,
    defines: &Defines,
) -> ProgramRead {
    match cache.program(shader, defines) {
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
