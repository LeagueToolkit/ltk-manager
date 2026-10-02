//! The elements a controller fills at run time, found through the definition structures its fields
//! hold, per "A preview that looks like the game" in docs/plans/atlas-ui-editor.md.
//!
//! The controllers build on a small set of structures, such as a spell slot, an item slot and a
//! portrait, so the rules key on the structure and not on the controller's class. The field a
//! structure sits under says which slot it is.

use std::collections::HashSet;

use ltk_hash::BinHash;
use ltk_manager_core::bin_document::{Fields, entries, hex, items, struct_of};

use super::fields::named;
use super::model::{UiBinding, UiRole};
use super::resolver::object;

const SPELL_SLOT_DETAILED: BinHash = named("SpellSlotDetailedUiDefinition");
const SPELL_SLOT_SIMPLE: BinHash = named("SpellSlotSimpleUiDefinition");
const COOLDOWN_EFFECT: BinHash = named("CooldownEffectUiData");
const ITEM_SLOT_DETAILED: BinHash = named("ItemSlotDetailedUiData");
const ITEM_SLOT_SIMPLE: BinHash = named("ItemSlotSimpleUiData");
const PLAYER_PORTRAIT: BinHash = named("PlayerPortraitUiData");
const UI_PLAYER_PORTRAIT: BinHash = named("UiPlayerPortraitData");
const UNIT_LEVEL: BinHash = named("UnitLevelUiData");
const HEALTH_METER: BinHash = named("HealthMeter");
const RESOURCE_BAR: BinHash = named("AbilityResourceBarData");
const KDA: BinHash = named("UiMetricUnitKda");
const CREEP_SCORE: BinHash = named("UiMetricUnitCreepScore");
const VISION_SCORE: BinHash = named("UiMetricUnitVisionScore");
const BOUNTY: BinHash = named("UiMetricUnitBounty");
const SUMMONER_NAME: BinHash = named("SummonerNameUiData");
const SHOP_BUTTON: BinHash = named("HudShopButton");
const KEYSTONE: BinHash = named("ChampionPerkKeystoneUiData");
const BUFF: BinHash = named("BuffDisplayData");
const CARD: BinHash = named("LoadingScreenPlayerCardClassicData");
const CARD_SPELL: BinHash = named("LoadingScreenPlayerCardClassicSpellData");
const BUFF_TIMER: BinHash = named("SpellSlotBuffTimerData");

const CONTENT_ELEMENT: BinHash = named("ContentElement");
const HOTKEY: BinHash = named("Hotkey");
const HOTKEY_TEXT: BinHash = named("HotkeyText");
const COST: BinHash = named("Cost");
const AMMO_TEXT: BinHash = named("AmmoText");
const COOLDOWN_TEXT: BinHash = named("CooldownText");
const ICON: BinHash = named("Icon");
const STACK_TEXT: BinHash = named("StackText");
const STACKS_TEXT: BinHash = named("StacksText");
const LEVEL_TEXT: BinHash = named("LevelText");
const RESPAWN_TIMER: BinHash = named("RespawnTimer");
const RESPAWN_TIMER_TEXT: BinHash = named("RespawnTimerText");
const PORTRAIT: BinHash = named("Portrait");
const PORTRAIT_ICON: BinHash = named("PortraitIcon");
const VALUE_TEXT: BinHash = named("ValueText");
const TEXT: BinHash = named("Text");
const SUMMONER_NAME_TEXT: BinHash = named("SummonerNameText");
const TEXT_LINK: BinHash = named("TextLink");
const KEYSTONE_ICON: BinHash = named("KeystoneIcon");
const KEYSTONE_SUBSTYLE_ICON: BinHash = named("KeystoneSubstyleIcon");
const CHARACTER_SPLASH: BinHash = named("CharacterSplash");
const BORDER_DISABLED: BinHash = named("BorderDisabled");
const OVERLAY_DISABLED: BinHash = named("OverlayDisabled");
const OVERLAY_CCED: BinHash = named("OverlayCced");
const OVERLAY_OOM: BinHash = named("OverlayOom");
const AMMO_FX: BinHash = named("AmmoFx");
const TOGGLE_FX: BinHash = named("ToggleFx");
const RESET_FLASH: BinHash = named("ResetFlashFxAttention");
const RADIAL_EFFECT: BinHash = named("RadialEffect");
const COOLDOWN_COMPLETE: BinHash = named("CooldownCompleteEffect");
const COOLDOWN_JUMP: BinHash = named("CooldownJumpEffect");
const TIMER_BORDER_BG: BinHash = named("TimerBorderBg");
const TIMER_BORDER_FX: BinHash = named("TimerBorderFx");
const TIMER_BAR_BG: BinHash = named("TimerBarBg");
const TIMER_BAR_FILL: BinHash = named("TimerBarFill");
const STATUS_MESSAGE: BinHash = named("StatusMessage");
const SPELL_CAST_MESSAGE: BinHash = named("SpellCastMessage");
const FADE_BAR: BinHash = named("FadeBar");
/// The spell slot's unnamed fields naming its augment, the augment's border and the effect that
/// plays when one is acquired, none of which a game without augments shows.
const AUGMENT_FIELDS: [BinHash; 3] = [
    BinHash(674_548_591),
    BinHash(2_225_472_146),
    BinHash(2_779_358_530),
];

