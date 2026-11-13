//! The pattern rules, which run after the known values.

use std::borrow::Cow;
use std::net::{Ipv4Addr, Ipv6Addr};
use std::sync::LazyLock;

use regex::{Captures, Regex, RegexSet};

/// Returns the replacement for one match, or `None` to keep the match. `after` is the text
/// that follows the match.
type Replace = fn(&Captures<'_>, after: &str) -> Option<String>;

/// The rules in the order they run. A deep link runs before a URL, because a deep link
/// carries a URL in its query. A URL runs before a `key=value` pair, because the placeholder
/// of the pair would end the URL match before its fragment.
const RULES: &[(&str, Replace)] = &[
    (r"(?i)\bbearer\s+[a-z0-9._~+/=-]{8,}", bearer),
    (r#"(?i)\bltk://([a-z0-9_-]*)[^\s"'<>]*"#, deep_link),
    (r#"(?i)\bhttps?://[^\s"'<>]+"#, url),
    (
        r#"(?i)\b(token|key|secret|password|signature|sig)=[^\s&"']+"#,
        key_value,
    ),
    (
        r#"(?i)\b([a-z]:[\\/]+users[\\/]+)(?:([^\\/"<>|:*?\r\n]+)([\\/])|([^\\/"<>|:*?\s]+))"#,
        other_user,
    ),
    (r"(?i)\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b", email),
    (r"\b\d{1,3}(?:\.\d{1,3}){3}\b", ipv4),
    (r"[0-9A-Fa-f:]{3,45}", ipv6),
    (r"'[^'#\r\n]{1,32}#[^'\s]{1,8}'", riot_id),
];

struct Patterns {
    set: RegexSet,
    rules: Vec<(Regex, Replace)>,
}

static PATTERNS: LazyLock<Patterns> = LazyLock::new(|| Patterns {
    set: RegexSet::new(RULES.iter().map(|(pattern, _)| pattern)).expect("valid patterns"),
    rules: RULES
        .iter()
        .map(|(pattern, replace)| (Regex::new(pattern).expect("a valid pattern"), *replace))
        .collect(),
});

/// Returns `text` with each pattern match replaced. Returns `text` borrowed if no rule
/// replaces anything.
pub(crate) fn redact(text: &str) -> Cow<'_, str> {
    let patterns = &*PATTERNS;
    let mut out = Cow::Borrowed(text);
    for index in patterns.set.matches(text) {
        let (regex, replace) = &patterns.rules[index];
        if let Some(replaced) = apply(&out, regex, *replace) {
            out = Cow::Owned(replaced);
        }
    }
    out
}

/// Returns `text` with the matches of `regex` that `replace` accepts replaced, or `None` if
/// `replace` accepts none.
fn apply(text: &str, regex: &Regex, replace: Replace) -> Option<String> {
    let mut out: Option<String> = None;
    let mut cursor = 0;
    for captures in regex.captures_iter(text) {
        let whole = captures.get(0).expect("group 0 always exists");
        let Some(replacement) = replace(&captures, &text[whole.end()..]) else {
            continue;
        };
        let out = out.get_or_insert_with(|| String::with_capacity(text.len()));
        out.push_str(&text[cursor..whole.start()]);
        out.push_str(&replacement);
        cursor = whole.end();
    }
    out.map(|mut out| {
        out.push_str(&text[cursor..]);
        out
    })
}

fn bearer(_: &Captures<'_>, _: &str) -> Option<String> {
    Some("Bearer <secret>".to_owned())
}

fn key_value(captures: &Captures<'_>, _: &str) -> Option<String> {
    Some(format!("{}=<secret>", &captures[1]))
}

/// Keeps the action of an `ltk://` link and drops the rest.
fn deep_link(captures: &Captures<'_>, _: &str) -> Option<String> {
    let action = &captures[1];
    let kept = format!("ltk://{action}");
    (kept.len() != captures[0].len()).then_some(kept)
}

/// Keeps the scheme, the host and the path of a URL. Drops the user info, the query and the
/// fragment.
fn url(captures: &Captures<'_>, _: &str) -> Option<String> {
    let whole = &captures[0];
    let (scheme, rest) = whole.split_once("://")?;
    let rest = &rest[..rest.find(['?', '#']).unwrap_or(rest.len())];
    let authority_end = rest.find('/').unwrap_or(rest.len());
    let rest = match rest[..authority_end].rfind('@') {
        Some(at) => &rest[at + 1..],
        None => rest,
    };
    let kept = format!("{scheme}://{rest}");
    (kept.len() != whole.len()).then_some(kept)
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

fn email(_: &Captures<'_>, _: &str) -> Option<String> {
    Some("<email>".to_owned())
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

fn riot_id(_: &Captures<'_>, _: &str) -> Option<String> {
    Some("'<riot-id>'".to_owned())
}
