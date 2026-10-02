//! Unit tests for the pass: one read per subscriber's shape, one walk per bin
//! with every visitor pruned on its own, failures spelled once per rule, and
//! facts shared.
//!
//! Every test drives `subscribe` through a real pass over a fixture project
//! and reads the report, never the plan.

use std::sync::Arc;

use fs_err as fs;
use indexmap::IndexMap;
use ltk_hash::{BinHash, Hash as _, WadHash};
use ltk_meta::property::{Kind, values};
use ltk_meta::walk::{Node, TreeValue, Visit, Visitor};
use ltk_meta::{Bin, BinObject, BinOverride};
use parking_lot::Mutex;

use super::*;
use crate::config::Config;
use crate::problems::bank_units::{BANK_PATH, BANK_UNIT, BankUnits};
use crate::problems::{Applied, Budget, FixError, FixRun, Problem, RuleFailure, RuleMeta, budget};

const ENTRY: BinHash = BinHash(0x0100_0001);
const OTHER_ENTRY: BinHash = BinHash(0x0100_0002);
const OUTER: BinHash = BinHash(0xc1a5_0001);
const INNER: BinHash = BinHash(0xc1a5_0002);
const LIST: BinHash = BinHash(0x0000_0010);
const LEAF: BinHash = BinHash(0x0000_0040);

/// The WAD directory every fixture file sits under, so it has a chunk hash.
const WAD: &str = "Aatrox.wad.client";

fn inner() -> values::Struct {
    values::Struct {
        class_hash: INNER,
        properties: IndexMap::from([(LEAF, values::U32::new(1).into())]),
    }
}

/// An `OUTER` object holding a list of two `INNER` nodes.
fn nested(entry: BinHash) -> BinObject {
    let list = values::Container::new(Kind::Struct, vec![inner().into(), inner().into()])
        .expect("structs are a kind a container holds");
    BinObject::builder(entry, OUTER)
        .property(LIST, list)
        .build()
}

/// A `BankUnit` object naming `paths`.
fn bank_unit(paths: &[&str]) -> BinObject {
    let paths: Vec<_> = paths
        .iter()
        .map(|path| values::String::new((*path).to_owned()))
        .collect();
    BinObject::builder(ENTRY, BANK_UNIT)
        .property(BANK_PATH, values::Container::from(paths))
        .build()
}

fn bin_bytes(objects: impl IntoIterator<Item = BinObject>) -> Vec<u8> {
    let bin = Bin::new(objects, std::iter::empty::<&str>());
    let mut out = std::io::Cursor::new(Vec::new());
    bin.to_writer(&mut out).unwrap();
    out.into_inner()
}

fn patch_bytes(object: BinObject) -> Vec<u8> {
    let mut patch = BinOverride::new();
    patch.objects.insert(object.path_hash, object);
    let mut out = std::io::Cursor::new(Vec::new());
    patch.to_writer(&mut out).unwrap();
    out.into_inner()
}

/// A project holding `files` under `content/base/<WAD>/`.
fn project(files: &[(&str, &[u8])]) -> (tempfile::TempDir, ProjectFiles) {
    project_under(files, Budget::repair())
}

fn project_under(files: &[(&str, &[u8])], budget: Budget) -> (tempfile::TempDir, ProjectFiles) {
    let tmp = tempfile::tempdir().unwrap();
    for (path, bytes) in files {
        let at = tmp
            .path()
            .join("content")
            .join("base")
            .join(WAD)
            .join(path.replace('/', std::path::MAIN_SEPARATOR_STR));
        fs::create_dir_all(at.parent().unwrap()).unwrap();
        fs::write(&at, bytes).unwrap();
    }
    let files = ProjectFiles::within(tmp.path(), &Config::default(), budget, None).unwrap();
    (tmp, files)
}

/// A rule that is nothing but its subscription.
struct Subscribing {
    meta: RuleMeta,
    subscribe: Box<dyn for<'x> Fn(&mut Pass<'x>) + Send + Sync>,
}

