mod auth;
mod backup_manager;
mod instances;
mod launcher;
mod modrinth;
mod skin;
mod utils;

use tauri::AppHandle;
use tauri::Manager;

#[tauri::command]
fn relaunch(app: AppHandle) {
    app.restart();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_log::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            auth::login,
            auth::get_profile,
            backup_manager::manual_backup,
            instances::get_instances,
            launcher::launch_game,
            relaunch,
            modrinth::search_modrinth,
            modrinth::get_modrinth_project,
            modrinth::get_mod_versions,
            modrinth::resolve_dependencies,
            modrinth::modrinth_install,
            instances::get_server_mods,
            skin::get_current_skin,
            skin::save_local_skin,
            skin::save_local_skin_from_url,
            skin::save_local_skin_from_username,
            skin::upload_skin,
            skin::upload_skin_from_url,
            skin::get_local_skins
        ])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
