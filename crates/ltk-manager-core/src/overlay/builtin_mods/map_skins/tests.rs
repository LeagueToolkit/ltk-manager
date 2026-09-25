//! Unit tests for the map skins built-in mod.

use super::super::{Context, ForcibleMapSkin, forcible_map_skins, inject};
use super::*;
use crate::meta_schema::{MetaSchema, PatchSchema};
use crate::utils::game::GameDir;
use fs_err as fs;
use ltk_game_data::{
    ApplyDiagnosticKind, EntryName, OverridePath, Selector, apply, load_declarations,
};
use ltk_meta::property::values;
use ltk_meta::{Bin, BinObject};
use ltk_overlay::ModContentProvider as _;
use ltk_wad::{PathResolver, WadBuilder, WadChunkBuilder, WadHash};
use std::collections::HashMap;
use std::io::{Cursor, Write as _};
use std::path::{Path, PathBuf};
use std::sync::Arc;

const MAP11_BIN: &str = "data/maps/shipping/map11/map11.bin";

/// WAD path tables naming nothing, which reading a map needs none of.
struct NoTables;

impl PathResolver for NoTables {
    fn resolve(&self, _: WadHash) -> Option<String> {
        None
    }
}

fn h(name: &str) -> BinHash {
    BinHash::from(name)
}

fn skin_entry(map: &str, name: &str) -> String {
    format!("Maps/Shipping/{map}/MapSkins/{name}")
}

fn string(text: &str) -> PropertyValueEnum {
    values::String::from(text).into()
}

fn file(path: &str) -> PropertyValueEnum {
    values::WadChunkLink::new(WadHash::from(path).0).into()
}

fn pointer(class: BinHash, field: &str, value: f32) -> PropertyValueEnum {
    values::Struct {
        class_hash: class,
        properties: [(h(field), values::F32::new(value).into())]
            .into_iter()
            .collect(),
    }
    .into()
}

fn embed(class: BinHash, field: &str, text: &str) -> PropertyValueEnum {
    values::Embedded(values::Struct {
        class_hash: class,
        properties: [(h(field), string(text))].into_iter().collect(),
    })
    .into()
}

fn links(entries: &[String]) -> PropertyValueEnum {
    values::Container::from(
        entries
            .iter()
            .map(|entry| values::ObjectLink::new(h(entry)))
            .collect::<Vec<_>>(),
    )
    .into()
}

const GAMMA: BinHash = BinHash(0x7CD4_F88A);
const ALTERNATE_ASSETS: BinHash = BinHash(0x32A5_F174);
const COLORIZATION: BinHash = BinHash(0x38F1_6A3E);

fn map_skin(map: &str, name: &str, properties: Vec<(&str, PropertyValueEnum)>) -> BinObject {
    let mut builder = BinObject::builder(h(&skin_entry(map, name)), h("MapSkin"))
        .property(h("name"), values::String::from(name));
    for (field, value) in properties {
        builder = builder.property(h(field), value);
    }
    builder.build()
}