impl Subscribing {
    fn new(
        id: &'static str,
        subscribe: impl for<'x> Fn(&mut Pass<'x>) + Send + Sync + 'static,
    ) -> Self {
        Self {
            meta: RuleMeta {
                id: RuleId(id),
                title: "A test rule",
                description: "Reports what its subscription saw",
                unfixable: "",
                severity: Some(ProblemSeverity::Info),
            },
            subscribe: Box::new(subscribe),
        }
    }
}

impl Rule for Subscribing {
    fn meta(&self) -> &RuleMeta {
        &self.meta
    }

    fn subscribe(&self, pass: &mut Pass<'_>) {
        (self.subscribe)(pass);
    }

    fn fix(&self, _: &[&Problem], _: &mut FixRun<'_>) -> Result<Applied, FixError> {
        Ok(Applied::default())
    }
}

/// The messages `rule` reported, in report order.
fn messages(problems: &[Problem], rule: &str) -> Vec<String> {
    problems
        .iter()
        .filter(|problem| problem.rule.0 == rule)
        .map(|problem| problem.message.clone().unwrap_or_default())
        .collect()
}

/// `(rule, path)` of every failure, in report order.
fn failed_at(failed: &[RuleFailure]) -> Vec<(String, String)> {
    failed
        .iter()
        .map(|failure| {
            (
                failure.rule.to_string(),
                failure
                    .site
                    .as_ref()
                    .map(|site| site.path.clone())
                    .unwrap_or_default(),
            )
        })
        .collect()
}

fn in_wad(path: &str) -> String {
    format!("{WAD}/{path}")
}

/// A visitor recording the class of every node it enters, declining the
/// properties in `declines`, and stopping at its first node if told to.
#[derive(Clone, Default)]
struct Entering {
    seen: Arc<Mutex<Vec<BinHash>>>,
    declines: Vec<BinHash>,
    stops: bool,
}

impl Entering {
    fn seen(&self) -> Vec<BinHash> {
        self.seen.lock().clone()
    }
}

impl BinVisitor for Entering {
    fn begin<'r, 'f: 'r>(&'r self, sink: Sink<'f>) -> Box<dyn Walk<'f> + 'r> {
        Box::new(EnteringWalk {
            of: self,
            seen: Vec::new(),
            sink,
        })
    }
}

struct EnteringWalk<'r, 'f> {
    of: &'r Entering,
    seen: Vec<BinHash>,
    sink: Sink<'f>,
}

impl<'a, V: TreeValue<'a>> Visitor<'a, V> for EnteringWalk<'_, '_> {
    type Error = ltk_meta::Error;

    fn enter_node(&mut self, node: &Node<'_, 'a, V>) -> Result<Visit, ltk_meta::Error> {
        self.seen.push(node.class_hash());
        Ok(if self.of.stops {
            Visit::Stop
        } else {
            Visit::Continue
        })
    }

    fn enter_property(
        &mut self,
        field: BinHash,
        _: V,
        _: &Node<'_, 'a, V>,
    ) -> Result<Visit, ltk_meta::Error> {
        Ok(if self.of.declines.contains(&field) {
            Visit::Skip
        } else {
            Visit::Continue
        })
    }
}

impl<'f> Walk<'f> for EnteringWalk<'_, 'f> {
    fn end(self: Box<Self>) -> Sink<'f> {
        let Self { of, seen, sink } = *self;
        of.seen.lock().extend(seen);
        sink
    }
}

/// A shallow subscriber keeping the class of every root it is handed.
struct Roots;

impl ObjectRead for Roots {
    type Kept = Vec<BinHash>;

    fn object<'a, V: Declared<'a>>(
        &self,
        object: &Node<'_, 'a, V>,
        kept: &mut Vec<BinHash>,
    ) -> Result<(), ltk_meta::Error> {
        kept.push(object.class_hash());
        Ok(())
    }
}

/// A shallow subscriber whose per-bin end refuses every bin.
struct Refusing;

impl ObjectRead for Refusing {
    type Kept = ();

    fn object<'a, V: Declared<'a>>(
        &self,
        _: &Node<'_, 'a, V>,
        (): &mut (),
    ) -> Result<(), ltk_meta::Error> {
        Ok(())
    }

    fn end(&self, _: FileHandle<'_>, (): ()) -> Result<(), String> {
        Err("refused at the bin's end".to_owned())
    }
}

