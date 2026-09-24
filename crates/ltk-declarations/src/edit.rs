//! An edit placed in a manifest's text.
//!
//! Every method here reads ranges from a fresh parse of the text and returns a
//! new text. None edits the tree.

use ltk_game_data::{EntryName, ModuleName, Sign};
use ltk_meta::path::Segment;
use rowan::ast::AstNode as _;
use yaml_edit::{Document, Mapping, MappingEntry, Sequence, SyntaxKind, YamlNode};

use crate::document_text::DocumentText;
use crate::locate::{self, Site};
use crate::syntax::{self, Node};
use crate::{Edit, ModuleChoice, Operation, Refusal, ValueText};

impl DocumentText {
    /// The text with `edit` applied, and the index of the module holding the key it wrote.
    /// `None` for a drop, which writes no key.
    pub(crate) fn apply(&self, edit: &Edit) -> Result<(Self, Option<usize>), Refusal> {
        let site = Site {
            chunk_hash: edit.chunk_hash,
            entry: edit.entry.object_hash(),
            sign: edit.operation.sign(),
            segments: edit.path.segments().collect(),
        };
        let value = edit.operation.value().map(ValueText::as_str);

        if self.is_blank() {
            return match (value, &edit.module) {
                (None, _) => Ok((self.clone(), None)),
                (Some(_), ModuleChoice::Index(index)) => Err(Refusal::NoModule(*index)),
                (Some(value), ModuleChoice::Auto) => {
                    Ok((new_manifest(None, &edit.entry, &site, value), Some(0)))
                }
                (Some(value), ModuleChoice::New(name)) => Ok((
                    new_manifest(name.as_ref(), &edit.entry, &site, value),
                    Some(0),
                )),
            };
        }

        let doc = self.parse()?;
        let key = locate::last_key(&doc, &site);
        let holder = key
            .as_ref()
            .and_then(|key| locate::module_of(&doc, key.syntax()));
        match (&edit.operation, key, value) {
            (Operation::Set(_), Some(key), Some(value)) => {
                Ok((self.replace_value(&key, value)?, holder))
            }
            (Operation::Add(_) | Operation::Remove(_), Some(_), Some(value)) => {
                Ok((self.merge(&site, value)?, holder))
            }
            (Operation::Drop(_), Some(key), _) => Ok((self.drop_key(&doc, &key), None)),
            (_, None, Some(value)) => self
                .insert(&doc, &site, &edit.entry, value, &edit.module)
                .map(|(text, module)| (text, Some(module))),
            (_, _, None) => Ok((self.clone(), None)),
        }
    }

    /// The text with a key for `site` added in the module `choice` names, and that module's
    /// index.
    fn insert(
        &self,
        doc: &Document,
        site: &Site<'_>,
        entry: &EntryName,
        value: &str,
        choice: &ModuleChoice,
    ) -> Result<(Self, usize), Refusal> {
        let created = locate::last_object(doc, site.chunk_hash, site.entry).and_then(|object| {
            Some((
                locate::module_of(doc, object.syntax())?,
                locate::creation(&object)?,
            ))
        });
        if let Some((index, object)) = created {
            return Ok((self.insert_set(&object, site, value)?, index));
        }

        match choice {
            ModuleChoice::Auto => {}
            ModuleChoice::Index(index) => {
                let entries = locate::entries_at(doc, *index)?;
                let text = self.insert_in_entries(
                    &entries,
                    site,
                    &syntax::spell_key(entry.as_str()),
                    value,
                )?;
                return Ok((text, *index));
            }
            ModuleChoice::New(name) => {
                let index = locate::module_items(doc).len();
                let module = module_text(name.as_ref(), entry, site, value);
                return Ok((self.append_module(doc, &module)?, index));
            }
        }

        if let Some((index, body)) = locate::last_entries_body(doc, site.entry) {
            let (block, rest) = locate::deepest_block(&body, &site.segments);
            let text = self.insert_entry(&block, &key_for(site.sign, rest), value)?;
            return Ok((text, index));
        }
        if let Some((index, entries)) = locate::trailing_entries(doc) {
            let text =
                self.insert_in_entries(&entries, site, &syntax::spell_key(entry.as_str()), value)?;
            return Ok((text, index));
        }
        let index = locate::module_items(doc).len();
        let module = module_text(None, entry, site, value);
        Ok((self.append_module(doc, &module)?, index))
    }

