//! Unit tests for the built-in mods and the projects they write.

use super::base_skins::Champions;
use super::skin_bin::SkinBin;
use super::*;
use ltk_hash::BinHash;
use ltk_meta::property::PropertyValueEnum;
use ltk_meta::property::values;
use ltk_meta::{Bin, BinObject};
use ltk_overlay::ModContentProvider as _;
use ltk_wad::WadHash;
use ltk_wad::{WadBuilder, WadChunkBuilder};
use std::collections::HashMap;
use std::io::Write as _;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

fn maps_dir(game: &Path) -> PathBuf {
    game.join("DATA")
        .join("FINAL")
        .join("Maps")
        .join("Shipping")
}

/// A game archive at `path` holding `chunk_paths`, a base skin as the game's own and every
/// other chunk as four bytes.
fn build_wad(path: &Path, chunk_paths: &[&str]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let mut builder = WadBuilder::default();
    let mut contents = HashMap::new();
    for chunk_path in chunk_paths {
        builder = builder.with_chunk(WadChunkBuilder::default().with_path(*chunk_path));
        let content = match SkinBin::parse(chunk_path) {
            Some(bin) if bin.is_base() => skin0_bin(&bin.character, GAME),
            _ => b"PROP".to_vec(),
        };
        contents.insert(WadHash::from(*chunk_path), content);
    }
    let mut file = fs::File::create(path).unwrap();
    builder
        .build_to_writer(&mut file, |path_hash, cursor| {
            cursor.write_all(&contents[&path_hash])?;
            Ok(())
        })
        .unwrap();
}

/// What `builtin` overrides in the game at `game` over `mods`, caching in `cache_dir`.
fn generate(
    builtin: &dyn BuiltinMod,
    game: &Path,
    cache_dir: &Path,
    tables: &Tables,
    mods: &mut [EnabledMod],
) -> Overrides {
    builtin
        .generate(&mut Context {
            game_dir: &GameDir::from_path(game),
            tables,
            mods,
            cache_dir,
        })
        .unwrap()
}

fn ward_skins(game: &Path) -> Overrides {
    let cache = tempfile::tempdir().unwrap();
    generate(
        &DefaultWardSkins,
        game,
        cache.path(),
        &Tables::default(),
        &mut [],
    )
}

fn files(overrides: &Overrides) -> Vec<(String, Vec<u8>)> {
    overrides
        .iter()
        .map(|(path, bytes)| (path.as_str().replace('\\', "/"), bytes.to_vec()))
        .collect()
}

#[test]
fn ward_skins_break_every_skin_bin_a_map_archive_holds() {
    let game = tempfile::tempdir().unwrap();
    build_wad(
        &maps_dir(game.path()).join("Map11.wad.client"),
        &[
            "data/characters/sightward/skins/skin0.bin",
            "data/characters/sightward/skins/skin1.bin",
            "data/characters/sightward/skins/skin267.bin",
            "data/characters/sru_dragon/skins/skin1.bin",
        ],
    );
    build_wad(
        &maps_dir(game.path()).join("Map12.wad.client"),
        &["data/characters/sightward/skins/skin3.bin"],
    );

    let overrides = ward_skins(game.path());

    assert_eq!(
        files(&overrides),
        [
            (
                "Map11.wad.client/data/characters/sightward/skins/skin1.bin".to_string(),
                b"JUNK".to_vec()
            ),
            (
                "Map11.wad.client/data/characters/sightward/skins/skin267.bin".to_string(),
                b"JUNK".to_vec()
            ),
            (
                "Map12.wad.client/data/characters/sightward/skins/skin3.bin".to_string(),
                b"JUNK".to_vec()
            ),
        ]
    );
}

#[test]
fn ward_skins_leave_archives_outside_the_maps_alone() {
    let game = tempfile::tempdir().unwrap();
    build_wad(
        &game
            .path()
            .join("DATA")
            .join("FINAL")
            .join("Global.wad.client"),
        &["data/characters/sightward/skins/skin1.bin"],
    );

    let overrides = ward_skins(game.path());

    assert_eq!(files(&overrides), []);
}

#[test]
fn ward_skins_pass_over_a_map_archive_that_does_not_mount() {
    let game = tempfile::tempdir().unwrap();
    fs::create_dir_all(maps_dir(game.path())).unwrap();
    fs::write(maps_dir(game.path()).join("Map11.wad.client"), b"not a wad").unwrap();
    build_wad(
        &maps_dir(game.path()).join("Map12.wad.client"),
        &["data/characters/sightward/skins/skin3.bin"],
    );

    let overrides = ward_skins(game.path());

    assert_eq!(
        files(&overrides),
        [(
            "Map12.wad.client/data/characters/sightward/skins/skin3.bin".to_string(),
            b"JUNK".to_vec()
        )]
    );
}

