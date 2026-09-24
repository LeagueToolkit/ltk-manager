//! The header's dependency list as an edit takes it. "Dependencies" in docs/ux/BIN_EDITOR.md.
//!
//! A layer bin's edit swaps the whole list, and the list it replaced is the undo. A declared
//! document writes a `links` or `-links` item instead (ADR-0050).

use std::mem;

use brex::Brex;
use brex::alphabet::BREX_BLOCK;
use ltk_meta::BinFile;

use super::edit::Edit;
use super::{BinDocument, BinDocumentError, Dependency, EditRejection, ReadOnly};

/// The address a refused dependency edit names.
pub(super) const ADDRESS: &str = "dependencies";

/// The most paths one brex spelling may expand to before it is refused. A dependency is one
/// path, and a range such as `{0→4000000000}` would expand for minutes.
const MAX_EXPANSION: u64 = 4096;

impl BinDocument {
    /// The header's dependencies as the rows draw them. A declared document lists the ones
    /// its layer removes after the rest (ADR-0050).
    #[must_use]
    pub fn dependency_rows(&self) -> Vec<Dependency> {
        let removed = self
            .declared
            .as_ref()
            .map(|declared| declared.removed_links().collect::<Vec<_>>())
            .unwrap_or_default();
        self.dependencies()
            .iter()
            .chain(removed)
            .cloned()
            .map(Dependency::new)
            .collect()
    }

    /// Put the dependency `text` names into the list at `index`, the end where `index` is
    /// `None`, answering its position.
    ///
    /// `text` is a path, or its brex spelling. A declared document adds at the end only.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::EditRejected`] for text that names no path
    /// ([`EditRejection::EmptyPath`], [`EditRejection::MalformedBrex`]), a path the list names
    /// ([`EditRejection::DependencyExists`]), a position past the end
    /// ([`EditRejection::NoSuchIndex`]), and in a declared document an add no declaration
    /// expresses ([`EditRejection::Undeclarable`]). A refused edit leaves the list as it was.
    pub fn insert_dependency(
        &mut self,
        index: Option<usize>,
        text: &str,
    ) -> Result<usize, BinDocumentError> {
        let path = dependency_path(text).map_err(refused)?;
        let held = self.dependencies();
        if names(held, &path).is_some() {
            return Err(refused(EditRejection::DependencyExists));
        }
        let at = index.unwrap_or(held.len());
        if at > held.len() {
            return Err(refused(EditRejection::NoSuchIndex));
        }

        if self.declares() {
            if at != held.len() {
                return Err(refused(EditRejection::Undeclarable));
            }
            self.declare_link_add(&path)?;
            return Ok(names(self.dependencies(), &path).unwrap_or(at));
        }

        let mut paths = held.to_vec();
        paths.insert(at, path);
        self.set_dependencies(paths)?;
        Ok(at)
    }

    /// Take the dependency at `index` out of the list.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::EditRejected`] for a position the list does not hold
    /// ([`EditRejection::NoSuchIndex`]), and in a declared document a removal no declaration
    /// expresses ([`EditRejection::Undeclarable`]).
    pub fn remove_dependency(&mut self, index: usize) -> Result<(), BinDocumentError> {
        let held = self.dependencies();
        let path = held
            .get(index)
            .cloned()
            .ok_or_else(|| refused(EditRejection::NoSuchIndex))?;

        if self.declares() {
            return self.declare_link_remove(&path);
        }

        let mut paths = held.to_vec();
        paths.remove(index);
        self.set_dependencies(paths)
    }

    /// Move the dependency at `from` to `to`, counted in the list as it stands after the move.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::EditRejected`] for a position the list does not hold
    /// ([`EditRejection::NoSuchIndex`]), and in a declared document, where no declaration
    /// orders the list ([`EditRejection::Undeclarable`]).
    pub fn move_dependency(&mut self, from: usize, to: usize) -> Result<(), BinDocumentError> {
        if self.declares() {
            return Err(refused(EditRejection::Undeclarable));
        }
        let held = self.dependencies();
        if from >= held.len() || to >= held.len() {
            return Err(refused(EditRejection::NoSuchIndex));
        }
        if from == to {
            return Ok(());
        }

        let mut paths = held.to_vec();
        let moved = paths.remove(from);
        paths.insert(to, moved);
        self.set_dependencies(paths)
    }

