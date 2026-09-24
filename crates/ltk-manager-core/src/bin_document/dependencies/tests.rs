//! Unit tests for dependency edits on a layer bin: add, remove, move, rename, undo, the save,
//! and typed brex.

use std::io::Cursor;

use fs_err as fs;
use ltk_hash::{BinHash, Hash as _};
use ltk_meta::{Bin, BinObject};

use super::*;

const COMMON: &str = "DATA/Characters/Teemo/Teemo.bin";
const SKINS: &str = "DATA/Characters/Teemo/Skins/Skin0.bin";

fn bytes_of(bin: &Bin) -> Vec<u8> {
    let mut out = Cursor::new(Vec::new());
    bin.to_writer(&mut out).unwrap();
    out.into_inner()
}

fn bin() -> Bin {
    let object =
        BinObject::builder(BinHash::hash_str("Object"), BinHash::hash_str("Record")).build();
    Bin::new([object], [COMMON, SKINS])
}

fn document() -> BinDocument {
    BinDocument::parse(bytes_of(&bin())).unwrap()
}

fn listed(document: &BinDocument) -> Vec<&str> {
    document.dependencies().iter().map(String::as_str).collect()
}

fn rejection(error: BinDocumentError) -> EditRejection {
    match error {
        BinDocumentError::EditRejected { rejection, .. } => rejection,
        other => panic!("expected a rejection, got {other}"),
    }
}

#[test]
fn an_insert_lands_at_its_position_or_the_end() {
    let mut document = document();

    assert_eq!(document.insert_dependency(None, "  a.bin ").unwrap(), 2);
    assert_eq!(document.insert_dependency(Some(0), "b.bin").unwrap(), 0);

    assert_eq!(listed(&document), ["b.bin", COMMON, SKINS, "a.bin"]);
    assert!(document.is_dirty());
}

#[test]
fn a_remove_a_move_and_a_rename_edit_the_list() {
    let mut document = document();
    document.insert_dependency(None, "a.bin").unwrap();

    document.move_dependency(2, 0).unwrap();
    assert_eq!(listed(&document), ["a.bin", COMMON, SKINS]);

    document.set_dependency(1, "c.bin").unwrap();
    assert_eq!(listed(&document), ["a.bin", "c.bin", SKINS]);

    document.remove_dependency(0).unwrap();
    assert_eq!(listed(&document), ["c.bin", SKINS]);
}

#[test]
fn each_edit_undoes_and_redoes() {
    let mut document = document();
    document.insert_dependency(None, "a.bin").unwrap();
    document.move_dependency(0, 1).unwrap();
    document.set_dependency(0, "c.bin").unwrap();
    document.remove_dependency(2).unwrap();
    assert_eq!(listed(&document), ["c.bin", COMMON]);

    for _ in 0..4 {
        assert!(document.undo().unwrap());
    }
    assert_eq!(listed(&document), [COMMON, SKINS]);

    for _ in 0..4 {
        assert!(document.redo().unwrap());
    }
    assert_eq!(listed(&document), ["c.bin", COMMON]);
}

#[test]
fn a_refused_edit_leaves_the_list() {
    let mut document = document();

    let cases = [
        document.insert_dependency(None, "   ").unwrap_err(),
        document
            .insert_dependency(None, &COMMON.to_ascii_lowercase())
            .unwrap_err(),
        document.insert_dependency(Some(3), "a.bin").unwrap_err(),
        document.remove_dependency(2).unwrap_err(),
        document.move_dependency(0, 2).unwrap_err(),
        document.set_dependency(0, SKINS).unwrap_err(),
    ];

    assert_eq!(
        cases.map(rejection),
        [
            EditRejection::EmptyPath,
            EditRejection::DependencyExists,
            EditRejection::NoSuchIndex,
            EditRejection::NoSuchIndex,
            EditRejection::NoSuchIndex,
            EditRejection::DependencyExists,
        ]
    );
    assert_eq!(listed(&document), [COMMON, SKINS]);
    assert!(!document.is_dirty());
}

#[test]
fn a_brex_spelling_expands_to_its_path() {
    let path = "data/aatrox_skins_root_skins_skin0_skins_skin1_skins_skin2.bin";
    let packed = brex::encode(path).unwrap();
    assert!(packed.contains(BREX_BLOCK.start), "{packed} folds nothing");
    let mut document = document();

    document.insert_dependency(None, &packed).unwrap();

    assert_eq!(listed(&document)[2], path);
    assert_eq!(
        Dependency::new(path.to_owned()).packed.as_deref(),
        Some(packed.as_str())
    );
}

#[test]
fn a_malformed_brex_spelling_is_refused() {
    for typed in [
        "DATA/❮Skin{0",
        "DATA/Skin❯.bin",
        "data/aatrox❮_skins{_skin{0→9999999999}}❯.bin",
        "data/aatrox❮_skins{_skin{0→4000000}}❯.bin",
        "data/aatrox❮_skins{_skin{²}}❯.bin",
    ] {
        assert_eq!(
            dependency_path(typed),
            Err(EditRejection::MalformedBrex),
            "{typed}"
        );
    }
}

#[test]
fn a_save_writes_the_list_and_every_object() {
    let base = bytes_of(&bin());
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("skin0.bin");
    fs::write(&path, &base).unwrap();
    let mut document = BinDocument::parse(base).unwrap();

    document.remove_dependency(0).unwrap();
    document.insert_dependency(None, "a.bin").unwrap();
    document.save_to(&path).unwrap();

    assert!(!document.is_dirty());
    let reread = BinDocument::parse(fs::read(&path).unwrap()).unwrap();
    assert_eq!(listed(&reread), [SKINS, "a.bin"]);
    assert!(reread.object_at(BinHash::hash_str("Object")).is_some());
}
