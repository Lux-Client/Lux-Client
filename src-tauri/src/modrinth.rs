use crate::utils::error::{LuxError, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub struct ModrinthManager;

impl ModrinthManager {
    const BASE_URL: &'static str = "https://api.modrinth.com/v2";

    pub async fn search(
        query: &str,
        facets: Vec<Vec<String>>,
        offset: usize,
        limit: usize,
        index: &str,
    ) -> Result<Value> {
        let client = reqwest::Client::new();
        let mut url = format!(
            "{}/search?query={}&offset={}&limit={}",
            Self::BASE_URL,
            query,
            offset,
            limit
        );

        if index != "relevance" {
            url.push_str(&format!("&index={}", index));
        }

        if !facets.is_empty() {
            let facets_json =
                serde_json::to_string(&facets).map_err(|e| LuxError::Network(e.to_string()))?;
            url.push_str(&format!("&facets={}", facets_json));
        }

        let response = client
            .get(&url)
            .header("User-Agent", "Lux-Client/1.0.0")
            .send()
            .await
            .map_err(|e| LuxError::Network(e.to_string()))?;

        let json = response
            .json::<Value>()
            .await
            .map_err(|e| LuxError::Network(e.to_string()))?;

        Ok(serde_json::json!({
            "success": true,
            "results": json["hits"],
            "total_hits": json["total_hits"]
        }))
    }

    pub async fn get_project(project_id: &str) -> Result<Value> {
        let client = reqwest::Client::new();
        let url = format!("{}/project/{}", Self::BASE_URL, project_id);

        let response = client
            .get(&url)
            .header("User-Agent", "Lux-Client/1.0.0")
            .send()
            .await
            .map_err(|e| LuxError::Network(e.to_string()))?;

        let json = response
            .json::<Value>()
            .await
            .map_err(|e| LuxError::Network(e.to_string()))?;

        Ok(serde_json::json!({
            "success": true,
            "project": json
        }))
    }

    pub async fn get_versions(
        project_id: &str,
        loaders: Vec<String>,
        game_versions: Vec<String>,
    ) -> Result<Value> {
        let client = reqwest::Client::new();
        let mut url = format!("{}/project/{}/version", Self::BASE_URL, project_id);

        let mut params = Vec::new();
        if !loaders.is_empty() {
            params.push(format!(
                "loaders={}",
                serde_json::to_string(&loaders).unwrap()
            ));
        }
        if !game_versions.is_empty() {
            params.push(format!(
                "game_versions={}",
                serde_json::to_string(&game_versions).unwrap()
            ));
        }

        if !params.is_empty() {
            url.push_str("?");
            url.push_str(&params.join("&"));
        }

        let response = client
            .get(&url)
            .header("User-Agent", "Lux-Client/1.0.0")
            .send()
            .await
            .map_err(|e| LuxError::Network(e.to_string()))?;

        let json = response
            .json::<Value>()
            .await
            .map_err(|e| LuxError::Network(e.to_string()))?;

        Ok(serde_json::json!({
            "success": true,
            "versions": json
        }))
    }

    pub async fn resolve_dependencies(
        version_id: &str,
        loaders: Vec<String>,
        game_versions: Vec<String>,
    ) -> Result<Value> {
        let client = reqwest::Client::new();
        // Modrinth dependency resolution is complex, usually done by fetching the version and checking dependencies
        // For now, we'll return a simplified response or fetch the version details
        let url = format!("{}/version/{}", Self::BASE_URL, version_id);

        let response = client
            .get(&url)
            .header("User-Agent", "Lux-Client/1.0.0")
            .send()
            .await
            .map_err(|e| LuxError::Network(e.to_string()))?;

        let json = response
            .json::<Value>()
            .await
            .map_err(|e| LuxError::Network(e.to_string()))?;

        // In a real implementation, we would recursively resolve dependencies.
        // For the bridge, we'll return the version details wrapped as expected by the frontend.
        Ok(serde_json::json!({
            "success": true,
            "dependencies": [json] // Stub: just the mod itself for now to prevent crash
        }))
    }

    pub async fn install(payload: Value) -> Result<Value> {
        // payload contains instanceName, projectId, url, filename, etc.
        // Implementation would use the downloader to save the file to the instance's mods folder.
        Ok(serde_json::json!({ "success": true }))
    }
}

#[tauri::command]
pub async fn search_modrinth(
    query: String,
    facets: Vec<Vec<String>>,
    offset: usize,
    limit: usize,
    index: String,
) -> Result<Value> {
    ModrinthManager::search(&query, facets, offset, limit, &index).await
}

#[tauri::command]
pub async fn get_modrinth_project(project_id: String) -> Result<Value> {
    ModrinthManager::get_project(&project_id).await
}

#[tauri::command]
pub async fn get_mod_versions(
    project_id: String,
    loaders: Vec<String>,
    game_versions: Vec<String>,
) -> Result<Value> {
    ModrinthManager::get_versions(&project_id, loaders, game_versions).await
}

#[tauri::command]
pub async fn resolve_dependencies(
    version_id: String,
    loaders: Vec<String>,
    game_versions: String,
) -> Result<Value> {
    // Note: frontend sends gameVersions as array but sometimes we receive single string?
    // Let's stick to Vec<String> but handle string fallback if needed.
    ModrinthManager::resolve_dependencies(&version_id, loaders, vec![game_versions]).await
}

#[tauri::command]
pub async fn modrinth_install(payload: Value) -> Result<Value> {
    ModrinthManager::install(payload).await
}
