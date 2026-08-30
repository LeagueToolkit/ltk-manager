//! The library sweep: what it re-checks, what it leaves alone, and what it
//! forgets.

use super::*;
use crate::events::BackendEvent;
use crate::mods::index::{LibraryModEntry, ModArchiveFormat};
use crate::mods::test_support::{
    RecordingEventSink, healthy_bin, make_library_with_events, make_library_with_version,
    make_slugged_entry, make_test_library, make_unpacked_entry, place_bin_archived_fantome,
    place_bin_project_mod, place_installed_mod, point_at_build, point_at_installed_build,
    seed_library, stale_bin,
};
use crate::problems::Counts;
use assert_matches::assert_matches;
use std::fs;
use std::sync::Arc;

fn project_entry(id: &str, slug: &str) -> LibraryModEntry {
    make_unpacked_entry(id, slug)
}

fn archived_entry(id: &str, slug: &str) -> LibraryModEntry {
    make_slugged_entry(id, slug, ModArchiveFormat::Fantome)
}

/// Story: the user opens the manager after a patch and learns, without asking,
/// which of their mods the patch broke.
#[test]
fn a_first_sweep_checks_every_mod_and_names_the_broken_ones() {
    let storage = tempfile::tempdir().unwrap();
    let (library, mut config) = make_test_library(storage.path());
    point_at_installed_build(&mut config, storage.path());
    place_bin_project_mod(storage.path(), "stale-mod", &stale_bin());
    place_bin_project_mod(storage.path(), "fine-mod", &healthy_bin());
    seed_library(
        &library,
        &config,
        vec![
            project_entry("id-stale", "stale-mod"),
            project_entry("id-fine", "fine-mod"),
        ],
    );

    let report = library.sweep_mod_health(&config).unwrap();

    assert_eq!(report.checked, 2);
    assert_eq!(report.skipped, 0);
    assert_eq!(report.repairable, vec!["id-stale".to_string()]);
    assert!(report.unrepairable.is_empty());
    assert_matches!(
        library.health_sweep_state(),
        HealthSweepState::Finished { report } if report.checked == 2
    );
}

/// Story: the user folds a broken mod's row open and reads which rules
/// objected, by title and count, without being sent to the Problems panel.
#[test]
fn a_verdict_names_the_rules_behind_its_counts() {
    let storage = tempfile::tempdir().unwrap();
    let (library, mut config) = make_test_library(storage.path());
    point_at_installed_build(&mut config, storage.path());
    place_bin_project_mod(storage.path(), "stale-mod", &stale_bin());
    seed_library(&library, &config, vec![project_entry("id-1", "stale-mod")]);

    library.sweep_mod_health(&config).unwrap();

    let verdicts = library.mod_health_verdicts(&config).unwrap();
    let verdict = &verdicts["id-1"];
    assert_eq!(verdict.rules.len(), 1);
    let brief = &verdict.rules[0];
    assert!(!brief.rule.is_empty());
    assert!(!brief.title.is_empty());
    assert!(!brief.description.is_empty());
    let total = verdict.counts.fatals
        + verdict.counts.errors
        + verdict.counts.warnings
        + verdict.counts.infos;
    assert_eq!(brief.count, total);
    assert_eq!(brief.fixable, verdict.fixable);
}

/// Story: nothing about the game or the manager moved, so the second launch
/// costs the user nothing and draws no banner.
#[test]
fn a_second_sweep_on_the_same_basis_re_checks_nothing() {
    let storage = tempfile::tempdir().unwrap();
    let (library, mut config) = make_test_library(storage.path());
    point_at_installed_build(&mut config, storage.path());
    place_bin_project_mod(storage.path(), "stale-mod", &stale_bin());
    seed_library(&library, &config, vec![project_entry("id-1", "stale-mod")]);

    library.sweep_mod_health(&config).unwrap();
    let again = library.sweep_mod_health(&config).unwrap();

    assert_eq!(again.checked, 0);
    assert_eq!(again.skipped, 1);
    // The mod is still broken, so the report still names it — a sweep that
    // checked nothing is not a library with nothing wrong.
    assert_eq!(again.repairable, vec!["id-1".to_string()]);
    assert_matches!(library.health_sweep_state(), HealthSweepState::Idle);
}

