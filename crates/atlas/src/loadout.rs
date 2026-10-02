//! A sample of what the controllers fill their elements with, read out of the game: one champion
//! with the summoner spells, runes and items it plays with, per "A preview that looks like the
//! game" in docs/plans/atlas-ui-editor.md.

use ltk_hash::BinHash;
use ltk_manager_core::bin_document::{
    AssetLookup, BinDocument, Fields, GameCopy, Namer, RowNames, fields_of, items, leaf, optional,
    text,
};
use ltk_manager_game::character::{ABILITY_COUNT, ability_spells, record_path, skin_path};
use ltk_manager_game::spell::spell_data;
use ltk_meta::PropertyValueEnum;
use ltk_meta::walk::Leaf;
use rayon::prelude::*;
use serde::Serialize;

use super::fields::named;
use super::model::UiTexture;
use super::resolver::{number, object};
use super::spell_tooltip::{Character, SpellContext, SpellObjects, StatsUi, spell_tooltip};

/// The highest level a tooltip's values can be read at.
pub const MAX_CHARACTER_LEVEL: u8 = super::spell_tooltip::MAX_LEVEL;

const CHAMPION: &str = "Ahri";
const SUMMONERS: [&str; 2] = ["SummonerFlash", "SummonerDot"];
/// Luden's Companion, Sorcerer's Shoes, Shadowflame, Rabadon's Deathcap, Zhonya's Hourglass, Void
/// Staff, then the Stealth Ward trinket.
const ITEMS: [u32; 7] = [6655, 3020, 4645, 3089, 3157, 3135, 3340];
const KEYSTONE: &str = "Perks/Styles/Domination/Electrocute";
const SUBSTYLE: &str = "Perks/Styles/Sorcery";
/// The folder a summoner spell's bare icon name sits in.
const SPELL_ICONS: &str = "assets/spells/icons2d/";
const ABILITY_KEYS: [&str; ABILITY_COUNT] = ["Q", "W", "E", "R"];
/// Each `arType`'s name in its `game_ability_resource_` string key, in the enum's order.
const RESOURCES: [&str; 14] = [
    "mp",
    "energy",
    "none",
    "shield",
    "battlefury",
    "dragonfury",
    "rage",
    "heat",
    "gnarfury",
    "ferocity",
    "bloodwell",
    "wind",
    "ammo",
    "other",
];

const SPELL_OBJECT: BinHash = named("SpellObject");
/// The `GlobalStatsUIData` the client writes a calculation's scaling by, which the tables do
/// not name.
const GLOBAL_STATS_UI: BinHash = BinHash(0x42e2_a2c6);
const SCRIPT_NAME: BinHash = named("mScriptName");
const ICON_NAME: BinHash = named("mImgIconName");
const PASSIVE_ICON: BinHash = named("passive1IconName");
const PASSIVE_SPELL: BinHash = named("mCharacterPassiveSpell");
const PRIMARY_RESOURCE: BinHash = named("primaryAbilityResource");
const RESOURCE_TYPE: BinHash = named("arType");
const NAME: BinHash = named("name");
const CHARACTER_NAME: BinHash = named("mCharacterName");
const ICON_SQUARE: BinHash = named("iconSquare");
const LOADSCREEN: BinHash = named("loadscreen");
const IMAGE: BinHash = named("image");
const ITEM_CLIENT: BinHash = named("mItemDataClient");
const INVENTORY_ICON: BinHash = named("inventoryIcon");
const PERK_ICON: BinHash = named("mIconTextureName");

/// The textures and names a preview fills a controller's elements with.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct UiLoadout {
    pub champion: String,
    /// The champion's name in the string table, where its record names one.
    pub name_key: Option<String>,
    pub portrait: Option<UiTexture>,
    pub splash: Option<UiTexture>,
    /// Q, W, E and R.
    pub abilities: Vec<Option<UiTexture>>,
    pub passive: Option<UiTexture>,
    /// D and F.
    pub summoners: Vec<Option<UiTexture>>,
    pub keystone: Option<UiTexture>,
    pub substyle: Option<UiTexture>,
    /// The six item slots, then the trinket.
    pub items: Vec<Option<UiTexture>>,
}

