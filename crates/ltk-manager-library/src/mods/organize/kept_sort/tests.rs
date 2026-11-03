use super::*;
use crate::mods::StorageLayout as _;
use crate::mods::index::ModArchiveFormat;
use crate::mods::test_support::{
    make_slugged_entry, make_test_library, place_installed_mod, seed_library,
};
use crate::mods::types::ROOT_FOLDER_ID;
use chrono::TimeZone;
use fs_err as fs;
use std::collections::HashMap;

fn ids(names: &[&str]) -> Vec<String> {
    names.iter().map(|name| name.to_string()).collect()
}

fn keys() -> HashMap<&'static str, SortKey> {
    let at = |day: u32| Utc.with_ymd_and_hms(2026, 1, day, 0, 0, 0).unwrap();
    HashMap::from([
        (
            "ahri",
            SortKey {
                name: "ahri skin".into(),
                champion: Some("ahri".into()),
                installed_at: at(3),
                enabled: false,
            },
        ),
        (
            "zed",
            SortKey {
                name: "zed skin".into(),
                champion: Some("zed".into()),
                installed_at: at(1),
                enabled: true,
            },
        ),
        (
            "hud",
            SortKey {
                name: "hud".into(),
                champion: None,
                installed_at: at(2),
                enabled: true,
            },
        ),
    ])
}

fn sort(field: KeptSortField, direction: SortDirection) -> KeptSort {
    KeptSort { field, direction }
}

#[test]
fn kept_order_sorts_by_name_either_way() {
    let keys = keys();
    let key_of = |id: &str| keys[id].clone();
    let mods = ids(&["zed", "ahri", "hud"]);

    let asc = kept_order(&mods, sort(KeptSortField::Name, SortDirection::Asc), key_of);
    assert_eq!(asc, ids(&["ahri", "hud", "zed"]));

    let desc = kept_order(
        &mods,
        sort(KeptSortField::Name, SortDirection::Desc),
        key_of,
    );
    assert_eq!(desc, ids(&["zed", "hud", "ahri"]));
}

#[test]
fn kept_order_keeps_a_mod_without_a_champion_last_either_way() {
    let keys = keys();
    let key_of = |id: &str| keys[id].clone();
    let mods = ids(&["hud", "zed", "ahri"]);

    let asc = kept_order(
        &mods,
        sort(KeptSortField::Champion, SortDirection::Asc),
        key_of,
    );
    assert_eq!(asc, ids(&["ahri", "zed", "hud"]));

    let desc = kept_order(
        &mods,
        sort(KeptSortField::Champion, SortDirection::Desc),
        key_of,
    );
    assert_eq!(desc, ids(&["zed", "ahri", "hud"]));
}

#[test]
fn kept_order_sorts_by_install_time_and_enabled_first() {
    let keys = keys();
    let key_of = |id: &str| keys[id].clone();
    let mods = ids(&["ahri", "zed", "hud"]);

    let newest = kept_order(
        &mods,
        sort(KeptSortField::InstalledAt, SortDirection::Desc),
        key_of,
    );
    assert_eq!(newest, ids(&["ahri", "hud", "zed"]));

    let enabled = kept_order(
        &mods,
        sort(KeptSortField::Enabled, SortDirection::Asc),
        key_of,
    );
    assert_eq!(enabled, ids(&["zed", "hud", "ahri"]));
}

#[test]
fn kept_order_keeps_the_order_of_equal_keys() {
    let same = |_: &str| SortKey {
        name: "same".into(),
        champion: None,
        installed_at: DateTime::<Utc>::MIN_UTC,
        enabled: false,
    };
    let mods = ids(&["c", "a", "b"]);

    assert_eq!(
        kept_order(&mods, sort(KeptSortField::Name, SortDirection::Desc), same),
        mods
    );
}

/// A library of three installed mods whose display names are their slugs.
fn seeded_library() -> (tempfile::TempDir, ModLibrary, Config) {
    let dir = tempfile::tempdir().unwrap();
    let (library, config) = make_test_library(dir.path());
    for slug in ["charlie", "alpha", "bravo"] {
        place_installed_mod(dir.path(), slug, ModArchiveFormat::Fantome, true);
    }
    seed_library(
        &library,
        &config,
        ["charlie", "alpha", "bravo"]
            .into_iter()
            .map(|slug| make_slugged_entry(slug, slug, ModArchiveFormat::Fantome))
            .collect(),
    );
    (dir, library, config)
}

fn root_order(library: &ModLibrary, config: &Config) -> Vec<String> {
    library
        .with_index(config, |_, index| Ok(index.folders[0].mod_ids.clone()))
        .unwrap()
}

