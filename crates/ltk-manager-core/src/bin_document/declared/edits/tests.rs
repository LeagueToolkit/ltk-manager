use assert_matches::assert_matches;
use fs_err as fs;
use ltk_meta::{Bin, BinObject};

use super::super::tests::{Game, SKIN, h, manifest, project};
use super::super::{DeclareContext, DeclaredSign};
use super::*;
use crate::bin_document::{LeafValue, NewItem, ValueEdit};
use crate::meta_schema::{self, PatchSchema};
use crate::problems::GameBuild;

const RESOURCES: &str = "Characters/Teemo/Skins/Skin0/Resources";
const CHUNK: &str = "data/characters/teemo/skins/skin0.bin";

/// A build the embedded schema describes, which types a property the game's copy omits.
const BUILD: GameBuild = GameBuild::new(16, 17, 8_104_348);

fn emitter(name: &str) -> PropertyValueEnum {
    values::Embedded(values::Struct {
        class_hash: h("VfxEmitterDefinitionData"),
        properties: [(
            h("emitterName"),
            values::String::new(name.to_owned()).into(),
        )]
        .into(),
    })
    .into()
}

/// A resource map, a list of hashes, a list of embeds, an option and a pointer.
fn game_bin() -> Vec<u8> {
    let link = |key: &str, target: &str| -> (PropertyValueEnum, PropertyValueEnum) {
        (
            values::Hash::new(h(key)).into(),
            values::ObjectLink::new(h(target)).into(),
        )
    };
    let resources = BinObject::builder(h(RESOURCES), h("ResourceResolver"))
        .property(
            h("resourceMap"),
            values::Map::new(
                Kind::Hash,
                Kind::ObjectLink,
                vec![
                    link("Teemo_Q", "Particles/Q"),
                    link("Teemo_R", "Particles/R"),
                ],
            )
            .unwrap(),
        )
        .build();
    let skin = BinObject::builder(h(SKIN), h("SkinCharacterDataProperties"))
        .property(
            h("tags"),
            values::Container::new(
                Kind::Hash,
                vec![
                    values::Hash::new(h("a")).into(),
                    values::Hash::new(h("b")).into(),
                ],
            )
            .unwrap(),
        )
        .property(
            h("complexEmitterDefinitionData"),
            values::Container::new(
                Kind::Embedded,
                vec![emitter("one"), emitter("two"), emitter("three")],
            )
            .unwrap(),
        )
        .property(
            h("twice"),
            values::Container::new(
                Kind::Hash,
                vec![
                    values::Hash::new(h("a")).into(),
                    values::Hash::new(h("a")).into(),
                ],
            )
            .unwrap(),
        )
        .property(h("maybe"), values::Optional::empty(Kind::F32).unwrap())
        .property(h("pointer"), values::Struct::default())
        .property(
            h("heldPointer"),
            values::Struct {
                class_hash: h("VfxEmitterDefinitionData"),
                properties: Default::default(),
            },
        )
        .build();
    let mut bytes = std::io::Cursor::new(Vec::new());
    Bin::builder()
        .object(resources)
        .object(skin)
        .build()
        .to_writer(&mut bytes)
        .unwrap();
    bytes.into_inner()
}

fn declared(dir: &std::path::Path) -> BinDocument {
    declared_naming(dir, &[])
}

