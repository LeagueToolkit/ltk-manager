//! Unit tests for what a run sees: the files it lists, and how it reads them.

use super::*;
use crate::game::FakeContent;
use fs_err as fs;
use ltk_manager_assets::test_util::bin_bytes;

/// Write `contents` to `path`, creating every directory above it.
fn touch(path: &Path, contents: &[u8]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, contents).unwrap();
}

fn layer(files: &ProjectFiles, name: &str) -> LayerFiles {
    files
        .layers()
        .iter()
        .find(|layer| layer.name == name)
        .unwrap_or_else(|| panic!("no layer named {name}"))
        .clone()
}

fn paths(layer: &LayerFiles) -> Vec<&str> {
    layer.files.iter().map(|file| file.path.as_str()).collect()
}

#[test]
fn every_layer_on_disk_is_read_with_base_first() {
    let tmp = tempfile::tempdir().unwrap();
    for name in ["zephyr", "base", "alt"] {
        touch(
            &tmp.path().join(CONTENT_DIR).join(name).join("a.bin"),
            b"bin",
        );
    }

    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();
    let names: Vec<&str> = files
        .layers()
        .iter()
        .map(|layer| layer.name.as_str())
        .collect();
    assert_eq!(names, ["base", "alt", "zephyr"]);
}

#[test]
fn a_dot_directory_under_content_is_not_a_layer() {
    let tmp = tempfile::tempdir().unwrap();
    touch(
        &tmp.path().join(CONTENT_DIR).join("base").join("a.bin"),
        b"bin",
    );
    touch(
        &tmp.path().join(CONTENT_DIR).join(".git").join("HEAD"),
        b"ref",
    );

    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();
    assert_eq!(files.layers().len(), 1);
    assert_eq!(files.layers()[0].name, "base");
}

#[test]
fn a_dot_file_inside_a_layer_is_read_since_a_pack_includes_it() {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().join(CONTENT_DIR).join("base");
    touch(&base.join("a.bin"), b"bin");
    touch(&base.join(".hidden.bin"), b"bin");
    touch(&base.join(".tools").join("b.bin"), b"bin");

    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();
    assert_eq!(
        paths(&layer(&files, "base")),
        [".hidden.bin", ".tools/b.bin", "a.bin"]
    );
}

#[test]
fn a_file_the_ignore_rules_exclude_is_not_read() {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().join(CONTENT_DIR).join("base");
    touch(&base.join("a.bin"), b"bin");
    touch(&base.join("draft.bin"), b"bin");
    touch(&base.join("scratch").join("b.bin"), b"bin");
    touch(
        &tmp.path().join(".modignore"),
        b"/base/draft.bin\nscratch/\n",
    );

    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();
    assert_eq!(paths(&layer(&files, "base")), ["a.bin"]);
}

#[test]
fn a_layer_the_ignore_rules_exclude_reads_empty() {
    let tmp = tempfile::tempdir().unwrap();
    touch(
        &tmp.path().join(CONTENT_DIR).join("base").join("a.bin"),
        b"bin",
    );
    touch(
        &tmp.path().join(CONTENT_DIR).join("alt").join("b.bin"),
        b"bin",
    );
    touch(&tmp.path().join(".modignore"), b"/alt/\n");

    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();
    assert!(paths(&layer(&files, "alt")).is_empty());
    assert_eq!(paths(&layer(&files, "base")), ["a.bin"]);
}

#[test]
fn a_file_is_read_again_once_its_ignore_rule_is_removed() {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().join(CONTENT_DIR).join("base");
    touch(&base.join("draft.bin"), b"bin");
    touch(&tmp.path().join(".modignore"), b"draft.bin\n");

    let before = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();
    assert!(paths(&layer(&before, "base")).is_empty());

    touch(&tmp.path().join(".modignore"), b"");
    let after = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();
    assert_eq!(paths(&layer(&after, "base")), ["draft.bin"]);
}

#[test]
fn a_nested_modignore_is_neither_read_as_a_file_nor_ignored() {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().join(CONTENT_DIR).join("base");
    touch(&base.join("a.bin"), b"bin");
    touch(&base.join("data").join("draft.bin"), b"bin");
    touch(&base.join("data").join(".modignore"), b"draft.bin\n");

    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();
    assert_eq!(paths(&layer(&files, "base")), ["a.bin"]);
}

/// The content tree also lists every file of such a project.
#[test]
fn rules_that_do_not_compile_leave_every_file_read() {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().join(CONTENT_DIR).join("base");
    touch(&base.join("a.bin"), b"bin");
    touch(&tmp.path().join(".modignore"), b"a{b\n*.bin\n");

    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();
    assert_eq!(paths(&layer(&files, "base")), ["a.bin"]);
}

#[test]
fn only_a_workshop_project_with_no_modignore_lacks_ignore_rules() {
    let tmp = tempfile::tempdir().unwrap();
    touch(
        &tmp.path().join(CONTENT_DIR).join("base").join("a.bin"),
        b"bin",
    );

    let read = || ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();
    assert!(
        !read().lacks_ignore_rules(),
        "a library mod is never reported"
    );
    assert!(read().in_workshop().lacks_ignore_rules());

    touch(&tmp.path().join(".modignore"), b"");
    assert!(
        !read().in_workshop().lacks_ignore_rules(),
        "an empty file counts as rules"
    );
}

#[test]
fn a_nested_modignore_counts_as_ignore_rules() {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().join(CONTENT_DIR).join("base");
    touch(&base.join("a.bin"), b"bin");
    touch(&base.join(".modignore"), b"*.psd\n");

    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();
    assert!(!files.in_workshop().lacks_ignore_rules());
}

