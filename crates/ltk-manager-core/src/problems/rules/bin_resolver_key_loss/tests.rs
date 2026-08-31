//! Unit tests for what the rule reports, what it stays quiet about, and what
//! it says with no install to compare against.

use std::sync::Arc;

use ltk_hash::Hash as _;
use ltk_meta::property::{Kind, NoMeta, values};
use ltk_meta::{BinObject, PropertyValueEnum};

use super::*;
use crate::config::Config;
use crate::mods::test_support::{make_packed_chunk_fantome_zip, resolver_naming};
use crate::problems::game::FakeContent;
use crate::problems::{Budget, RuleState};

/// The chunk the mod overrides, inside the WAD holding it.
const BIN_IN_WAD: &str = "data/characters/sett/skins/skin66.bin";

/// The WAD directory that path sits under, both in the tree and in the archive.
const WAD: &str = "Aatrox.wad.client";

/// The resolver object both copies of the bin carry.
const RESOLVER: BinHash = BinHash(0x1019_bc3f);

/// Where the file sits inside the layer, either way it is stored.
fn in_layer() -> String {
    format!("{WAD}/{BIN_IN_WAD}")
}

/// A bin whose one resolver maps `keys` names onto objects.
fn bin_resolving(keys: usize) -> Vec<u8> {
    let entries: Vec<(PropertyValueEnum, PropertyValueEnum)> = (0..keys)
        .map(|at| {
            (
                PropertyValueEnum::Hash(values::Hash::new(BinHash(0x1000 + at as u32))),
                PropertyValueEnum::ObjectLink(values::ObjectLink::new(BinHash(0x2000 + at as u32))),
            )
        })
        .collect();
    let map = values::Map::new(Kind::Hash, Kind::ObjectLink, entries).unwrap();

    let bin = Bin::new(
        [BinObject::<NoMeta>::builder(RESOLVER, RESOURCE_RESOLVER)
            .property(RESOURCE_MAP, PropertyValueEnum::Map(map))
            .build()],
        std::iter::empty::<&str>(),
    );

    let mut out = std::io::Cursor::new(Vec::new());
    bin.to_writer(&mut out).unwrap();
    out.into_inner()
}

/// An install holding the game's copy of the bin, mapping `keys` names.
fn install(keys: usize) -> Arc<dyn GameContent> {
    let bytes = bin_resolving(keys);
    FakeContent::holding_bytes(&[(BIN_IN_WAD, &bytes)])
}

/// The mod as an unpacked tree, its resolver mapping `keys` names.
fn tree(keys: usize, game: Option<Arc<dyn GameContent>>) -> (tempfile::TempDir, ProjectFiles) {
    let tmp = tempfile::tempdir().unwrap();
    let at = tmp
        .path()
        .join("content")
        .join("base")
        .join(in_layer().replace('/', std::path::MAIN_SEPARATOR_STR));
    std::fs::create_dir_all(at.parent().unwrap()).unwrap();
    std::fs::write(&at, bin_resolving(keys)).unwrap();

    let files = ProjectFiles::read(tmp.path(), &Config::default(), game).unwrap();
    (tmp, files)
}

/// The same mod packed into an archive.
fn archive(keys: usize, game: Option<Arc<dyn GameContent>>) -> (tempfile::TempDir, ProjectFiles) {
    let tmp = tempfile::tempdir().unwrap();
    let at = tmp.path().join("skin.fantome");
    make_packed_chunk_fantome_zip(&at, "Skin", BIN_IN_WAD, &bin_resolving(keys));

    let files = ProjectFiles::in_archive(
        &at,
        &Config::default(),
        Budget::repair(),
        &resolver_naming(&[BIN_IN_WAD]),
        game,
    )
    .unwrap();
    (tmp, files)
}

fn found_in(files: &ProjectFiles) -> Vec<Problem> {
    let mut report = Report::default();
    BinResolverKeyLoss::new().check(files, &mut report);
    let (problems, failed) = report.finish();
    assert!(
        failed.is_empty(),
        "the fixture should read cleanly: {failed:?}"
    );
    problems
}

/// The names the two constants stand for, so a mistyped hash is a failing test
/// rather than a rule that quietly reports nothing forever.
#[test]
fn the_constants_are_the_names_they_stand_for() {
    assert_eq!(RESOURCE_RESOLVER, BinHash::hash_str("ResourceResolver"));
    assert_eq!(RESOURCE_MAP, BinHash::hash_str("resourceMap"));
}

