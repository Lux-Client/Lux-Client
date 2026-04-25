use crate::utils::paths;
use anyhow::{Context, Result};
use reqwest::Client;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use zip::ZipArchive;

const ADOPTIUM_API: &str = "https://api.adoptium.net/v3";

pub async fn download_java(version: u32, runtimes_dir: &Path, app: &AppHandle) -> Result<PathBuf> {
    let os = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "mac"
    } else {
        "linux"
    };
    let arch = if cfg!(target_arch = "x86_64") {
        "x64"
    } else {
        "aarch64"
    };
    let image_type = "jdk";
    let jvm_impl = "hotspot";

    let url = format!("{}/assets/feature_releases/{}/ga?architecture={}&heap_size=normal&image_type={}&jvm_impl={}&os={}", 
        ADOPTIUM_API, version, arch, image_type, jvm_impl, os);

    let client = Client::new();
    let res = client
        .get(&url)
        .send()
        .await?
        .json::<serde_json::Value>()
        .await?;

    let binary = res
        .as_array()
        .and_then(|a| a.first())
        .and_then(|v| v["binaries"].as_array())
        .and_then(|a| a.first())
        .context("No Java release found")?;

    let download_url = binary["package"]["link"]
        .as_str()
        .context("No download link")?;
    let file_name = binary["package"]["name"].as_str().context("No file name")?;

    fs::create_dir_all(runtimes_dir)?;
    let dest_path = runtimes_dir.join(file_name);

    let mut response = client.get(download_url).send().await?;
    let mut file = fs::File::create(&dest_path)?;

    while let Some(chunk) = response.chunk().await? {
        file.write_all(&chunk)?;
    }

    // Extraction
    if file_name.ends_with(".zip") {
        let file = fs::File::open(&dest_path)?;
        let mut archive = ZipArchive::new(file)?;
        archive.extract(runtimes_dir)?;
    } else {
        // Implement tar.gz extraction if needed for linux/mac
        #[cfg(not(windows))]
        {
            use flate2::read::GzDecoder;
            use tar::Archive;
            let tar_gz = fs::File::open(&dest_path)?;
            let tar = GzDecoder::new(tar_gz);
            let mut archive = Archive::new(tar);
            archive.unpack(runtimes_dir)?;
        }
    }

    fs::remove_file(&dest_path)?;

    // Find java binary
    let bin_name = if cfg!(target_os = "windows") {
        "java.exe"
    } else {
        "java"
    };
    for entry in fs::read_dir(runtimes_dir)? {
        let entry = entry?;
        let path = entry.path().join("bin").join(bin_name);
        if path.exists() {
            return Ok(path);
        }
    }

    Err(anyhow::anyhow!("Java binary not found after extraction"))
}