/// Subscribe to every bin with `visitor`, which records what it saw itself.
fn rule_over_bins(id: &'static str, visitor: Entering) -> Subscribing {
    Subscribing::new(id, move |pass| pass.bins().visit(visitor.clone()))
}

/// Subscribe to every bin's roots and, at finish, report the classes seen as
/// one message per bin.
fn rule_over_roots(id: &'static str) -> Subscribing {
    Subscribing::new(id, |pass| {
        let roots = pass.bins().collect(Roots);
        pass.finish(move |finish| {
            for (handle, classes) in finish.take(roots) {
                finish.problem(
                    ProblemSeverity::Info,
                    Site::file(handle.layer(), handle.path()),
                    Detail::new(format!("{classes:?}")),
                );
            }
        });
    })
}

/// Subscribe to the first `bytes` of every texture and report how many came
/// back for each.
fn rule_over_heads(id: &'static str, bytes: usize) -> Subscribing {
    Subscribing::new(id, move |pass| {
        let heads = pass
            .files(WorkshopFileKind::Texture)
            .head(bytes)
            .collect(|head| Ok(head.bytes().len()));
        pass.finish(move |finish| {
            for (handle, seen) in finish.take(heads) {
                finish.problem(
                    ProblemSeverity::Info,
                    Site::file(handle.layer(), handle.path()),
                    Detail::new(seen.to_string()),
                );
            }
        });
    })
}

// ---- the file round ----------------------------------------------------

#[test]
fn two_head_sizes_on_one_kind_each_see_their_own_prefix() {
    let (_tmp, files) = project(&[("a.tex", &[7u8; 32])]);
    let short = rule_over_heads("short", 4);
    let long = rule_over_heads("long", 16);
    let whole = Subscribing::new("whole", |pass| {
        let all = pass
            .files(WorkshopFileKind::Texture)
            .whole()
            .collect(|head| Ok(head.bytes().len()));
        pass.finish(move |finish| {
            for (handle, seen) in finish.take(all) {
                finish.problem(
                    ProblemSeverity::Info,
                    Site::file(handle.layer(), handle.path()),
                    Detail::new(seen.to_string()),
                );
            }
        });
    });

    let (problems, failed) = files.report(&[&short, &long, &whole]).finish();

    assert!(failed.is_empty(), "{failed:?}");
    assert_eq!(messages(&problems, "short"), ["4"]);
    assert_eq!(messages(&problems, "long"), ["16"]);
    assert_eq!(messages(&problems, "whole"), ["32"]);
}

#[test]
fn a_file_shorter_than_the_head_answers_with_what_it_has() {
    let (_tmp, files) = project(&[("a.tex", &[7u8; 3])]);
    let long = rule_over_heads("long", 16);

    let (problems, _) = files.report(&[&long]).finish();

    assert_eq!(messages(&problems, "long"), ["3"]);
}

#[test]
fn results_come_back_in_file_order() {
    let named: Vec<String> = (0..12).map(|at| format!("t{at:02}.tex")).collect();
    let files: Vec<(&str, &[u8])> = named
        .iter()
        .map(|name| (name.as_str(), &[0u8; 8][..]))
        .collect();
    let (_tmp, files) = project(&files);
    let rule = Subscribing::new("paths", |pass| {
        let heads = pass
            .files(WorkshopFileKind::Texture)
            .head(1)
            .collect(|head| Ok(head.handle().path().to_owned()));
        pass.finish(move |finish| {
            for (_, path) in finish.take(heads) {
                finish.problem(
                    ProblemSeverity::Info,
                    Site::file("base", &path),
                    Detail::new(path),
                );
            }
        });
    });

    let (problems, _) = files.report(&[&rule]).finish();

    let expected: Vec<String> = named.iter().map(|name| in_wad(name)).collect();
    assert_eq!(messages(&problems, "paths"), expected);
}

