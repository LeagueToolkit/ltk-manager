//! Unit tests for what the rule reports, what it stays quiet about, and what
//! its repair writes.

use fs_err as fs;
use ltk_hash::{BinHash, Hash as _, WadHash};
use ltk_meta::property::{NoMeta, values};
use ltk_meta::{Bin, BinObject, PropertyValueEnum};

use super::*;

use crate::config::Config;
use crate::mods::test_support::{
    BUILT_BANK_ID, audio_bank_with_id, make_packed_chunk_fantome_zip, resolver_naming,
};
use crate::problems::Budget;
use crate::problems::ProjectFiles;

/// Where the fixture bank sits inside the WAD holding it.
const BANK_IN_WAD: &str = "assets/sounds/wwise2016/sfx/sett_base_sfx_audio.bnk";

/// The name the archive builders give the one WAD they pack.
const WAD: &str = "Aatrox.wad.client";

/// The id the shipped game carries at `BANK_IN_WAD`.
///
/// `sett_base_sfx_audio.bnk` ships at `0xE9B70B40`, which is `FNV-1` of its own
/// name. This is the number the repair has to arrive at from the file name alone.
const SETT_BANK_ID: u32 = 0xE9B7_0B40;

/// The version the measured specimens carry, which the rule says nothing about.
const SPECIMEN_VERSION: u32 = 134;

/// A media bank at `id`, carrying the two chunks a media bank carries.
fn bank(id: u32) -> Vec<u8> {
    audio_bank_with_id(SPECIMEN_VERSION, id, &[(b"DIDX", 12), (b"DATA", 64)])
}

fn found_in(files: &ProjectFiles) -> Vec<Problem> {
    let (problems, failed) = files.report(&[&AudioBankId::new()]).finish();
    assert!(
        failed.is_empty(),
        "the fixture should read cleanly: {failed:?}"
    );
    problems
}

/// A project holding one `.bnk` at `content/base/<WAD>/<at>`.
fn tree_at(at: &str, bytes: &[u8]) -> (tempfile::TempDir, ProjectFiles) {
    let tmp = tempfile::tempdir().unwrap();
    let file = tmp
        .path()
        .join("content")
        .join("base")
        .join(format!("{WAD}/{at}").replace('/', std::path::MAIN_SEPARATOR_STR));
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    fs::write(&file, bytes).unwrap();

    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();
    (tmp, files)
}

