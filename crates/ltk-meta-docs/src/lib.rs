//! The LoL Meta Wiki's documentation for bin classes and their properties.
//!
//! The wiki serves it at `/v1/docs/all` under CC BY-SA 4.0 with the League Toolkit Developer
//! Tooling Exception, which requires only attribution from a tool that displays it.

use std::collections::{BTreeMap, HashMap};

use ltk_hash::BinHash;
use serde::{Deserialize, Deserializer, Serialize};

mod cache;

pub use cache::{
    DocsCache, FetchDocs, FetchDocsError, Fetched, PublishedDocs, REFRESH_INTERVAL, Refresh,
    RefreshError,
};

/// The wiki's documentation for one class or one property. Each part is markdown.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct Doc {
    /// The main text. Absent when the entry has only notes or examples.
    pub description: Option<String>,
    /// Short caveats, one paragraph each.
    pub notes: Vec<String>,
    /// Worked examples, one block each.
    pub examples: Vec<String>,
}

impl Doc {
    /// Whether the entry has no text.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.description
            .as_deref()
            .is_none_or(|text| text.trim().is_empty())
            && self.notes.is_empty()
            && self.examples.is_empty()
    }
}

/// The wiki's documentation for one class and the properties declared on it and its bases.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct ClassDocs {
    /// The documentation of the class itself. Absent when the wiki documents only properties.
    pub class: Option<Doc>,
    /// Keyed by the property's hash, `0x` and eight hex digits.
    pub properties: BTreeMap<String, PropertyDocs>,
}

/// The wiki's documentation for one property, and the class whose page documents it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct PropertyDocs {
    /// The declaring class as the wiki names it, or its hash where no name is known.
    pub owner: String,
    /// The property as the wiki names it, or its hash where no name is known.
    pub name: String,
    pub doc: Doc,
}

/// Why a documentation payload could not be read.
#[derive(Debug, thiserror::Error)]
#[error("meta wiki documentation")]
pub struct ParseDocsError(#[from] serde_json::Error);

/// Every class the wiki documents, keyed by hash.
#[derive(Debug, Default)]
pub struct MetaDocs {
    classes: HashMap<BinHash, ClassEntry>,
}

#[derive(Debug)]
struct ClassEntry {
    name: String,
    doc: Option<Doc>,
    properties: HashMap<BinHash, PropertyEntry>,
}

#[derive(Debug)]
struct PropertyEntry {
    name: String,
    doc: Doc,
}

/// One class of the published payload, keyed by its name or its hash.
#[derive(Deserialize)]
struct PublishedClass {
    #[serde(default)]
    class: Option<PublishedDoc>,
    #[serde(default)]
    properties: HashMap<String, PublishedDoc>,
}

/// One entry in the published format, converted into a [`Doc`].
#[derive(Deserialize)]
struct PublishedDoc {
    #[serde(default)]
    description: Option<String>,
    #[serde(default, deserialize_with = "strings")]
    notes: Vec<String>,
    #[serde(default, deserialize_with = "strings")]
    examples: Vec<String>,
}

impl From<PublishedDoc> for Doc {
    fn from(published: PublishedDoc) -> Self {
        Self {
            description: published.description,
            notes: published.notes,
            examples: published.examples,
        }
    }
}

impl MetaDocs {
    /// Parse the payload `/v1/docs/all` serves.
    ///
    /// # Errors
    ///
    /// Fails when the bytes are not that payload - see [`ParseDocsError`].
    pub fn parse(json: &[u8]) -> Result<Self, ParseDocsError> {
        let published: HashMap<String, PublishedClass> = serde_json::from_slice(json)?;

        let classes = published
            .into_iter()
            .map(|(name, class)| {
                let properties = class
                    .properties
                    .into_iter()
                    .map(|(name, doc)| (name, Doc::from(doc)))
                    .filter(|(_, doc)| !doc.is_empty())
                    .map(|(name, doc)| (key_hash(&name), PropertyEntry { name, doc }))
                    .collect();
                let entry = ClassEntry {
                    doc: class.class.map(Doc::from).filter(|doc| !doc.is_empty()),
                    name,
                    properties,
                };
                (key_hash(&entry.name), entry)
            })
            .collect();

        Ok(Self { classes })
    }

    /// How many classes the wiki documents.
    #[must_use]
    pub fn class_count(&self) -> usize {
        self.classes.len()
    }

    /// The documentation for the first class in `lineage`, with the property documentation of
    /// every class in it.
    ///
    /// `lineage` is the class and then its bases, nearest first. A property documented on two of
    /// them uses the nearer class's text. `None` when none of them is documented.
    #[must_use]
    pub fn class_docs(&self, lineage: &[BinHash]) -> Option<ClassDocs> {
        let (class, _) = lineage.split_first()?;
        let mut docs = ClassDocs {
            class: self.classes.get(class).and_then(|entry| entry.doc.clone()),
            properties: BTreeMap::new(),
        };

        for entry in lineage.iter().filter_map(|owner| self.classes.get(owner)) {
            for (hash, property) in &entry.properties {
                docs.properties
                    .entry(hex(*hash))
                    .or_insert_with(|| PropertyDocs {
                        owner: entry.name.clone(),
                        name: property.name.clone(),
                        doc: property.doc.clone(),
                    });
            }
        }

        if docs.class.is_none() && docs.properties.is_empty() {
            return None;
        }
        Some(docs)
    }
}

/// The hash for a payload key: the key parsed as hex when it starts with `0x`, otherwise the
/// hash of the name.
fn key_hash(key: &str) -> BinHash {
    key.strip_prefix("0x")
        .and_then(|hex| BinHash::from_str_radix(hex, 16).ok())
        .unwrap_or_else(|| BinHash::from(key))
}

fn hex(hash: BinHash) -> String {
    format!("0x{:08x}", hash.0)
}

/// A list of markdown strings. Entries that are not strings are skipped.
fn strings<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<String>, D::Error> {
    let values = Option::<Vec<serde_json::Value>>::deserialize(deserializer)?;
    Ok(values
        .unwrap_or_default()
        .into_iter()
        .filter_map(|value| match value {
            serde_json::Value::String(text) => Some(text),
            _ => None,
        })
        .collect())
}

#[cfg(test)]
mod tests;
