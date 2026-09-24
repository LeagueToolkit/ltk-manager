//! What a skin gives a viewport: the files its character is built from, the effects it
//! wears, and the animation graph its clips come out of.
//!
//! Rust resolves the references and TypeScript draws them, the split
//! docs/plans/vfx-particle-renderer.md makes for a particle system. A skin reads a
//! handful of named fields rather than walking its subtree, because the resolver it links
//! maps every system its file declares and a walk would inline all of them.

mod tangents;

pub use tangents::bake_mesh_tangents;

use std::collections::{HashMap, HashSet, VecDeque};

use ltk_hash::BinHash;
use ltk_meta::PropertyValueEnum;
use ltk_meta::walk::Leaf;
use serde::Serialize;

pub use crate::bin_document::NamedAsset;
use crate::bin_document::{
    AssetLookup, BinDocument, BinDocumentError, EFFECT_KEY, Fields, Locator, RowNames, fields_of,
    hex, items, leaf, link, object_at, resolver_entries, struct_of, text,
};
use crate::material::{MaterialPreview, linked_material};
use crate::preview::AssetRef;

/// `SkinCharacterDataProperties.skinMeshProperties`.
const MESH_PROPERTIES: BinHash = BinHash(0x45ff_5904);
/// `SkinMeshDataProperties.simpleSkin`, the `.skn`.
const SIMPLE_SKIN: BinHash = BinHash(0xd6a0_0df6);
/// `SkinMeshDataProperties.skeleton`, the `.skl`.
const SKELETON: BinHash = BinHash(0xb14c_976e);
/// `texture`, on the mesh properties and on each material override.
const TEXTURE: BinHash = BinHash(0x3c64_68f4);
/// `SkinMeshDataProperties.skinScale`.
const SKIN_SCALE: BinHash = BinHash(0xa1f8_05da);
/// `SkinMeshDataProperties.selfIllumination`.
const SELF_ILLUMINATION: BinHash = BinHash(0x252f_6884);
/// `SkinMeshDataProperties.emissiveTexture`.
const EMISSIVE_TEXTURE: BinHash = BinHash(0x9a93_4591);
/// `SkinMeshDataProperties.initialSubmeshToHide`.
const HIDDEN_SUBMESHES: BinHash = BinHash(0x80b7_f78f);
/// `SkinMeshDataProperties.materialOverride`.
const MATERIAL_OVERRIDE: BinHash = BinHash(0x2472_5910);
/// `SkinMeshDataProperties_MaterialOverride.submesh`.
const SUBMESH: BinHash = BinHash(0xaad7_612c);
/// `Material`, the `StaticMaterialDef` link on the mesh properties and on each override.
const MATERIAL: BinHash = BinHash(0xd2e4_d060);
/// `SkinCharacterDataProperties.skinAnimationProperties`.
const ANIMATION_PROPERTIES: BinHash = BinHash(0x426d_89a3);
/// `SkinAnimationProperties.animationGraphData`.
const ANIMATION_GRAPH: BinHash = BinHash(0xf5fb_07c7);
/// `SkinCharacterDataProperties.idleParticlesEffects`.
const IDLE_EFFECTS: BinHash = BinHash(0x8418_6f3c);
/// `SkinCharacterDataProperties.mResourceResolver`.
const RESOURCE_RESOLVER: BinHash = BinHash(0x6228_6e7e);
/// `SkinCharacterDataProperties_CharacterIdleEffect.boneName`.
const BONE_NAME: BinHash = BinHash(0x1ecb_978c);
/// `SkinCharacterDataProperties_CharacterIdleEffect.targetBoneName`.
const TARGET_BONE_NAME: BinHash = BinHash(0xda42_8935);
/// `SkinCharacterDataProperties_CharacterIdleEffect.Position`.
const POSITION: BinHash = BinHash(0x934f_4e0a);
/// `AnimationGraphData.mClipDataMap`.
const CLIP_DATA_MAP: BinHash = BinHash(0x45e1_22f8);
/// `AnimationGraphData.mTrackDataMap`.
const TRACK_DATA_MAP: BinHash = BinHash(0x38ea_85a7);
/// `AnimationGraphData.mMaskDataMap`.
const MASK_DATA_MAP: BinHash = BinHash(0xde04_746e);
/// `AnimationGraphData.mSyncGroupDataMap`.
const SYNC_GROUP_DATA_MAP: BinHash = BinHash(0xaf88_4184);
/// `AtomicClipData.mAnimationResourceData`.
const ANIMATION_RESOURCE: BinHash = BinHash(0xb49f_754e);
/// `AnimationResourceData.mAnimationFilePath`.
const ANIMATION_FILE: BinHash = BinHash(0x0329_f1d7);
/// `AtomicClipData.mTickDuration`.
const TICK_DURATION: BinHash = BinHash(0x193f_611d);
/// `BlendableClipData.mTrackDataName`.
const TRACK_DATA_NAME: BinHash = BinHash(0xd392_43c4);
/// `BlendableClipData.mMaskDataName`.
const MASK_DATA_NAME: BinHash = BinHash(0x0359_739b);
/// `BlendableClipData.mSyncGroupDataName`.
const SYNC_GROUP_DATA_NAME: BinHash = BinHash(0xa09d_0561);
/// `mEventDataMap`, on a blendable clip and on a sequencer.
const EVENT_DATA_MAP: BinHash = BinHash(0xf598_463e);
/// `ClipBaseData.mAnimationInterruptionGroupNames`.
const INTERRUPTION_GROUPS: BinHash = BinHash(0x89d3_4040);
/// `ClipBaseData.mFlags`.
const FLAGS: BinHash = BinHash(0x8d80_922b);
/// `TrackData.mPriority`.
const TRACK_PRIORITY: BinHash = BinHash(0x0f71_7330);
/// `TrackData.mBlendMode`.
const TRACK_BLEND_MODE: BinHash = BinHash(0x9ae6_020c);
/// `TrackData.mBlendWeight`.
const TRACK_BLEND_WEIGHT: BinHash = BinHash(0xf401_8e7f);
/// `MaskData.mId`.
const MASK_ID: BinHash = BinHash(0xc38f_3be5);
/// `MaskData.mWeightList`.
const MASK_WEIGHTS: BinHash = BinHash(0xa3c8_0380);
/// `SyncGroupData.mType`.
const SYNC_GROUP_TYPE: BinHash = BinHash(0x87ed_aeb0);
/// `ParametricClipData.mParametricPairDataList`.
const PARAMETRIC_PAIRS: BinHash = BinHash(0x2ec3_ba66);
/// `ParametricPairData.mClipName`, which the other `m`-prefixed pair kinds share.
const PAIR_CLIP: BinHash = BinHash(0xca2b_847d);
/// `ParametricPairData.mValue`, the parameter the pair's clip plays at.
const PAIR_VALUE: BinHash = BinHash(0x24f2_ec89);
/// `BaseEventData.mStartFrame`.
const EVENT_START_FRAME: BinHash = BinHash(0x250c_fbe1);
/// `BaseEventData.mEndFrame`.
const EVENT_END_FRAME: BinHash = BinHash(0xb725_173e);
/// `SubmeshVisibilityEventData`.
const SUBMESH_VISIBILITY_EVENT: BinHash = BinHash(0xbcf5_6e70);
/// `SubmeshVisibilityEventData.mShowSubmeshList`.
const EVENT_SHOW_SUBMESHES: BinHash = BinHash(0x6d4d_42d0);
/// `SubmeshVisibilityEventData.mHideSubmeshList`.
const EVENT_HIDE_SUBMESHES: BinHash = BinHash(0xbb41_a45b);
/// `ParticleEventData`.
const PARTICLE_EVENT: BinHash = BinHash(0x0542_d41d);
/// `ParticleEventData.mEffectKey`, which is not the idle effect's `effectKey`.
const EVENT_EFFECT_KEY: BinHash = BinHash(0xf638_6280);
/// `ParticleEventData.mEffectName`.
const EVENT_EFFECT_NAME: BinHash = BinHash(0x5a3d_d1c2);
/// `ParticleEventData.mParticleEventDataPairList`.
const EVENT_PAIRS: BinHash = BinHash(0x6064_5d6a);
/// `ParticleEventData.mIsLoop`.
const EVENT_IS_LOOP: BinHash = BinHash(0xd91e_32ee);
/// `ParticleEventData.mIsKillEvent`.
const EVENT_IS_KILL: BinHash = BinHash(0x72a0_3ff8);
/// `ParticleEventData.scale`.
const EVENT_SCALE: BinHash = BinHash(0x8297_1c71);
/// `ParticleEventDataPair.mBoneName`.
const EVENT_BONE: BinHash = BinHash(0xeb88_0965);
/// `ParticleEventDataPair.mTargetBoneName`.
const EVENT_TARGET_BONE: BinHash = BinHash(0x95bb_67b8);
/// `JointSnapEventData`.
const JOINT_SNAP_EVENT: BinHash = BinHash(0xb5c1_b6ad);
/// `JointSnapEventData.mJointNameToOverride`.
const EVENT_JOINT: BinHash = BinHash(0xac70_ab62);
/// `JointSnapEventData.mJointNameToSnapTo`.
const EVENT_SNAP_TO: BinHash = BinHash(0xf6e6_d893);
/// `JointSnapEventData.offset`.
const EVENT_OFFSET: BinHash = BinHash(0x14c8_d3ca);
/// `ConformToPathEventData`.
const CONFORM_EVENT: BinHash = BinHash(0x8237_7a1d);
/// `ConformToPathEventData.mBlendInTime`.
const EVENT_BLEND_IN: BinHash = BinHash(0xdf2f_42a9);
/// `ConformToPathEventData.mBlendOutTime`.
const EVENT_BLEND_OUT: BinHash = BinHash(0xa8c5_78b4);

