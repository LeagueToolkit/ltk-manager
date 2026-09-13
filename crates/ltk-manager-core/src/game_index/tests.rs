//! Unit tests for the merged archive tree, and for the search and find over it.

use super::*;
use crate::matcher::PatternSyntax;
use fs_err as fs;
use ltk_wad::{WadBuilder, WadChunkBuilder};
use std::io::Write as _;
use std::path::Path;
use tempfile::TempDir;

/// The key the `game` table would file this path under, asked of the table
/// itself so a test cannot disagree with it about the algorithm.
fn path_hash(path: &str) -> u64 {
    crate::hashtables::Table::Game.key_config().hash(path)
}

/// A game directory holding `wads`, each named by its chunk paths.
fn game_with(wads: &[(&str, &[&str])]) -> TempDir {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("DATA").join("FINAL");
    fs::create_dir_all(&dir).unwrap();

    for (name, chunk_paths) in wads {
        let path = dir.join(name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let mut builder = WadBuilder::default();
        for chunk_path in *chunk_paths {
            builder = builder.with_chunk(WadChunkBuilder::default().with_path(*chunk_path));
        }
        let mut file = fs::File::create(&path).unwrap();
        builder
            .build_to_writer(&mut file, |_path_hash, cursor| {
                cursor.write_all(&[0xAA; 64])?;
                Ok(())
            })
            .unwrap();
    }
    tmp
}

fn resolver_for(paths: &[&str]) -> LayeredHashDb {
    let mut resolver = LayeredHashDb::new();
    for path in paths {
        resolver.insert(path_hash(path), *path);
    }
    resolver
}

fn build(game: &Path, paths: &[&str]) -> GameIndex {
    GameIndex::build(&GameArchives::at(game), &resolver_for(paths)).unwrap()
}

/// The full path of each hit, in the order the search ranked them.
fn ranked(index: &GameIndex, query: &str) -> Vec<String> {
    index
        .search(query, || false)
        .hits
        .into_iter()
        .map(|hit| {
            if hit.path.is_empty() {
                hit.name
            } else {
                format!("{}/{}", hit.path, hit.name)
            }
        })
        .collect()
}

/// An index over exactly `paths`, all in one archive.
fn index_over(paths: &[&str]) -> (TempDir, GameIndex) {
    let tmp = game_with(&[("Search.wad.client", paths)]);
    let index = build(tmp.path(), paths);
    (tmp, index)
}

#[test]
fn search_finds_a_file_by_its_name() {
    let (_tmp, index) = index_over(&["assets/characters/aatrox/aatrox.bin"]);
    assert_eq!(
        ranked(&index, "aatrox.bin"),
        ["assets/characters/aatrox/aatrox.bin"]
    );
}

#[test]
fn search_finds_a_file_by_a_run_of_its_directory() {
    let (_tmp, index) = index_over(&["assets/characters/aatrox/skin01.bin"]);
    assert_eq!(
        ranked(&index, "characters/aatrox"),
        ["assets/characters/aatrox/skin01.bin"]
    );
}

#[test]
fn search_takes_every_term_of_a_query() {
    let (_tmp, index) = index_over(&[
        "assets/characters/nasus/skins/base/nasus_base_tx_cm.dds",
        "assets/characters/nasus/nasus.bin",
    ]);

    assert_eq!(
        ranked(&index, "nasus tx"),
        ["assets/characters/nasus/skins/base/nasus_base_tx_cm.dds"]
    );
    assert!(ranked(&index, "nasus zed").is_empty());
}

/// A chunk path is lowercase by the time a hash table names it, so the
/// query is the only side of the compare that can arrive in another case.
#[test]
fn search_lowercases_the_query() {
    let (_tmp, index) = index_over(&["assets/characters/aatrox/aatrox.bin"]);
    assert_eq!(
        ranked(&index, "  AATROX.BIN  "),
        ["assets/characters/aatrox/aatrox.bin"]
    );
}

#[test]
fn search_returns_nothing_for_an_empty_query() {
    let (_tmp, index) = index_over(&["assets/characters/aatrox/aatrox.bin"]);
    let result = index.search("   ", || false);
    assert!(result.hits.is_empty());
    assert_eq!(result.total, 0);
    assert!(!result.superseded);
}

#[test]
fn search_drops_what_does_not_match() {
    let (_tmp, index) = index_over(&[
        "assets/characters/aatrox/aatrox.bin",
        "assets/characters/zed/zed.bin",
    ]);
    assert_eq!(
        ranked(&index, "aatrox"),
        ["assets/characters/aatrox/aatrox.bin"]
    );
}

#[test]
fn search_marks_the_name_alone_when_the_name_matched() {
    let (_tmp, index) = index_over(&["assets/characters/aatrox.bin"]);
    let hit = index.search("aatrox", || false).hits.remove(0);

    assert_eq!(hit.name_ranges, [(0, 6)]);
    assert!(hit.path_ranges.is_empty());
}

#[test]
fn search_marks_both_lines_for_a_run_that_crosses_the_separator() {
    let (_tmp, index) = index_over(&["assets/skins/base.bin"]);
    let hit = index.search("skins/base", || false).hits.remove(0);

    assert!(!hit.path_ranges.is_empty());
    assert!(!hit.name_ranges.is_empty());
    for &(start, end) in &hit.path_ranges {
        assert!(end as usize <= hit.path.len());
        assert!(start < end);
    }
    for &(start, end) in &hit.name_ranges {
        assert!(end as usize <= hit.name.len());
        assert!(start < end);
    }
}

#[test]
fn search_counts_every_match_and_returns_at_most_the_cap() {
    let paths: Vec<String> = (0..SEARCH_LIMIT + 20)
        .map(|i| format!("assets/skins/aatrox_{i:03}.bin"))
        .collect();
    let refs: Vec<&str> = paths.iter().map(String::as_str).collect();
    let (_tmp, index) = index_over(&refs);

    let result = index.search("aatrox", || false);
    assert_eq!(result.total as usize, paths.len());
    assert_eq!(result.hits.len(), SEARCH_LIMIT);
}

#[test]
fn search_names_the_archive_each_hit_came_from() {
    let (_tmp, index) = index_over(&["assets/characters/aatrox.bin"]);
    let hit = index.search("aatrox", || false).hits.remove(0);
    assert_eq!(hit.wad, "Search.wad.client");
}

#[test]
fn search_reports_an_index_no_hash_table_named() {
    let tmp = game_with(&[("Search.wad.client", &["assets/characters/aatrox.bin"])]);

    let named = build(tmp.path(), &["assets/characters/aatrox.bin"]);
    assert!(!named.search("aatrox", || false).unnamed);

    let unnamed = build(tmp.path(), &[]);
    assert!(unnamed.search("aatrox", || false).unnamed);
}

#[test]
fn search_reaches_a_chunk_no_hash_table_names_by_its_hash() {
    let tmp = game_with(&[("Search.wad.client", &["assets/characters/aatrox.bin"])]);
    // No resolver entry, so the chunk lands in the unnamed group.
    let index = build(tmp.path(), &[]);

    let hash = format!("{:016x}", path_hash("assets/characters/aatrox.bin"));
    let hits = index.search(&hash, || false).hits;

    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].name, hash);
    assert!(hits[0].path.is_empty());
}

