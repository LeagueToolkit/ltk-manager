//! The ticket counter a scan checks to learn that a newer one has replaced it.

use std::fmt;
use std::marker::PhantomData;
use std::sync::atomic::{AtomicU64, Ordering};

/// The newest scan asked for on one line, so a scan can see it has been overtaken.
///
/// `Line` is a type of its own per line, so a newer scan on one line never gives up a scan
/// another line is waiting on. The tags live in [`line`].
pub struct Generation<Line>(AtomicU64, PhantomData<fn() -> Line>);

impl<Line> Generation<Line> {
    /// Take the newest ticket, which every scan already running is now behind.
    pub fn claim(&self) -> u64 {
        self.0.fetch_add(1, Ordering::Relaxed) + 1
    }

    /// Whether a later scan has claimed a ticket since `ticket`.
    #[must_use]
    pub fn overtook(&self, ticket: u64) -> bool {
        self.0.load(Ordering::Relaxed) > ticket
    }
}

impl<Line> Default for Generation<Line> {
    fn default() -> Self {
        Self(AtomicU64::new(0), PhantomData)
    }
}

impl<Line> fmt::Debug for Generation<Line> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("Generation").field(&self.0).finish()
    }
}

/// The lines a scan runs on, one tag per box that asks.
pub mod line {
    /// The palette's search of the install.
    pub enum Palette {}

    /// The full search of the install.
    pub enum Find {}

    /// A path field's search of the install.
    pub enum PathField {}

    /// The palette's search of the object index.
    pub enum ObjectSearch {}

    /// The objects browser's full search.
    pub enum ObjectFind {}

    /// The References document's query.
    pub enum References {}
}
