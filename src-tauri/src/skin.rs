use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use base64::Engine;

#[derive(Debug, Serialize, Deserialize)]
pub struct SkinData {
    pub id: String,
    pub url: String,
    pub variant: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LocalSkin {
    pub id: String,
    pub name: String,
    pub path: String,
    pub model: String,
    pub created_at: i64,
}

#[tauri::command]
pub async fn get_current_skin(token: String) -> Result<SkinData, String> {
    let client = reqwest::Client::new();
    
    let response = client.get("https://api.mojang.com/user/profile/{}")
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Ok(SkinData {
            id: String::new(),
            url: String::new(),
            variant: "classic".to_string(),
        });
    }

    let profile: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    
    let textures = profile.get("textures")
        .and_then(|t| t.get("SKIN"));
    
    let url = textures
        .and_then(|t| t.get("url"))
        .and_then(|u| u.as_str())
        .unwrap_or("")
        .to_string();
    
    let variant = textures
        .and_then(|t| t.get("metadata"))
        .and_then(|m| m.get("model"))
        .and_then(|m| m.as_str())
        .unwrap_or("classic")
        .to_string();

    Ok(SkinData {
        id: profile.get("id")
            .and_then(|id| id.as_str())
            .unwrap_or("")
            .to_string(),
        url,
        variant,
    })
}

#[tauri::command]
pub async fn save_local_skin(data: serde_json::Value) -> Result<serde_json::Value, String> {
    let skins_dir = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("lux")
        .join("skins");
    
    fs::create_dir_all(&skins_dir).map_err(|e| e.to_string())?;

    let source = data.get("source")
        .and_then(|s| s.as_str())
        .unwrap_or("");
    
    let name = data.get("name")
        .and_then(|n| n.as_str())
        .unwrap_or("skin");
    
    let model = data.get("model")
        .and_then(|m| m.as_str())
        .unwrap_or("classic");

    let skin_id = format!("{}_{}", name.replace(" ", "_"), chrono::Utc::now().timestamp());
    let file_path = skins_dir.join(format!("{}.png", skin_id));

    if source.starts_with("data:image") {
        let base64_data = source
            .split(',')
            .nth(1)
            .unwrap_or(source);
        
        let image_data = base64::engine::general_purpose::STANDARD.decode(base64_data)
            .map_err(|e: base64::DecodeError| e.to_string())?;
        
        fs::write(&file_path, image_data)
            .map_err(|e| e.to_string())?;
    } else if source.starts_with("http") {
        let client = reqwest::Client::new();
        let response = client.get(source)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        
        let bytes = response.bytes()
            .await
            .map_err(|e| e.to_string())?;
        
        fs::write(&file_path, bytes)
            .map_err(|e| e.to_string())?;
    }

    let local_skin = LocalSkin {
        id: skin_id,
        name: name.to_string(),
        path: file_path.to_string_lossy().to_string(),
        model: model.to_string(),
        created_at: chrono::Utc::now().timestamp(),
    };

    Ok(serde_json::json!({
        "success": true,
        "skin": local_skin
    }))
}

#[tauri::command]
pub async fn save_local_skin_from_url(skin_url: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    
    let response = client.get(&skin_url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err("Failed to download skin".to_string());
    }

    let bytes = response.bytes()
        .await
        .map_err(|e| e.to_string())?;

    let skins_dir = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("lux")
        .join("skins");
    
    fs::create_dir_all(&skins_dir).map_err(|e| e.to_string())?;

    let skin_id = format!("skin_{}", chrono::Utc::now().timestamp());
    let file_path = skins_dir.join(format!("{}.png", skin_id));

    fs::write(&file_path, &bytes).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "success": true,
        "skin": {
            "id": skin_id,
            "path": file_path.to_string_lossy().to_string(),
            "url": format!("/local/skins/{}", skin_id),
            "model": "classic"
        }
    }))
}

#[tauri::command]
pub async fn save_local_skin_from_username(username: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    
    let uuid_response = client.get(format!("https://api.mojang.com/users/profiles/minecraft/{}", username))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !uuid_response.status().is_success() {
        return Err("Player not found".to_string());
    }

    let uuid_data: serde_json::Value = uuid_response.json().await.map_err(|e| e.to_string())?;
    let uuid = uuid_data.get("id")
        .and_then(|id| id.as_str())
        .unwrap_or("");

    let profile_response = client.get(format!("https://sessionserver.mojang.com/session/minecraft/profile/{}", uuid))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let profile_data: serde_json::Value = profile_response.json().await.map_err(|e| e.to_string())?;
    
    let textures = profile_data.get("textures")
        .and_then(|t| t.get("SKIN"));
    
    let skin_url = textures
        .and_then(|t| t.get("url"))
        .and_then(|u| u.as_str())
        .ok_or("No skin found")?
        .to_string();

    save_local_skin_from_url(skin_url).await
}

#[tauri::command]
pub async fn upload_skin(token: String, skin_path: String, variant: String) -> Result<serde_json::Value, String> {
    let image_data = fs::read(&skin_path)
        .map_err(|e| e.to_string())?;

    let base64_image = base64::engine::general_purpose::STANDARD.encode(&image_data);

    let client = reqwest::Client::new();
    
    let response = client.post("https://api.mojang.com/user/profile/cape")
        .header("Authorization", format!("Bearer {}", token))
        .json(&serde_json::json!({
            "url": format!("data:image/png;base64,{}", base64_image),
            "variant": variant
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "success": response.status().is_success()
    }))
}

#[tauri::command]
pub async fn upload_skin_from_url(token: String, skin_url: String, variant: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    
    let response = client.get(&skin_url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let bytes = response.bytes()
        .await
        .map_err(|e| e.to_string())?;

    let base64_image = base64::engine::general_purpose::STANDARD.encode(&bytes);

    let upload_response = client.post("https://api.mojang.com/user/profile/cape")
        .header("Authorization", format!("Bearer {}", token))
        .json(&serde_json::json!({
            "url": format!("data:image/png;base64,{}", base64_image),
            "variant": variant
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "success": upload_response.status().is_success()
    }))
}

#[tauri::command]
pub fn get_local_skins() -> Result<Vec<LocalSkin>, String> {
    let skins_dir = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("lux")
        .join("skins");

    if !skins_dir.exists() {
        return Ok(Vec::new());
    }

    let mut skins = Vec::new();
    
    for entry in fs::read_dir(&skins_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        
        if path.extension().and_then(|e| e.to_str()) == Some("png") {
            let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
            
            skins.push(LocalSkin {
                id: path.file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("unknown")
                    .to_string(),
                name: path.file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Unknown")
                    .to_string(),
                path: path.to_string_lossy().to_string(),
                model: "classic".to_string(),
                created_at: metadata.modified()
                    .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64)
                    .unwrap_or(0),
            });
        }
    }

    skins.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    
    Ok(skins)
}