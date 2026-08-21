//! The game log reader: one `r3dlog` in, a small record out.
//!
//! League writes `Logs/GameLogs/<stamp>/<stamp>_r3dlog.txt` for every game,
//! named for the moment it started in local time. The reader keeps the facts a
//! verdict reports and a bounded excerpt, and never keeps the file. Nothing in
//! here knows about the patcher, a mod, or Tauri.

use std::borrow::Cow;
use std::collections::{BTreeMap, VecDeque};
use std::fs::{self, File};
use std::io::{self, BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::thread;
use std::time::{Duration, Instant};

use chrono::{DateTime, Local, NaiveDateTime, TimeDelta, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};

use super::log_codes::{self, CodeKind};

/// The tail of the log the excerpt always keeps.
const TAIL_LINES: usize = 40;

/// Lines kept on each side of a coded line.
const CONTEXT_LINES: usize = 5;

/// The excerpt's size cap, which is what the incident budget allows for a game.
const EXCERPT_BYTES: usize = 16 * 1024;

/// Sightings kept before the oldest go. A graphics fault can write a code on
/// every frame, and the last sightings are the ones a verdict reads.
const MAX_SIGHTINGS: usize = 256;

/// How long a read waits for the game to let go of the file.
const READ_RETRY_BUDGET: Duration = Duration::from_secs(5);

const READ_RETRY_PAUSE: Duration = Duration::from_millis(100);

/// How far before the first sign a log may have opened. League opens it a few
/// seconds before the host sees the window.
const STAMP_LEAD_SECS: i64 = 60;

const STARTED_AT_PREFIX: &str = "Logging started at ";
const COMMAND_LINE_PREFIX: &str = "Command Line:";

/// One code the log carried, with where and when.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct CodeSighting {
    pub code: String,
    /// Seconds into the log.
    pub at: f64,
    /// The whole record, redacted.
    pub line: String,
}

/// What one game's log says, without the log.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct GameLogFacts {
    /// The wall clock the log opened at, from its first line.
    pub started_at: Option<String>,
    pub build_version: Option<String>,
    pub content_version: Option<String>,
    pub game_base_dir: Option<String>,
    /// `-EnableCrashpad` against `-DisableCrashUploading`, which picks the DLL's scan.
    pub crash_reporting: Option<bool>,
    /// Every code seen, in order, with its time.
    pub codes: Vec<CodeSighting>,
    /// The last `LOAD` marker, which is the step that was running at the end.
    pub last_load_step: Option<CodeSighting>,
    pub loading_ended: bool,
    /// A heuristic: `Loading Ended` was written, and at least one record came
    /// later than it.
    pub reached_game_loop: bool,
    /// `ALE-8SDFH23F` and the renderer's close, which a clean end writes.
    pub torn_down: bool,
    pub error_lines: u32,
    pub total_lines: u32,
    pub last_time: f64,
    /// The last forty lines, and ten around each coded line.
    pub excerpt: Vec<String>,
}

impl GameLogFacts {
    /// Reads one `r3dlog` from `reader`.
    ///
    /// Pure over the stream. Tolerates a file a crash cut short, including one
    /// padded with NUL bytes, and drops every private field of the command line
    /// before a line is kept.
    ///
    /// # Errors
    ///
    /// Only an I/O error reading the stream. A log with none of the expected
    /// lines reads as a record with nothing in it.
    pub fn read(reader: impl BufRead) -> std::io::Result<Self> {
        Reader::default().read(reader)
    }
}

/// One line of the log, split into its columns.
///
/// The only reader of the `time|LEVEL|CHAN| message` shape. An evidence row
/// keeps a game line whole, so [`Evidence`](super::incident::Evidence) reads its
/// columns back through this rather than matching them a second way.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Record<'a> {
    /// Seconds into the log.
    pub time: f64,
    /// `ALWAYS`, `ERROR`, `WARN` and the rest, as the game writes them.
    pub level: &'a str,
    /// The subsystem that wrote the line, which most lines do not name.
    pub channel: Option<&'a str>,
    /// What the line says, trimmed, with none of its columns.
    pub message: &'a str,
}

impl<'a> Record<'a> {
    /// Splits one log line into its columns.
    ///
    /// `None` for anything that is not a record, which is how NUL padding and
    /// a line a crash tore are skipped.
    pub fn parse(line: &'a str) -> Option<Self> {
        let (time, rest) = line.split_once('|')?;
        let time = time.trim();
        if time.is_empty() || !time.bytes().all(|b| b.is_ascii_digit() || b == b'.') {
            return None;
        }
        let time = time.parse().ok()?;
        let (level, rest) = rest.split_once('|')?;
        let level = level.trim();
        if level.is_empty() || !level.bytes().all(|b| b.is_ascii_uppercase()) {
            return None;
        }
        let (channel, message) = match rest.split_once('|') {
            Some((column, message)) if Self::is_channel(column) => (Some(column.trim()), message),
            _ => (None, rest),
        };
        Some(Self {
            time,
            level,
            channel,
            message: message.trim(),
        })
    }

