//! The half of the command table that `tauri-specta` generates bindings for.
//!
//! A command moves here module by module. The names and the [`IpcResult`] envelope
//! are what the frontend sees, and both are unchanged by the move, so a migrated
//! module is invisible to a call site until it switches to the generated function.
//!
//! [`IpcResult`]: crate::error::IpcResult

use tauri::ipc::Invoke;
use tauri::Wry;
use tauri_specta::{collect_commands, Builder, Commands};

/// The commands on `tauri-specta`, as both a dispatch table and a name list.
///
/// A handler takes the [`Invoke`] by value, so two of them cannot fall through to each
/// other and [`invoke_handler`] has to pick one up front. Writing the list once is what
/// keeps the pick and the bindings equal.
macro_rules! migrated {
    ($($name:ident),* $(,)?) => {
        /// The command names [`commands`] answers.
        const MIGRATED: &[&str] = &[$(stringify!($name)),*];

        /// Every command the generated bindings carry.
        fn commands() -> Commands<Wry> {
            collect_commands![$(crate::commands::$name),*]
        }
    };
}

migrated![
    // Bin editor
    bin_open,
    bin_children,
    bin_read,
    bin_close,
    class_schema,
    // Particle renderer
    read_vfx_system,
    // Skin preview
    read_skin,
    read_animation_clips,
    // Diagnostics
    run_diagnostics,
    open_elevated_terminal,
    list_incidents,
    dismiss_incident,
    dismiss_all_incidents,
    reveal_game_log,
    incident_report,
    incident_token,
    decode_incident_token,
    telemetry_identity,
    reset_telemetry_secret,
    track_ui_error,
    // Launcher
    check_install_mismatch,
    switch_league_install,
];

/// The builder the bindings are generated from and the handler is built out of.
fn builder() -> Builder<Wry> {
    /* `ts-rs` writes a `number` for a 64-bit integer, and the two exporters describe
    one wire format, so this side matches rather than leading. */
    Builder::<Wry>::new()
        .commands(commands())
        .dangerously_cast_bigints_to_number()
}

/// Route each call to the handler that owns its command.
pub fn invoke_handler(
    legacy: impl Fn(Invoke<Wry>) -> bool + Send + Sync + 'static,
) -> impl Fn(Invoke<Wry>) -> bool + Send + Sync + 'static {
    /* The handler's type captures the borrow, though its body only clones an `Arc`.
    Leaked rather than held, because the app outlives every scope in `main`. */
    let builder: &'static Builder<Wry> = Box::leak(Box::new(builder()));
    let migrated = builder.invoke_handler();
    move |invoke| {
        if MIGRATED.contains(&invoke.message.command()) {
            migrated(invoke)
        } else {
            legacy(invoke)
        }
    }
}

#[cfg(test)]
mod tests;