/// The document, with `more` named beside the fixture's own names.
fn declared_naming(dir: &std::path::Path, more: &[&'static str]) -> BinDocument {
    let mut names = vec![
        SKIN,
        RESOURCES,
        "resourceMap",
        "tags",
        "twice",
        "complexEmitterDefinitionData",
        "emitterName",
        "VfxEmitterDefinitionData",
        "maybe",
        "pointer",
        "heldPointer",
        "Teemo_Q",
        "Teemo_R",
        "Teemo_E",
        "Particles/Q",
        "a",
        "b",
        "c",
    ];
    names.extend_from_slice(more);
    let context = DeclareContext {
        project: project(dir),
        schema: PatchSchema::new(meta_schema::shared(Some(BUILD)), Some(BUILD)),
        game: Game::naming(&names),
    };
    BinDocument::declare(game_bin(), ltk_game_data::path_hash(CHUNK), context).unwrap()
}

fn field(name: &str) -> String {
    format!("{:08x}", *h(name))
}

fn schema() -> std::sync::Arc<crate::meta_schema::MetaSchema> {
    meta_schema::shared(Some(BUILD))
}

fn force_edits() -> Vec<ValueEdit> {
    vec![
        ValueEdit::EnsurePointer {
            path: String::new(),
            class: "VfxFieldCollectionDefinitionData".to_owned(),
        },
        ValueEdit::EnsureProperty {
            path: String::new(),
            field: field("fieldAccelerationDefinitions"),
        },
        ValueEdit::InsertItem {
            path: field("fieldAccelerationDefinitions"),
            item: NewItem {
                index: None,
                key: None,
                class: Some("VfxFieldAccelerationDefinitionData".to_owned()),
            },
        },
    ]
}

const FORCE_NAMES: &[&str] = &[
    "fieldCollectionDefinition",
    "VfxFieldCollectionDefinitionData",
    "fieldAccelerationDefinitions",
    "VfxFieldAccelerationDefinitionData",
    "acceleration",
    "ValueVector3",
    "constantValue",
];

#[test]
fn a_nested_property_batch_is_one_undoable_declaration() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared_naming(dir.path(), FORCE_NAMES);
    let holder = format!("{}[0]", field("complexEmitterDefinitionData"));

    document
        .edit_property(
            h(SKIN),
            &holder,
            &field("fieldCollectionDefinition"),
            force_edits(),
            schema().at(Some(BUILD)),
        )
        .unwrap();
    let first = manifest(dir.path(), "base");
    assert!(first.contains("fieldCollectionDefinition"), "{first}");
    assert!(
        first.contains("VfxFieldAccelerationDefinitionData"),
        "{first}"
    );

    assert!(document.undo().unwrap());
    assert!(!dir.path().join("content/base/game_data.yaml").exists());
    assert!(!document.undo().unwrap());
    assert!(document.redo().unwrap());
    assert_eq!(manifest(dir.path(), "base"), first);

    document
        .edit_property(
            h(SKIN),
            &holder,
            &field("fieldCollectionDefinition"),
            force_edits(),
            schema().at(Some(BUILD)),
        )
        .unwrap();
    let second = manifest(dir.path(), "base");
    assert_eq!(
        second.matches("VfxFieldAccelerationDefinitionData").count(),
        2
    );
    assert!(document.undo().unwrap());
    assert_eq!(manifest(dir.path(), "base"), first);
}

#[test]
fn an_invalid_nested_batch_leaves_no_property_or_declaration() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared_naming(dir.path(), FORCE_NAMES);
    let holder = format!("{}[0]", field("complexEmitterDefinitionData"));
    let mut edits = force_edits();
    edits.push(ValueEdit::SetLeaf {
        path: String::new(),
        value: LeafValue::Bool { value: true },
    });

    assert!(
        document
            .edit_property(
                h(SKIN),
                &holder,
                &field("fieldCollectionDefinition"),
                edits,
                schema().at(Some(BUILD))
            )
            .is_err()
    );
    assert!(!dir.path().join("content/base/game_data.yaml").exists());
    assert!(!document.undo().unwrap());
    assert!(
        document
            .value_at(
                h(SKIN),
                &format!("{holder}.{}", field("fieldCollectionDefinition"))
            )
            .is_none()
    );
}

