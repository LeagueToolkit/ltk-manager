//! Unit tests for copied values: a duplicate and a paste of an emitter through one property
//! edit, the unique name, undo, the save, and the refusals.

use std::io::Cursor;

use assert_matches::assert_matches;
use indexmap::IndexMap;
use ltk_hash::Hash as _;
use ltk_meta::property::Kind;
use ltk_meta::{Bin, BinObject};

use super::*;
use crate::bin_document::ValueEdit;
use crate::meta_schema::{self, MetaSchema};
use crate::problems::GameBuild;

const BUILD: GameBuild = GameBuild::new(16, 17, 8_104_348);
const SYSTEM: &str = "Characters/Teemo/Skins/Skin0/Particles/Teemo_Q";
const OTHER: &str = "Characters/Teemo/Skins/Skin0/Particles/Teemo_R";

fn h(text: &str) -> BinHash {
    BinHash::hash_str(text)
}

fn hashed(name: &str) -> String {
    format!("{:08x}", h(name).0)
}

fn schema() -> std::sync::Arc<MetaSchema> {
    meta_schema::shared(Some(BUILD))
}

fn class(name: &str, properties: Vec<(&str, PropertyValueEnum)>) -> values::Struct {
    values::Struct {
        class_hash: h(name),
        properties: properties
            .into_iter()
            .map(|(field, value)| (h(field), value))
            .collect(),
    }
}

/// An emitter holding a hash, a link, a classed pointer, a nested embed, an option and a map.
fn emitter(name: &str) -> PropertyValueEnum {
    let drivers = values::Map::new(
        Kind::String,
        Kind::Struct,
        vec![(
            values::String::from("Alpha").into(),
            class(
                "FloatLiteralMaterialDriver",
                vec![("mValue", values::F32::new(0.25).into())],
            )
            .into(),
        )],
    )
    .unwrap();
    let color = class(
        "ValueColor",
        vec![("constantValue", values::Vector4::default().into())],
    );

    class(
        "VfxEmitterDefinitionData",
        vec![
            ("emitterName", values::String::from(name).into()),
            ("StencilReferenceId", values::Hash::new(h("Stencil")).into()),
            (
                "Material",
                values::ObjectLink::new(h("Maps/Materials/Glow")).into(),
            ),
            (
                "SpawnShape",
                class(
                    "VfxShapeBox",
                    vec![("size", values::Vector3::default().into())],
                )
                .into(),
            ),
            ("birthColor", values::Embedded(color).into()),
            (
                "lifetime",
                values::Optional::new(Kind::F32, Some(values::F32::new(1.5).into()))
                    .unwrap()
                    .into(),
            ),
            ("materialDrivers", drivers.into()),
        ],
    )
    .into()
}

fn emitters(names: &[&str]) -> values::Container {
    values::Container::new(
        Kind::Struct,
        names.iter().map(|name| emitter(name)).collect(),
    )
    .unwrap()
}

/// A bin with one system of `complex` and `simple` emitters, and one object beside it.
fn bin_bytes(system: &str, complex: &[&str], simple: &[&str]) -> Vec<u8> {
    let object = BinObject::builder(h(system), h("VfxSystemDefinitionData"))
        .property(h("complexEmitterDefinitionData"), emitters(complex))
        .property(h("simpleEmitterDefinitionData"), emitters(simple))
        .property(h("particleName"), values::String::from("Teemo_Q"))
        .build();
    let untouched = BinObject::new(h("Characters/Teemo"), h("CharacterRecord"));
    let mut out = Cursor::new(Vec::new());
    Bin::new([object, untouched], std::iter::empty::<&str>())
        .to_writer(&mut out)
        .unwrap();
    out.into_inner()
}

fn document(complex: &[&str], simple: &[&str]) -> BinDocument {
    BinDocument::parse(bin_bytes(SYSTEM, complex, simple)).unwrap()
}

fn list<'a>(document: &'a BinDocument, system: &str, field: &str) -> &'a [PropertyValueEnum] {
    match &document.object_at(h(system)).unwrap().properties[&h(field)] {
        PropertyValueEnum::Container(items) => items.items(),
        other => panic!("{field} is no list: {other:?}"),
    }
}

fn names(document: &BinDocument, system: &str) -> Vec<String> {
    list(document, system, "complexEmitterDefinitionData")
        .iter()
        .map(|item| {
            let PropertyValueEnum::Struct(inner) = item else {
                panic!("an emitter is a pointer");
            };
            match &inner.properties[&h("emitterName")] {
                PropertyValueEnum::String(text) => text.value.clone(),
                other => panic!("emitterName is no string: {other:?}"),
            }
        })
        .collect()
}

fn unique() -> Option<String> {
    Some(format!("0x{}", hashed("emitterName")))
}

