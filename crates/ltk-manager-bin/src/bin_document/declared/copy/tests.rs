use std::collections::HashMap;

use indexmap::IndexMap;
use ltk_hash::BinHash;

use ltk_game_data::{Selector, load_declarations};
use ltk_meta::property::{Kind, values};
use ltk_meta::{Bin, BinObject, PropertyValueEnum};

use super::super::tests::{Game, SKIN, declared, h, manifest, project};
use super::super::{DeclareContext, DeclaredDiagnosticKind, SkipReason};
use super::*;
use crate::meta_schema::{self, PatchSchema};

const RESOURCES: &str = "Characters/Teemo/Skins/Skin0/Resources";
const JADE: &str = "Characters/Jade_Teemo/Skins/Skin0/Resources";
const CHUNK: &str = "data/characters/teemo/skins/skin0.bin";
const NAMES: [&str; 8] = [
    RESOURCES,
    JADE,
    "resourceMap",
    "Teemo_Q",
    "Teemo_R",
    "Particles/Q",
    "Particles/R",
    "Particles/Jade_R",
];

fn field(name: &str) -> String {
    format!("{:08x}", *h(name))
}

fn link(key: &str, target: &str) -> (PropertyValueEnum, PropertyValueEnum) {
    (
        values::Hash::new(h(key)).into(),
        values::ObjectLink::new(h(target)).into(),
    )
}

/// A chunk holding `entry` with a resource map of `links`.
fn resources(entry: &str, links: &[(&str, &str)]) -> Vec<u8> {
    let entries = links
        .iter()
        .map(|(key, target)| link(key, target))
        .collect();
    let object = BinObject::builder(h(entry), h("ResourceResolver"))
        .property(
            h("resourceMap"),
            values::Map::new(Kind::Hash, Kind::ObjectLink, entries).unwrap(),
        )
        .build();
    let mut bytes = std::io::Cursor::new(Vec::new());
    Bin::builder()
        .object(object)
        .build()
        .to_writer(&mut bytes)
        .unwrap();
    bytes.into_inner()
}

/// The resources of Teemo as a declared document, over a game that also declares Jade Teemo.
fn teemo(dir: &std::path::Path) -> BinDocument {
    let jade = resources(JADE, &[("Teemo_R", "Particles/Jade_R")]);
    let context = DeclareContext {
        project: project(dir),
        schema: PatchSchema::new(meta_schema::shared(None), None),
        game: Game::declaring(&NAMES, HashMap::from([(h(JADE), jade)])),
    };
    let game = resources(
        RESOURCES,
        &[("Teemo_Q", "Particles/Q"), ("Teemo_R", "Particles/R")],
    );
    BinDocument::declare(game, ltk_game_data::path_hash(CHUNK), context).unwrap()
}

#[test]
fn a_leaf_copies_as_a_module_that_loads_to_one_set() {
    let dir = tempfile::tempdir().unwrap();
    let document = declared(project(dir.path()));
    let path = format!(
        "{}.{}",
        field("skinMeshProperties"),
        field("selfIllumination")
    );
    let names = Game::naming(&[SKIN, "skinMeshProperties", "selfIllumination"]);

    let copied = document.row_declaration(h(SKIN), &path, &*names).unwrap();

    assert_eq!(
        copied.reference.as_deref(),
        Some("Characters/Teemo/Skins/Skin0:skinMeshProperties.selfIllumination")
    );
    let module = copied.declaration.expect("a leaf copies as a declaration");
    let indented: String = module.lines().map(|line| format!("  {line}\n")).collect();
    let loaded = load_declarations(
        "game_data.yaml",
        &format!("version: 1\nmodules:\n{indented}"),
        |_| unreachable!(),
    )
    .unwrap();
    let Selector::Entries(entries) = &loaded.modules[0].selector else {
        panic!("the module is an entries module");
    };
    assert_eq!(loaded.modules.len(), 1);
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].properties.len(), 1);
    assert_eq!(
        entries[0].properties[0].value,
        Value::Mapping([("selfIllumination".to_owned(), Value::Float(0.0))].into())
    );
}

#[test]
fn a_struct_copies_as_a_block_of_its_named_fields() {
    let dir = tempfile::tempdir().unwrap();
    let document = declared(project(dir.path()));
    /* `texture` is left out of the names, so the embed holds a field nothing spells. */
    let names = Game::naming(&[SKIN, "skinMeshProperties", "selfIllumination"]);

    let copied = document
        .row_declaration(h(SKIN), &field("skinMeshProperties"), &*names)
        .unwrap();

    assert_eq!(
        copied.declaration.as_deref(),
        Some(
            "- entries:\n    Characters/Teemo/Skins/Skin0:\n      skinMeshProperties:\n        \
             selfIllumination: 0.0"
        )
    );
    assert_eq!(copied.skipped, 1);
    assert_eq!(
        copied.reference.as_deref(),
        Some("Characters/Teemo/Skins/Skin0:skinMeshProperties")
    );
    assert_eq!(
        document
            .row_declaration(h(SKIN), "12345678", &*names)
            .unwrap(),
        RowDeclaration::default()
    );
}

