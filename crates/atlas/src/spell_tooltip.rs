//! A spell's tooltip as the client composes it, per "The string" in
//! docs/research/ui-data-layout.md: an output of its `TooltipFormat` with each loc key's text in
//! place, each `{{ Key }}` include expanded, each list laid out, and each `@Value@` read from the
//! spell at a rank for a character at a level with no items. A spell composes the tooltip shown
//! as is, and the one shown while Shift is held.

use std::collections::HashMap;

use ltk_hash::BinHash;
use ltk_manager_core::bin_document::{
    Fields, entries, fields_of, items, leaf, string_map, struct_of, text,
};
use ltk_meta::PropertyValueEnum;
use ltk_meta::walk::Leaf;

use ltk_manager_game::spell::spell_data;

use super::fields::named;
use super::resolver::{flag, number, object};

mod display;
mod level;

pub(super) use display::StatsUi;
use display::{Calculated, NUMBER_ONLY, Scaler, Term, TermKind};
pub(super) use level::{Character, MAX_LEVEL};
use level::{DataValues, grows, level_part};

/// The ranks of a spell with no level-up list to count them: its first alone.
const NO_LIST_RANKS: u8 = 1;
/// The list a spell's ranks and the Shift tooltip's grid come from.
const LEVEL_UP: &str = "LevelUp";
/// How deep keys, includes and calculations nest before the rest reads as unresolved.
const DEPTH: usize = 8;
/// The decimals a value shows where neither its token nor its calculation sets a precision.
const DECIMALS: usize = 2;
/// The most decimals a precision asks for that a value shows.
const MAX_DECIMALS: usize = 6;
/// `cooldownTime`'s default, which a spell that leaves it out has at every rank.
const DEFAULT_COOLDOWN: f32 = 10.0;
/// `mMaxAmmo`'s default, which a spell that leaves it out has at every rank.
const DEFAULT_MAX_AMMO: f32 = -1.0;

/// The outputs a spell's tooltip shows: plain, with the hint that Shift shows more, and the
/// one Shift shows.
const TOOLTIP: &str = "Tooltip";
const HINTED: &str = "TooltipWithExtendedBehaviorHint";
const EXTENDED: &str = "TooltipExtended";
/// The key Shift reads as in the hint, for the default point-and-click controls.
const EXTENDED_KEYBIND: &str = "Tooltip_Extended_Keybind_P&C";
/// The values a spell holds by rank, beside its data values and effect amounts, which a
/// calculation of the same name does not stand in for.
const SPELL_STATS: [&str; 6] = [
    "cooldown",
    "cost",
    "basecost",
    "ammorechargetime",
    "castrange",
    "castrangedisplayoverride",
];

const CLIENT_DATA: BinHash = named("mClientData");
const TOOLTIP_DATA: BinHash = named("mTooltipData");
const FORMAT: BinHash = named("mFormat");
const LOC_KEYS: BinHash = named("mLocKeys");
const ENABLE_EXTENDED: BinHash = named("EnableExtendedTooltip");
const INPUT_KEYS: BinHash = named("mInputLocKeysWithDefaults");
const OUTPUT_STRINGS: BinHash = named("mOutputStrings");

const LISTS: BinHash = named("mLists");
const LEVEL_COUNT: BinHash = named("levelCount");
const ELEMENTS: BinHash = named("Elements");
const ELEMENT_TYPE: BinHash = named("type");
const ELEMENT_TYPE_INDEX: BinHash = named("typeIndex");
const ELEMENT_NAME: BinHash = named("nameOverride");
const ELEMENT_STYLE: BinHash = named("Style");
const ELEMENT_MULTIPLIER: BinHash = named("multiplier");
const LIST_NAMES: BinHash = named("mListNames");
const LIST_TYPE_CHOICES: BinHash = named("mListTypeChoices");
const LIST_STYLES: BinHash = named("mListStyles");
const GRID_PREFIX: BinHash = named("mListGridPrefix");
const GRID_SEPARATOR: BinHash = named("mListGridSeparator");
const GRID_POSTFIX: BinHash = named("mListGridPostfix");
/// What a list value writes where its style is unknown.
const PLAIN_LIST_STYLE: &str = "@value@";

const DATA_VALUES: BinHash = named("DataValues");
const DATA_VALUE_NAME: BinHash = named("name");
const VALUES: BinHash = named("values");
const CALCULATIONS: BinHash = named("mSpellCalculations");
const COOLDOWN: BinHash = named("cooldownTime");
const COOLDOWN_VALUES: BinHash = named("Cooldown");
const MANA: BinHash = named("mana");
const MANA_VALUES: BinHash = named("manaValues");
const AMMO_RECHARGE: BinHash = named("mAmmoRechargeTime");
const MAX_AMMO: BinHash = named("mMaxAmmo");
const CAST_RANGE: BinHash = named("castRange");
const CAST_RANGE_OVERRIDE: BinHash = named("castRangeDisplayOverride");
const EFFECT_AMOUNT: BinHash = named("mEffectAmount");
const EFFECT_VALUE: BinHash = named("value");