#[test]
fn a_modignore_that_does_not_compile_counts_as_ignore_rules() {
    let tmp = tempfile::tempdir().unwrap();
    touch(
        &tmp.path().join(CONTENT_DIR).join("base").join("a.bin"),
        b"bin",
    );
    touch(&tmp.path().join(".modignore"), b"a{b\n");

    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();
    assert!(!files.in_workshop().lacks_ignore_rules());
}

/// A site's path crosses IPC and keys a fix, so it has to be the same on
/// Windows as on every other platform.
#[test]
fn a_path_is_posix_style_and_relative_to_the_layer_root() {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().join(CONTENT_DIR).join("base");
    touch(
        &base
            .join("Smolder.wad.client")
            .join("data")
            .join("characters")
            .join("x.bin"),
        b"bin",
    );

    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();
    assert_eq!(
        paths(&layer(&files, "base")),
        ["Smolder.wad.client/data/characters/x.bin"]
    );
}

#[test]
fn a_kind_comes_from_the_extension() {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().join(CONTENT_DIR).join("base");
    touch(&base.join("skin0.bin"), b"bin");
    touch(&base.join("notes.txt"), b"hello");

    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();
    let base = layer(&files, "base");
    assert_eq!(paths(&base), ["notes.txt", "skin0.bin"]);
    assert_ne!(base.files[0].kind, WorkshopFileKind::PropertyBin);
    assert_eq!(base.files[1].kind, WorkshopFileKind::PropertyBin);
    assert_eq!(base.files[1].size_bytes, 3);
}

/// Story: a mod imported before the hashtables were synced holds its bins under
/// bare hashes, and a rule that reads only `.bin` never sees them.
#[test]
fn a_hex_named_file_in_a_tree_is_a_bin_when_its_first_bytes_are_one() {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().join(CONTENT_DIR).join("base");
    touch(
        &base.join("Aatrox.wad.client").join("32fa9b1e0c4d5a67"),
        &bin_bytes(&ltk_manager_assets::test_util::stale_bin()),
    );

    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();

    let base = layer(&files, "base");
    assert_eq!(paths(&base), ["Aatrox.wad.client/32fa9b1e0c4d5a67"]);
    assert_eq!(base.files[0].kind, WorkshopFileKind::PropertyBin);
    assert_eq!(files.bins().count(), 1);
}

/// The magic decides, so a hex name over something else is still not a bin.
#[test]
fn a_hex_named_file_that_is_not_a_bin_is_left_unknown() {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().join(CONTENT_DIR).join("base");
    touch(
        &base.join("Aatrox.wad.client").join("32fa9b1e0c4d5a67"),
        b"not a league file at all",
    );

    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();

    assert_eq!(
        layer(&files, "base").files[0].kind,
        WorkshopFileKind::Unknown
    );
    assert_eq!(files.bins().count(), 0);
}

/// A named file takes its kind from its extension, so the run does not read a
/// file whose extension already gives its kind.
#[test]
fn a_named_file_is_not_sniffed() {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().join(CONTENT_DIR).join("base");
    touch(&base.join("data").join("skin0.bin"), b"not really a bin");

    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();

    assert_eq!(
        layer(&files, "base").files[0].kind,
        WorkshopFileKind::PropertyBin
    );
}

#[test]
fn a_project_with_no_content_directory_reports_no_layers() {
    let tmp = tempfile::tempdir().unwrap();
    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();

    assert!(files.layers().is_empty());
    assert_eq!(files.root(), tmp.path());
}

#[test]
fn of_kind_names_each_matching_file_with_its_layer() {
    let tmp = tempfile::tempdir().unwrap();
    let content = tmp.path().join(CONTENT_DIR);
    touch(&content.join("base").join("skin0.bin"), b"bin");
    touch(&content.join("base").join("notes.txt"), b"hello");
    touch(&content.join("chroma").join("skin1.bin"), b"bin");

    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();
    let found: Vec<(&str, &str)> = files
        .of_kind(WorkshopFileKind::PropertyBin)
        .map(|handle| (handle.layer(), handle.path()))
        .collect();

    assert_eq!(found, [("base", "skin0.bin"), ("chroma", "skin1.bin")]);
}

/// Every file, not only the kinds a rule already had an accessor for.
#[test]
fn files_names_every_file_of_every_layer() {
    let tmp = tempfile::tempdir().unwrap();
    let content = tmp.path().join(CONTENT_DIR);
    touch(&content.join("base").join("skin0.bin"), b"bin");
    touch(&content.join("base").join("notes.txt"), b"hello");
    touch(&content.join("chroma").join("audio.bnk"), b"BKHD");

    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();
    let found: Vec<(&str, &str)> = files
        .files()
        .map(|handle| (handle.layer(), handle.path()))
        .collect();

    assert_eq!(
        found,
        [
            ("base", "notes.txt"),
            ("base", "skin0.bin"),
            ("chroma", "audio.bnk"),
        ]
    );
}

#[test]
fn a_head_reads_the_first_bytes_of_a_file_on_disk() {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().join(CONTENT_DIR).join("base");
    touch(
        &base.join("notes.txt"),
        b"the first bytes and then the rest",
    );

    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();
    let handle = files.files().next().unwrap();

    assert_eq!(handle.head(9).unwrap(), b"the first");
}

/// A rule that reads a header needs nothing past it, so a file shorter than
/// the bound is a normal answer rather than a failure.
#[test]
fn a_head_of_a_short_file_on_disk_answers_with_what_there_is() {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().join(CONTENT_DIR).join("base");
    touch(&base.join("notes.txt"), b"short");

    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();
    let handle = files.files().next().unwrap();

    assert_eq!(handle.head(8192).unwrap(), b"short");
}

/// A directory layer holds plain files, so they carry no chunk info.
#[test]
fn a_file_on_disk_carries_no_chunk_info() {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().join(CONTENT_DIR).join("base");
    touch(&base.join("skin0.bin"), b"bin");

    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();

    assert_eq!(files.files().next().unwrap().chunk(), None);
}

