use std::io::Cursor;

use glam::vec3;
use ltk_hash::{Hash as _, WadHash};
use ltk_meta::property::{Kind, values};
use ltk_meta::{Bin, BinObject};

use super::effects::{
    BONE_NAME, EFFECT_NAME, PERSISTENT_CONDITIONS, PERSISTENT_VFXS, POSITION, SUBMESHES_TO_HIDE,
    SUBMESHES_TO_SHOW, TARGET_BONE_NAME,
};
use super::*;
use crate::lookup::ObjectLookup;
use crate::resolver::{EFFECT_KEY, RESOURCE_MAP};
use ltk_manager_assets::preview::AssetRef;

use crate::material::{BaseRule, Blending};

const BODY_MATERIAL: &str = "Characters/Ahri/Skins/Skin3/Materials/Body";
const WINGS_MATERIAL: &str = "Characters/Ahri/Skins/Skin3/Materials/Wings";
const WINGS: &str = "ASSETS/Characters/Ahri/Skins/Skin03/Wings_TX_CM.tex";

fn h(text: &str) -> BinHash {
    BinHash::hash_str(text)
}

const SKIN: &str = "Characters/Ahri/Skins/Skin3";
const RESOLVER: &str = "Characters/Ahri/Skins/Skin3/Resources";
const SYSTEM: &str = "Characters/Ahri/Skins/Skin3/Particles/Ahri_Skin03_Tail";
const GRAPH: &str = "Characters/Ahri/Animations/Skin3";
const SKN: &str = "ASSETS/Characters/Ahri/Skins/Skin03/Ahri_Skin03.skn";
const SKL: &str = "ASSETS/Characters/Ahri/Skins/Skin03/Ahri_Skin03.skl";
const CAPE: &str = "ASSETS/Characters/Ahri/Skins/Skin03/Cape_TX_CM.tex";
const IDLE: &str = "ASSETS/Characters/Ahri/Skins/Skin03/Animations/Idle1.anm";
const ATTACK: &str = "assets/characters/ahri/skins/skin03/animations/attack1.anm";
const ATTACK_CHUNK: u64 = 0x0123_4567_89ab_cdef;
const UNNAMED_CHUNK: u64 = 0xfeed_face_cafe_beef;

fn embedded(class: &str, properties: Vec<(BinHash, PropertyValueEnum)>) -> values::Embedded {
    values::Embedded(values::Struct {
        class_hash: h(class),
        properties: properties.into_iter().collect(),
    })
}

fn pointer(class: &str, properties: Vec<(BinHash, PropertyValueEnum)>) -> PropertyValueEnum {
    values::Struct {
        class_hash: h(class),
        properties: properties.into_iter().collect(),
    }
    .into()
}

fn idle(key: &str, bone: &str, position: [f32; 3]) -> values::Embedded {
    embedded(
        "SkinCharacterDataProperties_CharacterIdleEffect",
        vec![
            (EFFECT_KEY, values::Hash::new(h(key)).into()),
            (BONE_NAME, values::String::from(bone).into()),
            (TARGET_BONE_NAME, values::String::from("").into()),
            (
                POSITION,
                values::Vector3::new(vec3(position[0], position[1], position[2])).into(),
            ),
        ],
    )
}

fn skin() -> BinObject {
    BinObject::builder(h(SKIN), h("SkinCharacterDataProperties"))
        .property(
            MESH_PROPERTIES,
            embedded(
                "SkinMeshDataProperties",
                vec![
                    (SIMPLE_SKIN, values::String::from(SKN).into()),
                    (SKELETON, values::String::from(SKL).into()),
                    (TEXTURE, values::WadChunkLink::new(UNNAMED_CHUNK).into()),
                    (SKIN_SCALE, values::F32::new(1.5).into()),
                    (SELF_ILLUMINATION, values::F32::new(0.75).into()),
                    (
                        HIDDEN_SUBMESHES,
                        values::String::from("Wings, Cape  Hat").into(),
                    ),
                    (
                        MATERIAL_OVERRIDE,
                        values::Container::from(vec![
                            embedded(
                                "SkinMeshDataProperties_MaterialOverride",
                                vec![
                                    (SUBMESH, values::String::from("Cape").into()),
                                    (TEXTURE, values::String::from(CAPE).into()),
                                ],
                            ),
                            embedded(
                                "SkinMeshDataProperties_MaterialOverride",
                                vec![
                                    (SUBMESH, values::String::from("Wings").into()),
                                    (MATERIAL, values::ObjectLink::new(h(WINGS_MATERIAL)).into()),
                                ],
                            ),
                            embedded(
                                "SkinMeshDataProperties_MaterialOverride",
                                vec![(SUBMESH, values::String::from("Hat").into())],
                            ),
                        ])
                        .into(),
                    ),
                ],
            ),
        )
        .property(
            ANIMATION_PROPERTIES,
            embedded(
                "SkinAnimationProperties",
                vec![(ANIMATION_GRAPH, values::ObjectLink::new(h(GRAPH)).into())],
            ),
        )
        .property(RESOURCE_RESOLVER, values::ObjectLink::new(h(RESOLVER)))
        .property(
            IDLE_EFFECTS,
            values::Container::from(vec![
                idle("Tail", "Tail_Base", [0.0, 10.0, 0.0]),
                idle("Unmapped", "Root", [0.0; 3]),
            ]),
        )
        .build()
}

/// The wings material: one colour map, alpha blended, in the shape the exporter writes.
fn wings_material() -> BinObject {
    let sampler = embedded(
        "StaticMaterialShaderSamplerDef",
        vec![
            (
                h("TextureName"),
                values::String::from("Diffuse_Texture").into(),
            ),
            (
                h("texturePath"),
                values::WadChunkLink::new(WadHash::hash_str(WINGS).0).into(),
            ),
        ],
    );
    let pass = embedded(
        "StaticMaterialPassDef",
        vec![
            (
                h("shader"),
                values::ObjectLink::new(h("Shaders/SkinnedMesh/Diffuse")).into(),
            ),
            (h("blendEnable"), values::Bool::new(true).into()),
        ],
    );
    let technique = embedded(
        "StaticMaterialTechniqueDef",
        vec![
            (h("name"), values::String::from("normal").into()),
            (h("passes"), values::Container::from(vec![pass]).into()),
        ],
    );
    BinObject::builder(h(WINGS_MATERIAL), h("StaticMaterialDef"))
        .property(h("samplerValues"), values::Container::from(vec![sampler]))
        .property(h("techniques"), values::Container::from(vec![technique]))
        .build()
}

fn resolver() -> BinObject {
    BinObject::builder(h(RESOLVER), h("ResourceResolver"))
        .property(
            RESOURCE_MAP,
            values::Map::new(
                Kind::Hash,
                Kind::ObjectLink,
                vec![
                    (
                        values::Hash::new(h("Tail")).into(),
                        values::ObjectLink::new(h(SYSTEM)).into(),
                    ),
                    (
                        values::Hash::new(h("Tail")).into(),
                        values::ObjectLink::new(h("Somewhere/Else")).into(),
                    ),
                ],
            )
            .unwrap(),
        )
        .build()
}

fn system() -> BinObject {
    BinObject::builder(h(SYSTEM), h("VfxSystemDefinitionData")).build()
}

fn hash_of(name: &str) -> PropertyValueEnum {
    values::Hash::new(h(name)).into()
}

fn hashes(names: &[&str]) -> PropertyValueEnum {
    values::Container::from(
        names
            .iter()
            .map(|name| values::Hash::new(h(name)))
            .collect::<Vec<_>>(),
    )
    .into()
}

