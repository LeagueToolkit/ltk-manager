use std::io::Read;

use fs_err as fs;

use ltk_manager_assets::preview::AssetInfo;

use super::*;

/// Locates `path` at the file `on_disk`, and nothing else.
struct OneFile {
    path: &'static str,
    on_disk: String,
}

impl AssetLookup for OneFile {
    fn locate(&self, path: &str) -> Option<AssetRef> {
        path.eq_ignore_ascii_case(self.path)
            .then(|| AssetRef::File {
                path: self.on_disk.clone(),
            })
    }
}

#[test]
fn sandbox_audio_files_read_located_file_with_its_asset() {
    let dir = tempfile::tempdir().unwrap();
    let on_disk = dir.path().join("a.wpk").to_string_lossy().into_owned();
    fs::write(&on_disk, b"r3d2").unwrap();
    let lookup = OneFile {
        path: "sounds/a.wpk",
        on_disk: on_disk.clone(),
    };
    let config = Config::default();
    let wads = WadCache::default();
    let files = SandboxAudioFiles {
        assets: &lookup,
        config: &config,
        wads: &wads,
    };

    let read = files.read("SOUNDS/A.wpk").unwrap().unwrap();
    let mut opened = files.open("sounds/a.wpk").unwrap().unwrap();
    let mut contents = Vec::new();
    opened.contents.read_to_end(&mut contents).unwrap();

    assert_eq!(read.contents, b"r3d2");
    assert_eq!(read.asset, AssetRef::File { path: on_disk });
    assert_eq!(contents, b"r3d2");
    assert!(files.read("sounds/b.wpk").unwrap().is_none());
}

const PACKAGE: &[u8] =
    include_bytes!("../../../../crates/ltk-manager-audio/tests/fixtures/package.wpk");

/// Writes `bytes` as the file `name` of `dir` and returns its reference.
fn loose(dir: &tempfile::TempDir, name: &str, bytes: &[u8]) -> AssetRef {
    let path = dir.path().join(name);
    fs::write(&path, bytes).unwrap();
    AssetRef::File {
        path: path.to_string_lossy().into_owned(),
    }
}

#[test]
fn asset_info_reports_package_as_audio() {
    let dir = tempfile::tempdir().unwrap();
    let asset = loose(&dir, "map22_audio.wpk", PACKAGE);

    let info = asset_info(&asset, &Config::default(), &WadCache::default()).unwrap();

    assert!(
        matches!(&info, AssetInfo::Audio(audio) if audio.media_count == 2),
        "{info:?}"
    );
}

#[test]
fn asset_info_reports_other_file_through_assets_crate() {
    let dir = tempfile::tempdir().unwrap();
    let asset = loose(&dir, "data.bin", b"PROP\x00\x00\x00\x00");

    let info = asset_info(&asset, &Config::default(), &WadCache::default()).unwrap();

    assert!(matches!(info, AssetInfo::Unsupported { .. }), "{info:?}");
}

#[test]
fn asset_media_lists_package_rows() {
    let dir = tempfile::tempdir().unwrap();
    let asset = loose(&dir, "map22_audio.wpk", PACKAGE);

    let rows = asset_media(&asset, &Config::default(), &WadCache::default()).unwrap();

    let sources: Vec<u32> = rows.iter().map(|row| row.source_id).collect();
    assert_eq!(sources, [380_333_190, 470_358_536]);
}

#[test]
fn asset_media_fails_for_file_that_is_not_audio() {
    let dir = tempfile::tempdir().unwrap();
    let asset = loose(&dir, "data.bin", b"PROP\x00\x00\x00\x00");

    assert!(asset_media(&asset, &Config::default(), &WadCache::default()).is_err());
}

#[test]
fn exported_media_writes_original_wem_or_decoded_ogg() {
    let dir = tempfile::tempdir().unwrap();
    let asset = loose(&dir, "map22_audio.wpk", PACKAGE);
    let cache = SoundCache::default();
    let config = Config::default();
    let wads = WadCache::default();
    let source = SourceId(470_358_536);

    let original = exported_media(
        &asset,
        source,
        MediaExport::Original,
        &cache,
        &config,
        &wads,
    );
    let decoded = exported_media(&asset, source, MediaExport::Decoded, &cache, &config, &wads);

    let original = original.unwrap();
    assert_eq!(original.len(), 4446);
    assert_eq!(&original[..4], b"RIFF");
    assert_eq!(&decoded.unwrap()[..4], b"OggS");
}

/// Names the one chunk `0123456789abcdef` and nothing else.
struct OneChunkName;

impl ltk_manager_bin::bin_document::RowNames for OneChunkName {
    fn for_each_entry(&self, _: &[ltk_hash::BinHash], _: &mut dyn FnMut(usize, &str)) {}

    fn for_each_class(&self, _: &[ltk_hash::BinHash], _: &mut dyn FnMut(usize, &str)) {}

