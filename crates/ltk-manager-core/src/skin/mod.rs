//! What a skin gives a viewport: the files its character is built from, the effects it
//! wears, and the clips its animation graph plays.
//!
//! Rust resolves the references and TypeScript draws them, the split
//! docs/plans/vfx-particle-renderer.md makes for a particle system. A skin reads a
//! handful of named fields rather than walking its subtree, because the resolver it links
//! maps every system its file declares and a walk would inline all of them.

use std::collections::{HashMap, HashSet, VecDeque};

use indexmap::IndexMap;
use ltk_hash::BinHash;
use ltk_meta::PropertyValueEnum;
use ltk_meta::property::values;
use ltk_meta::walk::{Leaf, TreeValue as _};
use serde::Serialize;

use crate::bin_document::{
    AssetLookup, BinDocument, BinDocumentError, EFFECT_KEY, RowNames, chunk_asset, first_name, hex,
    object_at, owned, resolver_entries,
};
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
/// `SkinMeshDataProperties.initialSubmeshToHide`.
const HIDDEN_SUBMESHES: BinHash = BinHash(0x80b7_f78f);
/// `SkinMeshDataProperties.materialOverride`.
const MATERIAL_OVERRIDE: BinHash = BinHash(0x2472_5910);
/// `SkinMeshDataProperties_MaterialOverride.submesh`.
const SUBMESH: BinHash = BinHash(0xaad7_612c);
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
/// `AtomicClipData`, the one clip class that plays a single `.anm`.
const ATOMIC_CLIP: BinHash = BinHash(0x5bd9_a1e6);
/// `AtomicClipData.mAnimationResourceData`.
const ANIMATION_RESOURCE: BinHash = BinHash(0xb49f_754e);
/// `AnimationResourceData.mAnimationFilePath`.
const ANIMATION_FILE: BinHash = BinHash(0x0329_f1d7);

/// A path a bin names, and where its bytes live.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct NamedAsset {
    /// The path as the bin spells it, or a chunk's sixteen hex digits where no table
    /// names it.
    pub path: String,
    /// Absent for a path nothing on this machine holds, which is not an error.
    pub asset: Option<AssetRef>,
}

/// A skin, as a viewport draws it.
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
    /// The submeshes a `materialOverride` gives a texture of their own.
    pub overrides: Vec<SubmeshTexture>,
    /// The submeshes `initialSubmeshToHide` names, which the character starts without.
    pub hidden: Vec<String>,
    /// `skinScale`, which the character is drawn at.
    pub scale: f32,
    /// `skinAnimationProperties.animationGraphData`, `0x` and eight hex digits.
    pub animation_graph: Option<String>,
    /// `idleParticlesEffects`, in the order the skin lists them.
    pub idle_effects: Vec<IdleEffect>,
}

/// One submesh a material override gives its own texture.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct SubmeshTexture {
    /// The submesh's name as the `.skn` spells it.
    pub submesh: String,
    /// The override's `texture`, which the submesh draws with in place of the skin's own.
    pub texture: NamedAsset,
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

/// One clip an animation graph plays out of a single `.anm`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct AnimationClip {
    /// The clip's key as the tables name it, and its hash where none does.
    pub name: String,
    /// The key, `0x` and eight hex digits.
    pub hash: String,
    /// `mAnimationResourceData.mAnimationFilePath`.
    pub animation: NamedAsset,
}

