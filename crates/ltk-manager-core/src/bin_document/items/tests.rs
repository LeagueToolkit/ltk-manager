//! Unit tests for the items of a list, a map and an option, and the class of a pointer: the
//! value a new item starts at, the refusals, undo, the class choices, and the save.

use std::io::Cursor;

use glam::Vec3;
use indexmap::IndexMap;
use ltk_hash::Hash as _;
use ltk_meta::Bin;

use super::*;
use crate::bin_document::{PropertyKind, ValueEdit};
use crate::meta_schema::MetaSchema;
use crate::problems::GameBuild;

fn h(text: &str) -> BinHash {
    BinHash::hash_str(text)
}

fn wire(hash: BinHash) -> String {
    format!("{:08x}", hash.0)
}

const BUILD: GameBuild = GameBuild::new(16, 17, 8_104_348);
const SKIN: &str = "Characters/Aatrox/Skins/Skin0";

/// A schema declaring a pointer list and a pointer of `InnerData`, which two classes derive
/// from, one through the other.
fn schema() -> MetaSchema {
    let class = |name: &str, bases: &[&str], properties: &str| {
        let bases: Vec<String> = bases
            .iter()
            .map(|base| format!(r#""0x{}""#, wire(h(base))))
            .collect();
        format!(
            r#""0x{hash}": {{
              "name": "{name}",
              "revisions": [{{ "from": 1, "bases": [{bases}], "interface": false, "value": false }}],
              "properties": {{ {properties} }}
            }}"#,
            hash = wire(h(name)),
            bases = bases.join(","),
        )
    };
    let field = |name: &str, kind: [&str; 4]| {
        format!(
            r#""0x{hash}": {{ "name": "{name}", "revisions": [{{ "from": 1, "type": ["{}", "{}", "{}", "{}"] }}] }}"#,
            kind[0],
            kind[1],
            kind[2],
            kind[3],
            hash = wire(h(name)),
        )
    };
    let inner = format!("0x{}", wire(h("InnerData")));
    let skin = [
        field("emitters", ["List", "0x0", "Pointer", &inner]),
        field("mesh", ["Pointer", "0x0", "0x0", &inner]),
    ]
    .join(",");
    let json = format!(
        r#"{{
          "formatVersion": 1,
          "hashSource": {{ "fetchedAt": "2026-09-14T00:00:00Z" }},
          "latest": 8104348,
          "versions": [{{ "patch": "16.17", "build": 8104348 }}],
          "classes": {{ {}, {}, {}, {}, {} }}
        }}"#,
        class("SkinData", &[], &skin),
        class(
            "InnerData",
            &[],
            &field("shared", ["F32", "0x0", "0x0", "0x0"])
        ),
        class(
            "DerivedData",
            &["InnerData"],
            &field("own", ["U32", "0x0", "0x0", "0x0"]),
        ),
        class("DeeperData", &["DerivedData"], ""),
        class(
            "UnrelatedData",
            &[],
            &field("shared", ["U32", "0x0", "0x0", "0x0"]),
        ),
    );
    MetaSchema::parse(json.as_bytes()).unwrap()
}

fn empty(class: &str) -> values::Struct {
    values::Struct {
        class_hash: h(class),
        properties: IndexMap::new(),
    }
}

fn floats(items: &[f32]) -> values::Container {
    items.iter().copied().map(values::F32::new).collect()
}