fn duplicate(document: &mut BinDocument, index: usize) -> Result<(), BinDocumentError> {
    document.edit_property(
        h(SYSTEM),
        "",
        &format!("0x{}", hashed("complexEmitterDefinitionData")),
        vec![ValueEdit::CopyItem {
            from: format!("[{index}]"),
            path: String::new(),
            index: Some(index + 1),
            unique: unique(),
        }],
        schema().at(Some(BUILD)),
    )
}

fn paste(
    document: &mut BinDocument,
    system: &str,
    index: Option<usize>,
    text: &str,
) -> Result<(), BinDocumentError> {
    document.edit_property(
        h(system),
        "",
        &format!("0x{}", hashed("complexEmitterDefinitionData")),
        vec![ValueEdit::PasteItem {
            path: String::new(),
            index,
            text: text.to_owned(),
            unique: unique(),
        }],
        schema().at(Some(BUILD)),
    )
}

fn copy(document: &BinDocument, path: &str) -> String {
    document
        .copy_value(h(SYSTEM), path, schema().at(Some(BUILD)))
        .unwrap()
}

fn rejection(result: Result<(), BinDocumentError>) -> EditRejection {
    match result {
        Err(BinDocumentError::EditRejected { rejection, .. }) => rejection,
        other => panic!("expected a rejection, got {other:?}"),
    }
}

/// `value` with its `emitterName` set to `name`, to compare a copy with its source.
fn renamed(value: &PropertyValueEnum, name: &str) -> PropertyValueEnum {
    let PropertyValueEnum::Struct(inner) = value else {
        panic!("an emitter is a pointer");
    };
    let mut properties: IndexMap<_, _> = inner.properties.clone();
    properties.insert(h("emitterName"), values::String::from(name).into());
    values::Struct {
        class_hash: inner.class_hash,
        properties,
    }
    .into()
}

#[test]
fn a_duplicate_lands_after_its_source_under_a_unique_name() {
    let mut document = document(&["Spark", "Smoke"], &[]);
    let source = list(&document, SYSTEM, "complexEmitterDefinitionData")[0].clone();

    duplicate(&mut document, 0).unwrap();

    assert_eq!(names(&document, SYSTEM), ["Spark", "Spark_copy", "Smoke"]);
    let copied = &list(&document, SYSTEM, "complexEmitterDefinitionData")[1];
    assert_eq!(*copied, renamed(&source, "Spark_copy"));
    assert!(document.is_dirty());
}

#[test]
fn a_duplicate_is_one_undo_step() {
    let mut document = document(&["Spark", "Smoke"], &[]);

    duplicate(&mut document, 1).unwrap();
    assert!(document.undo().unwrap());
    assert_eq!(names(&document, SYSTEM), ["Spark", "Smoke"]);
    assert!(!document.undo().unwrap());

    assert!(document.redo().unwrap());
    assert_eq!(names(&document, SYSTEM), ["Spark", "Smoke", "Smoke_copy"]);
}

#[test]
fn a_duplicate_of_a_copy_counts_past_every_name_the_system_holds() {
    let mut document = document(&["Spark", "Spark_copy"], &["Spark_copy2"]);

    duplicate(&mut document, 1).unwrap();

    assert_eq!(
        names(&document, SYSTEM),
        ["Spark", "Spark_copy", "Spark_copy3"]
    );
}

#[test]
fn a_name_is_unique_against_the_taken_texts() {
    let taken = HashSet::from(["Glow", "Glow_copy", "Glow_copy2", "Rim_copyA"]);

    assert_eq!(unique_text("Fresh", &taken), "Fresh");
    assert_eq!(unique_text("Glow", &taken), "Glow_copy3");
    assert_eq!(unique_text("Glow_copy2", &taken), "Glow_copy3");
    assert_eq!(unique_text("Rim_copyA", &taken), "Rim_copyA_copy");
}

#[test]
fn a_duplicate_saves_through_the_delta_and_reads_back_whole() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("teemo.bin");
    let mut document = document(&["Spark"], &["Glow"]);
    fs_err::write(&path, document.base()).unwrap();

    duplicate(&mut document, 0).unwrap();
    document.save_to(&path).unwrap();
    assert!(!document.is_dirty());

    let reread = BinDocument::parse(fs_err::read(&path).unwrap()).unwrap();
    assert_eq!(
        reread.object_at(h(SYSTEM)),
        document.object_at(h(SYSTEM)),
        "the saved system reads back as the tree held it"
    );
    assert_eq!(names(&reread, SYSTEM), ["Spark", "Spark_copy"]);
    assert!(reread.object_at(h("Characters/Teemo")).is_some());
}

