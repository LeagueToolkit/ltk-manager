//! What differs between the platforms the manager runs on.

use std::process::Command;

#[cfg(windows)]
pub mod windows;

/// Start `command` with no console window of its own. Nothing changes off Windows.
pub fn hide_console(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command
}
