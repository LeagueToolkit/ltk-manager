//! Where a declarations document spells its modules, entries and keys.
//!
//! [`Layout`] reads the same lossless tree the writer edits through, and answers the byte
//! range of what a loaded [`ltk_game_data::Declarations`] holds. The loaded declarations say
//! what a document means, and the layout says where it says it.

use std::ops::Range;

use ltk_game_data::{EntryName, Sign};
use ltk_meta::path::{PropertyPath, Segment};
use rowan::ast::AstNode as _;
use yaml_edit::{Document, Mapping, MappingEntry};

use crate::Refusal;
use crate::document_text::DocumentText;
use crate::syntax;

/// The keys of a `target` body that are not entry names.
const BINDING_KEYS: [&str; 8] = [
    "target",
    "entries",
    "source",
    "edits",
    "overrides",
    "links",
    "+links",
    "-links",
];

/// Where one entry body sits in a manifest or in a source document.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BodyAt {
    /// The `entries` mapping of the manifest's module `module`.
    Entries {
        /// The module's position in `modules`.
        module: usize,
    },
    /// Edit `edit` of the manifest's `target` module `module`: its compact body, or an item
    /// of its `edits` list.
    Target {
        /// The module's position in `modules`.
        module: usize,
        /// The edit's position in the module.
        edit: usize,
    },
    /// Edit `edit` of a source document: its root body, or an item of its `edits` list.
    Source {
        /// The edit's position in the document.
        edit: usize,
    },
}

/// Which mapping of a body names an entry.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub enum Binding {
    /// A key of the body itself, whose value is the entry's properties.
    #[default]
    Entry,
    /// A key of the body's `objects` mapping, whose `set` is the object's properties.
    Object,
}

/// One signed property key as a document spells it.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct KeyLayout {
    /// From the key's first byte to the end of its value's last line.
    pub span: Range<usize>,
    /// The value as a standalone YAML text, empty for a key with no value.
    pub value: String,
}

/// A declarations document parsed for the byte ranges of what it declares.
///
/// Every range indexes [`Layout::text`], which is the parsed text with `\r\n` read as `\n`.
#[derive(Debug)]
pub struct Layout {
    text: DocumentText,
    doc: Document,
}

impl Layout {
    /// The layout of a manifest or a source document.
    ///
    /// # Errors
    ///
    /// [`Refusal::Syntax`] for text that is not YAML, and [`Refusal::NoDocument`] for text
    /// that holds no document.
    pub fn parse(text: &str) -> Result<Self, Refusal> {
        let text = DocumentText::new(text.replace("\r\n", "\n"));
        let doc = text.parse()?;

        Ok(Self { text, doc })
    }

    /// The parsed text, lines ending in `\n`.
    #[must_use]
    pub fn text(&self) -> &str {
        self.text.as_str()
    }

    /// The first line of the manifest's module `module`.
    #[must_use]
    pub fn module(&self, module: usize) -> Option<Range<usize>> {
        let mapping = self.module_mapping(module)?;
        let node = mapping.syntax();
        let start = syntax::start(node);

        Some(start..self.first_line_end(start))
    }

    /// The comment lines directly above the manifest's module `module`, without their `#`.
    ///
    /// These are the lines a module action carries with the module. A blank line or any
    /// other line ends them, and `None` stands for a module with none.
    #[must_use]
    pub fn module_note(&self, module: usize) -> Option<String> {
        let mapping = self.module_mapping(module)?;
        let text = self.text.as_str();
        let first_line = self.text.line_start(syntax::start(mapping.syntax()));

        let mut lines = Vec::new();
        let mut end = first_line;
        while end > 0 {
            let start = self.text.line_start(end - 1);
            let Some(comment) = text[start..end].trim().strip_prefix('#') else {
                break;
            };

            lines.push(comment.strip_prefix(' ').unwrap_or(comment).trim_end());
            end = start;
        }

        if lines.is_empty() {
            return None;
        }

        lines.reverse();
        Some(lines.join("\n"))
    }

    /// The key naming `entry` in the body at `body`.
    #[must_use]
    pub fn entry(&self, body: BodyAt, binding: Binding, entry: &EntryName) -> Option<Range<usize>> {
        let found = self.entry_key(body, binding, entry)?;
        let start = syntax::start(found.syntax());

        Some(start..self.first_line_end(start))
    }

