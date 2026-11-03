//! What the League Classic copy of a skin, its `Jade_*` character, changes for the outline.
//!
//! Riot authors each League Classic champion as a `Jade_<champion>` character in the champion's
//! archive. Its skins list the outlined submeshes, give a cape or a prop an outline material
//! masked by the part's own texture, and swap textures in the body materials so no part fades in
//! front of the outline shell. The skin with the same id carries the outline list and the mask
//! swaps over, and keeps its own albedo.

use super::outline::Mask;
use super::textures::BASE_SAMPLERS;
use ltk_hash::BinHash;
use ltk_meta::property::values::Struct;
use ltk_meta::{Bin, BinObject, PropertyValueEnum};
use ltk_wad::WadHash;
use serde::{Deserialize, Serialize};
use std::io::Cursor;

/// The mask of every League Classic outline material that covers a whole submesh.
const WHITE: &str = "assets/shared/materials/white.tex";

/// The outline changes of a League Classic skin, ready to carry over.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub(super) struct Classic {
    /// The League Classic skin's `simpleSkin`, lowercased, whose submeshes Riot's entries name.
    pub(super) mesh: Option<String>,
    /// Riot's outline entries, in list order.
    pub(super) entries: Vec<ClassicEntry>,
    /// The textures of the normal skin's materials that the League Classic skin replaces.
    pub(super) swaps: Vec<TextureSwap>,
}

impl Classic {
    /// The mask of the entry that lists `submesh`, `Some(None)` for an entry with no mask, and
    /// `None` if no entry lists it.
    pub(super) fn entry_for(&self, submesh: &str) -> Option<Option<Mask>> {
        self.entries
            .iter()
            .find(|entry| {
                entry
                    .submeshes
                    .split(|c: char| c.is_whitespace() || c == ',')
                    .any(|name| name.eq_ignore_ascii_case(submesh))
            })
            .map(|entry| entry.mask)
    }
}

/// One `CharacterOutlineSubmeshes` entry of a League Classic skin.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(super) struct ClassicEntry {
    /// `Submeshes`, as Riot writes it.
    pub(super) submeshes: String,
    /// The mask of its `materialOverride`, and `None` where it covers the whole submesh.
    pub(super) mask: Option<Mask>,
}

/// One sampler texture of a material that the League Classic skin draws differently.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct TextureSwap {
    /// The lowercased chunk path of the bin that declares the material.
    pub(super) chunk: String,
    /// The material's path hash.
    pub(super) material: u32,
    /// The sampler's index in `samplerValues`.
    pub(super) index: usize,
    /// The path hash of the League Classic texture.
    pub(super) texture: u64,
}

/// A skin bin and every bin it links, by lowercased chunk path.
pub(super) struct Bins(Vec<(String, Bin)>);

impl Bins {
    /// Reads the bin at `path` out of `bytes`, and each bin it links through `read`. Returns
    /// `None` if the skin bin does not read.
    pub(super) fn load(
        path: &str,
        bytes: &[u8],
        read: &mut dyn FnMut(&str) -> Option<Vec<u8>>,
    ) -> Option<Self> {
        let root = Bin::from_reader(&mut Cursor::new(bytes)).ok()?;
        let mut bins = vec![(path.to_owned(), root)];
        let linked: Vec<String> = bins[0]
            .1
            .dependencies
            .iter()
            .map(|dependency| dependency.replace('\\', "/").to_ascii_lowercase())
            .collect();
        for chunk in linked {
            let Some(bytes) = read(&chunk) else {
                continue;
            };
            if let Ok(bin) = Bin::from_reader(&mut Cursor::new(bytes)) {
                bins.push((chunk, bin));
            }
        }
        Some(Self(bins))
    }

    /// The object at `hash` in the first bin that declares it, with that bin's chunk path.
    fn find(&self, hash: BinHash) -> Option<(&str, &BinObject)> {
        self.0.iter().find_map(|(chunk, bin)| {
            bin.objects
                .get(&hash)
                .map(|object| (chunk.as_str(), object))
        })
    }

    /// The `skinMeshProperties` of the skin object at `skin`.
    fn mesh(&self, skin: BinHash) -> Option<&Struct> {
        let (_, object) = self.find(skin)?;
        match object
            .properties
            .get(&BinHash::from("skinMeshProperties"))?
        {
            PropertyValueEnum::Embedded(mesh) => Some(&mesh.0),
            _ => None,
        }
    }
}

/// Reads what the League Classic skin `jade_skin` in `jade` changes for the normal skin
/// `skin` in `normal`. Returns `None` if the League Classic skin lists no outline entry.
pub(super) fn classic(
    normal: &Bins,
    skin: BinHash,
    jade: &Bins,
    jade_skin: BinHash,
) -> Option<Classic> {
    let jade_mesh = jade.mesh(jade_skin)?;
    let entries: Vec<ClassicEntry> = items(field(jade_mesh, "OutlineCategorySubmeshes"))
        .iter()
        .filter_map(embedded)
        .filter_map(|entry| {
            let PropertyValueEnum::String(submeshes) =
                entry.properties.get(&BinHash::from("Submeshes"))?
            else {
                return None;
            };
            let mask = link(entry.properties.get(&BinHash::from("materialOverride")))
                .and_then(|material| outline_mask(jade, material));
            Some(ClassicEntry {
                submeshes: submeshes.value.clone(),
                mask,
            })
        })
        .collect();
    if entries.is_empty() {
        return None;
    }

    let swaps = normal
        .mesh(skin)
        .map(|mesh| texture_swaps(normal, mesh, jade, jade_mesh))
        .unwrap_or_default();
    let mesh = match field(jade_mesh, "simpleSkin") {
        Some(PropertyValueEnum::String(path)) if !path.value.is_empty() => {
            Some(path.value.replace('\\', "/").to_ascii_lowercase())
        }
        _ => None,
    };
    Some(Classic {
        mesh,
        entries,
        swaps,
    })
}

