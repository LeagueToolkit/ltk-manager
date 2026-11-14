//! The private values that the process environment holds.

/// The private values of the user and the machine, as the environment variables give them.
///
/// The redactor reads the environment through this type only, so that a test supplies the
/// values and does not depend on the variables of the machine that runs it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Environment {
    /// The profile directory, from `USERPROFILE` or `HOME`.
    pub profile_dir: Option<String>,
    /// The username, from `USERNAME` or `USER`. Falls back to the last component of the
    /// profile directory.
    pub username: Option<String>,
    /// The computer name, from `COMPUTERNAME`.
    pub machine: Option<String>,
}

impl Environment {
    /// Reads the values from the environment of the running process.
    #[must_use]
    pub fn read() -> Self {
        Self::from_lookup(|name| std::env::var(name).ok())
    }

    /// Reads the values through `lookup`, which returns the value of a variable by name.
    ///
    /// A variable with an empty value counts as not set.
    #[must_use]
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Self {
        let first_set = |names: &[&str]| {
            names
                .iter()
                .find_map(|name| lookup(name).filter(|value| !value.trim().is_empty()))
        };
        let profile_dir = first_set(&["USERPROFILE", "HOME"]);
        let username = first_set(&["USERNAME", "USER"]).or_else(|| {
            let dir = profile_dir.as_deref()?.trim_end_matches(['/', '\\']);
            let name = dir.rsplit(['/', '\\']).next()?;
            (!name.is_empty()).then(|| name.to_owned())
        });
        Self {
            profile_dir,
            username,
            machine: first_set(&["COMPUTERNAME"]),
        }
    }
}