/// A `Map11` bin shaped like the shipped one: `Default`, an event skin differing in a few
/// environment properties, one carrying a property `Default` lacks and lacking two it has,
/// one with no container of its own, and one the map does not link.
fn map11_bin() -> Vec<u8> {
    let resolvers = links(&[format!("{}/Resources", skin_entry("Map11", "Default"))]);
    let skins = vec![
        map_skin(
            "Map11",
            "Default",
            vec![
                (
                    "mMapContainerLink",
                    string("Maps/MapGeometry/Map11/Base_SRX"),
                ),
                ("mNavigationMesh", string("nav/default")),
                ("mGrassTintTexture", file("grass/default.tex")),
                ("GammaParameters", pointer(GAMMA, "gamma", 1.0)),
                (
                    "mAlternateAssets",
                    embed(ALTERNATE_ASSETS, "set", "default"),
                ),
                ("mResourceResolvers", resolvers.clone()),
            ],
        ),
        map_skin(
            "Map11",
            "Bloom",
            vec![
                ("mMapContainerLink", string("Maps/MapGeometry/Map11/Bloom")),
                ("mNavigationMesh", string("nav/default")),
                ("mWorldParticlesINI", string("bloom.ini")),
                ("mGrassTintTexture", file("grass/bloom.tex")),
                ("GammaParameters", pointer(GAMMA, "gamma", 1.0)),
                (
                    "mAlternateAssets",
                    embed(ALTERNATE_ASSETS, "set", "default"),
                ),
                ("mResourceResolvers", resolvers.clone()),
            ],
        ),
        map_skin(
            "Map11",
            "Ruby_SR",
            vec![
                ("mMapContainerLink", string("Maps/MapGeometry/Map11/Ruby")),
                ("mNavigationMesh", string("nav/ruby")),
                ("mGrassTintTexture", file("grass/default.tex")),
                (
                    "mColorizationPostEffect",
                    pointer(COLORIZATION, "strength", 0.5),
                ),
                ("mResourceResolvers", resolvers.clone()),
            ],
        ),
        map_skin(
            "Map11",
            "Odyssey",
            vec![
                ("mNavigationMesh", string("nav/odyssey")),
                ("mGrassTintTexture", file("grass/default.tex")),
                ("GammaParameters", pointer(GAMMA, "gamma", 1.0)),
                (
                    "mAlternateAssets",
                    embed(ALTERNATE_ASSETS, "set", "default"),
                ),
                ("mResourceResolvers", resolvers),
            ],
        ),
    ];
    let unlinked = map_skin("Map11", "SR_Seasonal_Map", Vec::new());
    let PropertyValueEnum::Container(linked) =
        links(&["Default", "Bloom", "Ruby_SR", "Odyssey"].map(|name| skin_entry("Map11", name)))
    else {
        unreachable!()
    };
    let map = BinObject::builder(h("Maps/Shipping/Map11"), h("Map"))
        .property(h("mapSkins"), values::UnorderedContainer(linked))
        .build();

    let mut bin = Bin::default();
    for object in skins.into_iter().chain([unlinked, map]) {
        bin.objects.insert(object.path_hash, object);
    }
    let mut bytes = Cursor::new(Vec::new());
    bin.to_writer(&mut bytes).unwrap();
    bytes.into_inner()
}

/// The chunks of each container `map11_bin` names but `Odyssey`, which names none.
fn containers() -> Vec<(String, Vec<u8>)> {
    ["base_srx", "bloom", "ruby"]
        .iter()
        .flat_map(|container| {
            ["mapgeo", "materials.bin"].map(|extension| {
                (
                    format!("data/maps/mapgeometry/map11/{container}.{extension}"),
                    b"OEGM".to_vec(),
                )
            })
        })
        .collect()
}

fn maps_dir(game: &Path) -> PathBuf {
    game.join("DATA")
        .join("FINAL")
        .join("Maps")
        .join("Shipping")
}

/// A game archive at `path` holding each chunk with its bytes.
fn build_wad(path: &Path, chunks: &[(String, Vec<u8>)]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let mut builder = WadBuilder::default();
    let mut contents = HashMap::new();
    for (chunk_path, bytes) in chunks {
        builder = builder.with_chunk(WadChunkBuilder::default().with_path(chunk_path));
        contents.insert(WadHash::from(chunk_path.as_str()), bytes.clone());
    }
    let mut file = fs::File::create(path).unwrap();
    builder
        .build_to_writer(&mut file, |path_hash, cursor| {
            cursor.write_all(&contents[&path_hash])?;
            Ok(())
        })
        .unwrap();
}

/// A game whose `Map11` archive holds `map11_bin` and its containers.
fn game() -> tempfile::TempDir {
    let game = tempfile::tempdir().unwrap();
    let mut chunks = containers();
    chunks.push((MAP11_BIN.to_owned(), map11_bin()));
    build_wad(&maps_dir(game.path()).join("Map11.wad.client"), &chunks);
    game
}

fn settings(map_skin: MapSkinMode, forced: &str) -> BuiltinModSettings {
    BuiltinModSettings {
        map_skin,
        forced_map_skin: forced.to_owned(),
        ..BuiltinModSettings::default()
    }
}