/// The sample loadout, each object read from the bin `game` answers for it and each texture
/// located through `assets`. A part the install does not hold is absent.
pub fn read_loadout(
    game: &dyn GameCopy,
    assets: &dyn AssetLookup,
    names: &dyn RowNames,
) -> UiLoadout {
    let mut objects = Objects {
        game,
        bins: Vec::new(),
    };
    let mut textures = Textures {
        assets,
        namer: Namer::new(names),
    };

    let record = objects.fields(&record_path(CHAMPION));
    let skin = objects.fields(&skin_path(CHAMPION, 0));

    let abilities = ability_spells(record.as_ref(), |entry| objects.at(entry))
        .into_iter()
        .map(|spell| textures.at(spell_icon(spell.as_ref()?)))
        .collect();
    let summoners = SUMMONERS
        .iter()
        .map(|name| {
            let spell = objects.fields(&format!("Shared/Spells/{name}"))?;
            let Leaf::String(icon) = first_leaf(spell_icon(&spell))? else {
                return None;
            };
            textures.path(&summoner_path(icon))
        })
        .collect();
    let items = ITEMS
        .iter()
        .map(|id| {
            let item = objects.fields(&format!("Items/{id}"))?;
            textures.at(fields_of(item.get(&ITEM_CLIENT))?.get(&INVENTORY_ICON))
        })
        .collect();
    let keystone = objects.fields(KEYSTONE);
    let substyle = objects.fields(SUBSTYLE);

    UiLoadout {
        champion: CHAMPION.to_owned(),
        name_key: text(own(record.as_ref(), NAME)).map(str::to_owned),
        portrait: textures.at(own(skin.as_ref(), ICON_SQUARE)),
        splash: textures
            .at(fields_of(own(skin.as_ref(), LOADSCREEN)).and_then(|image| image.get(&IMAGE))),
        abilities,
        passive: textures.at(own(record.as_ref(), PASSIVE_ICON)),
        summoners,
        keystone: textures.at(own(keystone.as_ref(), PERK_ICON)),
        substyle: textures.at(own(substyle.as_ref(), PERK_ICON)),
        items,
    }
}

/// One ability's tooltip, per "The string" in docs/research/ui-data-layout.md.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct UiSpellTooltip {
    pub name: String,
    /// The key that casts the spell, none for the passive.
    pub hotkey: Option<String>,
    /// The tooltip string, its values at the rank and level read for, with no bonus stats.
    pub text: String,
    /// The tooltip string while Shift is held, none for a spell with no extended tooltip.
    pub extended: Option<String>,
    /// How many ranks the spell has, the top rank its values can read at.
    pub ranks: u8,
    /// The spell's icon, which the tooltip's icon shows.
    pub icon: Option<UiTexture>,
}

