//! End-to-end tests at the repair seam: a library holding a fantome whose bin
//! carries a property type the migration table moves.

use crate::mods::ModHealth;
use crate::mods::index::{LibraryModEntry, ModArchiveFormat, ModStorage};
use crate::mods::test_support::{
    SILENT_BANK_IN_WAD, STALE_BIN_IN_WAD, STALE_ICON, healthy_bin, make_library_naming,
    make_slugged_entry, make_test_library, make_unpacked_entry, place_bin_archived_fantome,
    place_bin_project_mod, place_game_wad, place_installed_mod,
    place_packed_chunks_archived_fantome, place_packed_fantome_with_raw, point_at_installed_build,
    property_in_unpacked_tree, resolver_naming, seed_library, silent_audio_bank, stale_bin,
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
    make_slugged_entry(id, slug, ModArchiveFormat::Fantome)
}

fn migrated_property() -> PropertyValueEnum {
    PropertyValueEnum::WadChunkLink(values::WadChunkLink::new(WadHash::hash_str(STALE_ICON)))
}

/// Story: a mod whose events bank the game silently drops is repaired by
/// deleting it, and an archive-storage mod is repaired inside its archive.
///
/// The path it takes is the repack, because no archive delta can state a
/// deletion - and a repack packs the staged tree, which is the tree the
/// deletion already happened in.
#[test]
fn a_removed_bank_is_gone_from_the_repaired_archive() {
    const OTHER: &str = "assets/sounds/wwise2016/sfx/ashe_sfx_audio.bnk";

    let storage = tempfile::tempdir().unwrap();
    let (library, mut config) = make_library_naming(storage.path(), &[SILENT_BANK_IN_WAD, OTHER]);
    point_at_installed_build(&mut config, storage.path());
    place_game_wad(
        storage.path(),
        "Aatrox.wad.client",
        &[(SILENT_BANK_IN_WAD, b"the bank the game ships")],
    );
    place_packed_chunks_archived_fantome(
        storage.path(),
        "silent-mod",
        &[
            (SILENT_BANK_IN_WAD, &silent_audio_bank()),
            (OTHER, b"the media bank, which the reader takes"),
        ],
    );
    seed_library(
        &library,
        &config,
        vec![archived_entry("id-1", "silent-mod")],
    );

    let report = library.repair_mod(&config, "id-1").unwrap();

    assert_eq!(report.applied, 1);
    assert!(report.failed.is_empty(), "{:?}", report.failed);
    let removed = report
        .files
        .iter()
        .find(|file| file.path.ends_with("ashe_sfx_events.bnk"))
        .expect("the bank is in the report");
    assert_eq!(removed.change, crate::problems::FileChange::Removed);

    let archive = storage.path().join("mods").join("silent-mod.fantome");
    let left = crate::problems::ProjectFiles::in_archive(
        &archive,
        &config,
        crate::problems::Budget::repair(),
        &resolver_naming(&[SILENT_BANK_IN_WAD, OTHER]),
        None,
    )
    .unwrap();
    let paths: Vec<String> = left.files().map(|file| file.path().to_owned()).collect();

    assert_eq!(paths, [format!("Aatrox.wad.client/{OTHER}")]);
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
        vec![make_unpacked_entry("id-1", "unpacked-mod")],
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

/// Story: a verdict outlives the tables it was taken against, so a badge can be
/// on screen on a launch that has none. Pressing Repair there would apply what
/// it could, withhold what needs a name, and then record a verdict calling the
/// remainder unrepairable - the refusal ADR-0009 exists for, through the door
/// the check does not watch.
#[test]
fn a_repair_refuses_to_run_before_the_hashtables_are_there() {
    let storage = tempfile::tempdir().unwrap();
    let (library, mut config) =
        crate::mods::test_support::make_library_without_hashtables(storage.path());
    point_at_installed_build(&mut config, storage.path());
    place_bin_project_mod(storage.path(), "unpacked-mod", &stale_bin());
    seed_library(
        &library,
        &config,
        vec![make_unpacked_entry("id-1", "unpacked-mod")],
    );
    let before = property_in_unpacked_tree(storage.path(), "unpacked-mod");

    let refused = library.repair_mod(&config, "id-1");

    assert!(refused.is_err(), "a repair with no names must not write");
    assert_eq!(
        property_in_unpacked_tree(storage.path(), "unpacked-mod"),
        before,
        "the mod is left exactly as it was"
    );
    assert!(
        library.mod_health_verdicts(&config).unwrap().is_empty(),
        "and it records no verdict the run could not earn"
    );
}

/// Repair all refuses as one run rather than as a column of identical failures.
/// The per-mod gate would catch every mod anyway, so this exists for what the
/// reader is handed: one sentence that is true of the whole press.
#[test]
fn repairing_many_refuses_as_one_before_the_hashtables_are_there() {
    let storage = tempfile::tempdir().unwrap();
    let (library, mut config) =
        crate::mods::test_support::make_library_without_hashtables(storage.path());
    point_at_installed_build(&mut config, storage.path());
    place_bin_project_mod(storage.path(), "stale-mod", &stale_bin());
    place_bin_project_mod(storage.path(), "other-mod", &stale_bin());
    seed_library(
        &library,
        &config,
        vec![
            make_unpacked_entry("id-1", "stale-mod"),
            make_unpacked_entry("id-2", "other-mod"),
        ],
    );

    let refused = library.repair_mods(&config, &["id-1".to_string(), "id-2".to_string()]);

    assert!(refused.is_err(), "the run does not start at all");
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
            make_unpacked_entry("id-stale", "stale-mod"),
            make_unpacked_entry("id-fine", "fine-mod"),
            make_slugged_entry("id-pkg", "packed-mod", ModArchiveFormat::Modpkg),
        ],
    );

    let report = library
        .repair_mods(
            &config,
            &[
                "id-stale".to_string(),
                "id-fine".to_string(),
                "id-pkg".to_string(),
            ],
        )
        .unwrap();

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

