//! Unit tests for what the reader would refuse, for the two refusals that keep
//! the rule from firing on banks that load, and for the guard on its removal.

use std::collections::HashSet;
use std::sync::Arc;

use ltk_hash::BinHash;
use ltk_meta::property::{NoMeta, values};
use ltk_meta::{Bin, BinObject, PropertyValueEnum};

use super::*;
use crate::config::Config;
use crate::mods::test_support::{audio_bank, make_packed_chunk_fantome_zip, resolver_naming};
use crate::problems::{Budget, ProjectFiles};

/// The bank's path inside the WAD, which is what a bank unit names it by.
const BANK_IN_WAD: &str = "assets/sounds/wwise2016/sfx/ashe_sfx_events.bnk";

/// The same bank as the layer lists it, under the WAD directory it sits in.
const BANK_IN_LAYER: &str = "Aatrox.wad.client/assets/sounds/wwise2016/sfx/ashe_sfx_events.bnk";

/// Where the fixture's skin bin sits.
const BIN_IN_LAYER: &str = "Aatrox.wad.client/data/characters/ashe/skins/skin0.bin";

/// The version most legacy banks in the wild carry.
const LEGACY: u32 = 134;

/// The chunk holding the objects that carry events and sounds.
const HIERARCHY: ChunkId = *b"HIRC";

/* The bin shape a request for a bank travels in. Written out here rather than
read from the rule, so a wrong constant there fails rather than agrees. */

/// `SkinAudioProperties`.
const SKIN_AUDIO: BinHash = BinHash(0x8f7b_194f);
/// `bankUnits` on it.
const BANK_UNITS: BinHash = BinHash(0xf8f2_9f92);
/// `BankUnit`.
const UNIT: BinHash = BinHash(0xa441_6515);
/// `bankPath` on it.
const UNIT_PATH: BinHash = BinHash(0x2a21_ad00);
/// The object the fixture hangs its audio properties on.
const ENTRY: BinHash = BinHash(0x1234_5678);

/// An install holding exactly the chunks it was built with.
#[derive(Debug, Default)]
struct FakeGame(HashSet<WadHash>);

impl FakeGame {
    fn holding(paths: &[&str]) -> Arc<dyn GameContent> {
        Arc::new(Self(paths.iter().copied().map(WadHash::hash_str).collect()))
    }

    fn empty() -> Arc<dyn GameContent> {
        Arc::new(Self::default())
    }
}

impl GameContent for FakeGame {
    fn holds(&self, path: WadHash) -> bool {
        self.0.contains(&path)
    }
}

/// A bank at `version` carrying `chunks`, each an id and a body length.
fn bank(version: u32, chunks: &[(ChunkId, usize)]) -> Vec<u8> {
    let chunks: Vec<(&[u8; 4], usize)> = chunks.iter().map(|(id, size)| (id, *size)).collect();
    audio_bank(version, &chunks)
}

/// A skin bin whose one bank unit asks for `paths`.
fn bin_asking_for(paths: &[&str]) -> Vec<u8> {
    let unit = values::Struct {
        class_hash: UNIT,
        properties: [(
            UNIT_PATH,
            PropertyValueEnum::Container(values::Container::String {
                items: paths
                    .iter()
                    .map(|path| values::String::new((*path).to_owned()))
                    .collect(),
                meta: NoMeta,
            }),
        )]
        .into_iter()
        .collect(),
        meta: NoMeta,
    };

    let bin = Bin::new(
        [BinObject::<NoMeta>::builder(ENTRY, SKIN_AUDIO)
            .property(
                BANK_UNITS,
                PropertyValueEnum::Container(values::Container::Embedded {
                    items: vec![values::Embedded(unit)],
                    meta: NoMeta,
                }),
            )
            .build()],
        std::iter::empty::<&str>(),
    );

    let mut out = std::io::Cursor::new(Vec::new());
    bin.to_writer(&mut out).unwrap();
    out.into_inner()
}

fn place(root: &std::path::Path, at: &str, bytes: &[u8]) {
    let path = root
        .join("content")
        .join("base")
        .join(at.replace('/', std::path::MAIN_SEPARATOR_STR));
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, bytes).unwrap();
}

/// A project holding one `.bnk`, and nothing that asks for it.
fn project(bytes: &[u8]) -> (tempfile::TempDir, ProjectFiles) {
    project_with(bytes, &[], None)
}

