//! Edits a layer's game data declarations manifest in place (ltk-manager
//! ADR-0042).
//!
//! [`Manifest`] holds a layer's `game_data.yaml` as text and takes one [`Edit`]
//! at a time:
//!
//! - An edit to a key some module already declares, in dotted or block form,
//!   replaces that key's value where it stands. Where several modules declare
//!   it, the last one is edited.
//! - A new key joins the module the edit's [`ModuleChoice`] names, inside the
//!   deepest block its path runs through (ADR-0048). With no choice it joins
//!   the last `entries` module naming the entry, else the last module where
//!   that is an `entries` module, else a new trailing `entries` module.
//! - A new key is a nested block for each step of its path below that block,
//!   with the sign on the innermost key. It is one dotted key in a flow mapping,
//!   or where the mapping already holds a key for the path's first step.
//! - A `target` module is edited only where the key already exists, except for
//!   an object it creates: a new key of that object joins the object's `set`,
//!   or the body under its class tag, whatever module the choice names
//!   (ADR-0049).
//! - An [`ObjectEdit`] replaces the body of the last `objects` entry naming the
//!   object in a `target` module of the chunk. A new entry joins the last
//!   `target` module of the chunk, else a new trailing `target` module. A
//!   constructed object is a class tag, `!Class {}`.
//! - A [`LinkEdit`] adds an item to the `links` or `-links` list of the last
//!   `target` module of the chunk, else of a new trailing `target` module. It
//!   drops the chunk's opposite item of the same path instead where one exists.
//!
//! - An edit of an object that a `source` module creates is applied to that
//!   source document, unless a later module of the manifest declares the path.
//!   A set of a path that a set value holds, a list item or a struct field
//!   under the value's key, replaces that node of the value where it stands.
//!
//! A module holds at least one entry, so a new module is made by the edit that
//! fills it, [`ModuleChoice::New`]. The module actions rename, remove and
//! reorder modules, and move an entry's keys from one module to another.
//!
//! Comments, blank lines, key order and the spelling of every other key are
//! kept. Each edited text loads through [`ltk_game_data::load_declarations`]
//! before it replaces the held text. A write compares the file on disk with
//! the bytes read and refuses on a difference.
//!
//! ```
//! use ltk_declarations::{Edit, Manifest, ModuleChoice, Operation, ValueText};
//!
//! let layer = tempfile::tempdir()?;
//! let mut manifest = Manifest::read(layer.path())?;
//! manifest.edit(&Edit {
//!     chunk_hash: ltk_game_data::path_hash("data/characters/teemo/skins/skin0.bin"),
//!     entry: "Characters/Teemo/Skins/Skin0".try_into()?,
//!     path: "skinMeshProperties.selfIllumination".parse()?,
//!     operation: Operation::Set(ValueText::new("0.37")?),
//!     module: ModuleChoice::Auto,
//! })?;
//! manifest.write()?;
//!
//! assert_eq!(
//!     std::fs::read_to_string(layer.path().join("game_data.yaml"))?,
//!     "\
//! version: 1
//! modules:
//!   - entries:
//!       Characters/Teemo/Skins/Skin0:
//!         skinMeshProperties:
//!           selfIllumination: 0.37
//! ",
//! );
//! # Ok::<(), Box<dyn std::error::Error>>(())
//! ```

#![warn(missing_docs)]

mod convert;
mod document_text;
mod edit;
mod layout;
mod line_ending;
mod link;
mod locate;
mod module;
mod object;
mod syntax;
#[cfg(test)]
mod tests;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use fs_err as fs;
use ltk_game_data::{
    BinHash, ClassName, Declarations, EntryName, Error as GameDataError,
    ErrorKind as GameDataErrorKind, LinkPath, MANIFEST_NAMES, ModuleName, REFUSED_MANIFEST_NAMES,
    Sign, Target, Value, load_declarations,
};
use ltk_meta::path::PropertyPath;
use rowan::ast::AstNode as _;

pub use self::convert::convert_layer;
pub use self::layout::{Binding, BodyAt, KeyLayout, Layout};

use self::document_text::DocumentText;
use self::line_ending::LineEnding;

/// The manifest file a layer with none gains.
pub const FILE_NAME: &str = "game_data.yaml";

