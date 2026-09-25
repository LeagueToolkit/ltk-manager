use glam::vec4;
use ltk_meta::BinObject;
use ltk_meta::property::values;

use super::*;
use crate::material::tests::{
    BLACK, DIFFUSE, MASK, MATERIAL, Material, Placed, SHADER_PATH, Tables, body, document_of,
    embedded, file, h, list, param, pass, placed, sampler, shader_param, shader_switch,
    shader_texture, shaders, string_map, switch,
};
use crate::material::{
    ADDRESS_U, ADDRESS_W, DATA, FEATURE_DEFINES, FIELDS, FILTER_MIN, LOGICAL_PARAMETERS,
    OBJECT_PATH, ON_BY_DEFAULT, PARAMETERS, RUNTIME_SWITCH, SAMPLER_NAME, STATIC_SWITCHES,
    SWITCHES, TEXTURE_NAME, TEXTURE_PATH, TEXTURES,
};

fn shader_switch_runtime(name: &str, on_by_default: bool) -> values::Embedded {
    embedded(
        "ShaderStaticSwitch",
        vec![
            (NAME, values::String::from(name).into()),
            (ON_BY_DEFAULT, values::Bool::new(on_by_default).into()),
            (RUNTIME_SWITCH, values::Bool::new(true).into()),
        ],
    )
}

/// A physical parameter whose logical names each write through their own mask.
fn shader_param_masked(name: &str, data: [f32; 4], logical: &[(&str, u32)]) -> values::Embedded {
    let logical = logical
        .iter()
        .map(|(name, fields)| {
            embedded(
                "ShaderLogicalParameter",
                vec![
                    (NAME, values::String::from(*name).into()),
                    (FIELDS, values::U32::new(*fields).into()),
                ],
            )
        })
        .collect();
    embedded(
        "ShaderPhysicalParameter",
        vec![
            (NAME, values::String::from(name).into()),
            (
                DATA,
                values::Vector4::new(vec4(data[0], data[1], data[2], data[3])).into(),
            ),
            (LOGICAL_PARAMETERS, list(logical)),
        ],
    )
}

fn shader_texture_shared(name: &str, sampler: &str) -> values::Embedded {
    embedded(
        "ShaderTexture",
        vec![
            (NAME, values::String::from(name).into()),
            (SAMPLER_NAME, values::String::from(sampler).into()),
        ],
    )
}

fn resolve(material: Material, shaders: Option<&BinDocument>) -> ResolvedMaterial {
    let document = document_of(vec![material.build()]);
    resolve_passes(&document, h(MATERIAL), &Tables, &Placed, shaders).unwrap()
}

fn only_pass(resolved: &ResolvedMaterial) -> &ResolvedPass {
    assert_eq!(resolved.passes.len(), 1, "{:?}", resolved.passes);
    &resolved.passes[0]
}

fn define(name: &str, value: &str, source: DefineSource) -> Define {
    Define {
        name: name.to_owned(),
        value: value.to_owned(),
        source,
    }
}

