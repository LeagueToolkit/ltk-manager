//! Unit tests for adding and removing a property: the fields a class offers with its bases',
//! the value a declared field starts at, the free-form shapes, the refusals, and undo.

use std::io::Cursor;

use ltk_hash::Hash as _;
use ltk_meta::Bin;

use super::*;
use crate::bin_document::{LeafValue, PropertyKind};
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

/// A schema with a class, its base, an embed class, and a default of every family.
fn schema() -> MetaSchema {
    let json = format!(
        r#"{{
          "formatVersion": 1,
          "hashSource": {{ "fetchedAt": "2026-09-14T00:00:00Z" }},
          "latest": 8104348,
          "versions": [{{ "patch": "16.17", "build": 8104348 }}],
          "classes": {{
            "0x{skin}": {{
              "name": "SkinData",
              "revisions": [{{ "from": 1, "bases": ["0x{base}"], "interface": false, "value": false }}],
              "properties": {{
                "0x{scale}": {{ "name": "scale", "revisions": [{{ "from": 1, "type": ["F32", "0x0", "0x0", "0x0"], "default": 1.5 }}] }},
                "0x{tint}": {{ "name": "tint", "revisions": [{{ "from": 1, "type": ["Color", "0x0", "0x0", "0x0"], "default": [0, 0, 0, 255] }}] }},
                "0x{mesh}": {{ "name": "mesh", "revisions": [{{ "from": 1, "type": ["Embed", "0x0", "0x0", "0x{inner}"], "default": {{ "depth": 9.0 }} }}] }},
                "0x{falloff}": {{ "name": "falloff", "revisions": [{{ "from": 1, "type": ["Pointer", "0x0", "0x0", "0x{inner}"], "default": {{ "depth": 0.0 }} }}] }},
                "0x{maybe}": {{ "name": "maybe", "revisions": [{{ "from": 1, "type": ["Pointer", "0x0", "0x0", "0x{inner}"], "default": null }}] }},
                "0x{corners}": {{ "name": "corners", "revisions": [{{ "from": 1, "type": ["List2", "0x0", "Vec3", "0x0"], "default": [[-1.0, 0.0, 1.0], [1.0, 0.0, 1.0]] }}] }},
                "0x{slots}": {{ "name": "slots", "revisions": [{{ "from": 1, "type": ["List", "0x2", "Embed", "0x{inner}"], "default": [{{}}, {{}}] }}] }},
                "0x{names}": {{ "name": "names", "revisions": [{{ "from": 1, "type": ["Map", "String", "String", "0x0"], "default": {{ "a": "b" }} }}] }},
                "0x{chance}": {{ "name": "chance", "revisions": [{{ "from": 1, "type": ["Option", "0x0", "F32", "0x0"], "default": 5.0 }}] }},
                "0x{material}": {{ "name": "material", "revisions": [{{ "from": 1, "type": ["Hash", "0x0", "0x0", "0x0"], "default": "0x2a" }}] }},
                "0x{transform}": {{ "name": "transform", "revisions": [{{ "from": 1, "type": ["Mtx44", "0x0", "0x0", "0x0"], "default": [[1.0, 2.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0], [0.0, 0.0, 0.0, 1.0]] }}] }},
                "0x{bare}": {{ "name": "bare", "revisions": [{{ "from": 1, "type": ["U8", "0x0", "0x0", "0x0"] }}] }},
                "0x{gone}": {{ "name": "gone", "revisions": [{{ "from": 1, "to": 2, "type": ["U8", "0x0", "0x0", "0x0"] }}] }}
              }}
            }},
            "0x{base}": {{
              "name": "BaseData",
              "revisions": [{{ "from": 1, "bases": [], "interface": false, "value": false }}],
              "properties": {{
                "0x{inherited}": {{ "name": "inherited", "revisions": [{{ "from": 1, "type": ["Bool", "0x0", "0x0", "0x0"], "default": true }}] }},
                "0x{scale}": {{ "name": "scale", "revisions": [{{ "from": 1, "type": ["U8", "0x0", "0x0", "0x0"], "default": 3 }}] }}
              }}
            }},
            "0x{inner}": {{
              "name": "InnerData",
              "revisions": [{{ "from": 1, "bases": [], "interface": false, "value": false }}],
              "properties": {{
                "0x{depth}": {{ "name": "depth", "revisions": [{{ "from": 1, "type": ["F32", "0x0", "0x0", "0x0"], "default": 9.0 }}] }}
              }}
            }}
          }}
        }}"#,
        skin = wire(h("SkinData")),
        base = wire(h("BaseData")),
        inner = wire(h("InnerData")),
        scale = wire(h("scale")),
        tint = wire(h("tint")),
        mesh = wire(h("mesh")),
        falloff = wire(h("falloff")),
        maybe = wire(h("maybe")),
        corners = wire(h("corners")),
        slots = wire(h("slots")),
        names = wire(h("names")),
        chance = wire(h("chance")),
        material = wire(h("material")),
        transform = wire(h("transform")),
        bare = wire(h("bare")),
        gone = wire(h("gone")),
        inherited = wire(h("inherited")),
        depth = wire(h("depth")),
    );
    MetaSchema::parse(json.as_bytes()).unwrap()
}