    /// Replace the dependency at `index` with the one `text` names, a path or its brex
    /// spelling.
    ///
    /// # Errors
    ///
    /// As [`BinDocument::insert_dependency`], with [`EditRejection::NoSuchIndex`] for a
    /// position the list does not hold. A declared document refuses the edit
    /// ([`EditRejection::Undeclarable`]): a rename is a removal and an addition at the end.
    pub fn set_dependency(&mut self, index: usize, text: &str) -> Result<(), BinDocumentError> {
        if self.declares() {
            return Err(refused(EditRejection::Undeclarable));
        }
        let path = dependency_path(text).map_err(refused)?;
        let held = self.dependencies();
        let old = held
            .get(index)
            .ok_or_else(|| refused(EditRejection::NoSuchIndex))?;
        if *old == path {
            return Ok(());
        }
        if names(held, &path).is_some_and(|at| at != index) {
            return Err(refused(EditRejection::DependencyExists));
        }

        let mut paths = held.to_vec();
        paths[index] = path;
        self.set_dependencies(paths)
    }

    /// Set the list to `paths` as an edit an undo reverts.
    fn set_dependencies(&mut self, paths: Vec<String>) -> Result<(), BinDocumentError> {
        let inverse = self.swap_dependencies(paths)?;
        self.record(inverse)
    }

    /// Set the list to `paths` and mark it touched, answering the edit that sets it back. Both
    /// stacks are left alone.
    pub(super) fn swap_dependencies(
        &mut self,
        paths: Vec<String>,
    ) -> Result<Edit, BinDocumentError> {
        let BinFile::Prop(bin) = &mut self.file else {
            return Err(BinDocumentError::ReadOnly(ReadOnly::Patch));
        };
        let held = mem::replace(&mut bin.dependencies, paths);
        self.dependencies_touched = true;
        Ok(Edit::Dependencies { paths: held })
    }
}

/// The position of `path` in `held`, compared without regard to ASCII case as the game and
/// the apply compare a dependency.
pub(super) fn names(held: &[String], path: &str) -> Option<usize> {
    held.iter().position(|each| each.eq_ignore_ascii_case(path))
}

/// The path a typed dependency names: the text itself, or what its brex spelling expands to.
///
/// # Errors
///
/// [`EditRejection::EmptyPath`] for blank text, and [`EditRejection::MalformedBrex`] for a
/// brex spelling that does not parse, leaves a brex mark behind, or expands past
/// [`MAX_EXPANSION`] paths.
pub(super) fn dependency_path(text: &str) -> Result<String, EditRejection> {
    let text = text.trim();
    if text.is_empty() {
        return Err(EditRejection::EmptyPath);
    }
    let marked = |text: &str| text.contains([BREX_BLOCK.start, BREX_BLOCK.end]);
    if !marked(text) {
        return Ok(text.to_owned());
    }

    /* The parser unwraps a number it reads as `char::is_numeric`, which takes digits a
    `u32` does not parse and a run no `u32` holds. */
    if text.chars().any(|c| c.is_numeric() && !c.is_ascii_digit()) || longest_digit_run(text) > 9 {
        return Err(EditRejection::MalformedBrex);
    }
    let parsed = Brex::parse(text).map_err(|_| EditRejection::MalformedBrex)?;
    let expansion: u64 = parsed
        .groups
        .iter()
        .flat_map(|group| &group.suffixes)
        .flat_map(|suffix| suffix.numerics.iter().flatten())
        .map(|numeric| u64::from(numeric.end().saturating_sub(numeric.start())) + 1)
        .sum();
    if expansion > MAX_EXPANSION {
        return Err(EditRejection::MalformedBrex);
    }

    let path = parsed.expand();
    if path.is_empty() || marked(&path) {
        return Err(EditRejection::MalformedBrex);
    }
    Ok(path)
}

/// The most ASCII digits standing together in `text`.
fn longest_digit_run(text: &str) -> usize {
    text.split(|c: char| !c.is_ascii_digit())
        .map(str::len)
        .max()
        .unwrap_or(0)
}

fn refused(rejection: EditRejection) -> BinDocumentError {
    BinDocumentError::EditRejected {
        address: ADDRESS.to_owned(),
        rejection,
    }
}

#[cfg(test)]
mod tests;
