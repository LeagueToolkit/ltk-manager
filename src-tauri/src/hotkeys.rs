use crate::error::{AppError, AppResult};
use crate::state::Settings;
use serde::Deserialize;
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// The action a global hotkey triggers when pressed.
#[derive(Debug, Clone, Copy, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum HotkeyAction {
    ReloadMods,
    KillLeague,
}

impl HotkeyAction {
    fn label(self) -> &'static str {
        match self {
            Self::ReloadMods => "reload-mods",
            Self::KillLeague => "kill-league",
        }
    }

    /// Return the current accelerator for this action from settings.
    pub fn get_accelerator(self, settings: &Settings) -> Option<&str> {
        match self {
            Self::ReloadMods => settings.reload_mods_hotkey.as_deref(),
            Self::KillLeague => settings.kill_league_hotkey.as_deref(),
        }
    }

    /// All configured hotkeys paired with their human-readable names.
    fn all_bindings(settings: &Settings) -> [(Option<&str>, &'static str); 2] {
        [
            (settings.reload_mods_hotkey.as_deref(), "Hot Reload Mods"),
            (settings.kill_league_hotkey.as_deref(), "Kill League"),
        ]
    }

    /// Fail if `accelerator` is already bound to a *different* action.
    pub fn check_no_conflict(self, settings: &Settings, accelerator: &str) -> AppResult<()> {
        let own = self.get_accelerator(settings);
        for (accel, name) in Self::all_bindings(settings) {
            if accel == Some(accelerator) && accel != own {
                return Err(AppError::ValidationFailed(format!(
                    "This hotkey is already used for {name}"
                )));
            }
        }
        Ok(())
    }

    /// Write the accelerator into the corresponding settings field.
    pub fn set_accelerator(self, settings: &mut Settings, value: Option<String>) {
        match self {
            Self::ReloadMods => settings.reload_mods_hotkey = value,
            Self::KillLeague => settings.kill_league_hotkey = value,
        }
    }

    /// Execute the action associated with this hotkey, emitting an error event on failure.
    fn execute(self, app_handle: &AppHandle) {
        let result = match self {
            Self::ReloadMods => crate::services::hotkeys::execute_hot_reload(app_handle),
            Self::KillLeague => crate::services::hotkeys::execute_kill_league(app_handle),
        };
        if let Err(e) = result {
            tracing::error!("{} failed: {}", self.label(), e);
            let _ = tauri::Emitter::emit(app_handle, "hotkey-error", e.to_string());
        }
    }
}

/// Manages global keyboard shortcuts for the application.
///
/// Registration state lives in the `global_shortcut` plugin — this struct
/// simply owns an `AppHandle` and provides a consolidated API.
pub struct HotkeyManager {
    app_handle: AppHandle,
}

impl HotkeyManager {
    pub fn new(app_handle: &AppHandle) -> Self {
        Self {
            app_handle: app_handle.clone(),
        }
    }

    /// Register a global shortcut for the given action.
    pub fn register(&self, action: HotkeyAction, accelerator: &str) -> AppResult<()> {
        let manager = self.app_handle.global_shortcut();
        let handle = self.app_handle.clone();
        let label = action.label();

        manager
            .on_shortcut(accelerator, move |_app, _shortcut, event| {
                if event.state != ShortcutState::Pressed {
                    return;
                }

                tracing::info!("{} hotkey pressed", label);
                let handle_inner = handle.clone();
                std::thread::spawn(move || action.execute(&handle_inner));
            })
            .map_err(|e| {
                AppError::ValidationFailed(format!(
                    "Hotkey \"{}\" could not be registered: {}",
                    accelerator, e
                ))
            })?;

        tracing::trace!("Registered {} hotkey: {}", label, accelerator);
        Ok(())
    }

    /// Unregister a global shortcut if it exists.
    pub fn unregister(&self, accelerator: &str) {
        let manager = self.app_handle.global_shortcut();
        if let Err(e) = manager.unregister(accelerator) {
            tracing::warn!("Failed to unregister hotkey {}: {}", accelerator, e);
        } else {
            tracing::trace!("Unregistered global hotkey: {}", accelerator);
        }
    }

    /// Unregister all configured hotkeys (e.g. while capturing a new binding).
    pub fn pause(&self, settings: &Settings) {
        if let Some(ref hotkey) = settings.reload_mods_hotkey {
            self.unregister(hotkey);
        }
        if let Some(ref hotkey) = settings.kill_league_hotkey {
            self.unregister(hotkey);
        }
        tracing::trace!("Paused all global hotkeys");
    }

    /// Re-register all configured hotkeys (idempotent — unregisters first).
    pub fn resume(&self, settings: &Settings) {
        if let Some(ref hotkey) = settings.reload_mods_hotkey {
            self.unregister(hotkey);
            if let Err(e) = self.register(HotkeyAction::ReloadMods, hotkey) {
                tracing::error!("Failed to resume reload-mods hotkey: {}", e);
            }
        }
        if let Some(ref hotkey) = settings.kill_league_hotkey {
            self.unregister(hotkey);
            if let Err(e) = self.register(HotkeyAction::KillLeague, hotkey) {
                tracing::error!("Failed to resume kill-league hotkey: {}", e);
            }
        }
        tracing::trace!("Resumed all global hotkeys");
    }

    /// Register persisted hotkeys from settings on app startup.
    pub fn register_from_settings(&self, settings: &Settings) {
        if let Some(ref hotkey) = settings.reload_mods_hotkey {
            let trimmed = hotkey.trim();
            if !trimmed.is_empty() {
                if let Err(e) = self.register(HotkeyAction::ReloadMods, trimmed) {
                    tracing::error!("Failed to register reload-mods hotkey on startup: {}", e);
                }
            }
        }

        if let Some(ref hotkey) = settings.kill_league_hotkey {
            let trimmed = hotkey.trim();
            if !trimmed.is_empty() {
                if let Err(e) = self.register(HotkeyAction::KillLeague, trimmed) {
                    tracing::error!("Failed to register kill-league hotkey on startup: {}", e);
                }
            }
        }
    }
}
