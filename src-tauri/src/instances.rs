use crate::utils::paths;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstanceConfig {
    pub name: String,
    pub version: String,
    pub loader: String,
    pub loader_version: Option<String>,
    pub version_id: Option<String>,
    pub icon: Option<String>,
    #[serde(default)]
    pub instance_type: String,
    pub external_source: Option<String>,
    pub external_path: Option<PathBuf>,
    pub last_played: Option<u64>,
    pub playtime: Option<u64>,
    pub folder_path: Option<String>,
}

#[tauri::command]
pub async fn get_instances(app: AppHandle) -> Result<Vec<InstanceConfig>, String> {
    let mut instances = Vec::new();
    let mut seen_names = std::collections::HashSet::new();
    
    for base_dir in paths::get_all_instance_dirs(&app) {
        if let Ok(entries) = fs::read_dir(&base_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                let config_path = entry.path().join("instance.json");
                if config_path.exists() {
                    if let Ok(content) = fs::read_to_string(&config_path) {
                        if let Ok(config) = serde_json::from_str::<InstanceConfig>(&content) {
                            let name = config.name.to_lowercase();
                            if !seen_names.contains(&name) {
                                seen_names.insert(name);
                                instances.push(config);
                            }
                        }
                    }
                }
            }
        }
    }

    if let Some(base_dirs) = directories::BaseDirs::new() {
        let modrinth_dir = match std::env::consts::OS {
            "windows" => base_dirs.data_dir().join("ModrinthApp").join("profiles"),
            "macos" => base_dirs.data_dir().join("com.modrinth.theseus").join("profiles"),
            _ => base_dirs.data_dir().join("ModrinthApp").join("profiles"),
        };

        if let Ok(entries) = fs::read_dir(&modrinth_dir) {
            for entry in entries.filter_map(|e| e.ok()).filter(|e| e.path().is_dir()) {
                let name = entry.file_name().to_string_lossy().to_string();
                let name_lower = name.to_lowercase();
                if !seen_names.contains(&name_lower) {
                    seen_names.insert(name_lower);
                    instances.push(InstanceConfig {
                        name,
                        version: String::new(),
                        loader: String::from("modrinth"),
                        loader_version: None,
                        version_id: None,
                        icon: None,
                        instance_type: String::from("external"),
                        external_source: Some(String::from("modrinth")),
                        external_path: Some(entry.path()),
                        last_played: None,
                        playtime: None,
                        folder_path: None,
                    });
                }
            }
        }
    }

    Ok(instances)
}

#[tauri::command]
pub async fn get_server_mods(_instance_name: String) -> Result<Vec<String>, String> {
    Ok(vec![])
}