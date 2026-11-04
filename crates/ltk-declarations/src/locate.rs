//! Where a manifest declares a property of an entry.
//!
//! An entry body sits under an `entries` module, or beside the `target` key of
//! a module whose chunk is the edited one, directly or in its `edits` list. In
//! a source document it sits in the root mapping or in its `edits` list. A
//! key names a property by its full path, `skinMeshProperties.selfIllumination`,
//! or by the part of it below an unsigned block key, `selfIllumination` under
//! `skinMeshProperties:`. An object a `target` module creates takes its keys in
//! the `set` of its `objects` entry, or under its class tag.

use ltk_game_data::{BinHash, EntryName, Sign, Target};
use ltk_meta::path::{PropertyPath, Segment, Subscript};
use rowan::ast::AstNode as _;
use yaml_edit::{Document, Mapping, MappingEntry, Sequence, YamlNode};

use crate::syntax::{self, Node};
use crate::{Edit, Refusal};

/// The keys of a `target` module or of a source document that are not entry names.
const MODULE_KEYS: [&str; 11] = [
    "version",
    "name",
    "target",
    "objects",
    "entries",
    "source",
    "edits",
    "overrides",
    "links",
    "+links",
    "-links",
];

/// One signed property of one entry, in the chunk a document shows.
pub(crate) struct Site<'a> {
    /// The path hash of the edited chunk. A `target` module applies to its own
    /// chunk only.
    pub(crate) chunk_hash: u64,
    pub(crate) entry: BinHash,
    pub(crate) sign: Sign,
    pub(crate) segments: Vec<Segment<'a>>,
    pub(crate) document: DocumentKind,
}

impl<'a> Site<'a> {
    /// The site that `edit` writes, looked up in a document of the kind `document`.
    pub(crate) fn of(edit: &'a Edit, document: DocumentKind) -> Self {
        Self {
            chunk_hash: edit.chunk_hash,
            entry: edit.entry.object_hash(),
            sign: edit.operation.sign(),
            segments: edit.path.segments().collect(),
            document,
        }
    }
}

/// The shape of the document a [`Site`] is looked up in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DocumentKind {
    /// A manifest, whose bodies sit in its `modules`.
    Manifest,
    /// A source document that a `source` module names, whose bodies sit in its root mapping.
    Source,
}

/// The `modules` list of a manifest and its entry in the root mapping.
pub(crate) fn modules(doc: &Document) -> Option<(MappingEntry, Option<Sequence>)> {
    let root = doc.as_mapping()?;
    let entry = syntax::entries(&root)
        .into_iter()
        .find(|entry| syntax::key_string(entry).as_deref() == Some("modules"))?;
    let list = match entry.value_node() {
        Some(YamlNode::Sequence(list)) => Some(list),
        _ => None,
    };
    Some((entry, list))
}

/// Every module mapping, in execution order.
pub(crate) fn module_mappings(doc: &Document) -> Vec<Mapping> {
    modules(doc)
        .and_then(|(_, list)| list)
        .map(|list| {
            list.values()
                .filter_map(|module| module.as_mapping().cloned())
                .collect()
        })
        .unwrap_or_default()
}

/// The bodies declaring for `site`'s entry, in execution order.
///
/// Within one binding body a creation's `set` applies before the entry edits.
fn bodies(doc: &Document, site: &Site<'_>) -> Vec<Mapping> {
    let mut bodies = Vec::new();
    if site.document == DocumentKind::Source {
        for body in source_bodies(doc) {
            binding_bodies(&body, site.entry, &mut bodies);
        }
        return bodies;
    }

    for module in module_mappings(doc) {
        if let Some(entries) = module.get_mapping("entries") {
            bodies.extend(entry_bodies(&entries, site.entry, &[]));
            continue;
        }

        for body in module_bodies(&module, site.chunk_hash) {
            binding_bodies(&body, site.entry, &mut bodies);
        }
    }
    bodies
}

