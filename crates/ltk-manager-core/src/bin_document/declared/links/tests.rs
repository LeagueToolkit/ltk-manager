use std::io::Cursor;

use assert_matches::assert_matches;

use super::super::tests::{Game, SKIN, h, manifest, project};
use super::super::{DeclareContext, LinkChange};
use super::*;
use crate::meta_schema::{self, PatchSchema};

const CHUNK: &str = "data/characters/teemo/skins/skin0.bin";
const SHARED: &str = "DATA/Characters/Teemo/Teemo.bin";
const GLOW: &str = "DATA/Mods/jade-teemo/Glow.bin";

/// The target a declared document spells its chunk by, which the test tables do not name.
fn target() -> String {
    format!("{:016x}", ltk_game_data::path_hash(CHUNK))
}

/// The game's copy of Teemo's skin, one object depending on Teemo's shared bin.
fn declared(project: crate::workshop::ProjectDir) -> BinDocument {
    let object = ltk_meta::BinObject::builder(h(SKIN), h("SkinCharacterDataProperties")).build();
    let mut bytes = Cursor::new(Vec::new());
    Bin::new([object], [SHARED]).to_writer(&mut bytes).unwrap();
    let context = DeclareContext {
        project,
        schema: PatchSchema::new(meta_schema::shared(None), None),
        game: Game::naming(&[SKIN]),
    };
    BinDocument::declare(bytes.into_inner(), ltk_game_data::path_hash(CHUNK), context).unwrap()
}

fn listed(document: &BinDocument) -> Vec<&str> {
    document.dependencies().iter().map(String::as_str).collect()
}

fn marks(document: &BinDocument) -> Vec<(String, LinkChange)> {
    document
        .declared_state()
        .unwrap()
        .links
        .into_iter()
        .map(|mark| (mark.path, mark.change))
        .collect()
}

#[test]
fn an_addition_declares_links_and_applies() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(project(dir.path()));

    assert_eq!(document.insert_dependency(None, GLOW).unwrap(), 1);

    assert_eq!(listed(&document), [SHARED, GLOW]);
    assert_eq!(
        manifest(dir.path(), "base"),
        format!(
            "version: 1\nmodules:\n  - target: {}\n    links:\n      - {GLOW}\n",
            target()
        )
    );
    assert_eq!(marks(&document), [(GLOW.to_owned(), LinkChange::Added)]);
}

#[test]
fn a_removal_declares_minus_links_and_keeps_the_row_for_a_restore() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(project(dir.path()));

    document.remove_dependency(0).unwrap();

    assert!(listed(&document).is_empty());
    assert!(manifest(dir.path(), "base").contains(&format!("    -links:\n      - {SHARED}\n")));
    assert_eq!(marks(&document), [(SHARED.to_owned(), LinkChange::Removed)]);
    let rows: Vec<String> = document
        .dependency_rows()
        .into_iter()
        .map(|row| row.path)
        .collect();
    assert_eq!(rows, [SHARED]);

    document.restore_dependency(SHARED).unwrap();

    assert_eq!(listed(&document), [SHARED]);
    assert!(marks(&document).is_empty());
    assert_eq!(manifest(dir.path(), "base"), "version: 1\nmodules: []\n");
}

#[test]
fn a_removal_of_an_own_addition_drops_it_and_undo_puts_it_back() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(project(dir.path()));
    document.insert_dependency(None, GLOW).unwrap();
    let added = manifest(dir.path(), "base");

    document.remove_dependency(1).unwrap();

    assert_eq!(listed(&document), [SHARED]);
    assert_eq!(manifest(dir.path(), "base"), "version: 1\nmodules: []\n");

    assert!(document.undo().unwrap());
    assert_eq!(manifest(dir.path(), "base"), added);
    assert_eq!(listed(&document), [SHARED, GLOW]);

    assert!(document.redo().unwrap());
    assert_eq!(listed(&document), [SHARED]);
}

#[test]
fn a_move_a_rename_and_a_mid_list_insert_are_undeclarable() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(project(dir.path()));
    document.insert_dependency(None, GLOW).unwrap();

    for refused in [
        document.move_dependency(0, 1),
        document.set_dependency(0, "a.bin"),
        document.insert_dependency(Some(0), "a.bin").map(|_| ()),
    ] {
        assert_matches!(
            refused,
            Err(BinDocumentError::EditRejected {
                rejection: EditRejection::Undeclarable,
                ..
            })
        );
    }
    assert_eq!(listed(&document), [SHARED, GLOW]);
}