    /// The channel column is six wide and holds one upper-case word, which
    /// keeps a `|` inside a message from reading as a channel.
    fn is_channel(column: &str) -> bool {
        let word = column.trim();
        column.len() <= 6
            && !word.is_empty()
            && word
                .bytes()
                .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
    }
}

/// The game's command line, cut down to what the record keeps.
#[derive(Debug, Default, PartialEq, Eq)]
struct CommandLine {
    game_base_dir: Option<String>,
    crashpad_enabled: bool,
    uploading_disabled: bool,
    /// The kept switches, in their original order.
    kept: Vec<String>,
}

impl CommandLine {
    fn parse(args: &str) -> Self {
        let mut parsed = Self::default();
        for arg in Self::args(args) {
            if let Some(dir) = arg.strip_prefix("-GameBaseDir=") {
                parsed.game_base_dir = Some(dir.to_owned());
            } else if arg == "-EnableCrashpad" || arg.starts_with("-EnableCrashpad=") {
                let value = arg.strip_prefix("-EnableCrashpad=").unwrap_or("true");
                parsed.crashpad_enabled = value.eq_ignore_ascii_case("true") || value == "1";
            } else if arg == "-DisableCrashUploading" {
                parsed.uploading_disabled = true;
            } else {
                continue;
            }
            parsed.kept.push(arg.to_owned());
        }
        parsed
    }

    /// The quoted arguments, or the whitespace-separated ones when nothing is
    /// quoted.
    fn args(text: &str) -> Vec<&str> {
        let quoted: Vec<&str> = text.split('"').skip(1).step_by(2).collect();
        if quoted.is_empty() {
            text.split_whitespace().collect()
        } else {
            quoted
        }
    }

    /// Mirrors the DLL's reading: reporting is on when crashpad is on and
    /// uploading is not disabled.
    fn crash_reporting(&self) -> bool {
        self.crashpad_enabled && !self.uploading_disabled
    }

    /// The kept switches, quoted the way the game writes them.
    fn redacted(&self) -> String {
        self.kept
            .iter()
            .map(|arg| format!("\"{arg}\""))
            .collect::<Vec<_>>()
            .join(" ")
    }
}

/// What a line may repeat from the command line, and what it becomes.
static REDACTIONS: LazyLock<Vec<(Regex, &'static str)>> = LazyLock::new(|| {
    [
        (r"\b(?:\d{1,3}\.){3}\d{1,3}\b", "<redacted>"),
        (
            r"\b(GameID|SummonerID|PlayerID)([=(])\d+",
            "${1}${2}<redacted>",
        ),
        (
            r#"\b(RiotClientAuthToken|LNPBlob)=[^\s"]+"#,
            "${1}=<redacted>",
        ),
        (r"\bRiotClientPort=\d+", "RiotClientPort=<redacted>"),
        (
            r"\bInitializing on port \d+",
            "Initializing on port <redacted>",
        ),
        (r"\b([A-Za-z0-9]+-)\d+(\.rofl)\b", "${1}<redacted>${2}"),
        (
            r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b",
            "<redacted>",
        ),
        (r"'[^'#]+#[^']+'", "'<redacted>'"),
    ]
    .into_iter()
    .map(|(pattern, replacement)| {
        let pattern = Regex::new(pattern).expect("a valid redaction pattern");
        (pattern, replacement)
    })
    .collect()
});

/// `line` with nothing private left in it.
///
/// A `Command Line:` line is rebuilt from `-GameBaseDir` and the crashpad
/// switches alone. Any other line loses its IPv4 addresses, game, summoner and
/// player ids, client port and token, LNP blob, replay file number, UUIDs, and
/// the Riot ID on the roster line. A line with nothing private is returned
/// borrowed.
pub fn redact_line(line: &str) -> Cow<'_, str> {
    if let Some(at) = line.find(COMMAND_LINE_PREFIX) {
        let (prefix, args) = line.split_at(at + COMMAND_LINE_PREFIX.len());
        let kept = CommandLine::parse(args).redacted();
        return Cow::Owned(if kept.is_empty() {
            prefix.to_owned()
        } else {
            format!("{prefix} {kept}")
        });
    }
    let mut out = Cow::Borrowed(line);
    for (pattern, replacement) in REDACTIONS.iter() {
        let replaced = match pattern.replace_all(&out, *replacement) {
            Cow::Borrowed(_) => None,
            Cow::Owned(replaced) => Some(replaced),
        };
        if let Some(replaced) = replaced {
            out = Cow::Owned(replaced);
        }
    }
    out
}

/// The reader's state over one pass of the stream.
#[derive(Debug, Default)]
struct Reader {
    facts: GameLogFacts,
    sightings: VecDeque<CodeSighting>,
    loading_ended_at: Option<f64>,
    teardown_code: bool,
    renderer_closed: bool,
    command_line_seen: bool,
    /// The newest lines, raw, keyed by line number. The tail of the excerpt,
    /// and the lines before a coded one.
    recent: VecDeque<(u32, String)>,
    /// The lines around each coded line, raw, keyed by line number.
    context: BTreeMap<u32, String>,
    context_bytes: usize,
    /// Lines still owed to the last coded line.
    context_due: usize,
}