#[test]
fn search_gives_up_once_it_has_been_overtaken() {
    // One interval, so the scan reaches its first test of the generation.
    let paths: Vec<String> = (0..=STALE_CHECK_INTERVAL)
        .map(|i| format!("assets/skins/aatrox_{i:05}.bin"))
        .collect();
    let refs: Vec<&str> = paths.iter().map(String::as_str).collect();
    let (_tmp, index) = index_over(&refs);

    let overtaken = index.search("aatrox", || true);
    assert!(overtaken.superseded);
    assert!((overtaken.total as usize) < paths.len());

    let whole = index.search("aatrox", || false);
    assert!(!whole.superseded);
    assert_eq!(whole.total as usize, paths.len());
}

#[test]
fn generation_reports_a_ticket_that_a_later_claim_overtook() {
    let generation = SearchGeneration::default();
    let first = generation.claim();
    assert!(!generation.overtook(first));

    let second = generation.claim();
    assert!(generation.overtook(first));
    assert!(!generation.overtook(second));
}

/// The order both palette scorers must agree on.
///
/// The frontend suite checks the same file through `rank.ts`. A change to
/// either scorer that moves a row shows up here and there at once.
/// The install answers `nasus` with the champion, not with most of itself.
///
/// `n`, `a`, `s`, `u`, `s` appear in that order inside nearly every long
/// asset path, so while a query was a subsequence this matched 137,032
/// files of a live install and buried the four that a modder wanted.
#[test]
fn search_answers_a_query_only_where_it_reads_as_a_run() {
    let paths = [
        "assets/characters/nasus/skins/base/nasus.skn",
        "data/characters/nasus/nasus.bin",
        // Holds n-a-s-u-s in order, and nothing a modder typing it wants.
        "assets/characters/smolder/skins/base/charizard_particles/aura_self.dds",
        "assets/characters/smolder/sounds/wwise2016/sfx/charizard_sfx_audio.bnk",
        "assets/characters/aurelionsol/skins/base/aurelionsol_base_e_meshmultmask.dds",
    ];
    let (_tmp, index) = index_over(&paths);

    assert_eq!(
        ranked(&index, "nasus"),
        [
            "data/characters/nasus/nasus.bin",
            "assets/characters/nasus/skins/base/nasus.skn",
        ]
    );
}

