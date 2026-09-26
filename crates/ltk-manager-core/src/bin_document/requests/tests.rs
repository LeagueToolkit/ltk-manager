//! Unit tests for the wire edits: the JSON a frontend sends, the store method each group
//! reaches, and the one gate every variant passes.

use std::io::Cursor;

use assert_matches::assert_matches;
use ltk_hash::Hash as _;
use ltk_meta::property::{Kind, values};
use ltk_meta::{Bin, BinObject};

use super::*;
use crate::bin_document::{BinDocumentError, ReadOnly};
use crate::meta_schema::MetaSchema;
use crate::preview::AssetRef;

const OBJECT: &str = "Characters/Teemo/Record";
const COMMON: &str = "DATA/Characters/Teemo/Teemo.bin";

fn h(text: &str) -> BinHash {
    BinHash::hash_str(text)
}

fn wire(hash: BinHash) -> String {
    format!("{:08x}", hash.0)
}

/// One object with a two-item `I32` list and a scale, over one dependency.
fn bytes() -> Vec<u8> {
    let list = values::Container::new(
        Kind::I32,
        vec![values::I32::new(1).into(), values::I32::new(2).into()],
    )
    .unwrap();
    let object = BinObject::builder(h(OBJECT), h("Record"))
        .property(h("list"), list)
        .property(h("scale"), values::F32::new(1.0))
        .build();
    let mut out = Cursor::new(Vec::new());
    Bin::new([object], [COMMON]).to_writer(&mut out).unwrap();
    out.into_inner()
}

fn schema() -> MetaSchema {
    let json = r#"{
      "formatVersion": 1,
      "hashSource": { "fetchedAt": "2026-09-24T00:00:00Z" },
      "latest": 9000000,
      "classes": {}
    }"#;
    MetaSchema::parse(json.as_bytes()).expect("the fixture is the published shape")
}

/// A store holding the fixture over `asset`, and the id it answered.
fn open(asset: AssetRef) -> (BinDocuments, BinDocumentId) {
    let store = BinDocuments::default();
    let id = store.open(asset, || Ok(bytes())).unwrap();
    (store, id)
}

fn layer() -> AssetRef {
    AssetRef::Layer {
        project: "p".to_owned(),
        layer: "base".to_owned(),
        path: "a.bin".to_owned(),
    }
}

fn entry() -> String {
    hex(h(OBJECT))
}

fn dependencies(store: &BinDocuments, id: BinDocumentId) -> Vec<String> {
    store
        .read(id, |open| Ok(open.dependencies().to_vec()))
        .unwrap()
}