const CALCULATION: BinHash = named("GameCalculation");
const MODIFIED_CALCULATION: BinHash = named("GameCalculationModified");
const CONDITIONAL_CALCULATION: BinHash = named("GameCalculationConditional");
const FORMULA_PARTS: BinHash = named("mFormulaParts");
const MULTIPLIER: BinHash = named("mMultiplier");
const DISPLAY_AS_PERCENT: BinHash = named("mDisplayAsPercent");
const PRECISION: BinHash = named("mPrecision");
const SIMPLE_DISPLAY: BinHash = named("mSimpleTooltipCalculationDisplay");
const EXPANDED_DISPLAY: BinHash = named("mExpandedTooltipCalculationDisplay");
const MODIFIED: BinHash = named("mModifiedGameCalculation");
const DEFAULT_CALCULATION: BinHash = named("mDefaultGameCalculation");
const CONDITIONAL: BinHash = named("mConditionalGameCalculation");
const CALCULATION_KEY: BinHash = named("mSpellCalculationKey");

const NAMED_DATA_VALUE: BinHash = named("NamedDataValueCalculationPart");
const NUMBER: BinHash = named("NumberCalculationPart");
const EFFECT_VALUE_PART: BinHash = named("EffectValueCalculationPart");
const SUM: BinHash = named("SumOfSubPartsCalculationPart");
const PRODUCT: BinHash = named("ProductOfSubPartsCalculationPart");
const CLAMP: BinHash = named("ClampSubPartsCalculationPart");
const COOLDOWN_MULTIPLIER: BinHash = named("CooldownMultiplierCalculationPart");
/// The unnamed part that reads `DATA_VALUE_OF` from the spell `SOURCE_OBJECT`.
const SOURCE_DATA_VALUE: BinHash = BinHash(0x9e9e_2e5c);
const STAT_BY_COEFFICIENT: BinHash = named("StatByCoefficientCalculationPart");
const STAT_BY_DATA_VALUE: BinHash = named("StatByNamedDataValueCalculationPart");
const STAT_BY_SUB_PART: BinHash = named("StatBySubPartCalculationPart");
const BUFF_BY_COEFFICIENT: BinHash = named("BuffCounterByCoefficientCalculationPart");
const BUFF_BY_DATA_VALUE: BinHash = named("BuffCounterByNamedDataValueCalculationPart");
const BUFF_ELAPSED: BinHash = named("PercentageOfBuffNameElapsed");
const RESOURCE_BY_COEFFICIENT: BinHash = named("AbilityResourceByCoefficientCalculationPart");

const DATA_VALUE: BinHash = named("mDataValue");
const COEFFICIENT: BinHash = named("mCoefficient");
const STAT: BinHash = named("mStat");
const STAT_FORMULA: BinHash = named("mStatFormula");
const ABILITY_RESOURCE: BinHash = named("mAbilityResource");
const SUBPART: BinHash = named("mSubpart");
const NUMBER_VALUE: BinHash = named("mNumber");
const EFFECT_INDEX: BinHash = named("mEffectIndex");
const SUBPARTS: BinHash = named("mSubparts");
const PART_1: BinHash = named("mPart1");
const PART_2: BinHash = named("mPart2");
const FLOOR: BinHash = named("mFloor");
const CEILING: BinHash = named("mCeiling");
const SOURCE_OBJECT: BinHash = named("SourceObject");
const DATA_VALUE_OF: BinHash = named("DataValue");

/// A spell's tooltip, composed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct SpellTooltip {
    /// The spell's name, `keyName`'s text.
    pub name: String,
    /// The tooltip string, in sections.
    pub text: String,
    /// The tooltip string while Shift is held, none for a spell with no extended tooltip.
    pub extended: Option<String>,
    /// How many ranks the spell has, the top rank its values can read at.
    pub ranks: u8,
}

/// The objects a spell's tooltip reads beyond the spell: its format, and the spells and
/// objects its values name.
pub(super) trait SpellObjects {
    /// The fields of the object `entry`.
    fn object(&mut self, entry: BinHash) -> Option<Fields>;

    /// The fields of the `SpellObject` whose `mScriptName` is `script`, in any case.
    fn spell(&mut self, script: &str) -> Option<Fields>;
}

