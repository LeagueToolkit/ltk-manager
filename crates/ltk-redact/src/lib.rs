//! Redaction of private values from text that reaches the log file or leaves the machine.
//!
//! A [`Redactor`] replaces known values first and pattern matches second. A known value is a
//! string that the process holds, such as the profile directory, so it is matched exactly. A
//! pattern matches text that has the form of a private value, such as a URL query.
//!
//! [`redact`] applies the redactor that the whole process shares. [`register`] adds known
//! values to it when the process reads them. [`redact_counting`] also counts the replacements
//! of each rule, for the manifest of a support report.

use std::{borrow::Cow, collections::BTreeMap, ffi::OsStr, io::Write, ops::Range, sync::LazyLock};

use parking_lot::RwLock;

mod environment;
mod patterns;

pub use environment::Environment;

#[cfg(test)]
mod tests;

/// The version of the rules. A change to a rule that replaces more text raises it.
pub const RULESET_VERSION: u32 = 1;

/// The shortest bare value that is replaced outside a path. A shorter value matches inside
/// ordinary words.
const MIN_BARE_VALUE_CHARS: usize = 4;

/// The text that replaces every private value that is not a known path.
const REDACTED: &str = "<redacted>";

/// The kind of a known value, which decides the text that replaces the value and how the
/// value is matched.
///
/// `Profile`, `League`, `Data` and `Workshop` are paths. A path matches with either
/// separator, with doubled backslashes and in any ASCII letter case, and each has a
/// placeholder of its own. Any other kind is a bare value, which matches where it stands
/// alone and reads `<redacted>`.
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
    fn text(self) -> &'static str {
        match self {
            Self::Profile => "%USERPROFILE%",
            Self::League => "<league>",
            Self::Data => "<data>",
            Self::Workshop => "<workshop>",
            Self::User | Self::Machine | Self::Secret | Self::Install | Self::RuneforgeUser => {
                REDACTED
            }
        }
    }

    /// Returns the name that [`Counts`] holds the replacements of this kind under.
    fn rule(self) -> &'static str {
        match self {
            Self::Profile => "profile",
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

    fn is_path(self) -> bool {
        matches!(
            self,
            Self::Profile | Self::League | Self::Data | Self::Workshop
        )
    }
}

/// The number of replacements that each rule made, by the name of the rule.
///
/// A known value counts under its kind, such as `profile` or `user`. A pattern counts under
/// its own name, such as `url` or `email`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Counts(BTreeMap<&'static str, usize>);

impl Counts {
    fn add(&mut self, rule: &'static str) {
        *self.0.entry(rule).or_default() += 1;
    }

    /// Returns each rule that replaced something, with its count, in the order of the names.
    pub fn iter(&self) -> impl Iterator<Item = (&'static str, usize)> + '_ {
        self.0.iter().map(|(rule, count)| (*rule, *count))
    }

    /// Returns the number of replacements of all rules.
    #[must_use]
    pub fn total(&self) -> usize {
        self.0.values().sum()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Known {
    /// The value in folded form.
    needle: String,
    replacement: String,
    /// The name that a replacement counts under.
    rule: &'static str,
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
    /// name of `environment`.
    #[must_use]
    pub fn for_environment(environment: &Environment) -> Self {
        let mut redactor = Self::new();
        redactor.register(Placeholder::Profile, &environment.profile_dir);
        redactor.register(Placeholder::User, &environment.username);
        redactor.register(Placeholder::Machine, &environment.machine);
        redactor
    }

    /// Adds each of `values` as a known value that `placeholder` replaces.
    ///
    /// Skips a path that is empty or is a drive root. Skips a bare value that is shorter
    /// than four characters.
    pub fn register<V: AsRef<str>>(
        &mut self,
        placeholder: Placeholder,
        values: impl IntoIterator<Item = V>,
    ) {
        for value in values {
            let value = value.as_ref().trim();
            if placeholder.is_path() {
                self.register_path(placeholder, value);
            } else if value.chars().count() >= MIN_BARE_VALUE_CHARS {
                self.insert(
                    fold(value),
                    placeholder.text().to_owned(),
                    placeholder,
                    true,
                );
            }
        }
    }

    fn register_path(&mut self, placeholder: Placeholder, path: &str) {
        let path = path.trim_end_matches(['/', '\\']);
        let path = path.strip_prefix(r"\\?\").unwrap_or(path);
        if !path.contains(['/', '\\']) {
            return;
        }
        let text = placeholder.text();
        let replacement = if path.is_ascii() {
            text.to_owned()
        } else {
            let (body, close) = text.split_at(text.len() - 1);
            format!("{body}:non-ascii{close}")
        };
        let folded = fold(path);
        let doubled = folded.replace('\\', r"\\");
        self.insert(doubled, replacement.clone(), placeholder, false);
        self.insert(folded, replacement, placeholder, false);
    }

    fn insert(&mut self, needle: String, replacement: String, kind: Placeholder, bare: bool) {
        if self.known.iter().any(|known| known.needle == needle) {
            return;
        }
        let at = self
            .known
            .partition_point(|known| known.needle.len() >= needle.len());
        let known = Known {
            needle,
            replacement,
            rule: kind.rule(),
            bare,
        };
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
        self.replace_known(text, None)
    }

    fn replace_known<'a>(&self, text: &'a str, counts: Option<&mut Counts>) -> Cow<'a, str> {
        if self.known.is_empty() {
            return Cow::Borrowed(text);
        }
        // Folding keeps every byte offset, so an offset into `folded` is an offset into `text`.
        let folded = fold(text);
        let mut matches: Vec<(Range<usize>, &str, &'static str)> = Vec::new();
        for known in &self.known {
            let mut from = 0;
            while let Some(offset) = folded[from..].find(&known.needle) {
                let start = from + offset;
                let end = start + known.needle.len();
                let free = matches
                    .iter()
                    .all(|(taken, ..)| end <= taken.start || start >= taken.end);
                if free && is_bounded(&folded, start, end, known.bare) {
                    matches.push((start..end, &known.replacement, known.rule));
                }
                from = start + folded[start..].chars().next().map_or(1, char::len_utf8);
            }
        }
        matches.sort_unstable_by_key(|(range, ..)| range.start);
        splice(text, matches, counts)
    }

    /// Returns `text` with each known value and each pattern match replaced. Returns `text`
    /// borrowed if nothing is replaced.
    #[must_use]
    pub fn redact<'a>(&self, text: &'a str) -> Cow<'a, str> {
        self.replace(text, None)
    }

    /// Returns `text` redacted as [`Self::redact`] does, and adds each replacement to
    /// `counts`.
    #[must_use]
    pub fn redact_counting<'a>(&self, text: &'a str, counts: &mut Counts) -> Cow<'a, str> {
        self.replace(text, Some(counts))
    }

    fn replace<'a>(&self, text: &'a str, mut counts: Option<&mut Counts>) -> Cow<'a, str> {
        let known = self.replace_known(text, counts.as_deref_mut());
        and_then(known, |text| patterns::redact(text, counts))
    }
}

