//! What one pass draws with once its shader is known: everything the engine binds it with.
//!
//! [`MaterialPreview`](super::MaterialPreview) picks a base texture and a blend by name for
//! a stock material. A translated shader takes every input the engine hands the pass
//! instead: the define list that picks the permutation, the switches read at run time,
//! every texture with its sampler state, every physical parameter and the render state,
//! per section 11 stages 3 to 7 of docs/research/static-material-studio-rendering.md.
//! An absent field reads as the class default, rule 1 of that note.

use std::collections::HashMap;

use indexmap::IndexMap;
use ltk_hash::BinHash;
use ltk_meta::PropertyValueEnum;
use serde::Serialize;

use super::{
    BLEND_ENABLE, BlendFactor, CULL_ENABLE, DEPTH_ENABLE, DST_COLOR_BLEND_FACTOR, DYNAMIC_MATERIAL,
    MaterialWarning, NAME, PARAM_VALUES, PASSES, Reader, SHADER_MACROS, SRC_COLOR_BLEND_FACTOR,
    ShaderDef, VALUE, WINDING_TO_CULL, WRITE_MASK, Wrap, boolean, integer, string_map, structs,
    vector4,
};
use crate::bin_document::{
    AssetLookup, BinDocument, BinDocumentError, Fields, Locator, NamedAsset, RowNames, fields_of,
    hex, items, object_at, struct_of, text,
};

/// `StaticMaterialDef.type`.
const MATERIAL_TYPE: BinHash = BinHash(0x5127_f14d);
/// `StaticMaterialPassDef.srcAlphaBlendFactor`.
const SRC_ALPHA_BLEND_FACTOR: BinHash = BinHash(0xa095_8d01);
/// `StaticMaterialPassDef.dstAlphaBlendFactor`.
const DST_ALPHA_BLEND_FACTOR: BinHash = BinHash(0x7385_e534);
/// `StaticMaterialPassDef.depthCompareFunc`.
const DEPTH_COMPARE_FUNC: BinHash = BinHash(0xa0c7_176b);
/// The `depthCompareFunc` the class defaults to, less or equal, which every shipped pass
/// a preview draws keeps.
const DEPTH_LESS_EQUAL: u32 = 3;
/// The `writeMask` the class defaults to, colour and depth.
const WRITE_ALL: u32 = 31;

/// One `StaticMaterialDef` as the engine builds it: every pass of its `normal` technique
/// with everything the pass shader is bound with.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct ResolvedMaterial {
    /// The material's path hash, `0x` and eight hex digits.
    pub hash: String,
    /// The material's path, where a table names it.
    pub name: Option<String>,
    /// `dynamicMaterial` is set, so the passes hold the static values of an animated
    /// material.
    pub animated: bool,
    /// `type`, which decides the global defines the engine adds.
    pub kind: MaterialKind,
    /// The passes of the `normal` technique, in draw order.
    pub passes: Vec<ResolvedPass>,
    /// Every drop, miss and fallback the read made, in the order it made them.
    pub warnings: Vec<MaterialWarning>,
}

/// `StaticMaterialDef.type`, the family a material's shader belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum MaterialKind {
    StaticMesh,
    /// The class default, which is why no skinned material writes the field.
    #[default]
    SkinnedMesh,
    Particles,
    Ui,
    PostProcess,
    /// A value this build does not name, such as the parallax family TFT sets use.
    Unknown,
}

impl MaterialKind {
    /// The family `value` names on the wire. An absent value is the class default.
    fn of(value: Option<&PropertyValueEnum>) -> Self {
        match integer(value) {
            Some(0) => Self::StaticMesh,
            Some(1) | None => Self::SkinnedMesh,
            Some(2) => Self::Particles,
            Some(3) => Self::Ui,
            Some(4) => Self::PostProcess,
            Some(_) => Self::Unknown,
        }
    }
}

/// One `StaticMaterialPassDef` with its shader's inputs filled in.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct ResolvedPass {
    /// The pass shader's `objectPath`, which its TOCs are named after, and none where the
    /// link resolves to nothing.
    pub shader: Option<String>,
    /// The define list that picks the permutation, by name.
    pub defines: Vec<Define>,
    /// The switches the shader reads at run time, each the `$Globals` float
    /// `switch_<name>`.
    pub runtime_switches: Vec<RuntimeSwitch>,
    /// Every shader texture in declaration order, each bound as `<name>__TX`.
    pub textures: Vec<PassTexture>,
    /// Every physical parameter in declaration order, each a `$Globals` member.
    pub params: Vec<PassParam>,
    pub state: PassState,
    /// What the pass shader declares, and none where the defs were not opened.
    pub schema: Option<ShaderSchema>,
}

