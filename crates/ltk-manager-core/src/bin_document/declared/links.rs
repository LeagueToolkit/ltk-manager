//! A dependency added or removed, as the `links` or `-links` item of a `target` module that
//! expresses it. ADR-0050.
//!
//! Each plan is checked the way an object edit's is: the declarations apply again, and the
//! list has to come out as the edit asked. A plan that does not is taken back.

use ltk_declarations::{LinkEdit, LinkOperation, LinkSign};
use ltk_game_data::{LinkPath, Module};
use ltk_meta::Bin;
use serde::Serialize;

use super::super::dependencies::{ADDRESS, names};
use super::super::{BinDocument, BinDocumentError, EditRejection};
use super::{Declared, TextEdit, declaring, edits_on, not_declared};

/// How many times one link plan is written before it is refused: once for the layer's own
/// opposite item, and once for the item itself.
const ATTEMPTS: usize = 2;

/// What a declaration of the chosen layer does to one dependency of the chunk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct DeclaredLinkMark {
    /// The dependency as the applied list spells it, or the game's list for a removal.
    pub path: String,
    pub change: LinkChange,
}

/// Whether a declaration adds a dependency or removes one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum LinkChange {
    /// A `links` item the applied list holds and the game's does not.
    Added,
    /// A `-links` item of a dependency of the game's list the applied one lacks.
    Removed,
}

impl BinDocument {
    /// Declare `path` as a new dependency of the chunk in the chosen layer.
    pub(in super::super) fn declare_link_add(
        &mut self,
        path: &str,
    ) -> Result<(), BinDocumentError> {
        self.declare_link(path, LinkOperation::Add, |document| {
            names(document.dependencies(), path).is_some()
        })
    }

    /// Declare the removal of the dependency `path` in the chosen layer.
    pub(in super::super) fn declare_link_remove(
        &mut self,
        path: &str,
    ) -> Result<(), BinDocumentError> {
        self.declare_link(path, LinkOperation::Remove, |document| {
            names(document.dependencies(), path).is_none()
        })
    }

    /// Take back the chosen layer's removal of the dependency `path`.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::Declaring`] for a document that declares nothing, and
    /// with [`BinDocumentError::EditRejected`] where dropping the layer's removal does not
    /// bring the dependency back. A refused edit leaves the tree and the manifest as they were.
    pub fn restore_dependency(&mut self, path: &str) -> Result<(), BinDocumentError> {
        if !self.declares() {
            return Err(not_declared());
        }
        if names(self.dependencies(), path).is_some() {
            return Ok(());
        }
        self.declare_link(path, LinkOperation::Drop(LinkSign::Remove), |document| {
            names(document.dependencies(), path).is_some()
        })
    }

    /// Write the link edit `operation` makes on `path` until `landed` holds, at most
    /// [`ATTEMPTS`] times, each on top of the last. The writes that do not land are taken back.
    fn declare_link(
        &mut self,
        path: &str,
        operation: LinkOperation,
        landed: impl Fn(&Self) -> bool,
    ) -> Result<(), BinDocumentError> {
        let edit = LinkEdit {
            target: self.chunk_target()?,
            path: LinkPath::try_from(path).map_err(|_| refused(EditRejection::EmptyPath))?,
            operation,
        };

        let mut written: Option<TextEdit> = None;
        for _ in 0..ATTEMPTS {
            let declared = self.declared.as_ref().ok_or_else(not_declared)?;
            let wrote = declared
                .write_with(|manifest| manifest.edit_link(&edit).map(|()| None))
                .map_err(declaring)?;
            self.reapply()?;
            let Some(wrote) = wrote else {
                break;
            };
            written = Some(match written {
                Some(first) => TextEdit {
                    before: first.before,
                    ..wrote
                },
                None => wrote,
            });

            if landed(self) {
                break;
            }
        }

        if landed(self) {
            if let Some(written) = written {
                self.declared
                    .as_mut()
                    .ok_or_else(not_declared)?
                    .remember(written);
            }
            return Ok(());
        }

        if let Some(written) = written {
            let declared = self.declared.as_ref().ok_or_else(not_declared)?;
            declared
                .put(&written.layer, &written.after, &written.before)
                .map_err(declaring)?;
        }
        self.reapply()?;
        Err(refused(EditRejection::Undeclarable))
    }
}

impl Declared {
    /// The dependencies of the game's copy the chosen layer removes.
    pub(in super::super) fn removed_links(&self) -> impl Iterator<Item = &String> {
        self.links
            .iter()
            .filter(|link| link.change == LinkChange::Removed)
            .map(|link| &link.path)
    }
}

/// The marks the link edits of `modules` leave on the chunk `chunk_hash`: an addition the
/// applied list holds and the game's lacks, and a removal of a game dependency the applied
/// list lacks.
pub(super) fn link_marks(
    modules: &[Module],
    chunk_hash: u64,
    applied: &Bin,
    game: &Bin,
) -> Vec<DeclaredLinkMark> {
    let held: Vec<_> = applied.objects.keys().copied().collect();
    let mut marks: Vec<DeclaredLinkMark> = Vec::new();
    let mut mark = |list: &[String], path: &str, change: LinkChange| {
        let Some(at) = names(list, path) else {
            return;
        };
        if !marks
            .iter()
            .any(|held| held.path.eq_ignore_ascii_case(path))
        {
            marks.push(DeclaredLinkMark {
                path: list[at].clone(),
                change,
            });
        }
    };

    for module in modules {
        for edit in edits_on(module, chunk_hash, &held) {
            for path in &edit.links.add {
                if names(&game.dependencies, path.as_str()).is_none() {
                    mark(&applied.dependencies, path.as_str(), LinkChange::Added);
                }
            }
            for path in &edit.links.remove {
                if names(&applied.dependencies, path.as_str()).is_none() {
                    mark(&game.dependencies, path.as_str(), LinkChange::Removed);
                }
            }
        }
    }
    marks
}

fn refused(rejection: EditRejection) -> BinDocumentError {
    BinDocumentError::EditRejected {
        address: ADDRESS.to_owned(),
        rejection,
    }
}

#[cfg(test)]
mod tests;
