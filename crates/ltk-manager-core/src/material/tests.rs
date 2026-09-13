use std::io::Cursor;

use glam::vec4;
use ltk_hash::{Hash as _, WadHash};
use ltk_meta::property::{Kind, NoMeta, values};
use ltk_meta::{Bin, BinObject};

use super::*;
use crate::preview::AssetRef;

fn h(text: &str) -> BinHash {
    BinHash::hash_str(text)
}

const MATERIAL: &str = "Characters/Ahri/Skins/Skin3/Materials/Body";
const SHADER_PATH: &str = "Shaders/SkinnedMesh/Diffuse_Bloom";
const DIFFUSE: &str = "ASSETS/Characters/Ahri/Skins/Skin03/Ahri_Skin03_TX_CM.tex";
const MASK: &str = "ASSETS/Characters/Ahri/Skins/Skin03/Ahri_Skin03_Mask.tex";
const BLACK: &str = "ASSETS/Shared/Materials/black.tex";
const WHITE: &str = "assets/shared/materials/white.tex";
/// The chunks the tables name, which is every path a test writes as a `File`.
const NAMED: [&str; 4] = [DIFFUSE, MASK, BLACK, WHITE];

fn embedded(class: &str, properties: Vec<(BinHash, PropertyValueEnum)>) -> values::Embedded {
    values::Embedded(values::Struct {
        class_hash: h(class),
        properties: properties.into_iter().collect(),
        meta: NoMeta,
    })
}

fn list(items: Vec<values::Embedded>) -> PropertyValueEnum {
    values::Container::from(items).into()
}

fn string_map(entries: &[(&str, &str)]) -> PropertyValueEnum {
    values::Map::new(
        Kind::String,
        Kind::String,
        entries
            .iter()
            .map(|(key, value)| {
                (
                    values::String::from(*key).into(),
                    values::String::from(*value).into(),
                )
            })
            .collect(),
    )
    .unwrap()
    .into()
}

fn sampler(name: &str, path: PropertyValueEnum, address: Option<(u32, u32)>) -> values::Embedded {
    let mut fields = vec![
        (TEXTURE_NAME, values::String::from(name).into()),
        (TEXTURE_PATH, path),
    ];
    if let Some((u, v)) = address {
        fields.push((ADDRESS_U, values::U32::new(u).into()));
        fields.push((ADDRESS_V, values::U32::new(v).into()));
    }
    embedded("StaticMaterialShaderSamplerDef", fields)
}

/// A path as the exporter writes it since 16.17, a `File` hash the tables name.
fn file(path: &str) -> PropertyValueEnum {
    values::WadChunkLink::new(WadHash::hash_str(path).0).into()
}

fn param(name: &str, value: Option<[f32; 4]>) -> values::Embedded {
    let mut fields = vec![(NAME, values::String::from(name).into())];
    if let Some([x, y, z, w]) = value {
        fields.push((VALUE, values::Vector4::new(vec4(x, y, z, w)).into()));
    }
    embedded("StaticMaterialShaderParamDef", fields)
}

fn switch(name: &str, on: Option<bool>) -> values::Embedded {
    let mut fields = vec![(NAME, values::String::from(name).into())];
    if let Some(on) = on {
        fields.push((ON, values::Bool::new(on).into()));
    }
    embedded("StaticMaterialSwitchDef", fields)
}

fn pass(shader: &str, fields: Vec<(BinHash, PropertyValueEnum)>) -> values::Embedded {
    let mut all = vec![(SHADER, values::ObjectLink::new(h(shader)).into())];
    all.extend(fields);
    embedded("StaticMaterialPassDef", all)
}

fn technique(name: &str, passes: Vec<values::Embedded>) -> values::Embedded {
    embedded(
        "StaticMaterialTechniqueDef",
        vec![
            (NAME, values::String::from(name).into()),
            (PASSES, list(passes)),
        ],
    )
}

/// A material builder in the shape the exporter writes: only what differs from the default.
struct Material {
    properties: Vec<(BinHash, PropertyValueEnum)>,
}

impl Material {
    fn new() -> Self {
        Self {
            properties: Vec::new(),
        }
    }

    fn with(mut self, field: BinHash, value: PropertyValueEnum) -> Self {
        self.properties.push((field, value));
        self
    }

    fn samplers(self, samplers: Vec<values::Embedded>) -> Self {
        self.with(SAMPLER_VALUES, list(samplers))
    }

    fn params(self, params: Vec<values::Embedded>) -> Self {
        self.with(PARAM_VALUES, list(params))
    }