/// What a spell's tooltip reads beyond the spell itself.
pub(super) struct SpellContext<'a> {
    /// The key that casts the spell, none for a passive.
    pub hotkey: Option<&'a str>,
    /// The key that casts each of the character's abilities, by its script name.
    pub hotkeys: &'a [(String, &'a str)],
    /// The name of the resource the spell costs, `@AbilityResourceName@`.
    pub resource: Option<&'a str>,
    /// The game's text of a string key.
    pub strings: &'a dyn Fn(&str) -> Option<String>,
    /// How a calculation writes the stats it scales with.
    pub stats: &'a StatsUi,
    /// The character whose level and stats the calculations read.
    pub character: &'a Character,
    /// The rank the spell's values read at, from 1, and its top rank where it has fewer.
    pub rank: u8,
}

/// The tooltip of the `SpellObject` with the fields `spell`, none where the spell names no
/// tooltip or its format has no `Tooltip` output.
///
/// The client shows `TooltipWithExtendedBehaviorHint` and, while Shift is held,
/// `TooltipExtended`, for a spell whose `EnableExtendedTooltip` is on, and `Tooltip` alone
/// otherwise (`0x1408AB890`).
pub(super) fn spell_tooltip(
    spell: &Fields,
    objects: &mut dyn SpellObjects,
    context: &SpellContext<'_>,
) -> Option<SpellTooltip> {
    let data = spell_data(spell)?;
    let tooltip = fields_of(fields_of(data.get(&CLIENT_DATA))?.get(&TOOLTIP_DATA))?;
    let format = objects.object(object(tooltip.get(&FORMAT))?)?;
    let template = Template {
        own: string_map(tooltip.get(&LOC_KEYS)),
        defaults: string_map(format.get(&INPUT_KEYS)),
        outputs: string_map(format.get(&OUTPUT_STRINGS)),
        tooltip,
        format: &format,
        context,
    };

    let ranks = level_up_ranks(tooltip);
    let rank = usize::from(context.rank.clamp(1, ranks));
    let has_extended = flag(tooltip, ENABLE_EXTENDED).unwrap_or(true);
    let shown_template = has_extended
        .then(|| template.output(HINTED))
        .flatten()
        .or_else(|| template.output(TOOLTIP))?;
    let extended_template = has_extended.then(|| template.output(EXTENDED)).flatten();

    let mut fill = |text: &str, expanded: bool| {
        let mut values = Values {
            data,
            hotkey: context.hotkey,
            objects: &mut *objects,
            context,
            expanded,
            rank,
            top: usize::from(ranks),
        };
        filled(text, |token| values.text(token))
    };
    let text = fill(&shown_template, false);
    let extended = extended_template.map(|text| fill(&text, true));
    Some(SpellTooltip {
        name: template.key_text("keyName"),
        text,
        extended,
        ranks,
    })
}

/// How many ranks a spell has: as many as its level-up list counts, the only place the client's
/// data holds the number, and one for a spell with no such list.
fn level_up_ranks(tooltip: &Fields) -> u8 {
    entries(tooltip.get(&LISTS))
        .iter()
        .find(|(name, _)| text(Some(name)) == Some(LEVEL_UP))
        .and_then(|(_, list)| number(fields_of(Some(list))?, LEVEL_COUNT))
        .map_or(NO_LIST_RANKS, |count| (count as u8).max(1))
}

/// A spell's outputs before their values are read: the loc keys, the format and the lists.
struct Template<'a> {
    own: HashMap<String, String>,
    defaults: HashMap<String, String>,
    outputs: HashMap<String, String>,
    tooltip: &'a Fields,
    format: &'a Fields,
    context: &'a SpellContext<'a>,
}