/// Where a clip names the clips it plays: a `Hash` field, a list of them, or a list of
/// pairs each naming one.
///
/// Every kind of `ClipBaseData` keeps its children under one of these, "What the data
/// is" in docs/plans/animation-graph-table.md. A clip holds the fields of its own kind
/// alone, so one list read in this order is each kind's own field order.
const CHILD_FIELDS: &[Children] = &[
    /* ParametricClipData.mParametricPairDataList[].mClipName */
    Children::Pairs(PARAMETRIC_PAIRS, PAIR_CLIP),
    /* SelectorClipData.mSelectorPairDataList[].mClipName */
    Children::Pairs(BinHash(0x512c_9525), PAIR_CLIP),
    /* ConditionBoolClipData.mTrueConditionClipName */
    Children::One(BinHash(0x4d7a_54c0)),
    /* ConditionBoolClipData.mFalseConditionClipName */
    Children::One(BinHash(0x24af_5ac1)),
    /* ConditionFloatClipData.mConditionFloatPairDataList[].mClipName */
    Children::Pairs(BinHash(0x2329_eec5), PAIR_CLIP),
    /* SequencerClipData.mClipNameList, and ParallelClipData's */
    Children::Many(BinHash(0x078c_afd9)),
    /* EventControlledSelectorClipData.SelectorPairDataList[].ClipName */
    Children::Pairs(BinHash(0xd188_b400), BinHash(0x68c1_4f60)),
    /* EventControlledSelectorClipData.DefaultClipName */
    Children::One(BinHash(0x9a7f_92cb)),
    /* StateAnimClipData.ChildClipName */
    Children::One(BinHash(0x8e5e_6618)),
    /* StateAnimClipData.Transitions[].TargetClipName */
    Children::Pairs(BinHash(0x2132_8a43), BinHash(0xc6f2_91ed)),
    /* SwitchIntClipData.SwitchIntPairDataList[].ClipName */
    Children::Pairs(BinHash(0x778d_6dee), BinHash(0x68c1_4f60)),
];