const CHAMPION_SPELLS: BinHash = named("ChampionSpells");
const SUMMONER_SPELLS: BinHash = named("SummonerSpells");
const PASSIVE: BinHash = named("Passive");
const SUMMONER_SPELL_1: BinHash = named("SummonerSpell1");
const SUMMONER_SPELL_2: BinHash = named("SummonerSpell2");
const PERKS: BinHash = named("Perks");
const ITEMS: [BinHash; 7] = [
    named("Item0"),
    named("Item1"),
    named("Item2"),
    named("Item3"),
    named("Item4"),
    named("Item5"),
    named("Item6"),
];

const ABILITY_KEYS: [&str; 4] = ["Q", "W", "E", "R"];
const SUMMONER_KEYS: [&str; 2] = ["D", "F"];
/// The inventory's keys by slot: the six item slots, the trinket, then recall.
const ITEM_KEYS: [&str; 8] = ["1", "2", "3", "5", "6", "7", "4", "B"];

/// Where a structure sits: the field holding it, and its index where that field is a list.
#[derive(Debug, Clone, Copy)]
struct Slot {
    field: BinHash,
    index: Option<usize>,
}

const ROOT: Slot = Slot {
    field: BinHash(0),
    index: None,
};

/// The elements the controller of class `class` with the fields `controller` fills, each once,
/// in field order.
pub(super) fn bindings(controller: &Fields, class: BinHash) -> Vec<UiBinding> {
    let mut found = Vec::new();
    walk(controller, class, ROOT, &mut found);

    let mut seen = HashSet::new();
    found.retain(|binding| seen.insert(binding.element.clone()));
    found
}

fn walk(fields: &Fields, class: BinHash, slot: Slot, found: &mut Vec<UiBinding>) {
    for (&field, value) in fields {
        if let Some(element) = object(Some(value)) {
            if let Some(role) = role_of(class, field, slot) {
                found.push(UiBinding {
                    element: hex(element),
                    role,
                });
            }
            continue;
        }

        if let Some((inner, nested)) = struct_of(Some(value)) {
            walk(nested, inner, Slot { field, index: None }, found);
            continue;
        }

        for (index, item) in items(Some(value)).iter().enumerate() {
            if let Some((inner, nested)) = struct_of(Some(item)) {
                let at = Slot {
                    field,
                    index: Some(index),
                };
                walk(nested, inner, at, found);
            }
        }

        for (_, item) in entries(Some(value)) {
            if let Some((inner, nested)) = struct_of(Some(item)) {
                walk(nested, inner, Slot { field, index: None }, found);
            }
        }
    }
}

