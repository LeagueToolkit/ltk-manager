//! Unit tests for a leaf edit and the delta save: every kind a patch sets, the refusals,
//! latest-format output, untouched object bytes, and the store's gate.

use std::num::NonZeroUsize;

use super::*;
use crate::bin_document::{BinDocuments, wire_key};
use crate::error::AppError;
use ltk_meta::Bin;
use ltk_meta::property::PropertyValueEnum;

fn h(text: &str) -> BinHash {
    BinHash::hash_str(text)
}

fn field(name: &str) -> String {
    format!("{:08x}", h(name))
}

const EDITED: &str = "Characters/Aatrox/Edited";
const UNTOUCHED: &str = "Characters/Aatrox/Untouched";

fn embedded(properties: Vec<(BinHash, PropertyValueEnum)>) -> values::Embedded {
    values::Embedded(values::Struct {
        class_hash: h("Inner"),
        properties: properties.into_iter().collect(),
    })
}

/// One object with a property of every leaf kind and one of every container, and one
/// object no test edits.
fn bin() -> Bin {
    let items = values::Container::new(
        Kind::F32,
        vec![values::F32::new(1.0).into(), values::F32::new(2.0).into()],
    )
    .unwrap();
    let maybe = values::Optional::new(Kind::F32, Some(values::F32::new(3.0).into())).unwrap();
    let absent = values::Optional::new(Kind::F32, None).unwrap();
    let map = values::Map::new(
        Kind::Hash,
        Kind::U32,
        vec![(
            values::Hash::new(h("key")).into(),
            values::U32::new(4).into(),
        )],
    )
    .unwrap();

    let edited = BinObject::builder(h(EDITED), h("Record"))
        .property(h("visible"), values::Bool::new(true))
        .property(h("flag"), values::BitBool::new(false))
        .property(h("count"), values::U8::new(7))
        .property(h("big"), values::U64::new(u64::MAX))
        .property(h("scale"), values::F32::new(1.5))
        .property(h("offset"), values::Vector3::new(Vec3::new(1.0, 2.0, 3.0)))
        .property(h("transform"), values::Matrix44::new(Mat4::IDENTITY))
        .property(h("tint"), tint())
        .property(h("label"), values::String::new("before".to_owned()))
        .property(h("material"), values::Hash::new(h("Mat")))
        .property(h("target"), values::ObjectLink::new(h(UNTOUCHED)))
        .property(
            h("texture"),
            values::WadChunkLink::new(WadHash::hash_str("a.tex")),
        )
        .property(h("items"), items)
        .property(h("maybe"), maybe)
        .property(h("absent"), absent)
        .property(h("map"), map)
        .property(
            h("inner"),
            embedded(vec![(h("depth"), values::F32::new(9.0).into())]),
        )
        .build();
    let untouched = BinObject::builder(h(UNTOUCHED), h("Record"))
        .property(h("scale"), values::F32::new(0.25))
        .build();
    Bin::new([edited, untouched], ["common.bin"])
}

/// An opaque orange, set field by field on the value a `Color` leaf holds.
fn tint() -> values::Color {
    let mut tint = values::Color::default();
    tint.value.r = 255;
    tint.value.g = 128;
    tint.value.a = 255;
    tint
}

fn bytes_of(bin: &Bin) -> Vec<u8> {
    let mut out = Cursor::new(Vec::new());
    bin.to_writer(&mut out).unwrap();
    out.into_inner()
}

/// `bytes`, a version-3 file, with the header naming `version`. Version 2 reads the same.
fn at_version(mut bytes: Vec<u8>, version: u32) -> Vec<u8> {
    bytes[4..8].copy_from_slice(&version.to_le_bytes());
    bytes
}

fn document() -> BinDocument {
    BinDocument::parse(bytes_of(&bin())).unwrap()
}

fn edited() -> BinHash {
    h(EDITED)
}

