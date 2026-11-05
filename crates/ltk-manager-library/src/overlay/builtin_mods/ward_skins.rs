//! The built-in mod that shows every ward in its own base skin, per ADR-0043.

use super::game_skins::GameSkins;
use super::overrides::Overrides;
use super::{BuiltinMod, Context, mounted};
use ltk_manager_base::error::AppResult;

/// What a ward skin bin is replaced with, so the game falls back to the ward's base skin. No bin
/// starts with these four bytes.
const JUNK: &[u8] = b"JUNK";

/// Every ward shows its own base skin.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct DefaultWardSkins;

impl BuiltinMod for DefaultWardSkins {
    fn slug(&self) -> &'static str {
        "default-ward-skins"
    }

    fn display_name(&self) -> &'static str {
        "Default ward skins"
    }

    /// `JUNK` over each ward skin bin past the base that a map archive holds.
    fn generate(&self, cx: &mut Context<'_>) -> AppResult<Overrides> {
        let maps = mounted(&mut cx.maps, || GameSkins::maps(cx.game_dir, cx.tables))?;
        let mut overrides = Overrides::default();
        for (archive, bin) in maps.past_base_of("sightward") {
            overrides.insert(archive, &bin.path(), JUNK);
        }
        Ok(overrides)
    }
}
