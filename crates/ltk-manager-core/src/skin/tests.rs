use std::io::Cursor;

use glam::vec3;
use ltk_hash::{Hash as _, WadHash};
use ltk_meta::property::{Kind, values};
use ltk_meta::{Bin, BinObject};

use super::*;
use crate::bin_document::resolve::RESOURCE_MAP;
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
            project: None,
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
                project: None,
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

/// The first entry for a key is the one the resolver answers with, and a key it does not
/// map keeps no system.
#[test]
fn an_idle_effect_reaches_the_system_its_key_resolves_to() {
    let effects = read_skin().idle_effects;

    assert_eq!(effects.len(), 2);
    assert_eq!(effects[0].effect_key, hex(h("Tail")));
    assert_eq!(effects[0].system, Some(hex(h(SYSTEM))));
    assert_eq!(effects[0].bone, "Tail_Base");
    assert_eq!(effects[0].position, [0.0, 10.0, 0.0]);
    assert_eq!(effects[1].system, None);
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
            source: None,
        }]
    );
}

/// A system the skin's file keeps in a file of its own is reached through the skin's
/// links and names that file, and a key no file declares a system for is left out.
#[test]
fn a_system_the_skin_lacks_is_looked_for_in_the_files_it_links() {
    const PARTICLES: &str = "DATA/Characters/Ahri/Skins/Skin3/Particles.bin";
    const WING_SYSTEM: &str = "Characters/Ahri/Skins/Skin3/Particles/Ahri_Skin03_Wing";
    let resolver = BinObject::builder(h(RESOLVER), h("ResourceResolver"))
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
        .build();
    let document = document_linking(vec![skin(), resolver, system()], &[PARTICLES]);
    let mut model = resolve_skin(&document, h(SKIN), &Tables, &Placed, None).unwrap();
    assert_eq!(model.effect_systems.len(), 1);

    let linked = document
        .dependencies()
        .iter()
        .filter_map(|path| Placed.locate(path))
        .collect();
    search_linked_systems(
        &mut model,
        &document,
        h(SKIN),
        linked,
        &Placed,
        &mut |asset| {
            (asset == &file(PARTICLES).unwrap()).then(|| {
                document_of(vec![
                    BinObject::builder(h(WING_SYSTEM), h("VfxSystemDefinitionData")).build(),
                ])
            })
        },
    );

    let mut expected = vec![
        EffectSystem {
            key: hex(h("Tail")),
            system: hex(h(SYSTEM)),
            source: None,
        },
        EffectSystem {
            key: hex(h("Wing")),
            system: hex(h(WING_SYSTEM)),
            source: file(PARTICLES),
        },
    ];
    expected.sort_by(|a, b| a.key.cmp(&b.key));
    assert_eq!(model.effect_systems, expected);
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
    assert_eq!(swing.kind, EventKind::Other);
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
    assert!(skin.idle_effects.is_empty());
    assert_eq!(skin.animation_graph, None);
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
    assert_eq!(graph.source, None);
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
    assert_eq!(children("Taunt"), [key("Run", true), key("Idle1", true)]);
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
fn a_graph_the_file_declares_answers_itself() {
    let document = document_of(vec![graph()]);

    let found = graph_at(&document, h(GRAPH), &Tables, &Placed).unwrap();

    assert_eq!(found, GraphRead::Found(read_graph()));
}

/// The skin file names its animations bin among its dependencies, and a link nothing on
/// this machine holds is left out.
#[test]
fn a_graph_the_file_lacks_is_looked_for_in_the_files_it_links() {
    const ANIMATIONS: &str = "DATA/Characters/Ahri/Animations/Skin3.bin";
    let document = document_linking(vec![skin()], &[ANIMATIONS, SKL]);

    let linked = graph_at(&document, h(GRAPH), &Tables, &Placed).unwrap();

    assert_eq!(linked, GraphRead::Linked(vec![file(ANIMATIONS).unwrap()]));
}

/// A material a merged CAC bin declares is reached through the skin's links, and one no
/// file within reach declares stays missing.
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
    let mut model = resolve_skin(&document, h(SKIN), &Tables, &Placed, None).unwrap();
    assert!(
        model
            .material
            .as_ref()
            .is_some_and(|material| material.missing)
    );

    let linked = document
        .dependencies()
        .iter()
        .filter_map(|path| Placed.locate(path))
        .collect();
    search_linked_materials(&mut model, linked, &Tables, &Placed, None, &mut |asset| {
        (asset == &file(CAC).unwrap()).then(|| document_of(vec![wings_material()]))
    });

    let body = model.material.expect("the skin's material");
    assert!(!body.missing);
    assert_eq!(body.source, file(CAC));
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

/// The graph found through a link names the file it was found in as its source.
#[test]
fn a_graph_is_found_in_a_file_a_linked_file_links() {
    let found = search_linked(
        vec![file("DATA/A.bin").unwrap()],
        h(GRAPH),
        &Tables,
        &Placed,
        &mut |asset| circle(asset, || vec![graph()]),
    )
    .unwrap();

    assert_eq!(found.clips.len(), 11);
    assert_eq!(found.source, file("DATA/B.bin"));
}

#[test]
fn a_linked_file_that_cannot_be_read_is_passed_over() {
    let found = search_linked(
        vec![file("DATA/Gone.bin").unwrap(), file("DATA/B.bin").unwrap()],
        h(GRAPH),
        &Tables,
        &Placed,
        &mut |asset| circle(asset, || vec![graph()]),
    )
    .unwrap();

    assert_eq!(found.clips.len(), 11);
}

/// Each file of a circle is read once, so a search through one ends.
#[test]
fn links_that_circle_without_the_graph_end_not_found() {
    let mut reads = 0;
    let err = search_linked(
        vec![file("DATA/A.bin").unwrap()],
        h(GRAPH),
        &Tables,
        &Placed,
        &mut |asset| {
            reads += 1;
            circle(asset, Vec::new)
        },
    )
    .unwrap_err();

    assert!(matches!(err, BinDocumentError::NodeNotFound { .. }));
    assert_eq!(reads, 2);
}

/// Each hash is the field's name through the bin's own hash, so a typo in a constant is a
/// failure here rather than a field that silently reads as absent.
#[test]
fn every_field_hash_is_its_name() {
    for (hash, name) in [
        (MESH_PROPERTIES, "skinMeshProperties"),
        (SIMPLE_SKIN, "simpleSkin"),
        (SKELETON, "skeleton"),
        (TEXTURE, "texture"),
        (SKIN_SCALE, "skinScale"),
        (SELF_ILLUMINATION, "selfIllumination"),
        (EMISSIVE_TEXTURE, "emissiveTexture"),
        (HIDDEN_SUBMESHES, "initialSubmeshToHide"),
        (MATERIAL_OVERRIDE, "materialOverride"),
        (SUBMESH, "submesh"),
        (MATERIAL, "Material"),
        (ANIMATION_PROPERTIES, "skinAnimationProperties"),
        (ANIMATION_GRAPH, "animationGraphData"),
        (IDLE_EFFECTS, "idleParticlesEffects"),
        (RESOURCE_RESOLVER, "mResourceResolver"),
        (RESOURCE_MAP, "resourceMap"),
        (EFFECT_KEY, "effectKey"),
        (BONE_NAME, "boneName"),
        (TARGET_BONE_NAME, "targetBoneName"),
        (POSITION, "Position"),
        (CLIP_DATA_MAP, "mClipDataMap"),
        (TRACK_DATA_MAP, "mTrackDataMap"),
        (MASK_DATA_MAP, "mMaskDataMap"),
        (SYNC_GROUP_DATA_MAP, "mSyncGroupDataMap"),
        (ANIMATION_RESOURCE, "mAnimationResourceData"),
        (ANIMATION_FILE, "mAnimationFilePath"),
        (TICK_DURATION, "mTickDuration"),
        (TRACK_DATA_NAME, "mTrackDataName"),
        (MASK_DATA_NAME, "mMaskDataName"),
        (SYNC_GROUP_DATA_NAME, "mSyncGroupDataName"),
        (EVENT_DATA_MAP, "mEventDataMap"),
        (INTERRUPTION_GROUPS, "mAnimationInterruptionGroupNames"),
        (FLAGS, "mFlags"),
        (TRACK_PRIORITY, "mPriority"),
        (TRACK_BLEND_MODE, "mBlendMode"),
        (TRACK_BLEND_WEIGHT, "mBlendWeight"),
        (MASK_ID, "mId"),
        (MASK_WEIGHTS, "mWeightList"),
        (SYNC_GROUP_TYPE, "mType"),
        (PARAMETRIC_PAIRS, "mParametricPairDataList"),
        (PAIR_CLIP, "mClipName"),
        (PAIR_VALUE, "mValue"),
        (EVENT_START_FRAME, "mStartFrame"),
        (EVENT_END_FRAME, "mEndFrame"),
        (SUBMESH_VISIBILITY_EVENT, "SubmeshVisibilityEventData"),
        (EVENT_SHOW_SUBMESHES, "mShowSubmeshList"),
        (EVENT_HIDE_SUBMESHES, "mHideSubmeshList"),
        (PARTICLE_EVENT, "ParticleEventData"),
        (EVENT_EFFECT_KEY, "mEffectKey"),
        (EVENT_EFFECT_NAME, "mEffectName"),
        (EVENT_PAIRS, "mParticleEventDataPairList"),
        (EVENT_IS_LOOP, "mIsLoop"),
        (EVENT_IS_KILL, "mIsKillEvent"),
        (EVENT_SCALE, "scale"),
        (EVENT_BONE, "mBoneName"),
        (EVENT_TARGET_BONE, "mTargetBoneName"),
        (JOINT_SNAP_EVENT, "JointSnapEventData"),
        (EVENT_JOINT, "mJointNameToOverride"),
        (EVENT_SNAP_TO, "mJointNameToSnapTo"),
        (EVENT_OFFSET, "offset"),
        (CONFORM_EVENT, "ConformToPathEventData"),
        (EVENT_BLEND_IN, "mBlendInTime"),
        (EVENT_BLEND_OUT, "mBlendOutTime"),
    ] {
        assert_eq!(hash, h(name), "{name}");
    }
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
        ("SelectorPairDataList", Some("ClipName")),
        ("DefaultClipName", None),
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