/// The skin object at `entry`, as a viewport draws it.
///
/// A field the skin leaves out answers the meta default: no file, a scale of one, no graph
/// and no effects.
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
) -> Result<SkinModel, BinDocumentError> {
    let skin = &object_at(document, entry)?.properties;
    let locator = Locator { names, assets };
    let mesh = fields_of(skin.get(&MESH_PROPERTIES));
    let mesh_field = |field: BinHash| mesh.and_then(|mesh| mesh.get(&field));

    Ok(SkinModel {
        mesh: locator.asset(mesh_field(SIMPLE_SKIN)),
        skeleton: locator.asset(mesh_field(SKELETON)),
        texture: locator.asset(mesh_field(TEXTURE)),
        overrides: items(mesh_field(MATERIAL_OVERRIDE))
            .iter()
            .filter_map(|item| {
                let fields = fields_of(Some(item))?;
                Some(SubmeshTexture {
                    submesh: text(fields.get(&SUBMESH))?.to_owned(),
                    texture: locator.asset(fields.get(&TEXTURE))?,
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
        animation_graph: fields_of(skin.get(&ANIMATION_PROPERTIES))
            .and_then(|animation| link(animation.get(&ANIMATION_GRAPH)))
            .map(hex),
        idle_effects: idle_effects(document, skin),
    })
}

/// The atomic clips of the animation graph at `entry`, in the order the graph holds them.
///
/// A clip of any other class blends or picks between atomic ones and plays no file of its
/// own, so it is left out.
///
/// # Errors
///
/// Fails with [`BinDocumentError::NodeNotFound`] where `entry` is no object of the
/// document.
pub fn resolve_clips(
    document: &BinDocument,
    entry: BinHash,
    names: &dyn RowNames,
    assets: &dyn AssetLookup,
) -> Result<Vec<AnimationClip>, BinDocumentError> {
    let graph = &object_at(document, entry)?.properties;
    let locator = Locator { names, assets };
    let Some(PropertyValueEnum::Map(map)) = graph.get(&CLIP_DATA_MAP) else {
        return Ok(Vec::new());
    };

    Ok(map
        .entries()
        .iter()
        .filter_map(|(key, value)| {
            let Some(Leaf::Hash(hash)) = leaf(Some(key)) else {
                return None;
            };
            let (class, clip) = struct_of(Some(value))?;
            if class != ATOMIC_CLIP {
                return None;
            }
            let animation =
                locator.asset(fields_of(clip.get(&ANIMATION_RESOURCE))?.get(&ANIMATION_FILE))?;
            Some(AnimationClip {
                name: locator.value_name(hash).unwrap_or_else(|| hex(hash)),
                hash: hex(hash),
                animation,
            })
        })
        .collect())
}

/// Where an animation graph's clips are: in the document read, or in a file it links.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GraphClips {
    /// The document declares the graph, and these are its clips.
    Found(Vec<AnimationClip>),
    /// The document declares no graph under the entry, and these are the files it links
    /// that this machine holds, in the order the header lists them.
    Linked(Vec<AssetRef>),
}

/// The clips of the graph at `entry`, or the linked files to look for it in.
///
/// A skin's graph is usually declared in the animations bin its own file links, which is
/// where the engine resolves it from too, so the links are looked in before the object
/// index is needed.
///
/// # Errors
///
/// Fails as [`resolve_clips`] does, which it only calls for an entry the document holds.
pub fn graph_clips(
    document: &BinDocument,
    entry: BinHash,
    names: &dyn RowNames,
    assets: &dyn AssetLookup,
) -> Result<GraphClips, BinDocumentError> {
    if document.object_at(entry).is_some() {
        return resolve_clips(document, entry, names, assets).map(GraphClips::Found);
    }
    Ok(GraphClips::Linked(
        document
            .dependencies()
            .iter()
            .filter_map(|path| assets.locate(path))
            .collect(),
    ))
}

/// The most linked files a graph is looked for in, however deep the links run.
const LINKED_CAP: usize = 32;

/// The clips of the graph at `entry`, looked for in `linked` and in what each file links.
///
/// Breadth first, each file's links in the order its header lists them, so the file
/// nearest the skin wins. `read` answers a file's document, and none for one it cannot
/// read, which is passed over. A file reached twice is read once.
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
) -> Result<Vec<AnimationClip>, BinDocumentError> {
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
        if document.object_at(entry).is_some() {
            return resolve_clips(&document, entry, names, assets);
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
    Err(BinDocumentError::NodeNotFound {
        address: format!("{}:", hex(entry)),
    })
}

/// The skin's idle effects, each with the system its key resolves to.
fn idle_effects(document: &BinDocument, skin: &Fields) -> Vec<IdleEffect> {
    let systems = resolver_map(document, link(skin.get(&RESOURCE_RESOLVER)));

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
                    .get(&key)
                    .copied()
                    .filter(|system| document.object_at(*system).is_some())
                    .map(hex),
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

/// The effect keys the resolver object `resolver` maps, to the object each names.
///
/// The first entry for a key wins, which is the order the engine probes a map in.
fn resolver_map(document: &BinDocument, resolver: Option<BinHash>) -> HashMap<BinHash, BinHash> {
    let mut systems = HashMap::new();
    let Some(resolver) = resolver.and_then(|resolver| document.object_at(resolver)) else {
        return systems;
    };
    for (key, target) in resolver_entries(resolver) {
        systems.entry(key).or_insert(target);
    }
    systems
}

/// The submesh names `initialSubmeshToHide` lists, apart on spaces and commas.
fn submesh_names(list: &str) -> Vec<String> {
    list.split(|character: char| character.is_whitespace() || character == ',')
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
        .collect()
}

/// What a read names hashes by and places paths through.
struct Locator<'a> {
    names: &'a dyn RowNames,
    assets: &'a dyn AssetLookup,
}

impl Locator<'_> {
    /// The file `value` names as a path or as a chunk, and none for an empty one.
    fn asset(&self, value: Option<&PropertyValueEnum>) -> Option<NamedAsset> {
        match leaf(value)? {
            Leaf::String(path) if !path.is_empty() => Some(self.placed(path.to_owned())),
            Leaf::File(hash) if hash.0 != 0 => {
                let name = first_name(|visit| self.names.for_each_chunk(&[hash], visit));
                let (path, asset) = chunk_asset(hash, name, self.assets);
                Some(NamedAsset { path, asset })
            }
            _ => None,
        }
    }

    fn placed(&self, path: String) -> NamedAsset {
        NamedAsset {
            asset: self.assets.locate(&path),
            path,
        }
    }

    fn value_name(&self, hash: BinHash) -> Option<String> {
        first_name(|visit| self.names.for_each_value(&[hash], visit))
    }
}

type Fields = IndexMap<BinHash, PropertyValueEnum>;

/// The class and the fields of the struct `value` holds, through an optional, and none
/// for a null one.
fn struct_of(value: Option<&PropertyValueEnum>) -> Option<(BinHash, &Fields)> {
    match value? {
        PropertyValueEnum::Struct(inner) | PropertyValueEnum::Embedded(values::Embedded(inner))
            if inner.class_hash.0 != 0 =>
        {
            Some((inner.class_hash, &inner.properties))
        }
        PropertyValueEnum::Optional(optional) => struct_of(optional.value()),
        _ => None,
    }
}

fn fields_of(value: Option<&PropertyValueEnum>) -> Option<&Fields> {
    struct_of(value).map(|(_, fields)| fields)
}

fn items(value: Option<&PropertyValueEnum>) -> &[PropertyValueEnum] {
    match value {
        Some(PropertyValueEnum::Container(items)) => items.items(),
        Some(PropertyValueEnum::UnorderedContainer(items)) => items.items(),
        _ => &[],
    }
}

fn leaf(value: Option<&PropertyValueEnum>) -> Option<Leaf<'_>> {
    owned(value?.leaf())
}

fn text(value: Option<&PropertyValueEnum>) -> Option<&str> {
    match leaf(value)? {
        Leaf::String(text) => Some(text),
        _ => None,
    }
}

/// The object `value` links to, and none for a null link.
fn link(value: Option<&PropertyValueEnum>) -> Option<BinHash> {
    match leaf(value)? {
        Leaf::Link(hash) if hash.0 != 0 => Some(hash),
        _ => None,
    }
}

#[cfg(test)]
mod tests;
