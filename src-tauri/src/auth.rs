use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UserProfile {
    pub name: String,
    pub uuid: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub exp: Option<u64>,
    pub xuid: Option<String>,
}

pub struct AuthManager;

impl AuthManager {
    pub async fn login(app: &AppHandle) -> crate::utils::error::Result<UserProfile> {
        let client_id = "00000000402b5328"; // Xbox App Client ID for desktop
        let auth_url = format!(
            "https://login.live.com/oauth20_authorize.srf?client_id={}&response_type=code&scope=XboxLive.signin%20offline_access&redirect_uri=https://login.live.com/oauth20_desktop.srf",
            client_id
        );

        let window = WebviewWindowBuilder::new(
            app,
            "ms-auth",
            WebviewUrl::External(
                auth_url
                    .parse::<tauri::Url>()
                    .map_err(|e| crate::utils::error::LuxError::Auth(e.to_string()))?,
            ),
        )
        .title("Microsoft Login - Lux Client")
        .inner_size(500.0, 600.0)
        .build()
        .map_err(|e| crate::utils::error::LuxError::Auth(e.to_string()))?;

        // Loop and wait for the redirect URL containing the code
        let mut auth_code = String::new();
        for _ in 0..600 {
            // 5 minutes timeout
            if let Ok(url) = window.url() {
                if url
                    .as_str()
                    .starts_with("https://login.live.com/oauth20_desktop.srf")
                {
                    if let Some((_, code)) = url.query_pairs().find(|(k, _)| k == "code") {
                        auth_code = code.into_owned();
                        break;
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }

        let _ = window.close();

        if auth_code.is_empty() {
            return Err(crate::utils::error::LuxError::Network(
                "Authentication timed out or failed to parse code.".to_string(),
            ));
        }

        // Perform the full MSMC exchange logically here (Simplified for now)
        let profile = UserProfile {
            name: "LuxUser".to_string(),
            uuid: "00000000-0000-0000-0000-000000000000".to_string(),
            access_token: auth_code, // Normally MC token
            refresh_token: None,
            exp: None,
            xuid: None,
        };

        let _ = Self::save_profile(app, &profile);
        Ok(profile)
    }

    pub fn load_active_profile(app: &AppHandle) -> Option<UserProfile> {
        let path = crate::utils::paths::get_user_data_dir(app).join("profile.json");
        std::fs::read_to_string(path)
            .ok()
            .and_then(|content| serde_json::from_str(&content).ok())
    }

    pub fn save_profile(app: &AppHandle, profile: &UserProfile) -> crate::utils::error::Result<()> {
        let path = crate::utils::paths::get_user_data_dir(app).join("profile.json");
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        std::fs::write(path, serde_json::to_string_pretty(profile)?)?;
        Ok(())
    }
}

#[tauri::command]
pub async fn login(app: AppHandle) -> crate::utils::error::Result<UserProfile> {
    AuthManager::login(&app).await
}

#[tauri::command]
pub async fn get_profile(app: AppHandle) -> Option<UserProfile> {
    AuthManager::load_active_profile(&app)
}
