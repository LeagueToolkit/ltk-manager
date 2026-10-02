use super::*;
use crate::mods::index::document::{load_library_index, save_library_index};
use crate::mods::test_support::{
    make_fantome_zip, make_slugged_entry, make_test_entry, make_test_profile, make_unpacked_entry,
    mod_project_named, place_installed_mod, place_unpacked_mod,
};
use crate::mods::types::{LibraryFolder, ROOT_FOLDER_ID};
use ltk_wad::NoResolver;

fn context() -> InstallContext<'static> {
    InstallContext {
        resolver: &NoResolver,
    }
}

fn reconcile(storage: &Path, index: &mut LibraryIndex) -> bool {
    reconcile_library_index(storage, index, &mut Vec::new(), &context())
}

/// An index holding `mods`, with one profile and root folder naming `enabled`.
fn index_with(mods: Vec<LibraryModEntry>, enabled: Vec<&str>) -> LibraryIndex {
    let ids: Vec<String> = mods.iter().map(|m| m.id.clone()).collect();
    let order: Vec<&str> = ids.iter().map(String::as_str).collect();
    LibraryIndex {
        version: 0,
        mods,
        profiles: vec![make_test_profile("p1", "Default", order, enabled)],
        active_profile_id: "p1".to_string(),
        folders: vec![LibraryFolder {
            id: ROOT_FOLDER_ID.to_string(),
            name: String::new(),
            mod_ids: ids,
        }],
        folder_order: vec![ROOT_FOLDER_ID.to_string()],
    }
}

#[test]
fn a_clean_library_reports_no_changes() {
    let dir = tempfile::tempdir().unwrap();
    place_installed_mod(dir.path(), "mod-a", ModArchiveFormat::Modpkg, true);

    let mut index = index_with(
        vec![make_slugged_entry(
            "mod-a",
            "mod-a",
            ModArchiveFormat::Modpkg,
        )],
        vec!["mod-a"],
    );

    assert!(!reconcile(dir.path(), &mut index));
    assert_eq!(index.mods.len(), 1);
    assert_eq!(index.profiles[0].mod_order, vec!["mod-a"]);
    assert_eq!(index.profiles[0].enabled_mods, vec!["mod-a"]);
}

#[test]
fn a_modpkg_that_lost_its_archive_is_orphaned() {
    let dir = tempfile::tempdir().unwrap();
    place_installed_mod(dir.path(), "mod-a", ModArchiveFormat::Modpkg, false);

    let mut index = index_with(
        vec![make_slugged_entry(
            "mod-a",
            "mod-a",
            ModArchiveFormat::Modpkg,
        )],
        vec!["mod-a"],
    );

    assert!(reconcile(dir.path(), &mut index));
    assert!(index.mods.is_empty());
    assert!(index.profiles[0].mod_order.is_empty());
    assert!(index.profiles[0].enabled_mods.is_empty());
}

#[test]
fn a_mod_with_no_directory_at_all_is_orphaned() {
    let dir = tempfile::tempdir().unwrap();
    let mut index = index_with(
        vec![make_slugged_entry(
            "ghost",
            "ghost",
            ModArchiveFormat::Fantome,
        )],
        vec!["ghost"],
    );

    assert!(reconcile(dir.path(), &mut index));
    assert!(index.mods.is_empty());
    assert!(index.profiles[0].mod_order.is_empty());
}

#[test]
fn valid_mods_survive_a_pass_that_removes_orphans() {
    let dir = tempfile::tempdir().unwrap();
    place_installed_mod(dir.path(), "valid", ModArchiveFormat::Modpkg, true);

    let mut index = index_with(
        vec![
            make_slugged_entry("valid", "valid", ModArchiveFormat::Modpkg),
            make_slugged_entry("orphan", "orphan", ModArchiveFormat::Modpkg),
        ],
        vec!["valid", "orphan"],
    );

    assert!(reconcile(dir.path(), &mut index));
    assert_eq!(index.mods.len(), 1);
    assert_eq!(index.mods[0].id, "valid");
    assert_eq!(index.profiles[0].enabled_mods, vec!["valid"]);
}

