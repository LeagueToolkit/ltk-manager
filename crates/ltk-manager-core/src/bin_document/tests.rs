//! Unit tests for the bin document: the row projection over a bin built with the
//! toolkit's writer, the address in both forms, and the store the app keeps documents in.

use super::*;
use crate::meta_schema::MetaSchema;
use crate::problems::GameBuild;
use ltk_meta::path::PropertyPath;
use ltk_meta::property::NoMeta;
use ltk_meta::{Bin, BinOverride, PropertyPatch};
use std::collections::HashMap;

fn h(text: &str) -> BinHash {
    BinHash::hash_str(text)
}

fn wire(field: &str) -> String {
    format!("{:08x}", h(field))
}

const UNNAMED_FIELD: u32 = 0x9c4e_1b02;
const UNNAMED_OBJECT: u32 = 0x1234_5678;
const UNNAMED_KEY: u32 = 0xdead_beef;

fn embedded(class: &str, properties: Vec<(BinHash, PropertyValueEnum)>) -> values::Embedded {
    values::Embedded(values::Struct {
        class_hash: h(class),
        properties: properties.into_iter().collect(),
        meta: NoMeta,
    })
}

/// The skin object of the design's own example, with one property of every shape.
fn skin() -> BinObject {
    let mesh = embedded(
        "SkinMeshDataProperties",
        vec![
            (h("material"), values::Hash::new(h("Aatrox_Mat")).into()),
            (
                h("texture"),
                values::WadChunkLink::new(WadHash::hash_str("assets/aatrox.tex")).into(),
            ),
        ],
    );
    let lookup = values::Map::new(
        Kind::Hash,
        Kind::String,
        vec![
            (
                values::Hash::new(h("weapon")).into(),
                values::String::from("sword").into(),
            ),
            (
                values::Hash::new(UNNAMED_KEY).into(),
                values::String::from("shield").into(),
            ),
        ],
    )
    .unwrap();
    let parts = values::Container::new(
        Kind::Embedded,
        vec![embedded("Part", vec![(h("name"), values::String::from("p0").into())]).into()],
    )
    .unwrap();

    BinObject::builder(
        h("Characters/Aatrox/Skins/Skin0/Resources"),
        h("SkinCharacterDataProperties"),
    )
    .property(h("skinClassification"), values::I32::new(1))
    .property(
        h("championSkinName"),
        values::String::from("Justicar Aatrox"),
    )
    .property(h("skinMeshProperties"), mesh)
    .property(
        h("armorMaterial"),
        values::Container::from(vec![
            values::I32::new(10),
            values::I32::new(20),
            values::I32::new(30),
        ]),
    )
    .property(h("lookup"), lookup)
    .property(
        h("maybe"),
        values::Optional::from(Some(values::F32::new(1.5))),
    )
    .property(
        h("never"),
        values::Optional::<NoMeta>::empty(Kind::I32).unwrap(),
    )
    .property(
        h("iconSquare"),
        values::Optional::from(Some(values::WadChunkLink::new(WadHash::hash_str(
            "assets/aatrox.tex",
        )))),
    )
    .property(
        h("boxed"),
        values::Optional::from(Some(values::Embedded(values::Struct {
            class_hash: h("Part"),
            properties: [(h("name"), values::String::from("b0").into())]
                .into_iter()
                .collect(),
            meta: NoMeta,
        }))),
    )
    .property(h("pointer"), values::Struct::default())
    .property(h("link"), values::ObjectLink::new(h("Characters/Aatrox")))
    .property(h("bits"), values::BitBool::new(true))
    .property(h("big"), values::U64::new(u64::MAX))
    .property(h("origin"), values::Vector3::default())
    .property(h("basis"), values::Matrix44::default())
    .property(h("tint"), values::Color::default())
    .property(h("parts"), parts)
    .property(
        h("unordered"),
        values::UnorderedContainer::from(values::Container::from(vec![values::U8::new(7)])),
    )
    .property(
        h("classed"),
        values::Struct {
            class_hash: h("Part"),
            properties: [(h("name"), values::String::from("s0").into())]
                .into_iter()
                .collect(),
            meta: NoMeta,
        },
    )
    .property(UNNAMED_FIELD, values::Bool::new(false))
    .build()
}

fn prop_bytes() -> Vec<u8> {
    let bin = Bin::<NoMeta>::builder()
        .dependency("common.bin")
        .object(skin())
        .object(BinObject::new(h("Characters/Aatrox"), h("CharacterRecord")))
        .object(BinObject::new(UNNAMED_OBJECT, 0xabcd_ef01u32))
        .build();
    let mut out = Cursor::new(Vec::new());
    bin.to_writer(&mut out).unwrap();
    out.into_inner()
}

fn document() -> BinDocument {
    BinDocument::parse(&prop_bytes()).unwrap()
}

/// Tables that name what the fixture writes with a name, and nothing else.
#[derive(Default)]
struct Tables {
    entries: HashMap<BinHash, &'static str>,
    classes: HashMap<BinHash, &'static str>,
    fields: HashMap<BinHash, &'static str>,
    values: HashMap<BinHash, &'static str>,
    chunks: HashMap<WadHash, &'static str>,
}