/// A bin with one object of `SkinData` holding a list, a list2, a pointer list, an embed
/// list, two maps, two options and three pointers.
fn document() -> BinDocument {
    let names = values::Map::new(
        Kind::Hash,
        Kind::String,
        vec![(
            values::Hash::new(h("Idle")).into(),
            values::String::new("idle.anm".to_owned()).into(),
        )],
    )
    .unwrap();
    let counts = values::Map::empty(Kind::U32, Kind::F32).unwrap();
    let object = BinObject::builder(h(SKIN), h("SkinData"))
        .property(h("weights"), floats(&[0.5, 1.0]))
        .property(
            h("corners"),
            values::UnorderedContainer(values::Container::empty(Kind::Vector3).unwrap()),
        )
        .property(
            h("emitters"),
            values::Container::new(Kind::Struct, vec![empty("InnerData").into()]).unwrap(),
        )
        .property(
            h("slots"),
            values::Container::empty(Kind::Embedded).unwrap(),
        )
        .property(h("names"), names)
        .property(h("counts"), counts)
        .property(h("chance"), values::Optional::empty(Kind::F32).unwrap())
        .property(
            h("held"),
            values::Optional::new(Kind::F32, Some(values::F32::new(2.0).into())).unwrap(),
        )
        .property(h("mesh"), values::Struct::default())
        .property(h("falloff"), empty("DerivedData"))
        .property(
            h("shape"),
            values::Struct {
                class_hash: h("DerivedData"),
                properties: IndexMap::from([
                    (h("shared"), values::F32::new(2.0).into()),
                    (h("own"), values::U32::new(3).into()),
                    (h("stray"), values::String::new("kept?".to_owned()).into()),
                ]),
            },
        )
        .build();
    let mut out = Cursor::new(Vec::new());
    Bin::new([object], std::iter::empty::<&str>())
        .to_writer(&mut out)
        .unwrap();
    BinDocument::parse(out.into_inner()).unwrap()
}

fn entry() -> BinHash {
    h(SKIN)
}

fn value<'a>(document: &'a BinDocument, field: &str) -> &'a PropertyValueEnum {
    &document.object_at(entry()).unwrap().properties[&h(field)]
}

fn items<'a>(document: &'a BinDocument, field: &str) -> &'a [PropertyValueEnum] {
    match value(document, field) {
        PropertyValueEnum::Container(items)
        | PropertyValueEnum::UnorderedContainer(values::UnorderedContainer(items)) => items.items(),
        other => panic!("{field} is no list: {other:?}"),
    }
}

fn map_keys(document: &BinDocument, field: &str) -> Vec<String> {
    let PropertyValueEnum::Map(map) = value(document, field) else {
        panic!("{field} is no map");
    };
    map.entries().iter().map(|(key, _)| wire_key(key)).collect()
}

fn hash_key(text: &str) -> String {
    wire_key(&values::Hash::new(h(text)).into())
}

fn item(index: Option<usize>, key: Option<&str>, class: Option<&str>) -> NewItem {
    NewItem {
        index,
        key: key.map(str::to_owned),
        class: class.map(str::to_owned),
    }
}

fn insert(
    document: &mut BinDocument,
    holder: &str,
    item: NewItem,
) -> Result<String, BinDocumentError> {
    let schema = schema();
    document.insert_item(entry(), holder, item, schema.at(Some(BUILD)))
}

fn rejection<T: std::fmt::Debug>(result: Result<T, BinDocumentError>) -> EditRejection {
    match result {
        Err(BinDocumentError::EditRejected { rejection, .. }) => rejection,
        other => panic!("expected a refusal, got {other:?}"),
    }
}