#[test]
fn a_closure_error_is_a_failure_of_that_rule_alone() {
    let (_tmp, files) = project(&[("a.tex", b"aaaa"), ("b.tex", b"bbbb")]);
    let picky = Subscribing::new("picky", |pass| {
        let heads = pass
            .files(WorkshopFileKind::Texture)
            .head(4)
            .collect(|head| match head.bytes() {
                b"bbbb" => Err("not this one".to_owned()),
                _ => Ok(()),
            });
        pass.finish(move |finish| {
            for (handle, ()) in finish.take(heads) {
                finish.problem(
                    ProblemSeverity::Info,
                    Site::file(handle.layer(), handle.path()),
                    Detail::new(handle.path()),
                );
            }
        });
    });
    let easy = rule_over_heads("easy", 4);

    let (problems, failed) = files.report(&[&picky, &easy]).finish();

    assert_eq!(failed_at(&failed), [("picky".to_owned(), in_wad("b.tex"))]);
    assert_eq!(failed[0].message, "not this one");
    assert_eq!(messages(&problems, "picky"), [in_wad("a.tex")]);
    assert_eq!(messages(&problems, "easy"), ["4", "4"]);
}

#[test]
fn a_selection_reads_only_the_files_the_fact_names() {
    let asked = "sfx/asked.bnk";
    let (_tmp, files) = project(&[
        ("sfx/asked.bnk", b"BKHD"),
        ("sfx/other.bnk", b"BKHD"),
        ("sfx/third.bnk", b"BKHD"),
        ("units.bin", &bin_bytes([bank_unit(&[asked])])),
    ]);
    let rule = Subscribing::new("asked", |pass| {
        let units = pass.demand::<BankUnits>();
        let banks = pass
            .files(WorkshopFileKind::WwiseBank)
            .head(4)
            .selected_by(units, |units: &BankUnits, handle| {
                handle.wad_hash().is_some_and(|hash| units.asks_for(hash))
            })
            .collect(|head| Ok(head.handle().path().to_owned()));
        pass.finish(move |finish| {
            for (_, path) in finish.take(banks) {
                finish.problem(
                    ProblemSeverity::Info,
                    Site::file("base", &path),
                    Detail::new(path),
                );
            }
        });
    });

    let (problems, failed) = files.report(&[&rule]).finish();

    assert!(
        failed.is_empty(),
        "a declined file is not a failure: {failed:?}"
    );
    assert_eq!(messages(&problems, "asked"), [in_wad(asked)]);
}

/// Two subscriptions on one kind, one selected to one file and one unselected:
/// each sees what it asked for.
#[test]
fn a_selection_is_per_subscription() {
    let (_tmp, files) = project(&[
        ("sfx/asked.bnk", b"BKHD"),
        ("sfx/other.bnk", b"BKHD"),
        ("units.bin", &bin_bytes([bank_unit(&["sfx/asked.bnk"])])),
    ]);
    let selecting = Subscribing::new("selecting", |pass| {
        let units = pass.demand::<BankUnits>();
        let banks = pass
            .files(WorkshopFileKind::WwiseBank)
            .head(4)
            .selected_by(units, |units: &BankUnits, handle| {
                handle.wad_hash().is_some_and(|hash| units.asks_for(hash))
            })
            .collect(|head| Ok(head.handle().path().to_owned()));
        pass.finish(move |finish| {
            for (_, path) in finish.take(banks) {
                finish.problem(
                    ProblemSeverity::Info,
                    Site::file("base", &path),
                    Detail::new(path),
                );
            }
        });
    });
    let every = Subscribing::new("every", |pass| {
        let banks = pass
            .files(WorkshopFileKind::WwiseBank)
            .head(2)
            .collect(|head| Ok(format!("{} {}", head.handle().path(), head.bytes().len())));
        pass.finish(move |finish| {
            for (_, seen) in finish.take(banks) {
                finish.problem(
                    ProblemSeverity::Info,
                    Site::file("base", "-"),
                    Detail::new(seen),
                );
            }
        });
    });

    let (problems, failed) = files.report(&[&selecting, &every]).finish();

    assert!(failed.is_empty(), "{failed:?}");
    assert_eq!(messages(&problems, "selecting"), [in_wad("sfx/asked.bnk")]);
    assert_eq!(
        messages(&problems, "every"),
        [
            format!("{} 2", in_wad("sfx/asked.bnk")),
            format!("{} 2", in_wad("sfx/other.bnk"))
        ]
    );
}