#[test]
fn an_object_copies_as_its_entry_with_every_named_field() {
    let dir = tempfile::tempdir().unwrap();
    let document = declared(project(dir.path()));
    let names = Game::naming(&[
        SKIN,
        "skinMeshProperties",
        "selfIllumination",
        "texture",
        "championSkinName",
        "tags",
        "a",
    ]);

    let copied = document.row_declaration(h(SKIN), "", &*names).unwrap();

    let module = copied
        .declaration
        .expect("an object copies as a declaration");
    assert_eq!(
        module,
        "- entries:\n    Characters/Teemo/Skins/Skin0:\n      skinMeshProperties:\n        \
         selfIllumination: 0.0\n        texture: assets/teemo.tex\n      championSkinName: \
         Teemo\n      tags: [a]"
    );
    assert_eq!(copied.reference, None);
    assert_eq!(copied.skipped, 1, "the unnamed field is left out");

    /* The copy applied over the game's own copy changes nothing, the unnamed field included. */
    let indented: String = module.lines().map(|line| format!("  {line}\n")).collect();
    fs_err::write(
        dir.path().join("content/base/game_data.yaml"),
        format!("version: 1\nmodules:\n{indented}"),
    )
    .unwrap();
    let applied = declared(project(dir.path()));
    let game = BinDocument::parse(super::super::tests::game_bin()).unwrap();
    assert_eq!(applied.object_at(h(SKIN)), game.object_at(h(SKIN)));
    assert_eq!(applied.declared_state().unwrap().marks.len(), 4);
}

#[test]
fn a_list_whose_items_hold_a_nameless_field_copies_whole_in_hash_form() {
    let emitter = |name: &str, unnamed: bool| -> PropertyValueEnum {
        let mut properties: IndexMap<BinHash, PropertyValueEnum> = [(
            h("emitterName"),
            values::String::new(name.to_owned()).into(),
        )]
        .into();
        if unnamed {
            properties.insert(BinHash(0x0bad_f00d), values::U8::new(1).into());
        }
        values::Embedded(values::Struct {
            class_hash: h("VfxEmitterDefinitionData"),
            properties,
        })
        .into()
    };
    let object = BinObject::builder(h(SKIN), h("VfxSystemDefinitionData"))
        .property(
            h("emitters"),
            values::Container::new(
                Kind::Embedded,
                vec![emitter("one", false), emitter("two", true)],
            )
            .unwrap(),
        )
        .build();
    let mut bytes = std::io::Cursor::new(Vec::new());
    Bin::builder()
        .object(object)
        .build()
        .to_writer(&mut bytes)
        .unwrap();
    let document = BinDocument::parse(bytes.into_inner()).unwrap();
    let names = Game::naming(&[SKIN, "emitters", "emitterName"]);

    let copied = document.row_declaration(h(SKIN), "", &*names).unwrap();

    assert_eq!(
        copied.declaration.as_deref(),
        Some(
            "- entries:\n    Characters/Teemo/Skins/Skin0:\n      emitters:\n        \
             - !embed(0x09cde442)\n          emitterName: one\n        \
             - !embed(0x09cde442)\n          emitterName: two\n          \"0x0badf00d\": 1"
        )
    );
    assert_eq!(copied.skipped, 0);
}

#[test]
fn a_merged_reference_adds_the_games_copy_of_another_entry() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = teemo(dir.path());
    let reference = format!("{JADE}:resourceMap");

    document
        .declare_reference(h(RESOURCES), &field("resourceMap"), &reference, true)
        .unwrap();

    assert!(
        manifest(dir.path(), "base").contains(&format!("+resourceMap: !ref \"{reference}\"")),
        "{}",
        manifest(dir.path(), "base")
    );
    let object = document.object_at(h(RESOURCES)).unwrap();
    let Some(PropertyValueEnum::Map(map)) = object.properties.get(&h("resourceMap")) else {
        panic!("the map is a map");
    };
    assert_eq!(map.entries().len(), 2);
    assert!(map.entries().contains(&link("Teemo_Q", "Particles/Q")));
    assert!(map.entries().contains(&link("Teemo_R", "Particles/Jade_R")));
    let state = document.declared_state().unwrap();
    assert_eq!(
        state.marks[0].reference.as_deref(),
        Some(reference.as_str())
    );

    assert!(document.undo().unwrap());
    assert!(!dir.path().join("content/base/game_data.yaml").exists());
}

#[test]
fn a_pasted_reference_the_game_lacks_draws_its_reason_on_the_row() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = teemo(dir.path());

    document
        .declare_reference(
            h(RESOURCES),
            &field("resourceMap"),
            "Characters/Nobody/Resources:resourceMap",
            false,
        )
        .unwrap();

    let state = document.declared_state().unwrap();
    let skipped = state
        .diagnostics
        .iter()
        .find(|diagnostic| diagnostic.kind == DeclaredDiagnosticKind::PropertyEditSkipped)
        .expect("the reference is skipped");
    assert_eq!(skipped.reason, Some(SkipReason::ReferenceMissingEntry));
    assert_eq!(skipped.path, field("resourceMap"));
}

#[test]
fn text_that_is_no_reference_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = teemo(dir.path());

    assert!(matches!(
        document.declare_reference(h(RESOURCES), &field("resourceMap"), "nocolon", false),
        Err(BinDocumentError::Declaring(_))
    ));
    assert!(!dir.path().join("content/base/game_data.yaml").exists());
}
