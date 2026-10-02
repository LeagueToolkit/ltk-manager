//! A map's screen effects: the `PostEffectOptions` of its post effect component.

use ltk_hash::BinHash;
use ltk_manager_core::hashing::named;
use serde::Serialize;

use super::MapPath;
use super::component::map_component;
use ltk_manager_core::bin_document::{BinDocument, Fields, boolean, float, struct_of, vector4};

/// The unnamed `MapGraphicsFeature` whose `options` are the map's `PostEffectOptions`.
const POST_EFFECTS: BinHash = BinHash(0x50db_156b);
/// `options`, an embedded `PostEffectOptions`.
const OPTIONS: BinHash = named("options");
/// `DepthFog` and the four fields named after it.
const DEPTH_FOG: FogFields = FogFields {
    enabled: BinHash(0xd23c_9e02),
    color: BinHash(0x4d87_c515),
    start: BinHash(0xa6ce_8c9a),
    end: BinHash(0x456d_362f),
    max_intensity: BinHash(0x749b_3695),
};
/// `HeightFog` and the four fields named after it.
const HEIGHT_FOG: FogFields = FogFields {
    enabled: BinHash(0x3200_6fba),
    color: BinHash(0xb0d4_508d),
    start: BinHash(0x8e73_1442),
    end: BinHash(0x2188_a687),
    max_intensity: BinHash(0x7a8d_755d),
};
/// `PostEffectOptions.Dof`.
const DOF: BinHash = named("Dof");
/// `FocalDistance`, a name the meta does not state and the hash matches.
const FOCAL_DISTANCE: BinHash = named("FocalDistance");
/// `InFocusWidth`, a name the meta does not state and the hash matches.
const IN_FOCUS_WIDTH: BinHash = named("InFocusWidth");
/// `PostEffectOptions.Coc`.
const COC: BinHash = named("Coc");

/// The fields one fog of `PostEffectOptions` is stated in.
struct FogFields {
    enabled: BinHash,
    color: BinHash,
    start: BinHash,
    end: BinHash,
    max_intensity: BinHash,
}

/// A map's post effects, as its `PostEffectOptions` states them.
///
/// A field the map leaves out reads as the class default, which [`MapPostEffects::default`]
/// returns and which switches every effect off.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct MapPostEffects {
    /// `DepthFog` and its fields, which fog by distance from the camera.
    pub depth_fog: MapFog,
    /// `HeightFog` and its fields, which fog by height in the world.
    pub height_fog: MapFog,
    /// `Dof` and its fields.
    pub depth_of_field: MapDepthOfField,
}

/// One fog of [`MapPostEffects`], ramping from nothing at `start` to its most at `end`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct MapFog {
    /// The fog is drawn.
    pub enabled: bool,
    /// RGBA with each channel 0 to 1, as the bin writes it.
    pub color: [f32; 4],
    /// Where the fog begins, a distance or a height in world units.
    pub start: f32,
    /// Where the fog reaches `max_intensity`.
    pub end: f32,
    /// The most the fog covers, 0 to 1.
    pub max_intensity: f32,
}

/// The depth of field of [`MapPostEffects`].
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct MapDepthOfField {
    /// The blur is drawn.
    pub enabled: bool,
    /// The distance from the camera that is sharpest.
    pub focal_distance: f32,
    /// How deep the sharp band around `focal_distance` is.
    pub in_focus_width: f32,
    /// `Coc`, the circle of confusion the blur widens to.
    pub coc: f32,
}

impl Default for MapPostEffects {
    /// The class defaults `PostEffectOptions` declares.
    fn default() -> Self {
        Self {
            depth_fog: MapFog {
                enabled: false,
                color: [0.0, 0.0, 0.0, 1.0],
                start: 5000.0,
                end: 8000.0,
                max_intensity: 1.0,
            },
            height_fog: MapFog {
                enabled: false,
                color: [0.0, 0.0, 0.0, 1.0],
                start: 300.0,
                end: -100.0,
                max_intensity: 1.0,
            },
            depth_of_field: MapDepthOfField {
                enabled: false,
                focal_distance: 2000.0,
                in_focus_width: 800.0,
                coc: 10.0,
            },
        }
    }
}

/// The post effects of `map`'s container in its own `.materials.bin`, and none where it
/// states none.
///
/// The container is the object at `map`'s entry path, else the file's first `MapContainer`.
/// A component without `options` reads as the class defaults.
#[must_use]
pub fn map_post_effects(materials: &BinDocument, map: &MapPath) -> Option<MapPostEffects> {
    let component = map_component(materials, map, POST_EFFECTS)?;
    Some(match struct_of(component.get(&OPTIONS)) {
        Some((_, options)) => post_effects_of(options),
        None => MapPostEffects::default(),
    })
}

fn post_effects_of(fields: &Fields) -> MapPostEffects {
    let stated = MapPostEffects::default();
    let focus = stated.depth_of_field;
    MapPostEffects {
        depth_fog: fog_of(fields, &DEPTH_FOG, stated.depth_fog),
        height_fog: fog_of(fields, &HEIGHT_FOG, stated.height_fog),
        depth_of_field: MapDepthOfField {
            enabled: boolean(fields.get(&DOF)).unwrap_or(focus.enabled),
            focal_distance: float(fields.get(&FOCAL_DISTANCE)).unwrap_or(focus.focal_distance),
            in_focus_width: float(fields.get(&IN_FOCUS_WIDTH)).unwrap_or(focus.in_focus_width),
            coc: float(fields.get(&COC)).unwrap_or(focus.coc),
        },
    }
}

fn fog_of(fields: &Fields, named: &FogFields, stated: MapFog) -> MapFog {
    MapFog {
        enabled: boolean(fields.get(&named.enabled)).unwrap_or(stated.enabled),
        color: vector4(fields.get(&named.color)).unwrap_or(stated.color),
        start: float(fields.get(&named.start)).unwrap_or(stated.start),
        end: float(fields.get(&named.end)).unwrap_or(stated.end),
        max_intensity: float(fields.get(&named.max_intensity)).unwrap_or(stated.max_intensity),
    }
}

#[cfg(test)]
mod tests;
