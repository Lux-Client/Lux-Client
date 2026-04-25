use crate::utils::paths;
use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use tauri::{AppHandle, Manager};
use walkdir::WalkDir;

#[derive(Debug, Serialize, Deserialize)]
pub struct BackupResponse {
    pub success: bool,
    pub path: Option<String>,
    pub name: Option<String>,
    pub error: Option<String>,
}

pub struct BackupManager;

impl BackupManager {
    pub async fn create_backup(
        app: &AppHandle,
        instance_name: &str,
    ) -> anyhow::Result<BackupResponse> {
        let instances_dir = paths::resolve_primary_instances_dir(app);
        let instance_dir = paths::resolve_instance_dir_by_name(app, instance_name)
            .unwrap_or_else(|| instances_dir.join(instance_name));

        let saves_dir = instance_dir.join("saves");
        let backups_dir = app
            .path()
            .app_data_dir()?
            .join("backups")
            .join(instance_name);

        if !saves_dir.exists() {
            return Ok(BackupResponse {
                success: false,
                path: None,
                name: None,
                error: Some("No saves found".to_string()),
            });
        }

        fs::create_dir_all(&backups_dir)?;

        let timestamp = Local::now().format("%Y-%m-%d_%H-%M").to_string();
        let file_name = format!("{}_{}.zip", instance_name, timestamp);
        let file_path = backups_dir.join(&file_name);

        let file = fs::File::create(&file_path)?;
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(0o755);

        let mut buffer = Vec::new();
        for entry in WalkDir::new(&saves_dir).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            let name = path.strip_prefix(&saves_dir)?;

            if path.is_file() {
                zip.start_file(name.to_string_lossy(), options)?;
                let mut f = fs::File::open(path)?;
                f.read_to_end(&mut buffer)?;
                zip.write_all(&buffer)?;
                buffer.clear();
            } else if !name.as_os_str().is_empty() {
                zip.add_directory(name.to_string_lossy(), options)?;
            }
        }
        zip.finish()?;

        // Update instance.json with lastBackup
        let config_path = instance_dir.join("instance.json");
        if config_path.exists() {
            if let Ok(content) = fs::read_to_string(&config_path) {
                if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&content) {
                    json["lastBackup"] = serde_json::json!(chrono::Utc::now().timestamp_millis());
                    if let Ok(new_content) = serde_json::to_string_pretty(&json) {
                        let _ = fs::write(config_path, new_content);
                    }
                }
            }
        }

        Self::cleanup_backups(app, instance_name).await?;

        Ok(BackupResponse {
            success: true,
            path: Some(file_path.to_string_lossy().to_string()),
            name: Some(file_name),
            error: None,
        })
    }

    pub async fn cleanup_backups(app: &AppHandle, instance_name: &str) -> anyhow::Result<()> {
        let backups_dir = app
            .path()
            .app_data_dir()?
            .join("backups")
            .join(instance_name);
        if !backups_dir.exists() {
            return Ok(());
        }

        let settings = paths::read_settings(app);
        let max_backups = settings["backupSettings"]["maxBackups"]
            .as_u64()
            .unwrap_or(10) as usize;

        let mut files = fs::read_dir(&backups_dir)?
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("zip"))
            .collect::<Vec<_>>();

        files.sort_by_key(|e| e.metadata().and_then(|m| m.modified()).ok());

        if files.len() > max_backups {
            let to_delete = files.len() - max_backups;
            for i in 0..to_delete {
                fs::remove_file(files[i].path())?;
            }
        }

        Ok(())
    }
}

#[tauri::command]
pub async fn manual_backup(
    app: AppHandle,
    instance_name: String,
) -> Result<BackupResponse, String> {
    BackupManager::create_backup(&app, &instance_name)
        .await
        .map_err(|e| e.to_string())
}
