//! The report text: one incident as the text a support thread wants.

use std::fmt::Write;

use super::incident::{EvidenceSource, Incident};
use crate::patcher::SessionOrigin;

impl Incident {
    /// The incident as one text to paste, built from the record and never from
    /// the log, so nothing the reader dropped can reach it.
    ///
    /// `token` is the incident's own [token](super::token), carried on the
    /// second line so a pasted report holds the short form of itself.
    pub fn report_text(&self, manager_version: &str, token: Option<&str>) -> String {
        let mut out = String::new();
        let league = self
            .game
            .as_ref()
            .map(|game| game.version.as_str())
            .filter(|version| !version.is_empty())
            .unwrap_or("unknown");

        out.push_str("# LTK Manager - League diagnostics\n");
        let _ = writeln!(
            out,
            "Incident: {} · LTK Manager v{} · League {league}",
            self.id,
            manager_version.trim_start_matches('v')
        );
        if let Some(token) = token {
            let _ = writeln!(out, "Token: {token}");
        }
        out.push('\n');

        let _ = writeln!(
            out,
            "Verdict: {} ({})",
            self.verdict.title, self.verdict.consequence
        );
        out.push_str(&self.verdict.cause);
        out.push('\n');
        if let Some(subject) = &self.verdict.subject {
            let label = if subject.starts_with("step ") {
                "Step"
            } else if self.subject_is_archive() {
                "Archive"
            } else {
                "Path"
            };
            let _ = writeln!(out, "{label}: {subject}");
            let archives = self.archives();
            if label != "Archive" && !archives.is_empty() {
                let _ = writeln!(out, "Archive: {}", archives.join(", "));
            }
        }

        if !self.suspects.is_empty() {
            out.push_str("\nSuspects:\n");
            for suspect in &self.suspects {
                let _ = writeln!(out, "  - {} - {}", suspect.display_name, suspect.because);
            }
        }
        if !self.verdict.hints.is_empty() {
            out.push_str("\nHints:\n");
            for hint in &self.verdict.hints {
                let _ = writeln!(out, "  - {hint}");
            }
        }

        out.push('\n');
        let _ = writeln!(out, "Ending: {}", self.ending_line());
        let _ = writeln!(out, "Origin: {}", self.origin_line());
        let _ = writeln!(out, "Game log: {}", self.game_log_line());

        out.push_str("\nEvidence:\n");
        if self.evidence.is_empty() {
            out.push_str("  none\n");
        }
        for row in &self.evidence {
            let _ = writeln!(out, "  {:<7}  {:<7} {}", row.at, row.source, row.message());
            if let Some(code) = &row.code
                && let Some(meaning) = &code.meaning
            {
                let _ = writeln!(out, "           {meaning}");
            }
        }

        let game_lines: Vec<&str> = self
            .evidence
            .iter()
            .rev()
            .filter(|row| row.source == EvidenceSource::Game)
            .map(|row| row.line.as_str())
            .collect();
        if !game_lines.is_empty() {
            out.push_str("\nLast lines of the game log:\n");
            for line in game_lines {
                let _ = writeln!(out, "  {line}");
            }
        }
        out
    }

    fn ending_line(&self) -> String {
        let mut parts = Vec::new();
        if let Some(summary) = self.ending.summary() {
            parts.push(summary);
        }
        match self.ending.crashed {
            Some(true) => parts.push("crashpad ran".to_string()),
            Some(false) => parts.push("crashpad did not run".to_string()),
            None => {}
        }
        if parts.is_empty() {
            "no reason recorded".to_string()
        } else {
            parts.join(", ")
        }
    }

    fn origin_line(&self) -> String {
        let redirected = format!(
            "{} archive{} redirected",
            self.redirected.len(),
            if self.redirected.len() == 1 { "" } else { "s" }
        );
        match &self.origin {
            SessionOrigin::Library => format!("library, {redirected}"),
            SessionOrigin::Workshop { projects } => {
                let names: Vec<&str> = projects
                    .iter()
                    .map(|path| {
                        path.trim_end_matches(['/', '\\'])
                            .rsplit(['/', '\\'])
                            .next()
                            .unwrap_or(path)
                    })
                    .collect();
                format!("workshop test of {}, {redirected}", names.join(", "))
            }
        }
    }

