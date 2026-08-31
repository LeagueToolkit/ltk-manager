//! The League log codes the manager can name.
//!
//! A retail build of League writes a short stable id, `ALE-` or `SEJ-` and a
//! body, where a message would be. `log_codes.tsv` names the codes the manager
//! can say something about, each with the kind the classifier switches on and a
//! mark for how firm the reading is. A code the table does not know shows as
//! the code, never as an error, so a stale table degrades and never misleads.

use std::collections::HashMap;
use std::fmt;
use std::sync::LazyLock;

use regex::Regex;
use serde::{Deserialize, Serialize};

const TABLE: &str = include_str!("log_codes.tsv");

/// How firm a row's reading is, which is a claim about this table and no more.
///
/// It hedges the one sentence that reads the code and nothing else. What a
/// verdict cost the game is a fact the manager observed, so the mark never
/// grades it - see [`Consequence`](super::incident::Consequence).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "lowercase")]
pub enum EvidenceMark {
    /// The reading is a fact, and the sentence states it as one.
    Confirmed,
    /// The reading is probable, and the sentence says `probably`.
    Inferred,
}

/// What a code means to the classifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CodeKind {
    /// A file the game needed is in no mounted archive. The line carries its hash.
    MissingData,
    /// An archive could not be mounted.
    WadMount,
    /// A texture could not be created.
    Texture,
    /// Memory ran out.
    Memory,
    /// The graphics device faulted.
    Device,
    /// A loading-screen step began. The number is the step, out of 64.
    LoadStep(u8),
    /// The game session ended the way it should.
    Teardown,
    /// Worth a sentence, and nothing more.
    Info,
}

impl CodeKind {
    fn parse(text: &str) -> Option<Self> {
        Some(match text {
            "missing_data" => Self::MissingData,
            "wad_mount" => Self::WadMount,
            "texture" => Self::Texture,
            "memory" => Self::Memory,
            "device" => Self::Device,
            "teardown" => Self::Teardown,
            "info" => Self::Info,
            other => Self::LoadStep(other.strip_prefix("load_step:")?.parse().ok()?),
        })
    }
}

impl fmt::Display for CodeKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingData => f.write_str("missing_data"),
            Self::WadMount => f.write_str("wad_mount"),
            Self::Texture => f.write_str("texture"),
            Self::Memory => f.write_str("memory"),
            Self::Device => f.write_str("device"),
            Self::LoadStep(step) => write!(f, "load_step:{step}"),
            Self::Teardown => f.write_str("teardown"),
            Self::Info => f.write_str("info"),
        }
    }
}

/// One row of the table.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CodeRow {
    pub code: &'static str,
    pub kind: CodeKind,
    pub mark: EvidenceMark,
    /// One sentence a user reads, under its mark.
    pub meaning: &'static str,
}

static ROWS: LazyLock<HashMap<&'static str, CodeRow>> = LazyLock::new(|| {
    TABLE
        .lines()
        .skip(1)
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            let row = parse_row(line).unwrap_or_else(|| {
                panic!("log_codes.tsv holds a row the reader cannot parse: {line:?}")
            });
            (row.code, row)
        })
        .collect()
});

fn parse_row(line: &'static str) -> Option<CodeRow> {
    let mut columns = line.split('\t');
    let code = columns.next()?.trim();
    let kind = CodeKind::parse(columns.next()?.trim())?;
    let mark = match columns.next()?.trim() {
        "confirmed" => EvidenceMark::Confirmed,
        "inferred" => EvidenceMark::Inferred,
        _ => return None,
    };
    let meaning = columns.next()?.trim();
    if code.is_empty() || meaning.is_empty() || columns.next().is_some() {
        return None;
    }
    Some(CodeRow {
        code,
        kind,
        mark,
        meaning,
    })
}

/// The row for `code`, matched case-sensitively because the bodies mix cases.
pub fn lookup(code: &str) -> Option<&'static CodeRow> {
    ROWS.get(code)
}

/// Every row the table holds, in no particular order.
pub fn rows() -> impl Iterator<Item = &'static CodeRow> {
    ROWS.values()
}

/// Bodies are alphanumeric and seven to ten characters, so a hex class or an
/// upper-case class would drop real codes.
static CODE_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\b(?:ALE|SEJ)-[0-9A-Za-z]{7,10}\b").expect("a valid code pattern")
});

/// Every code in `text`, in order, whether or not the table knows it.
pub fn find_codes(text: &str) -> impl Iterator<Item = &str> {
    CODE_PATTERN.find_iter(text).map(|found| found.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_table_parses() {
        assert!(rows().count() > 50);
    }

    #[test]
    fn confirmed_and_inferred_rows_keep_their_mark() {
        let missing = lookup("ALE-9B39AA45").expect("the missing-data row");
        assert_eq!(missing.kind, CodeKind::MissingData);
        assert_eq!(missing.mark, EvidenceMark::Confirmed);

        let unverified = lookup("ALE-9D171D1D").expect("a wad-mount row");
        assert_eq!(unverified.kind, CodeKind::WadMount);
        assert_eq!(unverified.mark, EvidenceMark::Inferred);
    }

    #[test]
    fn load_steps_carry_their_number() {
        assert_eq!(
            lookup("SEJ-9F31B5D0").map(|row| row.kind),
            Some(CodeKind::LoadStep(52))
        );
        assert_eq!(CodeKind::LoadStep(52).to_string(), "load_step:52");
    }

    #[test]
    fn lookup_is_case_sensitive() {
        assert!(lookup("ALE-89b0dee7").is_some());
        assert!(lookup("ALE-89B0DEE7").is_none());
    }

    #[test]
    fn an_unknown_code_has_no_row() {
        assert!(lookup("SEJ-ZZZZZZZZ").is_none());
    }

    #[test]
    fn codes_are_found_in_every_form_they_take() {
        let channel: Vec<_> = find_codes("000003.691| ALWAYS|  LOAD| SEJ-1A4F7C20").collect();
        assert_eq!(channel, ["SEJ-1A4F7C20"]);

        let standalone: Vec<_> =
            find_codes("ALE-9B39AA45 FATAL ERROR. Missing data: 0x1a2b3c4d5e6f7081").collect();
        assert_eq!(standalone, ["ALE-9B39AA45"]);

        let quoted: Vec<_> =
            find_codes(r#"Error: "ALE-D0D00022" - Result: E_INVALIDARG."#).collect();
        assert_eq!(quoted, ["ALE-D0D00022"]);
    }

    #[test]
    fn alphanumeric_bodies_are_codes_too() {
        let found: Vec<_> =
            find_codes("ALE-8SDFH23F and SEJ-9Z6Y34B0 and ALE-1234567890").collect();
        assert_eq!(found, ["ALE-8SDFH23F", "SEJ-9Z6Y34B0", "ALE-1234567890"]);
    }

    #[test]
    fn a_short_or_long_body_is_not_a_code() {
        assert_eq!(find_codes("ALE-ABC123").count(), 0);
        assert_eq!(find_codes("ALE-ABCDEF12345").count(), 0);
    }

    #[test]
    fn every_row_reads_as_a_sentence_a_user_can_take() {
        for row in rows() {
            assert!(row.meaning.len() > 10, "{} has no meaning", row.code);
            assert!(
                !row.meaning.ends_with('.'),
                "{} ends with a full stop, which the UI adds",
                row.code
            );
        }
    }
}
