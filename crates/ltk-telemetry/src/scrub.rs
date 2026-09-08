//! What is taken out of every outgoing string, wherever it came from.

use std::borrow::Cow;

use serde_json::Value;

use crate::event::Properties;

#[cfg(test)]
mod tests;

/// What stands in for the user profile path once it has been taken out.
pub const PROFILE_PLACEHOLDER: &str = "%USERPROFILE%";

/// The last thing every outgoing string passes through.
///
/// It sits here rather than at the call sites because a panic message, an error
/// message and a property filled in by hand all reach the wire by different
/// routes, and only one of them can be reviewed.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Scrubber {
    profile_dir: Option<String>,
}

impl Scrubber {
    /// A scrubber that takes nothing out.
    #[must_use]
    pub fn none() -> Self {
        Self::default()
    }

    /// A scrubber for the profile directory of whoever is running.
    #[must_use]
    pub fn from_env() -> Self {
        let profile_dir = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .ok();
        match profile_dir {
            Some(dir) => Self::for_profile_dir(dir),
            None => Self::none(),
        }
    }

    /// A scrubber for a named profile directory, as a test drives it.
    #[must_use]
    pub fn for_profile_dir(dir: impl Into<String>) -> Self {
        let dir = dir.into();
        let trimmed = dir.trim_end_matches(['/', '\\']);
        if trimmed.is_empty() {
            return Self::none();
        }
        Self {
            profile_dir: Some(trimmed.to_owned()),
        }
    }

    /// `value` with the profile path replaced, or `value` when it holds none.
    #[must_use]
    pub fn scrub<'a>(&self, value: &'a str) -> Cow<'a, str> {
        let Some(profile_dir) = &self.profile_dir else {
            return Cow::Borrowed(value);
        };

        // Both sides are folded onto one separator and one case so that a path
        // written either way matches. Folding is byte for byte, so an offset
        // into the folded string is the same offset into the original.
        let needle = fold(profile_dir);
        let folded = fold(value);
        if !folded.contains(&needle) {
            return Cow::Borrowed(value);
        }

        let mut scrubbed = String::with_capacity(value.len());
        let mut cursor = 0;
        while let Some(offset) = folded[cursor..].find(&needle) {
            let start = cursor + offset;
            let end = start + needle.len();
            if !value.is_char_boundary(start) || !value.is_char_boundary(end) {
                break;
            }
            scrubbed.push_str(&value[cursor..start]);
            scrubbed.push_str(PROFILE_PLACEHOLDER);
            cursor = end;
        }
        scrubbed.push_str(&value[cursor..]);
        Cow::Owned(scrubbed)
    }

    /// Scrub every string in `properties`, however deeply it is nested.
    pub fn scrub_properties(&self, properties: &mut Properties) {
        if self.profile_dir.is_none() {
            return;
        }
        for value in properties.as_map_mut().values_mut() {
            self.scrub_value(value);
        }
    }

    fn scrub_value(&self, value: &mut Value) {
        match value {
            Value::String(text) => {
                if let Cow::Owned(scrubbed) = self.scrub(text) {
                    *text = scrubbed;
                }
            }
            Value::Array(items) => {
                for item in items {
                    self.scrub_value(item);
                }
            }
            Value::Object(fields) => {
                for field in fields.values_mut() {
                    self.scrub_value(field);
                }
            }
            Value::Null | Value::Bool(_) | Value::Number(_) => {}
        }
    }
}

/// One case and one separator, so a path written either way compares equal.
fn fold(value: &str) -> String {
    value
        .chars()
        .map(|character| match character {
            '/' => '\\',
            other => other.to_ascii_lowercase(),
        })
        .collect()
}