impl Reader {
    fn read(mut self, mut reader: impl BufRead) -> io::Result<GameLogFacts> {
        let mut buf = Vec::new();
        loop {
            buf.clear();
            if reader.read_until(b'\n', &mut buf)? == 0 {
                break;
            }
            let text = String::from_utf8_lossy(&buf);
            self.record(text.trim_end_matches(['\n', '\r', '\0']));
        }
        Ok(self.finish())
    }

    fn record(&mut self, line: &str) {
        let Some(record) = Record::parse(line) else {
            return;
        };
        let index = self.facts.total_lines;
        self.facts.total_lines += 1;
        self.facts.last_time = record.time;
        if record.level == "ERROR" {
            self.facts.error_lines += 1;
        }
        self.note_header(&record);
        self.note_flow(&record);
        let coded = self.note_codes(&record, line);
        self.keep(index, line, coded);
    }

    fn note_header(&mut self, record: &Record<'_>) {
        let message = record.message;
        if let Some(at) = message.strip_prefix(STARTED_AT_PREFIX) {
            self.facts
                .started_at
                .get_or_insert_with(|| at.trim().to_owned());
        } else if let Some(args) = message.strip_prefix(COMMAND_LINE_PREFIX) {
            if !self.command_line_seen {
                self.command_line_seen = true;
                let command_line = CommandLine::parse(args);
                self.facts.crash_reporting = Some(command_line.crash_reporting());
                self.facts.game_base_dir = command_line.game_base_dir;
            }
        } else if let Some(version) = message.strip_prefix("Build Version:") {
            let version = version.trim_start();
            let version = version
                .strip_prefix("Version")
                .map_or(version, str::trim_start);
            if let Some(version) = version.split_whitespace().next() {
                self.facts
                    .build_version
                    .get_or_insert_with(|| version.to_owned());
            }
        } else if let Some(version) = message.strip_prefix("Content Version:") {
            let version = version.trim();
            if !version.is_empty() {
                self.facts
                    .content_version
                    .get_or_insert_with(|| version.to_owned());
            }
        }
    }

    fn note_flow(&mut self, record: &Record<'_>) {
        match record.message {
            "Loading Ended" => {
                self.loading_ended_at.get_or_insert(record.time);
            }
            "Destroying the renderer" | "r3dRenderLayer::Close() exit" => {
                self.renderer_closed = true;
            }
            _ => {}
        }
    }

    /// Records every code on the line, and says whether there was one.
    fn note_codes(&mut self, record: &Record<'_>, line: &str) -> bool {
        let mut redacted: Option<String> = None;
        let mut coded = false;
        for code in log_codes::find_codes(record.message) {
            coded = true;
            let line = redacted
                .get_or_insert_with(|| redact_line(line).into_owned())
                .clone();
            let sighting = CodeSighting {
                code: code.to_owned(),
                at: record.time,
                line,
            };
            let kind = log_codes::lookup(code).map(|row| row.kind);
            let is_load_step = match kind {
                Some(kind) => matches!(kind, CodeKind::LoadStep(_)),
                None => record.channel == Some("LOAD"),
            };
            if is_load_step {
                self.facts.last_load_step = Some(sighting.clone());
            }
            if kind == Some(CodeKind::Teardown) {
                self.teardown_code = true;
            }
            if self.sightings.len() == MAX_SIGHTINGS {
                self.sightings.pop_front();
            }
            self.sightings.push_back(sighting);
        }
        coded
    }

    fn keep(&mut self, index: u32, line: &str, coded: bool) {
        if coded {
            let before: Vec<(u32, String)> = self
                .recent
                .iter()
                .rev()
                .take(CONTEXT_LINES)
                .map(|(index, line)| (*index, line.clone()))
                .collect();
            for (index, line) in before {
                self.remember(index, line);
            }
            self.context_due = CONTEXT_LINES + 1;
        }
        if self.context_due > 0 {
            self.context_due -= 1;
            self.remember(index, line.to_owned());
        }
        if self.recent.len() == TAIL_LINES {
            self.recent.pop_front();
        }
        self.recent.push_back((index, line.to_owned()));
    }

    /// Keeps a context line, and lets the oldest go once the context alone
    /// would overflow the excerpt.
    fn remember(&mut self, index: u32, line: String) {
        if self.context.contains_key(&index) {
            return;
        }
        self.context_bytes += line.len();
        self.context.insert(index, line);
        while self.context_bytes > EXCERPT_BYTES {
            let Some((_, oldest)) = self.context.pop_first() else {
                break;
            };
            self.context_bytes -= oldest.len();
        }
    }

