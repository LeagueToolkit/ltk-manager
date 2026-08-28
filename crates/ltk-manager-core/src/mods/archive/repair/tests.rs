//! End-to-end tests at the repair seam: a library holding a fantome whose bin
//! carries a property type the migration table moves.

use crate::mods::ModHealth;
use crate::mods::index::{LibraryModEntry, ModArchiveFormat, ModStorage};
use crate::mods::test_support::{
    STALE_ICON, healthy_bin, make_slugged_entry, make_test_library, place_bin_archived_fantome,
    place_bin_project_mod, place_installed_mod, point_at_installed_build,
    property_in_unpacked_tree, seed_library, stale_bin,
};
use ltk_hash::{Hash as _, WadHash};
use ltk_meta::PropertyValueEnum;
use ltk_meta::property::values;
use std::fs;

fn archived_entry(id: &str, slug: &str) -> LibraryModEntry {
    LibraryModEntry {
        storage: ModStorage::Archive,
        ..make_slugged_entry(id, slug, ModArchiveFormat::Fantome)
    }
}

fn migrated_property() -> PropertyValueEnum {
    PropertyValueEnum::WadChunkLink(values::WadChunkLink::new(WadHash::hash_str(STALE_ICON)))
}

#[test]
fn a_mod_with_nothing_to_fix_keeps_its_archive_byte_for_byte() {
    let storage = tempfile::tempdir().unwrap();
    let (library, mut config) = make_test_library(storage.path());
    point_at_installed_build(&mut config, storage.path());
    place_bin_archived_fantome(storage.path(), "healthy-mod", &healthy_bin());
    seed_library(
        &library,
        &config,
        vec![archived_entry("id-1", "healthy-mod")],
    );
    let archive = storage.path().join("mods").join("healthy-mod.fantome");
    let before = fs::read(&archive).unwrap();
    let marker = storage.path().join(".overlay-build-version");
    fs::write(&marker, "1").unwrap();

    let report = library.repair_mod(&config, "id-1").unwrap();

    assert_eq!(report.applied, 0);
    assert!(report.failed.is_empty());
    assert_eq!(fs::read(&archive).unwrap(), before);
    assert!(
        marker.exists(),
        "a repair that wrote nothing must not flush overlay builds"
    );
}

#[test]
fn a_project_storage_mod_is_repaired_in_its_tree() {
    let storage = tempfile::tempdir().unwrap();
    let (library, mut config) = make_test_library(storage.path());
    point_at_installed_build(&mut config, storage.path());
    place_bin_project_mod(storage.path(), "unpacked-mod", &stale_bin());
    seed_library(
        &library,
        &config,
        vec![make_slugged_entry(
            "id-1",
            "unpacked-mod",
            ModArchiveFormat::Fantome,
        )],
    );
    let marker = storage.path().join(".overlay-build-version");
    fs::write(&marker, "1").unwrap();

    let report = library.repair_mod(&config, "id-1").unwrap();

    assert_eq!(report.applied, 1);
    assert!(
        !marker.exists(),
        "a repair that wrote must flush the next overlay build"
    );
    assert!(report.failed.is_empty());
    assert_eq!(
        property_in_unpacked_tree(storage.path(), "unpacked-mod"),
        migrated_property(),
    );

    // The tree makes the repair undoable, so the restore point the report
    // names must actually be there.
    let restore = storage
        .path()
        .join("mods")
        .join("unpacked-mod")
        .join(".ltk")
        .join("restore")
        .join(&report.stamp);
    assert!(restore.is_dir());
}

/// Story: a repair is never applied for a game patch the user is not on yet.
#[test]
fn a_game_before_the_migration_build_leaves_the_archive_alone() {
    let storage = tempfile::tempdir().unwrap();
    let (library, mut config) = make_test_library(storage.path());

    let league = storage.path().join("league");
    fs::create_dir_all(league.join("Game")).unwrap();
    fs::write(
        league.join("Game").join("content-metadata.json"),
        r#"{ "version": "16.16.8049184" }"#,
    )
    .unwrap();
    config.league_path = Some(league);

    place_bin_archived_fantome(storage.path(), "stale-mod", &stale_bin());
    seed_library(&library, &config, vec![archived_entry("id-1", "stale-mod")]);
    let archive = storage.path().join("mods").join("stale-mod.fantome");
    let before = fs::read(&archive).unwrap();

    let report = library.repair_mod(&config, "id-1").unwrap();

    assert_eq!(report.applied, 0);
    assert_eq!(fs::read(&archive).unwrap(), before);
}

/// Story: the one button behind the sweep's banner. Everything repairable is
/// repaired, and the one mod that cannot be is named rather than fatal.
#[test]
fn repairing_many_fixes_what_it_can_and_names_what_it_could_not() {
    let storage = tempfile::tempdir().unwrap();
    let (library, mut config) = make_test_library(storage.path());
    point_at_installed_build(&mut config, storage.path());
    place_bin_project_mod(storage.path(), "stale-mod", &stale_bin());
    place_bin_project_mod(storage.path(), "fine-mod", &healthy_bin());
    place_installed_mod(storage.path(), "packed-mod", ModArchiveFormat::Modpkg, true);
    seed_library(
        &library,
        &config,
        vec![
            make_slugged_entry("id-stale", "stale-mod", ModArchiveFormat::Fantome),
            make_slugged_entry("id-fine", "fine-mod", ModArchiveFormat::Fantome),
            make_slugged_entry("id-pkg", "packed-mod", ModArchiveFormat::Modpkg),
        ],
    );

    let report = library.repair_mods(
        &config,
        &[
            "id-stale".to_string(),
            "id-fine".to_string(),
            "id-pkg".to_string(),
        ],
    );

    assert_eq!(report.repaired, vec!["id-stale".to_string()]);
    assert_eq!(report.unchanged, vec!["id-fine".to_string()]);
    assert_eq!(report.applied, 1);
    assert_eq!(report.failed.len(), 1);
    assert_eq!(report.failed[0].mod_id, "id-pkg");

    assert_eq!(
        property_in_unpacked_tree(storage.path(), "stale-mod"),
        migrated_property(),
    );
    // Each repair records its own verdict, so the badges are current without a
    // second sweep.
    let verdicts = library.mod_health_verdicts(&config).unwrap();
    assert_eq!(verdicts.get("id-stale").unwrap().health, ModHealth::Healthy);
}

#[test]
fn repairing_an_archived_fantome_rewrites_the_stale_property_in_its_archive() {
    let storage = tempfile::tempdir().unwrap();
    let (library, mut config) = make_test_library(storage.path());
    point_at_installed_build(&mut config, storage.path());
    place_bin_archived_fantome(storage.path(), "stale-mod", &stale_bin());
    seed_library(&library, &config, vec![archived_entry("id-1", "stale-mod")]);

    let report = library.repair_mod(&config, "id-1").unwrap();

    assert_eq!(report.applied, 1);
    assert!(report.failed.is_empty());

    // The archive is the mod's only content, so unpacking it through the
    // library is how the repair is read back.
    library
        .set_mod_storage(&config, "id-1", ModStorage::Project)
        .unwrap();
    assert_eq!(
        property_in_unpacked_tree(storage.path(), "stale-mod"),
        migrated_property(),
    );
}