    fn for_each_field(&self, _: &[ltk_hash::BinHash], _: &mut dyn FnMut(usize, &str)) {}

    fn for_each_value(&self, _: &[ltk_hash::BinHash], _: &mut dyn FnMut(usize, &str)) {}

    fn for_each_chunk(&self, hashes: &[ltk_hash::WadHash], visit: &mut dyn FnMut(usize, &str)) {
        for (at, hash) in hashes.iter().enumerate() {
            if hash.0 == 0x0123_4567_89ab_cdef {
                visit(at, "assets/sounds/ahri_sfx_events.bnk");
            }
        }
    }
}

fn layer_file(path: &str) -> AssetRef {
    AssetRef::Layer {
        project: "C:/projects/ahri".to_owned(),
        layer: "base".to_owned(),
        path: path.to_owned(),
    }
}

#[test]
fn game_path_drops_archive_directory_of_layer_file() {
    let asset = layer_file("Ahri.wad.client/assets/sounds/ahri_sfx_events.bnk");

    assert_eq!(
        game_path(&asset, &OneChunkName),
        "assets/sounds/ahri_sfx_events.bnk"
    );
}

#[test]
fn game_path_names_hash_named_layer_file_from_tables() {
    let asset = layer_file("Ahri.wad.client/0123456789abcdef.bnk");

    assert_eq!(
        game_path(&asset, &OneChunkName),
        "assets/sounds/ahri_sfx_events.bnk"
    );
}

#[test]
fn game_path_of_loose_file_is_its_file_name() {
    let asset = AssetRef::File {
        path: "C:\\Downloads\\ahri_sfx_events.bnk".to_owned(),
    };

    assert_eq!(game_path(&asset, &OneChunkName), "ahri_sfx_events.bnk");
}

/// Names one spell path in `binentries` and one situation in `binhashes`.
struct ContextualNames;

const SPELL_HASH: u32 = 0x5be1_1000;
const SITUATION_HASH: u32 = 0x5ca5_7000;

impl ltk_manager_bin::bin_document::RowNames for ContextualNames {
    fn for_each_entry(&self, hashes: &[ltk_hash::BinHash], visit: &mut dyn FnMut(usize, &str)) {
        for (at, hash) in hashes.iter().enumerate() {
            if hash.0 == SPELL_HASH {
                visit(at, "Characters/Ahri/Spells/AhriBasicAttack");
            }
        }
    }

    fn for_each_class(&self, _: &[ltk_hash::BinHash], _: &mut dyn FnMut(usize, &str)) {}

    fn for_each_field(&self, _: &[ltk_hash::BinHash], _: &mut dyn FnMut(usize, &str)) {}

    fn for_each_value(&self, hashes: &[ltk_hash::BinHash], visit: &mut dyn FnMut(usize, &str)) {
        for (at, hash) in hashes.iter().enumerate() {
            if hash.0 == SITUATION_HASH {
                visit(at, "SpellCast");
            }
        }
    }

    fn for_each_chunk(&self, _: &[ltk_hash::WadHash], _: &mut dyn FnMut(usize, &str)) {}
}

#[test]
fn sandbox_site_names_name_hash_from_values_then_entries() {
    use ltk_manager_audio::SiteNames as _;

    let lookup = OneFile {
        path: "data/characters/ahri/skins/skin0.bin",
        on_disk: "C:/mods/skin0.bin".to_owned(),
    };
    let names = references::SandboxSiteNames {
        names: &ContextualNames,
        assets: &lookup,
    };

    assert_eq!(
        names.hash_name(SITUATION_HASH).as_deref(),
        Some("SpellCast")
    );
    assert_eq!(
        names.hash_name(SPELL_HASH).as_deref(),
        Some("Characters/Ahri/Spells/AhriBasicAttack")
    );
    assert_eq!(names.hash_name(1), None);
    assert_eq!(
        names.locate("DATA/Characters/Ahri/Skins/Skin0.bin"),
        Some(AssetRef::File {
            path: "C:/mods/skin0.bin".to_owned()
        })
    );
}

#[test]
fn bank_references_of_loose_fixture_name_no_unit() {
    let dir = tempfile::tempdir().unwrap();
    let asset = loose(&dir, "map22_sfx_audio.wpk", PACKAGE);
    let mut builder = ltk_manager_audio::AudioIndex::builder();
    builder.add_bin(
        "data/maps/shipping/map22/map22.bin",
        ltk_manager_audio::BinAudio {
            units: vec![
                ltk_manager_audio::BankUnit {
                    name: "Map22_SFX".to_owned(),
                    bank_path: vec![
                        "assets/sounds/wwise2016/sfx/shared/map22_sfx_audio.wpk".to_owned()
                    ],
                    events: Vec::new(),
                    voice_over: false,
                }
                .into(),
            ],
            ..ltk_manager_audio::BinAudio::default()
        },
    );
    let index = builder.build();
    let lookup = OneFile {
        path: "unused",
        on_disk: String::new(),
    };
    let names = references::SandboxSiteNames {
        names: &OneChunkName,
        assets: &lookup,
    };

    let path = game_path(&asset, &OneChunkName);
    let references = ltk_manager_audio::BankReferences::of(&path, &[&index], &names);

    assert_eq!(path, "map22_sfx_audio.wpk");
    assert!(references.units.is_empty());
    assert!(references.lists.is_empty());
}

