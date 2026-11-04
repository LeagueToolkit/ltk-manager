use std::io::Cursor;

use ltk_hash::Hash as _;
use ltk_manager_bin::bin_document::hex;
use ltk_meta::property::values;
use ltk_meta::{Bin, BinObject};

use crate::material::pass::PassState;

use super::*;

const MATERIAL: &str = "Characters/Ahri/Skins/Skin3/Materials/Body";
const SHADER_PATH: &str = "Shaders/SkinnedMesh/Diffuse_Bloom";

fn h(text: &str) -> BinHash {
    BinHash::hash_str(text)
}

fn document_of(objects: Vec<BinObject>) -> BinDocument {
    let mut bin = Bin::builder();
    for object in objects {
        bin = bin.object(object);
    }
    let mut out = Cursor::new(Vec::new());
    bin.build().to_writer(&mut out).unwrap();
    BinDocument::parse(out.into_inner()).unwrap()
}

/// A material with one pass linking the body shader, and the def that names it.
fn material_and_shaders() -> (BinDocument, BinDocument) {
    let pass = values::Embedded(values::Struct {
        class_hash: h("StaticMaterialPassDef"),
        properties: [(h("shader"), values::ObjectLink::new(h(SHADER_PATH)).into())]
            .into_iter()
            .collect(),
    });
    let technique = values::Embedded(values::Struct {
        class_hash: h("StaticMaterialTechniqueDef"),
        properties: [
            (h("name"), values::String::from("normal").into()),
            (h("passes"), values::Container::from(vec![pass]).into()),
        ]
        .into_iter()
        .collect(),
    });
    let material = BinObject::builder(h(MATERIAL), h("StaticMaterialDef"))
        .property(h("techniques"), values::Container::from(vec![technique]))
        .build();
    let shader = BinObject::builder(h(SHADER_PATH), h("CustomShaderDef"))
        .property(h("objectPath"), values::String::from(SHADER_PATH))
        .build();
    (document_of(vec![material]), document_of(vec![shader]))
}

