use std::collections::HashMap;

use fs_err as fs;
use ltk_meta::property::values;

use super::tests::{Game, SKIN, game_bin, h, manifest, project};
use super::*;
use crate::bin_document::LeafValue;
use crate::meta_schema;

const BASE: &str = "data/characters/teemo/skins/skin0.bin";
const VARIANT: &str = "data/characters/teemo/skins/skin0_rtl.bin";

/// A variant that renames the skin.
fn variant_bin() -> Vec<u8> {
    let patch = BinOverride::builder()
        .set(
            h(SKIN),
            PropertyPath::new("championSkinName").unwrap(),
            values::String::new("Omeet".to_owned()),
        )
        .build();
    let mut bytes = Cursor::new(Vec::new());
    patch.to_writer(&mut bytes).unwrap();
    bytes.into_inner()
}

fn declared_variant(project: ProjectDir) -> BinDocument {
    let context = DeclareContext {
        project,
        schema: PatchSchema::new(meta_schema::shared(None), None),
        game: Game::declaring(
            &[
                SKIN,
                "skinMeshProperties",
                "selfIllumination",
                "texture",
                "championSkinName",
            ],
            HashMap::from([(h(SKIN), game_bin())]),
        ),
    };
    let source = VariantSource {
        game: variant_bin(),
        target: Target::try_from(VARIANT).unwrap(),
        base: game_bin(),
        base_hash: ltk_game_data::path_hash(BASE),
        context,
    };
    BinDocument::declare_variant(source, ltk_game_data::path_hash(VARIANT)).unwrap()
}

fn at(document: &BinDocument, path: &str) -> PropertyValueEnum {
    document
        .object_at(h(SKIN))
        .unwrap()
        .resolve(&PropertyPath::new(path).unwrap())
        .unwrap()
        .clone()
}

fn glow_path() -> String {
    format!(
        "{:08x}.{:08x}",
        *h("skinMeshProperties"),
        *h("selfIllumination")
    )
}

#[test]
fn a_declared_variant_draws_its_records_over_the_base() {
    let dir = tempfile::tempdir().unwrap();

    let document = declared_variant(project(dir.path()));

    assert_eq!(
        at(&document, "championSkinName"),
        values::String::new("Omeet".to_owned()).into()
    );
    let laid = document.laid_variant().unwrap();
    assert_eq!(laid.records.len(), 1);
    assert!(laid.report.is_clean());
}

#[test]
fn an_edit_of_a_variant_lands_in_a_target_module_of_the_variant() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared_variant(project(dir.path()));

    document
        .set_leaf(h(SKIN), &glow_path(), LeafValue::Float { value: 0.5 })
        .unwrap();

    assert_eq!(
        manifest(dir.path(), "base"),
        format!(
            "version: 1\nmodules:\n  - target: {VARIANT}\n    {SKIN}:\n      \
             skinMeshProperties:\n        selfIllumination: 0.5\n"
        ),
    );
    assert_eq!(
        at(&document, "skinMeshProperties.selfIllumination"),
        values::F32::new(0.5).into()
    );
    let records: Vec<&str> = document
        .laid_variant()
        .unwrap()
        .records
        .iter()
        .map(|record| record.path.as_str())
        .collect();
    assert_eq!(
        records,
        ["championSkinName", "skinMeshProperties.selfIllumination"]
    );
}

#[test]
fn a_declaration_of_the_base_shows_through_the_variant() {
    let dir = tempfile::tempdir().unwrap();
    let project = project(dir.path());
    fs::write(
        dir.path().join("content/base/game_data.yaml"),
        format!(
            "version: 1\nmodules:\n  - entries:\n      {SKIN}:\n        \
             skinMeshProperties.texture: assets/jade.tex\n        championSkinName: Jade\n"
        ),
    )
    .unwrap();

    let document = declared_variant(project);

    assert_eq!(
        at(&document, "skinMeshProperties.texture"),
        values::String::new("assets/jade.tex".to_owned()).into()
    );
    assert_eq!(
        at(&document, "championSkinName"),
        values::String::new("Omeet".to_owned()).into()
    );
}
