//! The objects that the game data declarations of a sandbox's layers create, remove or edit.
//!
//! "Declared objects" in `docs/ux/PROJECT_EDITOR.md`.

use std::collections::HashMap;

use ltk_game_data::{Declarations, EntryName, ObjectEdit, Selector, Target};
use ltk_hash::{BinHash, WadHash};
use ltk_mod_project::game_data::load_layer;
use serde::Serialize;

use super::Sandbox;
use crate::bin_document::{AssetLookup, RowNames, hex};
use crate::object_index::ObjectDeclaration;
use ltk_manager_assets::preview::AssetRef;
use ltk_manager_base::error::Utf8PathRefExt as _;
use ltk_manager_workshop::ProjectDir;

/// What one module of a layer's game data declarations does to an object.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ModuleObjectAction {
    /// The module creates the object in its target chunk, which `declaration` names.
    Create { declaration: ObjectDeclaration },
    /// The module removes the object from its target chunk.
    Remove,
    /// The module edits properties of the object.
    Edit,
}

/// An object that one module of a layer's game data declarations creates, removes or edits.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ModuleObject {
    /// The object's path hash, as `0x` and eight hex digits.
    pub object_hash: String,
    /// The object's path as the declaration spells it, else as a table names it, else its hash.
    pub path: String,
    /// The layer whose declarations hold the module.
    pub layer: String,
    /// The module's position in the layer's declarations.
    pub module: u32,
    /// The module's name, if the author gave one.
    pub module_name: Option<String>,
    pub action: ModuleObjectAction,
}

impl Sandbox {
    /// Returns every object that a module of the sandbox's layers creates, removes or edits, in
    /// build order.
    ///
    /// `install_class` returns the class of an object the install declares, for a clone of one.
    /// A creation whose class or target chunk does not resolve is skipped, because the build
    /// fails on it. A layer whose declarations do not load adds nothing. Returns an empty list for
    /// the game sandbox.
    #[must_use]
    pub fn module_objects(
        &self,
        names: &dyn RowNames,
        assets: &dyn AssetLookup,
        install_class: &dyn Fn(BinHash) -> Option<BinHash>,
    ) -> Vec<ModuleObject> {
        let Some(project) = self.reference.project() else {
            return Vec::new();
        };
        let Ok(dir) = ProjectDir::open(project) else {
            return Vec::new();
        };
        let (Ok(root), Ok(ignore)) = (
            dir.path().try_as_utf8("project directory"),
            dir.ignore_filter(),
        ) else {
            return Vec::new();
        };

        let mut list = ModuleObjects {
            sandbox: self,
            names,
            assets,
            install_class,
            created: HashMap::new(),
            spelled: HashMap::new(),
            objects: Vec::new(),
        };
        for layer in self.layers() {
            match load_layer(root, layer, &ignore).declarations {
                Ok(Some(declarations)) => list.read_layer(layer, &declarations),
                Ok(None) => {}
                Err(e) => tracing::debug!(layer, "No declared objects for a layer: {e}"),
            }
        }

        list.objects
    }
}

/// The list [`Sandbox::module_objects`] collects, with what a clone's class resolves against.
struct ModuleObjects<'a> {
    sandbox: &'a Sandbox,
    names: &'a dyn RowNames,
    assets: &'a dyn AssetLookup,
    install_class: &'a dyn Fn(BinHash) -> Option<BinHash>,
    /// The class of each object an earlier module creates.
    created: HashMap<BinHash, BinHash>,
    /// The class names that constructions spell, for a class no table names.
    spelled: HashMap<BinHash, String>,
    objects: Vec<ModuleObject>,
}

impl ModuleObjects<'_> {
    fn read_layer(&mut self, layer: &str, declarations: &Declarations) {
        for (index, module) in declarations.modules.iter().enumerate() {
            let at = Module {
                layer,
                index: u32::try_from(index).unwrap_or(u32::MAX),
                name: module.name.as_ref().map(|name| name.as_str().to_owned()),
            };

            match &module.selector {
                Selector::Target { target, edits } => {
                    for edit in edits {
                        for (name, object) in &edit.objects {
                            self.object_edit(&at, target, name, object);
                        }
                        for name in edit.entries.keys() {
                            self.push(&at, name, ModuleObjectAction::Edit);
                        }
                    }
                }
                Selector::Entries(entries) => {
                    for name in entries.keys() {
                        self.push(&at, name, ModuleObjectAction::Edit);
                    }
                }
                _ => {}
            }
        }
    }

    fn object_edit(
        &mut self,
        at: &Module<'_>,
        target: &Target,
        name: &EntryName,
        edit: &ObjectEdit,
    ) {
        let class = match edit {
            ObjectEdit::Clone { source, .. } => self.class_of(source.object_hash()),
            ObjectEdit::Construct { class, .. } => {
                if !class.as_str().starts_with("0x") {
                    self.spelled
                        .insert(class.class_hash(), class.as_str().to_owned());
                }
                Some(class.class_hash())
            }
            ObjectEdit::Remove => {
                self.push(at, name, ModuleObjectAction::Remove);
                return;
            }
            _ => return,
        };

        let Some(class) = class else {
            tracing::debug!(
                object = name.as_str(),
                "Skipping a clone of an unknown source"
            );
            return;
        };
        /* The install's index reaches a chunk the tables name by its path alone. */
        let located = self
            .assets
            .locate(target.as_str())
            .or_else(|| self.assets.locate_chunk(WadHash(target.chunk_hash())));
        let Some(asset) = located else {
            tracing::debug!(
                target = target.as_str(),
                "Skipping a creation in a missing chunk"
            );
            return;
        };

        self.created.insert(name.object_hash(), class);
        let declaration = ObjectDeclaration {
            file: self.file_name(&asset, target),
            asset,
            class_hash: hex(class),
            class: self.class_name(class),
        };
        self.push(at, name, ModuleObjectAction::Create { declaration });
    }

    /// The class of `object`: an earlier creation's, then a layer bin's, then the install's.
    fn class_of(&self, object: BinHash) -> Option<BinHash> {
        self.created
            .get(&object)
            .copied()
            .or_else(|| {
                let declared = self.sandbox.objects().get(&object)?;
                declared.first().map(|layer| layer.class)
            })
            .or_else(|| (self.install_class)(object))
    }

    /// The class's name as a table gives it, else as a construction spells it, else its hash.
    fn class_name(&self, class: BinHash) -> String {
        self.names
            .class_name(class)
            .or_else(|| self.spelled.get(&class).cloned())
            .unwrap_or_else(|| hex(class))
    }

    /// The target file as an [`ObjectDeclaration`] names it: a layer's path, else the chunk's.
    fn file_name(&self, asset: &AssetRef, target: &Target) -> String {
        if let AssetRef::Layer { path, .. } = asset {
            return path.clone();
        }

        self.names
            .chunk_name(WadHash(target.chunk_hash()))
            .unwrap_or_else(|| target.as_str().to_owned())
    }

    fn push(&mut self, at: &Module<'_>, name: &EntryName, action: ModuleObjectAction) {
        let hash = name.object_hash();
        let path = if name.is_hash() {
            self.names.entry_name(hash).unwrap_or_else(|| hex(hash))
        } else {
            name.as_str().to_owned()
        };

        self.objects.push(ModuleObject {
            object_hash: hex(hash),
            path,
            layer: at.layer.to_owned(),
            module: at.index,
            module_name: at.name.clone(),
            action,
        });
    }
}

/// The module a [`ModuleObject`] comes from.
struct Module<'a> {
    layer: &'a str,
    index: u32,
    name: Option<String>,
}

#[cfg(test)]
mod tests;
