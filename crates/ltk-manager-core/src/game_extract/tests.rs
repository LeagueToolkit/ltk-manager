//! Unit tests for the extract plan, the layouts it writes and the paths it refuses.

use super::*;
use crate::events::NullEventSink;
use ltk_wad::{WadBuilder, WadChunkBuilder};
use std::io::Write as _;

fn final_dir(root: &Path) -> PathBuf {
    let dir = root.join("DATA").join("FINAL");
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn build_wad(path: &Path, chunk_paths: &[&str]) {
    build_wad_of(path, chunk_paths, &[0xAA; 64]);
}

/// A WAD whose every chunk holds `bytes`, for the tests that care what the
/// kind sniffer makes of them.
fn build_wad_of(path: &Path, chunk_paths: &[&str], bytes: &[u8]) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    let mut builder = WadBuilder::default();
    for chunk_path in chunk_paths {
        builder = builder.with_chunk(WadChunkBuilder::default().with_path(*chunk_path));
    }
    let mut file = fs::File::create(path).unwrap();
    builder
        .build_to_writer(&mut file, |_path_hash, cursor| {
            cursor.write_all(bytes)?;
            Ok(())
        })
        .unwrap();
}

/// A WAD whose chunks each hold their own bytes, keyed by the path they were
/// added under.
fn build_wad_chunks(path: &Path, chunks: &[(&str, Vec<u8>)]) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    let mut builder = WadBuilder::default();
    for (chunk_path, _) in chunks {
        builder = builder.with_chunk(WadChunkBuilder::default().with_path(*chunk_path));
    }
    let mut file = fs::File::create(path).unwrap();
    builder
        .build_to_writer(&mut file, |hash, cursor| {
            let (_, bytes) = chunks
                .iter()
                .find(|(chunk_path, _)| WadHash(path_hash(chunk_path)) == hash)
                .expect("every chunk was built from this list");
            cursor.write_all(bytes)?;
            Ok(())
        })
        .unwrap();
}

/// A string as a bin writes it: a little-endian `u16` length, then the bytes.
fn bin_string(out: &mut Vec<u8>, text: &str) {
    out.extend_from_slice(&(text.len() as u16).to_le_bytes());
    out.extend_from_slice(text.as_bytes());
}

/// Enough of a bin for the name recovery to read paths back out of it.
///
/// The recovery parses no structure, so the magic and the length-prefixed
/// strings are the whole of what it needs.
fn bin_with(paths: &[&str]) -> Vec<u8> {
    let mut out = b"PROP".to_vec();
    out.extend_from_slice(&2u32.to_le_bytes());
    out.extend_from_slice(&(paths.len() as u32).to_le_bytes());
    for path in paths {
        bin_string(&mut out, path);
    }
    out
}

/// The key the `game` table would file this path under, asked of the table
/// itself so a test cannot disagree with it about the algorithm.
fn path_hash(path: &str) -> u64 {
    crate::hashtables::Table::Game.key_config().hash(path)
}

fn names(paths: &[&str]) -> WadPathResolver {
    let mut db = crate::hashtables::LayeredHashDb::new();
    for path in paths {
        db.insert(path_hash(path), *path);
    }
    WadPathResolver::new(db)
}

fn options(destination: &Path) -> ExtractOptions {
    ExtractOptions {
        destination: destination.to_string_lossy().into_owned(),
        layout: ExtractLayout::Paths,
        per_archive_folder: false,
        existing: ExistingFiles::Skip,
        recover_names: false,
        kinds: None,
    }
}

fn hash_of(path: &str) -> String {
    format!("{:016x}", path_hash(path))
}

#[test]
fn an_archive_target_takes_every_chunk_of_the_archive() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = final_dir(tmp.path());
    build_wad(
        &dir.join("Aatrox.wad.client"),
        &["assets/one.dds", "assets/two.bin"],
    );
    let archives = GameArchives::at(tmp.path());
    let resolver = names(&["assets/one.dds", "assets/two.bin"]);

    let job = ExtractJob::plan(
        &[ExtractTarget::Archive {
            wad: "Aatrox.wad.client".to_owned(),
        }],
        None,
        &GameIndex::build(&archives, &Default::default()).unwrap(),
        &archives,
        &resolver,
    )
    .unwrap();

    assert_eq!(job.summary().files, 2);
    assert_eq!(job.summary().archives, ["Aatrox.wad.client"]);
}

