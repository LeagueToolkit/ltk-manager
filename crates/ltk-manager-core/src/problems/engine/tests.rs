//! Unit tests for what a run sees: the files it lists, and how it reads them.

use super::*;
use crate::mods::test_support::bin_bytes;
use std::fs;

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
fn a_dot_file_inside_a_layer_is_skipped() {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().join(CONTENT_DIR).join("base");
    touch(&base.join("a.bin"), b"bin");
    touch(&base.join(".hidden.bin"), b"bin");
    touch(&base.join(".tools").join("b.bin"), b"bin");

    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();
    assert_eq!(paths(&layer(&files, "base")), ["a.bin"]);
}

/// A site's path crosses IPC and keys a fix, so it has to read the same on
/// Windows as it does anywhere else.
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
        &bin_bytes(&crate::mods::test_support::stale_bin()),
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

/// A named file keeps taking its kind from its extension, so nothing pays a
/// read for content the tree already names.
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

/// A rule judging from a header has nothing to require of the rest, so a file
/// with less than the bound is a normal answer rather than a failure.
#[test]
fn a_head_of_a_short_file_on_disk_answers_with_what_there_is() {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().join(CONTENT_DIR).join("base");
    touch(&base.join("notes.txt"), b"short");

    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();
    let handle = files.files().next().unwrap();

    assert_eq!(handle.head(8192).unwrap(), b"short");
}

/// A directory layer's files are files, so nothing records a chunk for them.
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
        Err(crate::error::AppError::ProjectNotFound(_))
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

/// A run over a project with nothing to gate on lists every rule as
/// speaking, which is what a panel needs to tell a clean project from a
/// quiet one.
#[test]
fn a_rule_with_nothing_to_wait_for_is_listed_as_active() {
    let tmp = tempfile::tempdir().unwrap();
    touch(
        &tmp.path().join(CONTENT_DIR).join("base").join("notes.txt"),
        b"hello",
    );

    let run = analyze(tmp.path(), &Config::default(), None).unwrap();
    assert!(!run.rules.is_empty());
    assert!(run.rules.iter().all(|info| info.state == RuleState::Active));
}

/// A game install from before the one shipped table, so every rule keyed
/// on that build reports what it is waiting for.
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

    let run = analyze(tmp.path(), &config, None).unwrap();
    let dormant: Vec<_> = run
        .rules
        .iter()
        .filter(|info| info.state != RuleState::Active)
        .collect();

    assert_eq!(dormant.len(), 1, "the bin retype rule is the keyed one");
    let RuleState::Dormant {
        waiting,
        reason,
        detail,
    } = &dormant[0].state
    else {
        unreachable!("filtered on it")
    };
    assert_eq!(waiting, "Patch 16.17");
    assert!(reason.contains("16.17"), "{reason}");
    let detail = detail.as_deref().expect("the rule names both builds");
    assert!(detail.contains("16.17.8087655"), "{detail}");
    assert!(detail.contains("16.16.8049184"), "{detail}");
}

/* An archive read where it lies. The fixtures are the health suite's own, so
these hold the archive constructor to the answers the walk gives for the tree
an unpack would have written. */

mod archive {
    use super::*;
    use crate::mods::test_support::{
        STALE_BIN_IN_WAD, bin_bytes, healthy_bin, make_bin_fantome_zip,
        make_packed_bin_fantome_zip, make_raw_bin_fantome_zip, resolver_naming, stale_bin,
    };
    use zip::CompressionMethod;

    /// Where the fixture bin lands inside the layer, in either archive shape.
    const BIN_IN_LAYER: &str = "Aatrox.wad.client/data/skin0.bin";

    /// A resolver naming the fixture chunk, which is what puts it under
    /// [`BIN_IN_LAYER`] rather than under its hash.
    fn naming_the_bin() -> crate::hashtables::WadPathResolver {
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
        assert_eq!(bin_bytes(&handle.bin().unwrap()), bin_bytes(&stale_bin()));
    }

    /// A deflated entry cannot be seeked into, so it is inflated whole first.
    /// Which of the two a caller got must not change what it reads back.
    #[test]
    fn a_deflated_packed_wad_reads_the_same_as_a_stored_one() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = packed(tmp.path(), &stale_bin(), CompressionMethod::Deflated);

        let files = files_in(&archive, &naming_the_bin());