#[test]
fn a_body_material_resolves_every_input_its_shader_declares() {
    let resolved = resolve(body(), Some(&shaders()));
    let pass = only_pass(&resolved);

    assert_eq!(resolved.name.as_deref(), Some(MATERIAL));
    assert_eq!(resolved.kind, MaterialKind::SkinnedMesh);
    assert!(!resolved.animated);
    assert_eq!(pass.shader.as_deref(), Some(SHADER_PATH));
    assert_eq!(
        pass.defines,
        [define("FEATURE_BLOOM", "1", DefineSource::Feature)]
    );
    assert!(pass.runtime_switches.is_empty());
    assert_eq!(
        pass.textures,
        [
            PassTexture {
                name: "Diffuse_Texture".to_owned(),
                texture: Some(placed(DIFFUSE)),
                source: TextureSource::Material,
                sampler: SamplerState {
                    wrap: [Wrap::Clamp, Wrap::Repeat, Wrap::Repeat],
                    ..SamplerState::default()
                },
            },
            PassTexture {
                name: "Mask_Texture".to_owned(),
                texture: Some(NamedAsset {
                    path: MASK.to_owned(),
                    asset: None,
                }),
                source: TextureSource::Material,
                sampler: SamplerState::default(),
            },
            PassTexture {
                name: "Emissive_Texture".to_owned(),
                texture: Some(placed(BLACK)),
                source: TextureSource::ShaderDefault,
                sampler: SamplerState::default(),
            },
        ]
    );
    assert_eq!(
        pass.params,
        [
            PassParam {
                name: "TintColor".to_owned(),
                value: [1.0, 0.5, 0.25, 1.0],
                source: ParamSource::Material,
            },
            PassParam {
                name: "Bloom_Intensity".to_owned(),
                value: [2.0, 0.0, 0.0, 0.0],
                source: ParamSource::Material,
            },
            PassParam {
                name: "Alpha".to_owned(),
                value: [0.75, 0.0, 0.0, 0.0],
                source: ParamSource::ShaderDefault,
            },
        ]
    );
    assert_eq!(
        pass.state,
        PassState {
            blend_enable: true,
            dst_color: BlendFactor::SrcAlpha,
            ..PassState::default()
        }
    );
    assert_eq!(
        resolved.warnings,
        [MaterialWarning::TextureNotFound {
            name: "Mask_Texture".to_owned(),
            path: MASK.to_owned(),
        }]
    );
}

#[test]
fn the_define_list_runs_material_feature_switch_pass_with_later_winning() {
    let shader = BinObject::builder(h(SHADER_PATH), h("CustomShaderDef"))
        .property(OBJECT_PATH, values::String::from(SHADER_PATH))
        .property(
            STATIC_SWITCHES,
            list(vec![
                shader_switch("GLOW_ON", true),
                shader_switch("FRESNEL_ON", false),
                shader_switch("OUTLINE_ON", false),
                shader_switch_runtime("HIT_FLASH", false),
            ]),
        )
        .property(
            FEATURE_DEFINES,
            string_map(&[("FEATURE_BLOOM", "1"), ("QUALITY", "high")]),
        )
        .build();
    let defs = document_of(vec![shader]);
    let material = Material::new()
        .with(
            SHADER_MACROS,
            string_map(&[("QUALITY", "low"), ("SKINNED", "1"), ("LOD", "0")]),
        )
        .switches(vec![
            switch("GLOW_ON", Some(false)),
            switch("FRESNEL_ON", None),
            switch("HIT_FLASH", None),
            switch("UNKNOWN_ON", None),
        ])
        .passes(vec![pass(
            SHADER_PATH,
            vec![(SHADER_MACROS, string_map(&[("LOD", "2")]))],
        )]);

    let resolved = resolve(material, Some(&defs));
    let pass = only_pass(&resolved);

    assert_eq!(
        pass.defines,
        [
            define("FEATURE_BLOOM", "1", DefineSource::Feature),
            define("FRESNEL_ON", "1", DefineSource::Switch),
            define("GLOW_ON", "0", DefineSource::Switch),
            define("LOD", "2", DefineSource::Pass),
            define("OUTLINE_ON", "0", DefineSource::Switch),
            define("QUALITY", "high", DefineSource::Feature),
            define("SKINNED", "1", DefineSource::Material),
        ]
    );
    assert_eq!(
        pass.runtime_switches,
        [RuntimeSwitch {
            name: "HIT_FLASH".to_owned(),
            on: true,
        }]
    );
    assert_eq!(
        resolved.warnings,
        [MaterialWarning::UndeclaredSwitch {
            name: "UNKNOWN_ON".to_owned()
        }]
    );
}

