//! What is wrong with a mod project, and what a machine can repair.
//!
//! A [`Rule`] checks one thing and reports a [`Problem`] for each place it
//! objects to. A problem names a [`Site`] - a layer, a file, and where inside
//! the file - and carries a [`FixPreview`] where the rule can derive a repair.
//! One pass of every rule over one project is a [`Run`].
//!
//! The model here is generic on purpose. A rule is the only thing that knows a
//! format, so there is no shared apply step: "replace a value" means nothing
//! without the format that holds it. What the model owns is the preview and the
//! address, because those are the parts a user reads.
//!
//! A problem is a description and never a plan. It says what is wrong and what
//! a repair would look like, and it does not carry the steps of that repair.
//! The rule derives those again, from the file on disk, when a user applies
//! them - so a file changed between the run and the fix cannot be written
//! wrong, and a fix offered twice applies once.

pub mod bank_units;
pub mod budget;
pub mod build;
mod engine;
mod fix;
pub mod game;
pub mod names;
pub mod pass;
pub mod preserve;
pub mod rules;
pub mod walk;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use ltk_hash::BinHash;
use serde::{Deserialize, Serialize};

pub use budget::Budget;
pub use build::GameBuild;
pub use engine::{
    ChunkInfo, FileHandle, LayerFiles, Opened, ProjectFile, ProjectFiles, analyze, analyze_archive,
    analyze_within,
};
pub use fix::{
    FileChange, FileOutcome, FixError, FixReport, FixRun, HeldWrites, apply, apply_held,
};
pub use game::{GameContent, InstalledContent};
pub use names::BinNames;
pub use pass::{
    BinVisitor, Bins, Collected, Coverage, Demanded, Fact, FileRead, Files, Finish, Head,
    ObjectRead, Pass, PropertyRead, PropertyWalk, Sink, Walk, Weight,
};
pub use preserve::{KeptTable, Preserved, PreservedNames};

/// The stable id a user reads, such as `bin/property-type`.
///
/// The first part names what the rule reads and the second names the state it
/// objects to. It is on every row, because an id is what a user pastes into a
/// search when they want to know more.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
#[serde(transparent)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct RuleId(pub &'static str);

impl std::fmt::Display for RuleId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.0)
    }
}

/// How much a problem costs the mod.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub enum ProblemSeverity {
    /// The game crashes on this.
    Fatal,
    /// The game rejects this. The mod does not work.
    Error,
    /// The game accepts this, and something is still wrong.
    Warning,
    /// Worth knowing, and nothing is wrong.
    Info,
}

/// One node of one bin: which object, and where inside it.
///
/// This is the game's own property path, which is what a `PTCH` record carries
/// and what Riot's tools address a property with. A path begins inside an
/// object and never names it, which is why the entry hash sits beside it.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct NodeAddress {
    /// The object's path hash, which the file addresses it by.
    #[serde(with = "bin_hash_hex")]
    #[cfg_attr(feature = "ts", specta(type = String))]
    pub entry: BinHash,
    /// The property path, empty for the object itself.
    ///
    /// Every segment is a hash, which is what the file itself holds. A repair
    /// matches on this, so what the hash tables can or cannot name never
    /// changes what a fix reaches.
    pub path: String,
    /// The same path for reading, where a table named anything in it.
    ///
    /// Absent when no segment could be named, which is when it would read the
    /// same as `path`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", specta(optional))]
    pub label: Option<String>,
}

impl std::fmt::Display for NodeAddress {
    /// Written for a person the two join on a colon.
    ///
    /// An object path separates on `/` and a property path never holds one, so
    /// the colon is unambiguous.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "0x{:08x}:{}", self.entry.0, self.path)
    }
}

/// A [`BinHash`] as `0x` and eight hex digits, which is how a user reads one.
mod bin_hash_hex {
    use ltk_hash::BinHash;
    use serde::{Deserialize as _, Deserializer, Serialize as _, Serializer};

    use crate::hashing::HexBinHash;

