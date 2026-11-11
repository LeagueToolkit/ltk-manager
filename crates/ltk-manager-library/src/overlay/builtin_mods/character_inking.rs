//! The built-in mod that draws the League Classic ink outline around champions, and around lane
//! minions and structures when those settings are on, per ADR-0078.

mod classic;
mod outline;
mod skins;
mod textures;

pub use outline::{InkingOutline, InkingSide, outline_values};

use super::base_skins::{BaseSkins, Champions};
use super::game_skins::GameSkins;
use super::mod_skins::ModSkins;
use super::overrides::{Overrides, quoted};
use super::skin_bin::SkinBin;
use super::{BuiltinMod, Context, check_called_off, mounted};
use ltk_manager_assets::game_wads::mount_wad;
use ltk_manager_base::config::{
    BaseSkinsScope, BuiltinModSettings, CharacterInking as InkingSettings, InkingMaps, InkingScope,
};
use ltk_manager_base::error::AppResult;
use ltk_manager_base::utils::game::{GameDir, archive_stem};
use ltk_wad::WadHash;
use outline::Mask;
use serde::Serialize;
use skins::{OUTLINE_LIST, SkinReads, skin_entry};
use std::collections::BTreeSet;

/// The outline category that every skin list links.
const CATEGORY: &str = "Mods/builtin/character-inking/Category";

/// The outline material that the category links.
const MATERIAL: &str = "Mods/builtin/character-inking/Material";

/// The prefix of each outline material masked by a submesh's own texture.
const MASK_MATERIALS: &str = "Mods/builtin/character-inking/Masks";

/// The prefix of the League Classic copy of a character, such as `jade_aatrox`.
const JADE_PREFIX: &str = "jade_";

/// The TFT map, whose boards draw no champion.
const TFT: &str = "map22";

/// Summoner's Rift.
const SUMMONERS_RIFT: &str = "map11";

/// The lane minions of Summoner's Rift and of the Howling Abyss, as the map archives name them.
const LANE_MINIONS: [&str; 16] = [
    "sru_orderminionmelee",
    "sru_orderminionranged",
    "sru_orderminionsiege",
    "sru_orderminionsuper",
    "sru_chaosminionmelee",
    "sru_chaosminionranged",
    "sru_chaosminionsiege",
    "sru_chaosminionsuper",
    "ha_orderminionmelee",
    "ha_orderminionranged",
    "ha_orderminionsiege",
    "ha_orderminionsuper",
    "ha_chaosminionmelee",
    "ha_chaosminionranged",
    "ha_chaosminionsiege",
    "ha_chaosminionsuper",
];

/// The turrets, inhibitors and nexuses of every map, as the map archives name them. `turret`,
/// `inhibitor` and `nexus` hold one skin per map and team.
const STRUCTURES: [&str; 9] = [
    "turret",
    "inhibitor",
    "nexus",
    "sruap_turret_order5",
    "sruap_turret_chaos5",
    "ha_ap_ordershrineturret",
    "ha_ap_chaosturretshrine",
    "brawl_turret",
    "brawl_fountainturret",
];

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

/// A preview project of character inking for one champion, as [`write_inking_preview`] writes it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct InkingPreview {
    /// The project directory, which a project sandbox reads over the game.
    pub project: String,
    /// The champion's base skin bin, `data/characters/<champion>/skins/skin0.bin`.
    pub skin_bin: String,
    /// The path hash of the base skin's object, `Characters/<champion>/Skins/Skin0`, written as
    /// `0x` and eight hex digits.
    pub entry: String,
    /// The content hash of the project's declarations, which changes with every rewrite.
    pub revision: String,
}

/// WAD path tables that name no chunk, for a preview that needs no companion.
struct NoTables;

impl ltk_wad::PathResolver for NoTables {
    fn resolve(&self, _: WadHash) -> Option<String> {
        None
    }
}

