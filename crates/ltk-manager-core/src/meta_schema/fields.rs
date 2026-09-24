//! The fields a class declares with its bases', which Add property lists, and the classes
//! deriving from one, which a class line lists.

use std::collections::HashSet;

use ltk_hash::BinHash;

use super::{MetaSchema, SchemaAt, Shape};
use crate::problems::GameBuild;

/// One field a class declares at one build, the way Add property offers it.
#[derive(Debug, Clone, PartialEq)]
pub struct DeclaredField<'a> {
    pub field: BinHash,
    /// The field as the database names it.
    pub name: Option<&'a str>,
    pub shape: Shape,
    /// What an `Embed` or a `Pointer` holds, or what a list's items hold.
    pub class: Option<BinHash>,
    /// The class that declares the field: the one asked about, or a base of it.
    pub owner: BinHash,
    /// The value the game constructs the field with.
    pub default: Option<&'a serde_json::Value>,
}

impl MetaSchema {
    /// Every field `class` and its bases declare, the class's own first.
    ///
    /// Read at `build` where the database describes it, and at the newest build it names
    /// otherwise. A field a nearer class declares hides the same hash on a base. A class the
    /// database does not describe declares nothing.
    #[must_use]
    pub fn declared_fields(
        &self,
        class: BinHash,
        build: Option<GameBuild>,
    ) -> Vec<DeclaredField<'_>> {
        let build = self.content_build(build);

        let mut fields = Vec::new();
        let mut seen_fields = HashSet::new();
        let mut seen_classes = HashSet::new();
        let mut pending = vec![class];
        while let Some(owner) = pending.pop() {
            if !seen_classes.insert(owner) {
                continue;
            }
            let Some(parsed) = self.classes.get(&owner) else {
                continue;
            };

            let mut own: Vec<DeclaredField<'_>> = parsed
                .properties
                .iter()
                .filter(|(field, _)| !seen_fields.contains(*field))
                .filter_map(|(field, property)| {
                    let revision = property.at(build)?;
                    Some(DeclaredField {
                        field: *field,
                        name: property.name.as_deref(),
                        shape: revision.shape?,
                        class: revision.class,
                        owner,
                        default: revision.default.as_ref(),
                    })
                })
                .collect();
            own.sort_by_cached_key(|field| {
                (
                    field.name.is_none(),
                    field.name.map(str::to_lowercase),
                    field.field.0,
                )
            });
            seen_fields.extend(own.iter().map(|field| field.field));
            fields.extend(own);

            if let Some(revision) = parsed.bases.iter().find(|revision| revision.covers(build)) {
                pending.extend(revision.bases.iter().rev());
            }
        }
        fields
    }

    /// The field `field` as `class` or one of its bases declares it. See
    /// [`MetaSchema::declared_fields`].
    #[must_use]
    pub fn declared_field(
        &self,
        class: BinHash,
        field: BinHash,
        build: Option<GameBuild>,
    ) -> Option<DeclaredField<'_>> {
        self.declared_fields(class, build)
            .into_iter()
            .find(|declared| declared.field == field)
    }

    /// Every class the database knows, at any build, sorted by name. An unnamed class sorts
    /// last.
    #[must_use]
    pub fn classes(&self) -> Vec<BinHash> {
        let mut classes: Vec<_> = self
            .classes
            .iter()
            .map(|(class, parsed)| (*class, parsed.name.as_deref()))
            .collect();
        classes.sort_by_cached_key(|(class, name)| {
            (name.is_none(), name.map(str::to_lowercase), class.0)
        });
        classes.into_iter().map(|(class, _)| class).collect()
    }

    /// Every class deriving from `class` through any number of bases, sorted by name.
    ///
    /// Read at `build` as [`MetaSchema::declared_fields`] reads it. An unnamed class sorts
    /// last, and `class` is not one of its own.
    #[must_use]
    pub fn derived_classes(&self, class: BinHash, build: Option<GameBuild>) -> Vec<BinHash> {
        let build = self.content_build(build);
        let mut derived: Vec<_> = self
            .classes
            .iter()
            .filter(|(candidate, _)| {
                **candidate != class && self.derives(**candidate, class, build)
            })
            .map(|(candidate, parsed)| (*candidate, parsed.name.as_deref()))
            .collect();
        derived.sort_by_cached_key(|(candidate, name)| {
            (name.is_none(), name.map(str::to_lowercase), candidate.0)
        });
        derived
            .into_iter()
            .map(|(candidate, _)| candidate)
            .collect()
    }

    /// Whether `class` reaches `base` through its bases at `build`.
    fn derives(&self, class: BinHash, base: BinHash, build: u32) -> bool {
        let mut seen = HashSet::new();
        let mut pending = vec![class];
        while let Some(at) = pending.pop() {
            if !seen.insert(at) {
                continue;
            }
            let Some(revision) = self
                .classes
                .get(&at)
                .and_then(|parsed| parsed.bases.iter().find(|revision| revision.covers(build)))
            else {
                continue;
            };
            if revision.bases.contains(&base) {
                return true;
            }
            pending.extend(revision.bases.iter().copied());
        }
        false
    }

    /// The build a read at `build` takes: `build` where the database describes it, and the
    /// newest one it names otherwise.
    pub(super) fn content_build(&self, build: Option<GameBuild>) -> u32 {
        build
            .filter(|build| self.describes(*build))
            .map_or(self.latest, |build| build.content())
    }
}

impl<'a> SchemaAt<'a> {
    /// Every field `class` and its bases declare at this build. See
    /// [`MetaSchema::declared_fields`].
    #[must_use]
    pub fn declared_fields(self, class: BinHash) -> Vec<DeclaredField<'a>> {
        self.schema.declared_fields(class, self.build)
    }

    /// The field `field` as `class` or one of its bases declares it at this build.
    #[must_use]
    pub fn declared_field(self, class: BinHash, field: BinHash) -> Option<DeclaredField<'a>> {
        self.schema.declared_field(class, field, self.build)
    }

    /// Every class deriving from `class` at this build. See [`MetaSchema::derived_classes`].
    #[must_use]
    pub fn derived_classes(self, class: BinHash) -> Vec<BinHash> {
        self.schema.derived_classes(class, self.build)
    }

    /// Every class the database knows. See [`MetaSchema::classes`].
    #[must_use]
    pub fn classes(self) -> Vec<BinHash> {
        self.schema.classes()
    }
}
