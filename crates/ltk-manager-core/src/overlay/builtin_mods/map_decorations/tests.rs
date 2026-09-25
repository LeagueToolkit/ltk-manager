//! Unit tests for the map decorations built-in mod.

use super::super::{Context, MapDecoration, map_decorations};
use super::*;
use crate::utils::game::GameDir;
use fs_err as fs;
use ltk_game_data::{
    ApplyDiagnosticKind, EntryName, NoSchema, OverridePath, Selector, apply, load_declarations,
};
use ltk_meta::BinObject;
use ltk_meta::property::values;
use ltk_wad::{PathResolver, WadBuilder, WadChunkBuilder, WadHash};
use std::collections::HashMap;
use std::io::{Cursor, Write as _};
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};

const MATERIALS: &str = "data/maps/mapgeometry/map11/base_srx.materials.bin";
const MAPGEO: &str = "data/maps/mapgeometry/map11/base_srx.mapgeo";
/// What the stand-in rewrite reads as a map with a Hall of Legends mesh to move.
const WITH_STATUE: &[u8] = b"OEGM with a statue";
const HALL_OF_LEGENDS: BinHash = BinHash(0x76c5_0391);
const TROPHY: BinHash = BinHash(0x8f1a_b207);

struct NoTables;

impl PathResolver for NoTables {
    fn resolve(&self, _: WadHash) -> Option<String> {
        None
    }
}

fn bin_bytes(objects: Vec<BinObject>) -> Vec<u8> {
    let mut bin = Bin::default();
    for object in objects {
        bin.objects.insert(object.path_hash, object);
    }
    let mut bytes = Cursor::new(Vec::new());
    bin.to_writer(&mut bytes).unwrap();
    bytes.into_inner()
}

/// A `Map11` bin whose one skin draws with the `Base_SRX` container.
fn map_bin() -> Vec<u8> {
    let skin = BinObject::builder(
        BinHash::from("Maps/Shipping/Map11/MapSkins/Default"),
        BinHash::from("MapSkin"),
    )
    .property(BinHash::from("name"), values::String::from("Default"))
    .property(
        BinHash::from("mMapContainerLink"),
        values::String::from("Maps/MapGeometry/Map11/Base_SRX"),
    )
    .build();
    let map = BinObject::builder(BinHash::from("Maps/Shipping/Map11"), BinHash::from("Map"))
        .property(
            BinHash::from("mapSkins"),
            values::UnorderedContainer(values::Container::from(vec![values::ObjectLink::new(
                skin.path_hash,
            )])),
        )
        .build();
    bin_bytes(vec![skin, map])
}

fn controller(hash: BinHash, mutator: &str) -> BinObject {
    BinObject::builder(hash, BinHash::from(MUTATOR_CONTROLLER))
        .property(BinHash::from(MUTATOR_NAME), values::String::from(mutator))
        .build()
}

/// The `Base_SRX` materials, with the two mutator controllers the shipped one names and a
/// controller of another class.
fn materials_bin() -> Vec<u8> {
    let child = BinObject::builder(
        BinHash(0x0c21_0e40),
        BinHash::from("ChildMapVisibilityController"),
    )
    .build();
    bin_bytes(vec![
        controller(HALL_OF_LEGENDS, "SR_Hall_Of_Legends"),
        controller(TROPHY, "MSITrophy"),
        child,
    ])
}

fn build_wad(path: &Path, chunks: &[(&str, Vec<u8>)]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let mut builder = WadBuilder::default();
    let mut contents = HashMap::new();
    for (chunk_path, bytes) in chunks {
        builder = builder.with_chunk(WadChunkBuilder::default().with_path(*chunk_path));
        contents.insert(WadHash::from(*chunk_path), bytes.clone());
    }
    let mut file = fs::File::create(path).unwrap();
    builder
        .build_to_writer(&mut file, |path_hash, cursor| {
            cursor.write_all(&contents[&path_hash])?;
            Ok(())
        })
        .unwrap();
}