#[test]
fn a_skin_bin_path_hashes_to_the_chunk_the_game_ships() {
    let hash = ltk_wad::WadHash::from("data/characters/sightward/skins/skin1.bin");
    assert_eq!(hash.0, 0x3352_aa5f_60c7_fbd0);
}

fn ward_overrides(skins: &[(&str, u32)]) -> Overrides {
    let mut overrides = Overrides::default();
    for (wad, id) in skins {
        overrides.insert(
            wad,
            &format!("data/characters/sightward/skins/skin{id}.bin"),
            b"JUNK".as_slice(),
        );
    }
    overrides
}

fn write_ward_project(overrides: &Overrides, dir: &Path) {
    overrides
        .write(dir, "default-ward-skins", "Default ward skins")
        .unwrap();
}

fn overrides(dir: &Path) -> Vec<(String, String, Vec<u8>)> {
    let mut content = ltk_overlay::FsModContent::new(dir.to_path_buf().try_into().unwrap());
    let mut out = Vec::new();
    for wad in content.list_layer_wads("base").unwrap() {
        for (path, bytes) in content.read_wad_overrides("base", &wad).unwrap() {
            out.push((wad.clone(), path.as_str().replace('\\', "/"), bytes));
        }
    }
    out.sort();
    out
}

#[test]
fn a_written_project_reads_back_as_a_mod() {
    let dir = tempfile::tempdir().unwrap();

    write_ward_project(
        &ward_overrides(&[("Map11.wad.client", 1), ("Map12.wad.client", 3)]),
        dir.path(),
    );

    let mut content = ltk_overlay::FsModContent::new(dir.path().to_path_buf().try_into().unwrap());
    assert_eq!(content.mod_project().unwrap().name, "default-ward-skins");
    assert_eq!(
        overrides(dir.path()),
        [
            (
                "Map11.wad.client".to_string(),
                "data/characters/sightward/skins/skin1.bin".to_string(),
                b"JUNK".to_vec()
            ),
            (
                "Map12.wad.client".to_string(),
                "data/characters/sightward/skins/skin3.bin".to_string(),
                b"JUNK".to_vec()
            ),
        ]
    );
}

#[test]
fn rewriting_an_unchanged_project_keeps_its_fingerprint() {
    let dir = tempfile::tempdir().unwrap();
    let overrides = ward_overrides(&[("Map11.wad.client", 1)]);
    write_ward_project(&overrides, dir.path());

    let long_ago = filetime::FileTime::from_unix_time(1_000_000_000, 0);
    for entry in walkdir::WalkDir::new(dir.path()) {
        let entry = entry.unwrap();
        if entry.file_type().is_file() {
            filetime::set_file_mtime(entry.path(), long_ago).unwrap();
        }
    }
    let content = ltk_overlay::FsModContent::new(dir.path().to_path_buf().try_into().unwrap());
    let before = content.content_fingerprint().unwrap();

    write_ward_project(&overrides, dir.path());

    let content = ltk_overlay::FsModContent::new(dir.path().to_path_buf().try_into().unwrap());
    let after = content.content_fingerprint().unwrap();
    assert!(before.is_some());
    assert_eq!(before, after);
}

#[test]
fn a_rewrite_drops_what_the_project_no_longer_holds() {
    let dir = tempfile::tempdir().unwrap();
    write_ward_project(
        &ward_overrides(&[
            ("Map11.wad.client", 1),
            ("Map11.wad.client", 2),
            ("Map12.wad.client", 3),
        ]),
        dir.path(),
    );

    write_ward_project(&ward_overrides(&[("Map11.wad.client", 1)]), dir.path());

    assert_eq!(
        overrides(dir.path()),
        [(
            "Map11.wad.client".to_string(),
            "data/characters/sightward/skins/skin1.bin".to_string(),
            b"JUNK".to_vec()
        )]
    );
    assert!(
        !dir.path()
            .join("content")
            .join("base")
            .join("Map12.wad.client")
            .exists()
    );
}

fn ward_skins_turned(on: bool) -> BuiltinModSettings {
    BuiltinModSettings {
        default_ward_skins: on,
        ..BuiltinModSettings::default()
    }
}