/// A list of pair structs, each naming a clip under `field`.
fn pairs(class: &str, field: &str, names: &[&str]) -> PropertyValueEnum {
    values::Container::from(
        names
            .iter()
            .map(|name| embedded(class, vec![(h(field), hash_of(name))]))
            .collect::<Vec<_>>(),
    )
    .into()
}

/// A parametric clip's pairs, each naming a clip and the `mValue` it plays at.
fn parametric_pairs(pairs: &[(&str, f32)]) -> PropertyValueEnum {
    values::Container::from(
        pairs
            .iter()
            .map(|(name, value)| {
                embedded(
                    "ParametricPairData",
                    vec![
                        (h("mClipName"), hash_of(name)),
                        (h("mValue"), values::F32::new(*value).into()),
                    ],
                )
            })
            .collect::<Vec<_>>(),
    )
    .into()
}

fn key_map(entries: Vec<(&str, PropertyValueEnum)>) -> PropertyValueEnum {
    values::Map::new(
        Kind::Hash,
        Kind::Struct,
        entries
            .into_iter()
            .map(|(key, value)| (hash_of(key), value))
            .collect(),
    )
    .unwrap()
    .into()
}

fn embed_map(entries: Vec<(&str, values::Embedded)>) -> PropertyValueEnum {
    values::Map::new(
        Kind::Hash,
        Kind::Embedded,
        entries
            .into_iter()
            .map(|(key, value)| (hash_of(key), value.into()))
            .collect(),
    )
    .unwrap()
    .into()
}

/// A graph holding a clip of every kind, each naming the clips it plays.
///
/// `Idle1` keys a declared track and an undeclared mask. `Attack1` is keyed by a chunk
/// no table names. `Run_Selector` picks `Run` out of one pair.
fn graph() -> BinObject {
    let atomic = |path: PropertyValueEnum, track: &str| {
        pointer(
            "AtomicClipData",
            vec![
                (
                    ANIMATION_RESOURCE,
                    embedded("AnimationResourceData", vec![(ANIMATION_FILE, path)]).into(),
                ),
                (TICK_DURATION, values::F32::new(1.0 / 30.0).into()),
                (TRACK_DATA_NAME, hash_of(track)),
                (MASK_DATA_NAME, hash_of("UpperBody")),
                (
                    EVENT_DATA_MAP,
                    key_map(vec![
                        (
                            "Hit",
                            pointer(
                                "ParticleEventData",
                                vec![
                                    (EVENT_START_FRAME, values::F32::new(12.0).into()),
                                    (EVENT_END_FRAME, values::F32::new(40.0).into()),
                                    (EVENT_EFFECT_KEY, hash_of("Tail")),
                                    (EVENT_EFFECT_NAME, values::String::from("Tail_Flash").into()),
                                    (
                                        EVENT_PAIRS,
                                        values::Container::from(vec![embedded(
                                            "ParticleEventDataPair",
                                            vec![
                                                (EVENT_BONE, hash_of("Tail_Base")),
                                                (EVENT_TARGET_BONE, hash_of("Head")),
                                            ],
                                        )])
                                        .into(),
                                    ),
                                    (EVENT_IS_LOOP, values::Bool::new(true).into()),
                                    (EVENT_SCALE, values::F32::new(2.0).into()),
                                ],
                            ),
                        ),
                        ("Swing", pointer("SoundEventData", vec![])),
                        (
                            "Lean",
                            pointer(
                                "ConformToPathEventData",
                                vec![
                                    (EVENT_START_FRAME, values::F32::new(2.0).into()),
                                    (MASK_DATA_NAME, hash_of("UpperBody")),
                                    (EVENT_BLEND_IN, values::F32::new(0.25).into()),
                                    (EVENT_BLEND_OUT, values::F32::new(0.5).into()),
                                ],
                            ),
                        ),
                        (
                            "Grip",
                            pointer(
                                "JointSnapEventData",
                                vec![
                                    (EVENT_START_FRAME, values::F32::new(5.0).into()),
                                    (EVENT_END_FRAME, values::F32::new(9.0).into()),
                                    (EVENT_JOINT, hash_of("Buffbone_Weapon")),
                                    (EVENT_SNAP_TO, hash_of("R_Hand")),
                                    (
                                        EVENT_OFFSET,
                                        values::Vector3::new(vec3(1.0, 2.0, 3.0)).into(),
                                    ),
                                ],
                            ),
                        ),
                        (
                            "Wings",
                            pointer(
                                "SubmeshVisibilityEventData",
                                vec![
                                    (EVENT_START_FRAME, values::F32::new(3.0).into()),
                                    (EVENT_SHOW_SUBMESHES, hashes(&["Wings"])),
                                    (EVENT_HIDE_SUBMESHES, hashes(&["Cape", "Hat"])),
                                ],
                            ),
                        ),
                    ]),
                ),
                (INTERRUPTION_GROUPS, hashes(&["Attack1"])),
                (FLAGS, values::U32::new(3).into()),
            ],
        )
    };

    BinObject::builder(h(GRAPH), h("AnimationGraphData"))
        .property(
            CLIP_DATA_MAP,
            key_map(vec![
                (
                    "Idle1",
                    atomic(values::String::from(IDLE).into(), "Default"),
                ),
                (
                    "Run_Selector",
                    pointer(
                        "SelectorClipData",
                        vec![(
                            h("mSelectorPairDataList"),
                            pairs("SelectorPairData", "mClipName", &["Run", "Nowhere"]),
                        )],
                    ),
                ),
                (
                    "Attack1",
                    atomic(values::WadChunkLink::new(ATTACK_CHUNK).into(), "Gone"),
                ),
                (
                    "Run",
                    pointer(
                        "ParametricClipData",
                        vec![(
                            h("mParametricPairDataList"),
                            parametric_pairs(&[("Idle1", -180.0), ("Attack1", 90.0)]),
                        )],
                    ),
                ),
                (
                    "Crouch",
                    pointer(
                        "ConditionBoolClipData",
                        vec![
                            (h("mTrueConditionClipName"), hash_of("Idle1")),
                            (h("mFalseConditionClipName"), hash_of("Attack1")),
                        ],
                    ),
                ),
                (
                    "Dance",
                    pointer(
                        "ConditionFloatClipData",
                        vec![(
                            h("mConditionFloatPairDataList"),
                            pairs("ConditionFloatPairData", "mClipName", &["Idle1"]),
                        )],
                    ),
                ),
                (
                    "Combo",
                    pointer(
                        "SequencerClipData",
                        vec![
                            (h("mClipNameList"), hashes(&["Attack1", "Idle1"])),
                            (
                                EVENT_DATA_MAP,
                                key_map(vec![("Hit", pointer("SoundEventData", vec![]))]),
                            ),
                        ],
                    ),
                ),
                (
                    "Both",
                    pointer(
                        "ParallelClipData",
                        vec![(h("mClipNameList"), hashes(&["Idle1"]))],
                    ),
                ),
                (
                    "Taunt",
                    pointer(
                        "EventControlledSelectorClipData",
                        vec![
                            (
                                h("SelectorPairDataList"),
                                pairs("EventControlledSelectorPairData", "ClipName", &["Run"]),
                            ),
                            (h("DefaultClipName"), hash_of("Idle1")),
                        ],
                    ),
                ),
                (
                    "Stance",
                    pointer(
                        "StateAnimClipData",
                        vec![
                            (h("ChildClipName"), hash_of("Idle1")),
                            (
                                h("Transitions"),
                                pairs("StateAnimTransitionData", "TargetClipName", &["Run"]),
                            ),
                        ],
                    ),
                ),
                (
                    "Form",
                    pointer(
                        "SwitchIntClipData",
                        vec![(
                            h("SwitchIntPairDataList"),
                            pairs("SwitchIntPairData", "ClipName", &["Idle1", "Attack1"]),
                        )],
                    ),
                ),
            ]),
        )
        .property(
            TRACK_DATA_MAP,
            embed_map(vec![(
                "Default",
                embedded(
                    "TrackData",
                    vec![
                        (TRACK_PRIORITY, values::U8::new(2).into()),
                        (TRACK_BLEND_MODE, values::U8::new(1).into()),
                        (TRACK_BLEND_WEIGHT, values::F32::new(0.5).into()),
                    ],
                ),
            )]),
        )
        .property(
            MASK_DATA_MAP,
            embed_map(vec![(
                "Unnamed_Mask",
                embedded(
                    "MaskData",
                    vec![
                        (MASK_ID, values::U32::new(7).into()),
                        (
                            MASK_WEIGHTS,
                            values::Container::from(vec![
                                values::F32::new(1.0),
                                values::F32::new(0.0),
                                values::F32::new(1.0),
                            ])
                            .into(),
                        ),
                    ],
                ),
            )]),
        )
        .property(
            SYNC_GROUP_DATA_MAP,
            embed_map(vec![(
                "Locomotion",
                embedded(
                    "SyncGroupData",
                    vec![(SYNC_GROUP_TYPE, values::U32::new(1).into())],
                ),
            )]),
        )
        .build()
}

