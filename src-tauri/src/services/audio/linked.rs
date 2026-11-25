//! The bin documents that an event bank document edits beside its bank: the `events` lists of the
//! bank units that name the bank.
//!
//! "Bank unit events" in `docs/ux/AUDIO.md`. Each bin edit goes through
//! `BinDocuments::apply` (ADR-0051) as one step of that bin's history, and the event bank
//! document keeps the steps beside its own, so one undo reverts both.

use ltk_hash::BinHash;
use ltk_manager_assets::preview::AssetRef;
use ltk_manager_audio::{
    events_list_edits, unit_row, AudioIndex, BankReferences, BinAudio, ListEdit, SiteNames,
    BANK_EVENTS,
};
use ltk_manager_bin::bin_document::{
    BinDocumentId, BinDocuments, BinEdit, HistoryStep, LeafValue, NewItem, ValueEdit,
};
use ltk_manager_bin::sandbox::{SandboxRef, SandboxState};
use tauri::{AppHandle, Manager};

use super::bank::{layer_copy, write_copy};
use crate::error::{AppError, AppResult};
use crate::services::shared::installed::installed_schema;
use crate::services::shared::read_asset;

/// The most steps that the history keeps, as the event bank document keeps.
const HISTORY_DEPTH: usize = 100;

/// The extension of a bin chunk without a name.
const BIN_EXTENSION: &str = "bin";

/// One step of an event bank document's history: whether the bank took a step, and the bin
/// documents that took one.
#[derive(Debug, Clone, Default)]
pub(super) struct Step {
    pub bank: bool,
    pub bins: Vec<BinDocumentId>,
}

/// The bin documents that an open event bank holds, and the steps of its history.
#[derive(Debug, Default)]
pub(super) struct LinkedBins {
    held: Vec<(AssetRef, BinDocumentId)>,
    undo: Vec<Step>,
    redo: Vec<Step>,
    /// The bin documents with a step that no save wrote.
    unsaved: Vec<BinDocumentId>,
}

impl LinkedBins {
    /// Returns `true` if a held bin document has a step that no save wrote.
    pub fn is_dirty(&self) -> bool {
        !self.unsaved.is_empty()
    }

    /// Records `step` as the newest step, and drops the steps that a redo takes.
    pub fn push(&mut self, step: Step) {
        for &bin in &step.bins {
            self.touch(bin);
        }
        self.undo.push(step);
        if self.undo.len() > HISTORY_DEPTH {
            self.undo.remove(0);
        }
        self.redo.clear();
    }

    /// Returns the step that an undo or a redo takes, and moves it to the other side.
    pub fn take(&mut self, step: HistoryStep) -> Option<Step> {
        let (from, to) = match step {
            HistoryStep::Undo => (&mut self.undo, &mut self.redo),
            HistoryStep::Redo => (&mut self.redo, &mut self.undo),
        };
        let taken = from.pop()?;
        to.push(taken.clone());
        for &bin in &taken.bins {
            self.touch(bin);
        }
        Some(taken)
    }

    /// Returns the bin documents with unsaved steps, and marks them saved.
    pub fn take_unsaved(&mut self) -> Vec<BinDocumentId> {
        std::mem::take(&mut self.unsaved)
    }

    /// Closes every held bin document.
    pub fn close(&mut self, documents: &BinDocuments) {
        for (_, id) in self.held.drain(..) {
            documents.close(id);
        }
    }

    fn touch(&mut self, bin: BinDocumentId) {
        if !self.unsaved.contains(&bin) {
            self.unsaved.push(bin);
        }
    }

    /// Returns the held document of `asset`, and opens it in `sandbox` first if none is held.
    fn hold(
        &mut self,
        app: &AppHandle,
        sandbox: &SandboxRef,
        asset: &AssetRef,
    ) -> AppResult<BinDocumentId> {
        if let Some((_, id)) = self.held.iter().find(|(held, _)| held == asset) {
            return Ok(*id);
        }

        let id = app
            .state::<BinDocuments>()
            .open(sandbox, asset.clone(), || read_asset(app, asset))?;
        self.held.push((asset.clone(), id));
        Ok(id)
    }
}

