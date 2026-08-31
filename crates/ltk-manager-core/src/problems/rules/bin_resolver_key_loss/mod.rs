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
//! **The finding does not claim a crash.** Resolution walks its tiers and, on
//! total failure, logs and substitutes a placeholder effect, so what a lost key
//! costs is the effect rather than the process.
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

use ltk_hash::BinHash;
use ltk_meta::{Bin, PropertyValueEnum};

use crate::problems::budget;
use crate::problems::game::GameContent;
use crate::problems::{
    Applied, Detail, Dormancy, FileHandle, FixError, FixRun, NodeAddress, Problem, ProjectFiles,
    Report, Rule, RuleId, Severity, Site,
};

/// The id every row of this rule carries.
pub const ID: RuleId = RuleId("bin/resolver-key-loss");

/// `ResourceResolver`, the class holding the map a spell script resolves through.
const RESOURCE_RESOLVER: BinHash = BinHash(0xef3a_0f33);

/// `resourceMap` on that class, which is the map itself.
const RESOURCE_MAP: BinHash = BinHash(0xd2f5_8721);

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

impl Rule for BinResolverKeyLoss {
    fn id(&self) -> RuleId {
        ID
    }

    fn title(&self) -> &'static str {
        "Resolver holding far less than the game's"
    }

    fn description(&self) -> &'static str {
        "A resource resolver defining far fewer keys than the game's own copy of the same object. A spell asking for one of the missing keys gets a placeholder effect instead of the one it named"
    }

    fn unfixable_description(&self) -> &'static str {
        "The missing keys are defined in your installed game rather than in the mod, so there is nothing in the mod's own files to correct"
    }

    /// Nothing to compare against is not the same as nothing to report.
    fn dormant(&self, project: &ProjectFiles) -> Option<Dormancy> {
        project.game().is_none().then(|| {
            Dormancy::new(
                "A League install",
                "This check reads the game's own copy of each bin the mod replaces, and there is no League install configured to read.",
            )
        })
    }

    fn check(&self, project: &ProjectFiles, report: &mut Report) {
        let Some(game) = project.game() else {
            return;
        };

        let handles: Vec<_> = project
            .bins()
            .filter(|handle| handle.wad_hash().is_some())
            .collect();
        let read = project.budget().map(
            &handles,
            budget::files_at_once(),
            /* Both copies are parsed, and the game's is a bin of the same
            shape, so the mod's size stands in for the pair. */
            |handle| {
                handle
                    .size_bytes()
                    .saturating_mul(2 * budget::BIN_EXPANSION)
            },
            |handle| losses_in(handle, game),
        );

        for (handle, found) in handles.iter().zip(read) {
            let site = |entry| {
                Site::node(
                    handle.layer(),
                    handle.path(),
                    NodeAddress {
                        entry,
                        path: String::new(),
                        label: None,
                    },
                )
            };
            match found {
                Some(Ok(losses)) => {
                    for loss in losses {
                        report.problem(ID, Severity::Warning, site(loss.entry), loss.detail());
                    }
                }
                Some(Err(e)) => {
                    report.failure(ID, Some(Site::file(handle.layer(), handle.path())), e);
                }
                /* Cancelled before this bin was reached. Saying nothing about
                it is what keeps a partial run from reading as a clean one. */
                None => report.failure(
                    ID,
                    Some(Site::file(handle.layer(), handle.path())),
                    "The check was cancelled",
                ),
            }
        }
    }

    /// Records every problem as skipped.
    ///
    /// The rule derives no repair, so a caller reaches this only by naming a
    /// finding that never offered one.
    fn fix(&self, problems: &[&Problem], run: &mut FixRun<'_>) -> Result<Applied, FixError> {
        for problem in problems {
            run.skipped(&problem.site.layer, &problem.site.path, 1);
        }
        Ok(Applied {
            applied: 0,
            skipped: problems.len() as u32,
        })
    }
}

/// Every resolver of one bin that holds far less than the game's copy.
///
/// The game's copy is read only where the mod's bin holds a resolver at all,
/// so a mod shipping no skin bins never touches the install.
///
/// # Errors
///
/// Reports a bin of the mod, or the game's copy of it, that would not parse.
fn losses_in(handle: &FileHandle<'_>, game: &dyn GameContent) -> Result<Vec<Loss>, String> {
    let mine = handle.bin()?;
    let ours = resolvers_in(&mine);
    if ours.is_empty() {
        return Ok(Vec::new());
    }

    let Some(hash) = handle.wad_hash() else {
        return Ok(Vec::new());
    };
    let Some(bytes) = game.read(hash)? else {
        return Ok(Vec::new());
    };
    let theirs = resolvers_in(&parsed(&bytes)?);

    Ok(ours
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
        .collect())
}

/// Parse the game's own copy of a bin.
fn parsed(bytes: &[u8]) -> Result<Bin, String> {
    Bin::from_reader(&mut std::io::Cursor::new(bytes)).map_err(|e| e.to_string())
}

/// How many keys each of a bin's resolvers holds.
///
/// Top-level objects only, which is where a resolver lives: it is addressed by
/// its own path hash, and one nested inside another object would have no hash
/// for a site to name it by.
fn resolvers_in(bin: &Bin) -> std::collections::HashMap<BinHash, usize> {
    bin.objects
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
            "The game's copy of this resolver maps {} keys and the mod's maps {}. Anything asking for one of the {} that are gone gets a placeholder effect rather than the one it named. That is a fidelity loss rather than a crash, and a mod that deliberately gives every skin one look drops these keys on purpose.",
            self.holds,
            self.keeps,
            self.holds - self.keeps
        ))
    }
}

#[cfg(test)]
mod tests;