/// A value as YAML text: one node, starting at column 0.
///
/// The text `ltk_game_data`'s value rendering writes. A mapping or a list may
/// span lines, in block or flow form, and may carry a local tag.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ValueText(String);

impl ValueText {
    /// A value from its YAML text, trailing whitespace dropped.
    ///
    /// # Errors
    ///
    /// [`Error::InvalidValue`] for text that is empty or does not parse as one
    /// YAML node.
    pub fn new(text: impl Into<String>) -> Result<Self, Error> {
        let mut text = text.into();
        text.truncate(text.trim_end().len());
        if text.is_empty() {
            return Err(Error::InvalidValue("the text is empty".to_owned()));
        }
        let doc =
            syntax::parse(&text).map_err(|refusal| Error::InvalidValue(refusal.to_string()))?;
        if syntax::root(&doc).is_none() {
            return Err(Error::InvalidValue(
                "the text holds no YAML node".to_owned(),
            ));
        }
        Ok(Self(text))
    }

    /// The YAML text.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<&Value> for ValueText {
    type Error = Error;

    /// The text `value` writes as YAML.
    ///
    /// # Errors
    ///
    /// [`Error::InvalidValue`] for a value `ltk_game_data` does not write, which no loaded
    /// or rendered value is.
    fn try_from(value: &Value) -> Result<Self, Error> {
        let text = value
            .to_yaml()
            .map_err(|error| Error::InvalidValue(error.to_string()))?;
        Self::new(text)
    }
}

/// What a declaration does to one property.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Operation {
    /// Replace the property's value: an unsigned key.
    Set(ValueText),
    /// Add elements to a list, or entries to a map: a `+` key. They join an
    /// existing `+` key's value.
    Add(ValueText),
    /// Remove elements from a list, or keys from a map: a `-` key. They join
    /// an existing `-` key's value, once.
    Remove(ValueText),
    /// Drop the key with this sign. A body, a block or a module it leaves
    /// empty goes with it. Dropping a key nothing declares changes nothing.
    Drop(Sign),
}

impl Operation {
    /// The sign of the key the operation writes or drops.
    #[must_use]
    pub fn sign(&self) -> Sign {
        match self {
            Self::Set(_) => Sign::Set,
            Self::Add(_) => Sign::Add,
            Self::Remove(_) => Sign::Remove,
            Self::Drop(sign) => *sign,
        }
    }

    /// The value the operation writes, `None` for a drop.
    #[must_use]
    pub fn value(&self) -> Option<&ValueText> {
        match self {
            Self::Set(value) | Self::Add(value) | Self::Remove(value) => Some(value),
            Self::Drop(_) => None,
        }
    }
}

/// The module an edit's new key joins. ltk-manager ADR-0048.
///
/// A key some module already declares is edited where it stands, whichever
/// module is chosen.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum ModuleChoice {
    /// The last `entries` module naming the entry, else the last module where
    /// that is an `entries` module, else a new trailing `entries` module.
    #[default]
    Auto,
    /// The module at this index of `modules`, which is an `entries` module.
    Index(usize),
    /// A new trailing `entries` module, holding this name where one is given.
    New(Option<ModuleName>),
    /// The last `target` module of this chunk, else a new trailing one. An edit of
    /// a variant's `PTCH` lands here: an `entries` module reaches the chunk that
    /// declares the entry, which for a variant is its base.
    Target(Target),
}

/// One edit of one property of one entry, as a document showing one chunk
/// makes it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Edit {
    /// The path hash of the chunk the document shows, as
    /// [`ltk_game_data::path_hash`] computes it. A `target` module is edited
    /// only when it targets this chunk.
    pub chunk_hash: u64,
    /// The entry, spelled as a new key names it: its name, else its hash.
    pub entry: EntryName,
    /// The property path, without a sign.
    pub path: PropertyPath,
    /// What the edit does.
    pub operation: Operation,
    /// The module a new key joins.
    pub module: ModuleChoice,
}

impl Edit {
    /// The `entries` module the edit writes into a layer with no manifest, as the list item
    /// that stands under a manifest's `modules` key. `None` for a drop, which writes nothing.
    #[must_use]
    pub fn module_text(&self) -> Option<String> {
        module_text(std::slice::from_ref(self))
    }
}

