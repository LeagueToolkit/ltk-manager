//! Unit tests for the base skins the rule reports and the ones it leaves alone.

use std::sync::Arc;

use fs_err as fs;
use indexmap::IndexMap;
use ltk_meta::property::values;
use ltk_meta::{Bin, PropertyKind};

use super::*;
use crate::game::FakeContent;
use crate::{FixFacts, SkinAudioRepair};
use ltk_manager_base::config::Config;

const WAD: &str = "Ahri.wad.client";
const SKIN0: &str = "data/characters/ahri/skins/skin0.bin";
const SKIN7: &str = "data/characters/ahri/skins/skin7.bin";
const BASE_SKL: &str = "assets/characters/ahri/skins/base/ahri.skl";
const BASE_SKN: &str = "assets/characters/ahri/skins/base/ahri.skn";
const SKIN7_SKL: &str = "assets/characters/ahri/skins/skin07/ahri_skin07.skl";
const SKIN7_SKN: &str = "assets/characters/ahri/skins/skin07/ahri_skin07.skn";
const CUSTOM_SKL: &str = "assets/characters/ahri/skins/base/custom.skl";
const CUSTOM_SKN: &str = "assets/characters/ahri/skins/base/custom.skn";

const BASE_SKL_BYTES: &[u8] = b"base skeleton";
const BASE_SKN_BYTES: &[u8] = b"base simple skin";
const SKIN7_SKL_BYTES: &[u8] = b"skin 7 skeleton!";
const SKIN7_SKN_BYTES: &[u8] = b"skin 7 simple skin";
const CUSTOM_SKL_BYTES: &[u8] = b"custom skeleton";
const CUSTOM_SKN_BYTES: &[u8] = b"custom simple skin";

const ANIMATIONS: &str = "data/characters/ahri/animations/skin0.bin";
const BASE_SFX_AUDIO: &str =
    "ASSETS/Sounds/Wwise2016/SFX/Characters/Ahri/Skins/Base/Ahri_Base_SFX_audio.bnk";
const BASE_SFX_EVENTS: &str =
    "ASSETS/Sounds/Wwise2016/SFX/Characters/Ahri/Skins/Base/Ahri_Base_SFX_events.bnk";
const BASE_VO_AUDIO: &str =
    "ASSETS/Sounds/Wwise2016/VO/en_US/Characters/Ahri/Skins/Base/Ahri_Base_VO_audio.wpk";
const SKIN7_SFX_AUDIO: &str =
    "ASSETS/Sounds/Wwise2016/SFX/Characters/Ahri/Skins/Skin07/Ahri_Skin07_SFX_audio.bnk";
const SKIN7_SFX_EVENTS: &str =
    "ASSETS/Sounds/Wwise2016/SFX/Characters/Ahri/Skins/Skin07/Ahri_Skin07_SFX_events.bnk";
const BASE_EVENT: &str = "Play_sfx_Ahri_BasicAttack_OnCast";
const SKIN7_MAPPED_EVENT: &str = "Play_sfx_AhriSkin07_BasicAttack_OnCast";
const SKIN7_DANCE_EVENT: &str = "Play_sfx_AhriSkin07_Dance3D_buffactivate";

fn string(value: &str) -> PropertyValueEnum {
    PropertyValueEnum::String(values::String::new(value.to_owned()))
}

fn embed(class: &str, properties: Vec<(&str, PropertyValueEnum)>) -> PropertyValueEnum {
    let properties: IndexMap<_, _> = properties
        .into_iter()
        .map(|(name, value)| (named(name), value))
        .collect();
    PropertyValueEnum::Embedded(values::Embedded(values::Struct {
        class_hash: named(class),
        properties,
    }))
}

fn list(kind: PropertyKind, items: Vec<PropertyValueEnum>) -> PropertyValueEnum {
    PropertyValueEnum::Container(values::Container::new(kind, items).unwrap())
}