    fn finish(mut self) -> GameLogFacts {
        let mut lines: BTreeMap<u32, (String, bool)> = std::mem::take(&mut self.context)
            .into_iter()
            .map(|(index, line)| (index, (line, true)))
            .collect();
        for (index, line) in self.recent.drain(..) {
            lines.entry(index).or_insert((line, false));
        }
        let excerpt = lines
            .into_values()
            .map(|(line, from_context)| (redact_line(&line).into_owned(), from_context))
            .collect();

        let mut facts = self.facts;
        facts.excerpt = Self::within_budget(excerpt);
        facts.codes = self.sightings.into();
        facts.loading_ended = self.loading_ended_at.is_some();
        facts.reached_game_loop = self.loading_ended_at.is_some_and(|at| facts.last_time > at);
        facts.torn_down = self.teardown_code && self.renderer_closed;
        facts
    }

    /// Trims the excerpt to its cap. Tail-only lines go first, oldest first,
    /// and context lines only after every one of those is gone.
    fn within_budget(mut lines: Vec<(String, bool)>) -> Vec<String> {
        let mut bytes: usize = lines.iter().map(|(line, _)| line.len()).sum();
        lines.retain(|(line, from_context)| {
            let drop = bytes > EXCERPT_BYTES && !from_context;
            if drop {
                bytes -= line.len();
            }
            !drop
        });
        lines.retain(|(line, _)| {
            let drop = bytes > EXCERPT_BYTES;
            if drop {
                bytes -= line.len();
            }
            !drop
        });
        lines.into_iter().map(|(line, _)| line).collect()
    }
}

/// The window one game occupied, in local time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GameWindow {
    /// The host's `game found`, or the session's report that League is up.
    pub first_sign: DateTime<Local>,
    /// The host's `exited`, its return to scanning, or `session-ended`.
    pub last_sign: DateTime<Local>,
}

/// The `Logs` directory of a League install, which the manager reads and never
/// writes into.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LeagueLogs {
    root: PathBuf,
}

impl LeagueLogs {
    /// `league_path` is the install root, the directory that holds `Game`.
    pub fn new(league_path: &Path) -> Self {
        Self {
            root: league_path.join("Logs"),
        }
    }

    /// The `r3dlog` of the game that ran in `window`, or `None` when no
    /// directory's stamp falls in it or the one that does fails to confirm.
    pub fn find_game_log(&self, window: &GameWindow) -> Option<PathBuf> {
        let game_logs = self.root.join("GameLogs");
        let earliest = window.first_sign - TimeDelta::seconds(STAMP_LEAD_SECS);
        let mut newest: Option<(DateTime<Local>, String)> = None;
        for entry in fs::read_dir(&game_logs).ok()?.flatten() {
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            let Some(stamp) = Self::parse_stamp(name) else {
                continue;
            };
            if stamp < earliest || stamp > window.last_sign {
                continue;
            }
            if newest.as_ref().is_none_or(|(best, _)| stamp > *best) {
                newest = Some((stamp, name.to_owned()));
            }
        }
        let (stamp, name) = newest?;
        let path = game_logs.join(&name).join(format!("{name}_r3dlog.txt"));
        Self::header_agrees(&path, stamp.naive_local()).then_some(path)
    }

    /// A directory name, `YYYY-MM-DDTHH-MM-SS` in local time, as a moment.
    fn parse_stamp(name: &str) -> Option<DateTime<Local>> {
        NaiveDateTime::parse_from_str(name, "%Y-%m-%dT%H-%M-%S")
            .ok()?
            .and_local_timezone(Local)
            .earliest()
    }

    /// Whether the first line's `Logging started at` clock is within a minute
    /// of `stamp`. A wrong file is worse than none.
    fn header_agrees(path: &Path, stamp: NaiveDateTime) -> bool {
        let Ok(file) = File::open(path) else {
            return false;
        };
        let mut first = String::new();
        if BufReader::new(file)
            .take(512)
            .read_line(&mut first)
            .is_err()
        {
            return false;
        }
        let Some(record) = Record::parse(first.trim_end()) else {
            return false;
        };
        let Some(started) = record.message.strip_prefix(STARTED_AT_PREFIX) else {
            return false;
        };
        let Ok(started) = NaiveDateTime::parse_from_str(started.trim(), "%Y-%m-%dT%H:%M:%S%.f")
        else {
            return false;
        };
        (started - stamp).abs() < TimeDelta::minutes(1)
    }

    /// When crashpad last ran, from `GameCrashes/last_crash`.
    ///
    /// Nothing else in that directory is opened. The event beside the marker
    /// names the account.
    pub fn last_crash(&self) -> Option<DateTime<Utc>> {
        let file = File::open(self.root.join("GameCrashes").join("last_crash")).ok()?;
        let mut text = String::new();
        file.take(128).read_to_string(&mut text).ok()?;
        let stamp = text.lines().next()?.trim();
        DateTime::parse_from_rfc3339(stamp)
            .ok()
            .map(|at| at.with_timezone(&Utc))
    }

    /// Reads the log at `path`, retrying for a few seconds while the game still
    /// holds it open.
    ///
    /// # Errors
    ///
    /// The file could not be opened or read after the retries.
    pub fn read_game_log(&self, path: &Path) -> std::io::Result<GameLogFacts> {
        Self::read_game_log_within(path, READ_RETRY_BUDGET)
    }

