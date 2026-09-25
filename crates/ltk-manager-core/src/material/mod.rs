//! What a `StaticMaterialDef` gives a preview: the slots one stock material draws with.
//!
//! The engine binds a material by name against the `CustomShaderDef` its pass links, so
//! a preview that translates no shader picks its base texture, its tint and its render
//! state by name too. The name lists, their order and their guards are the ones
//! measured on every shipped material, section 2 and section 6.1 of
//! docs/research/static-material-studio-rendering.md, and an absent field reads as the
//! class default rather than as unset, which is rule 1 of that note's section 1.1.

use std::collections::HashMap;
use std::sync::LazyLock;

pub mod defs;
pub mod pass;

use indexmap::IndexMap;
use ltk_hash::{BinHash, Hash as _};
use ltk_meta::PropertyValueEnum;
use ltk_meta::walk::Leaf;
use regex::Regex;
use serde::Serialize;

use crate::bin_document::{
    AssetLookup, BinDocument, BinDocumentError, Fields, Locator, NamedAsset, RowNames, fields_of,
    hex, items, leaf, link, object_at, struct_of, text,
};
use crate::preview::AssetRef;

/// Where every `CustomShaderDef` lives, in `Shaders/Shaders.wad.client` and `Global.wad.client`.
pub const SHADER_DEFS_PATH: &str = "data/shaders/shaders.bin";

/// `StaticMaterialDef.samplerValues`.
const SAMPLER_VALUES: BinHash = BinHash(0x0a6f_0eb5);
/// `StaticMaterialDef.paramValues`, and `StaticMaterialPassDef.paramValues`.
const PARAM_VALUES: BinHash = BinHash(0xd0ab_46b8);
/// `StaticMaterialDef.switches`.
const SWITCHES: BinHash = BinHash(0xdd7d_db9d);
/// `shaderMacros`, on the material and on each pass.
const SHADER_MACROS: BinHash = BinHash(0xe6d6_7ded);
/// `StaticMaterialDef.techniques`.
const TECHNIQUES: BinHash = BinHash(0x844f_384e);
/// `StaticMaterialDef.dynamicMaterial`.
const DYNAMIC_MATERIAL: BinHash = BinHash(0x8687_5ff3);
/// `StaticMaterialShaderSamplerDef.TextureName`.
const TEXTURE_NAME: BinHash = BinHash(0xb311_d4ef);
/// `StaticMaterialShaderSamplerDef.texturePath`.
const TEXTURE_PATH: BinHash = BinHash(0xf0a3_63e3);
/// `StaticMaterialShaderSamplerDef.addressU`.
const ADDRESS_U: BinHash = BinHash(0x111e_c6d2);
/// `StaticMaterialShaderSamplerDef.addressV`.
const ADDRESS_V: BinHash = BinHash(0x101e_c53f);
/// `StaticMaterialShaderSamplerDef.addressW`.
const ADDRESS_W: BinHash = BinHash(0x0f1e_c3ac);
/// `StaticMaterialShaderSamplerDef.filterMin`.
const FILTER_MIN: BinHash = BinHash(0x1931_0df1);
/// `StaticMaterialShaderSamplerDef.filterMag`.
const FILTER_MAG: BinHash = BinHash(0x4044_d30e);
/// `name`, on a param, a switch, a technique, a shader texture, parameter and switch.
const NAME: BinHash = BinHash(0x8d39_bde6);
/// `StaticMaterialShaderParamDef.value`.
const VALUE: BinHash = BinHash(0x425e_d3ca);
/// `StaticMaterialSwitchDef.on`.
const ON: BinHash = BinHash(0x6134_2fd0);
/// `StaticMaterialTechniqueDef.passes`.
const PASSES: BinHash = BinHash(0x623c_d25c);
/// `StaticMaterialPassDef.shader`.
const SHADER: BinHash = BinHash(0x355d_5568);
/// `StaticMaterialPassDef.blendEnable`.
const BLEND_ENABLE: BinHash = BinHash(0x23b7_5597);
/// `StaticMaterialPassDef.srcColorBlendFactor`.
const SRC_COLOR_BLEND_FACTOR: BinHash = BinHash(0x22c0_c7d0);
/// `StaticMaterialPassDef.dstColorBlendFactor`.
const DST_COLOR_BLEND_FACTOR: BinHash = BinHash(0xbe0a_bbf5);
/// `StaticMaterialPassDef.cullEnable`.
const CULL_ENABLE: BinHash = BinHash(0x4b0f_55ce);
/// `StaticMaterialPassDef.windingToCull`.
const WINDING_TO_CULL: BinHash = BinHash(0x4b92_c1ec);
/// `StaticMaterialPassDef.depthEnable`.
const DEPTH_ENABLE: BinHash = BinHash(0xd250_7939);
/// `StaticMaterialPassDef.writeMask`.
const WRITE_MASK: BinHash = BinHash(0xba51_21ec);
/// `CustomShaderDef.objectPath`.
const OBJECT_PATH: BinHash = BinHash(0x1d36_9c29);
/// `IShaderDef.textures`.
const TEXTURES: BinHash = BinHash(0x9910_8c85);
/// `CustomShaderDef.parameters`.
const PARAMETERS: BinHash = BinHash(0x48a5_2ed9);
/// `CustomShaderDef.staticSwitches`.
const STATIC_SWITCHES: BinHash = BinHash(0x3291_437b);
/// `CustomShaderDef.featureDefines`.
const FEATURE_DEFINES: BinHash = BinHash(0xae29_287b);
/// `ShaderTexture.defaultTexturePath`.
const DEFAULT_TEXTURE_PATH: BinHash = BinHash(0x32b3_74fa);
/// `ShaderPhysicalParameter.data`.
const DATA: BinHash = BinHash(0xd872_e2a5);
/// `ShaderPhysicalParameter.logicalParameters`.
const LOGICAL_PARAMETERS: BinHash = BinHash(0x7467_2198);
/// `ShaderStaticSwitch.onByDefault`.
const ON_BY_DEFAULT: BinHash = BinHash(0xaae9_9956);
/// The unnamed flag of `ShaderStaticSwitch`, set on the 23 switches a `$Globals` float
/// carries at run time rather than a define at compile time.
const RUNTIME_SWITCH: BinHash = BinHash(0x066e_669c);
/// `ShaderLogicalParameter.fields`, the component mask a value scatters through.
const FIELDS: BinHash = BinHash(0x0640_657c);
/// `samplerName`, on a shader texture and on a material's sampler entry.
const SAMPLER_NAME: BinHash = BinHash(0x02e7_fb4c);