#[test]
fn an_item_inserts_at_an_index_and_at_the_end_at_its_zero() {
    let mut document = document();
    let weights = wire(h("weights"));

    let path = insert(&mut document, &weights, item(Some(1), None, None)).unwrap();
    assert_eq!(path, format!("{weights}[1]"));
    let end = insert(&mut document, &weights, item(None, None, None)).unwrap();
    assert_eq!(end, format!("{weights}[3]"));
    assert_eq!(
        items(&document, "weights"),
        floats(&[0.5, 0.0, 1.0, 0.0]).items()
    );

    insert(&mut document, &wire(h("corners")), NewItem::default()).unwrap();
    assert_eq!(
        items(&document, "corners"),
        [values::Vector3::new(Vec3::ZERO).into()]
    );

    insert(
        &mut document,
        &wire(h("slots")),
        item(None, None, Some("InnerData")),
    )
    .unwrap();
    insert(&mut document, &wire(h("slots")), NewItem::default()).unwrap();
    assert_eq!(
        items(&document, "slots"),
        [
            values::Embedded(empty("InnerData")).into(),
            values::Embedded(empty("InnerData")).into(),
        ],
        "an embed naming no class takes the one its list holds"
    );

    let emitters = wire(h("emitters"));
    insert(&mut document, &emitters, item(Some(0), None, None)).unwrap();
    insert(
        &mut document,
        &emitters,
        item(None, None, Some("DerivedData")),
    )
    .unwrap();
    assert_eq!(
        items(&document, "emitters"),
        [
            values::Struct::default().into(),
            empty("InnerData").into(),
            empty("DerivedData").into(),
        ],
        "a pointer item without a class starts null"
    );

    let names = wire(h("names"));
    let walk = insert(&mut document, &names, item(None, Some("Walk"), None)).unwrap();
    assert_eq!(walk, format!("{names}{{{}}}", hash_key("Walk")));
    assert_eq!(
        map_keys(&document, "names"),
        [hash_key("Idle"), hash_key("Walk")]
    );
    insert(
        &mut document,
        &names,
        item(Some(0), Some("0x0000002a"), None),
    )
    .unwrap();
    assert_eq!(
        map_keys(&document, "names")[0],
        wire_key(&values::Hash::new(BinHash(0x2a)).into())
    );

    let chance = wire(h("chance"));
    let set = insert(&mut document, &chance, NewItem::default()).unwrap();
    assert_eq!(set, format!("{chance}[0]"));
    assert_eq!(
        value(&document, "chance"),
        &values::Optional::new(Kind::F32, Some(values::F32::new(0.0).into()))
            .unwrap()
            .into()
    );
}

#[test]
fn an_item_edit_that_does_not_fit_is_refused_and_leaves_the_tree() {
    let mut document = document();
    let names = wire(h("names"));
    let weights = wire(h("weights"));

    assert_eq!(
        rejection(insert(
            &mut document,
            &names,
            item(None, Some("Idle"), None)
        )),
        EditRejection::KeyExists
    );
    assert_eq!(
        rejection(insert(&mut document, &names, NewItem::default())),
        EditRejection::MissingKey
    );
    assert_eq!(
        rejection(insert(
            &mut document,
            &wire(h("counts")),
            item(None, Some("many"), None)
        )),
        EditRejection::OutOfRange {
            kind: PropertyKind::U32
        }
    );
    assert_eq!(
        rejection(insert(&mut document, &wire(h("held")), NewItem::default())),
        EditRejection::ValueHeld
    );
    assert_eq!(
        rejection(insert(&mut document, &weights, item(Some(3), None, None))),
        EditRejection::NoSuchIndex
    );
    assert_eq!(
        rejection(insert(&mut document, &wire(h("slots")), NewItem::default())),
        EditRejection::MissingClass
    );
    assert_eq!(
        rejection(insert(
            &mut document,
            &format!("{weights}[0]"),
            NewItem::default()
        )),
        EditRejection::NotAList
    );
    assert_eq!(
        rejection(document.move_item(entry(), &format!("{weights}[0]"), 2)),
        EditRejection::NoSuchIndex
    );
    assert_eq!(
        rejection(document.remove_item(entry(), &weights)),
        EditRejection::NotAnItem
    );
    assert_eq!(
        rejection(document.set_pointer(entry(), &wire(h("falloff")), Some("InnerData"))),
        EditRejection::ValueHeld
    );
    assert_eq!(
        rejection(document.set_pointer(entry(), &weights, None)),
        EditRejection::NotAPointer
    );
    assert!(matches!(
        document.remove_item(entry(), &format!("{weights}[7]")),
        Err(BinDocumentError::NodeNotFound { .. })
    ));
    assert!(!document.is_dirty());
    assert_eq!(items(&document, "weights"), floats(&[0.5, 1.0]).items());
}