fn document_of(objects: Vec<BinObject>) -> BinDocument {
    document_linking(objects, &[])
}

fn document_linking(objects: Vec<BinObject>, dependencies: &[&str]) -> BinDocument {
    let mut bin = Bin::builder().dependencies(dependencies.iter().copied());
    for object in objects {
        bin = bin.object(object);
    }
    let mut out = Cursor::new(Vec::new());
    bin.build().to_writer(&mut out).unwrap();
    BinDocument::parse(out.into_inner()).unwrap()
}

/// Tables that name the clip keys and one chunk, and nothing else.
struct Tables;

impl RowNames for Tables {
    fn for_each_entry(&self, _hashes: &[BinHash], _visit: &mut dyn FnMut(usize, &str)) {}

    fn for_each_class(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        for (at, hash) in hashes.iter().enumerate() {
            if *hash == h("AtomicClipData") {
                visit(at, "AtomicClipData");
            }
        }
    }

    fn for_each_field(&self, _hashes: &[BinHash], _visit: &mut dyn FnMut(usize, &str)) {}

    fn for_each_value(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        for (at, hash) in hashes.iter().enumerate() {
            for name in ["Idle1", "Attack1", "Run", "Default", "Locomotion"] {
                if *hash == h(name) {
                    visit(at, name);
                }
            }
        }
    }

    fn for_each_chunk(&self, hashes: &[WadHash], visit: &mut dyn FnMut(usize, &str)) {
        for (at, hash) in hashes.iter().enumerate() {
            if hash.0 == ATTACK_CHUNK {
                visit(at, ATTACK);
            }
            if *hash == WadHash::hash_str(WINGS) {
                visit(at, WINGS);
            }
        }
    }
}

/// A lookup that places every path this file names but the skeleton, and the one chunk
/// no table names.
struct Placed;

impl AssetLookup for Placed {
    fn locate(&self, path: &str) -> Option<AssetRef> {
        (!path.eq_ignore_ascii_case(SKL)).then(|| AssetRef::File {
            path: path.to_lowercase(),
        })
    }

    fn locate_chunk(&self, hash: WadHash) -> Option<AssetRef> {
        (hash.0 == UNNAMED_CHUNK).then(|| AssetRef::GameChunk {
            wad: "Champions/Ahri.wad.client".to_owned(),
            path_hash: format!("{UNNAMED_CHUNK:016x}"),
        })
    }
}

fn read_skin() -> SkinModel {
    let document = document_of(vec![skin(), resolver(), system(), wings_material()]);
    resolve_skin(&document, h(SKIN), &Tables, &Placed, None).unwrap()
}

fn file(path: &str) -> Option<AssetRef> {
    Some(AssetRef::File {
        path: path.to_lowercase(),
    })
}

#[test]
fn a_skin_names_its_mesh_and_its_skeleton() {
    let skin = read_skin();

    assert_eq!(
        skin.mesh,
        Some(NamedAsset {
            path: SKN.to_owned(),
            asset: file(SKN),
        })
    );
    assert_eq!(
        skin.skeleton,
        Some(NamedAsset {
            path: SKL.to_owned(),
            asset: None,
        }),
        "a path nothing holds is a path and no asset rather than a failure"
    );
}

/// A chunk no table names has only its hash for a path, and the hash still places it.
#[test]
fn an_unnamed_chunk_keeps_its_hash_for_a_path_and_is_placed_by_it() {
    let skin = read_skin();

    assert_eq!(
        skin.texture,
        Some(NamedAsset {
            path: format!("{UNNAMED_CHUNK:016x}"),
            asset: Some(AssetRef::GameChunk {
                wad: "Champions/Ahri.wad.client".to_owned(),
                path_hash: format!("{UNNAMED_CHUNK:016x}"),
            }),
        })
    );
}

/// An override naming neither a texture nor a material is no override at all.
#[test]
fn an_override_gives_its_submesh_a_texture_or_a_material() {
    let skin = read_skin();

    assert_eq!(skin.overrides.len(), 2);
    assert_eq!(skin.overrides[0].submesh, "Cape");
    assert_eq!(
        skin.overrides[0].texture,
        Some(NamedAsset {
            path: CAPE.to_owned(),
            asset: file(CAPE),
        })
    );
    assert_eq!(skin.overrides[0].material, None);

    let wings = &skin.overrides[1];
    assert_eq!(wings.submesh, "Wings");
    assert_eq!(wings.texture, None);
    let material = wings.material.as_ref().expect("the wings' material");
    assert_eq!(material.hash, hex(h(WINGS_MATERIAL)));
    assert!(!material.missing);
    let base = material.base.as_ref().expect("the wings' base texture");
    assert_eq!(base.rule, BaseRule::Exact);
    assert_eq!(base.texture.asset, file(WINGS));
    assert_eq!(
        material.render_state.blending,
        Blending::Opaque,
        "the pass blends, and nothing says the material reads an alpha"
    );
}

/// The skin's own `Material` is read like an override's, and a link the document does
/// not declare comes back as an error material rather than as nothing.
#[test]
fn the_skins_material_link_is_read_and_a_missing_one_is_an_error_material() {
    let mesh = embedded(
        "SkinMeshDataProperties",
        vec![(MATERIAL, values::ObjectLink::new(h(BODY_MATERIAL)).into())],
    );
    let bare = BinObject::builder(h(SKIN), h("SkinCharacterDataProperties"))
        .property(MESH_PROPERTIES, mesh)
        .build();
    let document = document_of(vec![bare]);

    let skin = resolve_skin(&document, h(SKIN), &Tables, &Placed, None).unwrap();

    let material = skin.material.expect("the skin's material");
    assert!(material.missing);
    assert_eq!(material.hash, hex(h(BODY_MATERIAL)));
}

#[test]
fn the_hidden_submeshes_are_read_apart_on_spaces_and_commas() {
    let skin = read_skin();

    assert_eq!(skin.hidden, ["Wings", "Cape", "Hat"]);
    assert!((skin.scale - 1.5).abs() < f32::EPSILON);
    assert!((skin.self_illumination - 0.75).abs() < f32::EPSILON);
}