    fn switches(self, switches: Vec<values::Embedded>) -> Self {
        self.with(SWITCHES, list(switches))
    }

    fn passes(self, passes: Vec<values::Embedded>) -> Self {
        self.with(TECHNIQUES, list(vec![technique("normal", passes)]))
    }

    fn build(self) -> BinObject {
        let mut object = BinObject::builder(h(MATERIAL), h("StaticMaterialDef"));
        for (field, value) in self.properties {
            object = object.property(field, value);
        }
        object.build()
    }
}

/// The body material most champions ship: a diffuse, a mask, a tint and an alpha blend.
fn body() -> Material {
    Material::new()
        .samplers(vec![
            sampler("Diffuse_Texture", file(DIFFUSE), Some((1, 0))),
            sampler("Mask_Texture", file(MASK), None),
        ])
        .params(vec![
            param("TintColor", Some([1.0, 0.5, 0.25, 1.0])),
            param("Bloom_Intensity", Some([2.0, 0.0, 0.0, 0.0])),
        ])
        .passes(vec![pass(
            SHADER_PATH,
            vec![
                (BLEND_ENABLE, values::Bool::new(true).into()),
                (DST_COLOR_BLEND_FACTOR, values::U32::new(6).into()),
            ],
        )])
}

fn shader_texture(name: &str, default: Option<&str>) -> values::Embedded {
    let mut fields = vec![(NAME, values::String::from(name).into())];
    if let Some(default) = default {
        fields.push((DEFAULT_TEXTURE_PATH, file(default)));
    }
    embedded("ShaderTexture", fields)
}

fn shader_param(name: &str, data: [f32; 4]) -> values::Embedded {
    embedded(
        "ShaderPhysicalParameter",
        vec![
            (NAME, values::String::from(name).into()),
            (
                DATA,
                values::Vector4::new(vec4(data[0], data[1], data[2], data[3])).into(),
            ),
            (
                LOGICAL_PARAMETERS,
                list(vec![embedded(
                    "ShaderLogicalParameter",
                    vec![(NAME, values::String::from(name).into())],
                )]),
            ),
        ],
    )
}

fn shader_switch(name: &str, on_by_default: bool) -> values::Embedded {
    embedded(
        "ShaderStaticSwitch",
        vec![
            (NAME, values::String::from(name).into()),
            (ON_BY_DEFAULT, values::Bool::new(on_by_default).into()),
        ],
    )
}

/// The defs of two shaders: the body's, and the one whose switch decides its base.
fn shaders() -> BinDocument {
    let diffuse_bloom = BinObject::builder(h(SHADER_PATH), h("CustomShaderDef"))
        .property(OBJECT_PATH, values::String::from(SHADER_PATH))
        .property(
            TEXTURES,
            list(vec![
                shader_texture("Diffuse_Texture", None),
                shader_texture("Mask_Texture", Some(BLACK)),
                shader_texture("Emissive_Texture", Some(BLACK)),
            ]),
        )
        .property(
            PARAMETERS,
            list(vec![
                shader_param("TintColor", [1.0; 4]),
                shader_param("Bloom_Intensity", [0.0; 4]),
                shader_param("Alpha", [0.75, 0.0, 0.0, 0.0]),
            ]),
        )
        .property(FEATURE_DEFINES, string_map(&[("FEATURE_BLOOM", "1")]))
        .build();
    let switched = BinObject::builder(h(SWITCHED_SHADER), h("CustomShaderDef"))
        .property(OBJECT_PATH, values::String::from(SWITCHED_SHADER))
        .property(
            TEXTURES,
            list(vec![
                shader_texture("Diffuse_Texture", None),
                shader_texture("Main_Texture", None),
            ]),
        )
        .property(
            STATIC_SWITCHES,
            list(vec![shader_switch(SWITCHED_SWITCH, false)]),
        )
        .build();
    document_of(vec![diffuse_bloom, switched])
}

fn document_of(objects: Vec<BinObject>) -> BinDocument {
    let mut bin = Bin::<NoMeta>::builder();
    for object in objects {
        bin = bin.object(object);
    }
    let mut out = Cursor::new(Vec::new());
    bin.build().to_writer(&mut out).unwrap();
    BinDocument::parse(&out.into_inner()).unwrap()
}

/// Tables that name the material, the shaders and one chunk.
struct Tables;