/// The parameters, textures and switches a `CustomShaderDef` declares, with its defaults.
///
/// A material's `paramValues`, `samplerValues` and `switches` override these by name, so
/// an editor lists every declared row and the material's value where it writes one.
#[derive(Debug, Clone, PartialEq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct ShaderSchema {
    /// Every logical parameter, in declaration order.
    pub params: Vec<SchemaParam>,
    /// Every texture, in declaration order.
    pub textures: Vec<SchemaTexture>,
    /// Every static switch, in declaration order.
    pub switches: Vec<SchemaSwitch>,
}

/// One name a `paramValues` entry may carry, with the value the shader holds for it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct SchemaParam {
    /// The logical name, or the physical one where the parameter declares no logical names.
    pub name: String,
    /// The physical parameter it writes into, which the `$Globals` member carries.
    pub physical: String,
    /// `ShaderLogicalParameter.fields`, the components of the physical parameter the entry's
    /// value writes, in order. 15 for a physical parameter written whole.
    pub fields: u32,
    /// The components `fields` selects out of the physical default, packed from the first,
    /// which is the value an entry would hold to change nothing.
    pub default: [f32; 4],
}

/// One `ShaderTexture` a `samplerValues` entry may name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct SchemaTexture {
    pub name: String,
    /// `defaultTexturePath`, drawn where the material names no texture.
    pub default: Option<String>,
    /// `samplerName`, the shared sampler that overrides a material's address modes.
    pub shared_sampler: Option<String>,
}

/// One `ShaderStaticSwitch` a `switches` entry may name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct SchemaSwitch {
    pub name: String,
    pub on_by_default: bool,
    /// Read as a `$Globals` float at run time, so a toggle recompiles nothing.
    pub runtime: bool,
}

/// One `NAME=VALUE` of the define list.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct Define {
    pub name: String,
    pub value: String,
    /// The last stage that set it.
    pub source: DefineSource,
}

/// The stages the define list is built from, in the order the engine runs them, later
/// winning.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum DefineSource {
    /// `StaticMaterialDef.shaderMacros`.
    Material,
    /// `CustomShaderDef.featureDefines`, all of them.
    Feature,
    /// A compile-time static switch, `1` on and `0` off.
    Switch,
    /// `StaticMaterialPassDef.shaderMacros`.
    Pass,
    /// Set by the engine for the emitter that draws an engine particle shader.
    Emitter,
}

/// A static switch the shader reads as a `$Globals` float rather than a define.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct RuntimeSwitch {
    /// The switch's name, without the `switch_` the member carries.
    pub name: String,
    pub on: bool,
}

/// One `ShaderTexture` with the path and the sampler the pass binds it with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct PassTexture {
    /// The shader texture's name, which the material's sampler entry is keyed by.
    pub name: String,
    /// The texture, and none where no step names a path, which the engine's fallback
    /// texture draws.
    pub texture: Option<NamedAsset>,
    pub source: TextureSource,
    pub sampler: SamplerState,
}

/// Which step of section 11.5 supplied a texture's path.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum TextureSource {
    /// The material's own `samplerValues` entry.
    Material,
    /// `ShaderTexture.defaultTexturePath`.
    ShaderDefault,
    /// Neither, so the engine's fallback texture.
    Fallback,
}

/// How a texture is sampled: a shared sampler by name, or the entry's own modes.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct SamplerState {
    /// `ShaderTexture.samplerName`, the `X3DSharedSamplerDef` the shader reads through
    /// as `<name>_SharedSampler`, which wins over the modes below.
    pub shared: Option<String>,
    /// `addressU`, `addressV` and `addressW`.
    pub wrap: [Wrap; 3],
    /// `filterMin` is 1, linear.
    pub filter_min: bool,
    /// `filterMag` is 1, linear.
    pub filter_mag: bool,
}

impl Default for SamplerState {
    /// The class defaults: wrap on every axis, linear both ways, no shared sampler.
    fn default() -> Self {
        Self {
            shared: None,
            wrap: [Wrap::Repeat; 3],
            filter_min: true,
            filter_mag: true,
        }
    }
}

/// One `ShaderPhysicalParameter` after the material's and the pass's values wrote into it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct PassParam {
    /// The physical name, which the `$Globals` member carries.
    pub name: String,
    pub value: [f32; 4],
    /// The last step that wrote a component.
    pub source: ParamSource,
}

