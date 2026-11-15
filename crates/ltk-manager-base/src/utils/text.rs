//! Cuts of a text to a limit: by characters, and by bytes at line boundaries.

use std::borrow::Cow;

/// Returns the first `max_chars` characters of `text`.
///
/// Returns `text` whole if it holds `max_chars` at most.
#[must_use]
pub fn first_chars(text: &str, max_chars: usize) -> &str {
    match text.char_indices().nth(max_chars) {
        Some((end, _)) => &text[..end],
        None => text,
    }
}

/// Returns the first `max_bytes` bytes of `text`, ending at the end of a line.
///
/// Returns `text` whole if it holds `max_bytes` at most. Returns an empty text if the first
/// line alone is longer.
#[must_use]
pub fn first_lines(text: &str, max_bytes: usize) -> &str {
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
#[must_use]
pub fn last_lines(text: &str, max_bytes: usize) -> &str {
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
#[must_use]
pub fn first_and_last_lines(text: &str, max_bytes: usize) -> Cow<'_, str> {
    if text.len() <= max_bytes {
        return Cow::Borrowed(text);
    }
    let first = first_lines(text, max_bytes / 2);
    let last = last_lines(text, max_bytes / 2);
    let left_out = text.len() - first.len() - last.len();
    Cow::Owned(format!("{first}[{left_out} bytes left out]\n{last}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEXT: &str = "first\nsecond\nthird\nfourth\nfifth\n";

    #[test]
    fn first_chars_counts_characters_and_not_bytes() {
        assert_eq!(first_chars("héllo", 2), "hé");
        assert_eq!(first_chars("héllo", 5), "héllo");
        assert_eq!(first_chars("héllo", 9), "héllo");
        assert_eq!(first_chars("héllo", 0), "");
    }

    #[test]
    fn first_lines_ends_at_the_end_of_a_line() {
        assert_eq!(first_lines(TEXT, 64), TEXT);
        assert_eq!(first_lines(TEXT, 15), "first\nsecond\n");
        assert_eq!(first_lines(TEXT, 3), "");
    }

    #[test]
    fn last_lines_starts_at_the_start_of_a_line() {
        assert_eq!(last_lines(TEXT, 64), TEXT);
        assert_eq!(last_lines(TEXT, 15), "fourth\nfifth\n");
        assert_eq!(last_lines(TEXT, 3), "");
    }

    #[test]
    fn line_cuts_keep_a_character_of_several_bytes_whole() {
        let text = "é\nmiddle\né\n";

        assert_eq!(first_lines(text, 4), "é\n");
        assert_eq!(last_lines(text, 4), "é\n");
    }

    #[test]
    fn first_and_last_lines_states_the_bytes_that_are_left_out() {
        assert_eq!(first_and_last_lines(TEXT, 64), TEXT);
        assert_eq!(
            first_and_last_lines(TEXT, 14),
            "first\n[20 bytes left out]\nfifth\n"
        );
    }
}
