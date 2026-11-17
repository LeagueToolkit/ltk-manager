//! Advisories: coded conditions that the manager handled and that change what the user gets.
//!
//! A mod that the build skipped, an archive that the patcher did not serve and an overlay
//! that the patcher refused are advisories. An advisory is not an error: the build or the
//! game went on. It crosses IPC as a code, and the frontend catalog words it (ADR-0017).
//!
//! [`Advisories::raise`] is the one way to raise an advisory. It writes the log line with the
//! code and keeps the advisory on the build or the game that the list belongs to, so the log
//! and the record cannot disagree.

use std::fmt;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// The code of an advisory, on the wire and in the stores.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, strum::Display, strum::EnumIter,
)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "kebab-case")]
#[strum(serialize_all = "kebab-case")]
pub enum AdvisoryCode {
    /// The mod is in the profile and not in the library.
    ModMissing,
    /// The files of the mod are missing on disk.
    ModContentMissing,
    /// The mod has several layers and none is chosen, so the build applies `base` alone.
    LayersUnset,
    /// The strings of the mod target a locale that the game does not have. Nothing raises
    /// it until `ltk_overlay` reports the condition for each mod.
    LocaleMissing,
    /// The entry of the mod cannot be read, so the build skips the mod.
    EntryUnreadable,
    /// The patcher refused the overlay, so no mod was in the game.
    OverlayRefused,
    /// The patcher could not open one modded archive, and the game read its own.
    ArchiveNotServed,
    /// The skin check of the patcher ran against another game version. Nothing raises it
    /// until the patcher writes a record for the condition.
    SkinDataStale,
    /// The patcher that the delivery service offers failed its check, so it is not used.
    DllUnattested,
    /// The patcher wrote an error record that the manager does not know.
    PatcherUncoded,
}

impl AdvisoryCode {
    /// Returns the tier of an advisory that the patcher is the source of, and `None` for
    /// an advisory of the manager's own.
    ///
    /// A precise reason for an integrity refusal tells a bypass author what to change. A
    /// record that the manager does not know is an integrity record.
    #[must_use]
    pub fn tier(self) -> Option<AdvisoryTier> {
        match self {
            Self::ArchiveNotServed | Self::SkinDataStale => Some(AdvisoryTier::Environment),
            Self::OverlayRefused | Self::PatcherUncoded => Some(AdvisoryTier::Integrity),
            Self::ModMissing
            | Self::ModContentMissing
            | Self::LayersUnset
            | Self::LocaleMissing
            | Self::EntryUnreadable
            | Self::DllUnattested => None,
        }
    }
}

/// What the app tells the user about an advisory of the patcher.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "kebab-case")]
pub enum AdvisoryTier {
    /// A cause in the user's environment, such as a file that cannot be opened. The app
    /// names the cause and a fix.
    Environment,
    /// A refusal of the integrity checks. The app shows the code and no reason.
    Integrity,
}

/// What an advisory is about.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AdvisorySubject {
    /// A mod of the library, by its id.
    Mod { id: String },
    /// A game archive, by its last path segment.
    Archive { name: String },
    /// A workshop project under test, by its path.
    Project { path: String },
}

impl AdvisorySubject {
    /// Returns the subject for the mod `id`.
    pub fn mod_id(id: impl Into<String>) -> Self {
        Self::Mod { id: id.into() }
    }

    /// Returns the subject for the archive `name`.
    pub fn archive(name: impl Into<String>) -> Self {
        Self::Archive { name: name.into() }
    }
}

impl fmt::Display for AdvisorySubject {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Mod { id } => write!(f, "mod {id}"),
            Self::Archive { name } => write!(f, "archive {name}"),
            Self::Project { path } => write!(f, "project {path}"),
        }
    }
}

/// One condition that the manager handled and that changes what the user gets.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Advisory {
    pub code: AdvisoryCode,
    pub subject: Option<AdvisorySubject>,
    /// The code that the patcher gave the condition, such as `VRF00000008`.
    pub patcher_code: Option<String>,
    /// The detail for the support report: the text of an error, or the record of the
    /// patcher. No type that crosses IPC holds it, so the app does not show it.
    pub detail: Option<String>,
    pub at: DateTime<Utc>,
}

impl Advisory {
    /// Returns an advisory with the code `code` that was raised at `at`.
    #[must_use]
    pub fn new(code: AdvisoryCode, at: DateTime<Utc>) -> Self {
        Self {
            code,
            subject: None,
            patcher_code: None,
            detail: None,
            at,
        }
    }

    /// Sets what the advisory is about.
    #[must_use]
    pub fn about(mut self, subject: AdvisorySubject) -> Self {
        self.subject = Some(subject);
        self
    }

    /// Sets the code that the patcher gave the condition. `None` leaves the advisory
    /// without one.
    #[must_use]
    pub fn with_patcher_code(mut self, code: Option<String>) -> Self {
        self.patcher_code = code;
        self
    }

    /// Sets the detail for the support report.
    #[must_use]
    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    /// Returns whether `other` is the same condition: the same code, subject, patcher code
    /// and detail, whatever the time.
    fn is_same_condition(&self, other: &Self) -> bool {
        self.code == other.code
            && self.subject == other.subject
            && self.patcher_code == other.patcher_code
            && self.detail == other.detail
    }
}

/// Formats the advisory as its log line: `[mod-missing] mod <id>: <detail>`.
impl fmt::Display for Advisory {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{}]", self.code)?;
        if let Some(code) = &self.patcher_code {
            write!(f, " [{code}]")?;
        }
        if let Some(subject) = &self.subject {
            write!(f, " {subject}")?;
        }
        if let Some(detail) = &self.detail {
            write!(f, ": {detail}")?;
        }
        Ok(())
    }
}