/// Which step of section 11.6 last wrote a parameter.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum ParamSource {
    /// `ShaderPhysicalParameter.data`.
    ShaderDefault,
    /// `StaticMaterialDef.paramValues`.
    Material,
    /// `StaticMaterialPassDef.paramValues`.
    Pass,
}

/// The pass's render state, field by field, with the class defaults filled in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct PassState {
    pub blend_enable: bool,
    pub src_color: BlendFactor,
    pub dst_color: BlendFactor,
    pub src_alpha: BlendFactor,
    pub dst_alpha: BlendFactor,
    pub cull_enable: bool,
    pub winding_to_cull: Winding,
    pub depth_enable: bool,
    /// `depthCompareFunc` as written, 3 being less or equal, the default.
    pub depth_compare_func: u32,
    /// `writeMask` as written: bits 1, 2, 4 and 8 the colour channels, 16 depth.
    pub write_mask: u32,
}

impl Default for PassState {
    /// The class defaults: opaque, the counter-clockwise face culled, depth written and
    /// tested at less or equal.
    fn default() -> Self {
        Self {
            blend_enable: false,
            src_color: BlendFactor::One,
            dst_color: BlendFactor::Zero,
            src_alpha: BlendFactor::One,
            dst_alpha: BlendFactor::Zero,
            cull_enable: true,
            winding_to_cull: Winding::Ccw,
            depth_enable: true,
            depth_compare_func: DEPTH_LESS_EQUAL,
            write_mask: WRITE_ALL,
        }
    }
}

/// The winding a pass culls, `windingToCull` on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum Winding {
    /// Clockwise, `0`, which 436 shipped passes cull for an inverted hull.
    Cw,
    /// Counter-clockwise, `1`, the class default.
    #[default]
    Ccw,
}

impl Winding {
    /// The winding `value` names on the wire. An absent value is the class default.
    fn of(value: Option<&PropertyValueEnum>) -> Self {
        match integer(value) {
            Some(0) => Self::Cw,
            _ => Self::Ccw,
        }
    }
}

/// The material object at `entry`, with every pass as the engine builds it.
///
/// `shaders` is `data/shaders/shaders.bin`, which each pass's declarations come from.
/// Without it a pass lists only what the material itself writes and carries no shader
/// path, and the record says so.
///
/// # Errors
///
/// Fails with [`BinDocumentError::NodeNotFound`] where `entry` is no object of the
/// document.
pub fn resolve_passes(
    document: &BinDocument,
    entry: BinHash,
    names: &dyn RowNames,
    assets: &dyn AssetLookup,
    shaders: Option<&BinDocument>,
) -> Result<ResolvedMaterial, BinDocumentError> {
    let material = &object_at(document, entry)?.properties;
    let locator = Locator { names, assets };
    Ok(Reader::new(entry, material, &locator, shaders).resolved())
}

impl<'a> Reader<'a> {
    fn resolved(mut self) -> ResolvedMaterial {
        let passes = self
            .passes()
            .into_iter()
            .map(|pass| self.resolved_pass(pass))
            .collect();

        let mut warnings = Vec::new();
        for warning in self.warnings {
            if !warnings.contains(&warning) {
                warnings.push(warning);
            }
        }

        ResolvedMaterial {
            hash: hex(self.hash),
            name: self.locator.entry_name(self.hash),
            animated: struct_of(self.material.get(&DYNAMIC_MATERIAL)).is_some(),
            kind: MaterialKind::of(self.material.get(&MATERIAL_TYPE)),
            passes,
            warnings,
        }
    }