/// The technique a preview draws. Every shipped material has exactly this one.
const NORMAL_TECHNIQUE: &str = "normal";
/// The one shader whose base texture a static switch decides.
const SWITCHED_SHADER: &str = "Shaders/SkinnedMesh/AlphaBlend_Additive_Scroll_Packed";
const SWITCHED_SWITCH: &str = "MAINTEX_ON";
const SWITCHED_TEXTURE: &str = "Main_Texture";
/// The switches of that shader that read an alpha at all, without which its pass's
/// blend covers nothing and the packed channels are masks rather than coverage.
const SWITCHED_ALPHA_SWITCHES: [&str; 4] = [
    "ALPHABLEND_MAIN",
    "ALPHABLEND_BLENDMAT",
    "USE_MAINTEXALPHA",
    "ALPHACLIP_ON",
];
/// The switch of that shader that makes its blend additive, which its name says of all.
const SWITCHED_ADDITIVE_SWITCH: &str = "ADDITIVEALPHA_ON";
/// The `writeMask` bit that writes depth. The default mask is 31.
const WRITE_DEPTH: u64 = 16;
/// The `windingToCull` the engine culls by default, counter-clockwise.
const CULL_CCW: u64 = 1;
/// The alpha test a shader that masks takes where no parameter names one.
const MASKED_ALPHA_TEST: f32 = 0.5;

/// The texture names that mean the albedo in every shader declaring them, best first.
const BASE_EXACT: [&str; 18] = [
    "Diffuse_Texture",
    "DiffuseTexture",
    "Main_Texture",
    "Diffuse_Color",
    "Diffuse",
    "Base_Texture",
    "Diff_Tex",
    "_MainTex",
    "Diffuse_Texture_Primary",
    "MainItemTexture",
    "TierBaseTexture",
    "Glass_Diffuse_Texture",
    "TextureMain",
    "VoidAlbedo2",
    "BAKED_DIFFUSE_TEXTURE",
    "Diffuse_Sword_Texture",
    "Diffuse_Texture_2",
    "WP_Base_Texture",
];
const TINT_NAMES: [&str; 7] = [
    "TintColor",
    "MainTex_TintColor",
    "Diffuse_Tint",
    "BaseMat_Tint",
    "TintColorBase",
    "Main_Color",
    "Diffuse_Color_Tint",
];
const OPACITY_NAMES: [&str; 4] = ["Alpha", "Opacity", "Diffuse_AlphaIntensity", "Master_Alpha"];
const ALPHA_TEST_NAMES: [&str; 5] = [
    "AlphaTestValue",
    "AlphaClipValue",
    "Alpha_Test",
    "AlphaTest",
    "Cutoff",
];
const UV_REPEAT_NAMES: [&str; 6] = [
    "MainTex_Tile",
    "Diffuse_Tiling",
    "Base_Tile",
    "MainTexUV_Tile",
    "UV_Scale",
    "Diffuse_UV_Scale",
];
const UV_SCROLL_NAMES: [&str; 4] = [
    "ScrollSpeedMainTex",
    "ScrollSpeedBase",
    "Diffuse_Scroll_Speed",
    "Diffuse_ScrollSpeed",
];

/// A path the game ships as a stand-in rather than a picture.
static PLACEHOLDER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)shared/materials/(black|white|grey|gray|flat_normal|default|transparent|blank)|/blank\.tex$|alpha-mask\.tex$",
    )
    .expect("a valid placeholder pattern")
});
/// A texture name that reads as the albedo.
static BASE_LIKE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(^|_)(diffuse|albedo|main|base|basecolor|diff|color)(_|$|tex|texture)")
        .expect("a valid base name pattern")
});
/// A texture name that is plainly not the albedo, whatever else it says.
static NOT_BASE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)mask|noise|gradient|gredient|ramp|matcap|normal|nrm|distort|flow|dissolve|erosion|scroll|pan|alt|secondary|swap|transition|fresnel|bloom|glow|emiss|lut|remap|outline|shadow|deform|wpo|screen|rim|spec|rma|metal|alpha|opacity|overlay|pattern|tint|blend|hold|lightness|trans_",
    )
    .expect("a valid not-base pattern")
});
/// A texture name a colour map path may not rescue from being something else.
static NOT_BASE_EVEN_BY_PATH: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)noise|gradient|ramp|matcap|normal|nrm|distort|flow")
        .expect("a valid not-base pattern")
});
/// The file name convention of a colour map.
static COLOR_MAP_PATH: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(^|[_\-])(tx_cm|cm|diffuse|albedo|basecolor)([_\-.\d]|$)")
        .expect("a valid colour map pattern")
});
/// A shader whose name says it tests alpha.
static MASKED_SHADER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)alphatest|alpha_test|cutout|masked").expect("a valid masked pattern")
});
/// A shader whose name says it blends additively.
static ADDITIVE_SHADER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)additive").expect("a valid additive pattern"));
/// A shader that halves its tint, so a half-grey leaves the albedo where it was.
///
/// 149 of Summoner's Rift's 183 materials write `TintColor` at exactly 128 of 255 and
/// the two on `VertexDeform` write 255 for the same neutral, which is what says the
/// family scales rather than that the map is half grey.
static DOUBLED_TINT_SHADER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)staticmesh/defaultenv").expect("a valid tint pattern"));