#[test]
fn a_built_in_mod_turned_on_is_written_and_injected() {
    let game = tempfile::tempdir().unwrap();
    build_wad(
        &maps_dir(game.path()).join("Map11.wad.client"),
        &["data/characters/sightward/skins/skin1.bin"],
    );
    let storage = tempfile::tempdir().unwrap();

    let mods = inject(
        storage.path(),
        &ward_skins_turned(true),
        &GameDir::from_path(game.path()),
        &Tables::default(),
        Vec::new(),
    )
    .unwrap();

    let ids: Vec<&str> = mods.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(ids, ["builtin:default-ward-skins"]);
    assert_eq!(
        overrides(&storage.path().join("builtin").join("default-ward-skins")),
        [(
            "Map11.wad.client".to_string(),
            "data/characters/sightward/skins/skin1.bin".to_string(),
            b"JUNK".to_vec()
        )]
    );
}

#[test]
fn a_built_in_mod_turned_off_is_removed() {
    let game = tempfile::tempdir().unwrap();
    let storage = tempfile::tempdir().unwrap();
    let game_dir = GameDir::from_path(game.path());
    inject(
        storage.path(),
        &ward_skins_turned(true),
        &game_dir,
        &Tables::default(),
        Vec::new(),
    )
    .unwrap();

    let mods = inject(
        storage.path(),
        &ward_skins_turned(false),
        &game_dir,
        &Tables::default(),
        Vec::new(),
    )
    .unwrap();

    assert!(mods.is_empty());
    assert!(
        !storage
            .path()
            .join("builtin")
            .join("default-ward-skins")
            .exists()
    );
}

#[test]
fn a_directory_no_built_in_mod_owns_is_removed() {
    let game = tempfile::tempdir().unwrap();
    let storage = tempfile::tempdir().unwrap();
    let retired = storage.path().join("builtin").join("retired-slug");
    fs::create_dir_all(retired.join("content")).unwrap();

    inject(
        storage.path(),
        &ward_skins_turned(false),
        &GameDir::from_path(game.path()),
        &Tables::default(),
        Vec::new(),
    )
    .unwrap();

    assert!(!retired.exists());
}

#[test]
fn a_game_without_maps_generates_no_override() {
    let game = tempfile::tempdir().unwrap();

    let overrides = ward_skins(game.path());

    assert_eq!(files(&overrides), []);
}

#[test]
fn a_built_in_mod_goes_above_every_other_mod() {
    let game = tempfile::tempdir().unwrap();
    let storage = tempfile::tempdir().unwrap();
    let installed = tempfile::tempdir().unwrap();

    let mods = inject(
        storage.path(),
        &ward_skins_turned(true),
        &GameDir::from_path(game.path()),
        &Tables::default(),
        vec![fs_mod("installed", installed.path())],
    )
    .unwrap();

    let ids: Vec<&str> = mods.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(ids, ["builtin:default-ward-skins", "installed"]);
}

#[test]
fn every_built_in_mod_turned_on_is_injected_in_priority_order() {
    let game = tempfile::tempdir().unwrap();
    build_wad(
        &champions_dir(game.path()).join("Ahri.wad.client"),
        &[&skin("ahri", 0), &skin("ahri", 1)],
    );
    let storage = tempfile::tempdir().unwrap();
    let settings = BuiltinModSettings {
        default_ward_skins: true,
        base_skins: crate::config::BaseSkinsScope::AllChampions,
        ..BuiltinModSettings::default()
    };

    let mods = inject(
        storage.path(),
        &settings,
        &GameDir::from_path(game.path()),
        &Tables::default(),
        Vec::new(),
    )
    .unwrap();

    let ids: Vec<&str> = mods.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(ids, ["builtin:default-ward-skins", "builtin:base-skins"]);
    assert_eq!(count_enabled(&settings), 2);
    assert_eq!(
        overrides(&storage.path().join("builtin").join("base-skins"))
            .into_iter()
            .map(|(wad, path, bytes)| (format!("{wad}/{path}"), whose(&bytes)))
            .collect::<Vec<_>>(),
        [stand_in("Ahri.wad.client", &skin("ahri", 1), GAME)]
    );
}

fn champions_dir(game: &Path) -> PathBuf {
    game.join("DATA").join("FINAL").join("Champions")
}

fn skin(character: &str, id: u32) -> String {
    format!("data/characters/{character}/skins/skin{id}.bin")
}

fn object(character: &str, id: u32, suffix: &str) -> BinHash {
    BinHash::from(format!("Characters/{character}/Skins/Skin{id}{suffix}").as_str())
}

/// Whose base skin a test bin is, read back out of a stand-in.
const GAME: &str = "the game's";
const MOD: &str = "a mod's";