/// One field a clip names its children through.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Children {
    /// A `Hash` field naming one clip.
    One(BinHash),
    /// A `List<Hash>` naming clips in order.
    Many(BinHash),
    /// A list of structs, each naming one clip in the second field.
    Pairs(BinHash, BinHash),
}

/// A skin, as a viewport draws it.
///
/// A submesh picks what it draws with in the engine's order: its override's `Material`,
/// else its override's `texture`, else the skin's `Material`, else the skin's `texture`.
/// Section 1.3 of docs/research/static-material-studio-rendering.md.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct SkinModel {
    /// The `.skn`, `skinMeshProperties.simpleSkin`.
    pub mesh: Option<NamedAsset>,
    /// The `.skl`, `skinMeshProperties.skeleton`.
    pub skeleton: Option<NamedAsset>,
    /// The texture a submesh draws with where no override names its own.
    pub texture: Option<NamedAsset>,
    /// `emissiveTexture`, the emissive mask of a submesh with no material.
    pub emissive_texture: Option<NamedAsset>,
    /// The `Material` a submesh draws with where no override names its own.
    pub material: Option<MaterialPreview>,
    /// The submeshes a `materialOverride` gives a texture or a material of their own.
    pub overrides: Vec<SubmeshOverride>,
    /// The submeshes `initialSubmeshToHide` names, which the character starts without.
    pub hidden: Vec<String>,
    /// `skinScale`, which the character is drawn at.
    pub scale: f32,
    /// `selfIllumination`, added to the character's ambient light. Zero by default.
    pub self_illumination: f32,
    /// `skinAnimationProperties.animationGraphData`, `0x` and eight hex digits.
    pub animation_graph: Option<String>,
    /// `idleParticlesEffects`, in the order the skin lists them.
    pub idle_effects: Vec<IdleEffect>,
    /// Every effect key `mResourceResolver` maps to a system some file within reach declares.
    ///
    /// A particle event of the graph names a key of this map, and the graph is read from
    /// another file, so the map crosses with the skin for the viewport to look the key up.
    /// [`resolve_skin`] lists the systems the document itself declares, and
    /// [`search_linked_systems`] adds those its linked files declare.
    pub effect_systems: Vec<EffectSystem>,
}

/// One key of the skin's resolver, and the system it stands for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct EffectSystem {
    /// The key, `0x` and eight hex digits.
    pub key: String,
    /// The `VfxSystemDefinitionData` object, `0x` and eight hex digits.
    pub system: String,
    /// The linked file declaring the system, and none where the skin's own document does.
    pub source: Option<AssetRef>,
}

/// One submesh a material override gives its own texture or material.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct SubmeshOverride {
    /// The submesh's name as the `.skn` spells it.
    pub submesh: String,
    /// The override's `texture`, which the submesh draws with in place of the skin's own.
    pub texture: Option<NamedAsset>,
    /// The override's `Material`, which wins over every texture.
    pub material: Option<MaterialPreview>,
}

/// One effect a skin wears for as long as the character stands.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct IdleEffect {
    /// `effectKey`, `0x` and eight hex digits.
    pub effect_key: String,
    /// The system the skin's resolver maps the key to, where this document declares it.
    pub system: Option<String>,
    /// `boneName`, the joint the effect rides.
    pub bone: String,
    /// `targetBoneName`, the joint it aims at, and empty for one that aims at none.
    pub target_bone: String,
    /// `Position`, the effect's offset from its joint.
    pub position: [f32; 3],
}

/// An animation graph, as a clip table and a viewport read it.
///
/// "The model" in docs/plans/animation-graph-table.md. Every list keeps the order its
/// map holds, and every key is named by the tables or written as its hex.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct AnimationGraph {
    /// The linked file declaring the graph, and none where the open document does.
    pub source: Option<AssetRef>,
    /// `mClipDataMap`.
    pub clips: Vec<GraphClip>,
    /// `mTrackDataMap`.
    pub tracks: Vec<Track>,
    /// `mMaskDataMap`.
    pub masks: Vec<Mask>,
    /// `mSyncGroupDataMap`.
    pub sync_groups: Vec<SyncGroup>,
}

/// One entry of `mClipDataMap`, of any kind of `ClipBaseData`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct GraphClip {
    /// The clip's key as the tables name it, and its hash where none does.
    pub name: String,
    /// The key, `0x` and eight hex digits.
    pub hash: String,
    /// The clip's class as the tables name it, and its hash where none does.
    pub class: String,
    /// `mAnimationResourceData.mAnimationFilePath`, which an atomic clip alone names.
    pub animation: Option<NamedAsset>,
    /// `mTrackDataName`.
    pub track: Option<KeyRef>,
    /// `mMaskDataName`.
    pub mask: Option<KeyRef>,
    /// `mSyncGroupDataName`.
    pub sync_group: Option<KeyRef>,
    /// `mTickDuration`, seconds per tick, which an atomic clip alone sets.
    pub tick_duration: Option<f32>,
    /// `mEventDataMap`, in map order.
    pub events: Vec<ClipEvent>,
    /// The clips this one plays, in its kind's field order.
    pub children: Vec<KeyRef>,
    /// `mValue` of each pair of a parametric clip, one per child in the same order, and
    /// empty for every other kind.
    pub parameters: Vec<f32>,
    /// `mAnimationInterruptionGroupNames`.
    pub interruption_groups: Vec<String>,
    /// `mFlags`.
    pub flags: u32,
}

/// One entry of `mEventDataMap`, of any kind of `BaseEventData`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct ClipEvent {
    /// The event's key as the tables name it, and its hash where none does.
    pub name: String,
    /// The key, `0x` and eight hex digits.
    pub hash: String,
    /// The event's class as the tables name it, and its hash where none does.
    pub class: String,
    /// `mStartFrame`, the frame of the clip the event fires on.
    pub start_frame: f32,
    /// `mEndFrame`, and none for an event that ends on its own, which the meta writes as -1.
    pub end_frame: Option<f32>,
    /// What the event does, for the kinds a viewport plays.
    pub kind: EventKind,
}