impl Template<'_> {
    /// The text of the input key `input`: the spell's own key, else the format's default.
    fn key_text(&self, input: &str) -> String {
        [self.own.get(input), self.defaults.get(input)]
            .into_iter()
            .flatten()
            .find(|key| !key.is_empty())
            .and_then(|key| (self.context.strings)(key))
            .unwrap_or_default()
    }

    /// The output `name` with its keys, includes and lists in place, none where the format has
    /// no such output.
    fn output(&self, name: &str) -> Option<String> {
        let mut text = (self.context.strings)(self.outputs.get(name)?)?;

        /* A key's text can name another key, such as `keyTooltipExtended`'s `@keyTooltip@`. */
        for _ in 0..DEPTH {
            let before = text.clone();
            for input in self.own.keys().chain(self.defaults.keys()) {
                text = text.replace(&format!("@{input}@"), &self.key_text(input));
            }
            if text == before {
                break;
            }
        }

        let hotkey = self.context.hotkey.map(|key| format!("[{key}]"));
        text = text.replace("@keyHotkey@", hotkey.as_deref().unwrap_or_default());
        text = included(&text, self.context.strings);
        Some(self.listed(text))
    }

    /// `text` with each list the format names in place of `@list<Name>Type@` and
    /// `@list<Name>Grid@`: one line per element, its name and its value at every rank, and
    /// nothing for a list the spell leaves out.
    fn listed(&self, mut text: String) -> String {
        let mut lists = HashMap::new();
        for (name, list) in entries(self.tooltip.get(&LISTS)) {
            if let (Some(name), Some(list)) = (self::text(Some(name)), fields_of(Some(list))) {
                lists.insert(name, list);
            }
        }

        let names = items(self.format.get(&LIST_NAMES))
            .iter()
            .filter_map(|name| self::text(Some(name)));
        for name in names.chain(lists.keys().copied()) {
            let (types, grids) = lists
                .get(name)
                .map(|list| self.list_lines(list))
                .unwrap_or_default();
            text = text
                .replace(&format!("@list{name}Type@"), &types.join("<br>"))
                .replace(&format!("@list{name}Grid@"), &grids.join("<br>"));
        }
        text
    }

    /// Each element's name, and its values from rank 1 up as tokens the values fill.
    fn list_lines(&self, list: &Fields) -> (Vec<String>, Vec<String>) {
        let strings = self.context.strings;
        let format_text = |field| {
            self::text(self.format.get(&field))
                .and_then(strings)
                .unwrap_or_default()
        };
        let prefix = format_text(GRID_PREFIX);
        let separator = format_text(GRID_SEPARATOR);
        let postfix = format_text(GRID_POSTFIX);
        let choices = string_map(self.format.get(&LIST_TYPE_CHOICES));
        let styles = style_map(self.format.get(&LIST_STYLES));
        let levels = number(list, LEVEL_COUNT).map_or(0, |count| count as usize);

        let mut types = Vec::new();
        let mut grids = Vec::new();
        for element in items(list.get(&ELEMENTS)) {
            let Some(element) = fields_of(Some(element)) else {
                continue;
            };
            let kind = self::text(element.get(&ELEMENT_TYPE)).unwrap_or_default();
            let index = number(element, ELEMENT_TYPE_INDEX).map_or(0, |index| index as i64);
            let value = kind.replace("%d", &index.to_string());

            let label_key = self::text(element.get(&ELEMENT_NAME))
                .or_else(|| choices.get(kind).map(String::as_str))
                .filter(|key| !key.is_empty());
            types.push(label_key.and_then(strings).unwrap_or_else(|| value.clone()));

            let style = number(element, ELEMENT_STYLE)
                .and_then(|style| styles.get(&(style as u32)))
                .and_then(|key| strings(key))
                .unwrap_or_else(|| PLAIN_LIST_STYLE.to_owned());
            let factor = number(element, ELEMENT_MULTIPLIER)
                .filter(|factor| *factor != 1.0)
                .map(|factor| format!("*{factor}"))
                .unwrap_or_default();
            let ranks = (1..=levels)
                .map(|rank| {
                    let token = format!("@{value}{rank}{factor}@");
                    format!(
                        "@{value}{rank}Prefix@{}@{value}{rank}Postfix@",
                        style.replace("@value@", &token)
                    )
                })
                .collect::<Vec<_>>();
            grids.push(format!("{prefix}{}{postfix}", ranks.join(&separator)));
        }
        (types, grids)
    }
}

/// `text` with each `{{ Key }}` in place of the text of `Key`, nested includes too.
fn included(text: &str, strings: &dyn Fn(&str) -> Option<String>) -> String {
    let mut text = text.to_owned();
    for _ in 0..DEPTH {
        let Some(open) = text.find("{{") else {
            break;
        };
        let Some(length) = text[open..].find("}}") else {
            break;
        };

        let key = text[open + 2..open + length].trim();
        let found = strings(key).unwrap_or_default();
        text.replace_range(open..open + length + 2, &found);
    }
    text
}

/// `text` with each `@token@` in place of what `resolve` reads for it, and left as written
/// where it reads nothing.
fn filled(text: &str, mut resolve: impl FnMut(&str) -> Option<String>) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find('@') {
        out.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        let Some(close) = after.find('@') else {
            rest = &rest[open..];
            break;
        };

        let name = &after[..close];
        let token = !name.is_empty()
            && name
                .chars()
                .all(|char| char.is_ascii_alphanumeric() || "_.*-:".contains(char));
        if !token {
            out.push('@');
            rest = after;
            continue;
        }

        match resolve(name) {
            Some(value) => out.push_str(&value),
            None => {
                out.push('@');
                out.push_str(name);
                out.push('@');
            }
        }
        rest = &after[close + 1..];
    }
    out.push_str(rest);
    out
}

/// A value token, `[spell.Script:]Name[.precision][*factor]`.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Token<'a> {
    /// The script name of the spell the value is read from, none for the spell itself.
    spell: Option<&'a str>,
    name: &'a str,
    /// The decimals the value shows, none or negative for its own.
    precision: Option<i32>,
    factor: f64,
}

