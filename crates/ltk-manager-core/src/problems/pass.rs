//! The pass: one traversal of a project's files for every rule.
//!
//! A rule declares what it reads in [`Rule::subscribe`] and opens nothing
//! itself. The pass then makes two rounds under one budget - every bin, then
//! every file a subscription named - reads each file once at the widest shape
//! anyone asked for, parses and walks each bin once with every subscribed
//! visitor riding the one walk, and hands each rule its part at finish.
//!
//! The design is `docs/design/problems-pass.md`. Where this module's shape
//! differs from the spec's sketches, the spec's own rules table has the reason
//! beside the section, and the doc on the item here says what changed.
//!
//! [`Rule::subscribe`]: super::Rule::subscribe

mod fan;
mod plan;
mod source;

use std::marker::PhantomData;
use std::sync::Arc;

use ltk_hash::BinHash;
use ltk_meta::PropertyValueEnum;
use ltk_meta::walk::RawValue;
use ltk_meta::walk::{Node, Visit, Visitor};
use parking_lot::Mutex;

use crate::workshop::WorkshopFileKind;

use super::budget::BIN_EXPANSION;
use super::game::GameContent;
use super::walk::Declared;
use super::{
    Detail, FileHandle, NodeAddress, ProblemSeverity, ProjectFiles, Report, Rule, RuleId, Site,
};

use plan::{BinSub, Demands, Facts, FileSub, Lists, Objects, Plan, Reading, Shape, Subject};

/// A subscription's results as the round fills them: each with the index of
/// the file it came from.
type Store<R> = Arc<Mutex<Vec<(usize, R)>>>;

/// A rule's finish, run once after both rounds.
type FinishBody<'p> = Box<dyn for<'x> FnOnce(&mut Finish<'x>) + Send + 'p>;

/// Run `rules` over `project`: both rounds, then every finish, in rule order.
///
/// The report is in file order and unsorted, which is what a test reads. The
/// engine sorts it into a `Run`.
pub(super) fn run(project: &ProjectFiles, rules: &[&dyn Rule]) -> Report {
    let mut plan = Plan::new(project);
    for rule in rules {
        let mut pass = Pass::for_rule(project, rule.id());
        rule.subscribe(&mut pass);
        plan.absorb(pass);
    }
    plan.run()
}

/// Compute one fact over `project` in a bin round carrying its collector alone.
///
/// What the fix side calls, since a repair reads the mod as it is now and
/// cannot ride the check's pass.
pub(super) fn fact<F: Fact>(project: &ProjectFiles) -> F {
    let mut plan = Plan::new(project);
    plan.demand::<F>();
    plan.fact::<F>()
}

/// What one file costs the budget while one of its subscribers reads it.
///
/// The pass reserves, for one file, the largest weight among its subscribers,
/// once.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Weight {
    /// The bytes the read shape asks for. The default for `head` and `whole`.
    Read,
    /// The whole file, for a `head` subscriber that may fall back to it.
    Whole,
    /// The file's size times `BIN_EXPANSION`. The default for bins.
    Bin,
    /// `Bin`, `times` over: a bin subscriber that parses a second bin of the
    /// same shape beside it, such as the game's copy.
    Bins(u32),
}

impl Weight {
    /// The bytes reserved for a file of `size` read at `shape`.
    fn bytes(self, size: u64, shape: Shape) -> u64 {
        match self {
            Self::Read => shape.bytes(size),
            Self::Whole => size,
            Self::Bin => size.saturating_mul(BIN_EXPANSION),
            Self::Bins(times) => size
                .saturating_mul(BIN_EXPANSION)
                .saturating_mul(u64::from(times)),
        }
    }
}

/// A subscription's per-file results, redeemable once at finish.
///
/// Consumed by [`Finish::take`], by the rule that made it, in its own finish.
/// It carries the store the round fills, so a result borrows nothing and no
/// downcast stands between a read and its rule.
#[must_use = "a collected read is only reachable through Finish::take"]
#[derive(Debug)]
pub struct Collected<R> {
    subject: Subject,
    store: Store<R>,
}

