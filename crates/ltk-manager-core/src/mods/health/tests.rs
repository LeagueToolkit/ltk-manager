//! End-to-end tests at the check seam: verdicts over the same stale-bin
//! fixtures the repair suite uses.

use super::*;
use crate::mods::index::{LibraryModEntry, ModArchiveFormat, ModStorage};
use crate::mods::test_support::{
    make_slugged_entry, make_test_library, place_bin_archived_fantome, point_at_installed_build,
    seed_library, stale_bin,
};
use std::fs;

fn archived_entry(id: &str, slug: &str) -> LibraryModEntry {
    LibraryModEntry {
        storage: ModStorage::Archive,
        ..make_slugged_entry(id, slug, ModArchiveFormat::Fantome)
    }
}

#[test]
fn checking_a_stale_archived_fantome_reports_it_repairable_and_remembers() {
    let storage = tempfile::tempdir().unwrap();
    let (library, mut config) = make_test_library(storage.path());
    point_at_installed_build(&mut config, storage.path());
    place_bin_archived_fantome(storage.path(), "stale-mod", &stale_bin());
    seed_library(&library, &config, vec![archived_entry("id-1", "stale-mod")]);
    let archive = storage.path().join("mods").join("stale-mod.fantome");
    let before = fs::read(&archive).unwrap();

    let verdict = library.check_mod_health(&config, "id-1").unwrap();

    assert_eq!(verdict.health, ModHealth::Repairable);
    assert_eq!(verdict.fixable, 1);
    assert_eq!(fs::read(&archive).unwrap(), before, "a check never writes");

    let verdicts = library.mod_health_verdicts(&config).unwrap();
    assert_eq!(verdicts.get("id-1").unwrap(), &verdict);
}

#[test]
fn checking_a_stale_project_mod_reports_it_repairable() {
    let storage = tempfile::tempdir().unwrap();
    let (library, mut config) = make_test_library(storage.path());
    point_at_installed_build(&mut config, storage.path());
    crate::mods::test_support::place_bin_project_mod(storage.path(), "unpacked-mod", &stale_bin());
    seed_library(
        &library,
        &config,
        vec![make_slugged_entry(
            "id-1",
            "unpacked-mod",
            ModArchiveFormat::Fantome,
        )],
    );

    let verdict = library.check_mod_health(&config, "id-1").unwrap();

    assert_eq!(verdict.health, ModHealth::Repairable);
    assert_eq!(verdict.fixable, 1);
}

/// Story: one unreadable mod does not cost the user the rest of the sweep.
#[test]
fn checking_many_skips_the_mod_it_cannot_read() {
    let storage = tempfile::tempdir().unwrap();
    let (library, mut config) = make_test_library(storage.path());
    point_at_installed_build(&mut config, storage.path());
    place_bin_archived_fantome(storage.path(), "good-mod", &stale_bin());
    // An archive-storage entry whose archive is gone is a mod the check
    // cannot read.
    let broken_dir = storage.path().join("mods").join("broken-mod");
    fs::create_dir_all(&broken_dir).unwrap();
    fs::write(broken_dir.join("mod.config.json"), "{}").unwrap();
    seed_library(
        &library,
        &config,
        vec![
            archived_entry("id-broken", "broken-mod"),
            archived_entry("id-good", "good-mod"),
        ],
    );

    let recorded =
        library.check_mods_health(&config, &["id-broken".to_string(), "id-good".to_string()]);

    assert_eq!(recorded, 1);
    let verdicts = library.mod_health_verdicts(&config).unwrap();
    assert_eq!(
        verdicts.get("id-good").unwrap().health,
        ModHealth::Repairable
    );
    assert!(!verdicts.contains_key("id-broken"));
}

/// Story: a repaired mod's badge updates without the user asking for a
/// re-check — the repair already analyzed the mod, so the verdict rides along.
#[test]
fn a_repair_refreshes_the_stored_verdict() {
    let storage = tempfile::tempdir().unwrap();
    let (library, mut config) = make_test_library(storage.path());
    point_at_installed_build(&mut config, storage.path());
    place_bin_archived_fantome(storage.path(), "stale-mod", &stale_bin());
    seed_library(&library, &config, vec![archived_entry("id-1", "stale-mod")]);

    let checked = library.check_mod_health(&config, "id-1").unwrap();
    assert_eq!(checked.health, ModHealth::Repairable);

    library.repair_mod(&config, "id-1").unwrap();

    let verdicts = library.mod_health_verdicts(&config).unwrap();
    assert_eq!(verdicts.get("id-1").unwrap().health, ModHealth::Healthy);
}