/// Story: the crashing mod from the Discord reports. Its packed WAD holds a
/// stale bin no table names, and one Repair press has to reach it.
///
/// The chunk is addressed by hash the whole way through: the unpack writes it
/// as bare hex under `NamingPolicy::Lossless`, the tree reads it as a bin by
/// its first bytes, and the delta puts the fixed bytes back into the chunk that
/// hex names. Nothing in that chain needs a hashtable, which is the point - the
/// user whose cache is empty is the user this mod crashes.
#[test]
fn repairing_a_packed_fantome_no_table_names_reaches_the_bin_by_its_hash() {
    let storage = tempfile::tempdir().unwrap();
    let (library, mut config) = make_test_library(storage.path());
    point_at_installed_build(&mut config, storage.path());
    crate::mods::test_support::place_packed_bin_archived_fantome(
        storage.path(),
        "packed-mod",
        &stale_bin(),
    );
    seed_library(
        &library,
        &config,
        vec![archived_entry("id-1", "packed-mod")],
    );

    let report = library.repair_mod(&config, "id-1").unwrap();

    assert_eq!(report.applied, 1);

    // Re-checked against the archive where it lies, so the repair reached the
    // chunk itself rather than a tree beside it.
    let verdict = library.check_mod_health(&config, "id-1").unwrap();
    assert_eq!(verdict.health, ModHealth::Healthy);
    assert_eq!(verdict.fixable, 0);

    let left: Vec<String> = fs::read_dir(storage.path().join("mods"))
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert!(
        !left
            .iter()
            .any(|name| name.starts_with(crate::mods::archive::install::STAGING_PREFIX)),
        "the repair cleared its staging and the re-check opened none: {left:?}"
    );
}

/// Story: the same crashing mod, once its owner has unpacked it. The bin sits
/// in the tree under the bare hex the import wrote, and Repair has to reach it
/// there too.
#[test]
fn repairing_a_project_mod_reaches_a_bin_under_its_bare_hash() {
    let storage = tempfile::tempdir().unwrap();
    let (library, mut config) = make_test_library(storage.path());
    point_at_installed_build(&mut config, storage.path());
    let hex = crate::mods::test_support::place_hex_named_bin_project_mod(
        storage.path(),
        "unpacked-mod",
        &stale_bin(),
    );
    seed_library(
        &library,
        &config,
        vec![make_unpacked_entry("id-1", "unpacked-mod")],
    );

    let report = library.repair_mod(&config, "id-1").unwrap();

    assert_eq!(report.applied, 1);
    assert_eq!(
        report.files[0].path,
        format!("Aatrox.wad.client/{hex}"),
        "the fix writes the file at the address the check named"
    );
    assert_eq!(
        property_at(storage.path(), "unpacked-mod", &hex),
        migrated_property()
    );
}

/// Story: a repair hashes a path away whether or not a table ever named the
/// bin holding it, so the mod's own `hashes/` is what reads it back either way.
///
/// The chunk-addressed half of
/// [`a_repaired_path_reads_back_out_of_the_mods_own_hashtable`], which is what
/// a repair keeping no restore point rests on - ADR-0006.
#[test]
fn a_path_repaired_inside_a_nameless_chunk_is_kept_in_the_archives_own_table() {
    let storage = tempfile::tempdir().unwrap();
    let (library, mut config) = make_test_library(storage.path());
    point_at_installed_build(&mut config, storage.path());
    crate::mods::test_support::place_packed_bin_archived_fantome(
        storage.path(),
        "packed-mod",
        &stale_bin(),
    );
    seed_library(
        &library,
        &config,
        vec![archived_entry("id-1", "packed-mod")],
    );

    assert_eq!(library.repair_mod(&config, "id-1").unwrap().applied, 1);

    // Read back out of the archive rather than a tree beside it: the edit has
    // to carry the table into the mod the user still has.
    library
        .set_mod_storage(&config, "id-1", ModStorage::Project)
        .unwrap();
    let mod_dir = storage.path().join("mods").join("packed-mod");
    assert_eq!(
        embedded_names(&mod_dir).resolve_value(
            &ltk_hashtable::Category::Game,
            WadHash::hash_str(STALE_ICON).0
        ),
        Some(STALE_ICON),
        "the repaired path must resolve out of the mod's own hashes/"
    );
}