fn pass_with(defines: &[(&str, &str)]) -> ResolvedPass {
    ResolvedPass {
        shader: Some(SHADER_PATH.to_owned()),
        defines: defines
            .iter()
            .map(|(name, value)| Define {
                name: (*name).to_owned(),
                value: (*value).to_owned(),
                source: DefineSource::Pass,
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

#[test]
fn the_studio_defines_join_the_list_and_the_pass_wins_on_a_name() {
    let pass = pass_with(&[("FEATURE_BLOOM", "1"), ("DISABLE_FOW", "0")]);

    let skinned = define_list(
        &pass,
        MaterialKind::SkinnedMesh,
        ProgramOptions { low_quality: true },
    );
    let flat = define_list(&pass, MaterialKind::StaticMesh, ProgramOptions::default());

    assert_eq!(
        skinned.to_entries(),
        [
            "DISABLE_FOW=0",
            "DISABLE_SHADOWS=1",
            "FEATURE_BLOOM=1",
            "LOW_QUALITY_MODE=1",
            "NUM_BLEND_WEIGHTS=4",
        ]
    );
    assert_eq!(
        flat.to_entries(),
        ["DISABLE_FOW=0", "DISABLE_SHADOWS=1", "FEATURE_BLOOM=1"]
    );
}

#[test]
fn a_shader_cache_the_machine_lacks_fails_the_pass_without_a_guess() {
    let (document, shaders) = material_and_shaders();
    let mut read = |asset: &AssetRef| -> AppResult<Vec<u8>> {
        panic!("nothing was located, so nothing reads: {asset:?}")
    };

    let programs = read_programs(
        Resolution {
            document: &document,
            names: &(),
            assets: &(),
            shaders: Some(&shaders),
        },
        &[h(MATERIAL), h("Characters/Ahri/Skins/Skin3/Materials/Gone")],
        ProgramOptions::default(),
        &TranslationCache::default(),
        &mut read,
    );

    let [Some(material), None] = programs.as_slice() else {
        panic!("{programs:?}");
    };
    assert_eq!(material.passes.len(), 1);
    assert_eq!(
        material.passes[0].program,
        ProgramRead::Failed {
            reason: "Nothing on this machine holds \
                     assets/shaders/generated/shaders/skinnedmesh/diffuse_bloom.vs-dx11"
                .to_owned(),
        }
    );
}

#[test]
fn read_programs_resolves_a_shader_def_against_its_own_document() {
    let (_, shaders) = material_and_shaders();
    let mut read = |asset: &AssetRef| -> AppResult<Vec<u8>> {
        panic!("no asset is located, so none is read: {asset:?}")
    };

    let programs = read_programs(
        Resolution {
            document: &shaders,
            names: &(),
            assets: &(),
            shaders: None,
        },
        &[h(SHADER_PATH)],
        ProgramOptions::default(),
        &TranslationCache::default(),
        &mut read,
    );

    let [Some(shader)] = programs.as_slice() else {
        panic!("{programs:?}");
    };
    assert_eq!(shader.kind, MaterialKind::SkinnedMesh);
    assert_eq!(shader.passes[0].pass.shader.as_deref(), Some(SHADER_PATH));
    assert!(shader.warnings.is_empty(), "{:?}", shader.warnings);
}

#[test]
fn with_preview_replaces_and_adds_defines_sorted_by_name() {
    let mut defines = pass_with(&[("USE_RIM", "1"), ("FEATURE_BLOOM", "1")]).defines;

    with_preview(
        &mut defines,
        &[
            "USE_RIM=0".to_owned(),
            "ADD_GLOW=1".to_owned(),
            "skipped".to_owned(),
        ],
    );

    let listed: Vec<(&str, &str, DefineSource)> = defines
        .iter()
        .map(|define| (define.name.as_str(), define.value.as_str(), define.source))
        .collect();
    assert_eq!(
        listed,
        [
            ("ADD_GLOW", "1", DefineSource::Preview),
            ("FEATURE_BLOOM", "1", DefineSource::Pass),
            ("USE_RIM", "0", DefineSource::Preview),
        ]
    );
}

#[test]
fn changes_lists_the_set_and_removed_defines() {
    let requested: Defines = [("USE_RIM", "1"), ("LOCK", "0"), ("DISABLE_FOW", "1")]
        .into_iter()
        .collect();
    let found: Defines = [("USE_RIM", "0"), ("GLOW", "1"), ("DISABLE_FOW", "1")]
        .into_iter()
        .collect();

    let warning = changes(&requested, &found);

    assert_eq!(
        warning,
        MaterialWarning::NearestPermutation {
            set: vec!["GLOW=1".to_owned(), "USE_RIM=0".to_owned()],
            unset: vec!["LOCK".to_owned()],
        }
    );
}

#[test]
fn grouped_lists_each_name_once_with_its_values() {
    let pairs = [("A", "0"), ("A", "1"), ("B", "4")]
        .map(|(name, value)| (name.to_owned(), value.to_owned()))
        .to_vec();

    let declared = grouped(pairs);

    assert_eq!(
        declared,
        [
            DeclaredDefine {
                name: "A".to_owned(),
                values: vec!["0".to_owned(), "1".to_owned()],
            },
            DeclaredDefine {
                name: "B".to_owned(),
                values: vec!["4".to_owned()],
            },
        ]
    );
}

#[test]
fn read_shader_program_resolves_a_material_of_another_bin_against_the_open_def() {
    let (material, shaders) = material_and_shaders();
    let mut read = |asset: &AssetRef| -> AppResult<Vec<u8>> {
        panic!("no asset is located, so none is read: {asset:?}")
    };

    let program = read_shader_program(
        Resolution {
            document: &shaders,
            names: &(),
            assets: &(),
            shaders: None,
        },
        h(SHADER_PATH),
        Some((&material, h(MATERIAL))),
        &["USE_RIM=1".to_owned()],
        ProgramOptions::default(),
        &TranslationCache::default(),
        &mut read,
    )
    .unwrap();

    let pass = &program.program.passes[0].pass;
    assert_eq!(program.program.hash, hex(h(MATERIAL)));
    assert_eq!(pass.shader.as_deref(), Some(SHADER_PATH));
    assert_eq!(pass.defines[0].source, DefineSource::Preview);
}

#[test]
fn read_shader_program_returns_none_if_no_object_is_at_entry() {
    let (_, shaders) = material_and_shaders();
    let mut read = |_: &AssetRef| -> AppResult<Vec<u8>> { unreachable!("no lookup") };

    let program = read_shader_program(
        Resolution {
            document: &shaders,
            names: &(),
            assets: &(),
            shaders: None,
        },
        h("Shaders/SkinnedMesh/Missing"),
        None,
        &[],
        ProgramOptions::default(),
        &TranslationCache::default(),
        &mut read,
    );

    assert_eq!(program, None);
}

#[test]
fn a_pass_without_a_shader_fails_before_any_lookup() {
    let (document, _) = material_and_shaders();
    let mut read = |_: &AssetRef| -> AppResult<Vec<u8>> { unreachable!("no lookup") };

    let programs = read_programs(
        Resolution {
            document: &document,
            names: &(),
            assets: &(),
            shaders: None,
        },
        &[h(MATERIAL)],
        ProgramOptions::default(),
        &TranslationCache::default(),
        &mut read,
    );

    let pass = &programs[0].as_ref().unwrap().passes[0];
    assert_eq!(pass.pass.shader, None);
    assert!(matches!(pass.program, ProgramRead::Failed { .. }));
}

#[test]
fn a_particle_pass_lists_the_emitter_defines_under_the_studio_defines() {
    let pass = particle_pass(
        ParticleShader::Quad,
        &[
            ParticleDefine::MultPass,
            ParticleDefine::AlphaTest,
            ParticleDefine::MultPass,
        ],
    );

    let defines = define_list(&pass, MaterialKind::Particles, ProgramOptions::default());

    assert_eq!(pass.shader.as_deref(), Some("ParticleSystem/QUAD"));
    assert_eq!(
        defines.to_entries(),
        [
            "ALPHA_TEST=1",
            "DISABLE_FOW=1",
            "DISABLE_SHADOWS=1",
            "MULT_PASS=1",
        ]
    );
}

#[test]
fn a_particle_define_crosses_ipc_as_its_bytecode_name() {
    for define in ParticleDefine::ALL {
        assert_eq!(
            serde_json::to_value(define).unwrap(),
            define.name(),
            "{define:?}"
        );
    }
}

#[test]
fn a_particle_shader_the_machine_lacks_fails_without_a_guess() {
    let mut read =
        |asset: &AssetRef| -> AppResult<Vec<u8>> { panic!("nothing is located: {asset:?}") };

    let particle = read_particle_program(
        &(),
        ParticleShader::QuadSlice,
        &[ParticleDefine::AlphaTest],
        ProgramOptions::default(),
        &TranslationCache::default(),
        &mut read,
    );

    assert_eq!(
        particle.program,
        ProgramRead::Failed {
            reason: "Nothing on this machine holds \
                     assets/shaders/hlsl/particlesystem/quad_vs.vs-dx11"
                .to_owned(),
        }
    );
}

#[test]
fn the_default_skinned_program_is_lit_uber_with_a_texture_per_submesh() {
    let mut read =
        |asset: &AssetRef| -> AppResult<Vec<u8>> { panic!("nothing is located: {asset:?}") };

    let default = read_default_skinned_program(
        &(),
        SkinnedShading::Base,
        ProgramOptions::default(),
        &TranslationCache::default(),
        &mut read,
    );

    assert_eq!(default.pass.shader.as_deref(), Some(LIT_UBER_NAME));
    assert!(default.pass.defines.is_empty());
    let names: Vec<&str> = default
        .pass
        .textures
        .iter()
        .map(|texture| texture.name.as_str())
        .collect();
    assert_eq!(names, [LIT_UBER_DIFFUSE, LIT_UBER_EMISSIVE]);
    assert_eq!(
        default.program,
        ProgramRead::Failed {
            reason: "Nothing on this machine holds \
                     assets/shaders/hlsl/skinnedmesh/lit_uber_vs.vs-dx11"
                .to_owned(),
        }
    );
}

#[test]
fn the_default_skinned_program_selects_the_features_of_its_shading() {
    let mut read =
        |asset: &AssetRef| -> AppResult<Vec<u8>> { panic!("nothing is located: {asset:?}") };

    let default = read_default_skinned_program(
        &(),
        SkinnedShading::RoughnessMetallicNormal,
        ProgramOptions::default(),
        &TranslationCache::default(),
        &mut read,
    );

    let defines: Vec<(&str, &str)> = default
        .pass
        .defines
        .iter()
        .map(|define| (define.name.as_str(), define.value.as_str()))
        .collect();
    assert_eq!(
        defines,
        [
            ("FEATURE_ROUGHNESS_METALLIC", "1"),
            ("FEATURE_TANGENT", "1"),
        ]
    );
    let names: Vec<&str> = default
        .pass
        .textures
        .iter()
        .map(|texture| texture.name.as_str())
        .collect();
    assert_eq!(names, [LIT_UBER_DIFFUSE, LIT_UBER_RMA, LIT_UBER_NORMAL]);
}
