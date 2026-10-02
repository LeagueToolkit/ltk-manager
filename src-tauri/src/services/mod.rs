//! The IPC services, each a Tauri plugin answering its own commands. ADR-0059.
//!
//! `table.rs` names every service and its commands once. Here each becomes a [`Service`], whose
//! commands the frontend invokes as `plugin:<name>|<command>` through its own generated file,
//! with the types in the one file every service shares.

pub mod app_update;
pub mod atlas;
pub mod bin;
pub mod desktop;
pub mod diagnostics;
pub mod game;
pub mod hotkeys;
pub mod integrations;
pub mod launcher;
pub mod library;
pub mod links;
pub mod news;
pub mod objects;
pub mod patcher;
pub mod preview;
pub mod settings;
pub(crate) mod shared;
pub mod workshop;

#[cfg(test)]
use specta::Types;
use tauri::plugin::Builder as PluginBuilder;
use tauri::Wry;
use tauri_specta::{collect_commands, Builder, Commands};

/// A service: the plugin its commands are invoked through, and the commands.
pub trait Service {
    /// The plugin name, which every command is invoked under.
    const NAME: &'static str;

    /// The names of the commands this build answers.
    const COMMANDS: &'static [&'static str];

    /// The commands this build answers.
    fn commands() -> Commands<Wry>;

    /// Register the types the commands reach.
    #[cfg(test)]
    fn types(types: &mut Types);
}

/// A [`Service`] for each module of `table.rs`, and the functions over all of them.
///
/// `collect_commands!` takes no attributes, so a debug-only command cannot carry its own `cfg`.
macro_rules! services {
    ($($module:ident($name:literal) {
        $($command:ident),* $(,)?
        $(; debug: $($debug:ident),* $(,)?)?
    })*) => {
        $(
            impl Service for $module::Table {
                const NAME: &'static str = $name;

                #[cfg(not(debug_assertions))]
                const COMMANDS: &'static [&'static str] = &[$(stringify!($command)),*];

                #[cfg(debug_assertions)]
                const COMMANDS: &'static [&'static str] =
                    &[$(stringify!($command),)* $($(stringify!($debug)),*)?];

                #[cfg(not(debug_assertions))]
                fn commands() -> Commands<Wry> {
                    collect_commands![$($module::$command),*]
                }

                #[cfg(debug_assertions)]
                fn commands() -> Commands<Wry> {
                    collect_commands![$($module::$command,)* $($($module::$debug),*)?]
                }

                #[cfg(all(test, not(debug_assertions)))]
                fn types(types: &mut Types) {
                    specta::function::collect_functions![$($module::$command),*](types);
                }

                #[cfg(all(test, debug_assertions))]
                fn types(types: &mut Types) {
                    specta::function::collect_functions![
                        $($module::$command,)* $($($module::$debug),*)?
                    ](types);
                }
            }
        )*

        /// The types every service's commands reach, for the file the bindings share.
        #[cfg(test)]
        pub fn types() -> Types {
            let mut types = Types::default();
            $(<$module::Table as Service>::types(&mut types);)*
            types
        }

        /// Each service's name, command names and bindings builder, for the export.
        #[cfg(test)]
        pub fn builders() -> Vec<(&'static str, &'static [&'static str], Builder<Wry>)> {
            vec![$((
                $name,
                <$module::Table as Service>::COMMANDS,
                builder::<$module::Table>(),
            )),*]
        }
    };
}

include!("table.rs");

/// The bindings builder of `S`, whose commands invoke through its plugin.
///
/// Configured as `ipc::builder` is, so a type renders the same in both files.
pub(crate) fn builder<S: Service>() -> Builder<Wry> {
    Builder::<Wry>::new()
        .plugin_name(S::NAME)
        .commands(S::commands())
        .constant(
            crate::ipc::COMMAND_NAMES,
            crate::ipc::command_names(S::NAME, S::COMMANDS),
        )
        .dangerously_cast_bigints_to_number()
}

/// The plugin answering `S`'s commands, for the service to add its lifecycle to.
fn plugin<S: Service>() -> PluginBuilder<Wry> {
    PluginBuilder::new(S::NAME).invoke_handler(crate::ipc::handler(builder::<S>()))
}
