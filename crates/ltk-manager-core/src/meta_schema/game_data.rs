//! The meta schema as the game-data engine reads it.
//!
//! Upstream ADR-0015 in league-mod names the two questions `ltk_game_data::Schema` asks.

use std::sync::Arc;

use ltk_hash::BinHash;

use super::{MetaSchema, Shape};
use crate::problems::GameBuild;

/// The meta schema at one game build, as the game-data engine reads it.
///
/// A field answers with the type its class or a base of it declares. A game build the
/// database does not describe answers no type and knows every class, and its fallback is
/// the type at the newest build the database names.
#[derive(Debug, Clone)]
pub struct PatchSchema {
    schema: Arc<MetaSchema>,
    /// `None` where the database does not describe the build.
    build: Option<GameBuild>,
}

impl PatchSchema {
    /// The schema read at `build`.
    #[must_use]
    pub fn new(schema: Arc<MetaSchema>, build: Option<GameBuild>) -> Self {
        let build = build.filter(|build| schema.describes(*build));
        Self { schema, build }
    }
}

impl ltk_game_data::Schema for PatchSchema {
    fn expected(&self, class: BinHash, field: BinHash) -> Option<ltk_game_data::Shape> {
        self.schema
            .expected(class, field, self.build?)?
            .shape
            .map(Into::into)
    }

    fn fallback(&self, class: BinHash, field: BinHash) -> Option<ltk_game_data::Shape> {
        self.schema
            .newest_expected(class, field)?
            .shape
            .map(Into::into)
    }

    fn has_class(&self, class: BinHash) -> bool {
        self.build.is_none() || self.schema.has_class(class)
    }
}

impl From<Shape> for ltk_game_data::Shape {
    fn from(shape: Shape) -> Self {
        Self {
            kind: shape.kind,
            key: shape.key,
            item: shape.value,
        }
    }
}