fn named() -> Tables {
    let bin = |names: &[&'static str]| -> HashMap<BinHash, &'static str> {
        names.iter().map(|name| (h(name), *name)).collect()
    };
    Tables {
        entries: bin(&[
            "Characters/Aatrox/Skins/Skin0/Resources",
            "Characters/Aatrox",
        ]),
        classes: bin(&[
            "SkinCharacterDataProperties",
            "SkinMeshDataProperties",
            "CharacterRecord",
            "Part",
        ]),
        fields: bin(&[
            "skinClassification",
            "championSkinName",
            "skinMeshProperties",
            "material",
            "texture",
            "armorMaterial",
            "lookup",
            "maybe",
            "never",
            "iconSquare",
            "boxed",
            "pointer",
            "link",
            "bits",
            "big",
            "origin",
            "basis",
            "tint",
            "parts",
            "unordered",
            "classed",
            "name",
        ]),
        values: bin(&["Aatrox_Mat", "weapon"]),
        chunks: [(WadHash::hash_str("assets/aatrox.tex"), "assets/aatrox.tex")]
            .into_iter()
            .collect(),
    }
}

fn visit_each<K: std::hash::Hash + Eq>(
    table: &HashMap<K, &'static str>,
    hashes: &[K],
    visit: &mut dyn FnMut(usize, &str),
) {
    for (at, hash) in hashes.iter().enumerate() {
        if let Some(name) = table.get(hash) {
            visit(at, name);
        }
    }
}

impl RowNames for Tables {
    fn for_each_entry(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        visit_each(&self.entries, hashes, visit);
    }

    fn for_each_class(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        visit_each(&self.classes, hashes, visit);
    }

    fn for_each_field(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        visit_each(&self.fields, hashes, visit);
    }

    fn for_each_value(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        visit_each(&self.values, hashes, visit);
    }

    fn for_each_chunk(&self, hashes: &[WadHash], visit: &mut dyn FnMut(usize, &str)) {
        visit_each(&self.chunks, hashes, visit);
    }
}

/// The rows under `path` of the skin object, all of them, named, with no schema.
fn under(path: &str) -> Vec<BinRow> {
    document()
        .children(
            h("Characters/Aatrox/Skins/Skin0/Resources"),
            path,
            0,
            usize::MAX,
            &named(),
            None,
        )
        .unwrap()
        .rows
}

fn row<'a>(rows: &'a [BinRow], name: &str) -> &'a BinRow {
    rows.iter()
        .find(|row| row.name == name)
        .unwrap_or_else(|| panic!("no row named {name}"))
}

#[test]
fn roots_name_every_object_and_count_its_properties() {
    let rows = document().roots(&named(), None);

    let names: Vec<_> = rows.iter().map(|row| row.name.as_str()).collect();
    assert_eq!(
        names,
        [
            "Characters/Aatrox/Skins/Skin0/Resources",
            "Characters/Aatrox",
            "0x12345678"
        ]
    );
    assert!(rows.iter().all(|row| row.node == RowNode::Object));
    assert!(rows.iter().all(|row| row.kind.is_none()));
    assert!(
        rows.iter()
            .all(|row| row.path.is_empty() && row.label.is_empty())
    );
    assert_eq!(
        rows[0].entry,
        hex(h("Characters/Aatrox/Skins/Skin0/Resources"))
    );
    assert_eq!(
        rows[0].value,
        BinValue::Struct {
            class_hash: hex(h("SkinCharacterDataProperties")),
            class: Some("SkinCharacterDataProperties".to_owned()),
            len: 20,
        }
    );
    assert!(!rows[0].unnamed);
    assert!(rows[2].unnamed);
    assert_eq!(
        rows[2].value,
        BinValue::Struct {
            class_hash: "0xabcdef01".to_owned(),
            class: None,
            len: 0,
        }
    );
}

#[test]
fn an_object_expands_to_its_properties_in_file_order() {
    let rows = under("");

    assert_eq!(rows.len(), 20);
    assert_eq!(rows[0].name, "skinClassification");
    assert_eq!(rows[0].node, RowNode::Property);
    assert_eq!(rows[0].kind, Some(PropertyKind::I32));
    assert_eq!(rows[0].path, wire("skinClassification"));
    assert_eq!(rows[0].label, "skinClassification");
    assert_eq!(
        rows[0].value,
        BinValue::Integer {
            text: "1".to_owned()
        }
    );
    assert_eq!(rows[1].name, "championSkinName");
    assert_eq!(
        rows[1].value,
        BinValue::String {
            value: "Justicar Aatrox".to_owned()
        }
    );
    assert_eq!(rows[19].name, "0x9c4e1b02");
}

#[test]
fn a_field_no_table_names_is_hex_in_the_name_and_the_label() {
    let rows = under("");
    let row = row(&rows, "0x9c4e1b02");

    assert!(row.unnamed);
    assert_eq!(row.path, format!("{UNNAMED_FIELD:08x}"));
    assert_eq!(row.label, "0x9c4e1b02");
    assert_eq!(row.value, BinValue::Bool { value: false });
}

#[test]
fn nothing_named_draws_every_hash_as_hex() {
    let rows = document()
        .children(
            h("Characters/Aatrox/Skins/Skin0/Resources"),
            &wire("skinMeshProperties"),
            0,
            usize::MAX,
            &(),
            None,
        )
        .unwrap()
        .rows;

    assert_eq!(rows[0].name, hex(h("material")));
    assert_eq!(
        rows[0].label,
        format!("0x{}.0x{}", wire("skinMeshProperties"), wire("material"))
    );
    assert_eq!(
        rows[0].value,
        BinValue::Hash {
            hash: hex(h("Aatrox_Mat")),
            name: None
        }
    );
}