/// A bin with one object of `SkinData` writing `scale`, and an embed and a null pointer.
fn document() -> BinDocument {
    let object = BinObject::builder(h(SKIN), h("SkinData"))
        .property(h("scale"), values::F32::new(2.0))
        .property(
            h("mesh"),
            values::Embedded(values::Struct {
                class_hash: h("InnerData"),
                properties: IndexMap::new(),
            }),
        )
        .property(h("maybe"), values::Struct::default())
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

fn declared(field: &str) -> NewProperty {
    NewProperty::Declared {
        field: hex(h(field)),
    }
}

fn property<'a>(
    document: &'a BinDocument,
    holder_field: Option<&str>,
    field: &str,
) -> Option<&'a PropertyValueEnum> {
    let object = document.object_at(entry()).unwrap();
    let properties = match holder_field {
        None => &object.properties,
        Some(holder) => match &object.properties[&h(holder)] {
            PropertyValueEnum::Embedded(values::Embedded(inner)) => &inner.properties,
            PropertyValueEnum::Struct(inner) => &inner.properties,
            other => panic!("{holder} is no holder: {other:?}"),
        },
    };
    properties.get(&h(field))
}

fn rejection(result: Result<(), BinDocumentError>) -> EditRejection {
    match result {
        Err(BinDocumentError::EditRejected { rejection, .. }) => rejection,
        other => panic!("expected a refusal, got {other:?}"),
    }
}

#[test]
fn a_class_offers_its_fields_and_its_bases_less_what_the_holder_writes() {
    let schema = schema();
    let offered = document()
        .addable_fields(entry(), "", schema.at(Some(BUILD)))
        .unwrap();

    assert_eq!(offered.class.as_deref(), Some("SkinData"));
    let names: Vec<_> = offered
        .fields
        .iter()
        .map(|field| field.name.as_deref().unwrap())
        .collect();
    assert!(!names.contains(&"scale"), "the holder writes it: {names:?}");
    assert!(!names.contains(&"mesh"));
    assert!(
        !names.contains(&"gone"),
        "a revision that ended is no field at the build"
    );
    assert!(names.contains(&"inherited"));

    let inherited = offered
        .fields
        .iter()
        .find(|field| field.name.as_deref() == Some("inherited"))
        .unwrap();
    assert_eq!(inherited.inherited_from.as_deref(), Some("BaseData"));
    let falloff = offered
        .fields
        .iter()
        .find(|field| field.name.as_deref() == Some("falloff"))
        .unwrap();
    assert_eq!(falloff.class.as_deref(), Some("InnerData"));
}

#[test]
fn a_nearer_class_hides_a_base_field_of_the_same_hash() {
    let schema = schema();
    let scale = schema
        .declared_field(h("SkinData"), h("scale"), Some(BUILD))
        .unwrap();
    assert_eq!(scale.shape.kind, Kind::F32);
    assert_eq!(scale.owner, h("SkinData"));
}

