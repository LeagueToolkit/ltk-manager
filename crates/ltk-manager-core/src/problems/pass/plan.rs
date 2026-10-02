//! The engine side of the pass: the plan every rule's subscriptions fold
//! into, and the two rounds that run it.

use std::any::{Any, TypeId};
use std::collections::HashMap;
use std::time::Instant;

use ltk_meta::walk::{Node, Visit, Visitor};
use parking_lot::Mutex;

use crate::problems::budget;
use crate::problems::walk::Declared;
use crate::problems::{FileHandle, ProjectFiles, Report, RuleId, Site};
use crate::workshop::WorkshopFileKind;

use super::fan::Fan;
use super::source::BinSource;
use super::{
    BinVisitor, Coverage, Fact, Finish, FinishBody, Head, ObjectRead, Pass, Reports, Sink, Store,
    Walk, Weight,
};

/// A selection's predicate, over the facts and one file.
type Select<'p> = Box<dyn Fn(&Facts, FileHandle<'_>) -> Option<bool> + Send + Sync + 'p>;

/// The one spelling of a file the run was called off before reaching.
const CANCELLED: &str = "The check was cancelled";

/// How much of a file the file round reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Shape {
    Head(usize),
    Whole,
}

impl Shape {
    /// The bytes this shape reads of a file of `size`.
    pub(super) fn bytes(self, size: u64) -> u64 {
        match self {
            Self::Head(limit) => (limit as u64).min(size),
            Self::Whole => size,
        }
    }

    fn widest(self, other: Self) -> Self {
        match (self, other) {
            (Self::Whole, _) | (_, Self::Whole) => Self::Whole,
            (Self::Head(a), Self::Head(b)) => Self::Head(a.max(b)),
        }
    }

    /// The part of a read at a wider shape that this shape asked for.
    fn prefix(self, bytes: &[u8]) -> &[u8] {
        match self {
            Self::Head(limit) => &bytes[..limit.min(bytes.len())],
            Self::Whole => bytes,
        }
    }
}

/// Which work list a subscription's results index into.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Subject {
    Kind(WorkshopFileKind),
    Bins,
}

/// The work lists of one run, built once so a result's index names one file.
#[derive(Debug)]
pub(super) struct Lists<'p> {
    bins: Vec<FileHandle<'p>>,
    kinds: Vec<(WorkshopFileKind, Vec<FileHandle<'p>>)>,
}

impl<'p> Lists<'p> {
    fn new(project: &'p ProjectFiles, files: &[FileSub<'_>]) -> Self {
        let mut kinds: Vec<(WorkshopFileKind, Vec<FileHandle<'p>>)> = Vec::new();
        for sub in files {
            if !kinds.iter().any(|(kind, _)| *kind == sub.kind) {
                kinds.push((sub.kind, project.of_kind(sub.kind).collect()));
            }
        }
        Self {
            bins: project.bins().collect(),
            kinds,
        }
    }

    pub(super) fn of(&self, subject: Subject) -> &[FileHandle<'p>] {
        match subject {
            Subject::Bins => &self.bins,
            Subject::Kind(kind) => self
                .kinds
                .iter()
                .find(|(held, _)| *held == kind)
                .map_or(&[], |(_, files)| files.as_slice()),
        }
    }
}

/// Every fact the bin round assembled, and whether that round was complete.
pub struct Facts {
    coverage: Coverage,
    by_type: HashMap<TypeId, Box<dyn Any + Send + Sync>>,
}

impl std::fmt::Debug for Facts {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Facts")
            .field("coverage", &self.coverage)
            .field("held", &self.by_type.len())
            .finish()
    }
}

impl Facts {
    fn assemble(demands: Demands, coverage: Coverage) -> Self {
        Self {
            coverage,
            by_type: demands
                .0
                .into_iter()
                .map(|(id, demand)| (id, demand.assemble(coverage)))
                .collect(),
        }
    }

    pub(super) fn get<F: Fact>(&self) -> Option<&F> {
        self.by_type.get(&TypeId::of::<F>())?.downcast_ref()
    }

    /// `F`, where every bin contributed to it.
    pub(super) fn complete<F: Fact>(&self) -> Option<&F> {
        if self.coverage.complete {
            self.get()
        } else {
            None
        }
    }

