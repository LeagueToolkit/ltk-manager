//! A map's chunk graph: each `MapPlaceableContainer` of its file, and what each holds.
//!
//! The graph is two levels deep. A `MapContainer` lists its chunks, a chunk holds its
//! placeables, and no placeable names a parent, a `MapGroup` being a named transform.

use std::collections::HashMap;

use ltk_hash::BinHash;
use ltk_manager_base::hashing::named;
use ltk_meta::PropertyValueEnum;
use ltk_meta::walk::Leaf;
use serde::Serialize;

use super::characters::skin_of;
use super::component::MAP_CONTAINER;
use super::particles::PARTICLE;
use super::placeable::{NAME, Placed, controller, placeables, transform, visibility};
use ltk_manager_bin::bin_document::{
    BinDocument, Fields, Namer, RowNames, boolean, color, entries, fields_of, float, hash_hex, hex,
    items, leaf, link, unsigned, vector3,
};

/// `MapContainer.chunks`, a `Map<Hash, Link<MapPlaceableContainer>>`.
const CHUNKS: BinHash = named("chunks");
const LOCATOR: BinHash = named("MapLocator");
const SCRIPT_LOCATOR: BinHash = named("MapScriptLocator");
const GROUP: BinHash = named("MapGroup");
const AUDIO: BinHash = named("MapAudio");
const DYNAMIC_POINT_LIGHT: BinHash = named("MapDynamicPointLight");
const DYNAMIC_SPOTLIGHT: BinHash = named("MapDynamicSpotlight");
const POINT_LIGHT: BinHash = named("MapPointLight");
const SPOTLIGHT: BinHash = named("MapSpotlight");
const UNIQUE_POINT_LIGHT: BinHash = named("MapUniquePointLight");
const CUBEMAP_PROBE: BinHash = named("MapCubemapProbe");
const LIGHTING_VOLUME: BinHash = named("MapLightingVolume");
const LIGHT_REGION: BinHash = named("LightRegionEntityTemplate");
const MOTION_PATH: BinHash = named("MapMotionPath");
const BANNER: BinHash = named("GdsMapObject");
const REGION_BOUNDARY: BinHash = named("RegionBoundary");
/// A `MapPlaceable` of `Vertices`, a `type` and a `Min` and `Max` box, which no table names.
const VERTEX_REGION: BinHash = BinHash(0x5a96_97c1);

/// The frustum fields of `MapFrustum`, which both spotlight classes derive from, with the
/// defaults the schema publishes.
const FOV: (BinHash, f32) = (named("fov"), 60.0);
const ASPECT: (BinHash, f32) = (named("Aspect"), 1.0);
const NEAR: (BinHash, f32) = (named("Near"), 10.0);
const FAR: (BinHash, f32) = (named("far"), 500.0);
const ORTHO_HEIGHT: (BinHash, f32) = (named("OrthoHeight"), 200.0);
const ORTHOGRAPHIC: BinHash = named("Orthographic");
const RADIUS: BinHash = named("radius");
const CUBEMAP_REGION: BinHash = named("CubemapRegion");
const MIN: BinHash = named("Min");
const MAX: BinHash = named("Max");
const BOX_MIN: BinHash = named("boxMin");
const BOX_MAX: BinHash = named("boxMax");
const SEGMENTS: BinHash = named("Segments");
/// `LightRegionEntityTemplate.LightRegion`, which holds the region's `Polygon`.
const LIGHT_REGION_FIELD: BinHash = named("LightRegion");
const POLYGON: BinHash = named("Polygon");
const END_POSITION: BinHash = named("EndPosition");
/// The polygon fields of `RegionBoundary`, with the defaults the schema publishes.
const VERTICES: BinHash = named("Vertices");
const DRAW_HEIGHT: (BinHash, f32) = (named("DrawHeight"), 100.0);
const LINE_COLOR: (BinHash, [u8; 4]) = (named("LineColor"), [255, 0, 0, 255]);
const FILL_COLOR: (BinHash, [u8; 4]) = (named("FillColor"), [255, 255, 0, 255]);

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
    /// A dynamic or a static point light or spotlight.
    Light,
    /// A `MapCubemapProbe`.
    Probe,
    /// A `MapLightingVolume` or a `LightRegionEntityTemplate`.
    Volume,
    /// A `MapMotionPath`.
    Path,
    /// A `RegionBoundary`, or the unnamed placeable of vertices, a polygon on the ground.
    Region,
    /// Any other class.
    Other,
}