#[test]
fn every_profile_gets_the_full_mod_order() {
    let dir = tempfile::tempdir().unwrap();
    place_installed_mod(dir.path(), "mod-a", ModArchiveFormat::Modpkg, true);
    place_installed_mod(dir.path(), "mod-b", ModArchiveFormat::Fantome, true);

    let mut index = LibraryIndex {
        profiles: vec![
            make_test_profile("p1", "Default", vec!["mod-a"], vec![]),
            make_test_profile("p2", "Ranked", vec!["mod-b"], vec!["mod-b"]),
        ],
        ..index_with(
            vec![
                make_slugged_entry("mod-a", "mod-a", ModArchiveFormat::Modpkg),
                make_slugged_entry("mod-b", "mod-b", ModArchiveFormat::Fantome),
            ],
            vec![],
        )
    };
    index.active_profile_id = "p1".to_string();

    assert!(reconcile(dir.path(), &mut index));
    assert_eq!(index.profiles[0].mod_order, vec!["mod-a", "mod-b"]);
    assert_eq!(index.profiles[1].mod_order, vec!["mod-a", "mod-b"]);
}

#[test]
fn a_profile_reference_to_a_mod_the_index_never_had_is_dropped() {
    let dir = tempfile::tempdir().unwrap();
    place_installed_mod(dir.path(), "mod-a", ModArchiveFormat::Modpkg, true);

    let mut index = index_with(
        vec![make_slugged_entry(
            "mod-a",
            "mod-a",
            ModArchiveFormat::Modpkg,
        )],
        vec!["mod-a"],
    );
    index.profiles[0].mod_order.push("deleted".to_string());
    index.profiles[0].enabled_mods.push("deleted".to_string());

    assert!(reconcile(dir.path(), &mut index));
    assert_eq!(index.profiles[0].mod_order, vec!["mod-a"]);
    assert_eq!(index.profiles[0].enabled_mods, vec!["mod-a"]);
}

#[test]
fn an_empty_library_reports_no_changes() {
    let dir = tempfile::tempdir().unwrap();
    let mut index = index_with(Vec::new(), Vec::new());
    assert!(!reconcile(dir.path(), &mut index));
}

/// A mod the layout migration could not move stays in the legacy layout, and
/// every pass has to leave it there: it is not an orphan, its directory is not
/// a discovery, and its archive in `archives/` is not a drop.
#[test]
fn reconciliation_leaves_a_legacy_entry_alone() {
    let dir = tempfile::tempdir().unwrap();

    let archives = dir.path().join("archives");
    fs::create_dir_all(&archives).unwrap();
    make_fantome_zip(&archives.join("legacy.fantome"));
    let meta_dir = dir.path().join("mods").join("legacy");
    fs::create_dir_all(&meta_dir).unwrap();
    fs::write(
        meta_dir.join("mod.config.json"),
        serde_json::to_string_pretty(&mod_project_named("legacy-mod")).unwrap(),
    )
    .unwrap();

    let mut index = index_with(
        vec![make_test_entry("legacy", ModArchiveFormat::Fantome)],
        vec!["legacy"],
    );

    assert!(!reconcile(dir.path(), &mut index));
    assert_eq!(index.mods.len(), 1, "the legacy entry must be left alone");
    assert!(index.mods[0].slug.is_none());
}

#[test]
fn an_archive_dropped_into_the_drop_folder_installs_into_a_slug_directory() {
    let dir = tempfile::tempdir().unwrap();
    let archives_dir = dir.path().join("archives");
    fs::create_dir_all(&archives_dir).unwrap();
    make_fantome_zip(&archives_dir.join("cool-skin.fantome"));

    let mut index = index_with(Vec::new(), Vec::new());

    assert!(reconcile(dir.path(), &mut index));
    assert_eq!(index.mods.len(), 1);
    assert_eq!(index.mods[0].format, ModArchiveFormat::Fantome);
    assert_eq!(index.mods[0].slug.as_ref().unwrap().as_str(), "test-mod");
    assert!(
        index.mods[0]
            .mod_dir(dir.path())
            .join("mod.config.json")
            .exists()
    );
    assert!(!archives_dir.join("cool-skin.fantome").exists());
    assert_eq!(index.profiles[0].enabled_mods.len(), 1);
}

#[test]
fn a_corrupt_dropped_archive_is_removed_along_with_its_staging() {
    let dir = tempfile::tempdir().unwrap();
    let archives_dir = dir.path().join("archives");
    fs::create_dir_all(&archives_dir).unwrap();
    fs::write(archives_dir.join("corrupt.fantome"), b"not a zip").unwrap();

    let mut index = index_with(Vec::new(), Vec::new());

    assert!(!reconcile(dir.path(), &mut index));
    assert!(index.mods.is_empty());
    assert!(!archives_dir.join("corrupt.fantome").exists());
    assert!(!staging_dirs(dir.path()).any(|_| true));
}