/// Story: the trigger the whole feature exists for. Riot ships a patch, and
/// every verdict taken on the old build is asked again.
#[test]
fn a_game_patch_makes_every_verdict_due_again() {
    let storage = tempfile::tempdir().unwrap();
    let (library, mut config) = make_test_library(storage.path());
    point_at_build(&mut config, storage.path(), "16.16.8049184");
    place_bin_project_mod(storage.path(), "stale-mod", &stale_bin());
    seed_library(&library, &config, vec![project_entry("id-1", "stale-mod")]);

    let before = library.sweep_mod_health(&config).unwrap();
    // On the older build the retype rule is dormant, so its findings are not
    // live and the mod reads healthy.
    assert!(before.repairable.is_empty());

    point_at_build(&mut config, storage.path(), "16.17.8087655");
    let after = library.sweep_mod_health(&config).unwrap();

    assert_eq!(after.checked, 1);
    assert_eq!(after.repairable, vec!["id-1".to_string()]);
}

/// Story: a manager release ships a new migration table, so the rules know
/// something they did not last launch — even on the same game build.
#[test]
fn a_manager_release_makes_every_verdict_due_again() {
    let storage = tempfile::tempdir().unwrap();
    let (library, mut config) = make_test_library(storage.path());
    point_at_installed_build(&mut config, storage.path());
    place_bin_project_mod(storage.path(), "stale-mod", &stale_bin());
    seed_library(&library, &config, vec![project_entry("id-1", "stale-mod")]);
    library.sweep_mod_health(&config).unwrap();

    let (updated, _) = make_library_with_version(storage.path(), "next-release");

    let report = updated.sweep_mod_health(&config).unwrap();

    assert_eq!(report.checked, 1);
    assert_eq!(report.skipped, 0);
}

/// Story: the release that adds a rule lands, and a library of healthy badges
/// taken by the old rule set does not keep them.
///
/// The mechanism is the basis, and the badge is what makes it worth pinning
/// separately: a sweep that re-checked and then left the stored verdict alone
/// would satisfy the count above and still show the user the wrong word.
#[test]
fn a_verdict_taken_by_an_older_rule_set_loses_its_badge_on_the_next_sweep() {
    let storage = tempfile::tempdir().unwrap();
    let (library, mut config) = make_test_library(storage.path());
    point_at_installed_build(&mut config, storage.path());
    place_bin_project_mod(storage.path(), "stale-mod", &stale_bin());
    seed_library(&library, &config, vec![project_entry("id-1", "stale-mod")]);
    library.sweep_mod_health(&config).unwrap();

    // The library as the previous release left it: checked, and checked by
    // rules that had nothing to say about this mod.
    let mut file = VerdictFile::load(storage.path());
    for verdict in file.verdicts.values_mut() {
        verdict.health = ModHealth::Healthy;
        verdict.counts = Counts::default();
        verdict.fixable = 0;
        verdict.rules.clear();
        verdict.basis.manager = "the release before".to_owned();
    }
    file.save(storage.path()).unwrap();

    let report = library.sweep_mod_health(&config).unwrap();

    assert_eq!(report.checked, 1);
    assert_eq!(report.repairable, vec!["id-1".to_string()]);
    let held = VerdictFile::load(storage.path());
    assert_eq!(held.verdicts["id-1"].health, ModHealth::Repairable);
}