/// The bytes of skin `skin` of Ahri, with its meshes and the extra properties `extra`.
fn skin_bin(skin: u32, skl: &str, skn: &str, extra: Vec<(&str, PropertyValueEnum)>) -> Vec<u8> {
    let mut object = BinObject::builder(
        skin_object("ahri", skin),
        named("SkinCharacterDataProperties"),
    )
    .property(
        named("SkinMeshProperties"),
        embed(
            "SkinMeshProperties",
            vec![("Skeleton", string(skl)), ("SimpleSkin", string(skn))],
        ),
    );
    for (name, value) in extra {
        object = object.property(named(name), value);
    }

    let bin = Bin::new([object.build()], std::iter::empty::<&str>());
    let mut out = std::io::Cursor::new(Vec::new());
    bin.to_writer(&mut out).unwrap();
    out.into_inner()
}

fn base() -> Vec<u8> {
    let audio = audio(
        &["Ahri"],
        vec![base_sfx_unit(), voice_over_unit("Ahri_Base_VO")],
    );
    skin_bin(0, BASE_SKL, BASE_SKN, vec![("SkinAudioProperties", audio)])
}

fn strings(values: &[&str]) -> PropertyValueEnum {
    list(
        PropertyKind::String,
        values.iter().map(|value| string(value)).collect(),
    )
}

/// A `BankUnit` named `name` that lists `paths` and `events`.
fn unit(name: &str, paths: &[&str], events: &[&str], voice_over: bool) -> PropertyValueEnum {
    embed(
        "BankUnit",
        vec![
            ("name", string(name)),
            ("bankPath", strings(paths)),
            ("events", strings(events)),
            (
                "voiceOver",
                PropertyValueEnum::Bool(values::Bool::new(voice_over)),
            ),
        ],
    )
}

fn base_sfx_unit() -> PropertyValueEnum {
    unit(
        "Ahri_Base_SFX",
        &[BASE_SFX_AUDIO, BASE_SFX_EVENTS],
        &[BASE_EVENT],
        false,
    )
}

fn skin7_sfx_unit() -> PropertyValueEnum {
    unit(
        "Ahri_Skin07_SFX",
        &[SKIN7_SFX_AUDIO, SKIN7_SFX_EVENTS],
        &[SKIN7_MAPPED_EVENT, SKIN7_DANCE_EVENT],
        false,
    )
}

fn voice_over_unit(name: &str) -> PropertyValueEnum {
    unit(name, &[BASE_VO_AUDIO], &["Play_vo_Ahri_Attack"], true)
}

/// A `SkinAudioProperties` with the tags `tags` and the units `units`.
fn audio(tags: &[&str], units: Vec<PropertyValueEnum>) -> PropertyValueEnum {
    embed(
        "SkinAudioProperties",
        vec![
            ("TagEventList", strings(tags)),
            ("BankUnits", list(PropertyKind::Embedded, units)),
        ],
    )
}

/// An install with Ahri's base skin and skin 7, with their meshes.
fn game() -> Arc<dyn GameContent> {
    FakeContent::containing_bytes(&[
        (SKIN0, &base()),
        (SKIN7, &skin_bin(7, SKIN7_SKL, SKIN7_SKN, Vec::new())),
        (BASE_SKL, BASE_SKL_BYTES),
        (BASE_SKN, BASE_SKN_BYTES),
        (SKIN7_SKL, SKIN7_SKL_BYTES),
        (SKIN7_SKN, SKIN7_SKN_BYTES),
    ])
}

/// A base skin that ships its own meshes, with the extra properties `extra`.
fn custom(extra: Vec<(&str, PropertyValueEnum)>) -> Vec<(String, Vec<u8>)> {
    vec![
        (in_layer(SKIN0), skin_bin(0, CUSTOM_SKL, CUSTOM_SKN, extra)),
        (in_layer(CUSTOM_SKL), CUSTOM_SKL_BYTES.to_vec()),
        (in_layer(CUSTOM_SKN), CUSTOM_SKN_BYTES.to_vec()),
    ]
}