#[test]
fn set_kept_sort_sorts_the_folder_and_rederives_the_profile() {
    let (_dir, library, config) = seeded_library();

    library
        .set_kept_sort(
            &config,
            &[ROOT_FOLDER_ID.to_string()],
            Some(sort(KeptSortField::Name, SortDirection::Asc)),
        )
        .unwrap();

    assert_eq!(
        root_order(&library, &config),
        ids(&["alpha", "bravo", "charlie"])
    );
    library
        .with_index(&config, |_, index| {
            assert_eq!(
                index.profiles[0].mod_order,
                ids(&["alpha", "bravo", "charlie"])
            );
            assert_eq!(
                index.profiles[0].enabled_mods,
                ids(&["alpha", "bravo", "charlie"])
            );
            Ok(())
        })
        .unwrap();
}

#[test]
fn set_kept_sort_rejects_an_unknown_folder() {
    let (_dir, library, config) = seeded_library();

    let result = library.set_kept_sort(
        &config,
        &["missing".to_string()],
        Some(sort(KeptSortField::Name, SortDirection::Asc)),
    );

    assert!(matches!(result, Err(AppError::ValidationFailed(_))));
}

#[test]
fn a_renamed_mod_moves_to_its_place_in_a_kept_folder() {
    let (_dir, library, config) = seeded_library();
    library
        .set_kept_sort(
            &config,
            &[ROOT_FOLDER_ID.to_string()],
            Some(sort(KeptSortField::Name, SortDirection::Asc)),
        )
        .unwrap();

    library
        .edit_mod_metadata(
            &config,
            "alpha",
            crate::mods::types::EditModMetadataArgs {
                display_name: Some("Zulu".to_string()),
                tags: None,
                champions: None,
                maps: None,
                set_thumbnail_path: None,
                remove_thumbnail: None,
            },
        )
        .unwrap();

    assert_eq!(
        root_order(&library, &config),
        ids(&["bravo", "charlie", "alpha"])
    );
}

#[test]
fn a_mod_moved_into_a_kept_folder_takes_its_place() {
    let (_dir, library, config) = seeded_library();
    let folder = library.create_folder(&config, "Skins").unwrap();
    library
        .move_mod_to_folder(&config, "charlie", &folder.id)
        .unwrap();
    library
        .set_kept_sort(
            &config,
            std::slice::from_ref(&folder.id),
            Some(sort(KeptSortField::Name, SortDirection::Asc)),
        )
        .unwrap();

    library
        .move_mod_to_folder(&config, "alpha", &folder.id)
        .unwrap();

    library
        .with_index(&config, |_, index| {
            let kept = index.folders.iter().find(|f| f.id == folder.id).unwrap();
            assert_eq!(kept.mod_ids, ids(&["alpha", "charlie"]));
            Ok(())
        })
        .unwrap();
}

#[test]
fn enabling_a_mod_moves_it_up_in_an_enabled_first_folder() {
    let (_dir, library, config) = seeded_library();
    library
        .toggle_mod_enabled(&config, "charlie", false)
        .unwrap();
    library.toggle_mod_enabled(&config, "alpha", false).unwrap();
    library
        .set_kept_sort(
            &config,
            &[ROOT_FOLDER_ID.to_string()],
            Some(sort(KeptSortField::Enabled, SortDirection::Asc)),
        )
        .unwrap();
    assert_eq!(
        root_order(&library, &config),
        ids(&["bravo", "charlie", "alpha"])
    );

    library.toggle_mod_enabled(&config, "alpha", true).unwrap();

    assert_eq!(
        root_order(&library, &config),
        ids(&["bravo", "alpha", "charlie"])
    );
}

#[test]
fn a_reorder_by_hand_clears_the_kept_sort_it_changes() {
    let (_dir, library, config) = seeded_library();
    library
        .set_kept_sort(
            &config,
            &[ROOT_FOLDER_ID.to_string()],
            Some(sort(KeptSortField::Name, SortDirection::Asc)),
        )
        .unwrap();

    let unchanged = library
        .reorder_folder_mods(&config, ROOT_FOLDER_ID, ids(&["alpha", "bravo", "charlie"]))
        .unwrap();
    assert!(unchanged.cleared_kept_sorts.is_empty());

    let changed = library
        .reorder_mods(&config, ids(&["charlie", "alpha", "bravo"]))
        .unwrap();
    assert_eq!(
        changed.cleared_kept_sorts,
        vec![ClearedKeptSort {
            folder_id: ROOT_FOLDER_ID.to_string(),
            folder_name: String::new(),
            kept_sort: sort(KeptSortField::Name, SortDirection::Asc),
        }]
    );
    library
        .with_index(&config, |_, index| {
            assert_eq!(index.kept_sort_of(ROOT_FOLDER_ID), None);
            Ok(())
        })
        .unwrap();
}

#[test]
fn a_mod_whose_config_does_not_read_sorts_first_by_name() {
    let (dir, library, config) = seeded_library();
    fs::remove_file(dir.path().mods_dir().join("bravo").join("mod.config.json")).unwrap();

    library
        .set_kept_sort(
            &config,
            &[ROOT_FOLDER_ID.to_string()],
            Some(sort(KeptSortField::Name, SortDirection::Asc)),
        )
        .unwrap();

    assert_eq!(
        root_order(&library, &config),
        ids(&["bravo", "alpha", "charlie"])
    );
}