/// A fact demanded at subscribe time, redeemable at finish.
///
/// Zero-sized, and made only by [`Pass::demand`], so [`Finish::fact`] cannot
/// be asked for a fact no rule demanded.
pub struct Demanded<F>(PhantomData<fn() -> F>);

impl<F> Clone for Demanded<F> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<F> Copy for Demanded<F> {}

impl<F> std::fmt::Debug for Demanded<F> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Demanded<{}>", std::any::type_name::<F>())
    }
}

/// Whether every bin a fact asked for was read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Coverage {
    /// Whether every bin was parsed and walked to the end.
    pub complete: bool,
}

/// Data every bin contributes to, that more than one rule reads.
///
/// Computed once per run whichever rules demand it, and owned by none of
/// them: `docs/design/problems-pass.md` section 7.
pub trait Fact: Sized + Send + Sync + 'static {
    /// What rides the walk collecting it, folding once per bin under its own
    /// lock (ADR-0021).
    type Collector: BinVisitor + Default + 'static;

    /// The fact, once the bin round is over.
    fn assemble(collector: Self::Collector, coverage: Coverage) -> Self;
}

/// A rule's bin visitor. One instance per bin, made on the worker, folded at
/// the bin's end.
///
/// Boxed rather than a generic associated type: `docs/design/problems-pass.md`
/// section 5.3.
pub trait BinVisitor: Send + Sync {
    /// One instance for one bin, on the worker. The sink is the instance's for
    /// the bin.
    fn begin<'r, 'f: 'r>(&'r self, sink: Sink<'f>) -> Box<dyn Walk<'f> + 'r>;
}

/// One instance's walk over one bin, over either tree.
///
/// A rule writes one generic implementation,
/// `impl<'a, V: TreeValue<'a>> Visitor<'a, V> for Check<'_>`, which meets both
/// bounds and never names `RawValue` or `PropertyValueEnum` (ADR-0020).
pub trait Walk<'f>:
    for<'a> Visitor<'a, RawValue<'a>, Error = ltk_meta::Error>
    + for<'a> Visitor<'a, &'a PropertyValueEnum, Error = ltk_meta::Error>
{
    /// After the bin: the sink back, and anything the rule keeps across bins
    /// folded into the rule.
    fn end(self: Box<Self>) -> Sink<'f>;
}

/// What a shallow subscriber reads off one top-level object, over either tree.
pub trait ObjectRead: Send + Sync {
    /// What one bin keeps for finish.
    type Kept: Default + Send;

    /// Called once per top-level object of a bin, in file order, with its
    /// root node. `object.inner()` is the node's properties, undecoded until
    /// read.
    ///
    /// # Errors
    ///
    /// Over a view, a header that does not decode. That is the file's fault,
    /// so it ends the walk of the bin and the pass reports it under every
    /// subscriber at the file's site.
    fn object<'a, V: Declared<'a>>(
        &self,
        object: &Node<'_, 'a, V>,
        kept: &mut Self::Kept,
    ) -> Result<(), ltk_meta::Error>;

    /// After the bin's last object, on the worker, under the subscription's
    /// weight. The default keeps what the objects left.
    ///
    /// The one place a bin subscriber may read a second bin beside the one it
    /// was handed, under a declared [`Weight::Bins`] (D31).
    ///
    /// # Errors
    ///
    /// A failure of this rule at the file's site, in the pass's report. The
    /// bin is then absent from [`Finish::take`].
    fn end(&self, handle: FileHandle<'_>, kept: Self::Kept) -> Result<Self::Kept, String> {
        let _ = handle;
        Ok(kept)
    }
}

/// What a subscriber reads off each property of one bin, over either tree.
pub trait PropertyRead {
    /// Called for each property the walk enters, with where it sits and the bin's sink.
    ///
    /// # Errors
    ///
    /// Over a view, a value that does not decode, which ends the walk of the bin.
    fn property<'a, V: Declared<'a>>(
        &mut self,
        field: BinHash,
        value: V,
        node: &Node<'_, 'a, V>,
        sink: &mut Sink<'_>,
    ) -> Result<Visit, ltk_meta::Error>;
}

/// One bin's walk that hands each property to a [`PropertyRead`], and the sink back at the end.
pub struct PropertyWalk<'f, R> {
    read: R,
    sink: Sink<'f>,
}