    fn game_log_line(&self) -> String {
        if self.game.is_none() {
            return "not found".to_string();
        }
        let game_rows: Vec<_> = self
            .evidence
            .iter()
            .filter(|row| row.source == EvidenceSource::Game)
            .collect();
        let errors = game_rows.iter().filter(|row| row.is_error_level()).count();
        format!(
            "found, {} coded line{}, {errors} error line{}",
            game_rows.len(),
            if game_rows.len() == 1 { "" } else { "s" },
            if errors == 1 { "" } else { "s" }
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics::incident::fixtures;

    fn report() -> String {
        fixtures::incident("2026-08-21T21-14-02", "2026-08-21T21:14:02+00:00")
            .report_text("1.14.0", Some("LTK1-abc"))
    }

    #[test]
    fn the_report_has_every_section_in_order() {
        let text = report();
        let sections = [
            "# LTK Manager - League diagnostics\n",
            "Incident: 2026-08-21T21-14-02 · LTK Manager v1.14.0 · League 16.16.804.9184\n",
            "Token: LTK1-abc\n",
            "\nVerdict: Missing Game Data (the game stopped)\n",
            "League failed to read a file.",
            "Path: assets/characters/aatrox/skins/skin12/aatrox_skin12_tx_cm.dds\n",
            "Archive: Aatrox.wad.client\n",
            "\nSuspects:\n  - Aatrox Justicar - writes Aatrox.wad.client, which holds the path\n",
            "\nHints:\n  - ",
            "\nEnding: Interrupt, exit code 0xC0000005 STATUS_ACCESS_VIOLATION, crashpad ran\n",
            "Origin: library, 4 archives redirected\n",
            "Game log: found, 2 coded lines, 1 error line\n",
            "\nEvidence:\n",
            "  00:12.4  client  Interrupt, exit code 0xC0000005 STATUS_ACCESS_VIOLATION\n",
            "  00:12.3  game    ALE-9B39AA45 FATAL ERROR. Missing data: 0x1a2b3c4d5e6f7081\n",
            "           A file the game needed is in no mounted archive\n",
            "  00:00.0  dll     redirected Aatrox.wad.client",
            "\nLast lines of the game log:\n",
            "  000012.301| ALWAYS|  LOAD| SEJ-9F31B5D0\n",
            "  000012.344|  ERROR| ALE-9B39AA45 FATAL ERROR. Missing data: 0x1a2b3c4d5e6f7081\n",
        ];
        let mut from = 0;
        for section in sections {
            let at = text[from..]
                .find(section)
                .unwrap_or_else(|| panic!("missing or out of order: {section:?}\n{text}"));
            from += at + section.len();
        }
    }

    #[test]
    fn nothing_leaks_from_the_types() {
        let text = report();
        assert!(!text.contains("None"), "{text}");
        assert!(!text.contains("Some("), "{text}");
        assert!(!text.contains('\r'));
    }

    #[test]
    fn a_report_without_a_token_or_a_log_says_so() {
        let mut incident = fixtures::incident("a", "2026-08-21T21:14:02+00:00");
        incident.game = None;
        incident.evidence.clear();
        incident.ending = Default::default();
        let text = incident.report_text("v1.14.0", None);
        assert!(text.contains("· League unknown\n"));
        assert!(!text.contains("Token:"));
        assert!(text.contains("\nVerdict: Missing Game Data (the game stopped)\n"));
        assert!(text.contains("Ending: no reason recorded\n"));
        assert!(text.contains("Game log: not found\n"));
        assert!(text.contains("Evidence:\n  none\n"));
        assert!(!text.contains("Last lines"));
    }

    #[test]
    fn a_workshop_origin_names_the_projects() {
        let mut incident = fixtures::incident("a", "2026-08-21T21:14:02+00:00");
        incident.origin = SessionOrigin::Workshop {
            projects: vec![r"C:\workshop\aatrox-justicar".to_string()],
        };
        let text = incident.report_text("1.14.0", None);
        assert!(text.contains("Origin: workshop test of aatrox-justicar, 4 archives redirected\n"));
    }

    #[test]
    fn a_step_subject_and_an_archive_subject_take_their_own_label() {
        let mut incident = fixtures::incident("a", "2026-08-21T21:14:02+00:00");
        incident.verdict.subject = Some("step 52 of 64".to_string());
        assert!(
            incident
                .report_text("1.14.0", None)
                .contains("\nStep: step 52 of 64\n")
        );
        incident.verdict.subject = Some("Aatrox.wad.client".to_string());
        let text = incident.report_text("1.14.0", None);
        assert!(text.contains("\nArchive: Aatrox.wad.client\n"));
        assert_eq!(text.matches("Archive:").count(), 1);
    }
}