    fn take<F: Fact>(&mut self) -> Option<F> {
        let held = self.by_type.remove(&TypeId::of::<F>())?;
        held.downcast::<F>().ok().map(|fact| *fact)
    }
}

/// A demanded fact's collector as the plan holds it: a visitor for the round,
/// and the fact after it.
pub(super) trait Demand: BinVisitor {
    fn assemble(self: Box<Self>, coverage: Coverage) -> Box<dyn Any + Send + Sync>;
}

/// The facts demanded so far, one collector each however many rules asked.
#[derive(Default)]
pub(super) struct Demands(Vec<(TypeId, Box<dyn Demand>)>);

impl Demands {
    pub(super) fn demand<F: Fact>(&mut self) {
        if !self.holds(TypeId::of::<F>()) {
            self.0
                .push((TypeId::of::<F>(), Box::new(Collecting::<F>::default())));
        }
    }

    /// Take `other`'s demands, keeping the collector already held for a fact
    /// both name.
    fn merge(&mut self, other: Self) {
        for (id, demand) in other.0 {
            if !self.holds(id) {
                self.0.push((id, demand));
            }
        }
    }

    fn holds(&self, id: TypeId) -> bool {
        self.0.iter().any(|(held, _)| *held == id)
    }

    pub(super) fn len(&self) -> usize {
        self.0.len()
    }

    fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    fn collectors(&self) -> impl Iterator<Item = &dyn Demand> {
        self.0.iter().map(|(_, demand)| demand.as_ref())
    }
}

struct Collecting<F: Fact>(F::Collector);

impl<F: Fact> Default for Collecting<F> {
    fn default() -> Self {
        Self(F::Collector::default())
    }
}

impl<F: Fact> BinVisitor for Collecting<F> {
    fn begin<'r, 'f: 'r>(&'r self, sink: Sink<'f>) -> Box<dyn Walk<'f> + 'r> {
        self.0.begin(sink)
    }
}

impl<F: Fact> Demand for Collecting<F> {
    fn assemble(self: Box<Self>, coverage: Coverage) -> Box<dyn Any + Send + Sync> {
        Box::new(F::assemble(self.0, coverage))
    }
}

/// One file-round subscription.
pub(super) struct FileSub<'p> {
    pub(super) rule: RuleId,
    pub(super) kind: WorkshopFileKind,
    pub(super) shape: Shape,
    pub(super) weight: Weight,
    pub(super) select: Option<Selection<'p>>,
    pub(super) reader: Box<dyn FileReader + 'p>,
}

/// A selection, judged on the calling thread between the rounds.
pub(super) struct Selection<'p>(Select<'p>);

impl<'p> Selection<'p> {
    pub(super) fn new(
        select: impl Fn(&Facts, FileHandle<'_>) -> Option<bool> + Send + Sync + 'p,
    ) -> Self {
        Self(Box::new(select))
    }

    /// Whether `handle` is wanted. `None` where the fact cannot say, which
    /// reads as yes.
    fn judge(&self, facts: &Facts, handle: FileHandle<'_>) -> Option<bool> {
        (self.0)(facts, handle)
    }
}

/// A file-round subscription's closure, keeping what it reads by file index.
pub(super) trait FileReader: Send + Sync {
    /// # Errors
    ///
    /// The closure's own, a failure of the rule at this file.
    fn read(&self, index: usize, head: &Head<'_>) -> Result<(), String>;
}

pub(super) struct Reading<F, R> {
    pub(super) read: F,
    pub(super) store: Store<R>,
}

impl<F, R> FileReader for Reading<F, R>
where
    F: Fn(&Head<'_>) -> Result<R, String> + Send + Sync,
    R: Send,
{
    fn read(&self, index: usize, head: &Head<'_>) -> Result<(), String> {
        let result = (self.read)(head)?;
        self.store.lock().push((index, result));
        Ok(())
    }
}

/// One bin-round subscription.
pub(super) struct BinSub<'p> {
    pub(super) rule: RuleId,
    pub(super) weight: Weight,
    pub(super) visitor: Box<dyn BinVisitor + 'p>,
}

/// The shallow subscription: a visitor pruned at the root, keeping what an
/// [`ObjectRead`] collects per bin.
pub(super) struct Objects<O: ObjectRead> {
    pub(super) read: O,
    pub(super) store: Store<O::Kept>,
}

impl<O: ObjectRead> BinVisitor for Objects<O> {
    fn begin<'r, 'f: 'r>(&'r self, sink: Sink<'f>) -> Box<dyn Walk<'f> + 'r> {
        Box::new(ObjectsWalk {
            read: &self.read,
            store: &self.store,
            kept: O::Kept::default(),
            sink,
        })
    }
}

struct ObjectsWalk<'r, 'f, O: ObjectRead> {
    read: &'r O,
    store: &'r Mutex<Vec<(usize, O::Kept)>>,
    kept: O::Kept,
    sink: Sink<'f>,
}

impl<'a, V: Declared<'a>, O: ObjectRead> Visitor<'a, V> for ObjectsWalk<'_, '_, O> {
    type Error = ltk_meta::Error;

