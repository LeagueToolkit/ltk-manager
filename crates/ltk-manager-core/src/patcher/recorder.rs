//! The game record, assembled from the injector's events.
//!
//! [`GameRecorder`] is the state machine between the event loop and the
//! classifier. It opens a [`GameRecord`] at the first sign of a game, folds
//! every event into it, and hands it back closed at the last sign. Pure over
//! its inputs, so every transition is a unit test.

use chrono::{DateTime, Utc};

use crate::diagnostics::incident::{
    Ending, EvidenceSource, GameRecord, RawEvidence, SessionFailure, SkippedArchive,
};

use super::injector::InjectorEvent;
use super::state::SessionOrigin;

/// How many timeline lines one record keeps. A game writes a handful, and a
/// DLL in trouble can write hundreds of the same error.
const TIMELINE_CAP: usize = 256;

/// Turns [`InjectorEvent`]s into closed [`GameRecord`]s, one per game.
#[derive(Debug)]
pub struct GameRecorder {
    origin: SessionOrigin,
    host_elevated: bool,
    open: Option<GameRecord>,
}

impl GameRecorder {
    /// A recorder for one session. `host_elevated` is kept on every record,
    /// because it picks the hint for a DLL that never attached.
    pub fn new(origin: SessionOrigin, host_elevated: bool) -> Self {
        Self {
            origin,
            host_elevated,
            open: None,
        }
    }

    /// Whether a game is open.
    pub fn has_open_game(&self) -> bool {
        self.open.is_some()
    }

    /// Folds one event in. Returns the record when the event closed a game:
    /// the host's `exited`, or its return to scanning while the DLL never
    /// attached, or a new game found while the last one was still open.
    pub fn observe(&mut self, event: &InjectorEvent, now: DateTime<Utc>) -> Option<GameRecord> {
        match event {
            InjectorEvent::Scanning => {
                if self.open.as_ref().is_some_and(|record| !record.injected) {
                    self.push_line(EvidenceSource::Host, "scanning for game", now);
                    return self.close(now);
                }
                None
            }
            InjectorEvent::GameFound => {
                let stale = self.close(now);
                self.open_record(now);
                self.push_line(EvidenceSource::Host, "game found", now);
                stale
            }
            InjectorEvent::GameAttached { pid } => {
                let record = self.open_or_start(now);
                record.injected = true;
                let text = match pid {
                    Some(pid) => format!("injected, pid {pid}"),
                    None => "injected".to_string(),
                };
                self.push_line(EvidenceSource::Host, &text, now);
                None
            }
            InjectorEvent::Overlay { outcome, detail } => {
                let record = self.open_or_attach(now);
                record.overlay = *outcome;
                record.overlay_detail = detail.clone();
                None
            }
            InjectorEvent::WadRedirected { wad } => {
                let record = self.open_or_attach(now);
                if !record
                    .redirected
                    .iter()
                    .any(|r| r.eq_ignore_ascii_case(wad))
                {
                    record.redirected.push(wad.clone());
                }
                None
            }
            InjectorEvent::WadSkipped { wad, why } => {
                let record = self.open_or_attach(now);
                record.skipped.push(SkippedArchive {
                    wad: wad.clone(),
                    why: why.clone(),
                });
                None
            }
            InjectorEvent::Launch(kind) => {
                self.open_or_attach(now).launch = *kind;
                None
            }
            InjectorEvent::WadScanFailed { failures } => {
                let record = self.open_or_attach(now);
                record.scan_failures.extend(failures.iter().cloned());
                for failure in failures {
                    self.push_line(EvidenceSource::Dll, &failure.evidence_line(), now);
                }
                None
            }
            InjectorEvent::GameExited => {
                self.push_line(EvidenceSource::Host, "exited", now);
                self.close(now)
            }
            InjectorEvent::Line { source, text, .. } => {
                self.push_line(*source, text, now);
                None
            }
        }
    }

    /// The session failed, in the build or at the host. Returns a record with
    /// the failure set, with any open game folded in.
    pub fn session_failed(&mut self, failure: SessionFailure, now: DateTime<Utc>) -> GameRecord {
        let mut record = self.close(now).unwrap_or_else(|| self.new_record(now));
        record.ended_at = now;
        record.failure = Some(failure);
        record
    }

