//! The walk: one object's property subtree into a [`VfxValue`], with every link chased
//! and every asset name located.

use std::collections::HashMap;

use indexmap::IndexMap;
use ltk_hash::{BinHash, WadHash};
use ltk_meta::property::values;
use ltk_meta::walk::{Leaf, TreeValue as _};
use ltk_meta::{BinObject, PropertyValueEnum};

use super::{VfxField, VfxMapEntry, VfxObject, VfxSystem, VfxValue};
use crate::bin_document::{
    AssetLookup, BinDocument, BinDocumentError, EFFECT_KEY, Namer, RowNames, chunk_asset, hex,
    object_at, owned, resolver_entries,
};
use crate::problems::walk;

/// How many values one system answers, past which the read is refused.
///
/// The bound is on the answer rather than on the data: a system a person authored is
/// orders under it, and what reaches it is a tree no viewport draws.
pub const MAX_NODES: usize = 500_000;

/// How deep the walk descends, past which the read is refused.
///
/// A property nests through its containers and its embedded classes, and neither runs
/// deep. What reaches this is a shape the format allows and the game does not author.
pub const MAX_DEPTH: usize = 64;

/// The fields whose string is a path to an asset, by the hash a bin writes them as.
///
/// `VfxEmitterDefinitionData`'s four texture and mesh names, then
/// `VfxMeshDefinitionData`'s three, then the texture `VfxTextureMultDefinitionData`
/// names, the normal map `VfxDistortionDefinitionData` names and the cube map
/// `VfxReflectionDefinitionData` names. The mult hash is the emitter's own pointer to the
/// mult as well, and the two are told apart by the value rather than by the field: only a
/// string is located.
const ASSET_FIELDS: [BinHash; 12] = [
    BinHash(0x3c64_68f4), // texture
    BinHash(0xa5b8_cdf4), // falloffTexture
    BinHash(0xb56e_8811), // particleColorTexture
    BinHash(0x2135_c4d4), // emissionMeshName
    BinHash(0x8c41_a32e), // mMeshName
    BinHash(0x9059_5a15), // mMeshSkeletonName
    BinHash(0xd467_e8c0), // mSimpleMeshName
    BinHash(0x2f2e_99f2), // textureMult
    BinHash(0xffa7_11fb), // paletteTexture
    BinHash(0x5da0_5f9b), // erosionMapName
    BinHash(0xe672_d557), // normalMapTexture
    BinHash(0x85a3_4efd), // reflectionMapTexture
];

/// `VfxChildIdentifier`, the one class whose `effectKey` a walk resolves.
///
/// Other classes write the field too, and nothing reads theirs as a child.
const CHILD_IDENTIFIER: BinHash = BinHash(0x969a_ee94);

/// `ResourceResolver`, the scope a skin's effect keys resolve in.
const RESOURCE_RESOLVER: BinHash = BinHash(0xef3a_0f33);

/// One system's whole property subtree, with every reference resolved.
///
/// A `Link` naming another object of the same document is inlined as that object's
/// tree, and so is an `effectKey` a `ResourceResolver` of the document maps to one of its
/// objects. One naming an object the walk is already inside answers as a link, so a cycle
/// ends where it closes. `assets` decides where a name field's bytes live, and a name
/// it does not place is a path and no asset rather than a failure.
///
/// # Errors
///
/// Fails with [`BinDocumentError::NodeNotFound`] where `entry` is no object of the
/// document, and with [`BinDocumentError::ReadTooLarge`] or
/// [`BinDocumentError::ReadTooDeep`] where the subtree is larger than one read answers.
pub fn resolve_system(
    document: &BinDocument,
    entry: BinHash,
    names: &dyn RowNames,
    assets: &dyn AssetLookup,
) -> Result<VfxSystem, BinDocumentError> {
    let object = object_at(document, entry)?;

    let mut walk = Walk {
        document,
        namer: Namer::new(names),
        assets,
        resources: resources(document),
        open: vec![entry],
        values: 0,
    };
    let root = walk.object(entry, object, 0)?;

    Ok(VfxSystem {
        entry: hex(entry),
        name: walk.namer.entry(entry),
        class_hash: hex(object.class_hash),
        class: walk.namer.class(object.class_hash),
        root,
    })
}

/// One read of one system: the tree it is over, what it resolves against, and what it
/// has spent of the caps.
struct Walk<'a> {
    document: &'a BinDocument,
    namer: Namer<'a>,
    assets: &'a dyn AssetLookup,
    /// Every effect key the document's resolvers map, to the object its link names.
    resources: HashMap<BinHash, BinHash>,
    /// The objects the walk is inside, which a link back into answers as a link.
    open: Vec<BinHash>,
    values: usize,
}

