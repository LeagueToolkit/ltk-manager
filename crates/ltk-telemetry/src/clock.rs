//! The source of the current time, handed in rather than called.

use chrono::{DateTime, TimeZone, Utc};
use parking_lot::Mutex;

/// What the current UTC instant is, for whoever is asking.
pub trait Clock: std::fmt::Debug + Send + Sync {
    /// The instant an event carries and an identity is derived from.
    fn now(&self) -> DateTime<Utc>;
}

/// The wall clock of the machine.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> DateTime<Utc> {
        Utc::now()
    }
}

/// A clock a test moves by hand, across a date boundary or not at all.
#[derive(Debug)]
pub struct FixedClock(Mutex<DateTime<Utc>>);

impl FixedClock {
    /// A clock stopped at `instant`.
    #[must_use]
    pub fn new(instant: DateTime<Utc>) -> Self {
        Self(Mutex::new(instant))
    }

    /// A clock stopped at midnight UTC on the given calendar day.
    ///
    /// # Panics
    ///
    /// Panics when the three parts do not name a real date, which is a bug in
    /// the test that wrote them.
    #[must_use]
    pub fn at_midnight(year: i32, month: u32, day: u32) -> Self {
        let instant = Utc
            .with_ymd_and_hms(year, month, day, 0, 0, 0)
            .single()
            .expect("the test named a date that does not exist");
        Self::new(instant)
    }

    /// Move the clock to `instant`.
    pub fn set(&self, instant: DateTime<Utc>) {
        *self.0.lock() = instant;
    }
}

impl Clock for FixedClock {
    fn now(&self) -> DateTime<Utc> {
        *self.0.lock()
    }
}