/// What a declaration does to one object of a chunk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ObjectOperation {
    /// Create the object as a copy of an object of the chunk: `clone`.
    Clone(EntryName),
    /// Create an object of a class, holding no property: a class tag, `!Class {}`. A class
    /// spelled as a hash writes `class`.
    Construct(ClassName),
    /// Remove the object: `remove: true`.
    Remove,
    /// Drop the object's entry, its `set` with it. A module it leaves empty goes with it.
    /// Dropping an object nothing declares changes nothing.
    Drop,
}

impl ObjectOperation {
    /// The object body the operation writes, as YAML text. `None` for a drop.
    fn body(&self) -> Option<String> {
        match self {
            Self::Clone(source) => Some(format!("clone: {}", syntax::spell_key(source.as_str()))),
            /* `{}`: yaml_edit reads the entries after a bodyless tag as its body. */
            Self::Construct(class) if is_tag_name(class.as_str()) => {
                Some(format!("!{} {{}}", class.as_str()))
            }
            Self::Construct(class) => Some(format!("class: {}", syntax::spell_key(class.as_str()))),
            Self::Remove => Some("remove: true".to_owned()),
            Self::Drop => None,
        }
    }
}

/// Whether `class` can stand as a YAML tag: a name of ASCII letters, digits and `_` that
/// starts with a letter or `_`, so a `0x` hash is not one.
fn is_tag_name(class: &str) -> bool {
    class.starts_with(|first: char| first.is_ascii_alphabetic() || first == '_')
        && class.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// One edit of one object of one chunk: an entry of a `target` module's `objects`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObjectEdit {
    /// The chunk, spelled as a new `target` module names it.
    pub target: Target,
    /// The object, spelled as a new entry of `objects` names it.
    pub entry: EntryName,
    /// What the edit does.
    pub operation: ObjectOperation,
}

/// The list of a binding body a dependency path stands in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LinkSign {
    /// `links`, or its alias `+links`: the chunk gains the dependency.
    Add,
    /// `-links`: the chunk loses the dependency.
    Remove,
}

/// What a declaration does to one dependency of a chunk.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LinkOperation {
    /// Add the dependency: an item of `links`. Where the chunk's `-links` names the path,
    /// that item is dropped instead. A path `links` already names writes nothing.
    Add,
    /// Remove the dependency: an item of `-links`. Where the chunk's `links` names the path,
    /// that item is dropped instead. A path `-links` already names writes nothing.
    Remove,
    /// Drop every item naming the path from the lists of this sign. A list or a module it
    /// leaves empty goes with it.
    Drop(LinkSign),
}

/// One edit of one dependency of one chunk: an item of a `target` module's link lists.
///
/// A path compares without regard to ASCII case, as the apply compares it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkEdit {
    /// The chunk, spelled as a new `target` module names it.
    pub target: Target,
    /// The dependency, as the file writes it.
    pub path: LinkPath,
    /// What the edit does.
    pub operation: LinkOperation,
}

/// The modules `edits` write into a layer with no manifest, in order, as the list items that
/// stand under a manifest's `modules` key. `None` where they write nothing, or where the text
/// cannot take one of them.
#[must_use]
pub fn module_text(edits: &[Edit]) -> Option<String> {
    const MODULES: &str = "modules:\n";
    let mut text = DocumentText::default();
    for edit in edits {
        text = text.apply(edit).ok()?.0;
    }
    let (_, modules) = text.as_str().split_once(MODULES)?;
    let lines: Vec<&str> = modules
        .lines()
        .map(|line| line.strip_prefix("  ").unwrap_or(line))
        .collect();
    (!lines.is_empty()).then(|| lines.join("\n"))
}

