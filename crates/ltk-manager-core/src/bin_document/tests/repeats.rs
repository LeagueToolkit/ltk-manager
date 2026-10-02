//! A map the file writes with one key twice: each entry its own row, path and edits.

use super::*;

const LOOKUP: &str = "Characters/Smolder/Animations/Charizard";

/// A map of three entries, the first and the last under one key.
fn repeating() -> BinDocument {
    let map = values::Map::new(
        Kind::Hash,
        Kind::String,
        vec![
            (
                values::Hash::new(h("Run")).into(),
                values::String::from("first").into(),
            ),
            (
                values::Hash::new(h("Idle")).into(),
                values::String::from("idle").into(),
            ),
            (
                values::Hash::new(h("Run")).into(),
                values::String::from("second").into(),
            ),
        ],
    )
    .unwrap();
    let bin = Bin::builder()
        .object(
            BinObject::builder(h(LOOKUP), h("AnimationGraphData"))
                .property(h("clips"), map)
                .build(),
        )
        .build();
    let mut out = Cursor::new(Vec::new());
    bin.to_writer(&mut out).unwrap();
    BinDocument::parse(out.into_inner()).unwrap()
}

fn run() -> String {
    format!("{}{{{:08x}}}", hashed("clips"), h("Run"))
}

fn rows(document: &BinDocument) -> Vec<BinRow> {
    document
        .children(h(LOOKUP), &hashed("clips"), 0, usize::MAX, &named(), None)
        .unwrap()
        .rows
}

fn string_at(document: &BinDocument, path: &str) -> String {
    let parent = &path[..path.rfind('{').unwrap()];
    let rows = document
        .children(h(LOOKUP), parent, 0, usize::MAX, &named(), None)
        .unwrap()
        .rows;
    let row = rows.iter().find(|row| row.path == path).unwrap();
    let BinValue::String { value } = &row.value else {
        panic!("{path} holds no string");
    };
    value.clone()
}

#[test]
fn a_repeated_key_gives_each_entry_a_path_of_its_own() {
    let rows = rows(&repeating());
    let paths: Vec<&str> = rows.iter().map(|row| row.path.as_str()).collect();

    assert_eq!(
        paths,
        [
            run(),
            format!("{}{{{:08x}}}", hashed("clips"), h("Idle")),
            format!("{}#1", run()),
        ]
    );
    assert_eq!(
        rows[2].label,
        format!("{}{{{}}}#1", hex(h("clips")), hex(h("Run"))),
        "no table names the fixture, so both halves read as hex"
    );
    assert_eq!(
        rows[2].value,
        BinValue::String {
            value: "second".to_owned()
        },
        "the repeat reads its own value, not the first entry's"
    );
}

#[test]
fn an_edit_of_a_repeat_changes_that_entry_and_no_other() {
    let mut document = repeating();
    let repeat = format!("{}#1", run());

    document
        .set_leaf(
            h(LOOKUP),
            &repeat,
            LeafValue::String {
                value: "changed".to_owned(),
            },
        )
        .unwrap();

    assert_eq!(string_at(&document, &repeat), "changed");
    assert_eq!(string_at(&document, &run()), "first");
}

#[test]
fn removing_a_repeat_takes_it_out_and_an_undo_puts_it_back_as_the_repeat() {
    let mut document = repeating();
    let repeat = format!("{}#1", run());

    document.remove_item(h(LOOKUP), &repeat).unwrap();
    assert_eq!(rows(&document).len(), 2);
    assert_eq!(string_at(&document, &run()), "first");

    assert!(document.undo().unwrap());
    assert_eq!(string_at(&document, &repeat), "second");
}

#[test]
fn a_repeat_rekeyed_to_a_new_key_leaves_the_repeat_behind_and_an_undo_restores_it() {
    let mut document = repeating();
    let repeat = format!("{}#1", run());

    let landed = document.set_key(h(LOOKUP), &repeat, "Walk").unwrap();
    assert_eq!(landed, format!("{}{{{:08x}}}", hashed("clips"), h("Walk")));
    assert_eq!(string_at(&document, &landed), "second");

    assert!(document.undo().unwrap());
    assert_eq!(string_at(&document, &repeat), "second");
}

#[test]
fn a_key_another_entry_holds_is_still_refused_to_a_reader() {
    let mut document = repeating();
    let idle = format!("{}{{{:08x}}}", hashed("clips"), h("Idle"));

    let error = document.set_key(h(LOOKUP), &idle, "Run").unwrap_err();
    assert!(matches!(
        error,
        BinDocumentError::EditRejected {
            rejection: EditRejection::KeyExists,
            ..
        }
    ));
}
