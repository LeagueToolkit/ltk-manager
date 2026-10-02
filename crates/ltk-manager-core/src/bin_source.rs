//! A bin opened by its magic: a `PROP` mounted as a stream, or a `PTCH` parsed whole.

use std::io::{Read, Seek, SeekFrom};

use ltk_meta::BinOverride;
use ltk_meta::stream::BinStream;

/// The magic a `PTCH` opens with, which the streaming reader refuses.
const PATCH_MAGIC: [u8; 4] = *b"PTCH";

/// A bin opened by its kind.
pub(crate) enum BinSource<R: Read + Seek> {
    /// A `PROP`, mounted. One object's bytes in memory at a time.
    Stream(BinStream<R>),
    /// A `PTCH`, parsed whole.
    Patch(BinOverride),
}

impl<R: Read + Seek> BinSource<R> {
    /// Open `source` by its magic.
    ///
    /// # Errors
    ///
    /// Fails when `source` cannot be read or is not a bin the toolkit reads.
    pub(crate) fn open(mut source: R) -> Result<Self, ltk_meta::Error> {
        let mut magic = [0u8; 4];
        source.read_exact(&mut magic)?;
        source.seek(SeekFrom::Start(0))?;

        if magic == PATCH_MAGIC {
            return Ok(Self::Patch(BinOverride::from_reader(&mut source)?));
        }
        Ok(Self::Stream(BinStream::mount(source)?))
    }
}