/// Why an edit cannot be placed in a manifest's text.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[non_exhaustive]
pub enum Refusal {
    /// The text is not YAML.
    #[error("the text does not parse as YAML: {0}")]
    Syntax(String),
    /// The text holds no document.
    #[error("the text holds no YAML document")]
    NoDocument,
    /// The document is not a mapping.
    #[error("the manifest's root is not a mapping")]
    RootNotMapping,
    /// `modules` is a flow list, which takes no block module.
    #[error("`modules` is a flow list, and a module joins a block list only")]
    ModulesNotBlock,
    /// A flow collection meets a value that spans lines or is a block
    /// collection.
    #[error("a flow mapping or list takes one-line flow values only")]
    FlowValue,
    /// An addition or removal meets a declared value of another shape.
    #[error("the declared value is not a list or a map like the one joining it")]
    MergeShape,
    /// The edited text does not load. The writer placed the edit wrongly.
    #[error("the edited text does not load: {0}")]
    DoesNotLoad(String),
    /// `modules` holds no module at this index.
    #[error("the manifest holds no module {0}")]
    NoModule(usize),
    /// The module at this index is a `target` module, which takes no new key.
    #[error("module {0} is not an `entries` module")]
    NotEntriesModule(usize),
    /// The module declares nothing for the entry or the path to move.
    #[error("the module declares no such key")]
    NoKey,
    /// The module a key moves to already declares it.
    #[error("the destination module already declares the key")]
    DeclaredInDestination,
}

/// A failure to read, edit or write a manifest.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// The file on disk is not the one read. Nothing was written.
    #[error("{} changed since it was read", path.display())]
    ChangedOnDisk {
        /// The manifest file.
        path: PathBuf,
    },
    /// The layer's manifest is JSON or TOML, which is not edited.
    #[error("{} is not YAML, and only game_data.yaml is edited", path.display())]
    NotYaml {
        /// The manifest file.
        path: PathBuf,
    },
    /// The manifest does not load, or the layer holds more than one.
    #[error("{} does not load: {message}", path.display())]
    Invalid {
        /// The manifest file.
        path: PathBuf,
        /// What `ltk_game_data` reports.
        message: String,
    },
    /// The manifest's text cannot take the edit. The text is unchanged.
    #[error("{} cannot take the edit: {reason}", path.display())]
    Uneditable {
        /// The manifest file.
        path: PathBuf,
        /// Why.
        reason: Refusal,
    },
    /// A [`ValueText`] that is not one YAML node.
    #[error("invalid value: {0}")]
    InvalidValue(String),
    /// A read or a write failed.
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

/// A layer's declarations manifest, held as text and edited in place.
#[derive(Debug)]
pub struct Manifest {
    /// The manifest file, or the one a write creates.
    path: PathBuf,
    /// The layer's content directory, where source files resolve.
    layer_dir: PathBuf,
    /// The bytes read from disk, `None` where the layer had no manifest.
    read: Option<Vec<u8>>,
    /// The text with every edit applied.
    text: DocumentText,
    ending: LineEnding,
    /// The source documents an edit or a replace read, in the order they were read.
    sources: Vec<HeldSource>,
}

/// A source document that a manifest names, held as text once an edit reads it.
#[derive(Debug)]
struct HeldSource {
    /// The source as the manifest names it.
    name: String,
    /// The file, resolved inside the layer.
    path: PathBuf,
    /// The bytes read from disk, or last written.
    read: Vec<u8>,
    /// The text with every edit applied.
    text: DocumentText,
    ending: LineEnding,
}

/// The texts of a manifest and of the source documents it holds, lines ending in `\n`.
///
/// An undo keeps the texts from before and after an edit, and [`Manifest::replace`] puts
/// one back.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ManifestTexts {
    /// The manifest's text. Empty for a layer with no manifest.
    pub manifest: String,
    /// The text of each held source document, keyed by the source as the manifest names it.
    pub sources: BTreeMap<String, String>,
}