#[test]
fn a_declared_field_starts_at_its_published_default() {
    let schema = schema();
    let mut document = document();
    let at = schema.at(Some(BUILD));
    for field in [
        "tint",
        "falloff",
        "corners",
        "slots",
        "names",
        "chance",
        "material",
        "transform",
        "bare",
        "inherited",
    ] {
        document
            .add_property(entry(), "", declared(field), at)
            .unwrap_or_else(|error| panic!("{field}: {error}"));
    }

    let mut tint = values::Color::default();
    tint.value.a = 255;
    assert_eq!(property(&document, None, "tint"), Some(&tint.into()));
    assert_eq!(
        property(&document, None, "falloff"),
        Some(
            &values::Struct {
                class_hash: h("InnerData"),
                properties: IndexMap::new(),
            }
            .into()
        ),
        "a pointer the game constructs starts as its class with no fields"
    );
    let Some(PropertyValueEnum::UnorderedContainer(corners)) = property(&document, None, "corners")
    else {
        panic!("corners is a list2");
    };
    assert_eq!(corners.0.len(), 2);
    let Some(PropertyValueEnum::Container(slots)) = property(&document, None, "slots") else {
        panic!("slots is a list");
    };
    assert_eq!(slots.len(), 2, "a fixed list of embeds starts as that many");
    let Some(PropertyValueEnum::Map(names)) = property(&document, None, "names") else {
        panic!("names is a map");
    };
    assert_eq!(names.entries().len(), 1);
    assert_eq!(
        property(&document, None, "chance"),
        Some(
            &values::Optional::new(Kind::F32, Some(values::F32::new(5.0).into()))
                .unwrap()
                .into()
        )
    );
    assert_eq!(
        property(&document, None, "material"),
        Some(&values::Hash::new(BinHash(0x2a)).into())
    );
    let Some(PropertyValueEnum::Matrix44(transform)) = property(&document, None, "transform")
    else {
        panic!("transform is a matrix");
    };
    assert_eq!(
        transform.value.transpose().to_cols_array()[1],
        2.0,
        "rows stay rows"
    );
    assert_eq!(
        property(&document, None, "bare"),
        Some(&values::U8::new(0).into()),
        "a revision with no default starts at the kind's zero"
    );
    assert_eq!(
        property(&document, None, "inherited"),
        Some(&values::Bool::new(true).into())
    );
}

#[test]
fn a_field_adds_inside_an_embed_and_lands_last() {
    let schema = schema();
    let mut document = document();
    document
        .add_property(
            entry(),
            &wire(h("mesh")),
            declared("depth"),
            schema.at(Some(BUILD)),
        )
        .unwrap();
    assert_eq!(
        property(&document, Some("mesh"), "depth"),
        Some(&values::F32::new(9.0).into())
    );

    document
        .add_property(entry(), "", declared("tint"), schema.at(Some(BUILD)))
        .unwrap();
    let object = document.object_at(entry()).unwrap();
    assert_eq!(object.properties.keys().last(), Some(&h("tint")));
}

#[test]
fn a_custom_field_takes_a_name_a_hash_a_container_and_a_class() {
    let schema = schema();
    let at = schema.at(Some(BUILD));
    let mut document = document();
    let custom = |field: &str, shape: KindShape, class: Option<&str>| NewProperty::Custom {
        field: field.to_owned(),
        shape,
        class: class.map(str::to_owned),
    };
    let bare = |kind| KindShape::bare(kind);

    document
        .add_property(
            entry(),
            "",
            custom("myLabel", bare(PropertyKind::String), None),
            at,
        )
        .unwrap();
    document
        .add_property(
            entry(),
            "",
            custom("0x0000002a", bare(PropertyKind::U32), None),
            at,
        )
        .unwrap();
    document
        .add_property(
            entry(),
            "",
            custom(
                "myList",
                KindShape {
                    kind: PropertyKind::Container,
                    key: None,
                    value: Some(PropertyKind::Hash),
                },
                None,
            ),
            at,
        )
        .unwrap();
    document
        .add_property(
            entry(),
            "",
            custom("myEmbed", bare(PropertyKind::Embedded), Some("InnerData")),
            at,
        )
        .unwrap();

    assert_eq!(
        property(&document, None, "myLabel"),
        Some(&values::String::new(String::new()).into())
    );
    assert!(
        document
            .object_at(entry())
            .unwrap()
            .properties
            .contains_key(&BinHash(0x2a))
    );
    assert!(matches!(
        property(&document, None, "myList"),
        Some(PropertyValueEnum::Container(items)) if items.item_kind() == Kind::Hash
    ));
    assert!(matches!(
        property(&document, None, "myEmbed"),
        Some(PropertyValueEnum::Embedded(values::Embedded(inner))) if inner.class_hash == h("InnerData")
    ));
}

#[test]
fn a_typed_pointer_starts_as_the_class_it_names() {
    let schema = schema();
    let mut document = document();
    let pointer = NewProperty::Custom {
        field: "myPointer".to_owned(),
        shape: KindShape::bare(PropertyKind::Struct),
        class: Some("InnerData".to_owned()),
    };

    document
        .add_property(entry(), "", pointer, schema.at(Some(BUILD)))
        .unwrap();

    assert!(matches!(
        property(&document, None, "myPointer"),
        Some(PropertyValueEnum::Struct(inner)) if inner.class_hash == h("InnerData")
    ));
}