fn in_layer(chunk: &str) -> String {
    format!("{WAD}/{chunk}")
}

fn tree(
    files: &[(String, Vec<u8>)],
    game: Option<Arc<dyn GameContent>>,
) -> (tempfile::TempDir, ProjectFiles) {
    let tmp = tempfile::tempdir().unwrap();
    for (path, bytes) in files {
        let at = tmp
            .path()
            .join("content")
            .join("base")
            .join(path.replace('/', std::path::MAIN_SEPARATOR_STR));
        fs::create_dir_all(at.parent().unwrap()).unwrap();
        fs::write(&at, bytes).unwrap();
    }

    let files = ProjectFiles::read(tmp.path(), &Config::default(), game).unwrap();
    (tmp, files)
}

fn found_in(files: &ProjectFiles) -> Vec<Problem> {
    let (problems, failed) = files.report(&[&BinSkinhack::new()]).finish();
    assert!(
        failed.is_empty(),
        "the fixture should read cleanly: {failed:?}"
    );
    problems
}

fn messages(problems: &[Problem]) -> Vec<&str> {
    problems
        .iter()
        .filter_map(|problem| problem.message.as_deref())
        .collect()
}

#[test]
fn base_skin_pointed_at_other_skin_meshes_is_reported() {
    let (_tmp, files) = tree(
        &[(
            in_layer(SKIN0),
            skin_bin(0, SKIN7_SKL, SKIN7_SKN, Vec::new()),
        )],
        Some(game()),
    );

    let problems = found_in(&files);

    assert_eq!(problems.len(), 1);
    assert_eq!(problems[0].rule, ID);
    assert_eq!(problems[0].severity, ProblemSeverity::Error);
    assert_eq!(problems[0].site.path, in_layer(SKIN0));
    assert_eq!(
        messages(&problems),
        ["SkinMeshProperties.Skeleton is the mesh of skin 7"]
    );
}

#[test]
fn base_skin_shipping_copy_of_other_skin_mesh_is_reported() {
    let (_tmp, files) = tree(
        &[
            (
                in_layer(SKIN0),
                skin_bin(0, CUSTOM_SKL, CUSTOM_SKN, Vec::new()),
            ),
            (in_layer(CUSTOM_SKL), CUSTOM_SKL_BYTES.to_vec()),
            (in_layer(CUSTOM_SKN), SKIN7_SKN_BYTES.to_vec()),
        ],
        Some(game()),
    );

    assert_eq!(
        messages(&found_in(&files)),
        ["SkinMeshProperties.SimpleSkin is the mesh of skin 7"]
    );
}

#[test]
fn base_skin_shipping_zero_padded_copy_of_other_skin_mesh_is_reported() {
    let mut padded = SKIN7_SKN_BYTES.to_vec();
    padded.extend_from_slice(&[0u8; 16]);
    let (_tmp, files) = tree(
        &[
            (
                in_layer(SKIN0),
                skin_bin(0, CUSTOM_SKL, CUSTOM_SKN, Vec::new()),
            ),
            (in_layer(CUSTOM_SKL), CUSTOM_SKL_BYTES.to_vec()),
            (in_layer(CUSTOM_SKN), padded),
        ],
        Some(game()),
    );

    assert_eq!(
        messages(&found_in(&files)),
        ["SkinMeshProperties.SimpleSkin is the mesh of skin 7"]
    );
}

