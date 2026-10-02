use super::*;
use crate::mods::index::ModStorage;
use crate::mods::index::document::load_library_index;
use crate::mods::test_support::{
    RecordingEventSink, make_full_fantome_zip, make_library_with_events, make_slugged_entry,
    make_test_entry, make_test_library, mod_project_named, place_installed_mod, seed_library,
};
use assert_matches::assert_matches;
use std::sync::Arc;

/// Lay out one mod the way the pre-slug library did: `archives/<id>.<ext>` plus
/// a `mods/<id>/` holding only the extracted metadata.
fn place_legacy_fantome(storage: &Path, id: &str, display_name: &str) {
    let archives = storage.archives_dir();
    fs::create_dir_all(&archives).unwrap();
    make_full_fantome_zip(&archives.join(format!("{id}.fantome")));

    let meta_dir = storage.mods_dir().join(id);
    fs::create_dir_all(&meta_dir).unwrap();
    let mut project = mod_project_named("full-mod");
    project.display_name = display_name.to_string();
    fs::write(
        meta_dir.join("mod.config.json"),
        serde_json::to_string_pretty(&project).unwrap(),
    )
    .unwrap();
}

#[test]
fn a_legacy_fantome_moves_onto_its_slug_byte_for_byte() {
    let storage = tempfile::tempdir().unwrap();
    let (library, config) = make_test_library(storage.path());
    place_legacy_fantome(storage.path(), "id-1", "Full Mod");
    let before = fs::read(storage.path().archives_dir().join("id-1.fantome")).unwrap();
    seed_library(
        &library,
        &config,
        vec![make_test_entry("id-1", ModArchiveFormat::Fantome)],
    );

    let report = library.migrate_library_layout(&config).unwrap();
    assert_eq!(report.migrated, 1);
    assert!(report.failed.is_empty());

    let index = load_library_index(storage.path()).unwrap();
    let entry = &index.mods[0];
    assert_eq!(entry.slug.as_ref().unwrap().as_str(), "full-mod");
    assert_eq!(entry.storage, ModStorage::Archive);

    assert_eq!(
        entry.archive_path(storage.path()),
        storage.path().mods_dir().join("full-mod.fantome")
    );
    assert_eq!(
        fs::read(entry.archive_path(storage.path())).unwrap(),
        before
    );
    assert!(
        entry
            .mod_dir(storage.path())
            .join("mod.config.json")
            .exists()
    );

    assert!(!storage.path().mods_dir().join("id-1").exists());
    assert!(
        !storage
            .path()
            .join("archives")
            .join("id-1.fantome")
            .exists()
    );
}

/// The archive is the content, so the migration must never unpack it — that is
/// what makes the move instant and costs no disk.
#[test]
fn a_moved_fantome_is_not_unpacked() {
    let storage = tempfile::tempdir().unwrap();
    let (library, config) = make_test_library(storage.path());
    place_legacy_fantome(storage.path(), "id-1", "Full Mod");
    seed_library(
        &library,
        &config,
        vec![make_test_entry("id-1", ModArchiveFormat::Fantome)],
    );

    library.migrate_library_layout(&config).unwrap();

    let index = load_library_index(storage.path()).unwrap();
    assert!(
        !index.mods[0]
            .mod_dir(storage.path())
            .join("content")
            .exists()
    );
    assert!(index.mods[0].is_packed());
}

/// The old layout's metadata directory is the only place a mod's name lives,
/// and a user who deleted it would otherwise strand the mod.
#[test]
fn a_missing_metadata_directory_is_rebuilt_from_the_archive() {
    let storage = tempfile::tempdir().unwrap();
    let (library, config) = make_test_library(storage.path());
    place_legacy_fantome(storage.path(), "id-1", "Full Mod");
    fs::remove_dir_all(storage.path().mods_dir().join("id-1")).unwrap();
    seed_library(
        &library,
        &config,
        vec![make_test_entry("id-1", ModArchiveFormat::Fantome)],
    );

    let report = library.migrate_library_layout(&config).unwrap();
    assert_eq!(report.migrated, 1, "{:?}", report.failed);

    let index = load_library_index(storage.path()).unwrap();
    let project = load_mod_project(&index.mods[0].mod_dir(storage.path())).unwrap();
    assert_eq!(project.display_name, "Full Mod");
}