    /// The text with a key for `site` in `entries`, an `entries` module's mapping: in the
    /// deepest block of the entry's last body there, else in a new body keyed `spelled`.
    pub(crate) fn insert_in_entries(
        &self,
        entries: &Mapping,
        site: &Site<'_>,
        spelled: &str,
        value: &str,
    ) -> Result<Self, Refusal> {
        if let Some(body) = locate::entry_keys(entries, site.entry)
            .iter()
            .rev()
            .find_map(syntax::mapping_value)
        {
            let (block, rest) = locate::deepest_block(&body, &site.segments);
            return self.insert_entry(&block, &key_for(site.sign, rest), value);
        }
        let body = syntax::layout_entry(&key_for(site.sign, &site.segments), value, 0, None);
        self.insert_entry(entries, spelled, body.trim_end())
    }

    /// The text with a key for `site` in the `set` of `object`, a creation's body.
    fn insert_set(&self, object: &Mapping, site: &Site<'_>, value: &str) -> Result<Self, Refusal> {
        if let Some(set) = object.get_mapping("set") {
            let (block, rest) = locate::deepest_block(&set, &site.segments);
            return self.insert_entry(&block, &key_for(site.sign, rest), value);
        }

        let body = syntax::layout_entry(&key_for(site.sign, &site.segments), value, 0, None);
        self.insert_entry(object, "set", body.trim_end())
    }

    /// The text with `key: value` as the last entry of `mapping`.
    pub(crate) fn insert_entry(
        &self,
        mapping: &Mapping,
        key: &str,
        value: &str,
    ) -> Result<Self, Refusal> {
        self.insert_entry_commented(mapping, key, value, None)
    }

    /// As [`DocumentText::insert_entry`], `comment` beside the key's line in a block mapping.
    pub(crate) fn insert_entry_commented(
        &self,
        mapping: &Mapping,
        key: &str,
        value: &str,
        comment: Option<&str>,
    ) -> Result<Self, Refusal> {
        let entries = syntax::entries(mapping);
        let (Some(first), Some(last), false) =
            (entries.first(), entries.last(), mapping.is_flow_style())
        else {
            if !syntax::is_inline(value) {
                return Err(Refusal::FlowValue);
            }
            let close = before_closing(mapping.syntax(), SyntaxKind::RIGHT_BRACE)?;
            let separator = if entries.is_empty() { "" } else { ", " };
            return Ok(self.splice(close, close, &format!("{separator}{key}: {value}")));
        };
        Ok(self.insert_lines(
            syntax::line_end(last.syntax()),
            &syntax::layout_entry(key, value, self.column(first.syntax()), comment),
        ))
    }

    /// The text with `item` as the last element of `list`.
    pub(crate) fn insert_item(&self, list: &Sequence, item: &str) -> Result<Self, Refusal> {
        let items = syntax::sequence_entries(list.syntax());
        let (Some(first), Some(last), false) = (items.first(), items.last(), list.is_flow_style())
        else {
            if !syntax::is_inline(item) {
                return Err(Refusal::FlowValue);
            }
            let close = before_closing(list.syntax(), SyntaxKind::RIGHT_BRACKET)?;
            let separator = if items.is_empty() { "" } else { ", " };
            return Ok(self.splice(close, close, &format!("{separator}{item}")));
        };
        Ok(self.insert_lines(
            syntax::line_end(last),
            &syntax::layout_item(item, self.column(first)),
        ))
    }

    /// The text with `module` as the last item of `modules`.
    pub(crate) fn append_module(&self, doc: &Document, module: &str) -> Result<Self, Refusal> {
        let root = doc.as_mapping().ok_or(Refusal::RootNotMapping)?;
        let Some((entry, list)) = locate::modules(doc) else {
            let at = syntax::entries(&root)
                .last()
                .map_or(self.as_str().len(), |last| syntax::line_end(last.syntax()));
            let lines = format!("modules:\n{}", syntax::layout_item(module, 2));
            return Ok(self.insert_lines(at, &lines));
        };
        let items = list
            .as_ref()
            .map(|list| syntax::sequence_entries(list.syntax()))
            .unwrap_or_default();
        match (list, items.first(), items.last()) {
            (Some(list), Some(first), Some(last)) if !list.is_flow_style() => Ok(self
                .insert_lines(
                    syntax::line_end(last),
                    &syntax::layout_item(module, self.column(first)),
                )),
            (Some(_), Some(_), _) => Err(Refusal::ModulesNotBlock),
            _ => {
                let node = entry.syntax();
                let column = self.column(node);
                let key = syntax::key_spelling(&entry).unwrap_or_else(|| "modules".to_owned());
                let lines = format!(
                    "{}{key}:\n{}",
                    " ".repeat(column),
                    syntax::layout_item(module, column + 2)
                );
                Ok(self.replace_lines(node, &lines))
            }
        }
    }