#[test]
fn an_embedded_expands_through_its_class_and_names_what_its_leaves_point_at() {
    let rows = under("");
    let mesh = row(&rows, "skinMeshProperties");
    assert_eq!(mesh.kind, Some(PropertyKind::Embedded));
    assert_eq!(
        mesh.value,
        BinValue::Struct {
            class_hash: hex(h("SkinMeshDataProperties")),
            class: Some("SkinMeshDataProperties".to_owned()),
            len: 2,
        }
    );

    let inner = under(&mesh.path);
    assert_eq!(inner.len(), 2);
    assert_eq!(
        inner[0].path,
        format!("{}.{}", wire("skinMeshProperties"), wire("material"))
    );
    assert_eq!(inner[0].label, "skinMeshProperties.material");
    assert_eq!(
        inner[0].value,
        BinValue::Hash {
            hash: hex(h("Aatrox_Mat")),
            name: Some("Aatrox_Mat".to_owned()),
        }
    );
    assert_eq!(
        inner[1].value,
        BinValue::WadChunkLink {
            hash: format!("{:016x}", WadHash::hash_str("assets/aatrox.tex")),
            path: Some("assets/aatrox.tex".to_owned()),
        }
    );
}

#[test]
fn a_container_indexes_its_elements() {
    let rows = under("");
    let list = row(&rows, "armorMaterial");
    assert_eq!(
        list.value,
        BinValue::Container {
            len: 3,
            item_kind: PropertyKind::I32,
        }
    );

    let items = under(&list.path);
    let names: Vec<_> = items.iter().map(|row| row.name.as_str()).collect();
    assert_eq!(names, ["[0]", "[1]", "[2]"]);
    assert!(items.iter().all(|row| row.node == RowNode::Element));
    assert_eq!(items[1].path, format!("{}[1]", wire("armorMaterial")));
    assert_eq!(items[1].label, "armorMaterial[1]");
    assert_eq!(
        items[1].value,
        BinValue::Integer {
            text: "20".to_owned()
        }
    );
}

#[test]
fn a_file_under_an_option_is_named_like_one_beside_a_field() {
    let rows = under("");
    let option = row(&rows, "iconSquare");
    assert_eq!(option.kind, Some(PropertyKind::Optional));

    assert!(under(&option.path).is_empty());
    assert_eq!(
        option.value,
        BinValue::WadChunkLink {
            hash: format!("{:016x}", WadHash::hash_str("assets/aatrox.tex")),
            path: Some("assets/aatrox.tex".to_owned()),
        }
    );
}

#[test]
fn an_unordered_container_indexes_its_elements_like_an_ordered_one() {
    let rows = under("");
    let list = row(&rows, "unordered");
    assert_eq!(list.kind, Some(PropertyKind::UnorderedContainer));
    assert_eq!(
        list.value,
        BinValue::Container {
            len: 1,
            item_kind: PropertyKind::U8,
        }
    );

    let items = under(&list.path);
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].name, "[0]");
    assert_eq!(items[0].label, "unordered[0]");
    assert_eq!(
        items[0].value,
        BinValue::Integer {
            text: "7".to_owned()
        }
    );
}

#[test]
fn a_struct_with_a_class_shows_it_and_expands_to_its_properties() {
    let rows = under("");
    let classed = row(&rows, "classed");
    assert_eq!(classed.kind, Some(PropertyKind::Struct));
    assert_eq!(
        classed.value,
        BinValue::Struct {
            class_hash: hex(h("Part")),
            class: Some("Part".to_owned()),
            len: 1,
        }
    );

    let inner = under(&classed.path);
    assert_eq!(inner.len(), 1);
    assert_eq!(inner[0].name, "name");
    assert_eq!(inner[0].label, "classed.name");
    assert_eq!(
        inner[0].value,
        BinValue::String {
            value: "s0".to_owned()
        }
    );
}

#[test]
fn a_range_answers_a_window_and_the_total() {
    let list = wire("armorMaterial");
    let page = document()
        .children(
            h("Characters/Aatrox/Skins/Skin0/Resources"),
            &list,
            1,
            1,
            &named(),
            None,
        )
        .unwrap();

    assert_eq!(page.total, 3);
    assert_eq!(page.rows.len(), 1);
    assert_eq!(page.rows[0].name, "[1]");

    let past_the_end = document()
        .children(
            h("Characters/Aatrox/Skins/Skin0/Resources"),
            &list,
            5,
            1,
            &named(),
            None,
        )
        .unwrap();
    assert_eq!(past_the_end.total, 3);
    assert!(past_the_end.rows.is_empty());
}

