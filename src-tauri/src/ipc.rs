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
    integration_status,
    integration_release,
    change_integration,
    cancel_integration_download,
    // Bin editor: a document's lifetime
    bin_open,
    bin_save,
    bin_reload,
    bin_close,
    // Bin editor: reads
    bin_roots,
    bin_children,
    bin_read,
    bin_find,
    bin_dependencies,
    bin_choices,
    class_schema,
    class_docs,
    sync_meta_docs,
    // Bin editor: edits
    bin_edit,
    bin_undo,
    bin_redo,
    // Bin editor: declarations
    bin_declared,
    bin_set_declaring,
    bin_declare_into,
    bin_row_declaration,
    declarations_module_action,
    // Object index
    locate_game_files,
    search_game_paths,
    warm_object_index,
    drop_object_index,
    search_object_index,
    declared_objects,
    object_dir,
    character_spells,
    read_spell,
    find_objects,
    find_references,
    cancel_reference_walk,
    // Particle renderer
    read_vfx_system,
    // Skin preview
    read_skin,
    read_material_programs,
    read_default_skinned_program,
    bake_skin_tangents,
    read_map,
    read_map_particles,
    read_map_characters,
    read_map_variants,
    read_map_outline,
    locate_map_files,
    locate_files_near,
    read_animation_graph,
    read_clip_header,
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
    // Workshop folders
    inspect_project_folder,
    open_project_folder,
    record_project_opened,
    get_opened_project_folders,
    forget_project_folder,
    relocate_project_folder,
    convert_folder_to_project,
    add_project_folders,
    // Workshop ignore rules
    get_project_ignore_rules,
    recommended_ignore_rules,
    save_project_ignore_rules,
    add_recommended_ignore_rules,
    get_project_text,
    save_project_text,
    // Workshop declarations
    declarations_outline,
    // Launcher
    check_install_mismatch,
    switch_league_install,
    // Updater
    check_update,
    download_update,
    install_update,
    discard_update,
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