fn generate(game: &Path, settings: &BuiltinModSettings) -> Overrides {
    let cache = tempfile::tempdir().unwrap();
    MapSkins::of(settings)
        .unwrap()
        .generate(&mut Context {
            game_dir: &GameDir::from_path(game),
            tables: &NoTables,
            mods: &mut [],
            cache_dir: cache.path(),
        })
        .unwrap()
}

/// Each declaration as `(target, entry, property, value)`, in the order the manifest holds them.
fn declared(overrides: &Overrides) -> Vec<(String, String, String, String)> {
    let Some(text) = overrides.declarations() else {
        return Vec::new();
    };
    let unquote = |text: &str| {
        text.trim()
            .trim_end_matches(':')
            .trim_matches('"')
            .to_owned()
    };
    let (mut target, mut entry) = (String::new(), String::new());
    let mut out = Vec::new();
    for line in text.lines().skip(2) {
        if let Some(rest) = line.strip_prefix("  - target: ") {
            target = unquote(rest);
        } else if let Some(rest) = line.strip_prefix("      ") {
            let (property, value) = rest.split_once(": ").unwrap();
            out.push((
                target.clone(),
                entry.clone(),
                property.to_owned(),
                value.to_owned(),
            ));
        } else {
            entry = unquote(line);
        }
    }
    out
}

fn reference(source: &str, property: &str) -> String {
    format!("!ref \"{}:{property}\"", skin_entry("Map11", source))
}

fn row(entry: &str, property: &str, value: String) -> (String, String, String, String) {
    (
        MAP11_BIN.to_owned(),
        skin_entry("Map11", entry),
        property.to_owned(),
        value,
    )
}

#[test]
fn the_game_mode_turns_no_mod_on() {
    assert_eq!(MapSkins::of(&settings(MapSkinMode::Game, "Bloom")), None);
    assert_eq!(MapSkins::of(&settings(MapSkinMode::Forced, "")), None);
    assert_eq!(
        MapSkins::of(&settings(MapSkinMode::Classic, "Bloom")),
        Some(MapSkins {
            source: "Default".to_owned()
        })
    );
}

#[test]
fn classic_declares_the_default_environment_on_every_other_linked_skin() {
    let game = game();

    let overrides = generate(game.path(), &settings(MapSkinMode::Classic, ""));

    assert_eq!(
        declared(&overrides),
        [
            row(
                "Bloom",
                "mGrassTintTexture",
                reference("Default", "mGrassTintTexture")
            ),
            row(
                "Bloom",
                "mMapContainerLink",
                reference("Default", "mMapContainerLink")
            ),
            row("Bloom", "mWorldParticlesINI", "\"\"".to_owned()),
            row(
                "Odyssey",
                "mMapContainerLink",
                reference("Default", "mMapContainerLink")
            ),
            row(
                "Ruby_SR",
                "GammaParameters",
                reference("Default", "GammaParameters")
            ),
            row(
                "Ruby_SR",
                "mAlternateAssets",
                reference("Default", "mAlternateAssets")
            ),
            row("Ruby_SR", "mColorizationPostEffect", "null".to_owned()),
            row(
                "Ruby_SR",
                "mMapContainerLink",
                reference("Default", "mMapContainerLink")
            ),
        ]
    );
}