impl<'a> Token<'a> {
    fn parse(token: &'a str) -> Option<Self> {
        let (value, factor) = match token.split_once('*') {
            Some((value, factor)) => (value, factor.parse::<f64>().ok()?),
            None => (token, 1.0),
        };

        let (spell, value) = match value.split_once(':') {
            Some((owner, value)) => {
                let script = owner
                    .get(..6)?
                    .eq_ignore_ascii_case("spell.")
                    .then(|| &owner[6..]);
                (Some(script?), value)
            }
            None => (None, value),
        };

        let (name, precision) = match value.rsplit_once('.') {
            Some((name, digits)) => (name, Some(digits.parse::<i32>().ok()?)),
            None => (value, None),
        };
        Some(Self {
            spell,
            name,
            precision,
            factor,
        })
    }
}

/// A number a value reads as, whether it shows as a percentage, the decimals it shows, the
/// parts its calculation writes, and the mode it writes them in.
#[derive(Debug, Clone)]
struct Value {
    number: f64,
    percent: bool,
    precision: Option<usize>,
    terms: Vec<Term>,
    display: u8,
}

impl Value {
    fn plain(number: f32) -> Self {
        Self {
            number: f64::from(number),
            percent: false,
            precision: None,
            terms: Vec::new(),
            display: NUMBER_ONLY,
        }
    }
}

/// The values of one spell's data, as the tooltip shown as is or with Shift held reads them.
struct Values<'a> {
    data: &'a Fields,
    /// The key that casts the spell.
    hotkey: Option<&'a str>,
    objects: &'a mut dyn SpellObjects,
    context: &'a SpellContext<'a>,
    expanded: bool,
    /// The rank the values read at, from 1.
    rank: usize,
    /// The spell's top rank.
    top: usize,
}