#[test]
fn a_selection_against_an_incomplete_fact_reads_every_file() {
    let (_tmp, files) = project(&[
        ("sfx/asked.bnk", b"BKHD"),
        ("sfx/other.bnk", b"BKHD"),
        ("units.bin", &bin_bytes([bank_unit(&["sfx/asked.bnk"])])),
        ("broken.bin", b"not a bin at all"),
    ]);
    let rule = Subscribing::new("asked", |pass| {
        let units = pass.demand::<BankUnits>();
        let banks = pass
            .files(WorkshopFileKind::WwiseBank)
            .head(4)
            .selected_by(units, |units: &BankUnits, handle| {
                handle.wad_hash().is_some_and(|hash| units.asks_for(hash))
            })
            .collect(|head| Ok(head.handle().path().to_owned()));
        pass.finish(move |finish| {
            for (_, path) in finish.take(banks) {
                finish.problem(
                    ProblemSeverity::Info,
                    Site::file("base", &path),
                    Detail::new(path),
                );
            }
        });
    });

    let (problems, failed) = files.report(&[&rule]).finish();

    assert!(
        failed.is_empty(),
        "a fact's bins are nobody's subscription: {failed:?}"
    );
    assert_eq!(
        messages(&problems, "asked"),
        [in_wad("sfx/asked.bnk"), in_wad("sfx/other.bnk")]
    );
}

// ---- the bin round -----------------------------------------------------

#[test]
fn pruning_is_per_visitor() {
    let (_tmp, files) = project(&[("a.bin", &bin_bytes([nested(ENTRY)]))]);
    let declining = Entering {
        declines: vec![LIST],
        ..Entering::default()
    };
    let entering = Entering::default();

    let (_, failed) = files
        .report(&[
            &rule_over_bins("declining", declining.clone()),
            &rule_over_bins("entering", entering.clone()),
        ])
        .finish();

    assert!(failed.is_empty(), "{failed:?}");
    assert_eq!(declining.seen(), [OUTER]);
    assert_eq!(entering.seen(), [OUTER, INNER, INNER]);
}

#[test]
fn a_stopped_instance_leaves_the_walk_to_the_others() {
    let (_tmp, files) = project(&[("a.bin", &bin_bytes([nested(ENTRY), nested(OTHER_ENTRY)]))]);
    let stopping = Entering {
        stops: true,
        ..Entering::default()
    };
    let entering = Entering::default();

    let (_, failed) = files
        .report(&[
            &rule_over_bins("stopping", stopping.clone()),
            &rule_over_bins("entering", entering.clone()),
        ])
        .finish();

    assert!(failed.is_empty(), "{failed:?}");
    assert_eq!(stopping.seen(), [OUTER]);
    assert_eq!(entering.seen(), [OUTER, INNER, INNER, OUTER, INNER, INNER]);
}

#[test]
fn an_objects_subscriber_sees_roots_and_a_visitor_sees_every_node() {
    let (_tmp, files) = project(&[("a.bin", &bin_bytes([nested(ENTRY)]))]);
    let entering = Entering::default();

    let (problems, failed) = files
        .report(&[
            &rule_over_roots("roots"),
            &rule_over_bins("nodes", entering.clone()),
        ])
        .finish();

    assert!(failed.is_empty(), "{failed:?}");
    assert_eq!(messages(&problems, "roots"), [format!("{:?}", [OUTER])]);
    assert_eq!(entering.seen(), [OUTER, INNER, INNER]);
}

#[test]
fn a_patch_bin_walks_the_objects_it_carries() {
    let (_tmp, files) = project(&[("a.bin", &patch_bytes(nested(ENTRY)))]);
    let entering = Entering::default();

    let (problems, failed) = files
        .report(&[
            &rule_over_roots("roots"),
            &rule_over_bins("nodes", entering.clone()),
        ])
        .finish();

    assert!(failed.is_empty(), "{failed:?}");
    assert_eq!(messages(&problems, "roots"), [format!("{:?}", [OUTER])]);
    assert_eq!(entering.seen(), [OUTER, INNER, INNER]);
}

