//! The built-in mod that draws the League Classic ink outline around champions, per ADR-0078.

mod outline;
mod skins;

pub use outline::{InkingOutline, InkingSide, outline_values};

use super::base_skins::{BaseSkins, Champions};
use super::game_skins::GameSkins;
use super::mod_skins::ModSkins;
use super::overrides::{Overrides, quoted};
use super::skin_bin::SkinBin;
use super::{BuiltinMod, Context};
use ltk_manager_assets::game_wads::mount_wad;
use ltk_manager_base::config::{
    BaseSkinsScope, BuiltinModSettings, CharacterInking as InkingSettings, InkingMaps, InkingScope,
};
use ltk_manager_base::error::AppResult;
use ltk_manager_base::utils::game::{GameDir, archive_stem};
use ltk_wad::WadHash;
use serde::Serialize;
use skins::{OUTLINE_LIST, SkinReads, skin_entry};
use std::collections::BTreeSet;

/// The outline category that every skin list links.
const CATEGORY: &str = "Mods/builtin/character-inking/Category";

/// The outline material that the category links.
const MATERIAL: &str = "Mods/builtin/character-inking/Material";

/// The TFT map, whose boards draw no champion.
const TFT: &str = "map22";

/// Summoner's Rift.
const SUMMONERS_RIFT: &str = "map11";

/// A map whose bin can hold the outline category, which draws the outline on that map only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct InkingMap {
    /// The archive's name lowercased without its extensions, such as `map11`, which the setting
    /// stores.
    pub name: String,
    /// The archive, such as `Map11.wad.client`.
    pub archive: String,
}

impl InkingMap {
    /// `data/maps/shipping/<map>/<map>.bin`.
    fn chunk_path(&self) -> String {
        format!("data/maps/shipping/{0}/{0}.bin", self.name)
    }
}

/// Every map in `game_dir` whose unlocalized archive holds its map bin, TFT's aside, in archive
/// order.
///
/// # Errors
///
/// Fails when the maps directory cannot be listed.
pub fn inking_maps(game_dir: &GameDir) -> AppResult<Vec<InkingMap>> {
    let mut maps = Vec::new();
    for (archive, path) in game_dir.map_archives()? {
        let name = archive_stem(&archive).to_ascii_lowercase();
        if name.contains('.') || name == TFT {
            continue;
        }

        let map = InkingMap { name, archive };
        match mount_wad(&path) {
            Ok(wad)
                if wad
                    .chunks()
                    .contains(WadHash::from(map.chunk_path().as_str())) =>
            {
                maps.push(map);
            }
            Ok(_) => {}
            Err(e) => tracing::warn!("Built-in mods: passing over {}: {e}", path.display()),
        }
    }
    Ok(maps)
}

/// Every champion in scope gets the outline on every map in scope.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct CharacterInking {
    settings: InkingSettings,
    /// The champions base skins stands in for, whose skin bins then hold skin 0's objects.
    base_skins: Option<Champions>,
}

impl CharacterInking {
    /// The mod `settings` turn on, and none when inking is off.
    pub(super) fn of(settings: &BuiltinModSettings) -> Option<Self> {
        if !settings.character_inking.enabled {
            return None;
        }

        let base_skins = match settings.base_skins {
            BaseSkinsScope::Off => None,
            BaseSkinsScope::ModdedChampions => Some(Champions::Modded),
            BaseSkinsScope::AllChampions => Some(Champions::All),
        };
        Some(Self {
            settings: settings.character_inking.clone(),
            base_skins,
        })
    }

    /// Whether the outline draws on `map`.
    fn draws_on(&self, map: &InkingMap) -> bool {
        match self.settings.maps {
            InkingMaps::All => true,
            InkingMaps::SummonersRift => map.name == SUMMONERS_RIFT,
            InkingMaps::Chosen => self.settings.chosen_maps.contains(&map.name),
        }
    }