/// The raw bytes of `object` in `bytes`, out of the TOC.
fn object_bytes(bytes: &[u8], object: BinHash) -> Vec<u8> {
    let mut stream = BinStream::<_>::mount(Cursor::new(bytes)).unwrap();
    let range = stream.toc().unwrap().entry(object).unwrap().byte_range();
    bytes[usize::try_from(range.start).unwrap()..usize::try_from(range.end).unwrap()].to_vec()
}

/// A layer file holding `bytes`, and the directory that keeps it alive.
fn layer_file(bytes: &[u8]) -> (tempfile::TempDir, std::path::PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("skin0.bin");
    fs::write(&path, bytes).unwrap();
    (dir, path)
}

fn set_twice(document: &mut BinDocument, path: &str, value: LeafValue) -> LeafValue {
    let held = document.set_leaf(edited(), path, value.clone()).unwrap();
    let back = document.set_leaf(edited(), path, held.clone()).unwrap();
    assert_eq!(
        back, value,
        "the second set answers what the first wrote at {path}"
    );
    held
}

#[test]
fn every_leaf_kind_takes_a_value_of_its_kind() {
    let mut document = document();
    let cases = [
        (field("visible"), LeafValue::Bool { value: false }),
        (field("flag"), LeafValue::Bool { value: true }),
        (
            field("count"),
            LeafValue::Integer {
                text: "200".to_owned(),
            },
        ),
        (
            field("big"),
            LeafValue::Integer {
                text: "1".to_owned(),
            },
        ),
        (field("scale"), LeafValue::Float { value: -2.0 }),
        (
            field("offset"),
            LeafValue::Vector {
                values: vec![4.0, 5.0, 6.0],
            },
        ),
        (
            field("transform"),
            LeafValue::Matrix {
                values: (0..16).map(|cell| cell as f32).collect(),
            },
        ),
        (
            field("tint"),
            LeafValue::Color {
                r: 1,
                g: 2,
                b: 3,
                a: 4,
            },
        ),
        (
            field("label"),
            LeafValue::String {
                value: "after".to_owned(),
            },
        ),
        (
            field("material"),
            LeafValue::Hash {
                text: "0x0000002a".to_owned(),
            },
        ),
        (
            field("target"),
            LeafValue::ObjectLink {
                text: "0x0000002b".to_owned(),
            },
        ),
        (
            field("texture"),
            LeafValue::WadChunkLink {
                text: "000000000000002c".to_owned(),
            },
        ),
        (
            format!("{}[1]", field("items")),
            LeafValue::Float { value: 8.0 },
        ),
        (field("maybe"), LeafValue::Float { value: 8.0 }),
        (
            format!(
                "{}{{{}}}",
                field("map"),
                wire_key(&values::Hash::new(h("key")).into())
            ),
            LeafValue::Integer {
                text: "5".to_owned(),
            },
        ),
        (
            format!("{}.{}", field("inner"), field("depth")),
            LeafValue::Float { value: 8.0 },
        ),
    ];

    for (path, value) in cases {
        set_twice(&mut document, &path, value);
    }
    assert!(document.is_dirty());
}

#[test]
fn a_leaf_answers_the_value_it_held() {
    let mut document = document();
    assert_eq!(
        set_twice(
            &mut document,
            &field("big"),
            LeafValue::Integer {
                text: "1".to_owned()
            }
        ),
        LeafValue::Integer {
            text: u64::MAX.to_string()
        }
    );
    assert_eq!(
        set_twice(
            &mut document,
            &field("transform"),
            LeafValue::Matrix {
                values: vec![0.0; 16]
            }
        ),
        LeafValue::Matrix {
            values: Mat4::IDENTITY.to_cols_array().to_vec()
        }
    );
    assert_eq!(
        set_twice(
            &mut document,
            &field("target"),
            LeafValue::ObjectLink {
                text: "0x00000001".to_owned()
            }
        ),
        LeafValue::ObjectLink {
            text: hex(h(UNTOUCHED))
        }
    );
}

