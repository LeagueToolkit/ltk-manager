//! `bin/resolver-key-loss` - a resolver defining far fewer keys than the
//! game's.
//!
//! A skin's `SkinCharacterDataProperties` points at a `ResourceResolver`, whose
//! `resourceMap` maps the generic name a spell script asks for onto that skin's
//! own effect. Bin objects are substituted by path hash rather than merged, so
//! a mod shipping its own skin bin replaces the game's resolver outright, and
//! every key the mod's copy does not carry is a key nothing answers.
//!
//! The shape this catches is one skin's resolver cloned into every slot: the
//! same handful of keys repeated per skin, where the game's copy holds that
//! skin's own set. One measured mod dropped 1,151 keys across 75 resolvers.
//!
//! **A miss does not crash, so this reports at `Info`.** Effect-key resolution
//! walks its tiers, and on total failure it logs the key that resolved to
//! nothing and substitutes a placeholder effect - which it then resolves
//! through the same last-resort tier. The one assert on that path is compiled
//! out of a retail build. So what a lost resource costs is the effect rather
//! than the process, and a mod that gives every skin one look drops these on
//! purpose: the rule cannot tell that apart from an accident, which is what
//! makes this worth knowing rather than something wrong.
//!
//! Two refusals keep the count honest:
//!
//! - **A raw difference is an upper bound on a defect, not a count of one.** A
//!   mod that deliberately collapses every skin onto one look drops per-skin
//!   keys on purpose and is reported all the same. That is why the finding says
//!   what the two counts are rather than naming a number of faults, and why
//!   `LOST_AT_LEAST` keeps the small edits out.
//! - **The rule offers no repair, because a repair is the wrong instrument.**
//!   The keys only exist in the installed game, and ADR-0012 puts reading them
//!   in the overlay build rather than in the mod file - recomputed every build,
//!   so nothing bakes to one patch and nothing is written to a file that keeps
//!   no copy of what it was.

use std::collections::HashMap;

use crate::hashing::named;
use ltk_hash::BinHash;
use ltk_meta::property::Kind;
use ltk_meta::walk::{Node, TreeNode as _};
use ltk_meta::{BinFile, PropertyValueEnum};

use crate::problems::engine::parse_bin;
use crate::problems::game::GameContent;
use crate::problems::walk::Declared;
use crate::problems::{
    Applied, Detail, Dormancy, FileHandle, FixError, FixRun, NodeAddress, ObjectRead, Pass,
    Problem, ProblemSeverity, ProjectFiles, Rule, RuleId, RuleMeta, Site, Weight,
};

/// The id every row of this rule carries.
pub const ID: RuleId = RuleId("bin/resolver-key-loss");

/// `ResourceResolver`, the class holding the map a spell script resolves through.
const RESOURCE_RESOLVER: BinHash = named("ResourceResolver");

/// `resourceMap` on that class, which is the map itself.
const RESOURCE_MAP: BinHash = named("resourceMap");

/// How many keys a resolver has to have lost before it is worth reporting.
///
/// A floor rather than a ratio, because the loss the class was measured at runs
/// from 19 keys to 177 and the size of the map they came out of does not
/// predict which. What the floor buys is silence over a resolver an author
/// edited by hand, which is the only shape a small difference has.
const LOST_AT_LEAST: usize = 8;

/// Reports a resolver holding far less than the one it replaces.
#[derive(Debug, Default)]
pub struct BinResolverKeyLoss;

impl BinResolverKeyLoss {
    #[must_use]
    pub fn new() -> Self {
        Self
    }
}

/// The rule as the catalogue lists it.
const META: RuleMeta = RuleMeta {
    id: ID,
    title: "Partial resource resolver",
    description: "A mod's resource resolver doesn't define all of the expected resources",
    unfixable: "Couldn't restore the resources because writing the game's copy in would tie the mod to one patch",
    severity: Some(ProblemSeverity::Info),
};

impl Rule for BinResolverKeyLoss {
    fn meta(&self) -> &RuleMeta {
        &META
    }

    /// Nothing to compare against is not the same as nothing to report.
    fn dormant(&self, project: &ProjectFiles) -> Option<Dormancy> {
        project.game().is_none().then(|| {
            Dormancy::new(
                "A League install",
                "This check reads the game's own copy of each bin the mod replaces, and there is no League install to read.",
            )
        })
    }

