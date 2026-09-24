//! A project layer's declarations manifest (ADR-0042), edited through
//! `ltk-declarations`.

use ltk_declarations::Manifest;
use ltk_game_data::{EntryName, ModuleName};
use ltk_meta::path::PropertyPath;
use serde::Deserialize;

pub use self::outline::{
    DeclarationsLayer, DeclarationsLoadError, DeclaredEntry, DeclaredKey, DeclaredModule,
    DeclaredObjectEdit, LineSpan, ModuleSelector,
};

use super::{ProjectDir, WorkshopError};
use crate::error::{AppError, AppResult};

/// One module action on a layer's manifest, each module named by its index in `modules`.
/// ADR-0048.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum ModuleAction {
    /// Give the module a name, or take its name away with `None`.
    Rename { module: usize, name: Option<String> },
    /// Remove the module and every key it declares.
    Remove { module: usize },
    /// Move the module to stand at `to` in execution order.
    Move { module: usize, to: usize },
    /// Move the keys of `entry`, a name or a `0x` hash, to the `entries` module at `to`:
    /// every signed key of the property path `path`, or the whole body where it is `None`.
    MoveKeys {
        module: usize,
        entry: String,
        path: Option<String>,
        to: usize,
    },
}

/// A manifest's text before and after an action that changed it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManifestChange {
    pub before: String,
    pub after: String,
}

impl ProjectDir {
    /// Apply `action` to the manifest of `layer` and write it. `None` where the text is
    /// left as it was.
    ///
    /// # Errors
    ///
    /// [`AppError::ValidationFailed`] for an empty name, an entry that is not an entry name
    /// and a path that is not a property path, and the errors of
    /// [`ProjectDir::declarations_manifest`] and of the [`Manifest`] action.
    pub fn apply_module_action(
        &self,
        layer: &str,
        action: &ModuleAction,
    ) -> AppResult<Option<ManifestChange>> {
        let invalid = |error: &dyn std::fmt::Display| AppError::ValidationFailed(error.to_string());
        let mut manifest = self.declarations_manifest(layer)?;
        let before = manifest.text().to_owned();

        match action {
            ModuleAction::Rename { module, name } => {
                let name = name
                    .as_deref()
                    .map(ModuleName::try_from)
                    .transpose()
                    .map_err(|error| invalid(&error))?;
                manifest.rename_module(*module, name.as_ref())?;
            }
            ModuleAction::Remove { module } => manifest.remove_module(*module)?,
            ModuleAction::Move { module, to } => manifest.move_module(*module, *to)?,
            ModuleAction::MoveKeys {
                module,
                entry,
                path,
                to,
            } => {
                let entry = EntryName::try_from(entry.as_str()).map_err(|error| invalid(&error))?;
                let path = path
                    .as_deref()
                    .map(PropertyPath::new)
                    .transpose()
                    .map_err(|error| invalid(&error))?;
                manifest.move_keys(*module, entry.object_hash(), path.as_ref(), *to)?;
            }
        }

        manifest.write()?;
        let after = manifest.text().to_owned();
        Ok((before != after).then_some(ManifestChange { before, after }))
    }

    /// The declarations manifest of one of the project's layers.
    ///
    /// # Errors
    ///
    /// [`AppError::ValidationFailed`] for a layer name that is not one path
    /// component, and the errors of [`Manifest::read`].
    pub fn declarations_manifest(&self, layer: &str) -> AppResult<Manifest> {
        if layer.is_empty() || layer.contains(['/', '\\']) || matches!(layer, "." | "..") {
            return Err(AppError::ValidationFailed(format!(
                "Invalid layer name: {layer}"
            )));
        }
        Ok(Manifest::read(self.path().join("content").join(layer))?)
    }
}

impl From<ltk_declarations::Error> for AppError {
    fn from(error: ltk_declarations::Error) -> Self {
        use ltk_declarations::Error;

        match error {
            Error::ChangedOnDisk { path } => WorkshopError::DeclarationsChangedOnDisk {
                path: path.display().to_string(),
            }
            .into(),
            Error::NotYaml { path } => WorkshopError::DeclarationsNotYaml {
                path: path.display().to_string(),
            }
            .into(),
            Error::Invalid { path, message } => WorkshopError::DeclarationsInvalid {
                path: path.display().to_string(),
                message,
            }
            .into(),
            Error::Uneditable { path, reason } => WorkshopError::DeclarationsUneditable {
                path: path.display().to_string(),
                reason: reason.to_string(),
            }
            .into(),
            Error::InvalidValue(reason) => AppError::ValidationFailed(reason),
            Error::Io(error) => AppError::Io(error),
            other => AppError::Other(other.to_string()),
        }
    }
}

mod outline;
#[cfg(test)]
mod tests;
