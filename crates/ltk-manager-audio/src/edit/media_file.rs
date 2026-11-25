//! A media bank or a package that an event bank document adds media to.

use std::collections::{BTreeMap, BTreeSet};
use std::io::Cursor;

use ltk_manager_assets::preview::AssetRef;
use ltk_wwise::{Bank, Package, SourceId};
use xxhash_rust::xxh64::xxh64;

use super::BankEditError;

/// A media bank or a package of the bank set, with the media that the document added to it or
/// removed from it.
///
/// The file writes the bytes it was read from while it holds no added media and no removed media, so
/// an undo of every change restores those bytes exactly.
#[derive(Debug)]
pub struct MediaFile {
    path: String,
    asset: AssetRef,
    /// The bytes that the file was read from.
    opened: Vec<u8>,
    /// The file as it was read.
    model: MediaModel,
    /// The media that the document added, by source ID.
    added: BTreeMap<SourceId, Vec<u8>>,
    /// The media that the document removed from the file, by source ID.
    removed: BTreeSet<SourceId>,
    /// The file with the added media and removed media, written out. `None` while it holds neither.
    written: Option<Vec<u8>>,
    /// The xxh64 of the bytes that the file was read from or last saved as.
    base: u64,
    /// The added or removed media changed since the file was last written.
    stale: bool,
}

#[derive(Debug, Clone)]
enum MediaModel {
    Bank(Bank),
    Package(Package),
}

impl MediaFile {
    /// Reads `bytes` of the game path `path` as a media bank or a package.
    ///
    /// # Errors
    ///
    /// Fails if a `.wpk` is not a package, or if a bank does not read or has no media index.
    pub(super) fn read(
        path: &str,
        asset: AssetRef,
        bytes: Vec<u8>,
        package: bool,
    ) -> Result<Self, BankEditError> {
        let model = if package {
            MediaModel::Package(Package::from_reader(&mut Cursor::new(&bytes))?)
        } else {
            let bank = Bank::from_reader(&mut Cursor::new(&bytes))?;
            if bank.media().is_none() {
                return Err(BankEditError::NoMediaFile);
            }
            MediaModel::Bank(bank)
        };

        Ok(Self {
            path: path.to_owned(),
            asset,
            base: xxh64(&bytes, 0),
            opened: bytes,
            model,
            added: BTreeMap::new(),
            removed: BTreeSet::new(),
            written: None,
            stale: false,
        })
    }

    /// Returns the game path of the file.
    #[must_use]
    pub fn path(&self) -> &str {
        &self.path
    }

    /// Returns the layer file or game chunk that a save writes.
    #[must_use]
    pub fn asset(&self) -> &AssetRef {
        &self.asset
    }

    /// Points the file at `asset`, the layer copy of a game chunk.
    pub fn set_asset(&mut self, asset: AssetRef) {
        self.asset = asset;
    }

    /// Returns `true` for a package, and `false` for a media bank.
    #[must_use]
    pub fn is_package(&self) -> bool {
        matches!(self.model, MediaModel::Package(_))
    }

    /// Returns the file with the added media, written out.
    #[must_use]
    pub fn bytes(&self) -> &[u8] {
        self.written.as_deref().unwrap_or(&self.opened)
    }

    /// Returns the bytes that the file was read from.
    #[must_use]
    pub fn opened(&self) -> &[u8] {
        &self.opened
    }

    /// Returns `true` if `bytes` are the bytes that the file was read from or last saved as.
    #[must_use]
    pub fn is_base(&self, bytes: &[u8]) -> bool {
        xxh64(bytes, 0) == self.base
    }

    /// Returns `true` if the file differs from the bytes it was read from or last saved as.
    #[must_use]
    pub fn is_changed(&self) -> bool {
        !self.is_base(self.bytes())
    }

    /// Returns `true` if the file holds the media `source`, added or as read and not removed.
    #[must_use]
    pub fn contains(&self, source: SourceId) -> bool {
        if self.removed.contains(&source) {
            return false;
        }

        self.added.contains_key(&source)
            || match &self.model {
                MediaModel::Bank(bank) => bank.media().is_some_and(|media| media.contains(source)),
                MediaModel::Package(package) => package.wem(source).is_some(),
            }
    }