impl<'f, R> PropertyWalk<'f, R> {
    /// A walk reading through `read` and reporting into `sink`.
    pub fn new(read: R, sink: Sink<'f>) -> Self {
        Self { read, sink }
    }
}

impl<'a, V: Declared<'a>, R: PropertyRead> Visitor<'a, V> for PropertyWalk<'_, R> {
    type Error = ltk_meta::Error;

    fn enter_property(
        &mut self,
        field: BinHash,
        value: V,
        node: &Node<'_, 'a, V>,
    ) -> Result<Visit, ltk_meta::Error> {
        self.read.property(field, value, node, &mut self.sink)
    }
}

impl<'f, R: PropertyRead> Walk<'f> for PropertyWalk<'f, R> {
    fn end(self: Box<Self>) -> Sink<'f> {
        self.sink
    }
}

/// Where a subscriber reports during a round: one rule, one file.
///
/// Scoped to one rule and one file, so a report names neither. Filled on the
/// worker and merged into the report in file order once the round is over.
#[derive(Debug)]
pub struct Sink<'s> {
    handle: FileHandle<'s>,
    /// The file's position in its round's work list.
    index: usize,
    reports: Reports,
}

/// What one sink holds, apart from the file it is for.
#[derive(Debug, Default)]
pub(super) struct Reports {
    problems: Vec<(ProblemSeverity, Option<NodeAddress>, Detail)>,
    failures: Vec<String>,
}

impl<'s> Sink<'s> {
    fn new(handle: FileHandle<'s>, index: usize) -> Self {
        Self {
            handle,
            index,
            reports: Reports::default(),
        }
    }

    /// The file this sink reports on.
    #[must_use]
    pub fn handle(&self) -> FileHandle<'s> {
        self.handle
    }

    /// The file's position in the round, for a fold that must land in file
    /// order whatever order the workers finished in.
    #[must_use]
    pub fn index(&self) -> usize {
        self.index
    }

    /// One finding at a node of this file, or at the file when `node` is `None`.
    pub fn problem(
        &mut self,
        severity: ProblemSeverity,
        node: Option<NodeAddress>,
        detail: Detail,
    ) {
        self.reports.problems.push((severity, node, detail));
    }

    /// This rule could not finish this file.
    pub fn failure(&mut self, message: impl Into<String>) {
        self.reports.failures.push(message.into());
    }

    fn into_reports(self) -> Reports {
        self.reports
    }
}

/// The bytes a file-round subscription asked for, with the file they came from.
#[derive(Debug, Clone, Copy)]
pub struct Head<'f> {
    handle: FileHandle<'f>,
    bytes: &'f [u8],
}

impl<'f> Head<'f> {
    /// The file the bytes came from.
    #[must_use]
    pub fn handle(&self) -> FileHandle<'f> {
        self.handle
    }

    /// The bytes read: the prefix asked for, or the whole file under `whole`.
    #[must_use]
    pub fn bytes(&self) -> &'f [u8] {
        self.bytes
    }
}

/// What one rule asks the pass for.
///
/// Handed to one rule at a time and already knows which rule it is serving,
/// so no subscription names a `RuleId`. Every method that registers a read
/// returns the token the rule needs to get the result back.
pub struct Pass<'p> {
    project: &'p ProjectFiles,
    rule: RuleId,
    files: Vec<FileSub<'p>>,
    bins: Vec<BinSub<'p>>,
    facts: Demands,
    finishes: Vec<FinishBody<'p>>,
}

impl std::fmt::Debug for Pass<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Pass")
            .field("rule", &self.rule)
            .field("files", &self.files.len())
            .field("bins", &self.bins.len())
            .field("facts", &self.facts.len())
            .field("finishes", &self.finishes.len())
            .finish()
    }
}

impl<'p> Pass<'p> {
    fn for_rule(project: &'p ProjectFiles, rule: RuleId) -> Self {
        Self {
            project,
            rule,
            files: Vec::new(),
            bins: Vec::new(),
            facts: Demands::default(),
            finishes: Vec::new(),
        }
    }

