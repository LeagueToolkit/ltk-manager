//! The verdict classifier: a pure function over a [`GameRecord`] and the
//! library's footprints, with no I/O and no file read, so every verdict is a
//! unit test. The precedence table in [`GameRecord::verdict`] is the whole of
//! it, and each row builds one [`Verdict`] with its suspects.

use super::*;
use crate::launcher::same_install;
use crate::utils::path::slashed;

/// One rule of the precedence table: a self-contained verdict that fires on a
/// record, or `None` to let the next rule try. See [`GameRecord::RULES`].
type VerdictRule = fn(&GameRecord, &ClassifyContext<'_>) -> Option<(Verdict, Vec<Suspect>)>;

/// The loading step that mounts the champions' archives.
const CHAMPION_STEP: u8 = 52;

/// The loading step that sets up the map's rendering.
const MAP_STEP: u8 = 62;

/// The last loading step a marker for `step` covers, since the steps before the
/// next marker in the table write none of their own.
fn last_step_under_marker(step: u8) -> u8 {
    log_codes::rows()
        .filter_map(|row| match row.kind {
            CodeKind::LoadStep(next) if next > step => Some(next - 1),
            _ => None,
        })
        .min()
        .unwrap_or(LOAD_STEPS)
}

/// A game that ended inside this many seconds under the lazy scan earns the
/// up-front scan hint, and one that ended inside them with a redirected
/// archive and no log is an incident.
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
            log_root: None,
            log: None,
            log_searched: false,
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
            scan_status_code: self.scan_failures.first().map(|f| f.status.clone()),
            scan_rejected: saturating_count(self.scan_failures.len()),
            shader: (verdict.kind == VerdictKind::ShaderFailed)
                .then(|| self.shader_failure())
                .flatten(),
            phase: self.phase(),
            game: self.log.as_ref().map(|log| GameInfo {
                version: log.build_version.clone().unwrap_or_default(),
                content_version: log.content_version.clone().unwrap_or_default(),
                log_path: self
                    .log_path
                    .as_ref()
                    .map(|path| path.display().to_string())
                    .unwrap_or_default(),
                game_base_dir: log.game_base_dir.clone(),
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
        Self::rule_wrong_install,
        Self::rule_patcher_failure,
        Self::rule_out_of_date,
        Self::rule_scan_rejection,
        Self::rule_overlay_disabled,
        Self::rule_unmodded,
        Self::rule_missing_data,
        Self::rule_corrupt_archive,
        Self::rule_shader_failure,
        Self::rule_texture_failure,
        Self::rule_out_of_memory,
        Self::rule_graphics_fault,
        Self::rule_stuck_loading,
        Self::rule_archive_skipped,
        Self::rule_short_game_without_log,
        Self::rule_ended_without_reason,
    ];

    /// The verdict over this record, or `None` when no rule fires and the game
    /// was clean.
    fn verdict(&self, ctx: &ClassifyContext<'_>) -> Option<(Verdict, Vec<Suspect>)> {
        Self::RULES.iter().find_map(|rule| rule(self, ctx))
    }

    /// The game ran from another install than the overlay was built for, and
    /// did not end clean. Per "The wrong install" in docs/ux/LEAGUE_DIAGNOSTICS.md.
    fn rule_wrong_install(&self, ctx: &ClassifyContext<'_>) -> Option<(Verdict, Vec<Suspect>)> {
        let base_dir = self.log.as_ref()?.game_base_dir.as_deref()?;
        let configured = ctx.league_path?;
        let ran_from = Path::new(base_dir);
        if same_install(ran_from, configured)
            || same_install(ran_from, &configured.join("Game"))
            || !self.worth_reporting()
        {
            return None;
        }
        let verdict = Verdict::new(
            VerdictKind::WrongInstall,
            format!(
                "League ran from {}, and the overlay was built for {}. A mod built from one install crashes the other.",
                slashed(ran_from),
                slashed(configured)
            ),
        )
        .with_hint(Hint::CheckGamePath);
        Some((verdict, Vec::new()))
    }

    /// The patcher never got a mod into the game, in the build or at the host.
    fn rule_patcher_failure(&self, _ctx: &ClassifyContext<'_>) -> Option<(Verdict, Vec<Suspect>)> {
        let failure = self.failure.as_ref()?;
        let verdict = match failure {
            // The message is the builder's or the host's own words, which name
            // a part of the patcher the player has never heard of. Each cause
            // says what the step was for before quoting it.
            SessionFailure::Build {
                kind,
                category,
                message,
            } => {
                let mut verdict = Verdict::new(
                    VerdictKind::OverlayBuildFailed,
                    format!(
                        "Your enabled mods are merged into one overlay before League starts, and that did not finish, so the game ran without them. {}",
                        failure_detail(*kind, message)
                    ),
                );
                for hint in build_failure_hints(*category) {
                    verdict = verdict.with_hint(*hint);
                }
                verdict
            }
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
            .with_hint(Hint::SystemChecks),
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
                    Hint::Signature
                } else {
                    Hint::Elevate
                })
                .with_hint(Hint::SystemChecks),
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
        .with_hint(Hint::UpdateManager);
        Some((verdict, Vec::new()))
    }

    /// The integrity scan rejected an archive, so no mod was applied.
    ///
    /// The cause is left empty on purpose. What a rejection reads like is the
    /// frontend's sentence, built from `scan_status`, `scan_status_code` and
    /// `scan_rejected`, so the dialog and the Games tab word one event once.
    fn rule_scan_rejection(&self, ctx: &ClassifyContext<'_>) -> Option<(Verdict, Vec<Suspect>)> {
        let first = self.scan_failures.first()?;
        let status = self.scan_status().unwrap_or(ScanStatus::Unknown);
        let wads: Vec<String> = self
            .scan_failures
            .iter()
            .filter_map(|failure| failure.wad.clone())
            .collect();
        let suspects = ctx.writers_of(&wads, Because::Rejected);
        let mut verdict = Verdict::new(status.kind(), "").with_hint(status.hint());
        if let Some(wad) = first.wad.as_deref() {
            verdict = verdict.with_subject(last_segment(wad));
            if self.is_workshop() {
                verdict = verdict.with_hint(Hint::OpenProject);
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
            Verdict::new(VerdictKind::OverlayDisabled, "").with_hint(Hint::RebuildOverlay);
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
                    verdict = verdict.with_hint(Hint::OpenProject);
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
                verdict = verdict.with_hint(Hint::StartFirst);
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
                    cause.push_str(
                        " The specified file could not be found in any mounted WAD archive.",
                    );
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
            Hint::OpenProject
        } else {
            Hint::DisableSuspect
        });
        Some((verdict, suspects))
    }

    /// An archive would not mount, named with its problem when the lines under
    /// the code say. Per "A corrupt archive" in docs/ux/LEAGUE_DIAGNOSTICS.md.
    fn rule_corrupt_archive(&self, ctx: &ClassifyContext<'_>) -> Option<(Verdict, Vec<Suspect>)> {
        let (sighting, row) = self.first_code_of(|kind| kind == CodeKind::WadMount)?;
        let wad = sighting.detail_value("WadFile");
        let word = sighting.detail_value("Problem");
        let problem = word.and_then(MountProblem::parse);
        let (cause, suspects) = match wad {
            Some(wad) => {
                let mut cause = format!("League could not mount {}.", last_segment(wad));
                match (problem, word) {
                    (Some(problem), _) => cause.push_str(&format!(" {}", problem.reading())),
                    (None, Some(word)) => {
                        cause.push_str(&format!(" The game reported the problem as {word}."))
                    }
                    (None, None) => {}
                }
                (
                    cause,
                    ctx.writers_of(&[wad.to_string()], Because::CouldNotMount),
                )
            }
            None => (
                format!(
                    "{} The log does not name which WAD, so every mod that was in the game is listed.",
                    reading(row)
                ),
                self.redirected_writers(ctx),
            ),
        };
        let mut verdict =
            Verdict::new(VerdictKind::CorruptArchive, cause).with_hint(Hint::RebuildOverlay);
        if let Some(wad) = wad {
            verdict = verdict.with_subject(last_segment(wad));
        }
        if problem != Some(MountProblem::Inconsistent) {
            verdict = verdict.with_hint(Hint::RepairInstall);
        }
        Some((verdict, suspects))
    }

    /// A shader did not compile, or a material had no pipeline, in a game that
    /// did not end clean. Per "A shader failed" in docs/ux/LEAGUE_DIAGNOSTICS.md.
    ///
    /// The cause is left empty. The frontend words it from [`Incident::shader`].
    fn rule_shader_failure(&self, ctx: &ClassifyContext<'_>) -> Option<(Verdict, Vec<Suspect>)> {
        if !self.worth_reporting() {
            return None;
        }
        let failure = self.shader_failure()?;

        let mut verdict = Verdict::new(VerdictKind::ShaderFailed, "");
        if let Some(defines) = self
            .shader_variants()
            .first()
            .map(|variant| variant.defines)
            && !defines.is_empty()
        {
            verdict = verdict.with_subject(spaced_defines(defines));
        }
        if failure.unnamed_programs {
            verdict = verdict.with_hint(Hint::ShaderDefinition);
        }
        verdict = verdict.with_hint(if self.is_workshop() {
            Hint::OpenProject
        } else {
            Hint::DisableSuspect
        });
        Some((verdict, self.redirected_writers(ctx)))
    }

    /// The failed shader variants in the log, each once, in the order first seen.
    fn shader_variants(&self) -> Vec<ShaderVariant<'_>> {
        let mut variants: Vec<ShaderVariant<'_>> = Vec::new();
        let sightings = self.log.iter().flat_map(|log| &log.messages);
        for variant in sightings.filter_map(ShaderVariant::of) {
            if !variants.contains(&variant) {
                variants.push(variant);
            }
        }
        variants
    }

    /// What the log says about failed shaders, or `None` when it says nothing.
    fn shader_failure(&self) -> Option<ShaderFailure> {
        let variants = self.shader_variants();
        let missing_pipeline = self
            .log
            .iter()
            .flat_map(|log| &log.messages)
            .find_map(MessageSighting::missing_pipeline)
            .map(str::to_string);
        if variants.is_empty() && missing_pipeline.is_none() {
            return None;
        }
        Some(ShaderFailure {
            variants: saturating_count(variants.len()),
            unnamed_programs: !variants.is_empty()
                && variants.iter().all(ShaderVariant::names_no_vertex_shader),
            missing_pipeline,
        })
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
        .with_hint(Hint::TextureDimensions)
        .with_hint(Hint::RebuildOverlay);
        Some((verdict, Vec::new()))
    }

    /// League asked for memory and did not get it.
    ///
    /// An allocation fails for far more reasons than the log names, so the
    /// cause says only what the manager can act on and never settles on one.
    fn rule_out_of_memory(&self, _ctx: &ClassifyContext<'_>) -> Option<(Verdict, Vec<Suspect>)> {
        let row = self.best_row_of(|kind| kind == CodeKind::Memory)?;
        let mut verdict = Verdict::new(VerdictKind::OutOfMemory, format!(
                "League asked for memory and did not get it. {} An allocation fails for many reasons, and the three worth checking are free RAM, room on the drive for Windows to grow the page file, and a mod whose textures are far larger than what they replace.",
                reading(row)
            ),
        )
        .with_hint(Hint::FreeMemory);
        if !self.redirected.is_empty() {
            verdict = verdict.with_hint(Hint::LargeTextures);
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
        .with_hint(Hint::UpdateDriver);
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
                let stalled = match last_step_under_marker(n) {
                    last if last == n => String::from("this is the step that did not finish"),
                    last if last == n + 1 => format!(
                        "step {last} writes no marker of its own, so the step that did not finish is {n} or {last}"
                    ),
                    last => format!(
                        "steps {} to {last} write no marker of their own, so the step that did not finish is one of {n} to {last}",
                        n + 1
                    ),
                };
                verdict.cause = format!(
                    "League stopped at loading step {n} of {LOAD_STEPS}{work}. The marker is written before its step runs, and {stalled}."
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
            verdict = verdict.with_hint(Hint::ScanUpFront);
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
            .with_hint(Hint::RebuildOverlay);
        if self.is_workshop() {
            verdict = verdict.with_hint(Hint::OpenProject);
        }
        Some((verdict, suspects))
    }

    /// A game the overlay reached that ended inside its first minute, with no
    /// log under the configured install. Per "Ended without a reason" in
    /// docs/ux/LEAGUE_DIAGNOSTICS.md.
    fn rule_short_game_without_log(
        &self,
        _ctx: &ClassifyContext<'_>,
    ) -> Option<(Verdict, Vec<Suspect>)> {
        if !self.log_searched
            || self.log.is_some()
            || self.redirected.is_empty()
            || self.duration_secs() >= EARLY_CRASH_SECS
        {
            return None;
        }
        let verdict = Verdict::new(
            VerdictKind::EndedWithoutReason,
            format!(
                "League ended {:.0} seconds after the patcher redirected an archive into it, and no game log for the game was found under the configured install.",
                self.duration_secs()
            ),
        )
        .with_hint(Hint::CheckGamePath);
        Some((verdict, Vec::new()))
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
            verdict = verdict.with_hint(Hint::ScanUpFront);
        }
        Some((verdict.with_hint(Hint::CopyReport), Vec::new()))
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
                    detail: Vec::new(),
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
                    detail: Vec::new(),
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
                        detail: sighting.detail.clone(),
                        code: Some(EvidenceCode::from_table(&sighting.code)),
                    },
                ));
            }

            // A failed variant is logged again for every define set that asks
            // for it, so each shows once, at its last sighting. Pushed in log
            // order, so a tie on the clock still reads newest first.
            let mut shown: Vec<(&str, Vec<&str>)> = Vec::new();
            let mut last_sightings: Vec<&MessageSighting> = Vec::new();
            for sighting in log.messages.iter().rev() {
                let key = (
                    Record::parse(&sighting.line).map_or(sighting.line.as_str(), |r| r.message),
                    sighting
                        .detail
                        .iter()
                        .map(String::as_str)
                        .filter(|line| !line.starts_with(GLOBAL_DEFINES))
                        .collect(),
                );
                if !shown.contains(&key) {
                    shown.push(key);
                    last_sightings.push(sighting);
                }
            }
            for sighting in last_sightings.into_iter().rev() {
                rows.push((
                    sighting.at,
                    Evidence {
                        at: clock(sighting.at),
                        source: EvidenceSource::Game,
                        line: sighting.line.clone(),
                        detail: sighting.detail.clone(),
                        code: None,
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
                    detail: Vec::new(),
                    code: None,
                },
            ));
        }
        rows.sort_by(|a, b| a.0.total_cmp(&b.0));
        rows.reverse();
        rows.into_iter().map(|(_, evidence)| evidence).collect()
    }
}