/// The extent a viewport draws around a placeable, in the map's space.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub enum MapItemShape {
    /// The reach of a point light around its position.
    Sphere { radius: f32 },
    /// The frustum of a spotlight, along the -Z axis of its transform. Angles are in degrees.
    Frustum {
        fov: f32,
        aspect: f32,
        near: f32,
        far: f32,
        orthographic: bool,
        ortho_height: f32,
    },
    /// An axis-aligned box: a probe's region or a banner's box.
    Box { min: [f32; 3], max: [f32; 3] },
    /// The points of a motion path: its position, then the end of each segment.
    Path { points: Vec<[f32; 3]> },
    /// A lighting volume: the cube from -0.5 to 0.5 on each axis under its transform.
    Volume,
    /// The closed polygon of a light region, in the space of its transform.
    Polygon { points: Vec<[f32; 3]> },
    /// The closed polygon of a `RegionBoundary` in the space of its transform, its walls
    /// `height` units tall, and the colors the client draws its lines and fill in.
    Region {
        points: Vec<[f32; 3]>,
        height: f32,
        line_color: [u8; 4],
        fill_color: [u8; 4],
    },
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
    /// Its `transform`, column major with the translation last.
    pub transform: [f32; 16],
    /// The extent the viewport draws, and `None` for a class that states none.
    pub shape: Option<MapItemShape>,
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
            Some(Leaf::Hash(hash)) => hash
                .try_as_bin_hash()
                .and_then(|hash| namer.value(hash))
                .unwrap_or_else(|| hash_hex(hash)),
            _ => hex(placed.key),
        },
        class: namer
            .class(placed.class)
            .unwrap_or_else(|| hex(placed.class)),
        kind: kind_of(placed),
        position: [placement[12], placement[13], placement[14]],
        transform: placement,
        shape: shape_of(
            placed.class,
            fields,
            [placement[12], placement[13], placement[14]],
        ),
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
        DYNAMIC_POINT_LIGHT | DYNAMIC_SPOTLIGHT | POINT_LIGHT | SPOTLIGHT | UNIQUE_POINT_LIGHT => {
            MapItemKind::Light
        }
        CUBEMAP_PROBE => MapItemKind::Probe,
        LIGHTING_VOLUME | LIGHT_REGION => MapItemKind::Volume,
        MOTION_PATH => MapItemKind::Path,
        REGION_BOUNDARY | VERTEX_REGION => MapItemKind::Region,
        class if skin_of(class, placed.fields).is_some() => MapItemKind::Character,
        _ => MapItemKind::Other,
    }
}

/// Reads the extent of a placeable of `class` standing at `position`.
///
/// Returns `None` for a class that states no extent, and for a `MapPointLight`, whose reach
/// is in the `MapPointLightType` that it links.
fn shape_of(class: BinHash, fields: &Fields, position: [f32; 3]) -> Option<MapItemShape> {
    let number = |(field, default): (BinHash, f32)| float(fields.get(&field)).unwrap_or(default);

    match class {
        DYNAMIC_POINT_LIGHT | UNIQUE_POINT_LIGHT => Some(MapItemShape::Sphere {
            radius: float(fields.get(&RADIUS))?,
        }),
        DYNAMIC_SPOTLIGHT | SPOTLIGHT => Some(MapItemShape::Frustum {
            fov: number(FOV),
            aspect: number(ASPECT),
            near: number(NEAR),
            far: number(FAR),
            orthographic: boolean(fields.get(&ORTHOGRAPHIC)).unwrap_or(false),
            ortho_height: number(ORTHO_HEIGHT),
        }),
        CUBEMAP_PROBE => {
            let region = fields_of(fields.get(&CUBEMAP_REGION))?;
            Some(MapItemShape::Box {
                min: vector3(region.get(&MIN))?,
                max: vector3(region.get(&MAX))?,
            })
        }
        BANNER => Some(MapItemShape::Box {
            min: vector3(fields.get(&BOX_MIN))?,
            max: vector3(fields.get(&BOX_MAX))?,
        }),
        /* shortcut: segment ends are read as map space, which no shipped path confirms. Check
        against a map that ships a `MapMotionPath` before the path's points are dragged. */
        MOTION_PATH => {
            let ends = items(fields.get(&SEGMENTS))
                .iter()
                .filter_map(|segment| vector3(fields_of(Some(segment))?.get(&END_POSITION)));
            Some(MapItemShape::Path {
                points: std::iter::once(position).chain(ends).collect(),
            })
        }
        /* shortcut: the volume's extent is assumed to be the unit cube under its transform. No
        client code that reads it was traced. Check before a volume is sized by its box. */
        LIGHTING_VOLUME => Some(MapItemShape::Volume),
        LIGHT_REGION => {
            let region = fields_of(fields.get(&LIGHT_REGION_FIELD))?;
            Some(MapItemShape::Polygon {
                points: points_of(region.get(&POLYGON)),
            })
        }
        REGION_BOUNDARY => Some(MapItemShape::Region {
            points: points_of(fields.get(&VERTICES)),
            height: unsigned(fields.get(&DRAW_HEIGHT.0)).map_or(DRAW_HEIGHT.1, |n| n as f32),
            line_color: color(fields.get(&LINE_COLOR.0)).unwrap_or(LINE_COLOR.1),
            fill_color: color(fields.get(&FILL_COLOR.0)).unwrap_or(FILL_COLOR.1),
        }),
        VERTEX_REGION => Some(MapItemShape::Polygon {
            points: points_of(fields.get(&VERTICES)),
        }),
        _ => None,
    }
}

/// The `Vec3` items of the list `value`, and none of any other kind.
fn points_of(value: Option<&PropertyValueEnum>) -> Vec<[f32; 3]> {
    items(value)
        .iter()
        .filter_map(|point| vector3(Some(point)))
        .collect()
}

/// The key each chunk is listed under by a `MapContainer` of the same file.
fn listed_keys(materials: &BinDocument) -> HashMap<BinHash, BinHash> {
    materials
        .entries()
        .filter_map(|entry| materials.object_at(entry))
        .filter(|object| object.class_hash == MAP_CONTAINER)
        .flat_map(|container| entries(container.properties.get(&CHUNKS)))
        .filter_map(|(key, chunk)| match leaf(Some(key)) {
            Some(Leaf::Hash(key)) => Some((link(Some(chunk))?, key.try_as_bin_hash()?)),
            _ => None,
        })
        .collect()
}

#[cfg(test)]
mod tests;