/// A project holding one `.bnk`, a bin whose bank unit names `asked`, and an
/// install to ask about it.
fn project_with(
    bytes: &[u8],
    asked: &[&str],
    game: Option<Arc<dyn GameContent>>,
) -> (tempfile::TempDir, ProjectFiles) {
    let tmp = tempfile::tempdir().unwrap();
    place(tmp.path(), BANK_IN_LAYER, bytes);
    if !asked.is_empty() {
        place(tmp.path(), BIN_IN_LAYER, &bin_asking_for(asked));
    }

    let files = ProjectFiles::read(tmp.path(), &Config::default(), game).unwrap();
    (tmp, files)
}

fn found_in(files: &ProjectFiles) -> Vec<Problem> {
    let mut report = Report::default();
    AudioBankVersion::new().check(files, &mut report);
    let (problems, failed) = report.finish();
    assert!(
        failed.is_empty(),
        "the fixture should read cleanly: {failed:?}"
    );
    problems
}

fn found(bytes: &[u8]) -> Vec<Problem> {
    let (_tmp, files) = project(bytes);
    found_in(&files)
}

/// A bank the reader refuses, in the shape the whole check exists for.
fn silent_bank() -> Vec<u8> {
    bank(LEGACY, &[(HIERARCHY, 64)])
}

// ---- what the reader refuses ---------------------------------------------

/// The class the whole check exists for: an events bank at a legacy version,
/// which the game drops without a word so the mod is silent.
#[test]
fn a_legacy_bank_carrying_its_hierarchy_is_reported() {
    let problems = found(&silent_bank());

    assert_eq!(problems.len(), 1);
    let problem = &problems[0];
    assert_eq!(problem.rule, ID);
    assert_eq!(problem.severity, Severity::Warning);
    assert_eq!(problem.site.layer, "base");
    assert_eq!(problem.site.path, BANK_IN_LAYER);

    let message = problem.message.as_deref().unwrap_or_default();
    assert!(message.contains("134"), "{message}");
    assert!(message.contains("without a message"), "{message}");
}

/// The refusal that keeps the rule off the majority of legacy banks. Reporting
/// on the version alone would call every one of these broken, and the game
/// itself ships hundreds.
#[test]
fn a_legacy_bank_carrying_only_its_media_reports_nothing() {
    assert!(found(&bank(LEGACY, &[(*b"DIDX", 24), (*b"DATA", 512)])).is_empty());
}

/// A legacy bank holding nothing past its header loads too, because the reader
/// consumes the header before the loop that judges the rest.
#[test]
fn a_legacy_bank_that_is_only_a_header_reports_nothing() {
    assert!(found(&bank(LEGACY, &[])).is_empty());
}

#[test]
fn a_bank_at_the_version_the_reader_takes_as_current_reports_nothing() {
    assert!(found(&bank(CURRENT_VERSION, &[(HIERARCHY, 64)])).is_empty());
}

/// The one-sided predicate. A bank above the version written down here is a
/// bank authored after it was written down, and calling that defective is the
/// false positive the whole check exists to avoid.
#[test]
fn a_bank_newer_than_the_version_written_down_reports_nothing() {
    assert!(found(&bank(CURRENT_VERSION + 1, &[(HIERARCHY, 64)])).is_empty());
    assert!(found(&bank(CURRENT_VERSION + 40, &[(HIERARCHY, 64)])).is_empty());
}

/// Below the floor the reader refuses whatever the bank carries, so the media
/// shape that saves a legacy bank does not save this one.
#[test]
fn a_bank_below_the_floor_is_reported_whatever_it_carries() {
    let problems = found(&bank(LEGACY_FLOOR - 1, &[(*b"DIDX", 24), (*b"DATA", 512)]));

    assert_eq!(problems.len(), 1);
    let message = problems[0].message.as_deref().unwrap_or_default();
    assert!(message.contains("older than"), "{message}");
}

#[test]
fn a_bank_at_the_floor_carrying_only_media_reports_nothing() {
    assert!(found(&bank(LEGACY_FLOOR, &[(*b"DIDX", 24), (*b"DATA", 512)])).is_empty());
}

/// Chunks are not always contiguous in the wild. A walk that cannot account
/// for every byte has landed somewhere it cannot read, so it says nothing
/// rather than reporting what it found there.
#[test]
fn a_bank_whose_chunks_do_not_line_up_reports_nothing() {
    let mut bytes = bank(LEGACY, &[(*b"DIDX", 24)]);
    bytes.extend_from_slice(&[0u8; 10]);
    bytes.extend_from_slice(&HIERARCHY);
    bytes.extend_from_slice(&64u32.to_le_bytes());
    bytes.resize(bytes.len() + 64, 0);

    assert!(found(&bytes).is_empty());
}

/// A chunk id the reader's own loop does not handle is the same case: the walk
/// cannot say what it is looking at.
#[test]
fn a_bank_holding_a_chunk_nothing_recognizes_reports_nothing() {
    assert!(found(&bank(LEGACY, &[(*b"ZZZZ", 16)])).is_empty());
}