impl Manifest {
    /// Read the manifest of the layer whose content directory is `layer_dir`.
    ///
    /// A layer with no manifest reads as an empty text, which a write creates
    /// as [`FILE_NAME`].
    ///
    /// # Errors
    ///
    /// [`Error::NotYaml`] for a layer whose manifest is JSON or TOML,
    /// [`Error::Invalid`] for a layer with more than one manifest or one that
    /// is not UTF-8, and [`Error::Io`] when the file cannot be read.
    pub fn read(layer_dir: impl Into<PathBuf>) -> Result<Self, Error> {
        let layer_dir = layer_dir.into();
        let path = match present_manifests(&layer_dir).as_slice() {
            [] => {
                return Ok(Self {
                    path: layer_dir.join(FILE_NAME),
                    layer_dir,
                    read: None,
                    text: DocumentText::default(),
                    ending: LineEnding::Lf,
                    sources: Vec::new(),
                });
            }
            [path] => path.clone(),
            [first, ..] => {
                return Err(Error::Invalid {
                    path: first.clone(),
                    message: "the layer holds more than one game data manifest".to_owned(),
                });
            }
        };
        if !path
            .extension()
            .is_some_and(|extension| extension == "yaml" || extension == "yml")
        {
            return Err(Error::NotYaml { path });
        }

        let bytes = fs::read(&path)?;
        let Ok(text) = std::str::from_utf8(&bytes) else {
            return Err(Error::Invalid {
                path,
                message: "the file is not UTF-8".to_owned(),
            });
        };
        Ok(Self {
            text: DocumentText::new(text.replace("\r\n", "\n")),
            ending: LineEnding::of(&bytes),
            path,
            layer_dir,
            read: Some(bytes),
            sources: Vec::new(),
        })
    }

    /// The manifest file, or the one a write creates.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// The text with every edit applied, lines ending in `\n`.
    #[must_use]
    pub fn text(&self) -> &str {
        self.text.as_str()
    }

    /// The declarations the text loads to, `None` for an empty text.
    ///
    /// # Errors
    ///
    /// [`Error::Invalid`] for a text that does not load.
    pub fn declarations(&self) -> Result<Option<Declarations>, Error> {
        self.load(&self.text).map_err(|error| Error::Invalid {
            path: self.path.clone(),
            message: error.to_string(),
        })
    }

    /// The held texts of the manifest and of each source document an edit or a replace read.
    #[must_use]
    pub fn texts(&self) -> ManifestTexts {
        ManifestTexts {
            manifest: self.text.as_str().to_owned(),
            sources: self
                .sources
                .iter()
                .map(|held| (held.name.clone(), held.text.as_str().to_owned()))
                .collect(),
        }
    }

    /// The texts of the files [`Manifest::texts`] covers, as they were read or last written.
    #[must_use]
    pub fn texts_on_disk(&self) -> ManifestTexts {
        let text = |bytes: &[u8]| String::from_utf8_lossy(bytes).replace("\r\n", "\n");
        ManifestTexts {
            manifest: self.read.as_deref().map(text).unwrap_or_default(),
            sources: self
                .sources
                .iter()
                .map(|held| (held.name.clone(), text(&held.read)))
                .collect(),
        }
    }

    /// Apply one edit to the held text, answering the index of the module that holds the
    /// key it wrote. `None` for a drop, which writes no key.
    ///
    /// If a `source` module creates the edited object after every module that declares the
    /// path, the edit is applied to that source document, and the index is that module's.
    ///
    /// # Errors
    ///
    /// [`Error::Invalid`] for a manifest that does not load before the edit,
    /// and [`Error::Uneditable`] for an edit the text cannot take. Either
    /// leaves the text as it was.
    pub fn edit(&mut self, edit: &Edit) -> Result<Option<usize>, Error> {
        let Some((module, source)) = self.creating_source(edit)? else {
            return self.change(|text| text.apply(edit));
        };

        self.declarations()?;
        let index = self.hold_source(&source)?;
        let held = &self.sources[index];
        let text = held
            .text
            .apply_in_source(edit)
            .map_err(|reason| Error::Uneditable {
                path: held.path.clone(),
                reason,
            })?;

        let previous = std::mem::replace(&mut self.sources[index].text, text);
        if let Err(error) = self.load(&self.text) {
            let held = &mut self.sources[index];
            held.text = previous;
            return Err(Error::Uneditable {
                path: held.path.clone(),
                reason: Refusal::DoesNotLoad(error.to_string()),
            });
        }
        Ok(edit.operation.value().map(|_| module))
    }