/// One `StaticMaterialDef` as a preview draws it, cut down to the slots one stock
/// material takes.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct MaterialPreview {
    /// The material's path hash, `0x` and eight hex digits.
    pub hash: String,
    /// The material's path, where a table names it.
    pub name: Option<String>,
    /// The document declares no object under the link, so every slot is empty and the
    /// submesh draws as an error rather than as a guess.
    pub missing: bool,
    /// The linked file declaring the material, and none where the document read does.
    pub source: Option<AssetRef>,
    /// `dynamicMaterial` is set, so the slots are the static values of an animated
    /// material.
    pub animated: bool,
    /// The pass shader's `objectPath`, and none where the link resolves to nothing.
    pub shader: Option<String>,
    /// The texture the material's main layer samples, and none for a material with no
    /// texture at all.
    pub base: Option<BaseTexture>,
    /// A colour the base is multiplied by, in the shader's own units.
    pub tint: Option<[f32; 3]>,
    pub opacity: Option<f32>,
    /// The alpha a fragment is discarded below.
    pub alpha_test: Option<f32>,
    /// How many times the base tiles across the mesh.
    pub uv_repeat: Option<[f32; 2]>,
    /// How far the base moves per second, in tiles.
    pub uv_scroll: Option<[f32; 2]>,
    pub render_state: RenderState,
    /// Every drop, miss and fallback the read made, in the order it made them.
    pub warnings: Vec<MaterialWarning>,
}

/// The texture a preview draws a material's main layer with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct BaseTexture {
    /// The shader texture's name, which the sampler entry is keyed by.
    pub name: String,
    pub texture: NamedAsset,
    /// Which rule picked it, from surest to a last resort.
    pub rule: BaseRule,
    /// The sampler's address modes, across and down.
    pub wrap: [Wrap; 2],
}

/// The rule of section 10.2 that picked a base texture, in the order they are tried.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum BaseRule {
    /// A static switch of the one shader that has such a switch names it.
    SwitchOverride,
    /// Its name is one that means the albedo.
    Exact,
    /// Every albedo name held a placeholder, and another texture's path is a colour map.
    ColorMapOverPlaceholder,
    /// Every albedo name held a placeholder, which the engine samples too.
    ExactPlaceholder,
    /// Its name reads as an albedo and as nothing else.
    NameLike,
    /// Its path is a colour map's, and its name is not something else.
    ColorMapPath,
    /// Its path is a colour map's, whatever its name.
    ColorMapPathAnyName,
}

/// A sampler's address mode, `addressU` and `addressV` on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum Wrap {
    #[default]
    Repeat,
    Clamp,
    Mirror,
    Border,
}

impl Wrap {
    /// The mode `value` names on the wire. An absent value is the class default, `Repeat`.
    fn of(value: Option<&PropertyValueEnum>) -> Self {
        match integer(value) {
            Some(1) => Self::Clamp,
            Some(2) => Self::Mirror,
            Some(3) => Self::Border,
            _ => Self::Repeat,
        }
    }
}

/// How a pass's fragments reach the target, from the first pass's own fields.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct RenderState {
    pub blending: Blending,
    /// `StaticMaterialPassDef.srcColorBlendFactor`, defaulting to [`BlendFactor::One`].
    pub src_factor: BlendFactor,
    /// `StaticMaterialPassDef.dstColorBlendFactor`, defaulting to [`BlendFactor::Zero`].
    pub dst_factor: BlendFactor,
    /// The pass multiplies its colour by its own alpha before blending.
    pub premultiplied: bool,
    /// The pass clips on a threshold it states itself and writes depth, so the depth buffer
    /// resolves its body and only the fringe its filtering leaves blends.
    pub cutout: bool,
    /// `cullEnable` is off, so both faces draw.
    pub double_sided: bool,
    /// The pass culls the winding the engine keeps by default, which an inverted hull does.
    pub inverted: bool,
    pub depth_write: bool,
    pub depth_test: bool,
}

impl Default for RenderState {
    /// The class defaults: opaque, one face, depth written and tested.
    fn default() -> Self {
        Self {
            blending: Blending::Opaque,
            src_factor: BlendFactor::One,
            dst_factor: BlendFactor::Zero,
            premultiplied: false,
            cutout: false,
            double_sided: false,
            inverted: false,
            depth_write: true,
            depth_test: true,
        }
    }
}

/// The blends a preview tells apart.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum Blending {
    Opaque,
    /// Source alpha over one minus source alpha, which most character materials are.
    Normal,
    Additive,
    /// The target darkened by the source's own colour, which 17 shipped map materials do.
    Modulate,
}