#[test]
fn one_bad_bin_fails_once_per_subscribing_rule() {
    let (_tmp, files) = project(&[
        ("broken.bin", b"not a bin at all"),
        ("good.bin", &bin_bytes([nested(ENTRY)])),
    ]);
    let both = Subscribing::new("both", |pass| {
        pass.bins().visit(Entering::default());
        let roots = pass.bins().collect(Roots);
        pass.finish(move |finish| {
            finish.take(roots);
        });
    });
    let asking = Subscribing::new("asking", |pass| {
        let units = pass.demand::<BankUnits>();
        pass.finish(move |finish| {
            let units = finish.fact(units);
            finish.problem(
                ProblemSeverity::Info,
                Site::file("base", "units"),
                Detail::new(units.asks_for(WadHash(1)).to_string()),
            );
        });
    });

    let (problems, failed) = files
        .report(&[
            &rule_over_bins("nodes", Entering::default()),
            &rule_over_roots("roots"),
            &both,
            &asking,
        ])
        .finish();

    let broken = in_wad("broken.bin");
    assert_eq!(
        failed_at(&failed),
        [
            ("nodes".to_owned(), broken.clone()),
            ("roots".to_owned(), broken.clone()),
            ("both".to_owned(), broken),
        ]
    );
    assert_eq!(
        messages(&problems, "asking"),
        ["true"],
        "an unparseable bin leaves the fact incomplete"
    );
    assert_eq!(
        messages(&problems, "roots"),
        [format!("{:?}", [OUTER])],
        "the good bin is still read"
    );
}

#[test]
fn a_bin_the_stream_cannot_finish_fails_under_every_subscriber() {
    let whole = bin_bytes([nested(ENTRY), nested(OTHER_ENTRY)]);
    let cut = &whole[..whole.len() - 6];
    let (_tmp, files) = project(&[("cut.bin", cut)]);

    let (_, failed) = files
        .report(&[
            &rule_over_bins("nodes", Entering::default()),
            &rule_over_roots("roots"),
        ])
        .finish();

    let cut = in_wad("cut.bin");
    assert_eq!(
        failed_at(&failed),
        [("nodes".to_owned(), cut.clone()), ("roots".to_owned(), cut)]
    );
}

#[test]
fn an_objects_subscriber_refusing_a_bin_fails_at_that_file() {
    let (_tmp, files) = project(&[("a.bin", &bin_bytes([nested(ENTRY)]))]);
    let refusing = Subscribing::new("refusing", |pass| {
        let nothing = pass.bins().collect(Refusing);
        pass.finish(move |finish| {
            assert!(finish.take(nothing).is_empty(), "a refused bin is absent");
        });
    });

    let (_, failed) = files.report(&[&refusing]).finish();

    assert_eq!(
        failed_at(&failed),
        [("refusing".to_owned(), in_wad("a.bin"))]
    );
    assert_eq!(failed[0].message, "refused at the bin's end");
}

#[test]
fn a_cancelled_run_fails_every_unreached_file_under_every_subscriber() {
    let budget = Budget::of(1 << 20);
    let (_tmp, files) = project_under(
        &[
            ("a.bin", &bin_bytes([nested(ENTRY)])),
            ("b.bin", &bin_bytes([nested(ENTRY)])),
            ("t.tex", &[0u8; 16]),
        ],
        budget.clone(),
    );
    budget.cancel();
    let asking = Subscribing::new("asking", |pass| {
        let units = pass.demand::<BankUnits>();
        pass.finish(move |finish| {
            let units = finish.fact(units);
            finish.problem(
                ProblemSeverity::Info,
                Site::file("base", "units"),
                Detail::new(units.asks_for(WadHash(1)).to_string()),
            );
        });
    });

    let (problems, failed) = files
        .report(&[
            &rule_over_heads("heads", 4),
            &rule_over_bins("nodes", Entering::default()),
            &asking,
        ])
        .finish();

    assert_eq!(
        failed_at(&failed),
        [
            ("heads".to_owned(), in_wad("t.tex")),
            ("nodes".to_owned(), in_wad("a.bin")),
            ("nodes".to_owned(), in_wad("b.bin")),
        ],
        "failures follow the run's rule order, not the rounds'"
    );
    assert!(
        failed
            .iter()
            .all(|failure| failure.message == "The check was cancelled")
    );
    assert_eq!(messages(&problems, "asking"), ["true"]);
}

