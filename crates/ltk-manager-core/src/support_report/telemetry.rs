//! The telemetry event of a support report: `support_report_created`.
//!
//! The event counts the reports that leave the `Get help` dialog. It holds where the user
//! opened the dialog, how the report left and one code that names the failure. Every value
//! is a code from a fixed set. The event holds no text of the report, no mod and no path.

use ltk_manager_base::advisory::AdvisoryCode;
use ltk_telemetry::Properties;
use serde::{Deserialize, Serialize};

use super::{BuiltReport, ReportOrigin, SupportReport};

/// The event that one report reports when it leaves the dialog.
pub const SUPPORT_REPORT_CREATED: &str = "support_report_created";

/// The longest error code that travels as a top code, in bytes.
const MAX_ERROR_CODE_BYTES: usize = 40;

/// Where the user opened the `Get help` dialog.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, strum::Display)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "kebab-case")]
#[strum(serialize_all = "kebab-case")]
pub enum ReportEntry {
    /// `Get help` on an error toast.
    ErrorToast,
    /// The screen that replaces the app after a crash of the frontend.
    CrashScreen,
    /// The screen that replaces one route after its render failed.
    RouteError,
    /// The `Manager crashed` line of the session bar.
    PanicLine,
    /// The verdict line of the session bar.
    VerdictLine,
    /// An incident on the Games tab.
    GamesTab,
    /// The mod trace panel.
    ModTrace,
    /// The About section of the settings.
    Settings,
    /// The title bar menu.
    TitleBar,
    /// The command palette.
    CommandPalette,
}

/// How a report left the dialog.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, strum::Display)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "kebab-case")]
#[strum(serialize_all = "kebab-case")]
pub enum ReportRoute {
    /// `Save as file`.
    File,
    /// `Copy for Discord`, which saves the zip and copies the summary.
    Discord,
}

/// Where a report was opened and how it left, as the dialog states it when the report is
/// saved.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ReportDelivery {
    pub entry: ReportEntry,
    pub route: ReportRoute,
}

/// The set that a top code is from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::Display)]
#[strum(serialize_all = "kebab-case")]
pub enum TopCodeKind {
    /// The code of the error that the report was opened from, such as `IO`.
    Error,
    /// The verdict kind of the incident of the report, such as `missing-data`.
    Verdict,
    /// An advisory code, such as `overlay-refused`.
    Advisory,
}

/// The one code that names the failure that a report is about.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TopCode {
    pub kind: TopCodeKind,
    pub code: String,
}

impl TopCode {
    /// Returns the top code of `report`.
    ///
    /// The code of the error that the report was opened from comes first, because the user
    /// asked about that error. The verdict of the incident is second. The advisory that
    /// tells the most is third. Returns `None` if the report holds none of the three.
    pub(super) fn of(report: &SupportReport) -> Option<Self> {
        if let Some(ReportOrigin::Error { error }) = &report.description.origin
            && Self::is_error_code(&error.code)
        {
            return Some(Self {
                kind: TopCodeKind::Error,
                code: error.code.clone(),
            });
        }
        if let Some(found) = &report.found {
            let kind = serde_json::to_value(found.kind).ok()?;
            return Some(Self {
                kind: TopCodeKind::Verdict,
                code: kind.as_str()?.to_owned(),
            });
        }
        let advisory = report
            .advisories
            .iter()
            .map(|reported| reported.advisory.code)
            .min_by_key(|code| Self::advisory_rank(*code))?;
        Some(Self {
            kind: TopCodeKind::Advisory,
            code: advisory.to_string(),
        })
    }

    /// Returns whether `code` has the form of an error code: capital letters, digits and
    /// underscores. The frontend sends the code, so the form is checked before the code
    /// leaves in an event.
    fn is_error_code(code: &str) -> bool {
        !code.is_empty()
            && code.len() <= MAX_ERROR_CODE_BYTES
            && code
                .bytes()
                .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
    }

    /// Returns the rank of an advisory code among the advisories of one report. The code
    /// with the lowest rank tells the most about why no mod, or one mod, was not in the
    /// game.
    fn advisory_rank(code: AdvisoryCode) -> u8 {
        match code {
            AdvisoryCode::OverlayRefused => 0,
            AdvisoryCode::DllUnattested => 1,
            AdvisoryCode::PatcherUncoded => 2,
            AdvisoryCode::ArchiveNotServed => 3,
            AdvisoryCode::SkinDataStale => 4,
            AdvisoryCode::EntryUnreadable => 5,
            AdvisoryCode::ModContentMissing => 6,
            AdvisoryCode::ModMissing => 7,
            AdvisoryCode::LocaleMissing => 8,
            AdvisoryCode::LayersUnset => 9,
        }
    }
}

impl BuiltReport {
    /// Returns the top code of the report, or `None` if the report holds no error code, no
    /// verdict and no advisory.
    #[must_use]
    pub fn top_code(&self) -> Option<&TopCode> {
        self.top_code.as_ref()
    }

    /// Returns the properties of `support_report_created` for the report as it left by
    /// `delivery`: the version of the manager, the entry point, the route and the top code.
    #[must_use]
    pub fn created_event(&self, delivery: ReportDelivery) -> Properties {
        let mut properties = Properties::new()
            .with("app_version", self.manifest.app.version.clone())
            .with("entry", delivery.entry.to_string())
            .with("route", delivery.route.to_string());
        if let Some(top) = &self.top_code {
            properties.insert("top_code", top.code.clone());
            properties.insert("top_code_kind", top.kind.to_string());
        }
        properties
    }
}
