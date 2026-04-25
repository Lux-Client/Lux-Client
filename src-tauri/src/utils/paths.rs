use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use serde_json::Value;
use std::fs;

pub fn get_user_data_dir(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().expect("failed to get app data dir")
}

pub fn get_settings_path(app: &AppHandle) -> PathBuf {
    get_user_data_dir(app).join("settings.json")
}

pub fn read_settings(app: &AppHandle) -> Value {
    let path = get_settings_path(app);
    if !path.exists() {
        return Value::Object(serde_json::Map::new());
    }
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Object(serde_json::Map::new()))
}

pub fn get_default_instances_dir(app: &AppHandle) -> PathBuf {
    get_user_data_dir(app).join("instances")
}

pub fn get_configured_instances_dir(app: &AppHandle) -> Option<PathBuf> {
    let settings = read_settings(app);
    settings.get("instancesPath")
        .or_else(|| settings.get("instancePath"))
        .and_then(|v| v.as_str())
        .map(PathBuf::from)
}

pub fn resolve_primary_instances_dir(app: &AppHandle) -> PathBuf {
    get_configured_instances_dir(app).unwrap_or_else(|| get_default_instances_dir(app))
}

pub fn get_legacy_instance_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let app_data = app.path().app_data_dir().expect("failed to get app data dir");
    // On Windows, app_data_dir() usually returns AppData/Roaming/LuxClient
    // We want the parent to check other folder names if legacy
    let roaming = app_data.parent().unwrap_or(&app_data);

    vec![
        roaming.join("mclc").join("instances"),
        roaming.join("Minecraft Launcher").join("instances"),
        roaming.join("LuxClient").join("instances"),
        roaming.join("luxclient").join("instances"),
        roaming.join("Lux Launcher").join("instances"),
    ]
}

pub fn get_all_instance_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let mut dirs = vec![resolve_primary_instances_dir(app), get_default_instances_dir(app)];
    dirs.extend(get_legacy_instance_dirs(app));

    let mut deduped = Vec::new();
    for dir in dirs {
        if dir.exists() && dir.is_dir() {
            let normalized = fs::canonicalize(&dir).unwrap_or(dir);
            if !deduped.contains(&normalized) {
                deduped.push(normalized);
            }
        }
    }
    deduped
}

pub fn resolve_instance_dir_by_name(app: &AppHandle, name: &str) -> Option<PathBuf> {
    let primary = resolve_primary_instances_dir(app).join(name);
    if primary.join("instance.json").exists() {
        return Some(primary);
    }

    for base in get_all_instance_dirs(app) {
        let candidate = base.join(name);
        if candidate.join("instance.json").exists() {
            return Some(candidate);
        }
    }
    None
}