#[test]
fn a_skin_names_its_animation_graph() {
    assert_eq!(read_skin().animation_graph, Some(hex(h(GRAPH))));
}

#[test]
fn idle_effect_reads_key_bone_and_offset() {
    let effects = read_skin().idle_effects;

    assert_eq!(effects.len(), 2);
    assert_eq!(effects[0].effect_key, hex(h("Tail")));
    assert_eq!(effects[0].bone, "Tail_Base");
    assert_eq!(effects[0].position, [0.0, 10.0, 0.0]);
    assert_eq!(effects[1].effect_key, hex(h("Unmapped")));
}

#[test]
fn idle_effect_keys_by_effect_name_without_effect_key() {
    let named_only = embedded(
        "SkinCharacterDataProperties_CharacterIdleEffect",
        vec![
            (EFFECT_NAME, values::String::from("Tail").into()),
            (BONE_NAME, values::String::from("Root").into()),
        ],
    );
    let skin = BinObject::builder(h(SKIN), h("SkinCharacterDataProperties"))
        .property(RESOURCE_RESOLVER, values::ObjectLink::new(h(RESOLVER)))
        .property(IDLE_EFFECTS, values::Container::from(vec![named_only]))
        .build();
    let document = document_of(vec![skin, resolver(), system()]);

    let effects = resolve_skin(&document, h(SKIN), &Tables, &Placed, None)
        .unwrap()
        .idle_effects;

    assert_eq!(effects[0].effect_key, hex(h("Tail")));
}

/// A persistent condition lists its effects as an idle effect is listed, and its submeshes
/// as the hashes the file holds.
#[test]
fn a_persistent_condition_lists_its_effects_and_submeshes() {
    let vfx = |key: &str, bone: &str| {
        embedded(
            "PersistentVfxData",
            vec![
                (EFFECT_KEY, values::Hash::new(h(key)).into()),
                (BONE_NAME, values::String::from(bone).into()),
            ],
        )
    };
    let condition = values::Struct {
        class_hash: h("PersistentEffectConditionData"),
        properties: [
            (
                h("OwnerCondition"),
                pointer("HasBuffDynamicMaterialBoolDriver", Vec::new()),
            ),
            (
                PERSISTENT_VFXS,
                values::Container::from(vec![vfx("Tail", "Tail_Base"), vfx("Unmapped", "Root")])
                    .into(),
            ),
            (SUBMESHES_TO_SHOW, hashes(&["Wings"])),
            (SUBMESHES_TO_HIDE, hashes(&["Cape", "Hat"])),
        ]
        .into_iter()
        .collect(),
    };
    let skin = BinObject::builder(h(SKIN), h("SkinCharacterDataProperties"))
        .property(RESOURCE_RESOLVER, values::ObjectLink::new(h(RESOLVER)))
        .property(
            PERSISTENT_CONDITIONS,
            values::Container::from(vec![condition]),
        )
        .build();
    let document = document_of(vec![skin, resolver(), system()]);

    let conditions = resolve_skin(&document, h(SKIN), &Tables, &Placed, None)
        .unwrap()
        .persistent_conditions;

    assert_eq!(conditions.len(), 1);
    let [tail, unmapped] = conditions[0].effects.as_slice() else {
        panic!("expected two effects, got {:?}", conditions[0].effects);
    };
    assert_eq!(tail.effect_key, hex(h("Tail")));
    assert_eq!(tail.bone, "Tail_Base");
    assert_eq!(tail.position, [0.0; 3]);
    assert_eq!(unmapped.bone, "Root");
    assert_eq!(conditions[0].shown, [hex(h("Wings"))]);
    assert_eq!(conditions[0].hidden, [hex(h("Cape")), hex(h("Hat"))]);
}

/// The resolver's map crosses with the skin, less the keys mapping to nothing this document
/// declares, so a particle event of the graph reaches its system by its key.
#[test]
fn a_skin_lists_the_systems_its_resolver_declares() {
    assert_eq!(
        read_skin().effect_systems,
        [EffectSystem {
            key: hex(h("Tail")),
            system: hex(h(SYSTEM)),
            name: None,
        }]
    );
}

/// A resolver that maps `Tail` to the fixture's system, `Wing` to a system of a linked bin, and
/// `Lost` to a system that no bin declares.
fn wide_resolver() -> BinObject {
    BinObject::builder(h(RESOLVER), h("ResourceResolver"))
        .property(
            RESOURCE_MAP,
            values::Map::new(
                Kind::Hash,
                Kind::ObjectLink,
                vec![
                    (
                        values::Hash::new(h("Tail")).into(),
                        values::ObjectLink::new(h(SYSTEM)).into(),
                    ),
                    (
                        values::Hash::new(h("Wing")).into(),
                        values::ObjectLink::new(h(WING_SYSTEM)).into(),
                    ),
                    (
                        values::Hash::new(h("Lost")).into(),
                        values::ObjectLink::new(h("Nowhere")).into(),
                    ),
                ],
            )
            .unwrap(),
        )
        .build()
}

const PARTICLES: &str = "DATA/Characters/Ahri/Skins/Skin3/Particles.bin";
const WING_SYSTEM: &str = "Characters/Ahri/Skins/Skin3/Particles/Ahri_Skin03_Wing";

/// Resolves the fixture skin of `open` through a lookup that reads `linked` for the particles
/// bin.
fn reach_skin(open: &BinDocument, linked: Vec<BinObject>) -> SkinModel {
    let mut linked = Some(linked);
    let mut read = |asset: &AssetRef| {
        (asset == &file(PARTICLES).unwrap()).then(|| document_of(linked.take().unwrap_or_default()))
    };
    ObjectLookup::new(open, &Tables, &Placed, None, &mut read)
        .skin(h(SKIN))
        .unwrap()
}

fn tail_and_wing() -> Vec<EffectSystem> {
    let mut expected = vec![
        EffectSystem {
            key: hex(h("Tail")),
            system: hex(h(SYSTEM)),
            name: None,
        },
        EffectSystem {
            key: hex(h("Wing")),
            system: hex(h(WING_SYSTEM)),
            name: None,
        },
    ];
    expected.sort_by(|a, b| a.key.cmp(&b.key));
    expected
}

#[test]
fn reachable_skin_maps_keys_to_systems_of_linked_bins() {
    let open = document_linking(vec![skin(), wide_resolver(), system()], &[PARTICLES]);

    let model = reach_skin(
        &open,
        vec![BinObject::builder(h(WING_SYSTEM), h("VfxSystemDefinitionData")).build()],
    );

    assert_eq!(model.effect_systems, tail_and_wing());
}

#[test]
fn reachable_skin_reads_resolver_from_linked_bin() {
    let open = document_linking(vec![skin()], &[PARTICLES]);

    let model = reach_skin(
        &open,
        vec![
            wide_resolver(),
            system(),
            BinObject::builder(h(WING_SYSTEM), h("VfxSystemDefinitionData")).build(),
        ],
    );

    assert_eq!(model.effect_systems, tail_and_wing());
}

