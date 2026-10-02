//! How a calculation writes, by its display mode, per "How a calculation writes" in
//! docs/research/ui-data-layout.md.

use std::collections::HashMap;

use ltk_hash::BinHash;
use ltk_manager_core::bin_document::{Fields, entries, fields_of, leaf, text};
use ltk_meta::walk::Leaf;

use super::shown;
use crate::fields::named;
use crate::resolver::number;

/// The modes a calculation writes in: its total and its formula, its total alone, and its total
/// and the icons of the stats it scales with. Mode 2 writes the formula alone.
const TOTAL_AND_FORMULA: u8 = 4;
pub(crate) const NUMBER_ONLY: u8 = 5;
const TOTAL_AND_ICONS: u8 = 6;
/// The mode a calculation names to defer to `GlobalStatsUIData`.
const UNSET: u8 = 8;

/// The decimals a formula part shows at most.
const PART_DECIMALS: usize = 3;
/// The decimals a level range shows where its calculation sets no precision.
const RANGE_DECIMALS: usize = 2;

const STAT_FORMULA_BASE: u8 = 1;
const STAT_FORMULA_BONUS: u8 = 2;

const STAT_UI_DATA: BinHash = named("mStatUIData");
const ICON_KEY: BinHash = named("mIconKey");
const SCALING_TAG_KEY: BinHash = named("mScalingTagKey");
const MANA_ICON_KEY: BinHash = named("mManaIconKey");
const MANA_SCALING_TAG_KEY: BinHash = named("mManaScalingTagKey");
const LEVEL_ICON_KEY: BinHash = named("CharLevelIconKey");
const LEVEL_SCALING_TAG_KEY: BinHash = named("mCharLevelScalingTagKey");
const TOTAL_AND_ICONS_STYLE: BinHash = named("NumberStyleTotalAndScalingIcons");
const TOTAL_AND_FORMULA_STYLE: BinHash = named("NumberStyleTotalAndFormula");
const PART_STYLES: [BinHash; 4] = [
    named("FormulaPartStyle"),
    named("FormulaPartStylePercent"),
    named("FormulaPartStyleBonus"),
    named("FormulaPartStyleBonusPercent"),
];
const RANGE_STYLES: [BinHash; 4] = [
    named("FormulaPartRangeStyle"),
    named("FormulaPartRangeStylePercent"),
    named("FormulaPartRangeStyleBonus"),
    named("FormulaPartRangeStyleBonusPercent"),
];
const BASE_MODIFIER: BinHash = named("BaseOutputIconModifier");
const BONUS_MODIFIER: BinHash = named("BonusOutputIconModifier");
const SIMPLE_DISPLAY: BinHash = named("mTooltipCalculationExpansion");
const EXPANDED_DISPLAY: BinHash = named("mExpandedTooltipCalculationExpansion");

/// How a calculation writes, from the client's `GlobalStatsUIData`, with each style key's text.
#[derive(Debug, Clone, Default)]
pub(crate) struct StatsUi {
    stats: HashMap<u8, Scaler>,
    mana: Scaler,
    level: Scaler,
    total_and_icons: String,
    total_and_formula: String,
    /// A formula part's style: first or later, as a number or a percentage, by `style_index`.
    part_styles: [String; 4],
    range_styles: [String; 4],
    base_modifier: String,
    bonus_modifier: String,
    simple: Option<u8>,
    expanded: Option<u8>,
}

/// The icon and the tag a part that scales with something writes with.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct Scaler {
    icon: String,
    tag: String,
}

/// One formula part as its calculation writes it.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Term {
    pub(crate) kind: TermKind,
    pub(crate) scaler: Scaler,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum TermKind {
    /// A part written as its value, a percentage where its calculation shows one.
    Value(f64),
    /// A part that scales with a stat, a resource or a buff, written as its coefficient in
    /// percent, with `mStatFormula` saying whether it reads the base or the bonus.
    Coefficient { coefficient: f64, formula: u8 },
    /// A part that grows by level, written from level 1 to the top level.
    Range(f64, f64),
}

/// A calculation's total and the parts it writes beside it.
#[derive(Debug, Clone)]
pub(crate) struct Calculated<'a> {
    /// The total, already written.
    pub(crate) total: &'a str,
    pub(crate) percent: bool,
    pub(crate) precision: Option<usize>,
    pub(crate) terms: &'a [Term],
    pub(crate) display: u8,
}

impl StatsUi {
    /// The stats UI data of the `GlobalStatsUIData` with the fields `fields`.
    pub(crate) fn read(fields: &Fields, strings: &dyn Fn(&str) -> Option<String>) -> Self {
        let style = |field| {
            text(fields.get(&field))
                .and_then(strings)
                .unwrap_or_default()
        };
        let display = |field| number(fields, field).map(|display| display as u8);

        let mut stats = HashMap::new();
        for (key, value) in entries(fields.get(&STAT_UI_DATA)) {
            let Some(Leaf::U8(stat)) = leaf(Some(key)) else {
                continue;
            };
            let Some(stat_ui) = fields_of(Some(value)) else {
                continue;
            };
            stats.insert(stat, Scaler::read(stat_ui));
        }

        Self {
            stats,
            mana: Scaler::of(fields, MANA_ICON_KEY, MANA_SCALING_TAG_KEY),
            level: Scaler::of(fields, LEVEL_ICON_KEY, LEVEL_SCALING_TAG_KEY),
            total_and_icons: style(TOTAL_AND_ICONS_STYLE),
            total_and_formula: style(TOTAL_AND_FORMULA_STYLE),
            part_styles: PART_STYLES.map(style),
            range_styles: RANGE_STYLES.map(style),
            base_modifier: style(BASE_MODIFIER),
            bonus_modifier: style(BONUS_MODIFIER),
            simple: display(SIMPLE_DISPLAY),
            expanded: display(EXPANDED_DISPLAY),
        }
    }