/// The one property of a hex-named bin, read back out of the mod's tree.
fn property_at(storage_dir: &Path, slug: &str, hex: &str) -> PropertyValueEnum {
    let bin_path = storage_dir
        .join("mods")
        .join(slug)
        .join("content")
        .join("base")
        .join("Aatrox.wad.client")
        .join(hex);
    let bin = ltk_meta::Bin::from_reader(&mut fs::File::open(&bin_path).unwrap()).unwrap();
    bin.objects
        .get(&crate::mods::test_support::STALE_ENTRY)
        .unwrap()
        .properties
        .get(&crate::mods::test_support::ICON_AVATAR)
        .unwrap()
        .clone()
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
        vec![make_unpacked_entry("id-1", "unpacked-mod")],
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
        vec![make_unpacked_entry("id-1", "unpacked-mod")],
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

/// Every entry the archive at `path` holds, by name.
fn entry_names(path: &Path) -> Vec<String> {
    let mut archive = zip::ZipArchive::new(fs::File::open(path).unwrap()).unwrap();
    (0..archive.len())
        .map(|index| archive.by_index(index).unwrap().name().to_owned())
        .collect()
}

/// Story: the shape a mod ships in - one packed WAD - repaired by editing the
/// archive rather than packing the mod again.
///
/// The `RAW/` entry is the tell. Fantome packs the base layer's WAD directories
/// and nothing else, so a repack drops it where an edit raw-copies everything
/// the fixes did not name.
#[test]
fn repairing_a_packed_fantome_edits_it_and_leaves_the_rest_alone() {
    let storage = tempfile::tempdir().unwrap();
    let (library, mut config) = make_library_naming(storage.path(), &[STALE_BIN_IN_WAD]);
    point_at_installed_build(&mut config, storage.path());
    place_packed_fantome_with_raw(
        storage.path(),
        "packed-mod",
        &stale_bin(),
        ("config.ini", b"kept"),
    );
    seed_library(
        &library,
        &config,
        vec![archived_entry("id-1", "packed-mod")],
    );
    let archive = storage.path().join("mods").join("packed-mod.fantome");

    let report = library.repair_mod(&config, "id-1").unwrap();

    assert_eq!(report.applied, 1);
    assert!(report.failed.is_empty());

    let names = entry_names(&archive);
    assert!(
        names.iter().any(|name| name == "RAW/config.ini"),
        "an edit raw-copies what it did not name: {names:?}"
    );
    assert!(
        names.iter().any(|name| name == "WAD/Aatrox.wad.client"),
        "the WAD stays one packed entry: {names:?}"
    );

    library
        .set_mod_storage(&config, "id-1", ModStorage::Project)
        .unwrap();
    assert_eq!(
        property_in_unpacked_tree(storage.path(), "packed-mod"),
        migrated_property(),
    );
}

/// Story: an archive-storage repair keeps the names it hashed away, the same
/// promise ADR-0006 makes for a project. The table and the metadata declaring
/// it have to reach the archive for the mod to read its own hash back.
#[test]
fn a_repaired_archive_reads_its_own_names_back_after_a_round_trip() {
    let storage = tempfile::tempdir().unwrap();
    let (library, mut config) = make_library_naming(storage.path(), &[STALE_BIN_IN_WAD]);
    point_at_installed_build(&mut config, storage.path());
    place_packed_fantome_with_raw(
        storage.path(),
        "packed-mod",
        &stale_bin(),
        ("config.ini", b"kept"),
    );
    seed_library(
        &library,
        &config,
        vec![archived_entry("id-1", "packed-mod")],
    );

    assert_eq!(library.repair_mod(&config, "id-1").unwrap().names_kept, 1);

    library
        .set_mod_storage(&config, "id-1", ModStorage::Project)
        .unwrap();
    let mod_dir = storage.path().join("mods").join("packed-mod");
    assert_eq!(
        embedded_names(&mod_dir).resolve_value(
            &ltk_hashtable::Category::Game,
            WadHash::hash_str(STALE_ICON).0
        ),
        Some(STALE_ICON),
        "the repaired path must survive into the archive's own table"
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
            make_unpacked_entry("id-1", "first-mod"),
            make_unpacked_entry("id-2", "second-mod"),
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

    let report = library
        .repair_mods(&config, &["id-1".to_string(), "id-2".to_string()])
        .unwrap();

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
        vec![make_unpacked_entry("id-1", "locked-mod")],
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