    pub fn serialize<S: Serializer>(hash: &BinHash, ser: S) -> Result<S::Ok, S::Error> {
        HexBinHash::from(*hash).serialize(ser)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(de: D) -> Result<BinHash, D::Error> {
        HexBinHash::deserialize(de).map(HexBinHash::get)
    }
}

/// Where a problem is.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct Site {
    /// The layer, such as `base`.
    pub layer: String,
    /// The file, POSIX-style and relative to the layer root.
    pub path: String,
    /// Where inside the file. `None` for a rule that reads a file as a whole.
    pub node: Option<NodeAddress>,
}

impl Site {
    /// Name a whole file, for a rule that reads no content.
    pub fn file(layer: impl Into<String>, path: impl Into<String>) -> Self {
        Self {
            layer: layer.into(),
            path: path.into(),
            node: None,
        }
    }

    /// Name one node inside a file.
    pub fn node(layer: impl Into<String>, path: impl Into<String>, node: NodeAddress) -> Self {
        Self {
            layer: layer.into(),
            path: path.into(),
            node: Some(node),
        }
    }
}

impl std::fmt::Display for Site {
    /// Written for a person the three join in reading order.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} · {}", self.layer, self.path)?;
        match &self.node {
            Some(node) => write!(f, " · {node}"),
            None => Ok(()),
        }
    }
}

/// One finding, at one site, from one rule.
///
/// The id is derived from the rule and the site, so the same problem carries
/// the same id in two runs and a panel's selection survives a re-run.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct ProblemId(String);

impl ProblemId {
    /// Derive the id of one finding.
    ///
    /// Readable rather than hashed, because an id in a log is worth more than
    /// the bytes a hash would save over IPC.
    fn new(rule: RuleId, site: &Site) -> Self {
        let mut id = format!("{rule}@{}:{}", site.layer, site.path);
        if let Some(node) = &site.node {
            id.push('#');
            id.push_str(&node.to_string());
        }
        Self(id)
    }
}

impl std::fmt::Display for ProblemId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// A property whose declared type is not the one the game reads.
///
/// The two types stay apart rather than arriving as one sentence, because a
/// panel sets each of them in code type inside prose it writes itself.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct TypeMismatch {
    /// The type the game reads, such as `file`, in the words a bin row's tag draws.
    pub expected: String,
    /// The type the file declares, such as `string`.
    pub found: String,
}

/// What a repair would change, in the words a row draws.
///
/// The type it moves the property to is [`Problem::mismatch`] rather than a
/// field here, because a problem no rule can repair still has one to draw.
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct FixPreview {
    /// What the values alone do not say, such as `3 items`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", specta(optional))]
    pub note: Option<String>,
    /// The value now, rendered. `None` where a container draws its count instead.
    pub before: Option<String>,
    /// The value after, rendered. `None` for the same reason as `before`.
    pub after: Option<String>,
}

impl FixPreview {
    /// A preview of one value becoming another.
    pub fn value(before: impl Into<String>, after: impl Into<String>) -> Self {
        Self {
            note: None,
            before: Some(before.into()),
            after: Some(after.into()),
        }
    }

    /// A preview that draws a note where it cannot draw the values.
    ///
    /// A container of anything but strings takes this, because a count is all
    /// there is to say about values a row cannot render.
    pub fn note(note: impl Into<String>) -> Self {
        Self {
            note: Some(note.into()),
            before: None,
            after: None,
        }
    }

    /// One value out of the several a property holds, and what it leaves out.
    ///
    /// A container draws an example rather than its list, because two hundred
    /// paths is not a thing a row reads, and a count of them says nothing about
    /// what is in the file.
    pub fn sample(before: impl Into<String>, note: Option<String>) -> Self {
        Self {
            note,
            before: Some(before.into()),
            after: None,
        }
    }
}

/// What one problem says, as against where it is.
///
/// An input to [`Report::problem`], which flattens it into the [`Problem`] it
/// keys, so a rule states its wording in one place and never invents an id.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Detail {
    /// The types this problem is about, where the rule is about types.
    pub mismatch: Option<TypeMismatch>,
    /// What this one problem needs said that the rule's description does not.
    ///
    /// Absent for the ordinary case, which the rule's title and description
    /// already cover. A note repeated on every row of a run is noise, so this
    /// speaks only for the problem that is unusual in some way.
    pub message: Option<String>,
    /// What a repair would change. `None` where the rule has no repair.
    pub fix: Option<FixPreview>,
}