/// What the element the field `field` of a `class` structure at `slot` names is filled with.
fn role_of(class: BinHash, field: BinHash, slot: Slot) -> Option<UiRole> {
    let role = match (class, field) {
        (SPELL_SLOT_DETAILED | SPELL_SLOT_SIMPLE, CONTENT_ELEMENT) => spell(slot)?,
        (SPELL_SLOT_DETAILED, HOTKEY) => hotkey(spell_key(slot)?),
        (SPELL_SLOT_DETAILED, COST) => UiRole::Cost,
        (ITEM_SLOT_DETAILED | ITEM_SLOT_SIMPLE, ICON) => UiRole::Item {
            slot: item_slot(slot)?,
        },
        (ITEM_SLOT_DETAILED, HOTKEY_TEXT) => hotkey(ITEM_KEYS.get(usize::from(item_slot(slot)?))?),
        (PLAYER_PORTRAIT, ICON) | (UI_PLAYER_PORTRAIT, PORTRAIT_ICON) => UiRole::Portrait,
        (PLAYER_PORTRAIT | UNIT_LEVEL, LEVEL_TEXT) => UiRole::Level,
        (HEALTH_METER, VALUE_TEXT) => UiRole::Health,
        (RESOURCE_BAR, VALUE_TEXT) => UiRole::Resource,
        (KDA, TEXT) => UiRole::Kda,
        (CREEP_SCORE, TEXT) => UiRole::CreepScore,
        (VISION_SCORE, TEXT) => UiRole::VisionScore,
        (SUMMONER_NAME, SUMMONER_NAME_TEXT) => UiRole::PlayerName,
        (SHOP_BUTTON, TEXT_LINK) => UiRole::Gold,
        (KEYSTONE, KEYSTONE_ICON) => UiRole::Keystone,
        (KEYSTONE, KEYSTONE_SUBSTYLE_ICON) => UiRole::Substyle,
        (CARD, CHARACTER_SPLASH) => UiRole::Splash,
        (CARD_SPELL, ICON) => card_spell(slot)?,
        (BUFF, ICON) => UiRole::Buff,
        (
            SPELL_SLOT_DETAILED,
            BORDER_DISABLED | OVERLAY_DISABLED | OVERLAY_CCED | OVERLAY_OOM | AMMO_FX | TOGGLE_FX
            | RESET_FLASH,
        )
        | (COOLDOWN_EFFECT, RADIAL_EFFECT | COOLDOWN_COMPLETE | COOLDOWN_JUMP)
        | (BUFF_TIMER, TIMER_BORDER_BG | TIMER_BORDER_FX | TIMER_BAR_BG | TIMER_BAR_FILL)
        | (HEALTH_METER, FADE_BAR)
        | (_, STATUS_MESSAGE | SPELL_CAST_MESSAGE) => UiRole::Hidden,
        (SPELL_SLOT_DETAILED, field) if AUGMENT_FIELDS.contains(&field) => UiRole::Hidden,
        (SPELL_SLOT_DETAILED, AMMO_TEXT)
        | (COOLDOWN_EFFECT, COOLDOWN_TEXT)
        | (ITEM_SLOT_DETAILED | ITEM_SLOT_SIMPLE, STACK_TEXT)
        | (PLAYER_PORTRAIT, RESPAWN_TIMER)
        | (UI_PLAYER_PORTRAIT, RESPAWN_TIMER_TEXT)
        | (BOUNTY, TEXT)
        | (BUFF, STACKS_TEXT) => UiRole::Idle,
        /* A controller naming its portrait element outright, as the target frame does. */
        (_, PORTRAIT) => UiRole::Portrait,
        _ => return None,
    };
    Some(role)
}

fn hotkey(key: &str) -> UiRole {
    UiRole::Hotkey {
        key: key.to_owned(),
    }
}

/// The spell a spell slot at `slot` shows.
fn spell(slot: Slot) -> Option<UiRole> {
    let index = slot.index.and_then(|index| u8::try_from(index).ok());
    match slot.field {
        CHAMPION_SPELLS => index
            .filter(|&index| usize::from(index) < ABILITY_KEYS.len())
            .map(|slot| UiRole::Ability { slot }),
        SUMMONER_SPELLS => index
            .filter(|&index| usize::from(index) < SUMMONER_KEYS.len())
            .map(|slot| UiRole::Summoner { slot }),
        PASSIVE => Some(UiRole::Passive),
        SUMMONER_SPELL_1 => Some(UiRole::Summoner { slot: 0 }),
        SUMMONER_SPELL_2 => Some(UiRole::Summoner { slot: 1 }),
        _ => None,
    }
}

/// The key that casts the spell of a spell slot at `slot`, none for the passive.
fn spell_key(slot: Slot) -> Option<&'static str> {
    match slot.field {
        CHAMPION_SPELLS => ABILITY_KEYS.get(slot.index?).copied(),
        SUMMONER_SPELLS => SUMMONER_KEYS.get(slot.index?).copied(),
        _ => None,
    }
}

/// The inventory slot of an item slot at `slot`: its index in a list, or its `ItemN` field.
fn item_slot(slot: Slot) -> Option<u8> {
    let index = match slot.index {
        Some(index) => index,
        None => ITEMS.iter().position(|&item| item == slot.field)?,
    };
    u8::try_from(index).ok()
}

/// What a loading card's spell entry at `slot` shows: a summoner spell, or a rune.
fn card_spell(slot: Slot) -> Option<UiRole> {
    match (slot.field, slot.index?) {
        (SUMMONER_SPELLS, index) if index < SUMMONER_KEYS.len() => Some(UiRole::Summoner {
            slot: u8::try_from(index).ok()?,
        }),
        (PERKS, 0) => Some(UiRole::Keystone),
        (PERKS, 1) => Some(UiRole::Substyle),
        _ => None,
    }
}

#[cfg(test)]
mod tests;
