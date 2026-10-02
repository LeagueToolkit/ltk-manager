//! One parsed bin and the rows it projects.

use std::collections::VecDeque;
use std::io::Cursor;

use indexmap::{IndexMap, IndexSet};
use ltk_hash::{BinHash, Hash as _, WadHash};
use ltk_meta::{ApplyReport, Bin, BinFile, BinObject, PropertyValueEnum};

use super::{
    BinDocumentError, BinFileKind, BinHeader, BinObjectHeader, BinRow, BinRows, BinValue, Child,
    Lens, Node, ObjectName, READ_PAGE, READ_ROW_CAP, RowNames, RowNode, Segment, TARGET_PATH,
    Trace, Wanted, children_of, declared, descend, descend_from, edit, hex, label_of, parse_steps,
    records, typed_names,
};
use crate::meta_schema::SchemaAt;

/// One parsed bin, of either kind, and the bytes it parsed from.
#[derive(Debug)]
pub struct BinDocument {
    pub(super) file: BinFile,
    /// The bytes `file` parsed from, which a save writes the touched objects over.
    pub(super) base: Vec<u8>,
    /// The bytes the document was read from, which a save leaves as they are, for
    /// [`BinDocument::changes_from`] against the file as it was opened.
    pub(super) opened: Vec<u8>,
    /// Every object a patch touched since the base was read.
    pub(super) touched: IndexSet<BinHash>,
    /// A patch changed the header's dependency list since the base was read.
    pub(super) dependencies_touched: bool,
    /// The edits an undo reverts, the latest last, at most [`UNDO_DEPTH`].
    pub(super) undo: VecDeque<edit::Edit>,
    /// The edits a redo applies again, the latest undone last.
    pub(super) redo: Vec<edit::Edit>,
    /// The project the document declares into. Absent for every document but a game chunk
    /// opened from a project's game tree (ADR-0042).
    pub(super) declared: Option<declared::Declared>,
    /// The names typed into an edit, which draw where no table names their hash.
    pub(super) typed: typed_names::TypedNames,
}

impl BinDocument {
    /// Parse `bytes` as a bin, by its magic.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::Unreadable`] when the bytes are not a bin the
    /// toolkit reads.
    pub fn parse(bytes: impl Into<Vec<u8>>) -> Result<Self, BinDocumentError> {
        let base = bytes.into();
        Ok(Self {
            file: BinFile::from_reader(&mut Cursor::new(&base))?,
            opened: base.clone(),
            base,
            touched: IndexSet::new(),
            dependencies_touched: false,
            undo: VecDeque::new(),
            redo: Vec::new(),
            declared: None,
            typed: typed_names::TypedNames::default(),
        })
    }

    /// The bytes the document parsed from, before any patch.
    #[must_use]
    pub fn base(&self) -> &[u8] {
        &self.base
    }

    /// The facts the header row draws. `names` names the objects a `PTCH` deletes.
    #[must_use]
    pub fn header(&self, names: &dyn RowNames) -> BinHeader {
        match &self.file {
            BinFile::Prop(bin) => BinHeader {
                kind: BinFileKind::Prop,
                version: Some(bin.version),
                objects: bin.objects.len(),
                dependencies: self.dependency_rows(),
                patches: 0,
                deleted: Vec::new(),
            },
            BinFile::Override(patch) => {
                let wanted = Wanted {
                    entries: patch.deleted.clone(),
                    ..Wanted::default()
                };
                let named = wanted.resolve(&self.typed.over(names), None);
                BinHeader {
                    kind: BinFileKind::Patch,
                    version: None,
                    objects: patch.objects.len(),
                    dependencies: Vec::new(),
                    patches: patch.patches.len(),
                    deleted: patch
                        .deleted
                        .iter()
                        .map(|&hash| ObjectName {
                            hash: hex(hash),
                            name: named.entries.get(&hash).cloned(),
                        })
                        .collect(),
                }
            }
        }
    }

    /// The facts an object tab's header draws for `entry`.
    ///
    /// `schema` names a class the tables miss.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::NodeNotFound`] when `entry` is no object of the
    /// document.
    pub fn object(
        &self,
        entry: BinHash,
        names: &dyn RowNames,
        schema: Option<SchemaAt<'_>>,
    ) -> Result<BinObjectHeader, BinDocumentError> {
        let object =
            self.file
                .objects()
                .get(&entry)
                .ok_or_else(|| BinDocumentError::NodeNotFound {
                    address: format!("{}:", hex(entry)),
                })?;
        let mut wanted = Wanted::default();
        wanted.entries.push(entry);
        wanted.classes.push(object.class_hash);
        let named = wanted.resolve(&self.typed.over(names), schema);
        let (name, unnamed) = named.entry(entry);
        Ok(BinObjectHeader {
            entry: hex(entry),
            name,
            unnamed,
            class_hash: hex(object.class_hash),
            class: named.classes.get(&object.class_hash).cloned(),
            properties: object.properties.len(),
        })
    }