impl Detail {
    /// A problem that is nothing but its message.
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            mismatch: None,
            message: Some(message.into()),
            fix: None,
        }
    }
}

/// One finding, at one site, from one rule.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct Problem {
    /// Stable within a run, so the panel keys a row by it.
    pub id: ProblemId,
    pub rule: RuleId,
    pub severity: ProblemSeverity,
    pub site: Site,
    /// The types this problem is about, where the rule is about types.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", specta(optional))]
    pub mismatch: Option<TypeMismatch>,
    /// What this one problem needs said beyond [`RuleInfo::description`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", specta(optional))]
    pub message: Option<String>,
    /// What a repair would change, drawn before it is applied.
    pub fix: Option<FixPreview>,
}

/// A rule that could not finish, and why.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct RuleFailure {
    pub rule: RuleId,
    /// The file the rule stopped on, where one file is to blame.
    pub site: Option<Site>,
    pub message: String,
}

/// What a rule reports into during a check.
///
/// The report derives each [`ProblemId`], so a rule states the site and the
/// message and never has to invent a key.
#[derive(Debug, Default)]
pub struct Report {
    problems: Vec<Problem>,
    failed: Vec<RuleFailure>,
}

impl Report {
    /// Report one finding.
    pub fn problem(&mut self, rule: RuleId, severity: ProblemSeverity, site: Site, detail: Detail) {
        self.problems.push(Problem {
            id: ProblemId::new(rule, &site),
            rule,
            severity,
            site,
            mismatch: detail.mismatch,
            message: detail.message,
            fix: detail.fix,
        });
    }

    /// Report that the rule could not read or parse one file.
    ///
    /// A rule that cannot finish one file still finishes the rest, so this is a
    /// note on the run rather than an end to it.
    pub fn failure(&mut self, rule: RuleId, site: Option<Site>, message: impl Into<String>) {
        self.failed.push(RuleFailure {
            rule,
            site,
            message: message.into(),
        });
    }

    /// What the rules found, and what they could not read.
    pub fn finish(self) -> (Vec<Problem>, Vec<RuleFailure>) {
        (self.problems, self.failed)
    }
}

/// What one check is, apart from anything it found.
///
/// Sent once per run rather than copied onto every row: a project can hold
/// thousands of problems and the words describing the check are the same on
/// each of them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct RuleInfo {
    pub id: RuleId,
    /// A few words naming the state the rule objects to.
    pub title: String,
    /// One sentence saying what that state is.
    pub description: String,
    /// Why some of this rule's findings stay unrepaired, or empty where none do.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    #[cfg_attr(feature = "ts", specta(optional))]
    pub unfixable: String,
    /// The severity every finding of this rule carries - see
    /// [`RuleMeta::severity`].
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", specta(optional))]
    pub severity: Option<ProblemSeverity>,
    /// Whether this project is one the rule speaks about yet.
    pub state: RuleState,
}

/// Whether a rule speaks about a project, and what it waits for if not.
///
/// A check about a change the installed game has not taken still runs, because
/// a modder wants to see what is coming. What it does not do is claim the mod
/// is broken today: the panel draws those findings muted and leaves them out
/// of the count in the project bar, and this is what tells it which they are.
///
/// A rule that compares the mod against the installed game and finds no install
/// to compare with reports the same way, and reports nothing at all. A rule that
/// said nothing without saying why would read as a rule that found nothing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub enum RuleState {
    /// The project is one this rule has everything to say about.
    Active,
    /// Some or all of what the rule checks waits for the machine.
    ///
    /// A newer game build, or an install to read at all. Either way the rule
    /// has run and has nothing to say, which reads exactly like a clean project
    /// unless the panel is told which it is.
    Dormant {
        /// A few words a control can hold, such as `Patch 16.17`.
        waiting: String,
        /// One sentence a reader who has not met this check can act on.
        reason: String,
    },
}