#[test]
fn a_map_keys_its_entries() {
    let rows = under("");
    let map = row(&rows, "lookup");
    assert_eq!(
        map.value,
        BinValue::Map {
            len: 2,
            key_kind: PropertyKind::Hash,
            value_kind: PropertyKind::String,
        }
    );

    let entries = under(&map.path);
    assert_eq!(entries.len(), 2);
    assert!(entries.iter().all(|row| row.node == RowNode::Entry));

    assert_eq!(entries[0].name, "\"weapon\"");
    assert!(!entries[0].unnamed);
    assert_eq!(
        entries[0].path,
        format!("{}{{{}}}", wire("lookup"), wire("weapon"))
    );
    assert_eq!(entries[0].label, "lookup{\"weapon\"}");
    assert_eq!(
        entries[0].value,
        BinValue::String {
            value: "sword".to_owned()
        }
    );

    assert_eq!(entries[1].name, "0xdeadbeef");
    assert!(entries[1].unnamed);
    assert_eq!(entries[1].path, format!("{}{{deadbeef}}", wire("lookup")));
    assert_eq!(entries[1].label, "lookup{0xdeadbeef}");
}

#[test]
fn an_optional_holding_a_leaf_draws_it_and_holds_no_row() {
    let rows = under("");

    let maybe = row(&rows, "maybe");
    assert_eq!(maybe.kind, Some(PropertyKind::Optional));
    assert_eq!(maybe.value, BinValue::Float { value: 1.5 });
    assert!(under(&maybe.path).is_empty());

    let never = row(&rows, "never");
    assert_eq!(
        never.value,
        BinValue::Optional {
            present: false,
            item_kind: PropertyKind::I32,
        }
    );
    assert!(under(&never.path).is_empty());
}

#[test]
fn an_optional_holding_rows_keeps_the_index_they_hang_off() {
    let rows = under("");

    let boxed = row(&rows, "boxed");
    assert_eq!(
        boxed.value,
        BinValue::Optional {
            present: true,
            item_kind: PropertyKind::Embedded,
        }
    );

    let inside = under(&boxed.path);
    assert_eq!(inside.len(), 1);
    assert_eq!(inside[0].name, "[0]");
    assert_eq!(inside[0].label, "boxed[0]");
}

#[test]
fn a_null_struct_draws_null_and_has_no_children() {
    let rows = under("");
    let pointer = row(&rows, "pointer");

    assert_eq!(pointer.kind, Some(PropertyKind::Struct));
    assert_eq!(pointer.value, BinValue::Null);
    assert!(under(&pointer.path).is_empty());
}

#[test]
fn every_leaf_kind_projects_into_its_widget() {
    let rows = under("");

    assert_eq!(row(&rows, "bits").value, BinValue::Bool { value: true });
    assert_eq!(row(&rows, "bits").kind, Some(PropertyKind::BitBool));
    assert_eq!(
        row(&rows, "big").value,
        BinValue::Integer {
            text: u64::MAX.to_string()
        }
    );
    assert_eq!(
        row(&rows, "origin").value,
        BinValue::Vector {
            values: vec![0.0, 0.0, 0.0]
        }
    );
    let BinValue::Matrix { values } = &row(&rows, "basis").value else {
        panic!("a matrix");
    };
    assert_eq!(values.len(), 16);
    assert_eq!(
        row(&rows, "tint").value,
        BinValue::Color {
            r: 0,
            g: 0,
            b: 0,
            a: 0
        }
    );
    assert_eq!(
        row(&rows, "link").value,
        BinValue::ObjectLink {
            hash: hex(h("Characters/Aatrox")),
            name: Some("Characters/Aatrox".to_owned()),
        }
    );
}

#[test]
fn a_nested_address_reads_its_parent_label_back_from_the_tables() {
    let path = format!("{}[0]", wire("parts"));
    let inside = under(&path);

    assert_eq!(inside.len(), 1);
    assert_eq!(inside[0].name, "name");
    assert_eq!(
        inside[0].path,
        format!("{}[0].{}", wire("parts"), wire("name"))
    );
    assert_eq!(inside[0].label, "parts[0].name");
}

#[test]
fn an_address_the_document_does_not_hold_is_an_error() {
    let document = document();
    let entry = h("Characters/Aatrox/Skins/Skin0/Resources");
    let not_found = |entry: BinHash, path: &str| {
        let error = document
            .children(entry, path, 0, usize::MAX, &(), None)
            .unwrap_err();
        assert!(
            matches!(error, BinDocumentError::NodeNotFound { .. }),
            "{path:?} should be no node: {error}"
        );
    };

    not_found(BinHash(0x0bad_0bad), "");
    not_found(entry, &wire("noSuchField"));
    not_found(entry, &format!("{}[3]", wire("armorMaterial")));
    not_found(entry, &format!("{}{{{}}}", wire("lookup"), wire("shield")));
    not_found(
        entry,
        &format!("{}.{}", wire("skinClassification"), wire("x")),
    );
    not_found(entry, &format!("{}[0]", wire("never")));
    not_found(entry, "garbage");
    not_found(entry, &format!(".{}", wire("skinClassification")));
}

/// The rows under each of `paths` of the skin object, named, with no schema.
fn each(paths: &[&str]) -> Result<Vec<BinRows>, BinDocumentError> {
    let paths: Vec<String> = paths.iter().map(|path| (*path).to_owned()).collect();
    document().children_each(
        h("Characters/Aatrox/Skins/Skin0/Resources"),
        &paths,
        &named(),
        None,
    )
}

#[test]
fn a_projected_read_answers_every_path_in_the_order_asked() {
    let pages = each(&[
        &wire("armorMaterial"),
        &wire("skinMeshProperties"),
        &wire("parts"),
    ])
    .unwrap();

    assert_eq!(pages.len(), 3);
    assert_eq!(pages[0].total, 3);
    let indices: Vec<_> = pages[0].rows.iter().map(|row| row.name.as_str()).collect();
    assert_eq!(indices, ["[0]", "[1]", "[2]"]);
    assert_eq!(row(&pages[1].rows, "texture").path.len(), 17);
    assert_eq!(pages[2].total, 1);
}