    /// The project this pass reads, for a rule deciding what to subscribe to.
    #[must_use]
    pub fn project(&self) -> &'p ProjectFiles {
        self.project
    }

    /// The game's index, when the run was given one.
    ///
    /// `None` on a machine with no game content. A rule that needs it says
    /// so from [`Rule::dormant`], not here.
    ///
    /// [`Rule::dormant`]: super::Rule::dormant
    #[must_use]
    pub fn game(&self) -> Option<&'p dyn GameContent> {
        self.project.game()
    }

    /// Every file of `kind`, in the file round.
    #[must_use]
    pub fn files(&mut self, kind: WorkshopFileKind) -> Files<'_, 'p> {
        Files { pass: self, kind }
    }

    /// Every bin of every layer, override bins included, in the bin round.
    #[must_use]
    pub fn bins(&mut self) -> Bins<'_, 'p> {
        Bins {
            pass: self,
            weight: Weight::Bin,
        }
    }

    /// A fact computed once in the bin round, whichever rules demand it.
    #[must_use]
    pub fn demand<F: Fact>(&mut self) -> Demanded<F> {
        self.facts.demand::<F>();
        Demanded(PhantomData)
    }

    /// What this rule does with what the pass collected for it.
    ///
    /// Runs after both rounds, in rule order, on the calling thread. A rule
    /// whose findings come straight out of a visitor needs none.
    pub fn finish(&mut self, finish: impl for<'x> FnOnce(&mut Finish<'x>) + Send + 'p) {
        self.finishes.push(Box::new(finish));
    }
}

/// The files of one kind, before the read shape is chosen.
#[derive(Debug)]
pub struct Files<'a, 'p> {
    pass: &'a mut Pass<'p>,
    kind: WorkshopFileKind,
}

impl<'a, 'p> Files<'a, 'p> {
    /// The first `bytes` of each file. A shorter file answers with what it has.
    #[must_use]
    pub fn head(self, bytes: usize) -> FileRead<'a, 'p> {
        FileRead {
            pass: self.pass,
            kind: self.kind,
            shape: Shape::Head(bytes),
            weight: Weight::Read,
            select: None,
        }
    }

    /// Each file, whole.
    #[must_use]
    pub fn whole(self) -> FileRead<'a, 'p> {
        FileRead {
            pass: self.pass,
            kind: self.kind,
            shape: Shape::Whole,
            weight: Weight::Read,
            select: None,
        }
    }
}

/// A file-round subscription being built.
pub struct FileRead<'a, 'p> {
    pass: &'a mut Pass<'p>,
    kind: WorkshopFileKind,
    shape: Shape,
    weight: Weight,
    select: Option<plan::Selection<'p>>,
}

impl std::fmt::Debug for FileRead<'_, '_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FileRead")
            .field("kind", &self.kind)
            .field("shape", &self.shape)
            .field("weight", &self.weight)
            .field("selected", &self.select.is_some())
            .finish()
    }
}

