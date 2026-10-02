//! A `PTCH` bin's records: target rows, record rows, and the rows under a record's value.

use super::*;

const SKIN: &str = "Characters/Aatrox/Skins/Skin0/Resources";
const ADDED: &str = "Characters/Aatrox";

fn part(name: &str) -> values::Embedded {
    embedded("Part", vec![(h("name"), values::String::from(name).into())])
}

/// A patch adding one object, deleting one, and writing six records over three targets.
fn patched() -> BinDocument {
    let mut patch = BinOverride::new();
    patch.deleted.push(h("Characters/Gone"));
    let added = BinObject::new(h(ADDED), h("CharacterRecord"));
    patch.objects.insert(added.path_hash, added);

    let record = |target: u32, path: &str, value: PropertyValueEnum| {
        PropertyPatch::new(target, PropertyPath::new(path).unwrap(), value)
    };
    let lookup = values::Map::new(
        Kind::Hash,
        Kind::String,
        vec![(
            values::Hash::new(h("weapon")).into(),
            values::String::from("axe").into(),
        )],
    )
    .unwrap();
    patch.patches = vec![
        record(*h(SKIN), "skinClassification", values::I32::new(2).into()),
        record(*h(ADDED), "mValue", values::U32::new(3).into()),
        record(*h(SKIN), "skinMeshProperties.boxed", part("b1").into()),
        record(
            UNNAMED_OBJECT,
            "parts",
            values::Container::from(vec![part("p0"), part("p1")]).into(),
        ),
        record(
            *h(SKIN),
            "maybe",
            values::Optional::from(Some(part("m0"))).into(),
        ),
        record(*h(SKIN), "lookup", lookup.into()),
    ];

    let mut out = Cursor::new(Vec::new());
    patch.to_writer(&mut out).unwrap();
    BinDocument::parse(out.into_inner()).unwrap()
}

fn under(entry: impl Into<BinHash>, path: &str) -> Result<BinRows, BinDocumentError> {
    patched().children(entry.into(), path, 0, usize::MAX, &named(), None)
}

fn paths(rows: &[BinRow]) -> Vec<&str> {
    rows.iter().map(|row| row.path.as_str()).collect()
}

#[test]
fn roots_hold_the_added_objects_then_each_target_in_first_record_order() {
    let rows = patched().roots(&named(), None);

    let drawn: Vec<_> = rows
        .iter()
        .map(|row| (row.node, row.name.as_str(), row.path.as_str()))
        .collect();
    assert_eq!(
        drawn,
        [
            (RowNode::Object, ADDED, ""),
            (RowNode::Target, SKIN, "#"),
            (RowNode::Target, ADDED, "#"),
            (RowNode::Target, "0x12345678", "#"),
        ]
    );
    assert_eq!(rows[1].entry, hex(h(SKIN)));
    assert_eq!(rows[1].value, BinValue::Records { len: 4 });
    assert_eq!(rows[2].value, BinValue::Records { len: 1 });
    assert!(rows[3].unnamed);
    assert!(rows[1..].iter().all(|row| row.kind.is_none()));
}

#[test]
fn a_target_answers_its_records_in_file_order_under_their_positions() {
    let records = under(h(SKIN), TARGET_PATH).unwrap();

    assert_eq!(records.total, 4);
    assert_eq!(paths(&records.rows), ["#0", "#2", "#4", "#5"]);
    let first = &records.rows[0];
    assert_eq!(first.node, RowNode::Record);
    assert_eq!(first.name, "skinClassification");
    assert_eq!(first.label, "skinClassification");
    assert_eq!(first.entry, hex(h(SKIN)));
    assert_eq!(first.kind, Some(PropertyKind::I32));
    assert_eq!(
        first.value,
        BinValue::Integer {
            text: "2".to_owned()
        }
    );
    assert_eq!(first.declared, None);
    assert_eq!(
        records.rows[1].value,
        BinValue::Struct {
            class_hash: hex(h("Part")),
            class: Some("Part".to_owned()),
            len: 1,
        }
    );
}

#[test]
fn a_target_pages_its_records() {
    let page = patched()
        .children(h(SKIN), TARGET_PATH, 1, 2, &named(), None)
        .unwrap();

    assert_eq!(page.total, 4);
    assert_eq!(paths(&page.rows), ["#2", "#4"]);
}

#[test]
fn a_record_on_an_added_object_sits_under_its_target_apart_from_the_object() {
    let object = under(h(ADDED), "").unwrap();
    let records = under(h(ADDED), TARGET_PATH).unwrap();

    assert_eq!(object.total, 0);
    assert_eq!(paths(&records.rows), ["#1"]);
}

