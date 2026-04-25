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
    pub async fn get_merged_instances(
        app: &AppHandle,
    ) -> crate::utils::error::Result<Vec<InstanceConfig>> {
        let mut instances = Vec::new();
        let mut seen_names = std::collections::HashSet::new();

        // 1. Scan local instances
        for base_dir in paths::get_all_instance_dirs(app) {
            let entries = fs::read_dir(&base_dir).map_err(|e| {
                crate::utils::error::LuxError::Instance(format!(
                    "Failed to read instances dir {}: {}",
                    base_dir.display(),
                    e
                ))
            })?;
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

        // 2. Discover external profiles (Modrinth/CurseForge)
        if let Some(base_dirs) = directories::BaseDirs::new() {
            // Modrinth
            let modrinth_dir = match std::env::consts::OS {
                "windows" => base_dirs.data_dir().join("ModrinthApp").join("profiles"),
                "macos" => base_dirs
                    .data_dir()
                    .join("com.modrinth.theseus")
                    .join("profiles"),
                _ => base_dirs.data_dir().join("ModrinthApp").join("profiles"), // Fallback Linux
            };

            if let Ok(entries) = fs::read_dir(&modrinth_dir) {
                for entry in entries.filter_map(|e| e.ok()) {
                    if entry.path().is_dir() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        let lower_name = name.to_lowercase();
                        if !seen_names.contains(&lower_name) {
                            seen_names.insert(lower_name);
                            instances.push(InstanceConfig {
                                name,
                                version: "External".to_string(),
                                loader: "Unknown".to_string(),
                                loader_version: None,
                                version_id: None,
                                icon: None,
                                instance_type: "external".to_string(),
                                external_source: Some("modrinth".to_string()),
                                external_path: Some(entry.path()),
                                last_played: None,
                                playtime: None,
                                folder_path: None,
                            });
                        }
                    }
                }
            }

            // CurseForge
            let curseforge_dir = match std::env::consts::OS {
                "windows" => base_dirs
                    .home_dir()
                    .join("curseforge")
                    .join("minecraft")
                    .join("Instances"),
                "macos" => base_dirs
                    .data_dir()
                    .join("curseforge")
                    .join("minecraft")
                    .join("Instances"),
                _ => base_dirs
                    .home_dir()
                    .join("curseforge")
                    .join("minecraft")
                    .join("Instances"),
            };

            if let Ok(entries) = fs::read_dir(&curseforge_dir) {
                for entry in entries.filter_map(|e| e.ok()) {
                    if entry.path().is_dir() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        let lower_name = name.to_lowercase();
                        if !seen_names.contains(&lower_name) {
                            seen_names.insert(lower_name);
                            instances.push(InstanceConfig {
                                name,
                                version: "External".to_string(),
                                loader: "Unknown".to_string(),
                                loader_version: None,
                                version_id: None,
                                icon: None,
                                instance_type: "external".to_string(),
                                external_source: Some("curseforge".to_string()),
                                external_path: Some(entry.path()),
                                last_played: None,
                                playtime: None,
                                folder_path: None,
                            });
                        }
                    }
                }
            }
        }

        Ok(instances)
    }
}

#[tauri::command]
pub async fn get_instances(app: AppHandle) -> crate::utils::error::Result<Vec<InstanceConfig>> {
    InstanceManager::get_merged_instances(&app).await
}

#[tauri::command]
pub async fn get_server_mods(instance_name: String) -> crate::utils::error::Result<Vec<String>> {
    // Stub for now to allow UI to load
    Ok(Vec::new())
}
