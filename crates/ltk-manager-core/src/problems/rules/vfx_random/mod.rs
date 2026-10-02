//! `vfx/per-frame-random` and `vfx/broken-random` - probability tables the
//! game re-rolls every frame, or cannot read.
//!
//! An animated value's `dynamics` holds `probabilityTables`, one table per
//! channel, which a particle's birth reads at one roll.
//!
//! - The per-frame evaluate passes no roll, so a table on a per-frame value
//!   draws afresh every frame and every channel. That is attested for
//!   `Color` and `scale0`, so the rule names those two alone.
//! - A null slot after a held first slot is dereferenced unchecked, and two
//!   lists of different lengths read as 0.
//!
//! Neither offers a repair, because which value the author meant is not in the
//! file.

use crate::hashing::named;
use ltk_hash::BinHash;
use ltk_meta::walk::{Leaf, Node, TrailSegment, TreeNode as _, TreeValue, Visit};

use crate::problems::names::BinNames;
use crate::problems::walk::{Address, Declared};
use crate::problems::{
    Applied, BinVisitor, Detail, FixError, FixRun, NodeAddress, Pass, Problem, ProblemSeverity,
    PropertyRead, PropertyWalk, Rule, RuleId, RuleMeta, Sink, Walk,
};

/// The id every row of the per-frame rule carries.
pub const PER_FRAME_ID: RuleId = RuleId("vfx/per-frame-random");

/// The id every row of the broken-set rule carries.
pub const BROKEN_ID: RuleId = RuleId("vfx/broken-random");

/// `probabilityTables`, the list of one table per channel under a value's `dynamics`.
const PROBABILITY_TABLES: BinHash = named("probabilityTables");

/// `keyTimes`, a table's chances.
const KEY_TIMES: BinHash = named("keyTimes");

/// `keyValues`, a table's factors.
const KEY_VALUES: BinHash = named("keyValues");

/// `dynamics`, the pointer from a value to its curve and its tables.
const DYNAMICS: BinHash = named("dynamics");

/// `VfxEmitterDefinitionData`, the class whose per-frame fields these are.
const EMITTER: BinHash = named("VfxEmitterDefinitionData");

/// `Color` and `scale0`, the per-frame fields a table is attested to re-roll on.
const REROLLED: [BinHash; 2] = [BinHash(0x3d7e_6258), BinHash(0xd4e1_7a53)];

/// Reports a probability table on a value the game reads every frame.
#[derive(Debug, Default)]
pub struct VfxPerFrameRandom;

impl VfxPerFrameRandom {
    #[must_use]
    pub fn new() -> Self {
        Self
    }
}

/// The rule as the catalogue lists it.
const PER_FRAME_META: RuleMeta = RuleMeta {
    id: PER_FRAME_ID,
    title: "Per-frame random table",
    description: "A probability table on a value the game reads every frame, so its particles flicker",
    unfixable: "Couldn't move the table because the birth value it was meant for isn't in the file",
    severity: Some(ProblemSeverity::Warning),
};

impl Rule for VfxPerFrameRandom {
    fn meta(&self) -> &RuleMeta {
        &PER_FRAME_META
    }

    fn subscribe(&self, pass: &mut Pass<'_>) {
        let names = pass.project().names();
        pass.bins().visit(Tables {
            fault: Fault::PerFrame,
            names,
        });
    }

    fn fix(&self, problems: &[&Problem], run: &mut FixRun<'_>) -> Result<Applied, FixError> {
        Ok(run.skip_all(problems))
    }
}

/// Reports a probability table set the game crashes on or reads as 0.
#[derive(Debug, Default)]
pub struct VfxBrokenRandom;

impl VfxBrokenRandom {
    #[must_use]
    pub fn new() -> Self {
        Self
    }
}

/// The rule as the catalogue lists it.
const BROKEN_META: RuleMeta = RuleMeta {
    id: BROKEN_ID,
    title: "Unreadable random table set",
    description: "A probability table set the game can't read, which crashes it or zeroes the value",
    unfixable: "Couldn't complete the set because the tables the author meant aren't in the file",
    severity: Some(ProblemSeverity::Error),
};

impl Rule for VfxBrokenRandom {
    fn meta(&self) -> &RuleMeta {
        &BROKEN_META
    }

    fn subscribe(&self, pass: &mut Pass<'_>) {
        let names = pass.project().names();
        pass.bins().visit(Tables {
            fault: Fault::Broken,
            names,
        });
    }

    fn fix(&self, problems: &[&Problem], run: &mut FixRun<'_>) -> Result<Applied, FixError> {
        Ok(run.skip_all(problems))
    }
}

/// Which of the two rules a walk reads for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Fault {
    PerFrame,
    Broken,
}

/// One rule's read of every bin.
struct Tables<'p> {
    fault: Fault,
    names: &'p BinNames,
}