    /// Every pass of the `normal` technique, in draw order.
    fn passes(&mut self) -> Vec<&'a Fields> {
        let passes: Vec<&'a Fields> = self
            .technique()
            .map_or(&[][..], |fields| items(fields.get(&PASSES)))
            .iter()
            .filter_map(|item| fields_of(Some(item)))
            .collect();
        if passes.is_empty() {
            self.warnings.push(MaterialWarning::NoPass);
        }
        passes
    }

    fn resolved_pass(&mut self, pass: &'a Fields) -> ResolvedPass {
        let shader = self.shader_def(Some(pass));
        let switches = self.switches(&shader);
        let defines = self.defines(pass, &shader, &switches);
        let runtime_switches = shader
            .switches
            .iter()
            .filter(|(_, decl)| decl.runtime)
            .map(|(name, decl)| RuntimeSwitch {
                name: name.clone(),
                on: switches.get(name).copied().unwrap_or(decl.on_by_default),
            })
            .collect();
        let textures = self.pass_textures(&shader);
        let params = self.pass_params(pass, &shader);

        let schema = shader.declared.then(|| shader.schema());

        ResolvedPass {
            shader: shader.path,
            defines,
            runtime_switches,
            textures,
            params,
            state: pass_state(pass),
            schema,
        }
    }

    /// The define list of section 2.2: the material's macros, the shader's feature
    /// defines, its compile-time switches, then the pass's macros, later entries winning.
    fn defines(
        &self,
        pass: &Fields,
        shader: &ShaderDef,
        switches: &HashMap<String, bool>,
    ) -> Vec<Define> {
        let mut list: IndexMap<String, (String, DefineSource)> = IndexMap::new();
        for (name, value) in string_map(self.material.get(&SHADER_MACROS)) {
            list.insert(name, (value, DefineSource::Material));
        }
        for (name, value) in &shader.feature_defines {
            list.insert(name.clone(), (value.clone(), DefineSource::Feature));
        }
        for (name, decl) in &shader.switches {
            if decl.runtime {
                continue;
            }
            let on = switches.get(name).copied().unwrap_or(decl.on_by_default);
            let value = if on { "1" } else { "0" };
            list.insert(name.clone(), (value.to_owned(), DefineSource::Switch));
        }
        for (name, value) in string_map(pass.get(&SHADER_MACROS)) {
            list.insert(name, (value, DefineSource::Pass));
        }

        let mut defines: Vec<Define> = list
            .into_iter()
            .map(|(name, (value, source))| Define {
                name,
                value,
                source,
            })
            .collect();
        defines.sort_by(|a, b| a.name.cmp(&b.name));
        defines
    }

    /// Every texture the pass binds, in the shader's declaration order where the defs
    /// are open and in the material's otherwise.
    fn pass_textures(&mut self, shader: &ShaderDef) -> Vec<PassTexture> {
        let samplers = self.samplers(shader);
        let names: Vec<&str> = if shader.declared {
            shader.textures.keys().map(String::as_str).collect()
        } else {
            samplers.keys().map(String::as_str).collect()
        };

        let mut textures = Vec::with_capacity(names.len());
        for name in names {
            let sampler = &samplers[name];
            match &sampler.texture {
                Some(texture) if texture.asset.is_none() => {
                    self.warnings.push(MaterialWarning::TextureNotFound {
                        name: name.to_owned(),
                        path: texture.path.clone(),
                    });
                }
                Some(_) => {}
                None => self.warnings.push(MaterialWarning::NoTexturePath {
                    name: name.to_owned(),
                }),
            }
            textures.push(PassTexture {
                name: name.to_owned(),
                texture: sampler.texture.clone(),
                source: sampler.source,
                sampler: SamplerState {
                    shared: shader
                        .textures
                        .get(name)
                        .and_then(|decl| decl.sampler_name.clone()),
                    wrap: [sampler.wrap[0], sampler.wrap[1], sampler.wrap_w],
                    filter_min: sampler.filter[0],
                    filter_mag: sampler.filter[1],
                },
            });
        }
        textures
    }

    /// Every physical parameter of section 11.6: the shader's default, then the pass's
    /// entries, then the material's, each scattered through its logical mask. The
    /// material's value wins.
    fn pass_params(&mut self, pass: &Fields, shader: &ShaderDef) -> Vec<PassParam> {
        let entries = [
            (ParamSource::Pass, pass.get(&PARAM_VALUES)),
            (ParamSource::Material, self.material.get(&PARAM_VALUES)),
        ];

        if !shader.declared {
            let mut set: IndexMap<String, PassParam> = IndexMap::new();
            for (source, list) in entries {
                for fields in structs(list) {
                    let Some(name) = text(fields.get(&NAME)) else {
                        continue;
                    };
                    let param = PassParam {
                        name: name.to_owned(),
                        value: vector4(fields.get(&VALUE)),
                        source,
                    };
                    set.insert(name.to_owned(), param);
                }
            }
            return set.into_values().collect();
        }

        let mut params: Vec<PassParam> = shader
            .physical
            .iter()
            .map(|decl| PassParam {
                name: decl.name.clone(),
                value: decl.data,
                source: ParamSource::ShaderDefault,
            })
            .collect();
        for (source, list) in entries {
            for fields in structs(list) {
                let Some(name) = text(fields.get(&NAME)) else {
                    continue;
                };
                let Some((at, mask)) = shader.logical_target(name) else {
                    self.warnings.push(MaterialWarning::UndeclaredParam {
                        name: name.to_owned(),
                    });
                    continue;
                };
                if scatter(&mut params[at].value, mask, vector4(fields.get(&VALUE))) {
                    params[at].source = source;
                }
            }
        }
        params
    }
}