/// A shape closer to a real install than a one-file index: deep paths,
/// several archives, and the partial queries a modder actually types.
#[test]
fn search_answers_the_queries_a_modder_types() {
    let paths = [
        "assets/characters/aatrox/skins/base/aatrox_base_tx_cm.dds",
        "assets/characters/aatrox/skins/skin01/aatrox_skin01_tx_cm.dds",
        "assets/characters/aatrox/hud/aatrox_circle.dds",
        "assets/characters/aatrox/aatrox.bin",
        "assets/characters/ahri/skins/base/ahri_base_tx_cm.dds",
        "assets/maps/shipping/map11/map11.materials.bin",
        "data/characters/aatrox/aatrox.bin",
        "data/menu/main_menu.bin",
    ];
    let tmp = game_with(&[
        ("Aatrox.wad.client", &paths[0..4]),
        ("Ahri.wad.client", &paths[4..5]),
        ("Map11.wad.client", &paths[5..6]),
        ("Global.wad.client", &paths[6..8]),
    ]);
    let index = build(tmp.path(), &paths);

    // A bare file name.
    assert_eq!(
        ranked(&index, "aatrox_circle.dds"),
        ["assets/characters/aatrox/hud/aatrox_circle.dds"]
    );

    // A fragment of a name, which is what a modder half-remembers.
    assert_eq!(
        ranked(&index, "circle"),
        ["assets/characters/aatrox/hud/aatrox_circle.dds"]
    );

    // A directory fragment, matched over the path.
    assert!(
        ranked(&index, "hud")
            .contains(&"assets/characters/aatrox/hud/aatrox_circle.dds".to_owned())
    );

    // A path typed with its separators.
    assert!(
        ranked(&index, "characters/ahri")
            .contains(&"assets/characters/ahri/skins/base/ahri_base_tx_cm.dds".to_owned())
    );

    // A run spanning directory and name, the band 2 case.
    assert!(
        ranked(&index, "skin01/aatrox")
            .contains(&"assets/characters/aatrox/skins/skin01/aatrox_skin01_tx_cm.dds".to_owned())
    );

    // Two terms, which is how a modder narrows without knowing the path.
    assert_eq!(
        ranked(&index, "aatrox circle"),
        ["assets/characters/aatrox/hud/aatrox_circle.dds"]
    );

    // Every aatrox row, across two archives.
    let aatrox = ranked(&index, "aatrox");
    assert_eq!(aatrox.len(), 5, "{aatrox:?}");

    // A name that only one archive carries.
    assert_eq!(ranked(&index, "main_menu"), ["data/menu/main_menu.bin"]);

    // Something the install does not hold.
    assert!(ranked(&index, "zed").is_empty());
}