impl Blending {
    /// The blend a pass's factor pair names, for a pass that blends at all.
    fn of(src: BlendFactor, dst: BlendFactor) -> Self {
        match (src, dst) {
            (BlendFactor::One, BlendFactor::Zero) => Self::Opaque,
            (BlendFactor::OneMinusSrcColor, BlendFactor::Zero) => Self::Modulate,
            (_, BlendFactor::One) => Self::Additive,
            _ => Self::Normal,
        }
    }
}

/// One side of the pair a pass blends by, a `StaticMaterialPassDef::BlendFactor`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum BlendFactor {
    Zero,
    One,
    SrcColor,
    OneMinusSrcColor,
    DstColor,
    OneMinusDstColor,
    SrcAlpha,
    OneMinusSrcAlpha,
}

impl BlendFactor {
    /// The factor `value` names, and `default` where the pass states none this build reads.
    fn of(value: Option<&PropertyValueEnum>, default: Self) -> Self {
        match integer(value) {
            Some(0) => Self::Zero,
            Some(1) => Self::One,
            Some(2) => Self::SrcColor,
            Some(3) => Self::OneMinusSrcColor,
            Some(4) => Self::DstColor,
            Some(5) => Self::OneMinusDstColor,
            Some(6) => Self::SrcAlpha,
            Some(7) => Self::OneMinusSrcAlpha,
            _ => default,
        }
    }
}

/// Something the engine does silently that a preview says out loud.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum MaterialWarning {
    /// The shader defs were not opened, so no default texture, parameter or switch is known.
    NoShaderDefs,
    /// The material has no technique with a pass, so it draws with the defaults alone.
    NoPass,
    /// The pass links a shader the defs do not declare, `0x` and eight hex digits.
    UnresolvedShader { hash: String },
    /// A second pass the preview does not draw.
    SecondPass,
    /// A sampler entry the shader does not declare, which the engine ignores.
    UndeclaredSampler { name: String },
    /// A parameter the shader does not declare, which the engine ignores.
    UndeclaredParam { name: String },
    /// A switch the shader does not declare, which the engine ignores.
    UndeclaredSwitch { name: String },
    /// A `texturePath` written as a string, which the client drops for the default.
    StringTexturePath { name: String, path: String },
    /// The base texture names a path nothing on this machine holds.
    TextureNotFound { name: String, path: String },
    /// A shader texture neither the material nor the def gives a path, so the engine's
    /// fallback texture is what draws.
    NoTexturePath { name: String },
}

/// The material object at `entry`, as a preview draws it.
///
/// `shaders` is `data/shaders/shaders.bin`, which the pass shader's defaults come from.
/// Without it the slots are read off the material's own fields, which carry every
/// texture the shader declares, and the record says so.
///
/// # Errors
///
/// Fails with [`BinDocumentError::NodeNotFound`] where `entry` is no object of the
/// document.
pub fn resolve_material(
    document: &BinDocument,
    entry: BinHash,
    names: &dyn RowNames,
    assets: &dyn AssetLookup,
    shaders: Option<&BinDocument>,
) -> Result<MaterialPreview, BinDocumentError> {
    let material = &object_at(document, entry)?.properties;
    let locator = Locator { names, assets };
    Ok(Reader::new(entry, material, &locator, shaders).preview())
}

/// The material `hash` links to, or the error record for a link the document does not
/// declare.
pub(crate) fn linked_material(
    document: &BinDocument,
    hash: BinHash,
    locator: &Locator<'_>,
    shaders: Option<&BinDocument>,
) -> MaterialPreview {
    match document.object_at(hash) {
        Some(object) => Reader::new(hash, &object.properties, locator, shaders).preview(),
        None => MaterialPreview {
            hash: hex(hash),
            name: locator.entry_name(hash),
            missing: true,
            source: None,
            animated: false,
            shader: None,
            base: None,
            tint: None,
            opacity: None,
            alpha_test: None,
            uv_repeat: None,
            uv_scroll: None,
            render_state: RenderState::default(),
            warnings: Vec::new(),
        },
    }
}

/// One material's sampler entry, or a shader's default for a texture the material
/// leaves out.
struct Sampler {
    texture: Option<NamedAsset>,
    /// Which step supplied `texture`.
    source: pass::TextureSource,
    wrap: [Wrap; 2],
    /// `addressW`, which only a volume texture reads.
    wrap_w: Wrap,
    /// `filterMin` and `filterMag` as the engine reads them, absent being on.
    filter: [bool; 2],
}

/// The pass shader's declarations, as far as the read reached them.
#[derive(Default)]
struct ShaderDef {
    path: Option<String>,
    /// Every texture by name, in declaration order.
    textures: IndexMap<String, TextureDecl>,
    /// Every parameter name, physical and logical alike, with the physical default.
    parameters: HashMap<String, [f32; 4]>,
    /// Every physical parameter, in declaration order.
    physical: Vec<PhysicalDecl>,
    switches: IndexMap<String, SwitchDecl>,
    feature_defines: HashMap<String, String>,
    /// The defs were opened, so an undeclared name is a warning rather than unknown.
    declared: bool,
}

/// One `ShaderTexture`.
struct TextureDecl {
    /// `defaultTexturePath`, where the def names one.
    default: Option<NamedAsset>,
    /// `samplerName`, the shared sampler the texture reads through instead of its own.
    sampler_name: Option<String>,
}