#[test]
fn a_logical_value_scatters_through_its_mask_and_an_absent_value_writes_zeros() {
    let shader = BinObject::builder(h(SHADER_PATH), h("CustomShaderDef"))
        .property(OBJECT_PATH, values::String::from(SHADER_PATH))
        .property(
            PARAMETERS,
            list(vec![
                shader_param_masked(
                    "Wave",
                    [9.0, 9.0, 9.0, 9.0],
                    &[("WaveSpeed", 0b0011), ("WaveHeight", 0b1000)],
                ),
                shader_param("WaveStrength", [0.0, 1.0, 0.0, 0.0]),
                shader_param("Untouched", [4.0, 3.0, 2.0, 1.0]),
            ]),
        )
        .build();
    let defs = document_of(vec![shader]);
    let material = Material::new()
        .params(vec![
            param("WaveSpeed", Some([1.0, 2.0, 3.0, 4.0])),
            param("WaveHeight", Some([5.0, 0.0, 0.0, 0.0])),
            param("WaveStrength", None),
            param("Nobody", Some([1.0; 4])),
        ])
        .passes(vec![pass(SHADER_PATH, vec![])]);

    let resolved = resolve(material, Some(&defs));
    let pass = only_pass(&resolved);

    assert_eq!(
        pass.params,
        [
            PassParam {
                name: "Wave".to_owned(),
                value: [1.0, 2.0, 9.0, 5.0],
                source: ParamSource::Material,
            },
            PassParam {
                name: "WaveStrength".to_owned(),
                value: [0.0; 4],
                source: ParamSource::Material,
            },
            PassParam {
                name: "Untouched".to_owned(),
                value: [4.0, 3.0, 2.0, 1.0],
                source: ParamSource::ShaderDefault,
            },
        ]
    );
    assert_eq!(
        resolved.warnings,
        [MaterialWarning::UndeclaredParam {
            name: "Nobody".to_owned()
        }]
    );
}

#[test]
fn the_schema_lists_every_declaration_with_its_default() {
    let shader = BinObject::builder(h(SHADER_PATH), h("CustomShaderDef"))
        .property(OBJECT_PATH, values::String::from(SHADER_PATH))
        .property(
            PARAMETERS,
            list(vec![
                shader_param_masked(
                    "Wave",
                    [1.0, 2.0, 3.0, 4.0],
                    &[("WaveSpeed", 0b0011), ("WaveHeight", 0b1000)],
                ),
                shader_param_masked("Whole", [5.0, 6.0, 7.0, 8.0], &[]),
            ]),
        )
        .property(
            TEXTURES,
            list(vec![
                shader_texture("Diffuse_Texture", Some(BLACK)),
                shader_texture_shared("Noise_Texture", "Linear_Wrap"),
            ]),
        )
        .property(
            STATIC_SWITCHES,
            list(vec![
                shader_switch("GLOW_ON", true),
                shader_switch_runtime("HIT_FLASH", false),
            ]),
        )
        .build();
    let defs = document_of(vec![shader]);
    let material = Material::new().passes(vec![pass(SHADER_PATH, vec![])]);

    let resolved = resolve(material, Some(&defs));
    let schema = only_pass(&resolved).schema.as_ref().unwrap();

    let param = |name: &str, fields: u32, default: [f32; 4]| SchemaParam {
        name: name.to_owned(),
        physical: if name == "Whole" { "Whole" } else { "Wave" }.to_owned(),
        fields,
        default,
    };
    assert_eq!(
        schema.params,
        [
            param("WaveSpeed", 0b0011, [1.0, 2.0, 0.0, 0.0]),
            param("WaveHeight", 0b1000, [4.0, 0.0, 0.0, 0.0]),
            param("Whole", 0b1111, [5.0, 6.0, 7.0, 8.0]),
        ]
    );
    assert_eq!(
        schema.textures,
        [
            SchemaTexture {
                name: "Diffuse_Texture".to_owned(),
                default: Some(BLACK.to_owned()),
                shared_sampler: None,
            },
            SchemaTexture {
                name: "Noise_Texture".to_owned(),
                default: None,
                shared_sampler: Some("Linear_Wrap".to_owned()),
            },
        ]
    );
    assert_eq!(
        schema.switches,
        [
            SchemaSwitch {
                name: "GLOW_ON".to_owned(),
                on_by_default: true,
                runtime: false,
            },
            SchemaSwitch {
                name: "HIT_FLASH".to_owned(),
                on_by_default: false,
                runtime: true,
            },
        ]
    );
}

#[test]
fn a_pass_without_the_defs_carries_no_schema() {
    let resolved = resolve(body(), None);

    assert_eq!(only_pass(&resolved).schema, None);
}