/// What a clip event does, for the kinds a viewport plays, and nothing for the rest.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum EventKind {
    /// `SubmeshVisibilityEventData`: submeshes shown and hidden from the start frame on.
    SubmeshVisibility {
        /// `mShowSubmeshList`.
        show: Vec<HashRef>,
        /// `mHideSubmeshList`.
        hide: Vec<HashRef>,
    },
    /// `ParticleEventData`: a system spawned on a joint at the start frame.
    #[serde(rename_all = "camelCase")]
    Particle {
        /// `mEffectKey`, `0x` and eight hex digits, which the skin's resolver maps.
        effect_key: String,
        /// `mEffectName`, what the author called it.
        effect_name: String,
        /// `mParticleEventDataPairList`, one spawn per pair.
        spawns: Vec<EventSpawn>,
        /// `mIsLoop`.
        is_loop: bool,
        /// `mIsKillEvent`, which stops the effect of the key rather than spawning one.
        is_kill: bool,
        /// `scale`, which the meta defaults to one.
        scale: f32,
    },
    /// `JointSnapEventData`: one joint stands where another does, from the start frame on.
    #[serde(rename_all = "camelCase")]
    JointSnap {
        /// `mJointNameToOverride`, the joint moved, and none for an event naming no joint.
        joint: Option<HashRef>,
        /// `mJointNameToSnapTo`, the joint it stands on, and none for an event naming no joint.
        snap_to: Option<HashRef>,
        /// `offset`, in the frame of the joint stood on.
        offset: [f32; 3],
    },
    /// `ConformToPathEventData`: the joints a mask weighs follow the unit's path over the span.
    #[serde(rename_all = "camelCase")]
    ConformToPath {
        /// `mMaskDataName`, the joints that conform, and none for an event naming no mask.
        mask: Option<KeyRef>,
        /// `mBlendInTime`, seconds the conforming eases in over.
        blend_in: f32,
        /// `mBlendOutTime`, seconds it eases out over.
        blend_out: f32,
    },
    /// Any other kind, which the viewport draws nothing for.
    Other,
}

/// One pair of a particle event: the joint the system rides, and the joint it aims at.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct EventSpawn {
    /// `mBoneName`, and none for a pair riding the skeleton's own origin.
    pub bone: Option<HashRef>,
    /// `mTargetBoneName`, and none for a pair aiming at nothing.
    pub target_bone: Option<HashRef>,
}

/// A hash a bin names something outside the graph by, such as a submesh or a joint.
///
/// The tables name a few of them. A viewport matches the hash against the names the `.skn`
/// or the `.skl` spells, which is how the engine reaches them too.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct HashRef {
    /// The hash as the tables name it, and its hex where none does.
    pub name: String,
    /// The hash, `0x` and eight hex digits.
    pub hash: String,
}

/// A key one clip names into a map of the graph.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct KeyRef {
    /// The key as the tables name it, and its hash where none does.
    pub name: String,
    /// The key, `0x` and eight hex digits.
    pub hash: String,
    /// The map holds an entry under the key.
    pub declared: bool,
}

/// One entry of `mTrackDataMap`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct Track {
    pub name: String,
    /// The key, `0x` and eight hex digits.
    pub hash: String,
    /// `mPriority`.
    pub priority: u8,
    /// `mBlendMode`.
    pub blend_mode: u8,
    /// `mBlendWeight`.
    pub blend_weight: f32,
}

/// One entry of `mMaskDataMap`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct Mask {
    pub name: String,
    /// The key, `0x` and eight hex digits.
    pub hash: String,
    /// `mId`.
    pub id: u32,
    /// `mWeightList`, one weight per joint of the skeleton in the skeleton's order.
    pub weights: Vec<f32>,
}

/// One entry of `mSyncGroupDataMap`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct SyncGroup {
    pub name: String,
    /// The key, `0x` and eight hex digits.
    pub hash: String,
    /// `mType`.
    pub kind: u32,
}

/// The skin object at `entry`, as a viewport draws it.
///
/// A field the skin leaves out answers the meta default: no file, a scale of one, no graph
/// and no effects. `shaders` is `data/shaders/shaders.bin`, which a material's slots
/// take their defaults from, and none leaves every material on its own fields.
///
/// # Errors
///
/// Fails with [`BinDocumentError::NodeNotFound`] where `entry` is no object of the
/// document.
pub fn resolve_skin(
    document: &BinDocument,
    entry: BinHash,
    names: &dyn RowNames,
    assets: &dyn AssetLookup,
    shaders: Option<&BinDocument>,
) -> Result<SkinModel, BinDocumentError> {
    let skin = &object_at(document, entry)?.properties;
    let locator = Locator { names, assets };
    let mesh = fields_of(skin.get(&MESH_PROPERTIES));
    let mesh_field = |field: BinHash| mesh.and_then(|mesh| mesh.get(&field));
    let material =
        |value| link(value).map(|hash| linked_material(document, hash, &locator, shaders));
    let systems = resolver_systems(document, link(skin.get(&RESOURCE_RESOLVER)));

    Ok(SkinModel {
        mesh: locator.asset(mesh_field(SIMPLE_SKIN)),
        skeleton: locator.asset(mesh_field(SKELETON)),
        texture: locator.asset(mesh_field(TEXTURE)),
        emissive_texture: locator.asset(mesh_field(EMISSIVE_TEXTURE)),
        material: material(mesh_field(MATERIAL)),
        overrides: items(mesh_field(MATERIAL_OVERRIDE))
            .iter()
            .filter_map(|item| {
                let fields = fields_of(Some(item))?;
                let texture = locator.asset(fields.get(&TEXTURE));
                let material = material(fields.get(&MATERIAL));
                /* An override naming neither draws as no override at all. */
                if texture.is_none() && material.is_none() {
                    return None;
                }
                Some(SubmeshOverride {
                    submesh: text(fields.get(&SUBMESH))?.to_owned(),
                    texture,
                    material,
                })
            })
            .collect(),
        hidden: text(mesh_field(HIDDEN_SUBMESHES))
            .map(submesh_names)
            .unwrap_or_default(),
        scale: match leaf(mesh_field(SKIN_SCALE)) {
            Some(Leaf::F32(scale)) => scale,
            _ => 1.0,
        },
        self_illumination: f32_of(mesh_field(SELF_ILLUMINATION), 0.0),
        animation_graph: fields_of(skin.get(&ANIMATION_PROPERTIES))
            .and_then(|animation| link(animation.get(&ANIMATION_GRAPH)))
            .map(hex),
        idle_effects: idle_effects(document, skin, &systems),
        effect_systems: systems
            .iter()
            .filter(|(_, system)| document.object_at(*system).is_some())
            .map(|(key, system)| EffectSystem {
                key: hex(*key),
                system: hex(*system),
                source: None,
            })
            .collect(),
    })
}