#[test]
fn a_missing_nested_constant_is_created_without_replacing_its_force() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared_naming(dir.path(), FORCE_NAMES);
    let holder = format!("{}[0]", field("complexEmitterDefinitionData"));
    document
        .edit_property(
            h(SKIN),
            &holder,
            &field("fieldCollectionDefinition"),
            force_edits(),
            schema().at(Some(BUILD)),
        )
        .unwrap();
    let first = manifest(dir.path(), "base");
    let force = format!(
        "{holder}.{}.{}[0]",
        field("fieldCollectionDefinition"),
        field("fieldAccelerationDefinitions")
    );

    document
        .edit_property(
            h(SKIN),
            &force,
            &field("acceleration"),
            vec![
                ValueEdit::EnsureProperty {
                    path: String::new(),
                    field: field("constantValue"),
                },
                ValueEdit::SetLeaf {
                    path: field("constantValue"),
                    value: LeafValue::Vector {
                        values: vec![1.0, 2.0, 3.0],
                    },
                },
            ],
            schema().at(Some(BUILD)),
        )
        .unwrap();

    let saved = manifest(dir.path(), "base");
    assert!(saved.contains("constantValue: [1.0, 2.0, 3.0]"), "{saved}");
    document
        .set_leaf(
            h(SKIN),
            &format!(
                "{force}.{}.{}",
                field("acceleration"),
                field("constantValue")
            ),
            LeafValue::Vector {
                values: vec![4.0, 5.0, 6.0],
            },
        )
        .unwrap();
    assert!(manifest(dir.path(), "base").contains("constantValue: [4.0, 5.0, 6.0]"));
    assert!(document.undo().unwrap());
    assert_eq!(manifest(dir.path(), "base"), saved);

    document.remove_item(h(SKIN), &force).unwrap();
    assert!(!manifest(dir.path(), "base").contains("VfxFieldAccelerationDefinitionData"));
    assert!(document.undo().unwrap());
    assert_eq!(manifest(dir.path(), "base"), saved);

    assert!(document.undo().unwrap());
    assert_eq!(manifest(dir.path(), "base"), first);
}

#[test]
fn a_raw_property_batch_retains_atomic_undo_and_redo() {
    let mut document = BinDocument::parse(game_bin()).unwrap();
    let holder = format!("{}[0]", field("complexEmitterDefinitionData"));
    let scope = format!("{holder}.{}", field("fieldCollectionDefinition"));
    document
        .edit_property(
            h(SKIN),
            &holder,
            &field("fieldCollectionDefinition"),
            force_edits(),
            schema().at(Some(BUILD)),
        )
        .unwrap();
    let first = document.value_at(h(SKIN), &scope).cloned().unwrap();

    assert!(document.undo().unwrap());
    assert!(document.value_at(h(SKIN), &scope).is_none());
    assert!(!document.undo().unwrap());
    assert!(document.redo().unwrap());
    assert_eq!(document.value_at(h(SKIN), &scope), Some(&first));

    let mut edits = force_edits();
    edits.push(ValueEdit::SetLeaf {
        path: String::new(),
        value: LeafValue::Bool { value: true },
    });
    assert!(
        document
            .edit_property(
                h(SKIN),
                &holder,
                &field("fieldCollectionDefinition"),
                edits,
                schema().at(Some(BUILD))
            )
            .is_err()
    );
    assert_eq!(document.value_at(h(SKIN), &scope), Some(&first));
}

#[test]
fn a_nested_property_batch_removes_an_item_atomically() {
    let mut document = BinDocument::parse(game_bin()).unwrap();
    let holder = format!("{}[0]", field("complexEmitterDefinitionData"));
    let list = field("fieldAccelerationDefinitions");
    let mut edits = force_edits();
    edits.extend(force_edits());
    edits.push(ValueEdit::RemoveItem {
        path: format!("{list}[0]"),
    });

    document
        .edit_property(
            h(SKIN),
            &holder,
            &field("fieldCollectionDefinition"),
            edits,
            schema().at(Some(BUILD)),
        )
        .unwrap();

    let scope = format!("{holder}.{}.{}", field("fieldCollectionDefinition"), list);
    let Some(PropertyValueEnum::Container(forces)) = document.value_at(h(SKIN), &scope) else {
        panic!("the force list is a container");
    };
    assert_eq!(forces.len(), 1);

    assert!(document.undo().unwrap());
    assert!(document.value_at(h(SKIN), &scope).is_none());
}

/// The body the manifest holds under `entry`, one line per key.
fn body(dir: &std::path::Path, entry: &str) -> Vec<String> {
    let text = manifest(dir, "base");
    let start = text
        .find(&format!("{entry}:"))
        .expect("the entry is declared");
    text[start..]
        .lines()
        .skip(1)
        .take_while(|line| line.starts_with("        "))
        .map(|line| line.trim().to_owned())
        .collect()
}