#[test]
fn the_users_own_metadata_moves_with_the_directory_that_holds_it() {
    let storage = tempfile::tempdir().unwrap();
    let (library, config) = make_test_library(storage.path());
    place_legacy_fantome(storage.path(), "id-1", "My Renamed Mod");

    let meta_dir = storage.path().mods_dir().join("id-1");
    let mut project = mod_project_named("full-mod");
    project.display_name = "My Renamed Mod".to_string();
    project.tags = vec![ltk_mod_project::ModTag::from("skin".to_string())];
    project.champions = vec!["Aatrox".to_string()];
    project.thumbnail = Some("thumbnail.webp".to_string());
    fs::write(
        meta_dir.join("mod.config.json"),
        serde_json::to_string_pretty(&project).unwrap(),
    )
    .unwrap();
    fs::write(meta_dir.join("thumbnail.webp"), b"user thumbnail").unwrap();
    fs::write(meta_dir.join("README.md"), b"user readme").unwrap();

    seed_library(
        &library,
        &config,
        vec![make_test_entry("id-1", ModArchiveFormat::Fantome)],
    );
    assert_eq!(library.migrate_library_layout(&config).unwrap().migrated, 1);

    let index = load_library_index(storage.path()).unwrap();
    let mod_dir = index.mods[0].mod_dir(storage.path());
    let migrated = load_mod_project(&mod_dir).unwrap();

    assert_eq!(migrated.display_name, "My Renamed Mod");
    assert_eq!(migrated.champions, vec!["Aatrox"]);
    assert_eq!(migrated.tags.len(), 1);
    assert_eq!(
        fs::read(mod_dir.join("thumbnail.webp")).unwrap(),
        b"user thumbnail"
    );
    assert_eq!(fs::read(mod_dir.join("README.md")).unwrap(), b"user readme");
}

#[test]
fn a_modpkg_keeps_its_archive_and_moves_it_beside_the_mod() {
    let storage = tempfile::tempdir().unwrap();
    let (library, config) = make_test_library(storage.path());

    let archives = storage.path().archives_dir();
    fs::create_dir_all(&archives).unwrap();
    crate::mods::test_support::make_modpkg(&archives.join("id-1.modpkg"), "packed-mod");
    let packed_bytes = fs::read(archives.join("id-1.modpkg")).unwrap();
    let meta_dir = storage.path().mods_dir().join("id-1");
    fs::create_dir_all(&meta_dir).unwrap();
    fs::write(
        meta_dir.join("mod.config.json"),
        serde_json::to_string_pretty(&mod_project_named("packed-mod")).unwrap(),
    )
    .unwrap();

    seed_library(
        &library,
        &config,
        vec![make_test_entry("id-1", ModArchiveFormat::Modpkg)],
    );
    assert_eq!(library.migrate_library_layout(&config).unwrap().migrated, 1);

    let index = load_library_index(storage.path()).unwrap();
    let entry = &index.mods[0];
    assert_eq!(entry.slug.as_ref().unwrap().as_str(), "packed-mod");
    assert_eq!(entry.storage, ModStorage::Archive);
    assert_eq!(
        entry.archive_path(storage.path()),
        storage.path().mods_dir().join("packed-mod.modpkg")
    );
    assert_eq!(
        fs::read(entry.archive_path(storage.path())).unwrap(),
        packed_bytes
    );
    assert!(!archives.join("id-1.modpkg").exists());
    assert!(entry.is_present(storage.path()));
}