#[test]
fn a_path_that_reaches_nothing_answers_an_empty_page() {
    let pages = each(&[&wire("nowhere"), "not-a-path", &wire("parts")]).unwrap();

    assert!(pages[0].rows.is_empty());
    assert_eq!(pages[0].total, 0);
    assert!(pages[1].rows.is_empty());
    assert_eq!(pages[2].total, 1);
}

#[test]
fn a_projected_read_of_an_object_the_document_lacks_is_an_error() {
    let error = document()
        .children_each(h("Characters/Gone"), &[String::new()], &named(), None)
        .unwrap_err();

    assert!(matches!(error, BinDocumentError::NodeNotFound { .. }));
}

#[test]
fn a_projected_read_past_the_row_cap_is_refused_and_names_it() {
    /* Five lists of 401, so no one path is over its own page and the call is over
    the cap by five rows. */
    let list = |name: &str| {
        (
            h(name),
            values::Container::from(vec![values::I32::new(1); 401]),
        )
    };
    let object = BinObject::builder(h("Wide"), h("WideClass"))
        .property(list("a").0, list("a").1)
        .property(list("b").0, list("b").1)
        .property(list("c").0, list("c").1)
        .property(list("d").0, list("d").1)
        .property(list("e").0, list("e").1)
        .build();
    let bin = Bin::<NoMeta>::builder().object(object).build();
    let mut out = Cursor::new(Vec::new());
    bin.to_writer(&mut out).unwrap();
    let document = BinDocument::parse(&out.into_inner()).unwrap();

    let paths: Vec<String> = ["a", "b", "c", "d", "e"].iter().map(|f| wire(f)).collect();
    let error = document
        .children_each(h("Wide"), &paths, &named(), None)
        .unwrap_err();

    assert!(matches!(
        error,
        BinDocumentError::ReadTooWide {
            rows: 2005,
            cap: READ_ROW_CAP
        }
    ));

    /* Four of the five fit, which is what the caller batches down to. */
    assert!(
        document
            .children_each(h("Wide"), &paths[..4], &named(), None)
            .is_ok()
    );
}

#[test]
fn a_wire_path_parses_into_its_steps() {
    assert_eq!(parse_steps(""), Some(Vec::new()));
    assert_eq!(
        parse_steps("9c4e1b02[3].1a2b3c4d{\"we}ird\"}{7}"),
        Some(vec![
            Step::Field(BinHash(0x9c4e_1b02)),
            Step::Index(3),
            Step::Field(BinHash(0x1a2b_3c4d)),
            Step::Key("\"we}ird\"".to_owned()),
            Step::Key("7".to_owned()),
        ])
    );
    assert_eq!(parse_steps("9c4e1b0"), None);
    assert_eq!(parse_steps("9c4e1b02.zzzzzzzz"), None);
    assert_eq!(parse_steps("9c4e1b02[x]"), None);
    assert_eq!(parse_steps("9c4e1b02{\"open"), None);
}

#[test]
fn a_patch_bin_opens_to_its_added_objects_and_counts_what_it_does_not_draw() {
    let mut patch = BinOverride::<NoMeta>::new();
    patch.deleted.push(h("Characters/Gone"));
    let added = BinObject::new(h("Characters/Aatrox"), h("CharacterRecord"));
    patch.objects.insert(added.path_hash, added);
    for _ in 0..2 {
        patch.patches.push(PropertyPatch::new(
            h("Characters/Aatrox"),
            PropertyPath::new("mValue").unwrap(),
            values::U32::new(2),
        ));
    }
    let mut out = Cursor::new(Vec::new());
    patch.to_writer(&mut out).unwrap();

    let document = BinDocument::parse(&out.into_inner()).unwrap();
    assert_eq!(
        document.header(),
        BinHeader {
            kind: BinFileKind::Patch,
            version: None,
            objects: 1,
            dependencies: Vec::new(),
            patches: 2,
            deleted: 1,
        }
    );
    let rows = document.roots(&named(), None);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].name, "Characters/Aatrox");
}

#[test]
fn a_prop_header_carries_its_version_and_dependencies() {
    assert_eq!(
        document().header(),
        BinHeader {
            kind: BinFileKind::Prop,
            version: Some(3),
            objects: 3,
            dependencies: vec!["common.bin".to_owned()],
            patches: 0,
            deleted: 0,
        }
    );
}

/// A loose file, which is the asset a test names.
fn asset(path: &str) -> AssetRef {
    AssetRef::File {
        path: path.to_owned(),
    }
}

#[test]
fn bytes_that_are_not_a_bin_do_not_open() {
    let error = BinDocument::parse(b"DDS     ").unwrap_err();
    assert!(matches!(error, BinDocumentError::Unreadable(_)));

    let error = BinDocuments::default()
        .open(asset("a.bin"), || Ok(b"PROP".to_vec()))
        .unwrap_err();
    assert!(error.to_string().contains("not a readable bin"), "{error}");
}