/// A `skin0.bin` for `character`, its properties marked with whose it is.
fn skin0_bin(character: &str, whose: &str) -> Vec<u8> {
    let properties = BinObject::builder(
        object(character, 0, ""),
        BinHash::from("SkinCharacterDataProperties"),
    )
    .property(
        BinHash::from("whose"),
        values::String::new(whose.to_owned()),
    )
    .property(
        BinHash::from("mResourceResolver"),
        values::ObjectLink::new(object(character, 0, "/Resources")),
    )
    .build();
    let resources = BinObject::builder(
        object(character, 0, "/Resources"),
        BinHash::from("ResourceResolver"),
    )
    .build();
    let mut bin = Bin {
        dependencies: vec![format!("DATA/Characters/{character}/{character}.bin")],
        ..Bin::default()
    };
    bin.objects.insert(properties.path_hash, properties);
    bin.objects.insert(resources.path_hash, resources);
    let mut bytes = std::io::Cursor::new(Vec::new());
    bin.to_writer(&mut bytes).unwrap();
    bytes.into_inner()
}

/// Whose base skin the stand-in `bytes` copies.
fn whose(bytes: &[u8]) -> String {
    let bin = Bin::from_reader(&mut std::io::Cursor::new(bytes)).unwrap();
    bin.objects
        .values()
        .find_map(
            |object| match object.properties.get(&BinHash::from("whose")) {
                Some(PropertyValueEnum::String(value)) => Some(value.value.clone()),
                _ => None,
            },
        )
        .unwrap()
}

/// Each file of a base skins project, by path, with whose base skin it copies.
fn stand_ins(files: &[(String, Vec<u8>)]) -> Vec<(String, String)> {
    files
        .iter()
        .map(|(path, bytes)| (path.clone(), whose(bytes)))
        .collect()
}

fn stand_in(wad: &str, chunk_path: &str, from: &str) -> (String, String) {
    (format!("{wad}/{chunk_path}"), from.to_owned())
}

/// A mod project in `dir` holding `files`, each a chunk path in a game archive, with `bytes`.
fn write_mod_with(dir: &Path, files: &[(&str, &str)], bytes: &[u8]) {
    let mut overrides = Overrides::default();
    for (wad, chunk_path) in files {
        overrides.insert(wad, chunk_path, bytes.to_vec());
    }
    overrides.write(dir, "mod", "Mod").unwrap();
}

/// A mod project in `dir` giving `character` a base skin of its own.
fn write_base_skin_mod(dir: &Path, wad: &str, character: &str) {
    write_mod_with(
        dir,
        &[(wad, &skin(character, 0))],
        &skin0_bin(character, MOD),
    );
}

fn fs_mod(id: &str, dir: &Path) -> EnabledMod {
    EnabledMod {
        id: id.to_owned(),
        content: Box::new(FsModContent::new(dir.to_path_buf().try_into().unwrap())),
        enabled_layers: None,
    }
}

/// WAD path tables naming exactly the paths they were given.
#[derive(Default)]
struct Tables(HashMap<WadHash, String>);

impl Tables {
    fn naming(paths: &[String]) -> Self {
        Self(
            paths
                .iter()
                .map(|path| (WadHash::from(path.as_str()), path.clone()))
                .collect(),
        )
    }
}

impl PathResolver for Tables {
    fn resolve(&self, path_hash: WadHash) -> Option<String> {
        self.0.get(&path_hash).cloned()
    }
}

fn base_skins(
    game: &Path,
    cache_dir: &Path,
    champions: Champions,
    tables: &Tables,
    mods: &mut [EnabledMod],
) -> Vec<(String, Vec<u8>)> {
    files(&generate(
        &BaseSkins { champions },
        game,
        cache_dir,
        tables,
        mods,
    ))
}

fn modded_champions(
    game: &Path,
    cache_dir: &Path,
    mods: &mut [EnabledMod],
) -> Vec<(String, String)> {
    stand_ins(&base_skins(
        game,
        cache_dir,
        Champions::Modded,
        &Tables::default(),
        mods,
    ))
}