#[test]
fn a_hash_takes_a_name_or_its_hex() {
    let mut document = document();
    let path = field("material");
    let set = |document: &mut BinDocument, text: &str| {
        document
            .set_leaf(
                edited(),
                &path,
                LeafValue::Hash {
                    text: text.to_owned(),
                },
            )
            .unwrap()
    };

    set(&mut document, "Aatrox_Mat");
    assert_eq!(
        set(&mut document, "0x0000002a"),
        LeafValue::Hash {
            text: hex(h("Aatrox_Mat"))
        }
    );
    assert_eq!(
        set(&mut document, "deadbeef"),
        LeafValue::Hash {
            text: "0x0000002a".to_owned()
        }
    );
    assert_eq!(
        set(&mut document, "0x00000000"),
        LeafValue::Hash {
            text: hex(h("deadbeef"))
        },
        "eight bare hex digits are a name, and only `0x` reads as hex"
    );
}

#[test]
fn a_value_that_does_not_fit_is_refused_and_leaves_the_tree() {
    let mut document = document();
    let refused = |document: &mut BinDocument, path: String, value: LeafValue| match document
        .set_leaf(edited(), &path, value)
    {
        Err(BinDocumentError::EditRejected { rejection, .. }) => rejection,
        other => panic!("expected a refusal at {path}, got {other:?}"),
    };

    assert_eq!(
        refused(
            &mut document,
            field("scale"),
            LeafValue::Integer {
                text: "1".to_owned()
            }
        ),
        EditRejection::WrongKind {
            kind: PropertyKind::F32
        }
    );
    assert_eq!(
        refused(
            &mut document,
            field("count"),
            LeafValue::Integer {
                text: "300".to_owned()
            }
        ),
        EditRejection::OutOfRange {
            kind: PropertyKind::U8
        }
    );
    assert_eq!(
        refused(
            &mut document,
            field("count"),
            LeafValue::Integer {
                text: "ten".to_owned()
            }
        ),
        EditRejection::OutOfRange {
            kind: PropertyKind::U8
        }
    );
    assert_eq!(
        refused(
            &mut document,
            field("scale"),
            LeafValue::Float { value: f32::NAN }
        ),
        EditRejection::NotFinite
    );
    assert_eq!(
        refused(
            &mut document,
            field("offset"),
            LeafValue::Vector {
                values: vec![1.0, 2.0]
            }
        ),
        EditRejection::WrongLength { expected: 3 }
    );
    assert_eq!(
        refused(
            &mut document,
            field("material"),
            LeafValue::Hash {
                text: "0x2a".to_owned()
            }
        ),
        EditRejection::MalformedHash
    );
    assert_eq!(
        refused(
            &mut document,
            field("texture"),
            LeafValue::WadChunkLink {
                text: "  ".to_owned()
            }
        ),
        EditRejection::MalformedHash
    );
    assert_eq!(
        refused(
            &mut document,
            field("items"),
            LeafValue::Float { value: 1.0 }
        ),
        EditRejection::NotALeaf
    );
    assert_eq!(
        refused(
            &mut document,
            field("absent"),
            LeafValue::Float { value: 1.0 }
        ),
        EditRejection::NotALeaf
    );
    assert_eq!(
        refused(
            &mut document,
            field("inner"),
            LeafValue::Float { value: 1.0 }
        ),
        EditRejection::NotALeaf
    );

    assert!(matches!(
        document.set_leaf(edited(), &field("nothing"), LeafValue::Float { value: 1.0 }),
        Err(BinDocumentError::NodeNotFound { .. })
    ));
    assert!(matches!(
        document.set_leaf(edited(), "", LeafValue::Float { value: 1.0 }),
        Err(BinDocumentError::NodeNotFound { .. })
    ));
    assert!(!document.is_dirty(), "a refused edit touches nothing");
}