/// Pushes the bodies of the binding body `body` that declare for `entry`: the `set` of each
/// creation, then each entry body.
fn binding_bodies(body: &Mapping, entry: BinHash, bodies: &mut Vec<Mapping>) {
    bodies.extend(
        object_entries(body, entry)
            .iter()
            .filter(|object| creates(object))
            .filter_map(object_set),
    );
    bodies.extend(entry_bodies(body, entry, &MODULE_KEYS));
}

/// The binding bodies of a source document: each item of its `edits`, else its root mapping.
fn source_bodies(doc: &Document) -> Vec<Mapping> {
    let Some(root) = doc.as_mapping() else {
        return Vec::new();
    };

    match root.get_sequence("edits") {
        Some(edits) => edits
            .values()
            .filter_map(|edit| edit.as_mapping().cloned())
            .collect(),
        None => vec![root],
    }
}

/// The last `objects` entry of a source document that creates `entry`.
pub(crate) fn last_source_creation(doc: &Document, entry: BinHash) -> Option<MappingEntry> {
    source_bodies(doc)
        .iter()
        .flat_map(|body| object_entries(body, entry))
        .rfind(creates)
}

/// Returns the index of the last `target` module of the chunk `chunk_hash` that creates
/// `entry`, and the source that module names if the creation is in a source document.
///
/// `source_creates` returns whether the source document a module names creates `entry`.
pub(crate) fn last_creation(
    doc: &Document,
    chunk_hash: u64,
    entry: BinHash,
    mut source_creates: impl FnMut(&str) -> bool,
) -> Option<(usize, Option<String>)> {
    let mut found = None;
    for (index, module) in module_mappings(doc).iter().enumerate() {
        if !targets(module, chunk_hash) {
            continue;
        }

        let source = module
            .get("source")
            .and_then(|source| source.as_scalar().map(yaml_edit::Scalar::as_string));
        let creates = match &source {
            Some(source) => source_creates(source),
            None => module_bodies(module, chunk_hash)
                .iter()
                .any(|body| object_entries(body, entry).iter().any(creates)),
        };
        if creates {
            found = Some((index, source));
        }
    }
    found
}

/// The binding bodies of a `target` module of the chunk `chunk_hash`: the module itself,
/// else each item of its `edits`. None for another chunk's module or a `source` one.
fn module_bodies(module: &Mapping, chunk_hash: u64) -> Vec<Mapping> {
    if !targets(module, chunk_hash) || module.get("source").is_some() {
        return Vec::new();
    }

    match module.get_sequence("edits") {
        Some(edits) => edits
            .values()
            .filter_map(|edit| edit.as_mapping().cloned())
            .collect(),
        None => vec![module.clone()],
    }
}

/// Every binding body of the `target` modules of the chunk `chunk_hash`, in execution order.
pub(crate) fn target_bodies(doc: &Document, chunk_hash: u64) -> Vec<Mapping> {
    module_mappings(doc)
        .iter()
        .flat_map(|module| module_bodies(module, chunk_hash))
        .collect()
}

/// The binding bodies of the last module, where that module is a `target` module of the
/// chunk `chunk_hash`.
pub(crate) fn trailing_target_bodies(doc: &Document, chunk_hash: u64) -> Vec<Mapping> {
    module_mappings(doc)
        .last()
        .map(|module| module_bodies(module, chunk_hash))
        .unwrap_or_default()
}

/// The entries of a body's `objects` naming `entry`, a name or its hash alike.
pub(crate) fn object_entries(body: &Mapping, entry: BinHash) -> Vec<MappingEntry> {
    body.get_mapping("objects")
        .map(|objects| {
            syntax::entries(&objects)
                .into_iter()
                .filter(|candidate| names(candidate, entry, &[]))
                .collect()
        })
        .unwrap_or_default()
}

/// Whether an `objects` entry creates its object: by `clone`, by `class`, or by a class tag
/// (`Name: !Class`), with or without a body.
pub(crate) fn creates(object: &MappingEntry) -> bool {
    match object.value_node() {
        Some(YamlNode::TaggedNode(_)) => true,
        Some(YamlNode::Mapping(body)) => body.get("clone").is_some() || body.get("class").is_some(),
        _ => false,
    }
}

