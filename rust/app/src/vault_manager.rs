use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::Path;
use serde::{Deserialize, Serialize};

use crate::crypto;
use crate::types::{FileCategory, MediaItem};
use crate::vault;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UserAlbumsData {
    pub albums: Vec<String>,
    #[serde(rename = "fileAlbums")]
    pub file_albums: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserFavoritesFile {
    pub version: u32,
    pub favorites: Vec<String>,
}

pub fn is_valid_vault_filename(name: &str) -> bool {
    if name.is_empty() || name.len() > 255 {
        return false;
    }
    if name == "__proto__" || name == "constructor" || name == "prototype" {
        return false;
    }
    if name.starts_with('.') {
        return false;
    }
    if name.contains('/') || name.contains('\\') || name.contains(':') {
        return false;
    }
    for b in name.bytes() {
        if b < 0x20 || b == 0x7f {
            return false;
        }
    }
    true
}

pub fn is_valid_album_name(name: &str) -> bool {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.len() > 128 {
        return false;
    }
    if trimmed == "__proto__" || trimmed == "constructor" || trimmed == "prototype" {
        return false;
    }
    for b in trimmed.bytes() {
        if b < 0x20 || b == 0x7f {
            return false;
        }
    }
    true
}

pub fn classify_file_extension(filename: &str) -> (bool, FileCategory) {
    let lower = filename.to_lowercase();
    let ext = lower.rsplit('.').next().map(|e| format!(".{}", e)).unwrap_or_default();
    match ext.as_str() {
        ".jpg" | ".jpeg" | ".png" | ".gif" | ".webp" | ".bmp" | ".svg" | ".heic" | ".avif"
        | ".mp4" | ".mov" | ".webm" | ".mkv" => (true, FileCategory::Media),
        ".pdf" | ".doc" | ".docx" | ".xls" | ".xlsx" | ".ppt" | ".pptx" | ".odt" | ".ods"
        | ".odp" | ".rtf" | ".txt" | ".md" | ".csv" | ".tsv" => (false, FileCategory::Document),
        ".zip" | ".rar" | ".7z" | ".tar" | ".gz" | ".bz2" | ".apk" | ".iso" | ".dmg" | ".exe" => {
            (false, FileCategory::Archive)
        }
        ".mp3" | ".wav" | ".flac" | ".aac" | ".ogg" | ".m4a" | ".opus" => {
            (false, FileCategory::Audio)
        }
        ".json" | ".xml" | ".yaml" | ".yml" | ".js" | ".ts" | ".tsx" | ".jsx" | ".py" | ".kt"
        | ".java" | ".c" | ".cpp" | ".h" | ".html" | ".htm" | ".css" | ".sql" | ".sh"
        | ".ini" | ".conf" | ".log" => (false, FileCategory::Code),
        _ => (false, FileCategory::Other),
    }
}

pub fn get_albums_file_path(user_media: &Path, username: &str) -> std::path::PathBuf {
    user_media.join(username).join(".albums.json")
}

pub fn load_user_albums(user_media: &Path, username: &str) -> UserAlbumsData {
    let p = get_albums_file_path(user_media, username);
    vault::read_json_file(&p, UserAlbumsData::default())
}

pub fn save_user_albums(
    user_media: &Path,
    username: &str,
    data: &UserAlbumsData,
) -> io::Result<()> {
    let p = get_albums_file_path(user_media, username);
    vault::write_json_atomic(&p, data)
}

pub fn get_favorites_file_path(user_media: &Path, username: &str) -> std::path::PathBuf {
    user_media.join(username).join(".favorites.json")
}

pub fn load_user_favorites(user_media: &Path, username: &str) -> Vec<String> {
    let p = get_favorites_file_path(user_media, username);
    let data: UserFavoritesFile = vault::read_json_file(
        &p,
        UserFavoritesFile {
            version: 1,
            favorites: Vec::new(),
        },
    );
    data.favorites
}

pub fn save_user_favorites(
    user_media: &Path,
    username: &str,
    favorites: &[String],
) -> io::Result<()> {
    let mut sorted = favorites.to_vec();
    sorted.sort();
    sorted.dedup();
    let file = UserFavoritesFile {
        version: 1,
        favorites: sorted,
    };
    let p = get_favorites_file_path(user_media, username);
    vault::write_json_atomic(&p, &file)
}

pub fn list_media_files(
    folder_path: &Path,
    user_media: &Path,
    username: Option<&str>,
) -> Vec<MediaItem> {
    if !folder_path.exists() {
        return Vec::new();
    }
    let albums_data = username
        .map(|u| load_user_albums(user_media, u))
        .unwrap_or_default();
    let mut details = Vec::new();

    if let Ok(entries) = fs::read_dir(folder_path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if !is_valid_vault_filename(name) {
                    continue;
                }
                if let Ok(meta) = entry.metadata() {
                    if meta.is_file() {
                        let (is_media, category) = classify_file_extension(name);
                        let file_size = meta.len();
                        let original_size = file_size.saturating_sub(crypto::GCM_OVERHEAD as u64);
                        let mtime = meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                        let timestamp = mtime
                            .duration_since(std::time::SystemTime::UNIX_EPOCH)
                            .map(|d| d.as_secs_f64())
                            .unwrap_or(0.0);
                        let album = albums_data.file_albums.get(name).cloned().unwrap_or_default();
                        details.push(MediaItem {
                            filename: name.to_string(),
                            timestamp: timestamp as i64,
                            size: Some(original_size),
                            is_media: Some(is_media),
                            category: Some(category),
                            album: Some(album),
                            has_thumb: Some(false),
                        });
                    }
                }
            }
        }
    }
    details.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    details
}