/// What a rule waits for, in the two lengths a panel draws it at.
///
/// A control holds [`Dormancy::waiting`] and the sentence under it is
/// [`Dormancy::reason`]. One sentence and no more: a second line under it drew
/// the same fact in different numbers, which reads as the panel saying one
/// thing twice.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dormancy {
    /// A few words a control can hold, such as `Patch 16.17`.
    pub waiting: String,
    /// One sentence a reader who has not met this check can act on.
    pub reason: String,
}

impl Dormancy {
    /// What a rule waits for, and the sentence saying why.
    #[must_use]
    pub fn new(waiting: impl Into<String>, reason: impl Into<String>) -> Self {
        Self {
            waiting: waiting.into(),
            reason: reason.into(),
        }
    }
}

/// The path of one bin object, for the hashes a run's problems sit under.
///
/// A catalogue rather than a field on [`NodeAddress`], for the reason
/// [`RuleInfo`] is one: a file's problems repeat a handful of objects between
/// them, and an object's path is the same string every time it is named.
///
/// Only the objects a table could name are listed. An object with no entry here
/// is read as the hex of its hash, which is what the file itself holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct ObjectInfo {
    /// The object's path hash, matching [`NodeAddress::entry`].
    #[serde(with = "bin_hash_hex")]
    #[cfg_attr(feature = "ts", specta(type = String))]
    pub entry: BinHash,
    /// The path the hash is of, such as `Characters/Graves/Skins/Skin0`.
    pub name: String,
}

impl ObjectInfo {
    /// Name every object the problems sit in, where a table holds a name.
    ///
    /// Built from the finished problems rather than by each rule, because
    /// naming an entry is the same lookup whatever found it. Ordered by hash,
    /// so two runs over unchanged files produce the same catalogue.
    #[must_use]
    pub fn catalogue(problems: &[Problem], names: &BinNames) -> Vec<Self> {
        let entries: std::collections::BTreeSet<BinHash> = problems
            .iter()
            .filter_map(|problem| problem.site.node.as_ref())
            .map(|node| node.entry)
            .collect();

        entries
            .into_iter()
            .filter_map(|entry| names.entry(entry).map(|name| Self { entry, name }))
            .collect()
    }
}

/// One pass of every rule over one project.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct Run {
    /// When the run read the files.
    #[cfg_attr(feature = "ts", specta(type = String))]
    pub at: DateTime<Utc>,
    /// Every check that ran, whether or not it found anything.
    pub rules: Vec<RuleInfo>,
    /// The name of every object a problem sits in, where a table holds one.
    pub objects: Vec<ObjectInfo>,
    pub problems: Vec<Problem>,
    /// A rule that could not finish, and why. A run never fails as a whole.
    pub failed: Vec<RuleFailure>,
}