#[test]
fn the_store_evicts_the_least_recently_used_asset_past_its_capacity() {
    let store = BinDocuments::new(NonZeroUsize::new(2).unwrap());
    let bytes = prop_bytes();

    let first = store.open(asset("a.bin"), || Ok(bytes.clone())).unwrap();
    let second = store.open(asset("b.bin"), || Ok(bytes.clone())).unwrap();
    store.read(first, |_| Ok(())).unwrap();
    let third = store.open(asset("c.bin"), || Ok(bytes.clone())).unwrap();

    assert!(store.is_open(first));
    assert!(!store.is_open(second));
    assert!(store.is_open(third));
    assert_ne!(first, second);
    assert_eq!(store.asset_of(second), None);
    assert_eq!(store.asset_of(third), Some(asset("c.bin")));
}

#[test]
fn two_opens_of_one_asset_share_one_parse_and_close_apart() {
    let store = BinDocuments::default();
    let bytes = prop_bytes();
    let parses = std::cell::Cell::new(0);
    let read = || {
        parses.set(parses.get() + 1);
        Ok(bytes.clone())
    };

    let file_tab = store.open(asset("a.bin"), read).unwrap();
    let object_tab = store.open(asset("a.bin"), read).unwrap();
    assert_ne!(file_tab, object_tab);
    assert_eq!(parses.get(), 1);

    store.close(file_tab);
    assert!(!store.is_open(file_tab));
    assert!(store.is_open(object_tab));
    store.read(object_tab, |_| Ok(())).unwrap();

    store.close(object_tab);
    assert!(!store.is_open(object_tab));
    store.open(asset("a.bin"), read).unwrap();
    assert_eq!(parses.get(), 2, "the last close dropped the tree");
}

#[test]
fn the_bound_counts_assets_and_not_ids() {
    let store = BinDocuments::new(NonZeroUsize::new(2).unwrap());
    let bytes = prop_bytes();

    let first = store.open(asset("a.bin"), || Ok(bytes.clone())).unwrap();
    let second = store.open(asset("a.bin"), || Ok(bytes.clone())).unwrap();
    let third = store.open(asset("a.bin"), || Ok(bytes.clone())).unwrap();
    let other = store.open(asset("b.bin"), || Ok(bytes.clone())).unwrap();

    for id in [first, second, third, other] {
        assert!(store.is_open(id), "{id}");
    }

    let more = store.open(asset("c.bin"), || Ok(bytes.clone())).unwrap();
    assert!(store.is_open(more));
    assert!(store.is_open(other));
    for id in [first, second, third] {
        assert!(!store.is_open(id), "{id} outlived its asset");
    }
}

#[test]
fn a_closed_document_is_not_open_and_closing_it_again_is_nothing() {
    let store = BinDocuments::default();
    let id = store.open(asset("a.bin"), || Ok(prop_bytes())).unwrap();

    store.close(id);
    store.close(id);

    assert!(!store.is_open(id));
    let error = store.read(id, |_| Ok(())).unwrap_err();
    assert!(error.to_string().contains("is not open"), "{error}");
}

#[test]
fn a_container_and_an_optional_carry_the_kind_of_what_they_hold() {
    let rows = under("");

    assert_eq!(
        row(&rows, "armorMaterial").value,
        BinValue::Container {
            len: 3,
            item_kind: PropertyKind::I32,
        }
    );
    assert_eq!(
        row(&rows, "parts").value,
        BinValue::Container {
            len: 1,
            item_kind: PropertyKind::Embedded,
        }
    );
    assert_eq!(
        row(&rows, "unordered").value,
        BinValue::Container {
            len: 1,
            item_kind: PropertyKind::U8,
        }
    );
    assert_eq!(
        row(&rows, "never").value,
        BinValue::Optional {
            present: false,
            item_kind: PropertyKind::I32,
        }
    );
}

/// The wire spelling of a kind is the tag a row draws and the word a Problems finding
/// writes. The three are one vocabulary.
#[test]
fn every_kind_crosses_as_the_tag_a_row_draws() {
    /* The format numbers the nineteen primitive kinds from 0 and the eight complex
    kinds from 128. */
    let kinds: Vec<Kind> = (0..=18u8)
        .chain(128..=135)
        .map(|byte| Kind::try_from(byte).expect("a kind the reader holds"))
        .collect();
    assert_eq!(kinds.len(), 27);

    for kind in kinds {
        let property = PropertyKind::from(kind);
        let json = serde_json::to_value(property).unwrap();
        assert_eq!(json.as_str(), Some(property.tag()), "{kind:?}");
    }

    assert_eq!(PropertyKind::BitBool.tag(), "flag");
    assert_eq!(PropertyKind::Vector3.tag(), "vec3");
    assert_eq!(PropertyKind::Matrix44.tag(), "mtx44");
    assert_eq!(PropertyKind::Color.tag(), "rgba");
    assert_eq!(PropertyKind::WadChunkLink.tag(), "file");
    assert_eq!(PropertyKind::ObjectLink.tag(), "link");
    assert_eq!(PropertyKind::Container.tag(), "list");
    assert_eq!(PropertyKind::UnorderedContainer.tag(), "list2");
    assert_eq!(PropertyKind::Struct.tag(), "pointer");
    assert_eq!(PropertyKind::Embedded.tag(), "embed");
    assert_eq!(PropertyKind::Optional.tag(), "option");
}

/// The build the fixture's rows are judged at. Every revision of [`schema`] opens at 1.
const JUDGED_AT: GameBuild = GameBuild::new(16, 17, 100);

