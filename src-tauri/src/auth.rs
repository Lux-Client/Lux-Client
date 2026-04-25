use crate::utils::paths;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::oneshot;

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
    pub async fn login(app: &AppHandle) -> Result<UserProfile, String> {
        let (tx, rx) = oneshot::channel();
        let tx = Arc::new(std::sync::Mutex::new(Some(tx)));

        let client_id = "000000004C12D892"; // Example Client ID from msmc
        let redirect_uri = "https://login.live.com/oauth20_desktop.srf";
        let auth_url = format!(
            "https://login.live.com/oauth20_authorize.srf?client_id={}&response_type=code&redirect_uri={}&scope=XboxLive.signin%20offline_access&prompt=select_account",
            client_id, redirect_uri
        );

        let window =
            WebviewWindowBuilder::new(app, "auth", WebviewUrl::App(auth_url.parse().unwrap()))
                .title("Microsoft Login")
                .width(500.0)
                .height(650.0)
                .resizable(false)
                .build()
                .map_err(|e| e.to_string())?;

        let tx_clone = tx.clone();
        window.on_navigation(move |url| {
            let url_str = url.as_str();
            if url_str.starts_with(redirect_uri) {
                if let Some(code) = url
                    .query_pairs()
                    .find(|(k, _)| k == "code")
                    .map(|(_, v)| v.into_owned())
                {
                    if let Ok(mut lock) = tx_clone.lock() {
                        if let Some(sender) = lock.take() {
                            let _ = sender.send(Ok(code));
                        }
                    }
                }
            }
            true
        });

        let code = rx.await.map_err(|_| "Login window closed".to_string())??;
        window.close().map_err(|e| e.to_string())?;

        // Exchange code for tokens (this is very long, simplified for now)
        // In real LuxClient, this would call msmc-equivalent logic.

        Err("MSMC exchange logic not fully implemented yet".to_string())
    }
}

#[tauri::command]
pub async fn login(app: AppHandle) -> Result<UserProfile, String> {
    AuthManager::login(&app).await
}

#[tauri::command]
pub async fn get_profile(app: AppHandle) -> Option<UserProfile> {
    let settings = paths::read_settings(&app);
    serde_json::from_value(settings["userProfile"].clone()).ok()
}
