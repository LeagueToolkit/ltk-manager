//! Names a reader typed into an open document, which no hash table contains.
//!
//! "What an edit is" in docs/ux/BIN_EDITOR.md. A name typed into a `hash`, a `link`, a field
//! or a class is hashed in Rust, and the row that contains the hash draws the name again.

use std::collections::HashMap;

use ltk_hash::{BinHash, Hash as _, WadHash};

use super::RowNames;

/// The names typed into one document, by the hash each writes.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(super) struct TypedNames {
    hashes: HashMap<BinHash, String>,
    chunks: HashMap<WadHash, String>,
}

impl TypedNames {
    /// Remember `text` as the name behind the bin hash it writes. Hex names nothing.
    pub(super) fn learn_hash(&mut self, text: &str) {
        let text = text.trim();
        if text.is_empty() || text.starts_with("0x") {
            return;
        }
        self.hashes.insert(BinHash::hash_str(text), text.to_owned());
    }

    /// Remember `text` as the path behind the chunk hash it writes. Hex names nothing.
    pub(super) fn learn_chunk(&mut self, text: &str) {
        let text = text.trim();
        let hex = text.len() == 16 && text.bytes().all(|byte| byte.is_ascii_hexdigit());
        if text.is_empty() || hex {
            return;
        }
        self.chunks.insert(WadHash::hash_str(text), text.to_owned());
    }

    /// These names over `inner`, which answers what none of them names.
    pub(super) fn over<'a>(&'a self, inner: &'a dyn RowNames) -> Typed<'a> {
        Typed { typed: self, inner }
    }
}

/// [`TypedNames`] answering first, over the names a caller passed.
pub(super) struct Typed<'a> {
    typed: &'a TypedNames,
    inner: &'a dyn RowNames,
}

/// Visit what `typed` names, and hand the rest to `rest` with their positions kept.
fn answer<H: Copy + Eq + std::hash::Hash>(
    hashes: &[H],
    typed: &HashMap<H, String>,
    visit: &mut dyn FnMut(usize, &str),
    rest: impl FnOnce(&[H], &mut dyn FnMut(usize, &str)),
) {
    if typed.is_empty() {
        rest(hashes, visit);
        return;
    }

    let mut residue = Vec::new();
    let mut at_of = Vec::new();
    for (at, hash) in hashes.iter().enumerate() {
        match typed.get(hash) {
            Some(name) => visit(at, name),
            None => {
                residue.push(*hash);
                at_of.push(at);
            }
        }
    }
    if residue.is_empty() {
        return;
    }

    rest(&residue, &mut |at, name| visit(at_of[at], name));
}

impl RowNames for Typed<'_> {
    fn for_each_entry(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        answer(hashes, &self.typed.hashes, visit, |rest, visit| {
            self.inner.for_each_entry(rest, visit);
        });
    }

    fn for_each_class(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        answer(hashes, &self.typed.hashes, visit, |rest, visit| {
            self.inner.for_each_class(rest, visit);
        });
    }

    fn for_each_field(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        answer(hashes, &self.typed.hashes, visit, |rest, visit| {
            self.inner.for_each_field(rest, visit);
        });
    }

    fn for_each_value(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        answer(hashes, &self.typed.hashes, visit, |rest, visit| {
            self.inner.for_each_value(rest, visit);
        });
    }

    fn for_each_chunk(&self, hashes: &[WadHash], visit: &mut dyn FnMut(usize, &str)) {
        answer(hashes, &self.typed.chunks, visit, |rest, visit| {
            self.inner.for_each_chunk(rest, visit);
        });
    }
}
