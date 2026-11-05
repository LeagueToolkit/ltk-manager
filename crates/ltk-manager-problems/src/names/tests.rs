//! Unit tests for the four bin name tables, and for a cache that holds none.

use super::*;
use ltk_manager_bin::bin_document::hex;

/// Every lookup has to miss rather than answer out of another table's
/// universe, which is the whole reason the four are kept apart.
#[test]
fn a_cache_that_is_not_there_names_nothing() {
    let names = BinNames::none();
    let hash = BinHash(0x0032_9f1d);

    assert_eq!(names.field(hash), None);
    assert_eq!(names.value(hash), None);
    assert_eq!(names.entry(hash), None);
    assert_eq!(names.class(hash), None);
}

#[test]
fn a_project_names_what_its_game_data_declarations_write() {
    let dir = tempfile::tempdir().unwrap();
    fs_err::write(
        dir.path().join("mod.config.json"),
        r#"{"name":"named","display_name":"Named","version":"1.0.0","description":"","authors":[],
"layers":[{"name":"base","priority":0}]}"#,
    )
    .unwrap();
    fs_err::create_dir_all(dir.path().join("content/base")).unwrap();
    fs_err::write(
        dir.path().join("content/base/game_data.yaml"),
        r#"version: 1
modules:
  - target: data/characters/teemo/skins/skin0.bin
    objects:
      Characters/Teemo/Skins/Skin0/Custom:
        clone: Characters/Teemo/Skins/Skin0
        set:
          emitterName: Custom_Trail
"#,
    )
    .unwrap();

    let names = BinNames::open(dir.path());

    let entry = "Characters/Teemo/Skins/Skin0/Custom";
    assert_eq!(
        names.entry(BinHash::hash_str(entry)).as_deref(),
        Some(entry)
    );
    assert_eq!(
        names.value(BinHash::hash_str("Custom_Trail")).as_deref(),
        Some("Custom_Trail")
    );
}

#[test]
fn a_hash_with_no_name_prints_as_eight_digits() {
    assert_eq!(hex(BinHash(0x0032_9f1d)), "0x00329f1d");
    assert_eq!(hex(BinHash(0xffff_ffff)), "0xffffffff");
}