    /// The session ended by request, with a game possibly still running.
    ///
    /// A game that is still running has no ending to read, so its record is
    /// dropped, unless the scan rejected an archive, which is a verdict on its
    /// own and the reason the session stopped.
    pub fn session_stopped(&mut self, now: DateTime<Utc>) -> Option<GameRecord> {
        let keep = self
            .open
            .as_ref()
            .is_some_and(|record| !record.scan_failures.is_empty());
        let record = self.close(now);
        keep.then_some(record).flatten()
    }

    /// The Riot Client's word on how the session ended, for the open game.
    ///
    /// The session arrives on the `ritoclient-launcher` branch, and a Classic
    /// launch never has one, so the ending stays empty on the host's word alone.
    pub fn session_ended(&mut self, exit_reason: Option<String>, exit_code: Option<i64>) {
        if let Some(record) = self.open.as_mut() {
            record.ending = Ending {
                exit_reason,
                exit_code,
                crashed: record.ending.crashed,
            };
        }
    }

    fn new_record(&self, now: DateTime<Utc>) -> GameRecord {
        let mut record = GameRecord::open(now, self.origin.clone());
        record.host_elevated = self.host_elevated;
        record
    }

    fn open_record(&mut self, now: DateTime<Utc>) -> &mut GameRecord {
        self.open = Some(self.new_record(now));
        self.open.as_mut().expect("record just opened")
    }

    /// The open record, or a new one when a sign of the game arrives before
    /// the host's `game found`, as it does in the host's passive mode.
    fn open_or_start(&mut self, now: DateTime<Utc>) -> &mut GameRecord {
        if self.open.is_none() {
            self.open_record(now);
        }
        self.open.as_mut().expect("record open")
    }

    /// The open record, marked injected: the DLL is speaking, so it attached.
    fn open_or_attach(&mut self, now: DateTime<Utc>) -> &mut GameRecord {
        let record = self.open_or_start(now);
        record.injected = true;
        record
    }

    fn close(&mut self, now: DateTime<Utc>) -> Option<GameRecord> {
        let mut record = self.open.take()?;
        record.ended_at = now;
        Some(record)
    }