#[test]
fn a_record_value_expands_under_its_position_and_its_own_path() {
    let embed = under(h(SKIN), "#2").unwrap().rows;
    assert_eq!(paths(&embed), [format!("#2.{}", hashed("name"))]);
    assert_eq!(embed[0].label, "skinMeshProperties.boxed.name");
    assert_eq!(embed[0].node, RowNode::Property);

    let list = under(UNNAMED_OBJECT, "#3").unwrap().rows;
    assert_eq!(paths(&list), ["#3[0]", "#3[1]"]);
    assert_eq!(list[1].label, "parts[1]");

    let nested = under(UNNAMED_OBJECT, "#3[1]").unwrap().rows;
    assert_eq!(paths(&nested), [format!("#3[1].{}", hashed("name"))]);
    assert_eq!(nested[0].label, "parts[1].name");
    assert_eq!(
        nested[0].value,
        BinValue::String {
            value: "p1".to_owned()
        }
    );

    let option = under(h(SKIN), "#4").unwrap().rows;
    assert_eq!(paths(&option), ["#4[0]"]);

    let map = under(h(SKIN), "#5").unwrap().rows;
    assert_eq!(paths(&map), [format!("#5{{{:08x}}}", h("weapon"))]);
    assert_eq!(map[0].label, "lookup{\"weapon\"}");
}

#[test]
fn an_address_no_record_holds_reaches_nothing() {
    for (entry, path) in [
        (*h(SKIN), "#9"),
        (*h(SKIN), "#1"),
        (*h(SKIN), "#02"),
        (*h(SKIN), &format!("#2{}", hashed("name"))),
        (*h(SKIN), &format!("#0.{}", hashed("name"))),
        (*h(SKIN), ".#2"),
        (*h("Characters/Nobody"), "#"),
    ] {
        assert!(
            matches!(
                under(entry, path),
                Err(BinDocumentError::NodeNotFound { .. })
            ),
            "{entry:08x}:{path} reaches a node"
        );
    }
}

#[test]
fn a_prop_bin_has_no_target() {
    let rows = document().children(h(SKIN), TARGET_PATH, 0, usize::MAX, &named(), None);

    assert!(matches!(rows, Err(BinDocumentError::NodeNotFound { .. })));
}

#[test]
fn a_projected_read_answers_a_record_path() {
    let reads = patched()
        .children_each(
            h(SKIN),
            &["#2".to_owned(), TARGET_PATH.to_owned(), "#9".to_owned()],
            &named(),
            None,
        )
        .unwrap();

    assert_eq!(reads[0].total, 1);
    assert_eq!(reads[1].total, 4);
    assert_eq!(
        reads[2].total, 0,
        "a path reaching nothing answers an empty page"
    );
}

#[test]
fn a_patch_header_names_the_objects_it_deletes() {
    assert_eq!(
        patched().header(&named()),
        BinHeader {
            kind: BinFileKind::Patch,
            version: None,
            objects: 1,
            dependencies: Vec::new(),
            patches: 6,
            deleted: vec![ObjectName {
                hash: hex(h("Characters/Gone")),
                name: None,
            }],
        }
    );
}

#[test]
fn a_search_walks_the_targets_and_their_records_after_the_objects() {
    let result = patched().find(None, "aatrox", &named(), None);
    let hits: Vec<_> = result
        .hits
        .iter()
        .map(|hit| (hit.entry.as_str(), hit.path.as_str()))
        .collect();
    let skin = hex(h(SKIN));
    let added = hex(h(ADDED));
    assert_eq!(
        hits,
        [
            (added.as_str(), ""),
            (skin.as_str(), "#"),
            (added.as_str(), "#")
        ]
    );

    let nested = patched().find(None, "p1", &named(), None);
    assert_eq!(nested.hits.len(), 1);
    let hit = &nested.hits[0];
    assert_eq!(hit.path, format!("#3[1].{}", hashed("name")));
    assert_eq!(hit.label, "parts[1].name");
    assert_eq!(hit.object, "0x12345678");

    let record = patched().find(None, "skinclass", &named(), None);
    assert_eq!(record.hits[0].path, "#0");
    assert_eq!(record.hits[0].name, "skinClassification");
}

#[test]
fn an_object_search_leaves_the_records_out() {
    let result = patched().find(Some(h(ADDED)), "mvalue", &named(), None);

    assert_eq!(result.total, 0);
}
