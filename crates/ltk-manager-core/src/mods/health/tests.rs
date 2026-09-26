//! End-to-end tests at the check seam: verdicts over the same stale-bin
//! fixtures the repair suite uses.

use super::*;
use crate::mods::archive::install::STAGING_PREFIX;
use crate::mods::index::{LibraryModEntry, ModArchiveFormat};
use crate::mods::test_support::{
    make_slugged_entry, make_test_library, make_unpacked_entry, place_bin_archived_fantome,
    point_at_installed_build, seed_library, stale_bin,
};
use fs_err as fs;

fn archived_entry(id: &str, slug: &str) -> LibraryModEntry {
    make_slugged_entry(id, slug, ModArchiveFormat::Fantome)
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

/// Story: the Discord report. A mod still shipping a packed WAD, on a machine
/// whose hashtables name none of its chunks, and 1.15 called it healthy.
///
/// Nothing names the bin, so it is listed under its hash and read as a bin by
/// its first bytes. The repair reaches it at that same address -
/// `repairing_a_packed_fantome_no_table_names_reaches_the_bin_by_its_hash` -
/// so what is reported here is a finding a press can clear rather than one
/// raised on every sweep forever. The check itself still reads the archive
/// where it lies, unpacking nothing and writing nothing.
#[test]
fn checking_a_stale_packed_fantome_unpacks_nothing_and_reports_what_a_repair_could_fix() {
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
    let mods_dir = storage.path().join("mods");
    let before = fs::read(mods_dir.join("packed-mod.fantome")).unwrap();

    let verdict = library.check_mod_health(&config, "id-1").unwrap();

    assert_eq!(verdict.health, ModHealth::Repairable);
    assert_eq!(verdict.fixable, 1);
    assert_eq!(
        fs::read(mods_dir.join("packed-mod.fantome")).unwrap(),
        before,
        "a check never writes"
    );

    let left: Vec<_> = fs::read_dir(&mods_dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert!(
        !left.iter().any(|name| name.starts_with(STAGING_PREFIX)),
        "a check unpacks nothing: {left:?}"
    );
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
        vec![make_unpacked_entry("id-1", "unpacked-mod")],
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

    let report = library
        .sweep_mod_health(
            &config,
            &SweepScope::Installed(vec!["id-broken".to_string(), "id-good".to_string()]),
        )
        .unwrap();

    assert_eq!(report.checked, 1);
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

/// Story: a repair that wrote and was then called off leaves a verdict about
/// content that has since changed. The sweep compares only the basis, so a
/// stale verdict would stand until the game patches - it has to go instead.
#[test]
fn forgetting_a_verdict_makes_the_sweep_owe_that_mod_a_check() {
    let storage = tempfile::tempdir().unwrap();
    let (library, mut config) = make_test_library(storage.path());
    point_at_installed_build(&mut config, storage.path());
    crate::mods::test_support::place_bin_project_mod(storage.path(), "stale-mod", &stale_bin());
    seed_library(
        &library,
        &config,
        vec![make_unpacked_entry("id-1", "stale-mod")],
    );
    library.check_mod_health(&config, "id-1").unwrap();
    assert!(
        library
            .mod_health_verdicts(&config)
            .unwrap()
            .contains_key("id-1")
    );

    library.forget_health_check(&library.storage_dir(&config).unwrap(), "id-1");

    assert!(library.mod_health_verdicts(&config).unwrap().is_empty());
}

/// Story: a build rewrites a rule's sentences, and the sweep sees no reason to
/// re-check anything - the basis has not moved. Nothing the build owns may come
/// out of the store, so the file keeps what the run saw and a load rebuilds the
/// rest from the rules this build ships.
#[test]
fn the_store_keeps_what_the_run_saw_and_a_load_rebuilds_the_rest() {
    let storage = tempfile::tempdir().unwrap();
    let brief = RuleBrief {
        rule: "bin/property-type".to_owned(),
        title: "A title an older build wrote".to_owned(),
        description: "A sentence an older build wrote".to_owned(),
        severity: problems::Severity::Fatal,
        count: 3,
        fixable: 1,
        mismatches: vec![problems::TypeMismatch {
            expected: "File".to_owned(),
            found: "Hash".to_owned(),
        }],
        unfixable: Some("A why-not an older build wrote".to_owned()),
    };
    let file = VerdictFile {
        verdicts: std::iter::once((
            "id-1".to_owned(),
            ModHealthVerdict {
                mod_id: "id-1".to_owned(),
                health: ModHealth::Repairable,
                fixable: 1,
                counts: Counts::default(),
                rules: vec![brief],
                checked_at: "2026-08-28T10:00:00Z".to_owned(),
                basis: HealthCheckBasis::default(),
            },
        ))
        .collect(),
    };
    file.save(storage.path()).unwrap();

    let written = fs::read_to_string(storage.path().join("mod-health-verdicts.json")).unwrap();
    assert!(!written.contains("older build wrote"), "{written}");
    assert!(!written.contains("title"), "{written}");

    let loaded = VerdictFile::load(storage.path());
    let brief = &loaded.verdicts["id-1"].rules[0];

    let rule = problems::rules::all()
        .into_iter()
        .find(|rule| rule.id().0 == "bin/property-type")
        .unwrap();
    assert_eq!(brief.title, rule.title());
    assert_eq!(brief.description, rule.description());
    assert_eq!(
        brief.unfixable.as_deref(),
        Some(rule.unfixable_description())
    );
    assert_eq!((brief.count, brief.fixable), (3, 1));
    assert_eq!(
        brief.severity,
        problems::Severity::Fatal,
        "this rule's findings each answer for themselves, so the run's is the only answer"
    );
}

/// Story: a build demotes a rule to `Info`, deciding the state it reports is
/// worth knowing rather than wrong. No basis moves on a code edit, so the sweep
/// owes nothing and the stored verdicts stand - and every one of them would go
/// on drawing the amber triangle until the game patched. A severity the rule
/// declares is this build's word, exactly as its title is.
#[test]
fn a_declared_severity_is_the_builds_word_and_not_the_stores() {
    let storage = tempfile::tempdir().unwrap();
    let rule = problems::rules::all()
        .into_iter()
        .find(|rule| rule.id().0 == "bin/resolver-key-loss")
        .unwrap();
    assert_eq!(
        rule.severity(),
        Some(problems::Severity::Info),
        "the rule this test is about has to be one that declares"
    );

    let file = VerdictFile {
        verdicts: std::iter::once((
            "id-1".to_owned(),
            ModHealthVerdict {
                mod_id: "id-1".to_owned(),
                health: ModHealth::Unrepairable,
                fixable: 0,
                counts: Counts::default(),
                rules: vec![RuleBrief {
                    rule: "bin/resolver-key-loss".to_owned(),
                    title: String::new(),
                    description: String::new(),
                    severity: problems::Severity::Warning,
                    count: 75,
                    fixable: 0,
                    mismatches: Vec::new(),
                    unfixable: None,
                }],
                checked_at: "2026-08-28T10:00:00Z".to_owned(),
                basis: HealthCheckBasis::default(),
            },
        ))
        .collect(),
    };
    file.save(storage.path()).unwrap();

    let loaded = VerdictFile::load(storage.path());
    let brief = &loaded.verdicts["id-1"].rules[0];

    assert_eq!(brief.severity, problems::Severity::Info);
    assert_eq!(brief.count, 75, "the counts are still the run's to answer");
}

/// A rule this build no longer ships has no one left to answer for it, so the
/// severity the run saw is what the row keeps drawing.
#[test]
fn a_rule_the_build_dropped_keeps_the_severity_it_was_stored_with() {
    let storage = tempfile::tempdir().unwrap();
    let file = VerdictFile {
        verdicts: std::iter::once((
            "id-1".to_owned(),
            ModHealthVerdict {
                mod_id: "id-1".to_owned(),
                health: ModHealth::Unrepairable,
                fixable: 0,
                counts: Counts::default(),
                rules: vec![RuleBrief {
                    rule: "bin/a-rule-this-build-retired".to_owned(),
                    title: String::new(),
                    description: String::new(),
                    severity: problems::Severity::Error,
                    count: 2,
                    fixable: 0,
                    mismatches: Vec::new(),
                    unfixable: None,
                }],
                checked_at: "2026-08-28T10:00:00Z".to_owned(),
                basis: HealthCheckBasis::default(),
            },
        ))
        .collect(),
    };
    file.save(storage.path()).unwrap();

    let loaded = VerdictFile::load(storage.path());
    let brief = &loaded.verdicts["id-1"].rules[0];

    assert_eq!(brief.severity, problems::Severity::Error);
    assert_eq!(brief.title, "bin/a-rule-this-build-retired");
}

/// Story: a build adds data the old shape never wrote - the type pairs - and
/// the basis has not moved, so the sweep sees nothing due. A verdict from an
/// older shape has to read as never checked, or its row would draw without
/// the data every newer row has.
#[test]
fn a_file_from_an_older_shape_loads_as_never_checked() {
    let storage = tempfile::tempdir().unwrap();
    fs::write(
        storage.path().join("mod-health-verdicts.json"),
        r#"{
          "version": 0,
          "verdicts": {
            "id-1": {
              "modId": "id-1",
              "health": "repairable",
              "fixable": 1,
              "counts": { "fatals": 3, "errors": 0, "warnings": 0, "infos": 0 },
              "checkedAt": "2026-08-28T10:00:00Z"
            }
          }
        }"#,
    )
    .unwrap();

    assert!(VerdictFile::load(storage.path()).verdicts.is_empty());
}

/// Story: the Discord report, answered. A check with no tables to name a mod's
/// content with would misjudge what a repair reaches, so it does not run - and
/// the mod stays unchecked rather than wearing a verdict nobody earned.
#[test]
fn a_check_refuses_to_run_before_the_hashtables_are_there() {
    let storage = tempfile::tempdir().unwrap();
    let (library, mut config) =
        crate::mods::test_support::make_library_without_hashtables(storage.path());
    point_at_installed_build(&mut config, storage.path());
    crate::mods::test_support::place_bin_project_mod(storage.path(), "stale-mod", &stale_bin());
    seed_library(
        &library,
        &config,
        vec![make_unpacked_entry("id-1", "stale-mod")],
    );

    let refused = library.check_mod_health(&config, "id-1");

    assert!(refused.is_err(), "a check with no tables must not answer");
    assert!(
        library.mod_health_verdicts(&config).unwrap().is_empty(),
        "an unchecked mod is a claim about nothing, and a verdict is a claim"
    );
}

/// A machine with tables offers the check, with nothing to wait for.
#[test]
fn a_check_is_offered_where_the_tables_are_open() {
    let storage = tempfile::tempdir().unwrap();
    let (library, _config) = make_test_library(storage.path());

    assert_eq!(
        library.health_check_readiness(),
        HealthCheckReadiness::Ready
    );
}

/// The window this exists for: the startup pass is fetching the tables, so the
/// menu row says so instead of offering a press that would be refused.
#[test]
fn a_check_reads_as_syncing_while_the_startup_pass_has_not_reported() {
    let storage = tempfile::tempdir().unwrap();
    let (library, _config) =
        crate::mods::test_support::make_library_without_hashtables(storage.path());

    assert_eq!(
        library.health_check_readiness(),
        HealthCheckReadiness::Syncing,
        "a library that has not swept yet is still on its way to the tables"
    );
}

/// The sweep reported and there are still no tables, so nothing is coming that
/// the user did not ask for - a spinner there would wait on nobody.
#[test]
fn a_check_reads_as_unsynced_once_the_startup_pass_gave_up() {
    let storage = tempfile::tempdir().unwrap();
    let (library, _config) =
        crate::mods::test_support::make_library_without_hashtables(storage.path());

    library.record_health_sweep(HealthSweepState::Idle);

    assert_eq!(
        library.health_check_readiness(),
        HealthCheckReadiness::Unsynced
    );
}

/// Forgetting a mod nothing remembers writes nothing, so a cancel over a mod
/// the run never got to does not rewrite the whole file.
#[test]
fn forgetting_a_verdict_that_is_not_held_writes_nothing() {
    let storage = tempfile::tempdir().unwrap();
    let (library, config) = make_test_library(storage.path());
    let storage_dir = library.storage_dir(&config).unwrap();

    library.forget_health_check(&storage_dir, "never-checked");

    assert!(!storage_dir.join("mod-health-verdicts.json").exists());
}

/// A run holding one finding at `severity`, for the verdict tests below.
fn run_of(severity: problems::Severity) -> Run {
    let mut report = problems::Report::default();
    report.problem(
        problems::RuleId("audio/bank-id"),
        severity,
        problems::Site::file("base", "assets/sounds/sfx.bnk"),
        problems::Detail::new("worth knowing"),
    );
    let (found, failed) = report.finish();
    Run {
        at: chrono::Utc::now(),
        rules: Vec::new(),
        objects: Vec::new(),
        problems: found,
        failed,
    }
}

/// Story: `Info` is worth knowing and says nothing is wrong, so a mod whose
/// findings are all informative is not one the library has to report. It reads
/// healthy, and the drawer, the badge and the status bar all stay quiet - while
/// the finding itself is still counted for anything that draws the tally.
#[test]
fn a_mod_whose_findings_are_all_informative_reads_healthy() {
    let verdict = ModHealthVerdict::from_run(
        "id-1",
        &run_of(problems::Severity::Info),
        HealthCheckBasis::default(),
    );

    assert_eq!(verdict.health, ModHealth::Healthy);
    assert_eq!(
        verdict.counts.infos, 1,
        "the finding is still counted, it just says nothing is wrong"
    );
}

/// The severity is what decides it, so the same shape one rung up is broken.
#[test]
fn one_rung_above_informative_is_a_mod_the_library_reports() {
    let verdict = ModHealthVerdict::from_run(
        "id-1",
        &run_of(problems::Severity::Warning),
        HealthCheckBasis::default(),
    );

    assert_ne!(verdict.health, ModHealth::Healthy);
}