impl ShaderDef {
    /// The declarations as an editor lists them.
    fn schema(&self) -> ShaderSchema {
        let mut params = Vec::new();
        for decl in &self.physical {
            if decl.logical.is_empty() {
                params.push(SchemaParam {
                    name: decl.name.clone(),
                    physical: decl.name.clone(),
                    fields: 0b1111,
                    default: decl.data,
                });
                continue;
            }

            for (name, fields) in &decl.logical {
                params.push(SchemaParam {
                    name: name.clone(),
                    physical: decl.name.clone(),
                    fields: *fields,
                    default: gather(decl.data, *fields),
                });
            }
        }

        let textures = self
            .textures
            .iter()
            .map(|(name, decl)| SchemaTexture {
                name: name.clone(),
                default: decl.default.as_ref().map(|texture| texture.path.clone()),
                shared_sampler: decl.sampler_name.clone(),
            })
            .collect();
        let switches = self
            .switches
            .iter()
            .map(|(name, decl)| SchemaSwitch {
                name: name.clone(),
                on_by_default: decl.on_by_default,
                runtime: decl.runtime,
            })
            .collect();

        ShaderSchema {
            params,
            textures,
            switches,
        }
    }

    /// The physical parameter `name` writes into and the mask it writes through: the
    /// first whose logical names hold it, else the one named so itself, whole.
    fn logical_target(&self, name: &str) -> Option<(usize, u32)> {
        self.physical
            .iter()
            .enumerate()
            .find_map(|(at, decl)| {
                decl.logical
                    .iter()
                    .find(|(logical, _)| logical == name)
                    .map(|(_, mask)| (at, *mask))
            })
            .or_else(|| {
                self.physical
                    .iter()
                    .position(|decl| decl.name == name)
                    .map(|at| (at, 0b1111))
            })
    }
}

/// `input` written into the components of `target` that `mask` selects, in order, as
/// `Material_SetLogicalParam` does. Whether any component was written.
fn scatter(target: &mut [f32; 4], mask: u32, input: [f32; 4]) -> bool {
    let mut next = 0;
    for (bit, slot) in target.iter_mut().enumerate() {
        if mask & (1 << bit) != 0 {
            *slot = input[next];
            next += 1;
        }
    }
    next > 0
}

/// The components of `source` that `mask` selects, packed from the first, the inverse of
/// `scatter`.
fn gather(source: [f32; 4], mask: u32) -> [f32; 4] {
    let mut packed = [0.0; 4];
    let mut next = 0;
    for (bit, value) in source.into_iter().enumerate() {
        if mask & (1 << bit) != 0 {
            packed[next] = value;
            next += 1;
        }
    }
    packed
}

/// The render state of section 11.7, off the pass with the class defaults.
fn pass_state(pass: &Fields) -> PassState {
    let field = |hash: BinHash| pass.get(&hash);
    let defaults = PassState::default();
    let small = |value: Option<&PropertyValueEnum>, default: u32| {
        integer(value)
            .and_then(|n| u32::try_from(n).ok())
            .unwrap_or(default)
    };

    PassState {
        blend_enable: boolean(field(BLEND_ENABLE)).unwrap_or(defaults.blend_enable),
        src_color: BlendFactor::of(field(SRC_COLOR_BLEND_FACTOR), defaults.src_color),
        dst_color: BlendFactor::of(field(DST_COLOR_BLEND_FACTOR), defaults.dst_color),
        src_alpha: BlendFactor::of(field(SRC_ALPHA_BLEND_FACTOR), defaults.src_alpha),
        dst_alpha: BlendFactor::of(field(DST_ALPHA_BLEND_FACTOR), defaults.dst_alpha),
        cull_enable: boolean(field(CULL_ENABLE)).unwrap_or(defaults.cull_enable),
        winding_to_cull: Winding::of(field(WINDING_TO_CULL)),
        depth_enable: boolean(field(DEPTH_ENABLE)).unwrap_or(defaults.depth_enable),
        depth_compare_func: small(field(DEPTH_COMPARE_FUNC), defaults.depth_compare_func),
        write_mask: small(field(WRITE_MASK), defaults.write_mask),
    }
}

#[cfg(test)]
mod tests;