#[test]
fn an_absolute_path_rebuilds_a_file_a_rule_can_open() {
    let tmp = tempfile::tempdir().unwrap();
    touch(
        &tmp.path()
            .join(CONTENT_DIR)
            .join("base")
            .join("data")
            .join("x.bin"),
        b"bin",
    );

    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();
    let base = layer(&files, "base");
    let absolute = base.absolute(&base.files[0]).expect("a layer on disk");

    assert_eq!(fs::metadata(&absolute).unwrap().len(), 3);
}

#[test]
fn a_config_with_no_league_path_names_no_build() {
    let tmp = tempfile::tempdir().unwrap();
    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();

    assert_eq!(files.build(), None);
}

#[test]
fn analyzing_a_directory_that_is_not_a_project_is_an_error() {
    let tmp = tempfile::tempdir().unwrap();
    let missing = tmp.path().join("charizard-smolder-x");

    assert_matches::assert_matches!(
        analyze(&missing, &Config::default(), None),
        Err(ltk_manager_base::error::AppError::ProjectNotFound(_))
    );
}

#[test]
fn analyzing_a_project_with_nothing_to_report_finds_nothing() {
    let tmp = tempfile::tempdir().unwrap();
    touch(
        &tmp.path().join(CONTENT_DIR).join("base").join("notes.txt"),
        b"hello",
    );

    let run = analyze(tmp.path(), &Config::default(), None).unwrap();
    assert!(run.problems.is_empty());
    assert!(run.failed.is_empty());
}

/// A run over a project with nothing to gate on lists every rule as active,
/// so a panel can tell a clean project from one where rules did not run.
///
/// The run gets an install because a rule that reads the game is gated on
/// having one.
#[test]
fn a_rule_with_nothing_to_wait_for_is_listed_as_active() {
    let tmp = tempfile::tempdir().unwrap();
    touch(
        &tmp.path().join(CONTENT_DIR).join("base").join("notes.txt"),
        b"hello",
    );

    let run = analyze(tmp.path(), &Config::default(), Some(FakeContent::empty())).unwrap();
    assert!(!run.rules.is_empty());
    assert!(run.rules.iter().all(|info| info.state == RuleState::Active));
}

/// A game install older than the build the shipped table is keyed on, so
/// every rule keyed on that build reports what it is waiting for.
fn project_on_an_older_game() -> (tempfile::TempDir, Config) {
    let tmp = tempfile::tempdir().unwrap();
    touch(
        &tmp.path().join(CONTENT_DIR).join("base").join("notes.txt"),
        b"hello",
    );

    let league = tmp.path().join("league");
    touch(
        &league.join("Game").join("content-metadata.json"),
        br#"{ "version": "16.16.8049184+branch.releases-16-16.content.release" }"#,
    );

    let config = Config {
        league_path: Some(league),
        ..Config::default()
    };
    (tmp, config)
}

#[test]
fn a_rule_waiting_on_a_newer_game_says_so_on_the_run() {
    let (tmp, config) = project_on_an_older_game();

    let run = analyze(tmp.path(), &config, Some(FakeContent::empty())).unwrap();
    let dormant: Vec<_> = run
        .rules
        .iter()
        .filter(|info| info.state != RuleState::Active)
        .collect();

    assert_eq!(dormant.len(), 1, "the bin retype rule is the keyed one");
    let RuleState::Dormant { waiting, reason } = &dormant[0].state else {
        unreachable!("filtered on it")
    };
    assert_eq!(waiting, "Patch 16.17");
    assert!(reason.contains("16.17"), "{reason}");
    assert!(reason.contains("16.16"), "{reason}");
    assert!(!reason.contains("8087655"), "{reason}");
}

/// A tree of three bins under one WAD: one equal to the game's copy, one the
/// same size with different bytes, and one larger than the game's copy.
fn wad_bins(game: Option<Arc<dyn GameContent>>) -> (tempfile::TempDir, ProjectFiles) {
    let tmp = tempfile::tempdir().unwrap();
    let data = tmp
        .path()
        .join(CONTENT_DIR)
        .join("base")
        .join("data.wad.client")
        .join("data");
    touch(&data.join("same.bin"), b"PROP-same");
    touch(&data.join("edited.bin"), b"PROP-ours");
    touch(&data.join("grown.bin"), b"PROP-grown-longer");

    let files = ProjectFiles::read(tmp.path(), &Config::default(), game).unwrap();
    (tmp, files)
}

fn sorted_paths(files: &ProjectFiles) -> Vec<String> {
    let mut paths: Vec<String> = files.files().map(|file| file.path().to_owned()).collect();
    paths.sort();
    paths
}

#[test]
fn a_bin_equal_to_the_game_copy_is_removed() {
    let game = FakeContent::containing_bytes(&[
        ("data/same.bin", b"PROP-same"),
        ("data/edited.bin", b"PROP-game"),
        ("data/grown.bin", b"PROP-grown"),
    ]);
    let (_tmp, files) = wad_bins(Some(game));

    let files = files.without_game_copies();

    assert_eq!(
        sorted_paths(&files),
        [
            "data.wad.client/data/edited.bin",
            "data.wad.client/data/grown.bin"
        ]
    );
}

#[test]
fn with_no_install_every_bin_is_kept() {
    let (_tmp, files) = wad_bins(None);

    let files = files.without_game_copies();

    assert_eq!(sorted_paths(&files).len(), 3);
}

/* Reading an archive in place. The fixtures are the health suite's own, and
these tests check that the archive constructor gives the same answers as the
walk over the tree an unpack writes. */

