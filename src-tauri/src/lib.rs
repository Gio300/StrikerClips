// Library entry for Tauri 2 (mobile-friendly split). Desktop wraps this
// from main.rs; mobile targets call `run()` directly via the platform shim.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .invoke_handler(tauri::generate_handler![
            commands::app_version,
            commands::open_obs_install_page,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ReelOne");
}

mod commands {
    use tauri::AppHandle;

    /// Returns the bundled app version. Used by the About dialog and the
    /// auto-update check (when we add it).
    #[tauri::command]
    pub fn app_version(_app: AppHandle) -> String {
        env!("CARGO_PKG_VERSION").to_string()
    }

    /// Convenience: opens the OBS download page in the user's browser. The
    /// OBS panel uses this when the user clicks "I don't have OBS yet".
    #[tauri::command]
    pub async fn open_obs_install_page(app: AppHandle) -> Result<(), String> {
        use tauri_plugin_shell::ShellExt;
        app.shell()
            .open("https://obsproject.com/", None)
            .map_err(|e| e.to_string())
    }
}