impl Values<'_> {
    /// The text `@token@` reads.
    fn text(&mut self, token: &str) -> Option<String> {
        let token = Token::parse(token)?;
        let Some(script) = token.spell else {
            return self.shown(&token);
        };

        let spell = self.objects.spell(script)?;
        let hotkey = self
            .context
            .hotkeys
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case(script))
            .map(|(_, key)| *key);
        let mut other = Values {
            data: spell_data(&spell)?,
            hotkey,
            objects: &mut *self.objects,
            context: self.context,
            expanded: self.expanded,
            rank: self.rank,
            top: self.top,
        };
        other.shown(&token)
    }

    fn shown(&mut self, token: &Token<'_>) -> Option<String> {
        match token.name.to_ascii_lowercase().as_str() {
            "hotkey" => return self.hotkey.map(str::to_owned),
            "abilityresourcename" => {
                return Some(self.context.resource.unwrap_or_default().to_owned());
            }
            "extendedkeybind" => return (self.context.strings)(EXTENDED_KEYBIND),
            "spelltags" | "spellmodifierdescriptionappend" => return Some(String::new()),
            _ => {}
        }
        if let Some(tag) = rank_tag(token.name, self.rank) {
            return Some(tag.to_owned());
        }

        let value = self.value(token.name)?;
        let decimals = match token.precision {
            Some(precision) if precision >= 0 => usize::try_from(precision).ok(),
            _ => value.precision,
        };
        let mut total = shown(value.number * token.factor, decimals.unwrap_or(DECIMALS));
        if value.percent {
            total.push('%');
        }

        /* A template that scales the value writes it alone, as its parts no longer match it. */
        if token.factor != 1.0 {
            return Some(total);
        }
        Some(self.context.stats.write(&Calculated {
            total: &total,
            percent: value.percent,
            precision: value.precision,
            terms: &value.terms,
            display: value.display,
        }))
    }

    fn value(&mut self, name: &str) -> Option<Value> {
        let lower = name.to_ascii_lowercase();
        if lower == "maxammo" {
            let ammo = ranked(self.data.get(&MAX_AMMO), self.rank).unwrap_or(DEFAULT_MAX_AMMO);
            return Some(Value::plain(ammo));
        }
        if SPELL_STATS.contains(&lower.as_str()) {
            return self.stat_at(name, self.rank).map(Value::plain);
        }
        if let Some(value) = self.calculation(named(name), DEPTH) {
            return Some(value);
        }
        if let Some(value) = self.stat_at(name, self.rank) {
            return Some(Value::plain(value));
        }
        if let Some(value) = self.ranked_value(name) {
            return Some(value);
        }

        /* A spell's script sets `@f1@` and its kin as it runs, so no data holds them. */
        let script_set = lower.strip_prefix('f').is_some_and(|index| {
            !index.is_empty() && index.bytes().all(|byte| byte.is_ascii_digit())
        });
        script_set.then(|| Value::plain(0.0))
    }

    /// A value the client lists by rank, `name`, at `rank`: a spell stat, a data value or an
    /// effect amount.
    fn stat_at(&self, name: &str, rank: usize) -> Option<f32> {
        let data = self.data;
        match name.to_ascii_lowercase().as_str() {
            "cooldown" => Some(
                ranked(data.get(&COOLDOWN), rank)
                    .or_else(|| ranked(fields_of(data.get(&COOLDOWN_VALUES))?.get(&VALUES), rank))
                    .unwrap_or(DEFAULT_COOLDOWN),
            ),
            /* A cost lists rank 1 first, where every other list holds a rank 0. */
            "cost" | "basecost" => {
                let at = rank.saturating_sub(1);
                Some(
                    ranked(data.get(&MANA), at)
                        .or_else(|| ranked(fields_of(data.get(&MANA_VALUES))?.get(&VALUES), at))
                        .unwrap_or(0.0),
                )
            }
            "ammorechargetime" => Some(ranked(data.get(&AMMO_RECHARGE), rank).unwrap_or(0.0)),
            "castrange" => ranked(data.get(&CAST_RANGE), rank),
            "castrangedisplayoverride" => ranked(data.get(&CAST_RANGE_OVERRIDE), rank),
            lower => data_value(data, |own| own.eq_ignore_ascii_case(name), rank).or_else(|| {
                let index = lower
                    .strip_prefix("effect")?
                    .strip_suffix("amount")?
                    .parse::<usize>()
                    .ok()?;
                effect(data, index, rank)
            }),
        }
    }

    /// `NameN`, `Name` at rank `N`, and `NameNL`, `Name` at the next rank, the top rank's own
    /// at the top.
    fn ranked_value(&self, name: &str) -> Option<Value> {
        let (base, rank) = match name.strip_suffix("NL") {
            Some(base) => (base, (self.rank + 1).min(self.top)),
            None => split_rank(name)?,
        };
        self.stat_at(base, rank).map(Value::plain)
    }

    /// The mode the calculation with the fields `fields` writes in, as this tooltip shows it.
    fn display(&self, fields: &Fields) -> u8 {
        let field = if self.expanded {
            EXPANDED_DISPLAY
        } else {
            SIMPLE_DISPLAY
        };
        let own = number(fields, field).map(|display| display as u8);
        self.context.stats.display(own, self.expanded)
    }

    /// The calculation `mSpellCalculations` holds under `key`.
    fn calculation(&mut self, key: BinHash, depth: usize) -> Option<Value> {
        let depth = depth.checked_sub(1)?;
        let (_, found) = entries(self.data.get(&CALCULATIONS))
            .iter()
            .find(|(name, _)| matches!(leaf(Some(name)), Some(Leaf::Hash(hash)) if hash == key))?;
        let (class, fields) = struct_of(Some(found))?;

        match class {
            CALCULATION => {
                let percent = flag(fields, DISPLAY_AS_PERCENT).unwrap_or(false);
                let parts = items(fields.get(&FORMULA_PARTS));
                let multiplier = self.multiplier(fields, depth)?;
                let total =
                    self.parts(parts, depth)? * multiplier * if percent { 100.0 } else { 1.0 };
                let precision = number(fields, PRECISION)
                    .filter(|precision| *precision > 0.0)
                    .map(|precision| precision as usize);
                let terms = self.terms(parts, multiplier, depth);
                Some(Value {
                    number: total,
                    percent,
                    precision,
                    terms,
                    display: self.display(fields),
                })
            }
            MODIFIED_CALCULATION => {
                let value = self.calculation(object(fields.get(&MODIFIED))?, depth)?;
                let multiplier = self.multiplier(fields, depth)?;
                let terms = value
                    .terms
                    .into_iter()
                    .map(|term| term.scaled(multiplier))
                    .collect();
                Some(Value {
                    number: value.number * multiplier,
                    terms,
                    display: self.display(fields),
                    ..value
                })
            }
            /* A preview holds no buffs, so a condition reads as unmet where it has a default. */
            CONDITIONAL_CALCULATION => {
                let chosen = object(fields.get(&DEFAULT_CALCULATION))
                    .or_else(|| object(fields.get(&CONDITIONAL)))?;
                self.calculation(chosen, depth)
            }
            _ => None,
        }
    }

    /// Each of `parts` as its calculation writes it, times `multiplier`.
    fn terms(&mut self, parts: &[PropertyValueEnum], multiplier: f64, depth: usize) -> Vec<Term> {
        parts
            .iter()
            .filter_map(|part| {
                let (class, fields) = struct_of(Some(part))?;
                self.term(class, fields, depth)
            })
            .map(|term| term.scaled(multiplier))
            .collect()
    }

    /// One part as its calculation writes it, per `0x140590B20` and its siblings: a part that
    /// scales with something by its coefficient, one that grows by level by its range, and any
    /// other by its value.
    fn term(&mut self, class: BinHash, fields: &Fields, depth: usize) -> Option<Term> {
        let stats = self.context.stats;
        let index = |field| number(fields, field).map_or(0, |value| value as u8);
        let coefficient = || f64::from(number(fields, COEFFICIENT).unwrap_or(0.0));
        let scaled = |coefficient, formula, scaler| Term {
            kind: TermKind::Coefficient {
                coefficient,
                formula,
            },
            scaler,
        };

        if object(fields.get(&CALCULATION_KEY)).is_some() {
            let value = self.part((class, fields), depth)?;
            return Some(Term {
                kind: TermKind::Value(value),
                scaler: Scaler::default(),
            });
        }

        match class {
            STAT_BY_COEFFICIENT | STAT_BY_DATA_VALUE | STAT_BY_SUB_PART => {
                let value = match class {
                    STAT_BY_COEFFICIENT => coefficient(),
                    STAT_BY_DATA_VALUE => {
                        named_data_value(self.data, object(fields.get(&DATA_VALUE))?, self.rank)?
                    }
                    _ => self.sub(fields, SUBPART, depth)?,
                };
                Some(scaled(value, index(STAT_FORMULA), stats.stat(index(STAT))))
            }
            RESOURCE_BY_COEFFICIENT => {
                let scaler = if index(ABILITY_RESOURCE) == 0 {
                    stats.mana()
                } else {
                    Scaler::default()
                };
                Some(scaled(coefficient(), index(STAT_FORMULA), scaler))
            }
            BUFF_BY_COEFFICIENT | BUFF_BY_DATA_VALUE => {
                let value = match class {
                    BUFF_BY_COEFFICIENT => coefficient(),
                    _ => named_data_value(self.data, object(fields.get(&DATA_VALUE))?, self.rank)?,
                };
                Some(scaled(value, 0, Scaler::read(fields)))
            }
            class if grows(class) => {
                let named_values = NamedValues(self.data, self.rank);
                let at = |level| level_part(class, fields, level, &named_values);
                Some(Term {
                    kind: TermKind::Range(at(1)?, at(MAX_LEVEL)?),
                    scaler: stats.level(),
                })
            }
            _ => Some(Term {
                kind: TermKind::Value(self.part((class, fields), depth)?),
                scaler: Scaler::default(),
            }),
        }
    }

    fn multiplier(&mut self, fields: &Fields, depth: usize) -> Option<f64> {
        match struct_of(fields.get(&MULTIPLIER)) {
            Some(part) => self.part(part, depth),
            None => Some(1.0),
        }
    }

    fn parts(&mut self, parts: &[PropertyValueEnum], depth: usize) -> Option<f64> {
        let mut total = 0.0;
        for part in parts {
            total += self.part(struct_of(Some(part))?, depth)?;
        }
        Some(total)
    }

    fn sub(&mut self, fields: &Fields, field: BinHash, depth: usize) -> Option<f64> {
        self.part(struct_of(fields.get(&field))?, depth)
    }

    /// One formula part for the context's character, none for a kind the preview does not read.
    fn part(&mut self, (class, fields): (BinHash, &Fields), depth: usize) -> Option<f64> {
        let depth = depth.checked_sub(1)?;
        let data = self.data;
        let character = self.context.character;
        let or_zero = |field| f64::from(number(fields, field).unwrap_or(0.0));
        let stat = || {
            let index = |field| number(fields, field).map_or(0, |value| value as u8);
            character.stat(index(STAT), index(STAT_FORMULA))
        };

        if let Some(key) = object(fields.get(&CALCULATION_KEY)) {
            return Some(self.calculation(key, depth)?.number);
        }
        let rank = self.rank;
        let named_values = NamedValues(data, rank);
        if let Some(value) = level_part(class, fields, character.level(), &named_values) {
            return Some(value);
        }

        match class {
            NAMED_DATA_VALUE => named_data_value(data, object(fields.get(&DATA_VALUE))?, rank),
            NUMBER => Some(or_zero(NUMBER_VALUE)),
            EFFECT_VALUE_PART => {
                let index = usize::try_from(number(fields, EFFECT_INDEX)? as i64).ok()?;
                effect(data, index, rank).map(f64::from)
            }
            SUM => self.parts(items(fields.get(&SUBPARTS)), depth),
            PRODUCT => Some(self.sub(fields, PART_1, depth)? * self.sub(fields, PART_2, depth)?),
            CLAMP => {
                let mut total = self.parts(items(fields.get(&SUBPARTS)), depth)?;
                if let Some(floor) = number(fields, FLOOR) {
                    total = total.max(f64::from(floor));
                }
                if let Some(ceiling) = number(fields, CEILING) {
                    total = total.min(f64::from(ceiling));
                }
                Some(total)
            }
            COOLDOWN_MULTIPLIER => Some(1.0),
            SOURCE_DATA_VALUE => {
                let source = self.objects.object(object(fields.get(&SOURCE_OBJECT))?)?;
                named_data_value(
                    spell_data(&source)?,
                    object(fields.get(&DATA_VALUE_OF))?,
                    rank,
                )
            }
            STAT_BY_COEFFICIENT => Some(or_zero(COEFFICIENT) * stat()),
            STAT_BY_DATA_VALUE => {
                Some(named_data_value(data, object(fields.get(&DATA_VALUE))?, rank)? * stat())
            }
            STAT_BY_SUB_PART => Some(self.sub(fields, SUBPART, depth)? * stat()),
            RESOURCE_BY_COEFFICIENT => Some(or_zero(COEFFICIENT) * character.resource()),
            /* A preview holds no buffs. */
            BUFF_BY_COEFFICIENT | BUFF_BY_DATA_VALUE | BUFF_ELAPSED => Some(0.0),
            _ => None,
        }
    }
}

