//! The overlay row of a mod trace: what the record of the last build holds about the mod.

use chrono::{DateTime, Utc};
use ltk_manager_base::advisory::AdvisoryCode;
use ltk_manager_library::{mods::ModWadReport, overlay::BuildRecord};
use serde::Serialize;

use super::{RowState, TraceSubject};

/// What the record of the last overlay build holds about the mod.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(
    tag = "reading",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum OverlayReading {
    /// The build applied the mod.
    Built { built_at: DateTime<Utc> },
    /// The build applied the mod, and the mod or the game changed after it.
    Stale { built_at: DateTime<Utc> },
    /// No build is on record.
    NotBuilt,
    /// The build left the mod out and raised `advisory`.
    LeftOut { advisory: AdvisoryCode },
    /// The build did not get the mod. The mod was enabled, or the project was put under
    /// test, after the build.
    WithoutMod { built_at: DateTime<Utc> },
}

impl OverlayReading {
    /// Returns how a row with this reading ended.
    #[must_use]
    pub fn state(&self) -> RowState {
        match self {
            Self::Built { .. } => RowState::Pass,
            Self::Stale { .. } => RowState::Warn,
            Self::NotBuilt | Self::LeftOut { .. } | Self::WithoutMod { .. } => RowState::Fail,
        }
    }

    /// Returns what the record `build` holds about `subject`.
    ///
    /// `report` is the archive report of the subject. A stale report means that the mod or
    /// the game changed after the build.
    pub(super) fn read(
        build: Option<&BuildRecord>,
        subject: &TraceSubject,
        report: Option<&ModWadReport>,
    ) -> Self {
        let Some(build) = build else {
            return Self::NotBuilt;
        };
        let left_out = build
            .advisories
            .iter()
            .find(|advisory| subject.is_subject_of(advisory) && advisory.code.leaves_mod_out());
        if let Some(advisory) = left_out {
            return Self::LeftOut {
                advisory: advisory.code,
            };
        }

        let built_at = build.built_at;
        let id = subject.overlay_id();
        if !build.mods.iter().any(|applied| *applied == id) {
            Self::WithoutMod { built_at }
        } else if report.is_some_and(|report| report.is_stale) {
            Self::Stale { built_at }
        } else {
            Self::Built { built_at }
        }
    }
}