/// The tooltips of the character `character`'s passive and abilities, in that order, each read
/// as `read_loadout` reads its objects and textures, with its text read through `strings`. An
/// ability whose spell names no tooltip is absent.
///
/// The values read for the character at `level`, from 1 to `MAX_CHARACTER_LEVEL`, and for no
/// character at level 0, as the client reads them with none: level 1 with every stat at 0. Each
/// spell's values read at `rank`, from 1, or at its top rank where it has fewer.
pub fn read_character_tooltips(
    game: &dyn GameCopy,
    assets: &dyn AssetLookup,
    names: &dyn RowNames,
    strings: &dyn Fn(&str) -> Option<String>,
    character: &str,
    level: u8,
    rank: u8,
) -> Vec<UiSpellTooltip> {
    let mut objects = Objects {
        game,
        bins: Vec::new(),
    };
    let mut textures = Textures {
        assets,
        namer: Namer::new(names),
    };

    let record = objects.fields(&record_path(character));
    let resource = resource_name(record.as_ref(), strings);
    let passive = object(own(record.as_ref(), PASSIVE_SPELL)).and_then(|spell| objects.at(spell));
    let passive_icon = textures.at(own(record.as_ref(), PASSIVE_ICON));
    let abilities = ability_spells(record.as_ref(), |entry| objects.at(entry));
    let hotkeys: Vec<(String, &str)> = abilities
        .iter()
        .zip(ABILITY_KEYS)
        .filter_map(|(spell, key)| Some((text(spell.as_ref()?.get(&SCRIPT_NAME))?.to_owned(), key)))
        .collect();
    let stats = objects
        .at(GLOBAL_STATS_UI)
        .map(|fields| StatsUi::read(&fields, strings))
        .unwrap_or_default();
    let at_level = Character::at(record.as_ref(), level);

    let slots =
        std::iter::once((None, passive)).chain(ABILITY_KEYS.into_iter().map(Some).zip(abilities));
    let mut tooltips = Vec::new();
    for (hotkey, spell) in slots {
        let Some(spell) = spell else {
            continue;
        };
        let context = SpellContext {
            hotkey,
            hotkeys: &hotkeys,
            resource: resource.as_deref(),
            strings,
            stats: &stats,
            character: &at_level,
            rank,
        };
        let Some(tooltip) = spell_tooltip(&spell, &mut objects, &context) else {
            continue;
        };

        let icon = match hotkey {
            Some(_) => textures.at(spell_icon(&spell)),
            None => passive_icon
                .clone()
                .or_else(|| textures.at(spell_icon(&spell))),
        };
        tooltips.push(UiSpellTooltip {
            name: tooltip.name,
            hotkey: hotkey.map(str::to_owned),
            text: tooltip.text,
            extended: tooltip.extended,
            ranks: tooltip.ranks,
            icon,
        });
    }
    tooltips
}

/// The name of the resource the character's abilities cost, as its strings name it.
fn resource_name(
    record: Option<&Fields>,
    strings: &dyn Fn(&str) -> Option<String>,
) -> Option<String> {
    let resource = fields_of(own(record, PRIMARY_RESOURCE));
    let kind = resource
        .and_then(|fields| number(fields, RESOURCE_TYPE))
        .unwrap_or(0.0);
    let name = RESOURCES.get(kind as usize)?;
    strings(&format!("game_ability_resource_{name}"))
}

/// One character a preview can fill a tooltip from.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct UiCharacter {
    /// The folder its paths name it by, such as `Ahri` or `TFT15_Ahri`.
    pub id: String,
    /// Its name in the string table, where the table holds one.
    pub name: Option<String>,
    /// The square icon of its base skin.
    pub icon: Option<UiTexture>,
}

/// Each of `characters` with its name and the icon of its base skin, every character's record
/// and skin read in parallel through `game`.
pub fn read_characters(
    game: &dyn GameCopy,
    assets: &dyn AssetLookup,
    names: &dyn RowNames,
    strings: &dyn Fn(&str) -> Option<String>,
    characters: &[String],
) -> Vec<UiCharacter> {
    let read: Vec<(Option<String>, Option<PropertyValueEnum>)> = characters
        .par_iter()
        .map(|id| {
            let mut objects = Objects {
                game,
                bins: Vec::new(),
            };
            let record = objects.fields(&record_path(id));
            let skin = objects.fields(&skin_path(id, 0));
            let name = text(own(record.as_ref(), CHARACTER_NAME)).map(str::to_owned);
            (name, own(skin.as_ref(), ICON_SQUARE).cloned())
        })
        .collect();

    let mut textures = Textures {
        assets,
        namer: Namer::new(names),
    };
    characters
        .iter()
        .zip(read)
        .map(|(id, (name, icon))| UiCharacter {
            id: id.clone(),
            name: strings(&format!(
                "game_character_displayname_{}",
                name.as_deref().unwrap_or(id)
            )),
            icon: textures.at(icon.as_ref()),
        })
        .collect()
}