/// An event's frames, and what it does for the kinds a viewport plays. A kind it does not
/// play keeps its name, its class and its frames alone.
#[test]
fn a_clip_reads_its_events_by_kind() {
    let graph = read_graph();
    let events = &clip(&graph, "Idle1").events;

    let hit = &events[0];
    assert_eq!(hit.name, hex(h("Hit")));
    assert_eq!(hit.class, hex(h("ParticleEventData")));
    assert!((hit.start_frame - 12.0).abs() < f32::EPSILON);
    assert_eq!(hit.end_frame, Some(40.0));
    assert_eq!(
        hit.kind,
        EventKind::Particle {
            effect_key: hex(h("Tail")),
            effect_name: "Tail_Flash".to_owned(),
            spawns: vec![EventSpawn {
                bone: Some(HashRef {
                    name: hex(h("Tail_Base")),
                    hash: hex(h("Tail_Base")),
                }),
                target_bone: Some(HashRef {
                    name: hex(h("Head")),
                    hash: hex(h("Head")),
                }),
            }],
            is_loop: true,
            is_kill: false,
            scale: 2.0,
        }
    );

    let swing = &events[1];
    assert_eq!(
        swing.kind,
        EventKind::Sound {
            name: String::new(),
            is_loop: true,
            is_kill: true,
            skip_if_past_end: false,
            condition_transition: 1,
        },
        "a sound event that sets no field reads the class defaults"
    );
    assert!(
        (swing.start_frame).abs() < f32::EPSILON,
        "the meta's default"
    );
    assert_eq!(swing.end_frame, None, "the meta's -1 is no end");

    let lean = &events[2];
    assert_eq!(
        lean.kind,
        EventKind::ConformToPath {
            mask: Some(unnamed("UpperBody", false)),
            blend_in: 0.25,
            blend_out: 0.5,
        },
        "the mask is a key into the graph's own map, marked as a clip's mask is"
    );

    let grip = &events[3];
    assert_eq!(grip.end_frame, Some(9.0));
    assert_eq!(
        grip.kind,
        EventKind::JointSnap {
            joint: Some(HashRef {
                name: hex(h("Buffbone_Weapon")),
                hash: hex(h("Buffbone_Weapon")),
            }),
            snap_to: Some(HashRef {
                name: hex(h("R_Hand")),
                hash: hex(h("R_Hand")),
            }),
            offset: [1.0, 2.0, 3.0],
        }
    );

    let wings = &events[4];
    assert!((wings.start_frame - 3.0).abs() < f32::EPSILON);
    assert_eq!(
        wings.kind,
        EventKind::SubmeshVisibility {
            show: vec![HashRef {
                name: hex(h("Wings")),
                hash: hex(h("Wings")),
            }],
            hide: vec![
                HashRef {
                    name: hex(h("Cape")),
                    hash: hex(h("Cape")),
                },
                HashRef {
                    name: hex(h("Hat")),
                    hash: hex(h("Hat")),
                },
            ],
        }
    );
}

/// A graph holding `clips` alone.
fn graph_of(clips: Vec<(&str, PropertyValueEnum)>) -> AnimationGraph {
    let object = BinObject::builder(h(GRAPH), h("AnimationGraphData"))
        .property(CLIP_DATA_MAP, key_map(clips))
        .build();
    let document = document_of(vec![object]);

    resolve_graph(&document, h(GRAPH), &Tables, &Placed).unwrap()
}

fn unnamed_hash(name: &str) -> Option<HashRef> {
    Some(HashRef {
        name: hex(h(name)),
        hash: hex(h(name)),
    })
}

#[test]
fn sound_event_reads_name_flags_and_transition() {
    let events = key_map(vec![(
        "Step",
        pointer(
            "SoundEventData",
            vec![
                (EVENT_START_FRAME, values::F32::new(4.0).into()),
                (
                    h("mSoundName"),
                    values::String::from("Play_sfx_Step").into(),
                ),
                (EVENT_IS_LOOP, values::Bool::new(false).into()),
                (EVENT_IS_KILL, values::Bool::new(false).into()),
                (h("mSkipIfPastEndFrame"), values::Bool::new(true).into()),
                (h("ConditionClipTransitionType"), values::U8::new(2).into()),
            ],
        ),
    )]);

    let graph = graph_of(vec![(
        "Walk",
        pointer("AtomicClipData", vec![(EVENT_DATA_MAP, events)]),
    )]);

    assert_eq!(
        clip(&graph, "Walk").events[0].kind,
        EventKind::Sound {
            name: "Play_sfx_Step".to_owned(),
            is_loop: false,
            is_kill: false,
            skip_if_past_end: true,
            condition_transition: 2,
        }
    );
}

#[test]
fn a_clip_reads_the_events_that_drive_a_pose_modifier() {
    let seconds = |value: f32| -> PropertyValueEnum { values::F32::new(value).into() };
    let events = key_map(vec![
        (
            "Loosen",
            pointer(
                "DynamicsChainBlendEventData",
                vec![
                    (EVENT_BLEND_FROM_DEFAULT, seconds(0.1)),
                    (EVENT_BLEND_TO_DEFAULT, seconds(0.3)),
                ],
            ),
        ),
        (
            "Stiffen",
            pointer(
                "SpringPhysicsEventData",
                vec![
                    (EVENT_SPRING, hash_of("Pauldron")),
                    (EVENT_BLEND_OUT_TIME, seconds(0.4)),
                ],
            ),
        ),
        ("StiffenAll", pointer("SpringPhysicsEventData", vec![])),
        (
            "Aim",
            pointer(
                "JointOrientationEventData",
                vec![
                    (
                        EVENT_BLEND_DATA,
                        embedded(
                            "JointOrientationBlendData",
                            vec![
                                (EVENT_BLEND_FROM_DEFAULT, seconds(0.2)),
                                (EVENT_BLEND_TO_DEFAULT, seconds(0.6)),
                            ],
                        )
                        .into(),
                    ),
                    (EVENT_SOURCE_OVERRIDE, pointer("LaterVectorDriver", vec![])),
                ],
            ),
        ),
        ("Hold", pointer("JointOrientationEventData", vec![])),
        (
            "Brace",
            pointer(
                "LockRootOrientationEventData",
                vec![(EVENT_JOINT_NAME, hash_of("Root"))],
            ),
        ),
    ]);

    let graph = graph_of(vec![(
        "Sway",
        pointer("AtomicClipData", vec![(EVENT_DATA_MAP, events)]),
    )]);

    let kinds: Vec<&EventKind> = clip(&graph, "Sway")
        .events
        .iter()
        .map(|event| &event.kind)
        .collect();
    assert_eq!(
        kinds,
        vec![
            &EventKind::DynamicsChainBlend {
                blend_from_default: 0.1,
                blend_to_default: 0.3,
            },
            &EventKind::SpringPhysics {
                spring: unnamed_hash("Pauldron"),
                blend_out: 0.4,
            },
            &EventKind::SpringPhysics {
                spring: None,
                blend_out: 0.0,
            },
            &EventKind::JointOrientation {
                blend_from_default: Some(0.2),
                blend_to_default: Some(0.6),
                overrides_source: true,
            },
            &EventKind::JointOrientation {
                blend_from_default: None,
                blend_to_default: None,
                overrides_source: false,
            },
            &EventKind::LockRootOrientation {
                joint: unnamed_hash("Root"),
                blend_out: 0.2,
            },
        ]
    );
}

#[test]
fn a_sequencer_and_a_flagged_parametric_clip_fire_their_own_events() {
    let graph = graph_of(vec![
        ("Atomic", pointer("AtomicClipData", vec![])),
        ("Sequence", pointer("SequencerClipData", vec![])),
        ("Blend", pointer("ParametricClipData", vec![])),
        (
            "Flagged",
            pointer(
                "ParametricClipData",
                vec![(CLIP_OWN_EVENTS, values::Bool::new(true).into())],
            ),
        ),
    ]);

    let own: Vec<bool> = ["Atomic", "Sequence", "Blend", "Flagged"]
        .map(|name| clip(&graph, name).own_events)
        .to_vec();
    assert_eq!(own, vec![false, true, false, true]);
}