pub fn format_file_size(bytes: u64) -> String {
    if bytes == 0 {
        return "0 B".to_string();
    }
    let k = 1024.0;
    let sizes = ["B", "KB", "MB", "GB", "TB"];
    let i = (bytes as f64).log(k).floor() as usize;
    let i = i.min(sizes.len() - 1);
    let val = (bytes as f64) / k.powi(i as i32);
    format!("{:.1} {}", val, sizes[i])
}

pub fn compute_cloud_storage_stats(
    active_files: &[MediaItem],
    trashed_files: &[MediaItem],
) -> serde_json::Value {
    let mut media_bytes: u64 = 0;
    let mut media_count: u64 = 0;
    let mut files_bytes: u64 = 0;
    let mut files_count: u64 = 0;

    for item in active_files {
        let is_media = item.is_media.unwrap_or(false);
        let sz = item.size.unwrap_or(0);
        if is_media {
            media_bytes += sz;
            media_count += 1;
        } else {
            files_bytes += sz;
            files_count += 1;
        }
    }

    let mut trash_bytes: u64 = 0;
    let mut trash_count: u64 = 0;
    for item in trashed_files {
        trash_bytes += item.size.unwrap_or(0);
        trash_count += 1;
    }

    let active_bytes = media_bytes + files_bytes;
    let active_count = media_count + files_count;
    let grand_total_bytes = active_bytes + trash_bytes;
    let grand_total_count = active_count + trash_count;

    let media_pct = if grand_total_bytes > 0 {
        ((media_bytes as f64 / grand_total_bytes as f64) * 100.0 * 10.0).round() / 10.0
    } else {
        0.0
    };
    let files_pct = if grand_total_bytes > 0 {
        ((files_bytes as f64 / grand_total_bytes as f64) * 100.0 * 10.0).round() / 10.0
    } else {
        0.0
    };
    let trash_pct = if grand_total_bytes > 0 {
        ((trash_bytes as f64 / grand_total_bytes as f64) * 100.0 * 10.0).round() / 10.0
    } else {
        0.0
    };

    serde_json::json!({
        "mediaBytes": media_bytes,
        "mediaCount": media_count,
        "filesBytes": files_bytes,
        "filesCount": files_count,
        "activeBytes": active_bytes,
        "activeTotalBytes": active_bytes,
        "activeCount": active_count,
        "trashBytes": trash_bytes,
        "trashCount": trash_count,
        "grandTotalBytes": grand_total_bytes,
        "grandTotalCount": grand_total_count,
        "mediaPct": media_pct,
        "filesPct": files_pct,
        "trashPct": trash_pct,
        "mediaPercent": media_pct,
        "filesPercent": files_pct,
        "trashPercent": trash_pct,
        "mediaFormatted": format_file_size(media_bytes),
        "filesFormatted": format_file_size(files_bytes),
        "activeTotalFormatted": format_file_size(active_bytes),
        "trashFormatted": format_file_size(trash_bytes),
        "grandTotalFormatted": format_file_size(grand_total_bytes),
        "thumbCacheBytes": 0,
    })
}