/// The shape the bounded read does not resolve: the hierarchy sits behind a
/// media blob larger than the prefix, so the chunk list runs past it and only
/// the whole file says what is there.
#[test]
fn a_hierarchy_behind_a_large_media_blob_is_still_reported() {
    let problems = found(&bank(
        LEGACY,
        &[(*b"DIDX", 24), (*b"DATA", 32 * 1024), (HIERARCHY, 64)],
    ));

    assert_eq!(problems.len(), 1);
}

/// The same bank without the hierarchy, which is the read the arithmetic
/// answers: the media blob runs to the end of the file, so nothing follows it
/// and no byte of it is ever read.
#[test]
fn a_large_media_only_bank_reports_nothing() {
    assert!(found(&bank(LEGACY, &[(*b"DIDX", 24), (*b"DATA", 32 * 1024)])).is_empty());
}

/// A file named `.bnk` that is not one is a rule failure rather than silence,
/// because the check could not do what it was asked rather than deciding.
#[test]
fn a_file_that_is_not_a_bank_is_reported_as_a_failure() {
    let (_tmp, files) = project(b"not a bank at all, whatever it is named");

    let mut report = Report::default();
    AudioBankVersion::new().check(&files, &mut report);
    let (problems, failed) = report.finish();

    assert!(problems.is_empty());
    assert_eq!(failed.len(), 1);
    assert_eq!(failed[0].rule, ID);
}

// ---- reading both layer sources ------------------------------------------

/// Story: the check that reads an unpacked mod reads a packed one the same
/// way, because both go through the one handle.
#[test]
fn an_archive_reports_what_its_tree_reports() {
    let bytes = silent_bank();
    let (_tmp, tree) = project(&bytes);

    let archive_dir = tempfile::tempdir().unwrap();
    let archive = archive_dir.path().join("silent.fantome");
    make_packed_chunk_fantome_zip(&archive, "Silent", BANK_IN_WAD, &bytes);
    let packed = ProjectFiles::in_archive(
        &archive,
        &Config::default(),
        Budget::repair(),
        &resolver_naming(&[BANK_IN_WAD]),
        None,
    )
    .unwrap();

    let in_tree = found_in(&tree);
    let in_archive = found_in(&packed);

    assert_eq!(in_tree.len(), 1);
    assert_eq!(in_archive.len(), 1);
    assert_eq!(in_archive[0].severity, in_tree[0].severity);
    assert_eq!(in_archive[0].message, in_tree[0].message);
    assert_eq!(in_archive[0].site.path, BANK_IN_LAYER);
}

/// The same, for the shape that has to fall back to the whole file.
#[test]
fn an_archive_falls_back_to_the_whole_chunk_the_same_way_a_tree_does() {
    let bytes = bank(
        LEGACY,
        &[(*b"DIDX", 24), (*b"DATA", 32 * 1024), (HIERARCHY, 64)],
    );

    let archive_dir = tempfile::tempdir().unwrap();
    let archive = archive_dir.path().join("behind-media.fantome");
    make_packed_chunk_fantome_zip(&archive, "Behind Media", BANK_IN_WAD, &bytes);
    let packed = ProjectFiles::in_archive(
        &archive,
        &Config::default(),
        Budget::repair(),
        &resolver_naming(&[BANK_IN_WAD]),
        None,
    )
    .unwrap();

    assert_eq!(found_in(&packed).len(), 1);
}

// ---- the guard on removal -------------------------------------------------

/// The first row of the guard, and 15 of the 17 banks measured: the install
/// holds one at the same path, so its own answers the request.
#[test]
fn a_bank_the_install_holds_is_offered_for_removal() {
    let (_tmp, files) = project_with(
        &silent_bank(),
        &[BANK_IN_WAD],
        Some(FakeGame::holding(&[BANK_IN_WAD])),
    );

    let problems = found_in(&files);
    let fix = problems[0].fix.as_ref().expect("the game answers for it");
    let note = fix.note.as_deref().unwrap_or_default();
    assert!(note.contains("your game's own bank"), "{note}");
}

/// The second row, and the two banks measured that must not be removed:
/// something asks and nothing would answer, which trades silence for a crash.
#[test]
fn a_bank_a_unit_asks_for_that_the_install_lacks_is_refused() {
    let (_tmp, files) = project_with(&silent_bank(), &[BANK_IN_WAD], Some(FakeGame::empty()));

    let problems = found_in(&files);
    assert_eq!(problems[0].fix, None);
    let message = problems[0].message.as_deref().unwrap_or_default();
    assert!(message.contains(UNANSWERED_CODE), "{message}");
}