#[test]
fn a_save_writes_version_three_and_keeps_every_untouched_object() {
    let base = at_version(bytes_of(&bin()), 2);
    let (_dir, path) = layer_file(&base);
    let mut document = BinDocument::parse(base.clone()).unwrap();

    document
        .set_leaf(edited(), &field("scale"), LeafValue::Float { value: 4.0 })
        .unwrap();
    document.save_to(&path).unwrap();

    let written = fs::read(&path).unwrap();
    assert_eq!(
        &written[4..8],
        &3u32.to_le_bytes(),
        "saves use the latest format"
    );
    assert_eq!(
        object_bytes(&written, h(UNTOUCHED)),
        object_bytes(&base, h(UNTOUCHED))
    );
    assert!(!document.is_dirty());

    let reread = BinDocument::parse(written).unwrap();
    let scale = &reread.object_at(edited()).unwrap().properties[&h("scale")];
    assert_eq!(scale, &values::F32::new(4.0).into());
}

#[test]
fn a_second_save_writes_over_the_first() {
    let (_dir, path) = layer_file(&bytes_of(&bin()));
    let mut document = document();

    for value in [4.0, 5.0] {
        document
            .set_leaf(edited(), &field("scale"), LeafValue::Float { value })
            .unwrap();
        document.save_to(&path).unwrap();
    }

    let reread = BinDocument::parse(fs::read(&path).unwrap()).unwrap();
    let scale = &reread.object_at(edited()).unwrap().properties[&h("scale")];
    assert_eq!(scale, &values::F32::new(5.0).into());
}

#[test]
fn a_version_one_save_writes_version_three() {
    let source = Bin::new(
        [BinObject::builder(edited(), h("Record"))
            .property(h("scale"), values::F32::new(1.5))
            .build()],
        std::iter::empty::<&str>(),
    );
    let mut base = at_version(bytes_of(&source), 1);
    base.drain(8..12);
    let (_dir, path) = layer_file(&base);
    let mut document = BinDocument::parse(base).unwrap();
    document
        .set_leaf(edited(), &field("scale"), LeafValue::Float { value: 4.0 })
        .unwrap();
    document.save_to(&path).unwrap();

    let written = fs::read(&path).unwrap();
    assert_eq!(&written[4..8], &3u32.to_le_bytes());
    let reread = BinDocument::parse(written).unwrap();
    assert_eq!(
        reread.object_at(edited()).unwrap().properties[&h("scale")],
        values::F32::new(4.0).into()
    );
    assert!(!document.is_dirty());
}

#[test]
fn an_untouched_legacy_object_refuses_save_and_keeps_edits() {
    let base = legacy_numbered_bytes_in(h(UNTOUCHED));
    let (_dir, path) = layer_file(&base);
    let mut document = BinDocument::parse(base.clone()).unwrap();
    document
        .set_leaf(edited(), &field("scale"), LeafValue::Float { value: 4.0 })
        .unwrap();
    let error = document.save_to(&path).unwrap_err();
    assert!(
        matches!(
            error,
            AppError::BinDocument(BinDocumentError::Unwritable(_))
        ),
        "{error}"
    );
    assert_eq!(fs::read(&path).unwrap(), base);
    assert!(document.is_dirty());
    assert_eq!(
        document.object_at(edited()).unwrap().properties[&h("scale")],
        values::F32::new(4.0).into()
    );
}

#[test]
fn a_file_changed_on_disk_refuses_the_save() {
    let (_dir, path) = layer_file(&bytes_of(&bin()));
    let mut document = document();
    document
        .set_leaf(edited(), &field("scale"), LeafValue::Float { value: 4.0 })
        .unwrap();

    let elsewhere = bytes_of(&Bin::new(
        [BinObject::new(h("Other"), h("Record"))],
        std::iter::empty::<&str>(),
    ));
    fs::write(&path, &elsewhere).unwrap();

    let error = document.save_to(&path).unwrap_err();
    assert!(
        matches!(
            error,
            AppError::BinDocument(BinDocumentError::ChangedOnDisk)
        ),
        "{error}"
    );
    assert_eq!(fs::read(&path).unwrap(), elsewhere, "nothing is written");
    assert!(document.is_dirty(), "the edits stay in the tree");
}