    /// The property key `key`, signed as spelled, of `entry` in the body at `body`.
    ///
    /// A key is compared by its text, else by its sign and the hashes of its path, so
    /// `+Skin.a` finds `+skin.a`.
    #[must_use]
    pub fn key(
        &self,
        body: BodyAt,
        binding: Binding,
        entry: &EntryName,
        key: &str,
    ) -> Option<KeyLayout> {
        let found = self.entry_key(body, binding, entry)?;
        let mut properties = syntax::mapping_value(&found)?;
        if binding == Binding::Object {
            properties = properties.get_mapping("set")?;
        }

        let property = syntax::entries(&properties).into_iter().find(|candidate| {
            syntax::key_string(candidate).is_some_and(|spelled| same_key(&spelled, key))
        })?;
        let node = property.syntax();
        let value = property
            .value_node()
            .map(|value| self.text.standalone(&syntax::node(&value)))
            .unwrap_or_default();

        Some(KeyLayout {
            span: syntax::start(node)..syntax::line_end(node),
            value,
        })
    }

    /// The end of the line `start` is on, before its newline.
    fn first_line_end(&self, start: usize) -> usize {
        let text = self.text.as_str();
        text[start..]
            .find('\n')
            .map_or(text.len(), |newline| start + newline)
    }

    /// The manifest's module `module` as a mapping.
    fn module_mapping(&self, module: usize) -> Option<Mapping> {
        let (_, list) = crate::locate::modules(&self.doc)?;
        list?.values().nth(module)?.as_mapping().cloned()
    }

    /// The mapping holding the entry keys of the body at `body`.
    fn body(&self, body: BodyAt) -> Option<Mapping> {
        match body {
            BodyAt::Entries { module } => self.module_mapping(module)?.get_mapping("entries"),
            BodyAt::Target { module, edit } => nth_edit(&self.module_mapping(module)?, edit),
            BodyAt::Source { edit } => nth_edit(&self.doc.as_mapping()?, edit),
        }
    }

    /// The key naming `entry` in the body at `body`.
    fn entry_key(&self, body: BodyAt, binding: Binding, entry: &EntryName) -> Option<MappingEntry> {
        let mut holder = self.body(body)?;
        let skip: &[&str] = match (body, binding) {
            (_, Binding::Object) => {
                holder = holder.get_mapping("objects")?;
                &[]
            }
            (BodyAt::Entries { .. }, Binding::Entry) => &[],
            (_, Binding::Entry) => &BINDING_KEYS,
        };
        let hash = entry.object_hash();

        syntax::entries(&holder).into_iter().find(|candidate| {
            syntax::key_string(candidate)
                .filter(|key| !skip.contains(&key.as_str()))
                .and_then(|key| EntryName::try_from(key).ok())
                .is_some_and(|name| name.object_hash() == hash)
        })
    }
}

/// Edit `edit` of a body holder: an item of its `edits` list, or itself as the only edit.
fn nth_edit(holder: &Mapping, edit: usize) -> Option<Mapping> {
    if let Some(edits) = holder.get_sequence("edits") {
        return edits.values().nth(edit)?.as_mapping().cloned();
    }

    (edit == 0).then(|| holder.clone())
}

/// Whether two signed keys name one property with one sign.
fn same_key(spelled: &str, key: &str) -> bool {
    if spelled == key {
        return true;
    }

    let (sign, path) = Sign::of(spelled);
    let (key_sign, key_path) = Sign::of(key);
    if sign != key_sign {
        return false;
    }
    let (Ok(path), Ok(key_path)) = (PropertyPath::new(path), PropertyPath::new(key_path)) else {
        return false;
    };

    let segments: Vec<Segment<'_>> = path.segments().collect();
    let key_segments: Vec<Segment<'_>> = key_path.segments().collect();
    segments.len() == key_segments.len()
        && segments
            .iter()
            .zip(&key_segments)
            .all(|(a, b)| a.name_hash() == b.name_hash() && a.subscript == b.subscript)
}

#[cfg(test)]
mod tests;