#[test]
fn a_forced_skin_is_declared_on_default_and_every_other_linked_skin() {
    let game = game();

    let overrides = generate(game.path(), &settings(MapSkinMode::Forced, "Bloom"));

    assert_eq!(
        declared(&overrides),
        [
            row(
                "Default",
                "mGrassTintTexture",
                reference("Bloom", "mGrassTintTexture")
            ),
            row(
                "Default",
                "mMapContainerLink",
                reference("Bloom", "mMapContainerLink")
            ),
            row(
                "Default",
                "mWorldParticlesINI",
                reference("Bloom", "mWorldParticlesINI")
            ),
            row(
                "Odyssey",
                "mGrassTintTexture",
                reference("Bloom", "mGrassTintTexture")
            ),
            row(
                "Odyssey",
                "mMapContainerLink",
                reference("Bloom", "mMapContainerLink")
            ),
            row(
                "Odyssey",
                "mWorldParticlesINI",
                reference("Bloom", "mWorldParticlesINI")
            ),
            row(
                "Ruby_SR",
                "GammaParameters",
                reference("Bloom", "GammaParameters")
            ),
            row(
                "Ruby_SR",
                "mAlternateAssets",
                reference("Bloom", "mAlternateAssets")
            ),
            row("Ruby_SR", "mColorizationPostEffect", "null".to_owned()),
            row(
                "Ruby_SR",
                "mGrassTintTexture",
                reference("Bloom", "mGrassTintTexture")
            ),
            row(
                "Ruby_SR",
                "mMapContainerLink",
                reference("Bloom", "mMapContainerLink")
            ),
            row(
                "Ruby_SR",
                "mWorldParticlesINI",
                reference("Bloom", "mWorldParticlesINI")
            ),
        ]
    );
}

#[test]
fn a_forced_skin_no_map_defines_declares_nothing() {
    let game = game();

    let overrides = generate(game.path(), &settings(MapSkinMode::Forced, "bloom"));

    assert_eq!(declared(&overrides), []);
}

#[test]
fn the_tft_map_and_a_localized_archive_are_passed_over() {
    let game = tempfile::tempdir().unwrap();
    for archive in ["Map22.wad.client", "Map11.en_US.wad.client"] {
        let mut chunks = containers();
        chunks.push((MAP11_BIN.to_owned(), map11_bin()));
        build_wad(&maps_dir(game.path()).join(archive), &chunks);
    }

    let overrides = generate(game.path(), &settings(MapSkinMode::Classic, ""));

    assert_eq!(declared(&overrides), []);
}

/// Story: the declarations are only worth writing if the overlay's apply turns them into the
/// map bin the setting promises, typed by the schema the build uses.
#[test]
fn applied_declarations_give_every_skin_the_default_environment() {
    let game = game();
    let overrides = generate(game.path(), &settings(MapSkinMode::Classic, ""));
    let text = overrides.declarations().unwrap();
    let declarations = load_declarations("game_data.yaml", &text, |_| unreachable!()).unwrap();
    let Selector::Target { edits, .. } = &declarations.modules[0].selector else {
        panic!("expected a target module");
    };
    let base = map11_bin();
    let game_bin = Bin::from_reader(&mut Cursor::new(&base)).unwrap();
    let schema = PatchSchema::new(Arc::new(MetaSchema::shipped()), None);

    let output = apply(
        &base,
        edits,
        |_: &OverridePath| -> Result<Vec<u8>, ltk_game_data::Error> { unreachable!() },
        |entry: &EntryName| Ok(game_bin.objects.get(&entry.object_hash()).cloned()),
        &schema,
    )
    .unwrap();

    // With no build the schema types each field at the newest build it names, and says so.
    let refused: Vec<_> = output
        .diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.kind != ApplyDiagnosticKind::SchemaFallback)
        .collect();
    assert!(refused.is_empty(), "{refused:#?}");
    let bin = Bin::from_reader(&mut Cursor::new(&output.bytes)).unwrap();
    let skin = |name: &str| &bin.objects[&h(&skin_entry("Map11", name))];
    let property = |name: &str, field: &str| skin(name).properties.get(&h(field)).cloned();
    for name in ["Bloom", "Ruby_SR", "Odyssey"] {
        for field in [
            "mMapContainerLink",
            "mGrassTintTexture",
            "GammaParameters",
            "mAlternateAssets",
            "mResourceResolvers",
        ] {
            assert_eq!(
                property(name, field),
                property("Default", field),
                "{name}.{field}"
            );
        }
    }
    assert_eq!(property("Bloom", "mWorldParticlesINI"), Some(string("")));
    assert!(matches!(
        property("Ruby_SR", "mColorizationPostEffect"),
        Some(PropertyValueEnum::Struct(pointer)) if pointer.properties.is_empty()
            && pointer.class_hash == BinHash(0)
    ));
    assert_eq!(
        property("Ruby_SR", "mNavigationMesh"),
        Some(string("nav/ruby"))
    );
    assert_eq!(
        property("Odyssey", "mNavigationMesh"),
        Some(string("nav/odyssey"))
    );
}