#[test]
fn a_clean_document_writes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("never.bin");
    document().save_to(&path).unwrap();
    assert!(!path.exists());
}

/// A bin whose second property is a null pointer written with the legacy kind byte for
/// `Struct`, beside a float a test edits.
fn legacy_numbered_bytes_in(pointer_entry: BinHash) -> Vec<u8> {
    let mut objects: Vec<_> = [edited(), h(UNTOUCHED)]
        .into_iter()
        .map(|entry| {
            BinObject::builder(entry, h("Record"))
                .property(h("scale"), values::F32::new(1.5))
                .build()
        })
        .collect();
    objects
        .iter_mut()
        .find(|object| object.path_hash == pointer_entry)
        .unwrap()
        .properties
        .insert(BinHash(0x7777_0001), values::Struct::default().into());
    let mut bytes = bytes_of(&Bin::new(objects, std::iter::empty::<&str>()));

    let modern: u8 = ltk_meta::property::Kind::Struct.into();
    let marker = 0x7777_0001u32.to_le_bytes();
    let field_at = bytes
        .windows(4)
        .position(|window| window == marker)
        .expect("the null pointer's field hash is in the file");
    assert_eq!(bytes[field_at + 4], modern);
    bytes[field_at + 4] = 19;
    bytes
}

#[test]
fn a_legacy_numbered_base_refuses_save_and_keeps_edits() {
    let base = legacy_numbered_bytes_in(edited());
    let (_dir, path) = layer_file(&base);
    let mut document = BinDocument::parse(base.clone()).unwrap();

    document
        .set_leaf(edited(), &field("scale"), LeafValue::Float { value: 4.0 })
        .unwrap();
    let error = document.save_to(&path).unwrap_err();
    assert!(
        matches!(
            error,
            AppError::BinDocument(BinDocumentError::Unwritable(_))
        ),
        "{error}"
    );
    assert_eq!(fs::read(&path).unwrap(), base);
    assert!(document.is_dirty());
    assert_eq!(
        document.object_at(edited()).unwrap().properties[&h("scale")],
        values::F32::new(4.0).into()
    );
}

#[test]
fn only_a_prop_of_a_layer_takes_edits() {
    let layer = AssetRef::Layer {
        project: "p".to_owned(),
        layer: "base".to_owned(),
        path: "a.bin".to_owned(),
    };
    let chunk = AssetRef::GameChunk {
        wad: "Champions/Aatrox.wad.client".to_owned(),
        path_hash: "0000000000000001".to_owned(),
        project: None,
    };
    let loose = AssetRef::File {
        path: "a.bin".to_owned(),
    };

    let prop = document();
    assert_eq!(prop.read_only(&layer), None);
    assert_eq!(prop.read_only(&chunk), Some(ReadOnly::Install));
    assert_eq!(prop.read_only(&loose), Some(ReadOnly::Loose));

    let mut out = Cursor::new(Vec::new());
    ltk_meta::BinOverride::builder()
        .build()
        .to_writer(&mut out)
        .unwrap();
    let patch = BinDocument::parse(out.into_inner()).unwrap();
    assert_eq!(patch.read_only(&layer), Some(ReadOnly::Patch));
}