#[test]
fn search_obeys_the_shared_ranking_fixture() {
    #[derive(serde::Deserialize)]
    struct Fixture {
        cases: Vec<Case>,
    }
    #[derive(serde::Deserialize)]
    struct Case {
        name: String,
        query: String,
        expect: Vec<String>,
        #[serde(default)]
        reject: Vec<String>,
    }

    let raw =
        include_str!("../../../../src/modules/workshop/palette/__tests__/ranking.fixture.json");
    let fixture: Fixture = serde_json::from_str(raw).unwrap();

    for case in fixture.cases {
        let held: Vec<&str> = case
            .expect
            .iter()
            .chain(case.reject.iter())
            .map(String::as_str)
            .collect();
        let (_tmp, index) = index_over(&held);

        assert_eq!(ranked(&index, &case.query), case.expect, "{}", case.name);
    }
}

fn find_query(pattern: &str, syntax: PatternSyntax) -> FindQuery {
    FindQuery::parse(pattern, syntax).unwrap().unwrap()
}

/// The full path of each hit, in the order the search returned them.
fn found(index: &GameIndex, pattern: &str) -> Vec<String> {
    let query = find_query(pattern, PatternSyntax::Literal);
    index
        .find(&query, || false)
        .hits
        .into_iter()
        .map(|hit| hit.path.unwrap_or(hit.name))
        .collect()
}

#[test]
fn find_lists_every_match_in_tree_order() {
    let (_tmp, index) = index_over(&[
        "assets/characters/aatrox/aatrox.bin",
        "assets/characters/aatrox/skins/base/aatrox.skn",
        "assets/characters/ahri/ahri.bin",
        "data/characters/aatrox/aatrox.bin",
    ]);

    assert_eq!(
        found(&index, "aatrox"),
        [
            "assets/characters/aatrox/aatrox.bin",
            "assets/characters/aatrox/skins/base/aatrox.skn",
            "data/characters/aatrox/aatrox.bin",
        ]
    );
}

#[test]
fn find_ignores_case() {
    let (_tmp, index) = index_over(&["assets/characters/aatrox/aatrox.bin"]);
    assert_eq!(
        found(&index, "AATROX.BIN"),
        ["assets/characters/aatrox/aatrox.bin"]
    );
}

#[test]
fn find_takes_a_regex_over_the_full_path() {
    let (_tmp, index) = index_over(&[
        "assets/characters/aatrox/skins/skin01/aatrox_skin01_tx_cm.dds",
        "assets/characters/aatrox/skins/skin03/aatrox_skin03_tx_cm.dds",
        "assets/characters/aatrox/aatrox.bin",
    ]);

    let query = find_query(r"skins/skin0[12].*\.dds$", PatternSyntax::Regex);
    let hits = index.find(&query, || false).hits;
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].name, "aatrox_skin01_tx_cm.dds");
    assert_eq!(
        hits[0].path.as_deref(),
        Some("assets/characters/aatrox/skins/skin01/aatrox_skin01_tx_cm.dds")
    );
    // The run crosses the separator, so both lines carry a piece of it.
    assert!(!hits[0].path_ranges.is_empty());
    assert_eq!(hits[0].name_ranges, [(0, hits[0].name.len() as u32)]);
}

/// One pattern, one run in the directory and one in the name, each marked
/// on its own line.
#[test]
fn find_marks_every_run_it_matched() {
    let (_tmp, index) = index_over(&["assets/aatrox/aatrox.bin"]);
    let query = find_query("aatrox", PatternSyntax::Literal);

    let hit = index.find(&query, || false).hits.remove(0);
    assert_eq!(hit.name, "aatrox.bin");
    assert_eq!(hit.path.as_deref(), Some("assets/aatrox/aatrox.bin"));
    assert_eq!(hit.name_ranges, [(0, 6)]);
    assert_eq!(hit.path_ranges, [(7, 13)]);
    assert_eq!(hit.wad, "Search.wad.client");
    assert!(hit.size_bytes > 0);
}

