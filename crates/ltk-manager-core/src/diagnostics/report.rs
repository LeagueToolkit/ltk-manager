//! The report text: one incident as the text a support thread wants.

use std::fmt::Write;

use super::incident::{EvidenceSource, GamePhase, Incident, VerdictKind};
use crate::patcher::SessionOrigin;

impl Incident {
    /// The incident as one text to paste, built from the record and never from
    /// the log, so nothing the reader dropped can reach it.
    ///
    /// `token` is the incident's own [token](super::token), carried on the
    /// second line so a pasted report holds the short form of itself. `hints`
    /// are the verdict's hints as sentences, which the frontend catalog owns.
    pub fn report_text(
        &self,
        manager_version: &str,
        token: Option<&str>,
        hints: &[String],
    ) -> String {
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
        if !self.verdict.cause.is_empty() {
            out.push_str(&self.verdict.cause);
            out.push('\n');
        }
        if let Some(code) = &self.scan_status_code {
            let _ = writeln!(
                out,
                "Scan: rejected {} archive(s), status {code}",
                self.scan_rejected
            );
        }
        if let Some(line) = self.shader_line() {
            let _ = writeln!(out, "Shaders: {line}");
        }
        if let Some(subject) = &self.verdict.subject {
            let label = if self.verdict.kind == VerdictKind::ShaderFailed {
                "Defines"
            } else if subject.starts_with("step ") {
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
        if !hints.is_empty() {
            out.push_str("\nHints:\n");
            for hint in hints {
                let _ = writeln!(out, "  - {hint}");
            }
        }

        out.push('\n');
        let _ = writeln!(out, "Ending: {}", self.ending_line());
        let _ = writeln!(out, "Origin: {}", self.origin_line());
        if let Some(line) = self.patcher_line() {
            let _ = writeln!(out, "Patcher: {line}");
        }
        let _ = writeln!(out, "Game log: {}", self.game_log_line());

        out.push_str("\nEvidence:\n");
        if self.evidence.is_empty() {
            out.push_str("  none\n");
        }
        for row in &self.evidence {
            let _ = writeln!(out, "  {:<7}  {:<7} {}", row.at, row.source, row.message());
            for line in &row.detail {
                let _ = writeln!(out, "                   {line}");
            }
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
            .flat_map(|row| {
                std::iter::once(row.line.as_str()).chain(row.detail.iter().map(String::as_str))
            })
            .collect();
        if !game_lines.is_empty() {
            out.push_str("\nLast lines of the game log:\n");
            for line in game_lines {
                let _ = writeln!(out, "  {line}");
            }
        }
        out
    }

    fn shader_line(&self) -> Option<String> {
        let shader = self.shader.as_ref()?;
        let mut parts = Vec::new();
        if shader.variants > 0 {
            parts.push(format!("{} variant(s) did not compile", shader.variants));
        }
        if shader.unnamed_programs {
            parts.push("no vertex shader named".to_string());
        }
        if let Some(pipeline) = &shader.missing_pipeline {
            parts.push(format!("pipeline {pipeline} missing"));
        }
        Some(parts.join(", "))
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
        let what = match &self.origin {
            SessionOrigin::Library => "library".to_string(),
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
                format!("workshop test of {}", names.join(", "))
            }
        };
        let mut line = format!(
            "{what}, {} archive{} redirected, {} mod{} enabled",
            self.redirected.len(),
            if self.redirected.len() == 1 { "" } else { "s" },
            self.enabled_count,
            if self.enabled_count == 1 { "" } else { "s" }
        );
        if self.host_elevated {
            line.push_str(", host elevated");
        }
        line
    }

    /// `dll a150130f1a90 built 2026-08-17, host … , stock`, or `None` when no
    /// binary was identified.
    fn patcher_line(&self) -> Option<String> {
        if self.patcher.is_empty() {
            return None;
        }
        let part = |label: &str, id: Option<&super::binary_id::BinaryId>| match id {
            None => format!("{label} not read"),
            Some(id) => match id.built_date() {
                Some(date) => format!("{label} {} built {date}", id.hash),
                None => format!("{label} {}", id.hash),
            },
        };
        let mut line = format!(
            "{}, {}",
            part("dll", self.patcher.dll.as_ref()),
            part("host", self.patcher.host.as_ref())
        );
        match self.patcher.matches_bundle {
            Some(true) => line.push_str(", stock"),
            Some(false) => line.push_str(", MODIFIED or not this build's"),
            None => {}
        }
        Some(line)
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
        let mut line = format!(
            "found, {} coded line{}, {errors} error line{}",
            game_rows.len(),
            if game_rows.len() == 1 { "" } else { "s" },
            if errors == 1 { "" } else { "s" }
        );
        match self.phase {
            GamePhase::Unknown => {}
            GamePhase::Loading => line.push_str(", stopped loading"),
            GamePhase::InGame => line.push_str(", reached the game"),
            GamePhase::TornDown => line.push_str(", torn down"),
        }
        line
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics::incident::{
        Evidence, EvidenceCode, ShaderFailure, Verdict, VerdictKind, fixtures,
    };

    fn report() -> String {
        fixtures::incident("2026-08-21T21-14-02", "2026-08-21T21:14:02+00:00").report_text(
            "1.14.0",
            Some("DIAG1-abc"),
            &["Disable the suspect.".to_string()],
        )
    }

    #[test]
    fn the_report_has_every_section_in_order() {
        let text = report();
        let sections = [
            "# LTK Manager - League diagnostics\n",
            "Incident: 2026-08-21T21-14-02 · LTK Manager v1.14.0 · League 16.16.804.9184\n",
            "Token: DIAG1-abc\n",
            "\nVerdict: Missing Game Data (the game stopped)\n",
            "League failed to read a file.",
            "Path: assets/characters/aatrox/skins/skin12/aatrox_skin12_tx_cm.dds\n",
            "Archive: Aatrox.wad.client\n",
            "\nSuspects:\n  - Aatrox Justicar - writes Aatrox.wad.client, which holds the path\n",
            "\nHints:\n  - Disable the suspect.\n",
            "\nEnding: Interrupt, exit code 0xC0000005 STATUS_ACCESS_VIOLATION, crashpad ran\n",
            "Origin: library, 4 archives redirected, 4 mods enabled\n",
            "Patcher: dll a150130f1a90dcc2 built 2026-08-17, host cc714b6990a29678 built 2026-08-17, stock\n",
            "Game log: found, 2 coded lines, 1 error line, stopped loading\n",
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
    fn a_records_detail_lines_print_under_it_and_in_the_last_lines() {
        let mut incident = fixtures::incident("a", "2026-08-21T21:14:02+00:00");
        incident.evidence[1] = Evidence {
            at: "00:01.9".to_string(),
            source: EvidenceSource::Game,
            line: "000001.912|  ERROR| ALE-18967994 FATAL ERROR. WadFile mount failed".to_string(),
            detail: vec![
                "- WadFile: DATA/FINAL/Shaders/Shaders.wad.client".to_string(),
                "- Problem: Inconsistent".to_string(),
            ],
            code: Some(EvidenceCode::from_table("ALE-18967994")),
        };
        let text = incident.report_text("1.14.0", None, &[]);
        assert!(text.contains(
            "  00:01.9  game    ALE-18967994 FATAL ERROR. WadFile mount failed\n                   - WadFile: DATA/FINAL/Shaders/Shaders.wad.client\n                   - Problem: Inconsistent\n           An archive could not be mounted, because it is inconsistent with another mounted archive\n"
        ), "{text}");
        assert!(text.ends_with(
            "  000012.301| ALWAYS|  LOAD| SEJ-9F31B5D0\n  000001.912|  ERROR| ALE-18967994 FATAL ERROR. WadFile mount failed\n  - WadFile: DATA/FINAL/Shaders/Shaders.wad.client\n  - Problem: Inconsistent\n"
        ), "{text}");
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
        let text = incident.report_text("v1.14.0", None, &[]);
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
        let text = incident.report_text("1.14.0", None, &[]);
        assert!(text.contains(
            "Origin: workshop test of aatrox-justicar, 4 archives redirected, 4 mods enabled\n"
        ));
    }

    #[test]
    fn the_origin_line_says_when_the_host_was_elevated() {
        let mut incident = fixtures::incident("a", "2026-08-21T21:14:02+00:00");
        incident.host_elevated = true;
        incident.enabled_count = 1;
        let text = incident.report_text("1.14.0", None, &[]);
        assert!(
            text.contains("Origin: library, 4 archives redirected, 1 mod enabled, host elevated\n")
        );
    }

    #[test]
    fn the_game_log_line_says_how_far_the_game_got() {
        let mut incident = fixtures::incident("a", "2026-08-21T21:14:02+00:00");
        for (phase, ending) in [
            (GamePhase::Unknown, "1 error line\n"),
            (GamePhase::InGame, "1 error line, reached the game\n"),
            (GamePhase::TornDown, "1 error line, torn down\n"),
        ] {
            incident.phase = phase;
            let text = incident.report_text("1.14.0", None, &[]);
            assert!(text.contains(ending), "{phase:?}: {text}");
        }
    }

    #[test]
    fn a_step_subject_and_an_archive_subject_take_their_own_label() {
        let mut incident = fixtures::incident("a", "2026-08-21T21:14:02+00:00");
        incident.verdict.subject = Some("step 52 of 64".to_string());
        assert!(
            incident
                .report_text("1.14.0", None, &[])
                .contains("\nStep: step 52 of 64\n")
        );
        incident.verdict.subject = Some("Aatrox.wad.client".to_string());
        let text = incident.report_text("1.14.0", None, &[]);
        assert!(text.contains("\nArchive: Aatrox.wad.client\n"));
        assert_eq!(text.matches("Archive:").count(), 1);
    }

    /// A shader verdict has no cause sentence of its own, so the facts print
    /// on a line, and its subject is the pass defines.
    #[test]
    fn a_shader_verdict_prints_its_facts_and_its_defines() {
        let mut incident = fixtures::incident("2026-09-25T12-46-41", "2026-09-25T12:46:45+00:00");
        incident.verdict = Verdict::new(VerdictKind::ShaderFailed, "")
            .with_subject("FEATURE_DISPLACEMENT=1 NUM_BLEND_WEIGHTS=4");
        incident.shader = Some(ShaderFailure {
            variants: 4,
            unnamed_programs: true,
            missing_pipeline: Some("822941f5adffbcc".to_string()),
        });

        let text = incident.report_text("1.22.0", None, &[]);
        assert!(text.contains(
            "Verdict: Shader Compilation Failure (the game stopped)\n\
             Shaders: 4 variant(s) did not compile, no vertex shader named, pipeline 822941f5adffbcc missing\n\
             Defines: FEATURE_DISPLACEMENT=1 NUM_BLEND_WEIGHTS=4\n"
        ), "{text}");
    }
}
