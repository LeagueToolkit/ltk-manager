//! Unit tests for what the rule reports and what it stays quiet about.

use super::*;
use crate::config::Config;
use crate::mods::test_support::{
    BUILT_BANK_ID, audio_bank_with_id, make_packed_chunk_fantome_zip, resolver_naming,
};
use crate::problems::Budget;

/// Where the fixture bank sits inside the WAD holding it.
const BANK_IN_WAD: &str = "assets/sounds/wwise2016/sfx/sett_base_sfx_audio.bnk";

/// The name the archive builders give the one WAD they pack.
const WAD: &str = "Aatrox.wad.client";

/// The version the measured specimens carry, which the rule says nothing about.
const SPECIMEN_VERSION: u32 = 134;

/// A media bank at `id`, carrying the two chunks a media bank carries.
fn bank(id: u32) -> Vec<u8> {
    audio_bank_with_id(SPECIMEN_VERSION, id, &[(b"DIDX", 12), (b"DATA", 64)])
}

fn found_in(files: &ProjectFiles) -> Vec<Problem> {
    let mut report = Report::default();
    AudioBankId::new().check(files, &mut report);
    let (problems, failed) = report.finish();
    assert!(
        failed.is_empty(),
        "the fixture should read cleanly: {failed:?}"
    );
    problems
}

/// A project holding one `.bnk` at `content/base/<WAD>/<BANK_IN_WAD>`.
fn tree(bytes: &[u8]) -> (tempfile::TempDir, ProjectFiles) {
    let tmp = tempfile::tempdir().unwrap();
    let at = tmp
        .path()
        .join("content")
        .join("base")
        .join(format!("{WAD}/{BANK_IN_WAD}").replace('/', std::path::MAIN_SEPARATOR_STR));
    std::fs::create_dir_all(at.parent().unwrap()).unwrap();
    std::fs::write(&at, bytes).unwrap();

    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();
    (tmp, files)
}

/// The same bank packed into an archive.
fn archive(bytes: &[u8]) -> (tempfile::TempDir, ProjectFiles) {
    let tmp = tempfile::tempdir().unwrap();
    let at = tmp.path().join("bank.fantome");
    make_packed_chunk_fantome_zip(&at, "Bank", BANK_IN_WAD, bytes);

    let files = ProjectFiles::in_archive(
        &at,
        &Config::default(),
        Budget::repair(),
        &resolver_naming(&[BANK_IN_WAD]),
        None,
    )
    .unwrap();
    (tmp, files)
}

#[test]
fn a_bank_carrying_no_id_is_an_error() {
    let (_tmp, files) = tree(&bank(0));

    let problems = found_in(&files);

    assert_eq!(problems.len(), 1);
    let problem = &problems[0];
    assert_eq!(problem.rule, ID);
    assert_eq!(problem.severity, Severity::Error);
    assert_eq!(problem.site.layer, "base");
    assert_eq!(problem.site.path, format!("{WAD}/{BANK_IN_WAD}"));
    assert_eq!(problem.site.node, None, "the rule reads the whole file");
}

#[test]
fn a_bank_carrying_an_id_reports_nothing() {
    let (_tmp, files) = tree(&bank(BUILT_BANK_ID));

    assert!(found_in(&files).is_empty());
}

/// Story: Riot ships 838 banks at v134 and 6,981 at v145, so the version is not
/// the signal and a bank at the specimens' own version is fine with an id.
#[test]
fn the_version_alone_is_never_the_signal() {
    for version in [125u32, 132, 134, 145] {
        let bytes = audio_bank_with_id(version, BUILT_BANK_ID, &[(b"DATA", 8)]);
        let (_tmp, files) = tree(&bytes);
        assert!(found_in(&files).is_empty(), "version {version}");
    }
}

/// Story: the check that reads an unpacked mod reads a packed one the same
/// way, because both go through the one handle.
#[test]
fn an_archive_reports_what_its_tree_reports() {
    let bytes = bank(0);
    let (_tree, unpacked) = tree(&bytes);
    let (_archive, packed) = archive(&bytes);

    let in_tree = found_in(&unpacked);
    let in_archive = found_in(&packed);

    assert_eq!(in_tree.len(), 1);
    assert_eq!(in_archive.len(), 1);
    assert_eq!(in_archive[0].site.path, in_tree[0].site.path);
    assert_eq!(in_archive[0].severity, in_tree[0].severity);
    assert_eq!(in_archive[0].message, in_tree[0].message);
}

/// A `.bnk` that is not a bank is a file the rule could not read rather than
/// one it reports, so it lands on the run as a failure.
#[test]
fn a_file_that_is_not_a_bank_is_reported_as_unread() {
    let (_tmp, files) = tree(b"not a bank at all, whatever it is named");

    let mut report = Report::default();
    AudioBankId::new().check(&files, &mut report);
    let (problems, failed) = report.finish();

    assert!(problems.is_empty());
    assert_eq!(failed.len(), 1);
    assert!(
        failed[0].message.contains("not an audio bank"),
        "{failed:?}"
    );
}

/// A header cut off before the id says nothing, rather than reading a zero out
/// of bytes that are not there.
#[test]
fn a_bank_header_shorter_than_the_id_reports_nothing() {
    let (_tmp, files) = tree(b"BKHD\x04\x00\x00\x00\x86\x00\x00\x00");

    assert!(found_in(&files).is_empty());
}

/// The id is the toolchain's to assign, so the row says to build the bank
/// again and offers nothing.
#[test]
fn the_rule_offers_no_repair() {
    let (_tmp, files) = tree(&bank(0));

    let problem = &found_in(&files)[0];
    assert_eq!(problem.fix, None);
    let message = problem.message.as_deref().unwrap_or_default();
    assert!(message.contains("Wwise"), "{message}");
    assert!(!AudioBankId::new().unfixable_description().is_empty());
}
