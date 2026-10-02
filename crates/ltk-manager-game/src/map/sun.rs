//! A map's daylight: the `MapSunProperties` component of its `MapContainer`.

use ltk_hash::BinHash;
use ltk_manager_core::hashing::named;
use serde::Serialize;

use super::MapPath;
use super::component::map_component;
use ltk_manager_core::bin_document::{
    BinDocument, Fields, boolean, float, vector2, vector3, vector4,
};

/// `MapSunProperties`, the `MapComponent` that lights the map.
const SUN_PROPERTIES: BinHash = named("MapSunProperties");
/// `MapSunProperties.sunDirection`.
const SUN_DIRECTION: BinHash = named("sunDirection");
/// `MapSunProperties.sunColor`.
const SUN_COLOR: BinHash = named("sunColor");
/// `MapSunProperties.SunIntensityScale`.
const SUN_INTENSITY: BinHash = named("SunIntensityScale");
/// `MapSunProperties.skyLightColor`.
const SKY_COLOR: BinHash = named("skyLightColor");
/// `MapSunProperties.groundColor`.
const GROUND_COLOR: BinHash = named("groundColor");
/// `MapSunProperties.horizonColor`.
const HORIZON_COLOR: BinHash = named("horizonColor");
/// `MapSunProperties.skyLightScale`.
const SKY_SCALE: BinHash = named("skyLightScale");
/// `MapSunProperties.lightMapColorScale`.
const LIGHT_MAP_COLOR_SCALE: BinHash = named("lightMapColorScale");
/// `MapSunProperties.fogEnabled`.
const FOG_ENABLED: BinHash = named("fogEnabled");
/// `MapSunProperties.fogColor`.
const FOG_COLOR: BinHash = named("fogColor");
/// `MapSunProperties.fogAlternateColor`.
const FOG_ALTERNATE_COLOR: BinHash = named("fogAlternateColor");
/// `MapSunProperties.fogStartAndEnd`.
const FOG_START_AND_END: BinHash = named("fogStartAndEnd");
/// `MapSunProperties.fogEmissiveRemap`.
const FOG_EMISSIVE_REMAP: BinHash = named("fogEmissiveRemap");

/// A map's sun, sky and fog, as its `MapSunProperties` states them.
///
/// Colours are RGBA with each channel 0 to 1, as the bin writes them. A field the map
/// leaves out reads as the class default, which [`MapSun::default`] returns.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct MapSun {
    /// `sunDirection`, which points at the sun in the engine's space.
    pub direction: [f32; 3],
    /// `sunColor`.
    pub color: [f32; 4],
    /// `SunIntensityScale`.
    pub intensity: f32,
    /// `skyLightColor`, what lights a surface facing up.
    pub sky_color: [f32; 4],
    /// `groundColor`, what lights a surface facing down.
    pub ground_color: [f32; 4],
    /// `horizonColor`, what lights a surface facing sideways.
    pub horizon_color: [f32; 4],
    /// `skyLightScale`.
    pub sky_scale: f32,
    /// `lightMapColorScale`, which scales a baked light map.
    pub light_map_color_scale: f32,
    /// `fogEnabled`.
    pub fog_enabled: bool,
    /// `fogColor`.
    pub fog_color: [f32; 4],
    /// `fogAlternateColor`.
    pub fog_alternate_color: [f32; 4],
    /// `fogStartAndEnd`, the heights the fog runs between, the start above the end.
    pub fog_start_end: [f32; 2],
    /// `fogEmissiveRemap`.
    pub fog_emissive_remap: f32,
}

impl Default for MapSun {
    /// The class defaults `MapSunProperties` declares.
    fn default() -> Self {
        Self {
            direction: [0.0, 0.707, 0.707],
            color: [1.0, 1.0, 1.0, 1.0],
            intensity: 1.0,
            sky_color: [0.705, 0.88, 1.0, 1.0],
            ground_color: [0.1, 0.1, 0.1, 1.0],
            horizon_color: [0.4, 0.4, 0.4, 1.0],
            sky_scale: 0.2,
            light_map_color_scale: 1.0,
            fog_enabled: true,
            fog_color: [0.2, 0.2, 0.4, 1.0],
            fog_alternate_color: [0.1, 0.1, 0.2, 1.0],
            fog_start_end: [0.0, -2000.0],
            fog_emissive_remap: 1.9,
        }
    }
}

/// The sun of `map`'s container in its own `.materials.bin`, and none where it states none.
///
/// The container is the object at `map`'s entry path, else the file's first `MapContainer`.
#[must_use]
pub fn map_sun(materials: &BinDocument, map: &MapPath) -> Option<MapSun> {
    map_component(materials, map, SUN_PROPERTIES).map(sun_of)
}

fn sun_of(fields: &Fields) -> MapSun {
    let stated = MapSun::default();
    MapSun {
        direction: vector3(fields.get(&SUN_DIRECTION)).unwrap_or(stated.direction),
        color: vector4(fields.get(&SUN_COLOR)).unwrap_or(stated.color),
        intensity: float(fields.get(&SUN_INTENSITY)).unwrap_or(stated.intensity),
        sky_color: vector4(fields.get(&SKY_COLOR)).unwrap_or(stated.sky_color),
        ground_color: vector4(fields.get(&GROUND_COLOR)).unwrap_or(stated.ground_color),
        horizon_color: vector4(fields.get(&HORIZON_COLOR)).unwrap_or(stated.horizon_color),
        sky_scale: float(fields.get(&SKY_SCALE)).unwrap_or(stated.sky_scale),
        light_map_color_scale: float(fields.get(&LIGHT_MAP_COLOR_SCALE))
            .unwrap_or(stated.light_map_color_scale),
        fog_enabled: boolean(fields.get(&FOG_ENABLED)).unwrap_or(stated.fog_enabled),
        fog_color: vector4(fields.get(&FOG_COLOR)).unwrap_or(stated.fog_color),
        fog_alternate_color: vector4(fields.get(&FOG_ALTERNATE_COLOR))
            .unwrap_or(stated.fog_alternate_color),
        fog_start_end: vector2(fields.get(&FOG_START_AND_END)).unwrap_or(stated.fog_start_end),
        fog_emissive_remap: float(fields.get(&FOG_EMISSIVE_REMAP))
            .unwrap_or(stated.fog_emissive_remap),
    }
}

#[cfg(test)]
mod tests;