#[test]
fn a_chunk_named_twice_is_planned_once() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = final_dir(tmp.path());
    build_wad(&dir.join("Aatrox.wad.client"), &["assets/one.dds"]);
    let archives = GameArchives::at(tmp.path());
    let resolver = names(&["assets/one.dds"]);

    let job = ExtractJob::plan(
        &[
            ExtractTarget::Archive {
                wad: "Aatrox.wad.client".to_owned(),
            },
            ExtractTarget::File {
                wad: "Aatrox.wad.client".to_owned(),
                path_hash: hash_of("assets/one.dds"),
                path: Some("assets/one.dds".to_owned()),
                size_bytes: 64,
            },
        ],
        None,
        &GameIndex::build(&archives, &Default::default()).unwrap(),
        &archives,
        &resolver,
    )
    .unwrap();

    assert_eq!(job.summary().files, 1);
}

#[test]
fn the_kind_filter_drops_a_named_chunk_of_another_kind() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = final_dir(tmp.path());
    build_wad(
        &dir.join("Aatrox.wad.client"),
        &["assets/one.dds", "assets/two.bin"],
    );
    let archives = GameArchives::at(tmp.path());
    let resolver = names(&["assets/one.dds", "assets/two.bin"]);

    let job = ExtractJob::plan(
        &[ExtractTarget::Archive {
            wad: "Aatrox.wad.client".to_owned(),
        }],
        Some(&[WorkshopFileKind::TextureDds]),
        &GameIndex::build(&archives, &Default::default()).unwrap(),
        &archives,
        &resolver,
    )
    .unwrap();

    assert_eq!(job.summary().files, 1);
}

#[test]
fn extracting_writes_each_chunk_at_its_path() {
    let tmp = tempfile::tempdir().unwrap();
    let out = tmp.path().join("out");
    let dir = final_dir(tmp.path());
    build_wad(
        &dir.join("Aatrox.wad.client"),
        &["assets/one.dds", "assets/deep/two.bin"],
    );
    let archives = GameArchives::at(tmp.path());
    let resolver = names(&["assets/one.dds", "assets/deep/two.bin"]);

    let job = ExtractJob::plan(
        &[ExtractTarget::Archive {
            wad: "Aatrox.wad.client".to_owned(),
        }],
        None,
        &GameIndex::build(&archives, &Default::default()).unwrap(),
        &archives,
        &resolver,
    )
    .unwrap();
    let summary = job
        .run(
            &options(&out),
            &Config::default(),
            &archives,
            &resolver,
            &NullEventSink,
            &AtomicBool::new(false),
        )
        .unwrap();

    assert_eq!(summary.extracted, 2);
    assert_eq!(summary.bytes_written, 128);
    assert!(out.join("assets/one.dds").is_file());
    assert!(out.join("assets/deep/two.bin").is_file());
}

#[test]
fn one_folder_per_archive_names_it_by_the_archive_alone() {
    let tmp = tempfile::tempdir().unwrap();
    let out = tmp.path().join("out");
    let dir = final_dir(tmp.path());
    build_wad(
        &dir.join("Champions").join("Aatrox.wad.client"),
        &["assets/one.dds"],
    );
    let archives = GameArchives::at(tmp.path());
    let resolver = names(&["assets/one.dds"]);

    let job = ExtractJob::plan(
        &[ExtractTarget::Archive {
            wad: "Champions/Aatrox.wad.client".to_owned(),
        }],
        None,
        &GameIndex::build(&archives, &Default::default()).unwrap(),
        &archives,
        &resolver,
    )
    .unwrap();
    let mut options = options(&out);
    options.per_archive_folder = true;
    job.run(
        &options,
        &Config::default(),
        &archives,
        &resolver,
        &NullEventSink,
        &AtomicBool::new(false),
    )
    .unwrap();

    assert!(out.join("Aatrox.wad.client/assets/one.dds").is_file());
}

