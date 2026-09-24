//! A link edit placed in a manifest's text: an item of a `target` body's `links` or `-links`.

use rowan::ast::AstNode as _;
use yaml_edit::{Document, MappingEntry, Sequence, YamlNode};

use crate::document_text::DocumentText;
use crate::locate;
use crate::syntax::{self, Node};
use crate::{LinkEdit, LinkOperation, LinkSign, Refusal};

/// The keys that list additions, `+links` being the alias of `links`.
const ADD_KEYS: [&str; 2] = ["links", "+links"];

/// The key that lists removals.
const REMOVE_KEYS: [&str; 1] = ["-links"];

impl LinkSign {
    fn keys(self) -> &'static [&'static str] {
        match self {
            Self::Add => &ADD_KEYS,
            Self::Remove => &REMOVE_KEYS,
        }
    }

    fn other(self) -> Self {
        match self {
            Self::Add => Self::Remove,
            Self::Remove => Self::Add,
        }
    }
}

impl DocumentText {
    /// The text with `edit` applied.
    pub(crate) fn apply_link(&self, edit: &LinkEdit) -> Result<Self, Refusal> {
        let sign = match edit.operation {
            LinkOperation::Add => LinkSign::Add,
            LinkOperation::Remove => LinkSign::Remove,
            LinkOperation::Drop(sign) => return self.drop_links(edit, sign),
        };

        /* The layer's own opposite item is taken back rather than answered. */
        let dropped = self.drop_links(edit, sign.other())?;
        if dropped != *self {
            return Ok(dropped);
        }
        if self.is_blank() {
            return Ok(DocumentText::with_module(&module_text(edit, sign)));
        }

        let doc = self.parse()?;
        let chunk_hash = edit.target.chunk_hash();
        if !link_items(&doc, chunk_hash, edit.path.as_str(), sign).is_empty() {
            return Ok(self.clone());
        }
        let Some(body) = locate::target_bodies(&doc, chunk_hash).pop() else {
            return self.append_module(&doc, &module_text(edit, sign));
        };

        let spelled = spell_item(edit.path.as_str());
        let held = syntax::entries(&body).into_iter().find(|entry| {
            syntax::key_string(entry).is_some_and(|key| sign.keys().contains(&key.as_str()))
        });
        match held.map(|entry| entry.value_node()) {
            Some(Some(YamlNode::Sequence(list))) => self.insert_item(&list, &spelled),
            Some(_) => Err(Refusal::MergeShape),
            None if body.is_flow_style() => {
                self.insert_entry(&body, sign.keys()[0], &format!("[{spelled}]"))
            }
            None => self.insert_entry(&body, sign.keys()[0], &format!("- {spelled}")),
        }
    }

    /// The text without any item naming `edit`'s path in the `sign` lists of the chunk's
    /// `target` bodies. A list it leaves empty goes with its key, and a module it leaves empty
    /// with it.
    fn drop_links(&self, edit: &LinkEdit, sign: LinkSign) -> Result<Self, Refusal> {
        if self.is_blank() {
            return Ok(self.clone());
        }

        let chunk_hash = edit.target.chunk_hash();
        let path = edit.path.as_str();
        let mut text = self.clone();
        loop {
            let doc = text.parse()?;
            let Some((key, list, item)) = link_items(&doc, chunk_hash, path, sign).pop() else {
                return Ok(text);
            };
            text = if syntax::sequence_entries(list.syntax()).len() == 1 {
                text.drop_key(&doc, &key)
            } else {
                text.cut(&item)
            };
        }
    }
}

/// Every item naming `path` in the `sign` lists of the `target` bodies of the chunk
/// `chunk_hash`, in order, each with its key and its list. A path compares without regard to
/// ASCII case, as the apply compares it.
fn link_items(
    doc: &Document,
    chunk_hash: u64,
    path: &str,
    sign: LinkSign,
) -> Vec<(MappingEntry, Sequence, Node)> {
    let mut found = Vec::new();
    for body in locate::target_bodies(doc, chunk_hash) {
        for key in syntax::entries(&body) {
            if !syntax::key_string(&key).is_some_and(|name| sign.keys().contains(&name.as_str())) {
                continue;
            }
            let Some(YamlNode::Sequence(list)) = key.value_node() else {
                continue;
            };
            for (item, value) in syntax::sequence_entries(list.syntax())
                .into_iter()
                .zip(list.values())
            {
                let named = value
                    .as_scalar()
                    .is_some_and(|scalar| scalar.as_string().eq_ignore_ascii_case(path));
                if named {
                    found.push((key.clone(), list.clone(), item));
                }
            }
        }
    }
    found
}

/// A `target` module holding one link list of `sign`, as a standalone document.
fn module_text(edit: &LinkEdit, sign: LinkSign) -> String {
    let links = syntax::layout_entry(
        sign.keys()[0],
        &format!("- {}", spell_item(edit.path.as_str())),
        0,
        None,
    );
    format!(
        "target: {}\n{links}",
        syntax::spell_key(edit.target.as_str())
    )
}

/// A path spelled as a list item, quoted where a flow list would split it.
fn spell_item(path: &str) -> String {
    if path.contains([',', '[', ']']) {
        return format!("'{}'", path.replace('\'', "''"));
    }
    syntax::spell_key(path).into_owned()
}

#[cfg(test)]
mod tests;