#[test]
fn a_skin_that_names_nothing_answers_the_defaults() {
    let bare = BinObject::builder(h(SKIN), h("SkinCharacterDataProperties")).build();
    let document = document_of(vec![bare]);

    let skin = resolve_skin(&document, h(SKIN), &Tables, &Placed, None).unwrap();

    assert_eq!(skin.mesh, None);
    assert_eq!(skin.material, None);
    assert!((skin.scale - 1.0).abs() < f32::EPSILON);
    assert!(skin.self_illumination.abs() < f32::EPSILON);
    assert_eq!(skin.emissive_texture, None);
    assert_eq!(skin.roughness_metallic_ao_texture, None);
    assert_eq!(skin.normal_map_texture, None);
    assert!(skin.idle_effects.is_empty());
    assert!(skin.persistent_conditions.is_empty());
    assert_eq!(skin.animation_graph, None);
}

#[test]
fn a_skin_reads_its_pbr_maps_and_an_overrides_own() {
    const RMA: &str = "ASSETS/Characters/Ahri/Skins/Skin03/Body_RMA.tex";
    const NORMAL: &str = "ASSETS/Characters/Ahri/Skins/Skin03/Body_NM.tex";
    const HAT_RMA: &str = "ASSETS/Characters/Ahri/Skins/Skin03/Hat_RMA.tex";
    let object = BinObject::builder(h(SKIN), h("SkinCharacterDataProperties"))
        .property(
            MESH_PROPERTIES,
            embedded(
                "SkinMeshDataProperties",
                vec![
                    (
                        ROUGHNESS_METALLIC_AO_TEXTURE,
                        values::String::from(RMA).into(),
                    ),
                    (NORMAL_MAP_TEXTURE, values::String::from(NORMAL).into()),
                    (
                        MATERIAL_OVERRIDE,
                        values::Container::from(vec![embedded(
                            "SkinMeshDataProperties_MaterialOverride",
                            vec![
                                (SUBMESH, values::String::from("Hat").into()),
                                (
                                    ROUGHNESS_METALLIC_AO_TEXTURE,
                                    values::String::from(HAT_RMA).into(),
                                ),
                            ],
                        )])
                        .into(),
                    ),
                ],
            ),
        )
        .build();
    let document = document_of(vec![object]);

    let skin = resolve_skin(&document, h(SKIN), &Tables, &Placed, None).unwrap();

    let named = |path: &str| {
        Some(NamedAsset {
            path: path.to_owned(),
            asset: file(path),
        })
    };
    assert_eq!(skin.roughness_metallic_ao_texture, named(RMA));
    assert_eq!(skin.normal_map_texture, named(NORMAL));
    assert_eq!(
        skin.overrides.len(),
        1,
        "an override that names only a map is an override"
    );
    let hat = &skin.overrides[0];
    assert_eq!(hat.submesh, "Hat");
    assert_eq!(hat.texture, None);
    assert_eq!(hat.roughness_metallic_ao_texture, named(HAT_RMA));
    assert_eq!(hat.normal_map_texture, None);
}

#[test]
fn an_entry_that_is_no_object_is_not_found() {
    let document = document_of(vec![skin()]);

    let err = resolve_skin(&document, h("Nowhere"), &Tables, &Placed, None).unwrap_err();

    assert!(matches!(err, BinDocumentError::NodeNotFound { .. }));
}

fn read_graph() -> AnimationGraph {
    let document = document_of(vec![graph()]);
    resolve_graph(&document, h(GRAPH), &Tables, &Placed).unwrap()
}

fn clip<'a>(graph: &'a AnimationGraph, name: &str) -> &'a GraphClip {
    graph
        .clips
        .iter()
        .find(|clip| clip.name == name || clip.hash == hex(h(name)))
        .unwrap_or_else(|| panic!("the graph holds no clip {name}"))
}

fn key(name: &str, declared: bool) -> KeyRef {
    KeyRef {
        name: name.to_owned(),
        hash: hex(h(name)),
        declared,
    }
}

fn unnamed(name: &str, declared: bool) -> KeyRef {
    KeyRef {
        name: hex(h(name)),
        hash: hex(h(name)),
        declared,
    }
}

#[test]
fn a_graph_names_keys_no_table_names_from_its_own_text() {
    let atomic = |file: &str, events: PropertyValueEnum| {
        pointer(
            "AtomicClipData",
            vec![
                (
                    ANIMATION_RESOURCE,
                    embedded(
                        "AnimationResourceData",
                        vec![(ANIMATION_FILE, values::String::from(file).into())],
                    )
                    .into(),
                ),
                (EVENT_DATA_MAP, events),
            ],
        )
    };
    let swing = pointer(
        "SoundEventData",
        vec![(EVENT_NAME, values::String::from("Swing").into())],
    );
    let wrong = pointer(
        "SoundEventData",
        vec![(EVENT_NAME, values::String::from("NotTheKey").into())],
    );
    let object = BinObject::builder(h(GRAPH), h("AnimationGraphData"))
        .property(
            CLIP_DATA_MAP,
            key_map(vec![
                (
                    "Crit_Melee",
                    atomic(
                        "assets/chogath_crit_melee.anm",
                        key_map(vec![("Swing", swing), ("Other", wrong)]),
                    ),
                ),
                ("Whirl", atomic("assets/spin.anm", key_map(vec![]))),
            ]),
        )
        .build();
    let document = document_of(vec![object]);

    let graph = resolve_graph(&document, h(GRAPH), &Tables, &Placed).unwrap();

    let crit = clip(&graph, "Crit_Melee");
    assert_eq!(
        crit.name, "crit_melee",
        "the file name's tail hashes to the key"
    );
    assert_eq!(crit.events[0].name, "Swing");
    assert_eq!(
        crit.events[1].name,
        hex(h("Other")),
        "an mName of another hash is no name"
    );
    assert_eq!(clip(&graph, "Whirl").name, hex(h("Whirl")));
}

/// Every entry of the map is a row, in map order, whatever its kind.
#[test]
fn a_graph_lists_every_clip_in_map_order() {
    let graph = read_graph();

    assert_eq!(
        graph
            .clips
            .iter()
            .map(|clip| clip.name.as_str())
            .collect::<Vec<_>>(),
        [
            "Idle1",
            &hex(h("Run_Selector")),
            "Attack1",
            "Run",
            &hex(h("Crouch")),
            &hex(h("Dance")),
            &hex(h("Combo")),
            &hex(h("Both")),
            &hex(h("Taunt")),
            &hex(h("Stance")),
            &hex(h("Form")),
        ]
    );
}

/// An atomic clip carries its file, its tick, its keys, its events and its flags. Its
/// class is named where a table names it.
#[test]
fn an_atomic_clip_reads_its_file_and_its_keys() {
    let graph = read_graph();
    let idle = clip(&graph, "Idle1");

    assert_eq!(idle.class, "AtomicClipData");
    assert_eq!(
        idle.animation,
        Some(NamedAsset {
            path: IDLE.to_owned(),
            asset: file(IDLE),
        })
    );
    assert!((idle.tick_duration.unwrap() - 1.0 / 30.0).abs() < f32::EPSILON);
    assert_eq!(idle.track, Some(key("Default", true)));
    assert_eq!(idle.mask, Some(unnamed("UpperBody", false)));
    assert_eq!(idle.sync_group, None);
    assert_eq!(idle.events.len(), 5);
    assert!(idle.children.is_empty());
    assert_eq!(idle.interruption_groups, ["Attack1"]);
    assert_eq!(idle.flags, 3);

    let attack = clip(&graph, "Attack1");
    assert_eq!(
        attack.animation,
        Some(NamedAsset {
            path: ATTACK.to_owned(),
            asset: file(ATTACK),
        })
    );
    assert_eq!(
        attack.track,
        Some(unnamed("Gone", false)),
        "a key the map does not declare is kept and marked"
    );
}