#[test]
fn a_stand_in_holds_the_base_skin_under_the_skin_s_names() {
    let base = super::stand_in::BaseSkin::parse("ahri", &skin0_bin("ahri", MOD)).unwrap();

    let bin = Bin::from_reader(&mut std::io::Cursor::new(base.stand_in(9).unwrap())).unwrap();

    let names: Vec<BinHash> = bin.objects.keys().copied().collect();
    assert_eq!(
        names,
        [object("ahri", 9, ""), object("ahri", 9, "/Resources")]
    );
    assert_eq!(
        bin.objects[&object("ahri", 9, "")].properties[&BinHash::from("mResourceResolver")],
        PropertyValueEnum::ObjectLink(values::ObjectLink::new(object("ahri", 9, "/Resources")))
    );
    assert_eq!(
        bin.dependencies,
        [
            "DATA/Characters/ahri/ahri.bin",
            "DATA/Characters/ahri/Skins/Skin0.bin"
        ]
    );
}

#[test]
fn modded_champions_stand_in_for_every_other_skin_of_a_champion_a_mod_reskins() {
    let game = tempfile::tempdir().unwrap();
    build_wad(
        &champions_dir(game.path()).join("Ahri.wad.client"),
        &[&skin("ahri", 0), &skin("ahri", 1), &skin("ahri", 86)],
    );
    build_wad(
        &champions_dir(game.path()).join("Annie.wad.client"),
        &[&skin("annie", 0), &skin("annie", 1)],
    );
    let skin_mod = tempfile::tempdir().unwrap();
    write_base_skin_mod(skin_mod.path(), "Ahri.wad.client", "ahri");
    let builtin = tempfile::tempdir().unwrap();

    let files = modded_champions(
        game.path(),
        builtin.path(),
        &mut [fs_mod("ahri", skin_mod.path())],
    );

    assert_eq!(
        files,
        [
            stand_in("Ahri.wad.client", &skin("ahri", 1), MOD),
            stand_in("Ahri.wad.client", &skin("ahri", 86), MOD),
        ]
    );
}

#[test]
fn modded_champions_leave_a_skin_another_mod_ships() {
    let game = tempfile::tempdir().unwrap();
    build_wad(
        &champions_dir(game.path()).join("Ahri.wad.client"),
        &[&skin("ahri", 0), &skin("ahri", 1), &skin("ahri", 7)],
    );
    let base_mod = tempfile::tempdir().unwrap();
    write_base_skin_mod(base_mod.path(), "Ahri.wad.client", "ahri");
    let skin7_mod = tempfile::tempdir().unwrap();
    write_mod_with(
        skin7_mod.path(),
        &[("Ahri.wad.client", &skin("ahri", 7))],
        b"PROP of a mod",
    );
    let builtin = tempfile::tempdir().unwrap();

    let files = modded_champions(
        game.path(),
        builtin.path(),
        &mut [
            fs_mod("base", base_mod.path()),
            fs_mod("skin7", skin7_mod.path()),
        ],
    );

    assert_eq!(files, [stand_in("Ahri.wad.client", &skin("ahri", 1), MOD)]);
}

#[test]
fn modded_champions_stand_in_for_a_skin_a_mod_ships_unchanged() {
    let game = tempfile::tempdir().unwrap();
    build_wad(
        &champions_dir(game.path()).join("Ahri.wad.client"),
        &[&skin("ahri", 0), &skin("ahri", 1), &skin("ahri", 2)],
    );
    let base_mod = tempfile::tempdir().unwrap();
    write_base_skin_mod(base_mod.path(), "Ahri.wad.client", "ahri");
    let unchanged = tempfile::tempdir().unwrap();
    write_mod_with(
        unchanged.path(),
        &[("Ahri.wad.client", &skin("ahri", 1))],
        b"PROP",
    );
    let builtin = tempfile::tempdir().unwrap();

    let files = modded_champions(
        game.path(),
        builtin.path(),
        &mut [
            fs_mod("base", base_mod.path()),
            fs_mod("unchanged", unchanged.path()),
        ],
    );

    assert_eq!(
        files,
        [
            stand_in("Ahri.wad.client", &skin("ahri", 1), MOD),
            stand_in("Ahri.wad.client", &skin("ahri", 2), MOD),
        ]
    );
}

#[test]
fn modded_champions_take_in_no_champion_whose_base_skin_a_mod_ships_unchanged() {
    let game = tempfile::tempdir().unwrap();
    build_wad(
        &champions_dir(game.path()).join("Ahri.wad.client"),
        &[&skin("ahri", 0), &skin("ahri", 1)],
    );
    let unchanged = tempfile::tempdir().unwrap();
    write_mod_with(
        unchanged.path(),
        &[("Ahri.wad.client", &skin("ahri", 0))],
        &skin0_bin("ahri", GAME),
    );
    let builtin = tempfile::tempdir().unwrap();

    let files = modded_champions(
        game.path(),
        builtin.path(),
        &mut [fs_mod("unchanged", unchanged.path())],
    );

    assert_eq!(files, []);
}