/// One `ShaderPhysicalParameter`, the `$Globals` member its logical names write into.
struct PhysicalDecl {
    name: String,
    /// `data`, the default, zeros where absent.
    data: [f32; 4],
    /// Each `logicalParameters[]` name with its `fields` mask.
    logical: Vec<(String, u32)>,
}

/// One `ShaderStaticSwitch`.
#[derive(Clone, Copy)]
struct SwitchDecl {
    on_by_default: bool,
    /// The switch is a `$Globals` float at run time rather than a define.
    runtime: bool,
}

/// One material's read, stage by stage, in the order section 11 of the note lays out.
struct Reader<'a> {
    hash: BinHash,
    material: &'a Fields,
    locator: &'a Locator<'a>,
    shaders: Option<&'a BinDocument>,
    warnings: Vec<MaterialWarning>,
}

impl<'a> Reader<'a> {
    fn new(
        hash: BinHash,
        material: &'a Fields,
        locator: &'a Locator<'a>,
        shaders: Option<&'a BinDocument>,
    ) -> Self {
        Self {
            hash,
            material,
            locator,
            shaders,
            warnings: Vec::new(),
        }
    }

    fn preview(mut self) -> MaterialPreview {
        let pass = self.first_pass();
        let shader = self.shader_def(pass);
        let macros = self.macros(pass, &shader);
        let samplers = self.samplers(&shader);
        let switches = self.switches(&shader);
        let params = self.params(pass, &shader);

        let switched = pass
            .and_then(|pass| link(pass.get(&SHADER)))
            .is_some_and(|hash| hash == BinHash::hash_str(SWITCHED_SHADER))
            || is_switched_shader(&shader);
        let base = self.base(&samplers, &switches, &shader, switched);
        let tint = params
            .first_of(&TINT_NAMES)
            .filter(|value| value[..3].iter().all(|x| (0.0..=4.0).contains(x)))
            .map(|value| {
                let scale = if shader
                    .path
                    .as_deref()
                    .is_some_and(|path| DOUBLED_TINT_SHADER.is_match(path))
                {
                    2.0
                } else {
                    1.0
                };
                [value[0] * scale, value[1] * scale, value[2] * scale]
            });
        let opacity = params
            .first_of(&OPACITY_NAMES)
            .map(|value| value[0])
            .filter(|x| (0.0..=1.0).contains(x));
        let authored_alpha_test = params
            .first_of(&ALPHA_TEST_NAMES)
            .map(|value| value[0])
            .filter(|x| *x > 0.0 && *x < 1.0);
        let alpha_test = authored_alpha_test.or_else(|| {
            let masked = shader
                .path
                .as_deref()
                .is_some_and(|path| MASKED_SHADER.is_match(path))
                || macros.get("FEATURE_MASKED").is_some_and(|on| on == "1");
            masked.then_some(MASKED_ALPHA_TEST)
        });
        let uv_repeat = params
            .first_of(&UV_REPEAT_NAMES)
            .map(|value| [value[0], value[1]])
            .filter(|uv| *uv != [1.0, 1.0] && uv.iter().all(|x| *x != 0.0));
        let uv_scroll = params
            .first_of(&UV_SCROLL_NAMES)
            .map(|value| [value[0], value[1]])
            .filter(|uv| uv.iter().any(|x| *x != 0.0));

        /* The packed shader's name says additive and its pass says blend for every
        material, and its switches say which of the two, if either, it does. Inferred
        from how the shader is built, not traced. */
        let mut render_state =
            render_state(pass, &macros, !switched && shader_path_is_additive(&shader));
        let on = |name: &str| switches.get(name).copied().unwrap_or(false);
        if switched && render_state.blending == Blending::Normal && on(SWITCHED_ADDITIVE_SWITCH) {
            render_state.blending = Blending::Additive;
        }
        /* A colour map's alpha is a mask more often than coverage, so a plain blend draws
        opaque until the material affirms it reads an alpha. Inferred, not traced. */
        let reads_alpha = opacity.is_some()
            || alpha_test.is_some()
            || (switched && SWITCHED_ALPHA_SWITCHES.iter().any(|name| on(name)));
        if render_state.blending == Blending::Normal && !reads_alpha {
            render_state.blending = Blending::Opaque;
        }
        /* An inferred threshold is not enough to call a pass a cutout: 1,237 shipped
        champion passes take theirs from a shader named `Masked` and would harden a wing
        or a hair edge nobody authored. */
        render_state.cutout = render_state.blending == Blending::Normal
            && render_state.depth_write
            && authored_alpha_test.is_some()
            && opacity.is_none_or(|value| value >= 1.0);

        MaterialPreview {
            hash: hex(self.hash),
            name: self.locator.entry_name(self.hash),
            missing: false,
            source: None,
            animated: struct_of(self.material.get(&DYNAMIC_MATERIAL)).is_some(),
            shader: shader.path,
            base,
            tint,
            opacity,
            alpha_test,
            uv_repeat,
            uv_scroll,
            render_state,
            warnings: self.warnings,
        }
    }