mod archive {
    use super::*;
    use ltk_manager_assets::test_util::{
        STALE_BIN_IN_WAD, bin_bytes, healthy_bin, make_bin_fantome_zip,
        make_layer_wads_fantome_zip, make_packed_bin_fantome_zip, make_raw_bin_fantome_zip,
        resolver_naming, stale_bin,
    };
    use zip::CompressionMethod;

    /// Where the fixture bin lands inside the layer, in either archive shape.
    const BIN_IN_LAYER: &str = "Aatrox.wad.client/data/skin0.bin";

    /// A resolver naming the fixture chunk, so the chunk is listed under
    /// [`BIN_IN_LAYER`] instead of under its hash.
    fn naming_the_bin() -> ltk_manager_assets::hashtables::WadPathResolver {
        resolver_naming(&[STALE_BIN_IN_WAD])
    }

    fn packed(dir: &Path, bin: &ltk_meta::Bin, compression: CompressionMethod) -> PathBuf {
        let archive = dir.join("packed.fantome");
        make_packed_bin_fantome_zip(&archive, "Packed", bin, compression);
        archive
    }

    fn files_in(archive: &Path, resolver: &dyn ltk_wad::PathResolver) -> ProjectFiles {
        ProjectFiles::in_archive(
            archive,
            &Config::default(),
            Budget::repair(),
            resolver,
            None,
        )
        .unwrap()
    }

    #[test]
    fn an_archive_holds_one_layer_named_base() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = packed(tmp.path(), &stale_bin(), CompressionMethod::Stored);

        let files = files_in(&archive, &naming_the_bin());

