//! Redaction of private values from text that reaches the log file or leaves the machine.
//!
//! A [`Redactor`] replaces known values first and pattern matches second. A known value is a
//! string that the process holds, such as the profile directory, so it is matched exactly. A
//! pattern matches text that has the form of a private value, such as a URL query.
//!
//! [`redact`] applies the redactor that the whole process shares. [`register_path`] and
//! [`register_value`] add a known value to it when the process reads one.

use std::borrow::Cow;
use std::path::Path;
use std::sync::{LazyLock, RwLock};

mod patterns;

#[cfg(test)]
mod tests;

/// The version of the rules. A change to a rule that replaces more text raises it.
pub const RULESET_VERSION: u32 = 1;

/// The shortest bare value that is replaced outside a path. A shorter value matches inside
/// ordinary words.
const MIN_BARE_VALUE_CHARS: usize = 4;

/// The text that replaces a known value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Placeholder {
    /// The profile directory.
    Profile,
    /// The username.
    User,
    /// The computer name.
    Machine,
    /// The League install path.
    League,
    /// The mod storage path.
    Data,
    /// The workshop path or a project path.
    Workshop,
    /// A secret or a token.
    Secret,
    /// The delivery install id.
    Install,
    /// The RuneForge username or user id.
    RuneforgeUser,
}

impl Placeholder {
    fn name(self) -> &'static str {
        match self {
            Self::Profile => "USERPROFILE",
            Self::User => "user",
            Self::Machine => "machine",
            Self::League => "league",
            Self::Data => "data",
            Self::Workshop => "workshop",
            Self::Secret => "secret",
            Self::Install => "install",
            Self::RuneforgeUser => "runeforge-user",
        }
    }

    /// Returns the replacement text. `non_ascii` adds the mark for a replaced path that holds
    /// a character outside ASCII.
    fn text(self, non_ascii: bool) -> String {
        let mark = if non_ascii { ":non-ascii" } else { "" };
        match self {
            Self::Profile => format!("%{}{mark}%", self.name()),
            _ => format!("<{}{mark}>", self.name()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Known {
    /// The value in folded form.
    needle: String,
    replacement: String,
    /// Whether the character before a match must also be a boundary. A path sets `false`.
    bare: bool,
}

/// Replaces private values in text.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Redactor {
    /// The known values, longest needle first.
    known: Vec<Known>,
}

impl Redactor {
    /// Returns a redactor with no known value.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns a redactor that knows the profile directory, the username and the computer
    /// name of the running process.
    #[must_use]
    pub fn from_env() -> Self {
        let mut redactor = Self::new();
        let profile_dir = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .ok();
        if let Some(dir) = &profile_dir {
            redactor.register_path(Placeholder::Profile, dir);
        }
        let username = std::env::var("USERNAME")
            .or_else(|_| std::env::var("USER"))
            .ok()
            .or_else(|| {
                let dir = profile_dir.as_deref()?.trim_end_matches(['/', '\\']);
                dir.rsplit(['/', '\\']).next().map(str::to_owned)
            });
        if let Some(username) = username {
            redactor.register_value(Placeholder::User, &username);
        }
        if let Ok(machine) = std::env::var("COMPUTERNAME") {
            redactor.register_value(Placeholder::Machine, &machine);
        }
        redactor
    }

    /// Returns whether the redactor has no known value.
    #[must_use]
    pub fn has_no_known_value(&self) -> bool {
        self.known.is_empty()
    }

    /// Adds `path` as a known value. The path matches with either separator, with doubled
    /// backslashes and in any ASCII letter case.
    ///
    /// Adds nothing if `path` is empty or is a drive root.
    pub fn register_path(&mut self, placeholder: Placeholder, path: &str) {
        let trimmed = path.trim().trim_end_matches(['/', '\\']);
        let trimmed = trimmed.strip_prefix(r"\\?\").unwrap_or(trimmed);
        if !trimmed.contains(['/', '\\']) {
            return;
        }
        let replacement = placeholder.text(!trimmed.is_ascii());
        let folded = fold(trimmed);
        let doubled = folded.replace('\\', r"\\");
        self.insert(Known {
            needle: doubled,
            replacement: replacement.clone(),
            bare: false,
        });
        self.insert(Known {
            needle: folded,
            replacement,
            bare: false,
        });
    }

    /// Adds `value` as a known value that is replaced where it stands alone.
    ///
    /// Adds nothing if `value` is shorter than four characters.
    pub fn register_value(&mut self, placeholder: Placeholder, value: &str) {
        let value = value.trim();
        if value.chars().count() < MIN_BARE_VALUE_CHARS {
            return;
        }
        self.insert(Known {
            needle: fold(value),
            replacement: placeholder.text(false),
            bare: true,
        });
    }

    fn insert(&mut self, known: Known) {
        if self.known.iter().any(|k| k.needle == known.needle) {
            return;
        }
        let at = self
            .known
            .partition_point(|k| k.needle.len() >= known.needle.len());
        self.known.insert(at, known);
    }

    /// Returns `text` with each known value replaced. Returns `text` borrowed if it holds
    /// none.
    ///
    /// The longest value wins where two values overlap.
    // shortcut: one substring search per known value, use an Aho-Corasick automaton if the
    // number of known values grows past a few dozen.
    #[must_use]
    pub fn redact_known<'a>(&self, text: &'a str) -> Cow<'a, str> {
        if self.known.is_empty() {
            return Cow::Borrowed(text);
        }
        // Folding keeps every byte offset, so an offset into `folded` is an offset into `text`.
        let folded = fold(text);
        let mut matches: Vec<(usize, usize, &str)> = Vec::new();
        for known in &self.known {
            let mut from = 0;
            while let Some(offset) = folded[from..].find(&known.needle) {
                let start = from + offset;
                let end = start + known.needle.len();
                let free = matches.iter().all(|&(s, e, _)| end <= s || start >= e);
                if free && is_bounded(&folded, start, end, known.bare) {
                    matches.push((start, end, &known.replacement));
                }
                from = start + folded[start..].chars().next().map_or(1, char::len_utf8);
            }
        }
        if matches.is_empty() {
            return Cow::Borrowed(text);
        }
        matches.sort_unstable_by_key(|&(start, _, _)| start);

        let mut out = String::with_capacity(text.len());
        let mut cursor = 0;
        for (start, end, replacement) in matches {
            out.push_str(&text[cursor..start]);
            out.push_str(replacement);
            cursor = end;
        }
        out.push_str(&text[cursor..]);
        Cow::Owned(out)
    }

    /// Returns `text` with each known value and each pattern match replaced. Returns `text`
    /// borrowed if nothing is replaced.
    #[must_use]
    pub fn redact<'a>(&self, text: &'a str) -> Cow<'a, str> {
        match self.redact_known(text) {
            Cow::Borrowed(text) => patterns::redact(text),
            Cow::Owned(text) => Cow::Owned(patterns::redact(&text).into_owned()),
        }
    }
}

