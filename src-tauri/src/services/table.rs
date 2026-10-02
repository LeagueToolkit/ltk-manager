// Every IPC service and the commands it answers, as its module, its plugin name and its
// commands. `build.rs` reads this for the permissions, and `services` for the handlers and the
// bindings, so the two cannot drift. ADR-0059.
services! {
    bin("bin") {
        // A document's lifetime
        bin_open,
        bin_open_variant,
        bin_save,
        bin_reload,
        bin_close,
        // Reads
        bin_roots,
        bin_children,
        bin_read,
        bin_find,
        bin_dependencies,
        bin_choices,
        bin_copy_value,
        class_schema,
        derived_classes,
        class_docs,
        sync_meta_docs,
        // Edits
        bin_edit,
        bin_history,
        bin_changes,
        bin_revert,
        // Declarations
        bin_declared,
        bin_overrides,
        bin_set_declaring,
        bin_declare_into,
        bin_row_declaration,
        declarations_module_action,
    }
    atlas("atlas") {
        // Views
        read_ui_view,
        read_ui_scene_view,
        read_ui_loadout,
        read_ui_characters,
        read_ui_tooltips,
        read_ui_font,
        read_ui_font_catalog,
        // Sheets
        atlas_import_sprite,
        atlas_import_font_file,
        atlas_make_surface,
        atlas_patch_sprite,
        atlas_sheet,
        atlas_export_sprite,
        // Programs
        read_ui_material_programs,
        read_ui_programs,
    }
    app_update("app-update") {
        check_update,
        download_update,
        install_update,
        discard_update,
    }
    game("game") {
        // Game index
        get_game_index,
        read_game_dir,
        refresh_game_index,
        search_game_index,
        find_in_game_index,
        locate_game_files,
        // Game WADs
        get_game_wads,
        read_game_wad,
        // Extract to disk
        plan_game_extract,
        extract_game_files,
        cancel_extract,
        // Hashtables
        get_hashtable_cache_status,
        check_hashtable_updates,
        sync_hashtables,
        // Strings
        search_string_keys,
        lookup_string_values,
    }
    library("library") {
        // Mods
        get_installed_mods,
        install_mod,
        install_mods,
        update_mod,
        uninstall_mod,
        toggle_mod,
        reorder_mods,
        set_mod_layers,
        enable_mod_with_layers,
        edit_mod_metadata,
        set_mod_storage,
        export_mods,
        get_mod_thumbnail,
        get_mod_thumbnails,
        get_mod_readme,
        get_mod_license_text,
        get_storage_directory,
        get_all_mod_wad_reports,
        analyze_mod_wads,
        // Folders
        get_folders,
        get_folder_order,
        create_folder,
        rename_folder,
        delete_folder,
        move_mod_to_folder,
        toggle_folder,
        reorder_folder_mods,
        reorder_folders,
        // Profiles
        list_mod_profiles,
        get_active_mod_profile,
        create_mod_profile,
        delete_mod_profile,
        switch_mod_profile,
        rename_mod_profile,
        // Health
        check_mod_health,
        sweep_mod_health,
        repair_mod,
        repair_mods,
        cancel_mod_health_run,
        get_health_check_readiness,
        get_health_sweep,
        get_mod_health_verdicts,
        // Migration
        get_layout_migration_state,
        scan_cslol_mods,
        import_cslol_mods,
        ;
        debug: time_mod_health,
    }
    objects("objects") {
        warm_object_index,
        drop_object_index,
        search_object_index,
        find_objects,
        object_dir,
        character_spells,
        class_object_count,
        declared_objects,
        find_references,
        cancel_reference_walk,
    }
    preview("preview") {
        // Asset preview
        read_asset_info,
        save_asset_copy,
        detect_ritobin_integration,
        open_asset_in_ritobin,
        // Programs
        read_material_programs,
        read_engine_program,
        // Maps
        read_map,
        read_map_particles,
        read_map_characters,
        read_map_variants,
        read_map_outline,
        locate_map_files,
        locate_files_near,
        // Skins
        read_skin,
        read_animation_graph,
        read_clip_header,
        bake_skin_tangents,
        // Spells and VFX
        read_spell,
        read_vfx_system,
        vfx_templates,
    }
    settings("settings") {
        get_settings,
        save_settings,
        get_default_settings,
        auto_detect_league_path,
        validate_league_path,
        check_setup_required,
        detect_league_run_as_admin,
        list_available_wads,
        list_forcible_map_skins,
        list_map_decorations,
    }
    patcher("patcher") {
        start_patcher,
        stop_patcher,
        rebuild_overlay,
        get_patcher_status,
        get_linked_bin_offenders,
        get_checksum_mismatches,
    }
    launcher("launcher") {
        launch_league,
        cancel_launch,
        stop_league,
        get_launch_availability,
        get_league_session,
        check_install_mismatch,
        switch_league_install,
    }
    diagnostics("diagnostics") {
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
    }
    hotkeys("hotkeys") {
        pause_hotkeys,
        resume_hotkeys,
        set_hotkey,
    }
    desktop("desktop") {
        get_app_info,
        get_platform_support,
        show_main_window,
        reveal_in_explorer,
        minimize_to_tray,
        detect_storage_medium,
    }
    integrations("integrations") {
        integration_status,
        integration_release,
        change_integration,
        cancel_integration_download,
    }
    links("links") {
        deep_link_install_mod,
        take_pending_deep_link,
    }
    news("news") {
        list_releases,
        list_announcements,
        list_notices,
    }
    workshop("workshop") {
        // Projects
        get_workshop_projects,
        get_workshop_project,
        create_project,
        edit_project,
        rename_workshop_project,
        delete_workshop_project,
        pack_workshop_project,
        peek_fantome,
        validate_project,
        get_project_thumbnail,
        get_project_content_tree,
        // Layers
        get_layer_content_path,
        get_layer_info,
        add_files_to_layer,
        delete_layer_content,
        watch_project_layers,
        unwatch_project_layers,
        // Opened folders
        inspect_project_folder,
        open_project_folder,
        record_project_opened,
        get_opened_project_folders,
        forget_project_folder,
        relocate_project_folder,
        convert_folder_to_project,
        add_project_folders,
        // Text files
        get_project_ignore_rules,
        recommended_ignore_rules,
        save_project_ignore_rules,
        add_recommended_ignore_rules,
        get_project_text,
        save_project_text,
        get_project_editor_state,
        save_project_editor_state,
        declarations_outline,
        // Problems
        analyze_project,
        fix_problems,
    }
}
