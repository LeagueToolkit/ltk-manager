use std::io::Cursor;

use glam::vec3;
use ltk_hash::{Hash as _, WadHash};
use ltk_meta::property::{Kind, NoMeta, values};
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
        meta: NoMeta,
    })
}

fn pointer(class: &str, properties: Vec<(BinHash, PropertyValueEnum)>) -> PropertyValueEnum {
    values::Struct {
        class_hash: h(class),
        properties: properties.into_iter().collect(),
        meta: NoMeta,
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

fn graph() -> BinObject {
    let clip = |path: PropertyValueEnum| {
        pointer(
            "AtomicClipData",
            vec![(
                ANIMATION_RESOURCE,
                embedded("AnimationResourceData", vec![(ANIMATION_FILE, path)]).into(),
            )],
        )
    };

    BinObject::builder(h(GRAPH), h("AnimationGraphData"))
        .property(
            CLIP_DATA_MAP,
            values::Map::new(
                Kind::Hash,
                Kind::Struct,
                vec![
                    (
                        values::Hash::new(h("Idle1")).into(),
                        clip(values::String::from(IDLE).into()),
                    ),
                    (
                        values::Hash::new(h("Run_Selector")).into(),
                        pointer("SelectorClipData", vec![]),
                    ),
                    (
                        values::Hash::new(h("Attack1")).into(),
                        clip(values::WadChunkLink::new(ATTACK_CHUNK).into()),
                    ),
                ],
            )
            .unwrap(),
        )
        .build()
}

fn document_of(objects: Vec<BinObject>) -> BinDocument {
    document_linking(objects, &[])
}

fn document_linking(objects: Vec<BinObject>, dependencies: &[&str]) -> BinDocument {
    let mut bin = Bin::<NoMeta>::builder().dependencies(dependencies.iter().copied());
    for object in objects {
        bin = bin.object(object);
    }
    let mut out = Cursor::new(Vec::new());
    bin.build().to_writer(&mut out).unwrap();
    BinDocument::parse(&out.into_inner()).unwrap()
}

/// Tables that name the clip keys and one chunk, and nothing else.
struct Tables;

impl RowNames for Tables {
    fn for_each_entry(&self, _hashes: &[BinHash], _visit: &mut dyn FnMut(usize, &str)) {}

    fn for_each_class(&self, _hashes: &[BinHash], _visit: &mut dyn FnMut(usize, &str)) {}

    fn for_each_field(&self, _hashes: &[BinHash], _visit: &mut dyn FnMut(usize, &str)) {}

    fn for_each_value(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        for (at, hash) in hashes.iter().enumerate() {
            for name in ["Idle1", "Attack1"] {
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
    assert_eq!(material.render_state.blending, Blending::Normal);
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

#[test]
fn a_skin_that_names_nothing_answers_the_defaults() {
    let bare = BinObject::builder(h(SKIN), h("SkinCharacterDataProperties")).build();
    let document = document_of(vec![bare]);

    let skin = resolve_skin(&document, h(SKIN), &Tables, &Placed, None).unwrap();

    assert_eq!(skin.mesh, None);
    assert_eq!(skin.material, None);
    assert!((skin.scale - 1.0).abs() < f32::EPSILON);
    assert!(skin.idle_effects.is_empty());
    assert_eq!(skin.animation_graph, None);
}

#[test]
fn an_entry_that_is_no_object_is_not_found() {
    let document = document_of(vec![skin()]);

    let err = resolve_skin(&document, h("Nowhere"), &Tables, &Placed, None).unwrap_err();

    assert!(matches!(err, BinDocumentError::NodeNotFound { .. }));
}

/// A selector plays the atomic clips it picks between and no file of its own.
#[test]
fn a_graph_lists_its_atomic_clips_in_order() {
    let document = document_of(vec![graph()]);

    let clips = resolve_clips(&document, h(GRAPH), &Tables, &Placed).unwrap();

    assert_eq!(
        clips,
        vec![
            AnimationClip {
                name: "Idle1".to_owned(),
                hash: hex(h("Idle1")),
                animation: NamedAsset {
                    path: IDLE.to_owned(),
                    asset: file(IDLE),
                },
            },
            AnimationClip {
                name: "Attack1".to_owned(),
                hash: hex(h("Attack1")),
                animation: NamedAsset {
                    path: ATTACK.to_owned(),
                    asset: file(ATTACK),
                },
            },
        ]
    );
}

#[test]
fn a_graph_the_file_declares_answers_its_clips() {
    let document = document_of(vec![graph()]);

    let found = graph_clips(&document, h(GRAPH), &Tables, &Placed).unwrap();

    assert_eq!(
        found,
        GraphClips::Found(resolve_clips(&document, h(GRAPH), &Tables, &Placed).unwrap())
    );
}

/// The skin file names its animations bin among its dependencies, and a link nothing on
/// this machine holds is left out.
#[test]
fn a_graph_the_file_lacks_is_looked_for_in_the_files_it_links() {
    const ANIMATIONS: &str = "DATA/Characters/Ahri/Animations/Skin3.bin";
    let document = document_linking(vec![skin()], &[ANIMATIONS, SKL]);

    let linked = graph_clips(&document, h(GRAPH), &Tables, &Placed).unwrap();

    assert_eq!(linked, GraphClips::Linked(vec![file(ANIMATIONS).unwrap()]));
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

#[test]
fn a_graph_is_found_in_a_file_a_linked_file_links() {
    let clips = search_linked(
        vec![file("DATA/A.bin").unwrap()],
        h(GRAPH),
        &Tables,
        &Placed,
        &mut |asset| circle(asset, || vec![graph()]),
    )
    .unwrap();

    assert_eq!(clips.len(), 2);
}

#[test]
fn a_linked_file_that_cannot_be_read_is_passed_over() {
    let clips = search_linked(
        vec![file("DATA/Gone.bin").unwrap(), file("DATA/B.bin").unwrap()],
        h(GRAPH),
        &Tables,
        &Placed,
        &mut |asset| circle(asset, || vec![graph()]),
    )
    .unwrap();

    assert_eq!(clips.len(), 2);
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
        (ATOMIC_CLIP, "AtomicClipData"),
        (ANIMATION_RESOURCE, "mAnimationResourceData"),
        (ANIMATION_FILE, "mAnimationFilePath"),
    ] {
        assert_eq!(hash, h(name), "{name}");
    }
}