impl Run {
    /// The named problems, grouped the way [`apply`] hands them to the rules.
    ///
    /// Indexed rather than scanned: a repair names every fixable problem of the
    /// run, and a project holding seven thousand of them is a scan seven
    /// thousand times over. An id this run does not hold is logged and dropped,
    /// because a panel goes stale and a row it still draws is a list to narrow
    /// rather than a call to refuse.
    ///
    /// [`apply`]: crate::problems::fix::apply
    #[must_use]
    pub fn by_rule<'a>(&'a self, ids: &[ProblemId]) -> HashMap<RuleId, Vec<&'a Problem>> {
        let held: HashMap<&ProblemId, &Problem> = self
            .problems
            .iter()
            .map(|problem| (&problem.id, problem))
            .collect();

        let mut chosen: HashMap<RuleId, Vec<&Problem>> = HashMap::new();
        for id in ids {
            match held.get(id) {
                Some(problem) => chosen.entry(problem.rule).or_default().push(problem),
                None => tracing::debug!("Ignoring a problem this run does not hold: {id}"),
            }
        }
        chosen
    }

    /// Every problem a one-button repair may apply: fixable, and from a live rule.
    #[must_use]
    pub fn live_fixable(&self) -> Vec<ProblemId> {
        self.live_problems()
            .filter(|problem| problem.fix.is_some())
            .map(|problem| problem.id.clone())
            .collect()
    }

    /// The same run with `repaired` gone, as it would read if re-run.
    ///
    /// What a repair leaves behind, without parsing every bin a second time to
    /// discover it. Sound only where every named problem was applied, which is
    /// the caller's to establish - a rule that skipped one leaves it in the
    /// file, and this run would then claim it gone.
    #[must_use]
    pub fn without(&self, repaired: &[ProblemId]) -> Self {
        let gone: HashSet<&ProblemId> = repaired.iter().collect();
        let problems: Vec<Problem> = self
            .problems
            .iter()
            .filter(|problem| !gone.contains(&problem.id))
            .cloned()
            .collect();

        let named: HashSet<BinHash> = problems
            .iter()
            .filter_map(|problem| problem.site.node.as_ref())
            .map(|node| node.entry)
            .collect();

        Self {
            at: self.at,
            rules: self.rules.clone(),
            objects: self
                .objects
                .iter()
                .filter(|object| named.contains(&object.entry))
                .cloned()
                .collect(),
            problems,
            failed: self.failed.clone(),
        }
    }

    /// How many problems the run holds at each severity.
    pub fn counts(&self) -> Counts {
        Counts::over(self.problems.iter())
    }

    /// The problems from live rules only — what a caller with no panel to
    /// draw dormancy on may act on or count.
    ///
    /// A dormant rule's findings describe a patch the installed game has not
    /// taken yet. The panel shows them with the fix withheld, and a flow with
    /// no panel has to make the same cut itself.
    pub fn live_problems(&self) -> impl Iterator<Item = &Problem> {
        let dormant: HashSet<RuleId> = self
            .rules
            .iter()
            .filter(|rule| !matches!(rule.state, RuleState::Active))
            .map(|rule| rule.id)
            .collect();
        self.problems
            .iter()
            .filter(move |problem| !dormant.contains(&problem.rule))
    }
}

/// How many problems a run holds at each severity.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct Counts {
    pub fatals: u32,
    pub errors: u32,
    pub warnings: u32,
    pub infos: u32,
}

impl Counts {
    /// Tally `problems` by severity.
    pub fn over<'a>(problems: impl Iterator<Item = &'a Problem>) -> Self {
        let mut counts = Self::default();
        for problem in problems {
            match problem.severity {
                ProblemSeverity::Fatal => counts.fatals += 1,
                ProblemSeverity::Error => counts.errors += 1,
                ProblemSeverity::Warning => counts.warnings += 1,
                ProblemSeverity::Info => counts.infos += 1,
            }
        }
        counts
    }
}

/// What a rule says about itself, the same for every project it runs over.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RuleMeta {
    /// The stable id a user reads, such as `bin/property-type`.
    pub id: RuleId,
    /// A few words naming the state this rule objects to.
    ///
    /// Sentence case and no trailing stop, because a panel sets it as a
    /// heading: `Meta property type mismatch`.
    pub title: &'static str,
    /// One sentence saying what that state is, for a reader who has not met it.
    pub description: &'static str,
    /// One sentence saying which of this rule's findings no repair reaches, and why.
    ///
    /// Empty for a rule whose findings a repair always fixes - the sentence is
    /// only shown beside a count the repair falls short of.
    pub unfixable: &'static str,
    /// The severity every problem this rule reports carries.
    ///
    /// `None` where each finding answers for itself, because what it costs
    /// depends on the machine the check ran on rather than on the rule.
    ///
    /// **A severity given here is this build's word, as much as the title is.**
    /// That is what lets a remembered verdict take it from the running build
    /// instead of from the record, so a rule demoted in a release stops drawing
    /// the old glyph without waiting for a game patch to move the basis. It is
    /// required rather than defaulted for the same reason: a rule that fell to
    /// the wrong side of it by inheriting a default would go stale silently.
    pub severity: Option<ProblemSeverity>,
}