#[test]
fn find_counts_every_match_past_its_cap() {
    let paths: Vec<String> = (0..30)
        .map(|i| format!("assets/skins/aatrox_{i:03}.bin"))
        .collect();
    let refs: Vec<&str> = paths.iter().map(String::as_str).collect();
    let (_tmp, index) = index_over(&refs);

    let query = find_query("aatrox", PatternSyntax::Literal);
    let result = index.find_capped(&query, 10, || false);

    assert_eq!(result.hits.len(), 10);
    assert_eq!(result.total as usize, paths.len());
    assert!(!result.superseded);
}

#[test]
fn find_reaches_a_chunk_no_hash_table_names_by_its_hash() {
    let tmp = game_with(&[("Search.wad.client", &["assets/characters/aatrox.bin"])]);
    let index = build(tmp.path(), &[]);

    let hash = format!("{:016x}", path_hash("assets/characters/aatrox.bin"));
    let by_hash = index.find(&find_query(&hash, PatternSyntax::Literal), || false);
    assert_eq!(by_hash.hits.len(), 1);
    assert_eq!(by_hash.hits[0].name, hash);
    assert!(by_hash.hits[0].path.is_none());

    let result = index.find(&find_query("aatrox", PatternSyntax::Literal), || false);
    assert!(result.hits.is_empty());
    assert!(result.unnamed);
}

#[test]
fn find_gives_up_once_it_has_been_overtaken() {
    let paths: Vec<String> = (0..=STALE_CHECK_INTERVAL)
        .map(|i| format!("assets/skins/aatrox_{i:05}.bin"))
        .collect();
    let refs: Vec<&str> = paths.iter().map(String::as_str).collect();
    let (_tmp, index) = index_over(&refs);

    let query = find_query("aatrox", PatternSyntax::Literal);
    let overtaken = index.find(&query, || true);
    assert!(overtaken.superseded);
    assert!((overtaken.total as usize) < paths.len());

    let whole = index.find(&query, || false);
    assert!(!whole.superseded);
    assert_eq!(whole.total as usize, paths.len());
}

#[test]
fn merges_archives_into_one_tree() {
    let paths = ["assets/shared.bin", "assets/aatrox/skin0.bin"];
    let game = game_with(&[
        ("Aatrox.wad.client", &paths),
        (
            "Ahri.wad.client",
            &["assets/shared.bin", "assets/ahri/skin0.bin"],
        ),
    ]);

    let index = build(
        game.path(),
        &[
            "assets/shared.bin",
            "assets/aatrox/skin0.bin",
            "assets/ahri/skin0.bin",
        ],
    );

    let root = index.read_dir("").unwrap();
    assert_eq!(root.dirs.len(), 1, "one tree, not one row per archive");
    assert_eq!(root.dirs[0].name, "assets");
    assert_eq!(root.dirs[0].file_count, 3, "the shared chunk counts once");

    let assets = index.read_dir("assets").unwrap();
    let dirs: Vec<&str> = assets.dirs.iter().map(|d| d.name.as_str()).collect();
    assert_eq!(
        dirs,
        ["aatrox", "ahri"],
        "both archives' paths, side by side"
    );
    let files: Vec<&str> = assets
        .files
        .iter()
        .filter_map(|f| f.path.as_deref())
        .collect();
    assert_eq!(files, ["assets/shared.bin"]);
}

#[test]
fn a_shared_chunk_is_one_file() {
    let game = game_with(&[
        ("A.wad.client", &["assets/shared.bin"]),
        ("B.wad.client", &["assets/shared.bin"]),
        ("C.wad.client", &["assets/shared.bin"]),
    ]);

    let index = build(game.path(), &["assets/shared.bin"]);

    let files = index.read_dir("assets").unwrap().files;
    assert_eq!(files.len(), 1);
    assert_eq!(
        files[0].wad, "A.wad.client",
        "the copy that survives the fold names the archive it came from"
    );
    let stats = index.stats();
    assert_eq!(stats.archives, 3);
    assert_eq!(stats.files, 1);
}

