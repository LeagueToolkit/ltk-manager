//! The full-results view the objects browser's box reads: every match, in path order.

use std::collections::HashSet;

use ltk_hash::BinHash;

use crate::bin_document::hex;
use crate::game_index::FIND_LIMIT;
use crate::matcher::{FindQuery, Range};

use super::{ObjectFindHit, ObjectFindResult, ObjectIndex, STALE_CHECK_INTERVAL};

/// The runs `query` marks on `text`, every run empty where no query narrows.
fn matched(query: Option<&FindQuery>, text: &str) -> Option<Vec<Range>> {
    match query {
        Some(query) => query.matches(text),
        None => Some(Vec::new()),
    }
}

/// One full search's hits as they are met, full at its cap.
#[derive(Debug)]
struct FindScan {
    hits: Vec<ObjectFindHit>,
    limit: usize,
    total: u32,
    since_check: u32,
    overtaken: bool,
}

impl FindScan {
    fn new(limit: usize) -> Self {
        Self {
            hits: Vec::new(),
            limit,
            total: 0,
            since_check: 0,
            overtaken: false,
        }
    }

    /// Count a match. `hit` is kept under the cap and dropped past it.
    fn keep(&mut self, hit: impl FnOnce() -> ObjectFindHit) {
        self.total += 1;
        if self.hits.len() < self.limit {
            self.hits.push(hit());
        }
    }

    /// Test the generation on the first object and every few thousand after, and
    /// report whether to stop.
    fn tick(&mut self, is_overtaken: &impl Fn() -> bool) -> bool {
        if self.since_check == 0 {
            self.overtaken = is_overtaken();
        }
        self.since_check = (self.since_check + 1) % STALE_CHECK_INTERVAL;
        self.overtaken
    }
}

impl ObjectIndex {
    /// Every object the pattern matches, in path order, the unnamed last by their hex.
    ///
    /// The full-results twin of [`search`](Self::search): nothing is ranked, every hit
    /// comes back up to [`FIND_LIMIT`], and the total counts on past it. `class` is the
    /// `class:` term's value, a name prefix or a hash, and narrows the objects to the
    /// classes it opens. With no `query` the class's objects list whole. With neither,
    /// nothing matches.
    ///
    /// `is_overtaken` is tested every few thousand objects, the contract
    /// [`GameIndex::search`](crate::game_index::GameIndex::search) sets.
    #[must_use]
    pub fn find(
        &self,
        query: Option<&FindQuery>,
        class: Option<&str>,
        is_overtaken: impl Fn() -> bool,
    ) -> ObjectFindResult {
        self.find_capped(query, class, FIND_LIMIT, is_overtaken)
    }

    /// [`find`](Self::find) with the cap a test can afford to fill.
    pub(super) fn find_capped(
        &self,
        query: Option<&FindQuery>,
        class: Option<&str>,
        limit: usize,
        is_overtaken: impl Fn() -> bool,
    ) -> ObjectFindResult {
        let unnamed = self.names.objects.is_empty() && !self.declared.rows.is_empty();
        let classes: Option<HashSet<BinHash>> =
            class.map(|term| self.classes_opened_by(term).into_iter().collect());
        if (query.is_none() && classes.is_none()) || classes.as_ref().is_some_and(HashSet::is_empty)
        {
            return ObjectFindResult::empty(unnamed);
        }

        let mut scan = FindScan::new(limit);
        for object in &self.names.named {
            if scan.tick(&is_overtaken) {
                break;
            }
            if !self.declares_as(object.hash, classes.as_ref()) {
                continue;
            }
            let Some(ranges) = matched(query, &object.name) else {
                continue;
            };
            scan.keep(|| self.find_hit(object.hash, &object.name, ranges));
        }
        if !scan.overtaken {
            for object in self.unnamed_objects() {
                if scan.tick(&is_overtaken) {
                    break;
                }
                if !self.declares_as(object, classes.as_ref()) {
                    continue;
                }
                let text = hex(object);
                let Some(ranges) = matched(query, &text) else {
                    continue;
                };
                scan.keep(|| self.find_hit(object, &text, ranges));
            }
        }

        ObjectFindResult {
            hits: scan.hits,
            total: scan.total,
            superseded: scan.overtaken,
            unnamed,
        }
    }

    /// Whether a declaration of `object` carries one of `classes`. Every object does with none.
    fn declares_as(&self, object: BinHash, classes: Option<&HashSet<BinHash>>) -> bool {
        classes.is_none_or(|classes| {
            self.declared
                .rows_of(object)
                .iter()
                .any(|at| classes.contains(&self.declared.rows[*at as usize].class))
        })
    }

    /// The wire shape of one object the find matched at `ranges` of `path`.
    fn find_hit(&self, object: BinHash, path: &str, ranges: Vec<Range>) -> ObjectFindHit {
        ObjectFindHit {
            object_hash: hex(object),
            path: path.to_owned(),
            ranges,
            declarations: self.declarations_of(object),
        }
    }
}
