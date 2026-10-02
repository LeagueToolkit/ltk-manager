//! The `IMAA` sprite manifest a view controller loads at its `PathHashToSelf`, per section 6 of
//! docs/research/ui-data-layout.md.
//!
//! The magic reads `IMAA` on disk and is the constant `'AAMI'` as a little-endian `u32`.

use std::io::{self, Write};

use hexshade::bundle::chunk_hash;

const MAGIC: &[u8; 4] = b"IMAA";
const ENTRY_SIZE: usize = 28;

/// The pages of a view controller's folder, `uiautoatlas/<folder>/atlas_<index>.tex`.
#[must_use]
pub fn page_path(folder: &str, index: usize) -> String {
    format!("uiautoatlas/{}/atlas_{index}.tex", folder.to_lowercase())
}

/// The key a `LooseUiTextureData.TextureName` looks its sprite up by, the chunk hash of the name.
#[must_use]
pub fn sprite_key(texture_name: &str) -> u64 {
    chunk_hash(texture_name)
}

/// A view controller's sprite manifest: its pages and one UV rect per sprite.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Manifest {
    /// The path hash of each page, which an entry names by index.
    pub pages: Vec<u64>,
    pub entries: Vec<ManifestEntry>,
}

/// One sprite of a manifest.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ManifestEntry {
    /// The XXH64 of the source image path, as [`sprite_key`] computes it.
    pub key: u64,
    /// `u0, v0, u1, v1`, normalized to the page.
    pub uv: [f32; 4],
    /// The index into [`Manifest::pages`].
    pub page: u32,
}

/// Why bytes are not a manifest.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[non_exhaustive]
pub enum ManifestError {
    #[error("The file does not start with IMAA")]
    Magic,
    #[error("The file ends inside its {0}")]
    Truncated(&'static str),
    #[error("The file has {0} bytes after its last entry")]
    Trailing(usize),
    #[error("Entry {entry} names page {page}, and the file lists {pages}")]
    PageOutOfRange {
        entry: usize,
        page: u32,
        pages: usize,
    },
}

impl Manifest {
    /// Parse a manifest, keeping its entries in file order.
    ///
    /// # Errors
    ///
    /// Fails on a wrong magic, a short or long file, or an entry naming a page the file does
    /// not list.
    pub fn read(bytes: &[u8]) -> Result<Self, ManifestError> {
        let mut reader = Reader { bytes, at: 0 };
        if reader.take(4, "magic")? != MAGIC {
            return Err(ManifestError::Magic);
        }

        let page_count = reader.u32("page count")? as usize;
        let pages = (0..page_count)
            .map(|_| reader.u64("pages"))
            .collect::<Result<Vec<_>, _>>()?;

        let entry_count = reader.u32("entry count")? as usize;
        if bytes.len().saturating_sub(reader.at) < entry_count.saturating_mul(ENTRY_SIZE) {
            return Err(ManifestError::Truncated("entries"));
        }
        let mut entries = Vec::with_capacity(entry_count);
        for index in 0..entry_count {
            let key = reader.u64("entries")?;
            let mut uv = [0.0; 4];
            for value in &mut uv {
                *value = f32::from_bits(reader.u32("entries")?);
            }
            let page = reader.u32("entries")?;
            if page as usize >= pages.len() {
                return Err(ManifestError::PageOutOfRange {
                    entry: index,
                    page,
                    pages: pages.len(),
                });
            }
            entries.push(ManifestEntry { key, uv, page });
        }

        let trailing = bytes.len() - reader.at;
        if trailing > 0 {
            return Err(ManifestError::Trailing(trailing));
        }
        Ok(Self { pages, entries })
    }

    /// Write the manifest with its entries sorted by key, which the client binary-searches.
    ///
    /// # Errors
    ///
    /// Fails where `out` does.
    pub fn write(&self, out: &mut impl Write) -> io::Result<()> {
        let mut entries = self.entries.clone();
        entries.sort_by_key(|entry| entry.key);

        out.write_all(MAGIC)?;
        out.write_all(&count(self.pages.len())?.to_le_bytes())?;
        for page in &self.pages {
            out.write_all(&page.to_le_bytes())?;
        }

        out.write_all(&count(entries.len())?.to_le_bytes())?;
        for entry in &entries {
            out.write_all(&entry.key.to_le_bytes())?;
            for value in entry.uv {
                out.write_all(&value.to_le_bytes())?;
            }
            out.write_all(&entry.page.to_le_bytes())?;
        }
        Ok(())
    }

    /// The entry under `key`, found by binary search as the client finds it, so an unsorted
    /// manifest misses here where it misses in game.
    #[must_use]
    pub fn find(&self, key: u64) -> Option<&ManifestEntry> {
        let at = self
            .entries
            .binary_search_by_key(&key, |entry| entry.key)
            .ok()?;
        self.entries.get(at)
    }

    /// Whether the entries are in ascending key order, which [`Manifest::find`] needs.
    #[must_use]
    pub fn is_sorted(&self) -> bool {
        self.entries.is_sorted_by_key(|entry| entry.key)
    }
}

fn count(len: usize) -> io::Result<u32> {
    u32::try_from(len).map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "too many items"))
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, len: usize, what: &'static str) -> Result<&'a [u8], ManifestError> {
        let end = self
            .at
            .checked_add(len)
            .ok_or(ManifestError::Truncated(what))?;
        let slice = self
            .bytes
            .get(self.at..end)
            .ok_or(ManifestError::Truncated(what))?;
        self.at = end;
        Ok(slice)
    }

    fn u32(&mut self, what: &'static str) -> Result<u32, ManifestError> {
        let bytes = self.take(4, what)?;
        Ok(u32::from_le_bytes(bytes.try_into().expect("four bytes")))
    }

    fn u64(&mut self, what: &'static str) -> Result<u64, ManifestError> {
        let bytes = self.take(8, what)?;
        Ok(u64::from_le_bytes(bytes.try_into().expect("eight bytes")))
    }
}