#[test]
fn the_store_refuses_a_patch_behind_a_gate_and_shares_one_across_ids() {
    let store = BinDocuments::new(NonZeroUsize::new(2).unwrap());
    let loose = AssetRef::File {
        path: "a.bin".to_owned(),
    };
    let id = store.open(loose, || Ok(bytes_of(&bin()))).unwrap();
    assert!(matches!(
        store.patch(
            id,
            edited(),
            &field("scale"),
            LeafValue::Float { value: 4.0 }
        ),
        Err(BinDocumentError::ReadOnly(ReadOnly::Loose))
    ));
    assert_eq!(store.read_only(id).unwrap(), Some(ReadOnly::Loose));
    assert!(matches!(
        store.save(id),
        Err(AppError::BinDocument(BinDocumentError::ReadOnly(
            ReadOnly::Loose
        )))
    ));

    let dir = tempfile::tempdir().unwrap();
    fs::create_dir_all(dir.path().join("content/base")).unwrap();
    fs::write(dir.path().join("content/base/a.bin"), bytes_of(&bin())).unwrap();
    let layer = AssetRef::Layer {
        project: dir.path().to_string_lossy().into_owned(),
        layer: "base".to_owned(),
        path: "a.bin".to_owned(),
    };
    let read = || layer.read(&crate::config::Config::default(), &Default::default());
    let file_tab = store.open(layer.clone(), read).unwrap();
    let object_tab = store.open(layer.clone(), read).unwrap();

    store
        .patch(
            file_tab,
            edited(),
            &field("scale"),
            LeafValue::Float { value: 4.0 },
        )
        .unwrap();
    let seen = store
        .read(object_tab, |open| {
            Ok(open.object_at(edited()).unwrap().properties[&h("scale")].clone())
        })
        .unwrap();
    assert_eq!(seen, values::F32::new(4.0).into());

    store.save(object_tab).unwrap();
    let reread =
        BinDocument::parse(fs::read(dir.path().join("content/base/a.bin")).unwrap()).unwrap();
    assert_eq!(
        reread.object_at(edited()).unwrap().properties[&h("scale")],
        values::F32::new(4.0).into()
    );
}

fn scale_of(document: &BinDocument) -> PropertyValueEnum {
    document.object_at(edited()).unwrap().properties[&h("scale")].clone()
}

fn float(value: f32) -> LeafValue {
    LeafValue::Float { value }
}

#[test]
fn an_undo_reverts_and_a_redo_applies_again() {
    let mut document = document();
    document
        .set_leaf(edited(), &field("scale"), float(2.0))
        .unwrap();
    document
        .set_leaf(edited(), &field("scale"), float(3.0))
        .unwrap();

    assert!(document.undo().unwrap());
    assert_eq!(scale_of(&document), values::F32::new(2.0).into());
    assert!(document.undo().unwrap());
    assert_eq!(scale_of(&document), values::F32::new(1.5).into());
    assert!(!document.undo().unwrap(), "an empty stack undoes nothing");

    assert!(document.redo().unwrap());
    assert_eq!(scale_of(&document), values::F32::new(2.0).into());

    document
        .set_leaf(edited(), &field("scale"), float(9.0))
        .unwrap();
    assert!(!document.redo().unwrap(), "an edit empties the redo stack");
    assert!(document.is_dirty(), "an undo is an edit the save writes");
}

#[test]
fn the_undo_stack_keeps_the_latest_edits() {
    let mut document = document();
    for step in 0..=UNDO_DEPTH {
        document
            .set_leaf(edited(), &field("scale"), float(step as f32))
            .unwrap();
    }

    let mut undone = 0;
    while document.undo().unwrap() {
        undone += 1;
    }
    assert_eq!(undone, UNDO_DEPTH);
    assert_eq!(scale_of(&document), values::F32::new(0.0).into());
}

/// A layer asset over `dir`, holding the fixture at `name`.
fn layer_asset(dir: &Path, name: &str) -> AssetRef {
    fs::create_dir_all(dir.join("content/base")).unwrap();
    fs::write(dir.join("content/base").join(name), bytes_of(&bin())).unwrap();
    AssetRef::Layer {
        project: dir.to_string_lossy().into_owned(),
        layer: "base".to_owned(),
        path: name.to_owned(),
    }
}