#[test]
fn every_file_names_the_archive_it_came_from() {
    let game = game_with(&[
        ("A.wad.client", &["assets/one.bin"]),
        ("Champions/B.wad.client", &["assets/two.bin"]),
    ]);

    let index = build(game.path(), &["assets/one.bin", "assets/two.bin"]);

    let files = index.read_dir("assets").unwrap().files;
    let wads: Vec<(&str, &str)> = files
        .iter()
        .map(|file| (file.path.as_deref().unwrap(), file.wad.as_str()))
        .collect();
    assert_eq!(
        wads,
        [
            ("assets/one.bin", "A.wad.client"),
            ("assets/two.bin", "Champions/B.wad.client"),
        ]
    );
}

#[test]
fn a_listing_orders_digit_runs_numerically() {
    let (_tmp, index) = index_over(&[
        "assets/skin50.bin",
        "assets/skin5.bin",
        "assets/skin9.bin",
        "assets/skin76.bin",
        "assets/skin14.bin",
        "assets/skin3.bin",
    ]);

    let listing = index.read_dir("assets").unwrap();
    let names: Vec<&str> = listing
        .files
        .iter()
        .map(|file| file.path.as_deref().unwrap())
        .collect();
    assert_eq!(
        names,
        [
            "assets/skin3.bin",
            "assets/skin5.bin",
            "assets/skin9.bin",
            "assets/skin14.bin",
            "assets/skin50.bin",
            "assets/skin76.bin",
        ]
    );
}

#[test]
fn a_listing_orders_its_directories_naturally_too() {
    let (_tmp, index) = index_over(&[
        "assets/map10/terrain.bin",
        "assets/map2/terrain.bin",
        "assets/map1/terrain.bin",
    ]);

    let listing = index.read_dir("assets").unwrap();
    let names: Vec<&str> = listing.dirs.iter().map(|dir| dir.name.as_str()).collect();
    assert_eq!(names, ["map1", "map2", "map10"]);
}

#[test]
fn an_unnamed_chunk_names_its_archive_too() {
    let game = game_with(&[("A.wad.client", &["assets/hidden.bin"])]);

    let index = build(game.path(), &[]);

    let files = index.read_dir(UNKNOWN_DIR).unwrap().files;
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].wad, "A.wad.client");
}

#[test]
fn folds_a_chain_of_single_child_directories() {
    let game = game_with(&[("A.wad.client", &["assets/characters/aatrox/hud/icon.dds"])]);
    let index = build(game.path(), &["assets/characters/aatrox/hud/icon.dds"]);

    let root = index.read_dir("").unwrap();
    assert_eq!(root.dirs[0].name, "assets/characters/aatrox/hud");
    assert_eq!(
        root.dirs[0].path, "assets/characters/aatrox/hud",
        "the row opens the directory that holds the files"
    );

    let folded = index.read_dir(&root.dirs[0].path).unwrap();
    assert_eq!(folded.files.len(), 1);
    assert_eq!(
        folded.files[0].path.as_deref(),
        Some("assets/characters/aatrox/hud/icon.dds"),
        "a file carries the whole path, folded rows included"
    );
}

#[test]
fn a_chain_stops_folding_where_it_branches() {
    let game = game_with(&[(
        "A.wad.client",
        &[
            "assets/characters/aatrox/a.bin",
            "assets/characters/ahri/b.bin",
        ],
    )]);
    let index = build(
        game.path(),
        &[
            "assets/characters/aatrox/a.bin",
            "assets/characters/ahri/b.bin",
        ],
    );

    let root = index.read_dir("").unwrap();
    assert_eq!(root.dirs[0].name, "assets/characters");
    assert_eq!(root.dirs[0].file_count, 2);
}

#[test]
fn unnamed_chunks_gather_under_one_group() {
    let game = game_with(&[("A.wad.client", &["assets/known.bin", "assets/mystery.bin"])]);
    let index = build(game.path(), &["assets/known.bin"]);

    let root = index.read_dir("").unwrap();
    let names: Vec<&str> = root.dirs.iter().map(|d| d.name.as_str()).collect();
    assert_eq!(
        names,
        ["assets", "unknown"],
        "the group sits after named paths"
    );

    let unknown = index.read_dir(UNKNOWN_DIR).unwrap();
    assert_eq!(unknown.files.len(), 1);
    assert_eq!(
        unknown.files[0].path, None,
        "nothing names an unnamed chunk"
    );
    assert_eq!(
        unknown.files[0].path_hash,
        format!("{:016x}", path_hash("assets/mystery.bin"))
    );
    assert_eq!(index.stats().files, 2, "unnamed chunks count as files");
}