    fn enter_node(&mut self, node: &Node<'_, 'a, V>) -> Result<Visit, ltk_meta::Error> {
        if node.is_root() {
            self.read.object(node, &mut self.kept)?;
        }
        Ok(Visit::Skip)
    }
}

impl<'f, O: ObjectRead> Walk<'f> for ObjectsWalk<'_, 'f, O> {
    fn end(self: Box<Self>) -> Sink<'f> {
        let Self {
            read,
            store,
            kept,
            mut sink,
        } = *self;
        match read.end(sink.handle(), kept) {
            Ok(kept) => store.lock().push((sink.index, kept)),
            Err(message) => sink.failure(message),
        }
        sink
    }
}

/// Every rule's subscriptions, folded into one run.
pub(super) struct Plan<'p> {
    project: &'p ProjectFiles,
    /// Every rule that subscribed, in the order the run asked them.
    rules: Vec<RuleId>,
    files: Vec<FileSub<'p>>,
    bins: Vec<BinSub<'p>>,
    facts: Demands,
    finishes: Vec<(RuleId, FinishBody<'p>)>,
}

impl<'p> Plan<'p> {
    pub(super) fn new(project: &'p ProjectFiles) -> Self {
        Self {
            project,
            rules: Vec::new(),
            files: Vec::new(),
            bins: Vec::new(),
            facts: Demands::default(),
            finishes: Vec::new(),
        }
    }

    /// Take one rule's subscriptions. A fact two rules demand is kept once.
    pub(super) fn absorb(&mut self, pass: Pass<'p>) {
        if !self.rules.contains(&pass.rule) {
            self.rules.push(pass.rule);
        }
        self.files.extend(pass.files);
        self.bins.extend(pass.bins);
        self.facts.merge(pass.facts);
        self.finishes
            .extend(pass.finishes.into_iter().map(|finish| (pass.rule, finish)));
    }

    /// Demand `F` with no rule behind it, for a fact computed on its own.
    pub(super) fn demand<F: Fact>(&mut self) {
        self.facts.demand::<F>();
    }

    /// Both rounds, then every finish in rule order.
    pub(super) fn run(self) -> Report {
        let Self {
            project,
            rules,
            files,
            bins,
            facts,
            finishes,
        } = self;
        let lists = Lists::new(project, &files);
        let mut report = Report::default();
        let mut failed = Failures::new(rules);

        let coverage = bin_round(
            project,
            &lists.bins,
            &bins,
            &facts,
            &mut report,
            &mut failed,
        );
        let facts = Facts::assemble(facts, coverage);
        file_round(project, &lists, &files, &facts, &mut failed);
        failed.drain_into(&mut report);

        for (rule, finish) in finishes {
            let mut at = Finish {
                project,
                rule,
                lists: &lists,
                facts: &facts,
                report: &mut report,
            };
            finish(&mut at);
        }
        report
    }