impl RowNames for Tables {
    fn for_each_entry(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        for (at, hash) in hashes.iter().enumerate() {
            for name in [MATERIAL, SHADER_PATH, SWITCHED_SHADER] {
                if *hash == h(name) {
                    visit(at, name);
                }
            }
        }
    }

    fn for_each_class(&self, _hashes: &[BinHash], _visit: &mut dyn FnMut(usize, &str)) {}

    fn for_each_field(&self, _hashes: &[BinHash], _visit: &mut dyn FnMut(usize, &str)) {}

    fn for_each_value(&self, _hashes: &[BinHash], _visit: &mut dyn FnMut(usize, &str)) {}

    fn for_each_chunk(&self, hashes: &[WadHash], visit: &mut dyn FnMut(usize, &str)) {
        for (at, hash) in hashes.iter().enumerate() {
            for path in NAMED {
                if *hash == WadHash::hash_str(path) {
                    visit(at, path);
                }
            }
        }
    }
}

/// A lookup that places every path but the mask.
struct Placed;

impl AssetLookup for Placed {
    fn locate(&self, path: &str) -> Option<AssetRef> {
        (!path.eq_ignore_ascii_case(MASK)).then(|| AssetRef::File {
            path: path.to_lowercase(),
        })
    }
}

fn placed(path: &str) -> NamedAsset {
    NamedAsset {
        path: path.to_owned(),
        asset: Some(AssetRef::File {
            path: path.to_lowercase(),
        }),
    }
}

fn read(material: Material, shaders: Option<&BinDocument>) -> MaterialPreview {
    let document = document_of(vec![material.build()]);
    resolve_material(&document, h(MATERIAL), &Tables, &Placed, shaders).unwrap()
}

fn base_of(preview: &MaterialPreview) -> (&str, BaseRule) {
    let base = preview.base.as_ref().expect("a base texture");
    (base.name.as_str(), base.rule)
}

#[test]
fn a_body_material_reads_its_diffuse_tint_and_blend_off_its_own_fields() {
    let preview = read(body(), None);

    assert_eq!(preview.name.as_deref(), Some(MATERIAL));
    assert!(!preview.missing);
    assert!(!preview.animated);
    assert_eq!(
        preview.base,
        Some(BaseTexture {
            name: "Diffuse_Texture".to_owned(),
            texture: placed(DIFFUSE),
            rule: BaseRule::Exact,
            wrap: [Wrap::Clamp, Wrap::Repeat],
        })
    );
    assert_eq!(preview.tint, Some([1.0, 0.5, 0.25]));
    assert_eq!(preview.opacity, None);
    assert_eq!(preview.alpha_test, None);
    assert_eq!(
        preview.render_state,
        RenderState {
            blending: Blending::Normal,
            ..RenderState::default()
        }
    );
    assert_eq!(preview.warnings, [MaterialWarning::NoShaderDefs]);
}

/// The shader names itself, fills a default the material leaves out, and seeds a
/// parameter the material never sets.
#[test]
fn the_shader_defs_answer_the_name_the_defaults_and_the_declarations() {
    let preview = read(body(), Some(&shaders()));

    assert_eq!(preview.shader.as_deref(), Some(SHADER_PATH));
    assert_eq!(preview.opacity, Some(0.75));
    assert!(preview.warnings.is_empty());
}

#[test]
fn without_the_defs_the_shader_is_named_by_the_tables() {
    let preview = read(body(), None);

    assert_eq!(preview.shader.as_deref(), Some(SHADER_PATH));
}

#[test]
fn a_material_link_the_document_lacks_is_missing() {
    let document = document_of(vec![]);
    let locator = Locator {
        names: &Tables,
        assets: &Placed,
    };

    let preview = linked_material(&document, h(MATERIAL), &locator, None);

    assert!(preview.missing);
    assert_eq!(preview.name.as_deref(), Some(MATERIAL));
    assert_eq!(preview.base, None);
    assert_eq!(preview.render_state, RenderState::default());
}

#[test]
fn an_entry_that_is_no_object_is_not_found() {
    let document = document_of(vec![body().build()]);

    let err = resolve_material(&document, h("Nowhere"), &Tables, &Placed, None).unwrap_err();

    assert!(matches!(err, BinDocumentError::NodeNotFound { .. }));
}

/// A parameter with no `value` writes zeros rather than the shader's default.
#[test]
fn a_param_with_no_value_is_zeros() {
    let material = body().params(vec![param("TintColor", None)]);

    let preview = read(material, Some(&shaders()));

    assert_eq!(preview.tint, Some([0.0, 0.0, 0.0]));
}