#[test]
fn skip_leaves_a_file_that_is_already_there() {
    let tmp = tempfile::tempdir().unwrap();
    let out = tmp.path().join("out");
    fs::create_dir_all(out.join("assets")).unwrap();
    fs::write(out.join("assets/one.dds"), b"mine").unwrap();
    let dir = final_dir(tmp.path());
    build_wad(&dir.join("Aatrox.wad.client"), &["assets/one.dds"]);
    let archives = GameArchives::at(tmp.path());
    let resolver = names(&["assets/one.dds"]);

    let job = ExtractJob::plan(
        &[ExtractTarget::Archive {
            wad: "Aatrox.wad.client".to_owned(),
        }],
        None,
        &GameIndex::build(&archives, &Default::default()).unwrap(),
        &archives,
        &resolver,
    )
    .unwrap();
    let summary = job
        .run(
            &options(&out),
            &Config::default(),
            &archives,
            &resolver,
            &NullEventSink,
            &AtomicBool::new(false),
        )
        .unwrap();

    assert_eq!(summary.extracted, 0);
    assert_eq!(summary.skipped_existing, 1);
    assert_eq!(fs::read(out.join("assets/one.dds")).unwrap(), b"mine");
}

#[test]
fn a_chunk_nothing_names_lands_under_its_hex_hash() {
    let tmp = tempfile::tempdir().unwrap();
    let out = tmp.path().join("out");
    let dir = final_dir(tmp.path());
    build_wad(&dir.join("Aatrox.wad.client"), &["assets/one.dds"]);
    let archives = GameArchives::at(tmp.path());

    let job = ExtractJob::plan(
        &[ExtractTarget::Archive {
            wad: "Aatrox.wad.client".to_owned(),
        }],
        None,
        &GameIndex::build(&archives, &Default::default()).unwrap(),
        &archives,
        &names(&[]),
    )
    .unwrap();
    let summary = job
        .run(
            &options(&out),
            &Config::default(),
            &archives,
            &names(&[]),
            &NullEventSink,
            &AtomicBool::new(false),
        )
        .unwrap();

    assert_eq!(summary.extracted, 1);
    let written: Vec<String> = fs::read_dir(&out)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(written, [hash_of("assets/one.dds")]);
}

#[test]
fn a_nameless_chunk_lands_without_the_extension_its_bytes_identify() {
    let tmp = tempfile::tempdir().unwrap();
    let out = tmp.path().join("out");
    let dir = final_dir(tmp.path());
    build_wad_of(
        &dir.join("Aatrox.wad.client"),
        &["assets/one.dds"],
        b"DDS     ",
    );
    let archives = GameArchives::at(tmp.path());

    let job = ExtractJob::plan(
        &[ExtractTarget::Archive {
            wad: "Aatrox.wad.client".to_owned(),
        }],
        None,
        &GameIndex::build(&archives, &Default::default()).unwrap(),
        &archives,
        &names(&[]),
    )
    .unwrap();
    job.run(
        &options(&out),
        &Config::default(),
        &archives,
        &names(&[]),
        &NullEventSink,
        &AtomicBool::new(false),
    )
    .unwrap();

    let written: Vec<String> = fs::read_dir(&out)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(written, [hash_of("assets/one.dds")]);
}

#[test]
fn a_destination_inside_the_install_is_refused() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = final_dir(tmp.path());
    build_wad(&dir.join("Aatrox.wad.client"), &["assets/one.dds"]);
    let archives = GameArchives::at(tmp.path());
    let resolver = names(&["assets/one.dds"]);
    let config = Config {
        league_path: Some(tmp.path().to_path_buf()),
        ..Config::default()
    };

    let job = ExtractJob::plan(
        &[ExtractTarget::Archive {
            wad: "Aatrox.wad.client".to_owned(),
        }],
        None,
        &GameIndex::build(&archives, &Default::default()).unwrap(),
        &archives,
        &resolver,
    )
    .unwrap();
    let err = job
        .run(
            &options(&tmp.path().join("DATA").join("mine")),
            &config,
            &archives,
            &resolver,
            &NullEventSink,
            &AtomicBool::new(false),
        )
        .unwrap_err();

    assert!(matches!(err, AppError::ValidationFailed(_)));
}