    fn read_game_log_within(path: &Path, budget: Duration) -> io::Result<GameLogFacts> {
        let deadline = Instant::now() + budget;
        loop {
            match File::open(path).and_then(|file| GameLogFacts::read(BufReader::new(file))) {
                Ok(facts) => return Ok(facts),
                Err(err) => {
                    let now = Instant::now();
                    if now >= deadline {
                        return Err(err);
                    }
                    thread::sleep(READ_RETRY_PAUSE.min(deadline - now));
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use chrono::TimeZone;

    use super::*;

    const CLEAN: &str = include_str!("fixtures/clean_game_r3dlog.txt");
    const CRASH_TRUNCATED: &[u8] = include_bytes!("fixtures/crash_truncated_r3dlog.bin");
    const DEVICE_ERROR: &str = include_str!("fixtures/device_error_r3dlog.txt");
    const MISSING_DATA: &str = include_str!("fixtures/missing_data_r3dlog.txt");
    const STUCK_LOADING: &str = include_str!("fixtures/stuck_loading_r3dlog.txt");

    fn read(text: &str) -> GameLogFacts {
        GameLogFacts::read(Cursor::new(text)).expect("the fixture reads")
    }

    fn codes(facts: &GameLogFacts) -> Vec<&str> {
        facts.codes.iter().map(|s| s.code.as_str()).collect()
    }

    #[test]
    fn a_clean_game_reads_its_facts() {
        let facts = read(CLEAN);
        assert_eq!(facts.started_at.as_deref(), Some("2026-08-17T07:26:15.487"));
        assert_eq!(facts.build_version.as_deref(), Some("16.16.804.9184"));
        assert_eq!(
            facts.content_version.as_deref(),
            Some("16.16.8049184+branch.releases-16-16.content.release")
        );
        assert_eq!(
            facts.game_base_dir.as_deref(),
            Some(r"C:\Riot Games\League of Legends")
        );
        assert_eq!(facts.crash_reporting, Some(false));
        assert!(facts.loading_ended);
        assert!(facts.reached_game_loop);
        assert!(facts.torn_down);
        assert_eq!(facts.error_lines, 1);
        assert_eq!(facts.total_lines, 173);
        assert!((facts.last_time - 8.543).abs() < 1e-9);
    }

    #[test]
    fn a_clean_game_keeps_every_code_in_order() {
        let facts = read(CLEAN);
        let seen = codes(&facts);
        assert_eq!(seen.len(), 20);
        assert_eq!(seen[0], "SEJ-1A4F7C20");
        assert_eq!(seen[12], "SEJ-5F4B27D8");
        assert_eq!(seen[19], "ALE-8SDFH23F");
        assert!(facts.codes.windows(2).all(|pair| pair[0].at <= pair[1].at));

        let step = facts.last_load_step.expect("a last load step");
        assert_eq!(step.code, "SEJ-5F4B27D8");
        assert_eq!(
            log_codes::lookup(&step.code).map(|row| row.kind),
            Some(CodeKind::LoadStep(63))
        );
        assert_eq!(step.line, "000004.111| ALWAYS|  LOAD| SEJ-5F4B27D8");
    }

    #[test]
    fn the_excerpt_is_bounded_and_ends_with_the_last_line() {
        let facts = read(CLEAN);
        let bytes: usize = facts.excerpt.iter().map(String::len).sum();
        assert!(bytes < EXCERPT_BYTES, "{bytes} bytes");
        assert_eq!(
            facts.excerpt.last().map(String::as_str),
            Some("000008.543| ALWAYS| r3dRenderLayer::Close() exit")
        );
        assert!(facts.excerpt.len() >= TAIL_LINES);
        assert!(
            facts
                .excerpt
                .iter()
                .any(|line| line.ends_with("LoadGlobalEffects")),
            "the lines before the first LOAD marker are context"
        );
        assert!(
            facts
                .excerpt
                .iter()
                .any(|line| line.ends_with("Loading Ended")),
            "the lines after the last LOAD marker are context"
        );
        assert!(
            !facts.excerpt.iter().any(|line| line.contains("Init enter")),
            "a line far from any code and outside the tail is not kept"
        );
    }

    #[test]
    fn a_log_a_crash_cut_short_reads_without_panic() {
        let facts = GameLogFacts::read(Cursor::new(CRASH_TRUNCATED)).expect("the fixture reads");
        assert_eq!(facts.started_at.as_deref(), Some("2026-06-23T13:23:08.419"));
        assert_eq!(facts.total_lines, 3);
        assert_eq!(facts.crash_reporting, Some(true));
        assert!(!facts.torn_down);
        assert!(!facts.loading_ended);
        assert!(facts.codes.is_empty());
        assert_eq!(facts.excerpt.len(), 3);
        assert!(
            facts.excerpt.iter().all(|line| !line.contains('\0')),
            "no NUL byte reaches the excerpt"
        );
        assert_eq!(
            facts.excerpt[2],
            r#"000000.148| ALWAYS|   CFG| Command Line: "-GameBaseDir=C:\Riot Games\League of Legends" "-EnableCrashpad=true""#
        );
    }

    #[test]
    fn missing_data_is_sighted_with_the_step_that_ran() {
        let facts = read(MISSING_DATA);
        assert_eq!(codes(&facts).last(), Some(&"ALE-9B39AA45"));
        let step = facts.last_load_step.expect("a last load step");
        assert_eq!(step.code, "SEJ-9F31B5D0");
        assert_eq!(
            log_codes::lookup(&step.code).map(|row| row.kind),
            Some(CodeKind::LoadStep(52))
        );
        assert!(!facts.loading_ended);
        assert!(!facts.reached_game_loop);
        assert!(!facts.torn_down);
        assert_eq!(facts.error_lines, 1);
        assert_eq!(facts.crash_reporting, Some(true));
        let fatal = facts.codes.last().expect("the fatal sighting");
        assert!(fatal.line.ends_with("Missing data: 0x1a2b3c4d5e6f7081"));
        assert!((fatal.at - 12.344).abs() < 1e-9);
    }

    #[test]
    fn stuck_loading_stops_at_the_last_marker() {
        let facts = read(STUCK_LOADING);
        let step = facts.last_load_step.expect("a last load step");
        assert_eq!(step.code, "SEJ-9F31B5D0");
        assert!(!facts.loading_ended);
        assert!(!facts.reached_game_loop);
        assert!(!facts.torn_down);
        assert_eq!(facts.error_lines, 0);
        assert_eq!(facts.crash_reporting, Some(false));
        assert!((facts.last_time - 3.664).abs() < 1e-9);
    }

    #[test]
    fn a_device_error_is_sighted_each_time() {
        let facts = read(DEVICE_ERROR);
        let device: Vec<_> = facts
            .codes
            .iter()
            .filter(|s| s.code == "ALE-D0D00009")
            .collect();
        assert_eq!(device.len(), 4);
        assert_eq!(facts.error_lines, 4);
        assert!(facts.loading_ended);
        assert!(facts.reached_game_loop);
        assert!(!facts.torn_down);
        assert_eq!(facts.crash_reporting, Some(false));
        assert_eq!(
            device[0].line,
            r#"000056.778|  ERROR| Error: "ALE-D0D00009" - Result: DXGI_ERROR_INVALID_CALL."#
        );
    }

    #[test]
    fn the_command_line_keeps_only_the_base_dir_and_crashpad() {
        let line = r#"000000.173| ALWAYS|   CFG| Command Line:  "10.20.30.40 7058 QUJDRA== 12345678" "-Product=LoL" "-PlayerID=12345678" "-GameID=1234567890" "-LNPBlob=QUJD" "-GameBaseDir=C:\Riot Games\League of Legends" "-Region=EUW" "-EnableCrashpad=true" "-DisableCrashUploading" "-RiotClientPort=49925" "-RiotClientAuthToken=abcDEF" "#;
        assert_eq!(
            redact_line(line),
            r#"000000.173| ALWAYS|   CFG| Command Line: "-GameBaseDir=C:\Riot Games\League of Legends" "-EnableCrashpad=true" "-DisableCrashUploading""#
        );

        let bare = "000000.173| ALWAYS|   CFG| Command Line:  \"10.20.30.40 7058 QUJDRA== 12345678\" \"-PlayerID=12345678\"";
        assert_eq!(
            redact_line(bare),
            "000000.173| ALWAYS|   CFG| Command Line:"
        );
    }

    #[test]
    fn private_fields_are_redacted_wherever_they_repeat() {
        let cases = [
            (
                "000001.663| ALWAYS| GameStartData::GameID=1234567890",
                "000001.663| ALWAYS| GameStartData::GameID=<redacted>",
            ),
            (
                "000001.664| ALWAYS|  CONN| Starting Multiplayer Session: PlayerClient GameID(1234567890) ServerAddress(10.20.30.40:7058) SummonerID(12345678)",
                "000001.664| ALWAYS|  CONN| Starting Multiplayer Session: PlayerClient GameID(<redacted>) ServerAddress(<redacted>:7058) SummonerID(<redacted>)",
            ),
            (
                "000001.664| ALWAYS|  CONN| Connecting to address (10.20.30.40) port (7058)",
                "000001.664| ALWAYS|  CONN| Connecting to address (<redacted>) port (7058)",
            ),
            (
                "000000.632| ALWAYS| LCURemotingClient: Initializing on port 49925",
                "000000.632| ALWAYS| LCURemotingClient: Initializing on port <redacted>",
            ),
            (
                r"000000.200| ALWAYS| Replay: C:\Replays\EUW1-7939624995.rofl",
                r"000000.200| ALWAYS| Replay: C:\Replays\EUW1-<redacted>.rofl",
            ),
            (
                "000001.861| ALWAYS|  ROST| CONNECTION READY | TeamOrder 0) 'Someone#EUW' **LOCAL** - Champion(Aatrox) PUUID(b8482d4d-3590-5b21-81fa-4c87306b2a54)",
                "000001.861| ALWAYS|  ROST| CONNECTION READY | TeamOrder 0) '<redacted>' **LOCAL** - Champion(Aatrox) PUUID(<redacted>)",
            ),
            (
                "000000.001| ALWAYS| RiotClientAuthToken=E-tb5OWD6TzjkT7jjQJecg LNPBlob=S6StbDjMbK4= RiotClientPort=49925",
                "000000.001| ALWAYS| RiotClientAuthToken=<redacted> LNPBlob=<redacted> RiotClientPort=<redacted>",
            ),
        ];
        for (line, expected) in cases {
            assert_eq!(redact_line(line), expected);
        }
    }

    #[test]
    fn a_line_with_nothing_private_is_borrowed() {
        let lines = [
            "000000.558| ALWAYS|   CFG| Build Version: Version 16.16.804.9184 (Aug 10 2026/16:10:32) [PUBLIC] <Releases/16.16> ChangeList: 8049184",
            "000000.568| ALWAYS|   CFG| Content Version: 16.16.8049184+branch.releases-16-16.content.release",
            "000003.691| ALWAYS|  LOAD| SEJ-1A4F7C20",
            "000000.659| ALWAYS| Detected Adapter 'NVIDIA GeForce RTX 4070 SUPER'",
        ];
        for line in lines {
            assert!(
                matches!(redact_line(line), Cow::Borrowed(same) if same == line),
                "{line}"
            );
        }
    }

    #[test]
    fn nothing_private_survives_into_the_record() {
        // Short enough that the whole file is the tail, so every private line
        // of the header reaches the excerpt.
        let facts = read(MISSING_DATA);
        assert_eq!(facts.excerpt.len(), 27);
        let kept: Vec<&str> = facts
            .excerpt
            .iter()
            .map(String::as_str)
            .chain(facts.codes.iter().map(|s| s.line.as_str()))
            .chain(facts.last_load_step.iter().map(|s| s.line.as_str()))
            .collect();
        for line in &kept {
            assert!(!line.contains("0.0.0.0"), "{line}");
            assert!(!line.contains("AAAA"), "{line}");
            assert!(!line.contains("PlayerID=0"), "{line}");
            assert!(!line.contains("GameID=0"), "{line}");
            assert!(!line.contains("GameID(0)"), "{line}");
            assert!(!line.contains("SummonerID(0)"), "{line}");
            assert!(!line.contains("port 0"), "{line}");
        }
        assert!(kept.iter().any(|line| {
            line.ends_with(
                r#"Command Line: "-GameBaseDir=C:\Riot Games\League of Legends" "-EnableCrashpad=true""#,
            )
        }));
        assert!(
            kept.iter()
                .any(|line| line.ends_with("GameStartData::GameID=<redacted>"))
        );
        assert!(
            kept.iter()
                .any(|line| line.ends_with("Connecting to address (<redacted>) port (0)"))
        );

        let clean = read(CLEAN);
        let roster = clean
            .excerpt
            .iter()
            .chain(clean.codes.iter().map(|s| &s.line))
            .find(|line| line.contains("ROST"));
        assert_eq!(
            roster, None,
            "the roster line is far from any code and the tail"
        );
    }

    #[test]
    fn crash_reporting_follows_the_switches() {
        let read_switches = |switches: &str| {
            let log = format!(
                "000000.000| ALWAYS| Logging started at 2026-08-17T07:26:15.487\n000000.173| ALWAYS|   CFG| Command Line:  {switches}\n"
            );
            read(&log).crash_reporting
        };
        assert_eq!(read_switches(r#""-EnableCrashpad=true""#), Some(true));
        assert_eq!(read_switches(r#""-EnableCrashpad""#), Some(true));
        assert_eq!(
            read_switches(r#""-EnableCrashpad=true" "-DisableCrashUploading""#),
            Some(false)
        );
        assert_eq!(read_switches(r#""-EnableCrashpad=false""#), Some(false));
        assert_eq!(read_switches(r#""-Product=LoL""#), Some(false));
        assert_eq!(
            read_switches("-EnableCrashpad=true -Product=LoL"),
            Some(true)
        );
        assert_eq!(
            read("000000.000| ALWAYS| Logging started at 2026-08-17T07:26:15.487\n")
                .crash_reporting,
            None
        );
    }

    #[test]
    fn garbage_reads_as_an_empty_record() {
        for garbage in ["", "\0\0\0\0", "not a log\nat all\n", "|||\n1e5| X| y\n"] {
            let facts = read(garbage);
            assert_eq!(facts, GameLogFacts::default(), "{garbage:?}");
        }
        let torn = "000000.000| ALWAYS| Logging started at 2026-08-17T07:26:15.487\r\n000012.3";
        let facts = read(torn);
        assert_eq!(facts.total_lines, 1);
    }

    fn at(h: u32, m: u32, s: u32) -> DateTime<Local> {
        Local
            .with_ymd_and_hms(2026, 8, 17, h, m, s)
            .single()
            .expect("an unambiguous local time")
    }

    fn stamp_dir(root: &Path, stamp: DateTime<Local>, header_at: DateTime<Local>) -> PathBuf {
        let name = stamp.format("%Y-%m-%dT%H-%M-%S").to_string();
        let dir = root.join("Logs").join("GameLogs").join(&name);
        fs::create_dir_all(&dir).expect("the fixture directory");
        let path = dir.join(format!("{name}_r3dlog.txt"));
        fs::write(
            &path,
            format!(
                "000000.000| ALWAYS| Logging started at {}\r\n000000.001| ALWAYS|   CFG| CrashHandler(Sentry)\r\n",
                header_at.format("%Y-%m-%dT%H:%M:%S%.3f")
            ),
        )
        .expect("the fixture log");
        path
    }

    #[test]
    fn the_newest_directory_in_the_window_is_picked() {
        let tmp = tempfile::tempdir().expect("a temp dir");
        let window = GameWindow {
            first_sign: at(7, 26, 30),
            last_sign: at(7, 35, 0),
        };
        stamp_dir(tmp.path(), at(7, 20, 0), at(7, 20, 0));
        let older = stamp_dir(tmp.path(), at(7, 25, 40), at(7, 25, 40));
        let expected = stamp_dir(tmp.path(), at(7, 26, 15), at(7, 26, 15));
        stamp_dir(tmp.path(), at(7, 45, 0), at(7, 45, 0));
        fs::create_dir_all(tmp.path().join("Logs/GameLogs/not-a-stamp")).expect("a stray dir");

        let logs = LeagueLogs::new(tmp.path());
        let found = logs.find_game_log(&window);
        assert_eq!(found.as_deref(), Some(expected.as_path()));
        assert_ne!(found.as_deref(), Some(older.as_path()));
    }

    #[test]
    fn a_stamp_whose_header_disagrees_is_refused() {
        let tmp = tempfile::tempdir().expect("a temp dir");
        let window = GameWindow {
            first_sign: at(7, 26, 30),
            last_sign: at(7, 35, 0),
        };
        stamp_dir(tmp.path(), at(7, 26, 15), at(9, 0, 0));
        let logs = LeagueLogs::new(tmp.path());
        assert_eq!(logs.find_game_log(&window), None);
    }

    #[test]
    fn a_stamp_with_no_log_inside_is_refused() {
        let tmp = tempfile::tempdir().expect("a temp dir");
        let window = GameWindow {
            first_sign: at(7, 26, 30),
            last_sign: at(7, 35, 0),
        };
        fs::create_dir_all(tmp.path().join("Logs/GameLogs/2026-08-17T07-26-15"))
            .expect("an empty stamp dir");
        let logs = LeagueLogs::new(tmp.path());
        assert_eq!(logs.find_game_log(&window), None);
    }

    #[test]
    fn no_game_logs_directory_is_no_log() {
        let tmp = tempfile::tempdir().expect("a temp dir");
        let window = GameWindow {
            first_sign: at(7, 26, 30),
            last_sign: at(7, 35, 0),
        };
        let logs = LeagueLogs::new(tmp.path());
        assert_eq!(logs.find_game_log(&window), None);
        assert_eq!(logs.last_crash(), None);
    }

    #[test]
    fn last_crash_reads_the_marker_and_nothing_else() {
        let tmp = tempfile::tempdir().expect("a temp dir");
        let crashes = tmp.path().join("Logs/GameCrashes");
        fs::create_dir_all(&crashes).expect("the crash dir");
        let logs = LeagueLogs::new(tmp.path());

        fs::write(crashes.join("last_crash"), "2026-03-13T15:20:23.400Z\n").expect("the marker");
        let expected = Utc
            .with_ymd_and_hms(2026, 3, 13, 15, 20, 23)
            .single()
            .expect("a UTC time")
            + TimeDelta::milliseconds(400);
        assert_eq!(logs.last_crash(), Some(expected));

        fs::write(crashes.join("last_crash"), "yesterday, probably").expect("the marker");
        assert_eq!(logs.last_crash(), None);

        fs::write(crashes.join("last_crash"), "").expect("the marker");
        assert_eq!(logs.last_crash(), None);
    }

    #[test]
    fn reading_a_file_on_disk_gives_the_same_facts() {
        let tmp = tempfile::tempdir().expect("a temp dir");
        let path = tmp.path().join("clean_r3dlog.txt");
        fs::write(&path, CLEAN).expect("the log");
        let logs = LeagueLogs::new(tmp.path());
        assert_eq!(logs.read_game_log(&path).expect("reads"), read(CLEAN));
    }

    #[test]
    fn a_missing_file_is_an_error_after_the_retries() {
        let tmp = tempfile::tempdir().expect("a temp dir");
        let path = tmp.path().join("gone_r3dlog.txt");
        let err = LeagueLogs::read_game_log_within(&path, Duration::from_millis(20))
            .expect_err("a missing file");
        assert_eq!(err.kind(), io::ErrorKind::NotFound);
    }

    #[test]
    fn reading_a_short_game_is_cheap() {
        let started = Instant::now();
        for _ in 0..100 {
            let facts = read(CLEAN);
            assert_eq!(facts.total_lines, 173);
        }
        let elapsed = started.elapsed();
        assert!(
            elapsed < Duration::from_secs(1),
            "{elapsed:?} for 100 reads"
        );
    }
}