fn read_layer(asset: &AssetRef) -> AppResult<Vec<u8>> {
    asset.read(&crate::config::Config::default(), &Default::default())
}

#[test]
fn a_full_store_evicts_a_clean_tree_and_grows_past_a_dirty_one() {
    let dir = tempfile::tempdir().unwrap();
    let store = BinDocuments::new(NonZeroUsize::new(2).unwrap());
    let first = layer_asset(dir.path(), "a.bin");
    let second = layer_asset(dir.path(), "b.bin");
    let third = layer_asset(dir.path(), "c.bin");

    let a = store.open(first.clone(), || read_layer(&first)).unwrap();
    let b = store.open(second.clone(), || read_layer(&second)).unwrap();
    store
        .patch(a, edited(), &field("scale"), float(4.0))
        .unwrap();
    store.read(a, |_| Ok(())).unwrap();

    let c = store.open(third.clone(), || read_layer(&third)).unwrap();
    assert!(
        store.is_open(a),
        "the dirty tree stays, though it was used before the clean one"
    );
    assert!(!store.is_open(b), "the clean tree leaves");
    assert!(store.is_open(c));

    store
        .patch(c, edited(), &field("scale"), float(4.0))
        .unwrap();
    let fourth = layer_asset(dir.path(), "d.bin");
    let d = store.open(fourth.clone(), || read_layer(&fourth)).unwrap();
    assert!(
        store.is_open(a) && store.is_open(c) && store.is_open(d),
        "a store of dirty trees grows rather than drop one"
    );
}

#[test]
fn a_reload_reads_the_file_again_and_drops_the_edits() {
    let dir = tempfile::tempdir().unwrap();
    let store = BinDocuments::default();
    let asset = layer_asset(dir.path(), "a.bin");
    let id = store.open(asset.clone(), || read_layer(&asset)).unwrap();
    store
        .patch(id, edited(), &field("scale"), float(4.0))
        .unwrap();

    store.reload(id, read_layer).unwrap();

    store
        .read(id, |open| {
            assert!(!open.is_dirty());
            assert_eq!(scale_of(open), values::F32::new(1.5).into());
            Ok(())
        })
        .unwrap();
    assert!(!store.undo(id).unwrap(), "a reload drops the undo stack");
}

#[test]
fn closing_every_id_keeps_a_tree_with_unsaved_edits_for_the_next_open() {
    let store = BinDocuments::default();
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir_all(dir.path().join("content/base")).unwrap();
    fs::write(dir.path().join("content/base/a.bin"), bytes_of(&bin())).unwrap();
    let layer = AssetRef::Layer {
        project: dir.path().to_string_lossy().into_owned(),
        layer: "base".to_owned(),
        path: "a.bin".to_owned(),
    };
    let read = || layer.read(&crate::config::Config::default(), &Default::default());
    let edited_tab = store.open(layer.clone(), read).unwrap();
    store
        .patch(edited_tab, edited(), &field("scale"), float(4.0))
        .unwrap();
    let loose = AssetRef::File {
        path: "b.bin".to_owned(),
    };
    let clean_tab = store.open(loose.clone(), || Ok(bytes_of(&bin()))).unwrap();

    store.close_all();

    assert!(!store.is_open(edited_tab));
    assert!(!store.is_open(clean_tab));
    let reopened = store
        .open(layer, || panic!("the edited tree was parsed again"))
        .unwrap();
    let seen = store.read(reopened, |open| Ok(scale_of(open))).unwrap();
    assert_eq!(seen, values::F32::new(4.0).into());
    let parses = std::cell::Cell::new(0);
    store
        .open(loose, || {
            parses.set(parses.get() + 1);
            Ok(bytes_of(&bin()))
        })
        .unwrap();
    assert_eq!(parses.get(), 1, "the clean tree left the store");
}