#[test]
fn a_cancelled_run_says_so() {
    let tmp = tempfile::tempdir().unwrap();
    let out = tmp.path().join("out");
    let dir = final_dir(tmp.path());
    build_wad(&dir.join("Aatrox.wad.client"), &["assets/one.dds"]);
    let archives = GameArchives::at(tmp.path());
    let resolver = names(&["assets/one.dds"]);

    let job = ExtractJob::plan(
        &[ExtractTarget::Archive {
            wad: "Aatrox.wad.client".to_owned(),
        }],
        None,
        &GameIndex::build(&archives, &Default::default()).unwrap(),
        &archives,
        &resolver,
    )
    .unwrap();
    let summary = job
        .run(
            &options(&out),
            &Config::default(),
            &archives,
            &resolver,
            &NullEventSink,
            &AtomicBool::new(true),
        )
        .unwrap();

    assert!(summary.cancelled);
    assert_eq!(summary.extracted, 0);
}

#[test]
fn a_directory_target_takes_every_file_below_it() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = final_dir(tmp.path());
    build_wad(
        &dir.join("Aatrox.wad.client"),
        &[
            "assets/skins/base/one.dds",
            "assets/skins/two.dds",
            "data/three.bin",
        ],
    );
    let archives = GameArchives::at(tmp.path());
    let mut db = ltk_hashdb::LayeredHashDb::new();
    for path in [
        "assets/skins/base/one.dds",
        "assets/skins/two.dds",
        "data/three.bin",
    ] {
        db.insert(path_hash(path), path);
    }
    let index = GameIndex::build(&archives, &db).unwrap();

    let job = ExtractJob::plan(
        &[ExtractTarget::Dir {
            path: "assets/skins".to_owned(),
        }],
        None,
        &index,
        &archives,
        &names(&[
            "assets/skins/base/one.dds",
            "assets/skins/two.dds",
            "data/three.bin",
        ]),
    )
    .unwrap();

    assert_eq!(job.summary().files, 2);
}

#[test]
fn a_directory_the_index_does_not_hold_is_an_invalid_path() {
    let tmp = tempfile::tempdir().unwrap();
    final_dir(tmp.path());
    let archives = GameArchives::at(tmp.path());
    let index = GameIndex::build(&archives, &Default::default()).unwrap();

    let err = ExtractJob::plan(
        &[ExtractTarget::Dir {
            path: "nope/nowhere".to_owned(),
        }],
        None,
        &index,
        &archives,
        &names(&[]),
    )
    .unwrap_err();

    assert!(matches!(err, AppError::InvalidPath(_)));
}

#[test]
fn the_flat_layout_drops_the_directories() {
    let tmp = tempfile::tempdir().unwrap();
    let out = tmp.path().join("out");
    let dir = final_dir(tmp.path());
    build_wad(&dir.join("Aatrox.wad.client"), &["assets/deep/one.dds"]);
    let archives = GameArchives::at(tmp.path());
    let resolver = names(&["assets/deep/one.dds"]);

    let job = ExtractJob::plan(
        &[ExtractTarget::Archive {
            wad: "Aatrox.wad.client".to_owned(),
        }],
        None,
        &GameIndex::build(&archives, &Default::default()).unwrap(),
        &archives,
        &resolver,
    )
    .unwrap();
    let mut options = options(&out);
    options.layout = ExtractLayout::Flat;
    job.run(
        &options,
        &Config::default(),
        &archives,
        &resolver,
        &NullEventSink,
        &AtomicBool::new(false),
    )
    .unwrap();

    assert!(out.join("one.dds").is_file());
}

