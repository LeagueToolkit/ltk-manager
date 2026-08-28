//! Unit tests for keeping a name, the collision refusal, and what lands on disk.

use super::*;

use ltk_hash::Hash as _;
use std::collections::HashMap;

const ICON: &str = "ASSETS/Characters/Smolder/HUD/Smolder_Circle.dds";
const OTHER: &str = "ASSETS/Characters/Smolder/HUD/Smolder_Square.dds";

/// A resolver naming exactly what it is given, standing in for the community
/// hashtables.
struct Knows(HashMap<u64, String>);

impl Knows {
    fn of(paths: &[&str]) -> Self {
        Self(
            paths
                .iter()
                .map(|path| (WadHash::hash_str(path).0, (*path).to_owned()))
                .collect(),
        )
    }
}

impl PathResolver for Knows {
    fn resolve(&self, path_hash: WadHash) -> Option<String> {
        self.0.get(&path_hash.0).cloned()
    }
}

/// A project directory whose config declares `hashtables`.
fn project(hashtables: Vec<ModProjectHashtable>) -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("a temp dir");
    let config = ModProject {
        hashtables,
        ..crate::mods::test_support::mod_project_named("smolder-x")
    };
    std::fs::write(
        dir.path().join("mod.config.json"),
        config
            .to_config_string(ConfigFormat::Json)
            .expect("the config"),
    )
    .expect("the config file");
    dir
}

fn bare_project() -> tempfile::TempDir {
    project(Vec::new())
}

/// The names the project's declared tables resolve, as a reader would see them.
fn declared(root: &Path) -> HashtableSet {
    let utf8 = camino::Utf8Path::from_path(root).expect("a utf-8 root");
    let project = ModProject::load(utf8).expect("the project");
    HashtableSet::build(read_tables(root, &project.hashtables))
}

fn table_of(root: &Path) -> String {
    std::fs::read_to_string(root.join(GAME_TABLE_PATH)).expect("the table")
}

#[test]
fn a_kept_name_reads_back_out_of_the_table_it_writes() {
    let dir = bare_project();
    let mut kept = PreservedNames::open(dir.path(), None);

    assert_eq!(kept.keep(ICON), Preserved::Kept);
    assert_eq!(kept.write().expect("the write"), 1);

    assert_eq!(
        declared(dir.path()).resolve_value(&Category::Game, WadHash::hash_str(ICON).0),
        Some(ICON)
    );
}

/// The manifest is what makes a table exist for lookup, so a run that writes
/// the file and not the entry has kept nothing.
#[test]
fn keeping_a_name_declares_the_table_in_the_project_config() {
    let dir = bare_project();
    let mut kept = PreservedNames::open(dir.path(), None);
    kept.keep(ICON);
    kept.write().expect("the write");

    let utf8 = camino::Utf8Path::from_path(dir.path()).unwrap();
    let manifest = ModProject::load(utf8).unwrap().hashtables;
    assert_eq!(manifest.len(), 1);
    assert_eq!(manifest[0].path, GAME_TABLE_PATH);
    assert_eq!(manifest[0].category, Category::Game);
    assert_eq!(manifest[0].bits, 64);
}

/// Story: embedding a name a reader already resolves costs the mod size and
/// buys it nothing.
#[test]
fn a_name_the_community_tables_already_hold_is_not_embedded() {
    let dir = bare_project();
    let known = Knows::of(&[ICON]);
    let mut kept = PreservedNames::open(dir.path(), Some(&known));

    assert_eq!(kept.keep(ICON), Preserved::Kept);
    assert_eq!(kept.added(), 0);
    assert_eq!(kept.write().expect("the write"), 0);
    assert!(!dir.path().join(GAME_TABLE_PATH).exists());
}

#[test]
fn keeping_one_name_twice_writes_it_once() {
    let dir = bare_project();
    let mut kept = PreservedNames::open(dir.path(), None);

    assert_eq!(kept.keep(ICON), Preserved::Kept);
    assert_eq!(kept.keep(ICON), Preserved::Kept);

    assert_eq!(kept.added(), 1);
}

/// A name differing only in case is the same name: [`Key`] canonicalizes
/// before it hashes, so both take one key and one entry.
#[test]
fn a_name_recased_is_the_same_name() {
    let dir = bare_project();
    let mut kept = PreservedNames::open(dir.path(), None);

    assert_eq!(kept.keep(ICON), Preserved::Kept);
    assert_eq!(kept.keep(&ICON.to_ascii_lowercase()), Preserved::Kept);

    assert_eq!(kept.added(), 1);
}