    fn subscribe(&self, pass: &mut Pass<'_>) {
        let Some(game) = pass.game() else {
            return;
        };
        let losses = pass
            .bins()
            /* Both copies are parsed, and the game's is a bin of the same
            shape, so the mod's size stands in for the pair. */
            .weighing(Weight::Bins(2))
            .collect(Resolvers { game });
        pass.finish(move |finish| {
            for (handle, resolved) in finish.take(losses) {
                for loss in resolved.lost {
                    let site = Site::node(
                        handle.layer(),
                        handle.path(),
                        NodeAddress {
                            entry: loss.entry,
                            path: String::new(),
                            label: None,
                        },
                    );
                    finish.problem(ProblemSeverity::Info, site, loss.detail());
                }
            }
        });
    }

    /// Records every problem as skipped.
    ///
    /// The rule derives no repair, so a caller reaches this only by naming a
    /// finding that never offered one.
    fn fix(&self, problems: &[&Problem], run: &mut FixRun<'_>) -> Result<Applied, FixError> {
        Ok(run.skip_all(problems))
    }
}

/// The mod's resolvers against the game's, one bin at a time.
struct Resolvers<'p> {
    game: &'p dyn GameContent,
}

/// What one bin's resolvers hold, and then what they lost.
#[derive(Debug, Default)]
struct Resolved {
    /// How many keys each resolver of the bin holds, in file order.
    keeps: Vec<(BinHash, usize)>,
    lost: Vec<Loss>,
}

impl ObjectRead for Resolvers<'_> {
    type Kept = Resolved;

    /// Top-level objects only, which is where a resolver lives: it is
    /// addressed by its own path hash, and one nested inside another object
    /// would have no hash for a site to name it by.
    fn object<'a, V: Declared<'a>>(
        &self,
        object: &Node<'_, 'a, V>,
        kept: &mut Resolved,
    ) -> Result<(), ltk_meta::Error> {
        if object.class_hash() != RESOURCE_RESOLVER {
            return Ok(());
        }
        let Some(map) = object.inner().get(RESOURCE_MAP)? else {
            return Ok(());
        };
        if map.kind() != Kind::Map {
            return Ok(());
        }
        if let Some(keys) = map.item_count()? {
            kept.keeps.push((object.object_hash(), keys));
        }
        Ok(())
    }

    /// The game's copy is read only where the mod's bin holds a resolver at
    /// all, so a mod shipping no skin bins never touches the install.
    ///
    /// # Errors
    ///
    /// Reports a game copy that would not read or parse.
    fn end(&self, handle: FileHandle<'_>, kept: Resolved) -> Result<Resolved, String> {
        if kept.keeps.is_empty() {
            return Ok(Resolved::default());
        }
        let Some(hash) = handle.wad_hash() else {
            return Ok(Resolved::default());
        };
        let Some(bytes) = self.game.read(hash)? else {
            return Ok(Resolved::default());
        };
        let theirs = resolvers_in(&parse_bin(&bytes)?);

        let lost = kept
            .keeps
            .into_iter()
            .filter_map(|(entry, keeps)| {
                let holds = *theirs.get(&entry)?;
                let lost = holds.checked_sub(keeps)?;
                (lost >= LOST_AT_LEAST).then_some(Loss {
                    entry,
                    keeps,
                    holds,
                })
            })
            .collect();
        Ok(Resolved {
            keeps: Vec::new(),
            lost,
        })
    }
}

/// How many keys each of the game's resolvers holds, off the owned tree.
fn resolvers_in(bin: &BinFile) -> HashMap<BinHash, usize> {
    bin.objects()
        .iter()
        .filter(|(_, object)| object.class_hash == RESOURCE_RESOLVER)
        .filter_map(|(hash, object)| Some((*hash, keys_in(object.properties.get(&RESOURCE_MAP)?)?)))
        .collect()
}

/// How many entries a `resourceMap` property holds.
fn keys_in(value: &PropertyValueEnum) -> Option<usize> {
    match value {
        PropertyValueEnum::Map(map) => Some(map.entries().len()),
        _ => None,
    }
}

/// One resolver of the mod against the game's copy of it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Loss {
    /// The resolver's own path hash, which the site names it by.
    entry: BinHash,
    /// How many keys the mod's copy holds.
    keeps: usize,
    /// How many the game's holds.
    holds: usize,
}

impl Loss {
    /// What this one finding says.
    fn detail(&self) -> Detail {
        Detail::new(format!(
            "The game's copy defines {} resources and the mod's defines {}. Anything asking for one of the {} that are gone gets a placeholder effect rather than the one it named. That is a fidelity loss rather than a crash, and a mod that gives every skin one look drops these on purpose.",
            self.holds,
            self.keeps,
            self.holds - self.keeps
        ))
    }
}

#[cfg(test)]
mod tests;