/// The properties an `objects` entry sets: the body of a class-tag object, else its `set`.
pub(crate) fn object_set(object: &MappingEntry) -> Option<Mapping> {
    match object.value_node()? {
        YamlNode::TaggedNode(tagged) => tagged.as_mapping(),
        YamlNode::Mapping(body) => body.get_mapping("set"),
        _ => None,
    }
}

/// The last `objects` entry naming `entry` in a `target` module of the chunk `chunk_hash`.
pub(crate) fn last_object(doc: &Document, chunk_hash: u64, entry: BinHash) -> Option<MappingEntry> {
    target_bodies(doc, chunk_hash)
        .iter()
        .flat_map(|body| object_entries(body, entry))
        .last()
}

/// Whether `body` declares for `entry`: creates it, or edits its properties.
pub(crate) fn declares(body: &Mapping, entry: BinHash) -> bool {
    !object_entries(body, entry).is_empty() || !entry_bodies(body, entry, &MODULE_KEYS).is_empty()
}

/// Whether a module's `target` is the chunk `chunk_hash` names.
fn targets(module: &Mapping, chunk_hash: u64) -> bool {
    module
        .get("target")
        .and_then(|target| target.as_scalar().map(yaml_edit::Scalar::as_string))
        .and_then(|target| Target::try_from(target).ok())
        .is_some_and(|target| target.chunk_hash() == chunk_hash)
}

/// The bodies of `mapping`'s keys naming `entry`, a name or its hash alike.
fn entry_bodies(mapping: &Mapping, entry: BinHash, skip: &[&str]) -> Vec<Mapping> {
    syntax::entries(mapping)
        .iter()
        .filter(|candidate| names(candidate, entry, skip))
        .filter_map(syntax::mapping_value)
        .collect()
}

/// Whether a mapping entry's key is an entry name for `entry`.
fn names(candidate: &MappingEntry, entry: BinHash, skip: &[&str]) -> bool {
    syntax::key_string(candidate)
        .filter(|key| !skip.contains(&key.as_str()))
        .and_then(|key| EntryName::try_from(key).ok())
        .is_some_and(|name| name.object_hash() == entry)
}

/// The last key declaring `site`, the one whose value the build applies last.
pub(crate) fn last_key(doc: &Document, site: &Site<'_>) -> Option<MappingEntry> {
    let mut found = Vec::new();
    for body in bodies(doc, site) {
        keys_in(&body, site.sign, &site.segments, &mut found);
    }
    found.pop()
}

/// Returns the node inside a set value that `site` names, if the build applies that value
/// after every key declaring `site`.
///
/// A set value holds `site` when its key names a prefix of the path: a list item by its
/// index, a struct field by its name. Returns `None` for a site that is not a set.
pub(crate) fn last_within(doc: &Document, site: &Site<'_>) -> Option<Node> {
    if site.sign != Sign::Set {
        return None;
    }

    let mut found = Vec::new();
    for body in bodies(doc, site) {
        declarations_in(&body, site.sign, &site.segments, true, &mut found);
    }
    match found.pop()? {
        Found::Within(node) => Some(node),
        Found::Key(_) => None,
    }
}

/// A declaration of one path.
enum Found {
    /// A key whose path is the declared path.
    Key(MappingEntry),
    /// The node inside a set value that the declared path names.
    Within(Node),
}

