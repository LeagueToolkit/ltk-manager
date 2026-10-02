//! Command arguments that stand in for the states a family of commands takes together.
//!
//! Each crosses no IPC, so a binding leaves it out as it leaves out a `State`.

use ltk_manager_core::config::Config;
use ltk_manager_core::mods::ModLibrary;
use ltk_manager_core::workshop::Workshop as Projects;
use specta::datatype::DataType;
use specta::function::FunctionArg;
use specta::Types;
use tauri::ipc::{CommandArg, CommandItem, InvokeError};
use tauri::Runtime;

use crate::error::{AppResult, IpcResult};
use crate::mods::ModLibraryState;
use crate::patcher::PatcherState;
use crate::state::SettingsState;
use crate::workshop::WorkshopState;

/// The mod library, the settings it is read under, and the patcher a change refreshes.
pub(crate) struct Library<'r> {
    library: &'r ModLibrary,
    settings: &'r SettingsState,
    patcher: &'r PatcherState,
}

impl Library<'_> {
    /// `work` over the library under the current settings.
    pub(crate) fn with<T>(
        &self,
        work: impl FnOnce(&ModLibrary, &Config) -> AppResult<T>,
    ) -> IpcResult<T> {
        work(self.library, &self.settings.config()).into()
    }

    /// `change` over the library, and the patcher's overlay refreshed from what it leaves.
    ///
    /// The refresh runs whether or not the change succeeds, because a failed change can still
    /// have written part of itself.
    pub(crate) fn with_refresh<T>(
        &self,
        change: impl FnOnce(&ModLibrary, &Config) -> AppResult<T>,
    ) -> IpcResult<T> {
        let result = change(self.library, &self.settings.config());
        self.patcher.refresh_overlay();
        result.into()
    }
}

impl<'de, R: Runtime> CommandArg<'de, R> for Library<'de> {
    fn from_command(command: CommandItem<'de, R>) -> Result<Self, InvokeError> {
        Ok(Self {
            library: &managed::<ModLibraryState, R>(&command)?.0,
            settings: managed(&command)?,
            patcher: managed(&command)?,
        })
    }
}

impl FunctionArg for Library<'_> {
    fn to_datatype(_: &mut Types) -> Option<DataType> {
        None
    }
}

/// The workshop's projects and the settings they are read under.
pub(crate) struct Workshop<'r> {
    projects: &'r Projects,
    settings: &'r SettingsState,
}

impl Workshop<'_> {
    /// `work` over the projects under the current settings.
    pub(crate) fn with<T>(
        &self,
        work: impl FnOnce(&Projects, &Config) -> AppResult<T>,
    ) -> IpcResult<T> {
        work(self.projects, &self.settings.config()).into()
    }
}

impl<'de, R: Runtime> CommandArg<'de, R> for Workshop<'de> {
    fn from_command(command: CommandItem<'de, R>) -> Result<Self, InvokeError> {
        Ok(Self {
            projects: &managed::<WorkshopState, R>(&command)?.0,
            settings: managed(&command)?,
        })
    }
}

impl FunctionArg for Workshop<'_> {
    fn to_datatype(_: &mut Types) -> Option<DataType> {
        None
    }
}

/// The state `T` the app manages, or the error naming the command that asked for it.
fn managed<'de, T: Send + Sync + 'static, R: Runtime>(
    command: &CommandItem<'de, R>,
) -> Result<&'de T, InvokeError> {
    let state = command.message.state_ref().try_get::<T>().ok_or_else(|| {
        InvokeError::from(format!(
            "{} not managed for `{}` on command `{}`",
            std::any::type_name::<T>(),
            command.key,
            command.name
        ))
    })?;

    Ok(state.inner())
}