    fn push_line(&mut self, source: EvidenceSource, text: &str, now: DateTime<Utc>) {
        let Some(record) = self.open.as_mut() else {
            return;
        };
        if record.timeline.len() >= TIMELINE_CAP {
            return;
        }
        record.timeline.push(RawEvidence {
            at: now,
            source,
            line: text.to_string(),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics::incident::{LaunchKind, OverlayOutcome};
    use crate::error::ErrorKind;
    use crate::patcher::InjectionStage;
    use crate::patcher::injector::WadScanFailure;
    use chrono::TimeZone;

    fn at(secs: i64) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 8, 21, 21, 0, 0).unwrap() + chrono::Duration::seconds(secs)
    }

    fn recorder() -> GameRecorder {
        GameRecorder::new(SessionOrigin::Library, false)
    }

    fn line(source: EvidenceSource, text: &str) -> InjectorEvent {
        InjectorEvent::Line {
            source,
            at_host: "1.0".to_string(),
            text: text.to_string(),
        }
    }

    fn redirected(wad: &str) -> InjectorEvent {
        InjectorEvent::WadRedirected {
            wad: wad.to_string(),
        }
    }

    #[test]
    fn a_full_game_yields_one_record_with_its_facts() {
        let mut recorder = recorder();
        assert!(recorder.observe(&InjectorEvent::Scanning, at(0)).is_none());
        assert!(recorder.observe(&InjectorEvent::GameFound, at(1)).is_none());
        assert!(
            recorder
                .observe(&InjectorEvent::GameAttached { pid: Some(18232) }, at(2))
                .is_none()
        );
        assert!(
            recorder
                .observe(&line(EvidenceSource::Host, "game exit"), at(2))
                .is_none()
        );
        assert!(
            recorder
                .observe(
                    &InjectorEvent::Overlay {
                        outcome: OverlayOutcome::Live,
                        detail: None,
                    },
                    at(3)
                )
                .is_none()
        );
        assert!(
            recorder
                .observe(&InjectorEvent::Launch(LaunchKind::Replay), at(3))
                .is_none()
        );
        assert!(
            recorder
                .observe(&redirected("Aatrox.wad.client"), at(4))
                .is_none()
        );
        assert!(
            recorder
                .observe(&redirected("Map11.wad.client"), at(4))
                .is_none()
        );
        assert!(
            recorder
                .observe(&redirected("aatrox.wad.client"), at(5))
                .is_none()
        );
        assert!(
            recorder
                .observe(
                    &InjectorEvent::WadSkipped {
                        wad: "Ahri.wad.client".to_string(),
                        why: "open modded file: not found".to_string(),
                    },
                    at(6)
                )
                .is_none()
        );

        let record = recorder
            .observe(&InjectorEvent::GameExited, at(60))
            .expect("exited closes the game");

        assert_eq!(record.started_at, at(1));
        assert_eq!(record.ended_at, at(60));
        assert_eq!(record.origin, SessionOrigin::Library);
        assert!(record.injected);
        assert_eq!(record.overlay, OverlayOutcome::Live);
        assert_eq!(record.launch, LaunchKind::Replay);
        assert_eq!(record.redirected, ["Aatrox.wad.client", "Map11.wad.client"]);
        assert_eq!(
            record.skipped,
            [SkippedArchive {
                wad: "Ahri.wad.client".to_string(),
                why: "open modded file: not found".to_string(),
            }]
        );
        assert!(record.failure.is_none());
        assert_eq!(record.ending, Ending::default());
        let lines: Vec<_> = record.timeline.iter().map(|e| e.line.as_str()).collect();
        assert_eq!(
            lines,
            ["game found", "injected, pid 18232", "game exit", "exited"]
        );
        assert!(!recorder.has_open_game());
    }

    #[test]
    fn a_second_game_in_the_same_session_is_a_second_record() {
        let mut recorder = recorder();
        recorder.observe(&InjectorEvent::GameFound, at(1));
        recorder.observe(&InjectorEvent::GameAttached { pid: Some(1) }, at(2));
        let first = recorder
            .observe(&InjectorEvent::GameExited, at(10))
            .unwrap();
        recorder.observe(&InjectorEvent::Scanning, at(11));

        recorder.observe(&InjectorEvent::GameFound, at(20));
        recorder.observe(&InjectorEvent::GameAttached { pid: Some(2) }, at(21));
        recorder.observe(&redirected("Ahri.wad.client"), at(22));
        let second = recorder
            .observe(&InjectorEvent::GameExited, at(30))
            .unwrap();

        assert_eq!(first.started_at, at(1));
        assert!(first.redirected.is_empty());
        assert_eq!(second.started_at, at(20));
        assert_eq!(second.redirected, ["Ahri.wad.client"]);
    }

    /// The host reports `scanning for game` when the window goes. For a game
    /// the DLL never attached to, that is the only last sign there is.
    #[test]
    fn scanning_after_game_found_without_an_attach_closes_an_uninjected_record() {
        let mut recorder = recorder();
        recorder.observe(&InjectorEvent::GameFound, at(1));

        let record = recorder
            .observe(&InjectorEvent::Scanning, at(5))
            .expect("the window going is the last sign");

        assert!(!record.injected);
        assert_eq!(record.overlay, OverlayOutcome::None);
        assert_eq!(record.ended_at, at(5));
    }

    /// After `exited` closed the game, the window going is not a new sign.
    #[test]
    fn scanning_after_an_exit_closes_nothing() {
        let mut recorder = recorder();
        recorder.observe(&InjectorEvent::GameFound, at(1));
        recorder.observe(&InjectorEvent::GameAttached { pid: None }, at(2));
        assert!(
            recorder
                .observe(&InjectorEvent::GameExited, at(10))
                .is_some()
        );

        assert!(recorder.observe(&InjectorEvent::Scanning, at(11)).is_none());
    }

    #[test]
    fn scanning_leaves_an_injected_game_open_for_its_exit() {
        let mut recorder = recorder();
        recorder.observe(&InjectorEvent::GameFound, at(1));
        recorder.observe(&InjectorEvent::GameAttached { pid: None }, at(2));

        assert!(recorder.observe(&InjectorEvent::Scanning, at(3)).is_none());
        assert!(recorder.has_open_game());
    }

    #[test]
    fn a_new_game_found_closes_a_game_whose_exit_was_missed() {
        let mut recorder = recorder();
        recorder.observe(&InjectorEvent::GameFound, at(1));
        recorder.observe(&InjectorEvent::GameAttached { pid: Some(7) }, at(2));

        let stale = recorder
            .observe(&InjectorEvent::GameFound, at(50))
            .expect("the stale game closes");

        assert_eq!(stale.started_at, at(1));
        assert_eq!(stale.ended_at, at(50));
        assert!(recorder.has_open_game());
    }

    #[test]
    fn the_dll_speaking_opens_an_injected_record_without_a_game_found() {
        let mut recorder = recorder();
        recorder.observe(
            &InjectorEvent::Overlay {
                outcome: OverlayOutcome::TooLate,
                detail: None,
            },
            at(3),
        );

        let record = recorder.observe(&InjectorEvent::GameExited, at(9)).unwrap();

        assert!(record.injected);
        assert_eq!(record.overlay, OverlayOutcome::TooLate);
        assert_eq!(record.started_at, at(3));
    }

    #[test]
    fn session_failed_before_any_game_gives_a_record_with_the_failure() {
        let mut recorder = GameRecorder::new(
            SessionOrigin::Workshop {
                projects: vec!["C:\\projects\\skin".to_string()],
            },
            true,
        );

        let record = recorder.session_failed(
            SessionFailure::Build {
                kind: ErrorKind::Other,
                message: "Overlay build failed: bad wad".to_string(),
            },
            at(1),
        );

        assert_eq!(record.started_at, at(1));
        assert_eq!(record.ended_at, at(1));
        assert!(record.host_elevated);
        assert!(!record.injected);
        assert!(record.origin.is_workshop());
        assert_eq!(
            record.failure,
            Some(SessionFailure::Build {
                kind: ErrorKind::Other,
                message: "Overlay build failed: bad wad".to_string()
            })
        );
        assert!(!recorder.has_open_game());
    }

    #[test]
    fn session_failed_folds_an_open_game_in() {
        let mut recorder = recorder();
        recorder.observe(&InjectorEvent::GameFound, at(1));

        let record = recorder.session_failed(
            SessionFailure::Injection {
                stage: InjectionStage::Injection,
                message: "DLL never attached after 60s".to_string(),
            },
            at(61),
        );

        assert_eq!(record.started_at, at(1));
        assert_eq!(record.ended_at, at(61));
        assert!(!record.injected);
        assert!(matches!(
            record.failure,
            Some(SessionFailure::Injection {
                stage: InjectionStage::Injection,
                ..
            })
        ));
    }

    #[test]
    fn a_stop_drops_a_game_still_running() {
        let mut recorder = recorder();
        recorder.observe(&InjectorEvent::GameFound, at(1));
        recorder.observe(&InjectorEvent::GameAttached { pid: Some(1) }, at(2));

        assert!(recorder.session_stopped(at(30)).is_none());
        assert!(!recorder.has_open_game());
    }

    #[test]
    fn a_stop_after_a_rejected_archive_keeps_the_record() {
        let mut recorder = recorder();
        recorder.observe(&InjectorEvent::GameFound, at(1));
        recorder.observe(&InjectorEvent::GameAttached { pid: Some(1) }, at(2));
        let failures = vec![WadScanFailure {
            wad: Some("Ahri.wad.client".to_string()),
            status: "c0000229".to_string(),
        }];
        recorder.observe(
            &InjectorEvent::WadScanFailed {
                failures: failures.clone(),
            },
            at(3),
        );

        let record = recorder
            .session_stopped(at(4))
            .expect("a verdict on its own");

        assert_eq!(record.scan_failures, failures);
        assert_eq!(record.ended_at, at(4));
        assert!(
            record
                .timeline
                .iter()
                .any(|e| e.line == "scan rejected Ahri.wad.client, status c0000229")
        );
    }

    #[test]
    fn session_ended_sets_the_ending_on_the_open_game() {
        let mut recorder = recorder();
        recorder.observe(&InjectorEvent::GameFound, at(1));
        recorder.session_ended(Some("Interrupt".to_string()), Some(-1073741819));

        let record = recorder.observe(&InjectorEvent::GameExited, at(9)).unwrap();

        assert_eq!(record.ending.exit_reason.as_deref(), Some("Interrupt"));
        assert_eq!(record.ending.exit_code, Some(-1073741819));
        assert_eq!(record.ending.crashed, None);
    }

    #[test]
    fn lines_before_a_game_are_dropped_and_the_timeline_is_capped() {
        let mut recorder = recorder();
        recorder.observe(&line(EvidenceSource::Host, "awaiting dll"), at(0));
        recorder.observe(&InjectorEvent::GameFound, at(1));
        for _ in 0..(TIMELINE_CAP * 2) {
            recorder.observe(&line(EvidenceSource::Dll, "AH init failed:00"), at(2));
        }

        let record = recorder.observe(&InjectorEvent::GameExited, at(9)).unwrap();

        assert_eq!(record.timeline.len(), TIMELINE_CAP);
        assert_eq!(record.timeline[0].line, "game found");
    }
}
