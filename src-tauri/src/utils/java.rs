use crate::utils::error::LuxError;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
pub struct JavaMetadata {
    pub path: PathBuf,
    pub version: u32,
    pub is_64bit: bool,
}

pub fn get_java_metadata(java_path: &Path) -> crate::utils::error::Result<JavaMetadata> {
    let output = Command::new(java_path)
        .arg("-version")
        .output()
        .map_err(|e| LuxError::Java(format!("Failed to execute java -version: {}", e)))?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let combined = format!("{}{}", stderr, stdout);

    let version_match =
        regex::Regex::new(r#"(?:version|jd[kj])\s*["']?(\d+)(?:\.(\d+))?(?:\.(\d+))?"#)
            .map_err(|e| LuxError::Java(format!("Regex error: {}", e)))?
            .captures(&combined)
            .ok_or_else(|| {
                LuxError::Java("Could not parse java version from output".to_string())
            })?;

    let mut major = version_match[1]
        .parse::<u32>()
        .map_err(|e| LuxError::Java(format!("Failed to parse major version: {}", e)))?;

    if major == 1 {
        major = version_match[2].parse::<u32>().unwrap_or(8);
    }

    let is_64bit = combined.contains("64-Bit");

    Ok(JavaMetadata {
        path: java_path.to_path_buf(),
        version: major,
        is_64bit,
    })
}
