use super::*;
use ltk_fantome::FantomeReader;

fn reader(path: &Path) -> FantomeReader<fs::File> {
    FantomeReader::new(fs::File::open(path).unwrap()).unwrap()
}

#[test]
fn repair_drops_a_declaration_whose_table_is_absent() {
    let dir = tempfile::tempdir().unwrap();
    let archive = dir.path().join("missing-table.fantome");
    ltk_manager_assets::test_util::make_missing_hashtable_fantome_zip(&archive);

    let repaired = repair_declared_hashtables(&archive, dir.path())
        .unwrap()
        .expect("the archive declares an absent table");

    let mut repaired = reader(repaired.path());
    let info = repaired.read_info().unwrap();
    assert!(info.hashtables.is_empty());
    assert_eq!(info.name, "Missing Table Mod");
    assert!(repaired.read_hashtables().unwrap().is_empty());
    assert!(
        repaired
            .entry_names()
            .any(|name| name == "WAD/Ashe.wad.client")
    );
}

#[test]
fn repair_keeps_the_manifest_fields_it_does_not_change() {
    let dir = tempfile::tempdir().unwrap();
    let archive = dir.path().join("missing-table.fantome");
    ltk_manager_assets::test_util::make_missing_hashtable_fantome_zip(&archive);
    let before = reader(&archive).read_info().unwrap();

    let repaired = repair_declared_hashtables(&archive, dir.path())
        .unwrap()
        .unwrap();

    let after = reader(repaired.path()).read_info().unwrap();
    assert_eq!(after.author, before.author);
    assert_eq!(after.version, before.version);
    assert_eq!(after.extra, before.extra);
}

#[test]
fn repair_returns_none_if_every_declared_table_is_present() {
    let dir = tempfile::tempdir().unwrap();
    let archive = dir.path().join("full.fantome");
    ltk_manager_assets::test_util::make_full_fantome_zip(&archive);

    assert!(
        repair_declared_hashtables(&archive, dir.path())
            .unwrap()
            .is_none()
    );
}