#[test]
fn the_forcible_skins_are_the_whole_ones_other_than_default() {
    let game = game();
    build_wad(
        &maps_dir(game.path()).join("Map12.wad.client"),
        &[
            ("data/maps/shipping/map12/map12.bin".to_owned(), map11_bin()),
            (
                "data/maps/mapgeometry/map11/bloom.mapgeo".to_owned(),
                b"OEGM".to_vec(),
            ),
            (
                "data/maps/mapgeometry/map11/bloom.materials.bin".to_owned(),
                b"PROP".to_vec(),
            ),
        ],
    );

    let skins = forcible_map_skins(&GameDir::from_path(game.path())).unwrap();

    assert_eq!(
        skins,
        [
            ForcibleMapSkin {
                name: "Bloom".to_owned(),
                maps: vec!["Map11.wad.client".to_owned(), "Map12.wad.client".to_owned()],
            },
            ForcibleMapSkin {
                name: "Ruby_SR".to_owned(),
                maps: vec!["Map11.wad.client".to_owned()],
            },
        ]
    );
}

#[test]
fn an_injected_map_skins_project_carries_its_declarations() {
    let game = game();
    let storage = tempfile::tempdir().unwrap();

    let mods = inject(
        storage.path(),
        &settings(MapSkinMode::Classic, ""),
        &GameDir::from_path(game.path()),
        &NoTables,
        Vec::new(),
    )
    .unwrap();

    let ids: Vec<&str> = mods.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(ids, ["builtin:map-skins"]);
    let dir = storage.path().join("builtin").join("map-skins");
    let mut content = ltk_overlay::FsModContent::new(dir.try_into().unwrap());
    let declarations = content.game_data_declarations("base").unwrap().unwrap();
    assert_eq!(declarations.modules.len(), 1);
    assert_eq!(
        content.list_layer_wads("base").unwrap(),
        Vec::<String>::new()
    );
}

#[test]
fn a_rewrite_with_nothing_declared_drops_the_manifest() {
    let dir = tempfile::tempdir().unwrap();
    let manifest = dir
        .path()
        .join("content")
        .join("base")
        .join(ltk_declarations::FILE_NAME);
    let mut overrides = Overrides::default();
    overrides.declare(
        MAP11_BIN,
        "Maps/Shipping/Map11/MapSkins/Bloom",
        "a",
        "1".to_owned(),
    );
    overrides
        .write(dir.path(), "map-skins", "Map skin")
        .unwrap();
    assert!(manifest.exists());

    Overrides::default()
        .write(dir.path(), "map-skins", "Map skin")
        .unwrap();

    assert!(!manifest.exists());
}

#[test]
fn a_skin_the_game_names_by_hash_is_declared_by_hash() {
    assert_eq!(
        game_maps_entry_name("Map11", "Renamed", BinHash(0x1234_abcd)),
        "0x1234abcd"
    );
    assert_eq!(
        game_maps_entry_name("Map11", "Bloom", h("Maps/Shipping/Map11/MapSkins/Bloom")),
        "Maps/Shipping/Map11/MapSkins/Bloom"
    );
}

fn game_maps_entry_name(map: &str, name: &str, hash: BinHash) -> String {
    super::super::game_maps::entry_name(map, name, hash)
}

#[test]
fn a_declaration_text_loads_as_declarations() {
    let mut overrides = Overrides::default();
    overrides.declare(
        MAP11_BIN,
        "0x5fbe6627",
        "mMapContainerLink",
        format!(
            "!ref {}",
            super::super::overrides::quoted("0xafd164e9:mMapContainerLink")
        ),
    );

    let text = overrides.declarations().unwrap();

    let declarations = load_declarations("game_data.yaml", &text, |_| unreachable!()).unwrap();
    let Selector::Target { target, .. } = &declarations.modules[0].selector else {
        panic!("expected a target module");
    };
    assert_eq!(target.as_str(), MAP11_BIN);
}