impl BinVisitor for Tables<'_> {
    fn begin<'r, 'f: 'r>(&'r self, sink: Sink<'f>) -> Box<dyn Walk<'f> + 'r> {
        Box::new(PropertyWalk::new(
            Reading {
                fault: self.fault,
                names: self.names,
            },
            sink,
        ))
    }
}

/// One bin's read, reporting each table list its rule objects to.
struct Reading<'n> {
    fault: Fault,
    names: &'n BinNames,
}

impl PropertyRead for Reading<'_> {
    /// Read a table list and prune it, since nothing under one holds another.
    fn property<'a, V: Declared<'a>>(
        &mut self,
        field: BinHash,
        value: V,
        node: &Node<'_, 'a, V>,
        sink: &mut Sink<'_>,
    ) -> Result<Visit, ltk_meta::Error> {
        if field != PROBABILITY_TABLES {
            return Ok(Visit::Continue);
        }
        let set = TableSet::read(value)?;
        let finding = match self.fault {
            Fault::PerFrame => {
                (set.random && rerolled(node)).then_some((ProblemSeverity::Warning, None))
            }
            Fault::Broken => set
                .fault()
                .map(|message| (ProblemSeverity::Error, Some(message))),
        };
        if let Some((severity, message)) = finding {
            let address = Address::of(node.trail(), field, node.class_hash(), self.names);
            sink.problem(
                severity,
                Some(NodeAddress {
                    entry: node.object_hash(),
                    label: address.label(),
                    path: address.into_hashes(),
                }),
                Detail {
                    mismatch: None,
                    message,
                    fix: None,
                },
            );
        }
        Ok(Visit::Skip)
    }
}

/// The `dynamics` node sits under `Color` or `scale0` of an emitter.
fn rerolled<'a, V: TreeValue<'a>>(dynamics: &Node<'_, 'a, V>) -> bool {
    let trail = dynamics.trail();
    let [.., TrailSegment::Field(value), TrailSegment::Field(pointer)] = trail.segments() else {
        return false;
    };
    let [.., owner, _] = trail.classes() else {
        return false;
    };
    *pointer == DYNAMICS && *owner == EMITTER && REROLLED.contains(value)
}

/// One `probabilityTables` list, as far as the two rules ask of it.
#[derive(Debug, Default)]
struct TableSet {
    /// Slots the list holds, a null one included.
    slots: usize,
    /// The first slot holds a table, which is what makes the game read the rest unchecked.
    first_held: bool,
    /// Null slots.
    missing: usize,
    /// Tables whose two lists disagree in length.
    mismatched: usize,
    /// Some table's factor varies with the roll.
    random: bool,
}

impl TableSet {
    /// # Errors
    ///
    /// Over a view, a header that does not decode. The owned tree never fails.
    fn read<'a, V: Declared<'a>>(list: V) -> Result<Self, ltk_meta::Error> {
        let mut set = Self::default();
        for child in list.children()? {
            let (_, slot) = child?;
            set.slots += 1;
            let Some(table) = slot.as_node()? else {
                set.missing += 1;
                continue;
            };
            if set.slots == 1 {
                set.first_held = true;
            }
            let times = table.get(KEY_TIMES)?;
            let factors = table.get(KEY_VALUES)?;
            let counted = |list: Option<V>| -> Result<usize, ltk_meta::Error> {
                Ok(list
                    .map(|each| each.item_count())
                    .transpose()?
                    .flatten()
                    .unwrap_or(0))
            };
            let chances = counted(times)?;
            if chances > 0 && chances != counted(factors)? {
                set.mismatched += 1;
            } else if let Some(factors) = factors {
                set.random |= varies(factors)?;
            }
        }
        Ok(set)
    }

    /// What is wrong with the set, as the finding says it, or `None` for one the game reads.
    fn fault(&self) -> Option<String> {
        let mut said = Vec::new();
        if self.first_held && self.missing > 0 {
            said.push(format!(
                "The set holds {} tables for {} channels. The game reads every channel's table without checking, so it crashes on this one.",
                self.slots - self.missing,
                self.slots
            ));
        }
        if self.mismatched > 0 {
            said.push(format!(
                "{} of its tables list a different number of chances and factors. The game reads such a table as 0, so the value is zeroed.",
                self.mismatched
            ));
        }
        (!said.is_empty()).then(|| said.join(" "))
    }
}

/// A factor list holds two different factors, so what it draws depends on the roll.
fn varies<'a, V: TreeValue<'a>>(factors: V) -> Result<bool, ltk_meta::Error> {
    let mut first = None;
    for child in factors.children()? {
        let (_, factor) = child?;
        let Some(Leaf::F32(level)) = factor.as_leaf()? else {
            continue;
        };
        match first {
            None => first = Some(level.to_bits()),
            Some(held) if held != level.to_bits() => return Ok(true),
            Some(_) => {}
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests;