/// Writes the declarations that `settings` give `champion` on Summoner's Rift into `dir`, as a
/// mod project of its own.
///
/// The project holds the same declarations the overlay build writes for that champion, so a
/// viewer reading it through a project sandbox draws the outline the game draws.
///
/// # Errors
///
/// Fails when the game cannot be read or the project cannot be written.
pub fn write_inking_preview(
    dir: &std::path::Path,
    settings: &InkingSettings,
    champion: &str,
    game_dir: &GameDir,
) -> AppResult<InkingPreview> {
    let character = champion.to_ascii_lowercase();
    let preview = CharacterInking {
        settings: InkingSettings {
            enabled: true,
            scope: InkingScope::Chosen,
            chosen_champions: BTreeSet::from([character.clone()]),
            minions: false,
            structures: false,
            maps: InkingMaps::SummonersRift,
            ..settings.clone()
        },
        base_skins: None,
    };

    let overrides = preview.generate(&mut Context::new(game_dir, &NoTables, &mut [], dir))?;
    overrides.write(dir, preview.slug(), preview.display_name())?;

    let bin = SkinBin::new(&character, 0);
    let revision =
        ltk_overlay::ContentHash::of(overrides.declarations().unwrap_or_default().as_bytes());
    Ok(InkingPreview {
        project: dir.to_string_lossy().into_owned(),
        skin_bin: bin.path(),
        entry: format!(
            "0x{:08x}",
            ltk_hash::BinHash::from(skin_entry(&bin).as_str()).0
        ),
        revision: revision.to_string(),
    })
}

