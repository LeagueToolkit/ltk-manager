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
use std::path::Path;

/// Hold a path against writes, or let it go again.
fn hold(path: &Path, held: bool) {
    let mut perms = fs::metadata(path).unwrap().permissions();
    perms.set_readonly(held);
    fs::set_permissions(path, perms).unwrap();
}

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
    assert!(
        !storage.path().join("mods/unpacked-mod/.ltk").exists(),
        "a repair keeps no restore point - ADR-0006"
    );
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

/// Every table the project declares, merged the way a reader would see them.
fn embedded_names(mod_dir: &std::path::Path) -> ltk_hashtable::HashtableSet {
    let root = camino::Utf8Path::from_path(mod_dir).unwrap();
    let project = ltk_mod_project::ModProject::load(root).unwrap();
    ltk_hashtable::HashtableSet::build(project.hashtables.iter().map(|manifest| {
        let table = ltk_hashtable::Hashtable::from_reader(
            fs::File::open(root.join(&manifest.path)).unwrap(),
        )
        .unwrap();
        (manifest.to_entry().unwrap(), table)
    }))
}

/// Story: a repair hashes a path away, and the mod's own table is what reads
/// it back. This is what a repair keeping no restore point rests on.
#[test]
fn a_repaired_path_reads_back_out_of_the_mods_own_hashtable() {
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

    let report = library.repair_mod(&config, "id-1").unwrap();
    assert_eq!(report.applied, 1);

    let mod_dir = storage.path().join("mods").join("unpacked-mod");
    assert_eq!(
        embedded_names(&mod_dir).resolve_value(
            &ltk_hashtable::Category::Game,
            WadHash::hash_str(STALE_ICON).0
        ),
        Some(STALE_ICON),
        "the repaired path must resolve out of the mod's own hashes/"
    );
}

/// Story: a property whose path the mod's own table already keys to another
/// name is left alone, and the mod is still reported as needing repair.
///
/// The verdict comes from re-checking the repaired tree in memory, so a refusal
/// has to survive into it rather than being lost to arithmetic over counts.
#[test]
fn a_refused_property_leaves_the_mod_repairable() {
    use ltk_hashtable::{Algorithm, Category, Key, KeyWidth};

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

    // A table narrow enough for two names to share a key, holding a different
    // name on the one the repair would need. Sixty-four bits makes this
    // unreachable, which is the whole reason the guard is staged this way.
    let narrow = KeyWidth::new(8).unwrap();
    let claimed = Key::of(STALE_ICON, &Algorithm::Xxh64, narrow).unwrap();
    let twin = (0..)
        .map(|n| format!("ASSETS/twin{n}.dds"))
        .find(|name| Key::of(name, &Algorithm::Xxh64, narrow) == Some(claimed))
        .expect("eight bits is 256 keys");

    let mod_dir = storage.path().join("mods").join("unpacked-mod");
    let root = camino::Utf8Path::from_path(&mod_dir).unwrap();
    let mut project = ltk_mod_project::ModProject::load(root).unwrap();
    project.hashtables = vec![ltk_mod_project::ModProjectHashtable {
        path: "hashes/game.hashes.txt".to_owned(),
        category: Category::Game,
        algorithm: Algorithm::Xxh64,
        bits: narrow.bits(),
    }];
    fs::create_dir_all(mod_dir.join("hashes")).unwrap();
    fs::write(mod_dir.join("hashes/game.hashes.txt"), format!("{twin}\n")).unwrap();
    fs::write(
        mod_dir.join("mod.config.json"),
        project
            .to_config_string(ltk_mod_project::ConfigFormat::Json)
            .unwrap(),
    )
    .unwrap();

    let report = library.repair_mod(&config, "id-1").unwrap();

    assert_eq!(report.applied, 0);
    assert_eq!(report.skipped, 1);
    assert_eq!(
        report.remaining.len(),
        1,
        "the refused property is still there"
    );
    assert_eq!(
        library
            .mod_health_verdicts(&config)
            .unwrap()
            .get("id-1")
            .unwrap()
            .health,
        ModHealth::Repairable
    );
}

/// Story: a run called off leaves the mods it never reached with no verdict at
/// all, so the next sweep picks them up rather than trusting a partial answer.
#[test]
fn a_cancelled_run_records_no_verdict_for_the_mods_it_did_not_reach() {
    let storage = tempfile::tempdir().unwrap();
    let (library, mut config) = make_test_library(storage.path());
    point_at_installed_build(&mut config, storage.path());
    for slug in ["first-mod", "second-mod"] {
        place_bin_project_mod(storage.path(), slug, &stale_bin());
    }
    seed_library(
        &library,
        &config,
        vec![
            make_slugged_entry("id-1", "first-mod", ModArchiveFormat::Fantome),
            make_slugged_entry("id-2", "second-mod", ModArchiveFormat::Fantome),
        ],
    );

    library.cancel_mod_health_run();
    let cancelled = library.clone();
    // Cancelled the moment the run installs its budget, which is before the
    // first mod is picked up.
    std::thread::spawn(move || {
        for _ in 0..200 {
            cancelled.cancel_mod_health_run();
            std::thread::yield_now();
        }
    });

    let report = library.repair_mods(&config, &["id-1".to_string(), "id-2".to_string()]);

    assert!(
        report.repaired.is_empty() && report.failed.is_empty(),
        "a cancelled mod is neither repaired nor failed: {report:?}"
    );
    assert_eq!(report.cancelled.len(), 2);
    assert!(
        library.mod_health_verdicts(&config).unwrap().is_empty(),
        "a cancelled run concluded nothing, so it recorded nothing"
    );
}

/// Story: a rule that stopped never reached the files after the one it stopped
/// on, so their problems are neither applied nor reported as left. Deriving the
/// verdict from that would call a mod healthy that was never written to.
///
/// Staged with a read-only bin: the fix converts it in memory, the re-check
/// therefore finds nothing left, and only the write fails.
#[test]
fn a_repair_a_rule_stopped_does_not_report_the_mod_healthy() {
    let storage = tempfile::tempdir().unwrap();
    let (library, mut config) = make_test_library(storage.path());
    point_at_installed_build(&mut config, storage.path());
    place_bin_project_mod(storage.path(), "locked-mod", &stale_bin());
    seed_library(
        &library,
        &config,
        vec![make_slugged_entry(
            "id-1",
            "locked-mod",
            ModArchiveFormat::Fantome,
        )],
    );

    let bin = storage
        .path()
        .join("mods")
        .join("locked-mod")
        .join("content")
        .join("base")
        .join("Aatrox.wad.client")
        .join("data/skin0.bin");
    let data_dir = bin.parent().unwrap().to_path_buf();
    hold(&bin, true);
    hold(&data_dir, true);
    let report = library.repair_mod(&config, "id-1").unwrap();
    hold(&data_dir, false);
    hold(&bin, false);

    assert_eq!(report.applied, 0);
    assert!(!report.failed.is_empty(), "the write could not land");
    assert_eq!(
        library
            .mod_health_verdicts(&config)
            .unwrap()
            .get("id-1")
            .unwrap()
            .health,
        ModHealth::Repairable,
        "nothing was written, so nothing was repaired"
    );
}
