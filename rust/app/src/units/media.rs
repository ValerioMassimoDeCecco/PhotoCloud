use axum::extract::{Multipart, Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use std::collections::HashMap;
use std::fs;
use std::path::Path as StdPath;

use crate::crypto;
use crate::state::AppState;
use crate::thumb_cache;
use crate::vault_manager::{is_valid_vault_filename, load_user_albums, save_user_albums};
use super::common::{access_denied, json_response};
use super::extras::serve_plain_media;

pub fn allocate_unique_vault_filename(user_folder: &StdPath, raw_name: &str) -> String {
    let clean = StdPath::new(raw_name)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(raw_name);
    let mut candidate = clean.to_string();
    if !user_folder.join(&candidate).exists() {
        return candidate;
    }
    let (stem, ext) = match clean.rfind('.') {
        Some(idx) => (&clean[..idx], &clean[idx..]),
        None => (clean, ""),
    };
    let mut counter = 1;
    loop {
        candidate = format!("{stem} ({counter}){ext}");
        if !user_folder.join(&candidate).exists() {
            return candidate;
        }
        counter += 1;
    }
}

pub fn guess_mime(filename: &str) -> &'static str {
    let lower = filename.to_lowercase();
    let ext = lower.rsplit('.').next().map(|e| format!(".{}", e)).unwrap_or_default();
    match ext.as_str() {
        ".jpg" | ".jpeg" => "image/jpeg",
        ".png" => "image/png",
        ".gif" => "image/gif",
        ".webp" => "image/webp",
        ".bmp" => "image/bmp",
        ".svg" => "image/svg+xml",
        ".mp4" => "video/mp4",
        ".mov" => "video/quicktime",
        ".webm" => "video/webm",
        ".mkv" => "video/x-matroska",
        ".mp3" => "audio/mpeg",
        ".wav" => "audio/wav",
        ".pdf" => "application/pdf",
        ".txt" | ".md" => "text/plain; charset=utf-8",
        ".json" => "application/json",
        ".zip" => "application/zip",
        _ => "application/octet-stream",
    }
}

pub struct ByteRange {
    pub start: usize,
    pub end: usize,
}

pub fn parse_range_header(header: &str, total_len: usize) -> Option<ByteRange> {
    if total_len == 0 {
        return None;
    }
    let trimmed = header.trim();
    if !trimmed.starts_with("bytes=") {
        return None;
    }
    let spec = &trimmed[6..];
    if let Some((start_str, end_str)) = spec.split_once('-') {
        let start = start_str.trim().parse::<usize>().ok()?;
        let end = if end_str.trim().is_empty() {
            total_len - 1
        } else {
            end_str.trim().parse::<usize>().ok()?.min(total_len - 1)
        };
        if start <= end && start < total_len {
            return Some(ByteRange { start, end });
        }
    }
    None
}

// POST /upload
pub async fn post_upload(
    State(state): State<AppState>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => return access_denied(),
    };

    let user_folder = state.upload_dir.join(&sess.username);
    let _ = fs::create_dir_all(&user_folder);

    let mut uploaded_filenames = Vec::new();
    let mut target_album: Option<String> = None;
    let mut timestamps: Vec<u64> = Vec::new();
    let mut skip_list = false;

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or_default().to_string();
        if name == "album" {
            if let Ok(val) = field.text().await {
                let trimmed = val.trim().to_string();
                if !trimmed.is_empty() {
                    target_album = Some(trimmed);
                }
            }
            continue;
        }
        if name == "skipList" {
            if let Ok(val) = field.text().await {
                skip_list = matches!(val.trim(), "1" | "true");
            }
            continue;
        }
        if name == "timestamp[]" || name == "timestamp" {
            if let Ok(val) = field.text().await {
                if let Ok(ts) = val.trim().parse::<u64>() {
                    timestamps.push(ts);
                }
            }
            continue;
        }

        let file_orig_name = field
            .file_name()
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("file_{}", std::time::SystemTime::now().duration_since(std::time::SystemTime::UNIX_EPOCH).unwrap().as_millis()));

        let data = match field.bytes().await {
            Ok(b) => b,
            Err(_) => continue,
        };

        let unique_name = allocate_unique_vault_filename(&user_folder, &file_orig_name);
        let out_path = user_folder.join(&unique_name);

        match crypto::encrypt_file(&data, &sess.api_key) {
            Ok(encrypted) => {
                if fs::write(&out_path, encrypted).is_ok() {
                    let ts_index = uploaded_filenames.len();
                    if let Some(ts_ms) = timestamps.get(ts_index) {
                        let seconds = *ts_ms / 1000;
                        let nanos = ((*ts_ms % 1000) * 1_000_000) as u32;
                        if let Some(time) = std::time::SystemTime::UNIX_EPOCH
                            .checked_add(std::time::Duration::new(seconds, nanos))
                        {
                            if let Ok(file) = fs::OpenOptions::new().write(true).open(&out_path) {
                                let _ = file.set_modified(time);
                            }
                        }
                    }
                    uploaded_filenames.push(unique_name);
                }
            }
            Err(_) => continue,
        }
    }

    if let Some(album) = target_album {
        if !uploaded_filenames.is_empty() {
            let mut albums_data = load_user_albums(&state.upload_dir, &sess.username);
            if !albums_data.albums.contains(&album) {
                albums_data.albums.push(album.clone());
                albums_data.albums.sort();
            }
            for f in &uploaded_filenames {
                albums_data.file_albums.insert(f.clone(), album.clone());
            }
            let _ = save_user_albums(&state.upload_dir, &sess.username, &albums_data);
        }
    }

    let media_files = if skip_list {
        None
    } else {
        Some(crate::vault_manager::list_media_files(
            &user_folder,
            &state.upload_dir,
            Some(&sess.username),
        ))
    };
    let storage_stats = if skip_list {
        None
    } else {
        let active = media_files.clone().unwrap_or_default();
        let trashed = crate::vault_manager::list_media_files(
            &user_folder.join("trash"),
            &state.upload_dir,
            Some(&sess.username),
        );
        Some(crate::vault_manager::compute_cloud_storage_stats(&active, &trashed))
    };
    let resp = serde_json::json!({
        "success": true,
        "files": uploaded_filenames,
        "uploaded": uploaded_filenames.len(),
        "mediaFiles": media_files,
        "storageStats": storage_stats,
    });
    json_response(StatusCode::OK, resp.to_string())
}

