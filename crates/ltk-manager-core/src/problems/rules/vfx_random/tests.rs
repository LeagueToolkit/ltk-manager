//! Unit tests for which table lists each rule reports, and which it leaves alone.

use fs_err as fs;
use ltk_hash::Hash as _;
use ltk_meta::property::{Kind, NoMeta, values};
use ltk_meta::{Bin, BinObject, PropertyValueEnum};

use super::*;
use crate::config::Config;
use crate::problems::ProjectFiles;

/// The name the fixture's one WAD goes by.
const WAD: &str = "Aatrox.wad.client";

/// Where the fixture's bin sits inside that WAD.
const BIN_IN_WAD: &str = "data/characters/aatrox/skins/skin0.bin";

/// The particle system object the fixture's emitter hangs off.
const SYSTEM: BinHash = BinHash(0x5151_0001);

fn hash(name: &str) -> BinHash {
    BinHash::hash_str(name)
}

fn floats(levels: &[f32]) -> PropertyValueEnum {
    let items = levels
        .iter()
        .map(|&level| values::F32::new(level).into())
        .collect();
    PropertyValueEnum::Container(values::Container::new(Kind::F32, items).unwrap())
}

/// A table drawing `factors` at `chances`.
fn table(chances: &[f32], factors: &[f32]) -> PropertyValueEnum {
    values::Struct {
        class_hash: hash("VfxProbabilityTableData"),
        properties: [(KEY_TIMES, floats(chances)), (KEY_VALUES, floats(factors))]
            .into_iter()
            .collect(),
        meta: NoMeta,
    }
    .into()
}

/// A random table, drawing from half to the whole of its value.
fn uniform() -> PropertyValueEnum {
    table(&[0.0, 1.0], &[0.5, 1.0])
}

/// A keyless table, which multiplies by its default of 1.
fn filler() -> PropertyValueEnum {
    values::Struct {
        class_hash: hash("VfxProbabilityTableData"),
        properties: Default::default(),
        meta: NoMeta,
    }
    .into()
}

/// A slot the file leaves null.
fn null() -> PropertyValueEnum {
    PropertyValueEnum::Struct(values::Struct::default())
}

/// A colour value whose curve holds `slots`.
fn value(slots: Vec<PropertyValueEnum>) -> PropertyValueEnum {
    let list = values::Container::new(Kind::Struct, slots).unwrap();
    let dynamics = values::Struct {
        class_hash: hash("VfxAnimatedColorVariableData"),
        properties: [(PROBABILITY_TABLES, PropertyValueEnum::Container(list))]
            .into_iter()
            .collect(),
        meta: NoMeta,
    };
    values::Embedded(values::Struct {
        class_hash: hash("ValueColor"),
        properties: [(DYNAMICS, dynamics.into())].into_iter().collect(),
        meta: NoMeta,
    })
    .into()
}

/// A system whose one emitter sets `field` to `value`.
fn bin(field: &str, value: PropertyValueEnum) -> Vec<u8> {
    let emitter = values::Struct {
        class_hash: EMITTER,
        properties: [(hash(field), value)].into_iter().collect(),
        meta: NoMeta,
    };
    let emitters =
        values::Container::new(Kind::Embedded, vec![values::Embedded(emitter).into()]).unwrap();
    let bin = Bin::new(
        [
            BinObject::<NoMeta>::builder(SYSTEM, hash("VfxSystemDefinitionData"))
                .property(
                    hash("complexEmitterDefinitionData"),
                    PropertyValueEnum::Container(emitters),
                )
                .build(),
        ],
        std::iter::empty::<&str>(),
    );

    let mut out = std::io::Cursor::new(Vec::new());
    bin.to_writer(&mut out).unwrap();
    out.into_inner()
}

/// What `rule` reports over a project holding `bytes` as its one bin.
fn found(bytes: &[u8], rule: &dyn Rule) -> Vec<Problem> {
    let tmp = tempfile::tempdir().unwrap();
    let file = tmp
        .path()
        .join("content")
        .join("base")
        .join(format!("{WAD}/{BIN_IN_WAD}").replace('/', std::path::MAIN_SEPARATOR_STR));
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    fs::write(&file, bytes).unwrap();

    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();
    let (problems, failed) = files.report(&[rule]).finish();
    assert!(
        failed.is_empty(),
        "the fixture should read cleanly: {failed:?}"
    );
    problems
}

