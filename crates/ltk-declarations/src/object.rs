//! An object edit placed in a manifest's text: an entry of a `target` module's `objects`.

use yaml_edit::Document;

use crate::document_text::DocumentText;
use crate::locate;
use crate::syntax;
use crate::{ObjectEdit, ObjectOperation, Refusal};

impl DocumentText {
    /// The text with `edit` applied.
    pub(crate) fn apply_object(&self, edit: &ObjectEdit) -> Result<Self, Refusal> {
        let body = edit.operation.body();

        if self.is_blank() {
            return Ok(match body {
                Some(body) => DocumentText::new(format!(
                    "version: 1\nmodules:\n{}",
                    syntax::layout_item(&module_text(edit, &body), 2)
                )),
                None => self.clone(),
            });
        }

        let doc = self.parse()?;
        let chunk_hash = edit.target.chunk_hash();
        let found = locate::last_object(&doc, chunk_hash, edit.entry.object_hash());
        match (found, body) {
            (Some(object), Some(body)) => self.replace_value(&object, &body),
            (Some(object), None) => Ok(self.drop_key(&doc, &object)),
            (None, Some(body)) => self.insert_object(&doc, edit, &body),
            (None, None) => Ok(self.clone()),
        }
    }

    /// The text with a new `objects` entry for `edit`.
    ///
    /// It joins the last `target` module of the chunk. A clone joins only the trailing
    /// module, and only where that module declares nothing for the clone's source: a clone
    /// reads its source as the module starts, before that module's own edits.
    fn insert_object(
        &self,
        doc: &Document,
        edit: &ObjectEdit,
        body: &str,
    ) -> Result<Self, Refusal> {
        let chunk_hash = edit.target.chunk_hash();
        let joined = match &edit.operation {
            ObjectOperation::Clone(source) => locate::trailing_target_bodies(doc, chunk_hash)
                .pop()
                .filter(|last| !locate::declares(last, source.object_hash())),
            _ => locate::target_bodies(doc, chunk_hash).pop(),
        };
        let Some(joined) = joined else {
            return self.append_module(doc, &module_text(edit, body));
        };

        let name = syntax::spell_key(edit.entry.as_str());
        match joined.get_mapping("objects") {
            Some(objects) => self.insert_entry(&objects, &name, body),
            None => {
                let object = syntax::layout_entry(&name, body, 0, None);
                self.insert_entry(&joined, "objects", object.trim_end())
            }
        }
    }
}

/// A `target` module holding one `objects` entry, as a standalone document.
fn module_text(edit: &ObjectEdit, body: &str) -> String {
    let object = syntax::layout_entry(&syntax::spell_key(edit.entry.as_str()), body, 0, None);
    let objects = syntax::layout_entry("objects", object.trim_end(), 0, None);
    format!(
        "target: {}\n{objects}",
        syntax::spell_key(edit.target.as_str())
    )
}

#[cfg(test)]
mod tests;
