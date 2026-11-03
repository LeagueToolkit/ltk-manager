//! Unit tests for character inking.

use super::super::{Context, inject};
use super::*;
use fs_err as fs;
use ltk_hash::BinHash;
use ltk_manager_base::config::{InkingColorMode, Rgb8};
use ltk_meta::property::{Kind, values};
use ltk_meta::{Bin, BinObject};
use ltk_overlay::{EnabledMod, FsModContent, ModContentProvider as _};
use ltk_wad::{PathResolver, WadBuilder, WadChunkBuilder};
use std::collections::HashMap;
use std::io::Write as _;
use std::path::Path;

const AHRI_BASE_MESH: &str = "ASSETS/Characters/Ahri/Skins/Base/Ahri.skn";
const AHRI_SKIN1_MESH: &str = "ASSETS/Characters/Ahri/Skins/Skin01/Ahri_Skin01.skn";
const ANNIE_BASE_MESH: &str = "ASSETS/Characters/Annie/Skins/Base/Annie.skn";
const TIBBERS_MESH: &str = "ASSETS/Characters/AnnieTibbers/Skins/Base/AnnieTibbers.skn";

/// WAD path tables naming exactly the paths they were given.
#[derive(Default)]
struct Tables(HashMap<WadHash, String>);

impl PathResolver for Tables {
    fn resolve(&self, path_hash: WadHash) -> Option<String> {
        self.0.get(&path_hash).cloned()
    }
}

fn tables(paths: &[&str]) -> Tables {
    Tables(
        paths
            .iter()
            .map(|path| (WadHash::from(*path), (*path).to_owned()))
            .collect(),
    )
}

fn write_wad(path: &Path, chunks: &[(String, Vec<u8>)]) {
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

/// A `.skn` header naming `submeshes`, with no buffers after it.
fn skn(submeshes: &[&str]) -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend(SKN_MAGIC_BYTES);
    bytes.extend(1u16.to_le_bytes());
    bytes.extend(1u16.to_le_bytes());
    bytes.extend(u32::try_from(submeshes.len()).unwrap().to_le_bytes());
    for name in submeshes {
        ltk_mesh::SkinnedMeshRange::new(*name, 0, 0, 0, 0)
            .to_writer(&mut bytes)
            .unwrap();
    }
    bytes
}

const SKN_MAGIC_BYTES: [u8; 4] = ltk_mesh::SKN_MAGIC.to_le_bytes();

/// A skin bin of `character` skin `id` whose mesh is `mesh`, already listing a category if
/// `listed`.
fn skin_bin(character: &str, id: u32, mesh: &str, listed: bool) -> Vec<u8> {
    let mut mesh_properties = values::Struct {
        class_hash: BinHash::from("SkinMeshDataProperties"),
        properties: Default::default(),
    };
    mesh_properties.properties.insert(
        BinHash::from("simpleSkin"),
        values::String::new(mesh.to_owned()).into(),
    );
    if listed {
        let entry = values::Embedded(values::Struct {
            class_hash: BinHash::from("CharacterOutlineSubmeshes"),
            properties: Default::default(),
        });
        mesh_properties.properties.insert(
            BinHash::from("OutlineCategorySubmeshes"),
            values::Container::new(Kind::Embedded, vec![entry.into()])
                .unwrap()
                .into(),
        );
    }

    let skin = BinObject::builder(
        BinHash::from(format!("Characters/{character}/Skins/Skin{id}").as_str()),
        BinHash::from("SkinCharacterDataProperties"),
    )
    .property(
        BinHash::from("skinMeshProperties"),
        values::Embedded(mesh_properties),
    )
    .build();
    let mut bin = Bin::default();
    bin.objects.insert(skin.path_hash, skin);
    let mut bytes = std::io::Cursor::new(Vec::new());
    bin.to_writer(&mut bytes).unwrap();
    bytes.into_inner()
}

fn skin_path(character: &str, id: u32) -> String {
    format!("data/characters/{character}/skins/skin{id}.bin")
}

fn lower(path: &str) -> String {
    path.to_ascii_lowercase()
}