/// Story: the user syncs the hashtables in Settings, and the badges refresh
/// without waiting for the next game patch.
///
/// A verdict taken against an empty cache is the one that reads Healthy on a
/// mod that crashes the game, so a sync has to be able to disprove it.
#[test]
fn a_verdict_taken_against_other_hashtables_is_due_again() {
    let storage = tempfile::tempdir().unwrap();
    let (library, mut config) = make_test_library(storage.path());
    point_at_installed_build(&mut config, storage.path());
    place_bin_project_mod(storage.path(), "stale-mod", &stale_bin());
    seed_library(&library, &config, vec![project_entry("id-1", "stale-mod")]);
    library.sweep_mod_health(&config).unwrap();
    assert_eq!(library.sweep_mod_health(&config).unwrap().checked, 0);

    let mut file = VerdictFile::load(storage.path());
    for verdict in file.verdicts.values_mut() {
        verdict.basis.tables = Some("the cache before the sync".to_owned());
    }
    file.save(storage.path()).unwrap();

    assert_eq!(library.sweep_mod_health(&config).unwrap().checked, 1);
}

/// Story: the fresh install with no network. Nothing is checked and nothing is
/// badged, because every verdict the sweep could take would misjudge what a
/// repair reaches - and a library that says nothing beats one that says the
/// wrong thing.
#[test]
fn a_sweep_stands_down_before_the_hashtables_are_there() {
    let storage = tempfile::tempdir().unwrap();
    let (library, mut config) =
        crate::mods::test_support::make_library_without_hashtables(storage.path());
    point_at_installed_build(&mut config, storage.path());
    place_bin_project_mod(storage.path(), "stale-mod", &stale_bin());
    seed_library(&library, &config, vec![project_entry("id-1", "stale-mod")]);

    let report = library.sweep_mod_health(&config).unwrap();

    assert_eq!(report.checked, 0);
    assert!(report.repairable.is_empty());
    assert!(library.mod_health_verdicts(&config).unwrap().is_empty());
    assert_matches!(library.health_sweep_state(), HealthSweepState::Idle);
}

/// A mod the library dropped still loses its verdict, because that is true
/// whatever the hashtables hold.
#[test]
fn a_sweep_that_stands_down_still_prunes() {
    let storage = tempfile::tempdir().unwrap();
    let (library, mut config) = make_test_library(storage.path());
    point_at_installed_build(&mut config, storage.path());
    place_bin_project_mod(storage.path(), "stale-mod", &stale_bin());
    seed_library(&library, &config, vec![project_entry("id-1", "stale-mod")]);
    library.sweep_mod_health(&config).unwrap();

    let (unsynced, _) = crate::mods::test_support::make_library_without_hashtables(storage.path());
    seed_library(&unsynced, &config, Vec::new());
    unsynced.sweep_mod_health(&config).unwrap();

    assert!(library.mod_health_verdicts(&config).unwrap().is_empty());
}

