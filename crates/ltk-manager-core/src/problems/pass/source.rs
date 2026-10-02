//! Where the bin round's objects come from: a `PROP` mounted as a stream, or
//! a `PTCH` parsed whole.
//!
//! The one function the streaming reader sits behind, with the `PTCH`
//! fallback beside it and nowhere else (FR-10, D17).

use std::io::{Read, Seek};

use ltk_meta::walk::WalkOutcome;

pub(super) use crate::bin_source::BinSource;
use crate::problems::FileHandle;
use crate::problems::engine::Opened;

use super::fan::Fan;

impl BinSource<Opened> {
    /// Open `handle` by its magic.
    ///
    /// # Errors
    ///
    /// A file that cannot be opened, or whose first bytes are not a bin the
    /// toolkit reads, as one sentence a panel can draw.
    pub(super) fn open_handle(handle: &FileHandle<'_>) -> Result<Self, String> {
        Self::open(handle.open()?).map_err(|e| e.to_string())
    }
}

impl<R: Read + Seek> BinSource<R> {
    /// Walk every object through `fan`, in file order. A `PTCH`'s objects walk as a
    /// `PROP`'s do, and its patch records are outside the pass.
    ///
    /// # Errors
    ///
    /// An object the source could not read. Objects before it were walked, and
    /// the pass reports the failure under every subscriber at the file's site.
    pub(super) fn walk(&mut self, fan: &mut Fan<'_, '_>) -> Result<WalkOutcome, ltk_meta::Error> {
        match self {
            Self::Stream(stream) => stream.walk(fan),
            Self::Patch(patch) => patch.walk(fan),
        }
    }
}