/// Story: two names on one key would leave the second unreadable after the
/// fix, so the caller is told to leave that property alone.
#[test]
fn a_second_name_on_one_key_collides() {
    let dir = bare_project();
    let mut kept = PreservedNames::open(dir.path(), None);
    let key = Key::of(ICON, &Algorithm::Xxh64, KeyWidth::new(64).unwrap()).unwrap();
    kept.fresh.insert(key.value(), OTHER.to_owned());

    assert_eq!(kept.keep(ICON), Preserved::Collides);
    assert_eq!(kept.added(), 1, "the name that was already there stays");
}

/// A name the project's own table already keys differently is refused, so a
/// repair never writes a hash the mod's tables read as something else.
///
/// Staged at a width narrow enough for two names to meet, which is the only
/// way to reach a path the 64-bit game category makes unreachable.
#[test]
fn a_name_a_declared_table_keys_differently_collides() {
    let narrow = KeyWidth::new(8).unwrap();
    let dir = project(vec![ModProjectHashtable {
        path: GAME_TABLE_PATH.to_owned(),
        category: Category::Game,
        algorithm: Algorithm::Xxh64,
        bits: narrow.bits(),
    }]);
    let held = Key::of(OTHER, &Algorithm::Xxh64, narrow).unwrap();
    let twin = (0..)
        .map(|n| format!("ASSETS/twin{n}.dds"))
        .find(|name| Key::of(name, &Algorithm::Xxh64, narrow) == Some(held))
        .expect("eight bits is 256 keys");
    std::fs::create_dir_all(dir.path().join(HASHES_DIR_NAME)).unwrap();
    std::fs::write(
        dir.path().join(GAME_TABLE_PATH),
        format!(
            "{OTHER}
"
        ),
    )
    .unwrap();

    let mut kept = PreservedNames::open(dir.path(), None);

    assert_eq!(kept.keep(&twin), Preserved::Collides);
    assert_eq!(kept.added(), 0);
}

/// Merge-only: a second repair must not cost the mod the names the first kept.
#[test]
fn a_second_run_keeps_what_the_first_wrote() {
    let dir = bare_project();
    let mut first = PreservedNames::open(dir.path(), None);
    first.keep(ICON);
    first.write().expect("the write");

    let mut second = PreservedNames::open(dir.path(), None);
    assert_eq!(second.keep(OTHER), Preserved::Kept);
    second.write().expect("the write");

    let table = table_of(dir.path());
    assert!(table.contains(ICON), "{table}");
    assert!(table.contains(OTHER), "{table}");
    assert_eq!(
        ModProject::load(camino::Utf8Path::from_path(dir.path()).unwrap())
            .unwrap()
            .hashtables
            .len(),
        1,
        "the second run declares no second table"
    );
}

/// A rerun that keeps only names the table already holds is a no-op, so a
/// repair offered twice does not rewrite the project.
#[test]
fn a_run_that_keeps_a_name_already_declared_writes_nothing() {
    let dir = bare_project();
    let mut first = PreservedNames::open(dir.path(), None);
    first.keep(ICON);
    first.write().expect("the write");
    let before = std::fs::read(dir.path().join("mod.config.json")).expect("the config");

    let mut second = PreservedNames::open(dir.path(), None);
    assert_eq!(second.keep(ICON), Preserved::Kept);
    assert_eq!(second.write().expect("the write"), 0);

    assert_eq!(
        std::fs::read(dir.path().join("mod.config.json")).expect("the config"),
        before
    );
}

/// A project already declaring a table under another name merges into it
/// rather than declaring a second one for the same category.
#[test]
fn a_project_that_already_declares_a_game_table_gains_no_second_one() {
    let dir = project(vec![ModProjectHashtable {
        path: "hashes/harvested.hashes.txt".to_owned(),
        category: Category::Game,
        algorithm: Algorithm::Xxh64,
        bits: 64,
    }]);
    std::fs::create_dir_all(dir.path().join("hashes")).unwrap();
    std::fs::write(dir.path().join("hashes/harvested.hashes.txt"), "").unwrap();

    let mut kept = PreservedNames::open(dir.path(), None);
    kept.keep(ICON);
    kept.write().expect("the write");

    let manifest = ModProject::load(camino::Utf8Path::from_path(dir.path()).unwrap())
        .unwrap()
        .hashtables;
    assert_eq!(manifest.len(), 1);
    assert!(
        std::fs::read_to_string(dir.path().join("hashes/harvested.hashes.txt"))
            .unwrap()
            .contains(ICON)
    );
}

/// A directory with no project config has nowhere to declare a table. The
/// write reports it, and `FixRun::finish` logs it rather than failing a repair
/// whose bins have already landed.
#[test]
fn a_directory_that_is_not_a_project_cannot_keep_names() {
    let dir = tempfile::tempdir().unwrap();
    let mut kept = PreservedNames::open(dir.path(), None);

    assert_eq!(kept.keep(ICON), Preserved::Kept);
    assert!(kept.write().is_err());
}
