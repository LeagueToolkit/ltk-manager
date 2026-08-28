//! Timing a health pass over the real library, for the dev console.
//!
//! Debug builds only. The numbers a repair is tuned against come from a real
//! library on a real disk, and a synthetic fixture is the one thing that cannot
//! produce them - a 25MB mod of actual bins is what the budget and the pools
//! were sized against.
//!
//! The per-file split rides on `TRACE` and the per-mod line on `DEBUG`, both of
//! which the dev console already streams. What this adds is the trigger and the
//! table, which is the part a reader compares between two builds.

use std::time::{Duration, Instant};

use serde::Serialize;

use crate::config::Config;
use crate::error::AppResult;
use crate::mods::ModLibrary;
use crate::problems::Budget;

/// What one timed pass over the library cost.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct HealthTiming {
    /// Whether the pass repaired, or only checked.
    pub repaired: bool,
    /// Wall-clock milliseconds for the whole pass, concurrency included.
    pub total_ms: u64,
    /// One row per mod, slowest first.
    pub mods: Vec<ModTiming>,
}

/// What one mod of a timed pass cost.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct ModTiming {
    /// The slug, because a uuid is a name nobody can map back to a mod.
    pub slug: String,
    pub millis: u64,
    /// What the pass concluded, or why it could not.
    pub outcome: String,
}

impl ModLibrary {
    /// Time a check - or a repair - over every checkable mod in the library.
    ///
    /// `repair` runs the real thing, which rewrites the mods it can fix and
    /// keeps no way back. The default pass only reads.
    ///
    /// # Errors
    ///
    /// Fails only before the pass starts, for a storage directory that cannot
    /// be resolved or an index that cannot be read.
    pub fn time_mod_health(&self, config: &Config, repair: bool) -> AppResult<HealthTiming> {
        let entries = self.with_index(config, |_storage_dir, index| Ok(index.mods.clone()))?;
        let due: Vec<(String, String)> = entries
            .iter()
            .filter(|entry| entry.is_checkable())
            .map(|entry| {
                let slug = entry
                    .slug
                    .as_ref()
                    .map_or_else(|| entry.id.clone(), |slug| slug.as_str().to_owned());
                (entry.id.clone(), slug)
            })
            .collect();

        tracing::info!(
            "Timing a {} over {} mods",
            if repair { "repair" } else { "check" },
            due.len()
        );
        let started = Instant::now();

        let budget = self.begin_health_run(Budget::repair());
        let timed = budget.map(
            &due,
            crate::problems::budget::MODS_AT_ONCE,
            |_| 0,
            |(mod_id, _)| {
                // Through the `_within` pair, so every mod of the pass spends
                // the one budget the pass is measuring.
                let at = Instant::now();
                let outcome = if repair {
                    self.repair_mod_within(config, mod_id, &budget)
                        .map(|report| format!("{} applied", report.applied))
                } else {
                    self.check_mod_health_within(config, mod_id, &budget)
                        .map(|verdict| format!("{:?}", verdict.health))
                };
                (at.elapsed(), outcome.unwrap_or_else(|e| e.to_string()))
            },
        );
        self.end_health_run(&budget);

        let mut mods: Vec<ModTiming> = due
            .iter()
            .zip(timed)
            .filter_map(|((_, slug), timed)| {
                let (elapsed, outcome) = timed?;
                Some(ModTiming {
                    slug: slug.clone(),
                    millis: elapsed.as_millis() as u64,
                    outcome,
                })
            })
            .collect();
        mods.sort_by_key(|row| std::cmp::Reverse(row.millis));

        let timing = HealthTiming {
            repaired: repair,
            total_ms: started.elapsed().as_millis() as u64,
            mods,
        };
        report(&timing, started.elapsed());
        Ok(timing)
    }
}

/// Write the table into the log the dev console streams.
///
/// One line per mod at `INFO`: a timing run is asked for, so what it found is
/// not the noise the ordinary levels are guarding against.
fn report(timing: &HealthTiming, elapsed: Duration) {
    for row in &timing.mods {
        tracing::info!("  {:>7} ms  {}  ({})", row.millis, row.slug, row.outcome);
    }
    let slowest = timing.mods.first().map_or(0, |row| row.millis);
    tracing::info!(
        "Timed {} mods in {elapsed:?}: slowest {slowest} ms",
        timing.mods.len()
    );
}