        let names: Vec<&str> = files
            .layers()
            .iter()
            .map(|layer| layer.name.as_str())
            .collect();
        assert_eq!(names, ["base"]);
    }

    #[test]
    fn each_wad_directory_of_an_archive_is_a_layer_under_its_declared_name() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = tmp.path().join("layers.fantome");
        make_layer_wads_fantome_zip(&archive, &healthy_bin(), &stale_bin());

        let files = files_in(&archive, &naming_the_bin());

        let names: Vec<&str> = files
            .layers()
            .iter()
            .map(|layer| layer.name.as_str())
            .collect();
        assert_eq!(names, ["base", "Chroma", "zeta"]);
        for name in names {
            assert_eq!(paths(&layer(&files, name)), [BIN_IN_LAYER]);
        }
    }

    #[test]
    fn each_layer_of_an_archive_reads_back_its_own_bin() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = tmp.path().join("layers.fantome");
        make_layer_wads_fantome_zip(&archive, &healthy_bin(), &stale_bin());

        let files = files_in(&archive, &naming_the_bin());

        let read: Vec<(&str, Vec<u8>)> = files
            .bins()
            .map(|handle| {
                let bin = handle.bin().unwrap();
                (handle.layer(), bin_bytes(bin.as_prop().unwrap()))
            })
            .collect();
        assert_eq!(
            read,
            [
                ("base", bin_bytes(&healthy_bin())),
                ("Chroma", bin_bytes(&stale_bin())),
                ("zeta", bin_bytes(&stale_bin())),
            ]
        );
    }

    #[test]
    fn a_packed_wads_bin_is_listed_under_the_path_its_hash_names() {
        let tmp = tempfile::tempdir().unwrap();
        let bin = stale_bin();
        let archive = packed(tmp.path(), &bin, CompressionMethod::Stored);

        let files = files_in(&archive, &naming_the_bin());

        let base = layer(&files, "base");
        assert_eq!(paths(&base), [BIN_IN_LAYER]);
        assert_eq!(base.files[0].kind, WorkshopFileKind::PropertyBin);
        assert_eq!(base.files[0].size_bytes, bin_bytes(&bin).len() as u64);
    }

    #[test]
    fn a_packed_wads_bin_reads_back_through_its_handle() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = packed(tmp.path(), &stale_bin(), CompressionMethod::Stored);

        let files = files_in(&archive, &naming_the_bin());

        let handle = files.bins().next().expect("the packed WAD holds one bin");
        assert_eq!(handle.layer(), "base");
        assert_eq!(handle.path(), BIN_IN_LAYER);
        assert_eq!(
            bin_bytes(handle.bin().unwrap().as_prop().unwrap()),
            bin_bytes(&stale_bin())
        );
    }

    /// A deflated entry cannot be seeked into, so it is inflated whole first.
    /// Both kinds of entry have to read back the same bytes.
    #[test]
    fn a_deflated_packed_wad_reads_the_same_as_a_stored_one() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = packed(tmp.path(), &stale_bin(), CompressionMethod::Deflated);

        let files = files_in(&archive, &naming_the_bin());

        let handle = files.bins().next().expect("the packed WAD holds one bin");
        assert_eq!(handle.path(), BIN_IN_LAYER);
        assert_eq!(
            bin_bytes(handle.bin().unwrap().as_prop().unwrap()),
            bin_bytes(&stale_bin())
        );
    }

    #[test]
    fn a_wad_kept_as_a_directory_of_entries_is_read_entry_by_entry() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = tmp.path().join("loose.fantome");
        make_bin_fantome_zip(&archive, "Loose", &stale_bin());

        let files = files_in(&archive, &naming_the_bin());

        let handle = files.bins().next().expect("the archive holds one bin");
        assert_eq!(handle.path(), BIN_IN_LAYER);
        assert_eq!(
            bin_bytes(handle.bin().unwrap().as_prop().unwrap()),
            bin_bytes(&stale_bin())
        );
    }

    /// A chunk no table names is listed under its bare hash, as the unpack
    /// writes it, and read as a bin because its first bytes are one.
    ///
    /// The import runs under `NamingPolicy::Lossless`, which adds no
    /// extension, so naming the chunk by its magic would put the check's site
    /// at a path where the tree has no file. The magic sets the kind, and the
    /// path stays the hex name.
    #[test]
    fn a_chunk_no_table_names_is_read_as_a_bin_under_its_bare_hash() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = packed(tmp.path(), &stale_bin(), CompressionMethod::Stored);

        let tree = unpacked(&archive, &tmp.path().join("staging"));
        let from_tree = ProjectFiles::read(&tree, &Config::default(), None).unwrap();
        let from_archive = files_in(&archive, &resolver_naming(&[]));

        let in_archive = layer(&from_archive, "base");
        let in_tree = layer(&from_tree, "base");
        assert_eq!(paths(&in_archive), paths(&in_tree));

        let hash = ltk_wad::WadHash::from(STALE_BIN_IN_WAD);
        assert_eq!(
            paths(&in_archive),
            [format!("Aatrox.wad.client/{:016x}", hash.0).as_str()]
        );
        assert_eq!(in_archive.files[0].kind, WorkshopFileKind::PropertyBin);
        assert_eq!(in_tree.files[0].kind, WorkshopFileKind::PropertyBin);
        assert_eq!(from_archive.bins().count(), 1);
        assert_eq!(from_tree.bins().count(), 1);
    }

    /// The bin reads back through its handle under the hex path, so a rule can
    /// parse a chunk no table names.
    #[test]
    fn a_chunk_no_table_names_reads_back_through_its_handle() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = packed(tmp.path(), &stale_bin(), CompressionMethod::Stored);

        let files = files_in(&archive, &resolver_naming(&[]));

        let handle = files.bins().next().expect("the nameless chunk is a bin");
        assert_eq!(
            bin_bytes(handle.bin().unwrap().as_prop().unwrap()),
            bin_bytes(&stale_bin())
        );
    }

    /// A deflated WAD is inflated whole and read out of memory, so the sniff
    /// has to give the same answer there too.
    #[test]
    fn a_deflated_chunk_no_table_names_is_read_as_a_bin() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = packed(tmp.path(), &stale_bin(), CompressionMethod::Deflated);

        let files = files_in(&archive, &resolver_naming(&[]));

        assert_eq!(files.bins().count(), 1);
    }

    /// The magic decides, so the bin rules never open a nameless chunk that is
    /// not a bin.
    #[test]
    fn a_nameless_chunk_that_is_not_a_bin_is_left_unknown() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = tmp.path().join("opaque.fantome");
        ltk_manager_assets::test_util::make_long_chunk_fantome_zip(&archive);

        let files = files_in(&archive, &resolver_naming(&[]));

        let base = layer(&files, "base");
        assert_eq!(base.files.len(), 1);
        assert!(
            base.files[0].path.starts_with("Ashe.wad.client/"),
            "the chunk is listed under its hash: {}",
            base.files[0].path
        );
        assert_eq!(base.files[0].kind, WorkshopFileKind::Unknown);
        assert_eq!(files.bins().count(), 0);
    }

    #[test]
    fn a_chunk_that_is_not_a_bin_is_listed_but_never_read_as_one() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = tmp.path().join("healthy.fantome");
        make_packed_bin_fantome_zip(
            &archive,
            "Healthy",
            &healthy_bin(),
            CompressionMethod::Stored,
        );

        let files = files_in(&archive, &naming_the_bin());

        assert_eq!(files.bins().count(), 1);
    }

    /// An unpack writes `RAW/` entries under the base layer, so a rule reads
    /// them like any other content.
    #[test]
    fn a_raw_entry_is_read_under_the_layer_the_unpack_would_put_it_in() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = tmp.path().join("raw.fantome");
        make_raw_bin_fantome_zip(&archive, "Raw", &stale_bin());

        let files = files_in(&archive, &naming_the_bin());

        let handle = files.bins().next().expect("the archive holds one bin");
        assert_eq!(handle.path(), "raw/data/skin0.bin");
        assert_eq!(
            bin_bytes(handle.bin().unwrap().as_prop().unwrap()),
            bin_bytes(&stale_bin())
        );
    }

    /// Story: a check that reads an archive without unpacking it reports what
    /// the unpacked tree reports.
    #[test]
    fn analyzing_an_archive_finds_what_its_unpacked_tree_would() {
        let tmp = tempfile::tempdir().unwrap();
        let mut config = Config::default();
        ltk_manager_assets::test_util::point_at_installed_build(&mut config, tmp.path());

        let project = tmp.path().join("project");
        ltk_manager_assets::test_util::place_bin_project(&project, "mod", &stale_bin());
        let from_tree = analyze(&project, &config, None).expect("the tree analyzes");

        let archive = packed(tmp.path(), &stale_bin(), CompressionMethod::Stored);
        let from_archive =
            analyze_archive(&archive, &config, Budget::repair(), &naming_the_bin(), None).unwrap();

        let sites = |run: &Run| -> Vec<(String, String)> {
            run.live_problems()
                .map(|problem| (problem.site.layer.clone(), problem.site.path.clone()))
                .collect()
        };
        assert_eq!(sites(&from_archive), sites(&from_tree));
        assert_eq!(
            sites(&from_archive),
            [("base".to_owned(), BIN_IN_LAYER.to_owned())]
        );
    }

    /// The texture in the bin-named fixture. No table names it. The only
    /// record of its path is a string inside the bin packed beside it, and
    /// name recovery reads that string.
    const RECOVERED_TEXTURE: &str = "data/characters/ashe/ashe_tx_cm.dds";

    /// Unpack `archive` into `into` the way a repair does, and return the
    /// project root it wrote.
    ///
    /// This uses the real importer, because a parity test against a
    /// hand-placed tree only compares the fixture with itself.
    fn unpacked(archive: &Path, into: &Path) -> PathBuf {
        let into_utf8 = camino::Utf8PathBuf::from_path_buf(into.to_path_buf()).unwrap();
        ltk_mod_project::ProjectImporter::new(&into_utf8)
            .import(ltk_mod_project::fantome::FantomeImporter::new(
                fs::File::open(archive).unwrap(),
            ))
            .expect("the archive imports");
        into.to_path_buf()
    }

    /// Story: a check that reads an archive in place lists what the unpack
    /// lists.
    ///
    /// An unpack runs name recovery over a WAD's bins, so a chunk no table
    /// names lands under the path a bin gives for it. A scan that skips the
    /// recovery lists that chunk under its hash instead, and the check and the
    /// repair then disagree about where a problem is.
    #[test]
    fn an_archive_lists_what_its_unpacked_tree_lists() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = tmp.path().join("bin-named.fantome");
        ltk_manager_assets::test_util::make_bin_named_chunk_fantome_zip(
            &archive,
            RECOVERED_TEXTURE,
        );

        let tree = unpacked(&archive, &tmp.path().join("staging"));
        let from_tree = ProjectFiles::read(&tree, &Config::default(), None).unwrap();
        let from_archive = files_in(&archive, &ltk_wad::NoResolver);

        let in_archive = layer(&from_archive, "base");
        let in_tree = layer(&from_tree, "base");
        assert_eq!(paths(&in_archive), paths(&in_tree));
    }

    /// The same archive, read with a resolver that names nothing, so the
    /// recovered path comes from name recovery and not from the caller.
    #[test]
    fn a_chunk_only_a_bin_names_is_listed_under_that_name() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = tmp.path().join("bin-named.fantome");
        ltk_manager_assets::test_util::make_bin_named_chunk_fantome_zip(
            &archive,
            RECOVERED_TEXTURE,
        );

        let files = files_in(&archive, &ltk_wad::NoResolver);

        let base = layer(&files, "base");
        assert!(
            paths(&base).contains(&format!("Ashe.wad.client/{RECOVERED_TEXTURE}").as_str()),
            "the recovered path is missing from {:?}",
            paths(&base)
        );
    }

    /// If only one of the archive scan and the tree walk lists a file, the
    /// check can report a problem that the repair cannot reach.
    #[test]
    fn a_dot_file_in_an_archive_is_listed_as_the_tree_it_unpacks_to_lists_it() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = tmp.path().join("dotted.fantome");
        ltk_manager_assets::test_util::make_dot_file_fantome_zip(&archive);

        let tree = unpacked(&archive, &tmp.path().join("staging"));
        let from_tree = ProjectFiles::read(&tree, &Config::default(), None).unwrap();
        let from_archive = files_in(&archive, &ltk_wad::NoResolver);

        let in_archive = layer(&from_archive, "base");
        assert!(
            paths(&in_archive).contains(&"Ashe.wad.client/data/.hidden.bin"),
            "the dot-file is missing from {:?}",
            paths(&in_archive)
        );
        assert_eq!(paths(&in_archive), paths(&layer(&from_tree, "base")));
    }

    /// An archive that declares a hashtable it does not hold cannot name its
    /// chunks as declared. The unpack refuses such an archive, and a scan that
    /// continues would name its chunks differently from the repair that
    /// follows.
    #[test]
    fn an_undeclarable_hashtable_fails_the_scan() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = tmp.path().join("missing-table.fantome");
        ltk_manager_assets::test_util::make_missing_hashtable_fantome_zip(&archive);

        let refused = ProjectFiles::in_archive(
            &archive,
            &Config::default(),
            Budget::repair(),
            &ltk_wad::NoResolver,
            None,
        );

        assert!(
            refused.is_err(),
            "a manifest naming an absent table was accepted"
        );
    }

    /// A rule about how a mod was packed reads what the WAD records about a
    /// chunk, and only the table of contents is read for it.
    #[test]
    fn a_packed_chunk_carries_what_the_wad_records_about_it() {
        let tmp = tempfile::tempdir().unwrap();
        let bin = stale_bin();
        let archive = packed(tmp.path(), &bin, CompressionMethod::Stored);

        let files = files_in(&archive, &naming_the_bin());
        let handle = files.bins().next().expect("the packed WAD holds one bin");
        let chunk = handle.chunk().expect("a packed chunk records itself");

        assert_eq!(chunk.hash, ltk_wad::WadHash::from(STALE_BIN_IN_WAD));
        assert_eq!(chunk.uncompressed_size, handle.size_bytes());
        assert_eq!(chunk.uncompressed_size, bin_bytes(&bin).len() as u64);
        assert!(chunk.compressed_size > 0);
    }

    /// Chunk info is the one difference between layer sources that a rule can
    /// see, and its absence is a normal state rather than an error.
    #[test]
    fn a_loose_entry_carries_no_chunk_info() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = tmp.path().join("loose.fantome");
        make_bin_fantome_zip(&archive, "Loose", &stale_bin());

        let files = files_in(&archive, &naming_the_bin());

        assert_eq!(files.bins().next().unwrap().chunk(), None);
    }

    #[test]
    fn a_head_of_a_packed_chunk_reads_its_first_bytes() {
        let tmp = tempfile::tempdir().unwrap();
        let bin = stale_bin();
        let archive = packed(tmp.path(), &bin, CompressionMethod::Stored);

        let files = files_in(&archive, &naming_the_bin());
        let handle = files.bins().next().unwrap();

        assert_eq!(handle.head(9).unwrap(), bin_bytes(&bin)[..9]);
    }

    #[test]
    fn a_head_of_a_packed_chunk_shorter_than_the_bound_answers_with_what_there_is() {
        let tmp = tempfile::tempdir().unwrap();
        let bin = stale_bin();
        let archive = packed(tmp.path(), &bin, CompressionMethod::Stored);

        let files = files_in(&archive, &naming_the_bin());
        let handle = files.bins().next().unwrap();

        assert_eq!(handle.head(8192).unwrap(), bin_bytes(&bin));
    }

    #[test]
    fn a_head_of_a_loose_entry_reads_its_first_bytes() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = tmp.path().join("loose.fantome");
        let bin = stale_bin();
        make_bin_fantome_zip(&archive, "Loose", &bin);

        let files = files_in(&archive, &naming_the_bin());
        let handle = files.bins().next().unwrap();

        assert_eq!(handle.head(9).unwrap(), bin_bytes(&bin)[..9]);
        assert_eq!(handle.head(8192).unwrap(), bin_bytes(&bin));
    }

    /// Story: a rule reads the same header whichever way the mod is stored.
    #[test]
    fn a_head_reads_the_same_bytes_from_a_tree_and_from_an_archive() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = packed(tmp.path(), &stale_bin(), CompressionMethod::Stored);

        let tree = unpacked(&archive, &tmp.path().join("staging"));
        let from_tree = ProjectFiles::read(&tree, &Config::default(), None).unwrap();
        let from_archive = files_in(&archive, &resolver_naming(&[]));

        let in_tree = from_tree.bins().next().unwrap().head(9).unwrap();
        let in_archive = from_archive.bins().next().unwrap().head(9).unwrap();
        assert_eq!(in_archive, in_tree);
    }

    /// The first 16 KB of this chunk decode to nothing, because a compressed
    /// block decodes only once it is read whole, so the head reads more
    /// instead of returning short.
    #[test]
    fn a_head_of_a_chunk_whose_first_block_was_cut_short_reads_it_anyway() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = tmp.path().join("large-block.fantome");
        let bytes = ltk_manager_assets::test_util::make_large_block_chunk_fantome_zip(&archive);

        let files = files_in(
            &archive,
            &resolver_naming(&[ltk_manager_assets::test_util::LARGE_BLOCK_CHUNK_PATH]),
        );
        let handle = files.files().next().expect("the WAD holds one chunk");

        assert!(
            handle.chunk().unwrap().compressed_size > 16 * 1024,
            "the fixture has to be larger than the first raw read"
        );
        assert_eq!(handle.head(16).unwrap(), bytes[..16]);
    }

    /// A packed chunk is compared by the hash in its WAD's table of contents.
    #[test]
    fn a_packed_bin_equal_to_the_game_copy_is_removed() {
        let tmp = tempfile::tempdir().unwrap();
        let bin = stale_bin();
        let archive = packed(tmp.path(), &bin, CompressionMethod::Deflated);
        let game = FakeContent::containing_bytes(&[(STALE_BIN_IN_WAD, &bin_bytes(&bin))]);

        let files = ProjectFiles::in_archive(
            &archive,
            &Config::default(),
            Budget::repair(),
            &naming_the_bin(),
            Some(game),
        )
        .unwrap()
        .without_game_copies();

        assert_eq!(files.bins().count(), 0);
    }

    /// A check writes nothing, so it leaves nothing beside the archive.
    #[test]
    fn analyzing_an_archive_writes_nothing_beside_it() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = packed(tmp.path(), &stale_bin(), CompressionMethod::Stored);
        let before = fs::read(&archive).unwrap();

        files_in(&archive, &naming_the_bin());

        let left: Vec<_> = fs::read_dir(tmp.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(left, ["packed.fantome"]);
        assert_eq!(fs::read(&archive).unwrap(), before);
    }
}

