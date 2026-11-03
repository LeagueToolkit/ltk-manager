//! The texture each submesh of a skin draws with, which masks its outline the way the League
//! Classic skins mask a cape or a prop.

use super::classic::{file, items, link};
use ltk_hash::BinHash;
use ltk_meta::{Bin, BinObject, PropertyValueEnum};
use serde::{Deserialize, Serialize};

/// The sampler names that hold a material's albedo, best first. A subset of `BASE_EXACT` in
/// `crates/ltk-manager-game/src/material.rs`, which the preview reads.
pub(super) const BASE_SAMPLERS: [&str; 8] = [
    "Diffuse_Texture",
    "DiffuseTexture",
    "Main_Texture",
    "Diffuse_Color",
    "Diffuse",
    "Base_Texture",
    "Diff_Tex",
    "_MainTex",
];

/// The TEX format codes, as `ltk_texture::tex::Format` numbers them.
const ETC1: u8 = 1;
const BC1: u8 = 10;
const BC1_ALT: u8 = 11;
const BC3: u8 = 12;
const BC5: u8 = 14;
const BGRA8: u8 = 20;

/// The offset of the format byte in a TEX header: the magic, the width, the height, the depth.
const FORMAT_OFFSET: usize = 9;

/// The length of a TEX header: the format byte, the resource type and the flags.
const HEADER_LEN: usize = 12;

/// The textures of one skin's submeshes, by the path hash of each texture.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct SkinTextures {
    /// The texture of a submesh with no override, and `None` if the skin's material names none
    /// this read could find.
    pub(super) default: Option<u64>,
    /// Each override's lowercased submesh name with its texture, `None` where it is unknown.
    pub(super) overrides: Vec<(String, Option<u64>)>,
}

impl SkinTextures {
    /// The texture `submesh` draws with, and `None` if it is unknown.
    pub(super) fn of(&self, submesh: &str) -> Option<u64> {
        let submesh = submesh.to_ascii_lowercase();
        self.overrides
            .iter()
            .find(|(name, _)| *name == submesh)
            .map_or(self.default, |(_, texture)| *texture)
    }
}

/// Reads the textures of the skin whose `skinMeshProperties` are `mesh`.
///
/// A material is looked up in `bins` in order, the skin's own bin first.
pub(super) fn skin_textures(
    mesh: &ltk_meta::property::values::Struct,
    bins: &[&Bin],
) -> SkinTextures {
    let properties = &mesh.properties;
    let default = match link(properties.get(&BinHash::from("Material"))) {
        Some(material) => material_texture(material, bins),
        None => file(properties.get(&BinHash::from("texture"))),
    };

    let overrides = items(properties.get(&BinHash::from("materialOverride")))
        .iter()
        .filter_map(|item| match item {
            PropertyValueEnum::Embedded(entry) => Some(&entry.0.properties),
            _ => None,
        })
        .filter_map(|entry| {
            let PropertyValueEnum::String(submesh) = entry.get(&BinHash::from("submesh"))? else {
                return None;
            };
            let texture = match link(entry.get(&BinHash::from("Material"))) {
                Some(material) => material_texture(material, bins),
                None => file(entry.get(&BinHash::from("texture"))),
            };
            Some((submesh.value.to_ascii_lowercase(), texture))
        })
        .collect();

    SkinTextures { default, overrides }
}

/// Whether `bins` other than the first are needed to resolve the materials `mesh` links.
pub(super) fn needs_linked(mesh: &ltk_meta::property::values::Struct, own: &Bin) -> bool {
    let properties = &mesh.properties;
    let mut materials = Vec::new();
    materials.extend(link(properties.get(&BinHash::from("Material"))));
    for item in items(properties.get(&BinHash::from("materialOverride"))) {
        if let PropertyValueEnum::Embedded(entry) = item {
            materials.extend(link(entry.0.properties.get(&BinHash::from("Material"))));
        }
    }
    materials
        .iter()
        .any(|material| !own.objects.contains_key(material))
}

/// Reads the albedo texture of the material at `material` in the first of `bins` that holds it.
fn material_texture(material: BinHash, bins: &[&Bin]) -> Option<u64> {
    let object: &BinObject = bins.iter().find_map(|bin| bin.objects.get(&material))?;
    let samplers: Vec<(&str, Option<u64>)> =
        items(object.properties.get(&BinHash::from("samplerValues")))
            .iter()
            .filter_map(|item| match item {
                PropertyValueEnum::Embedded(sampler) => Some(&sampler.0.properties),
                _ => None,
            })
            .filter_map(|sampler| {
                let PropertyValueEnum::String(name) = sampler.get(&BinHash::from("TextureName"))?
                else {
                    return None;
                };
                Some((
                    name.value.as_str(),
                    file(sampler.get(&BinHash::from("texturePath"))),
                ))
            })
            .collect();
    BASE_SAMPLERS.iter().find_map(|base| {
        samplers
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case(base))
            .and_then(|(_, texture)| *texture)
    })
}

/// Whether the TEX in `bytes` has a texel that is not fully opaque, in any mip.
///
/// BC1 is transparent where a block in its three-color mode, `color0 <= color1`, uses index 3.
/// BC3 is transparent where a block's alpha endpoints are not both 255, and BGRA8 where an alpha
/// byte is below 255. A format this read does not scan, a `.dds` and any other file count as
/// transparent.
pub(super) fn has_transparency(bytes: &[u8]) -> bool {
    if !bytes.starts_with(b"TEX\0") {
        return true;
    }
    let Some(&format) = bytes.get(FORMAT_OFFSET) else {
        return true;
    };
    let data = bytes.get(HEADER_LEN..).unwrap_or_default();

    match format {
        ETC1 | BC5 => false,
        BC1 | BC1_ALT => data.as_chunks::<8>().0.iter().any(bc1_transparent),
        BC3 => data
            .as_chunks::<16>()
            .0
            .iter()
            .any(|block| block[0] != u8::MAX || block[1] != u8::MAX),
        BGRA8 => data
            .as_chunks::<4>()
            .0
            .iter()
            .any(|texel| texel[3] != u8::MAX),
        _ => true,
    }
}

/// Whether the BC1 `block` is in its three-color mode and uses index 3, the transparent texel.
fn bc1_transparent(block: &[u8; 8]) -> bool {
    let color0 = u16::from_le_bytes([block[0], block[1]]);
    let color1 = u16::from_le_bytes([block[2], block[3]]);
    if color0 > color1 {
        return false;
    }
    let indices = u32::from_le_bytes([block[4], block[5], block[6], block[7]]);
    (0..16).any(|texel| (indices >> (texel * 2)) & 0b11 == 0b11)
}