// GET /media/:filename
pub async fn get_media(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(filename): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    handle_media(state, headers, filename, &query, false).await
}

// GET /trash/media/:filename
pub async fn get_trash_media(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(filename): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    handle_media(state, headers, filename, &query, true).await
}

async fn handle_media(
    state: AppState,
    headers: HeaderMap,
    filename: String,
    query: &HashMap<String, String>,
    force_trash: bool,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => return access_denied(),
    };

    if !is_valid_vault_filename(&filename) {
        return (StatusCode::BAD_REQUEST, "Nome file non valido").into_response();
    }

    let from_trash = force_trash
        || matches!(query.get("from_trash").map(|v| v.as_str()), Some("1") | Some("true"));
    let download = matches!(query.get("download").map(|v| v.as_str()), Some("1") | Some("true"));
    let preview = query.get("preview").map(|v| v.as_str()).unwrap_or("");

    let user_folder = state.upload_dir.join(&sess.username);
    let base = if from_trash {
        user_folder.join("trash")
    } else {
        user_folder.clone()
    };
    let file_path = base.join(&filename);
    if !file_path.exists() {
        return (StatusCode::NOT_FOUND, "File non trovato").into_response();
    }

    if !download && !from_trash && matches!(preview, "thumb" | "large") {
        if let Some(thumb) =
            thumb_cache::get_or_create_thumbnail(&user_folder, &filename, preview, &sess.api_key)
        {
            let preview_name = format!("preview_{filename}.jpg");
            let mut resp = serve_plain_media(thumb, &preview_name, &headers, false);
            resp.headers_mut().insert(
                header::CACHE_CONTROL,
                axum::http::HeaderValue::from_static("private, max-age=86400"),
            );
            return resp;
        }
    }

    let enc_bytes = match fs::read(&file_path) {
        Ok(b) => b,
        Err(_) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "Errore lettura file").into_response()
        }
    };

    let plain_bytes = match crypto::decrypt_file(&enc_bytes, &sess.api_key) {
        Ok(b) => b,
        Err(_) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "Errore decifratura").into_response()
        }
    };

    serve_plain_media(plain_bytes, &filename, &headers, download)
}

// POST /trash/:filename
pub async fn post_trash_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(filename): Path<String>,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => return access_denied(),
    };

    if !is_valid_vault_filename(&filename) {
        return json_response(StatusCode::BAD_REQUEST, r#"{"error":"Nome file non valido"}"#);
    }

    let user_folder = state.upload_dir.join(&sess.username);
    let trash_folder = user_folder.join("trash");
    let _ = fs::create_dir_all(&trash_folder);

    let src = user_folder.join(&filename);
    let dst = trash_folder.join(&filename);

    if src.exists() {
        let _ = fs::rename(src, dst);
        json_response(StatusCode::OK, r#"{"success":true}"#)
    } else {
        json_response(StatusCode::NOT_FOUND, r#"{"error":"File non trovato"}"#)
    }
}

// POST /restore/:filename
pub async fn post_restore_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(filename): Path<String>,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => return access_denied(),
    };

    if !is_valid_vault_filename(&filename) {
        return json_response(StatusCode::BAD_REQUEST, r#"{"error":"Nome file non valido"}"#);
    }

    let user_folder = state.upload_dir.join(&sess.username);
    let trash_folder = user_folder.join("trash");

    let src = trash_folder.join(&filename);
    let dst = user_folder.join(&filename);

    if src.exists() {
        let _ = fs::rename(src, dst);
        json_response(StatusCode::OK, r#"{"success":true}"#)
    } else {
        json_response(StatusCode::NOT_FOUND, r#"{"error":"File non trovato nel cestino"}"#)
    }
}

// POST /delete_permanent/:filename
pub async fn post_delete_permanent(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(filename): Path<String>,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => return access_denied(),
    };

    if !is_valid_vault_filename(&filename) {
        return json_response(StatusCode::BAD_REQUEST, r#"{"error":"Nome file non valido"}"#);
    }

    let user_folder = state.upload_dir.join(&sess.username);
    let trash_path = user_folder.join("trash").join(&filename);
    let active_path = user_folder.join(&filename);

    if trash_path.exists() {
        let _ = fs::remove_file(trash_path);
        json_response(StatusCode::OK, r#"{"success":true}"#)
    } else if active_path.exists() {
        let _ = fs::remove_file(active_path);
        json_response(StatusCode::OK, r#"{"success":true}"#)
    } else {
        json_response(StatusCode::NOT_FOUND, r#"{"error":"File non trovato"}"#)
    }
}

// POST /empty_trash
pub async fn post_empty_trash(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => return access_denied(),
    };

    let trash_folder = state.upload_dir.join(&sess.username).join("trash");
    if trash_folder.exists() {
        if let Ok(entries) = fs::read_dir(&trash_folder) {
            for entry in entries.flatten() {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
    json_response(StatusCode::OK, r#"{"success":true}"#)
}