/// A game with Ahri (base, skin 1, and skin 2 that lists a category), Annie with her companion
/// Tibbers, and the maps Map11, Map12, a localized Map11 and TFT's Map22.
fn game() -> tempfile::TempDir {
    let game = tempfile::tempdir().unwrap();
    let champions = game.path().join("DATA").join("FINAL").join("Champions");
    write_wad(
        &champions.join("Ahri.wad.client"),
        &[
            (
                skin_path("ahri", 0),
                skin_bin("Ahri", 0, AHRI_BASE_MESH, false),
            ),
            (
                skin_path("ahri", 1),
                skin_bin("Ahri", 1, AHRI_SKIN1_MESH, false),
            ),
            (
                skin_path("ahri", 2),
                skin_bin("Ahri", 2, AHRI_BASE_MESH, true),
            ),
            (lower(AHRI_BASE_MESH), skn(&["Body", "Tails", "Body"])),
            (lower(AHRI_SKIN1_MESH), skn(&["Skin01_Body"])),
        ],
    );
    write_wad(
        &champions.join("Annie.wad.client"),
        &[
            (
                skin_path("annie", 0),
                skin_bin("Annie", 0, ANNIE_BASE_MESH, false),
            ),
            (
                skin_path("annietibbers", 1),
                skin_bin("AnnieTibbers", 1, TIBBERS_MESH, false),
            ),
            (lower(ANNIE_BASE_MESH), skn(&["Annie"])),
            (lower(TIBBERS_MESH), skn(&["Tibbers"])),
        ],
    );

    let maps = game
        .path()
        .join("DATA")
        .join("FINAL")
        .join("Maps")
        .join("Shipping");
    for map in ["Map11", "Map12", "Map22"] {
        let lower = map.to_ascii_lowercase();
        write_wad(
            &maps.join(format!("{map}.wad.client")),
            &[(
                format!("data/maps/shipping/{lower}/{lower}.bin"),
                b"PROP".to_vec(),
            )],
        );
    }
    write_wad(
        &maps.join("Map11.en_US.wad.client"),
        &[(
            "data/maps/shipping/map11/map11.bin".to_owned(),
            b"PROP".to_vec(),
        )],
    );
    game
}

fn on(scope: InkingScope) -> BuiltinModSettings {
    BuiltinModSettings {
        character_inking: InkingSettings {
            enabled: true,
            scope,
            ..InkingSettings::default()
        },
        ..BuiltinModSettings::default()
    }
}

fn generate(settings: &BuiltinModSettings, game: &Path, mods: &mut [EnabledMod]) -> Overrides {
    let cache = tempfile::tempdir().unwrap();
    generate_in(settings, game, cache.path(), mods)
}

fn generate_in(
    settings: &BuiltinModSettings,
    game: &Path,
    cache_dir: &Path,
    mods: &mut [EnabledMod],
) -> Overrides {
    CharacterInking::of(settings)
        .unwrap()
        .generate(&mut Context {
            game_dir: &GameDir::from_path(game),
            tables: &tables(&["data/characters/annietibbers/skins/skin1.bin"]),
            mods,
            cache_dir,
        })
        .unwrap()
}

/// The skin bins that `overrides` gives an outline list, with the submeshes each one lists.
fn outlined(overrides: &Overrides) -> Vec<(String, Vec<String>)> {
    let Some(text) = overrides.declarations() else {
        return Vec::new();
    };
    let mut outlined = Vec::new();
    let mut target = None;
    for line in text.lines() {
        if let Some(path) = line.strip_prefix("  - target: ") {
            target = Some(path.trim_matches('"').to_owned());
        }
        if let Some(list) = line
            .trim()
            .strip_prefix("skinMeshProperties.OutlineCategorySubmeshes: ")
        {
            let submeshes = list
                .split("Submeshes: ")
                .skip(1)
                .map(|rest| rest.split('"').nth(1).unwrap().to_owned())
                .collect();
            outlined.push((target.clone().unwrap(), submeshes));
        }
    }
    outlined
}

/// The map bins that `overrides` creates the category and material in.
fn inked_maps(overrides: &Overrides) -> Vec<String> {
    let Some(text) = overrides.declarations() else {
        return Vec::new();
    };
    let mut maps = Vec::new();
    let mut target = String::new();
    for line in text.lines() {
        if let Some(path) = line.strip_prefix("  - target: ") {
            target = path.trim_matches('"').to_owned();
        }
        if line.trim() == format!("{}:", quoted(CATEGORY)) {
            maps.push(target.clone());
        }
    }
    maps
}

fn names(submeshes: &[&str]) -> Vec<String> {
    submeshes.iter().map(|name| (*name).to_owned()).collect()
}

