use fs_err as fs;
use ltk_meta::path::PropertyPath;
use ltk_meta::{Bin, PropertyValueEnum};

use super::super::tests::{Game, SKIN, game_bin, h, project};
use super::*;
use crate::bin_document::BinDocument;
use crate::meta_schema;

const CHUNK: &str = "data/characters/teemo/skins/skin0.bin";

fn declarations(dir: &std::path::Path, manifest: &str) -> ProjectDeclarations {
    let project = project(dir);
    fs::write(dir.join("content/base/game_data.yaml"), manifest).unwrap();
    ProjectDeclarations::load(
        &project,
        PatchSchema::new(meta_schema::shared(None), None),
        Game::naming(&[SKIN]),
    )
    .unwrap()
}

fn glow(bytes: Vec<u8>) -> f32 {
    let bin = Bin::from_reader(&mut Cursor::new(bytes)).unwrap();
    let path = PropertyPath::new("skinMeshProperties.selfIllumination").unwrap();
    match bin.objects[&h(SKIN)].resolve(&path).unwrap() {
        PropertyValueEnum::F32(value) => value.value,
        other => panic!("the glow is {other:?}"),
    }
}

#[test]
fn a_chunk_an_entries_module_names_comes_back_declared() {
    let dir = tempfile::tempdir().unwrap();
    let declarations = declarations(
        dir.path(),
        &format!(
            "version: 1\nmodules:\n  - entries:\n      {SKIN}:\n        skinMeshProperties.selfIllumination: 0.37\n"
        ),
    );

    let applied = declarations
        .apply(&game_bin(), ltk_game_data::path_hash(CHUNK))
        .unwrap()
        .unwrap();

    assert!((glow(applied) - 0.37).abs() < f32::EPSILON);
}

#[test]
fn a_chunk_no_declaration_reaches_is_none() {
    let dir = tempfile::tempdir().unwrap();
    let declarations = declarations(
        dir.path(),
        "version: 1\nmodules:\n  - entries:\n      Characters/Ahri/Skins/Skin0:\n        championSkinName: Ahri\n",
    );

    let applied = declarations
        .apply(&game_bin(), ltk_game_data::path_hash(CHUNK))
        .unwrap();

    assert_eq!(applied, None);
}

/// A game chunk asset as the game index places `CHUNK`.
fn game_chunk() -> AssetRef {
    AssetRef::GameChunk {
        wad: "Champions/Teemo.wad.client".to_owned(),
        path_hash: format!("{:016x}", ltk_game_data::path_hash(CHUNK)),
    }
}

#[test]
fn declared_asset_reads_a_game_chunk_with_the_object_a_target_module_clones() {
    const CLONE: &str = "Mods/jade-teemo/Animations/Clone";
    let dir = tempfile::tempdir().unwrap();
    let declarations = declarations(
        dir.path(),
        &format!(
            "version: 1
modules:
  - target: {CHUNK}
    objects:
      {CLONE}:
        clone: {SKIN}
"
        ),
    );

    let read = declarations.declared_asset(&game_chunk(), game_bin());

    let document = BinDocument::parse(read).unwrap();
    assert!(document.object_at(h(CLONE)).is_some());
    assert!(document.object_at(h(SKIN)).is_some());
}

#[test]
fn declared_asset_applies_declarations_to_a_layer_bin() {
    let dir = tempfile::tempdir().unwrap();
    let declarations = declarations(
        dir.path(),
        &format!(
            "version: 1
modules:
  - entries:
      {SKIN}:
        skinMeshProperties.selfIllumination: 0.37
"
        ),
    );
    let layer = AssetRef::Layer {
        project: dir.path().to_string_lossy().into_owned(),
        layer: "base".to_owned(),
        path: format!("Teemo.wad.client/{CHUNK}"),
    };

    let applied = declarations.declared_asset(&layer, game_bin());

    assert!((glow(applied) - 0.37).abs() < f32::EPSILON);
    assert!(!declarations.is_empty());
}