/// Every champion in scope, and every lane minion and structure that the settings turn on, gets
/// the outline on every map in scope.
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

    /// Each skin bin of the lane minions and structures in scope that a map archive holds, in
    /// path order.
    fn map_bins(&self, game: &GameSkins<'_>) -> BTreeSet<SkinBin> {
        let minions = self.settings.minions.then_some(LANE_MINIONS.as_slice());
        let structures = self.settings.structures.then_some(STRUCTURES.as_slice());

        let mut bins = BTreeSet::new();
        for character in minions.into_iter().chain(structures).flatten() {
            let base = SkinBin::new(character, 0);
            if game.checksum(&base.path()).is_some() {
                bins.insert(base);
            }
            bins.extend(game.past_base_of(character).into_iter().map(|(_, bin)| bin));
        }
        bins
    }

    /// Declares the outline list of `bin`, whose loaded bin holds the objects of `source`, with
    /// its mask materials and League Classic texture swaps. Returns `false` if the skin lists an
    /// outline already or has no mesh that reads.
    fn outline_skin(
        &self,
        bin: &SkinBin,
        source: &SkinBin,
        reads: &mut SkinReads,
        game: &mut GameSkins<'_>,
        mods: &mut ModSkins<'_>,
        overrides: &mut Overrides,
    ) -> bool {
        let Some(facts) = reads.skin(source, game, mods) else {
            return false;
        };
        if facts.listed {
            return false;
        }
        let Some(mesh) = facts.mesh else {
            return false;
        };
        let Some(submeshes) = reads.submeshes(&mesh, game, mods) else {
            return false;
        };

        let jade = SkinBin::new(&format!("{JADE_PREFIX}{}", source.character), source.id);
        let classic = (!mods.ships(source) && game.checksum(&jade.path()).is_some())
            .then(|| reads.classic(source, &jade, game))
            .flatten();
        let jade_submeshes: Vec<String> = classic
            .as_ref()
            .and_then(|classic| classic.mesh.clone())
            .and_then(|mesh| reads.submeshes(&mesh, game, mods))
            .unwrap_or_default();

        let mut seen = BTreeSet::new();
        let mut entries: Vec<(String, Option<Mask>)> = Vec::new();
        for name in submeshes
            .iter()
            .filter(|name| !name.is_empty() && seen.insert(name.to_ascii_lowercase()))
        {
            let classic_entry = classic.as_ref().and_then(|classic| classic.entry_for(name));
            let mask = match classic_entry {
                Some(mask) => mask,
                None if jade_submeshes
                    .iter()
                    .any(|jade| jade.eq_ignore_ascii_case(name)) =>
                {
                    continue;
                }
                None => facts
                    .textures
                    .of(name)
                    .filter(|texture| reads.has_transparency(*texture, game))
                    .map(|texture| Mask {
                        texture,
                        channels: outline::ALPHA,
                    }),
            };
            entries.push((name.clone(), mask));
        }
        let Some(list) = outline_list(&entries) else {
            return false;
        };

        let target = bin.path();
        for mask in entries.iter().filter_map(|(_, mask)| *mask) {
            overrides.create(
                &target,
                &mask_material(mask),
                outline::material_body(&self.settings, Some(mask)),
            );
        }
        for swap in classic.iter().flat_map(|classic| &classic.swaps) {
            overrides.declare(
                &swap.chunk,
                &format!("0x{:08x}", swap.material),
                &format!("samplerValues[{}].texturePath", swap.index),
                format!("\"0x{:016x}\"", swap.texture),
            );
        }
        overrides.declare(
            &target,
            &skin_entry(bin),
            &format!("skinMeshProperties.{OUTLINE_LIST}"),
            list,
        );
        true
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
            overrides.create(
                &target,
                MATERIAL,
                outline::material_body(&self.settings, None),
            );
        }

        let called_off = cx.called_off;
        let game = mounted(&mut cx.champions, || {
            GameSkins::champions(cx.game_dir, cx.tables)
        })?;
        let mut mods = ModSkins::load(cx.mods, game, cx.cache_dir);
        let stood_in: BTreeSet<SkinBin> = self
            .base_skins
            .map(|champions| {
                BaseSkins { champions }
                    .stand_in_targets(game, &mods)
                    .into_values()
                    .flatten()
                    .map(|(_, bin)| bin)
                    .collect()
            })
            .unwrap_or_default();

        let champions: Vec<String> = self
            .champions(game, &mods)
            .into_iter()
            .map(str::to_owned)
            .collect();
        let champions: BTreeSet<&str> = champions.iter().map(String::as_str).collect();
        let bins = self.skin_bins(&champions, game, &mods);

        let mut reads = SkinReads::open(cx.cache_dir);
        let mut declared = 0usize;
        for bin in bins {
            check_called_off(called_off)?;
            let source = if stood_in.contains(&bin) {
                SkinBin::new(&bin.character, 0)
            } else {
                bin.clone()
            };
            if self.outline_skin(&bin, &source, &mut reads, game, &mut mods, &mut overrides) {
                declared += 1;
            }
        }

        if self.settings.minions || self.settings.structures {
            let map_game = mounted(&mut cx.maps, || GameSkins::maps(cx.game_dir, cx.tables))?;
            for bin in self.map_bins(map_game) {
                check_called_off(called_off)?;
                if self.outline_skin(&bin, &bin, &mut reads, map_game, &mut mods, &mut overrides) {
                    declared += 1;
                }
            }
        }
        reads.save();

        tracing::info!(
            "Built-in mods: character inking outlines {declared} skins on {} maps",
            maps.len()
        );
        Ok(overrides)
    }
}

/// The outline material masked by `mask`, created in each skin bin that draws a submesh with it.
fn mask_material(mask: Mask) -> String {
    let channels = mask
        .channels
        .iter()
        .enumerate()
        .filter(|(_, weight)| **weight != 0.0)
        .fold(0u8, |bits, (at, _)| bits | (1 << at));
    format!("{MASK_MATERIALS}/{:016x}-{channels:x}", mask.texture)
}

/// The `OutlineCategorySubmeshes` list of `entries`, each a `Submeshes` value with its mask, as
/// one line of flow YAML. An entry with a mask links its masked material. Returns `None` for no
/// entry.
fn outline_list(entries: &[(String, Option<Mask>)]) -> Option<String> {
    let entries: Vec<String> = entries
        .iter()
        .map(|(submeshes, mask)| {
            let material = mask.map_or(String::new(), |mask| {
                format!(", materialOverride: {}", quoted(&mask_material(mask)))
            });
            format!(
                "!embed(CharacterOutlineSubmeshes) {{category: {}, Submeshes: {}{material}}}",
                quoted(CATEGORY),
                quoted(submeshes)
            )
        })
        .collect();
    (!entries.is_empty()).then(|| format!("[{}]", entries.join(", ")))
}

#[cfg(test)]
mod tests;
