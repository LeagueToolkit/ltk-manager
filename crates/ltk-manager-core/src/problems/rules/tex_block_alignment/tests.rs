//! Unit tests for what the rule reports, what it stays quiet about, and what
//! its repair writes.

use super::*;
use crate::config::Config;
use crate::mods::test_support::{make_packed_chunk_fantome_zip, resolver_naming};
use crate::problems::Budget;

/// Where the fixture texture sits, in the tree and inside the archive's WAD.
const TEX_IN_LAYER: &str = "data/characters/ashe/ashe_tx_cm.tex";

/// Two blocks wide and one high, with the width one block short of whole.
const RAGGED: (u32, u32) = (6, 4);

/// The byte the format sits at in a `.tex` header, for a fixture the crate
/// will read back and will not write.
const FORMAT_BYTE: usize = 9;

/// The byte the resource type sits at, for the same reason.
const RESOURCE_TYPE_BYTE: usize = 10;

/// The byte the z-slice count sits at, which is what makes a `.tex` a volume.
const DEPTH_BYTE: usize = 8;

fn bc3() -> EncodeFormat {
    EncodeFormat::Bc3 {
        weigh_colour_by_alpha: false,
    }
}

/// A `.tex` of `size` in `format`, painted one colour.
fn tex_bytes(size: (u32, u32), format: EncodeFormat) -> Vec<u8> {
    let pixels = image::RgbaImage::from_pixel(size.0, size.1, image::Rgba([12, 34, 56, 255]));
    let tex = Tex::encode_rgba_image(&pixels, EncodeOptions::new(format)).unwrap();

    let mut out = Vec::new();
    tex.write(&mut out).unwrap();
    out
}

/// A project holding one `.tex` at `content/base/<TEX_IN_LAYER>`.
fn project(bytes: &[u8]) -> (tempfile::TempDir, ProjectFiles) {
    let tmp = tempfile::tempdir().unwrap();
    let at = tmp
        .path()
        .join("content")
        .join("base")
        .join(TEX_IN_LAYER.replace('/', std::path::MAIN_SEPARATOR_STR));
    std::fs::create_dir_all(at.parent().unwrap()).unwrap();
    std::fs::write(&at, bytes).unwrap();

    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();
    (tmp, files)
}

