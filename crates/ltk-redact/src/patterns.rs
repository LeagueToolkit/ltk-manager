//! The pattern rules, which run after the known values.

use std::{
    borrow::Cow,
    net::{Ipv4Addr, Ipv6Addr},
    sync::LazyLock,
};

use regex::{Captures, Regex, RegexSet};

use crate::{and_then, splice};

/// The replacement of a rule.
enum Replace {
    /// A template in the syntax of [`Captures::expand`].
    With(&'static str),
    /// A function that returns the replacement for one match, or `None` to keep the match.
    /// The second argument is the text that follows the match.
    By(fn(&Captures<'_>, &str) -> Option<String>),
}

use Replace::{By, With};

/// The rules in the order they run. A deep link runs before a URL, because a deep link
/// carries a URL in its query. A URL runs before a `key=value` pair, because the placeholder
/// of the pair would end the URL match before its fragment.
const RULES: &[(&str, Replace)] = &[
    (
        r"(?i)\bbearer\s+[a-z0-9._~+/=-]{8,}",
        With("Bearer <secret>"),
    ),
    (r#"(?i)\b(ltk://[a-z0-9_-]*)[^\s"'<>]*"#, With("$1")),
    (r#"(?i)\bhttps?://[^\s"'<>]+"#, By(url)),
    (
        r#"(?i)\b(token|key|secret|password|signature|sig)=[^\s&"']+"#,
        With("$1=<secret>"),
    ),
    (
        r#"(?i)\b([a-z]:[\\/]+users[\\/]+)(?:([^\\/"<>|:*?\r\n]+)([\\/])|([^\\/"<>|:*?\s]+))"#,
        By(other_user),
    ),
    (
        r"(?i)\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b",
        With("<email>"),
    ),
    (r"\b\d{1,3}(?:\.\d{1,3}){3}\b", By(ipv4)),
    (r"[0-9A-Fa-f:]{3,45}", By(ipv6)),
    (r"'[^'#\r\n]{1,32}#[^'\s]{1,8}'", With("'<riot-id>'")),
];

/// The set that selects the rules that match a text, and the regex of each rule.
static PATTERNS: LazyLock<(RegexSet, Vec<Regex>)> = LazyLock::new(|| {
    let patterns = RULES.iter().map(|(pattern, _)| *pattern);
    (
        RegexSet::new(patterns.clone()).expect("valid patterns"),
        patterns
            .map(|pattern| Regex::new(pattern).expect("a valid pattern"))
            .collect(),
    )
});

/// Returns `text` with each pattern match replaced. Returns `text` borrowed if no rule
/// replaces anything.
pub(crate) fn redact(text: &str) -> Cow<'_, str> {
    let (set, regexes) = &*PATTERNS;
    let mut out = Cow::Borrowed(text);
    for index in set.matches(text) {
        out = and_then(out, |text| apply(text, &regexes[index], &RULES[index].1));
    }
    out
}

/// Returns `text` with each match of `regex` replaced as `replace` states.
fn apply<'a>(text: &'a str, regex: &Regex, replace: &Replace) -> Cow<'a, str> {
    let replacements = regex.captures_iter(text).filter_map(|captures| {
        let whole = captures.get(0)?;
        let replacement = match replace {
            With(template) => {
                let mut replacement = String::new();
                captures.expand(template, &mut replacement);
                replacement
            }
            By(replace) => replace(&captures, &text[whole.end()..])?,
        };
        Some((whole.range(), replacement))
    });
    splice(text, replacements)
}

/// Keeps the scheme, the host and the path of a URL. Drops the user info, the query and the
/// fragment.
fn url(captures: &Captures<'_>, _: &str) -> Option<String> {
    let (scheme, rest) = captures[0].split_once("://")?;
    let rest = &rest[..rest.find(['?', '#']).unwrap_or(rest.len())];
    let authority_end = rest.find('/').unwrap_or(rest.len());
    let rest = match rest[..authority_end].rfind('@') {
        Some(at) => &rest[at + 1..],
        None => rest,
    };
    Some(format!("{scheme}://{rest}"))
}

/// Replaces the name in `<drive>:\Users\<name>`. Keeps the profile names that Windows
/// creates for every install.
fn other_user(captures: &Captures<'_>, _: &str) -> Option<String> {
    let name = captures.get(2).or_else(|| captures.get(4))?.as_str();
    const SHARED_PROFILES: [&str; 4] = ["public", "default", "default user", "all users"];
    if SHARED_PROFILES
        .iter()
        .any(|shared| name.eq_ignore_ascii_case(shared))
    {
        return None;
    }
    let separator = captures.get(3).map_or("", |m| m.as_str());
    Some(format!("{}<other>{separator}", &captures[1]))
}

/// Replaces an IPv4 address. Keeps the loopback and the unspecified address, and a match
/// that is the start of a longer dotted number.
fn ipv4(captures: &Captures<'_>, after: &str) -> Option<String> {
    let address: Ipv4Addr = captures[0].parse().ok()?;
    let mut following = after.chars();
    let longer =
        following.next() == Some('.') && following.next().is_some_and(|c| c.is_ascii_digit());
    (!longer && !address.is_loopback() && !address.is_unspecified()).then(|| "<ip>".to_owned())
}

/// Replaces an IPv6 address. The candidate must hold a digit, so that a Rust path such as
/// `db::cafe` is kept. Keeps the loopback and the unspecified address.
fn ipv6(captures: &Captures<'_>, after: &str) -> Option<String> {
    let whole = &captures[0];
    if after
        .chars()
        .next()
        .is_some_and(|c| c.is_alphanumeric() || c == '_')
    {
        return None;
    }
    let (candidate, tail) = match whole.strip_suffix(':') {
        Some(candidate) if !candidate.ends_with(':') => (candidate, ":"),
        _ => (whole, ""),
    };
    if !candidate.bytes().any(|b| b.is_ascii_digit()) {
        return None;
    }
    let address: Ipv6Addr = candidate.parse().ok()?;
    (!address.is_loopback() && !address.is_unspecified()).then(|| format!("<ip>{tail}"))
}
