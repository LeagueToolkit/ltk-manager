//! Opening a `.bin` as ritobin text, through the VS Code extension's own verb.
//!
//! `ritobin-lsp` registers a Windows Explorer verb for `.bin` files whose command
//! line is the VS Code executable the extension runs under. Reading that verb is
//! the whole of the integration. VS Code claims a `.bin` named on a command line
//! with the extension's own editor, which converts it to ritobin text, so this
//! side hands over a path and nothing else.

use std::path::Path;
use std::process::Command;

use crate::config::Config;
use crate::error::{AppError, AppResult};
use crate::game_wads::WadCache;
use crate::preview::AssetRef;

/// What Explorer puts the file's path in place of.
const PLACEHOLDER: &str = "%1";

/// The prefix canonicalizing a path adds on Windows.
const VERBATIM_PREFIX: &str = r"\\?\";

/// The Windows Explorer verb the `ritobin-lsp` VS Code extension installs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RitobinVerb {
    command: String,
}

impl RitobinVerb {
    /// Where the extension writes the verb's command line.
    ///
    /// Under `SystemFileAssociations`, which adds a verb to `.bin` without
    /// taking the extension away from whichever program owns it, and under
    /// `HKCU`, which is why installing it asks for no administrator.
    #[cfg(target_os = "windows")]
    const COMMAND_KEY: &'static str =
        r"Software\Classes\SystemFileAssociations\.bin\shell\RitobinLSP.OpenAsRitobin\command";

    /// The extension the editor selects on.
    const EDITOR_EXTENSION: &'static str = "bin";

    /// The verb as installed, or `None` when the extension has registered none.
    #[cfg(target_os = "windows")]
    pub fn installed() -> Option<Self> {
        /* Under `diagnostics` because that is where this crate's Win32
        wrappers ended up, rather than for any diagnostic reason. */
        use crate::diagnostics::win_util::{HKCU, reg_read_str};

        let command = reg_read_str(HKCU, Self::COMMAND_KEY, "")?;
        (!command.trim().is_empty()).then_some(Self { command })
    }

    /// The verb as installed, which no platform but Windows has.
    #[cfg(not(target_os = "windows"))]
    pub fn installed() -> Option<Self> {
        None
    }

    /// Open one asset as ritobin text, copying it out of its archive if it must.
    ///
    /// `name` is what a hash table made of a game chunk's hash, which the
    /// reference itself cannot carry.
    ///
    /// # Errors
    ///
    /// Fails when the asset cannot be read or copied out, and when the program
    /// the verb names will not start.
    pub fn open_asset(
        &self,
        asset: &AssetRef,
        name: Option<&str>,
        config: &Config,
        wads: &WadCache,
    ) -> AppResult<()> {
        let name = Self::editor_file_name(name.unwrap_or_else(|| asset.name()));
        self.open(&asset.to_disk_path(Some(&name), config, wads)?)
    }

    /// Open one file through the verb.
    ///
    /// # Errors
    ///
    /// Fails when the verb's command line names no program to run, and when
    /// that program will not start.
    pub fn open(&self, path: &Path) -> AppResult<()> {
        let (program, args) = self.command_line(path).ok_or_else(|| {
            AppError::Other(format!(
                "The ritobin verb names no program to run: {}",
                self.command
            ))
        })?;

        Command::new(program)
            .args(args)
            .spawn()
            .map_err(|e| AppError::Other(format!("Could not start the ritobin editor: {e}")))?;

        Ok(())
    }

    /// `name` under the extension the editor selects on.
    ///
    /// A chunk no hash table names arrives as its hash, which `*.bin` does not
    /// match, and VS Code would open the copy as the bytes it is rather than as
    /// ritobin text.
    fn editor_file_name(name: &str) -> String {
        let carries_it = Path::new(name)
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case(Self::EDITOR_EXTENSION));