#[test]
fn a_stale_staging_directory_is_swept_along_with_its_archive() {
    let dir = tempfile::tempdir().unwrap();
    let mods_dir = dir.path().join("mods");
    let stale = mods_dir.join(format!("{STAGING_PREFIX}abandoned"));
    let stale_archive = mods_dir.join(format!("{STAGING_PREFIX}abandoned.fantome"));
    fs::create_dir_all(stale.join("content")).unwrap();
    fs::write(&stale_archive, b"half a copy").unwrap();

    sweep_stale_staging(dir.path());

    assert!(!stale.exists());
    assert!(!stale_archive.exists());
}

/// Staging happens outside the index lock, and the writes themselves wake the
/// watcher. A reconcile that swept would delete a directory an install is
/// still filling.
#[test]
fn reconciling_leaves_staging_directories_alone() {
    let dir = tempfile::tempdir().unwrap();
    let in_flight = dir
        .path()
        .join("mods")
        .join(format!("{STAGING_PREFIX}in-flight"));
    fs::create_dir_all(in_flight.join("content")).unwrap();

    let mut index = index_with(Vec::new(), Vec::new());
    reconcile(dir.path(), &mut index);

    assert!(in_flight.exists());
}

#[test]
fn a_project_directory_is_adopted_under_the_name_it_already_has() {
    let dir = tempfile::tempdir().unwrap();
    let mod_dir = dir.path().join("mods").join("Restored Mod");
    fs::create_dir_all(mod_dir.join("content").join("base")).unwrap();
    fs::write(
        mod_dir.join("mod.config.json"),
        serde_json::to_string_pretty(&mod_project_named("restored-mod")).unwrap(),
    )
    .unwrap();

    let mut index = index_with(Vec::new(), Vec::new());
    assert!(reconcile(dir.path(), &mut index));

    assert_eq!(index.mods.len(), 1);
    assert_eq!(
        index.mods[0].slug.as_ref().unwrap().as_str(),
        "Restored Mod"
    );
    assert_eq!(index.mods[0].format, ModArchiveFormat::Unknown);
    assert_eq!(index.mods[0].storage, ModStorage::Project);
    assert!(!index.mods[0].id.is_empty());
}

/// A restored modpkg's directory holds only extracted metadata. Adopting it as
/// an unpacked project would build an empty overlay, so the archive beside it
/// is what has to be read.
#[test]
fn a_directory_beside_a_modpkg_is_adopted_as_packed() {
    let dir = tempfile::tempdir().unwrap();
    let mod_dir = dir.path().join("mods").join("packed-mod");
    fs::create_dir_all(&mod_dir).unwrap();
    fs::write(
        mod_dir.join("mod.config.json"),
        serde_json::to_string_pretty(&mod_project_named("packed-mod")).unwrap(),
    )
    .unwrap();
    fs::write(dir.path().join("mods").join("packed-mod.modpkg"), b"fake").unwrap();

    let mut index = index_with(Vec::new(), Vec::new());
    assert!(reconcile(dir.path(), &mut index));

    assert_eq!(index.mods.len(), 1);
    assert_eq!(index.mods[0].format, ModArchiveFormat::Modpkg);
    assert_eq!(index.mods[0].storage, ModStorage::Archive);
}

/// ADR-0002: a `.modpkg` means the content is in the archive. A `content/` dir
/// beside one is leftovers, and reading it instead would build the overlay from
/// them — with no way back, because a modpkg cannot be converted.
#[test]
fn a_content_tree_does_not_make_a_modpkg_unpacked() {
    let dir = tempfile::tempdir().unwrap();
    let mod_dir = dir.path().join("mods").join("packed-mod");
    fs::create_dir_all(mod_dir.join("content").join("base")).unwrap();
    fs::write(
        mod_dir.join("mod.config.json"),
        serde_json::to_string_pretty(&mod_project_named("packed-mod")).unwrap(),
    )
    .unwrap();
    fs::write(dir.path().join("mods").join("packed-mod.modpkg"), b"fake").unwrap();

    let mut index = index_with(Vec::new(), Vec::new());
    assert!(reconcile(dir.path(), &mut index));

    assert_eq!(index.mods.len(), 1);
    assert_eq!(index.mods[0].format, ModArchiveFormat::Modpkg);
    assert_eq!(index.mods[0].storage, ModStorage::Archive);
}