#[test]
fn a_tint_outside_the_guard_is_an_offset_colour_and_not_a_tint() {
    let material = body().params(vec![param("TintColor", Some([0.1, -0.03, -0.06, 1.0]))]);

    assert_eq!(read(material, None).tint, None);
}

#[test]
fn the_pass_params_win_over_the_materials() {
    let material = body().passes(vec![pass(
        SHADER_PATH,
        vec![(
            PARAM_VALUES,
            list(vec![param("TintColor", Some([2.0, 2.0, 2.0, 1.0]))]),
        )],
    )]);

    assert_eq!(read(material, None).tint, Some([2.0, 2.0, 2.0]));
}

/// The names a shader does not declare are what the engine ignores, and each is a warning.
#[test]
fn undeclared_names_are_ignored_and_warned() {
    let material = body()
        .samplers(vec![sampler("Diffuse_Texture", file(DIFFUSE), None)])
        .params(vec![param("Opacity", Some([0.5, 0.0, 0.0, 0.0]))])
        .switches(vec![switch("GHOST", None)]);

    let preview = read(material, Some(&shaders()));

    assert_eq!(
        preview.opacity,
        Some(0.75),
        "the shader's `Alpha` is what is declared"
    );
    assert_eq!(
        preview.warnings,
        [
            MaterialWarning::UndeclaredSwitch {
                name: "GHOST".to_owned()
            },
            MaterialWarning::UndeclaredParam {
                name: "Opacity".to_owned()
            },
        ]
    );
}

#[test]
fn a_switch_names_the_base_of_the_one_switched_shader() {
    let material = Material::new()
        .samplers(vec![
            sampler("Diffuse_Texture", file(MASK), None),
            sampler("Main_Texture", file(DIFFUSE), None),
        ])
        .switches(vec![switch(SWITCHED_SWITCH, None)])
        .passes(vec![pass(SWITCHED_SHADER, vec![])]);

    let with_defs = read(
        Material::new()
            .samplers(vec![
                sampler("Diffuse_Texture", file(MASK), None),
                sampler("Main_Texture", file(DIFFUSE), None),
            ])
            .switches(vec![switch(SWITCHED_SWITCH, None)])
            .passes(vec![pass(SWITCHED_SHADER, vec![])]),
        Some(&shaders()),
    );
    let without_defs = read(material, None);

    assert_eq!(
        base_of(&with_defs),
        ("Main_Texture", BaseRule::SwitchOverride)
    );
    assert_eq!(
        base_of(&without_defs),
        ("Main_Texture", BaseRule::SwitchOverride)
    );
}

#[test]
fn the_switch_off_leaves_the_switched_shader_on_its_diffuse() {
    let material = Material::new()
        .samplers(vec![
            sampler("Diffuse_Texture", file(MASK), None),
            sampler("Main_Texture", file(DIFFUSE), None),
        ])
        .switches(vec![switch(SWITCHED_SWITCH, Some(false))])
        .passes(vec![pass(SWITCHED_SHADER, vec![])]);

    assert_eq!(
        base_of(&read(material, None)),
        ("Diffuse_Texture", BaseRule::Exact)
    );
}

/// A placeholder under every albedo name keeps the placeholder, unless another
/// texture's path is a colour map.
#[test]
fn a_placeholder_base_gives_way_to_a_colour_map_under_another_name() {
    let kept = read(
        Material::new().samplers(vec![
            sampler("Diffuse_Texture", file(BLACK), None),
            sampler("Mask_Texture", file(MASK), None),
        ]),
        None,
    );
    let rescued = read(
        Material::new().samplers(vec![
            sampler("Diffuse_Texture", file(WHITE), None),
            sampler("Layer_Tex", file(DIFFUSE), None),
        ]),
        None,
    );

    assert_eq!(
        base_of(&kept),
        ("Diffuse_Texture", BaseRule::ExactPlaceholder)
    );
    assert_eq!(
        base_of(&rescued),
        ("Layer_Tex", BaseRule::ColorMapOverPlaceholder)
    );
}

#[test]
fn a_name_that_reads_as_an_albedo_is_picked_over_a_colour_map_path() {
    let preview = read(
        Material::new().samplers(vec![
            sampler("Noise_Texture", file(DIFFUSE), None),
            sampler("Albedo_Tex", file(MASK), None),
        ]),
        None,
    );

    assert_eq!(base_of(&preview), ("Albedo_Tex", BaseRule::NameLike));
}