/// The `Outline_Mask` of the outline material at `material`, and `None` for the white mask that
/// covers the whole submesh.
fn outline_mask(bins: &Bins, material: BinHash) -> Option<Mask> {
    let (_, object) = bins.find(material)?;
    let texture = samplers(object)
        .into_iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("Outline_Mask"))
        .and_then(|(_, texture)| texture)?;
    if texture == WadHash::from(WHITE).0 {
        return None;
    }

    let channels = items(object.properties.get(&BinHash::from("paramValues")))
        .iter()
        .filter_map(embedded)
        .find_map(|param| {
            let PropertyValueEnum::String(name) = param.properties.get(&BinHash::from("name"))?
            else {
                return None;
            };
            if !name.value.eq_ignore_ascii_case("Outline_Mask_ChannelMask") {
                return None;
            }
            match param.properties.get(&BinHash::from("value"))? {
                PropertyValueEnum::Vector4(value) => Some(value.value.to_array()),
                _ => None,
            }
        })
        .unwrap_or([0.0, 0.0, 0.0, 1.0]);
    Some(Mask { texture, channels })
}

/// Each sampler texture of a normal material that the League Classic material of the same
/// submesh names differently, matched by sampler name. The albedo stays the skin's own, so only
/// masks, gradients and the like change.
fn texture_swaps(
    normal: &Bins,
    mesh: &Struct,
    jade: &Bins,
    jade_mesh: &Struct,
) -> Vec<TextureSwap> {
    let mut pairs = vec![(
        link(field(mesh, "Material")),
        link(field(jade_mesh, "Material")),
    )];
    let jade_overrides = overrides(jade_mesh);
    for (submesh, material) in overrides(mesh) {
        let jade_material = jade_overrides
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case(&submesh))
            .and_then(|(_, material)| *material);
        pairs.push((material, jade_material));
    }

    let mut swaps = Vec::new();
    for (material, jade_material) in pairs {
        let (Some(material), Some(jade_material)) = (material, jade_material) else {
            continue;
        };
        let (Some((chunk, object)), Some((_, jade_object))) =
            (normal.find(material), jade.find(jade_material))
        else {
            continue;
        };
        let jade_samplers = samplers(jade_object);
        for (index, (name, texture)) in samplers(object).into_iter().enumerate() {
            if BASE_SAMPLERS
                .iter()
                .any(|base| base.eq_ignore_ascii_case(name))
            {
                continue;
            }
            let replacement = jade_samplers
                .iter()
                .find(|(jade_name, _)| jade_name.eq_ignore_ascii_case(name))
                .and_then(|(_, texture)| *texture);
            if let Some(replacement) = replacement
                && Some(replacement) != texture
                && !swaps
                    .iter()
                    .any(|swap: &TextureSwap| swap.material == material.0 && swap.index == index)
            {
                swaps.push(TextureSwap {
                    chunk: chunk.to_owned(),
                    material: material.0,
                    index,
                    texture: replacement,
                });
            }
        }
    }
    swaps
}

/// Each `materialOverride` of `mesh` with its submesh and its material.
fn overrides(mesh: &Struct) -> Vec<(String, Option<BinHash>)> {
    items(field(mesh, "materialOverride"))
        .iter()
        .filter_map(embedded)
        .filter_map(|entry| {
            let PropertyValueEnum::String(submesh) =
                entry.properties.get(&BinHash::from("submesh"))?
            else {
                return None;
            };
            Some((
                submesh.value.clone(),
                link(entry.properties.get(&BinHash::from("Material"))),
            ))
        })
        .collect()
}

/// Each sampler of the material `object` with its texture name and its texture's path hash.
fn samplers(object: &BinObject) -> Vec<(&str, Option<u64>)> {
    items(object.properties.get(&BinHash::from("samplerValues")))
        .iter()
        .filter_map(embedded)
        .filter_map(|sampler| {
            let PropertyValueEnum::String(name) =
                sampler.properties.get(&BinHash::from("TextureName"))?
            else {
                return None;
            };
            Some((
                name.value.as_str(),
                file(sampler.properties.get(&BinHash::from("texturePath"))),
            ))
        })
        .collect()
}

fn field<'a>(object: &'a Struct, name: &str) -> Option<&'a PropertyValueEnum> {
    object.properties.get(&BinHash::from(name))
}

fn embedded(value: &PropertyValueEnum) -> Option<&Struct> {
    match value {
        PropertyValueEnum::Embedded(embedded) => Some(&embedded.0),
        _ => None,
    }
}

/// The items of a `list` or a `list2`, and none for any other value.
pub(super) fn items(value: Option<&PropertyValueEnum>) -> &[PropertyValueEnum] {
    match value {
        Some(PropertyValueEnum::Container(list)) => list.items(),
        Some(PropertyValueEnum::UnorderedContainer(list)) => list.0.items(),
        _ => &[],
    }
}

pub(super) fn link(value: Option<&PropertyValueEnum>) -> Option<BinHash> {
    match value? {
        PropertyValueEnum::ObjectLink(link) if link.value.0 != 0 => Some(link.value),
        _ => None,
    }
}

/// The path hash a `file` or a `string` texture field names.
pub(super) fn file(value: Option<&PropertyValueEnum>) -> Option<u64> {
    match value? {
        PropertyValueEnum::WadChunkLink(file) if file.value.0 != 0 => Some(file.value.0),
        PropertyValueEnum::String(path) if !path.value.is_empty() => {
            Some(WadHash::from(path.value.as_str()).0)
        }
        _ => None,
    }
}
