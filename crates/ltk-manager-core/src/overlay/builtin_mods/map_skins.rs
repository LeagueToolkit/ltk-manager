//! The built-in mod that sets which map skin every game shows, per ADR-0052.

use super::game_maps::{self, MapSkin};
use super::overrides::{Overrides, quoted};
use super::{BuiltinMod, Context};
use crate::config::{BuiltinModSettings, MapSkinMode};
use crate::error::AppResult;
use ltk_hash::BinHash;
use ltk_meta::PropertyValueEnum;

/// The skin every map falls back to, and the one a server names in an ordinary game.
const DEFAULT: &str = "Default";

/// The `MapSkin` properties that draw the map, the ones a copy carries.
///
/// The navigation mesh, the server constants and the unit skin tables stay each skin's own.
const ENVIRONMENT: &[&str] = &[
    "mMapContainerLink",
    "mMapObjectsCFG",
    "mMinimapBackgroundConfig",
    "mAlternateAssets",
    "mWorldParticlesINI",
    "WorldParticles",
    "mGrassTintTexture",
    "mSkyboxCubemapTexture",
    "mColorizationPostEffect",
    "GammaParameters",
    "MaterialSwap",
    "ShadowsEnabled",
    "mResourceResolvers",
];

/// Every skin a map links draws the environment of one of them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct MapSkins {
    /// The `name` of the skin whose environment every other skin takes.
    source: String,
}

impl MapSkins {
    /// The mod `settings` turn on, and none when they leave the game's choice alone.
    pub(super) fn of(settings: &BuiltinModSettings) -> Option<Self> {
        let source = match settings.map_skin {
            MapSkinMode::Game => return None,
            MapSkinMode::Classic => DEFAULT,
            MapSkinMode::Forced if settings.forced_map_skin.is_empty() => return None,
            MapSkinMode::Forced => settings.forced_map_skin.as_str(),
        };
        Some(Self {
            source: source.to_owned(),
        })
    }
}

impl BuiltinMod for MapSkins {
    fn slug(&self) -> &'static str {
        "map-skins"
    }

    fn display_name(&self) -> &'static str {
        "Map skin"
    }

    /// On each map defining the source skin, every other linked skin declared to draw its
    /// environment.
    fn generate(&self, cx: &mut Context<'_>) -> AppResult<Overrides> {
        let mut overrides = Overrides::default();
        let mut found = false;
        for map in game_maps::read(cx.game_dir)? {
            let Some(source) = map.skin(&self.source) else {
                continue;
            };
            found = true;
            for slot in map.skins.iter().filter(|slot| slot.entry != source.entry) {
                for (property, value) in copy(source, slot) {
                    overrides.declare(&map.chunk_path, &slot.entry, property, value);
                }
            }
        }
        if !found {
            tracing::warn!(
                "Built-in mods: no map defines a map skin named {}",
                self.source
            );
        }
        Ok(overrides)
    }
}

/// Each environment property of `slot` that differs from `source`'s, with the value that makes
/// it `source`'s.
///
/// A value `source` holds is a reference to it, which the build reads from the installed game.
/// A value `source` lacks is cleared, since a declaration removes no property.
fn copy(source: &MapSkin, slot: &MapSkin) -> Vec<(&'static str, String)> {
    ENVIRONMENT
        .iter()
        .filter_map(|&property| {
            let hash = BinHash::from(property);
            let value = match (
                source.object.properties.get(&hash),
                slot.object.properties.get(&hash),
            ) {
                (Some(from), Some(to)) if from == to => return None,
                (Some(_), _) => format!("!ref {}", quoted(&format!("{}:{property}", source.entry))),
                (None, Some(to)) => {
                    let Some(empty) = cleared(to) else {
                        tracing::warn!(
                            "Built-in mods: {} keeps its {property}, which {} lacks",
                            slot.name,
                            source.name
                        );
                        return None;
                    };
                    empty.to_owned()
                }
                (None, None) => return None,
            };
            Some((property, value))
        })
        .collect()
}

/// The value a skin lacking a property of `value`'s kind reads as.
fn cleared(value: &PropertyValueEnum) -> Option<&'static str> {
    Some(match value {
        PropertyValueEnum::String(_) => "\"\"",
        PropertyValueEnum::Hash(_)
        | PropertyValueEnum::WadChunkLink(_)
        | PropertyValueEnum::ObjectLink(_)
        | PropertyValueEnum::Struct(_)
        | PropertyValueEnum::Optional(_) => "null",
        PropertyValueEnum::Embedded(_) => "{embed: {set: {}}}",
        PropertyValueEnum::Container(_) | PropertyValueEnum::UnorderedContainer(_) => "[]",
        _ => return None,
    })
}

#[cfg(test)]
mod tests;
