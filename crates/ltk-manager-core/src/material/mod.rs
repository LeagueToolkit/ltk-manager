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

/// The technique a preview draws. Every shipped material has exactly this one.
const NORMAL_TECHNIQUE: &str = "normal";
/// The one shader whose base texture a static switch decides.
const SWITCHED_SHADER: &str = "Shaders/SkinnedMesh/AlphaBlend_Additive_Scroll_Packed";
const SWITCHED_SWITCH: &str = "MAINTEX_ON";
const SWITCHED_TEXTURE: &str = "Main_Texture";
/// The blend factor `One`, which on the destination makes a blend additive.
const BLEND_FACTOR_ONE: u64 = 1;
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
    /// `PREMULTIPLIED_ALPHA=1` among the macros.
    pub premultiplied: bool,
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
            premultiplied: false,
            double_sided: false,
            inverted: false,
            depth_write: true,
            depth_test: true,
        }
    }
}

/// The three blends a preview tells apart.
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
    wrap: [Wrap; 2],
}

/// The pass shader's declarations, as far as the read reached them.
#[derive(Default)]
struct ShaderDef {
    path: Option<String>,
    /// Every texture name, with its default path where the def names one.
    textures: IndexMap<String, Option<NamedAsset>>,
    /// Every parameter name, physical and logical alike, with the physical default.
    parameters: HashMap<String, [f32; 4]>,
    switches: HashMap<String, bool>,
    feature_defines: HashMap<String, String>,
    /// The defs were opened, so an undeclared name is a warning rather than unknown.
    declared: bool,
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

        let switched_by_hash = pass
            .and_then(|pass| link(pass.get(&SHADER)))
            .is_some_and(|hash| hash == BinHash::hash_str(SWITCHED_SHADER));
        let base = self.base(&samplers, &switches, &shader, switched_by_hash);
        let tint = params
            .first_of(&TINT_NAMES)
            .filter(|value| value[..3].iter().all(|x| (0.0..=4.0).contains(x)))
            .map(|value| [value[0], value[1], value[2]]);
        let opacity = params
            .first_of(&OPACITY_NAMES)
            .map(|value| value[0])
            .filter(|x| (0.0..=1.0).contains(x));
        let alpha_test = params
            .first_of(&ALPHA_TEST_NAMES)
            .map(|value| value[0])
            .filter(|x| *x > 0.0 && *x < 1.0)
            .or_else(|| {
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

        let render_state = render_state(pass, &macros, shader_path_is_additive(&shader));

        MaterialPreview {
            hash: hex(self.hash),
            name: self.locator.entry_name(self.hash),
            missing: false,
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
        let material = self.material;
        let techniques = items(material.get(&TECHNIQUES));
        let technique = techniques
            .iter()
            .filter_map(|item| fields_of(Some(item)))
            .find(|fields| text(fields.get(&NAME)) == Some(NORMAL_TECHNIQUE))
            .or_else(|| techniques.first().and_then(|item| fields_of(Some(item))));
        let passes = technique.map_or(&[][..], |fields| items(fields.get(&PASSES)));
        let first = passes.first().and_then(|item| fields_of(Some(item)));
        if first.is_none() {
            self.warnings.push(MaterialWarning::NoPass);
        } else if passes.len() > 1 {
            self.warnings.push(MaterialWarning::SecondPass);
        }
        first
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
        for fields in structs(def.get(&PARAMETERS)) {
            let data = vector4(fields.get(&DATA));
            for logical in structs(fields.get(&LOGICAL_PARAMETERS)) {
                if let Some(name) = text(logical.get(&NAME)) {
                    parameters.insert(name.to_owned(), data);
                }
            }
            if let Some(name) = text(fields.get(&NAME)) {
                parameters.insert(name.to_owned(), data);
            }
        }
        ShaderDef {
            path: text(def.get(&OBJECT_PATH))
                .map(str::to_owned)
                .or_else(|| self.locator.entry_name(link)),
            textures: structs(def.get(&TEXTURES))
                .filter_map(|fields| {
                    let name = text(fields.get(&NAME))?.to_owned();
                    Some((name, self.locator.asset(fields.get(&DEFAULT_TEXTURE_PATH))))
                })
                .collect(),
            parameters,
            switches: structs(def.get(&STATIC_SWITCHES))
                .filter_map(|fields| {
                    let name = text(fields.get(&NAME))?.to_owned();
                    Some((name, boolean(fields.get(&ON_BY_DEFAULT)).unwrap_or(false)))
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
            let texture = match leaf(path) {
                Some(Leaf::String(written)) if !written.is_empty() => {
                    self.warnings.push(MaterialWarning::StringTexturePath {
                        name: name.to_owned(),
                        path: written.to_owned(),
                    });
                    shader.textures.get(name).cloned().flatten()
                }
                _ => self.locator.asset(path),
            };
            samplers.insert(
                name.to_owned(),
                Sampler {
                    texture,
                    wrap: [
                        Wrap::of(fields.get(&ADDRESS_U)),
                        Wrap::of(fields.get(&ADDRESS_V)),
                    ],
                },
            );
        }
        for (name, texture) in &shader.textures {
            samplers.entry(name.clone()).or_insert_with(|| Sampler {
                texture: texture.clone(),
                wrap: [Wrap::Repeat; 2],
            });
        }
        samplers
    }

    /// Every static switch by name: the material's, absent `on` being true, over the
    /// shader's `onByDefault`.
    fn switches(&mut self, shader: &ShaderDef) -> HashMap<String, bool> {
        let mut switches = shader.switches.clone();
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

    /// Every parameter by name: the shader's defaults, then the material's values, then
    /// the pass's, an entry with no value writing zeros.
    fn params(&mut self, pass: Option<&Fields>, shader: &ShaderDef) -> Params {
        let mut set = HashMap::new();
        let entries = structs(self.material.get(&PARAM_VALUES))
            .chain(structs(pass.and_then(|pass| pass.get(&PARAM_VALUES))));
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
    let switched = switched_by_hash
        || shader.path.as_deref().is_some_and(|path| {
            path.to_lowercase()
                .ends_with(&SWITCHED_SHADER.to_lowercase())
        });
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
    let additive = (blend && integer(field(DST_COLOR_BLEND_FACTOR)) == Some(BLEND_FACTOR_ONE))
        || macros
            .get("SKINNED_MATERIAL_ADDITIVE")
            .is_some_and(|on| on == "1")
        || (blend && additive_shader);
    RenderState {
        blending: if additive {
            Blending::Additive
        } else if blend {
            Blending::Normal
        } else {
            Blending::Opaque
        },
        premultiplied: macros
            .get("PREMULTIPLIED_ALPHA")
            .is_some_and(|on| on == "1"),
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
