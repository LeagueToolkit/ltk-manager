//! The runs of a command that a cancel or a newer run calls off.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use ltk_manager_core::generation::Generation;
use ltk_manager_core::launcher::StopFlag;
use parking_lot::Mutex;
use tauri::{AppHandle, Manager};

/// A flag that calls one run off.
pub(crate) trait Cancel: Clone {
    /// A flag for a run that has not been called off.
    fn fresh() -> Self;

    /// Call the run off.
    fn cancel(&self);
}

impl Cancel for Arc<AtomicBool> {
    fn fresh() -> Self {
        Arc::new(AtomicBool::new(false))
    }

    fn cancel(&self) {
        self.store(true, Ordering::Relaxed);
    }
}

impl Cancel for StopFlag {
    fn fresh() -> Self {
        StopFlag::new()
    }

    fn cancel(&self) {
        self.stop();
    }
}

/// The run in flight, and the flag that calls it off.
///
/// The flag is per run rather than per slot, so a cancelled run stays cancelled and does not
/// pre-cancel the next.
pub(crate) struct InFlight<F>(Mutex<Option<F>>);

impl<F> Default for InFlight<F> {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

impl<F: Cancel> InFlight<F> {
    /// Claim the slot with a fresh flag, or `None` while a run holds it.
    #[must_use]
    pub(crate) fn acquire(&self) -> Option<(InFlightGuard<'_, F>, F)> {
        let mut in_flight = self.0.lock();
        if in_flight.is_some() {
            return None;
        }

        let flag = F::fresh();
        *in_flight = Some(flag.clone());
        Some((InFlightGuard(self), flag))
    }

    /// Call the run in flight off, reporting whether there was one.
    pub(crate) fn cancel(&self) -> bool {
        let in_flight = self.0.lock();
        let Some(flag) = in_flight.as_ref() else {
            return false;
        };

        flag.cancel();
        true
    }
}

/// Releases the slot on every exit path, including the error ones.
pub(crate) struct InFlightGuard<'a, F>(&'a InFlight<F>);

impl<F> Drop for InFlightGuard<'_, F> {
    fn drop(&mut self) {
        *self.0 .0.lock() = None;
    }
}

/// A fresh ticket on `Line`, and the test of whether a newer scan on that line has overtaken it.
pub(crate) fn overtaken<Line: 'static>(
    app: &AppHandle,
) -> impl Fn() -> bool + Send + Sync + 'static {
    let ticket = app.state::<Generation<Line>>().claim();
    let app = app.clone();

    move || app.state::<Generation<Line>>().overtook(ticket)
}

#[cfg(test)]
mod tests;
