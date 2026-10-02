//! The characters a map stands in its scene: its structures, its camps and its level props.
//!
//! Two kinds of placeable name one. A gameplay object carries a `Character` component that
//! states the skin outright. A `GdsMapObject` of the level prop type states neither, and
//! the engine derives the character from the placeable's own name.

use ltk_hash::BinHash;
use ltk_manager_core::hashing::named;
use ltk_meta::walk::Leaf;
use serde::Serialize;

use super::placeable::{controller, name, placeables, transform, visibility};
use ltk_manager_core::bin_document::{
    BinDocument, Fields, fields_of, hex, items, leaf, struct_of, text,
};

/// `Character`, the component a gameplay placeable names its character in.
const CHARACTER: BinHash = named("Character");
/// `Character.Skin`, the entry path of a `SkinCharacterDataProperties`.
const SKIN: BinHash = named("Skin");
/// `Team`, both the component and the field inside it.
const TEAM: BinHash = named("Team");
const GDS_MAP_OBJECT: BinHash = named("GdsMapObject");
/// `GdsMapObject.type`.
const OBJECT_TYPE: BinHash = named("type");
/// `GdsMapObject.mapObjectSkinID`.
const OBJECT_SKIN_ID: BinHash = named("mapObjectSkinID");

/// `GdsMapObject.extraInfo`, a list of `GDSMapObjectExtraInfo`.
const EXTRA_INFO: BinHash = named("extraInfo");
const ANIMATION_INFO: BinHash = named("GDSMapObjectAnimationInfo");
/// `GDSMapObjectAnimationInfo.defaultAnimation`.
const DEFAULT_ANIMATION: BinHash = named("defaultAnimation");

/// The `GdsMapObject.type` of a level prop, which is the one type that draws a character.
const LEVEL_PROP: u8 = 10;
/// What a level prop's name opens with, ahead of the character it draws.
const LEVEL_PROP_PREFIX: &str = "LevelProp_";

/// One character a map stands in its scene.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct MapCharacter {
    /// The chunk that holds it, a `MapPlaceableContainer`, as `0x` and eight digits.
    pub chunk: String,
    /// The key it sits under in that chunk, as `0x` and eight digits.
    pub key: String,
    /// The placeable's own name, which is unique within a map.
    pub name: String,
    /// The entry path of the skin it wears, such as `Characters/Turret/Skins/Skin0`.
    pub skin: String,
    /// Where it stands in the map's space, column major with the translation last.
    pub transform: [f32; 16],
    /// The layer mask, one bit per visibility layer, as a map mesh carries one.
    pub visibility: u8,
    /// The controller that shows and hides it, which no layer mask expresses.
    pub controller: Option<String>,
    /// The team it stands for, where it states one. 300 is the neutral team a camp is on.
    pub team: Option<u32>,
    /// The clip a `GDSMapObjectAnimationInfo` names for it, by the name its graph keys it
    /// under. None plays whatever the graph idles on.
    pub animation: Option<String>,
}

/// Every character `materials` stands in its map, in file order.
#[must_use]
pub fn map_characters(materials: &BinDocument) -> Vec<MapCharacter> {
    placeables(materials)
        .filter_map(|placed| {
            let fields = placed.fields;
            Some(MapCharacter {
                chunk: hex(placed.chunk),
                key: hex(placed.key),
                skin: skin_of(placed.class, fields)?,
                name: name(fields),
                transform: transform(fields),
                visibility: visibility(fields),
                controller: controller(fields),
                team: fields_of(fields.get(&TEAM)).and_then(|team| match leaf(team.get(&TEAM)) {
                    Some(Leaf::U32(team)) => Some(team),
                    _ => None,
                }),
                animation: default_animation(fields),
            })
        })
        .collect()
}

/// The skin a placeable of `class` draws, and none for one that draws no character.
pub(super) fn skin_of(class: BinHash, fields: &Fields) -> Option<String> {
    if class == GDS_MAP_OBJECT {
        level_prop_skin(fields)
    } else {
        text(fields_of(fields.get(&CHARACTER))?.get(&SKIN)).map(str::to_owned)
    }
}

/// The clip the placeable's animation info names, and none for an empty name.
fn default_animation(fields: &Fields) -> Option<String> {
    items(fields.get(&EXTRA_INFO))
        .iter()
        .filter_map(|info| struct_of(Some(info)))
        .find(|(class, _)| *class == ANIMATION_INFO)
        .and_then(|(_, info)| text(info.get(&DEFAULT_ANIMATION)))
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
}

/// The skin a level prop wears, off its name with the prefix and the trailing count gone.
///
/// `LevelProp_sru_snail9` draws `Characters/sru_snail/Skins/Skin0`. Verified against the
/// 16.18 index for every level prop Summoner's Rift places.
fn level_prop_skin(fields: &Fields) -> Option<String> {
    if !matches!(leaf(fields.get(&OBJECT_TYPE)), Some(Leaf::U8(LEVEL_PROP))) {
        return None;
    }
    let character = text(fields.get(&super::placeable::NAME))?
        .strip_prefix(LEVEL_PROP_PREFIX)?
        .trim_end_matches(|digit: char| digit.is_ascii_digit());
    let skin = match leaf(fields.get(&OBJECT_SKIN_ID)) {
        Some(Leaf::U32(id)) => id,
        _ => 0,
    };
    (!character.is_empty()).then(|| format!("Characters/{character}/Skins/Skin{skin}"))
}

#[cfg(test)]
mod tests;