/// A database naming the fixture's two classes, with one line per field a case turns on.
fn schema() -> MetaSchema {
    let key = |name: &str| format!("0x{:08x}", h(name).0);
    let line = |name: &str, r#type: &str| {
        format!(
            r#""{}": {{ "name": "{name}", "revisions": [{{ "from": 1, "type": [{type}] }}] }}"#,
            key(name)
        )
    };
    let json = format!(
        r#"{{
          "formatVersion": 1,
          "hashSource": {{ "fetchedAt": "2026-09-05T00:00:00Z" }},
          "latest": 9000000,
          "classes": {{
            "{skin}": {{
              "name": "SkinCharacterDataProperties",
              "properties": {{
                {champion_skin_name},
                {skin_classification},
                {armor_material},
                {lookup},
                {skin_mesh_properties},
                "0x{UNNAMED_FIELD:08x}": {{ "name": "schemaNamed", "revisions": [{{ "from": 1, "type": ["Bool", "0x0", "0x0", "0x0"] }}] }}
              }}
            }},
            "{mesh}": {{
              "name": "SkinMeshDataProperties",
              "properties": {{ {material} }}
            }},
            "{part}": {{ "name": "Part", "properties": {{}} }},
            "{record}": {{ "name": "CharacterRecord", "properties": {{}} }}
          }}
        }}"#,
        skin = key("SkinCharacterDataProperties"),
        mesh = key("SkinMeshDataProperties"),
        part = key("Part"),
        record = key("CharacterRecord"),
        champion_skin_name = line("championSkinName", r#""String", "0x0", "0x0", "0x0""#),
        skin_classification = line("skinClassification", r#""File", "0x0", "0x0", "0x0""#),
        armor_material = line("armorMaterial", r#""List", "0x0", "I32", "0x0""#),
        lookup = line("lookup", r#""Map", "File", "String", "0x0""#),
        skin_mesh_properties = line("skinMeshProperties", r#""Embed", "0x0", "0x0", "0x0""#),
        material = line("material", r#""Hash", "0x0", "0x0", "0x0""#),
    );
    MetaSchema::parse(json.as_bytes()).expect("the fixture is the published shape")
}

fn at(schema: &MetaSchema) -> SchemaAt<'_> {
    schema.at(Some(JUDGED_AT))
}

/// The rows under `path` of the skin object, named by `tables`, judged by `schema`.
fn judged_under(schema: &MetaSchema, tables: &Tables, path: &str) -> Vec<BinRow> {
    document()
        .children(
            h("Characters/Aatrox/Skins/Skin0/Resources"),
            path,
            0,
            usize::MAX,
            tables,
            Some(at(schema)),
        )
        .unwrap()
        .rows
}

fn declared(kind: PropertyKind, mismatch: bool) -> Option<DeclaredKind> {
    Some(DeclaredKind {
        shape: KindShape::bare(kind),
        mismatch,
    })
}

#[test]
fn a_property_row_carries_what_the_schema_declares_and_marks_a_mismatch() {
    let schema = schema();
    let rows = judged_under(&schema, &named(), "");

    assert_eq!(
        row(&rows, "championSkinName").declared,
        declared(PropertyKind::String, false)
    );

    let retyped = row(&rows, "skinClassification");
    assert_eq!(retyped.kind, Some(PropertyKind::I32));
    assert_eq!(retyped.declared, declared(PropertyKind::WadChunkLink, true));

    assert_eq!(
        row(&rows, "armorMaterial").declared,
        Some(DeclaredKind {
            shape: KindShape {
                kind: PropertyKind::Container,
                key: None,
                value: Some(PropertyKind::I32),
            },
            mismatch: false,
        })
    );
    assert_eq!(
        row(&rows, "lookup").declared,
        Some(DeclaredKind {
            shape: KindShape {
                kind: PropertyKind::Map,
                key: Some(PropertyKind::WadChunkLink),
                value: Some(PropertyKind::String),
            },
            mismatch: true,
        })
    );

    assert_eq!(row(&rows, "link").declared, None);
}

#[test]
fn without_a_schema_no_row_carries_a_declared_kind() {
    assert!(under("").iter().all(|row| row.declared.is_none()));
}

#[test]
fn a_field_no_table_names_takes_the_schemas_name() {
    let schema = schema();
    let rows = judged_under(&schema, &named(), "");
    let named_by_schema = row(&rows, "schemaNamed");

    assert!(!named_by_schema.unnamed);
    assert_eq!(named_by_schema.label, "schemaNamed");
    assert_eq!(named_by_schema.path, format!("{UNNAMED_FIELD:08x}"));
    assert_eq!(
        named_by_schema.declared,
        declared(PropertyKind::Bool, false)
    );
}

#[test]
fn a_class_no_table_names_takes_the_schemas_name() {
    let schema = schema();
    let mut tables = named();
    tables.classes.remove(&h("Part"));

    let classed = judged_under(&schema, &tables, "");
    let without = document()
        .children(
            h("Characters/Aatrox/Skins/Skin0/Resources"),
            "",
            0,
            usize::MAX,
            &tables,
            None,
        )
        .unwrap()
        .rows;

    let class = |rows: &[BinRow]| match &row(rows, "classed").value {
        BinValue::Struct { class, .. } => class.clone(),
        other => panic!("classed is a struct, not {other:?}"),
    };
    assert_eq!(class(&classed).as_deref(), Some("Part"));
    assert_eq!(class(&without), None);
}

/// A name is the database's at every build. A declared kind is a revision's.
#[test]
fn without_a_build_the_schema_names_a_field_and_declares_nothing() {
    let schema = schema();
    let rows = document()
        .children(
            h("Characters/Aatrox/Skins/Skin0/Resources"),
            "",
            0,
            usize::MAX,
            &named(),
            Some(schema.at(None)),
        )
        .unwrap()
        .rows;

    let named_by_schema = row(&rows, "schemaNamed");
    assert!(!named_by_schema.unnamed);
    assert!(rows.iter().all(|row| row.declared.is_none()));
}

#[test]
fn a_nested_field_is_declared_on_the_class_of_its_embedded() {
    let schema = schema();
    let rows = judged_under(&schema, &named(), &wire("skinMeshProperties"));

    assert_eq!(
        row(&rows, "material").declared,
        declared(PropertyKind::Hash, false)
    );
    assert_eq!(row(&rows, "texture").declared, None);
}

#[test]
fn an_element_and_an_entry_carry_no_declared_kind() {
    let schema = schema();

    let items = judged_under(&schema, &named(), &wire("armorMaterial"));
    assert_eq!(items.len(), 3);
    assert!(items.iter().all(|row| row.declared.is_none()));

    let entries = judged_under(&schema, &named(), &wire("lookup"));
    assert_eq!(entries.len(), 2);
    assert!(entries.iter().all(|row| row.declared.is_none()));
}

#[test]
fn a_parent_label_reads_a_schema_name_where_the_tables_have_none() {
    let schema = schema();
    let mut tables = named();
    tables.fields.remove(&h("skinMeshProperties"));

    let rows = judged_under(&schema, &tables, &wire("skinMeshProperties"));

    assert_eq!(rows[0].label, "skinMeshProperties.material");
}

#[test]
fn an_entry_open_answers_the_objects_header_facts() {
    let document = document();
    let entry = h("Characters/Aatrox/Skins/Skin0/Resources");

    let header = document.object(entry, &named(), None).unwrap();
    assert_eq!(header.entry, hex(entry));
    assert_eq!(header.name, "Characters/Aatrox/Skins/Skin0/Resources");
    assert!(!header.unnamed);
    assert_eq!(header.class.as_deref(), Some("SkinCharacterDataProperties"));
    assert_eq!(header.class_hash, hex(h("SkinCharacterDataProperties")));
    assert_eq!(header.properties, under("").len());

    let unnamed = document
        .object(BinHash::from(UNNAMED_OBJECT), &named(), None)
        .unwrap();
    assert_eq!(unnamed.name, "0x12345678");
    assert!(unnamed.unnamed);
    assert_eq!(unnamed.class, None);
    assert_eq!(unnamed.class_hash, "0xabcdef01");
    assert_eq!(unnamed.properties, 0);

    let error = document
        .object(h("Characters/Ahri"), &named(), None)
        .unwrap_err();
    assert!(matches!(error, BinDocumentError::NodeNotFound { .. }));
}

#[test]
fn a_header_and_a_root_take_the_schemas_class_name_where_the_tables_have_none() {
    let schema = schema();
    let document = document();
    let mut tables = named();
    tables.classes.remove(&h("CharacterRecord"));

    let header = document
        .object(h("Characters/Aatrox"), &tables, Some(at(&schema)))
        .unwrap();
    assert_eq!(header.class.as_deref(), Some("CharacterRecord"));

    let roots = document.roots(&tables, Some(at(&schema)));
    let root = roots
        .iter()
        .find(|row| row.name == "Characters/Aatrox")
        .expect("the record is a root");
    assert!(
        matches!(&root.value, BinValue::Struct { class: Some(name), .. } if name == "CharacterRecord")
    );
}

#[test]
fn an_objects_own_declaration_names_its_asset_and_file() {
    let document = document();
    let asset = asset("skin0.bin");
    let tables = named();

    let declaration = document
        .object(h("Characters/Aatrox"), &tables, None)
        .unwrap()
        .declared_in(&asset, "data/skin0.bin");
    assert_eq!(declaration.asset, asset);
    assert_eq!(declaration.file, "data/skin0.bin");
    assert_eq!(declaration.class, "CharacterRecord");
    assert_eq!(declaration.class_hash, hex(h("CharacterRecord")));

    let unnamed = document
        .object(BinHash::from(UNNAMED_OBJECT), &tables, None)
        .unwrap()
        .declared_in(&asset, "data/skin0.bin");
    assert_eq!(
        unnamed.class, "0xabcdef01",
        "a class no table names is its hex"
    );
}

#[test]
fn the_headers_dependencies_hash_as_wad_paths() {
    assert_eq!(
        document().dependency_hashes(),
        [WadHash::hash_str("common.bin")]
    );

    let mut patch = BinOverride::<NoMeta>::new();
    let added = BinObject::new(h("Characters/Aatrox"), h("CharacterRecord"));
    patch.objects.insert(added.path_hash, added);
    let mut out = Cursor::new(Vec::new());
    patch.to_writer(&mut out).unwrap();
    let patch = BinDocument::parse(&out.into_inner()).unwrap();
    assert!(patch.dependency_hashes().is_empty());
}