#[test]
fn a_map_entry_added_is_an_addition_that_keeps_the_games_keys() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(dir.path());
    let new = NewItem {
        index: None,
        key: Some("Teemo_E".to_owned()),
        class: None,
    };

    let path = document
        .insert_item(
            h(RESOURCES),
            &field("resourceMap"),
            new,
            schema().at(Some(BUILD)),
        )
        .unwrap();

    assert_eq!(
        body(dir.path(), RESOURCES),
        ["+resourceMap:", "Teemo_E: \"0x00000000\""]
    );
    let Some(PropertyValueEnum::Map(map)) = document.value_at(h(RESOURCES), &field("resourceMap"))
    else {
        panic!("the map is a map");
    };
    assert_eq!(map.entries().len(), 3);
    assert!(document.value_at(h(RESOURCES), &path).is_some());
    let marks = document.declared_state().unwrap().marks;
    assert_eq!(marks.len(), 1);
    assert_eq!(marks[0].sign, DeclaredSign::Add);
    assert_eq!(marks[0].path, field("resourceMap"));
}

#[test]
fn a_map_entry_removed_is_a_removal_by_key() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(dir.path());

    document
        .remove_item(
            h(RESOURCES),
            &format!("{}{{{:08x}}}", field("resourceMap"), *h("Teemo_Q")),
        )
        .unwrap();

    assert_eq!(body(dir.path(), RESOURCES), ["-resourceMap: [Teemo_Q]"]);
}

#[test]
fn a_map_key_set_is_a_removal_and_an_addition() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(dir.path());

    document
        .set_key(
            h(RESOURCES),
            &format!("{}{{{:08x}}}", field("resourceMap"), *h("Teemo_Q")),
            "Teemo_E",
        )
        .unwrap();

    assert_eq!(
        body(dir.path(), RESOURCES),
        [
            "-resourceMap: [Teemo_Q]",
            "+resourceMap:",
            "Teemo_E: Particles/Q"
        ]
    );
    assert!(document.undo().unwrap());
    assert!(!dir.path().join("content/base/game_data.yaml").exists());
}

#[test]
fn a_list_item_added_at_the_end_is_an_addition() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(dir.path());
    let end = NewItem {
        index: None,
        key: None,
        class: None,
    };

    document
        .insert_item(h(SKIN), &field("tags"), end, schema().at(Some(BUILD)))
        .unwrap();

    assert_eq!(body(dir.path(), SKIN), ["+tags: [\"0x00000000\"]"]);
}

#[test]
fn a_scalar_list_item_removed_is_a_removal_by_value() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(dir.path());

    document
        .remove_item(h(SKIN), &format!("{}[0]", field("tags")))
        .unwrap();

    assert_eq!(body(dir.path(), SKIN), ["-tags: [a]"]);
}

#[test]
fn a_struct_list_item_removed_is_a_removal_by_index() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(dir.path());

    document
        .remove_item(
            h(SKIN),
            &format!("{}[1]", field("complexEmitterDefinitionData")),
        )
        .unwrap();

    assert_eq!(
        body(dir.path(), SKIN),
        ["-complexEmitterDefinitionData: [1]"]
    );
}

#[test]
fn a_moved_item_writes_the_whole_list_and_marks_it_replaced() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(dir.path());

    document
        .move_item(h(SKIN), &format!("{}[0]", field("tags")), 1)
        .unwrap();

    assert_eq!(body(dir.path(), SKIN), ["tags: [b, a]"]);
    let marks = document.declared_state().unwrap().marks;
    assert_eq!(marks.len(), 1);
    assert!(marks[0].whole);
    assert_eq!(marks[0].sign, DeclaredSign::Set);
}

#[test]
fn an_item_inserted_mid_list_writes_the_whole_list() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(dir.path());
    let first = NewItem {
        index: Some(0),
        key: None,
        class: None,
    };

    document
        .insert_item(h(SKIN), &field("tags"), first, schema().at(Some(BUILD)))
        .unwrap();

    assert_eq!(body(dir.path(), SKIN), ["tags: [\"0x00000000\", a, b]"]);
}