    /// The text with `entry`'s value replaced by `value`.
    ///
    /// A one-line value replaced by an inline value is spliced where it stands,
    /// which keeps the comment beside it. Otherwise the entry's lines are laid
    /// out again, the key spelled as before and the comment on its first line
    /// kept.
    pub(crate) fn replace_value(&self, entry: &MappingEntry, value: &str) -> Result<Self, Refusal> {
        let node = entry.syntax();
        let in_flow = node
            .parent()
            .and_then(Mapping::cast)
            .is_some_and(|mapping| mapping.is_flow_style());
        let inline = syntax::is_inline(value);
        if let Some(old) = entry.value_node() {
            let old = syntax::node(&old);
            let start = syntax::start(&old);
            let old_text = self.as_str()[start..syntax::end(&old)].trim_end();
            if inline && (in_flow || !old_text.contains('\n')) {
                return Ok(self.splice(start, start + old_text.len(), value));
            }
        }
        if in_flow {
            return Err(Refusal::FlowValue);
        }
        let key = syntax::key_spelling(entry).unwrap_or_default();
        let comment = self.key_line_comment(node);
        Ok(self.replace_lines(
            node,
            &syntax::layout_entry(&key, value, self.column(node), comment.as_deref()),
        ))
    }

    /// The text with an addition's or a removal's value joining the value of
    /// the signed key `site` names. A removal skips an element already listed.
    fn merge(&self, site: &Site<'_>, value: &str) -> Result<Self, Refusal> {
        let (tag, items) = items(&DocumentText::new(value))?;
        let mut text = self.clone();
        for item in items {
            let doc = text.parse()?;
            let key = locate::last_key(&doc, site).ok_or(Refusal::MergeShape)?;
            let (declared_tag, declared) = untagged(key.value_node().ok_or(Refusal::MergeShape)?);
            if tag.is_some() && declared_tag != tag {
                return Err(Refusal::MergeShape);
            }
            text = match (declared, item) {
                (
                    Some(YamlNode::Mapping(mapping)),
                    Item::Entry {
                        spelling,
                        key,
                        value,
                    },
                ) => {
                    match syntax::entries(&mapping)
                        .into_iter()
                        .find(|entry| syntax::key_string(entry).as_deref() == Some(key.as_str()))
                    {
                        Some(entry) => text.replace_value(&entry, &value)?,
                        None => text.insert_entry(&mapping, &spelling, &value)?,
                    }
                }
                (Some(YamlNode::Sequence(list)), Item::Element(element)) => {
                    let listed = list
                        .values()
                        .any(|listed| text.standalone(&syntax::node(&listed)) == element);
                    if site.sign == Sign::Remove && listed {
                        text
                    } else {
                        text.insert_item(&list, &element)?
                    }
                }
                _ => return Err(Refusal::MergeShape),
            };
        }
        Ok(text)
    }

    /// The text without `entry`, and without every body, block and module it
    /// leaves empty. A module left holding only its `target` or its `name` is empty.
    /// Removing the last module leaves `modules: []`.
    pub(crate) fn drop_key(&self, doc: &Document, entry: &MappingEntry) -> Self {
        let modules = locate::modules(doc).map(|(entry, _)| entry.syntax().clone());
        let module_mappings: Vec<Node> = locate::module_mappings(doc)
            .iter()
            .map(|module| module.syntax().clone())
            .collect();

        let mut removed = entry.syntax().clone();
        while let Some(container) = removed.parent() {
            let left: Vec<Node> = container
                .children()
                .filter(|child| {
                    matches!(
                        child.kind(),
                        SyntaxKind::MAPPING_ENTRY | SyntaxKind::SEQUENCE_ENTRY
                    ) && *child != removed
                })
                .collect();
            let empty = if module_mappings.contains(&container) {
                left.iter().all(|child| {
                    matches!(
                        MappingEntry::cast(child.clone())
                            .and_then(|entry| syntax::key_string(&entry))
                            .as_deref(),
                        Some("target" | "name")
                    )
                })
            } else {
                left.is_empty()
            };
            if !empty {
                break;
            }
            let Some(owner) = container.ancestors().skip(1).find(|ancestor| {
                matches!(
                    ancestor.kind(),
                    SyntaxKind::MAPPING_ENTRY | SyntaxKind::SEQUENCE_ENTRY
                )
            }) else {
                break;
            };
            if Some(&owner) == modules.as_ref() {
                let key = MappingEntry::cast(owner.clone())
                    .and_then(|entry| syntax::key_spelling(&entry))
                    .unwrap_or_else(|| "modules".to_owned());
                let pad = " ".repeat(self.column(&owner));
                return self.replace_lines(&owner, &format!("{pad}{key}: []\n"));
            }
            removed = owner;
        }
        if locate::module_items(doc).contains(&removed) && !node_in_flow(&removed) {
            let (start, end) = self.module_span(&removed);
            return self.splice(start, end, "");
        }
        self.cut(&removed)
    }