fn game() -> tempfile::TempDir {
    let game = tempfile::tempdir().unwrap();
    build_wad(
        &game
            .path()
            .join("DATA")
            .join("FINAL")
            .join("Maps")
            .join("Shipping")
            .join("Map11.wad.client"),
        &[
            ("data/maps/shipping/map11/map11.bin", map_bin()),
            (MATERIALS, materials_bin()),
            (MAPGEO, WITH_STATUE.to_vec()),
        ],
    );
    game
}

/// Calls of [`stand_in`], which tests read to see whether a cached rewrite was reused.
static REWRITES: AtomicUsize = AtomicUsize::new(0);

/// A rewrite that moves something only in [`WITH_STATUE`], and says what it was asked.
fn stand_in(bytes: &[u8], controller: u32, prefix: &str) -> AppResult<Option<Vec<u8>>> {
    REWRITES.fetch_add(1, Ordering::SeqCst);
    Ok((bytes == WITH_STATUE).then(|| format!("moved {controller:08x} {prefix}").into_bytes()))
}

/// What the mod generates for `settings` with the stand-in rewrite, caching in `project`.
fn generate_in(game: &Path, project: &Path, settings: &BuiltinModSettings) -> Overrides {
    let decorations = MapDecorations {
        rewrite: stand_in,
        ..MapDecorations::of(settings).unwrap()
    };
    decorations
        .generate(&mut Context {
            game_dir: &GameDir::from_path(game),
            tables: &NoTables,
            mods: &mut [],
            cache_dir: project,
        })
        .unwrap()
}

fn copies(overrides: &Overrides) -> Vec<(String, Vec<u8>)> {
    overrides
        .copies()
        .map(|(path, source)| (path.as_str().replace('\\', "/"), fs::read(source).unwrap()))
        .collect()
}

fn settings(modes: &[(&str, MapDecorationMode)]) -> BuiltinModSettings {
    BuiltinModSettings {
        map_decorations: modes
            .iter()
            .map(|(mutator, mode)| ((*mutator).to_owned(), *mode))
            .collect(),
        ..BuiltinModSettings::default()
    }
}

fn generate(game: &Path, settings: &BuiltinModSettings) -> Overrides {
    let cache = tempfile::tempdir().unwrap();
    MapDecorations::of(settings)
        .unwrap()
        .generate(&mut Context {
            game_dir: &GameDir::from_path(game),
            tables: &NoTables,
            mods: &mut [],
            cache_dir: cache.path(),
        })
        .unwrap()
}

#[test]
fn no_mode_set_turns_no_mod_on() {
    assert!(MapDecorations::of(&BuiltinModSettings::default()).is_none());
}

#[test]
fn a_hidden_decoration_names_a_key_no_game_applies() {
    let game = game();

    let overrides = generate(
        game.path(),
        &settings(&[("SR_Hall_Of_Legends", MapDecorationMode::Hide)]),
    );

    assert_eq!(
        overrides.declarations().unwrap(),
        format!(
            "version: 1\nmodules:\n  - target: \"{MATERIALS}\"\n    \"0x76c50391\":\n      MutatorName: \"LTK_MapDecorationHidden\"\n"
        )
    );
}

#[test]
fn a_shown_decoration_names_a_key_every_game_applies() {
    let game = game();

    let overrides = generate(
        game.path(),
        &settings(&[("MSITrophy", MapDecorationMode::Show)]),
    );

    let text = overrides.declarations().unwrap();
    assert!(
        text.contains("\"0x8f1ab207\":\n      MutatorName: \"HudSkin\""),
        "{text}"
    );
    assert!(!text.contains("0x76c50391"), "{text}");
}

#[test]
fn a_mode_matches_its_mutator_without_case() {
    let game = game();

    let overrides = generate(
        game.path(),
        &settings(&[("sr_hall_of_legends", MapDecorationMode::Hide)]),
    );

    assert!(overrides.declarations().unwrap().contains("0x76c50391"));
}

