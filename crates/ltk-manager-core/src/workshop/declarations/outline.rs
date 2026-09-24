//! Each layer's declarations manifest as the modules, entries and keys it declares.
//!
//! The meaning comes from `load_layer`, as a build reads it, and the place of each part from
//! `ltk_declarations::Layout` over the manifest's text.

use std::fmt::Write as _;
use std::ops::Range;

use camino::Utf8Path;
use fs_err as fs;
use ltk_declarations::{Binding, BodyAt, Layout};
use ltk_game_data::{
    EntryName, Error as GameDataError, MANIFEST_NAMES, Module, ObjectEdit, PropertyEdit, Selector,
};
use ltk_meta::path::{PropertyPath, Subscript};
use ltk_mod_project::game_data::load_layer;
use ltk_mod_project::{ModIgnore, ModProjectLayer};
use serde::Serialize;

use super::ProjectDir;
use crate::bin_document::{DeclaredSign, hex};
use crate::error::{AppResult, Utf8PathRefExt as _};

/// One layer's declarations manifest, read for an outline.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct DeclarationsLayer {
    pub layer: String,
    /// The manifest's path inside the layer, `None` for a layer with none.
    pub file: Option<String>,
    /// The manifest's text with `\r\n` read as `\n`, which every span indexes.
    pub text: Option<String>,
    /// Why the declarations do not load. `modules` is empty beside one.
    pub error: Option<DeclarationsLoadError>,
    /// The modules in execution order.
    pub modules: Vec<DeclaredModule>,
}

/// Why a layer's declarations do not load, and where.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct DeclarationsLoadError {
    pub message: String,
    /// The file the error is in, as the loader names it: the manifest's name or a source path.
    pub document: Option<String>,
    /// Where in the manifest, `None` for an error in another file or at no place.
    pub span: Option<LineSpan>,
}

/// A range of a text by one-based lines and one-based character columns, the end exclusive.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct LineSpan {
    pub line: u32,
    pub column: u32,
    pub end_line: u32,
    pub end_column: u32,
}

/// Which selector a module holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum ModuleSelector {
    /// One chunk, named by `target`.
    Target,
    /// Named entries in every chunk that declares them.
    Entries,
}

/// One module of a manifest.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct DeclaredModule {
    /// The module's position in `modules`, zero-based.
    pub index: u32,
    /// The module's own name, where the manifest spells one.
    pub name: Option<String>,
    pub selector: ModuleSelector,
    /// The chunk a `target` module edits, as spelled.
    pub target: Option<String>,
    /// The path hash of the chunk a `target` module edits, 16 lowercase hex digits.
    pub target_hash: Option<String>,
    /// The source file holding the module's edits. The spans of its entries and keys are
    /// `None`, since they sit in that file.
    pub source: Option<String>,
    /// The override files the module names, layer-relative.
    pub overrides: Vec<String>,
    /// The module's first line.
    pub span: Option<LineSpan>,
    pub entries: Vec<DeclaredEntry>,
}

/// One entry a module declares properties of, or one object it creates or removes.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct DeclaredEntry {
    /// The entry name as spelled.
    pub name: String,
    /// The object's path hash, `0x` and eight hex digits.
    pub hash: String,
    /// The edit of a `target` module the entry sits in, zero-based.
    pub edit: u32,
    /// What an `objects` binding does to the object, `None` for an entry body.
    pub object: Option<DeclaredObjectEdit>,
    /// The line naming the entry.
    pub span: Option<LineSpan>,
    pub keys: Vec<DeclaredKey>,
}

/// What an `objects` binding does to one object.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum DeclaredObjectEdit {
    /// A copy of the entry `source`.
    Clone { source: String },
    /// A new object of `class`.
    Construct { class: String },
    /// The object's removal.
    Remove,
}

/// One signed property key of an entry body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct DeclaredKey {
    /// The key as the build reads it, sign included.
    pub key: String,
    pub sign: DeclaredSign,
    /// The property path, without the sign.
    pub path: String,
    /// The value as YAML text: the manifest's own spelling where it is in the manifest.
    pub value: String,
    /// The wire path of the row the key reaches, cut before the first map key, which only
    /// the bin itself can spell.
    pub row: String,
    /// From the key to the end of its value.
    pub span: Option<LineSpan>,
}