/// The advisories of one build or one game, in the order they were raised.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Advisories(Vec<Advisory>);

impl Advisories {
    /// The largest number of advisories that one build or one game keeps.
    pub const CAP: usize = 64;

    /// Raises `advisory`: writes the log line with its code, and keeps the advisory.
    ///
    /// Keeps a condition once, so a condition that repeats writes one line. Writes the
    /// line and keeps nothing if the list holds [`Self::CAP`] advisories.
    pub fn raise(&mut self, advisory: Advisory) {
        if self.0.iter().any(|kept| kept.is_same_condition(&advisory)) {
            return;
        }
        tracing::warn!("Advisory {advisory}");
        if self.0.len() < Self::CAP {
            self.0.push(advisory);
        }
    }

    /// Adds the advisories of `other`, which were raised and logged before. Keeps a
    /// condition once.
    pub fn merge(&mut self, other: Self) {
        for advisory in other.0 {
            let known = self.0.iter().any(|kept| kept.is_same_condition(&advisory));
            if !known && self.0.len() < Self::CAP {
                self.0.push(advisory);
            }
        }
    }

    /// Returns the advisories in the order they were raised.
    pub fn iter(&self) -> std::slice::Iter<'_, Advisory> {
        self.0.iter()
    }

    /// Returns whether no advisory was raised.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// Returns the number of advisories.
    #[must_use]
    pub fn len(&self) -> usize {
        self.0.len()
    }

    /// Returns the advisories with the detail of each replaced by `rewrite` of it, for a
    /// store that keeps redacted text.
    #[must_use]
    pub fn with_details(&self, rewrite: impl Fn(&str) -> String) -> Self {
        let rewritten = self.0.iter().map(|advisory| Advisory {
            detail: advisory.detail.as_deref().map(&rewrite),
            ..advisory.clone()
        });
        Self(rewritten.collect())
    }
}

impl<'a> IntoIterator for &'a Advisories {
    type Item = &'a Advisory;
    type IntoIter = std::slice::Iter<'a, Advisory>;

    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;
    use strum::IntoEnumIterator;

    use super::*;

    fn at(second: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 11, 17, 12, 0, second).unwrap()
    }

    #[test]
    fn a_code_is_kebab_case_on_the_wire_and_in_the_log() {
        for code in AdvisoryCode::iter() {
            let wire = serde_json::to_value(code).unwrap();
            assert_eq!(wire, serde_json::json!(code.to_string()));
        }
        assert_eq!(
            AdvisoryCode::ModContentMissing.to_string(),
            "mod-content-missing"
        );
    }

    #[test]
    fn only_an_advisory_of_the_patcher_has_a_tier() {
        assert_eq!(AdvisoryCode::ModMissing.tier(), None);
        assert_eq!(
            AdvisoryCode::ArchiveNotServed.tier(),
            Some(AdvisoryTier::Environment)
        );
        assert_eq!(
            AdvisoryCode::PatcherUncoded.tier(),
            Some(AdvisoryTier::Integrity)
        );
    }

    #[test]
    fn display_writes_the_code_the_subject_and_the_detail() {
        let advisory = Advisory::new(AdvisoryCode::OverlayRefused, at(0))
            .with_patcher_code(Some("VRF00000008".to_owned()));
        assert_eq!(advisory.to_string(), "[overlay-refused] [VRF00000008]");

        let advisory = Advisory::new(AdvisoryCode::ArchiveNotServed, at(0))
            .about(AdvisorySubject::archive("Ahri.wad.client"))
            .with_detail("open modded file: not found");
        assert_eq!(
            advisory.to_string(),
            "[archive-not-served] archive Ahri.wad.client: open modded file: not found"
        );
    }

    #[test]
    fn raise_keeps_a_condition_once() {
        let mut advisories = Advisories::default();
        let missing = |second| {
            Advisory::new(AdvisoryCode::ModMissing, at(second)).about(AdvisorySubject::mod_id("a"))
        };
        advisories.raise(missing(0));
        advisories.raise(missing(5));
        advisories.raise(
            Advisory::new(AdvisoryCode::ModMissing, at(6)).about(AdvisorySubject::mod_id("b")),
        );

        assert_eq!(advisories.len(), 2);
        assert_eq!(advisories.iter().next(), Some(&missing(0)));
    }

    #[test]
    fn raise_keeps_the_cap_at_most() {
        let mut advisories = Advisories::default();
        for n in 0..(Advisories::CAP + 5) {
            advisories.raise(
                Advisory::new(AdvisoryCode::ModMissing, at(0))
                    .about(AdvisorySubject::mod_id(n.to_string())),
            );
        }

        assert_eq!(advisories.len(), Advisories::CAP);
    }

    #[test]
    fn merge_adds_the_conditions_that_the_list_does_not_hold() {
        let missing =
            Advisory::new(AdvisoryCode::ModMissing, at(0)).about(AdvisorySubject::mod_id("a"));
        let unattested = Advisory::new(AdvisoryCode::DllUnattested, at(1));
        let mut build = Advisories::default();
        build.raise(missing.clone());
        let mut host = Advisories::default();
        host.raise(missing.clone());
        host.raise(unattested.clone());

        build.merge(host);

        assert_eq!(build.iter().collect::<Vec<_>>(), [&missing, &unattested]);
    }
}
