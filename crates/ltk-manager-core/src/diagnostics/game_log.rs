//! The game log reader: one `r3dlog` in, a small record out.
//!
//! League writes `Logs/GameLogs/<stamp>/<stamp>_r3dlog.txt` for every game,
//! named for the moment it started in local time. The reader keeps the facts a
//! verdict reports and a bounded excerpt, and never keeps the file. Nothing in
//! here knows about the patcher, a mod, or Tauri.

use fs_err::{self as fs, File};
use std::borrow::Cow;
use std::collections::{BTreeMap, VecDeque};
use std::io::{self, BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::thread;
use std::time::{Duration, Instant};

use chrono::{DateTime, Local, NaiveDateTime, TimeDelta, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};

use super::log_codes::{self, CodeKind};
use crate::utils::path::slashed;

/// The tail of the log the excerpt always keeps.
const TAIL_LINES: usize = 40;

/// Lines kept on each side of a coded line.
const CONTEXT_LINES: usize = 5;

/// The excerpt's size cap, which is what the incident budget allows for a game.
const EXCERPT_BYTES: usize = 16 * 1024;

/// Sightings kept before the oldest go. A graphics fault can write a code on
/// every frame, and the last sightings are the ones a verdict reads.
const MAX_SIGHTINGS: usize = 256;

/// Detail lines one sighting keeps. League's multi-line errors run to three.
const DETAIL_LINES: usize = 16;

/// Message sightings kept before the oldest go. A failed shader is logged again
/// for every pass and define set that asks for it.
const MAX_MESSAGES: usize = 64;

const SHADER_COMPILE_FAILED: &str = "Failed to compile shader.";
const MISSING_PIPELINE_PREFIX: &str = "Material Missing Pipeline:";

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
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct CodeSighting {
    pub code: String,
    /// Seconds into the log.
    pub at: f64,
    /// The whole record, redacted.
    pub line: String,
    /// The lines under the record with no columns of their own, in order and
    /// redacted like it.
    pub detail: Vec<String>,
}

impl CodeSighting {
    /// The value of the `Key: value` detail line named `key`, matched without
    /// regard to case, or `None` when no detail line carries it.
    pub fn detail_value(&self, key: &str) -> Option<&str> {
        detail_value(&self.detail, key)
    }
}

/// A record League writes with no code, which the reader knows by its words.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "kebab-case")]
pub enum LogMessage {
    /// `Failed to compile shader.`, with the programs and the defines on the
    /// lines under it.
    ShaderCompileFailed,
    /// `Material Missing Pipeline: <hash>`, a material drawn with no pipeline.
    MissingPipeline,
}

impl LogMessage {
    /// The message a record's message column is, or `None` for one the reader
    /// does not know.
    fn of(text: &str) -> Option<Self> {
        if text == SHADER_COMPILE_FAILED {
            Some(Self::ShaderCompileFailed)
        } else if text.starts_with(MISSING_PIPELINE_PREFIX) {
            Some(Self::MissingPipeline)
        } else {
            None
        }
    }
}

/// One record League wrote with no code, with where and when.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct MessageSighting {
    pub message: LogMessage,
    /// Seconds into the log.
    pub at: f64,
    /// The whole record, redacted.
    pub line: String,
    /// The lines under the record, in order and redacted like it.
    pub detail: Vec<String>,
}

impl MessageSighting {
    /// The value of the `Key: value` detail line named `key`, matched without
    /// regard to case, or `None` when no detail line carries it.
    pub fn detail_value(&self, key: &str) -> Option<&str> {
        detail_value(&self.detail, key)
    }

    /// The text after `Material Missing Pipeline:`, or `None` on any other message.
    pub fn missing_pipeline(&self) -> Option<&str> {
        let record = Record::parse(&self.line)?;
        let pipeline = record.message.strip_prefix(MISSING_PIPELINE_PREFIX)?.trim();
        (!pipeline.is_empty()).then_some(pipeline)
    }
}

fn detail_value<'a>(detail: &'a [String], key: &str) -> Option<&'a str> {
    detail.iter().find_map(|line| {
        let (found, value) = line.trim().trim_start_matches(['-', ' ']).split_once(':')?;
        found.trim().eq_ignore_ascii_case(key).then(|| value.trim())
    })
}