    /// The mode a calculation writes in: its own, else the default for the view it is in.
    pub(crate) fn display(&self, own: Option<u8>, expanded: bool) -> u8 {
        let fallback = if expanded { self.expanded } else { self.simple };
        own.filter(|&mode| mode != UNSET)
            .or(fallback)
            .unwrap_or(NUMBER_ONLY)
    }

    /// How a part that scales with `stat` writes.
    pub(crate) fn stat(&self, stat: u8) -> Scaler {
        self.stats.get(&stat).cloned().unwrap_or_default()
    }

    /// How a part that scales with the character's resource writes.
    pub(crate) fn mana(&self) -> Scaler {
        self.mana.clone()
    }

    /// How a part that grows by level writes.
    pub(crate) fn level(&self) -> Scaler {
        self.level.clone()
    }

    /// `calculated` as its display mode writes it, the total alone where a style it needs is
    /// unknown.
    pub(crate) fn write(&self, calculated: &Calculated<'_>) -> String {
        let total = calculated.total.to_owned();
        match calculated.display {
            NUMBER_ONLY => total,
            TOTAL_AND_ICONS => {
                let icons: String = calculated
                    .terms
                    .iter()
                    .map(|term| term.scaler.icon.as_str())
                    .collect();
                if icons.is_empty() || self.total_and_icons.is_empty() {
                    return total;
                }
                self.total_and_icons
                    .replace("@Number@", &total)
                    .replace("@Icons@", &icons)
            }
            TOTAL_AND_FORMULA => {
                if self.total_and_formula.is_empty() {
                    return total;
                }
                self.total_and_formula
                    .replace("@Number@", &total)
                    .replace("@Formula@", &self.formula(calculated))
            }
            /* Modes 0, 1 and 3 write each part a little differently from mode 2, and ship on a
            handful of calculations, so they write as it does. */
            mode if mode < TOTAL_AND_FORMULA => {
                let formula = self.formula(calculated);
                if formula.is_empty() { total } else { formula }
            }
            _ => total,
        }
    }

    /// Every part of `calculated`, each in its style, `&nbsp;` between them.
    fn formula(&self, calculated: &Calculated<'_>) -> String {
        calculated
            .terms
            .iter()
            .enumerate()
            .map(|(at, term)| self.part(term, at == 0, calculated))
            .collect::<Vec<_>>()
            .join("&nbsp;")
    }

    fn part(&self, term: &Term, first: bool, calculated: &Calculated<'_>) -> String {
        let percent = calculated.percent;
        let hundred = |percent: bool| if percent { 100.0 } else { 1.0 };
        let (opening, closing) = match term.scaler.tag.as_str() {
            "" => (String::new(), String::new()),
            tag => (format!("<{tag}>"), format!("</{tag}>")),
        };

        let written = match term.kind {
            TermKind::Value(value) => self.part_styles[style_index(first, percent)]
                .replace("@Value@", &shown(value * hundred(percent), PART_DECIMALS))
                .replace("@IconModifier@", ""),
            TermKind::Coefficient {
                coefficient,
                formula,
            } => {
                let modifier = match formula {
                    STAT_FORMULA_BASE => self.base_modifier.as_str(),
                    STAT_FORMULA_BONUS => self.bonus_modifier.as_str(),
                    _ => "",
                };
                self.part_styles[style_index(first, true)]
                    .replace("@Value@", &shown(coefficient * 100.0, PART_DECIMALS))
                    .replace("@IconModifier@", modifier)
            }
            TermKind::Range(start, end) => {
                let decimals = calculated.precision.unwrap_or(RANGE_DECIMALS);
                self.range_styles[style_index(first, percent)]
                    .replace("@RangeStart@", &shown(start * hundred(percent), decimals))
                    .replace("@RangeEnd@", &shown(end * hundred(percent), decimals))
            }
        };
        written
            .replace("@Icon@", &term.scaler.icon)
            .replace("@OpeningTag@", &opening)
            .replace("@ClosingTag@", &closing)
    }
}

impl Scaler {
    /// The icon and tag of a `StatUIData`, or of a buff counter part, which name them the same.
    pub(crate) fn read(fields: &Fields) -> Self {
        Self::of(fields, ICON_KEY, SCALING_TAG_KEY)
    }

    fn of(fields: &Fields, icon: BinHash, tag: BinHash) -> Self {
        let owned = |field| text(fields.get(&field)).unwrap_or_default().to_owned();
        Self {
            icon: owned(icon),
            tag: owned(tag),
        }
    }
}

impl Term {
    /// The term with its numbers times `multiplier`, which the client applies to every part.
    pub(crate) fn scaled(self, multiplier: f64) -> Self {
        let kind = match self.kind {
            TermKind::Value(value) => TermKind::Value(value * multiplier),
            TermKind::Coefficient {
                coefficient,
                formula,
            } => TermKind::Coefficient {
                coefficient: coefficient * multiplier,
                formula,
            },
            TermKind::Range(start, end) => TermKind::Range(start * multiplier, end * multiplier),
        };
        Self { kind, ..self }
    }
}

/// A part style's place in `StatsUi`'s lists: the first part's own, else the bonus style for
/// every later one, each as a number or a percentage.
fn style_index(first: bool, percent: bool) -> usize {
    usize::from(!first) * 2 + usize::from(percent)
}