/// The archive is a keepsake, not the content, so the directory still reads as
/// the project it is — but it does say which format the mod arrived as.
#[test]
fn a_retained_fantome_names_the_format_of_the_directory_beside_it() {
    let dir = tempfile::tempdir().unwrap();
    place_unpacked_mod(dir.path(), "kept", true);

    let mut index = index_with(Vec::new(), Vec::new());
    assert!(reconcile(dir.path(), &mut index));

    assert_eq!(index.mods.len(), 1);
    assert_eq!(index.mods[0].format, ModArchiveFormat::Fantome);
    assert_eq!(index.mods[0].storage, ModStorage::Project);
}

#[test]
fn a_directory_an_entry_already_claims_is_not_adopted_twice() {
    let dir = tempfile::tempdir().unwrap();
    place_unpacked_mod(dir.path(), "original", false);

    let mut index = index_with(vec![make_unpacked_entry("dup", "original")], vec!["dup"]);

    assert!(!reconcile(dir.path(), &mut index));
    assert_eq!(index.mods.len(), 1);
    assert_eq!(index.mods[0].id, "dup");
}

#[test]
fn a_directory_that_is_not_a_mod_project_is_ignored() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir_all(dir.path().join("mods").join("just-a-folder")).unwrap();
    fs::write(
        dir.path()
            .join("mods")
            .join("just-a-folder")
            .join("notes.txt"),
        b"hello",
    )
    .unwrap();

    let mut index = index_with(Vec::new(), Vec::new());
    assert!(!reconcile(dir.path(), &mut index));
    assert!(index.mods.is_empty());
}

#[test]
fn stale_modpkg_metadata_is_re_extracted_and_unpacked_mods_are_left_alone() {
    let dir = tempfile::tempdir().unwrap();
    place_installed_mod(dir.path(), "fs-mod", ModArchiveFormat::Fantome, true);

    // Backdate the unpacked mod's config so its retained archive looks newer.
    let config_path = dir
        .path()
        .join("mods")
        .join("fs-mod")
        .join("mod.config.json");
    let past = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_000_000);
    filetime::set_file_mtime(&config_path, filetime::FileTime::from_system_time(past)).unwrap();
    let before = fs::read_to_string(&config_path).unwrap();

    let mut index = index_with(
        vec![make_slugged_entry(
            "fs-mod",
            "fs-mod",
            ModArchiveFormat::Fantome,
        )],
        vec!["fs-mod"],
    );
    let mut refreshed = Vec::new();
    reconcile_library_index(dir.path(), &mut index, &mut refreshed, &context());

    assert!(
        refreshed.is_empty(),
        "an unpacked mod is never re-extracted"
    );
    assert_eq!(fs::read_to_string(&config_path).unwrap(), before);
}

#[test]
fn a_saved_index_reconciles_back_to_its_orphan_free_shape() {
    let dir = tempfile::tempdir().unwrap();
    let index = index_with(
        vec![make_slugged_entry(
            "ghost",
            "ghost",
            ModArchiveFormat::Modpkg,
        )],
        vec!["ghost"],
    );
    save_library_index(dir.path(), &index).unwrap();

    let mut loaded = load_library_index(dir.path()).unwrap();
    assert!(reconcile(dir.path(), &mut loaded));
    assert!(loaded.mods.is_empty());
    assert!(loaded.profiles[0].enabled_mods.is_empty());
}

fn staging_dirs(storage: &Path) -> impl Iterator<Item = PathBuf> + use<> {
    fs::read_dir(storage.mods_dir())
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with(STAGING_PREFIX))
        })
}

/// What the layout migration leaves: a metadata directory with the archive it
/// is read from beside it, and no `content/` anywhere.
#[test]
fn a_directory_beside_a_fantome_with_no_content_tree_is_adopted_as_packed() {
    let dir = tempfile::tempdir().unwrap();
    let mod_dir = dir.path().join("mods").join("moved-mod");
    fs::create_dir_all(&mod_dir).unwrap();
    fs::write(
        mod_dir.join("mod.config.json"),
        serde_json::to_string_pretty(&mod_project_named("moved-mod")).unwrap(),
    )
    .unwrap();
    fs::write(dir.path().join("mods").join("moved-mod.fantome"), b"fake").unwrap();

    let mut index = index_with(Vec::new(), Vec::new());
    assert!(reconcile(dir.path(), &mut index));

    assert_eq!(index.mods.len(), 1);
    assert_eq!(index.mods[0].format, ModArchiveFormat::Fantome);
    assert_eq!(index.mods[0].storage, ModStorage::Archive);
}
