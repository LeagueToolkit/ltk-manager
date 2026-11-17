//! The rows of a mod trace: the state of a row and the reading of each source.

use ltk_manager_base::advisory::AdvisoryCode;
use ltk_manager_library::mods::ModHealth;
use serde::Serialize;

use super::{GameReading, OverlayReading};

/// How one row of a trace ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "kebab-case")]
pub enum RowState {
    /// The row holds nothing that keeps the mod out of the game.
    Pass,
    /// The row holds a condition that can keep the mod out of the game. The trace goes on.
    Warn,
    /// The mod did not get past the row. The trace ends here.
    Fail,
    /// The manager holds no answer for the row.
    Unknown,
}

/// One row of a trace: the reading of one source, and how the row ended.
///
/// Serializes as one object: `state`, `row` and the fields of the reading.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct TraceRow {
    /// The state of `reading`.
    pub state: RowState,
    #[serde(flatten)]
    pub reading: RowReading,
}

impl From<RowReading> for TraceRow {
    fn from(reading: RowReading) -> Self {
        Self {
            state: reading.state(),
            reading,
        }
    }
}

/// What one source holds about the mod. Each variant is one source.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(
    tag = "row",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum RowReading {
    /// The library index: whether the active profile enables the mod.
    Enabled { enabled: bool, profile: String },
    /// The mod health verdict. `check` is `None` if the mod was never checked.
    Health { check: Option<HealthCheck> },
    /// The record of the last overlay build.
    Overlay(OverlayReading),
    /// The archive report: the game archives that the mod patches, each by its last path
    /// segment.
    Archives { archives: Vec<String> },
    /// One advisory that the last build raised about the mod, and applied the mod.
    Advisory { code: AdvisoryCode },
    /// The newest game record and the game log directory.
    LastGame(GameReading),
}

impl RowReading {
    /// Returns how a row with this reading ended.
    #[must_use]
    pub fn state(&self) -> RowState {
        match self {
            Self::Enabled { enabled: true, .. } => RowState::Pass,
            Self::Enabled { enabled: false, .. } => RowState::Fail,
            Self::Health { check: None } => RowState::Unknown,
            Self::Health { check: Some(check) } => match check.health {
                ModHealth::Healthy => RowState::Pass,
                ModHealth::Repairable | ModHealth::Unrepairable => RowState::Warn,
            },
            Self::Overlay(reading) => reading.state(),
            Self::Archives { archives } if archives.is_empty() => RowState::Fail,
            Self::Archives { .. } => RowState::Pass,
            Self::Advisory { .. } => RowState::Warn,
            Self::LastGame(reading) => reading.state(),
        }
    }
}

/// The last health check of a mod.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct HealthCheck {
    pub health: ModHealth,
    /// ISO-8601.
    pub checked_at: String,
}