#[test]
fn a_remove_a_move_and_a_key_edit_undo_to_where_they_were() {
    let mut document = document();
    let weights = wire(h("weights"));
    let names = wire(h("names"));

    document
        .remove_item(entry(), &format!("{weights}[0]"))
        .unwrap();
    assert_eq!(items(&document, "weights"), floats(&[1.0]).items());
    assert!(document.undo().unwrap());
    assert_eq!(items(&document, "weights"), floats(&[0.5, 1.0]).items());

    let moved = document
        .move_item(entry(), &format!("{weights}[0]"), 1)
        .unwrap();
    assert_eq!(moved, format!("{weights}[1]"));
    assert_eq!(items(&document, "weights"), floats(&[1.0, 0.5]).items());
    assert!(document.undo().unwrap());
    assert_eq!(items(&document, "weights"), floats(&[0.5, 1.0]).items());
    assert!(document.redo().unwrap());
    assert_eq!(items(&document, "weights"), floats(&[1.0, 0.5]).items());
    assert!(document.undo().unwrap());

    let idle = format!("{names}{{{}}}", hash_key("Idle"));
    let run = document.set_key(entry(), &idle, "Run").unwrap();
    assert_eq!(run, format!("{names}{{{}}}", hash_key("Run")));
    assert_eq!(map_keys(&document, "names"), [hash_key("Run")]);
    assert!(document.undo().unwrap());
    assert_eq!(map_keys(&document, "names"), [hash_key("Idle")]);
    assert_eq!(
        document.set_key(entry(), &idle, "Idle").unwrap(),
        idle,
        "the key it holds already is no edit"
    );

    insert(&mut document, &names, item(None, Some("Walk"), None)).unwrap();
    document.remove_item(entry(), &idle).unwrap();
    assert!(document.undo().unwrap());
    assert_eq!(
        map_keys(&document, "names"),
        [hash_key("Idle"), hash_key("Walk")],
        "a removed entry comes back at its index"
    );

    let held = wire(h("held"));
    document
        .remove_item(entry(), &format!("{held}[0]"))
        .unwrap();
    assert!(matches!(
        value(&document, "held"),
        PropertyValueEnum::Optional(optional) if optional.is_none()
    ));
    assert!(document.undo().unwrap());
    assert!(matches!(
        value(&document, "held"),
        PropertyValueEnum::Optional(optional) if optional.is_some()
    ));

    document
        .set_pointer(entry(), &wire(h("mesh")), Some("InnerData"))
        .unwrap();
    assert_eq!(value(&document, "mesh"), &empty("InnerData").into());
    assert!(document.undo().unwrap());
    assert_eq!(value(&document, "mesh"), &values::Struct::default().into());

    document
        .set_pointer(entry(), &wire(h("falloff")), None)
        .unwrap();
    assert_eq!(
        value(&document, "falloff"),
        &values::Struct::default().into()
    );
    assert!(document.undo().unwrap());
    assert_eq!(value(&document, "falloff"), &empty("DerivedData").into());
}

/// The fields the pointer at `field` holds, in the order it holds them.
fn pointer_fields(document: &BinDocument, field: &str) -> Vec<BinHash> {
    match value(document, field) {
        PropertyValueEnum::Struct(pointer) => pointer.properties.keys().copied().collect(),
        other => panic!("{field} is no pointer: {other:?}"),
    }
}

#[test]
fn a_replaced_class_keeps_the_fields_both_classes_declare_alike() {
    let schema = schema();
    let at = schema.at(Some(BUILD));
    let mut document = document();
    let shape = wire(h("shape"));
    let held = value(&document, "shape").clone();

    document
        .replace_pointer(entry(), &shape, Some("DerivedData"), at)
        .unwrap();
    assert!(
        !document.is_dirty(),
        "the class it holds already is no edit"
    );

    document
        .replace_pointer(entry(), &shape, Some("DeeperData"), at)
        .unwrap();
    assert_eq!(pointer_fields(&document, "shape"), [h("shared"), h("own")]);

    document
        .replace_pointer(entry(), &shape, Some("InnerData"), at)
        .unwrap();
    assert_eq!(pointer_fields(&document, "shape"), [h("shared")]);

    document
        .replace_pointer(entry(), &shape, Some("UnrelatedData"), at)
        .unwrap();
    assert_eq!(
        pointer_fields(&document, "shape"),
        [],
        "a field the next class declares with another type is dropped"
    );

    document.replace_pointer(entry(), &shape, None, at).unwrap();
    assert_eq!(value(&document, "shape"), &values::Struct::default().into());

    for _ in 0..4 {
        assert!(document.undo().unwrap());
    }
    assert_eq!(value(&document, "shape"), &held);
    assert_eq!(
        rejection(document.replace_pointer(entry(), &wire(h("weights")), None, at)),
        EditRejection::NotAPointer
    );
}