    /// Returns the index of the `source` module that creates the object of `edit` and the
    /// source it names. Returns `None` if no `source` module creates the object, or if a
    /// later module of the manifest declares the path.
    fn creating_source(&self, edit: &Edit) -> Result<Option<(usize, String)>, Error> {
        if self.text.is_blank() {
            return Ok(None);
        }

        let doc = self
            .text
            .parse()
            .map_err(|reason| self.uneditable(reason))?;
        let entry = edit.entry.object_hash();
        let creation = locate::last_creation(&doc, edit.chunk_hash, entry, |source| {
            self.source_text(source)
                .ok()
                .and_then(|text| DocumentText::new(text).parse().ok())
                .is_some_and(|source| locate::last_source_creation(&source, entry).is_some())
        });
        let Some((module, Some(source))) = creation else {
            return Ok(None);
        };

        let site = locate::Site::of(edit, locate::DocumentKind::Manifest);
        let declared = locate::last_within(&doc, &site)
            .or_else(|| locate::last_key(&doc, &site).map(|key| key.syntax().clone()))
            .and_then(|node| locate::module_of(&doc, &node));
        if declared.is_some_and(|declared| declared > module) {
            return Ok(None);
        }
        Ok(Some((module, source)))
    }

    /// Returns the text of the source document `source`: the held text, else the file's.
    fn source_text(&self, source: &str) -> Result<String, GameDataError> {
        let path = resolve_source(&self.layer_dir, source)?;
        if let Some(held) = self.sources.iter().find(|held| held.path == path) {
            return Ok(held.text.as_str().to_owned());
        }
        fs::read_to_string(&path).map_err(|error| GameDataError::io(source, &error))
    }

    /// Returns the index of the held source document `source`, reading it first if it is not
    /// held.
    fn hold_source(&mut self, source: &str) -> Result<usize, Error> {
        let invalid = |message: String| Error::Invalid {
            path: self.path.clone(),
            message,
        };
        let path =
            resolve_source(&self.layer_dir, source).map_err(|error| invalid(error.to_string()))?;
        if let Some(index) = self.sources.iter().position(|held| held.path == path) {
            return Ok(index);
        }

        let read = fs::read(&path)?;
        let Ok(text) = std::str::from_utf8(&read) else {
            return Err(Error::Invalid {
                path,
                message: "the file is not UTF-8".to_owned(),
            });
        };
        self.sources.push(HeldSource {
            name: source.to_owned(),
            text: DocumentText::new(text.replace("\r\n", "\n")),
            ending: LineEnding::of(&read),
            path,
            read,
        });
        Ok(self.sources.len() - 1)
    }

    /// Give the module at `module` the name `name`, or take its name away.
    ///
    /// # Errors
    ///
    /// As [`Manifest::edit`], with [`Refusal::NoModule`] for an index `modules` does not
    /// hold.
    pub fn rename_module(&mut self, module: usize, name: Option<&ModuleName>) -> Result<(), Error> {
        self.change(|text| Ok((text.rename_module(module, name)?, ())))
    }

    /// Add a module holding `name` and no entry at the end of `modules`, answering its index.
    ///
    /// # Errors
    ///
    /// As [`Manifest::edit`], with [`Refusal::ModulesNotBlock`] for a flow `modules` list
    /// holding a module.
    pub fn create_module(&mut self, name: Option<&ModuleName>) -> Result<usize, Error> {
        self.change(|text| text.create_module(name))
    }

    /// Remove the module at `module` and every key it declares.
    ///
    /// # Errors
    ///
    /// As [`Manifest::rename_module`].
    pub fn remove_module(&mut self, module: usize) -> Result<(), Error> {
        self.change(|text| Ok((text.remove_module(module)?, ())))
    }

    /// Move the module at `module` to stand at `to` in execution order.
    ///
    /// # Errors
    ///
    /// As [`Manifest::rename_module`], with [`Refusal::ModulesNotBlock`] for a flow
    /// `modules` list.
    pub fn move_module(&mut self, module: usize, to: usize) -> Result<(), Error> {
        self.change(|text| Ok((text.move_module(module, to)?, ())))
    }