#[test]
fn modded_champions_leave_a_champion_whose_base_skin_does_not_read() {
    let game = tempfile::tempdir().unwrap();
    build_wad(
        &champions_dir(game.path()).join("Ahri.wad.client"),
        &[&skin("ahri", 0), &skin("ahri", 1)],
    );
    let broken = tempfile::tempdir().unwrap();
    write_mod_with(
        broken.path(),
        &[("Ahri.wad.client", &skin("ahri", 0))],
        b"not a bin",
    );
    let builtin = tempfile::tempdir().unwrap();

    let files = modded_champions(
        game.path(),
        builtin.path(),
        &mut [fs_mod("broken", broken.path())],
    );

    assert_eq!(files, []);
}

#[test]
fn modded_champions_name_a_hashed_base_skin_by_the_champion_archives() {
    let game = tempfile::tempdir().unwrap();
    build_wad(
        &champions_dir(game.path()).join("Ahri.wad.client"),
        &[&skin("ahri", 0), &skin("ahri", 1)],
    );
    let skin_mod = tempfile::tempdir().unwrap();
    let hashed = format!("{:016x}.bin", WadHash::from(skin("ahri", 0).as_str()).0);
    write_mod_with(
        skin_mod.path(),
        &[("Ahri.wad.client", &hashed)],
        &skin0_bin("ahri", MOD),
    );
    let builtin = tempfile::tempdir().unwrap();

    let files = modded_champions(
        game.path(),
        builtin.path(),
        &mut [fs_mod("ahri", skin_mod.path())],
    );

    assert_eq!(files, [stand_in("Ahri.wad.client", &skin("ahri", 1), MOD)]);
}

#[test]
fn modded_champions_follow_a_named_character_the_champion_archive_carries() {
    let game = tempfile::tempdir().unwrap();
    build_wad(
        &champions_dir(game.path()).join("Annie.wad.client"),
        &[
            &skin("annie", 0),
            &skin("annie", 1),
            &skin("annietibbers", 0),
            &skin("annietibbers", 1),
        ],
    );
    let skin_mod = tempfile::tempdir().unwrap();
    write_mod_with(
        skin_mod.path(),
        &[(
            "Annie.wad.client",
            "DATA/Characters/AnnieTibbers/Skins/Skin0.bin",
        )],
        &skin0_bin("annietibbers", MOD),
    );
    let builtin = tempfile::tempdir().unwrap();

    let files = modded_champions(
        game.path(),
        builtin.path(),
        &mut [fs_mod("tibbers", skin_mod.path())],
    );

    assert_eq!(
        files,
        [stand_in("Annie.wad.client", &skin("annietibbers", 1), MOD)]
    );
}

#[test]
fn modded_champions_pass_over_a_layer_the_profile_turned_off() {
    let game = tempfile::tempdir().unwrap();
    build_wad(
        &champions_dir(game.path()).join("Ahri.wad.client"),
        &[&skin("ahri", 0), &skin("ahri", 1)],
    );
    let skin_mod = tempfile::tempdir().unwrap();
    write_mod_with(skin_mod.path(), &[], b"");
    let config_path = skin_mod.path().join("mod.config.json");
    let mut config: ltk_mod_project::ModProject =
        serde_json::from_slice(&fs::read(&config_path).unwrap()).unwrap();
    config.layers.push(ltk_mod_project::ModProjectLayer {
        name: "extra".to_owned(),
        priority: 1,
        ..Default::default()
    });
    fs::write(&config_path, serde_json::to_vec(&config).unwrap()).unwrap();
    let extra = skin_mod
        .path()
        .join("content")
        .join("extra")
        .join("Ahri.wad.client");
    fs::create_dir_all(extra.join("data/characters/ahri/skins")).unwrap();
    fs::write(extra.join(skin("ahri", 0)), skin0_bin("ahri", MOD)).unwrap();
    let builtin = tempfile::tempdir().unwrap();
    let mut layered = fs_mod("layered", skin_mod.path());
    layered.enabled_layers = Some(["base".to_owned()].into());

    let files = modded_champions(game.path(), builtin.path(), &mut [layered]);

    assert_eq!(files, []);
}