/// The animation graph at `entry`: its clips of every kind, and the maps they key into.
///
/// `source` is none, which is the open document. A caller that found the graph through
/// a link sets it.
///
/// # Errors
///
/// Fails with [`BinDocumentError::NodeNotFound`] where `entry` is no object of the
/// document.
pub fn resolve_graph(
    document: &BinDocument,
    entry: BinHash,
    names: &dyn RowNames,
    assets: &dyn AssetLookup,
) -> Result<AnimationGraph, BinDocumentError> {
    let graph = &object_at(document, entry)?.properties;
    let keys = GraphKeys::of(graph, names, assets);
    let named = |hash: BinHash| keys.named(hash);

    let tracks: Vec<Track> = map_entries(graph.get(&TRACK_DATA_MAP))
        .map(|(hash, fields)| Track {
            name: named(hash),
            hash: hex(hash),
            priority: u8_of(fields.get(&TRACK_PRIORITY)),
            blend_mode: u8_of(fields.get(&TRACK_BLEND_MODE)),
            blend_weight: match leaf(fields.get(&TRACK_BLEND_WEIGHT)) {
                Some(Leaf::F32(weight)) => weight,
                _ => 0.0,
            },
        })
        .collect();
    let masks: Vec<Mask> = map_entries(graph.get(&MASK_DATA_MAP))
        .map(|(hash, fields)| Mask {
            name: named(hash),
            hash: hex(hash),
            id: u32_of(fields.get(&MASK_ID)),
            weights: items(fields.get(&MASK_WEIGHTS))
                .iter()
                .map(|item| match leaf(Some(item)) {
                    Some(Leaf::F32(weight)) => weight,
                    _ => 0.0,
                })
                .collect(),
        })
        .collect();
    let sync_groups: Vec<SyncGroup> = map_entries(graph.get(&SYNC_GROUP_DATA_MAP))
        .map(|(hash, fields)| SyncGroup {
            name: named(hash),
            hash: hex(hash),
            kind: u32_of(fields.get(&SYNC_GROUP_TYPE)),
        })
        .collect();

    let clips = map_entries_with_class(graph.get(&CLIP_DATA_MAP))
        .map(|(hash, class, fields)| GraphClip {
            name: named(hash),
            hash: hex(hash),
            class: keys.class(class),
            animation: fields_of(fields.get(&ANIMATION_RESOURCE))
                .and_then(|resource| keys.locator.asset(resource.get(&ANIMATION_FILE))),
            track: keys.keyed(fields.get(&TRACK_DATA_NAME), GraphMap::Tracks),
            mask: keys.keyed(fields.get(&MASK_DATA_NAME), GraphMap::Masks),
            sync_group: keys.keyed(fields.get(&SYNC_GROUP_DATA_NAME), GraphMap::SyncGroups),
            tick_duration: match leaf(fields.get(&TICK_DURATION)) {
                Some(Leaf::F32(seconds)) => Some(seconds),
                _ => None,
            },
            events: map_entries_with_class(fields.get(&EVENT_DATA_MAP))
                .map(|(hash, class, fields)| ClipEvent {
                    name: named(hash),
                    hash: hex(hash),
                    class: keys.class(class),
                    start_frame: f32_of(fields.get(&EVENT_START_FRAME), 0.0),
                    end_frame: Some(f32_of(fields.get(&EVENT_END_FRAME), -1.0))
                        .filter(|frame| *frame >= 0.0),
                    kind: event_kind(class, fields, &keys),
                })
                .collect(),
            children: children_of(fields)
                .map(|child| keys.key_ref(child, GraphMap::Clips))
                .collect(),
            parameters: parameters_of(fields),
            interruption_groups: items(fields.get(&INTERRUPTION_GROUPS))
                .iter()
                .filter_map(|item| match leaf(Some(item)) {
                    Some(Leaf::Hash(hash)) => Some(named(hash)),
                    _ => None,
                })
                .collect(),
            flags: u32_of(fields.get(&FLAGS)),
        })
        .collect();

    Ok(AnimationGraph {
        source: None,
        clips,
        tracks,
        masks,
        sync_groups,
    })
}

/// The maps of a graph a key names an entry of.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GraphMap {
    Clips,
    Tracks,
    Masks,
    SyncGroups,
}

/// How a graph's hashes are named, and which keys each of its maps declares.
///
/// Every key and hash a graph carries is written through this, so a clip's key, a track
/// it names and a joint an event names take one spelling.
struct GraphKeys<'a> {
    locator: Locator<'a>,
    clips: HashSet<BinHash>,
    tracks: HashSet<BinHash>,
    masks: HashSet<BinHash>,
    sync_groups: HashSet<BinHash>,
}

impl<'a> GraphKeys<'a> {
    /// The keys `graph` declares under each of its maps, named through `names`.
    fn of(graph: &Fields, names: &'a dyn RowNames, assets: &'a dyn AssetLookup) -> Self {
        let keys_of = |field: BinHash| -> HashSet<BinHash> {
            map_entries(graph.get(&field))
                .map(|(hash, _)| hash)
                .collect()
        };
        Self {
            locator: Locator { names, assets },
            clips: keys_of(CLIP_DATA_MAP),
            tracks: keys_of(TRACK_DATA_MAP),
            masks: keys_of(MASK_DATA_MAP),
            sync_groups: keys_of(SYNC_GROUP_DATA_MAP),
        }
    }

