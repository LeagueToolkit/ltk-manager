use serde::{Deserialize, Serialize};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;

// states, profiles and workshop
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AppTrayState {
    Default,
    LibraryLoading,
    LibraryOn,
    WorkshopLoading,
    WorkshopOn,
}

pub fn setup(app: &mut tauri::App) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show", "Show Manager", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    let _tray = TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().cloned().unwrap())
        .tooltip("LTK Manager")
        .menu(&tray_menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}

#[tauri::command]
pub fn set_tray_state(app: tauri::AppHandle, state: AppTrayState) -> Result<(), String> {
    let tray = app.tray_by_id("main-tray").ok_or("Tray not found")?;

    let (icon_bytes, tooltip) = match state {
        AppTrayState::Default => (None, "LTK Manager"),
        AppTrayState::LibraryLoading => (
            Some(include_bytes!("../icons/icon_load.png").as_slice()),
            "LTK Manager - Building Profile...",
        ),
        AppTrayState::LibraryOn => (
            Some(include_bytes!("../icons/icon_on.png").as_slice()),
            "LTK Manager - Profile Patched",
        ),
        // workshop solution if someone changed their mind :P
        AppTrayState::WorkshopLoading => (
            Some(include_bytes!("../icons/icon_load.png").as_slice()),
            "LTK Manager - Workshop Building...",
        ),
        AppTrayState::WorkshopOn => (
            Some(include_bytes!("../icons/icon_on.png").as_slice()),
            "LTK Manager - Workshop Patched",
        ),
    };
    // apply icon
    if let Some(bytes) = icon_bytes {
        let img = image::load_from_memory(bytes)
            .map_err(|e| e.to_string())?
            .into_rgba8();

        let (width, height) = img.dimensions();

        let icon_image = Image::new_owned(img.into_raw(), width, height);

        tray.set_icon(Some(icon_image)).map_err(|e| e.to_string())?;
    } else {
        let default_icon = app
            .default_window_icon()
            .cloned()
            .ok_or("No default icon")?;
        tray.set_icon(Some(default_icon))
            .map_err(|e| e.to_string())?;
    }
    let _ = tray.set_tooltip(Some(tooltip));

    Ok(())
}