#[test]
fn a_run_reports_its_last_chunk() {
    struct Counting(std::sync::Mutex<Vec<ExtractProgress>>);
    impl EventSink for Counting {
        fn emit(&self, event: BackendEvent) {
            if let BackendEvent::ExtractProgress(progress) = event {
                self.0.lock().unwrap().push(progress);
            }
        }
    }

    let tmp = tempfile::tempdir().unwrap();
    let out = tmp.path().join("out");
    let dir = final_dir(tmp.path());
    build_wad(
        &dir.join("Aatrox.wad.client"),
        &["assets/one.dds", "assets/two.dds"],
    );
    let archives = GameArchives::at(tmp.path());
    let resolver = names(&["assets/one.dds", "assets/two.dds"]);
    let events = Counting(std::sync::Mutex::new(Vec::new()));

    let job = ExtractJob::plan(
        &[ExtractTarget::Archive {
            wad: "Aatrox.wad.client".to_owned(),
        }],
        None,
        &GameIndex::build(&archives, &Default::default()).unwrap(),
        &archives,
        &resolver,
    )
    .unwrap();
    job.run(
        &options(&out),
        &Config::default(),
        &archives,
        &resolver,
        &events,
        &AtomicBool::new(false),
    )
    .unwrap();

    let seen = events.0.lock().unwrap();
    let last = seen.last().expect("the run reports at least one chunk");
    assert_eq!(last.current, 2);
    assert_eq!(last.total, 2);
}

#[test]
fn the_archive_folder_is_the_file_name_alone() {
    assert_eq!(
        archive_folder("Champions/Aatrox.wad.client"),
        "Aatrox.wad.client"
    );
    assert_eq!(archive_folder("Global.wad.client"), "Global.wad.client");
}

#[test]
fn a_path_that_does_not_exist_yet_resolves_through_its_parent() {
    let tmp = tempfile::tempdir().unwrap();

    assert!(is_within(tmp.path(), &tmp.path().join("not/here/yet")));
    assert!(!is_within(&tmp.path().join("a"), &tmp.path().join("b")));
}

#[test]
fn a_bin_names_a_chunk_no_hash_table_knows() {
    let tmp = tempfile::tempdir().unwrap();
    let out = tmp.path().join("out");
    let dir = final_dir(tmp.path());
    build_wad_chunks(
        &dir.join("Aatrox.wad.client"),
        &[
            (
                "assets/data/thing.bin",
                bin_with(&["assets/found/icon.dds"]),
            ),
            ("assets/found/icon.dds", b"DDS     ".to_vec()),
        ],
    );
    let archives = GameArchives::at(tmp.path());
    /* Only the bin is named, so the chunk it points at is the one the archive
    has to name for itself. */
    let resolver = names(&["assets/data/thing.bin"]);

    let job = ExtractJob::plan(
        &[ExtractTarget::Archive {
            wad: "Aatrox.wad.client".to_owned(),
        }],
        None,
        &GameIndex::build(&archives, &Default::default()).unwrap(),
        &archives,
        &resolver,
    )
    .unwrap();
    let summary = job
        .run(
            &ExtractOptions {
                recover_names: true,
                ..options(&out)
            },
            &Config::default(),
            &archives,
            &resolver,
            &NullEventSink,
            &AtomicBool::new(false),
        )
        .unwrap();

    assert_eq!(summary.recovered, 1);
    assert!(out.join("assets/found/icon.dds").is_file());
    assert!(!out.join(hash_of("assets/found/icon.dds")).exists());
}

#[test]
fn the_bins_are_not_read_for_names_unless_asked() {
    let tmp = tempfile::tempdir().unwrap();
    let out = tmp.path().join("out");
    let dir = final_dir(tmp.path());
    build_wad_chunks(
        &dir.join("Aatrox.wad.client"),
        &[
            (
                "assets/data/thing.bin",
                bin_with(&["assets/found/icon.dds"]),
            ),
            ("assets/found/icon.dds", b"DDS     ".to_vec()),
        ],
    );
    let archives = GameArchives::at(tmp.path());
    let resolver = names(&["assets/data/thing.bin"]);

    let job = ExtractJob::plan(
        &[ExtractTarget::Archive {
            wad: "Aatrox.wad.client".to_owned(),
        }],
        None,
        &GameIndex::build(&archives, &Default::default()).unwrap(),
        &archives,
        &resolver,
    )
    .unwrap();
    let summary = job
        .run(
            &options(&out),
            &Config::default(),
            &archives,
            &resolver,
            &NullEventSink,
            &AtomicBool::new(false),
        )
        .unwrap();

    assert_eq!(summary.recovered, 0);
    assert!(out.join(hash_of("assets/found/icon.dds")).is_file());
    assert!(!out.join("assets/found/icon.dds").exists());
}
