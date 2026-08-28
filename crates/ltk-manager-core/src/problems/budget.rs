//! What bounds a concurrent run: bytes in flight, not threads.
//!
//! A parsed `Bin` is several times its size on disk, so a pool sized by thread
//! count is a pool that pages the moment it lands on a 40MB mod. The unit that
//! actually has to be bounded is memory, and the count of workers only decides
//! how finely it is spent.
//!
//! A run that starts work over `budget` bytes still runs it, one job at a time.
//! Refusing an oversized file would leave a mod permanently unrepairable for
//! being large, which is the opposite of what the budget is for.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};

/// The bytes one repair may hold parsed at once.
///
/// Sized against `ltk_meta`'s expansion of a bin, which is several times the
/// file, and against a machine that is also running the game.
pub const REPAIR_BUDGET: u64 = 512 * 1024 * 1024;

/// The same, for the sweep that runs itself at startup.
///
/// A quarter of a user-pressed repair. The sweep is speculative background work
/// competing with someone browsing their library, so it takes what is left over
/// rather than what a repair would.
pub const SWEEP_BUDGET: u64 = REPAIR_BUDGET / 4;

/// How many mods a run reads at once.
///
/// Two rather than one core per mod: the inner pool is what fills the cores,
/// and a wide outer fan-out only spends the budget on more mods held open at
/// the same time.
pub const MODS_AT_ONCE: usize = 3;

/// The same, for the startup sweep.
pub const SWEEP_MODS_AT_ONCE: usize = 2;

/* The sweep is the one that yields. Held here rather than in a test, because a
future edit to either constant is what would break it. */
const _: () = assert!(SWEEP_BUDGET < REPAIR_BUDGET && SWEEP_MODS_AT_ONCE < MODS_AT_ONCE);

/// A run's share of memory, and whether it has been called off.
///
/// Cloned into every worker of both nesting levels, so the outer fan-out over
/// mods and the inner one over a mod's bins spend one allowance between them
/// rather than one each.
#[derive(Debug, Clone)]
pub struct Budget {
    bytes: Arc<InFlight>,
    cancelled: Arc<AtomicBool>,
}

impl Budget {
    /// A budget of `bytes`, with nothing in flight and nothing cancelled.
    #[must_use]
    pub fn of(bytes: u64) -> Self {
        Self {
            bytes: Arc::new(InFlight::of(bytes)),
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    /// The budget a user-pressed repair runs under.
    #[must_use]
    pub fn repair() -> Self {
        Self::of(REPAIR_BUDGET)
    }

    /// The smaller budget the startup sweep runs under.
    #[must_use]
    pub fn sweep() -> Self {
        Self::of(SWEEP_BUDGET)
    }

    /// Wait until `bytes` are free, and hold them until the guard drops.
    ///
    /// A job larger than the whole budget waits for the run to be otherwise
    /// idle and then runs alone.
    #[must_use]
    pub fn reserve(&self, bytes: u64) -> Reservation<'_> {
        let want = bytes.min(self.bytes.total);
        let mut held = self
            .bytes
            .free
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        while *held < want {
            held = self
                .bytes
                .released
                .wait(held)
                .unwrap_or_else(std::sync::PoisonError::into_inner);
        }
        *held -= want;
        Reservation {
            in_flight: &self.bytes,
            bytes: want,
        }
    }

    /// Call the run off. Every worker stops at its next file.
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
        // A worker parked on the budget would otherwise wait for bytes that
        // are never coming back.
        self.bytes.released.notify_all();
    }

    /// Whether the run has been called off.
    ///
    /// Checked between files rather than inside one: a half-written bin is
    /// worse than a repair that took another few milliseconds to notice.
    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Relaxed)
    }

    /// Run `job` over every item of `work`, on at most `workers` threads.
    ///
    /// Each job holds `weight` of the budget while it runs, so a wide pool over
    /// large files parks itself rather than paging the machine. Results come
    /// back in `work`'s own order, so a run over two threads reports what a run
    /// over one would.
    ///
    /// An item is `None` where the run was called off before reaching it, which
    /// is what tells a caller its answer is partial.
    pub fn map<T, R>(
        &self,
        work: &[T],
        workers: usize,
        weight: impl Fn(&T) -> u64 + Sync,
        job: impl Fn(&T) -> R + Sync,
    ) -> Vec<Option<R>>
    where
        T: Sync,
        R: Send,
    {
        let done: Vec<Mutex<Option<R>>> = work.iter().map(|_| Mutex::new(None)).collect();
        let next = AtomicUsize::new(0);
        let workers = workers.clamp(1, work.len().max(1));

        std::thread::scope(|scope| {
            for _ in 0..workers {
                scope.spawn(|| {
                    loop {
                        let index = next.fetch_add(1, Ordering::Relaxed);
                        if index >= work.len() || self.is_cancelled() {
                            return;
                        }
                        let item = &work[index];
                        let held = self.reserve(weight(item));
                        let answer = job(item);
                        drop(held);
                        *done[index]
                            .lock()
                            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(answer);
                    }
                });
            }
        });

        done.into_iter()
            .map(|slot| {
                slot.into_inner()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
            })
            .collect()
    }
}

/// How many jobs one mod's files are read on at once.
///
/// The machine's parallelism, capped: past a handful the run is waiting on the
/// disk and on the budget rather than on cores, and a library repair is not the
/// only thing the machine is doing.
#[must_use]
pub fn files_at_once() -> usize {
    std::thread::available_parallelism()
        .map_or(4, std::num::NonZeroUsize::get)
        .clamp(2, 8)
}

impl Default for Budget {
    fn default() -> Self {
        Self::repair()
    }
}

/// The bytes a budget has not handed out.
#[derive(Debug)]
struct InFlight {
    total: u64,
    free: Mutex<u64>,
    released: Condvar,
}

impl InFlight {
    fn of(total: u64) -> Self {
        Self {
            total: total.max(1),
            free: Mutex::new(total.max(1)),
            released: Condvar::new(),
        }
    }
}

/// Bytes held for the life of one job, returned when it drops.
#[derive(Debug)]
pub struct Reservation<'a> {
    in_flight: &'a InFlight,
    bytes: u64,
}

impl Drop for Reservation<'_> {
    fn drop(&mut self) {
        let mut held = self
            .in_flight
            .free
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *held += self.bytes;
        drop(held);
        self.in_flight.released.notify_all();
    }
}

#[cfg(test)]
mod tests;