    /// Returns the WEM bytes of the media `source`, added or as read and not removed.
    #[must_use]
    pub fn media(&self, source: SourceId) -> Option<&[u8]> {
        if self.removed.contains(&source) {
            return None;
        }

        if let Some(data) = self.added.get(&source) {
            return Some(data);
        }

        match &self.model {
            MediaModel::Bank(bank) => bank.media()?.get(source),
            MediaModel::Package(package) => package.wem(source),
        }
    }

    /// Returns `true` if the document added the media `source`, as a new media or a replacement.
    #[must_use]
    pub fn added(&self, source: SourceId) -> bool {
        self.added.contains_key(&source)
    }

    /// Returns `true` if the file held the media `source` when it was read and has not removed it.
    #[must_use]
    pub fn is_original(&self, source: SourceId) -> bool {
        !self.removed.contains(&source)
            && match &self.model {
                MediaModel::Bank(bank) => bank.media().is_some_and(|media| media.contains(source)),
                MediaModel::Package(package) => package.wem(source).is_some(),
            }
    }

    /// Returns the source IDs of the media that the file held when it was read and that the
    /// document replaced, in ascending order.
    pub fn replaced(&self) -> impl Iterator<Item = SourceId> + '_ {
        self.added
            .keys()
            .copied()
            .filter(|source| self.is_original(*source))
    }

    pub(super) fn add(&mut self, source: SourceId, data: Vec<u8>) {
        self.removed.remove(&source);

        let in_model_same = match &self.model {
            MediaModel::Bank(bank) => bank.media().and_then(|m| m.get(source)) == Some(&data),
            MediaModel::Package(package) => package.wem(source) == Some(&data),
        };
        if in_model_same {
            self.added.remove(&source);
        } else {
            self.added.insert(source, data);
        }

        self.stale = true;
    }

    /// Sets the added media `source` to `data`, or drops it for `None`, and returns what the file
    /// added at `source` before.
    pub(super) fn set(&mut self, source: SourceId, data: Option<Vec<u8>>) -> Option<Vec<u8>> {
        self.stale = true;
        self.removed.remove(&source);

        match data {
            Some(data) => self.added.insert(source, data),
            None => self.added.remove(&source),
        }
    }

    pub(super) fn remove(&mut self, source: SourceId) -> Option<Vec<u8>> {
        let previous = self.media(source).map(Vec::from);
        previous.as_ref()?;

        self.added.remove(&source);
        let in_model = match &self.model {
            MediaModel::Bank(bank) => bank.media().is_some_and(|media| media.contains(source)),
            MediaModel::Package(package) => package.wem(source).is_some(),
        };
        if in_model {
            self.removed.insert(source);
        }

        self.stale = true;
        previous
    }

    /// Writes the file again if its media changed.
    pub(super) fn refresh(&mut self) -> Result<(), BankEditError> {
        if !self.stale {
            return Ok(());
        }
        self.stale = false;

        if self.added.is_empty() && self.removed.is_empty() {
            self.written = None;
            return Ok(());
        }

        let mut bytes = Vec::with_capacity(
            self.opened.len() + self.added.values().map(Vec::len).sum::<usize>(),
        );
        match &mut self.model.clone() {
            MediaModel::Bank(bank) => {
                let media = bank.media_mut().ok_or(BankEditError::NoMediaFile)?;
                for source in &self.removed {
                    media.remove(*source);
                }
                for (source, data) in &self.added {
                    media.insert(*source, data.clone());
                }
                bank.to_writer(&mut bytes)?;
            }
            MediaModel::Package(package) => {
                for source in &self.removed {
                    package.remove(crate::sound::package_key(*source));
                }
                for (source, data) in &self.added {
                    package.insert_wem(*source, data.clone());
                }
                package.to_writer(&mut bytes)?;
            }
        }
        self.written = Some(bytes);
        Ok(())
    }

    pub(super) fn mark_saved(&mut self) {
        self.base = xxh64(self.bytes(), 0);
    }
}
