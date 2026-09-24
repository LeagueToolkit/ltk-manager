//! Module actions on a manifest's text. ltk-manager ADR-0048.
//!
//! A module's lines are its list item and the comment lines directly above it. Every
//! method reads ranges from a fresh parse and splices whole lines, as `edit.rs` does.

use ltk_game_data::{BinHash, ModuleName, Sign};
use ltk_meta::path::{PropertyPath, Segment};
use rowan::ast::AstNode as _;
use yaml_edit::{Document, Mapping, MappingEntry};

use crate::Refusal;
use crate::document_text::DocumentText;
use crate::locate::{self, Site};
use crate::syntax::{self, Node};

/// The signs a key of one path can carry, in the order a move writes them.
const SIGNS: [Sign; 3] = [Sign::Set, Sign::Add, Sign::Remove];

impl DocumentText {
    /// The text with the module at `index` holding `name`, or no name.
    pub(crate) fn rename_module(
        &self,
        index: usize,
        name: Option<&ModuleName>,
    ) -> Result<Self, Refusal> {
        let doc = self.parse()?;
        let module = locate::module_at(&doc, index)?;
        let entries = syntax::entries(&module);
        let held = entries
            .iter()
            .find(|entry| syntax::key_string(entry).as_deref() == Some("name"));

        match (held, name) {
            (Some(entry), Some(name)) => {
                let spelled = syntax::spell_key(name.as_str());
                let Some(value) = entry.value_node() else {
                    return Ok(self.replace_entry(entry.syntax(), &syntax::name_line(name)));
                };
                let value = syntax::node(&value);
                let start = syntax::start(&value);
                let old = self.as_str()[start..syntax::end(&value)].trim_end();
                Ok(self.splice(start, start + old.len(), &spelled))
            }
            (Some(entry), None) => Ok(self.remove_module_key(&module, entry)),
            (None, Some(name)) => {
                let first = entries.first().ok_or(Refusal::NoModule(index))?;
                let start = syntax::start(first.syntax());
                if module.is_flow_style() {
                    let spelled = syntax::spell_key(name.as_str());
                    return Ok(self.splice(start, start, &format!("name: {spelled}, ")));
                }

                let pad = " ".repeat(self.column(first.syntax()));
                Ok(self.splice(start, start, &format!("{}{pad}", syntax::name_line(name))))
            }
            (None, None) => Ok(self.clone()),
        }
    }

    /// The text without the module at `index`. Removing the last module leaves
    /// `modules: []`.
    pub(crate) fn remove_module(&self, index: usize) -> Result<Self, Refusal> {
        let doc = self.parse()?;
        let items = locate::module_items(&doc);
        let item = items.get(index).ok_or(Refusal::NoModule(index))?;

        if items.len() == 1 {
            let (entry, _) = locate::modules(&doc).ok_or(Refusal::NoModule(index))?;
            let key = syntax::key_spelling(&entry).unwrap_or_else(|| "modules".to_owned());
            let pad = " ".repeat(self.column(entry.syntax()));
            return Ok(self.replace_lines(entry.syntax(), &format!("{pad}{key}: []\n")));
        }
        if is_flow_list(&doc) {
            return Ok(self.cut(item));
        }

        let (start, end) = self.module_span(item);
        Ok(self.splice(start, end, ""))
    }

    /// The text with the module at `index` moved to stand at `to`, counted among the
    /// modules as they stand after the move.
    pub(crate) fn move_module(&self, index: usize, to: usize) -> Result<Self, Refusal> {
        let doc = self.parse()?;
        let items = locate::module_items(&doc);
        let item = items.get(index).ok_or(Refusal::NoModule(index))?;
        if to >= items.len() {
            return Err(Refusal::NoModule(to));
        }
        if index == to {
            return Ok(self.clone());
        }
        if is_flow_list(&doc) {
            return Err(Refusal::ModulesNotBlock);
        }

        let (start, end) = self.module_span(item);
        let mut moved = self.as_str()[start..end].to_owned();
        if !moved.ends_with('\n') {
            moved.push('\n');
        }
        let rest = self.splice(start, end, "");

        let doc = rest.parse()?;
        let items = locate::module_items(&doc);
        if let Some(before) = items.get(to) {
            let (at, _) = rest.module_span(before);
            return Ok(rest.splice(at, at, &moved));
        }
        let last = items.last().ok_or(Refusal::NoModule(to))?;
        let (_, at) = rest.module_span(last);
        Ok(rest.insert_lines(at, &moved))
    }