    /// The first pass of the `normal` technique, or of the first technique.
    fn first_pass(&mut self) -> Option<&'a Fields> {
        let passes = self
            .technique()
            .map_or(&[][..], |fields| items(fields.get(&PASSES)));
        let first = passes.first().and_then(|item| fields_of(Some(item)));
        if first.is_none() {
            self.warnings.push(MaterialWarning::NoPass);
        } else if passes.len() > 1 {
            self.warnings.push(MaterialWarning::SecondPass);
        }
        first
    }

    /// The `normal` technique, or the first where none is named so.
    fn technique(&self) -> Option<&'a Fields> {
        let techniques = items(self.material.get(&TECHNIQUES));
        techniques
            .iter()
            .filter_map(|item| fields_of(Some(item)))
            .find(|fields| text(fields.get(&NAME)) == Some(NORMAL_TECHNIQUE))
            .or_else(|| techniques.first().and_then(|item| fields_of(Some(item))))
    }

    /// What the pass shader declares, out of the defs where they were opened.
    fn shader_def(&mut self, pass: Option<&Fields>) -> ShaderDef {
        let Some(link) = pass.and_then(|pass| link(pass.get(&SHADER))) else {
            if pass.is_some() {
                self.warnings.push(MaterialWarning::UnresolvedShader {
                    hash: hex(BinHash(0)),
                });
            }
            return ShaderDef::default();
        };
        let Some(shaders) = self.shaders else {
            self.warnings.push(MaterialWarning::NoShaderDefs);
            return ShaderDef {
                path: self.locator.entry_name(link),
                ..ShaderDef::default()
            };
        };
        let Some(object) = shaders.object_at(link) else {
            self.warnings
                .push(MaterialWarning::UnresolvedShader { hash: hex(link) });
            return ShaderDef {
                path: self.locator.entry_name(link),
                ..ShaderDef::default()
            };
        };

        let def = &object.properties;
        let mut parameters = HashMap::new();
        let mut physical = Vec::new();
        for fields in structs(def.get(&PARAMETERS)) {
            let data = vector4(fields.get(&DATA));
            let mut logical = Vec::new();
            for entry in structs(fields.get(&LOGICAL_PARAMETERS)) {
                if let Some(name) = text(entry.get(&NAME)) {
                    parameters.insert(name.to_owned(), data);
                    let mask = integer(entry.get(&FIELDS)).unwrap_or(0);
                    logical.push((name.to_owned(), u32::try_from(mask).unwrap_or(0)));
                }
            }
            if let Some(name) = text(fields.get(&NAME)) {
                parameters.insert(name.to_owned(), data);
                physical.push(PhysicalDecl {
                    name: name.to_owned(),
                    data,
                    logical,
                });
            }
        }
        ShaderDef {
            path: text(def.get(&OBJECT_PATH))
                .map(str::to_owned)
                .or_else(|| self.locator.entry_name(link)),
            textures: structs(def.get(&TEXTURES))
                .filter_map(|fields| {
                    let name = text(fields.get(&NAME))?.to_owned();
                    let decl = TextureDecl {
                        default: self.locator.asset(fields.get(&DEFAULT_TEXTURE_PATH)),
                        sampler_name: text(fields.get(&SAMPLER_NAME))
                            .filter(|name| !name.is_empty())
                            .map(str::to_owned),
                    };
                    Some((name, decl))
                })
                .collect(),
            parameters,
            physical,
            switches: structs(def.get(&STATIC_SWITCHES))
                .filter_map(|fields| {
                    let name = text(fields.get(&NAME))?.to_owned();
                    let decl = SwitchDecl {
                        on_by_default: boolean(fields.get(&ON_BY_DEFAULT)).unwrap_or(false),
                        runtime: boolean(fields.get(&RUNTIME_SWITCH)).unwrap_or(false),
                    };
                    Some((name, decl))
                })
                .collect(),
            feature_defines: string_map(def.get(&FEATURE_DEFINES)),
            declared: true,
        }
    }

    /// The define list as far as the slots read it: the material's macros, then the
    /// shader's feature defines, then the pass's macros, later entries winning.
    fn macros(&self, pass: Option<&Fields>, shader: &ShaderDef) -> HashMap<String, String> {
        let mut macros = string_map(self.material.get(&SHADER_MACROS));
        macros.extend(shader.feature_defines.clone());
        macros.extend(string_map(pass.and_then(|pass| pass.get(&SHADER_MACROS))));
        macros
    }

    /// Every texture by name: the material's entries, then the shader's defaults for
    /// the rest.
    fn samplers(&mut self, shader: &ShaderDef) -> IndexMap<String, Sampler> {
        let mut samplers = IndexMap::new();
        for fields in structs(self.material.get(&SAMPLER_VALUES)) {
            let Some(name) = text(fields.get(&TEXTURE_NAME)) else {
                continue;
            };
            if shader.declared && !shader.textures.contains_key(name) {
                self.warnings.push(MaterialWarning::UndeclaredSampler {
                    name: name.to_owned(),
                });
            }
            let path = fields.get(&TEXTURE_PATH);
            let default = || {
                shader
                    .textures
                    .get(name)
                    .and_then(|decl| decl.default.clone())
            };
            let authored = match leaf(path) {
                Some(Leaf::String(written)) if !written.is_empty() => {
                    self.warnings.push(MaterialWarning::StringTexturePath {
                        name: name.to_owned(),
                        path: written.to_owned(),
                    });
                    None
                }
                _ => self.locator.asset(path),
            };
            let (texture, source) = match authored {
                Some(texture) => (Some(texture), pass::TextureSource::Material),
                None => match default() {
                    Some(texture) => (Some(texture), pass::TextureSource::ShaderDefault),
                    None => (None, pass::TextureSource::Fallback),
                },
            };
            samplers.insert(
                name.to_owned(),
                Sampler {
                    texture,
                    source,
                    wrap: [
                        Wrap::of(fields.get(&ADDRESS_U)),
                        Wrap::of(fields.get(&ADDRESS_V)),
                    ],
                    wrap_w: Wrap::of(fields.get(&ADDRESS_W)),
                    filter: [
                        integer(fields.get(&FILTER_MIN)).unwrap_or(1) == 1,
                        integer(fields.get(&FILTER_MAG)).unwrap_or(1) == 1,
                    ],
                },
            );
        }
        for (name, decl) in &shader.textures {
            samplers.entry(name.clone()).or_insert_with(|| Sampler {
                texture: decl.default.clone(),
                source: if decl.default.is_some() {
                    pass::TextureSource::ShaderDefault
                } else {
                    pass::TextureSource::Fallback
                },
                wrap: [Wrap::Repeat; 2],
                wrap_w: Wrap::Repeat,
                filter: [true; 2],
            });
        }
        samplers
    }

    /// Every static switch by name: the material's, absent `on` being true, over the
    /// shader's `onByDefault`.
    fn switches(&mut self, shader: &ShaderDef) -> HashMap<String, bool> {
        let mut switches: HashMap<String, bool> = shader
            .switches
            .iter()
            .map(|(name, decl)| (name.clone(), decl.on_by_default))
            .collect();
        for fields in structs(self.material.get(&SWITCHES)) {
            let Some(name) = text(fields.get(&NAME)) else {
                continue;
            };
            if shader.declared && !shader.switches.contains_key(name) {
                self.warnings.push(MaterialWarning::UndeclaredSwitch {
                    name: name.to_owned(),
                });
            }
            switches.insert(name.to_owned(), boolean(fields.get(&ON)).unwrap_or(true));
        }
        switches
    }

    /// Every parameter by name: the shader's defaults, then the pass's values, then the
    /// material's, an entry with no value writing zeros. The material's value wins.
    fn params(&mut self, pass: Option<&Fields>, shader: &ShaderDef) -> Params {
        let mut set = HashMap::new();
        let entries = structs(pass.and_then(|pass| pass.get(&PARAM_VALUES)))
            .chain(structs(self.material.get(&PARAM_VALUES)));
        for fields in entries {
            let Some(name) = text(fields.get(&NAME)) else {
                continue;
            };
            if shader.declared && !shader.parameters.contains_key(name) {
                self.warnings.push(MaterialWarning::UndeclaredParam {
                    name: name.to_owned(),
                });
            }
            set.insert(name.to_owned(), vector4(fields.get(&VALUE)));
        }
        Params {
            declared: shader.declared.then(|| shader.parameters.clone()),
            set,
        }
    }

    /// The base texture by the rules of section 10.2, first match winning.
    ///
    /// `switched_by_hash` says the pass links the one switched shader by the link's
    /// hash, which is the shader path's, so the defs need not be open to know.
    fn base(
        &mut self,
        samplers: &IndexMap<String, Sampler>,
        switches: &HashMap<String, bool>,
        shader: &ShaderDef,
        switched_by_hash: bool,
    ) -> Option<BaseTexture> {
        let (name, rule) = pick_base(samplers, switches, shader, switched_by_hash)?;
        let sampler = &samplers[name];
        let texture = sampler.texture.clone()?;
        if texture.asset.is_none() {
            self.warnings.push(MaterialWarning::TextureNotFound {
                name: name.to_owned(),
                path: texture.path.clone(),
            });
        }
        Some(BaseTexture {
            name: name.to_owned(),
            texture,
            rule,
            wrap: sampler.wrap,
        })
    }
}

