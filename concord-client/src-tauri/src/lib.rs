use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::{PermissionKind, PermissionResponse},
    Manager,
};

#[tauri::command]
fn reset_mic_permissions(app: tauri::AppHandle) -> Result<bool, String> {
    let fixed = fix_mic_permissions(&app);
    Ok(fixed)
}

#[tauri::command]
fn open_windows_mic_settings() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", "ms-settings:privacy-microphone"])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    app.restart();
}

fn fix_mic_permissions(app: &tauri::AppHandle) -> bool {
    let mut any_fixed = false;

    let mut candidate_dirs = Vec::new();
    if let Ok(local_data) = app.path().app_local_data_dir() {
        candidate_dirs.push(local_data.clone());
        if let Some(parent) = local_data.parent() {
            candidate_dirs.push(parent.join("com.concord.desktop"));
            candidate_dirs.push(parent.join("com.concord.app"));
        }
    }

    for dir in candidate_dirs {
        let pref_path = dir.join("EBWebView").join("Default").join("Preferences");
        if pref_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&pref_path) {
                if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&content) {
                    let mut modified = false;
                    if let Some(exceptions) = json
                        .get_mut("profile")
                        .and_then(|p| p.get_mut("content_settings"))
                        .and_then(|cs| cs.get_mut("exceptions"))
                    {
                        for key in &["media_stream_mic", "media_stream_camera"] {
                            if let Some(target) = exceptions.get_mut(*key) {
                                if let Some(obj) = target.as_object_mut() {
                                    for (_origin, val) in obj.iter_mut() {
                                        if let Some(setting) = val.get_mut("setting") {
                                            if setting.as_i64() != Some(1) {
                                                *setting = serde_json::json!(1);
                                                modified = true;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if modified {
                        if let Ok(new_content) = serde_json::to_string_pretty(&json) {
                            if std::fs::write(&pref_path, new_content).is_ok() {
                                any_fixed = true;
                            }
                        }
                    }
                }
            }
        }
    }

    any_fixed
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            reset_mic_permissions,
            open_windows_mic_settings,
            restart_app
        ])
        .on_permission_request(|_webview, kind| match kind {
            PermissionKind::Microphone | PermissionKind::Camera => PermissionResponse::Allow,
            _ => PermissionResponse::Default,
        })
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // Auto repair any previously blocked microphone permissions on startup
            fix_mic_permissions(&app.handle());

            let icon = app.default_window_icon().cloned();

            if let Some(ref icon) = icon {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_icon(icon.clone());
                }
            }

            // Create Tray Menu items
            let open_item = MenuItem::with_id(app, "open", "Abrir Concord", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Sair do Concord", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Concord")
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
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
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                    }
                });

            if let Some(icon) = icon {
                tray_builder = tray_builder.icon(icon);
            }

            tray_builder.build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