impl<'a> Walk<'a> {
    /// One object's properties, as the struct they are declared on, naming the object.
    fn object(
        &mut self,
        entry: BinHash,
        object: &BinObject,
        depth: usize,
    ) -> Result<VfxValue, BinDocumentError> {
        self.charge(depth)?;
        let named = VfxObject {
            entry: hex(entry),
            name: self.namer.entry(entry),
        };
        self.node(object.class_hash, &object.properties, Some(named), depth)
    }

    /// One class and its properties, resolved.
    fn node(
        &mut self,
        class_hash: BinHash,
        properties: &IndexMap<BinHash, PropertyValueEnum>,
        object: Option<VfxObject>,
        depth: usize,
    ) -> Result<VfxValue, BinDocumentError> {
        let mut fields = Vec::with_capacity(properties.len());
        for (field, value) in properties {
            fields.push(VfxField {
                hash: hex(*field),
                name: self.namer.field(*field),
                value: self.field(class_hash, *field, value, depth + 1)?,
            });
        }
        Ok(VfxValue::Struct {
            class_hash: hex(class_hash),
            class: self.namer.class(class_hash),
            fields,
            object,
        })
    }

    /// One property of a struct of `class`, resolved.
    ///
    /// A field that names an asset reads its string as a path, and a child identifier's
    /// effect key the document resolves reads as the system it names.
    fn field(
        &mut self,
        class: BinHash,
        field: BinHash,
        value: &PropertyValueEnum,
        depth: usize,
    ) -> Result<VfxValue, BinDocumentError> {
        if ASSET_FIELDS.contains(&field)
            && let Some(Leaf::String(path)) = owned(value.leaf())
        {
            self.charge(depth)?;
            return Ok(self.asset(path.to_owned()));
        }
        if class == CHILD_IDENTIFIER
            && field == EFFECT_KEY
            && let Some(Leaf::Hash(key)) = owned(value.leaf())
            && let Some(&target) = self.resources.get(&key)
            && self.document.object_at(target).is_some()
        {
            self.charge(depth)?;
            return self.link(target, depth);
        }
        self.value(value, depth)
    }

    /// Any value, resolved.
    fn value(
        &mut self,
        value: &PropertyValueEnum,
        depth: usize,
    ) -> Result<VfxValue, BinDocumentError> {
        self.charge(depth)?;
        match value {
            PropertyValueEnum::Container(items) => self.items(items.items(), depth),
            PropertyValueEnum::UnorderedContainer(items) => self.items(items.items(), depth),
            PropertyValueEnum::Optional(optional) => match optional.value() {
                Some(inner) => self.value(inner, depth + 1),
                None => Ok(VfxValue::None),
            },
            PropertyValueEnum::Map(map) => self.entries(map.entries(), depth),
            PropertyValueEnum::Struct(inner) if inner.class_hash.0 == 0 => Ok(VfxValue::Null),
            PropertyValueEnum::Struct(inner)
            | PropertyValueEnum::Embedded(values::Embedded(inner)) => {
                self.node(inner.class_hash, &inner.properties, None, depth)
            }
            leaf => self.leaf(owned(leaf.leaf()), depth),
        }
    }

    fn items(
        &mut self,
        items: &[PropertyValueEnum],
        depth: usize,
    ) -> Result<VfxValue, BinDocumentError> {
        let mut resolved = Vec::with_capacity(items.len());
        for item in items {
            resolved.push(self.value(item, depth + 1)?);
        }
        Ok(VfxValue::Container { items: resolved })
    }

    fn entries(
        &mut self,
        entries: &[(PropertyValueEnum, PropertyValueEnum)],
        depth: usize,
    ) -> Result<VfxValue, BinDocumentError> {
        let mut resolved = Vec::with_capacity(entries.len());
        for (key, value) in entries {
            resolved.push(VfxMapEntry {
                key: self.key(key),
                value: self.value(value, depth + 1)?,
            });
        }
        Ok(VfxValue::Map { entries: resolved })
    }

