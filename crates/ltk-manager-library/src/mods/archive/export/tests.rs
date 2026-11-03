use fs_err as fs;

use super::*;
use crate::mods::ModArchiveFormat;
use crate::mods::index::LibraryIndex;
use crate::mods::index::document::save_library_index;
use crate::mods::test_support::{
    make_slugged_entry, make_test_library, make_test_profile, place_installed_mod, seed_library,
};
use crate::mods::types::{LibraryFolder, ROOT_FOLDER_ID};
use ltk_manager_base::events::ModStorage;

/// Two mods on disk, the second of which is only enabled when `enabled` says so.
fn library_of_two(storage_dir: &Path, enabled: Vec<&str>) -> (crate::mods::ModLibrary, Config) {
    let (library, config) = make_test_library(storage_dir);
    place_installed_mod(storage_dir, "briar-mambo", ModArchiveFormat::Fantome, true);
    place_installed_mod(storage_dir, "noxus-rift", ModArchiveFormat::Modpkg, true);

    let mods = vec![
        make_slugged_entry("m1", "briar-mambo", ModArchiveFormat::Fantome),
        make_slugged_entry("m2", "noxus-rift", ModArchiveFormat::Modpkg),
    ];
    let index = LibraryIndex {
        version: 0,
        mods,
        profiles: vec![make_test_profile(
            "p1",
            "Default",
            vec!["m1", "m2"],
            enabled,
        )],
        active_profile_id: "p1".to_string(),
        folders: vec![LibraryFolder {
            id: ROOT_FOLDER_ID.to_string(),
            name: String::new(),
            mod_ids: vec!["m1".to_string(), "m2".to_string()],
            kept_sort: None,
        }],
        folder_order: vec![ROOT_FOLDER_ID.to_string()],
    };
    save_library_index(storage_dir, &index).unwrap();

    (library, config)
}

#[test]
fn every_mod_lands_in_the_folder_as_its_own_archive() {
    let storage = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let (library, config) = library_of_two(storage.path(), vec!["m1", "m2"]);

    let summary = library
        .export_mods(&config, ExportScope::All, ExportShape::Folder, out.path())
        .unwrap();

    assert_eq!(summary.exported, 2);
    assert!(summary.skipped.is_empty());
    assert!(out.path().join("briar-mambo.fantome").is_file());
    assert!(out.path().join("noxus-rift.modpkg").is_file());
}

#[test]
fn the_enabled_scope_leaves_a_disabled_mod_behind() {
    let storage = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let (library, config) = library_of_two(storage.path(), vec!["m1"]);

    let summary = library
        .export_mods(
            &config,
            ExportScope::Enabled,
            ExportShape::Folder,
            out.path(),
        )
        .unwrap();

    assert_eq!(summary.exported, 1);
    assert!(out.path().join("briar-mambo.fantome").is_file());
    assert!(!out.path().join("noxus-rift.modpkg").exists());
}

#[test]
fn a_mod_with_no_archive_is_skipped_by_name() {
    let storage = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let (library, config) = make_test_library(storage.path());
    place_installed_mod(
        storage.path(),
        "briar-mambo",
        ModArchiveFormat::Fantome,
        false,
    );
    seed_library(
        &library,
        &config,
        vec![crate::mods::index::document::LibraryModEntry {
            storage: ModStorage::Project,
            ..make_slugged_entry("m1", "briar-mambo", ModArchiveFormat::Fantome)
        }],
    );

    let summary = library
        .export_mods(&config, ExportScope::All, ExportShape::Folder, out.path())
        .unwrap();

    assert_eq!(summary.exported, 0);
    assert_eq!(summary.skipped, vec!["briar-mambo".to_string()]);
}

#[test]
fn the_zip_shape_writes_one_file_holding_every_archive() {
    let storage = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let (library, config) = library_of_two(storage.path(), vec!["m1", "m2"]);
    let destination = out.path().join("mods.zip");

    let summary = library
        .export_mods(&config, ExportScope::All, ExportShape::Zip, &destination)
        .unwrap();

    assert_eq!(summary.exported, 2);
    let archive = zip::ZipArchive::new(fs::File::open(&destination).unwrap()).unwrap();
    let mut names: Vec<&str> = archive.file_names().collect();
    names.sort_unstable();
    assert_eq!(names, vec!["briar-mambo.fantome", "noxus-rift.modpkg"]);
}

#[test]
fn a_destination_without_the_extension_gains_one() {
    assert_eq!(
        with_zip_extension(Path::new("D:/backups/mods")),
        PathBuf::from("D:/backups/mods.zip")
    );
    assert_eq!(
        with_zip_extension(Path::new("D:/backups/mods.ZIP")),
        PathBuf::from("D:/backups/mods.ZIP")
    );
}
