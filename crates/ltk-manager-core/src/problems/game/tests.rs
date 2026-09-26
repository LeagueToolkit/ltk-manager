use fs_err as fs;

use super::*;

#[test]
fn warming_builds_the_index_before_anything_asks() {
    let game = tempfile::tempdir().expect("a temp dir");
    fs::create_dir_all(game.path().join("DATA").join("FINAL")).expect("DATA/FINAL");
    let content = InstalledContent::at(game.path());
    assert!(content.chunks.get().is_none());

    content.warm();

    let index = content.chunks.get().expect("an index after warming");
    assert!(index.entries.is_empty());
    assert!(!content.contains(WadHash(1)));
}

#[test]
fn warming_an_install_with_no_archives_still_answers() {
    let game = tempfile::tempdir().expect("a temp dir");
    let content = InstalledContent::at(game.path());

    content.warm();

    assert!(content.chunks.get().is_some());
    assert_eq!(content.read(WadHash(1)), Ok(None));
}