    /// One fact, over a bin round carrying what was demanded and nothing else.
    pub(super) fn fact<F: Fact>(self) -> F {
        let lists = Lists::new(self.project, &[]);
        let coverage = bin_round(
            self.project,
            &lists.bins,
            &self.bins,
            &self.facts,
            &mut Report::default(),
            &mut Failures::new(Vec::new()),
        );
        Facts::assemble(self.facts, coverage)
            .take::<F>()
            .expect("the fact was demanded on this plan before the round ran")
    }
}

/// What one bin's job hands back: each rule subscription's sink, in
/// subscription order, or why the bin could not be walked.
type Walked = Result<Vec<Reports>, String>;

/// One `Budget::map` over every bin, driving every subscribed visitor and
/// every demanded collector through one walk of each.
fn bin_round<'p>(
    project: &'p ProjectFiles,
    bins: &[FileHandle<'p>],
    subs: &[BinSub<'p>],
    facts: &Demands,
    report: &mut Report,
    failed: &mut Failures<'p>,
) -> Coverage {
    if subs.is_empty() && facts.is_empty() {
        return Coverage { complete: true };
    }

    let work: Vec<(usize, FileHandle<'p>)> = bins.iter().copied().enumerate().collect();
    let walked = project.budget().map(
        &work,
        budget::files_at_once(),
        |(_, handle)| {
            subs.iter()
                .map(|sub| sub.weight.bytes(handle.size_bytes(), Shape::Whole))
                .max()
                .unwrap_or_else(|| Weight::Bin.bytes(handle.size_bytes(), Shape::Whole))
        },
        |(index, handle)| walk_bin(*index, *handle, subs, facts),
    );

    let mut complete = true;
    for ((_, handle), outcome) in work.iter().zip(walked) {
        let rules = || subs.iter().map(|sub| sub.rule);
        match outcome {
            None => {
                complete = false;
                failed.each(rules(), *handle, CANCELLED);
            }
            Some(Err(message)) => {
                complete = false;
                failed.each(rules(), *handle, &message);
            }
            Some(Ok(reports)) => {
                for (sub, reports) in subs.iter().zip(reports) {
                    reports.drain_into(sub.rule, *handle, report, failed);
                }
            }
        }
    }
    Coverage { complete }
}

/// Open one bin and walk it once through every instance, on a worker.
fn walk_bin<'p>(
    index: usize,
    handle: FileHandle<'p>,
    subs: &[BinSub<'p>],
    facts: &Demands,
) -> Walked {
    let started = Instant::now();
    let mut source = BinSource::open_handle(&handle)?;

    let mut fan = Fan::new(
        subs.iter()
            .map(|sub| sub.visitor.begin(Sink::new(handle, index)))
            .chain(
                facts
                    .collectors()
                    .map(|demand| demand.begin(Sink::new(handle, index))),
            )
            .collect(),
    );
    let walked = source.walk(&mut fan);

    tracing::trace!(
        "{}/{}: {} bytes walked in {:?}",
        handle.layer(),
        handle.path(),
        handle.size_bytes(),
        started.elapsed()
    );

    // A bin the walk failed on is dropped with everything its instances saw
    // of it: what they kept would be a partial answer no rule can tell from a
    // whole one.
    walked.map_err(|e| e.to_string())?;
    Ok(fan
        .end()
        .into_iter()
        .take(subs.len())
        .map(Sink::into_reports)
        .collect())
}

/// One file of the file round, and who wants it.
struct Job<'p> {
    index: usize,
    handle: FileHandle<'p>,
    /// Positions in the kind's subscription list.
    wanting: Vec<usize>,
    shape: Shape,
}

/// One `Budget::map` per kind over every selected file, read once at the
/// widest shape among its subscribers.
fn file_round<'p>(
    project: &'p ProjectFiles,
    lists: &Lists<'p>,
    subs: &[FileSub<'p>],
    facts: &Facts,
    failed: &mut Failures<'p>,
) {
    for (kind, files) in &lists.kinds {
        let subs: Vec<&FileSub<'p>> = subs.iter().filter(|sub| sub.kind == *kind).collect();

        let selected: Vec<Option<Vec<bool>>> = subs
            .iter()
            .map(|sub| {
                sub.select.as_ref().map(|selection| {
                    files
                        .iter()
                        .map(|handle| selection.judge(facts, *handle).unwrap_or(true))
                        .collect()
                })
            })
            .collect();

        let work: Vec<Job<'p>> = files
            .iter()
            .enumerate()
            .filter_map(|(index, handle)| {
                let wanting: Vec<usize> = (0..subs.len())
                    .filter(|at| selected[*at].as_ref().is_none_or(|chosen| chosen[index]))
                    .collect();
                let shape = wanting
                    .iter()
                    .map(|at| subs[*at].shape)
                    .reduce(Shape::widest)?;
                Some(Job {
                    index,
                    handle: *handle,
                    wanting,
                    shape,
                })
            })
            .collect();

        let read = project.budget().map(
            &work,
            budget::files_at_once(),
            |job| {
                job.wanting
                    .iter()
                    .map(|at| {
                        subs[*at]
                            .weight
                            .bytes(job.handle.size_bytes(), subs[*at].shape)
                    })
                    .max()
                    .unwrap_or(0)
            },
            |job| read_file(job, &subs),
        );

        for (job, outcome) in work.iter().zip(read) {
            let rules = || job.wanting.iter().map(|at| subs[*at].rule);
            match outcome {
                None => failed.each(rules(), job.handle, CANCELLED),
                Some(Err(message)) => failed.each(rules(), job.handle, &message),
                Some(Ok(results)) => {
                    for (at, result) in job.wanting.iter().zip(results) {
                        if let Err(message) = result {
                            failed.one(subs[*at].rule, job.handle, message);
                        }
                    }
                }
            }
        }
    }
}

/// Read one file at its job's shape and hand each subscriber its prefix.
///
/// # Errors
///
/// The file could not be read, which is a failure of every subscriber. A
/// subscriber's own `Err` is in the inner result at its position.
fn read_file(job: &Job<'_>, subs: &[&FileSub<'_>]) -> Result<Vec<Result<(), String>>, String> {
    let bytes = match job.shape {
        Shape::Head(limit) => job.handle.head(limit)?,
        Shape::Whole => job.handle.bytes()?,
    };
    Ok(job
        .wanting
        .iter()
        .map(|at| {
            let sub = subs[*at];
            let head = Head {
                handle: job.handle,
                bytes: sub.shape.prefix(&bytes),
            };
            sub.reader.read(job.index, &head)
        })
        .collect())
}