#[test]
fn a_colour_map_path_is_the_last_resort_and_a_noise_map_never_is() {
    let by_path = read(
        Material::new().samplers(vec![sampler("Flipbook_Tex", file(DIFFUSE), None)]),
        None,
    );
    let none = read(
        Material::new().samplers(vec![sampler("Noise_Tex", file(DIFFUSE), None)]),
        None,
    );

    assert_eq!(base_of(&by_path), ("Flipbook_Tex", BaseRule::ColorMapPath));
    assert_eq!(none.base, None);
}

#[test]
fn a_shader_default_fills_a_texture_the_material_leaves_out() {
    let material = Material::new()
        .samplers(vec![sampler("Emissive_Texture", file(DIFFUSE), None)])
        .passes(vec![pass(SHADER_PATH, vec![])]);

    let preview = read(material, Some(&shaders()));

    /* `Mask_Texture` defaults to black, a placeholder, so the emissive's colour map wins
    on its path alone, its name saying it is something else. */
    assert_eq!(
        base_of(&preview),
        ("Emissive_Texture", BaseRule::ColorMapPathAnyName)
    );
}

/// A string path is what a pre-16.17 mod writes, and the client drops it for the default.
#[test]
fn a_string_texture_path_is_dropped_for_the_default_and_warned() {
    let material = Material::new()
        .samplers(vec![sampler(
            "Diffuse_Texture",
            values::String::from(DIFFUSE).into(),
            None,
        )])
        .passes(vec![pass(SHADER_PATH, vec![])]);
    let dropped = read(material, Some(&shaders()));

    let material = Material::new()
        .samplers(vec![sampler("Diffuse_Texture", file(DIFFUSE), None)])
        .passes(vec![pass(SHADER_PATH, vec![])]);
    let kept = read(material, None);

    assert_eq!(dropped.base, None);
    assert!(
        dropped
            .warnings
            .contains(&MaterialWarning::StringTexturePath {
                name: "Diffuse_Texture".to_owned(),
                path: DIFFUSE.to_owned(),
            })
    );
    assert_eq!(base_of(&kept), ("Diffuse_Texture", BaseRule::Exact));
}

#[test]
fn a_base_nothing_holds_is_warned_with_its_path() {
    let preview = read(
        Material::new().samplers(vec![sampler("Diffuse_Texture", file(MASK), None)]),
        None,
    );

    assert_eq!(
        preview.base.as_ref().map(|base| base.texture.asset.clone()),
        Some(None)
    );
    assert!(
        preview
            .warnings
            .contains(&MaterialWarning::TextureNotFound {
                name: "Diffuse_Texture".to_owned(),
                path: MASK.to_owned(),
            })
    );
}

#[test]
fn the_alpha_test_falls_to_a_half_on_a_masked_shader() {
    let by_macro = read(
        body().with(SHADER_MACROS, string_map(&[("FEATURE_MASKED", "1")])),
        None,
    );
    let by_param = read(
        body().params(vec![param("AlphaTestValue", Some([0.3, 0.0, 0.0, 0.0]))]),
        None,
    );
    let by_name = read(
        Material::new().passes(vec![pass("Shaders/SkinnedMesh/Diffuse_AlphaTest", vec![])]),
        None,
    );

    assert_eq!(by_macro.alpha_test, Some(0.5));
    assert_eq!(by_param.alpha_test, Some(0.3));
    assert_eq!(
        by_name.alpha_test, None,
        "a shader the tables do not name has no name"
    );
}

#[test]
fn the_uv_slots_take_their_guards() {
    let repeat = read(
        body().params(vec![
            param("MainTex_Tile", Some([2.0, 3.0, 0.0, 0.0])),
            param("ScrollSpeedMainTex", Some([0.0, 0.0, 0.0, 0.0])),
        ]),
        None,
    );
    let plain = read(
        body().params(vec![
            param("MainTex_Tile", Some([1.0, 1.0, 0.0, 0.0])),
            param("ScrollSpeedMainTex", Some([0.5, 0.0, 0.0, 0.0])),
        ]),
        None,
    );

    assert_eq!(repeat.uv_repeat, Some([2.0, 3.0]));
    assert_eq!(repeat.uv_scroll, None);
    assert_eq!(plain.uv_repeat, None);
    assert_eq!(plain.uv_scroll, Some([0.5, 0.0]));
}