#[test]
fn a_copy_pastes_into_another_document_exactly() {
    let source = document(&["Spark", "Smoke"], &[]);
    let text = copy(
        &source,
        &format!("{}[1]", hashed("complexEmitterDefinitionData")),
    );
    assert!(text.contains(CLIPBOARD_FORMAT));
    assert!(
        text.contains("\"class\": \"VfxEmitterDefinitionData\""),
        "{text}"
    );

    let mut target = BinDocument::parse(bin_bytes(OTHER, &["Spark"], &[])).unwrap();
    paste(&mut target, OTHER, None, &text).unwrap();

    let pasted = &list(&target, OTHER, "complexEmitterDefinitionData")[1];
    assert_eq!(
        *pasted,
        list(&source, SYSTEM, "complexEmitterDefinitionData")[1],
        "a name the target does not hold stays"
    );
    assert!(target.undo().unwrap());
    assert_eq!(names(&target, OTHER), ["Spark"]);
}

#[test]
fn a_paste_of_a_taken_name_lands_where_asked_under_a_unique_name() {
    let mut document = document(&["Spark", "Smoke"], &[]);
    let text = copy(
        &document,
        &format!("{}[0]", hashed("complexEmitterDefinitionData")),
    );

    paste(&mut document, SYSTEM, Some(1), &text).unwrap();

    assert_eq!(names(&document, SYSTEM), ["Spark", "Spark_copy", "Smoke"]);
}

#[test]
fn a_paste_refuses_text_that_is_no_copy() {
    let mut document = document(&["Spark"], &[]);

    for text in ["", "Spark", "{\"format\":\"other\"}", "{\"value\":1}"] {
        assert_eq!(
            rejection(paste(&mut document, SYSTEM, None, text)),
            EditRejection::NotACopy,
            "{text:?}"
        );
    }
    assert_eq!(names(&document, SYSTEM), ["Spark"]);
    assert!(!document.is_dirty());
    assert!(!document.undo().unwrap());
}

#[test]
fn a_paste_refuses_a_copy_of_another_class() {
    let mut document = document(&["Spark"], &[]);
    let emitter = format!("{}[0]", hashed("complexEmitterDefinitionData"));

    let shape = copy(&document, &format!("{emitter}.{}", hashed("SpawnShape")));
    assert_eq!(
        rejection(paste(&mut document, SYSTEM, None, &shape)),
        EditRejection::ForeignClass
    );
    let color = copy(&document, &format!("{emitter}.{}", hashed("birthColor")));
    assert_eq!(
        rejection(paste(&mut document, SYSTEM, None, &color)),
        EditRejection::ForeignClass
    );
    let name = copy(&document, &format!("{emitter}.{}", hashed("emitterName")));
    assert_matches!(
        rejection(paste(&mut document, SYSTEM, None, &name)),
        EditRejection::InvalidShape
    );
    assert!(!document.is_dirty());
}

#[test]
fn a_paste_refuses_a_list_whose_items_are_not_its_kind() {
    let mut document = document(&["Spark"], &[]);
    let text = copy(
        &document,
        &format!("{}[0]", hashed("complexEmitterDefinitionData")),
    );
    let mut json: serde_json::Value = serde_json::from_str(&text).unwrap();
    let driver = json["value"]["value"]["properties"][h("materialDrivers").0.to_string()]["value"]
        ["value_kind"]
        .as_str()
        .map(str::to_owned);
    assert!(driver.is_some(), "the map writes its value kind: {json}");
    json["value"]["value"]["properties"][h("materialDrivers").0.to_string()]["value"]["value_kind"] =
        serde_json::Value::String("F32".to_owned());

    assert_eq!(
        rejection(paste(&mut document, SYSTEM, None, &json.to_string())),
        EditRejection::InvalidShape
    );
}

#[test]
fn a_system_template_lands_its_emitters_named_apart_in_one_undo_step() {
    let mut document = document(&["Sparks"], &[]);
    let explosion = crate::vfx::vfx_templates()
        .into_iter()
        .find(|template| template.id == "explosion")
        .unwrap();
    let mut taken = vec!["Sparks".to_owned()];
    let mut edits = Vec::new();
    for (offset, emitter) in explosion.emitters.iter().enumerate() {
        let name = if taken.contains(&emitter.name) {
            format!("{}2", emitter.name)
        } else {
            emitter.name.clone()
        };
        taken.push(name.clone());

        let index = 1 + offset;
        edits.push(ValueEdit::PasteItem {
            path: String::new(),
            index: Some(index),
            text: emitter.text.clone(),
            unique: None,
        });
        edits.push(ValueEdit::SetLeaf {
            path: format!("[{index}].{}", hashed("emitterName")),
            value: LeafValue::String { value: name },
        });
    }

    document
        .edit_property(
            h(SYSTEM),
            "",
            &format!("0x{}", hashed("complexEmitterDefinitionData")),
            edits,
            schema().at(Some(BUILD)),
        )
        .unwrap();

    assert_eq!(names(&document, SYSTEM), taken);
    assert!(document.undo().unwrap());
    assert_eq!(names(&document, SYSTEM), ["Sparks"]);
}