    /// The text with the keys of `entry` in the `entries` module at `index` moved to the
    /// `entries` module at `to`: every signed key of `path`, or the whole body where `path`
    /// is `None`.
    ///
    /// The module at `index` goes where the move leaves it empty, and `to` counts the
    /// modules as they stand before the move.
    pub(crate) fn move_keys(
        &self,
        index: usize,
        entry: BinHash,
        path: Option<&PropertyPath>,
        to: usize,
    ) -> Result<Self, Refusal> {
        let doc = self.parse()?;
        let source = locate::entries_at(&doc, index)?;
        let destination = locate::entries_at(&doc, to)?;
        if index == to {
            return Ok(self.clone());
        }
        let spelled = locate::entry_keys(&source, entry)
            .first()
            .and_then(syntax::key_spelling)
            .ok_or(Refusal::NoKey)?;

        match path {
            None => self.move_body(index, entry, &spelled, to, &source, &destination),
            Some(path) => {
                let segments: Vec<Segment<'_>> = path.segments().collect();
                self.move_path(index, entry, &spelled, &segments, to)
            }
        }
    }

    /// Move every key of `entry`'s bodies in the module at `index` to the module at `to`.
    fn move_body(
        &self,
        index: usize,
        entry: BinHash,
        spelled: &str,
        to: usize,
        source: &Mapping,
        destination: &Mapping,
    ) -> Result<Self, Refusal> {
        let keys = locate::entry_keys(source, entry);
        let mut moved = Vec::new();
        for body in keys.iter().filter_map(syntax::mapping_value) {
            for key in syntax::entries(&body) {
                moved.push(MovedKey {
                    spelling: syntax::key_spelling(&key).unwrap_or_default(),
                    name: syntax::key_string(&key).unwrap_or_default(),
                    value: key.value_node().map_or_else(
                        || "null".to_owned(),
                        |value| self.standalone(&syntax::node(&value)),
                    ),
                    comment: self.key_line_comment(key.syntax()),
                });
            }
        }
        if moved.is_empty() {
            return Err(Refusal::NoKey);
        }
        let held = held_body(destination, entry);
        if moved.iter().any(|key| {
            held.as_ref().is_some_and(|body| {
                syntax::entries(body)
                    .iter()
                    .any(|held| syntax::key_string(held).as_deref() == Some(key.name.as_str()))
            })
        }) {
            return Err(Refusal::DeclaredInDestination);
        }

        let (mut text, to) = self.drop_each(index, to, keys.len(), |entries| {
            locate::entry_keys(entries, entry).into_iter().next()
        })?;

        let doc = text.parse()?;
        let destination = locate::entries_at(&doc, to)?;
        if held_body(&destination, entry).is_none() {
            let body: String = moved
                .iter()
                .map(|key| {
                    syntax::layout_entry(&key.spelling, &key.value, 0, key.comment.as_deref())
                })
                .collect();
            return text.insert_entry(&destination, spelled, body.trim_end());
        }
        for key in &moved {
            let doc = text.parse()?;
            let body = held_body(&locate::entries_at(&doc, to)?, entry).ok_or(Refusal::NoKey)?;
            text = text.insert_entry_commented(
                &body,
                &key.spelling,
                &key.value,
                key.comment.as_deref(),
            )?;
        }
        Ok(text)
    }

