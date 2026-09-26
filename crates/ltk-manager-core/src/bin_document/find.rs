//! The project bar's `@` scope over one open document: every row whose name or value holds
//! the query.
//!
//! "Open questions" in `docs/ux/BIN_EDITOR.md`, under "Answered".

use indexmap::IndexMap;
use ltk_hash::BinHash;
use ltk_meta::BinObject;
use serde::Serialize;

use crate::matcher::Range;
use crate::meta_schema::SchemaAt;

use super::records::record_path;
use super::{
    BinDocument, BinValue, Child, Lens, Node, RowNames, Segment, TARGET_PATH, Wanted, children_of,
    hex,
};

/// How many rows one search answers. The total counts on past it.
///
/// The bar's scoped cap, so a search answers what one scoped group draws and no more.
pub const FIND_ROWS: usize = 200;

/// One row a search matched, with the path a reveal opens down to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct BinFindHit {
    /// The object's path hash, `0x` and eight hex digits.
    pub entry: String,
    /// The row's property path on the wire. Empty for an object row.
    pub path: String,
    /// The same path for a person. Empty for an object row.
    pub label: String,
    /// The object's path, or its hash where no table names it.
    pub object: String,
    /// What the row is called: the object's path, the property's name, `[i]` or the key.
    pub name: String,
    /// Byte offsets into `name` the query matched. Empty where the value matched alone.
    pub ranges: Vec<Range>,
    /// The row's value as one line of text, where it reads as one.
    pub value: Option<String>,
}

/// What one search of an open document found.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct BinFindResult {
    /// The matching rows in tree order, at most `FIND_ROWS`.
    pub hits: Vec<BinFindHit>,
    /// How many rows matched in all, counted on past the cap.
    pub total: u32,
}

impl BinDocument {
    /// Every row whose name or value holds `query`, case aside, in tree order.
    ///
    /// `entry` narrows the search to one object's properties, which is what an object tab
    /// draws. Without it every object row is searched too, and after the objects every patch
    /// target, its records and the rows under them (ADR-0041). A row's value matches by the
    /// text it draws: a string, a number, the name behind a hash or a link or its hex, a
    /// file's path, and the class a struct holds. A blank query matches nothing.
    #[must_use]
    pub fn find(
        &self,
        entry: Option<BinHash>,
        query: &str,
        names: &dyn RowNames,
        schema: Option<SchemaAt<'_>>,
    ) -> BinFindResult {
        let needle = query.trim().to_ascii_lowercase();
        if needle.is_empty() {
            return BinFindResult::default();
        }
        let objects: Vec<&BinObject> = match entry {
            Some(entry) => self.file.objects().get(&entry).into_iter().collect(),
            None => self.file.objects().values().collect(),
        };

        let records = self.records();
        let targets = match entry {
            Some(_) => IndexMap::new(),
            None => self.targets(),
        };

        let mut wanted = Wanted::default();
        for object in &objects {
            wanted.entries.push(object.path_hash);
            wanted.classes.push(object.class_hash);
            want_under(Node::Object(object), &mut wanted);
        }
        for (&target, positions) in &targets {
            wanted.entries.push(target);
            for &index in positions {
                let value = &records[index].value;
                wanted.value(value);
                want_under(Node::Value(value), &mut wanted);
            }
        }
        let lens = Lens {
            named: wanted.resolve(&self.typed.over(names), schema),
            schema,
        };

        let mut search = Search {
            needle: &needle,
            lens: &lens,
            object: String::new(),
            entry: String::new(),
            result: BinFindResult::default(),
        };
        for object in objects {
            search.entry = hex(object.path_hash);
            search.object = lens.named.entry(object.path_hash).0;
            if entry.is_none() {
                let class = lens.named.classes.get(&object.class_hash).cloned();
                let value = class.unwrap_or_else(|| hex(object.class_hash));
                let name = search.object.clone();
                search.consider("", "", &name, Some(value), None);
            }
            search.under(Node::Object(object), "", "");
        }
        for (&target, positions) in &targets {
            search.entry = hex(target);
            search.object = lens.named.entry(target).0;
            let name = search.object.clone();
            search.consider(TARGET_PATH, "", &name, None, None);
            for &index in positions {
                let record = &records[index];
                let path = record_path(index);
                let label = record.path.as_str();
                let value = lens.named.value_of(&record.value);
                search.consider(&path, label, label, value_text(&value), value_hash(&value));
                search.under(Node::Value(&record.value), &path, label);
            }
        }
        search.result
    }
}