#[test]
fn modded_champions_leave_archives_outside_the_champions_alone() {
    let game = tempfile::tempdir().unwrap();
    build_wad(
        &maps_dir(game.path()).join("Map11.wad.client"),
        &[&skin("ahri", 0), &skin("ahri", 1)],
    );
    build_wad(
        &champions_dir(game.path()).join("Ahri.en_US.wad.client"),
        &[&skin("ahri", 1)],
    );
    let skin_mod = tempfile::tempdir().unwrap();
    write_base_skin_mod(skin_mod.path(), "Ahri.wad.client", "ahri");
    let builtin = tempfile::tempdir().unwrap();

    let files = modded_champions(
        game.path(),
        builtin.path(),
        &mut [fs_mod("ahri", skin_mod.path())],
    );

    assert_eq!(files, []);
}

#[test]
fn all_champions_stand_in_for_every_skin_past_the_base_the_champion_archives_hold() {
    let game = tempfile::tempdir().unwrap();
    build_wad(
        &champions_dir(game.path()).join("Ahri.wad.client"),
        &[&skin("ahri", 0), &skin("ahri", 1), &skin("ahri", 2)],
    );
    build_wad(
        &champions_dir(game.path()).join("Annie.wad.client"),
        &[
            &skin("annie", 0),
            &skin("annie", 1),
            &skin("annietibbers", 0),
            &skin("annietibbers", 1),
        ],
    );
    let tables = Tables::naming(&[skin("annietibbers", 0), skin("annietibbers", 1)]);
    let builtin = tempfile::tempdir().unwrap();

    let files = base_skins(
        game.path(),
        builtin.path(),
        Champions::All,
        &tables,
        &mut [],
    );

    assert_eq!(
        stand_ins(&files),
        [
            stand_in("Ahri.wad.client", &skin("ahri", 1), GAME),
            stand_in("Ahri.wad.client", &skin("ahri", 2), GAME),
            stand_in("Annie.wad.client", &skin("annie", 1), GAME),
            stand_in("Annie.wad.client", &skin("annietibbers", 1), GAME),
        ]
    );
}

#[test]
fn all_champions_leave_a_character_with_no_base_skin() {
    let game = tempfile::tempdir().unwrap();
    build_wad(
        &champions_dir(game.path()).join("Annie.wad.client"),
        &[&skin("annie", 0), &skin("annieguardian", 3)],
    );
    let tables = Tables::naming(&[skin("annieguardian", 3)]);
    let builtin = tempfile::tempdir().unwrap();

    let files = base_skins(
        game.path(),
        builtin.path(),
        Champions::All,
        &tables,
        &mut [],
    );

    assert_eq!(files, []);
}

#[test]
fn all_champions_take_a_mod_s_base_skin_and_leave_a_skin_a_mod_ships() {
    let game = tempfile::tempdir().unwrap();
    build_wad(
        &champions_dir(game.path()).join("Ahri.wad.client"),
        &[&skin("ahri", 0), &skin("ahri", 1), &skin("ahri", 2)],
    );
    let base_mod = tempfile::tempdir().unwrap();
    write_base_skin_mod(base_mod.path(), "Ahri.wad.client", "ahri");
    let skin2_mod = tempfile::tempdir().unwrap();
    write_mod_with(
        skin2_mod.path(),
        &[("Ahri.wad.client", &skin("ahri", 2))],
        b"PROP of a mod",
    );
    let builtin = tempfile::tempdir().unwrap();

    let files = base_skins(
        game.path(),
        builtin.path(),
        Champions::All,
        &Tables::default(),
        &mut [
            fs_mod("base", base_mod.path()),
            fs_mod("skin2", skin2_mod.path()),
        ],
    );

    assert_eq!(
        stand_ins(&files),
        [stand_in("Ahri.wad.client", &skin("ahri", 1), MOD)]
    );
}

/// An [`FsModContent`] that counts the archive directories read out of it.
struct CountingReads {
    inner: FsModContent,
    reads: Arc<AtomicUsize>,
}

impl ltk_overlay::ModContentProvider for CountingReads {
    fn mod_project(&mut self) -> ltk_overlay::Result<ltk_mod_project::ModProject> {
        self.inner.mod_project()
    }

    fn list_layer_wads(&mut self, layer: &str) -> ltk_overlay::Result<Vec<String>> {
        self.inner.list_layer_wads(layer)
    }

    fn read_wad_overrides(
        &mut self,
        layer: &str,
        wad_name: &str,
    ) -> ltk_overlay::Result<Vec<(camino::Utf8PathBuf, Vec<u8>)>> {
        self.reads.fetch_add(1, Ordering::Relaxed);
        self.inner.read_wad_overrides(layer, wad_name)
    }

    fn content_fingerprint(&self) -> ltk_overlay::Result<Option<u64>> {
        self.inner.content_fingerprint()
    }