#[test]
fn base_skin_shipping_zero_padded_skeleton_with_adjusted_size_header_is_reported() {
    let mut game_skl = Vec::new();
    game_skl.extend_from_slice(&16u32.to_le_bytes());
    game_skl.extend_from_slice(&0x22FD_4FC3_u32.to_le_bytes());
    game_skl.extend_from_slice(b"skin7skl");

    let mut padded_skl = game_skl.clone();
    padded_skl[..4].copy_from_slice(&32u32.to_le_bytes());
    padded_skl.extend_from_slice(&[0u8; 16]);

    let game = FakeContent::containing_bytes(&[
        (SKIN0, &base()),
        (SKIN7, &skin_bin(7, SKIN7_SKL, SKIN7_SKN, Vec::new())),
        (BASE_SKL, BASE_SKL_BYTES),
        (BASE_SKN, BASE_SKN_BYTES),
        (SKIN7_SKL, &game_skl),
        (SKIN7_SKN, SKIN7_SKN_BYTES),
    ]);
    let (_tmp, files) = tree(
        &[
            (
                in_layer(SKIN0),
                skin_bin(0, CUSTOM_SKL, CUSTOM_SKN, Vec::new()),
            ),
            (in_layer(CUSTOM_SKL), padded_skl),
            (in_layer(CUSTOM_SKN), CUSTOM_SKN_BYTES.to_vec()),
        ],
        Some(game),
    );

    assert_eq!(
        messages(&found_in(&files)),
        ["SkinMeshProperties.Skeleton is the mesh of skin 7"]
    );
}

/* The patcher allows a base skin that still renders a stock mesh, whatever it names. */
#[test]
fn base_skin_keeping_base_skeleton_is_not_reported() {
    let (_tmp, files) = tree(
        &[(
            in_layer(SKIN0),
            skin_bin(
                0,
                BASE_SKL,
                SKIN7_SKN,
                vec![("ChampionSkinName", string("AhriSkin7"))],
            ),
        )],
        Some(game()),
    );

    assert!(found_in(&files).is_empty());
}

#[test]
fn base_skin_naming_other_skin_is_reported() {
    let (_tmp, files) = tree(
        &custom(vec![("ChampionSkinName", string("AhriSkin07"))]),
        Some(game()),
    );

    assert_eq!(
        messages(&found_in(&files)),
        ["ChampionSkinName names another skin: AhriSkin07"]
    );
}

#[test]
fn base_skin_with_other_skin_audio_tag_is_reported() {
    let audio = embed(
        "SkinAudioProperties",
        vec![(
            "TagEventList",
            list(PropertyKind::String, vec![string("AhriSkin7")]),
        )],
    );
    let (_tmp, files) = tree(&custom(vec![("SkinAudioProperties", audio)]), Some(game()));

    assert_eq!(
        messages(&found_in(&files)),
        ["SkinAudioProperties.TagEventList names another skin: AhriSkin7"]
    );
}

#[test]
fn base_skin_with_other_skin_bank_unit_is_reported() {
    let unit = embed("BankUnit", vec![("Name", string("Ahri_Skin07_SFX"))]);
    let audio = embed(
        "SkinAudioProperties",
        vec![("BankUnits", list(PropertyKind::Embedded, vec![unit]))],
    );
    let (_tmp, files) = tree(&custom(vec![("SkinAudioProperties", audio)]), Some(game()));

    assert_eq!(
        messages(&found_in(&files)),
        ["SkinAudioProperties.BankUnits.Name names another skin: Ahri_Skin07_SFX"]
    );
}

#[test]
fn base_skin_with_other_skin_event_in_renamed_sfx_unit_is_reported() {
    let disguised = unit(
        "Ahri_Base_SFX",
        &[BASE_SFX_AUDIO, BASE_SFX_EVENTS],
        &[SKIN7_MAPPED_EVENT],
        false,
    );
    let (_tmp, files) = tree(&with_audio(audio(&["Ahri"], vec![disguised])), Some(game()));

    assert_eq!(
        messages(&found_in(&files)),
        ["SkinAudioProperties.BankUnits.Name names another skin: Ahri_Base_SFX"]
    );
}

#[test]
fn base_skin_with_other_skin_event_in_voice_over_unit_is_not_reported() {
    let vo = unit(
        "Ahri_Base_VO",
        &[BASE_VO_AUDIO],
        &["Play_vo_AhriSkin07_Attack"],
        true,
    );
    let (_tmp, files) = tree(
        &with_audio(audio(&["Ahri"], vec![base_sfx_unit(), vo])),
        Some(game()),
    );

    assert!(found_in(&files).is_empty());
}