impl ProjectDir {
    /// Every layer's declarations manifest, in build order.
    ///
    /// # Errors
    ///
    /// The project's config or its `.modignore` does not read. A manifest that does not load
    /// is reported on its layer.
    pub fn declarations_outline(&self) -> AppResult<Vec<DeclarationsLayer>> {
        let root = self.path().try_as_utf8("project directory")?;
        let mut layers = self.config()?.layers;
        layers.sort_by(ModProjectLayer::apply_order);
        let ignore = self.ignore_filter()?;

        Ok(layers
            .iter()
            .map(|layer| layer_outline(root, &layer.name, &ignore))
            .collect())
    }
}

/// The outline of the layer `layer` of the project at `root`.
fn layer_outline(root: &Utf8Path, layer: &str, ignore: &ModIgnore) -> DeclarationsLayer {
    let directory = ModProjectLayer::content_path(root, layer);
    let file = MANIFEST_NAMES
        .iter()
        .copied()
        .find(|name| directory.join(name).exists());
    let raw = file.and_then(|name| fs::read_to_string(directory.join(name)).ok());
    let layout = raw.as_deref().and_then(|text| Layout::parse(text).ok());
    let text = raw.as_ref().map(|text| text.replace("\r\n", "\n"));

    let (modules, error) = match load_layer(root, layer, ignore).declarations {
        Ok(Some(declarations)) => {
            let place = Place {
                layout: layout.as_ref(),
            };
            let modules = declarations
                .modules
                .iter()
                .map(|module| place.module(module))
                .collect();
            (modules, None)
        }
        Ok(None) => (Vec::new(), None),
        Err(error) => {
            let in_manifest = error
                .location
                .document
                .as_deref()
                .is_none_or(|document| Some(document) == file);
            let span = in_manifest
                .then(|| error_span(&error, raw.as_deref(), layout.as_ref()))
                .flatten();
            let failure = DeclarationsLoadError {
                message: error.to_string(),
                document: error.location.document.clone(),
                span,
            };
            (Vec::new(), Some(failure))
        }
    };

    DeclarationsLayer {
        layer: layer.to_owned(),
        file: file.map(str::to_owned),
        text,
        error,
        modules,
    }
}

/// Where in the manifest a load error is: the span the parser reports, else the key, the
/// entry or the module its location names.
fn error_span(
    error: &GameDataError,
    raw: Option<&str>,
    layout: Option<&Layout>,
) -> Option<LineSpan> {
    let location = &error.location;
    if let (Some(span), Some(raw)) = (location.span, raw) {
        let text = raw.replace("\r\n", "\n");
        let unfold = |at: usize| at - raw[..at.min(raw.len())].matches("\r\n").count();
        return Some(LineSpan::of(&text, unfold(span.start)..unfold(span.end)));
    }

    let layout = layout?;
    let module = location.module?;
    let bodies = [
        BodyAt::Target {
            module,
            edit: location.edit.unwrap_or(0),
        },
        BodyAt::Entries { module },
    ];
    let entry = location
        .entry
        .as_deref()
        .and_then(|entry| EntryName::try_from(entry).ok());

    let at_key = entry
        .as_ref()
        .zip(location.key.as_deref())
        .and_then(|(entry, key)| {
            bodies
                .iter()
                .find_map(|body| layout.key(*body, Binding::Entry, entry, key))
                .map(|key| key.span)
        });
    let at_entry = || {
        let entry = entry.as_ref()?;
        bodies
            .iter()
            .find_map(|body| layout.entry(*body, Binding::Entry, entry))
    };
    let range = at_key.or_else(at_entry).or_else(|| layout.module(module))?;

    Some(LineSpan::of(layout.text(), range))
}

/// The manifest's layout, which places what the loaded declarations hold.
#[derive(Clone, Copy)]
struct Place<'a> {
    layout: Option<&'a Layout>,
}