    fn read_wad_override_file(
        &mut self,
        layer: &str,
        wad_name: &str,
        rel_path: &camino::Utf8Path,
    ) -> ltk_overlay::Result<Vec<u8>> {
        self.inner.read_wad_override_file(layer, wad_name, rel_path)
    }

    fn read_raw_override_file(
        &mut self,
        rel_path: &camino::Utf8Path,
    ) -> ltk_overlay::Result<Vec<u8>> {
        self.inner.read_raw_override_file(rel_path)
    }
}

fn counting_mod(id: &str, dir: &Path, reads: &Arc<AtomicUsize>) -> EnabledMod {
    EnabledMod {
        id: id.to_owned(),
        content: Box::new(CountingReads {
            inner: FsModContent::new(dir.to_path_buf().try_into().unwrap()),
            reads: Arc::clone(reads),
        }),
        enabled_layers: None,
    }
}

#[test]
fn base_skins_read_a_mod_again_only_once_its_content_changes() {
    let game = tempfile::tempdir().unwrap();
    build_wad(
        &champions_dir(game.path()).join("Ahri.wad.client"),
        &[&skin("ahri", 0), &skin("ahri", 1), &skin("ahri", 2)],
    );
    let skin_mod = tempfile::tempdir().unwrap();
    write_base_skin_mod(skin_mod.path(), "Ahri.wad.client", "ahri");
    let builtin = tempfile::tempdir().unwrap();
    let reads = Arc::new(AtomicUsize::new(0));

    modded_champions(
        game.path(),
        builtin.path(),
        &mut [counting_mod("ahri", skin_mod.path(), &reads)],
    );
    let files = modded_champions(
        game.path(),
        builtin.path(),
        &mut [counting_mod("ahri", skin_mod.path(), &reads)],
    );

    assert_eq!(reads.load(Ordering::Relaxed), 1);
    assert_eq!(
        files,
        [
            stand_in("Ahri.wad.client", &skin("ahri", 1), MOD),
            stand_in("Ahri.wad.client", &skin("ahri", 2), MOD),
        ]
    );

    let mut overrides = Overrides::default();
    overrides.insert("Ahri.wad.client", &skin("ahri", 0), skin0_bin("ahri", MOD));
    overrides.insert(
        "Ahri.wad.client",
        &skin("ahri", 2),
        b"PROP of a mod".as_slice(),
    );
    overrides.write(skin_mod.path(), "mod", "Mod").unwrap();
    let files = modded_champions(
        game.path(),
        builtin.path(),
        &mut [counting_mod("ahri", skin_mod.path(), &reads)],
    );

    assert_eq!(reads.load(Ordering::Relaxed), 2);
    assert_eq!(files, [stand_in("Ahri.wad.client", &skin("ahri", 1), MOD)]);
}

#[test]
fn base_skins_keep_what_a_mod_ships_while_another_profile_builds() {
    let game = tempfile::tempdir().unwrap();
    build_wad(
        &champions_dir(game.path()).join("Ahri.wad.client"),
        &[&skin("ahri", 0), &skin("ahri", 1)],
    );
    let first = tempfile::tempdir().unwrap();
    write_base_skin_mod(first.path(), "Ahri.wad.client", "ahri");
    let second = tempfile::tempdir().unwrap();
    write_mod_with(second.path(), &[], b"");
    let builtin = tempfile::tempdir().unwrap();
    let reads = Arc::new(AtomicUsize::new(0));

    for id in ["first", "second", "first"] {
        let dir = if id == "first" { &first } else { &second };
        modded_champions(
            game.path(),
            builtin.path(),
            &mut [counting_mod(id, dir.path(), &reads)],
        );
    }

    assert_eq!(reads.load(Ordering::Relaxed), 1);
}

#[test]
fn a_skin_bin_reads_back_from_its_path() {
    assert_eq!(
        SkinBin::parse("DATA\\Characters\\Ahri\\Skins\\Skin12.bin"),
        Some(SkinBin::new("ahri", 12))
    );
    assert_eq!(
        SkinBin::parse(&skin("ahri", 0)),
        Some(SkinBin::new("ahri", 0))
    );
    assert_eq!(
        SkinBin::parse("data/characters/ahri/skins/skin01.bin"),
        None
    );
    assert_eq!(
        SkinBin::parse("data/characters/ahri/skins/skin1.bin.bak"),
        None
    );
    assert_eq!(
        SkinBin::parse("data/characters/ahri/skins/base/skin1.bin"),
        None
    );
    assert_eq!(SkinBin::parse("data/characters/ahri/ahri.bin"), None);
}