/// Each kind names its children through its own fields, in that kind's field order, and
/// a child the map does not hold is marked.
#[test]
fn every_kind_names_its_children_in_field_order() {
    let graph = read_graph();
    let children = |name: &str| clip(&graph, name).children.clone();

    assert_eq!(
        children("Run_Selector"),
        [key("Run", true), unnamed("Nowhere", false)]
    );
    assert_eq!(children("Run"), [key("Idle1", true), key("Attack1", true)]);
    assert_eq!(
        clip(&graph, "Run").parameters,
        [-180.0, 90.0],
        "a parametric clip carries each pair's value beside its child"
    );
    assert!(clip(&graph, "Run_Selector").parameters.is_empty());
    assert_eq!(
        children("Crouch"),
        [key("Idle1", true), key("Attack1", true)]
    );
    assert_eq!(children("Dance"), [key("Idle1", true)]);
    assert_eq!(
        children("Combo"),
        [key("Attack1", true), key("Idle1", true)]
    );
    assert_eq!(children("Both"), [key("Idle1", true)]);
    assert_eq!(children("Taunt"), [key("Idle1", true), key("Run", true)]);
    assert_eq!(children("Stance"), [key("Idle1", true), key("Run", true)]);
    assert_eq!(children("Form"), [key("Idle1", true), key("Attack1", true)]);

    let combo = clip(&graph, "Combo");
    assert_eq!(
        combo.events.len(),
        1,
        "a sequencer carries its own event map"
    );
    assert_eq!(combo.animation, None);
    assert_eq!(combo.tick_duration, None);
    assert_eq!(
        combo.class,
        hex(h("SequencerClipData")),
        "a class no table names is its hex"
    );
}

#[test]
fn a_graph_lists_its_tracks_masks_and_sync_groups() {
    let graph = read_graph();

    assert_eq!(
        graph.tracks,
        vec![Track {
            name: "Default".to_owned(),
            hash: hex(h("Default")),
            priority: 2,
            blend_mode: 1,
            blend_weight: 0.5,
        }]
    );
    assert_eq!(
        graph.masks,
        vec![Mask {
            name: hex(h("Unnamed_Mask")),
            hash: hex(h("Unnamed_Mask")),
            id: 7,
            weights: vec![1.0, 0.0, 1.0],
        }]
    );
    assert_eq!(
        graph.sync_groups,
        vec![SyncGroup {
            name: "Locomotion".to_owned(),
            hash: hex(h("Locomotion")),
            kind: 1,
        }]
    );
}

#[test]
fn a_graph_that_names_nothing_answers_empty_lists() {
    let bare = BinObject::builder(h(GRAPH), h("AnimationGraphData")).build();
    let document = document_of(vec![bare]);

    let graph = resolve_graph(&document, h(GRAPH), &Tables, &Placed).unwrap();

    assert!(graph.clips.is_empty());
    assert!(graph.tracks.is_empty());
    assert!(graph.masks.is_empty());
    assert!(graph.sync_groups.is_empty());
}

#[test]
fn reachable_graph_reads_graph_of_open_bin() {
    let open = document_of(vec![graph()]);
    let mut read = |_: &AssetRef| None;
    let mut lookup = ObjectLookup::new(&open, &Tables, &Placed, None, &mut read);

    let found = lookup.graph(h(GRAPH)).unwrap();

    assert_eq!(found, read_graph());
}

/// A material a merged CAC bin declares is reached through the skin's links, and one no
/// bin of the lookup declares stays missing.
#[test]
fn a_material_the_skin_lacks_is_looked_for_in_the_files_it_links() {
    const CAC: &str = "DATA/Characters/Ahri/Skins/Skin3/CAC.bin";
    let mesh = embedded(
        "SkinMeshDataProperties",
        vec![
            (MATERIAL, values::ObjectLink::new(h(WINGS_MATERIAL)).into()),
            (
                MATERIAL_OVERRIDE,
                values::Container::from(vec![embedded(
                    "SkinMeshDataProperties_MaterialOverride",
                    vec![
                        (SUBMESH, values::String::from("Hat").into()),
                        (MATERIAL, values::ObjectLink::new(h(BODY_MATERIAL)).into()),
                    ],
                )])
                .into(),
            ),
        ],
    );
    let bare = BinObject::builder(h(SKIN), h("SkinCharacterDataProperties"))
        .property(MESH_PROPERTIES, mesh)
        .build();
    let document = document_linking(vec![bare], &[CAC]);
    let own = resolve_skin(&document, h(SKIN), &Tables, &Placed, None).unwrap();
    assert!(
        own.material
            .as_ref()
            .is_some_and(|material| material.missing)
    );

    let mut read = |asset: &AssetRef| {
        (asset == &file(CAC).unwrap()).then(|| document_of(vec![wings_material()]))
    };
    let model = ObjectLookup::new(&document, &Tables, &Placed, None, &mut read)
        .skin(h(SKIN))
        .unwrap();

    let body = model.material.expect("the skin's material");
    assert!(!body.missing);
    assert_eq!(
        body.base.as_ref().map(|base| base.texture.asset.clone()),
        Some(file(WINGS))
    );
    assert!(
        model.overrides[0]
            .material
            .as_ref()
            .is_some_and(|m| m.missing)
    );
}

/// Two linked bins that link each other, `A` naming `B`, and `B` holding `objects`.
fn circle(asset: &AssetRef, objects: fn() -> Vec<BinObject>) -> Option<BinDocument> {
    let AssetRef::File { path } = asset else {
        return None;
    };
    match path.as_str() {
        "data/a.bin" => Some(document_linking(vec![], &["DATA/B.bin"])),
        "data/b.bin" => Some(document_linking(objects(), &["DATA/A.bin"])),
        _ => None,
    }
}

/// Resolves the graph through a lookup whose open bin links `DATA/A.bin`.
fn graph_through_circle(
    read: &mut dyn FnMut(&AssetRef) -> Option<BinDocument>,
) -> Result<AnimationGraph, BinDocumentError> {
    let open = document_linking(vec![skin()], &["DATA/A.bin"]);
    ObjectLookup::new(&open, &Tables, &Placed, None, read).graph(h(GRAPH))
}

#[test]
fn reachable_graph_reads_graph_of_bin_that_linked_bin_links() {
    let found = graph_through_circle(&mut |asset| circle(asset, || vec![graph()])).unwrap();

    assert_eq!(found.clips.len(), 11);
}

#[test]
fn reachable_graph_passes_over_linked_bin_that_cannot_be_read() {
    let open = document_linking(vec![skin()], &["DATA/Gone.bin", "DATA/B.bin"]);
    let mut read = |asset: &AssetRef| circle(asset, || vec![graph()]);
    let mut lookup = ObjectLookup::new(&open, &Tables, &Placed, None, &mut read);

    let found = lookup.graph(h(GRAPH)).unwrap();

    assert_eq!(found.clips.len(), 11);
}

#[test]
fn reachable_graph_in_circle_of_links_without_it_is_not_found() {
    let mut reads = 0;
    let err = graph_through_circle(&mut |asset| {
        reads += 1;
        circle(asset, Vec::new)
    })
    .unwrap_err();

    assert!(matches!(err, BinDocumentError::NodeNotFound { .. }));
    assert_eq!(reads, 2);
}