/// Story: the declaration only helps if the overlay's apply turns it into a controller that
/// names the fixed key.
#[test]
fn an_applied_declaration_renames_the_controllers_mutator() {
    let game = game();
    let overrides = generate(
        game.path(),
        &settings(&[
            ("SR_Hall_Of_Legends", MapDecorationMode::Hide),
            ("MSITrophy", MapDecorationMode::Show),
        ]),
    );
    let declarations = load_declarations(
        "game_data.yaml",
        &overrides.declarations().unwrap(),
        |_| unreachable!(),
    )
    .unwrap();
    let Selector::Target { edits, .. } = &declarations.modules[0].selector else {
        panic!("expected a target module");
    };

    let output = apply(
        &materials_bin(),
        edits,
        |_: &OverridePath| -> Result<Vec<u8>, ltk_game_data::Error> { unreachable!() },
        |_: &EntryName| Ok(None),
        &NoSchema,
    )
    .unwrap();

    // With no schema, the base value types the property, and apply says so.
    let refused: Vec<_> = output
        .diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.kind != ApplyDiagnosticKind::SchemaFallback)
        .collect();
    assert!(refused.is_empty(), "{refused:#?}");
    let bin = Bin::from_reader(&mut Cursor::new(&output.bytes)).unwrap();
    let mutator = |hash: BinHash| {
        mutator_controllers(&bin)
            .into_iter()
            .find(|controller| controller.entry == format!("0x{:08x}", hash.0))
            .unwrap()
            .mutator
    };
    assert_eq!(mutator(HALL_OF_LEGENDS), "LTK_MapDecorationHidden");
    assert_eq!(mutator(TROPHY), "HudSkin");
}

#[test]
fn the_decorations_are_every_mutator_a_container_switches_by() {
    let game = game();

    let decorations = map_decorations(&GameDir::from_path(game.path())).unwrap();

    assert_eq!(
        decorations,
        [
            MapDecoration {
                mutator: "MSITrophy".to_owned(),
                maps: vec!["Map11.wad.client".to_owned()],
            },
            MapDecoration {
                mutator: "SR_Hall_Of_Legends".to_owned(),
                maps: vec!["Map11.wad.client".to_owned()],
            },
        ]
    );
}

// The mapgeo tests share `REWRITES`, so each counts the calls its own generation made.
static SERIAL: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[test]
fn a_hidden_hall_of_legends_moves_its_baked_meshes() {
    let _serial = SERIAL.lock().unwrap();
    let game = game();
    let project = tempfile::tempdir().unwrap();

    let overrides = generate_in(
        game.path(),
        project.path(),
        &settings(&[("SR_Hall_Of_Legends", MapDecorationMode::Hide)]),
    );

    assert_eq!(
        copies(&overrides),
        [(
            format!("Map11.wad.client/{MAPGEO}"),
            b"moved 76c50391 hol_".to_vec()
        )]
    );
}

#[test]
fn a_rewritten_mapgeo_is_reused_until_the_game_changes_it() {
    let _serial = SERIAL.lock().unwrap();
    let game = game();
    let project = tempfile::tempdir().unwrap();
    let hidden = settings(&[("SR_Hall_Of_Legends", MapDecorationMode::Hide)]);
    generate_in(game.path(), project.path(), &hidden);
    let before = REWRITES.load(Ordering::SeqCst);

    let overrides = generate_in(game.path(), project.path(), &hidden);

    assert_eq!(REWRITES.load(Ordering::SeqCst), before);
    assert_eq!(copies(&overrides).len(), 1);
}