/// Steps the bin documents of `step` in the direction `direction`.
///
/// # Errors
///
/// Fails if a bin document refuses the step.
pub(super) fn step_bins(app: &AppHandle, step: &Step, direction: HistoryStep) -> AppResult<()> {
    let documents = app.state::<BinDocuments>();
    for &bin in &step.bins {
        documents.step(bin, direction)?;
    }
    Ok(())
}

/// Saves the held bin documents with unsaved steps.
///
/// # Errors
///
/// Fails if a bin document does not save.
pub(super) fn save_bins(app: &AppHandle, linked: &mut LinkedBins) -> AppResult<()> {
    let documents = app.state::<BinDocuments>();
    for bin in linked.take_unsaved() {
        documents.save(bin)?;
    }
    Ok(())
}

/// Makes the `events` list of every bank unit that names the bank `path` follow an edit that
/// removed the events `removed` and added the events `added`, and returns the bin documents
/// that took a step.
///
/// The units of the project's bins take the edit. If no project bin names the bank, the first
/// ranked unit of the game takes it, and its bin is copied into the project layer of `sandbox`
/// first, as a game bank is on its first edit.
///
/// # Errors
///
/// Fails if a bin cannot be read, copied or edited.
#[expect(
    clippy::too_many_arguments,
    reason = "the context of one edit: the app, the bank, the indexes and the names"
)]
pub(super) fn follow_events(
    app: &AppHandle,
    linked: &mut LinkedBins,
    sandbox: &SandboxRef,
    path: &str,
    indexes: &[&AudioIndex],
    names: &dyn SiteNames,
    removed: &[String],
    added: &[String],
) -> AppResult<Vec<BinDocumentId>> {
    if removed.is_empty() && added.is_empty() {
        return Ok(Vec::new());
    }

    let rows: Vec<_> = BankReferences::of(path, indexes, names)
        .units
        .into_iter()
        .flat_map(|group| group.declarations)
        .map(|declaration| declaration.row)
        .filter(|row| row.asset.is_some() && row.property.is_some())
        .collect();
    let in_project: Vec<_> = rows
        .iter()
        .filter(|row| matches!(row.asset, Some(AssetRef::Layer { .. })))
        .cloned()
        .collect();

    let targets = if in_project.is_empty() {
        let is_announcer = path.to_ascii_lowercase().contains("announcer");
        let project_fallback = indexes.first().and_then(|project_index| {
            project_index.units().iter().find(|indexed| {
                let bin_lower = indexed.bin.to_ascii_lowercase();
                let is_map = bin_lower.contains("map");
                let is_announcer_unit = is_announcer
                    && (indexed.unit.name.to_ascii_lowercase().contains("announcer")
                        || indexed
                            .unit
                            .bank_path
                            .iter()
                            .any(|p| p.to_ascii_lowercase().contains("announcer")));
                (is_announcer && (is_map || is_announcer_unit)) || is_map
            })
        });

        if let Some(fallback_unit) = project_fallback {
            vec![unit_row(fallback_unit, None, names)]
        } else {
            rows.into_iter().take(1).collect()
        }
    } else {
        in_project
    };

    let mut stepped = Vec::new();
    for row in targets {
        let (Some(asset), Some(property)) = (row.asset, row.property) else {
            continue;
        };
        let asset = in_layer(app, sandbox, asset, &row.bin)?;
        let id = linked.hold(app, sandbox, &asset)?;

        let entry = parse_hex(&row.object_hash)?;
        let events = unit_events(app, id, entry, &property.path)?;
        let edits = value_edits(&events, &events_list_edits(&events, removed, added));
        if edits.is_empty() {
            continue;
        }

        let (schema, build) = installed_schema(app);
        app.state::<BinDocuments>().apply(
            id,
            BinEdit::EditProperty {
                entry: row.object_hash.clone(),
                holder: property.path.clone(),
                field: format!("{:#010x}", BANK_EVENTS.0),
                edits,
            },
            schema.at(build),
        )?;
        tracing::info!(
            bin = row.bin,
            object = row.object,
            ?removed,
            ?added,
            "Updated the events list of a bank unit"
        );
        stepped.push(id);
    }
    Ok(stepped)
}

