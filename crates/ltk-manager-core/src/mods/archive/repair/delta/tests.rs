//! The mapping from a repaired project file to what it addresses in the archive
//! it came out of, over the three shapes a lossless unpack names a chunk with.

use super::*;
use ltk_hash::Hash as _;

fn chunk(layer: &str, path: &str) -> (String, WadHash) {
    match DeltaTarget::of(layer, path) {
        Some(DeltaTarget::Chunk { wad, hash }) => (wad, hash),
        other => panic!("expected a chunk for {layer}/{path}, got {other:?}"),
    }
}

fn entry(layer: &str, path: &str) -> String {
    match DeltaTarget::of(layer, path) {
        Some(DeltaTarget::Entry { path }) => path,
        other => panic!("expected an entry for {layer}/{path}, got {other:?}"),
    }
}

#[test]
fn a_file_of_a_wad_directory_is_a_chunk_keyed_by_its_path() {
    assert_eq!(
        chunk("base", "Aatrox.wad.client/data/skin0.bin"),
        (
            "Aatrox.wad.client".to_owned(),
            WadHash::hash_str("data/skin0.bin")
        )
    );
}

/// A chunk nothing named comes out under sixteen hex digits and no extension,
/// which reads back as itself rather than as a path to hash.
#[test]
fn a_nameless_chunk_keeps_the_hash_it_was_written_under() {
    assert_eq!(
        chunk("base", "Aatrox.wad.client/0123456789abcdef").1,
        WadHash(0x0123456789abcdef)
    );
}

/// A path two chunks claim gains a `.ltk` suffix, which comes off again.
#[test]
fn a_collided_path_addresses_the_chunk_it_was_renamed_from() {
    assert_eq!(
        chunk("base", "Aatrox.wad.client/data/skin0.bin.ltk").1,
        chunk("base", "Aatrox.wad.client/data/skin0.bin").1
    );
}

#[test]
fn a_wad_directory_is_recognised_in_any_casing() {
    assert_eq!(
        chunk("base", "Aatrox.WAD.Client/data/skin0.bin"),
        (
            "Aatrox.WAD.Client".to_owned(),
            WadHash::hash_str("data/skin0.bin")
        )
    );
}

#[test]
fn a_raw_file_is_the_entry_it_was_unpacked_from() {
    assert_eq!(entry("base", "raw/config.ini"), "RAW/config.ini");
}

#[test]
fn a_loose_file_of_the_base_layer_is_a_wad_entry() {
    assert_eq!(entry("base", "notes.txt"), "WAD/notes.txt");
    assert_eq!(
        entry("base", "Aatrox.wad/data/skin0.bin"),
        "WAD/Aatrox.wad/data/skin0.bin"
    );
}

/// Fantome stores the base layer alone, so another layer's file has nowhere to
/// land and the repack is what answers for it.
#[test]
fn a_layer_the_archive_has_no_place_for_maps_nowhere() {
    assert_eq!(DeltaTarget::of("high-res", "X.wad.client/f.bin"), None);
}

#[test]
fn a_declared_table_keeps_its_name_under_the_archives_hashes() {
    assert_eq!(
        archive_table_path("hashes/game.hashes.txt").as_deref(),
        Some("META/hashes/game.hashes.txt")
    );
}

/// A table declared anywhere but flat under `hashes/` is routed by rules
/// `ltk_mod_project` owns, and the repack is what applies them.
#[test]
fn a_table_declared_elsewhere_maps_nowhere() {
    assert_eq!(archive_table_path("tables/game.hashes.txt"), None);
    assert_eq!(archive_table_path("hashes/nested/game.hashes.txt"), None);
    assert_eq!(archive_table_path("hashes/"), None);
}

/// A repair that deleted a file states the deletion as a delta, and reads no
/// bytes for it - the staged tree no longer holds any.
#[test]
fn a_removal_is_written_as_an_edit() {
    let report = crate::problems::FixReport {
        applied: 1,
        skipped: 0,
        names_kept: 0,
        tables: Vec::new(),
        remaining: Vec::new(),
        files: vec![crate::problems::FileOutcome {
            layer: "base".to_owned(),
            path: "Aatrox.wad.client/data/skin0.bin".to_owned(),
            applied: 1,
            skipped: 0,
            change: crate::problems::FileChange::Removed,
        }],
        failed: Vec::new(),
    };

    let tmp = tempfile::tempdir().unwrap();
    let archive = camino::Utf8Path::new("mod.fantome");
    let edit = RepairEdit::read(tmp.path(), archive, &report);

    assert!(edit.is_ok(), "{:?}", edit.err());
}