#[test]
fn a_mapgeo_with_nothing_to_move_is_read_once_and_not_copied() {
    let _serial = SERIAL.lock().unwrap();
    let game = tempfile::tempdir().unwrap();
    build_wad(
        &game
            .path()
            .join("DATA")
            .join("FINAL")
            .join("Maps")
            .join("Shipping")
            .join("Map11.wad.client"),
        &[
            ("data/maps/shipping/map11/map11.bin", map_bin()),
            (MATERIALS, materials_bin()),
            (MAPGEO, b"OEGM with no statue".to_vec()),
        ],
    );
    let project = tempfile::tempdir().unwrap();
    let hidden = settings(&[("SR_Hall_Of_Legends", MapDecorationMode::Hide)]);
    let first = generate_in(game.path(), project.path(), &hidden);
    let before = REWRITES.load(Ordering::SeqCst);

    let second = generate_in(game.path(), project.path(), &hidden);

    assert_eq!(copies(&first), []);
    assert_eq!(copies(&second), []);
    assert_eq!(REWRITES.load(Ordering::SeqCst), before);
}

#[test]
fn a_shown_or_undecorated_mutator_moves_no_mesh() {
    let _serial = SERIAL.lock().unwrap();
    let game = game();
    let project = tempfile::tempdir().unwrap();

    let shown = generate_in(
        game.path(),
        project.path(),
        &settings(&[("SR_Hall_Of_Legends", MapDecorationMode::Show)]),
    );
    let trophy = generate_in(
        game.path(),
        project.path(),
        &settings(&[("MSITrophy", MapDecorationMode::Hide)]),
    );

    assert_eq!(copies(&shown), []);
    assert_eq!(copies(&trophy), []);
}

#[test]
fn a_rewrite_no_longer_used_leaves_the_cache() {
    let _serial = SERIAL.lock().unwrap();
    let game = game();
    let project = tempfile::tempdir().unwrap();
    let stale = project
        .path()
        .join(MAPGEO_CACHE)
        .join("0000000000000000-76c50391-hol_-v1.mapgeo");
    fs::create_dir_all(stale.parent().unwrap()).unwrap();
    fs::write(&stale, b"an older patch").unwrap();

    generate_in(
        game.path(),
        project.path(),
        &settings(&[("SR_Hall_Of_Legends", MapDecorationMode::Hide)]),
    );

    assert!(!stale.exists());
}

/// Story: a copied `.mapgeo` is about 90 MB, so a rewrite that did not change must leave the
/// project's file, and the overlay's fingerprint with it, as it was.
#[test]
fn an_unchanged_copy_keeps_its_file() {
    let project = tempfile::tempdir().unwrap();
    let source = project.path().join("source.mapgeo");
    fs::write(&source, b"moved").unwrap();
    let mut overrides = Overrides::default();
    overrides.insert_copy("Map11.wad.client", MAPGEO, source.clone());
    overrides
        .write(project.path(), "map-decorations", "Map decorations")
        .unwrap();
    let copy = project
        .path()
        .join("content")
        .join("base")
        .join("Map11.wad.client")
        .join(MAPGEO);
    let long_ago = filetime::FileTime::from_unix_time(1_000_000_000, 0);
    filetime::set_file_mtime(&source, long_ago).unwrap();
    filetime::set_file_mtime(&copy, long_ago).unwrap();

    overrides
        .write(project.path(), "map-decorations", "Map decorations")
        .unwrap();

    let modified = filetime::FileTime::from_last_modification_time(&fs::metadata(&copy).unwrap());
    assert_eq!(modified, long_ago);

    fs::write(&source, b"moved again").unwrap();
    overrides
        .write(project.path(), "map-decorations", "Map decorations")
        .unwrap();
    assert_eq!(fs::read(&copy).unwrap(), b"moved again");
}

#[test]
fn a_mapgeo_the_rewrite_fails_on_is_left_as_it_ships() {
    let game = game();

    let overrides = generate(
        game.path(),
        &settings(&[("SR_Hall_Of_Legends", MapDecorationMode::Hide)]),
    );

    assert_eq!(copies(&overrides), []);
    assert!(overrides.declarations().unwrap().contains("0x76c50391"));
}