#[test]
fn character_inking_turned_off_is_not_enabled() {
    let settings = BuiltinModSettings::default();

    assert!(CharacterInking::of(&settings).is_none());
    assert_eq!(super::super::count_enabled(&settings), 0);
}

#[test]
fn all_champions_outline_every_skin_that_lists_no_category() {
    let game = game();

    let overrides = generate(&on(InkingScope::All), game.path(), &mut []);

    assert_eq!(
        outlined(&overrides),
        [
            (skin_path("ahri", 0), names(&["Body", "Tails"])),
            (skin_path("ahri", 1), names(&["Skin01_Body"])),
            (skin_path("annie", 0), names(&["Annie"])),
        ]
    );
}

#[test]
fn all_maps_take_the_category_except_tft_and_localized_archives() {
    let game = game();

    let overrides = generate(&on(InkingScope::All), game.path(), &mut []);

    assert_eq!(
        inked_maps(&overrides),
        [
            "data/maps/shipping/map11/map11.bin",
            "data/maps/shipping/map12/map12.bin"
        ]
    );
}

#[test]
fn summoners_rift_takes_the_category_alone() {
    let game = game();
    let mut settings = on(InkingScope::All);
    settings.character_inking.maps = InkingMaps::SummonersRift;

    let overrides = generate(&settings, game.path(), &mut []);

    assert_eq!(
        inked_maps(&overrides),
        ["data/maps/shipping/map11/map11.bin"]
    );
}

#[test]
fn chosen_maps_take_the_category_and_no_map_writes_nothing() {
    let game = game();
    let mut settings = on(InkingScope::All);
    settings.character_inking.maps = InkingMaps::Chosen;
    settings.character_inking.chosen_maps = BTreeSet::from(["map12".to_owned()]);

    let overrides = generate(&settings, game.path(), &mut []);
    assert_eq!(
        inked_maps(&overrides),
        ["data/maps/shipping/map12/map12.bin"]
    );

    settings.character_inking.chosen_maps.clear();
    let overrides = generate(&settings, game.path(), &mut []);
    assert_eq!(overrides.declarations(), None);
}

#[test]
fn chosen_champions_outline_only_the_chosen_roster_champions() {
    let game = game();
    let mut settings = on(InkingScope::Chosen);
    settings.character_inking.chosen_champions =
        BTreeSet::from(["annie".to_owned(), "annietibbers".to_owned()]);

    let overrides = generate(&settings, game.path(), &mut []);

    assert_eq!(
        outlined(&overrides),
        [(skin_path("annie", 0), names(&["Annie"]))]
    );
}

fn write_mod(dir: &Path, files: &[(&str, &str, Vec<u8>)]) {
    let mut overrides = Overrides::default();
    for (wad, chunk_path, bytes) in files {
        overrides.insert(wad, chunk_path, bytes.clone());
    }
    overrides.write(dir, "mod", "Mod").unwrap();
}

fn fs_mod(dir: &Path) -> EnabledMod {
    EnabledMod {
        id: "mod".to_owned(),
        content: Box::new(FsModContent::new(dir.to_path_buf().try_into().unwrap())),
        enabled_layers: None,
    }
}

#[test]
fn modded_champions_outline_a_reskinned_champion_with_the_mod_s_mesh() {
    let game = game();
    let mod_dir = tempfile::tempdir().unwrap();
    let mod_mesh = "ASSETS/Characters/Annie/Skins/Base/Annie_Mod.skn";
    write_mod(
        mod_dir.path(),
        &[
            (
                "Annie.wad.client",
                &skin_path("annie", 0),
                skin_bin("Annie", 0, mod_mesh, false),
            ),
            (
                "Annie.wad.client",
                &lower(mod_mesh),
                skn(&["ModBody", "ModHat"]),
            ),
        ],
    );
    let mut mods = [fs_mod(mod_dir.path())];

    let overrides = generate(&on(InkingScope::Modded), game.path(), &mut mods);

    assert_eq!(
        outlined(&overrides),
        [(skin_path("annie", 0), names(&["ModBody", "ModHat"]))]
    );
}