    /// A hash as the tables name it, and its hex where none does.
    fn named(&self, hash: BinHash) -> String {
        self.locator.value_name(hash).unwrap_or_else(|| hex(hash))
    }

    /// A class as the tables name it, and its hex where none does.
    fn class(&self, hash: BinHash) -> String {
        self.locator.class_name(hash).unwrap_or_else(|| hex(hash))
    }

    /// A hash naming something outside the graph, such as a submesh or a joint.
    fn hash_ref(&self, hash: BinHash) -> HashRef {
        HashRef {
            name: self.named(hash),
            hash: hex(hash),
        }
    }

    /// A `Hash` field naming something outside the graph, and none for a zero or absent one.
    fn hash_at(&self, value: Option<&PropertyValueEnum>) -> Option<HashRef> {
        match leaf(value) {
            Some(Leaf::Hash(hash)) if hash.0 != 0 => Some(self.hash_ref(hash)),
            _ => None,
        }
    }

    /// A key into `map`, marked for whether the map declares it.
    fn key_ref(&self, hash: BinHash, map: GraphMap) -> KeyRef {
        let keys = match map {
            GraphMap::Clips => &self.clips,
            GraphMap::Tracks => &self.tracks,
            GraphMap::Masks => &self.masks,
            GraphMap::SyncGroups => &self.sync_groups,
        };
        KeyRef {
            name: self.named(hash),
            hash: hex(hash),
            declared: keys.contains(&hash),
        }
    }

    /// A `Hash` field keying into `map`, and none for a zero or absent one.
    fn keyed(&self, value: Option<&PropertyValueEnum>, map: GraphMap) -> Option<KeyRef> {
        match leaf(value) {
            Some(Leaf::Hash(hash)) if hash.0 != 0 => Some(self.key_ref(hash, map)),
            _ => None,
        }
    }
}

/// The entries of a `Map<Hash, Struct>`, each as its key and its fields.
///
/// An entry keyed by anything but a hash, or holding no struct, is passed over.
fn map_entries(value: Option<&PropertyValueEnum>) -> impl Iterator<Item = (BinHash, &Fields)> + '_ {
    map_entries_with_class(value).map(|(hash, _, fields)| (hash, fields))
}

/// The entries of a `Map<Hash, Struct>`, each as its key, its class and its fields.
fn map_entries_with_class(
    value: Option<&PropertyValueEnum>,
) -> impl Iterator<Item = (BinHash, BinHash, &Fields)> + '_ {
    let entries = match value {
        Some(PropertyValueEnum::Map(map)) => map.entries(),
        _ => &[],
    };
    entries.iter().filter_map(|(key, value)| {
        let Some(Leaf::Hash(hash)) = leaf(Some(key)) else {
            return None;
        };
        let (class, fields) = struct_of(Some(value))?;
        Some((hash, class, fields))
    })
}

/// The clips `fields` names as children, through every field of [`CHILD_FIELDS`] it holds.
fn children_of(fields: &Fields) -> impl Iterator<Item = BinHash> + '_ {
    let hash_of = |value: Option<&PropertyValueEnum>| match leaf(value) {
        Some(Leaf::Hash(hash)) if hash.0 != 0 => Some(hash),
        _ => None,
    };
    CHILD_FIELDS.iter().flat_map(move |children| {
        let named: Vec<BinHash> = match *children {
            Children::One(field) => hash_of(fields.get(&field)).into_iter().collect(),
            Children::Many(field) => items(fields.get(&field))
                .iter()
                .filter_map(|item| hash_of(Some(item)))
                .collect(),
            Children::Pairs(field, clip) => items(fields.get(&field))
                .iter()
                .filter_map(|item| hash_of(fields_of(Some(item))?.get(&clip)))
                .collect(),
        };
        named
    })
}

/// The parameter each pair of a parametric clip plays at, for the pairs `children_of` keeps.
///
/// A pair naming no clip is passed over as `children_of` passes it over, so the two lists
/// line up. A pair with no `mValue` plays at zero.
fn parameters_of(fields: &Fields) -> Vec<f32> {
    items(fields.get(&PARAMETRIC_PAIRS))
        .iter()
        .filter_map(|item| {
            let pair = fields_of(Some(item))?;
            match leaf(pair.get(&PAIR_CLIP)) {
                Some(Leaf::Hash(hash)) if hash.0 != 0 => {}
                _ => return None,
            }
            Some(match leaf(pair.get(&PAIR_VALUE)) {
                Some(Leaf::F32(value)) => value,
                _ => 0.0,
            })
        })
        .collect()
}