    /// Move the keys of `entry` from the `entries` module at `module` to the one at `to`:
    /// every signed key of `path`, or the entry's whole body where `path` is `None`.
    ///
    /// An unnamed module the move leaves empty goes, which shifts every later index down by
    /// one. A named one stays, holding `entries: {}`.
    ///
    /// # Errors
    ///
    /// As [`Manifest::rename_module`], with [`Refusal::NotEntriesModule`] for a `target`
    /// module, [`Refusal::NoKey`] where `module` declares nothing to move, and
    /// [`Refusal::DeclaredInDestination`] where `to` already declares a moved key.
    pub fn move_keys(
        &mut self,
        module: usize,
        entry: BinHash,
        path: Option<&PropertyPath>,
        to: usize,
    ) -> Result<(), Error> {
        self.change(|text| Ok((text.move_keys(module, entry, path, to)?, ())))
    }

    /// Drop every signed key of `path` on `entry` from the `entries` module at `module`.
    ///
    /// An unnamed module the drop leaves empty goes, as after [`Manifest::move_keys`].
    ///
    /// # Errors
    ///
    /// As [`Manifest::rename_module`], with [`Refusal::NotEntriesModule`] for a `target`
    /// module and [`Refusal::NoKey`] where `module` declares nothing under `path`.
    pub fn drop_keys(
        &mut self,
        module: usize,
        entry: BinHash,
        path: &PropertyPath,
    ) -> Result<(), Error> {
        self.change(|text| Ok((text.drop_keys(module, entry, path)?, ())))
    }

    /// Replace the held text with what `change` makes of it, where that loads.
    fn change<T>(
        &mut self,
        change: impl FnOnce(&DocumentText) -> Result<(DocumentText, T), Refusal>,
    ) -> Result<T, Error> {
        self.declarations()?;
        let (text, outcome) = change(&self.text).map_err(|reason| self.uneditable(reason))?;
        if let Err(error) = self.load(&text) {
            return Err(self.uneditable(Refusal::DoesNotLoad(error.to_string())));
        }
        self.text = text;
        Ok(outcome)
    }

    /// Apply one object edit to the held text.
    ///
    /// # Errors
    ///
    /// As [`Manifest::edit`].
    pub fn edit_object(&mut self, edit: &ObjectEdit) -> Result<(), Error> {
        self.declarations()?;
        let text = self
            .text
            .apply_object(edit)
            .map_err(|reason| self.uneditable(reason))?;
        if let Err(error) = self.load(&text) {
            return Err(self.uneditable(Refusal::DoesNotLoad(error.to_string())));
        }
        self.text = text;
        Ok(())
    }

    /// Apply one link edit to the held text.
    ///
    /// # Errors
    ///
    /// As [`Manifest::edit`].
    pub fn edit_link(&mut self, edit: &LinkEdit) -> Result<(), Error> {
        self.change(|text| Ok((text.apply_link(edit)?, ())))
    }

    /// Replace the held text with `text`, which an undo holds from before an edit.
    ///
    /// # Errors
    ///
    /// [`Error::Uneditable`] for a text that is not blank and does not load, which leaves
    /// the held text as it was.
    pub fn restore(&mut self, text: &str) -> Result<(), Error> {
        let text = DocumentText::new(text.replace("\r\n", "\n"));
        if let Err(error) = self.load(&text) {
            return Err(self.uneditable(Refusal::DoesNotLoad(error.to_string())));
        }
        self.text = text;
        Ok(())
    }

    /// Replaces the held texts `from` with `to`, which an undo holds from before and after an
    /// edit.
    ///
    /// # Errors
    ///
    /// [`Error::ChangedOnDisk`] if the manifest or a source document of `from` holds another
    /// text, and [`Error::Uneditable`] if the texts of `to` do not load. Either leaves every
    /// held text as it was.
    pub fn replace(&mut self, from: &ManifestTexts, to: &ManifestTexts) -> Result<(), Error> {
        if self.text.as_str() != from.manifest {
            return Err(Error::ChangedOnDisk {
                path: self.path.clone(),
            });
        }
        for (source, text) in &from.sources {
            let index = self.hold_source(source)?;
            let held = &self.sources[index];
            if held.text.as_str() != text {
                return Err(Error::ChangedOnDisk {
                    path: held.path.clone(),
                });
            }
        }

        let previous_text = self.text.clone();
        let previous_sources: Vec<DocumentText> =
            self.sources.iter().map(|held| held.text.clone()).collect();
        self.text = DocumentText::new(to.manifest.replace("\r\n", "\n"));
        for (source, text) in &to.sources {
            let index = self.hold_source(source)?;
            self.sources[index].text = DocumentText::new(text.replace("\r\n", "\n"));
        }

        if let Err(error) = self.load(&self.text) {
            self.text = previous_text;
            self.sources.truncate(previous_sources.len());
            for (held, text) in self.sources.iter_mut().zip(previous_sources) {
                held.text = text;
            }
            return Err(self.uneditable(Refusal::DoesNotLoad(error.to_string())));
        }
        Ok(())
    }