    /// The text without `node`: its lines in a block collection, its text and
    /// one separating comma in a flow one.
    pub(crate) fn cut(&self, node: &Node) -> Self {
        if !node_in_flow(node) {
            return self.replace_lines(node, "");
        }

        /* An entry ahead of another carries the separating `, ` as its own
        tail, and the last entry carries none: the separator it takes is the
        one ahead of it. */
        let text = self.as_str();
        let start = syntax::start(node);
        let own = text[start..syntax::end(node)].trim_end();
        if own.ends_with(',') {
            return self.splice(start, syntax::end(node), "");
        }
        let end = start + own.len();
        let after = &text[end..];
        if let Some(rest) = after.trim_start().strip_prefix(',') {
            let skip = after.len() - rest.trim_start().len();
            return self.splice(start, end + skip, "");
        }
        match text[..start].trim_end().strip_suffix(',') {
            Some(kept) => self.splice(kept.len(), end, ""),
            None => self.splice(start, end, ""),
        }
    }
}

/// Whether `node` stands in a flow collection.
fn node_in_flow(node: &Node) -> bool {
    node.parent().is_some_and(|container| {
        container.children_with_tokens().any(|child| {
            matches!(
                child.kind(),
                SyntaxKind::LEFT_BRACE | SyntaxKind::LEFT_BRACKET
            )
        })
    })
}

/// A signed key for `segments`, spelled.
pub(crate) fn key_for(sign: Sign, segments: &[Segment<'_>]) -> String {
    let path = segments
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join(".");
    syntax::spell_key(&format!("{}{path}", sign.as_str())).into_owned()
}

/// A manifest holding one module, which declares one key.
fn new_manifest(
    name: Option<&ModuleName>,
    entry: &EntryName,
    site: &Site<'_>,
    value: &str,
) -> DocumentText {
    DocumentText::with_module(&module_text(name, entry, site, value))
}

/// An `entries` module declaring one key, as a standalone document, `name` first.
fn module_text(
    name: Option<&ModuleName>,
    entry: &EntryName,
    site: &Site<'_>,
    value: &str,
) -> String {
    let body = syntax::layout_entry(&key_for(site.sign, &site.segments), value, 0, None);
    let named = syntax::layout_entry(&syntax::spell_key(entry.as_str()), body.trim_end(), 0, None);
    let mut module = name.map(syntax::name_line).unwrap_or_default();
    module.push_str(&syntax::layout_entry("entries", named.trim_end(), 0, None));
    module
}

/// Where a flow collection's last element ends: before the whitespace ahead
/// of its closing bracket.
fn before_closing(collection: &Node, kind: SyntaxKind) -> Result<usize, Refusal> {
    let children: Vec<_> = collection.children_with_tokens().collect();
    let close = children
        .iter()
        .rposition(|child| child.kind() == kind)
        .ok_or(Refusal::FlowValue)?;
    let at = children[..close]
        .iter()
        .rev()
        .take_while(|child| {
            matches!(
                child.kind(),
                SyntaxKind::WHITESPACE | SyntaxKind::NEWLINE | SyntaxKind::INDENT
            )
        })
        .last()
        .unwrap_or(&children[close]);
    Ok(at.text_range().start().into())
}

/// One element or entry of an addition or a removal.
enum Item {
    /// A map entry: its key as spelled, as read, and its value.
    Entry {
        spelling: String,
        key: String,
        value: String,
    },
    /// A list element.
    Element(String),
}

/// The tag of a value and the collection under it.
fn untagged(value: YamlNode) -> (Option<String>, Option<YamlNode>) {
    match value {
        YamlNode::TaggedNode(tagged) => {
            let inner = tagged
                .as_mapping()
                .map(YamlNode::Mapping)
                .or_else(|| tagged.as_sequence().map(YamlNode::Sequence));
            (tagged.tag(), inner)
        }
        other => (None, Some(other)),
    }
}

/// The elements or entries of an addition's or a removal's value, and its
/// tag.
fn items(value: &DocumentText) -> Result<(Option<String>, Vec<Item>), Refusal> {
    let doc = value.parse()?;
    let (tag, inner) = untagged(syntax::root(&doc).ok_or(Refusal::MergeShape)?);
    let items = match inner {
        Some(YamlNode::Mapping(mapping)) => syntax::entries(&mapping)
            .iter()
            .map(|entry| Item::Entry {
                spelling: syntax::key_spelling(entry).unwrap_or_default(),
                key: syntax::key_string(entry).unwrap_or_default(),
                value: entry.value_node().map_or_else(
                    || "null".to_owned(),
                    |node| value.standalone(&syntax::node(&node)),
                ),
            })
            .collect(),
        Some(YamlNode::Sequence(list)) => list
            .values()
            .map(|element| Item::Element(value.standalone(&syntax::node(&element))))
            .collect(),
        _ => return Err(Refusal::MergeShape),
    };
    Ok((tag, items))
}
