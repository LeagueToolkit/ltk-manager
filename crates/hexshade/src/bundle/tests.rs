use super::*;

use crate::dxbc::tests::container;

#[test]
fn a_toc_path_is_lowercase_with_the_hyphen_separator() {
    assert_eq!(
        toc_path("Shaders/SkinnedMesh/Diffuse_Bloom", Stage::Vertex),
        "assets/shaders/generated/shaders/skinnedmesh/diffuse_bloom.vs-dx11"
    );
    assert_eq!(
        toc_path("Shaders/StaticMesh/DefaultEnv_Flat", Stage::Pixel),
        "assets/shaders/generated/shaders/staticmesh/defaultenv_flat.ps-dx11"
    );
}

#[test]
fn an_hlsl_toc_path_is_the_file_lowercase_with_the_hyphen_separator() {
    assert_eq!(
        hlsl_toc_path("ASSETS/Shaders/HLSL/SkinnedMesh/LIT_UBER_VS.vs"),
        "assets/shaders/hlsl/skinnedmesh/lit_uber_vs.vs-dx11"
    );
}

#[test]
fn a_bundle_path_names_the_hundred_its_record_falls_in() {
    assert_eq!(bundle_path("toc", 0), "toc_0");
    assert_eq!(bundle_path("toc", 99), "toc_0");
    assert_eq!(bundle_path("toc", 100), "toc_100");
    assert_eq!(bundle_path("toc", 250), "toc_200");
    assert_eq!(index_in_bundle(250), 50);
}

#[test]
fn a_chunk_hash_is_case_insensitive() {
    assert_eq!(
        chunk_hash("Assets/Shaders/X"),
        chunk_hash("assets/shaders/x")
    );
}

fn bundle_of(records: &[&[u8]]) -> Vec<u8> {
    let mut out = Vec::new();
    for record in records {
        out.extend((record.len() as u32).to_le_bytes());
        out.extend_from_slice(record);
    }
    out
}

#[test]
fn a_record_is_trimmed_to_its_container() {
    let blob = container();
    let mut padded = blob.clone();
    padded.push(0x35);
    let bundle = bundle_of(&[b"\x00\x01", &padded]);
    assert_eq!(record(&bundle, 1).unwrap(), blob.as_slice());
    assert_eq!(
        record(&bundle, 0).unwrap_err(),
        BundleError::Container(ContainerError::NotDxbc)
    );
    assert_eq!(
        record(&bundle, 2).unwrap_err(),
        BundleError::NoRecord { index: 2 }
    );
}

fn toc(defines: &[&str], keys: &[(&[&str], u32)]) -> ShaderToc {
    let base = defines
        .iter()
        .map(|define| {
            let (name, value) = define.split_once('=').unwrap_or((define, ""));
            ShaderMacroDefinition::new(name.to_owned(), value.to_owned())
        })
        .collect();
    let (hashes, ids) = keys
        .iter()
        .map(|(set, id)| (xxh64(set.concat().as_bytes(), 0), *id))
        .unzip();
    ShaderToc::new(base, hashes, ids)
}

#[test]
fn a_permutation_is_keyed_by_the_declared_defines_in_name_order() {
    let toc = toc(
        &["DISABLE_FOW=1", "ALPHA_TEST=1"],
        &[
            (&["ALPHA_TEST=1", "DISABLE_FOW=1"], 7),
            (&["DISABLE_FOW=1"], 3),
        ],
    );
    let both = Defines::from_iter([
        ("DISABLE_FOW", "1"),
        ("ALPHA_TEST", "1"),
        ("SOMETHING_ELSE", "1"),
    ]);
    assert_eq!(permutation(&toc, &both), Some(7));
    let one = Defines::from_iter([("DISABLE_FOW", "1")]);
    assert_eq!(permutation(&toc, &one), Some(3));
    let other = Defines::from_iter([("ALPHA_TEST", "0")]);
    assert_eq!(permutation(&toc, &other), None);
}