/// Objects read by path through the bins that declare them, each bin parsed once.
struct Objects<'a> {
    game: &'a dyn GameCopy,
    bins: Vec<BinDocument>,
}

impl Objects<'_> {
    fn fields(&mut self, path: &str) -> Option<Fields> {
        self.at(named(path))
    }

    fn at(&mut self, entry: BinHash) -> Option<Fields> {
        if let Some(object) = self.bins.iter().find_map(|bin| bin.object_at(entry)) {
            return Some(object.properties.clone());
        }

        let bytes = self.game.declaring_chunk(entry).ok()??;
        let bin = BinDocument::parse(bytes).ok()?;
        let fields = bin.object_at(entry).map(|object| object.properties.clone());
        self.bins.push(bin);
        fields
    }
}

impl SpellObjects for Objects<'_> {
    fn object(&mut self, entry: BinHash) -> Option<Fields> {
        self.at(entry)
    }

    /// Found among the bins read so far, which hold the character's own spells.
    fn spell(&mut self, script: &str) -> Option<Fields> {
        self.bins.iter().find_map(|bin| {
            bin.entries().find_map(|entry| {
                let object = bin.object_at(entry)?;
                let named = object.class_hash == SPELL_OBJECT
                    && text(object.properties.get(&SCRIPT_NAME))
                        .is_some_and(|name| name.eq_ignore_ascii_case(script));
                named.then(|| object.properties.clone())
            })
        })
    }
}

/// Textures located on this machine, each named as the tables name its chunk.
struct Textures<'a> {
    assets: &'a dyn AssetLookup,
    namer: Namer<'a>,
}

impl Textures<'_> {
    /// The texture a field names: a path, or a file link, the first where it holds a list.
    fn at(&mut self, value: Option<&PropertyValueEnum>) -> Option<UiTexture> {
        match first_leaf(value)? {
            Leaf::String(path) if !path.is_empty() => self.path(path),
            Leaf::File(hash) if hash.0 != 0 => {
                let named = self.namer.chunk(hash);
                let asset = match self.assets.locate_chunk(hash) {
                    Some(asset) => asset,
                    /* The install's index reaches a chunk the tables name by its path alone. */
                    None => self.assets.locate(named.as_deref()?)?,
                };
                let path = named.unwrap_or_else(|| format!("{:016x}", hash.0));
                Some(texture(path, asset))
            }
            _ => None,
        }
    }

    fn path(&mut self, path: &str) -> Option<UiTexture> {
        let asset = self.assets.locate(path)?;
        Some(texture(path.to_owned(), asset))
    }
}

fn texture(path: String, asset: ltk_manager_core::preview::AssetRef) -> UiTexture {
    UiTexture {
        path,
        asset: Some(asset),
        page: false,
    }
}

/// The field `field` of an object that may be absent.
fn own(fields: Option<&Fields>, field: BinHash) -> Option<&PropertyValueEnum> {
    fields?.get(&field)
}

/// The icon list of a `SpellObject`'s spell data.
fn spell_icon(spell: &Fields) -> Option<&PropertyValueEnum> {
    spell_data(spell)?.get(&ICON_NAME)
}

/// A summoner spell icon's path, which the spell names by its file name alone.
fn summoner_path(icon: &str) -> String {
    if icon.contains('/') {
        icon.to_owned()
    } else {
        format!("{SPELL_ICONS}{}", icon.to_lowercase())
    }
}

/// The value `value` holds, through an optional and to the first item of a list.
fn first_leaf(value: Option<&PropertyValueEnum>) -> Option<Leaf<'_>> {
    let value = optional(value)?;
    leaf(Some(value)).or_else(|| leaf(items(Some(value)).first()))
}

#[cfg(test)]
mod tests;