/// A spell's data values at a rank, as a level part names them.
struct NamedValues<'a>(&'a Fields, usize);

impl DataValues for NamedValues<'_> {
    fn named(&self, fields: &Fields, field: BinHash) -> f64 {
        object(fields.get(&field))
            .and_then(|hash| named_data_value(self.0, hash, self.1))
            .unwrap_or(0.0)
    }
}

/// The tag `NameNPrefix` or `NameNPostfix` reads: rank `N` opened or closed as `current`, the
/// rank the tooltip reads at, or as another.
fn rank_tag(name: &str, current: usize) -> Option<&'static str> {
    let (base, closing) = match (name.strip_suffix("Prefix"), name.strip_suffix("Postfix")) {
        (Some(base), _) => (base, false),
        (_, Some(base)) => (base, true),
        _ => return None,
    };
    let (_, rank) = split_rank(base)?;
    Some(match (rank == current, closing) {
        (true, false) => "<activeRank>",
        (true, true) => "</activeRank>",
        (false, false) => "<inactiveRank>",
        (false, true) => "</inactiveRank>",
    })
}

/// `NameN` as `Name` and the rank `N`.
fn split_rank(name: &str) -> Option<(&str, usize)> {
    let base = name.trim_end_matches(|char: char| char.is_ascii_digit());
    if base.is_empty() || base.len() == name.len() {
        return None;
    }
    Some((base, name[base.len()..].parse().ok()?))
}