/// An index with one bank unit named `name`, declared by the bin `bin`.
fn index_with_unit(bin: &str, name: &str) -> ltk_manager_audio::AudioIndex {
    let mut builder = ltk_manager_audio::AudioIndex::builder();
    builder.add_bin(
        bin,
        ltk_manager_audio::BinAudio {
            units: vec![ltk_manager_audio::BankUnit {
                name: name.to_owned(),
                ..ltk_manager_audio::BankUnit::default()
            }
            .into()],
            ..ltk_manager_audio::BinAudio::default()
        },
    );
    builder.build()
}

const SYSTEM: &str = "Characters/Ahri/Skins/Skin7/Particles/Ahri_Skin07_Q";

#[test]
fn skin_units_read_units_of_skin_named_by_system_path() {
    let game = index_with_unit("data/characters/ahri/skins/skin7.bin", "Ahri_Skin07_SFX");
    let other = index_with_unit("data/characters/ahri/skins/skin8.bin", "Ahri_Skin08_SFX");

    let units = sounds::skin_units(&[SYSTEM.to_owned()], &[&other, &game]);

    let names: Vec<&str> = units.iter().map(|unit| unit.name.as_str()).collect();
    assert_eq!(names, ["Ahri_Skin07_SFX"]);
}

#[test]
fn skin_units_take_units_of_first_index_that_declares_skin() {
    const SKIN: &str = "data/characters/ahri/skins/skin7.bin";
    let project = index_with_unit(SKIN, "Ahri_Skin07_Project");
    let game = index_with_unit(SKIN, "Ahri_Skin07_SFX");

    let units = sounds::skin_units(&[SYSTEM.to_owned()], &[&project, &game]);

    let names: Vec<&str> = units.iter().map(|unit| unit.name.as_str()).collect();
    assert_eq!(names, ["Ahri_Skin07_Project"]);
}

const EVENTS_PATH: &str = "assets/sounds/wwise2016/sfx/shared/map22_sfx_events.bnk";

fn game_chunk() -> AssetRef {
    AssetRef::GameChunk {
        wad: "DATA/FINAL/Maps/Shipping/Map22.wad.client".to_owned(),
        path_hash: "0123456789abcdef".to_owned(),
    }
}

#[test]
fn layer_copy_places_game_chunk_in_base_layer_of_project() {
    let sandbox = SandboxRef::Project {
        project: "C:/mods/ward".to_owned(),
    };

    let copy = bank::layer_copy(&sandbox, &game_chunk(), EVENTS_PATH, "bnk").unwrap();

    assert_eq!(
        copy,
        Some(AssetRef::Layer {
            project: "C:/mods/ward".to_owned(),
            layer: "base".to_owned(),
            path: format!("Map22.wad.client/{EVENTS_PATH}"),
        })
    );
}

#[test]
fn layer_copy_names_unnamed_chunk_by_hash() {
    let sandbox = SandboxRef::Project {
        project: "C:/mods/ward".to_owned(),
    };

    let copy = bank::layer_copy(&sandbox, &game_chunk(), "0123456789abcdef", "bnk").unwrap();

    let Some(AssetRef::Layer { path, .. }) = copy else {
        panic!("not a layer file");
    };
    assert_eq!(path, "Map22.wad.client/0123456789abcdef.bnk");
}

#[test]
fn layer_copy_refuses_layer_subset() {
    let sandbox = SandboxRef::Layers {
        project: "C:/mods/ward".to_owned(),
        layers: vec!["chroma".to_owned()],
    };

    assert!(bank::layer_copy(&sandbox, &game_chunk(), EVENTS_PATH, "bnk").is_err());
}

#[test]
fn layer_copy_refuses_game_sandbox_and_skips_layer_file() {
    let layer = AssetRef::Layer {
        project: "C:/mods/ward".to_owned(),
        layer: "base".to_owned(),
        path: format!("Map22.wad.client/{EVENTS_PATH}"),
    };

    assert!(bank::layer_copy(&SandboxRef::Game, &game_chunk(), EVENTS_PATH, "bnk").is_err());
    assert_eq!(
        bank::layer_copy(&SandboxRef::Game, &layer, EVENTS_PATH, "bnk").unwrap(),
        None
    );
}