/// A conversion failure leaves the mod whole in the legacy layout — nothing
/// moved aside, nothing deleted — so it keeps working and stays retryable.
#[test]
fn a_corrupt_archive_leaves_the_mod_in_the_legacy_layout() {
    let storage = tempfile::tempdir().unwrap();
    let (library, config) = make_test_library(storage.path());

    let archives = storage.path().archives_dir();
    fs::create_dir_all(&archives).unwrap();
    fs::write(archives.join("id-1.fantome"), b"not a zip").unwrap();
    let meta_dir = storage.path().mods_dir().join("id-1");
    fs::create_dir_all(&meta_dir).unwrap();
    fs::write(
        meta_dir.join("mod.config.json"),
        serde_json::to_string_pretty(&mod_project_named("broken-mod")).unwrap(),
    )
    .unwrap();

    seed_library(
        &library,
        &config,
        vec![make_test_entry("id-1", ModArchiveFormat::Fantome)],
    );

    let report = library.migrate_library_layout(&config).unwrap();
    assert_eq!(report.migrated, 0);
    assert_eq!(report.failed.len(), 1);
    assert_eq!(report.failed[0].id, "id-1");
    assert!(!report.failed[0].error.is_empty());

    let index = load_library_index(storage.path()).unwrap();
    assert_eq!(index.mods.len(), 1, "a failed mod stays in the library");
    assert!(index.mods[0].slug.is_none());
    assert!(index.mods[0].is_present(storage.path()));
    assert_eq!(index.profiles[0].mod_order, vec!["id-1"]);

    assert_eq!(
        fs::read(archives.join("id-1.fantome")).unwrap(),
        b"not a zip"
    );
    assert!(meta_dir.join("mod.config.json").exists());
}

/// The work set recomputes from the entries still without a slug, so a failure
/// is not a verdict — the next run tries the mod again.
#[test]
fn a_failed_mod_is_retried_by_a_later_run() {
    let storage = tempfile::tempdir().unwrap();
    let (library, config) = make_test_library(storage.path());

    let archives = storage.path().archives_dir();
    fs::create_dir_all(&archives).unwrap();
    fs::write(archives.join("id-1.fantome"), b"not a zip").unwrap();
    seed_library(
        &library,
        &config,
        vec![make_test_entry("id-1", ModArchiveFormat::Fantome)],
    );

    assert_eq!(
        library
            .migrate_library_layout(&config)
            .unwrap()
            .failed
            .len(),
        1
    );

    let second = library.migrate_library_layout(&config).unwrap();
    assert_eq!(second.migrated, 0);
    assert_eq!(second.failed.len(), 1, "a failed mod stays in the work set");
}

/// The index is saved after every mod, so a run that stops halfway leaves the
/// converted ones converted and only the rest pending.
#[test]
fn a_second_run_only_picks_up_what_is_still_pending() {
    let storage = tempfile::tempdir().unwrap();
    let (library, config) = make_test_library(storage.path());
    place_legacy_fantome(storage.path(), "id-1", "First");
    seed_library(
        &library,
        &config,
        vec![make_test_entry("id-1", ModArchiveFormat::Fantome)],
    );
    assert_eq!(library.migrate_library_layout(&config).unwrap().migrated, 1);

    place_legacy_fantome(storage.path(), "id-2", "Second");
    let mut index = load_library_index(storage.path()).unwrap();
    index
        .mods
        .push(make_test_entry("id-2", ModArchiveFormat::Fantome));
    save_library_index(storage.path(), &index).unwrap();

    let report = library.migrate_library_layout(&config).unwrap();
    assert_eq!(report.migrated, 1);

    let index = load_library_index(storage.path()).unwrap();
    assert!(index.mods.iter().all(|m| m.slug.is_some()));
}

#[test]
fn two_mods_that_slugify_the_same_get_distinct_directories() {
    let storage = tempfile::tempdir().unwrap();
    let (library, config) = make_test_library(storage.path());
    place_legacy_fantome(storage.path(), "id-1", "First");
    place_legacy_fantome(storage.path(), "id-2", "Second");
    seed_library(
        &library,
        &config,
        vec![
            make_test_entry("id-1", ModArchiveFormat::Fantome),
            make_test_entry("id-2", ModArchiveFormat::Fantome),
        ],
    );

    assert_eq!(library.migrate_library_layout(&config).unwrap().migrated, 2);

    let index = load_library_index(storage.path()).unwrap();
    let slugs: std::collections::HashSet<String> = index
        .mods
        .iter()
        .map(|m| m.slug.as_ref().unwrap().as_str().to_string())
        .collect();
    assert_eq!(slugs.len(), 2);
    assert!(slugs.contains("full-mod"));
    assert!(slugs.contains("full-mod-2"));
}