/// What an event of `class` does, read off `fields`, and nothing for a kind no viewport plays.
fn event_kind(class: BinHash, fields: &Fields, keys: &GraphKeys) -> EventKind {
    let hash_refs = |value: Option<&PropertyValueEnum>| -> Vec<HashRef> {
        items(value)
            .iter()
            .filter_map(|item| keys.hash_at(Some(item)))
            .collect()
    };

    match class {
        SUBMESH_VISIBILITY_EVENT => EventKind::SubmeshVisibility {
            show: hash_refs(fields.get(&EVENT_SHOW_SUBMESHES)),
            hide: hash_refs(fields.get(&EVENT_HIDE_SUBMESHES)),
        },
        PARTICLE_EVENT => EventKind::Particle {
            effect_key: hex(match leaf(fields.get(&EVENT_EFFECT_KEY)) {
                Some(Leaf::Hash(key)) => key,
                _ => BinHash(0),
            }),
            effect_name: text(fields.get(&EVENT_EFFECT_NAME))
                .unwrap_or_default()
                .to_owned(),
            spawns: items(fields.get(&EVENT_PAIRS))
                .iter()
                .filter_map(|item| {
                    let pair = fields_of(Some(item))?;
                    Some(EventSpawn {
                        bone: keys.hash_at(pair.get(&EVENT_BONE)),
                        target_bone: keys.hash_at(pair.get(&EVENT_TARGET_BONE)),
                    })
                })
                .collect(),
            is_loop: bool_of(fields.get(&EVENT_IS_LOOP)),
            is_kill: bool_of(fields.get(&EVENT_IS_KILL)),
            scale: f32_of(fields.get(&EVENT_SCALE), 1.0),
        },
        JOINT_SNAP_EVENT => EventKind::JointSnap {
            joint: keys.hash_at(fields.get(&EVENT_JOINT)),
            snap_to: keys.hash_at(fields.get(&EVENT_SNAP_TO)),
            offset: match leaf(fields.get(&EVENT_OFFSET)) {
                Some(Leaf::Vector3(offset)) => offset.to_array(),
                _ => [0.0; 3],
            },
        },
        CONFORM_EVENT => EventKind::ConformToPath {
            mask: keys.keyed(fields.get(&MASK_DATA_NAME), GraphMap::Masks),
            blend_in: f32_of(fields.get(&EVENT_BLEND_IN), 0.0),
            blend_out: f32_of(fields.get(&EVENT_BLEND_OUT), 0.0),
        },
        _ => EventKind::Other,
    }
}

/// An `F32` field's value, and `default` for one the struct leaves out.
fn f32_of(value: Option<&PropertyValueEnum>, default: f32) -> f32 {
    match leaf(value) {
        Some(Leaf::F32(float)) => float,
        _ => default,
    }
}

/// A `Bool` field's value, and false for one the struct leaves out.
fn bool_of(value: Option<&PropertyValueEnum>) -> bool {
    matches!(leaf(value), Some(Leaf::Bool(true) | Leaf::Flag(true)))
}

/// A `U8` field's value, and zero for one the struct leaves out.
fn u8_of(value: Option<&PropertyValueEnum>) -> u8 {
    match leaf(value) {
        Some(Leaf::U8(byte)) => byte,
        _ => 0,
    }
}

/// A `U32` field's value, and zero for one the struct leaves out.
fn u32_of(value: Option<&PropertyValueEnum>) -> u32 {
    match leaf(value) {
        Some(Leaf::U32(word)) => word,
        _ => 0,
    }
}

/// Where an animation graph is: in the document read, or in a file it links.
#[derive(Debug, Clone, PartialEq)]
pub enum GraphRead {
    /// The document declares the graph.
    Found(AnimationGraph),
    /// The document declares no graph under the entry, and these are the files it links
    /// that this machine holds, in the order the header lists them.
    Linked(Vec<AssetRef>),
}

/// The graph at `entry`, or the linked files to look for it in.
///
/// A skin's graph is usually declared in the animations bin its own file links, which is
/// where the engine resolves it from too, so the links are looked in before the object
/// index is needed.
///
/// # Errors
///
/// Fails as [`resolve_graph`] does, which it only calls for an entry the document holds.
pub fn graph_at(
    document: &BinDocument,
    entry: BinHash,
    names: &dyn RowNames,
    assets: &dyn AssetLookup,
) -> Result<GraphRead, BinDocumentError> {
    if document.object_at(entry).is_some() {
        return resolve_graph(document, entry, names, assets).map(GraphRead::Found);
    }
    Ok(GraphRead::Linked(
        document
            .dependencies()
            .iter()
            .filter_map(|path| assets.locate(path))
            .collect(),
    ))
}

/// The most linked files a graph is looked for in, however deep the links run.
const LINKED_CAP: usize = 32;

/// The graph at `entry`, looked for in `linked` and in what each file links.
///
/// Breadth first, each file's links in the order its header lists them, so the file
/// nearest the skin wins. `read` answers a file's document, and none for one it cannot
/// read, which is passed over. A file reached twice is read once. The graph's `source`
/// is the file it was found in.
///
/// # Errors
///
/// Fails with [`BinDocumentError::NodeNotFound`] where no file within reach declares the
/// graph.
pub fn search_linked(
    linked: Vec<AssetRef>,
    entry: BinHash,
    names: &dyn RowNames,
    assets: &dyn AssetLookup,
    read: &mut dyn FnMut(&AssetRef) -> Option<BinDocument>,
) -> Result<AnimationGraph, BinDocumentError> {
    let mut found = None;
    walk_linked(linked, assets, read, &mut |asset, document| {
        if document.object_at(entry).is_none() {
            return Walk::On;
        }
        found = Some(
            resolve_graph(document, entry, names, assets).map(|mut graph| {
                graph.source = Some(asset.clone());
                graph
            }),
        );
        Walk::Done
    });
    found.unwrap_or_else(|| {
        Err(BinDocumentError::NodeNotFound {
            address: format!("{}:", hex(entry)),
        })
    })
}

/// The materials of `model` no document within reach declared, looked for in `linked`
/// and in what each file links.
///
/// A skin's materials are in its own file for all but the few a merged CAC bin declares,
/// and those the skin reaches through its links, as [`search_linked`] reaches a graph.
/// Every link a material has stays missing where the walk ends first. `shaders` is the
/// defs [`resolve_skin`] took.
pub fn search_linked_materials(
    model: &mut SkinModel,
    linked: Vec<AssetRef>,
    names: &dyn RowNames,
    assets: &dyn AssetLookup,
    shaders: Option<&BinDocument>,
    read: &mut dyn FnMut(&AssetRef) -> Option<BinDocument>,
) {
    let locator = Locator { names, assets };
    let mut missing: Vec<&mut MaterialPreview> = model
        .material
        .iter_mut()
        .chain(
            model
                .overrides
                .iter_mut()
                .filter_map(|o| o.material.as_mut()),
        )
        .filter(|material| material.missing)
        .collect();
    if missing.is_empty() {
        return;
    }
    walk_linked(linked, assets, read, &mut |asset, document| {
        for material in &mut missing {
            let Some(hash) = parse_hex(&material.hash) else {
                continue;
            };
            if document.object_at(hash).is_some() {
                **material = MaterialPreview {
                    source: Some(asset.clone()),
                    ..linked_material(document, hash, &locator, shaders)
                };
            }
        }
        missing.retain(|material| material.missing);
        if missing.is_empty() {
            Walk::Done
        } else {
            Walk::On
        }
    });
}