/// The third row: nothing asks, so removing it leaves nothing unanswered
/// whatever the install holds.
#[test]
fn a_bank_nothing_asks_for_is_offered_for_removal() {
    let (_tmp, files) = project_with(&silent_bank(), &[], Some(FakeGame::empty()));

    let problems = found_in(&files);
    let fix = problems[0].fix.as_ref().expect("nobody asks for it");
    let note = fix.note.as_deref().unwrap_or_default();
    assert!(note.contains("Nothing in the mod asks"), "{note}");
}

/// A bank unit naming a different file is not a request for this one.
#[test]
fn a_unit_asking_for_something_else_does_not_hold_the_bank_back() {
    let (_tmp, files) = project_with(
        &silent_bank(),
        &["assets/sounds/wwise2016/sfx/somebody_else.bnk"],
        Some(FakeGame::empty()),
    );

    assert!(found_in(&files)[0].fix.is_some());
}

/// The question the guard asks is about the install, so a machine with none
/// gets the honest answer rather than a guess.
#[test]
fn no_install_means_no_removal_is_offered() {
    let (_tmp, files) = project_with(&silent_bank(), &[], None);

    let problems = found_in(&files);
    assert_eq!(problems[0].fix, None);
    let message = problems[0].message.as_deref().unwrap_or_default();
    assert!(message.contains("no League install"), "{message}");
}

// ---- the repair -----------------------------------------------------------

fn fix_run(root: &std::path::Path, game: Option<Arc<dyn GameContent>>) -> FixRun<'static> {
    FixRun::open(root, Vec::new(), None, Config::default(), game)
}

#[test]
fn the_repair_deletes_the_bank_and_leaves_the_rest_alone() {
    let game = FakeGame::holding(&[BANK_IN_WAD]);
    let (tmp, files) = project_with(&silent_bank(), &[BANK_IN_WAD], Some(Arc::clone(&game)));
    let problems = found_in(&files);
    let chosen: Vec<&Problem> = problems.iter().collect();

    let mut run = fix_run(tmp.path(), Some(game));
    let applied = AudioBankVersion::new().fix(&chosen, &mut run).unwrap();
    let report = run.finish().unwrap();

    assert_eq!(
        applied,
        Applied {
            applied: 1,
            skipped: 0
        }
    );
    let layer = tmp.path().join("content").join("base");
    assert!(
        !layer
            .join(BANK_IN_LAYER.replace('/', std::path::MAIN_SEPARATOR_STR))
            .exists(),
        "the bank is still there"
    );
    assert!(
        layer
            .join(BIN_IN_LAYER.replace('/', std::path::MAIN_SEPARATOR_STR))
            .exists(),
        "the repair took the bin with it"
    );
    assert_eq!(report.files.len(), 1);
    assert_eq!(report.files[0].change, crate::problems::FileChange::Removed);
}

/// The guard is re-derived rather than replayed, so a repair chosen while the
/// install held the path does nothing once it does not.
#[test]
fn the_repair_refuses_where_the_guard_no_longer_holds() {
    let (tmp, files) = project_with(
        &silent_bank(),
        &[BANK_IN_WAD],
        Some(FakeGame::holding(&[BANK_IN_WAD])),
    );
    let problems = found_in(&files);
    let chosen: Vec<&Problem> = problems.iter().collect();

    let mut run = fix_run(tmp.path(), Some(FakeGame::empty()));
    let applied = AudioBankVersion::new().fix(&chosen, &mut run).unwrap();
    run.finish().unwrap();

    assert_eq!(
        applied,
        Applied {
            applied: 0,
            skipped: 1
        }
    );
    assert!(
        tmp.path()
            .join("content")
            .join("base")
            .join(BANK_IN_LAYER.replace('/', std::path::MAIN_SEPARATOR_STR))
            .exists()
    );
}

/// A repair offered twice applies once, because the second run finds no bank
/// to judge at all.
#[test]
fn a_second_repair_over_a_removed_bank_skips_it() {
    let game = FakeGame::holding(&[BANK_IN_WAD]);
    let (tmp, files) = project_with(&silent_bank(), &[], Some(Arc::clone(&game)));
    let problems = found_in(&files);
    let chosen: Vec<&Problem> = problems.iter().collect();

    let mut run = fix_run(tmp.path(), Some(Arc::clone(&game)));
    AudioBankVersion::new().fix(&chosen, &mut run).unwrap();
    run.finish().unwrap();

    let mut again = fix_run(tmp.path(), Some(game));
    let applied = AudioBankVersion::new().fix(&chosen, &mut again).unwrap();

    assert_eq!(applied.applied, 0);
    assert_eq!(applied.skipped, 1);
}