/// A set of four slots whose first draws `first`, the rest filler.
fn set(first: PropertyValueEnum) -> Vec<PropertyValueEnum> {
    vec![first, filler(), filler(), filler()]
}

/// The names the constants stand for, so a mistyped hash is a failing test
/// rather than a rule that quietly reports nothing forever.
#[test]
fn the_constants_are_the_names_they_stand_for() {
    assert_eq!(PROBABILITY_TABLES, hash("probabilityTables"));
    assert_eq!(KEY_TIMES, hash("keyTimes"));
    assert_eq!(KEY_VALUES, hash("keyValues"));
    assert_eq!(DYNAMICS, hash("dynamics"));
    assert_eq!(EMITTER, hash("VfxEmitterDefinitionData"));
    assert_eq!(REROLLED, [hash("Color"), hash("scale0")]);
}

#[test]
fn a_random_table_on_a_per_frame_colour_is_reported() {
    let problems = found(
        &bin("Color", value(set(uniform()))),
        &VfxPerFrameRandom::new(),
    );

    assert_eq!(problems.len(), 1);
    let problem = &problems[0];
    assert_eq!(problem.rule, PER_FRAME_ID);
    assert_eq!(problem.severity, Severity::Warning);
    let node = problem.site.node.as_ref().expect("the table list");
    assert_eq!(node.entry, SYSTEM);
    assert!(node.path.ends_with("a7084719"), "{}", node.path);
}

/// A birth value reads its tables once, at the particle's roll, which is what
/// they are for.
#[test]
fn a_random_table_on_a_birth_value_is_left_alone() {
    let problems = found(
        &bin("birthColor", value(set(uniform()))),
        &VfxPerFrameRandom::new(),
    );

    assert!(problems.is_empty());
}

/// A factor that never varies draws the same number every frame, so nothing
/// flickers.
#[test]
fn a_fixed_table_on_a_per_frame_value_is_left_alone() {
    let fixed = table(&[0.0], &[2.0]);

    let problems = found(&bin("scale0", value(set(fixed))), &VfxPerFrameRandom::new());

    assert!(problems.is_empty());
}

#[test]
fn a_null_slot_after_a_held_first_slot_is_reported_as_a_crash() {
    let slots = vec![uniform(), null(), filler(), filler()];

    let problems = found(&bin("birthColor", value(slots)), &VfxBrokenRandom::new());

    assert_eq!(problems.len(), 1);
    assert_eq!(problems[0].rule, BROKEN_ID);
    assert_eq!(problems[0].severity, Severity::Error);
    let message = problems[0]
        .message
        .clone()
        .expect("the row says what it found");
    assert!(message.contains("3 tables for 4 channels"), "{message}");
    assert!(message.contains("crashes"), "{message}");
}

/// The game skips the whole set when its first slot is null, so the rest are
/// never read and nothing crashes.
#[test]
fn a_set_whose_first_slot_is_null_is_left_alone() {
    let slots = vec![null(), uniform(), filler(), filler()];

    let problems = found(&bin("birthColor", value(slots)), &VfxBrokenRandom::new());

    assert!(problems.is_empty());
}

#[test]
fn lists_of_two_lengths_are_reported_as_zeroed() {
    let uneven = table(&[0.0, 1.0], &[0.5]);

    let problems = found(
        &bin("birthColor", value(set(uneven))),
        &VfxBrokenRandom::new(),
    );

    assert_eq!(problems.len(), 1);
    let message = problems[0]
        .message
        .clone()
        .expect("the row says what it found");
    assert!(message.contains("zeroed"), "{message}");
}

#[test]
fn a_whole_set_on_a_birth_value_reports_nothing() {
    let bytes = bin("birthColor", value(set(uniform())));

    assert!(found(&bytes, &VfxBrokenRandom::new()).is_empty());
    assert!(found(&bytes, &VfxPerFrameRandom::new()).is_empty());
}

/// Which value the author meant is not in the file, so neither rule guesses.
#[test]
fn neither_rule_offers_a_repair() {
    let problems = found(
        &bin("Color", value(set(uniform()))),
        &VfxPerFrameRandom::new(),
    );

    assert_eq!(problems[0].fix, None);
    assert!(!VfxPerFrameRandom::new().unfixable_description().is_empty());
    assert!(!VfxBrokenRandom::new().unfixable_description().is_empty());
}
