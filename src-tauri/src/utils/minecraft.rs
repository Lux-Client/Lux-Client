use futures_util::StreamExt;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tokio::fs;

#[derive(Debug, Deserialize, Serialize)]
pub struct VersionManifest {
    pub id: String,
    #[serde(rename = "inheritsFrom")]
    pub inherits_from: Option<String>,
    #[serde(rename = "assetIndex")]
    pub asset_index: Option<AssetIndexRef>,
    pub libraries: Vec<Library>,
    #[serde(rename = "mainClass")]
    pub main_class: String,
    #[serde(rename = "minecraftArguments")]
    pub minecraft_arguments: Option<String>,
    pub arguments: Option<Arguments>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AssetIndexRef {
    pub id: String,
    pub sha1: String,
    pub size: u64,
    pub url: String,
    #[serde(rename = "totalSize")]
    pub total_size: u64,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Library {
    pub name: String,
    pub downloads: Option<LibraryDownloads>,
    pub rules: Option<Vec<Rule>>,
    pub natives: Option<HashMap<String, String>>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct LibraryDownloads {
    pub artifact: Option<Artifact>,
    pub classifiers: Option<HashMap<String, Artifact>>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Artifact {
    pub path: String,
    pub sha1: String,
    pub size: u64,
    pub url: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Rule {
    pub action: String,
    pub os: Option<HashMap<String, String>>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Arguments {
    pub game: Vec<serde_json::Value>,
    pub jvm: Vec<serde_json::Value>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AssetIndex {
    pub objects: HashMap<String, AssetObject>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AssetObject {
    pub hash: String,
    pub size: u64,
}

pub struct Downloader {
    client: reqwest::Client,
}

impl Downloader {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
        }
    }

    pub async fn download_parallel(
        &self,
        items: Vec<(String, PathBuf, String)>,
        max_concurrent: usize,
    ) -> anyhow::Result<()> {
        let stream = futures_util::stream::iter(items)
            .map(|(url, path, sha1)| {
                let client = self.client.clone();
                async move {
                    if let Some(parent) = path.parent() {
                        fs::create_dir_all(parent).await?;
                    }

                    // Check if already exists and matches sha1
                    if path.exists() {
                        let content = fs::read(&path).await?;
                        let mut hasher = Sha1::new();
                        hasher.update(&content);
                        let hash = format!("{:x}", hasher.finalize());
                        if hash == sha1 {
                            return Ok::<(), anyhow::Error>(());
                        }
                    }

                    let response = client.get(&url).send().await?;
                    let content = response.bytes().await?;

                    let mut hasher = Sha1::new();
                    hasher.update(&content);
                    let hash = format!("{:x}", hasher.finalize());

                    if hash != sha1 {
                        return Err(anyhow::anyhow!(
                            "SHA1 mismatch for {}: expected {}, got {}",
                            url,
                            sha1,
                            hash
                        ));
                    }

                    fs::write(&path, &content).await?;
                    Ok(())
                }
            })
            .buffer_unordered(max_concurrent);

        let results: Vec<_> = stream.collect().await;
        for res in results {
            res?;
        }
        Ok(())
    }

    pub fn verify_assets_parallel(
        &self,
        asset_root: &Path,
        objects: &HashMap<String, AssetObject>,
    ) -> Vec<(String, PathBuf, String)> {
        objects
            .par_iter()
            .filter_map(|(_name, obj)| {
                let hash = &obj.hash;
                let sub_folder = &hash[0..2];
                let path = asset_root.join("objects").join(sub_folder).join(hash);

                if path.exists() {
                    // Optimized check: verify size first, hashing is expensive
                    if let Ok(meta) = std::fs::metadata(&path) {
                        if meta.len() == obj.size {
                            // Optional: full SHA1 check. For "Fast Launch", maybe skip if size matches?
                            // But let's do it if we want to be safe.
                            let content = std::fs::read(&path).ok()?;
                            let mut hasher = Sha1::new();
                            hasher.update(&content);
                            let result_hash = format!("{:x}", hasher.finalize());
                            if result_hash == *hash {
                                return None;
                            }
                        }
                    }
                }

                let url = format!(
                    "https://resources.download.minecraft.net/{}/{}",
                    sub_folder, hash
                );
                Some((url, path, hash.clone()))
            })
            .collect()
    }
}