/// The parameters a slot reads, by name.
struct Params {
    /// The shader's declarations with their defaults, where the defs were opened.
    declared: Option<HashMap<String, [f32; 4]>>,
    /// The material's and the pass's values.
    set: HashMap<String, [f32; 4]>,
}

impl Params {
    /// The value of the first of `names` that is present: declared by the shader where
    /// the defs are open, else set by the material.
    fn first_of(&self, names: &[&str]) -> Option<[f32; 4]> {
        names.iter().find_map(|name| match &self.declared {
            Some(declared) => {
                let default = declared.get(*name)?;
                Some(self.set.get(*name).copied().unwrap_or(*default))
            }
            None => self.set.get(*name).copied(),
        })
    }
}

/// The sampler name the base rules pick, and the rule that picked it.
fn pick_base<'s>(
    samplers: &'s IndexMap<String, Sampler>,
    switches: &HashMap<String, bool>,
    shader: &ShaderDef,
    switched_by_hash: bool,
) -> Option<(&'s str, BaseRule)> {
    let path_of = |name: &str| {
        samplers
            .get(name)?
            .texture
            .as_ref()
            .map(|t| t.path.as_str())
    };
    let ok = |name: &str| path_of(name).is_some_and(|path| !PLACEHOLDER.is_match(path));
    let color_map = |name: &str| {
        path_of(name)
            .is_some_and(|path| COLOR_MAP_PATH.is_match(path.rsplit('/').next().unwrap_or(path)))
    };

    let names = || samplers.keys().map(String::as_str);
    let switched = switched_by_hash || is_switched_shader(shader);
    if switched && switches.get(SWITCHED_SWITCH).copied().unwrap_or(false) && ok(SWITCHED_TEXTURE) {
        return names()
            .find(|name| *name == SWITCHED_TEXTURE)
            .map(|name| (name, BaseRule::SwitchOverride));
    }

    let mut first_placeholder = None;
    for exact in BASE_EXACT {
        let Some(name) = names().find(|name| *name == exact) else {
            continue;
        };
        if ok(name) {
            return Some((name, BaseRule::Exact));
        }
        if path_of(name).is_some() && first_placeholder.is_none() {
            first_placeholder = Some(name);
        }
    }
    if let Some(placeholder) = first_placeholder {
        return Some(
            names()
                .find(|name| ok(name) && !NOT_BASE.is_match(name) && color_map(name))
                .map_or((placeholder, BaseRule::ExactPlaceholder), |name| {
                    (name, BaseRule::ColorMapOverPlaceholder)
                }),
        );
    }
    if let Some(name) =
        names().find(|name| BASE_LIKE.is_match(name) && !NOT_BASE.is_match(name) && ok(name))
    {
        return Some((name, BaseRule::NameLike));
    }
    if let Some(name) = names().find(|name| ok(name) && !NOT_BASE.is_match(name) && color_map(name))
    {
        return Some((name, BaseRule::ColorMapPath));
    }
    names()
        .find(|name| ok(name) && color_map(name) && !NOT_BASE_EVEN_BY_PATH.is_match(name))
        .map(|name| (name, BaseRule::ColorMapPathAnyName))
}