#[test]
fn custom_base_skin_is_not_reported() {
    let (_tmp, files) = tree(
        &custom(vec![("ChampionSkinName", string("AhriSkin0"))]),
        Some(game()),
    );

    assert!(found_in(&files).is_empty());
}

#[test]
fn unmodified_base_skin_is_not_reported() {
    let (_tmp, files) = tree(&[(in_layer(SKIN0), base())], Some(game()));

    assert!(found_in(&files).is_empty());
}

#[test]
fn base_skin_is_not_reported_without_game() {
    let (_tmp, files) = tree(
        &[(
            in_layer(SKIN0),
            skin_bin(0, SKIN7_SKL, SKIN7_SKN, Vec::new()),
        )],
        None,
    );

    assert!(found_in(&files).is_empty());
}

#[test]
fn base_skin_outside_its_champion_wad_is_not_reported() {
    let (_tmp, files) = tree(
        &[(
            format!("Common.wad.client/{SKIN0}"),
            skin_bin(0, SKIN7_SKL, SKIN7_SKN, Vec::new()),
        )],
        Some(game()),
    );

    assert!(found_in(&files).is_empty());
}

#[test]
fn names_other_skin_matches_nonzero_skin_number() {
    assert!(names_other_skin("AatroxSkin07", "aatroxskin", ""));
    assert!(names_other_skin("AatroxSkin7", "aatroxskin", ""));
    assert!(names_other_skin("AatroxSkin123", "aatroxskin", ""));
    assert!(names_other_skin("Aatrox_Skin07_SFX", "aatrox_skin", "_sfx"));
}

#[test]
fn names_other_skin_ignores_base_skin_and_missing_suffix() {
    assert!(!names_other_skin("AatroxSkin0", "aatroxskin", ""));
    assert!(!names_other_skin("Aatrox", "aatroxskin", ""));
    assert!(!names_other_skin("Aatrox_Skin07_VO", "aatrox_skin", "_sfx"));
    assert!(!names_other_skin(
        "AatroxSkin99999999999999999999",
        "aatroxskin",
        ""
    ));
}

#[test]
fn names_other_skin_searches_past_first_match() {
    assert!(names_other_skin(
        "AatroxSkin0 AatroxSkin12",
        "aatroxskin",
        ""
    ));
}

/// The bytes of Ahri's base animation bin, with one clip that plays `event`.
fn animations(event: &str) -> Vec<u8> {
    let clip = embed("SoundEventData", vec![("mSoundName", string(event))]);
    let object = BinObject::builder(
        BinHash::from("Characters/Ahri/Animations/Skin0"),
        named("animationGraphData"),
    )
    .property(
        named("mClipDataMap"),
        list(PropertyKind::Embedded, vec![clip]),
    )
    .build();

    let bin = Bin::new([object], std::iter::empty::<&str>());
    let mut out = std::io::Cursor::new(Vec::new());
    bin.to_writer(&mut out).unwrap();
    out.into_inner()
}

/// A custom base skin with the audio `audio`.
fn with_audio(audio: PropertyValueEnum) -> Vec<(String, Vec<u8>)> {
    custom(vec![("SkinAudioProperties", audio)])
}

/// Returns the ids of the findings of the rule in `run`.
fn ids_of(run: &crate::Run) -> Vec<crate::ProblemId> {
    run.problems
        .iter()
        .filter(|problem| problem.rule == ID)
        .map(|problem| problem.id.clone())
        .collect()
}

/// Checks `files` and applies the fix of every finding of the rule.
fn repaired(tmp: &tempfile::TempDir, files: &ProjectFiles) -> crate::FixReport {
    let run = files.checked();
    let ids = ids_of(&run);
    assert!(!ids.is_empty(), "the fixture should be reported");

    crate::apply(
        tmp.path(),
        &run,
        &ids,
        &Config::default(),
        None,
        Some(game()),
    )
    .unwrap()
}