impl<'p> FileRead<'_, 'p> {
    /// What one file costs the budget while it is read.
    ///
    /// Defaults to the bytes the shape reads. A subscriber that may read
    /// further on its own says so here: a subscription declares the largest
    /// read it may make, never the smallest (D4).
    #[must_use]
    pub fn weighing(mut self, weight: Weight) -> Self {
        self.weight = weight;
        self
    }

    /// Only the files `select` answers yes to, judged against `F` once the
    /// bin round is over.
    ///
    /// Runs on the calling thread, once per file of the kind, between the
    /// rounds. A file it declines is not read for this subscriber and is not
    /// a failure. When `F` is incomplete the selection is ignored and every
    /// file is read, so a bin that failed to parse never hides a file (D20).
    #[must_use]
    pub fn selected_by<F: Fact>(
        mut self,
        fact: Demanded<F>,
        select: impl Fn(&F, FileHandle<'_>) -> bool + Send + Sync + 'p,
    ) -> Self {
        let _ = fact;
        self.select = Some(plan::Selection::new(move |facts: &Facts, handle| {
            facts.complete::<F>().map(|fact| select(fact, handle))
        }));
        self
    }

    /// Read each file, keeping `R` for finish.
    ///
    /// `read` runs on a worker, once per file, with the bytes the shape asked
    /// for. An `Err` is a failure of this rule at that file, and the pass
    /// reports it: the closure never reports anything itself.
    pub fn collect<R>(
        self,
        read: impl Fn(&Head<'_>) -> Result<R, String> + Send + Sync + 'p,
    ) -> Collected<R>
    where
        R: Send + 'p,
    {
        let store = Arc::new(Mutex::new(Vec::new()));
        self.pass.files.push(FileSub {
            rule: self.pass.rule,
            kind: self.kind,
            shape: self.shape,
            weight: self.weight,
            select: self.select,
            reader: Box::new(Reading {
                read,
                store: Arc::clone(&store),
            }),
        });
        Collected {
            subject: Subject::Kind(self.kind),
            store,
        }
    }
}

/// A bin-round subscription being built.
#[derive(Debug)]
pub struct Bins<'a, 'p> {
    pass: &'a mut Pass<'p>,
    weight: Weight,
}

impl<'p> Bins<'_, 'p> {
    /// What one bin costs the budget while parsed. Defaults to [`Weight::Bin`].
    #[must_use]
    pub fn weighing(mut self, weight: Weight) -> Self {
        self.weight = weight;
        self
    }

    /// Each bin's top-level objects, one at a time, keeping what `read`
    /// collects for finish.
    ///
    /// The shallow subscription: a visitor pruned at the root. Nothing beneath
    /// an object is walked on this subscriber's behalf, so a rule that reads
    /// one map's length off one class pays for that and no more (FR-3).
    pub fn collect<O: ObjectRead + 'p>(self, read: O) -> Collected<O::Kept> {
        let store = Arc::new(Mutex::new(Vec::new()));
        self.pass.bins.push(BinSub {
            rule: self.pass.rule,
            weight: self.weight,
            visitor: Box::new(Objects {
                read,
                store: Arc::clone(&store),
            }),
        });
        Collected {
            subject: Subject::Bins,
            store,
        }
    }

    /// Every node of every bin, through the shared walk.
    pub fn visit(self, visitor: impl BinVisitor + 'p) {
        self.pass.bins.push(BinSub {
            rule: self.pass.rule,
            weight: self.weight,
            visitor: Box::new(visitor),
        });
    }
}

/// What a rule's finish reads and reports into.
pub struct Finish<'f> {
    project: &'f ProjectFiles,
    rule: RuleId,
    lists: &'f Lists<'f>,
    facts: &'f Facts,
    report: &'f mut Report,
}

impl std::fmt::Debug for Finish<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Finish").field("rule", &self.rule).finish()
    }
}

impl<'f> Finish<'f> {
    /// The project the pass read, for a rule about the project itself.
    #[must_use]
    pub fn project(&self) -> &'f ProjectFiles {
        self.project
    }

    /// The successful reads of one subscription, in file order.
    ///
    /// A file the read failed on, and a file the run was cancelled before
    /// reaching, were reported under this rule at that file's site when the
    /// round ended, once per rule however many of its subscriptions named the
    /// file. A rule never sees them and never spells the message.
    pub fn take<R>(&mut self, collected: Collected<R>) -> Vec<(FileHandle<'f>, R)> {
        let list = self.lists.of(collected.subject);
        let mut kept = std::mem::take(&mut *collected.store.lock());
        kept.sort_by_key(|(index, _)| *index);
        kept.into_iter()
            .map(|(index, result)| (list[index], result))
            .collect()
    }

    /// A fact this rule demanded.
    #[must_use]
    pub fn fact<F: Fact>(&self, demanded: Demanded<F>) -> &'f F {
        let _ = demanded;
        self.facts
            .get::<F>()
            .expect("Demanded<F> is only made by Pass::demand, which registers the collector")
    }

    /// Report one finding.
    pub fn problem(&mut self, severity: ProblemSeverity, site: Site, detail: Detail) {
        self.report.problem(self.rule, severity, site, detail);
    }

    /// Report a failure the reads did not already cover.
    pub fn failure(&mut self, site: Option<Site>, message: impl Into<String>) {
        self.report.failure(self.rule, site, message);
    }
}

#[cfg(test)]
mod tests;