/// Whether the def names the one shader with a base-deciding switch, by its path.
fn is_switched_shader(shader: &ShaderDef) -> bool {
    shader.path.as_deref().is_some_and(|path| {
        path.to_lowercase()
            .ends_with(&SWITCHED_SHADER.to_lowercase())
    })
}

fn shader_path_is_additive(shader: &ShaderDef) -> bool {
    shader
        .path
        .as_deref()
        .is_some_and(|path| ADDITIVE_SHADER.is_match(path))
}

/// The render state of section 10.4, off the pass with the class defaults.
fn render_state(
    pass: Option<&Fields>,
    macros: &HashMap<String, String>,
    additive_shader: bool,
) -> RenderState {
    let field = |hash: BinHash| pass.and_then(|pass| pass.get(&hash));
    let blend = boolean(field(BLEND_ENABLE)).unwrap_or(false);
    let src = BlendFactor::of(field(SRC_COLOR_BLEND_FACTOR), BlendFactor::One);
    let dst = BlendFactor::of(field(DST_COLOR_BLEND_FACTOR), BlendFactor::Zero);
    let mut blending = if blend {
        Blending::of(src, dst)
    } else {
        Blending::Opaque
    };
    /* A pass whose state says nothing additive still is where its shader says so, which
    the packed shader does in a switch rather than in a factor. */
    if macros
        .get("SKINNED_MATERIAL_ADDITIVE")
        .is_some_and(|on| on == "1")
        || (blend && additive_shader)
    {
        blending = Blending::Additive;
    }
    RenderState {
        blending,
        src_factor: src,
        dst_factor: dst,
        /* Decided by the caller, which is where the clip parameters are read. */
        cutout: false,
        /* The pair is what the pass itself states and the macro is what its shader was
        built with, so the pair decides wherever the pass blends at all. */
        premultiplied: if blend {
            src == BlendFactor::One && dst == BlendFactor::OneMinusSrcAlpha
        } else {
            macros
                .get("PREMULTIPLIED_ALPHA")
                .is_some_and(|on| on == "1")
        },
        double_sided: !boolean(field(CULL_ENABLE)).unwrap_or(true),
        inverted: integer(field(WINDING_TO_CULL)).unwrap_or(CULL_CCW) != CULL_CCW,
        depth_write: integer(field(WRITE_MASK)).unwrap_or(31) & WRITE_DEPTH != 0,
        depth_test: boolean(field(DEPTH_ENABLE)).unwrap_or(true),
    }
}

/// The fields of every struct in the container `value` holds.
fn structs(value: Option<&PropertyValueEnum>) -> impl Iterator<Item = &Fields> {
    items(value).iter().filter_map(|item| fields_of(Some(item)))
}

/// A `Map<String, String>` as it is, and empty for anything else.
fn string_map(value: Option<&PropertyValueEnum>) -> HashMap<String, String> {
    let Some(PropertyValueEnum::Map(map)) = value else {
        return HashMap::new();
    };
    map.entries()
        .iter()
        .filter_map(|(key, value)| {
            Some((text(Some(key))?.to_owned(), text(Some(value))?.to_owned()))
        })
        .collect()
}

/// A `Vec4` leaf, and zeros for an absent one or one of another kind, which the client
/// drops.
fn vector4(value: Option<&PropertyValueEnum>) -> [f32; 4] {
    match leaf(value) {
        Some(Leaf::Vector4(vector)) => vector.to_array(),
        _ => [0.0; 4],
    }
}

fn boolean(value: Option<&PropertyValueEnum>) -> Option<bool> {
    match leaf(value)? {
        Leaf::Bool(on) | Leaf::Flag(on) => Some(on),
        _ => None,
    }
}

/// Any unsigned integer leaf, however wide the wire wrote it.
fn integer(value: Option<&PropertyValueEnum>) -> Option<u64> {
    match leaf(value)? {
        Leaf::U8(n) => Some(n.into()),
        Leaf::U16(n) => Some(n.into()),
        Leaf::U32(n) => Some(n.into()),
        Leaf::U64(n) => Some(n),
        Leaf::I8(n) => u64::try_from(n).ok(),
        Leaf::I16(n) => u64::try_from(n).ok(),
        Leaf::I32(n) => u64::try_from(n).ok(),
        Leaf::I64(n) => u64::try_from(n).ok(),
        _ => None,
    }
}

#[cfg(test)]
mod tests;