/* Reading a modpkg in place. A package stores every chunk under the path that
it was packed from, so the scan lists what an import writes without a resolver. */

mod modpkg {
    use super::*;
    use ltk_manager_assets::test_util::{
        STALE_BIN_IN_WAD, bin_bytes, healthy_bin, make_bin_modpkg, make_packed_bin_fantome_zip,
        resolver_naming, stale_bin,
    };
    use zip::CompressionMethod;

    /// The path of the fixture bin inside the layer. A package stores a WAD's
    /// name lowercased, and an import writes the directory the same way.
    const BIN_IN_LAYER: &str = "aatrox.wad.client/data/skin0.bin";

    fn packaged(dir: &Path, bin: &ltk_meta::Bin) -> PathBuf {
        let archive = dir.join("packed.modpkg");
        make_bin_modpkg(&archive, "Packed", bin);
        archive
    }

    fn files_in(archive: &Path) -> ProjectFiles {
        ProjectFiles::in_modpkg(archive, &Config::default(), Budget::repair(), None).unwrap()
    }

    /// Unpack `archive` into `into` the way an import does, and return the
    /// project root it wrote.
    fn unpacked(archive: &Path, into: &Path) -> PathBuf {
        let into_utf8 = camino::Utf8PathBuf::from_path_buf(into.to_path_buf()).unwrap();
        ltk_mod_project::ProjectImporter::new(&into_utf8)
            .import(ltk_mod_project::modpkg::ModpkgImporter::new(
                fs::File::open(archive).unwrap(),
            ))
            .expect("the package imports");
        into.to_path_buf()
    }