    /// Each champion of the roster in scope, in name order.
    fn champions<'g>(&self, game: &'g GameSkins<'_>, mods: &ModSkins<'_>) -> BTreeSet<&'g str> {
        let roster = game.roster().iter().map(String::as_str);
        match self.settings.scope {
            InkingScope::All => roster.collect(),
            InkingScope::Modded => {
                let reskinned = mods.reskinned();
                roster.filter(|name| reskinned.contains(name)).collect()
            }
            InkingScope::Chosen => roster
                .filter(|name| self.settings.chosen_champions.contains(*name))
                .collect(),
        }
    }

    /// Each skin bin of `champions` that the game holds or a mod ships, base skins first.
    fn skin_bins(
        &self,
        champions: &BTreeSet<&str>,
        game: &GameSkins<'_>,
        mods: &ModSkins<'_>,
    ) -> Vec<SkinBin> {
        let mut bins: Vec<SkinBin> = champions
            .iter()
            .map(|character| SkinBin::new(character, 0))
            .filter(|bin| mods.ships(bin) || game.checksum(&bin.path()).is_some())
            .collect();

        let past_base = match self.settings.scope {
            InkingScope::All => game
                .past_base()
                .into_iter()
                .filter(|(_, bin)| champions.contains(bin.character.as_str()))
                .map(|(_, bin)| bin)
                .collect::<BTreeSet<_>>(),
            InkingScope::Modded | InkingScope::Chosen => champions
                .iter()
                .flat_map(|character| game.past_base_of(character))
                .map(|(_, bin)| bin)
                .collect(),
        };
        bins.extend(past_base);
        bins
    }
}

impl BuiltinMod for CharacterInking {
    fn slug(&self) -> &'static str {
        "character-inking"
    }

    fn display_name(&self) -> &'static str {
        "Character inking"
    }

    /// The outline category and material in each map bin in scope, and on each skin bin in scope
    /// that lists no category, one outline entry per submesh of its mesh.
    fn generate(&self, cx: &mut Context<'_>) -> AppResult<Overrides> {
        let mut overrides = Overrides::default();
        let maps: Vec<InkingMap> = inking_maps(cx.game_dir)?
            .into_iter()
            .filter(|map| self.draws_on(map))
            .collect();
        if maps.is_empty() {
            tracing::warn!("Built-in mods: character inking draws on no installed map");
            return Ok(overrides);
        }
        for map in &maps {
            let target = map.chunk_path();
            overrides.create(&target, CATEGORY, outline::category_body(MATERIAL));
            overrides.create(&target, MATERIAL, outline::material_body(&self.settings));
        }

        let mut game = GameSkins::champions(cx.game_dir, cx.tables)?;
        let mut mods = ModSkins::load(cx.mods, &mut game, cx.cache_dir);
        let stood_in: BTreeSet<SkinBin> = self
            .base_skins
            .map(|champions| {
                BaseSkins { champions }
                    .stand_in_targets(&game, &mods)
                    .into_values()
                    .flatten()
                    .map(|(_, bin)| bin)
                    .collect()
            })
            .unwrap_or_default();

        let champions: Vec<String> = self
            .champions(&game, &mods)
            .into_iter()
            .map(str::to_owned)
            .collect();
        let champions: BTreeSet<&str> = champions.iter().map(String::as_str).collect();
        let bins = self.skin_bins(&champions, &game, &mods);

        let mut reads = SkinReads::open(cx.cache_dir);
        let mut declared = 0usize;
        for bin in bins {
            let source = if stood_in.contains(&bin) {
                SkinBin::new(&bin.character, 0)
            } else {
                bin.clone()
            };
            let Some(facts) = reads.skin(&source, &mut game, &mut mods) else {
                continue;
            };
            if facts.listed {
                continue;
            }
            let Some(mesh) = facts.mesh else {
                continue;
            };
            let Some(submeshes) = reads.submeshes(&mesh, &mut game, &mut mods) else {
                continue;
            };
            let Some(list) = outline_list(&submeshes) else {
                continue;
            };

            overrides.declare(
                &bin.path(),
                &skin_entry(&bin),
                &format!("skinMeshProperties.{OUTLINE_LIST}"),
                list,
            );
            declared += 1;
        }
        reads.save();

        tracing::info!(
            "Built-in mods: character inking outlines {declared} skins on {} maps",
            maps.len()
        );
        Ok(overrides)
    }
}

/// The `OutlineCategorySubmeshes` list that outlines every named submesh in `submeshes` once,
/// as one line of flow YAML. Returns `None` if no submesh has a name.
fn outline_list(submeshes: &[String]) -> Option<String> {
    let mut seen = BTreeSet::new();
    let entries: Vec<String> = submeshes
        .iter()
        .filter(|name| !name.is_empty() && seen.insert(name.as_str()))
        .map(|name| {
            format!(
                "!embed(CharacterOutlineSubmeshes) {{category: {}, Submeshes: {}}}",
                quoted(CATEGORY),
                quoted(name)
            )
        })
        .collect();
    (!entries.is_empty()).then(|| format!("[{}]", entries.join(", ")))
}

#[cfg(test)]
mod tests;
