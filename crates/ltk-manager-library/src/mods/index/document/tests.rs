use super::*;
use crate::mods::test_support::{
    make_slugged_entry, make_test_entry, make_test_library, make_unpacked_entry,
    place_installed_mod, place_mod_files, place_unpacked_mod, seed_library,
};

#[test]
fn library_index_default_has_one_profile() {
    let index = LibraryIndex::default();
    assert_eq!(index.profiles.len(), 1);
    assert_eq!(index.profiles[0].name, "Default");
    assert_eq!(index.profiles[0].slug.as_str(), "default");
    assert_eq!(index.active_profile_id, index.profiles[0].id);
    assert!(index.mods.is_empty());
}

#[test]
fn library_index_save_and_load_round_trip() {
    let dir = tempfile::tempdir().unwrap();
    let index = LibraryIndex::default();
    save_library_index(dir.path(), &index).unwrap();
    let loaded = load_library_index(dir.path()).unwrap();
    assert_eq!(loaded.profiles.len(), 1);
    assert_eq!(loaded.profiles[0].name, "Default");
    assert_eq!(loaded.active_profile_id, loaded.profiles[0].id);
}

#[test]
fn load_library_index_returns_default_when_no_file() {
    let dir = tempfile::tempdir().unwrap();
    let index = load_library_index(dir.path()).unwrap();
    assert_eq!(index.profiles.len(), 1);
    assert_eq!(index.profiles[0].name, "Default");
}

#[test]
fn get_active_profile_finds_profile() {
    let index = LibraryIndex::default();
    let profile = get_active_profile(&index).unwrap();
    assert_eq!(profile.name, "Default");
}

#[test]
fn get_active_profile_returns_error_when_missing() {
    let index = LibraryIndex {
        version: 0,
        mods: Vec::new(),
        profiles: Vec::new(),
        active_profile_id: "nonexistent".to_string(),
        folders: vec![LibraryFolder {
            id: ROOT_FOLDER_ID.to_string(),
            name: String::new(),
            mod_ids: Vec::new(),
            kept_sort: None,
        }],
        folder_order: vec![ROOT_FOLDER_ID.to_string()],
    };
    assert!(get_active_profile(&index).is_err());
}

#[test]
fn resolve_profile_dirs_produces_correct_paths() {
    let storage_dir = Path::new("/storage");
    let slug = ProfileSlug("my-profile".to_string());
    let (overlay_dir, cache_dir) = resolve_profile_dirs(storage_dir, &slug);
    assert!(overlay_dir.ends_with("profiles/my-profile/overlay"));
    assert!(cache_dir.ends_with("profiles/my-profile/cache"));
}

#[test]
fn get_profile_by_id_not_found() {
    let index = LibraryIndex::default();
    assert!(get_profile_by_id(&index, "nonexistent-id").is_err());
}

#[test]
fn load_library_index_migrates_legacy_without_folders() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("library.json");

    // Write a legacy JSON without folders or folder_order fields
    let legacy_json = serde_json::json!({
        "mods": [
            {
                "id": "mod-a",
                "installedAt": "2026-01-01T00:00:00Z",
                "format": "modpkg"
            },
            {
                "id": "mod-b",
                "installedAt": "2026-01-01T00:00:00Z",
                "format": "modpkg"
            }
        ],
        "profiles": [{
            "id": "p1",
            "name": "Default",
            "slug": "default",
            "modOrder": ["mod-a", "mod-b"],
            "enabledMods": ["mod-a"],
            "layerStates": {},
            "createdAt": "2026-01-01T00:00:00Z",
            "lastUsed": "2026-01-01T00:00:00Z"
        }],
        "activeProfileId": "p1"
    });
    fs::write(&path, serde_json::to_string_pretty(&legacy_json).unwrap()).unwrap();

    let index = load_library_index(dir.path()).unwrap();

    // Root folder should exist with all mods
    let root = index.folders.iter().find(|f| f.id == ROOT_FOLDER_ID);
    assert!(
        root.is_some(),
        "Root folder should be created during migration"
    );
    let root = root.unwrap();
    assert_eq!(root.mod_ids, vec!["mod-a", "mod-b"]);

    // folder_order should contain root
    assert_eq!(index.folder_order, vec![ROOT_FOLDER_ID]);
}

#[test]
fn mod_archive_format_extension() {
    assert_eq!(ModArchiveFormat::Fantome.extension(), "fantome");
    assert_eq!(ModArchiveFormat::Modpkg.extension(), "modpkg");
}

#[test]
fn mod_archive_format_from_extension() {
    assert_eq!(
        ModArchiveFormat::from_extension("modpkg"),
        Some(ModArchiveFormat::Modpkg)
    );
    assert_eq!(
        ModArchiveFormat::from_extension("FANTOME"),
        Some(ModArchiveFormat::Fantome)
    );
    assert_eq!(
        ModArchiveFormat::from_extension("zip"),
        Some(ModArchiveFormat::Fantome)
    );
    assert_eq!(ModArchiveFormat::from_extension("rar"), None);
}

#[test]
fn a_legacy_entry_points_at_the_uuid_layout() {
    let storage_dir = Path::new("/storage");
    let entry = make_test_entry("abc-123", ModArchiveFormat::Fantome);

    assert!(entry.mod_dir(storage_dir).ends_with("mods/abc-123"));
    assert!(
        entry
            .archive_path(storage_dir)
            .ends_with("archives/abc-123.fantome")
    );
}