    #[test]
    fn a_modpkg_holds_one_layer_named_base() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = packaged(tmp.path(), &stale_bin());

        let files = files_in(&archive);

        let names: Vec<&str> = files
            .layers()
            .iter()
            .map(|layer| layer.name.as_str())
            .collect();
        assert_eq!(names, ["base"]);
    }

    /// A chunk is listed under the path that the package stores. No WAD holds
    /// the chunk, so its chunk info is `None`.
    #[test]
    fn a_modpkgs_bin_is_listed_under_the_path_the_package_stores() {
        let tmp = tempfile::tempdir().unwrap();
        let bin = stale_bin();
        let archive = packaged(tmp.path(), &bin);

        let files = files_in(&archive);

        let base = layer(&files, "base");
        assert_eq!(paths(&base), [BIN_IN_LAYER]);
        assert_eq!(base.files[0].kind, WorkshopFileKind::PropertyBin);
        assert_eq!(base.files[0].size_bytes, bin_bytes(&bin).len() as u64);
        assert_eq!(base.files[0].chunk, None);
    }

    #[test]
    fn a_modpkgs_bin_reads_back_through_its_handle() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = packaged(tmp.path(), &stale_bin());

        let files = files_in(&archive);

        let handle = files.bins().next().expect("the package holds one bin");
        assert_eq!(handle.layer(), "base");
        assert_eq!(handle.path(), BIN_IN_LAYER);
        assert_eq!(
            bin_bytes(handle.bin().unwrap().as_prop().unwrap()),
            bin_bytes(&stale_bin())
        );
    }

    #[test]
    fn a_head_of_a_modpkg_chunk_reads_its_first_bytes() {
        let tmp = tempfile::tempdir().unwrap();
        let bin = stale_bin();
        let archive = packaged(tmp.path(), &bin);

        let files = files_in(&archive);
        let handle = files.bins().next().unwrap();

        assert_eq!(handle.head(9).unwrap(), bin_bytes(&bin)[..9]);
        assert_eq!(handle.head(8192).unwrap(), bin_bytes(&bin));
    }

    /// A chunk's hash is derived from its path, so a modpkg's bin is compared
    /// with the game's copy the way a tree's bin is.
    #[test]
    fn a_modpkg_bin_equal_to_the_game_copy_is_removed() {
        let tmp = tempfile::tempdir().unwrap();
        let bin = stale_bin();
        let archive = packaged(tmp.path(), &bin);
        let game = FakeContent::containing_bytes(&[(STALE_BIN_IN_WAD, &bin_bytes(&bin))]);

        let files =
            ProjectFiles::in_modpkg(&archive, &Config::default(), Budget::repair(), Some(game))
                .unwrap()
                .without_game_copies();

        assert_eq!(files.bins().count(), 0);
    }

    /// Story: a check that reads a package in place lists what the import
    /// lists, so a site names a file that the tree contains.
    #[test]
    fn a_modpkg_lists_what_its_unpacked_tree_lists() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = packaged(tmp.path(), &stale_bin());

        let tree = unpacked(&archive, &tmp.path().join("staging"));
        let from_tree = ProjectFiles::read(&tree, &Config::default(), None).unwrap();
        let from_modpkg = files_in(&archive);

        assert_eq!(
            paths(&layer(&from_modpkg, "base")),
            paths(&layer(&from_tree, "base"))
        );
    }

    /// Story: the same content reports the same findings as a fantome and as
    /// a modpkg.
    ///
    /// The WAD name is the one difference between the two sites: the package
    /// stores it lowercased, and the zip keeps the directory as written.
    #[test]
    fn analyzing_a_modpkg_finds_what_a_fantome_of_the_same_content_finds() {
        let tmp = tempfile::tempdir().unwrap();
        let mut config = Config::default();
        ltk_manager_assets::test_util::point_at_installed_build(&mut config, tmp.path());

        let fantome = tmp.path().join("packed.fantome");
        make_packed_bin_fantome_zip(&fantome, "Packed", &stale_bin(), CompressionMethod::Stored);
        let from_fantome = analyze_archive(
            &fantome,
            &config,
            Budget::repair(),
            &resolver_naming(&[STALE_BIN_IN_WAD]),
            None,
        )
        .unwrap();

        let modpkg = packaged(tmp.path(), &stale_bin());
        let from_modpkg = analyze_modpkg(&modpkg, &config, Budget::repair(), None).unwrap();

        let findings = |run: &Run| -> Vec<(String, crate::ProblemSeverity, String, String, bool)> {
            run.live_problems()
                .map(|problem| {
                    (
                        problem.rule.to_string(),
                        problem.severity,
                        problem.site.layer.clone(),
                        problem.site.path.to_ascii_lowercase(),
                        problem.fix.is_some(),
                    )
                })
                .collect()
        };
        assert_eq!(findings(&from_modpkg), findings(&from_fantome));
        assert_eq!(
            from_modpkg
                .live_problems()
                .map(|problem| problem.site.path.as_str())
                .collect::<Vec<_>>(),
            [BIN_IN_LAYER]
        );
    }

    /// A healthy bin reports nothing out of a package, as it does out of a tree.
    #[test]
    fn analyzing_a_healthy_modpkg_finds_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        let mut config = Config::default();
        ltk_manager_assets::test_util::point_at_installed_build(&mut config, tmp.path());
        let archive = packaged(tmp.path(), &healthy_bin());

        let run = analyze_modpkg(&archive, &config, Budget::repair(), None).unwrap();

        assert!(run.problems.is_empty());
        assert!(run.failed.is_empty());
    }

    /// Story: a modpkg that will not mount reports as unchecked, never as
    /// healthy. Of sixteen local files named `.modpkg`, nine were not packages.
    #[test]
    fn a_file_that_is_not_a_package_fails_the_scan() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = tmp.path().join("zip.modpkg");
        fs::write(&archive, b"PK not a package").unwrap();

        let refused = ProjectFiles::in_modpkg(&archive, &Config::default(), Budget::repair(), None);

        assert!(refused.is_err(), "a file that is not a package was listed");
    }

    /// A check writes nothing, so it leaves nothing beside the package.
    #[test]
    fn analyzing_a_modpkg_writes_nothing_beside_it() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = packaged(tmp.path(), &stale_bin());
        let before = fs::read(&archive).unwrap();

        files_in(&archive);

        let left: Vec<_> = fs::read_dir(tmp.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(left, ["packed.modpkg"]);
        assert_eq!(fs::read(&archive).unwrap(), before);
    }
}