/// The systems the skin's resolver maps that `document` does not declare, looked for in
/// `linked` and in what each file links, and added to `model` with the file each was
/// found in.
///
/// A skin keeps its particle systems in a file of their own as often as in its own, and
/// the resolver links neither, so they are reached as [`search_linked`] reaches a graph.
/// `document` is the one [`resolve_skin`] read `model` from and `entry` its skin object.
/// A key no file within reach declares a system for is left out.
pub fn search_linked_systems(
    model: &mut SkinModel,
    document: &BinDocument,
    entry: BinHash,
    linked: Vec<AssetRef>,
    assets: &dyn AssetLookup,
    read: &mut dyn FnMut(&AssetRef) -> Option<BinDocument>,
) {
    let Some(skin) = document.object_at(entry) else {
        return;
    };
    let held: HashSet<&str> = model
        .effect_systems
        .iter()
        .map(|e| e.key.as_str())
        .collect();
    let mut missing: Vec<(BinHash, BinHash)> =
        resolver_systems(document, link(skin.properties.get(&RESOURCE_RESOLVER)))
            .into_iter()
            .filter(|(key, _)| !held.contains(hex(*key).as_str()))
            .collect();
    if missing.is_empty() {
        return;
    }
    let mut found = Vec::new();
    walk_linked(linked, assets, read, &mut |asset, document| {
        missing.retain(|(key, system)| {
            if document.object_at(*system).is_none() {
                return true;
            }
            found.push(EffectSystem {
                key: hex(*key),
                system: hex(*system),
                source: Some(asset.clone()),
            });
            false
        });
        if missing.is_empty() {
            Walk::Done
        } else {
            Walk::On
        }
    });
    model.effect_systems.extend(found);
    model.effect_systems.sort_by(|a, b| a.key.cmp(&b.key));
}

/// Whether a walk over linked files goes on past the file it is at.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Walk {
    On,
    Done,
}

/// Every file in `linked` and in what each links, breadth first, until `visit` is done.
///
/// Each file's links come in the order its header lists them, so the file nearest the
/// skin is visited first. `read` answers a file's document, and none for one it cannot
/// read, which is passed over. A file reached twice is read once, and at most
/// [`LINKED_CAP`] files are opened.
fn walk_linked(
    linked: Vec<AssetRef>,
    assets: &dyn AssetLookup,
    read: &mut dyn FnMut(&AssetRef) -> Option<BinDocument>,
    visit: &mut dyn FnMut(&AssetRef, &BinDocument) -> Walk,
) {
    let mut seen: HashSet<AssetRef> = linked.iter().cloned().collect();
    let mut queue: VecDeque<AssetRef> = linked.into();
    let mut opened = 0;

    while let Some(asset) = queue.pop_front() {
        if opened == LINKED_CAP {
            break;
        }
        opened += 1;
        let Some(document) = read(&asset) else {
            continue;
        };
        if visit(&asset, &document) == Walk::Done {
            return;
        }
        for next in document
            .dependencies()
            .iter()
            .filter_map(|path| assets.locate(path))
        {
            if seen.insert(next.clone()) {
                queue.push_back(next);
            }
        }
    }
}

/// The hash a record prints, `0x` and eight hex digits, read back.
fn parse_hex(text: &str) -> Option<BinHash> {
    crate::object_index::parse_hash(text)
}

/// The skin's idle effects, each with the system its key resolves to out of `systems`,
/// where `document` declares it.
fn idle_effects(
    document: &BinDocument,
    skin: &Fields,
    systems: &[(BinHash, BinHash)],
) -> Vec<IdleEffect> {
    items(skin.get(&IDLE_EFFECTS))
        .iter()
        .filter_map(|item| {
            let fields = fields_of(Some(item))?;
            let key = match leaf(fields.get(&EFFECT_KEY)) {
                Some(Leaf::Hash(key)) => key,
                _ => BinHash(0),
            };
            Some(IdleEffect {
                effect_key: hex(key),
                system: systems
                    .iter()
                    .find(|(each, _)| *each == key)
                    .filter(|(_, system)| document.object_at(*system).is_some())
                    .map(|(_, system)| hex(*system)),
                bone: text(fields.get(&BONE_NAME)).unwrap_or_default().to_owned(),
                target_bone: text(fields.get(&TARGET_BONE_NAME))
                    .unwrap_or_default()
                    .to_owned(),
                position: match leaf(fields.get(&POSITION)) {
                    Some(Leaf::Vector3(position)) => position.to_array(),
                    _ => [0.0; 3],
                },
            })
        })
        .collect()
}

/// The effect keys the resolver object `resolver` maps, each with the system it names, in
/// key order.
///
/// The first entry for a key wins, which is the order the engine probes a map in.
fn resolver_systems(document: &BinDocument, resolver: Option<BinHash>) -> Vec<(BinHash, BinHash)> {
    let mut systems = HashMap::new();
    let Some(resolver) = resolver.and_then(|resolver| document.object_at(resolver)) else {
        return Vec::new();
    };
    for (key, target) in resolver_entries(resolver) {
        systems.entry(key).or_insert(target);
    }
    let mut mapped: Vec<(BinHash, BinHash)> = systems.into_iter().collect();
    mapped.sort_by_key(|(key, _)| key.0);
    mapped
}

/// The submesh names `initialSubmeshToHide` lists, apart on spaces and commas.
fn submesh_names(list: &str) -> Vec<String> {
    list.split(|character: char| character.is_whitespace() || character == ',')
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
        .collect()
}

#[cfg(test)]
mod tests;
