//! What is taken out of every outgoing string, wherever it came from.

use std::borrow::Cow;

use ltk_redact::{Placeholder, Redactor};
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
    redactor: Redactor,
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
        let mut redactor = Redactor::new();
        redactor.register_path(Placeholder::Profile, &dir.into());
        Self { redactor }
    }

    /// `value` with the profile path replaced, or `value` when it holds none.
    #[must_use]
    pub fn scrub<'a>(&self, value: &'a str) -> Cow<'a, str> {
        self.redactor.redact_known(value)
    }

    /// Scrub every string in `properties`, however deeply it is nested.
    pub fn scrub_properties(&self, properties: &mut Properties) {
        if self.redactor.has_no_known_value() {
            return;
        }
        for value in properties.values_mut() {
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