/// A cancel partway: the file in flight finishes, and every file not reached
/// is a failure under every subscriber.
#[test]
fn a_cancel_partway_finishes_the_file_in_flight_and_fails_the_rest() {
    let named: Vec<String> = (0..12).map(|at| format!("t{at:02}.tex")).collect();
    let files: Vec<(&str, &[u8])> = named
        .iter()
        .map(|name| (name.as_str(), &[0u8; 8][..]))
        .collect();
    let budget = Budget::of(1 << 20);
    let (_tmp, files) = project_under(&files, budget.clone());
    let cancelling = Subscribing::new("cancelling", move |pass| {
        let budget = budget.clone();
        let heads = pass
            .files(WorkshopFileKind::Texture)
            .head(4)
            .collect(move |head| {
                budget.cancel();
                Ok(head.handle().path().to_owned())
            });
        pass.finish(move |finish| {
            for (_, path) in finish.take(heads) {
                finish.problem(
                    ProblemSeverity::Info,
                    Site::file("base", &path),
                    Detail::new(path),
                );
            }
        });
    });

    let (problems, failed) = files.report(&[&cancelling]).finish();

    let finished = messages(&problems, "cancelling");
    assert!(
        !finished.is_empty(),
        "the file that cancelled still finished"
    );
    assert_eq!(finished.len() + failed.len(), named.len());
    assert!(
        failed.len() >= named.len() - budget::files_at_once(),
        "at most one file per worker was in flight: {failed:?}"
    );
    assert!(
        failed
            .iter()
            .all(|failure| failure.message == "The check was cancelled")
    );
}

// ---- facts ---------------------------------------------------------------

#[test]
fn two_rules_demanding_one_fact_read_the_same_one() {
    let asked = "sfx/asked.bnk";
    let (_tmp, files) = project(&[("units.bin", &bin_bytes([bank_unit(&[asked])]))]);
    let naming = |id: &'static str| {
        Subscribing::new(id, |pass| {
            let units = pass.demand::<BankUnits>();
            pass.finish(move |finish| {
                let units = finish.fact(units);
                let named = units.path_of(WadHash::hash_str("sfx/asked.bnk"));
                finish.problem(
                    ProblemSeverity::Info,
                    Site::file("base", "units"),
                    Detail::new(format!(
                        "{} {}",
                        named.unwrap_or("-"),
                        units.asks_for(WadHash::hash_str("sfx/other.bnk"))
                    )),
                );
            });
        })
    };

    let (problems, failed) = files.report(&[&naming("one"), &naming("two")]).finish();

    assert!(failed.is_empty(), "{failed:?}");
    assert_eq!(messages(&problems, "one"), [format!("{asked} false")]);
    assert_eq!(messages(&problems, "two"), [format!("{asked} false")]);
}

#[test]
fn a_fact_is_computed_on_its_own_for_a_repair() {
    let asked = "sfx/asked.bnk";
    let (_tmp, files) = project(&[("units.bin", &bin_bytes([bank_unit(&[asked])]))]);

    let units = files.fact::<BankUnits>();

    assert_eq!(units.path_of(WadHash::hash_str(asked)), Some(asked));
    assert!(!units.asks_for(WadHash::hash_str("sfx/other.bnk")));
}

#[test]
fn a_fact_over_no_bins_is_complete() {
    let (_tmp, files) = project(&[("t.tex", &[0u8; 16])]);

    let units = files.fact::<BankUnits>();

    assert!(!units.asks_for(WadHash(1)));
}

#[test]
fn a_rule_subscribing_to_nothing_still_finishes() {
    let (_tmp, files) = project(&[("a.bin", &bin_bytes([nested(ENTRY)]))]);
    let quiet = Subscribing::new("quiet", |pass| {
        pass.finish(|finish| {
            finish.problem(
                ProblemSeverity::Info,
                Site::file("base", "project"),
                Detail::new(finish.project().layers().len().to_string()),
            );
        });
    });

    let (problems, failed) = files.report(&[&quiet]).finish();

    assert!(failed.is_empty(), "{failed:?}");
    assert_eq!(messages(&problems, "quiet"), ["1"]);
}