/// Each child field's hash is its name, the list's and the element's both.
#[test]
fn every_child_field_hash_is_its_name() {
    let expected = [
        ("mParametricPairDataList", Some("mClipName")),
        ("mSelectorPairDataList", Some("mClipName")),
        ("mTrueConditionClipName", None),
        ("mFalseConditionClipName", None),
        ("mConditionFloatPairDataList", Some("mClipName")),
        ("mClipNameList", None),
        ("DefaultClipName", None),
        ("SelectorPairDataList", Some("ClipName")),
        ("ChildClipName", None),
        ("Transitions", Some("TargetClipName")),
        ("SwitchIntPairDataList", Some("ClipName")),
    ];
    assert_eq!(CHILD_FIELDS.len(), expected.len());
    for (children, (list, element)) in CHILD_FIELDS.iter().zip(expected) {
        match (*children, element) {
            (Children::One(field) | Children::Many(field), None) => {
                assert_eq!(field, h(list), "{list}");
            }
            (Children::Pairs(field, clip), Some(element)) => {
                assert_eq!(field, h(list), "{list}");
                assert_eq!(clip, h(element), "{list}[].{element}");
            }
            (children, element) => panic!("{list}: {children:?} against {element:?}"),
        }
    }
}

const OUTLINE_CATEGORY_PATH: &str = "Maps/Shipping/Map453/CharacterOutline";
const OUTLINE_MATERIAL: &str = "Maps/Shipping/Map453/Materials/CharacterOutline";
const OVERRIDE_MATERIAL: &str = "Characters/Ahri/Skins/Skin3/Materials/Outline";
const MAP_BIN: &str = "data/maps/shipping/map453/map453.bin";
const WHITE: &str = "assets/shared/materials/white.tex";

fn outline_entry(category: &str, submeshes: &str, material: Option<&str>) -> values::Embedded {
    let mut fields = vec![
        (
            OUTLINE_CATEGORY,
            values::ObjectLink::new(h(category)).into(),
        ),
        (OUTLINE_SUBMESHES, values::String::from(submeshes).into()),
    ];
    if let Some(material) = material {
        fields.push((
            OUTLINE_MATERIAL_OVERRIDE,
            values::ObjectLink::new(h(material)).into(),
        ));
    }
    embedded("CharacterOutlineSubmeshes", fields)
}

fn outlined_skin() -> BinObject {
    BinObject::builder(h(SKIN), h("SkinCharacterDataProperties"))
        .property(
            MESH_PROPERTIES,
            embedded(
                "SkinMeshDataProperties",
                vec![(
                    OUTLINE_CATEGORY_SUBMESHES,
                    values::Container::from(vec![
                        outline_entry(OUTLINE_CATEGORY_PATH, "Body Hood,Cape", None),
                        outline_entry(OUTLINE_CATEGORY_PATH, "Wings", Some(OVERRIDE_MATERIAL)),
                        outline_entry("Nowhere", "Tail", None),
                    ])
                    .into(),
                )],
            ),
        )
        .build()
}

fn outline_category() -> BinObject {
    BinObject::builder(h(OUTLINE_CATEGORY_PATH), h("CharacterOutlineCategory"))
        .property(MATERIAL, values::ObjectLink::new(h(OUTLINE_MATERIAL)))
        .build()
}

/// An outline material with `params`, in the shape the shipped one has.
fn outline_material(path: &str, params: &[(&str, [f32; 4])]) -> BinObject {
    let param = |(name, value): &(&str, [f32; 4])| {
        embedded(
            "StaticMaterialShaderParamDef",
            vec![
                (h("name"), values::String::from(*name).into()),
                (
                    h("value"),
                    values::Vector4::new(glam::Vec4::from(*value)).into(),
                ),
            ],
        )
    };
    let sampler = embedded(
        "StaticMaterialShaderSamplerDef",
        vec![
            (
                h("TextureName"),
                values::String::from("Outline_Mask").into(),
            ),
            (
                h("texturePath"),
                values::WadChunkLink::new(WadHash::hash_str(WHITE).0).into(),
            ),
        ],
    );
    BinObject::builder(h(path), h("StaticMaterialDef"))
        .property(
            h("paramValues"),
            values::Container::from(params.iter().map(param).collect::<Vec<_>>()),
        )
        .property(h("samplerValues"), values::Container::from(vec![sampler]))
        .build()
}

#[test]
fn a_skin_reads_its_outline_entries_without_their_materials() {
    let document = document_of(vec![outlined_skin(), outline_category()]);

    let skin = resolve_skin(&document, h(SKIN), &Tables, &Placed, None).unwrap();

    let read: Vec<(String, Vec<String>)> = skin
        .outlines
        .iter()
        .map(|outline| (outline.category.clone(), outline.submeshes.clone()))
        .collect();
    assert_eq!(
        read,
        [
            (
                hex(h(OUTLINE_CATEGORY_PATH)),
                vec!["Body".into(), "Hood".into(), "Cape".into()]
            ),
            (hex(h(OUTLINE_CATEGORY_PATH)), vec!["Wings".into()]),
            (hex(h("Nowhere")), vec!["Tail".into()]),
        ]
    );
    assert!(
        skin.outlines
            .iter()
            .all(|outline| outline.material.is_none())
    );
}

#[test]
fn reachable_skin_resolves_outline_materials_from_a_declaring_bin() {
    let open = document_of(vec![outlined_skin()]);
    let map = file(MAP_BIN).unwrap();
    let mut read = |asset: &AssetRef| {
        (*asset == file(MAP_BIN).unwrap()).then(|| {
            document_of(vec![
                outline_category(),
                outline_material(
                    OUTLINE_MATERIAL,
                    &[
                        ("Outline_Color", [0.02, 0.09, 0.05, 1.0]),
                        ("Outline_Width", [5.0, 0.0, 0.0, 0.0]),
                        ("Outline_CameraDistanceMod", [4500.0, 0.0, 0.0, 0.0]),
                        ("Outline_CameraDepthOffset", [-20.0, 0.0, 0.0, 0.0]),
                    ],
                ),
                outline_material(
                    OVERRIDE_MATERIAL,
                    &[("Outline_Width", [2.0, 0.0, 0.0, 0.0])],
                ),
            ])
        })
    };

    let skin = ObjectLookup::new(&open, &Tables, &Placed, None, &mut read)
        .declared_by(|_| vec![map.clone()])
        .skin(h(SKIN))
        .unwrap();

    let body = skin.outlines[0].material.as_ref().unwrap();
    assert_eq!(body.hash, hex(h(OUTLINE_MATERIAL)));
    assert_eq!(body.color, [0.02, 0.09, 0.05, 1.0]);
    assert!((body.width - 5.0).abs() < f32::EPSILON);
    assert!((body.camera_distance - 4500.0).abs() < f32::EPSILON);
    assert!((body.depth_offset + 20.0).abs() < f32::EPSILON);
    assert!((body.alpha - 1.0).abs() < f32::EPSILON);
    assert_eq!(body.mask_channels, [1.0, 0.0, 0.0, 0.0]);
    assert!(body.mask.is_some(), "the mask is the material's sampler");

    let wings = skin.outlines[1].material.as_ref().unwrap();
    assert_eq!(
        wings.hash,
        hex(h(OVERRIDE_MATERIAL)),
        "the override wins over the category"
    );
    assert!((wings.width - 2.0).abs() < f32::EPSILON);
    assert!(
        (wings.camera_distance - 600.0).abs() < f32::EPSILON,
        "a parameter the material leaves out takes the shader's default"
    );

    assert_eq!(skin.outlines[2].material, None);
}
