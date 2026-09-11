//! The path-ordered view the objects browser reads, one prefix at a time.
//!
//! "Objects browser" in `docs/ux/PROJECT_EDITOR.md`.

use std::cmp::Ordering;

use ltk_hash::BinHash;

use crate::bin_document::hex;
use crate::utils::natural_order::compare_names;

use super::{
    NamedObject, ObjectDirListing, ObjectIndex, ObjectNodeEntry, ObjectPrefixEntry, UNNAMED_PREFIX,
};

/// Byte order with `/` below every other byte.
///
/// A node sorts before everything under it, and everything under it before any
/// sibling. One prefix's objects are one run of the sorted names.
pub(super) fn compare_paths(a: &str, b: &str) -> Ordering {
    let key = |byte: u8| if byte == b'/' { 0 } else { byte };
    a.bytes().map(key).cmp(b.bytes().map(key))
}

/// Whether `path` sits strictly below `prefix`, a non-empty path of whole segments.
fn is_under(path: &str, prefix: &str) -> bool {
    path.len() > prefix.len() && path.as_bytes()[prefix.len()] == b'/' && path.starts_with(prefix)
}

/// The segment `rest` opens with, `rest` itself where it holds no `/`.
fn first_segment(rest: &str) -> &str {
    rest.split('/').next().unwrap_or(rest)
}

/// Whether `rest` is `segment` or opens with `segment/`.
fn shares_segment(rest: &str, segment: &str) -> bool {
    rest.starts_with(segment)
        && (rest.len() == segment.len() || rest.as_bytes()[segment.len()] == b'/')
}

/// The row of the prefix `parent/segment`, folded down through every prefix under it
/// that holds one prefix and no object.
///
/// `group` is every object under the prefix, in path order, none of them at it.
fn folded_prefix(parent: &str, segment: &str, group: &[NamedObject]) -> ObjectPrefixEntry {
    let mut path = if parent.is_empty() {
        segment.to_owned()
    } else {
        format!("{parent}/{segment}")
    };
    let mut name = segment.to_owned();

    loop {
        let cut = path.len() + 1;
        let next = first_segment(&group[0].name[cut..]);
        let one_prefix = group.iter().all(|object| {
            let rest = &object.name[cut..];
            rest.len() > next.len() && shares_segment(rest, next)
        });
        if !one_prefix {
            break;
        }
        path.push('/');
        path.push_str(next);
        name.push('/');
        name.push_str(next);
    }

    ObjectPrefixEntry {
        path,
        name,
        count: group.len() as u32,
    }
}

impl ObjectIndex {
    /// What one prefix of the object tree holds, or `None` where no object path runs
    /// through it.
    ///
    /// `prefix` is `""` for the root, [`UNNAMED_PREFIX`] for the objects no table names,
    /// and otherwise a path a listing gave. An object at the prefix itself is the node's
    /// own row and not a child. A run of prefixes each holding one prefix and no object
    /// folds into one row, the game index's rule.
    #[must_use]
    pub fn object_dir(&self, prefix: &str) -> Option<ObjectDirListing> {
        if prefix == UNNAMED_PREFIX {
            return Some(ObjectDirListing {
                prefixes: Vec::new(),
                objects: self
                    .unnamed_objects()
                    .map(|object| self.unnamed_entry(object))
                    .collect(),
            });
        }

        let under = self.named_under(prefix)?;
        let cut = if prefix.is_empty() {
            0
        } else {
            prefix.len() + 1
        };
        let mut prefixes = Vec::new();
        let mut objects = Vec::new();

        let mut at = 0;
        while at < under.len() {
            let segment = first_segment(&under[at].name[cut..]);
            let end = at
                + under[at..]
                    .partition_point(|object| shares_segment(&object.name[cut..], segment));
            let group = &under[at..end];
            match group
                .first()
                .filter(|object| object.name.len() == cut + segment.len())
            {
                Some(object) => objects.push(self.node_entry(object, (group.len() - 1) as u32)),
                None => prefixes.push(folded_prefix(prefix, segment, group)),
            }
            at = end;
        }

        prefixes.sort_by(|a, b| compare_names(&a.name, &b.name));
        objects.sort_by(|a, b| compare_names(&a.name, &b.name));

        /* Last, and only at the root. The unnamed push no named path down. */
        let unnamed = self.declared.objects.len() - self.names.objects.len();
        if prefix.is_empty() && unnamed > 0 {
            prefixes.push(ObjectPrefixEntry {
                path: UNNAMED_PREFIX.to_owned(),
                name: UNNAMED_PREFIX.to_owned(),
                count: unnamed as u32,
            });
        }

        Some(ObjectDirListing { prefixes, objects })
    }

    /// The named objects strictly under `prefix`, in path order.
    ///
    /// `None` where no object sits at or under the prefix. The root is every named object.
    fn named_under(&self, prefix: &str) -> Option<&[NamedObject]> {
        let named = &self.names.named;
        if prefix.is_empty() {
            return Some(named);
        }
        let start =
            named.partition_point(|object| compare_paths(&object.name, prefix) == Ordering::Less);
        let is_node = named
            .get(start)
            .is_some_and(|object| &*object.name == prefix);
        let first = if is_node { start + 1 } else { start };
        let end = first + named[first..].partition_point(|object| is_under(&object.name, prefix));
        (is_node || end > first).then(|| &named[first..end])
    }

    /// The row of a named object with `count` objects below it.
    fn node_entry(&self, object: &NamedObject, count: u32) -> ObjectNodeEntry {
        let name = object.name.rsplit('/').next().unwrap_or(&object.name);
        ObjectNodeEntry {
            object_hash: hex(object.hash),
            path: object.name.to_string(),
            name: name.to_owned(),
            declarations: self.declarations_of(object.hash),
            count,
        }
    }

    /// The row of an object no table names, its hex for a path and a name.
    fn unnamed_entry(&self, object: BinHash) -> ObjectNodeEntry {
        let text = hex(object);
        ObjectNodeEntry {
            object_hash: text.clone(),
            path: text.clone(),
            name: text,
            declarations: self.declarations_of(object),
            count: 0,
        }
    }
}