impl Place<'_> {
    fn module(self, module: &Module) -> DeclaredModule {
        let index = module.origin.module_index;
        let source = module.origin.source.clone();
        let span = self.span(self.layout.and_then(|layout| layout.module(index)));

        /* A source module's entries sit in the source file, which this layout is not. */
        let inner = Place {
            layout: self.layout.filter(|_| source.is_none()),
        };

        let (selector, target, overrides, entries) = match &module.selector {
            Selector::Entries(named) => {
                let body = BodyAt::Entries { module: index };
                let entries = named
                    .iter()
                    .map(|(name, edit)| inner.entry(body, 0, name, None, &edit.properties))
                    .collect();
                (ModuleSelector::Entries, None, Vec::new(), entries)
            }
            Selector::Target { target, edits } => {
                let mut entries = Vec::new();
                let mut overrides = Vec::new();
                for (at, edit) in edits.iter().enumerate() {
                    let body = BodyAt::Target {
                        module: index,
                        edit: at,
                    };
                    for (name, properties) in &edit.entries {
                        entries.push(inner.entry(body, at, name, None, properties));
                    }
                    for (name, object) in &edit.objects {
                        let properties = object.properties();
                        entries.push(inner.entry(body, at, name, Some(object), properties));
                    }
                    overrides.extend(edit.overrides.iter().map(|path| path.as_str().to_owned()));
                }
                (ModuleSelector::Target, Some(target), overrides, entries)
            }
            _ => (ModuleSelector::Target, None, Vec::new(), Vec::new()),
        };

        DeclaredModule {
            index: count(index),
            name: module.name.as_ref().map(|name| name.as_str().to_owned()),
            selector,
            target_hash: target.map(|target| format!("{:016x}", target.chunk_hash())),
            target: target.map(|target| target.as_str().to_owned()),
            source,
            overrides,
            span,
            entries,
        }
    }

    fn entry(
        self,
        body: BodyAt,
        edit: usize,
        name: &EntryName,
        object: Option<&ObjectEdit>,
        properties: &[PropertyEdit],
    ) -> DeclaredEntry {
        let binding = match object {
            Some(_) => Binding::Object,
            None => Binding::Entry,
        };
        let span = self.span(
            self.layout
                .and_then(|layout| layout.entry(body, binding, name)),
        );
        let keys = properties
            .iter()
            .map(|property| self.key(body, binding, name, property))
            .collect();

        DeclaredEntry {
            name: name.as_str().to_owned(),
            hash: hex(name.object_hash()),
            edit: count(edit),
            object: object.and_then(object_edit),
            span,
            keys,
        }
    }

    fn key(
        self,
        body: BodyAt,
        binding: Binding,
        entry: &EntryName,
        property: &PropertyEdit,
    ) -> DeclaredKey {
        let key = property.key();
        let spelled = self
            .layout
            .and_then(|layout| layout.key(body, binding, entry, &key));
        let value = match &spelled {
            Some(spelled) if !spelled.value.is_empty() => spelled.value.clone(),
            _ => property
                .value
                .to_yaml()
                .unwrap_or_default()
                .trim_end()
                .to_owned(),
        };

        DeclaredKey {
            sign: property.sign.into(),
            path: property.path.as_str().to_owned(),
            value,
            row: row_path(&property.path),
            span: self.span(spelled.map(|spelled| spelled.span)),
            key,
        }
    }

    fn span(self, range: Option<Range<usize>>) -> Option<LineSpan> {
        Some(LineSpan::of(self.layout?.text(), range?))
    }
}

impl LineSpan {
    /// The lines and columns of the byte range `range` of `text`.
    fn of(text: &str, range: Range<usize>) -> Self {
        let (line, column) = line_column(text, range.start);
        let (end_line, end_column) = line_column(text, range.end.max(range.start));

        Self {
            line,
            column,
            end_line,
            end_column,
        }
    }
}

/// The one-based line and character column of the byte `at` of `text`.
fn line_column(text: &str, at: usize) -> (u32, u32) {
    let mut at = at.min(text.len());
    while !text.is_char_boundary(at) {
        at -= 1;
    }

    let before = &text[..at];
    let line_start = before.rfind('\n').map_or(0, |newline| newline + 1);
    let line = before.matches('\n').count() + 1;
    let column = before[line_start..].chars().count() + 1;

    (count(line), count(column))
}

/// What an `objects` binding does, for the wire. `None` for an edit this reader does not know.
fn object_edit(object: &ObjectEdit) -> Option<DeclaredObjectEdit> {
    match object {
        ObjectEdit::Clone { source, .. } => Some(DeclaredObjectEdit::Clone {
            source: source.as_str().to_owned(),
        }),
        ObjectEdit::Construct { class, .. } => Some(DeclaredObjectEdit::Construct {
            class: class.as_str().to_owned(),
        }),
        ObjectEdit::Remove => Some(DeclaredObjectEdit::Remove),
        _ => None,
    }
}

/// The wire path a property path reaches, cut before its first map key.
fn row_path(path: &PropertyPath) -> String {
    let mut wire = String::new();
    for segment in path.segments() {
        if !wire.is_empty() {
            wire.push('.');
        }
        let _ = write!(wire, "{:08x}", *segment.name_hash());

        match segment.subscript {
            Some(Subscript::Index(index)) => {
                let _ = write!(wire, "[{index}]");
            }
            Some(Subscript::Key(_)) => break,
            None => {}
        }
    }
    wire
}

/// A count or position for the wire, which no manifest reaches the end of.
fn count(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests;
