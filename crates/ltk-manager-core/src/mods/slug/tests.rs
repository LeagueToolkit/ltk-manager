use fs_err as fs;

use super::*;
use crate::mods::StorageLayout as _;
use crate::mods::index::LibraryIndex;

#[test]
fn slugifies_a_display_name() {
    let slug = ModSlug::assign("Dark Cosmic Jhin", &TakenSlugs::default());
    assert_eq!(slug.as_str(), "dark-cosmic-jhin");
}

#[test]
fn a_name_that_slugifies_to_nothing_falls_back() {
    let slug = ModSlug::assign("!!! ???", &TakenSlugs::default());
    assert_eq!(slug.as_str(), FALLBACK_SLUG);
}

#[test]
fn reserved_device_names_are_suffixed() {
    assert_eq!(
        ModSlug::assign("con", &TakenSlugs::default()).as_str(),
        "con-2"
    );
    assert_eq!(
        ModSlug::assign("COM3", &TakenSlugs::default()).as_str(),
        "com3-2"
    );
}

/// A reserved name only matters as the whole slug — `console` is a directory
/// Windows creates happily.
#[test]
fn a_reserved_name_as_a_prefix_is_left_alone() {
    assert_eq!(
        ModSlug::assign("Console Skin", &TakenSlugs::default()).as_str(),
        "console-skin"
    );
}

#[test]
fn collisions_walk_the_suffix_chain_deterministically() {
    let mut taken = TakenSlugs::default();
    let names = ["Ashe Skin", "Ashe Skin", "Ashe Skin"];
    let assigned: Vec<String> = names
        .iter()
        .map(|name| {
            let slug = ModSlug::assign(name, &taken);
            taken.insert(&slug);
            slug.as_str().to_string()
        })
        .collect();

    assert_eq!(assigned, vec!["ashe-skin", "ashe-skin-2", "ashe-skin-3"]);
}

#[test]
fn collision_matching_ignores_case() {
    let mut taken = TakenSlugs::default();
    taken.insert(&ModSlug::from_dir_name("Ashe-Skin"));
    assert_eq!(ModSlug::assign("ashe skin", &taken).as_str(), "ashe-skin-2");
}

#[test]
fn taken_slugs_collect_reads_both_the_index_and_the_disk() {
    let storage = tempfile::tempdir().unwrap();
    let mods_dir = storage.path().mods_dir();
    fs::create_dir_all(mods_dir.join("on-disk-only")).unwrap();
    fs::write(mods_dir.join("orphan-archive.fantome"), b"leftover").unwrap();

    let mut index = LibraryIndex::default();
    index
        .mods
        .push(crate::mods::test_support::make_slugged_entry(
            "id-1",
            "in-index-only",
            crate::mods::index::ModArchiveFormat::Fantome,
        ));

    let taken = TakenSlugs::collect(&index, &mods_dir);
    assert!(taken.contains("on-disk-only"));
    assert!(taken.contains("in-index-only"));
    assert!(taken.contains("orphan-archive"));
}

#[test]
fn collect_tolerates_a_missing_mods_directory() {
    let storage = tempfile::tempdir().unwrap();
    let taken = TakenSlugs::collect(&LibraryIndex::default(), &storage.path().mods_dir());
    assert_eq!(ModSlug::assign("Anything", &taken).as_str(), "anything");
}