#[test]
fn an_edit_reads_the_json_the_frontend_sends() {
    let edit: BinEdit = serde_json::from_str(
        r#"{ "kind": "setPointer", "entry": "0x00000001", "path": "a", "className": null }"#,
    )
    .unwrap();
    assert_eq!(
        edit,
        BinEdit::SetPointer {
            entry: "0x00000001".to_owned(),
            path: "a".to_owned(),
            class_name: None,
        }
    );

    let edit: BinEdit = serde_json::from_str(
        r#"{ "kind": "dependency", "edit": { "kind": "insert", "index": null, "text": "a.bin" } }"#,
    )
    .unwrap();
    assert_eq!(
        edit,
        BinEdit::Dependency {
            edit: DependencyEdit::Insert {
                index: None,
                text: "a.bin".to_owned(),
            },
        }
    );

    let query: ChoiceQuery = serde_json::from_str(r#"{ "kind": "objectClasses" }"#).unwrap();
    assert_eq!(query, ChoiceQuery::ObjectClasses);
}

#[test]
fn an_outcome_writes_its_kind_beside_its_value() {
    let written = serde_json::to_value(EditOutcome::Path {
        path: "a[0]".to_owned(),
    })
    .unwrap();
    assert_eq!(
        written,
        serde_json::json!({ "kind": "path", "path": "a[0]" })
    );
    assert_eq!(
        serde_json::to_value(EditOutcome::Done).unwrap(),
        serde_json::json!({ "kind": "done" })
    );
}

#[test]
fn a_patch_answers_the_value_the_leaf_held() {
    let schema = schema();
    let (store, id) = open(layer());

    let outcome = store
        .apply(
            id,
            BinEdit::Patch {
                entry: entry(),
                path: wire(h("scale")),
                value: LeafValue::Float { value: 4.0 },
            },
            schema.at(None),
        )
        .unwrap();

    assert_eq!(
        outcome,
        EditOutcome::Previous {
            value: LeafValue::Float { value: 1.0 },
        }
    );
}

#[test]
fn an_item_edit_answers_the_path_its_store_method_answers() {
    let schema = schema();
    let (store, id) = open(layer());
    let list = wire(h("list"));

    let inserted = store
        .apply(
            id,
            BinEdit::InsertItem {
                entry: entry(),
                path: list.clone(),
                item: NewItem {
                    index: Some(0),
                    ..NewItem::default()
                },
            },
            schema.at(None),
        )
        .unwrap();
    assert_eq!(
        inserted,
        EditOutcome::Path {
            path: format!("{list}[0]"),
        }
    );

    let moved = store
        .apply(
            id,
            BinEdit::MoveItem {
                entry: entry(),
                path: format!("{list}[0]"),
                to: 2,
            },
            schema.at(None),
        )
        .unwrap();
    assert_eq!(
        moved,
        EditOutcome::Path {
            path: format!("{list}[2]"),
        }
    );
}

#[test]
fn a_dependency_edit_reaches_the_list() {
    let schema = schema();
    let (store, id) = open(layer());
    let dependency = |edit| BinEdit::Dependency { edit };

    let inserted = store
        .apply(
            id,
            dependency(DependencyEdit::Insert {
                index: None,
                text: "a.bin".to_owned(),
            }),
            schema.at(None),
        )
        .unwrap();
    assert_eq!(inserted, EditOutcome::Index { index: 1 });

    let moved = store
        .apply(
            id,
            dependency(DependencyEdit::Move { from: 1, to: 0 }),
            schema.at(None),
        )
        .unwrap();
    assert_eq!(moved, EditOutcome::Done);
    assert_eq!(dependencies(&store, id), ["a.bin", COMMON]);
}

#[test]
fn an_object_edit_and_a_module_action_refuse_as_their_store_methods_do() {
    let schema = schema();
    let (store, id) = open(layer());

    let routed = store
        .apply(
            id,
            BinEdit::Object {
                edit: ObjectEdit::Remove { entry: entry() },
            },
            schema.at(None),
        )
        .unwrap_err();
    let direct = store.remove_object(id, h(OBJECT)).unwrap_err();
    assert_eq!(routed.to_string(), direct.to_string());

    let action = ModuleAction::Remove { module: 0 };
    let routed = store
        .apply(
            id,
            BinEdit::ModuleAction {
                layer: "base".to_owned(),
                action: action.clone(),
            },
            schema.at(None),
        )
        .unwrap_err();
    let direct = store
        .declared_module_action(id, "base", &action)
        .unwrap_err();
    assert_eq!(routed.to_string(), direct.to_string());
}

#[test]
fn every_edit_passes_the_gate() {
    let schema = schema();
    let (store, id) = open(AssetRef::File {
        path: "a.bin".to_owned(),
    });
    let path = || wire(h("scale"));
    let edits = [
        BinEdit::Patch {
            entry: entry(),
            path: path(),
            value: LeafValue::Float { value: 4.0 },
        },
        BinEdit::EditProperty {
            entry: entry(),
            holder: String::new(),
            field: hex(h("scale")),
            edits: Vec::new(),
        },
        BinEdit::AddProperty {
            entry: entry(),
            path: String::new(),
            property: NewProperty::Declared {
                field: hex(h("other")),
            },
        },
        BinEdit::RemoveProperty {
            entry: entry(),
            path: path(),
        },
        BinEdit::InsertItem {
            entry: entry(),
            path: wire(h("list")),
            item: NewItem::default(),
        },
        BinEdit::RemoveItem {
            entry: entry(),
            path: format!("{}[0]", wire(h("list"))),
        },
        BinEdit::MoveItem {
            entry: entry(),
            path: format!("{}[0]", wire(h("list"))),
            to: 1,
        },
        BinEdit::SetKey {
            entry: entry(),
            path: path(),
            key: "a".to_owned(),
        },
        BinEdit::SetPointer {
            entry: entry(),
            path: path(),
            class_name: None,
        },
        BinEdit::DeclareReference {
            entry: entry(),
            path: path(),
            reference: "0x1:a".to_owned(),
            merge: false,
        },
        BinEdit::Object {
            edit: ObjectEdit::Create {
                name: "Mods/a/b".to_owned(),
                origin: NewObject::Clone { source: entry() },
            },
        },
        BinEdit::Object {
            edit: ObjectEdit::Remove { entry: entry() },
        },
        BinEdit::Object {
            edit: ObjectEdit::Restore { entry: entry() },
        },
        BinEdit::Dependency {
            edit: DependencyEdit::Insert {
                index: None,
                text: "a.bin".to_owned(),
            },
        },
        BinEdit::Dependency {
            edit: DependencyEdit::Remove { index: 0 },
        },
        BinEdit::Dependency {
            edit: DependencyEdit::Move { from: 0, to: 0 },
        },
        BinEdit::Dependency {
            edit: DependencyEdit::Set {
                index: 0,
                text: "a.bin".to_owned(),
            },
        },
        BinEdit::Dependency {
            edit: DependencyEdit::Restore {
                path: COMMON.to_owned(),
            },
        },
        BinEdit::ModuleAction {
            layer: "base".to_owned(),
            action: ModuleAction::Remove { module: 0 },
        },
    ];

    for edit in edits {
        let shown = format!("{edit:?}");
        assert_matches!(
            store.apply(id, edit, schema.at(None)),
            Err(AppError::BinDocument(BinDocumentError::ReadOnly(
                ReadOnly::Loose
            ))),
            "{shown}"
        );
    }
}

#[test]
fn an_entry_that_is_no_hash_fails_validation_before_the_gate() {
    let schema = schema();
    let (store, id) = open(AssetRef::File {
        path: "a.bin".to_owned(),
    });

    assert_matches!(
        store.apply(
            id,
            BinEdit::RemoveProperty {
                entry: "Record".to_owned(),
                path: String::new(),
            },
            schema.at(None),
        ),
        Err(AppError::ValidationFailed(_))
    );
    assert_matches!(
        store.choices(
            id,
            ChoiceQuery::ItemClasses {
                entry: "Record".to_owned(),
                path: String::new(),
            },
            schema.at(None),
        ),
        Err(AppError::ValidationFailed(_))
    );
}

#[test]
fn a_choice_query_reads_a_document_that_takes_no_edit() {
    let schema = schema();
    let (store, id) = open(AssetRef::File {
        path: "a.bin".to_owned(),
    });

    let fields = store
        .choices(
            id,
            ChoiceQuery::AddableFields {
                entry: entry(),
                path: String::new(),
            },
            schema.at(None),
        )
        .unwrap();
    assert_matches!(fields, Choices::Fields { fields } if fields.class_hash == hex(h("Record")));

    let classes = store
        .choices(id, ChoiceQuery::ObjectClasses, schema.at(None))
        .unwrap();
    assert_matches!(classes, Choices::Classes { classes } if classes[0].hash == hex(h("Record")));

    let items = store
        .choices(
            id,
            ChoiceQuery::ItemClasses {
                entry: entry(),
                path: wire(h("list")),
            },
            schema.at(None),
        )
        .unwrap();
    assert_matches!(items, Choices::Classes { .. });
}

#[test]
fn a_name_typed_into_an_edit_draws_where_no_table_names_it() {
    let schema = schema();
    let (store, id) = open(layer());

    store
        .apply(
            id,
            BinEdit::AddProperty {
                entry: entry(),
                path: String::new(),
                property: NewProperty::Custom {
                    field: "myTag".to_owned(),
                    shape: crate::meta_schema::KindShape::bare(
                        crate::bin_document::PropertyKind::Hash,
                    ),
                    class: None,
                },
            },
            schema.at(None),
        )
        .unwrap();
    store
        .apply(
            id,
            BinEdit::Patch {
                entry: entry(),
                path: wire(h("myTag")),
                value: LeafValue::Hash {
                    text: "Mods/MyTag".to_owned(),
                },
            },
            schema.at(None),
        )
        .unwrap();

    let rows = store
        .read(id, |open| {
            Ok(open.children(h(OBJECT), "", 0, usize::MAX, &(), None)?.rows)
        })
        .unwrap();
    let tag = rows
        .iter()
        .find(|row| row.path == wire(h("myTag")))
        .expect("the added property is a row");

    assert_eq!(tag.name, "myTag");
    assert_matches!(
        &tag.value,
        crate::bin_document::BinValue::Hash { name: Some(name), .. } if name == "Mods/MyTag"
    );
}