#[test]
fn a_material_value_writes_over_the_pass_value() {
    let material = body().passes(vec![pass(
        SHADER_PATH,
        vec![(
            PARAM_VALUES,
            list(vec![param("TintColor", Some([0.0, 0.0, 1.0, 1.0]))]),
        )],
    )]);

    let resolved = resolve(material, Some(&shaders()));
    let tint = &only_pass(&resolved).params[0];

    assert_eq!(tint.value, [1.0, 0.5, 0.25, 1.0]);
    assert_eq!(tint.source, ParamSource::Material);
}

#[test]
fn a_shared_sampler_and_the_entry_modes_both_reach_the_record() {
    let shader = BinObject::builder(h(SHADER_PATH), h("CustomShaderDef"))
        .property(OBJECT_PATH, values::String::from(SHADER_PATH))
        .property(
            TEXTURES,
            list(vec![
                shader_texture_shared("Diffuse_Texture", "Wrap_No_Mip"),
                shader_texture("Noise_Texture", None),
                shader_texture("Mask_Texture", Some(BLACK)),
            ]),
        )
        .build();
    let defs = document_of(vec![shader]);
    let volume = embedded(
        "StaticMaterialShaderSamplerDef",
        vec![
            (TEXTURE_NAME, values::String::from("Noise_Texture").into()),
            (TEXTURE_PATH, file(DIFFUSE)),
            (ADDRESS_U, values::U32::new(2).into()),
            (ADDRESS_W, values::U32::new(3).into()),
            (FILTER_MIN, values::U32::new(0).into()),
        ],
    );
    let material = Material::new()
        .samplers(vec![
            sampler("Diffuse_Texture", file(DIFFUSE), None),
            volume,
        ])
        .passes(vec![pass(SHADER_PATH, vec![])]);

    let resolved = resolve(material, Some(&defs));
    let pass = only_pass(&resolved);

    assert_eq!(
        pass.textures[0].sampler,
        SamplerState {
            shared: Some("Wrap_No_Mip".to_owned()),
            ..SamplerState::default()
        }
    );
    assert_eq!(
        pass.textures[1].sampler,
        SamplerState {
            shared: None,
            wrap: [Wrap::Mirror, Wrap::Repeat, Wrap::Border],
            filter_min: false,
            filter_mag: true,
        }
    );
    assert_eq!(pass.textures[2].source, TextureSource::ShaderDefault);
    assert!(resolved.warnings.is_empty(), "{:?}", resolved.warnings);
}

#[test]
fn a_texture_no_step_names_is_the_fallback_and_warned() {
    let shader = BinObject::builder(h(SHADER_PATH), h("CustomShaderDef"))
        .property(OBJECT_PATH, values::String::from(SHADER_PATH))
        .property(TEXTURES, list(vec![shader_texture("Detail_Texture", None)]))
        .build();
    let defs = document_of(vec![shader]);
    let material = Material::new().passes(vec![pass(SHADER_PATH, vec![])]);

    let resolved = resolve(material, Some(&defs));
    let texture = &only_pass(&resolved).textures[0];

    assert_eq!(texture.texture, None);
    assert_eq!(texture.source, TextureSource::Fallback);
    assert_eq!(
        resolved.warnings,
        [MaterialWarning::NoTexturePath {
            name: "Detail_Texture".to_owned()
        }]
    );
}

#[test]
fn the_render_state_reads_every_field_the_pass_writes() {
    let material = Material::new().passes(vec![pass(
        SHADER_PATH,
        vec![
            (BLEND_ENABLE, values::Bool::new(true).into()),
            (SRC_COLOR_BLEND_FACTOR, values::U32::new(6).into()),
            (DST_COLOR_BLEND_FACTOR, values::U32::new(7).into()),
            (SRC_ALPHA_BLEND_FACTOR, values::U32::new(0).into()),
            (DST_ALPHA_BLEND_FACTOR, values::U32::new(1).into()),
            (CULL_ENABLE, values::Bool::new(false).into()),
            (WINDING_TO_CULL, values::U32::new(0).into()),
            (DEPTH_ENABLE, values::Bool::new(false).into()),
            (DEPTH_COMPARE_FUNC, values::U32::new(7).into()),
            (WRITE_MASK, values::U32::new(15).into()),
        ],
    )]);

    let resolved = resolve(material, None);

    assert_eq!(
        only_pass(&resolved).state,
        PassState {
            blend_enable: true,
            src_color: BlendFactor::SrcAlpha,
            dst_color: BlendFactor::OneMinusSrcAlpha,
            src_alpha: BlendFactor::Zero,
            dst_alpha: BlendFactor::One,
            cull_enable: false,
            winding_to_cull: Winding::Cw,
            depth_enable: false,
            depth_compare_func: 7,
            write_mask: 15,
        }
    );
}

