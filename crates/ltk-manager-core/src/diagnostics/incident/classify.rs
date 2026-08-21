//! The verdict classifier: a pure function over a [`GameRecord`] and the
//! library's footprints, with no I/O and no file read, so every verdict is a
//! unit test. The precedence table in [`GameRecord::verdict`] is the whole of
//! it, and each row builds one [`Verdict`] with its suspects.

use super::*;

/// One rule of the precedence table: a self-contained verdict that fires on a
/// record, or `None` to let the next rule try. See [`GameRecord::RULES`].
type VerdictRule = fn(&GameRecord, &ClassifyContext<'_>) -> Option<(Verdict, Vec<Suspect>)>;

/// The loading step that mounts the champions' archives.
const CHAMPION_STEP: u8 = 52;

/// The loading step that builds the environment's cube-map array.
const MAP_STEP: u8 = 62;

/// A game that ended inside this many seconds under the lazy scan earns the
/// up-front scan hint.
const EARLY_CRASH_SECS: f64 = 60.0;

impl GameRecord {
    /// A record that opens at the first sign of a game.
    pub fn open(started_at: DateTime<Utc>, origin: SessionOrigin) -> Self {
        Self {
            started_at,
            ended_at: started_at,
            origin,
            failure: None,
            injected: false,
            overlay: OverlayOutcome::None,
            overlay_detail: None,
            redirected: Vec::new(),
            skipped: Vec::new(),
            scan_failures: Vec::new(),
            launch: LaunchKind::Match,
            scan: None,
            host_elevated: false,
            patcher: PatcherBinaries::default(),
            ending: Ending::default(),
            log_path: None,
            log: None,
            timeline: Vec::new(),
        }
    }

    /// The verdict over this record, or `None` when the game was clean and
    /// there is nothing to keep.
    pub fn classify(&self, ctx: &ClassifyContext<'_>) -> Option<Incident> {
        let (verdict, suspects) = self.verdict(ctx)?;
        Some(Incident {
            id: self.id(),
            started_at: self.started_at.to_rfc3339(),
            ended_at: self.ended_at.to_rfc3339(),
            origin: self.origin.clone(),
            injected: self.injected,
            host_elevated: self.host_elevated,
            patcher: self.patcher.clone(),
            overlay: self.overlay,
            overlay_detail: self.overlay_detail.as_ref().map(ToString::to_string),
            redirected: self.redirected.clone(),
            skipped: self.skipped.clone(),
            enabled_count: saturating_count(ctx.mods.len() + ctx.projects.len()),
            launch: self.launch,
            scan: self.scan,
            scan_status: self.scan_status(),
            phase: self.phase(),
            game: self.log.as_ref().map(|log| GameInfo {
                version: log.build_version.clone().unwrap_or_default(),
                content_version: log.content_version.clone().unwrap_or_default(),
                log_path: self
                    .log_path
                    .as_ref()
                    .map(|path| path.display().to_string())
                    .unwrap_or_default(),
            }),
            ending: self.ending.clone(),
            failure: self.failure.clone(),
            verdict,
            evidence: self.evidence(),
            suspects,
            dismissed: false,
        })
    }

    /// What the scan reported about the first archive it rejected, when it
    /// rejected one. The single reading of the raw status string.
    fn scan_status(&self) -> Option<ScanStatus> {
        self.scan_failures
            .first()
            .map(|failure| ScanStatus::parse(&failure.status))
    }

    /// How far the game got, as its log says.
    pub(super) fn phase(&self) -> GamePhase {
        match &self.log {
            None => GamePhase::Unknown,
            Some(log) if log.torn_down => GamePhase::TornDown,
            Some(log) if log.loading_ended => GamePhase::InGame,
            Some(_) => GamePhase::Loading,
        }
    }

    /// The branch's `worthReporting` rule, with the log as the fallback when
    /// the client said nothing at all.
    ///
    /// A crash marker inside the game's window is always worth reporting. A
    /// client that spoke is believed, and anything but a clean `Exit` with code
    /// zero is reported. A client that said nothing, which is the Classic flow,
    /// leaves it to the log, and a log with no teardown is a game that did not
    /// end on its own.
    pub fn worth_reporting(&self) -> bool {
        if self.ending.crashed == Some(true) {
            return true;
        }
        let Ending { exit_code, .. } = &self.ending;
        if self.ending.exit_reason.is_some() || exit_code.is_some() {
            let clean_exit = self.ending.client_reason() == Some(ClientReason::Exit);
            return !clean_exit || exit_code.is_some_and(|code| code != 0);
        }
        self.log.as_ref().is_some_and(|log| !log.torn_down)
    }

    fn id(&self) -> String {
        self.log_path
            .as_ref()
            .and_then(|path| {
                path.file_name()?
                    .to_str()?
                    .strip_suffix("_r3dlog.txt")
                    .map(str::to_string)
            })
            .unwrap_or_else(|| {
                self.started_at
                    .with_timezone(&Local)
                    .format("%Y-%m-%dT%H-%M-%S")
                    .to_string()
            })
    }

    fn is_workshop(&self) -> bool {
        self.origin.is_workshop()
    }

    /// Seconds from the first sign to the last, or the log's own clock when
    /// it ran longer than the signs say.
    fn duration_secs(&self) -> f64 {
        let signs = (self.ended_at - self.started_at).num_milliseconds() as f64 / 1000.0;
        let log = self.log.as_ref().map_or(0.0, |log| log.last_time);
        signs.max(log).max(0.0)
    }

    fn ran_lazy_and_ended_early(&self) -> bool {
        self.scan == Some(ScanMode::Lazy) && self.duration_secs() < EARLY_CRASH_SECS
    }

    fn first_code_of(
        &self,
        wanted: impl Fn(CodeKind) -> bool,
    ) -> Option<(&CodeSighting, &'static CodeRow)> {
        self.log.as_ref()?.codes.iter().find_map(|sighting| {
            let row = log_codes::lookup(&sighting.code)?;
            wanted(row.kind).then_some((sighting, row))
        })
    }

    /// The row with the firmest mark among the codes `wanted` accepts, so one
    /// confirmed sighting is not read down by an inferred one beside it.
    fn best_row_of(&self, wanted: impl Fn(CodeKind) -> bool) -> Option<&'static CodeRow> {
        self.log
            .as_ref()?
            .codes
            .iter()
            .filter_map(|sighting| log_codes::lookup(&sighting.code))
            .filter(|row| wanted(row.kind))
            .max_by_key(|row| row.mark == EvidenceMark::Confirmed)
    }

    /// The precedence table, highest first. The first rule that fires wins, and
    /// each rule owns its own trigger and its build, so the order is the whole
    /// of the classification and the verdicts do not know about each other.
    const RULES: &[VerdictRule] = &[
        Self::rule_patcher_failure,
        Self::rule_out_of_date,
        Self::rule_scan_rejection,
        Self::rule_overlay_disabled,
        Self::rule_unmodded,
        Self::rule_missing_data,
        Self::rule_corrupt_archive,
        Self::rule_texture_failure,
        Self::rule_out_of_memory,
        Self::rule_graphics_fault,
        Self::rule_stuck_loading,
        Self::rule_archive_skipped,
        Self::rule_ended_without_reason,
    ];

    /// The verdict over this record, or `None` when no rule fires and the game
    /// was clean.
    fn verdict(&self, ctx: &ClassifyContext<'_>) -> Option<(Verdict, Vec<Suspect>)> {
        Self::RULES.iter().find_map(|rule| rule(self, ctx))
    }

    /// The patcher never got a mod into the game, in the build or at the host.
    fn rule_patcher_failure(&self, _ctx: &ClassifyContext<'_>) -> Option<(Verdict, Vec<Suspect>)> {
        let failure = self.failure.as_ref()?;
        let verdict = match failure {
            // The message is the builder's or the host's own words, which name
            // a part of the patcher the player has never heard of. Each cause
            // says what the step was for before quoting it.
            SessionFailure::Build { kind, message } => Verdict::new(
                VerdictKind::OverlayBuildFailed,
                format!(
                    "Your enabled mods are merged into one overlay before League starts, and that did not finish, so the game ran without them. {}",
                    failure_detail(*kind, message)
                ),
            )
            .with_hint(hint::REBUILD_OVERLAY),
            SessionFailure::Injection {
                stage: InjectionStage::Host,
                message,
            } => Verdict::new(
                VerdictKind::InjectionHostFailed,
                format!(
                    "The overlay was built, but the program that serves it to League never started, so the game ran without it. {}",
                    capitalized_sentence(message)
                ),
            )
            .with_hint(hint::SYSTEM_CHECKS),
            SessionFailure::Injection {
                stage: InjectionStage::Injection,
                message,
            } => Verdict::new(
                VerdictKind::PatcherDidNotRun,
                format!(
                    "The overlay was ready and the game started, but the patcher never got into League, so the game ran without it. {}",
                    capitalized_sentence(message)
                ),
            )
                .with_hint(if self.host_elevated {
                    hint::SIGNATURE
                } else {
                    hint::ELEVATE
                })
                .with_hint(hint::SYSTEM_CHECKS),
        };
        Some((verdict, Vec::new()))
    }

    /// The DLL refused a game build newer than it knows, and the game ran unmodded.
    fn rule_out_of_date(&self, _ctx: &ClassifyContext<'_>) -> Option<(Verdict, Vec<Suspect>)> {
        if self.overlay != OverlayOutcome::EndOfLife {
            return None;
        }
        let build = match &self.overlay_detail {
            Some(OverlayDetail::Build(build)) => {
                format!(" The game's build is {}.", build.trim())
            }
            _ => String::new(),
        };
        let verdict = Verdict::new(VerdictKind::PatcherOutOfDate, format!(
                "The patcher does not know this version of League. The DLL refused to patch a build newer than the one it was made for, and the game ran unmodded.{build}"
            ),
        )
        .with_hint(hint::UPDATE_MANAGER);
        Some((verdict, Vec::new()))
    }

    /// The integrity scan rejected an archive, so no mod was applied.
    fn rule_scan_rejection(&self, ctx: &ClassifyContext<'_>) -> Option<(Verdict, Vec<Suspect>)> {
        let first = self.scan_failures.first()?;
        let archive = first
            .wad
            .as_deref()
            .map(last_segment)
            .unwrap_or_else(|| "An archive".to_string());
        let status = self.scan_status().unwrap_or(ScanStatus::Unknown);
        let mut cause = status.cause(&archive, &first.status);
        let others = self.scan_failures.len() - 1;
        if others > 0 {
            cause.push_str(&format!(
                " {others} more archive{} failed the scan.",
                plural(others)
            ));
        }
        let wads: Vec<String> = self
            .scan_failures
            .iter()
            .filter_map(|failure| failure.wad.clone())
            .collect();
        let suspects = ctx.writers_of(&wads, Because::Rejected);
        let mut verdict = Verdict::new(status.kind(), cause);
        if first.wad.is_some() {
            verdict = verdict.with_subject(archive);
            if self.is_workshop() {
                verdict = verdict.with_hint(hint::OPEN_PROJECT);
            }
        }
        Some((verdict, suspects))
    }

    /// The eager scan turned the overlay off before the game loaded.
    fn rule_overlay_disabled(&self, ctx: &ClassifyContext<'_>) -> Option<(Verdict, Vec<Suspect>)> {
        if self.overlay != OverlayOutcome::Disabled {
            return None;
        }
        let (archive, why) = match &self.overlay_detail {
            Some(OverlayDetail::Rejected { wad, why }) => (
                Some(wad.clone()),
                Some(why.clone()).filter(|why| !why.is_empty()),
            ),
            _ => (None, None),
        };
        let mut cause = String::from("The patcher turned the overlay off before the game loaded.");
        let mut verdict =
            Verdict::new(VerdictKind::OverlayDisabled, "").with_hint(hint::REBUILD_OVERLAY);
        let mut suspects = Vec::new();
        match archive {
            Some(archive) => {
                cause.push_str(&format!(" {archive} did not verify"));
                match why {
                    Some(why) => cause.push_str(&format!(": {}", sentence(&why))),
                    None => cause.push('.'),
                }
                cause.push_str(" The eager scan fails closed, so no mod was in the game.");
                suspects = ctx.writers_of(
                    std::slice::from_ref(&archive), Because::DidNotVerify
                );
                verdict = verdict.with_subject(archive);
                if self.is_workshop() {
                    verdict = verdict.with_hint(hint::OPEN_PROJECT);
                }
            }
            None => cause.push_str(
                " The eager scan fails closed on the first archive that does not verify, so no mod was in the game.",
            ),
        }
        verdict.cause = cause;
        Some((verdict, suspects))
    }

    /// A game where no mod reached it, and why the DLL made none.
    fn rule_unmodded(&self, _ctx: &ClassifyContext<'_>) -> Option<(Verdict, Vec<Suspect>)> {
        if self.overlay == OverlayOutcome::Live || !self.worth_reporting() {
            return None;
        }
        let mut verdict = Verdict::new(VerdictKind::Unmodded, "");
        let why = match self.overlay {
            _ if !self.injected => {
                "The DLL never attached, because the patcher was not running or the host never found the game.".to_string()
            }
            OverlayOutcome::TooLate => {
                verdict = verdict.with_hint(hint::START_FIRST);
                "League started before the patcher's scan, so the DLL joined too late and stayed inert.".to_string()
            }
            OverlayOutcome::HookFailed => match &self.overlay_detail {
                Some(OverlayDetail::Hook(hook)) => format!(
                    "The DLL attached, and a hook did not install: {}",
                    sentence(hook)
                ),
                _ => "The DLL attached, and a hook did not install.".to_string(),
            },
            _ => "The DLL attached and said nothing about the overlay.".to_string(),
        };
        verdict.cause = format!("No mod was in this game. {why}");
        Some((verdict, Vec::new()))
    }

    /// A file the game needed was in no mounted archive.
    fn rule_missing_data(&self, ctx: &ClassifyContext<'_>) -> Option<(Verdict, Vec<Suspect>)> {
        let (sighting, _) = self.first_code_of(|kind| kind == CodeKind::MissingData)?;
        let hash = missing_hash_in(&sighting.line);
        let path = hash.and_then(|hash| (ctx.resolve_hash)(hash));
        let mut verdict = Verdict::new(VerdictKind::MissingData, "");
        let mut cause = String::from("League failed to read a file.");

        let suspects = match &path {
            Some(path) => {
                // The path is the answer, so it goes in the subject where the
                // card sets it in mono, not buried in the sentence.
                verdict = verdict.with_subject(path);
                let writers = match PathHome::of(path) {
                    PathHome::Champion(champion) => {
                        let archive = format!("{champion}.wad.client");
                        ctx.suspects(|name| name == archive, Because::HoldsThePath)
                    }
                    PathHome::Map => ctx.suspects(is_map_archive, Because::HoldsThePath),
                    PathHome::Unknown => Vec::new(),
                };
                if writers.is_empty() {
                    cause.push_str(" No enabled mod writes the archive that file lives in, so the mods that were in the game are listed.");
                    self.redirected_writers(ctx)
                } else {
                    writers
                }
            }
            None => {
                match hash {
                    Some(hash) => cause.push_str(&format!(
                        " The file's hash is 0x{hash:016x}, and no table names it, so it is a path a mod referenced and did not ship."
                    )),
                    None => cause.push_str(" The line carries no hash the manager can read."),
                }
                cause.push_str(" The mods whose archives were in the game are listed.");
                self.redirected_writers(ctx)
            }
        };

        verdict.cause = cause;
        verdict = verdict.with_hint(if self.is_workshop() {
            hint::OPEN_PROJECT
        } else {
            hint::DISABLE_SUSPECT
        });
        Some((verdict, suspects))
    }

    /// An archive would not mount, and the log does not name which.
    fn rule_corrupt_archive(&self, ctx: &ClassifyContext<'_>) -> Option<(Verdict, Vec<Suspect>)> {
        let (_, row) = self.first_code_of(|kind| kind == CodeKind::WadMount)?;
        let verdict = Verdict::new(
            VerdictKind::CorruptArchive,
            format!(
                "{} The log does not name which WAD, so every mod that was in the game is listed.",
                reading(row)
            ),
        )
        .with_hint(hint::REBUILD_OVERLAY)
        .with_hint(hint::REPAIR_INSTALL);
        Some((verdict, self.redirected_writers(ctx)))
    }

    /// A texture would not load onto the GPU. Names no mod.
    ///
    /// Nothing in the log says which texture failed or where it came from, and
    /// the game's own textures fail this way too, so a list of everything that
    /// was loaded would only be a list of everything that was loaded.
    fn rule_texture_failure(&self, _ctx: &ClassifyContext<'_>) -> Option<(Verdict, Vec<Suspect>)> {
        self.first_code_of(|kind| kind == CodeKind::Texture)?;
        let verdict = Verdict::new(
            VerdictKind::TextureFailed,
            "League could not load a texture onto the GPU. An invalid or unexpected texture format, or invalid texture dimensions, can cause this.",
        )
        .with_hint(hint::TEXTURE_DIMENSIONS)
        .with_hint(hint::REBUILD_OVERLAY);
        Some((verdict, Vec::new()))
    }

    /// League asked for memory and did not get it.
    ///
    /// An allocation fails for far more reasons than the log names, so the
    /// cause says only what the manager can act on and never settles on one.
    fn rule_out_of_memory(&self, _ctx: &ClassifyContext<'_>) -> Option<(Verdict, Vec<Suspect>)> {
        let row = self.best_row_of(|kind| kind == CodeKind::Memory)?;
        let count = self.redirected.len();
        let mut verdict = Verdict::new(VerdictKind::OutOfMemory, format!(
                "League asked for memory and did not get it. {} An allocation fails for many reasons, and the three worth checking are free RAM, room on the drive for Windows to grow the page file, and a mod whose textures are far larger than what they replace.",
                reading(row)
            ),
        )
        .with_hint(hint::FREE_MEMORY);
        if count > 0 {
            verdict = verdict.with_hint(format!(
                "{count} modded archive{} {} in this game. Disable any that replace textures with much larger ones and play again.",
                plural(count),
                if count == 1 { "was" } else { "were" }
            ));
        }
        Some((verdict, Vec::new()))
    }

    /// The graphics driver stopped responding.
    fn rule_graphics_fault(&self, _ctx: &ClassifyContext<'_>) -> Option<(Verdict, Vec<Suspect>)> {
        let (_, row) = self.first_code_of(|kind| kind == CodeKind::Device)?;
        let verdict = Verdict::new(
            VerdictKind::GraphicsFault,
            format!("The graphics driver stopped responding. {}", reading(row)),
        )
        .with_hint(hint::UPDATE_DRIVER);
        Some((verdict, Vec::new()))
    }

    /// League never finished the loading screen.
    fn rule_stuck_loading(&self, ctx: &ClassifyContext<'_>) -> Option<(Verdict, Vec<Suspect>)> {
        let log = self.log.as_ref()?;
        let step = log.last_load_step.as_ref()?;
        if log.loading_ended || !self.worth_reporting() {
            return None;
        }
        let row = log_codes::lookup(&step.code);
        let number = row.and_then(|row| match row.kind {
            CodeKind::LoadStep(n) => Some(n),
            _ => None,
        });
        let mut verdict = Verdict::new(VerdictKind::StuckLoading, "");
        let suspects = match number {
            Some(n) => {
                let work = row
                    .and_then(|row| row.meaning.split_once(", "))
                    .map(|(_, work)| format!(", {work}"))
                    .unwrap_or_default();
                verdict.cause = format!(
                    "League stopped at loading step {n} of {LOAD_STEPS}{work}. The marker is written before its step runs, so this is the step that did not finish."
                );
                verdict = verdict.with_subject(format!("step {n} of {LOAD_STEPS}"));
                match n {
                    CHAMPION_STEP => self.redirected_writers_where(ctx, is_champion_archive),
                    MAP_STEP => self.redirected_writers_where(ctx, is_map_archive),
                    _ => Vec::new(),
                }
            }
            None => {
                verdict.cause = format!(
                    "League stopped on the loading screen, at a step the manager does not know ({}).",
                    step.code
                );
                Vec::new()
            }
        };
        if self.ran_lazy_and_ended_early() {
            verdict = verdict.with_hint(hint::SCAN_UP_FRONT);
        }
        Some((verdict, suspects))
    }

    /// The lazy scan skipped an archive, and the game ran without that one.
    fn rule_archive_skipped(&self, ctx: &ClassifyContext<'_>) -> Option<(Verdict, Vec<Suspect>)> {
        let first = self.skipped.first()?;
        let count = self.skipped.len();
        let archive = last_segment(&first.wad);
        let mut cause = if count == 1 {
            String::from("One archive was left unmodded.")
        } else {
            format!("{count} archives were left unmodded.")
        };
        cause.push_str(&format!(
            " The lazy scan skipped {archive}: {} The game ran with every other mod and without this one.",
            sentence(&first.why)
        ));
        let wads: Vec<String> = self.skipped.iter().map(|s| s.wad.clone()).collect();
        let suspects = ctx.writers_of(&wads, Because::Skipped);
        let mut verdict = Verdict::new(VerdictKind::ArchiveSkipped, cause)
            .with_subject(archive)
            .with_hint(hint::REBUILD_OVERLAY);
        if self.is_workshop() {
            verdict = verdict.with_hint(hint::OPEN_PROJECT);
        }
        Some((verdict, suspects))
    }

    /// League closed and left no reason the manager can read.
    fn rule_ended_without_reason(
        &self,
        _ctx: &ClassifyContext<'_>,
    ) -> Option<(Verdict, Vec<Suspect>)> {
        if !self.worth_reporting() {
            return None;
        }
        let mut cause = String::from("League closed, and left no reason the manager can read.");
        match self.ending.summary() {
            Some(summary) => cause.push_str(&format!(" The client reported {summary}.")),
            None => cause.push_str(" The client reported no reason and no exit code."),
        }
        match self.ending.crashed {
            Some(true) => cause.push_str(" Crashpad ran."),
            Some(false) => cause.push_str(" Crashpad did not run."),
            None => {}
        }
        match &self.log {
            Some(log) => cause.push_str(&format!(
                " The game log held {} error line{}.",
                log.error_lines,
                plural(log.error_lines as usize)
            )),
            None => cause.push_str(" No game log was read."),
        }
        let mut verdict = Verdict::new(VerdictKind::EndedWithoutReason, cause);
        if self.ran_lazy_and_ended_early() {
            verdict = verdict.with_hint(hint::SCAN_UP_FRONT);
        }
        Some((verdict.with_hint(hint::COPY_REPORT), Vec::new()))
    }

    fn redirected_writers(&self, ctx: &ClassifyContext<'_>) -> Vec<Suspect> {
        ctx.writers_of(&self.redirected, Because::Redirected)
    }

    fn redirected_writers_where(
        &self,
        ctx: &ClassifyContext<'_>,
        keep: fn(&str) -> bool,
    ) -> Vec<Suspect> {
        let archives: Vec<String> = self
            .redirected
            .iter()
            .filter(|wad| keep(&wad_basename(wad)))
            .cloned()
            .collect();
        ctx.writers_of(&archives, Because::Redirected)
    }

    /// The timeline, the log's codes and the client's word, newest first.
    fn evidence(&self) -> Vec<Evidence> {
        let mut rows: Vec<(f64, Evidence)> = Vec::new();
        // A session that failed before any game has nothing else to show, and
        // the kind is the part worth pasting into a report.
        if let Some(failure) = &self.failure {
            let secs = self.duration_secs();
            rows.push((
                secs,
                Evidence {
                    at: clock(secs),
                    source: EvidenceSource::Patcher,
                    line: failure.line(),
                    code: None,
                },
            ));
        }
        for raw in &self.timeline {
            let secs = ((raw.at - self.started_at).num_milliseconds() as f64 / 1000.0).max(0.0);
            rows.push((
                secs,
                Evidence {
                    at: clock(secs),
                    source: raw.source,
                    line: raw.line.clone(),
                    code: None,
                },
            ));
        }
        if let Some(log) = &self.log {
            for sighting in &log.codes {
                rows.push((
                    sighting.at,
                    Evidence {
                        at: clock(sighting.at),
                        source: EvidenceSource::Game,
                        line: sighting.line.clone(),
                        code: Some(EvidenceCode::from_table(&sighting.code)),
                    },
                ));
            }
        }
        if let Some(summary) = self.ending.summary() {
            let secs = self.duration_secs();
            rows.push((
                secs,
                Evidence {
                    at: clock(secs),
                    source: EvidenceSource::Client,
                    line: summary,
                    code: None,
                },
            ));
        }
        rows.sort_by(|a, b| a.0.total_cmp(&b.0));
        rows.reverse();
        rows.into_iter().map(|(_, evidence)| evidence).collect()
    }
}
