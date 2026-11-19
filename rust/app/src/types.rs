use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileCategory {
    Media,
    Document,
    Archive,
    Audio,
    Code,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaItem {
    pub filename: String,
    pub timestamp: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_media: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<FileCategory>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_thumb: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupedMedia {
    pub title: String,
    pub items: Vec<MediaItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthFilePayload {
    pub username: String,
    pub api_key: String,
    pub session_id: String,
    pub created_at: i64,
    pub hash_of_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidBuildConfig {
    pub app_name: String,
    pub package_name: String,
    pub version_name: String,
    pub version_code: u32,
    pub server_url: String,
    pub min_sdk: u32,
    pub target_sdk: u32,
    pub enable_biometric_lock: bool,
    pub enable_offline_cache: bool,
    pub enable_auto_backup: bool,
    pub signing_mode: String,
    pub keystore_alias: String,
}
