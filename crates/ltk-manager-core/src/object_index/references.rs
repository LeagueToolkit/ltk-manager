//! The grouped view the References document reads: one query's hits, by declaring file.
//!
//! "The References document" in `docs/ux/PROJECT_EDITOR.md`.

use std::collections::HashMap;

use ltk_hash::BinHash;
use ltk_wad::WadHash;

use crate::bin_document::hex;
use crate::game_index::FIND_LIMIT;
use crate::utils::natural_order::compare_names;

use super::{ObjectIndex, ReferenceGroup, ReferenceHit, ReferenceResult, STALE_CHECK_INTERVAL};

/// Whether no table named the object of `hit`, which leaves its hex in place of a path.
fn unnamed_hit(hit: &ReferenceHit) -> bool {
    hit.path == hit.object_hash
}

/// One reference query's rows as they are met, gathered under their declaring file.
#[derive(Debug)]
struct ReferenceScan {
    /// The rows of each file, in the order the files were first met.
    groups: Vec<(WadHash, Vec<u32>)>,
    /// Where a file's rows sit in `groups`.
    at: HashMap<WadHash, usize>,
    limit: usize,
    kept: usize,
    total: u32,
    since_check: u32,
    overtaken: bool,
}

impl ReferenceScan {
    fn new(limit: usize) -> Self {
        Self {
            groups: Vec::new(),
            at: HashMap::new(),
            limit,
            kept: 0,
            total: 0,
            since_check: 0,
            overtaken: false,
        }
    }

    /// Count the row at `at`, and gather it under `file` while under the cap.
    fn keep(&mut self, file: WadHash, at: u32) {
        self.total += 1;
        if self.kept >= self.limit {
            return;
        }
        self.kept += 1;
        match self.at.get(&file) {
            Some(group) => self.groups[*group].1.push(at),
            None => {
                self.at.insert(file, self.groups.len());
                self.groups.push((file, vec![at]));
            }
        }
    }

    /// Test the generation on the first row and every few thousand after, and report
    /// whether to stop.
    fn tick(&mut self, is_overtaken: &impl Fn() -> bool) -> bool {
        if self.since_check == 0 {
            self.overtaken = is_overtaken();
        }
        self.since_check = (self.since_check + 1) % STALE_CHECK_INTERVAL;
        self.overtaken
    }

    /// The groups on the wire, each resolved through `index`.
    fn finish(self, index: &ObjectIndex) -> ReferenceResult {
        ReferenceResult {
            groups: self
                .groups
                .iter()
                .map(|(_, rows)| index.reference_group(rows))
                .collect(),
            total: self.total,
            superseded: self.overtaken,
        }
    }
}

impl ObjectIndex {
    /// Every object of `class`, grouped by the file that declares it.
    ///
    /// The class scan of [`find`](Self::find) with the objects grouped rather than
    /// listed: the files come in archive order, the objects of one file in natural
    /// path order, and the total counts on past the [`FIND_LIMIT`] the groups hold.
    ///
    /// `is_overtaken` is tested every few thousand rows, the contract
    /// [`GameIndex::search`](crate::game_index::GameIndex::search) sets.
    #[must_use]
    pub fn class_references(
        &self,
        class: BinHash,
        is_overtaken: impl Fn() -> bool,
    ) -> ReferenceResult {
        self.class_references_capped(class, FIND_LIMIT, is_overtaken)
    }

    /// [`class_references`](Self::class_references) with the cap a test can afford to fill.
    pub(super) fn class_references_capped(
        &self,
        class: BinHash,
        limit: usize,
        is_overtaken: impl Fn() -> bool,
    ) -> ReferenceResult {
        let mut scan = ReferenceScan::new(limit);
        for (at, row) in self.declared.rows.iter().enumerate() {
            if scan.tick(&is_overtaken) {
                break;
            }
            if row.class == class {
                scan.keep(row.file, at as u32);
            }
        }
        scan.finish(self)
    }

    /// Every declaration of `object`, grouped by the file that declares it.
    ///
    /// One file is one group of one object, the shape
    /// [`class_references`](Self::class_references) answers in. Nothing declaring
    /// `object` is no group at all.
    #[must_use]
    pub fn object_references(&self, object: BinHash) -> ReferenceResult {
        let rows = self.declared.rows_of(object);
        ReferenceResult {
            groups: rows.iter().map(|at| self.reference_group(&[*at])).collect(),
            total: rows.len() as u32,
            superseded: false,
        }
    }

    /// The rows of one declaring file as a group, its objects in natural path order.
    ///
    /// # Panics
    ///
    /// Panics on an empty `rows`, which no scan builds: a group exists because a row
    /// landed in it.
    fn reference_group(&self, rows: &[u32]) -> ReferenceGroup {
        let declaration = self.declaration(rows[0]);
        let mut objects: Vec<ReferenceHit> =
            rows.iter().map(|at| self.reference_hit(*at)).collect();
        objects.sort_by(|a, b| {
            unnamed_hit(a)
                .cmp(&unnamed_hit(b))
                .then_with(|| compare_names(&a.path, &b.path))
        });
        ReferenceGroup {
            asset: declaration.asset,
            file: declaration.file,
            objects,
        }
    }

    /// The row at `at` as one object of a group.
    fn reference_hit(&self, at: u32) -> ReferenceHit {
        let row = &self.declared.rows[at as usize];
        ReferenceHit {
            object_hash: hex(row.object),
            path: self.object_name(row.object),
            class_hash: hex(row.class),
            class: self.class_name(row.class),
        }
    }
}