fn tree(bytes: &[u8]) -> (tempfile::TempDir, ProjectFiles) {
    tree_at(BANK_IN_WAD, bytes)
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

/// The bytes the repair left at `at`.
fn read_back(tmp: &tempfile::TempDir, at: &str) -> Vec<u8> {
    fs::read(
        tmp.path()
            .join("content")
            .join("base")
            .join(format!("{WAD}/{at}").replace('/', std::path::MAIN_SEPARATOR_STR)),
    )
    .unwrap()
}

fn repair(tmp: &tempfile::TempDir, problems: &[Problem]) -> Applied {
    let chosen: Vec<&Problem> = problems.iter().collect();
    let mut run = FixRun::open(tmp.path(), Vec::new(), None, Config::default(), None);
    let applied = AudioBankId::new().fix(&chosen, &mut run).unwrap();
    run.finish().unwrap();
    applied
}

#[test]
fn a_bank_carrying_no_id_is_worth_knowing_and_nothing_more() {
    let (_tmp, files) = tree(&bank(0));

    let problems = found_in(&files);

    assert_eq!(problems.len(), 1);
    let problem = &problems[0];
    assert_eq!(problem.rule, ID);
    assert_eq!(
        problem.severity,
        Severity::Info,
        "nothing is known to read the field, so the mod is not broken by this"
    );
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

    let (problems, failed) = files.report(&[&AudioBankId::new()]).finish();

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

/// The hash is `FNV-1` and not `FNV-1a`, which the shipped bank pins: the game
/// carries `0xE9B70B40` at this path, and that is what the name alone gives.
#[test]
fn the_name_hashes_to_the_id_the_game_ships() {
    assert_eq!(bank_id_of_name("sett_base_sfx_audio"), SETT_BANK_ID);
}

/// The toolchain lowercases before hashing and strips the extension, so the
/// spelling of the file name on disk never changes the id.
#[test]
fn case_and_extension_do_not_change_the_id() {
    let stem = named_stem("Aatrox.wad.client/assets/SETT_Base_SFX_Audio.BNK")
        .expect("a named chunk keeps its stem");
    assert_eq!(bank_id_of_name(stem), SETT_BANK_ID);
}

#[test]
fn the_preview_names_the_id_the_repair_will_write() {
    let (_tmp, files) = tree(&bank(0));

    let problem = &found_in(&files)[0];
    let fix = problem
        .fix
        .as_ref()
        .expect("the id is derivable from a name");
    assert_eq!(fix.before.as_deref(), Some("0"));
    assert_eq!(fix.after.as_deref(), Some("0xE9B70B40"));
}

#[test]
fn the_fix_writes_the_id_the_name_hashes_to() {
    let (tmp, files) = tree(&bank(0));
    let problems = found_in(&files);

    let applied = repair(&tmp, &problems);

    assert_eq!(
        applied,
        Applied {
            applied: 1,
            skipped: 0
        }
    );
    let repaired = read_back(&tmp, BANK_IN_WAD);
    assert_eq!(
        u32::from_le_bytes(repaired[BANK_ID_AT..BANK_ID_AT + 4].try_into().unwrap()),
        SETT_BANK_ID
    );
    assert_eq!(
        repaired[..BANK_ID_AT],
        bank(0)[..BANK_ID_AT],
        "the repair touches four bytes and nothing else"
    );
    assert_eq!(repaired[BANK_ID_AT + 4..], bank(0)[BANK_ID_AT + 4..]);
}

/// A repaired bank is one the rule no longer objects to, so a repair offered
/// twice writes once.
#[test]
fn a_second_fix_over_a_repaired_bank_skips_it() {
    let (tmp, files) = tree(&bank(0));
    let problems = found_in(&files);

    repair(&tmp, &problems);
    let applied = repair(&tmp, &problems);

    assert_eq!(
        applied,
        Applied {
            applied: 0,
            skipped: 1
        }
    );
}

/// A chunk no hash table could name is unpacked under its own hash, and hashing
/// that would write an id belonging to nothing. The finding stands and the
/// repair declines.
#[test]
fn a_chunk_named_by_its_hash_is_reported_without_a_repair() {
    let hashed = "assets/0123456789abcdef.bnk";
    let (tmp, files) = tree_at(hashed, &bank(0));

    let problems = found_in(&files);
    assert_eq!(problems.len(), 1);
    assert_eq!(problems[0].fix, None);

    let applied = repair(&tmp, &problems);

    assert_eq!(
        applied,
        Applied {
            applied: 0,
            skipped: 1
        }
    );
    assert_eq!(read_back(&tmp, hashed), bank(0), "nothing was written");
    assert!(!AudioBankId::new().unfixable_description().is_empty());
}

/* The bin shape a bank's own name survives an unpack in. Written out here
rather than read from the scanner, so a wrong constant there fails rather than
agrees. */

/// `SkinAudioProperties`.
const SKIN_AUDIO: BinHash = BinHash(0x8f7b_194f);
/// `bankUnits` on it.
const BANK_UNITS: BinHash = BinHash(0xf8f2_9f92);
/// `BankUnit`.
const UNIT: BinHash = BinHash(0xa441_6515);
/// `bankPath` on it.
const UNIT_PATH: BinHash = BinHash(0x2a21_ad00);
/// The object the fixture hangs its audio properties on.
const BIN_ENTRY: BinHash = BinHash(0x1234_5678);

/// Where the fixture's skin bin sits.
const BIN_IN_WAD: &str = "data/characters/sett/skins/skin0.bin";

/// A skin bin whose one bank unit names `paths` in plaintext.
fn bin_naming(paths: &[&str]) -> Vec<u8> {
    let unit = values::Struct {
        class_hash: UNIT,
        properties: [(
            UNIT_PATH,
            PropertyValueEnum::Container(
                paths
                    .iter()
                    .map(|path| values::String::new((*path).to_owned()))
                    .collect(),
            ),
        )]
        .into_iter()
        .collect(),
        meta: NoMeta,
    };

    let bin = Bin::new(
        [BinObject::<NoMeta>::builder(BIN_ENTRY, SKIN_AUDIO)
            .property(
                BANK_UNITS,
                PropertyValueEnum::Container(vec![values::Embedded(unit)].into()),
            )
            .build()],
        std::iter::empty::<&str>(),
    );

    let mut out = std::io::Cursor::new(Vec::new());
    bin.to_writer(&mut out).unwrap();
    out.into_inner()
}

/// A project holding the bank at `at` and one skin bin beside it.
fn tree_with_bin(at: &str, bytes: &[u8], names: &[&str]) -> (tempfile::TempDir, ProjectFiles) {
    let tmp = tempfile::tempdir().unwrap();
    for (path, bytes) in [(at, bytes), (BIN_IN_WAD, bin_naming(names).as_slice())] {
        let file = tmp
            .path()
            .join("content")
            .join("base")
            .join(format!("{WAD}/{path}").replace('/', std::path::MAIN_SEPARATOR_STR));
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, bytes).unwrap();
    }

    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();
    (tmp, files)
}

/// The unpacked name of the chunk `BANK_IN_WAD` sits under.
fn hashed_bank_path() -> String {
    format!("assets/{:016x}.bnk", WadHash::hash_str(BANK_IN_WAD).0)
}

/// A bank has to be listed in a bank unit as plaintext or the game never loads
/// it, so the name an unpack hashed away is still in the mod - in the one bin
/// that asks for the bank.
#[test]
fn a_hash_named_chunk_takes_its_name_from_the_bank_unit_asking_for_it() {
    let hashed = hashed_bank_path();
    let (tmp, files) = tree_with_bin(&hashed, &bank(0), &[BANK_IN_WAD]);

    let problems = found_in(&files);
    assert_eq!(problems.len(), 1);
    let fix = problems[0]
        .fix
        .as_ref()
        .expect("the bank unit names the bank, so the id is derivable");
    assert_eq!(
        fix.after.as_deref(),
        Some(format!("{SETT_BANK_ID:#010X}").as_str())
    );

    let applied = repair(&tmp, &problems);

    assert_eq!(
        applied,
        Applied {
            applied: 1,
            skipped: 0
        }
    );
    assert_eq!(read_back(&tmp, &hashed), bank(SETT_BANK_ID));
}

/// A bank no bank unit names is one the game never asks for and so never
/// loads. The finding stands and the repair still declines, because hashing
/// hex digits would write an id belonging to nothing.
#[test]
fn a_hash_named_chunk_no_bank_unit_asks_for_keeps_no_repair() {
    let hashed = hashed_bank_path();
    let (_tmp, files) = tree_with_bin(
        &hashed,
        &bank(0),
        &["assets/sounds/wwise2016/sfx/other.bnk"],
    );

    let problems = found_in(&files);

    assert_eq!(problems.len(), 1);
    assert_eq!(problems[0].fix, None);
}