#[test]
fn a_resolver_holding_far_fewer_keys_than_the_games_is_reported() {
    let (_tmp, files) = tree(63, Some(install(231)));

    let problems = found_in(&files);

    assert_eq!(problems.len(), 1);
    let problem = &problems[0];
    assert_eq!(problem.rule, ID);
    assert_eq!(problem.severity, Severity::Warning);
    assert_eq!(problem.site.layer, "base");
    assert_eq!(problem.site.path, in_layer());
    let node = problem.site.node.as_ref().expect("the resolver object");
    assert_eq!(node.entry, RESOLVER);
    assert!(node.path.is_empty(), "the object itself, not a property");
}

/// Story: the count is a fidelity loss and never a crash. The row says both
/// counts, says what a miss actually costs, and denies the crash outright -
/// because a reader meeting a red row assumes one.
#[test]
fn the_finding_names_both_counts_and_denies_a_crash() {
    let (_tmp, files) = tree(63, Some(install(231)));

    let message = found_in(&files)[0]
        .message
        .clone()
        .expect("the row says what it found");
    assert!(message.contains("231"), "{message}");
    assert!(message.contains("63"), "{message}");
    assert!(message.contains("placeholder"), "{message}");
    assert!(message.contains("rather than a crash"), "{message}");
}

#[test]
fn a_resolver_holding_what_the_games_holds_reports_nothing() {
    let (_tmp, files) = tree(231, Some(install(231)));

    assert!(found_in(&files).is_empty());
}

/// A hand edit drops a key or two, and reporting that would bury the class this
/// rule is about.
#[test]
fn a_difference_below_the_floor_reports_nothing() {
    let (_tmp, files) = tree(231 - (LOST_AT_LEAST - 1), Some(install(231)));

    assert!(found_in(&files).is_empty());
}

/// The mod ships a resolver the game has no copy of, so there is no count to be
/// below.
#[test]
fn a_bin_the_install_does_not_hold_reports_nothing() {
    let (_tmp, files) = tree(5, Some(FakeContent::empty()));

    assert!(found_in(&files).is_empty());
}

/// A mod holding more than the game's is an addition rather than a loss.
#[test]
fn a_resolver_holding_more_than_the_games_reports_nothing() {
    let (_tmp, files) = tree(231, Some(install(63)));

    assert!(found_in(&files).is_empty());
}

/// Story: the check that reads an unpacked mod reads a packed one the same
/// way, because both go through the one handle.
#[test]
fn an_archive_reports_what_its_tree_reports() {
    let (_tree, unpacked) = tree(63, Some(install(231)));
    let (_archive, packed) = archive(63, Some(install(231)));

    let in_tree = found_in(&unpacked);
    let in_archive = found_in(&packed);

    assert_eq!(in_tree.len(), 1);
    assert_eq!(in_archive.len(), 1);
    assert_eq!(in_archive[0].site.path, in_tree[0].site.path);
    assert_eq!(in_archive[0].site.node, in_tree[0].site.node);
    assert_eq!(in_archive[0].message, in_tree[0].message);
}

/// A check with nothing to compare against says so rather than passing the mod.
#[test]
fn with_no_install_the_rule_is_dormant_and_reports_nothing() {
    let (_tmp, files) = tree(63, None);

    assert!(found_in(&files).is_empty());
    let dormancy = BinResolverKeyLoss::new()
        .dormant(&files)
        .expect("no install is something the panel has to say");
    assert_eq!(dormancy.waiting, "A League install");

    let with_one = tree(63, Some(install(231))).1;
    assert!(BinResolverKeyLoss::new().dormant(&with_one).is_none());
}

/// The rule's own catalogue entry carries that dormancy, which is what the
/// panel reads rather than asking the rule again.
#[test]
fn a_run_with_no_install_records_the_rule_as_dormant() {
    let (_tmp, files) = tree(63, None);
    let rule = BinResolverKeyLoss::new();

    let mut info = rule.info();
    if let Some(dormancy) = rule.dormant(&files) {
        info.state = RuleState::Dormant {
            waiting: dormancy.waiting,
            reason: dormancy.reason,
            detail: dormancy.detail,
        };
    }

    assert!(matches!(info.state, RuleState::Dormant { .. }));
}

/// Restoring the keys means merging the game's copy over the mod's, which is a
/// decision about the mod rather than a repair.
#[test]
fn the_rule_offers_no_repair() {
    let (_tmp, files) = tree(63, Some(install(231)));

    assert_eq!(found_in(&files)[0].fix, None);
    assert!(!BinResolverKeyLoss::new().unfixable_description().is_empty());
}
