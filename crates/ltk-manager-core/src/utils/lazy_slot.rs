//! A shared value built on first use and dropped when what it was built from changes.

use std::fmt;
use std::sync::Arc;

use parking_lot::Mutex;

/// A value built on first use and held until [`LazySlot::clear`], handed out as an `Arc`.
///
/// The lock is held across the build, so concurrent callers wait for the first build rather
/// than each running their own. A reader holding an `Arc` keeps its value past a clear.
pub struct LazySlot<T>(Mutex<Option<Arc<T>>>);

impl<T> LazySlot<T> {
    /// A slot that holds nothing yet.
    #[must_use]
    pub const fn new() -> Self {
        Self(Mutex::new(None))
    }

    /// A slot already holding `value`.
    #[must_use]
    pub fn holding(value: T) -> Self {
        Self(Mutex::new(Some(Arc::new(value))))
    }

    /// The value, built by `build` when the slot holds none.
    pub fn get_or_init(&self, build: impl FnOnce() -> T) -> Arc<T> {
        let mut slot = self.0.lock();
        Arc::clone(slot.get_or_insert_with(|| Arc::new(build())))
    }

    /// The value, built by `build` when the slot holds none. A failed build leaves the slot
    /// empty.
    ///
    /// # Errors
    ///
    /// Fails with what `build` raises.
    pub fn get_or_try_init<E>(&self, build: impl FnOnce() -> Result<T, E>) -> Result<Arc<T>, E> {
        let mut slot = self.0.lock();
        if let Some(value) = slot.as_ref() {
            return Ok(Arc::clone(value));
        }

        let value = Arc::new(build()?);
        *slot = Some(Arc::clone(&value));
        Ok(value)
    }

    /// Drop the value, so the next caller builds it again.
    pub fn clear(&self) {
        *self.0.lock() = None;
    }
}

impl<T> Default for LazySlot<T> {
    fn default() -> Self {
        Self::new()
    }
}

/// Whether the slot holds a value. A slot locked by a build prints as unknown.
impl<T> fmt::Debug for LazySlot<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let held = self.0.try_lock().map(|slot| slot.is_some());
        f.debug_tuple("LazySlot").field(&held).finish()
    }
}