#[test]
fn an_add_that_does_not_fit_is_refused_and_leaves_the_tree() {
    let schema = schema();
    let at = schema.at(Some(BUILD));
    let mut document = document();

    assert_eq!(
        rejection(document.add_property(entry(), "", declared("scale"), at)),
        EditRejection::PropertyExists
    );
    assert_eq!(
        rejection(document.add_property(entry(), "", declared("nothing"), at)),
        EditRejection::UndeclaredField
    );
    assert_eq!(
        rejection(document.add_property(entry(), &wire(h("scale")), declared("depth"), at)),
        EditRejection::NotAHolder
    );
    assert_eq!(
        rejection(document.add_property(entry(), &wire(h("maybe")), declared("depth"), at)),
        EditRejection::NotAHolder,
        "a null pointer holds nothing"
    );
    assert_eq!(
        rejection(document.add_property(
            entry(),
            "",
            NewProperty::Custom {
                field: "myEmbed".to_owned(),
                shape: KindShape::bare(PropertyKind::Embedded),
                class: None,
            },
            at
        )),
        EditRejection::MissingClass
    );
    assert_eq!(
        rejection(document.add_property(
            entry(),
            "",
            NewProperty::Custom {
                field: "myList".to_owned(),
                shape: KindShape::bare(PropertyKind::Container),
                class: None,
            },
            at
        )),
        EditRejection::InvalidShape
    );
    assert!(!document.is_dirty());
}

#[test]
fn a_remove_undoes_back_to_its_position_and_an_add_undoes_away() {
    let schema = schema();
    let mut document = document();
    let order = |document: &BinDocument| -> Vec<BinHash> {
        document
            .object_at(entry())
            .unwrap()
            .properties
            .keys()
            .copied()
            .collect()
    };
    let before = order(&document);

    document
        .remove_property(entry(), &wire(h("scale")))
        .unwrap();
    assert!(property(&document, None, "scale").is_none());
    assert!(document.undo().unwrap());
    assert_eq!(
        order(&document),
        before,
        "the property is back where it was"
    );
    assert_eq!(
        property(&document, None, "scale"),
        Some(&values::F32::new(2.0).into())
    );
    assert!(document.redo().unwrap());
    assert!(property(&document, None, "scale").is_none());
    assert!(document.undo().unwrap());

    document
        .add_property(entry(), "", declared("tint"), schema.at(Some(BUILD)))
        .unwrap();
    document
        .set_leaf(
            entry(),
            &wire(h("tint")),
            LeafValue::Color {
                r: 1,
                g: 2,
                b: 3,
                a: 4,
            },
        )
        .unwrap();
    assert!(document.undo().unwrap());
    assert!(document.undo().unwrap());
    assert_eq!(order(&document), before);
}

#[test]
fn a_remove_of_no_property_is_refused() {
    let mut document = document();
    assert_eq!(
        rejection(document.remove_property(entry(), "")),
        EditRejection::NotAProperty
    );
    assert!(matches!(
        document.remove_property(entry(), &wire(h("nothing"))),
        Err(BinDocumentError::NodeNotFound { .. })
    ));
    assert!(matches!(
        document.remove_property(
            entry(),
            &format!("{}.{}", wire(h("mesh")), wire(h("depth")))
        ),
        Err(BinDocumentError::NodeNotFound { .. })
    ));
    assert_eq!(
        rejection(document.remove_property(entry(), &format!("{}[0]", wire(h("mesh"))))),
        EditRejection::NotAProperty,
        "an element is no property"
    );
}

#[test]
fn an_add_and_a_remove_save_through_the_delta() {
    let schema = schema();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("skin0.bin");
    let mut document = document();
    fs_err::write(&path, &document.base).unwrap();

    document
        .add_property(entry(), "", declared("tint"), schema.at(Some(BUILD)))
        .unwrap();
    document
        .remove_property(entry(), &wire(h("scale")))
        .unwrap();
    document.save_to(&path).unwrap();

    let reread = BinDocument::parse(fs_err::read(&path).unwrap()).unwrap();
    assert!(property(&reread, None, "tint").is_some());
    assert!(property(&reread, None, "scale").is_none());
}
