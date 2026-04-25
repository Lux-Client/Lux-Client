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
    // Add other fields from JS as needed
}

pub struct InstanceManager;

impl InstanceManager {
    pub async fn get_merged_instances(app: &AppHandle) -> Vec<InstanceConfig> {
        let mut instances = Vec::new();
        let mut seen_names = std::collections::HashSet::new();

        // 1. Scan local instances
        for base_dir in paths::get_all_instance_dirs(app) {
            if let Ok(entries) = fs::read_dir(base_dir) {
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

        // 2. Discover external profiles (Modrinth/CurseForge)
        // TODO: Implement external discovery logic here

        instances
    }
}

#[tauri::command]
pub async fn get_instances(app: AppHandle) -> Result<Vec<InstanceConfig>, String> {
    Ok(InstanceManager::get_merged_instances(&app).await)
}