#[test]
fn an_addition_after_a_whole_list_set_joins_the_set() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(dir.path());
    document
        .move_item(h(SKIN), &format!("{}[0]", field("tags")), 1)
        .unwrap();
    let end = NewItem {
        index: None,
        key: None,
        class: None,
    };

    document
        .insert_item(h(SKIN), &field("tags"), end, schema().at(Some(BUILD)))
        .unwrap();

    assert_eq!(body(dir.path(), SKIN), ["tags: [b, a, \"0x00000000\"]"]);
}

#[test]
fn a_field_of_a_list_element_is_a_set_under_its_index() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(dir.path());

    document
        .set_leaf(
            h(SKIN),
            &format!(
                "{}[2].{}",
                field("complexEmitterDefinitionData"),
                field("emitterName")
            ),
            LeafValue::String {
                value: "last".to_owned(),
            },
        )
        .unwrap();

    assert_eq!(
        body(dir.path(), SKIN),
        ["complexEmitterDefinitionData[2].emitterName: last"]
    );
}

#[test]
fn an_option_given_a_value_is_a_set_and_taken_away_is_null() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(dir.path());
    let value = NewItem {
        index: None,
        key: None,
        class: None,
    };

    let path = document
        .insert_item(h(SKIN), &field("maybe"), value, schema().at(Some(BUILD)))
        .unwrap();
    assert_eq!(body(dir.path(), SKIN), ["maybe: 0.0"]);

    document.remove_item(h(SKIN), &path).unwrap();
    assert_eq!(body(dir.path(), SKIN), ["maybe: null"]);
}

#[test]
fn a_pointer_given_a_class_is_a_struct_pin() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(dir.path());

    document
        .set_pointer(h(SKIN), &field("pointer"), Some("VfxEmitterDefinitionData"))
        .unwrap();

    assert_eq!(
        body(dir.path(), SKIN),
        ["pointer: !pointer(VfxEmitterDefinitionData) {}"]
    );
}

#[test]
fn a_populated_pointer_cleared_is_a_null_pin() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(dir.path());

    document
        .set_pointer(h(SKIN), &field("heldPointer"), None)
        .unwrap();

    assert_eq!(body(dir.path(), SKIN), ["heldPointer: null"]);
}

#[test]
fn a_removal_that_would_take_too_much_falls_to_the_whole_list() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(dir.path());

    /* A removal by value takes every equal element, and the list holds `a` twice. */
    document
        .remove_item(h(SKIN), &format!("{}[0]", field("twice")))
        .unwrap();

    assert_eq!(body(dir.path(), SKIN), ["twice: [a]"]);
    assert!(document.undo().unwrap());
    assert!(!dir.path().join("content/base/game_data.yaml").exists());
}

#[test]
fn an_undo_restores_a_hand_written_manifest_byte_for_byte() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(dir.path());
    fs::write(
        dir.path().join("content/base/game_data.yaml"),
        format!(
            "# mine\nversion: 1\nmodules:\n  - entries:\n      {SKIN}:\n        +tags: [c] # kept\n"
        ),
    )
    .unwrap();
    document.reapply().unwrap();
    let before = manifest(dir.path(), "base");

    document
        .remove_item(h(SKIN), &format!("{}[0]", field("tags")))
        .unwrap();
    assert_eq!(body(dir.path(), SKIN), ["+tags: [c] # kept", "-tags: [a]"]);

    assert!(document.undo().unwrap());
    assert_eq!(manifest(dir.path(), "base"), before);
}

#[test]
fn removing_a_property_has_no_declaration() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(dir.path());

    assert_matches!(
        document.remove_property(h(SKIN), &field("tags")),
        Err(BinDocumentError::EditRejected {
            rejection: EditRejection::Undeclarable,
            ..
        })
    );
    assert!(!dir.path().join("content/base/game_data.yaml").exists());
}