#[test]
fn the_overlay_build_marker_is_cleared_so_the_next_build_starts_clean() {
    let storage = tempfile::tempdir().unwrap();
    let (library, config) = make_test_library(storage.path());
    let marker = storage.path().join(".overlay-build-version");
    fs::write(&marker, "1.2.3").unwrap();

    place_legacy_fantome(storage.path(), "id-1", "Full Mod");
    seed_library(
        &library,
        &config,
        vec![make_test_entry("id-1", ModArchiveFormat::Fantome)],
    );
    library.migrate_library_layout(&config).unwrap();

    assert!(!marker.exists());
}

/// The run announces itself, which is the only thing that puts it on screen now
/// that nothing asks the user to start it.
#[test]
fn a_run_that_moves_mods_announces_its_progress_and_its_report() {
    let storage = tempfile::tempdir().unwrap();
    let events = Arc::new(RecordingEventSink::default());
    let (library, config) = make_library_with_events(storage.path(), events.clone());

    place_legacy_fantome(storage.path(), "id-1", "Full Mod");
    seed_library(
        &library,
        &config,
        vec![make_test_entry("id-1", ModArchiveFormat::Fantome)],
    );
    assert_eq!(library.migrate_library_layout(&config).unwrap().migrated, 1);

    assert_eq!(
        events.names(),
        vec!["layout-migration-progress", "layout-migration-finished"]
    );
    // A window that opened too late for the events reads the same thing here.
    assert_matches!(
        library.layout_migration_state(),
        LayoutMigrationState::Finished { report } if report.migrated == 1
    );
}

/// Every start after the first has nothing to move, and a toast announcing that
/// would be a toast on every launch forever.
#[test]
fn a_library_already_on_the_slug_layout_announces_nothing() {
    let storage = tempfile::tempdir().unwrap();
    let events = Arc::new(RecordingEventSink::default());
    let (library, config) = make_library_with_events(storage.path(), events.clone());

    place_installed_mod(storage.path(), "full-mod", ModArchiveFormat::Fantome, true);
    seed_library(
        &library,
        &config,
        vec![make_slugged_entry(
            "id-1",
            "full-mod",
            ModArchiveFormat::Fantome,
        )],
    );

    let report = library.migrate_library_layout(&config).unwrap();
    assert_eq!(report.migrated, 0);
    assert!(report.failed.is_empty());
    assert!(events.names().is_empty());
    // Still an answer, so nothing is left asking for one all session.
    assert_matches!(library.layout_migration_state(), LayoutMigrationState::Idle);
}

/// The old layout stored a fantome's own layers in its config. The importer
/// resets them, so the conversion has to read them back out of the archive or
/// every profile's layer state points at layers that no longer exist.
#[test]
fn a_converted_fantome_keeps_the_layers_its_archive_declares() {
    let storage = tempfile::tempdir().unwrap();
    let (library, config) = make_test_library(storage.path());

    let archives = storage.path().archives_dir();
    fs::create_dir_all(&archives).unwrap();
    crate::mods::test_support::make_layered_fantome_zip(&archives.join("id-1.fantome"));
    let meta_dir = storage.path().mods_dir().join("id-1");
    fs::create_dir_all(&meta_dir).unwrap();
    fs::write(
        meta_dir.join("mod.config.json"),
        serde_json::to_string_pretty(&mod_project_named("layered-mod")).unwrap(),
    )
    .unwrap();

    seed_library(
        &library,
        &config,
        vec![make_test_entry("id-1", ModArchiveFormat::Fantome)],
    );
    assert_eq!(library.migrate_library_layout(&config).unwrap().migrated, 1);

    let index = load_library_index(storage.path()).unwrap();
    let project = load_mod_project(&index.mods[0].mod_dir(storage.path())).unwrap();
    let high_res = project
        .layers
        .iter()
        .find(|l| l.name == "high_res")
        .expect("the archive's own layer survives the conversion");
    assert_eq!(
        high_res.string_overrides["en_us"]["game_character_displayname_Ashe"],
        "Frost Archer"
    );
}