/// Returns `asset`, or for a game chunk its copy in the project layer of `sandbox`, written
/// from the game's bytes.
fn in_layer(
    app: &AppHandle,
    sandbox: &SandboxRef,
    asset: AssetRef,
    bin: &str,
) -> AppResult<AssetRef> {
    let Some(target) = layer_copy(sandbox, &asset, bin, BIN_EXTENSION)? else {
        return Ok(asset);
    };
    if target
        .layer_file()
        .is_some_and(|file| file.is_ok_and(|file| file.exists()))
    {
        return Ok(target);
    }

    write_copy(&target, &read_asset(app, &asset)?)?;
    if let AssetRef::Layer { project, .. } = &target {
        app.state::<SandboxState>().invalidate(project);
    }
    tracing::info!(
        ?target,
        "Copied a game bin into the project to update a bank unit"
    );
    Ok(target)
}

/// Returns the `events` list of the bank unit at `holder` under `entry` of the open bin `id`.
fn unit_events(
    app: &AppHandle,
    id: BinDocumentId,
    entry: BinHash,
    holder: &str,
) -> AppResult<Vec<String>> {
    app.state::<BinDocuments>().read(id, |document| {
        let object = document.object_at(entry).ok_or_else(|| {
            AppError::ValidationFailed(format!("The bin holds no object {entry}"))
        })?;
        let audio = BinAudio::of_objects([object])
            .map_err(|error| AppError::ValidationFailed(error.to_string()))?;
        Ok(audio
            .units
            .into_iter()
            .find(|sited| sited.site.hash_path() == holder)
            .map(|sited| sited.unit.events)
            .unwrap_or_default())
    })
}

/// Returns the value edits of `edits` under the `events` field of a unit that lists `events`.
fn value_edits(events: &[String], edits: &[ListEdit]) -> Vec<ValueEdit> {
    let mut length = events.len();
    let mut out = Vec::new();
    for edit in edits {
        match edit {
            ListEdit::Set { index, name } => out.push(ValueEdit::SetLeaf {
                path: format!("[{index}]"),
                value: LeafValue::String {
                    value: name.clone(),
                },
            }),
            ListEdit::Remove { index } => {
                out.push(ValueEdit::RemoveItem {
                    path: format!("[{index}]"),
                });
                length -= 1;
            }
            ListEdit::Append { name } => {
                out.push(ValueEdit::InsertItem {
                    path: String::new(),
                    item: NewItem {
                        index: None,
                        key: None,
                        class: None,
                    },
                });
                out.push(ValueEdit::SetLeaf {
                    path: format!("[{length}]"),
                    value: LeafValue::String {
                        value: name.clone(),
                    },
                });
                length += 1;
            }
        }
    }
    out
}

/// Parses `0x` and eight hex digits.
fn parse_hex(text: &str) -> AppResult<BinHash> {
    text.strip_prefix("0x")
        .and_then(|digits| u32::from_str_radix(digits, 16).ok())
        .map(BinHash)
        .ok_or_else(|| AppError::ValidationFailed(format!("{text} is not an object hash")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn value_edits_append_after_removals() {
        let events = vec!["a".to_owned(), "b".to_owned()];
        let edits = value_edits(
            &events,
            &[
                ListEdit::Remove { index: 0 },
                ListEdit::Append {
                    name: "c".to_owned(),
                },
            ],
        );

        assert_eq!(
            edits[2],
            ValueEdit::SetLeaf {
                path: "[1]".to_owned(),
                value: LeafValue::String {
                    value: "c".to_owned()
                },
            }
        );
    }
}