/// The detail line naming the defines every pass of a frame shares.
const GLOBAL_DEFINES: &str = "Global Defines:";

/// One shader variant that did not compile, told apart by its programs and
/// its pass defines.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ShaderVariant<'a> {
    vertex: &'a str,
    pixel: &'a str,
    defines: &'a str,
}

impl<'a> ShaderVariant<'a> {
    /// The variant a `Failed to compile shader.` sighting names, or `None` for
    /// any other message.
    fn of(sighting: &'a MessageSighting) -> Option<Self> {
        (sighting.message == LogMessage::ShaderCompileFailed).then(|| Self {
            vertex: sighting.detail_value("Vertex Shader").unwrap_or_default(),
            pixel: sighting.detail_value("Pixel Shader").unwrap_or_default(),
            defines: sighting.detail_value("Pass Defines").unwrap_or_default(),
        })
    }

    fn names_no_vertex_shader(&self) -> bool {
        self.vertex.is_empty()
    }
}

static DEFINE_NAME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[A-Z_][A-Z0-9_]*=").expect("a valid define pattern"));

/// `A=1B=2` as `A=1 B=2`. League writes a pass's defines with nothing between
/// them, and a define's name starts with a capital where its value is a number.
pub(super) fn spaced_defines(defines: &str) -> String {
    let mut spaced = String::with_capacity(defines.len() + 8);
    let mut from = 0;
    for name in DEFINE_NAME.find_iter(defines).skip(1) {
        spaced.push_str(&defines[from..name.start()]);
        spaced.push(' ');
        from = name.start();
    }
    spaced.push_str(&defines[from..]);
    spaced
}

/// The hints for a failed build, from the overlay's own word on which remedy
/// applies.
///
/// Only the categories whose remedy is not a rebuild get their own hints: a
/// wrong game directory is fixed in Settings, corrupt game files by a repair,
/// a builder bug by an update or a report, and a file held open by closing the
/// game. Everything else, including a
/// record from before the category was kept, keeps the rebuild hint.
fn build_failure_hints(category: Option<OverlayErrorCategory>) -> &'static [Hint] {
    match category {
        Some(OverlayErrorCategory::GameDir) => &[Hint::CheckGamePath],
        Some(OverlayErrorCategory::Corrupt) => &[Hint::RebuildOverlay, Hint::RepairInstall],
        Some(OverlayErrorCategory::Bug) => &[Hint::UpdateManager, Hint::CopyReport],
        Some(OverlayErrorCategory::FileInUse) => &[Hint::CloseGame],
        _ => &[Hint::RebuildOverlay],
    }
}