        let handle = files.bins().next().expect("the packed WAD holds one bin");
        assert_eq!(handle.path(), BIN_IN_LAYER);
        assert_eq!(bin_bytes(&handle.bin().unwrap()), bin_bytes(&stale_bin()));
    }

    #[test]
    fn a_wad_kept_as_a_directory_of_entries_is_read_entry_by_entry() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = tmp.path().join("loose.fantome");
        make_bin_fantome_zip(&archive, "Loose", &stale_bin());

        let files = files_in(&archive, &naming_the_bin());

        let handle = files.bins().next().expect("the archive holds one bin");
        assert_eq!(handle.path(), BIN_IN_LAYER);
        assert_eq!(bin_bytes(&handle.bin().unwrap()), bin_bytes(&stale_bin()));
    }

    /// A chunk nothing names is listed under its bare hash, which is what the
    /// unpack writes it as, and read as the bin its first bytes say it is.
    ///
    /// The hex path is what makes both halves possible: the import runs under
    /// `NamingPolicy::Lossless`, which invents no extension, so naming the
    /// chunk by its magic instead would put the check's site somewhere the
    /// tree has no file. The kind is what the magic decides, and the path is
    /// left exactly as it was.
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

    /// The bin reads back through its handle under the hex path, which is what
    /// lets a rule parse a chunk no table names.
    #[test]
    fn a_chunk_no_table_names_reads_back_through_its_handle() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = packed(tmp.path(), &stale_bin(), CompressionMethod::Stored);

        let files = files_in(&archive, &resolver_naming(&[]));

        let handle = files.bins().next().expect("the nameless chunk is a bin");
        assert_eq!(bin_bytes(&handle.bin().unwrap()), bin_bytes(&stale_bin()));
    }

    /// A deflated WAD is inflated whole and read out of memory, so the sniff
    /// has to reach the same answer through that path too.
    #[test]
    fn a_deflated_chunk_no_table_names_is_read_as_a_bin() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = packed(tmp.path(), &stale_bin(), CompressionMethod::Deflated);

        let files = files_in(&archive, &resolver_naming(&[]));

        assert_eq!(files.bins().count(), 1);
    }

    /// The magic decides, so a nameless chunk that is not a bin stays one the
    /// bin rules never open.
    #[test]
    fn a_nameless_chunk_that_is_not_a_bin_is_left_unknown() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = tmp.path().join("opaque.fantome");
        crate::mods::test_support::make_long_chunk_fantome_zip(&archive);

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

    /// An unpack writes `RAW/` entries under the layer rather than beside it,
    /// so they are content a rule reads and not something to skip.
    #[test]
    fn a_raw_entry_is_read_under_the_layer_the_unpack_would_put_it_in() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = tmp.path().join("raw.fantome");
        make_raw_bin_fantome_zip(&archive, "Raw", &stale_bin());

        let files = files_in(&archive, &naming_the_bin());

        let handle = files.bins().next().expect("the archive holds one bin");
        assert_eq!(handle.path(), "raw/data/skin0.bin");
        assert_eq!(bin_bytes(&handle.bin().unwrap()), bin_bytes(&stale_bin()));
    }

    /// Story: the check that used to unpack a gigabyte reports what the
    /// unpacked tree reported.
    #[test]
    fn analyzing_an_archive_finds_what_its_unpacked_tree_would() {
        let tmp = tempfile::tempdir().unwrap();
        let mut config = Config::default();
        crate::mods::test_support::point_at_installed_build(&mut config, tmp.path());

        let project = tmp.path().join("project");
        crate::mods::test_support::place_bin_project_mod(&project, "mod", &stale_bin());
        let from_tree =
            analyze(&project.join("mods").join("mod"), &config, None).expect("the tree analyzes");

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

    /// The texture in the bin-named fixture. No table names it - the only
    /// record of its path is a string inside the bin packed beside it, which
    /// is what name recovery reads.
    const RECOVERED_TEXTURE: &str = "data/characters/ashe/ashe_tx_cm.dds";

    /// Unpack `archive` into `into` the way a repair does, and answer the
    /// project root it wrote.
    ///
    /// The real importer on purpose: a parity test that hand-places the tree
    /// it compares against is only asserting that the fixture agrees with
    /// itself.
    fn unpacked(archive: &Path, into: &Path) -> PathBuf {
        let into_utf8 = camino::Utf8PathBuf::from_path_buf(into.to_path_buf()).unwrap();
        ltk_mod_project::ProjectImporter::new(&into_utf8)
            .import(ltk_mod_project::fantome::FantomeImporter::new(
                fs::File::open(archive).unwrap(),
            ))
            .expect("the archive imports");
        into.to_path_buf()
    }

    /// Story: the check that stopped unpacking still has to see what the
    /// unpack saw.
    ///
    /// An unpack runs name recovery over a WAD's bins, so a chunk no table
    /// names lands under the path a bin spells for it. A scan that skips the
    /// recovery lists that chunk under its hash instead, and the check and the
    /// repair then disagree about where a problem is.
    #[test]
    fn an_archive_lists_what_its_unpacked_tree_lists() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = tmp.path().join("bin-named.fantome");
        crate::mods::test_support::make_bin_named_chunk_fantome_zip(&archive, RECOVERED_TEXTURE);

        let tree = unpacked(&archive, &tmp.path().join("staging"));
        let from_tree = ProjectFiles::read(&tree, &Config::default(), None).unwrap();
        let from_archive = files_in(&archive, &ltk_wad::NoResolver);

        let in_archive = layer(&from_archive, "base");
        let in_tree = layer(&from_tree, "base");
        assert_eq!(paths(&in_archive), paths(&in_tree));
    }

    /// The same archive, read with a resolver that names nothing: the
    /// recovered path has to be there on its own merits, not because the
    /// caller happened to supply it.
    #[test]
    fn a_chunk_only_a_bin_names_is_listed_under_that_name() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = tmp.path().join("bin-named.fantome");
        crate::mods::test_support::make_bin_named_chunk_fantome_zip(&archive, RECOVERED_TEXTURE);

        let files = files_in(&archive, &ltk_wad::NoResolver);

        let base = layer(&files, "base");
        assert!(
            paths(&base).contains(&format!("Ashe.wad.client/{RECOVERED_TEXTURE}").as_str()),
            "the recovered path is missing from {:?}",
            paths(&base)
        );
    }

    /// The walk skips a dot-file inside a layer, so the archive scan has to
    /// skip one too. A file only one of them lists is one the check calls
    /// repairable and the repair then never touches.
    #[test]
    fn a_dot_file_in_an_archive_is_skipped_as_the_walk_skips_it() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = tmp.path().join("dotted.fantome");
        crate::mods::test_support::make_dot_file_fantome_zip(&archive);

        let files = files_in(&archive, &ltk_wad::NoResolver);

        let base = layer(&files, "base");
        assert!(
            !paths(&base).iter().any(|path| path.contains("/.")),
            "a dot-file was listed: {:?}",
            paths(&base)
        );
    }

    /// An archive declaring a table it does not hold is broken in a way that
    /// changes every name in it. The unpack refuses such an archive; a scan
    /// that shrugs and carries on names its chunks differently from the repair
    /// that follows, which is the divergence worth failing over.
    #[test]
    fn an_undeclarable_hashtable_fails_the_scan() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = tmp.path().join("missing-table.fantome");
        crate::mods::test_support::make_missing_hashtable_fantome_zip(&archive);

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

    /// What the WAD records about a chunk is what a rule about how a mod was
    /// packed reads, and reading it costs the table of contents alone.
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

    /// The one difference between the layer sources a rule can see, and its
    /// absence is a normal state rather than an error.
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
    ///
    /// The property the seam exists to guarantee, and the one the old
    /// layer-and-file pair would have broken silently: it handed back a path
    /// for a directory layer and nothing at all for an archive.
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

    /// The escalation: 16 KB of this chunk decodes to nothing at all, because a
    /// compressed block reads whole or not at all, so the read comes back for
    /// more rather than answering short.
    #[test]
    fn a_head_of_a_chunk_whose_first_block_was_cut_short_reads_it_anyway() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = tmp.path().join("large-block.fantome");
        let bytes = crate::mods::test_support::make_large_block_chunk_fantome_zip(&archive);

        let files = files_in(
            &archive,
            &resolver_naming(&[crate::mods::test_support::LARGE_BLOCK_CHUNK_PATH]),
        );
        let handle = files.files().next().expect("the WAD holds one chunk");

        assert!(
            handle.chunk().unwrap().compressed_size > 16 * 1024,
            "the fixture has to be larger than the first raw read"
        );
        assert_eq!(handle.head(16).unwrap(), bytes[..16]);
    }

    /// A check never leaves anything behind, which is now true because it
    /// never writes anything in the first place.
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