#[test]
fn a_stand_in_skin_takes_the_base_skin_s_submeshes() {
    let game = game();
    let mut settings = on(InkingScope::Chosen);
    settings.base_skins = BaseSkinsScope::AllChampions;
    settings.character_inking.chosen_champions = BTreeSet::from(["ahri".to_owned()]);

    let overrides = generate(&settings, game.path(), &mut []);

    assert_eq!(
        outlined(&overrides),
        [
            (skin_path("ahri", 0), names(&["Body", "Tails"])),
            (skin_path("ahri", 1), names(&["Body", "Tails"])),
            (skin_path("ahri", 2), names(&["Body", "Tails"])),
        ]
    );
}

#[test]
fn a_second_build_reads_the_same_outlines_out_of_the_cache() {
    let game = game();
    let cache = tempfile::tempdir().unwrap();
    let settings = on(InkingScope::All);

    let first = generate_in(&settings, game.path(), cache.path(), &mut []);
    assert!(cache.path().join("inking-skins.json").is_file());
    let second = generate_in(&settings, game.path(), cache.path(), &mut []);

    assert_eq!(first, second);
}

#[test]
fn an_injected_inking_project_declares_a_manifest_that_loads() {
    let game = game();
    let storage = tempfile::tempdir().unwrap();
    let mut settings = on(InkingScope::All);
    settings.character_inking.color_mode = InkingColorMode::Team;

    let mods = inject(
        storage.path(),
        &settings,
        &GameDir::from_path(game.path()),
        &tables(&[]),
        Vec::new(),
    )
    .unwrap();

    let ids: Vec<&str> = mods.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(ids, ["builtin:character-inking"]);
    let dir = storage.path().join("builtin").join("character-inking");
    let mut content = FsModContent::new(dir.try_into().unwrap());
    let declarations = content.game_data_declarations("base").unwrap().unwrap();
    declarations.validate().unwrap();
    assert_eq!(declarations.modules.len(), 5);
}

#[test]
fn outline_values_clamp_every_setting_to_its_range() {
    let settings = InkingSettings {
        width: 9000,
        opacity: 0,
        camera_distance: 1,
        death_fade: u16::MAX,
        ..InkingSettings::default()
    };

    let outline = outline_values(&settings, InkingSide::Ally);

    assert_eq!(outline.width, 15.0);
    assert_eq!(outline.alpha, 0.1);
    assert_eq!(outline.camera_distance, 1000.0);
    assert_eq!(outline.death_fade, 2.0);
    assert_eq!(outline.depth_offset, -20.0);
}

#[test]
fn outline_values_take_the_original_preset_by_default() {
    let outline = outline_values(&InkingSettings::default(), InkingSide::Enemy);

    assert_eq!(
        outline,
        InkingOutline {
            color: [0.0, 0.0, 0.0, 1.0],
            width: 5.0,
            camera_distance: 4500.0,
            depth_offset: -20.0,
            alpha: 1.0,
            death_fade: 0.5,
        }
    );
}

#[test]
fn outline_values_pick_the_side_s_color_only_with_team_colors() {
    let mut settings = InkingSettings {
        color: Rgb8([255, 0, 0]),
        ally_color: Rgb8([0, 255, 0]),
        enemy_color: Rgb8([0, 0, 255]),
        ..InkingSettings::default()
    };
    assert_eq!(
        outline_values(&settings, InkingSide::Enemy).color,
        [1.0, 0.0, 0.0, 1.0]
    );

    settings.color_mode = InkingColorMode::Team;
    assert_eq!(
        outline_values(&settings, InkingSide::Ally).color,
        [0.0, 1.0, 0.0, 1.0]
    );
    assert_eq!(
        outline_values(&settings, InkingSide::Enemy).color,
        [0.0, 0.0, 1.0, 1.0]
    );
}

#[test]
fn the_material_drives_the_alive_opacity_and_the_enemy_color() {
    let settings = InkingSettings {
        opacity: 60,
        color_mode: InkingColorMode::Team,
        ..InkingSettings::default()
    };

    let body = outline::material_body(&settings);

    assert!(body.contains("mOffValue: 0.6"), "{body}");
    assert!(body.contains("name: Outline_Color\n"), "{body}");
    assert!(body.contains("IsEnemyDynamicMaterialBoolDriver"), "{body}");
}

#[test]
fn submesh_names_read_the_header_and_refuse_other_files() {
    assert_eq!(
        skins::submesh_names(&skn(&["Body", "Weapon"])),
        Ok(names(&["Body", "Weapon"]))
    );
    assert!(skins::submesh_names(b"PROP").is_err());
}