        if carries_it {
            return name.to_owned();
        }
        format!("{name}.{}", Self::EDITOR_EXTENSION)
    }

    /// The command line split into the program to run and its arguments, with
    /// `path` where the placeholder was.
    ///
    /// Grouping by quotes is all Explorer's own parser promises of a verb
    /// written like `"C:\...\Code.exe" "%1"`. Each argument is passed on whole
    /// rather than quoted again, so nothing in a path is escaped twice.
    fn command_line(&self, path: &Path) -> Option<(String, Vec<String>)> {
        let path = shell_path(path);
        let mut tokens = tokenize(&self.command).into_iter();

        let program = tokens.next()?;
        let mut args: Vec<String> = tokens
            .map(|token| token.replace(PLACEHOLDER, &path))
            .collect();

        /* A verb written without the placeholder would open the editor on
        nothing at all. */
        if !self.command.contains(PLACEHOLDER) {
            args.push(path);
        }

        Some((program, args))
    }
}

/// Split a command line the way Explorer does, on whitespace outside quotes.
fn tokenize(command: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut started = false;
    let mut quoted = false;

    for character in command.chars() {
        match character {
            '"' => {
                quoted = !quoted;
                started = true;
            }
            character if character.is_whitespace() && !quoted => {
                if started {
                    tokens.push(std::mem::take(&mut current));
                    started = false;
                }
            }
            character => {
                current.push(character);
                started = true;
            }
        }
    }

    if started {
        tokens.push(current);
    }
    tokens
}

/// The path in the form another program will take it in.
///
/// Canonicalizing on Windows answers with the extended-length form, and a
/// program that does not know the prefix reads it as part of the name.
fn shell_path(path: &Path) -> String {
    let text = path.to_string_lossy().into_owned();

    match text.strip_prefix(VERBATIM_PREFIX) {
        /* `\\?\UNC\server\share` is `\\server\share` without the prefix. */
        Some(rest) => rest
            .strip_prefix("UNC\\")
            .map_or_else(|| rest.to_owned(), |share| format!(r"\\{share}")),
        None => text,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn verb(command: &str) -> RitobinVerb {
        RitobinVerb {
            command: command.to_owned(),
        }
    }

    #[test]
    fn a_quoted_program_keeps_the_spaces_in_its_path() {
        let (program, args) = verb(r#""C:\Program Files\Microsoft VS Code\Code.exe" "%1""#)
            .command_line(Path::new(r"C:\mods\Aatrox.bin"))
            .unwrap();

        assert_eq!(program, r"C:\Program Files\Microsoft VS Code\Code.exe");
        assert_eq!(args, vec![r"C:\mods\Aatrox.bin".to_owned()]);
    }

    #[test]
    fn a_verb_with_no_placeholder_still_reaches_the_file() {
        let (program, args) = verb(r#""C:\VSCode\Code.exe" --new-window"#)
            .command_line(Path::new(r"C:\mods\Aatrox.bin"))
            .unwrap();

        assert_eq!(program, r"C:\VSCode\Code.exe");
        assert_eq!(
            args,
            vec!["--new-window".to_owned(), r"C:\mods\Aatrox.bin".to_owned()]
        );
    }

    #[test]
    fn an_empty_command_names_no_program() {
        assert!(verb("   ").command_line(Path::new("a.bin")).is_none());
    }

    #[test]
    fn the_extended_length_prefix_comes_off_the_path() {
        let (_, args) = verb(r#""Code.exe" "%1""#)
            .command_line(Path::new(r"\\?\C:\mods\Aatrox.bin"))
            .unwrap();

        assert_eq!(args, vec![r"C:\mods\Aatrox.bin".to_owned()]);
    }

    #[test]
    fn a_verbatim_unc_path_reads_as_a_share_again() {
        assert_eq!(
            shell_path(Path::new(r"\\?\UNC\pc\share\Aatrox.bin")),
            r"\\pc\share\Aatrox.bin"
        );
    }

    #[test]
    fn a_name_without_the_editors_extension_gains_it() {
        assert_eq!(
            RitobinVerb::editor_file_name("0123456789abcdef"),
            "0123456789abcdef.bin"
        );
        assert_eq!(RitobinVerb::editor_file_name("Aatrox.bin"), "Aatrox.bin");
        assert_eq!(RitobinVerb::editor_file_name("Aatrox.BIN"), "Aatrox.BIN");
    }
}