/// Returns whether a match at `start..end` of `text` stands alone. The character after the
/// match must not continue a name. If `bare`, the character before it must not either.
fn is_bounded(text: &str, start: usize, end: usize, bare: bool) -> bool {
    let continues = |c: char| c.is_alphanumeric() || matches!(c, '_' | '-' | '~');
    let after = text[end..].chars().next().is_some_and(continues);
    let before = bare && text[..start].chars().next_back().is_some_and(continues);
    !after && !before
}

/// Returns `value` in one ASCII letter case and with one separator. Keeps every byte offset.
fn fold(value: &str) -> String {
    value
        .chars()
        .map(|c| match c {
            '/' => '\\',
            other => other.to_ascii_lowercase(),
        })
        .collect()
}

static SHARED: LazyLock<RwLock<Redactor>> = LazyLock::new(|| RwLock::new(Redactor::from_env()));

/// Returns `text` redacted by the redactor that the process shares.
#[must_use]
pub fn redact(text: &str) -> Cow<'_, str> {
    let redactor = SHARED.read().unwrap_or_else(|e| e.into_inner());
    redactor.redact(text)
}

/// Adds `path` as a known value of the shared redactor.
pub fn register_path(placeholder: Placeholder, path: &Path) {
    let mut redactor = SHARED.write().unwrap_or_else(|e| e.into_inner());
    redactor.register_path(placeholder, &path.to_string_lossy());
}

/// Adds `value` as a known value of the shared redactor.
pub fn register_value(placeholder: Placeholder, value: &str) {
    let mut redactor = SHARED.write().unwrap_or_else(|e| e.into_inner());
    redactor.register_value(placeholder, value);
}