#[test]
fn without_the_defs_a_pass_lists_what_the_material_writes_and_says_so_once() {
    let material = body()
        .with(SWITCHES, list(vec![]))
        .passes(vec![pass(SHADER_PATH, vec![]), pass(SHADER_PATH, vec![])]);

    let resolved = resolve(material, None);

    assert_eq!(resolved.passes.len(), 2);
    let pass = &resolved.passes[1];
    assert_eq!(pass.shader.as_deref(), Some(SHADER_PATH));
    assert!(pass.defines.is_empty());
    assert_eq!(
        pass.textures
            .iter()
            .map(|texture| texture.name.as_str())
            .collect::<Vec<_>>(),
        ["Diffuse_Texture", "Mask_Texture"]
    );
    assert_eq!(
        pass.params
            .iter()
            .map(|param| (param.name.as_str(), param.source))
            .collect::<Vec<_>>(),
        [
            ("TintColor", ParamSource::Material),
            ("Bloom_Intensity", ParamSource::Material),
        ]
    );
    assert_eq!(
        resolved.warnings,
        [
            MaterialWarning::NoShaderDefs,
            MaterialWarning::TextureNotFound {
                name: "Mask_Texture".to_owned(),
                path: MASK.to_owned(),
            },
        ]
    );
}

#[test]
fn a_material_without_a_pass_has_none_and_is_warned() {
    let resolved = resolve(Material::new(), None);

    assert!(resolved.passes.is_empty());
    assert_eq!(resolved.warnings, [MaterialWarning::NoPass]);
}

#[test]
fn the_material_kind_is_the_type_field_with_skinned_as_the_default() {
    let of = |value: Option<u8>| {
        let mut material = Material::new();
        if let Some(value) = value {
            material = material.with(MATERIAL_TYPE, values::U8::new(value).into());
        }
        resolve(material, None).kind
    };

    assert_eq!(of(None), MaterialKind::SkinnedMesh);
    assert_eq!(of(Some(0)), MaterialKind::StaticMesh);
    assert_eq!(of(Some(3)), MaterialKind::Ui);
    assert_eq!(of(Some(5)), MaterialKind::Unknown);
}

#[test]
fn a_switch_with_an_absent_on_reads_as_on() {
    let shader = BinObject::builder(h(SHADER_PATH), h("CustomShaderDef"))
        .property(OBJECT_PATH, values::String::from(SHADER_PATH))
        .property(STATIC_SWITCHES, list(vec![shader_switch("GLOW_ON", false)]))
        .build();
    let defs = document_of(vec![shader]);
    let material = Material::new()
        .switches(vec![embedded(
            "StaticMaterialSwitchDef",
            vec![(NAME, values::String::from("GLOW_ON").into())],
        )])
        .passes(vec![pass(SHADER_PATH, vec![])]);

    let resolved = resolve(material, Some(&defs));

    assert_eq!(
        only_pass(&resolved).defines,
        [define("GLOW_ON", "1", DefineSource::Switch)]
    );
}

#[test]
fn every_field_hash_is_its_name() {
    for (hash, name) in [
        (MATERIAL_TYPE, "type"),
        (SRC_ALPHA_BLEND_FACTOR, "srcAlphaBlendFactor"),
        (DST_ALPHA_BLEND_FACTOR, "dstAlphaBlendFactor"),
        (DEPTH_COMPARE_FUNC, "depthCompareFunc"),
    ] {
        assert_eq!(hash, h(name), "{name}");
    }
}