#[test]
fn a_path_outside_the_index_lists_nothing() {
    let game = game_with(&[("A.wad.client", &["assets/known.bin"])]);
    let index = build(game.path(), &["assets/known.bin"]);

    assert!(index.read_dir("assets/nope").is_none());
    assert!(index.read_dir("nope").is_none());
}

#[test]
fn an_install_with_no_archives_builds_an_empty_tree() {
    let game = game_with(&[]);
    let index = build(game.path(), &[]);

    let root = index.read_dir("").unwrap();
    assert!(root.dirs.is_empty());
    assert!(root.files.is_empty());
    assert_eq!(index.stats().files, 0);
}

#[test]
fn for_each_named_file_visits_every_named_file_with_its_archive() {
    let game = game_with(&[
        (
            "A.wad.client",
            &["assets/aatrox/aatrox.bin", "assets/mystery.bin"],
        ),
        (
            "B.wad.client",
            &["data/menu/main_menu.bin", "assets/aatrox/aatrox.bin"],
        ),
    ]);
    let index = build(
        game.path(),
        &["assets/aatrox/aatrox.bin", "data/menu/main_menu.bin"],
    );

    let mut seen = Vec::new();
    index.for_each_named_file(|hash, path, wad| seen.push((hash, path.to_owned(), wad)));
    seen.sort_by(|a, b| a.1.cmp(&b.1));

    assert_eq!(
        seen,
        [
            (
                path_hash("assets/aatrox/aatrox.bin"),
                "assets/aatrox/aatrox.bin".to_owned(),
                0
            ),
            (
                path_hash("data/menu/main_menu.bin"),
                "data/menu/main_menu.bin".to_owned(),
                1
            ),
        ],
        "the fold keeps the first archive's copy, and an unnamed chunk is not visited"
    );
    assert_eq!(index.wads(), ["A.wad.client", "B.wad.client"]);
}

#[test]
fn file_at_finds_a_file_by_its_path_and_nothing_for_another() {
    let (_tmp, index) = index_over(&[
        "assets/characters/aatrox/aatrox.bin",
        "assets/characters/aatrox/skin01.bin",
    ]);

    let file = index
        .file_at("assets/characters/aatrox/skin01.bin")
        .unwrap();
    assert_eq!(
        file.path.as_deref(),
        Some("assets/characters/aatrox/skin01.bin")
    );
    assert_eq!(file.wad, "Search.wad.client");
    assert_eq!(
        file.path_hash,
        hex_name(WadHash(path_hash("assets/characters/aatrox/skin01.bin")))
    );

    assert!(
        index
            .file_at("assets/characters/aatrox/skin02.bin")
            .is_none()
    );
    assert!(index.file_at("assets/characters/ahri/skin01.bin").is_none());
    assert!(index.file_at("aatrox.bin").is_none());
}

/// A path no table names is still a chunk the game reaches by the path's hash.
#[test]
fn unnamed_at_finds_a_chunk_no_hash_table_names_by_its_hash() {
    let game = game_with(&[(
        "A.wad.client",
        &["assets/known.bin", "assets/hidden.bin", "assets/other.bin"],
    )]);
    let index = build(game.path(), &["assets/known.bin"]);

    let hidden = path_hash("assets/hidden.bin");
    let file = index.unnamed_at(hidden).unwrap();
    assert_eq!(file.path, None);
    assert_eq!(file.path_hash, hex_name(WadHash(hidden)));
    assert_eq!(file.wad, "A.wad.client");

    assert!(
        index.unnamed_at(path_hash("assets/known.bin")).is_none(),
        "a named chunk is in the tree, not the unnamed group"
    );
    assert!(index.unnamed_at(path_hash("assets/gone.bin")).is_none());
}