impl Reports {
    /// Everything one sink reported, into `report` under `rule` at `handle`.
    fn drain_into<'p>(
        self,
        rule: RuleId,
        handle: FileHandle<'p>,
        report: &mut Report,
        failed: &mut Failures<'p>,
    ) {
        for (severity, node, detail) in self.problems {
            let site = match node {
                Some(node) => Site::node(handle.layer(), handle.path(), node),
                None => Site::file(handle.layer(), handle.path()),
            };
            report.problem(rule, severity, site, detail);
        }
        for message in self.failures {
            failed.one(rule, handle, message);
        }
    }
}

/// The failures of one run, reported once per rule in the run's rule order,
/// and in the order found within a rule: its bins, then its files.
struct Failures<'p> {
    rules: Vec<RuleId>,
    held: Vec<(RuleId, FileHandle<'p>, String)>,
}

impl<'p> Failures<'p> {
    fn new(rules: Vec<RuleId>) -> Self {
        Self {
            rules,
            held: Vec::new(),
        }
    }

    fn one(&mut self, rule: RuleId, handle: FileHandle<'p>, message: String) {
        self.held.push((rule, handle, message));
    }

    /// `message` under each of `rules`, once each however often one recurs.
    fn each(&mut self, rules: impl Iterator<Item = RuleId>, handle: FileHandle<'p>, message: &str) {
        let mut told: Vec<RuleId> = Vec::new();
        for rule in rules {
            if !told.contains(&rule) {
                told.push(rule);
                self.one(rule, handle, message.to_owned());
            }
        }
    }

    fn drain_into(mut self, report: &mut Report) {
        let rules = &self.rules;
        self.held
            .sort_by_key(|(rule, _, _)| rules.iter().position(|held| held == rule));
        for (rule, handle, message) in self.held {
            report.failure(
                rule,
                Some(Site::file(handle.layer(), handle.path())),
                message,
            );
        }
    }
}
