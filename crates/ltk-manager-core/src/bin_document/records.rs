//! The patch records of a `PTCH` bin, as rows under the object each record targets.
//!
//! ADR-0041 addresses them: a target row is its entry hash and `#`, a record row is `#n`,
//! and a row inside a record's value continues with the wire segments of ADR-0027.

use indexmap::IndexMap;
use ltk_hash::BinHash;
use ltk_meta::{BinFile, PropertyPatch};

use super::{
    BinDocument, BinRow, BinRows, BinValue, Named, RowNames, RowNode, Step, Wanted, hex,
    parse_steps,
};
use crate::meta_schema::SchemaAt;

/// The wire path of a target row, which holds the records one object takes.
pub const TARGET_PATH: &str = "#";

/// The wire path of the record at `index` of the file's record list.
pub(super) fn record_path(index: usize) -> String {
    format!("{TARGET_PATH}{index}")
}

/// A record address in two halves: the record's position, and the wire segments under its value.
///
/// `#12.0badf00d` is record 12 and `.0badf00d`. `None` for an object's path, for the target
/// path alone, and for a position written with a leading zero.
pub(super) fn record_address(path: &str) -> Option<(usize, &str)> {
    let after = path.strip_prefix(TARGET_PATH)?;
    let end = after
        .find(|character: char| !character.is_ascii_digit())
        .unwrap_or(after.len());
    let digits = &after[..end];
    if digits.is_empty() || (digits.len() > 1 && digits.starts_with('0')) {
        return None;
    }
    Some((digits.parse().ok()?, &after[end..]))
}

/// The steps under a record's value, or `None` where the text is not one.
///
/// Every segment keeps its separator, so a field opens with `.` even as the first step.
pub(super) fn steps_under(rest: &str) -> Option<Vec<Step>> {
    match rest.as_bytes().first() {
        None => Some(Vec::new()),
        Some(b'.') => {
            let fields = &rest[1..];
            if fields.starts_with(['[', '{']) {
                return None;
            }
            parse_steps(fields).filter(|steps| !steps.is_empty())
        }
        Some(b'[' | b'{') => parse_steps(rest),
        Some(_) => None,
    }
}

/// The row of one target: the object's name and how many records it takes.
pub(super) fn target_row(target: BinHash, records: usize, named: &Named) -> BinRow {
    let (name, unnamed) = named.entry(target);
    BinRow {
        entry: hex(target),
        path: TARGET_PATH.to_owned(),
        label: String::new(),
        node: RowNode::Target,
        name,
        unnamed,
        kind: None,
        value: BinValue::Records { len: records },
        declared: None,
    }
}

impl BinDocument {
    /// The patch records of the file, in file order. A `PROP` holds none.
    pub(super) fn records(&self) -> &[PropertyPatch] {
        match &self.file {
            BinFile::Prop(_) => &[],
            BinFile::Override(patch) => &patch.patches,
        }
    }

    /// The position of every record, under the object it targets.
    ///
    /// The targets keep the order of each one's first record, and the positions keep file order.
    pub(super) fn targets(&self) -> IndexMap<BinHash, Vec<usize>> {
        let mut targets: IndexMap<BinHash, Vec<usize>> = IndexMap::new();
        for (index, record) in self.records().iter().enumerate() {
            targets.entry(record.object_hash).or_default().push(index);
        }
        targets
    }

    /// The rows of the records `entry` takes: `offset` in, at most `limit` of them, and the total.
    ///
    /// `None` where no record targets `entry`. A record row carries no declared kind. The
    /// class of the object it targets is outside the file.
    pub(super) fn records_of(
        &self,
        entry: BinHash,
        offset: usize,
        limit: usize,
        names: &dyn RowNames,
        schema: Option<SchemaAt<'_>>,
    ) -> Option<BinRows> {
        let records = self.records();
        let targets = self.targets();
        let positions = targets.get(&entry)?;
        let window = positions.get(offset..).unwrap_or(&[]).iter().take(limit);

        let mut wanted = Wanted::default();
        for &index in window.clone() {
            wanted.value(&records[index].value);
        }
        let named = wanted.resolve(&self.typed.over(names), schema);

        let entry = hex(entry);
        let rows = window
            .map(|&index| {
                let record = &records[index];
                BinRow {
                    entry: entry.clone(),
                    path: record_path(index),
                    label: record.path.as_str().to_owned(),
                    node: RowNode::Record,
                    name: record.path.as_str().to_owned(),
                    unnamed: false,
                    kind: Some(record.value.kind().into()),
                    value: named.value_of(&record.value),
                    declared: None,
                }
            })
            .collect();

        Some(BinRows {
            rows,
            total: positions.len(),
        })
    }
}
