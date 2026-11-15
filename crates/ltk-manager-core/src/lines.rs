//! Cuts of a text at line boundaries, for a text that has a size limit.

use std::borrow::Cow;

#[cfg(test)]
mod tests;

/// Returns the first `max_bytes` bytes of `text`, ending at the end of a line.
///
/// Returns `text` whole if it holds `max_bytes` at most. Returns an empty text if the first
/// line alone is longer.
pub(crate) fn first(text: &str, max_bytes: usize) -> &str {
    if text.len() <= max_bytes {
        return text;
    }
    let mut cut = max_bytes;
    while !text.is_char_boundary(cut) {
        cut -= 1;
    }
    match text[..cut].rfind('\n') {
        Some(newline) => &text[..=newline],
        None => "",
    }
}

/// Returns the last `max_bytes` bytes of `text`, starting at the start of a line.
///
/// Returns `text` whole if it holds `max_bytes` at most. Returns an empty text if the last
/// line alone is longer.
pub(crate) fn last(text: &str, max_bytes: usize) -> &str {
    if text.len() <= max_bytes {
        return text;
    }
    let mut cut = text.len() - max_bytes;
    while !text.is_char_boundary(cut) {
        cut += 1;
    }
    match text[cut..].find('\n') {
        Some(newline) => &text[cut + newline + 1..],
        None => "",
    }
}

/// Returns the first and the last lines of `text`, half of `max_bytes` each, with one line
/// between them that states the number of bytes that are left out.
///
/// Returns `text` whole if it holds `max_bytes` at most.
pub(crate) fn first_and_last(text: &str, max_bytes: usize) -> Cow<'_, str> {
    if text.len() <= max_bytes {
        return Cow::Borrowed(text);
    }
    let first = first(text, max_bytes / 2);
    let last = last(text, max_bytes / 2);
    let left_out = text.len() - first.len() - last.len();
    Cow::Owned(format!("{first}[{left_out} bytes left out]\n{last}"))
}