#[test]
fn load_chosen_leaves_out_the_declarations_of_other_layers() {
    let dir = tempfile::tempdir().unwrap();
    let declared = declarations(
        dir.path(),
        &format!(
            "version: 1\nmodules:\n  - entries:\n      {SKIN}:\n        skinMeshProperties.selfIllumination: 0.37\n"
        ),
    );
    assert!(!declared.is_empty());

    let chosen = ProjectDeclarations::load_chosen(
        &project(dir.path()),
        Some(&[]),
        PatchSchema::new(meta_schema::shared(None), None),
        Game::naming(&[SKIN]),
    )
    .unwrap();

    assert!(chosen.is_empty());
    assert_eq!(chosen.declared_asset(&game_chunk(), game_bin()), game_bin());
}

#[test]
fn load_chosen_applies_the_last_chosen_layer_that_declares_a_value() {
    let dir = tempfile::tempdir().unwrap();
    let project = project(dir.path());
    let root = dir.path();
    let config = fs::read_to_string(root.join("mod.config.json")).unwrap();
    let mut config: serde_json::Value = serde_json::from_str(&config).unwrap();
    config["layers"] = serde_json::json!([
        { "name": "base", "priority": 0 },
        { "name": "evil-sunz", "priority": 1 },
        { "name": "blood-axes", "priority": 2 },
    ]);
    fs::write(root.join("mod.config.json"), config.to_string()).unwrap();
    for (layer, glow) in [("base", 0.1), ("evil-sunz", 0.2), ("blood-axes", 0.3)] {
        fs::create_dir_all(root.join("content").join(layer)).unwrap();
        fs::write(
            root.join("content").join(layer).join("game_data.yaml"),
            format!(
                "version: 1\nmodules:\n  - entries:\n      {SKIN}:\n        skinMeshProperties.selfIllumination: {glow}\n"
            ),
        )
        .unwrap();
    }
    let chosen_of = |chosen: Option<&[String]>| {
        let read = ProjectDeclarations::load_chosen(
            &project,
            chosen,
            PatchSchema::new(meta_schema::shared(None), None),
            Game::naming(&[SKIN]),
        )
        .unwrap();
        glow(read.declared_asset(&game_chunk(), game_bin()))
    };

    assert!((chosen_of(None) - 0.3).abs() < f32::EPSILON);

    let lower = ["base".to_owned(), "evil-sunz".to_owned()];
    assert!((chosen_of(Some(&lower)) - 0.2).abs() < f32::EPSILON);

    let base = ["base".to_owned()];
    assert!((chosen_of(Some(&base)) - 0.1).abs() < f32::EPSILON);
}

#[test]
fn declared_asset_leaves_a_loose_file_as_it_is() {
    let dir = tempfile::tempdir().unwrap();
    let declarations = declarations(
        dir.path(),
        &format!(
            "version: 1\nmodules:\n  - entries:\n      {SKIN}:\n        skinMeshProperties.selfIllumination: 0.37\n"
        ),
    );
    let loose = AssetRef::File {
        path: CHUNK.to_owned(),
    };

    assert_eq!(declarations.declared_asset(&loose, game_bin()), game_bin());
}

#[test]
fn creating_targets_names_the_target_whose_source_creates_the_entry() {
    const MAP: &str = "data/maps/shipping/map11/map11.bin";
    const CATEGORY: &str = "Mods/inked/CharacterInking";
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir_all(dir.path().join("content/base/game-data")).unwrap();
    fs::write(
        dir.path().join("content/base/game-data/inking.yaml"),
        format!("version: 1\nobjects:\n  {CATEGORY}:\n    clone: {SKIN}\n"),
    )
    .unwrap();
    let declarations = declarations(
        dir.path(),
        &format!(
            "version: 1
modules:
  - target: {CHUNK}
    objects:
      Mods/inked/Other:
        clone: {SKIN}
  - target: {MAP}
    source: game-data/inking.yaml
"
        ),
    );

    let targets: Vec<&str> = declarations
        .creating_targets(h(CATEGORY))
        .into_iter()
        .map(Target::as_str)
        .collect();

    assert_eq!(targets, [MAP]);
    assert!(declarations.creating_targets(h(SKIN)).is_empty());
}
