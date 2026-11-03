//! The built-in mod that shows champions in their base skin, a mod's where one replaces it, per
//! ADR-0043.

use super::game_skins::GameSkins;
use super::mod_skins::ModSkins;
use super::overrides::Overrides;
use super::skin_bin::SkinBin;
use super::stand_in::BaseSkin;
use super::{BuiltinMod, Context};
use ltk_manager_base::config::BaseSkinsScope;
use ltk_manager_base::error::AppResult;
use std::collections::BTreeMap;

/// Every skin past the base of each champion in scope stands in for the base skin.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct BaseSkins {
    pub(super) champions: Champions,
}

/// The champions base skins takes in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Champions {
    /// Each character whose base skin a mod changes, by its skin bin or its mesh or textures.
    Modded,
    /// Each character with a skin bin in a champion archive.
    All,
}

impl BaseSkins {
    /// The mod `scope` turns on, and none when it is off.
    pub(super) fn of(scope: BaseSkinsScope) -> Option<Self> {
        let champions = match scope {
            BaseSkinsScope::Off => return None,
            BaseSkinsScope::ModdedChampions => Champions::Modded,
            BaseSkinsScope::AllChampions => Champions::All,
        };
        Some(Self { champions })
    }

    /// Each skin past the base the mod stands in for, by character, with the archive holding it.
    ///
    /// A skin bin a mod ships stays that mod's.
    pub(super) fn stand_in_targets(
        self,
        game: &GameSkins<'_>,
        mods: &ModSkins<'_>,
    ) -> BTreeMap<String, Vec<(String, SkinBin)>> {
        let held = match self.champions {
            Champions::Modded => mods
                .reskinned()
                .into_iter()
                .flat_map(|character| game.past_base_of(character))
                .collect(),
            Champions::All => game.past_base(),
        };
        let mut targets: BTreeMap<String, Vec<(String, SkinBin)>> = BTreeMap::new();
        for (archive, bin) in held {
            if !mods.ships(&bin) {
                targets
                    .entry(bin.character.clone())
                    .or_default()
                    .push((archive.to_owned(), bin));
            }
        }
        targets
    }
}

impl BuiltinMod for BaseSkins {
    fn slug(&self) -> &'static str {
        "base-skins"
    }

    fn display_name(&self) -> &'static str {
        "Base skins"
    }

    /// A stand-in over each target skin bin, and none for a character whose base skin does not
    /// read.
    fn generate(&self, cx: &mut Context<'_>) -> AppResult<Overrides> {
        let mut game = GameSkins::champions(cx.game_dir, cx.tables)?;
        let mut mods = ModSkins::load(cx.mods, &mut game, cx.cache_dir);

        let mut overrides = Overrides::default();
        for (character, targets) in self.stand_in_targets(&game, &mods) {
            let Some(base) = read_base_skin(&character, &mut game, &mut mods) else {
                continue;
            };
            for (archive, bin) in targets {
                overrides.insert(&archive, &bin.path(), base.stand_in(bin.id)?);
            }
        }
        Ok(overrides)
    }
}

/// The base skin `character` shows, a mod's where one ships it and the game's otherwise.
fn read_base_skin(
    character: &str,
    game: &mut GameSkins<'_>,
    mods: &mut ModSkins<'_>,
) -> Option<BaseSkin> {
    let bin = SkinBin::new(character, 0);
    let bytes = if mods.ships(&bin) {
        mods.read(&bin)?
    } else {
        game.read(&bin)?
    };
    let base = BaseSkin::parse(character, &bytes);
    if base.is_none() {
        tracing::warn!(
            "Built-in mods: {} holds no base skin to stand in with",
            bin.path()
        );
    }
    base
}
