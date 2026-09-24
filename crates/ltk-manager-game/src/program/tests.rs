use std::io::Cursor;

use ltk_hash::Hash as _;
use ltk_manager_core::material::pass::{Define, DefineSource, PassState};
use ltk_meta::property::values;
use ltk_meta::{Bin, BinObject};

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
fn the_default_skinned_program_is_lit_uber_with_a_texture_per_submesh() {
    let mut read =
        |asset: &AssetRef| -> AppResult<Vec<u8>> { panic!("nothing is located: {asset:?}") };

    let default = read_default_skinned_program(
        &(),
        ProgramOptions::default(),
        &TranslationCache::default(),
        &mut read,
    );

    assert_eq!(default.pass.shader.as_deref(), Some(LIT_UBER_NAME));
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
