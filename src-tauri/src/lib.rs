mod auth;
mod backup_manager;
mod instances;
mod launcher;
mod utils;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            auth::login,
            auth::get_profile,
            backup_manager::manual_backup,
            instances::get_instances,
            launcher::launch_game
        ])
        .setup(|app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