/// One check the manager runs over a project.
///
/// A rule declares what it reads in [`subscribe`](Self::subscribe) and opens
/// nothing itself. What the [`pass`] does with that is its own doc. The
/// repair is the rule's own, reading and writing through a [`FixRun`].
pub trait Rule: Send + Sync {
    /// What the rule says about itself: its id, its words and its severity.
    fn meta(&self) -> &RuleMeta;

    /// The stable id a user reads, such as `bin/property-type`.
    fn id(&self) -> RuleId {
        self.meta().id
    }

    /// The severity every problem this rule reports carries - see [`RuleMeta::severity`].
    fn severity(&self) -> Option<ProblemSeverity> {
        self.meta().severity
    }

    /// What this rule is, for the catalogue a [`Run`] carries.
    ///
    /// [`RuleState::Active`] here, because dormancy is a fact about a project
    /// and this is the rule alone. The engine asks [`Rule::dormant`] and sets
    /// it.
    fn info(&self) -> RuleInfo {
        let meta = self.meta();
        RuleInfo {
            id: meta.id,
            title: meta.title.to_owned(),
            description: meta.description.to_owned(),
            unfixable: meta.unfixable.to_owned(),
            severity: meta.severity,
            state: RuleState::Active,
        }
    }

    /// Why this rule waits for something `project` does not have yet.
    ///
    /// The words a panel draws as they stand, in the rule's own words, because
    /// what a check waits for is the check's own business. A rule that speaks
    /// about every project - which is most of them, since most checks are about
    /// the mod alone - reports `None` and never overrides this.
    ///
    /// This changes nothing about what the rule reports. A finding about a
    /// change that has not landed is still a finding, and the severity it
    /// carries is what says the game has not taken it yet.
    fn dormant(&self, project: &ProjectFiles) -> Option<Dormancy> {
        let _ = project;
        None
    }

    /// Declare every read this rule needs, and what to do with what comes back.
    ///
    /// Runs once per run, before any file is opened, on the calling thread.
    /// It performs no IO of its own: a rule that needs bytes asks the pass
    /// for them here (D16). A file the pass cannot read is a failure it
    /// reports under this rule and carries on from, so one unreadable `.bin`
    /// never costs the other forty.
    fn subscribe(&self, pass: &mut Pass<'_>);

    /// Repair `problems`, and record every write in `run`.
    ///
    /// The rule re-derives every change from the file on disk rather than from
    /// what the check recorded. A problem whose site no longer matches is
    /// skipped and counted as skipped.
    ///
    /// A change that destroys a name asks [`FixRun::kept_names`] to keep it
    /// first, and leaves the property alone where the name cannot be kept.
    ///
    /// # Errors
    ///
    /// Reports the first file it could not read or write. What the run had
    /// already written stays written, and a second run picks up the rest.
    fn fix(&self, problems: &[&Problem], run: &mut FixRun<'_>) -> Result<Applied, FixError>;
}

/// What one rule's fix changed.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Applied {
    /// Problems the rule repaired.
    pub applied: u32,
    /// Problems the file no longer matched, which the rule left alone.
    pub skipped: u32,
}

/// The last run of each open project. In memory, and never on disk.
///
/// A problem is a fact about files as they were at a moment. Writing a run to
/// disk would let a panel draw a finding for a file a user has since changed in
/// another tool, and a run costs milliseconds, so re-running is cheaper than
/// the bookkeeping that would keep a stored one honest.
#[derive(Debug, Default)]
pub struct ProblemsState(parking_lot::Mutex<std::collections::HashMap<PathBuf, Run>>);

impl ProblemsState {
    /// Keep `run` as the last run of `project`.
    pub fn record(&self, project: &Path, run: Run) {
        self.0.lock().insert(project.to_path_buf(), run);
    }

    /// The last run of `project`, if one is held.
    #[must_use]
    pub fn last(&self, project: &Path) -> Option<Run> {
        self.0.lock().get(project).cloned()
    }

    /// Drop the run of `project`, so the next read re-runs the rules.
    ///
    /// A fix run leaves the list stale: it is a fact about files that have
    /// just changed.
    pub fn invalidate(&self, project: &Path) {
        self.0.lock().remove(project);
    }
}

#[cfg(test)]
mod tests;