/// The value at `rank` of the data value of `data` whose name `matches`.
fn data_value(data: &Fields, matches: impl Fn(&str) -> bool, rank: usize) -> Option<f32> {
    items(data.get(&DATA_VALUES)).iter().find_map(|item| {
        let fields = fields_of(Some(item))?;
        matches(text(fields.get(&DATA_VALUE_NAME))?)
            .then(|| ranked(fields.get(&VALUES), rank))
            .flatten()
    })
}

/// The value at `rank` of the data value of `data` whose name hashes to `hash`. A part reads one
/// the spell does not hold as 0, as a mode that adds it to the spell does elsewhere.
fn named_data_value(data: &Fields, hash: BinHash, rank: usize) -> Option<f64> {
    Some(data_value(data, |own| named(own) == hash, rank).map_or(0.0, f64::from))
}

/// `mEffectAmount`'s list `index`, counting from 1, at `rank`.
fn effect(data: &Fields, index: usize, rank: usize) -> Option<f32> {
    let effect = items(data.get(&EFFECT_AMOUNT)).get(index.checked_sub(1)?)?;
    ranked(fields_of(Some(effect))?.get(&EFFECT_VALUE), rank)
}

/// The `rank`th value of a list of numbers, its last where the list is shorter.
fn ranked(value: Option<&PropertyValueEnum>, rank: usize) -> Option<f32> {
    let values: Vec<f32> = items(value)
        .iter()
        .filter_map(|item| match leaf(Some(item))? {
            Leaf::F32(value) if value.is_finite() => Some(value),
            Leaf::I32(value) => Some(value as f32),
            _ => None,
        })
        .collect();
    values.get(rank).or(values.last()).copied()
}

/// A number as a tooltip shows it: at most `decimals` decimals, with none trailing.
fn shown(number: f64, decimals: usize) -> String {
    let fixed = format!("{number:.*}", decimals.min(MAX_DECIMALS));
    let trimmed = if fixed.contains('.') {
        fixed.trim_end_matches('0').trim_end_matches('.')
    } else {
        &fixed
    };
    match trimmed {
        "-0" => "0".to_owned(),
        other => other.to_owned(),
    }
}

/// `mListStyles`' entries, a style's string key by its number.
fn style_map(value: Option<&PropertyValueEnum>) -> HashMap<u32, String> {
    entries(value)
        .iter()
        .filter_map(|(key, value)| match leaf(Some(key))? {
            Leaf::U32(style) => Some((style, text(Some(value))?.to_owned())),
            _ => None,
        })
        .collect()
}

#[cfg(test)]
mod tests;