fn on_disk_path(tmp: &tempfile::TempDir, chunk: &str) -> std::path::PathBuf {
    tmp.path()
        .join("content")
        .join("base")
        .join(in_layer(chunk).replace('/', std::path::MAIN_SEPARATOR_STR))
}

fn on_disk(tmp: &tempfile::TempDir, chunk: &str) -> Vec<u8> {
    fs::read(on_disk_path(tmp, chunk)).unwrap()
}

/// The tags and the unit names of the skin object of the bin `bytes`.
fn audio_of(bytes: &[u8]) -> (Vec<String>, Vec<String>) {
    let bin = parse_bin(bytes).unwrap();
    let object = &bin.objects()[&skin_object("ahri", 0)];
    let audio = super::embed(object.properties.get(&named("SkinAudioProperties"))).unwrap();

    let tags = super::items(audio.properties.get(&named("TagEventList")))
        .iter()
        .filter_map(|tag| text(Some(tag)).map(str::to_owned))
        .collect();
    let units = super::items(audio.properties.get(&named("BankUnits")))
        .iter()
        .filter_map(|unit| super::embed(Some(unit)))
        .filter_map(|unit| text(unit.properties.get(&named("Name"))).map(str::to_owned))
        .collect();
    (tags, units)
}

/// The event that the clip of the animation bin `bytes` plays.
fn clip_event(bytes: &[u8]) -> String {
    let bin = parse_bin(bytes).unwrap();
    let object = bin.objects().values().next().unwrap();
    let clips = super::items(object.properties.get(&named("mClipDataMap")));
    let clip = super::embed(clips.first()).unwrap();
    text(clip.properties.get(&named("mSoundName")))
        .unwrap()
        .to_owned()
}

fn facts_of(problem: &Problem) -> Option<&SkinAudioRepair> {
    match problem.fix.as_ref()?.facts.as_ref()? {
        FixFacts::SkinAudio(repair) => Some(repair),
    }
}

fn owned(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}

#[test]
fn base_skin_with_other_skin_tag_and_bank_unit_reports_both() {
    let (_tmp, files) = tree(
        &with_audio(audio(&["Ahri", "AhriSkin7"], vec![skin7_sfx_unit()])),
        Some(game()),
    );

    assert_eq!(
        messages(&found_in(&files)),
        [
            "SkinAudioProperties.TagEventList names another skin: AhriSkin7. SkinAudioProperties.BankUnits.Name names another skin: Ahri_Skin07_SFX"
        ]
    );
}

#[test]
fn skinhack_fix_removes_other_skin_bank_unit() {
    let (tmp, files) = tree(
        &with_audio(audio(&["Ahri"], vec![skin7_sfx_unit(), base_sfx_unit()])),
        Some(game()),
    );

    let problems = found_in(&files);
    let report = repaired(&tmp, &files);

    assert_eq!(
        problems[0].fix,
        Some(FixPreview {
            note: None,
            facts: Some(FixFacts::SkinAudio(SkinAudioRepair {
                removed_units: owned(&["Ahri_Skin07_SFX"]),
                ..SkinAudioRepair::default()
            })),
            before: Some("Ahri_Skin07_SFX, Ahri_Base_SFX".to_owned()),
            after: Some("Ahri_Base_SFX".to_owned()),
        })
    );
    assert_eq!(report.applied, 1);
    assert_eq!(audio_of(&on_disk(&tmp, SKIN0)).1, ["Ahri_Base_SFX"]);
}

#[test]
fn skinhack_fix_removes_other_skin_tag() {
    let (tmp, files) = tree(
        &with_audio(audio(&["Ahri", "AhriSkin07"], vec![base_sfx_unit()])),
        Some(game()),
    );

    let problems = found_in(&files);
    let report = repaired(&tmp, &files);

    assert_eq!(
        problems[0].fix,
        Some(FixPreview {
            note: None,
            facts: Some(FixFacts::SkinAudio(SkinAudioRepair {
                removed_tags: owned(&["AhriSkin07"]),
                ..SkinAudioRepair::default()
            })),
            before: Some("Ahri, AhriSkin07".to_owned()),
            after: Some("Ahri".to_owned()),
        })
    );
    assert_eq!(report.applied, 1);
    assert_eq!(audio_of(&on_disk(&tmp, SKIN0)).0, ["Ahri"]);
}