#[test]
fn a_mesh_primitive_keeps_its_mesh_across_the_mesh_classes() {
    let schema = crate::meta_schema::shared(Some(BUILD));
    let at = schema.at(Some(BUILD));
    let mesh = values::Embedded(empty("VfxMeshDefinitionData"));
    let object = BinObject::builder(h(SKIN), h("VfxEmitterDefinitionData"))
        .property(
            h("primitive"),
            values::Struct {
                class_hash: h("VfxPrimitiveMesh"),
                properties: IndexMap::from([
                    (h("mMesh"), mesh.into()),
                    (h("AlignYawToCamera"), values::Bool::new(true).into()),
                ]),
            },
        )
        .build();
    let mut out = Cursor::new(Vec::new());
    Bin::new([object], std::iter::empty::<&str>())
        .to_writer(&mut out)
        .unwrap();
    let mut document = BinDocument::parse(out.into_inner()).unwrap();
    let primitive = wire(h("primitive"));

    document
        .replace_pointer(entry(), &primitive, Some("VfxPrimitiveAttachedMesh"), at)
        .unwrap();
    assert_eq!(
        pointer_fields(&document, "primitive"),
        [h("mMesh"), h("AlignYawToCamera")]
    );

    document
        .replace_pointer(entry(), &primitive, Some("VfxPrimitiveArbitraryTrail"), at)
        .unwrap();
    assert_eq!(pointer_fields(&document, "primitive"), []);
}

#[test]
fn a_replaced_class_through_a_property_edit_is_one_undo() {
    let schema = schema();
    let mut document = document();
    let replace = |class: &str| ValueEdit::ReplacePointer {
        path: String::new(),
        class: Some(class.to_owned()),
    };

    document
        .edit_property(
            entry(),
            "",
            &wire(h("mesh")),
            vec![replace("InnerData"), replace("DerivedData")],
            schema.at(Some(BUILD)),
        )
        .unwrap();
    assert_eq!(value(&document, "mesh"), &empty("DerivedData").into());

    assert!(document.undo().unwrap());
    assert_eq!(value(&document, "mesh"), &values::Struct::default().into());
}

#[test]
fn a_class_line_offers_held_declared_and_derived_classes() {
    let schema = schema();
    let at = schema.at(Some(BUILD));
    let document = document();
    let names = |choices: &[ClassChoice]| -> Vec<String> {
        choices
            .iter()
            .map(|choice| choice.name.clone().unwrap())
            .collect()
    };

    let emitters = document
        .item_classes(entry(), &wire(h("emitters")), at)
        .unwrap();
    assert_eq!(names(&emitters), ["InnerData", "DeeperData", "DerivedData"]);
    assert!(emitters[0].held);
    assert_eq!(emitters[0].derives_from, None);
    assert!(!emitters[1].held);
    assert_eq!(
        emitters[1].derives_from.as_deref(),
        Some("InnerData"),
        "a class two bases down derives too"
    );

    let mesh = document
        .item_classes(entry(), &wire(h("mesh")), at)
        .unwrap();
    assert_eq!(names(&mesh), ["InnerData", "DeeperData", "DerivedData"]);
    assert!(mesh.iter().all(|choice| !choice.held));

    assert_eq!(
        rejection(document.item_classes(entry(), &format!("{}[0]", wire(h("weights"))), at)),
        EditRejection::NotAList
    );
}

#[test]
fn an_item_edit_saves_through_the_delta() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("skin0.bin");
    let mut document = document();
    fs_err::write(&path, &document.base).unwrap();

    insert(
        &mut document,
        &wire(h("weights")),
        item(Some(0), None, None),
    )
    .unwrap();
    let names = wire(h("names"));
    document
        .set_key(entry(), &format!("{names}{{{}}}", hash_key("Idle")), "Run")
        .unwrap();
    document.save_to(&path).unwrap();

    let reread = BinDocument::parse(fs_err::read(&path).unwrap()).unwrap();
    assert_eq!(items(&reread, "weights"), floats(&[0.0, 0.5, 1.0]).items());
    assert_eq!(map_keys(&reread, "names"), [hash_key("Run")]);
}