/// The keys under `mapping` declaring `segments` with `sign`, in order.
fn keys_in(mapping: &Mapping, sign: Sign, segments: &[Segment<'_>], found: &mut Vec<MappingEntry>) {
    let mut declared = Vec::new();
    declarations_in(mapping, sign, segments, false, &mut declared);
    found.extend(
        declared
            .into_iter()
            .filter_map(|declaration| match declaration {
                Found::Key(entry) => Some(entry),
                Found::Within(_) => None,
            }),
    );
}

/// The declarations under `mapping` of `segments` with `sign`, in order. With `within`, a
/// set value that holds `segments` is one too.
fn declarations_in(
    mapping: &Mapping,
    sign: Sign,
    segments: &[Segment<'_>],
    within: bool,
    found: &mut Vec<Found>,
) {
    for entry in syntax::entries(mapping) {
        let Some(key) = syntax::key_string(&entry) else {
            continue;
        };
        let (key_sign, spelled) = Sign::of(&key);
        let Ok(path) = PropertyPath::new(spelled) else {
            continue;
        };
        let key_segments: Vec<Segment<'_>> = path.segments().collect();

        if is_prefix(&key_segments, segments) {
            if key_segments.len() == segments.len() {
                if key_sign == sign {
                    found.push(Found::Key(entry));
                }
                continue;
            }
            if key_sign != Sign::Set {
                continue;
            }
            if let Some(block) = syntax::mapping_value(&entry) {
                declarations_in(&block, sign, &segments[key_segments.len()..], within, found);
                continue;
            }
        }

        if within
            && key_sign == Sign::Set
            && let Some(node) = node_within(&entry, &key_segments, segments)
        {
            found.push(Found::Within(node));
        }
    }
}

/// The node under the value of `entry`, a key of `key_segments`, that `segments` names.
///
/// The key's last segment matches by name, and a subscript `segments` gives it picks an item
/// of the value. `None` where the key names no prefix of `segments`, or where a step reaches
/// no item or no field.
fn node_within(
    entry: &MappingEntry,
    key_segments: &[Segment<'_>],
    segments: &[Segment<'_>],
) -> Option<Node> {
    let (last, outer) = key_segments.split_last()?;
    if segments.len() <= outer.len() || !is_prefix(outer, segments) {
        return None;
    }
    let at = &segments[outer.len()];
    if last.name_hash() != at.name_hash() {
        return None;
    }

    let mut value = entry.value_node()?;
    let rest = &segments[outer.len() + 1..];
    match (&last.subscript, &at.subscript) {
        (None, Some(subscript)) => value = item(value, subscript)?,
        (held, wanted) if held == wanted && !rest.is_empty() => {}
        _ => return None,
    }

    for segment in rest {
        let fields = untagged_mapping(value)?;
        let field = syntax::entries(&fields).into_iter().find(|field| {
            syntax::key_string(field).is_some_and(|key| names_field(&key, segment))
        })?;
        value = field.value_node()?;
        if let Some(subscript) = &segment.subscript {
            value = item(value, subscript)?;
        }
    }
    Some(syntax::node(&value))
}

/// Whether the field key `key` names the field of `segment`, without a subscript.
fn names_field(key: &str, segment: &Segment<'_>) -> bool {
    PropertyPath::new(key).ok().is_some_and(|path| {
        let mut segments = path.segments();
        matches!(
            (segments.next(), segments.next()),
            (Some(field), None) if field.subscript.is_none() && field.name_hash() == segment.name_hash()
        )
    })
}

/// The item `subscript` picks from the list `value`. `None` for a map key subscript.
fn item(value: YamlNode, subscript: &Subscript<'_>) -> Option<YamlNode> {
    let Subscript::Index(index) = subscript else {
        return None;
    };
    let list = match value {
        YamlNode::Sequence(list) => list,
        YamlNode::TaggedNode(tagged) => tagged.as_sequence()?,
        _ => return None,
    };
    list.values().nth(usize::try_from(*index).ok()?)
}

/// The mapping of `value`, under its tag where it has one.
fn untagged_mapping(value: YamlNode) -> Option<Mapping> {
    match value {
        YamlNode::Mapping(mapping) => Some(mapping),
        YamlNode::TaggedNode(tagged) => tagged.as_mapping(),
        _ => None,
    }
}

/// Whether `prefix` names the first segments of `segments`, names compared by
/// hash.
fn is_prefix(prefix: &[Segment<'_>], segments: &[Segment<'_>]) -> bool {
    prefix.len() <= segments.len()
        && prefix
            .iter()
            .zip(segments)
            .all(|(a, b)| a.name_hash() == b.name_hash() && a.subscript == b.subscript)
}

/// The body of `entry` in the last `entries` module naming it, and that module's index.
pub(crate) fn last_entries_body(doc: &Document, entry: BinHash) -> Option<(usize, Mapping)> {
    module_mappings(doc)
        .iter()
        .enumerate()
        .filter_map(|(index, module)| Some((index, module.get_mapping("entries")?)))
        .flat_map(|(index, entries)| {
            entry_bodies(&entries, entry, &[])
                .into_iter()
                .map(move |body| (index, body))
        })
        .last()
}

/// The entries mapping of the last module and its index, where that module is an
/// `entries` module.
pub(crate) fn trailing_entries(doc: &Document) -> Option<(usize, Mapping)> {
    let mut modules = module_mappings(doc);
    let index = modules.len().checked_sub(1)?;
    Some((index, modules.pop()?.get_mapping("entries")?))
}

/// The `SEQUENCE_ENTRY` node of every module, in execution order.
pub(crate) fn module_items(doc: &Document) -> Vec<Node> {
    modules(doc)
        .and_then(|(_, list)| list)
        .map(|list| syntax::sequence_entries(list.syntax()))
        .unwrap_or_default()
}

/// The mapping of the module at `index`.
pub(crate) fn module_at(doc: &Document, index: usize) -> Result<Mapping, Refusal> {
    module_mappings(doc)
        .into_iter()
        .nth(index)
        .ok_or(Refusal::NoModule(index))
}

/// The entries mapping of the `entries` module at `index`.
pub(crate) fn entries_at(doc: &Document, index: usize) -> Result<Mapping, Refusal> {
    module_at(doc, index)?
        .get_mapping("entries")
        .ok_or(Refusal::NotEntriesModule(index))
}

/// The index of the module holding `node`.
pub(crate) fn module_of(doc: &Document, node: &Node) -> Option<usize> {
    let modules: Vec<Node> = module_mappings(doc)
        .iter()
        .map(|module| module.syntax().clone())
        .collect();
    node.ancestors()
        .find_map(|ancestor| modules.iter().position(|module| *module == ancestor))
}

/// The keys of an `entries` mapping naming `entry`, a name or its hash alike.
pub(crate) fn entry_keys(entries: &Mapping, entry: BinHash) -> Vec<MappingEntry> {
    syntax::entries(entries)
        .into_iter()
        .filter(|candidate| names(candidate, entry, &[]))
        .collect()
}

/// The keys declaring `segments` with `sign` in the bodies of `entry` under `entries`.
pub(crate) fn keys_in_entries(
    entries: &Mapping,
    entry: BinHash,
    sign: Sign,
    segments: &[Segment<'_>],
) -> Vec<MappingEntry> {
    let mut found = Vec::new();
    for body in entry_bodies(entries, entry, &[]) {
        keys_in(&body, sign, segments, &mut found);
    }
    found
}

/// The deepest unsigned block under `mapping` whose key names a prefix of
/// `segments`, with the segments below it. `mapping` itself where none does.
pub(crate) fn deepest_block<'s, 'p>(
    mapping: &Mapping,
    segments: &'s [Segment<'p>],
) -> (Mapping, &'s [Segment<'p>]) {
    let mut found = None;
    for entry in syntax::entries(mapping) {
        let Some(key) = syntax::key_string(&entry) else {
            continue;
        };
        let (key_sign, spelled) = Sign::of(&key);
        let Ok(path) = PropertyPath::new(spelled) else {
            continue;
        };
        let key_segments: Vec<Segment<'_>> = path.segments().collect();
        if key_sign == Sign::Set
            && key_segments.len() < segments.len()
            && is_prefix(&key_segments, segments)
            && let Some(block) = syntax::mapping_value(&entry)
        {
            found = Some((block, key_segments.len()));
        }
    }
    match found {
        Some((block, used)) => deepest_block(&block, &segments[used..]),
        None => (mapping.clone(), segments),
    }
}