    /// The path hash of every object, in file order.
    pub fn entries(&self) -> impl Iterator<Item = BinHash> + '_ {
        self.file.objects().keys().copied()
    }

    /// The object `entry` names, or `None` where the file declares none under it.
    #[must_use]
    pub fn object_at(&self, entry: BinHash) -> Option<&BinObject> {
        self.file.objects().get(&entry)
    }

    /// This `PROP` with the `PTCH` `variant` laid over a copy of it in the client's order, and
    /// what laying it did. `None` where this is no `PROP` or `variant` is no `PTCH`.
    #[must_use]
    pub fn with_variant(&self, variant: &BinDocument) -> Option<(Bin, ApplyReport)> {
        let (BinFile::Prop(bin), BinFile::Override(patch)) = (&self.file, &variant.file) else {
            return None;
        };

        let mut merged = bin.clone();
        let report = patch.clone().apply(&mut merged);
        Some((merged, report))
    }

    /// The header's dependencies, as the archive paths the file writes them. A `PTCH`
    /// names none.
    #[must_use]
    pub fn dependencies(&self) -> &[String] {
        match &self.file {
            BinFile::Prop(bin) => &bin.dependencies,
            BinFile::Override(_) => &[],
        }
    }

    /// The header's dependencies, hashed as the WAD paths they name.
    ///
    /// A dependency is written as the archive path of the file it names, and the hash
    /// is the one the object index keys a declaring file on. A `PTCH` names none.
    #[must_use]
    pub fn dependency_hashes(&self) -> Vec<WadHash> {
        match &self.file {
            BinFile::Prop(bin) => bin.dependencies.iter().map(WadHash::hash_str).collect(),
            BinFile::Override(_) => Vec::new(),
        }
    }

    /// One row per object in file order, then one per object the patch records target.
    ///
    /// A target keeps the order of its first record (ADR-0041). `schema` names a class the
    /// tables miss.
    #[must_use]
    pub fn roots(&self, names: &dyn RowNames, schema: Option<SchemaAt<'_>>) -> Vec<BinRow> {
        /* A declared document keeps the rows of the objects its layer removes, which draw
        struck through and hold no rows under them. ADR-0049. */
        let removed: Vec<&BinObject> = self
            .declared
            .as_ref()
            .map(|declared| declared.removed().collect())
            .unwrap_or_default();
        let objects = self.file.objects();
        let targets = self.targets();
        let mut wanted = Wanted::default();
        wanted.entries.extend(objects.keys().copied());
        wanted
            .entries
            .extend(removed.iter().map(|object| object.path_hash));
        wanted.entries.extend(targets.keys().copied());
        wanted.classes.extend(
            objects
                .values()
                .chain(removed.iter().copied())
                .map(|object| object.class_hash),
        );
        let named = wanted.resolve(&self.typed.over(names), schema);

        let targets = targets
            .iter()
            .map(|(&target, records)| records::target_row(target, records.len(), &named));
        let removed = removed
            .into_iter()
            .map(|object| (object.path_hash, object.class_hash, 0));
        objects
            .values()
            .map(|object| (object.path_hash, object.class_hash, object.properties.len()))
            .chain(removed)
            .map(|(entry, class_hash, len)| {
                let (name, unnamed) = named.entry(entry);
                BinRow {
                    entry: hex(entry),
                    path: String::new(),
                    label: String::new(),
                    node: RowNode::Object,
                    name,
                    unnamed,
                    kind: None,
                    value: BinValue::Struct {
                        class_hash: hex(class_hash),
                        class: named.classes.get(&class_hash).cloned(),
                        len,
                    },
                    declared: None,
                }
            })
            .chain(targets)
            .collect()
    }

    /// The rows under one node: `offset` in, at most `limit` of them, and the total.
    ///
    /// `path` is the hash path of ADR-0027, empty for the object itself. [`TARGET_PATH`]
    /// answers the patch records `entry` takes, and a record's own path what its value
    /// holds (ADR-0041). A leaf, a null struct and an absent optional have no rows under
    /// them. `schema` is the database at the install's build. `None` leaves every declared
    /// kind absent and every field the tables miss as hex.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::NodeNotFound`] when `entry` is no object and no
    /// target of the document, or `path` reaches nothing under it.
    pub fn children(
        &self,
        entry: BinHash,
        path: &str,
        offset: usize,
        limit: usize,
        names: &dyn RowNames,
        schema: Option<SchemaAt<'_>>,
    ) -> Result<BinRows, BinDocumentError> {
        let not_found = || BinDocumentError::NodeNotFound {
            address: format!("{}:{path}", hex(entry)),
        };
        if path == TARGET_PATH {
            return self
                .records_of(entry, offset, limit, names, schema)
                .ok_or_else(not_found);
        }
        let (node, trace, base) = self.locate(entry, path).ok_or_else(not_found)?;

        let children = children_of(node);
        let total = children.len();
        let window = children.get(offset..).unwrap_or(&[]).iter().take(limit);

        let mut wanted = Wanted::default();
        for step in &trace {
            match step {
                Trace::Field { field, .. } => wanted.fields.push(*field),
                Trace::Key(key) => wanted.key(key),
                Trace::Index(_) => {}
            }
        }
        for child in window.clone() {
            match child {
                Child::Field(field, value) => {
                    wanted.fields.push(*field);
                    wanted.value(value);
                }
                Child::Element(_, value) => wanted.value(value),
                Child::Entry(key, value, _) => {
                    wanted.key(key);
                    wanted.value(value);
                }
            }
        }
        let lens = Lens {
            named: wanted.resolve(&self.typed.over(names), schema),
            schema,
        };

        let class = node.class();
        let parent_label = label_of(base, &trace, &lens);
        let entry_hex = hex(entry);
        let rows = window
            .map(|child| {
                let segment = Segment::of(*child, path, &parent_label, &lens, class);
                let declared = match child {
                    Child::Field(field, value) => lens.declared(class, *field, value),
                    Child::Element(..) | Child::Entry(..) => None,
                };
                BinRow {
                    entry: entry_hex.clone(),
                    path: segment.path,
                    label: format!("{parent_label}{}", segment.readable),
                    node: segment.node,
                    name: segment.name,
                    unnamed: segment.unnamed,
                    kind: Some(segment.value.kind().into()),
                    value: lens.named.value_of(segment.value),
                    declared,
                }
            })
            .collect();

        Ok(BinRows { rows, total })
    }

    /// The rows under each of several nodes, one page each, in the order asked.
    ///
    /// The projected read of ADR-0026, which a layout and a value row use in place of
    /// one call per node. A path reaching nothing answers an empty page, because a
    /// layout names fields an object of its class need not hold.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::NodeNotFound`] when `entry` is no object and no
    /// target of the document, and with [`BinDocumentError::ReadTooWide`] when the paths
    /// together reach more than [`READ_ROW_CAP`] rows.
    pub fn children_each(
        &self,
        entry: BinHash,
        paths: &[String],
        names: &dyn RowNames,
        schema: Option<SchemaAt<'_>>,
    ) -> Result<Vec<BinRows>, BinDocumentError> {
        let targets = self.targets();
        if !self.file.objects().contains_key(&entry) && !targets.contains_key(&entry) {
            return Err(BinDocumentError::NodeNotFound {
                address: format!("{}:", hex(entry)),
            });
        }

        /* Counted before a row is built, so a call over the cap costs a walk rather
        than the whole answer it is about to be refused. */
        let mut rows = 0;
        for path in paths {
            let under = if path == TARGET_PATH {
                targets.get(&entry).map_or(0, Vec::len)
            } else {
                match self.locate(entry, path) {
                    Some((node, ..)) => children_of(node).len(),
                    None => continue,
                }
            };
            rows += under.min(READ_PAGE);
        }
        if rows > READ_ROW_CAP {
            return Err(BinDocumentError::ReadTooWide {
                rows,
                cap: READ_ROW_CAP,
            });
        }

        paths
            .iter()
            .map(
                |path| match self.children(entry, path, 0, READ_PAGE, names, schema) {
                    Err(BinDocumentError::NodeNotFound { .. }) => Ok(BinRows {
                        rows: Vec::new(),
                        total: 0,
                    }),
                    answer => answer,
                },
            )
            .collect()
    }

    /// The properties of the struct or embed the property path `path` under `entry` reaches.
    ///
    /// `None` where the path reaches no node, a leaf, a container or a null struct.
    #[must_use]
    pub fn properties_at(
        &self,
        entry: BinHash,
        path: &str,
    ) -> Option<&IndexMap<BinHash, PropertyValueEnum>> {
        self.locate(entry, path)?.0.properties()
    }

    /// The node a hash path reaches, the trace down to it, and the readable path above.
    ///
    /// Under an object the readable path starts empty. Under a record it starts with the
    /// record's own path, and the record has to target `entry`.
    pub(super) fn locate(
        &self,
        entry: BinHash,
        path: &str,
    ) -> Option<(Node<'_>, Vec<Trace<'_>>, &str)> {
        if let Some((index, rest)) = records::record_address(path) {
            let record = self
                .records()
                .get(index)
                .filter(|record| record.object_hash == entry)?;
            let steps = records::steps_under(rest)?;
            let (node, trace) = descend_from(Node::Value(&record.value), &steps)?;
            return Some((node, trace, record.path.as_str()));
        }
        let object = self.file.objects().get(&entry)?;
        let (node, trace) = descend(object, &parse_steps(path)?)?;
        Some((node, trace, ""))
    }
}
