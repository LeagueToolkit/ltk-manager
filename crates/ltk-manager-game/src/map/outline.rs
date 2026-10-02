//! A map's chunk graph: each `MapPlaceableContainer` of its file, and what each holds.
//!
//! The graph is two levels deep. A `MapContainer` lists its chunks, a chunk holds its
//! placeables, and no placeable names a parent, a `MapGroup` being a named transform.

use std::collections::HashMap;

use ltk_hash::BinHash;
use ltk_manager_core::hashing::named;
use ltk_meta::walk::Leaf;
use serde::Serialize;

use super::characters::skin_of;
use super::component::MAP_CONTAINER;
use super::particles::PARTICLE;
use super::placeable::{NAME, Placed, controller, placeables, transform, visibility};
use ltk_manager_core::bin_document::{BinDocument, Namer, RowNames, entries, hex, leaf, link};

/// `MapContainer.chunks`, a `Map<Hash, Link<MapPlaceableContainer>>`.
const CHUNKS: BinHash = named("chunks");
const LOCATOR: BinHash = named("MapLocator");
const SCRIPT_LOCATOR: BinHash = named("MapScriptLocator");
const GROUP: BinHash = named("MapGroup");
const AUDIO: BinHash = named("MapAudio");

/// What a placeable is to a scene, which is what an outliner marks its row with.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub enum MapItemKind {
    /// A `MapParticle`, which plays a system.
    Particle,
    /// A structure or a level prop, which draws a character.
    Character,
    /// A `MapLocator` or a `MapScriptLocator`, a named point.
    Locator,
    /// A `MapGroup`, a named transform.
    Group,
    /// A `MapAudio`.
    Audio,
    /// Any other class.
    Other,
}

/// One placeable of a chunk.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct MapChunkItem {
    /// The key it sits under in its chunk, as `0x` and eight digits.
    pub key: String,
    /// The placeable's own name, and the hash itself where nothing names one.
    pub name: String,
    /// Its class by name, and by hash where no table names it.
    pub class: String,
    pub kind: MapItemKind,
    /// Where it stands in the map's space.
    pub position: [f32; 3],
    /// The layer mask, one bit per visibility layer.
    pub visibility: u8,
    /// The controller that shows and hides it, which no layer mask expresses.
    pub controller: Option<String>,
}

/// One chunk of a map and everything it holds, in file order.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct MapChunk {
    /// The `MapPlaceableContainer` object, as `0x` and eight digits.
    pub entry: String,
    /// The object's path, else the key a `MapContainer` lists it under, else none.
    pub name: Option<String>,
    pub items: Vec<MapChunkItem>,
}

/// Every chunk `materials` declares, in file order, with a chunk that holds nothing left out.
#[must_use]
pub fn map_outline(materials: &BinDocument, names: &dyn RowNames) -> Vec<MapChunk> {
    let mut namer = Namer::new(names);
    let listed = listed_keys(materials);
    let mut chunks: Vec<MapChunk> = Vec::new();
    let mut at: HashMap<BinHash, usize> = HashMap::new();

    for placed in placeables(materials) {
        let slot = *at.entry(placed.chunk).or_insert_with(|| {
            let name = namer
                .entry(placed.chunk)
                .or_else(|| listed.get(&placed.chunk).and_then(|key| namer.value(*key)));
            chunks.push(MapChunk {
                entry: hex(placed.chunk),
                name,
                items: Vec::new(),
            });
            chunks.len() - 1
        });
        chunks[slot].items.push(item(&placed, &mut namer));
    }
    chunks
}

fn item(placed: &Placed<'_>, namer: &mut Namer<'_>) -> MapChunkItem {
    let fields = placed.fields;
    let placement = transform(fields);
    MapChunkItem {
        key: hex(placed.key),
        name: match leaf(fields.get(&NAME)) {
            Some(Leaf::String(text)) => text.to_owned(),
            Some(Leaf::Hash(hash)) => namer.value(hash).unwrap_or_else(|| hex(hash)),
            _ => hex(placed.key),
        },
        class: namer
            .class(placed.class)
            .unwrap_or_else(|| hex(placed.class)),
        kind: kind_of(placed),
        position: [placement[12], placement[13], placement[14]],
        visibility: visibility(fields),
        controller: controller(fields),
    }
}

fn kind_of(placed: &Placed<'_>) -> MapItemKind {
    match placed.class {
        PARTICLE => MapItemKind::Particle,
        LOCATOR | SCRIPT_LOCATOR => MapItemKind::Locator,
        GROUP => MapItemKind::Group,
        AUDIO => MapItemKind::Audio,
        class if skin_of(class, placed.fields).is_some() => MapItemKind::Character,
        _ => MapItemKind::Other,
    }
}

/// The key each chunk is listed under by a `MapContainer` of the same file.
fn listed_keys(materials: &BinDocument) -> HashMap<BinHash, BinHash> {
    materials
        .entries()
        .filter_map(|entry| materials.object_at(entry))
        .filter(|object| object.class_hash == MAP_CONTAINER)
        .flat_map(|container| entries(container.properties.get(&CHUNKS)))
        .filter_map(|(key, chunk)| match leaf(Some(key)) {
            Some(Leaf::Hash(key)) => Some((link(Some(chunk))?, key)),
            _ => None,
        })
        .collect()
}

#[cfg(test)]
mod tests;