/// Returns `text` with each range replaced by the text beside it, and adds the rule of each
/// replacement to `counts`. The ranges are in ascending order and do not overlap.
///
/// Skips a replacement that equals the text it replaces. Returns `text` borrowed if every
/// replacement is skipped.
fn splice<'a>(
    text: &'a str,
    replacements: impl IntoIterator<Item = (Range<usize>, impl AsRef<str>, &'static str)>,
    mut counts: Option<&mut Counts>,
) -> Cow<'a, str> {
    let mut out: Option<String> = None;
    let mut cursor = 0;
    for (range, replacement, rule) in replacements {
        let replacement = replacement.as_ref();
        if &text[range.clone()] == replacement {
            continue;
        }
        if let Some(counts) = counts.as_deref_mut() {
            counts.add(rule);
        }
        let out = out.get_or_insert_with(|| String::with_capacity(text.len()));
        out.push_str(&text[cursor..range.start]);
        out.push_str(replacement);
        cursor = range.end;
    }
    match out {
        Some(mut out) => {
            out.push_str(&text[cursor..]);
            Cow::Owned(out)
        }
        None => Cow::Borrowed(text),
    }
}

/// Returns the text that `pass` returns for `text`. Returns `text` itself, without a copy, if
/// `pass` returns its input borrowed.
fn and_then<'a>(
    text: Cow<'a, str>,
    pass: impl for<'b> FnOnce(&'b str) -> Cow<'b, str>,
) -> Cow<'a, str> {
    match text {
        Cow::Borrowed(text) => pass(text),
        Cow::Owned(text) => {
            let changed = match pass(&text) {
                Cow::Owned(changed) => Some(changed),
                Cow::Borrowed(_) => None,
            };
            Cow::Owned(changed.unwrap_or(text))
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

static SHARED: LazyLock<RwLock<Redactor>> =
    LazyLock::new(|| RwLock::new(Redactor::for_environment(&Environment::read())));

/// Returns `text` redacted by the shared redactor, and adds each replacement to `counts`.
#[must_use]
pub fn redact_counting<'a>(text: &'a str, counts: &mut Counts) -> Cow<'a, str> {
    SHARED.read().redact_counting(text, counts)
}

/// Returns `text` redacted by the redactor that the process shares.
#[must_use]
pub fn redact(text: &str) -> Cow<'_, str> {
    SHARED.read().redact(text)
}

/// Adds each of `values` as a known value of the shared redactor. See [`Redactor::register`].
///
/// Reads a value that is not valid Unicode lossily.
pub fn register<V: AsRef<OsStr>>(placeholder: Placeholder, values: impl IntoIterator<Item = V>) {
    let values = values
        .into_iter()
        .map(|value| value.as_ref().to_string_lossy().into_owned());
    SHARED.write().register(placeholder, values);
}

/// A writer that redacts each write through the shared redactor before the inner writer
/// receives it.
///
/// The caller passes one whole log event to each `write`. Bytes that are not valid UTF-8
/// are written unchanged.
#[derive(Debug)]
pub struct RedactingWriter<W>(W);

impl<W> RedactingWriter<W> {
    /// Returns a writer that redacts what it receives and writes the result to `inner`.
    pub fn new(inner: W) -> Self {
        Self(inner)
    }
}

impl<W: Write> Write for RedactingWriter<W> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        match std::str::from_utf8(buf) {
            Ok(text) => self.0.write_all(redact(text).as_bytes())?,
            Err(_) => self.0.write_all(buf)?,
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.0.flush()
    }
}