    /// Move every signed key of `segments` under `entry` in the module at `index` to the
    /// module at `to`.
    fn move_path(
        &self,
        index: usize,
        entry: BinHash,
        spelled: &str,
        segments: &[Segment<'_>],
        to: usize,
    ) -> Result<Self, Refusal> {
        let doc = self.parse()?;
        let source = locate::entries_at(&doc, index)?;
        let destination = locate::entries_at(&doc, to)?;

        let mut moved = Vec::new();
        for sign in SIGNS {
            if !locate::keys_in_entries(&destination, entry, sign, segments).is_empty()
                && !locate::keys_in_entries(&source, entry, sign, segments).is_empty()
            {
                return Err(Refusal::DeclaredInDestination);
            }
            for key in locate::keys_in_entries(&source, entry, sign, segments) {
                let value = key.value_node().map_or_else(
                    || "null".to_owned(),
                    |value| self.standalone(&syntax::node(&value)),
                );
                moved.push((sign, value));
            }
        }
        if moved.is_empty() {
            return Err(Refusal::NoKey);
        }

        let mut text = self.clone();
        let mut to = to;
        for (sign, _) in &moved {
            let (dropped, shifted) = text.drop_each(index, to, 1, |entries| {
                locate::keys_in_entries(entries, entry, *sign, segments)
                    .into_iter()
                    .next()
            })?;
            text = dropped;
            to = shifted;
        }

        for (sign, value) in &moved {
            let doc = text.parse()?;
            let site = Site {
                chunk_hash: 0,
                entry,
                sign: *sign,
                segments: segments.to_vec(),
            };
            text = text.insert_in_entries(&locate::entries_at(&doc, to)?, &site, spelled, value)?;
        }
        Ok(text)
    }

    /// Drop `count` keys that `find` locates in the `entries` module at `index`, one at a
    /// time. Answers the text and the index `to` holds after the drops, one less where the
    /// module at `index`, ahead of it, went.
    fn drop_each(
        &self,
        index: usize,
        to: usize,
        count: usize,
        find: impl Fn(&Mapping) -> Option<MappingEntry>,
    ) -> Result<(Self, usize), Refusal> {
        let mut text = self.clone();
        let modules = locate::module_items(&text.parse()?).len();
        for _ in 0..count {
            let doc = text.parse()?;
            let Some(key) = find(&locate::entries_at(&doc, index)?) else {
                break;
            };
            text = text.drop_key(&doc, &key);
            if locate::module_items(&text.parse()?).len() < modules {
                break;
            }
        }

        let removed = locate::module_items(&text.parse()?).len() < modules;
        Ok((text, if removed && to > index { to - 1 } else { to }))
    }

    /// The text without `entry`, a key of `module`. A first key on its item's dash line
    /// hands that line to the key after it, and the comment lines between them move above
    /// the item.
    fn remove_module_key(&self, module: &Mapping, entry: &MappingEntry) -> Self {
        let entries = syntax::entries(module);
        let node = entry.syntax();
        let start = syntax::start(node);
        let lead = self.line_start(start);
        let prefix = &self.as_str()[lead..start];
        let next = entries
            .iter()
            .position(|held| held.syntax() == node)
            .and_then(|at| entries.get(at + 1));

        match next {
            Some(next) if !module.is_flow_style() && !prefix.trim().is_empty() => {
                let next_start = syntax::start(next.syntax());
                let between = &self.as_str()[syntax::line_end(node)..self.line_start(next_start)];
                self.splice(lead, next_start, &format!("{between}{prefix}"))
            }
            _ => self.cut(node),
        }
    }

    /// Where the lines of a module's list item start and end: the comment lines directly
    /// above it through its last line. Comment and blank lines the parser hangs on the
    /// item's tail belong to what follows.
    pub(crate) fn module_span(&self, item: &Node) -> (usize, usize) {
        let text = self.as_str();
        let first_line = self.line_start(syntax::start(item));

        let mut start = first_line;
        while start > 0 {
            let above = self.line_start(start - 1);
            if !text[above..start].trim_start().starts_with('#') {
                break;
            }
            start = above;
        }

        let mut end = syntax::line_end(item);
        while end > first_line {
            let line_start = self.line_start(end - 1);
            let line = text[line_start..end].trim();
            if line_start <= first_line || !(line.is_empty() || line.starts_with('#')) {
                break;
            }
            end = line_start;
        }
        (start, end)
    }
}

/// One key of a body a move carries.
struct MovedKey {
    spelling: String,
    /// The key as read, which a destination key must not already be.
    name: String,
    value: String,
    comment: Option<String>,
}

/// The body of `entry` in an `entries` mapping, the last where several keys name it.
fn held_body(entries: &Mapping, entry: BinHash) -> Option<Mapping> {
    locate::entry_keys(entries, entry)
        .iter()
        .rev()
        .find_map(syntax::mapping_value)
}

/// Whether the manifest's `modules` is a flow list.
fn is_flow_list(doc: &Document) -> bool {
    locate::modules(doc)
        .and_then(|(_, list)| list)
        .is_some_and(|list| list.is_flow_style())
}

#[cfg(test)]
mod tests;