#[test]
fn a_slugged_entry_keeps_its_archive_beside_the_mod() {
    let storage_dir = Path::new("/storage");
    let entry = make_slugged_entry("abc-123", "cool-skin", ModArchiveFormat::Modpkg);

    assert!(entry.mod_dir(storage_dir).ends_with("mods/cool-skin"));
    assert!(
        entry
            .archive_path(storage_dir)
            .ends_with("mods/cool-skin.modpkg")
    );
}

/// Every install reads out of its archive, and only an unpack or a discovered
/// project directory reads off disk.
#[test]
fn an_install_reads_as_packed_and_an_unpack_does_not() {
    assert!(make_slugged_entry("a", "a", ModArchiveFormat::Modpkg).is_packed());
    assert!(make_slugged_entry("a", "a", ModArchiveFormat::Fantome).is_packed());
    assert!(!make_slugged_entry("a", "a", ModArchiveFormat::Unknown).is_packed());
    assert!(!make_unpacked_entry("a", "a").is_packed());

    assert!(make_test_entry("a", ModArchiveFormat::Modpkg).is_packed());
    assert!(make_test_entry("a", ModArchiveFormat::Fantome).is_packed());
}

/// The pre-slug layout left `mods/<uuid>/` holding metadata and nothing else,
/// so an entry whose archive is gone has no content anywhere.
#[test]
fn a_legacy_fantome_needs_its_archive_to_be_present() {
    let storage = tempfile::tempdir().unwrap();
    place_mod_files(storage.path(), "id-1", ModArchiveFormat::Fantome);

    let entry = make_test_entry("id-1", ModArchiveFormat::Fantome);
    assert!(entry.is_present(storage.path()));

    fs::remove_file(entry.archive_path(storage.path())).unwrap();
    assert!(!entry.is_present(storage.path()));
}

/// A fantome the user unpacked and whose archive later went missing is still
/// perfectly readable — its content is the directory.
#[test]
fn an_unpacked_mod_is_present_without_an_archive() {
    let storage = tempfile::tempdir().unwrap();
    place_unpacked_mod(storage.path(), "cool-skin", false);

    let entry = make_unpacked_entry("id-1", "cool-skin");
    assert!(entry.is_present(storage.path()));
}

/// A modpkg's content never leaves its archive, so losing it loses the mod.
#[test]
fn a_packed_mod_needs_its_archive_to_be_present() {
    let storage = tempfile::tempdir().unwrap();
    place_installed_mod(storage.path(), "cool-skin", ModArchiveFormat::Modpkg, false);

    let entry = make_slugged_entry("id-1", "cool-skin", ModArchiveFormat::Modpkg);
    assert!(!entry.is_present(storage.path()));

    fs::write(entry.archive_path(storage.path()), b"fake").unwrap();
    assert!(entry.is_present(storage.path()));
}

#[test]
fn a_legacy_entry_is_present_while_its_uuid_layout_is() {
    let storage = tempfile::tempdir().unwrap();
    place_mod_files(storage.path(), "id-1", ModArchiveFormat::Modpkg);

    let entry = make_test_entry("id-1", ModArchiveFormat::Modpkg);
    assert!(entry.is_present(storage.path()));

    fs::remove_file(entry.archive_path(storage.path())).unwrap();
    assert!(!entry.is_present(storage.path()));
}

fn write_newer_index(storage_dir: &Path) -> String {
    let newer = serde_json::json!({
        "version": schema_migration::CURRENT_VERSION + 1,
        "mods": [],
        "profiles": [],
        "activeProfileId": "p1"
    })
    .to_string();
    fs::write(library_index_path(storage_dir), &newer).unwrap();

    newer
}

#[test]
fn rebuild_newer_index_moves_newer_index_to_backup() {
    let dir = tempfile::tempdir().unwrap();
    let (library, config) = make_test_library(dir.path());
    let newer = write_newer_index(dir.path());

    library.rebuild_newer_index(&config).unwrap();

    let backup = LibraryIndex::backup_path(dir.path(), schema_migration::CURRENT_VERSION + 1);
    assert_eq!(fs::read_to_string(backup).unwrap(), newer);
    assert!(load_library_index(dir.path()).is_ok());
}

#[test]
fn rebuild_newer_index_adopts_mods_on_disk() {
    let dir = tempfile::tempdir().unwrap();
    let (library, config) = make_test_library(dir.path());
    library.record_layout_migration(LayoutMigrationState::Idle);
    write_newer_index(dir.path());
    place_unpacked_mod(dir.path(), "some-mod", false);

    library.rebuild_newer_index(&config).unwrap();

    let index = load_library_index(dir.path()).unwrap();
    assert_eq!(index.version, schema_migration::CURRENT_VERSION);
    assert_eq!(index.mods.len(), 1);
    assert_eq!(index.mods[0].slug.as_ref().unwrap().as_str(), "some-mod");
    assert_eq!(index.profiles.len(), 1);
}

#[test]
fn rebuild_newer_index_keeps_index_that_loads() {
    let dir = tempfile::tempdir().unwrap();
    let (library, config) = make_test_library(dir.path());
    library.record_layout_migration(LayoutMigrationState::Idle);
    place_unpacked_mod(dir.path(), "some-mod", false);
    seed_library(
        &library,
        &config,
        vec![make_unpacked_entry("id-1", "some-mod")],
    );

    library.rebuild_newer_index(&config).unwrap();

    let index = load_library_index(dir.path()).unwrap();
    assert_eq!(index.mods[0].id, "id-1");
    assert_eq!(index.profiles[0].id, "p1");
    assert!(!LibraryIndex::backup_path(dir.path(), schema_migration::CURRENT_VERSION).exists());
}
