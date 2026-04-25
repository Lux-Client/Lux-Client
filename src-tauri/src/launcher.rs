use crate::utils::{java, minecraft, paths};
use anyhow::Result;
use serde_json::Value;
use std::path::PathBuf;
use std::process::Command;
use tauri::AppHandle;

pub struct Launcher;

impl Launcher {
    pub async fn launch(app: &AppHandle, instance_name: &str) -> Result<()> {
        let instance_dir =
            paths::resolve_instance_dir_by_name(app, instance_name).ok_or_else(|| {
                anyhow::anyhow!(
                    "Instance directory and config not found for {}",
                    instance_name
                )
            })?;
        let config_path = instance_dir.join("instance.json");

        if !config_path.exists() {
            return Err(anyhow::anyhow!("Instance config not found"));
        }

        let config: Value = serde_json::from_str(&std::fs::read_to_string(config_path)?)?;
        let version = config["version"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("Missing version"))?;
        let version_id = config["versionId"].as_str().unwrap_or(version);

        // 1. Resolve version manifest
        let version_json_path = instance_dir
            .join("versions")
            .join(version_id)
            .join(format!("{}.json", version_id));
        if !version_json_path.exists() {
            return Err(anyhow::anyhow!(
                "Version manifest not found at {:?}",
                version_json_path
            ));
        }

        let manifest: minecraft::VersionManifest =
            serde_json::from_str(&std::fs::read_to_string(version_json_path)?)?;

        // 2. Sync Libraries (Parallel)
        let downloader = minecraft::Downloader::new();
        let libraries_dir = instance_dir.join("libraries");
        let mut lib_download_items = Vec::new();
        let mut classpath_entries = Vec::new();

        for lib in manifest.libraries {
            if let Some(downloads) = lib.downloads {
                if let Some(artifact) = downloads.artifact {
                    let lib_path = libraries_dir.join(&artifact.path);
                    lib_download_items.push((artifact.url, lib_path.clone(), artifact.sha1));
                    classpath_entries.push(lib_path);
                }
            }
        }

        // Add game jar to classpath
        let game_jar = instance_dir
            .join("versions")
            .join(version_id)
            .join(format!("{}.jar", version_id));
        classpath_entries.push(game_jar);

        println!("[Launcher] Syncing libraries...");
        downloader.download_parallel(lib_download_items, 10).await?;

        // 3. Sync Assets (Parallel / Fast)
        if let Some(asset_index_ref) = manifest.asset_index {
            let asset_root = paths::get_user_data_dir(app).join("common").join("assets");
            let index_path = asset_root
                .join("indexes")
                .join(format!("{}.json", asset_index_ref.id));

            if !index_path.exists() {
                downloader
                    .download_parallel(
                        vec![(
                            asset_index_ref.url,
                            index_path.clone(),
                            asset_index_ref.sha1,
                        )],
                        1,
                    )
                    .await?;
            }

            let asset_index: minecraft::AssetIndex =
                serde_json::from_str(&std::fs::read_to_string(index_path)?)?;
            println!("[Launcher] Verifying assets in parallel...");
            let asset_download_items =
                downloader.verify_assets_parallel(&asset_root, &asset_index.objects);

            if !asset_download_items.is_empty() {
                println!(
                    "[Launcher] Downloading {} missing assets...",
                    asset_download_items.len()
                );
                downloader
                    .download_parallel(asset_download_items, 15)
                    .await?;
            }
        }

        // 4. Java Selection
        let settings = paths::read_settings(app);
        let java_path_str = settings["javaPath"].as_str().unwrap_or("java");
        let java_path = PathBuf::from(java_path_str);

        // TODO: Use java_metadata cache here
        let _java_meta = java::get_java_metadata(&java_path)?;

        // 5. Construct arguments and launch
        let cp_sep = if cfg!(windows) { ";" } else { ":" };
        let classpath = classpath_entries
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect::<Vec<String>>()
            .join(cp_sep);

        let mut args = Vec::new();
        args.push(format!(
            "-Xmx{}M",
            settings["maxMemory"].as_u64().unwrap_or(4096)
        ));
        args.push(format!(
            "-Xms{}M",
            settings["minMemory"].as_u64().unwrap_or(1024)
        ));
        args.push("-Djava.library.path=natives".to_string()); // Simplified
        args.push("-cp".to_string());
        args.push(classpath);
        args.push(manifest.main_class);

        // Add game arguments...

        println!("[Launcher] Spawning Minecraft...");
        let _child = Command::new(&java_path)
            .args(args)
            .current_dir(&instance_dir)
            .spawn()?;

        // In a real app, we'd manage the child process lifecycle

        Ok(())
    }
}

#[tauri::command]
pub async fn launch_game(app: AppHandle, instance_name: String) -> crate::utils::error::Result<()> {
    Launcher::launch(&app, &instance_name)
        .await
        .map_err(|e| crate::utils::error::LuxError::Unexpected(e.to_string()))
}