/// Every hash the rows under `node` name, at any depth.
fn want_under(node: Node<'_>, wanted: &mut Wanted) {
    for child in children_of(node) {
        let value = match child {
            Child::Field(field, value) => {
                wanted.fields.push(field);
                value
            }
            Child::Element(_, value) => value,
            Child::Entry(key, value, _) => {
                wanted.key(key);
                value
            }
        };
        wanted.value(value);
        want_under(Node::Value(value), wanted);
    }
}

/// One search's walk of the rows, and what it has found so far.
struct Search<'s> {
    needle: &'s str,
    lens: &'s Lens<'s>,
    /// The readable path of the object being walked.
    object: String,
    /// The hash of the object being walked, `0x` and eight hex digits.
    entry: String,
    result: BinFindResult,
}

impl Search<'_> {
    fn under(&mut self, node: Node<'_>, path: &str, label: &str) {
        let class = node.class();
        for child in children_of(node) {
            let segment = Segment::of(child, path, label, self.lens, class);
            let row_path = format!("{path}{}", segment.wire);
            let row_label = format!("{label}{}", segment.readable);
            let value = self.lens.named.value_of(segment.value);
            self.consider(
                &row_path,
                &row_label,
                &segment.name,
                value_text(&value),
                value_hash(&value),
            );
            self.under(Node::Value(segment.value), &row_path, &row_label);
        }
    }

    /// Count the row, and keep it while under the cap, where its name, its value or the
    /// hash behind its value matches.
    fn consider(
        &mut self,
        path: &str,
        label: &str,
        name: &str,
        value: Option<String>,
        hash: Option<&str>,
    ) {
        let ranges: Vec<Range> = name
            .to_ascii_lowercase()
            .find(self.needle)
            .map(|start| {
                let end = start + self.needle.len();
                vec![(start as u32, end as u32)]
            })
            .unwrap_or_default();
        let in_value = [value.as_deref(), hash]
            .into_iter()
            .flatten()
            .any(|text| text.to_ascii_lowercase().contains(self.needle));
        if ranges.is_empty() && !in_value {
            return;
        }
        self.result.total += 1;
        if self.result.hits.len() >= FIND_ROWS {
            return;
        }
        self.result.hits.push(BinFindHit {
            entry: self.entry.clone(),
            path: path.to_owned(),
            label: label.to_owned(),
            object: self.object.clone(),
            name: name.to_owned(),
            ranges,
            value,
        });
    }
}

/// The text a row's value draws, or `None` where it draws a tally.
fn value_text(value: &BinValue) -> Option<String> {
    match value {
        BinValue::String { value } => Some(value.clone()),
        BinValue::Integer { text } => Some(text.clone()),
        BinValue::Float { value } => Some(value.to_string()),
        BinValue::Bool { value } => Some(value.to_string()),
        BinValue::Hash { hash, name } | BinValue::ObjectLink { hash, name } => {
            Some(name.clone().unwrap_or_else(|| hash.clone()))
        }
        BinValue::WadChunkLink { hash, path } => Some(path.clone().unwrap_or_else(|| hash.clone())),
        BinValue::Struct {
            class, class_hash, ..
        } => Some(class.clone().unwrap_or_else(|| class_hash.clone())),
        BinValue::None
        | BinValue::Vector { .. }
        | BinValue::Matrix { .. }
        | BinValue::Color { .. }
        | BinValue::Container { .. }
        | BinValue::Null
        | BinValue::Optional { .. }
        | BinValue::Map { .. }
        | BinValue::Undrawn
        | BinValue::Records { .. } => None,
    }
}

/// The hex behind a value that draws a name in its place, so the hash finds the row too.
fn value_hash(value: &BinValue) -> Option<&str> {
    match value {
        BinValue::Hash { hash, .. }
        | BinValue::ObjectLink { hash, .. }
        | BinValue::WadChunkLink { hash, .. } => Some(hash),
        BinValue::Struct { class_hash, .. } => Some(class_hash),
        _ => None,
    }
}
