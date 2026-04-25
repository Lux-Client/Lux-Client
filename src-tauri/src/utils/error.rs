use serde::{Serialize, Serializer};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum LuxError {
    #[error("Authentication failed: {0}")]
    Auth(String),

    #[error("IO Error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Network Error: {0}")]
    Network(String),

    #[error("Instance Error: {0}")]
    Instance(String),

    #[error("Java Error: {0}")]
    Java(String),

    #[error("Serialized JSON Error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Unexpected error: {0}")]
    Unexpected(String),
}

impl Serialize for LuxError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, LuxError>;
