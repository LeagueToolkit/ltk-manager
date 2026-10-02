//! Which audio files this mod's own bins ask for, and under what names.
//!
//! A bank is asked for by name. A skin's audio properties hold a list of bank
//! units, and each unit carries the paths of the files it needs - the media
//! bank, the events bank and any media package. That list is where a request
//! for a bank comes from, so it is what a removal has to answer to.
//!
//! **It is also the only plaintext copy of a bank's own name.** An unpacked
//! chunk is named by the hash of its path, and a name is what `audio/bank-id`
//! has to hash to derive an id, so the path a unit names is what resolves that
//! hash back. A bank no unit names is one the game never loads.
//!
//! The class rather than the class that holds it, because six classes hold bank
//! units and they all ask the same way.
//!
//! A [`Fact`]: its collector rides the pass's one walk of every bin, for
//! whichever rules demand it, and a repair computes it on its own through
//! `ProjectFiles::fact`.

use std::collections::HashMap;

use crate::hashing::named;
use ltk_hash::{BinHash, Hash as _, WadHash};
use ltk_meta::property::Kind;
use ltk_meta::walk::{Leaf, Node, TreeNode as _, TreeValue, Visit, Visitor};
use parking_lot::Mutex;

use crate::problems::{BinVisitor, Coverage, Fact, Sink, Walk};

/// `BankUnit`, the class naming the files one unit of a skin's audio needs.
pub(crate) const BANK_UNIT: BinHash = named("BankUnit");

/// `bankPath` on that class, which is the list of those files.
pub(crate) const BANK_PATH: BinHash = named("bankPath");

/// Every file this mod's bank units name, by the hash a WAD addresses it by.
///
/// The default is a fact nothing was read for, which answers as an incomplete
/// one does.
#[derive(Debug, Default)]
pub struct BankUnits {
    /// The path each unit named, keyed by the hash of that path.
    asked: HashMap<WadHash, String>,
    /// Whether every bin was read.
    complete: bool,
}

impl Fact for BankUnits {
    type Collector = BankUnitCollector;

    /// Folded in file order, so two paths under one hash resolve the same way
    /// on every run.
    fn assemble(collector: BankUnitCollector, coverage: Coverage) -> Self {
        let mut bins = collector.asked.into_inner();
        bins.sort_by_key(|(index, _)| *index);
        Self {
            asked: bins.into_iter().flat_map(|(_, asked)| asked).collect(),
            complete: coverage.complete,
        }
    }
}

impl BankUnits {
    /// Whether anything in the mod asks for the file at `chunk`.
    ///
    /// A bin that would not parse, or a read the budget called off, might hold
    /// a request nothing here records - so an incomplete read answers yes to
    /// everything. The cost of a wrong yes is a repair not offered, and the
    /// cost of a wrong no is a file deleted out from under something asking.
    #[must_use]
    pub fn asks_for(&self, chunk: WadHash) -> bool {
        !self.complete || self.asked.contains_key(&chunk)
    }

    /// The path a bank unit named the file at `chunk` by.
    ///
    /// This is the only place a bank's own name survives an unpack, which
    /// names the chunk by its hash. `None` where no unit names it, which is a
    /// bank the game never asks for and so never loads.
    #[must_use]
    pub fn path_of(&self, chunk: WadHash) -> Option<&str> {
        self.asked.get(&chunk).map(String::as_str)
    }
}

/// The paths one bin's units name, with the bin's position in the round.
type BinPaths = (usize, Vec<(WadHash, String)>);

/// Every path the bank units of every bin name, folded once per bin.
#[derive(Debug, Default)]
pub struct BankUnitCollector {
    asked: Mutex<Vec<BinPaths>>,
}

impl BinVisitor for BankUnitCollector {
    fn begin<'r, 'f: 'r>(&'r self, sink: Sink<'f>) -> Box<dyn Walk<'f> + 'r> {
        Box::new(Asked {
            into: &self.asked,
            found: Vec::new(),
            sink,
        })
    }
}

/// The paths every `BankUnit` node of one bin names, wherever the node sits.
struct Asked<'r, 'f> {
    into: &'r Mutex<Vec<BinPaths>>,
    found: Vec<(WadHash, String)>,
    sink: Sink<'f>,
}

impl<'a, V: TreeValue<'a>> Visitor<'a, V> for Asked<'_, '_> {
    type Error = ltk_meta::Error;

    fn enter_node(&mut self, node: &Node<'_, 'a, V>) -> Result<Visit, ltk_meta::Error> {
        if node.class_hash() != BANK_UNIT {
            return Ok(Visit::Continue);
        }
        let Some(paths) = node.inner().get(BANK_PATH)? else {
            return Ok(Visit::Continue);
        };
        if !matches!(paths.kind(), Kind::Container | Kind::UnorderedContainer) {
            return Ok(Visit::Continue);
        }
        for item in paths.children()? {
            let (_, held) = item?;
            if let Some(Leaf::String(path)) = held.as_leaf()? {
                self.found.push((WadHash::hash_str(path), path.to_owned()));
            }
        }
        Ok(Visit::Continue)
    }
}

impl<'f> Walk<'f> for Asked<'_, 'f> {
    fn end(self: Box<Self>) -> Sink<'f> {
        let Self { into, found, sink } = *self;
        into.lock().push((sink.index(), found));
        sink
    }
}