#[test]
fn the_render_state_reads_the_pass_with_the_class_defaults() {
    let additive = read(
        Material::new().passes(vec![pass(
            SHADER_PATH,
            vec![
                (BLEND_ENABLE, values::Bool::new(true).into()),
                (DST_COLOR_BLEND_FACTOR, values::U32::new(1).into()),
                (CULL_ENABLE, values::Bool::new(false).into()),
                (DEPTH_ENABLE, values::Bool::new(false).into()),
                (WRITE_MASK, values::U32::new(15).into()),
            ],
        )]),
        None,
    );
    let hull = read(
        Material::new()
            .with(SHADER_MACROS, string_map(&[("PREMULTIPLIED_ALPHA", "1")]))
            .passes(vec![pass(
                SHADER_PATH,
                vec![(WINDING_TO_CULL, values::U32::new(0).into())],
            )]),
        None,
    );
    let by_macro = read(
        Material::new()
            .with(
                SHADER_MACROS,
                string_map(&[("SKINNED_MATERIAL_ADDITIVE", "1")]),
            )
            .passes(vec![pass(SHADER_PATH, vec![])]),
        None,
    );

    assert_eq!(
        additive.render_state,
        RenderState {
            blending: Blending::Additive,
            premultiplied: false,
            double_sided: true,
            inverted: false,
            depth_write: false,
            depth_test: false,
        }
    );
    assert_eq!(
        hull.render_state,
        RenderState {
            premultiplied: true,
            inverted: true,
            ..RenderState::default()
        }
    );
    assert_eq!(by_macro.render_state.blending, Blending::Additive);
}

#[test]
fn a_second_pass_and_a_missing_pass_are_each_warned() {
    let two = read(
        body().passes(vec![pass(SHADER_PATH, vec![]), pass(SHADER_PATH, vec![])]),
        None,
    );
    let none = read(Material::new(), None);

    assert!(two.warnings.contains(&MaterialWarning::SecondPass));
    assert_eq!(none.warnings, [MaterialWarning::NoPass]);
    assert_eq!(none.render_state, RenderState::default());
}

#[test]
fn a_shader_the_defs_lack_is_warned_and_the_slots_still_read() {
    let material = body().passes(vec![pass("Shaders/SkinnedMesh/Gone", vec![])]);

    let preview = read(material, Some(&shaders()));

    assert_eq!(base_of(&preview), ("Diffuse_Texture", BaseRule::Exact));
    assert_eq!(
        preview.warnings,
        [MaterialWarning::UnresolvedShader {
            hash: hex(h("Shaders/SkinnedMesh/Gone"))
        }]
    );
}

#[test]
fn a_dynamic_material_is_animated() {
    let material = body().with(
        DYNAMIC_MATERIAL,
        values::Struct {
            class_hash: h("DynamicMaterialDef"),
            properties: Default::default(),
            meta: NoMeta,
        }
        .into(),
    );

    assert!(read(material, None).animated);
}

/// Each hash is the field's name through the bin's own hash, so a typo in a constant is a
/// failure here rather than a field that silently reads as absent.
#[test]
fn every_field_hash_is_its_name() {
    for (hash, name) in [
        (SAMPLER_VALUES, "samplerValues"),
        (PARAM_VALUES, "paramValues"),
        (SWITCHES, "switches"),
        (SHADER_MACROS, "shaderMacros"),
        (TECHNIQUES, "techniques"),
        (DYNAMIC_MATERIAL, "dynamicMaterial"),
        (TEXTURE_NAME, "TextureName"),
        (TEXTURE_PATH, "texturePath"),
        (ADDRESS_U, "addressU"),
        (ADDRESS_V, "addressV"),
        (NAME, "name"),
        (VALUE, "value"),
        (ON, "on"),
        (PASSES, "passes"),
        (SHADER, "shader"),
        (BLEND_ENABLE, "blendEnable"),
        (DST_COLOR_BLEND_FACTOR, "dstColorBlendFactor"),
        (CULL_ENABLE, "cullEnable"),
        (WINDING_TO_CULL, "windingToCull"),
        (DEPTH_ENABLE, "depthEnable"),
        (WRITE_MASK, "writeMask"),
        (OBJECT_PATH, "objectPath"),
        (TEXTURES, "textures"),
        (PARAMETERS, "parameters"),
        (STATIC_SWITCHES, "staticSwitches"),
        (FEATURE_DEFINES, "featureDefines"),
        (DEFAULT_TEXTURE_PATH, "defaultTexturePath"),
        (DATA, "data"),
        (LOGICAL_PARAMETERS, "logicalParameters"),
        (ON_BY_DEFAULT, "onByDefault"),
    ] {
        assert_eq!(hash, h(name), "{name}");
    }
}