    fn leaf(&mut self, leaf: Option<Leaf<'_>>, depth: usize) -> Result<VfxValue, BinDocumentError> {
        Ok(match leaf {
            None | Some(Leaf::None) => VfxValue::None,
            Some(Leaf::Bool(value) | Leaf::Flag(value)) => VfxValue::Bool { value },
            Some(Leaf::I8(value)) => number(value),
            Some(Leaf::U8(value)) => number(value),
            Some(Leaf::I16(value)) => number(value),
            Some(Leaf::U16(value)) => number(value),
            Some(Leaf::I32(value)) => number(value),
            Some(Leaf::U32(value)) => number(value),
            Some(Leaf::I64(value)) => number(value as f64),
            Some(Leaf::U64(value)) => number(value as f64),
            Some(Leaf::F32(value)) => number(value),
            Some(Leaf::Vector2(vector)) => VfxValue::Vector {
                values: vector.to_array().to_vec(),
            },
            Some(Leaf::Vector3(vector)) => VfxValue::Vector {
                values: vector.to_array().to_vec(),
            },
            Some(Leaf::Vector4(vector)) => VfxValue::Vector {
                values: vector.to_array().to_vec(),
            },
            Some(Leaf::Matrix44(matrix)) => VfxValue::Matrix {
                values: matrix.transpose().to_cols_array().to_vec(),
            },
            /* Fractions rather than bytes, because the renderer multiplies them. */
            Some(Leaf::Color(color)) => VfxValue::Vector {
                values: [color.r, color.g, color.b, color.a]
                    .map(|channel| f32::from(channel) / 255.0)
                    .to_vec(),
            },
            Some(Leaf::String(text)) => VfxValue::String {
                value: text.to_owned(),
            },
            Some(Leaf::Hash(hash)) => VfxValue::Hash {
                hash: hex(hash),
                name: self.namer.value(hash),
            },
            Some(Leaf::File(hash)) => self.chunk(hash),
            Some(Leaf::Link(hash)) => self.link(hash, depth)?,
            Some(_) => VfxValue::Undrawn,
        })
    }

    /// A chunk link, as the path a table names it and where that path's bytes live.
    fn chunk(&mut self, hash: WadHash) -> VfxValue {
        let (path, asset) = chunk_asset(hash, self.namer.chunk(hash), self.assets);
        VfxValue::Asset { path, asset }
    }

    fn asset(&self, path: String) -> VfxValue {
        VfxValue::Asset {
            asset: self.assets.locate(&path),
            path,
        }
    }

    /// A link, inlined where it names an object of this document the walk is not
    /// already inside.
    fn link(&mut self, hash: BinHash, depth: usize) -> Result<VfxValue, BinDocumentError> {
        /* Read out of `self` before the push below, so the object outlives that borrow. */
        let document = self.document;
        let Some(object) = document
            .object_at(hash)
            .filter(|_| !self.open.contains(&hash))
        else {
            return Ok(VfxValue::Link {
                hash: hex(hash),
                name: self.namer.entry(hash),
            });
        };

        self.open.push(hash);
        let inlined = self.object(hash, object, depth + 1);
        self.open.pop();
        inlined
    }

    /// A map key as the text the consumer keys by.
    fn key(&mut self, key: &PropertyValueEnum) -> String {
        match owned(key.leaf()) {
            Some(Leaf::Hash(hash)) => self.namer.value(hash).unwrap_or_else(|| hex(hash)),
            leaf => {
                let mut text = String::new();
                walk::write_key(&mut text, leaf);
                text
            }
        }
    }

    /// Charge one value against the caps.
    fn charge(&mut self, depth: usize) -> Result<(), BinDocumentError> {
        if depth > MAX_DEPTH {
            return Err(BinDocumentError::ReadTooDeep);
        }
        self.values += 1;
        if self.values > MAX_NODES {
            return Err(BinDocumentError::ReadTooLarge);
        }
        Ok(())
    }
}

/// Every key a `ResourceResolver` of `document` maps, to the object its link names.
///
/// The first resolver holding a key wins, in the order the document holds them. The walk
/// cannot know which resolver a system's skin links, so every resolver of the document
/// counts.
fn resources(document: &BinDocument) -> HashMap<BinHash, BinHash> {
    let mut resources = HashMap::new();
    for entry in document.entries() {
        let Some(object) = document
            .object_at(entry)
            .filter(|object| object.class_hash == RESOURCE_RESOLVER)
        else {
            continue;
        };
        for (key, target) in resolver_entries(object) {
            resources.entry(key).or_insert(target);
        }
    }
    resources
}

fn number(value: impl Into<f64>) -> VfxValue {
    VfxValue::Number {
        value: value.into(),
    }
}

#[cfg(test)]
mod tests;