fn found_in(files: &ProjectFiles) -> Vec<Problem> {
    let mut report = Report::default();
    TexBlockAlignment::new().check(files, &mut report);
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

#[test]
fn a_block_compressed_texture_with_a_ragged_dimension_is_fatal() {
    let problems = found(&tex_bytes(RAGGED, bc3()));

    assert_eq!(problems.len(), 1);
    let problem = &problems[0];
    assert_eq!(problem.rule, ID);
    assert_eq!(problem.severity, Severity::Fatal);
    assert_eq!(problem.site.layer, "base");
    assert_eq!(problem.site.path, TEX_IN_LAYER);
    assert_eq!(problem.site.node, None, "the rule reads the whole file");
}

#[test]
fn a_block_compressed_texture_on_the_grid_reports_nothing() {
    assert!(found(&tex_bytes((8, 4), bc3())).is_empty());
}

/// An uncompressed format stores one pixel per block, so no size it can be
/// written at is ragged.
#[test]
fn an_uncompressed_texture_reports_nothing_at_any_size() {
    assert!(found(&tex_bytes(RAGGED, EncodeFormat::Bgra8)).is_empty());
}

#[test]
fn the_fix_preview_rounds_down_to_the_block_grid() {
    let problems = found(&tex_bytes(RAGGED, bc3()));

    let fix = problems[0].fix.as_ref().expect("BC3 is a format we write");
    assert_eq!(fix.before.as_deref(), Some("6 × 4"));
    assert_eq!(fix.after.as_deref(), Some("4 × 4"));
}

/// The crash code is what a user holding a crash log matches this row against,
/// and it is the same on every row, so it is said once by the rule.
#[test]
fn the_rule_names_the_crash_code_a_log_records() {
    assert!(
        TexBlockAlignment::new()
            .description()
            .contains("ALE-D0D00020"),
        "the description has to carry the crash code"
    );
}

/// Story: the crate reads more formats than it writes, so a normal map in the
/// two-channel format is reported and left alone rather than converted to a
/// format that would change what the shader reads.
#[test]
fn a_format_the_manager_cannot_write_back_is_reported_with_no_fix() {
    let mut bytes = tex_bytes(RAGGED, bc3());
    bytes[FORMAT_BYTE] = Format::Bc5Snorm.to_u8();

    let problems = found(&bytes);

    assert_eq!(problems.len(), 1);
    assert_eq!(problems[0].fix, None);
    let message = problems[0].message.as_deref().unwrap_or_default();
    assert!(message.contains("Bc5Snorm"), "{message}");
}

/// The repair writes a plain 2D texture, so anything else is reported and left
/// alone rather than flattened into one.
#[test]
fn a_texture_that_is_not_a_plain_one_is_reported_with_no_fix() {
    let mut bytes = tex_bytes(RAGGED, bc3());
    bytes[RESOURCE_TYPE_BYTE] = ResourceType::VolumeTexture.to_u8();

    let problems = found(&bytes);

    assert_eq!(problems.len(), 1);
    assert_eq!(problems[0].fix, None);
}

/// Story: the check that reads an unpacked mod reads a packed one the same
/// way, because both go through the one handle.
#[test]
fn an_archive_reports_what_its_tree_reports() {
    let bytes = tex_bytes(RAGGED, bc3());
    let (_tmp, tree) = project(&bytes);

    let archive_dir = tempfile::tempdir().unwrap();
    let archive = archive_dir.path().join("ragged.fantome");
    make_packed_chunk_fantome_zip(&archive, "Ragged", TEX_IN_LAYER, &bytes);
    let packed = ProjectFiles::in_archive(
        &archive,
        &Config::default(),
        Budget::repair(),
        &resolver_naming(&[TEX_IN_LAYER]),
        None,
    )
    .unwrap();

    let in_tree = found_in(&tree);
    let in_archive = found_in(&packed);

    assert_eq!(in_tree.len(), 1);
    assert_eq!(in_archive.len(), 1);
    assert_eq!(in_archive[0].severity, in_tree[0].severity);
    assert_eq!(in_archive[0].fix, in_tree[0].fix);
    assert_eq!(
        in_archive[0].site.path,
        format!("Aatrox.wad.client/{TEX_IN_LAYER}")
    );
}

#[test]
fn the_fix_writes_a_texture_the_game_can_create() {
    let (tmp, files) = project(&tex_bytes(RAGGED, bc3()));
    let problems = found_in(&files);
    let chosen: Vec<&Problem> = problems.iter().collect();

    let mut run = FixRun::open(tmp.path(), Vec::new(), None, Config::default(), None);
    let applied = TexBlockAlignment::new().fix(&chosen, &mut run).unwrap();
    run.finish().unwrap();

    assert_eq!(
        applied,
        Applied {
            applied: 1,
            skipped: 0
        }
    );

    let repaired = std::fs::read(
        tmp.path()
            .join("content")
            .join("base")
            .join(TEX_IN_LAYER.replace('/', std::path::MAIN_SEPARATOR_STR)),
    )
    .unwrap();
    let tex = Tex::from_reader(&mut Cursor::new(&repaired)).unwrap();
    assert_eq!((tex.width, tex.height), (4, 4));
    assert_eq!(tex.format, Format::Bc3);
    assert!(
        Ragged::of(&tex).is_none(),
        "the repair has to be the end of it"
    );
}

/// A repaired file is one the rule no longer objects to, so a repair offered
/// twice writes once.
#[test]
fn a_second_fix_over_a_repaired_texture_skips_it() {
    let (tmp, files) = project(&tex_bytes(RAGGED, bc3()));
    let problems = found_in(&files);
    let chosen: Vec<&Problem> = problems.iter().collect();

    let mut run = FixRun::open(tmp.path(), Vec::new(), None, Config::default(), None);
    TexBlockAlignment::new().fix(&chosen, &mut run).unwrap();
    run.finish().unwrap();

    let mut again = FixRun::open(tmp.path(), Vec::new(), None, Config::default(), None);
    let applied = TexBlockAlignment::new().fix(&chosen, &mut again).unwrap();
    again.finish().unwrap();

    assert_eq!(
        applied,
        Applied {
            applied: 0,
            skipped: 1
        }
    );
}

/// Story: a volume texture is a real thing a `.tex` can be, declared by its
/// depth rather than by its resource type, and resampling one would have to
/// decide what happens to the z-slices. It is reported and left alone.
#[test]
fn a_volume_texture_is_reported_with_no_fix() {
    let mut bytes = tex_bytes(RAGGED, bc3());
    bytes[DEPTH_BYTE] = 4;

    let problems = found(&bytes);

    assert_eq!(problems.len(), 1);
    assert_eq!(problems[0].fix, None);
    let message = problems[0].message.as_deref().unwrap_or_default();
    assert!(message.contains("volume texture of 4 slices"), "{message}");
}