#[test]
fn skinhack_fix_keeps_base_and_voice_over_units() {
    let units = vec![
        skin7_sfx_unit(),
        base_sfx_unit(),
        voice_over_unit("Ahri_Base_VO"),
    ];
    let (tmp, files) = tree(&with_audio(audio(&["Ahri"], units)), Some(game()));

    repaired(&tmp, &files);

    assert_eq!(
        audio_of(&on_disk(&tmp, SKIN0)).1,
        ["Ahri_Base_SFX", "Ahri_Base_VO"]
    );
}

#[test]
fn skinhack_fix_adds_base_unit_if_none_remains() {
    let units = vec![skin7_sfx_unit(), voice_over_unit("Ahri_Base_VO")];
    let (tmp, files) = tree(&with_audio(audio(&["Ahri"], units)), Some(game()));

    let problems = found_in(&files);
    repaired(&tmp, &files);

    assert_eq!(
        facts_of(&problems[0]),
        Some(&SkinAudioRepair {
            removed_units: owned(&["Ahri_Skin07_SFX"]),
            added_units: owned(&["Ahri_Base_SFX"]),
            ..SkinAudioRepair::default()
        })
    );
    assert_eq!(
        audio_of(&on_disk(&tmp, SKIN0)).1,
        ["Ahri_Base_VO", "Ahri_Base_SFX"]
    );
}

#[test]
fn skinhack_fix_rewrites_clip_event_with_base_event() {
    let mut layer = with_audio(audio(&["Ahri", "AhriSkin07"], vec![skin7_sfx_unit()]));
    layer.push((in_layer(ANIMATIONS), animations(SKIN7_MAPPED_EVENT)));
    let (tmp, files) = tree(&layer, Some(game()));

    let problems = found_in(&files);
    let report = repaired(&tmp, &files);

    assert_eq!(
        facts_of(&problems[0]),
        Some(&SkinAudioRepair {
            removed_units: owned(&["Ahri_Skin07_SFX"]),
            removed_tags: owned(&["AhriSkin07"]),
            added_units: owned(&["Ahri_Base_SFX"]),
            renamed_events: 1,
            ..SkinAudioRepair::default()
        })
    );
    assert_eq!(report.applied, 1);
    assert_eq!(clip_event(&on_disk(&tmp, ANIMATIONS)), BASE_EVENT);
}

#[test]
fn skinhack_fix_keeps_clip_event_without_base_event() {
    let mut layer = with_audio(audio(
        &["Ahri", "AhriSkin07"],
        vec![skin7_sfx_unit(), base_sfx_unit()],
    ));
    layer.push((in_layer(ANIMATIONS), animations(SKIN7_DANCE_EVENT)));
    let (tmp, files) = tree(&layer, Some(game()));

    let problems = found_in(&files);
    let report = repaired(&tmp, &files);

    assert_eq!(
        problems[0].fix,
        Some(FixPreview {
            note: None,
            facts: Some(FixFacts::SkinAudio(SkinAudioRepair {
                removed_units: owned(&["Ahri_Skin07_SFX"]),
                removed_tags: owned(&["AhriSkin07"]),
                silent_clip_events: 1,
                ..SkinAudioRepair::default()
            })),
            before: Some("Ahri, AhriSkin07".to_owned()),
            after: Some("Ahri".to_owned()),
        })
    );
    assert_eq!(clip_event(&on_disk(&tmp, ANIMATIONS)), SKIN7_DANCE_EVENT);
    assert!(
        report
            .files
            .iter()
            .all(|file| file.path != in_layer(ANIMATIONS)),
        "the animation bin was written: {:?}",
        report.files
    );
}