    /// Write the held text over the manifest, and each held source document over its file,
    /// in the line ending each was read with. A blank manifest text removes the manifest.
    ///
    /// # Errors
    ///
    /// [`Error::ChangedOnDisk`] when a file on disk is not the one read,
    /// which writes nothing, and [`Error::Io`] when the write fails.
    pub fn write(&mut self) -> Result<(), Error> {
        let on_disk = match fs::read(&self.path) {
            Ok(bytes) => Some(bytes),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(error.into()),
        };
        if on_disk != self.read {
            return Err(Error::ChangedOnDisk {
                path: self.path.clone(),
            });
        }
        for held in &self.sources {
            if fs::read(&held.path)? != held.read {
                return Err(Error::ChangedOnDisk {
                    path: held.path.clone(),
                });
            }
        }

        for held in &mut self.sources {
            let bytes = held.ending.apply(held.text.as_str()).into_bytes();
            if bytes != held.read {
                write_file(&held.path, &bytes)?;
                held.read = bytes;
            }
        }

        if self.text.is_blank() {
            if self.read.take().is_some() {
                fs::remove_file(&self.path)?;
            }
            return Ok(());
        }
        let bytes = self.ending.apply(self.text.as_str()).into_bytes();
        if self.read.as_ref() == Some(&bytes) {
            return Ok(());
        }
        fs::create_dir_all(&self.layer_dir)?;
        write_file(&self.path, &bytes)?;
        self.read = Some(bytes);
        Ok(())
    }

    /// The declarations `text` loads to, its sources read from the held ones, else from the
    /// layer.
    fn load(&self, text: &DocumentText) -> Result<Option<Declarations>, GameDataError> {
        if text.is_blank() {
            return Ok(None);
        }
        let name = self
            .path
            .file_name()
            .map_or_else(|| FILE_NAME.into(), |name| name.to_string_lossy());
        load_declarations(&name, text.as_str(), |source| self.source_text(source)).map(Some)
    }

    fn uneditable(&self, reason: Refusal) -> Error {
        Error::Uneditable {
            path: self.path.clone(),
            reason,
        }
    }
}

/// Returns the manifests of the layer at `layer_dir`, including JSON and TOML ones that
/// `ltk_game_data` refuses.
fn present_manifests(layer_dir: &Path) -> Vec<PathBuf> {
    MANIFEST_NAMES
        .iter()
        .chain(&REFUSED_MANIFEST_NAMES)
        .map(|name| layer_dir.join(name))
        .filter(|path| path.exists())
        .collect()
}

/// Writes `bytes` over `path` through a temporary file beside it.
fn write_file(path: &Path, bytes: &[u8]) -> Result<(), Error> {
    let temporary = path.with_extension("ltk-tmp");
    fs::write(&temporary, bytes)?;
    fs::rename(&temporary, path)?;
    Ok(())
}

/// Resolves the source file a manifest names inside the layer.
fn resolve_source(layer_dir: &Path, source: &str) -> Result<PathBuf, GameDataError> {
    let relative = Path::new(source);
    if relative.is_absolute() || source.contains('\\') {
        return Err(GameDataError::in_document(
            GameDataErrorKind::SourcePathInvalid,
            source,
        ));
    }
    let missing = |error: std::io::Error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            GameDataError::in_document(GameDataErrorKind::InputMissing, source)
        } else {
            GameDataError::io(source, &error)
        }
    };
    let root = fs::canonicalize(layer_dir).map_err(missing)?;
    let resolved = fs::canonicalize(layer_dir.join(relative)).map_err(missing)?;
    if !resolved.starts_with(&root) {
        return Err(GameDataError::in_document(
            GameDataErrorKind::InputEscapes,
            source,
        ));
    }
    Ok(resolved)
}