#[test]
fn a_property_added_is_a_set_the_schema_types() {
    let dir = tempfile::tempdir().unwrap();
    let at = schema();
    let offered = declared(dir.path())
        .addable_fields(h(SKIN), "", at.at(Some(BUILD)))
        .unwrap();
    let leaf = offered
        .fields
        .iter()
        .find(|field| {
            field.name.is_some()
                && matches!(
                    Kind::from(field.shape.kind),
                    Kind::Bool | Kind::F32 | Kind::U32 | Kind::I32 | Kind::U8 | Kind::String
                )
        })
        .expect("the class declares a leaf field");
    let name: &'static str = Box::leak(leaf.name.clone().unwrap().into_boxed_str());
    let mut document = declared_naming(dir.path(), &[name]);

    document
        .add_property(
            h(SKIN),
            "",
            crate::bin_document::NewProperty::Declared {
                field: leaf.hash.clone(),
            },
            at.at(Some(BUILD)),
        )
        .unwrap();

    let lines = body(dir.path(), SKIN);
    assert_eq!(lines.len(), 1, "{lines:?}");
    assert!(lines[0].starts_with(&format!("{name}: ")), "{lines:?}");
}

/// The document, with `more` named, on a schema read at `build`.
fn declared_at(dir: &std::path::Path, more: &[&'static str], build: GameBuild) -> BinDocument {
    let mut names = vec![SKIN];
    names.extend_from_slice(more);
    let context = DeclareContext {
        project: project(dir),
        schema: PatchSchema::new(schema(), Some(build)),
        game: Game::naming(&names),
    };
    BinDocument::declare(game_bin(), ltk_game_data::path_hash(CHUNK), context).unwrap()
}

/// Add each named field Add property offers on the skin object, on a fresh document at
/// `build`, answering the field's name beside the manifest lines it wrote. Each add is
/// undone, and a refused or undone add leaves no manifest.
fn add_each_offered(build: GameBuild) -> Vec<(String, Result<Vec<String>, BinDocumentError>)> {
    let at = schema();
    let offered = declared(tempfile::tempdir().unwrap().path())
        .addable_fields(h(SKIN), "", at.at(Some(BUILD)))
        .unwrap();

    offered
        .fields
        .iter()
        .filter_map(|offer| {
            let name: &'static str = Box::leak(offer.name.clone()?.into_boxed_str());
            let mut more = vec![name];
            more.extend(
                offer
                    .class
                    .clone()
                    .map(|class| -> &'static str { Box::leak(class.into_boxed_str()) }),
            );
            let dir = tempfile::tempdir().unwrap();
            let mut document = declared_at(dir.path(), &more, build);

            let outcome = document
                .add_property(
                    h(SKIN),
                    "",
                    crate::bin_document::NewProperty::Declared {
                        field: offer.hash.clone(),
                    },
                    at.at(Some(BUILD)),
                )
                .map(|()| body(dir.path(), SKIN));
            if outcome.is_ok() {
                assert!(document.undo().unwrap());
            }
            assert!(
                !dir.path().join("content/base/game_data.yaml").exists(),
                "{name} leaves a manifest"
            );
            Some((name.to_owned(), outcome))
        })
        .collect()
}

#[test]
fn every_offered_property_declares_as_one_set_and_undoes() {
    let outcomes = add_each_offered(BUILD);

    let kinds = [
        "idleParticlesEffects",
        "healthBarData",
        "ChromaData",
        "iconCircle",
        "uncensoredIconCircles",
        "PersistentEffectConditions",
        "iconAvatar",
        "mResourceResolver",
        "skinParent",
    ];
    for kind in kinds {
        assert!(
            outcomes.iter().any(|(name, _)| name == kind),
            "the fixture offers no {kind}"
        );
    }
    for (name, outcome) in outcomes {
        let lines = outcome.unwrap_or_else(|error| panic!("{name}: {error:?}"));
        assert_eq!(lines.len(), 1, "{name}: {lines:?}");
        assert!(
            lines[0]
                .to_lowercase()
                .starts_with(&format!("{}: ", name.to_lowercase())),
            "{name}: {lines:?}"
        );
    }
}

#[test]
fn a_property_added_past_the_databases_newest_build_declares_through_the_fallback() {
    let past = GameBuild::new(99, 1, u32::MAX);

    for (name, outcome) in add_each_offered(past) {
        let lines = outcome.unwrap_or_else(|error| panic!("{name}: {error:?}"));
        assert_eq!(lines.len(), 1, "{name}: {lines:?}");
    }
}