#[test]
fn skinhack_fix_removes_shipped_bank_of_removed_unit() {
    let bank = SKIN7_SFX_AUDIO.to_ascii_lowercase();
    let mut layer = with_audio(audio(&["Ahri"], vec![skin7_sfx_unit(), base_sfx_unit()]));
    layer.push((in_layer(&bank), b"BKHD".to_vec()));
    let (tmp, files) = tree(&layer, Some(game()));

    let report = repaired(&tmp, &files);

    assert_eq!(report.applied, 1);
    assert!(
        !on_disk_path(&tmp, &bank).exists(),
        "the bank is still there"
    );
}

#[test]
fn skinhack_fix_refuses_mesh_evidence() {
    let (_tmp, files) = tree(
        &[(
            in_layer(SKIN0),
            skin_bin(
                0,
                SKIN7_SKL,
                SKIN7_SKN,
                vec![("SkinAudioProperties", audio(&["AhriSkin7"], Vec::new()))],
            ),
        )],
        Some(game()),
    );

    let problems = found_in(&files);

    assert_eq!(problems.len(), 1);
    assert_eq!(problems[0].fix, None);
}

#[test]
fn skinhack_fix_refuses_champion_skin_name_evidence() {
    let (_tmp, files) = tree(
        &custom(vec![
            ("ChampionSkinName", string("AhriSkin07")),
            ("SkinAudioProperties", audio(&["AhriSkin7"], Vec::new())),
        ]),
        Some(game()),
    );

    let problems = found_in(&files);

    assert_eq!(problems.len(), 1);
    assert_eq!(problems[0].fix, None);
}

#[test]
fn skinhack_fix_skips_bin_changed_since_check() {
    let (tmp, files) = tree(
        &with_audio(audio(&["Ahri", "AhriSkin7"], vec![base_sfx_unit()])),
        Some(game()),
    );
    let run = files.checked();
    let ids = ids_of(&run);

    let changed = skin_bin(
        0,
        CUSTOM_SKL,
        CUSTOM_SKN,
        vec![(
            "SkinAudioProperties",
            audio(&["Ahri", "AhriSkin8"], vec![base_sfx_unit()]),
        )],
    );
    fs::write(on_disk_path(&tmp, SKIN0), &changed).unwrap();

    let report = crate::apply(
        tmp.path(),
        &run,
        &ids,
        &Config::default(),
        None,
        Some(game()),
    )
    .unwrap();

    assert_eq!((report.applied, report.skipped), (0, 1));
    assert_eq!(on_disk(&tmp, SKIN0), changed);
}

#[test]
fn skinhack_fixed_bin_is_not_reported() {
    let mut layer = with_audio(audio(
        &["Ahri", "AhriSkin07"],
        vec![skin7_sfx_unit(), voice_over_unit("Ahri_Base_VO")],
    ));
    layer.push((in_layer(ANIMATIONS), animations(SKIN7_MAPPED_EVENT)));
    let (tmp, files) = tree(&layer, Some(game()));

    repaired(&tmp, &files);
    let again = ProjectFiles::read(tmp.path(), &Config::default(), Some(game())).unwrap();

    assert!(found_in(&again).is_empty());
}

#[test]
fn skinhack_fix_writes_held_archive() {
    let (_tmp, files) = tree(
        &with_audio(audio(
            &["Ahri", "AhriSkin07"],
            vec![skin7_sfx_unit(), base_sfx_unit()],
        )),
        Some(game()),
    );
    let run = files.checked();
    let ids = ids_of(&run);

    let (report, writes) = crate::apply_held(
        files,
        Vec::new(),
        &run,
        &ids,
        &Config::default(),
        None,
        Some(game()),
    )
    .unwrap();

    assert_eq!(report.applied, 1);
    let written = writes.bytes("base", &in_layer(SKIN0)).unwrap();
    assert_eq!(
        audio_of(written),
        (vec!["Ahri".to_owned()], vec!["Ahri_Base_SFX".to_owned()])
    );
}