/// Story: the cache under its old name is not left behind in the user's
/// storage directory for good.
#[test]
fn a_sweep_removes_the_verdict_cache_written_under_its_old_name() {
    let storage = tempfile::tempdir().unwrap();
    let (library, mut config) = make_test_library(storage.path());
    point_at_installed_build(&mut config, storage.path());
    place_bin_project_mod(storage.path(), "stale-mod", &stale_bin());
    seed_library(&library, &config, vec![project_entry("id-1", "stale-mod")]);
    let legacy = storage.path().join("check-verdicts.json");
    fs::write(&legacy, r#"{"version":0,"verdicts":{}}"#).unwrap();

    library.sweep_mod_health(&config).unwrap();

    assert!(!legacy.exists());
    assert!(
        storage.path().join("mod-health-verdicts.json").is_file(),
        "the cache under the current name is what the sweep wrote"
    );
}

/// Story: a mod uninstalled last week does not keep a verdict forever.
#[test]
fn a_sweep_forgets_the_verdict_of_a_mod_the_library_no_longer_holds() {
    let storage = tempfile::tempdir().unwrap();
    let (library, mut config) = make_test_library(storage.path());
    point_at_installed_build(&mut config, storage.path());
    place_bin_project_mod(storage.path(), "stale-mod", &stale_bin());
    place_bin_project_mod(storage.path(), "gone-mod", &stale_bin());
    seed_library(
        &library,
        &config,
        vec![
            project_entry("id-keeps", "stale-mod"),
            project_entry("id-goes", "gone-mod"),
        ],
    );
    library.sweep_mod_health(&config).unwrap();
    assert!(
        library
            .mod_health_verdicts(&config)
            .unwrap()
            .contains_key("id-goes")
    );

    seed_library(
        &library,
        &config,
        vec![project_entry("id-keeps", "stale-mod")],
    );
    let report = library.sweep_mod_health(&config).unwrap();

    let verdicts = library.mod_health_verdicts(&config).unwrap();
    assert!(verdicts.contains_key("id-keeps"));
    assert!(!verdicts.contains_key("id-goes"));
    assert_eq!(report.repairable, vec!["id-keeps".to_string()]);
}

/// Story: a modpkg has no unpacked form for the rules to read (ADR-0001), so
/// the sweep never tries and never reports it as a mod it failed on.
#[test]
fn a_modpkg_is_not_swept() {
    let storage = tempfile::tempdir().unwrap();
    let (library, mut config) = make_test_library(storage.path());
    point_at_installed_build(&mut config, storage.path());
    place_installed_mod(storage.path(), "packed-mod", ModArchiveFormat::Modpkg, true);
    seed_library(
        &library,
        &config,
        vec![make_slugged_entry(
            "id-pkg",
            "packed-mod",
            ModArchiveFormat::Modpkg,
        )],
    );

    let report = library.sweep_mod_health(&config).unwrap();

    assert_eq!(report.checked, 0);
    assert_eq!(report.skipped, 0);
    assert!(
        !library
            .mod_health_verdicts(&config)
            .unwrap()
            .contains_key("id-pkg")
    );
}

/// Story: one mod whose archive is gone does not cost the user every other
/// mod's verdict.
#[test]
fn one_unreadable_mod_does_not_stop_the_sweep() {
    let storage = tempfile::tempdir().unwrap();
    let (library, mut config) = make_test_library(storage.path());
    point_at_installed_build(&mut config, storage.path());
    place_bin_archived_fantome(storage.path(), "good-mod", &stale_bin());
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

    let report = library.sweep_mod_health(&config).unwrap();

    assert_eq!(
        report.checked, 1,
        "both were due, and only one could be read"
    );
    assert_eq!(report.repairable, vec!["id-good".to_string()]);
}

/// Story: the badges and the banner both need telling, and a library that had
/// nothing to check must not announce a sweep that did not happen.
#[test]
fn a_sweep_announces_its_progress_and_its_result_only_when_it_ran() {
    let storage = tempfile::tempdir().unwrap();
    let events = Arc::new(RecordingEventSink::default());
    let (library, mut config) = make_library_with_events(storage.path(), events.clone());
    point_at_installed_build(&mut config, storage.path());
    place_bin_project_mod(storage.path(), "stale-mod", &stale_bin());
    seed_library(&library, &config, vec![project_entry("id-1", "stale-mod")]);

    library.sweep_mod_health(&config).unwrap();
    // One mod is picked up and then finished, so it is reported twice.
    assert_eq!(
        events.names(),
        vec![
            "health-sweep-progress",
            "health-sweep-progress",
            "mod-health-verdicts-updated",
            "health-sweep-finished",
        ]
    );
    assert_matches!(
        events.events().first().unwrap(),
        BackendEvent::HealthSweepProgress(progress)
            if progress.total == 1 && progress.completed == 0 && progress.in_flight == ["id-1"]
    );
    assert_matches!(
        &events.events()[1],
        BackendEvent::HealthSweepProgress(progress)
            if progress.completed == 1 && progress.in_flight.is_empty()
    );

    let quiet = Arc::new(RecordingEventSink::default());
    let (again, _) = make_library_with_events(storage.path(), quiet.clone());
    again.sweep_mod_health(&config).unwrap();
    assert!(quiet.names().is_empty(), "nothing was due, so nothing said");
}