/// What one game's log says, without the log.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
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
    /// Every uncoded record the reader knows, in order, with its time.
    #[serde(default)]
    pub messages: Vec<MessageSighting>,
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
    /// The last forty lines, and ten around each coded line, with a record's
    /// detail lines under it.
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
    /// `None` for anything that is not a record: a detail line under one, NUL
    /// padding, or a line a crash tore.
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
                parsed.game_base_dir = Some(slashed(dir));
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
    /// The excerpt's key for the next line, records and detail lines alike.
    line_index: u32,
    /// The sightings of the record last read, each with whether it is a load
    /// step, open for detail lines until the next record.
    pending: Vec<(CodeSighting, bool)>,
    messages: VecDeque<MessageSighting>,
    /// The message of the record last read, open for detail lines like
    /// `pending`.
    pending_message: Option<MessageSighting>,
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
            self.take_line(text.trim_end_matches(['\n', '\r', '\0']));
        }
        Ok(self.finish())
    }

    fn take_line(&mut self, line: &str) {
        match Record::parse(line) {
            Some(record) => self.record(&record, line),
            None => self.note_continuation(line),
        }
    }

    fn record(&mut self, record: &Record<'_>, line: &str) {
        self.flush_pending();
        let index = self.next_index();
        self.facts.total_lines += 1;
        self.facts.last_time = record.time;
        if record.level == "ERROR" {
            self.facts.error_lines += 1;
        }
        self.note_header(record);
        self.note_flow(record);

        let coded = self.note_codes(record, line);
        let known = self.note_message(record, line);
        self.keep(index, line, coded || known);
    }

    /// A line under a record with no columns of its own, which is the record's
    /// detail. A line that opens with a digit is a record or the torn remains
    /// of one, and NUL padding is nothing.
    fn note_continuation(&mut self, line: &str) {
        let text = line.trim();
        if text.is_empty()
            || text.starts_with(|c: char| c.is_ascii_digit())
            || self.facts.total_lines == 0
        {
            return;
        }
        let index = self.next_index();
        if self.pending.is_empty() && self.pending_message.is_none() {
            self.keep(index, line, false);
            return;
        }

        let redacted = redact_line(line);
        let details = self
            .pending
            .iter_mut()
            .map(|(sighting, _)| &mut sighting.detail)
            .chain(
                self.pending_message
                    .as_mut()
                    .map(|message| &mut message.detail),
            );
        for detail in details {
            if detail.len() < DETAIL_LINES {
                detail.push(redacted.to_string());
            }
        }
        self.remember(index, line.to_owned());
        self.keep_recent(index, line);
    }

    /// Closes the record last read: its sightings join the deque, and a load
    /// step among them is the last one seen.
    fn flush_pending(&mut self) {
        for (sighting, is_load_step) in self.pending.drain(..) {
            if is_load_step {
                self.facts.last_load_step = Some(sighting.clone());
            }
            if self.sightings.len() == MAX_SIGHTINGS {
                self.sightings.pop_front();
            }
            self.sightings.push_back(sighting);
        }

        if let Some(message) = self.pending_message.take() {
            if self.messages.len() == MAX_MESSAGES {
                self.messages.pop_front();
            }
            self.messages.push_back(message);
        }
    }

    fn next_index(&mut self) -> u32 {
        let index = self.line_index;
        self.line_index += 1;
        index
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

    /// Opens the line's codes as the pending record, and says whether there
    /// was one.
    fn note_codes(&mut self, record: &Record<'_>, line: &str) -> bool {
        let mut redacted: Option<String> = None;
        for code in log_codes::find_codes(record.message) {
            let line = redacted
                .get_or_insert_with(|| redact_line(line).into_owned())
                .clone();
            let kind = log_codes::lookup(code).map(|row| row.kind);
            let is_load_step = match kind {
                Some(kind) => matches!(kind, CodeKind::LoadStep(_)),
                None => record.channel == Some("LOAD"),
            };
            if kind == Some(CodeKind::Teardown) {
                self.teardown_code = true;
            }
            self.pending.push((
                CodeSighting {
                    code: code.to_owned(),
                    at: record.time,
                    line,
                    detail: Vec::new(),
                },
                is_load_step,
            ));
        }
        !self.pending.is_empty()
    }

    /// Opens the line as the pending message when it is an uncoded record the
    /// reader knows, and says whether it was.
    fn note_message(&mut self, record: &Record<'_>, line: &str) -> bool {
        let Some(message) = LogMessage::of(record.message) else {
            return false;
        };
        self.pending_message = Some(MessageSighting {
            message,
            at: record.time,
            line: redact_line(line).into_owned(),
            detail: Vec::new(),
        });
        true
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
        self.keep_recent(index, line);
    }

    /// Keeps a line in the tail, and lets the oldest go.
    fn keep_recent(&mut self, index: u32, line: &str) {
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
        self.flush_pending();
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
        facts.messages = self.messages.into();
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
mod tests;
