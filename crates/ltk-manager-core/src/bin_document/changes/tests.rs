use std::io::Cursor;

use indexmap::IndexMap;
use ltk_hash::Hash as _;
use ltk_meta::Bin;
use ltk_meta::property::{Kind, values};

use super::*;
use crate::bin_document::LeafValue;

const SYSTEM: &str = "Characters/Aatrox/Skins/Skin0/Particles/Glow";

fn h(text: &str) -> BinHash {
    BinHash::hash_str(text)
}

fn hashed(hash: BinHash) -> String {
    format!("{:08x}", hash.0)
}

fn emitter(rate: f32) -> PropertyValueEnum {
    values::Struct {
        class_hash: h("VfxEmitterDefinitionData"),
        properties: IndexMap::from([(h("rate"), values::F32::new(rate).into())]),
    }
    .into()
}

/// A system with two emitters and a name.
fn document() -> BinDocument {
    let emitters = values::Container::new(Kind::Struct, vec![emitter(1.0), emitter(2.0)]).unwrap();
    let object = BinObject::builder(h(SYSTEM), h("VfxSystemDefinitionData"))
        .property(h("emitters"), emitters)
        .property(h("name"), values::String::new("glow".to_owned()))
        .build();
    let mut out = Cursor::new(Vec::new());
    Bin::new([object], std::iter::empty::<&str>())
        .to_writer(&mut out)
        .unwrap();
    BinDocument::parse(out.into_inner()).unwrap()
}

fn second_rate() -> String {
    format!("{}[1].{}", hashed(h("emitters")), hashed(h("rate")))
}

#[test]
fn an_edit_inside_a_list_of_structs_marks_that_field_alone() {
    let mut document = document();
    document
        .set_leaf(h(SYSTEM), &second_rate(), LeafValue::Float { value: 5.0 })
        .unwrap();
    document
        .remove_property(h(SYSTEM), &hashed(h("name")))
        .unwrap();

    let changes = document.changes_from(&document.opened_objects().unwrap());

    assert_eq!(
        changes,
        [
            BinChange {
                entry: hex(h(SYSTEM)),
                path: second_rate(),
                kind: ChangeKind::Changed,
            },
            BinChange {
                entry: hex(h(SYSTEM)),
                path: hashed(h("name")),
                kind: ChangeKind::Removed,
            },
        ]
    );
}

#[test]
fn a_revert_writes_the_baseline_back_as_one_undo() {
    let mut document = document();
    let opened = document.opened_objects().unwrap();
    document
        .set_leaf(h(SYSTEM), &second_rate(), LeafValue::Float { value: 5.0 })
        .unwrap();
    document
        .remove_property(h(SYSTEM), &hashed(h("name")))
        .unwrap();

    document
        .revert_property(h(SYSTEM), &second_rate(), opened.get(&h(SYSTEM)))
        .unwrap();
    document
        .revert_property(h(SYSTEM), &hashed(h("name")), opened.get(&h(SYSTEM)))
        .unwrap();
    assert!(document.changes_from(&opened).is_empty());

    assert!(document.undo().unwrap());
    assert_eq!(document.changes_from(&opened).len(), 1);
}

#[test]
fn an_object_the_baseline_lacks_is_added() {
    let document = document();

    assert_eq!(
        document.changes_from(&Originals::new()),
        [BinChange {
            entry: hex(h(SYSTEM)),
            path: String::new(),
            kind: ChangeKind::Added,
        }]
    );
}
