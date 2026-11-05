//! Unit tests for character inking.

use super::super::{Context, Regenerate, inject};
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
    mesh_properties.properties.insert(
        BinHash::from("texture"),
        values::WadChunkLink::new(WadHash::from(texture_path(character).as_str())).into(),
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

/// The base texture of character's test skins.
fn texture_path(character: &str) -> String {
    format!(
        "assets/characters/{0}/skins/base/{0}_tx_cm.tex",
        character.to_ascii_lowercase()
    )
}

/// A 4x4 TEX of `format`, the code the format byte holds, with `block` as its one block.
fn tex(format: u8, block: &[u8]) -> Vec<u8> {
    let mut bytes = b"TEX\0".to_vec();
    bytes.extend([4, 0, 4, 0, 1, format, 1, 0]);
    bytes.extend(block);
    bytes
}

/// A BC1 block in its four-color mode, which has no transparent texel.
const BC1_OPAQUE: [u8; 8] = [0xff, 0xff, 0, 0, 0xff, 0xff, 0xff, 0xff];

/// A BC1 block in its three-color mode whose texels all take index 3, the transparent one.
const BC1_CUTOUT: [u8; 8] = [0, 0, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

/// A BC3 block whose alpha endpoints are 0, which is transparent.
const BC3_CUTOUT: [u8; 16] = [0; 16];

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
            (texture_path("ahri"), tex(12, &BC3_CUTOUT)),
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
            (texture_path("annie"), tex(10, &BC1_OPAQUE)),
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
        .generate(&mut Context::new(
            &GameDir::from_path(game),
            &tables(&["data/characters/annietibbers/skins/skin1.bin"]),
            mods,
            cache_dir,
        ))
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
        "1.0.0",
        Regenerate::Always,
        &mut |_| {},
        &|| false,
    )
    .unwrap()
    .mods;

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

    let body = outline::material_body(&settings, None);

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

#[test]
fn a_submesh_whose_texture_carries_alpha_links_a_material_masked_by_it() {
    let game = game();

    let overrides = generate(&on(InkingScope::All), game.path(), &mut []);
    let text = overrides.declarations().unwrap();

    let ahri = WadHash::from(texture_path("ahri").as_str()).0;
    let masked = format!("Mods/builtin/character-inking/Masks/{ahri:016x}-8");
    let ahri_module = text
        .split("  - target: ")
        .find(|module| module.starts_with("\"data/characters/ahri/skins/skin0.bin\""))
        .unwrap();
    assert!(
        ahri_module.contains(&format!("\"{masked}\":")),
        "{ahri_module}"
    );
    assert!(ahri_module.contains(&format!("materialOverride: \"{masked}\"")));
    assert!(ahri_module.contains(&format!("texturePath: \"0x{ahri:016x}\"")));
    assert!(ahri_module.contains("value: [0.0, 0.0, 0.0, 1.0]"));

    let annie_module = text
        .split("  - target: ")
        .find(|module| module.starts_with("\"data/characters/annie/skins/skin0.bin\""))
        .unwrap();
    assert!(!annie_module.contains("materialOverride"), "{annie_module}");
}

#[test]
fn has_transparency_finds_a_transparent_texel_in_any_scanned_format() {
    assert!(!textures::has_transparency(&tex(10, &BC1_OPAQUE)));
    assert!(textures::has_transparency(&tex(10, &BC1_CUTOUT)));
    assert!(textures::has_transparency(&tex(12, &BC3_CUTOUT)));
    assert!(!textures::has_transparency(&tex(12, &[0xff; 16])));
    assert!(!textures::has_transparency(&tex(20, &[0xff; 4])));
    assert!(!textures::has_transparency(&tex(1, &[0; 8])));
    assert!(textures::has_transparency(b"DDS "));
}

/// A `StaticMaterialDef` at `path` with `samplers`, each a texture name and a texture path, and
/// `params`, each a parameter name and a vector.
fn material(path: &str, samplers: &[(&str, &str)], params: &[(&str, [f32; 4])]) -> BinObject {
    let embed = |class: &str, fields: Vec<(&str, ltk_meta::PropertyValueEnum)>| {
        let mut value = values::Struct {
            class_hash: BinHash::from(class),
            properties: Default::default(),
        };
        for (name, field) in fields {
            value.properties.insert(BinHash::from(name), field);
        }
        ltk_meta::PropertyValueEnum::from(values::Embedded(value))
    };
    let samplers = samplers
        .iter()
        .map(|(name, texture)| {
            embed(
                "StaticMaterialShaderSamplerDef",
                vec![
                    (
                        "TextureName",
                        values::String::new((*name).to_owned()).into(),
                    ),
                    (
                        "texturePath",
                        values::WadChunkLink::new(WadHash::from(*texture)).into(),
                    ),
                ],
            )
        })
        .collect();
    let params = params
        .iter()
        .map(|(name, value)| {
            embed(
                "StaticMaterialShaderParamDef",
                vec![
                    ("name", values::String::new((*name).to_owned()).into()),
                    (
                        "value",
                        values::Vector4::new(glam::Vec4::from(*value)).into(),
                    ),
                ],
            )
        })
        .collect();
    BinObject::builder(BinHash::from(path), BinHash::from("StaticMaterialDef"))
        .property(
            BinHash::from("samplerValues"),
            values::Container::new(Kind::Embedded, samplers).unwrap(),
        )
        .property(
            BinHash::from("paramValues"),
            values::Container::new(Kind::Embedded, params).unwrap(),
        )
        .build()
}

/// A skin bin of `character` skin 0 drawn by `material`, holding `objects` beside the skin and
/// listing `outlines`, each a `Submeshes` value and its outline material.
fn material_skin_bin(
    character: &str,
    mesh: &str,
    material_path: &str,
    outlines: &[(&str, Option<&str>)],
    objects: Vec<BinObject>,
) -> Vec<u8> {
    let mut mesh_properties = values::Struct {
        class_hash: BinHash::from("SkinMeshDataProperties"),
        properties: Default::default(),
    };
    mesh_properties.properties.insert(
        BinHash::from("simpleSkin"),
        values::String::new(mesh.to_owned()).into(),
    );
    mesh_properties.properties.insert(
        BinHash::from("Material"),
        values::ObjectLink::new(BinHash::from(material_path)).into(),
    );
    if !outlines.is_empty() {
        let entries = outlines
            .iter()
            .map(|(submeshes, material)| {
                let mut entry = values::Struct {
                    class_hash: BinHash::from("CharacterOutlineSubmeshes"),
                    properties: Default::default(),
                };
                entry.properties.insert(
                    BinHash::from("Submeshes"),
                    values::String::new((*submeshes).to_owned()).into(),
                );
                if let Some(material) = material {
                    entry.properties.insert(
                        BinHash::from("materialOverride"),
                        values::ObjectLink::new(BinHash::from(*material)).into(),
                    );
                }
                values::Embedded(entry).into()
            })
            .collect();
        mesh_properties.properties.insert(
            BinHash::from("OutlineCategorySubmeshes"),
            values::Container::new(Kind::Embedded, entries)
                .unwrap()
                .into(),
        );
    }

    let skin = BinObject::builder(
        BinHash::from(format!("Characters/{character}/Skins/Skin0").as_str()),
        BinHash::from("SkinCharacterDataProperties"),
    )
    .property(
        BinHash::from("skinMeshProperties"),
        values::Embedded(mesh_properties),
    )
    .build();
    let mut bin = Bin::default();
    bin.objects.insert(skin.path_hash, skin);
    for object in objects {
        bin.objects.insert(object.path_hash, object);
    }
    let mut bytes = std::io::Cursor::new(Vec::new());
    bin.to_writer(&mut bytes).unwrap();
    bytes.into_inner()
}

#[test]
fn a_skin_with_a_league_classic_copy_takes_riot_s_outline_list_and_mask_swaps() {
    let game = tempfile::tempdir().unwrap();
    let mesh = "ASSETS/Characters/Ahri/Skins/Base/Ahri.skn";
    let body = "Characters/Ahri/Skins/Skin0/Materials/Body";
    let jade_body = "Characters/Jade_Ahri/Skins/Skin0/Materials/Body";
    let tails = "Characters/Jade_Ahri/Skins/Skin0/Materials/Tails_Outline";
    write_wad(
        &game.path().join("DATA/FINAL/Champions/Ahri.wad.client"),
        &[
            (
                skin_path("ahri", 0),
                material_skin_bin(
                    "Ahri",
                    mesh,
                    body,
                    &[],
                    vec![material(
                        body,
                        &[
                            ("Diffuse_Texture", "ahri_tx.tex"),
                            ("Mask_Texture", "ahri_mask.tex"),
                        ],
                        &[],
                    )],
                ),
            ),
            (
                skin_path("jade_ahri", 0),
                material_skin_bin(
                    "Jade_Ahri",
                    mesh,
                    jade_body,
                    &[("Body", None), ("Tails", Some(tails))],
                    vec![
                        material(
                            jade_body,
                            &[
                                ("Diffuse_Texture", "jade_ahri_tx.tex"),
                                ("Mask_Texture", "jade_ahri_mask.tex"),
                            ],
                            &[],
                        ),
                        material(
                            tails,
                            &[("Outline_Mask", "ahri_tails_tx.tex")],
                            &[("Outline_Mask_ChannelMask", [0.0, 0.0, 0.0, 1.0])],
                        ),
                    ],
                ),
            ),
            (lower(mesh), skn(&["Body", "Tails", "Eyes"])),
        ],
    );
    write_wad(
        &game
            .path()
            .join("DATA/FINAL/Maps/Shipping/Map11.wad.client"),
        &[(
            "data/maps/shipping/map11/map11.bin".to_owned(),
            b"PROP".to_vec(),
        )],
    );

    let mut settings = on(InkingScope::Chosen);
    settings.character_inking.chosen_champions = BTreeSet::from(["ahri".to_owned()]);
    let overrides = generate(&settings, game.path(), &mut []);
    let text = overrides.declarations().unwrap();

    let mask = format!(
        "Mods/builtin/character-inking/Masks/{:016x}-8",
        WadHash::from("ahri_tails_tx.tex").0
    );
    assert_eq!(
        outlined(&overrides),
        [(skin_path("ahri", 0), names(&["Body", "Tails"]))]
    );
    assert!(text.contains(&format!(
        "Submeshes: \"Tails\", materialOverride: \"{mask}\""
    )));
    assert!(text.contains(&format!(
        "samplerValues[1].texturePath: \"0x{:016x}\"",
        WadHash::from("jade_ahri_mask.tex").0
    )));
    assert!(!text.contains("samplerValues[0]"), "{text}");
}

#[test]
fn a_manifest_past_the_parser_node_budget_still_loads() {
    let mut overrides = Overrides::default();
    let list = format!("[{}]", vec!["{a: 1, b: 2}"; 40].join(", "));
    for skin in 0..2000 {
        overrides.declare(
            &skin_path("ahri", skin),
            &format!("Characters/Ahri/Skins/Skin{skin}"),
            "skinMeshProperties.OutlineCategorySubmeshes",
            list.clone(),
        );
    }
    let dir = tempfile::tempdir().unwrap();
    overrides.write(dir.path(), "inking", "Inking").unwrap();

    let mut content = FsModContent::new(dir.path().to_path_buf().try_into().unwrap());
    let declarations = content.game_data_declarations("base").unwrap().unwrap();

    assert_eq!(declarations.modules.len(), 2000);
}

#[test]
fn a_part_the_league_classic_mesh_names_differently_takes_the_generic_outline() {
    let game = tempfile::tempdir().unwrap();
    let mesh = "ASSETS/Characters/Akali/Skins/Base/Akali.skn";
    let jade_mesh = "ASSETS/Characters/Jade_Akali/Skins/Base/Jade_Akali.skn";
    let body = "Characters/Akali/Skins/Skin0/Materials/Body";
    write_wad(
        &game.path().join("DATA/FINAL/Champions/Akali.wad.client"),
        &[
            (
                skin_path("akali", 0),
                material_skin_bin("Akali", mesh, body, &[], vec![material(body, &[], &[])]),
            ),
            (
                skin_path("jade_akali", 0),
                material_skin_bin(
                    "Jade_Akali",
                    jade_mesh,
                    body,
                    &[("Akali_Base_Body_Mat", None), ("kama", None)],
                    vec![],
                ),
            ),
            (lower(mesh), skn(&["Body", "kama", "ramen"])),
            (
                lower(jade_mesh),
                skn(&["Akali_Base_Body_Mat", "kama", "ramen"]),
            ),
        ],
    );
    write_wad(
        &game
            .path()
            .join("DATA/FINAL/Maps/Shipping/Map11.wad.client"),
        &[(
            "data/maps/shipping/map11/map11.bin".to_owned(),
            b"PROP".to_vec(),
        )],
    );

    let mut settings = on(InkingScope::Chosen);
    settings.character_inking.chosen_champions = BTreeSet::from(["akali".to_owned()]);
    let overrides = generate(&settings, game.path(), &mut []);

    assert_eq!(
        outlined(&overrides),
        [(skin_path("akali", 0), names(&["Body", "kama"]))]
    );
}

/// A game whose Map11 archive holds a lane minion's base skin and a turret's skin 3, and no
/// champion.
fn map_characters_game() -> tempfile::TempDir {
    let game = tempfile::tempdir().unwrap();
    let minion_mesh = "ASSETS/Characters/SRU_OrderMinionMelee/Skins/Base/SRU_OrderMinionMelee.skn";
    let turret_mesh = "ASSETS/Characters/Turret/Skins/Skin03/Turret_Skin03.skn";
    write_wad(
        &game.path().join("DATA/FINAL/Champions/Ahri.wad.client"),
        &[],
    );
    write_wad(
        &game
            .path()
            .join("DATA/FINAL/Maps/Shipping/Map11.wad.client"),
        &[
            (
                "data/maps/shipping/map11/map11.bin".to_owned(),
                b"PROP".to_vec(),
            ),
            (
                skin_path("sru_orderminionmelee", 0),
                skin_bin("SRU_OrderMinionMelee", 0, minion_mesh, false),
            ),
            (
                skin_path("turret", 3),
                skin_bin("Turret", 3, turret_mesh, false),
            ),
            (lower(minion_mesh), skn(&["Body"])),
            (lower(turret_mesh), skn(&["Tower", "Crystal"])),
            (texture_path("sru_orderminionmelee"), tex(10, &BC1_OPAQUE)),
            (texture_path("turret"), tex(10, &BC1_OPAQUE)),
        ],
    );
    game
}

#[test]
fn lane_minions_and_structures_get_a_list_only_when_their_setting_is_on() {
    let game = map_characters_game();
    let minion = (skin_path("sru_orderminionmelee", 0), names(&["Body"]));
    let turret = (skin_path("turret", 3), names(&["Tower", "Crystal"]));
    let mut settings = on(InkingScope::All);

    assert_eq!(outlined(&generate(&settings, game.path(), &mut [])), []);

    settings.character_inking.minions = true;
    assert_eq!(
        outlined(&generate(&settings, game.path(), &mut [])),
        std::slice::from_ref(&minion)
    );

    settings.character_inking.minions = false;
    settings.character_inking.structures = true;
    assert_eq!(
        outlined(&generate(&settings, game.path(), &mut [])),
        std::slice::from_ref(&turret)
    );

    settings.character_inking.minions = true;
    assert_eq!(
        outlined(&generate(&settings, game.path(), &mut [])),
        [minion, turret]
    );
}

#[test]
fn a_declaration_source_is_named_after_its_target_not_a_chunk_hash() {
    let mut overrides = Overrides::default();
    overrides.declare(
        &skin_path("ahri", 0),
        "Characters/Ahri/Skins/Skin0",
        "skinMeshProperties.OutlineCategorySubmeshes",
        "[]".to_owned(),
    );
    let dir = tempfile::tempdir().unwrap();
    overrides.write(dir.path(), "inking", "Inking").unwrap();

    let source = dir
        .path()
        .join("content/base/game-data/data/characters/ahri/skins/skin0.bin.yaml");
    assert!(source.is_file(), "missing {}", source.display());
    let hex_named = walkdir::WalkDir::new(dir.path().join("content/base/game-data"))
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.path().file_stem()?.to_str().map(str::to_owned))
        .any(|stem| stem.len() == 16 && stem.bytes().all(|b| b.is_ascii_hexdigit()));
    assert!(!hex_named, "a source name reads as a chunk hash");
}
