use std::collections::HashMap;
use std::fs;
use std::io::{Seek, SeekFrom, Write};

use axum::body::Bytes;
use axum::extract::{Multipart, Path, Query, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use rand::Rng;
use serde::Deserialize;

use crate::crypto;
use crate::document_engine;
use crate::exif;
use crate::hash_index;
use crate::state::{random_uuid_v4, AppState, ChunkedUpload, ZipTask};
use crate::thumb_cache;
use crate::vault_manager::{self, is_valid_vault_filename};
use super::common::{access_denied, html_response, json_response};
use super::media::{allocate_unique_vault_filename, guess_mime, parse_range_header};

const MAX_UPLOAD_MB: u64 = 2048;
const MAX_UPLOAD_BYTES: u64 = MAX_UPLOAD_MB * 1024 * 1024;
const MAX_CHUNKED_PART_BYTES: u64 = 16 * 1024 * 1024;
const DEFAULT_CHUNKED_PART_BYTES: u64 = 8 * 1024 * 1024;
const CHUNKED_UPLOAD_TTL_MS: u64 = 2 * 60 * 60 * 1000;

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn encode_uri_component(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for b in input.bytes() {
        let keep = b.is_ascii_alphanumeric()
            || matches!(b, b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')');
        if keep {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

async fn read_body(req: Request, limit: usize) -> Result<Vec<u8>, Response> {
    axum::body::to_bytes(req.into_body(), limit)
        .await
        .map(|b| b.to_vec())
        .map_err(|_| json_response(StatusCode::BAD_REQUEST, r#"{"error":"Payload non valido"}"#))
}

fn decode_query_bool(value: Option<&String>) -> bool {
    matches!(value.map(|v| v.as_str()), Some("1") | Some("true"))
}

// ---------------------------------------------------------------------------
// EXIF + mappa
// ---------------------------------------------------------------------------

pub async fn get_exif(
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
    let active = user_folder.join(&filename);
    let trashed = user_folder.join("trash").join(&filename);
    let path = if active.exists() {
        active
    } else if trashed.exists() {
        trashed
    } else {
        return json_response(StatusCode::NOT_FOUND, r#"{"error":"File non trovato"}"#);
    };
    if !exif::is_exif_parseable_filename(&filename) {
        return json_response(
            StatusCode::OK,
            serde_json::json!({
                "filename": filename,
                "exif": exif::empty_exif_metadata(),
                "supported": false,
            })
            .to_string(),
        );
    }
    let enc = match fs::read(&path) {
        Ok(b) => b,
        Err(_) => return json_response(StatusCode::NOT_FOUND, r#"{"error":"File non trovato"}"#),
    };
    let plain = match crypto::decrypt_file(&enc, &sess.api_key) {
        Ok(b) => b,
        Err(_) => {
            return json_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                r#"{"error":"Errore decifratura file"}"#,
            )
        }
    };
    let metadata = exif::parse_exif_from_jpeg(&plain);
    json_response(
        StatusCode::OK,
        serde_json::json!({
            "filename": filename,
            "exif": metadata,
            "supported": true,
        })
        .to_string(),
    )
}

pub async fn get_map_photos(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => return access_denied(),
    };
    let user_folder = state.upload_dir.join(&sess.username);
    let _ = fs::create_dir_all(&user_folder);
    let media = vault_manager::list_media_files(
        &user_folder,
        &state.upload_dir,
        Some(&sess.username),
    );
    let mut items = Vec::new();
    let mut processed = 0u64;
    for item in &media {
        if !item.is_media.unwrap_or(false) || !exif::is_exif_parseable_filename(&item.filename) {
            continue;
        }
        processed += 1;
        let full = user_folder.join(&item.filename);
        let enc = match fs::read(&full) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let plain = match crypto::decrypt_file(&enc, &sess.api_key) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let meta = exif::parse_exif_from_jpeg(&plain);
        if let (Some(lat), Some(lon)) = (meta.latitude, meta.longitude) {
            let timestamp = meta
                .date_time_original_ms
                .map(|ms| ms / 1000)
                .unwrap_or(item.timestamp);
            items.push(serde_json::json!({
                "filename": item.filename,
                "lat": lat,
                "lon": lon,
                "timestamp": timestamp,
                "album": item.album.clone().unwrap_or_default(),
            }));
        }
    }
    json_response(
        StatusCode::OK,
        serde_json::json!({
            "count": items.len(),
            "processed": processed,
            "cacheHits": 0,
            "items": items,
        })
        .to_string(),
    )
}

pub async fn get_map_page(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => {
            return (StatusCode::FOUND, [(header::LOCATION, "/")], "")
                .into_response()
        }
    };
    let template = include_str!("../map_page.html");
    let body = template.replace("__PC_USERNAME__", &escape_html(&sess.username));
    let mut resp = html_response(StatusCode::OK, body);
    let csp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'";
    resp.headers_mut().insert(
        "content-security-policy",
        HeaderValue::from_static(csp),
    );
    resp
}

// ---------------------------------------------------------------------------
// Miniature
// ---------------------------------------------------------------------------

pub async fn get_thumb_stats(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => return access_denied(),
    };
    let user_folder = state.upload_dir.join(&sess.username);
    let stats = thumb_cache::get_user_stats(&user_folder);
    json_response(
        StatusCode::OK,
        serde_json::json!({
            "thumbCount": stats.thumb_count,
            "largeCount": stats.large_count,
            "totalEntries": stats.total_entries,
            "diskBytes": stats.disk_bytes,
            "maxBytes": stats.max_bytes,
            "hits": 0,
            "misses": 0,
            "negativeEntries": stats.negative_entries,
            "queuePending": stats.queue_pending,
            "activeWorkers": 0,
            "totalBytes": stats.disk_bytes,
            "entriesCount": stats.total_entries,
            "variantCount": stats.total_entries,
            "negativeCount": stats.negative_entries,
            "pendingJobs": stats.queue_pending,
            "diskFormatted": vault_manager::format_file_size(stats.disk_bytes),
            "maxFormatted": vault_manager::format_file_size(stats.max_bytes),
        })
        .to_string(),
    )
}

pub async fn post_thumb_rebuild(
    State(state): State<AppState>,
    headers: HeaderMap,
    req: Request,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => return access_denied(),
    };
    let bytes = match read_body(req, 1024 * 1024).await {
        Ok(b) => b,
        Err(resp) => return resp,
    };
    #[derive(Deserialize, Default)]
    struct RebuildPayload {
        force: Option<bool>,
    }
    let payload: RebuildPayload = serde_json::from_slice(&bytes).unwrap_or_default();
    let user_folder = state.upload_dir.join(&sess.username);
    let active: Vec<String> = vault_manager::list_media_files(
        &user_folder,
        &state.upload_dir,
        Some(&sess.username),
    )
    .into_iter()
    .map(|m| m.filename)
    .collect();
    let result = thumb_cache::rebuild_user_thumbnails(
        &user_folder,
        &sess.api_key,
        &active,
        payload.force.unwrap_or(false),
    );
    let message = if result.queued_count > 0 {
        format!(
            "Avviata generazione in background di {} varianti miniature.",
            result.queued_count
        )
    } else {
        "Tutte le miniature supportate sono già aggiornate.".to_string()
    };
    json_response(
        StatusCode::OK,
        serde_json::json!({
            "success": true,
            "queuedCount": result.queued_count,
            "totalActiveImages": result.total_active_images,
            "queued": result.queued_count,
            "totalMedia": result.total_active_images,
            "message": message,
        })
        .to_string(),
    )
}

pub async fn put_thumb(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(filename): Path<String>,
    Query(query): Query<HashMap<String, String>>,
    req: Request,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => return access_denied(),
    };
    if !is_valid_vault_filename(&filename) {
        return json_response(StatusCode::BAD_REQUEST, r#"{"error":"Nome file non valido."}"#);
    }
    let bytes = match axum::body::to_bytes(req.into_body(), 1024 * 1024 + 4096).await {
        Ok(b) => b.to_vec(),
        Err(_) => {
            return json_response(
                StatusCode::PAYLOAD_TOO_LARGE,
                r#"{"error":"Miniatura oltre il limite massimo consentito (1 MB)."}"#,
            )
        }
    };
    let user_folder = state.upload_dir.join(&sess.username);
    let variant = query
        .get("variant")
        .map(|v| v.as_str())
        .filter(|v| *v == "thumb" || *v == "large")
        .unwrap_or("thumb");
    match thumb_cache::put_client_thumbnail(
        &user_folder,
        &filename,
        &bytes,
        &sess.api_key,
        variant,
    ) {
        Ok(size) => json_response(
            StatusCode::OK,
            serde_json::json!({
                "success": true,
                "filename": filename,
                "variant": variant,
                "bytes": size,
            })
            .to_string(),
        ),
        Err("SOURCE_NOT_FOUND") => json_response(
            StatusCode::NOT_FOUND,
            r#"{"error":"File sorgente non trovato."}"#,
        ),
        Err("THUMBNAIL_TOO_LARGE") => json_response(
            StatusCode::PAYLOAD_TOO_LARGE,
            r#"{"error":"Miniatura oltre il limite massimo consentito (1 MB)."}"#,
        ),
        Err(_) => json_response(
            StatusCode::BAD_REQUEST,
            r#"{"error":"Miniatura JPEG non valida."}"#,
        ),
    }
}

// ---------------------------------------------------------------------------
// Cestino batch + duplicati
// ---------------------------------------------------------------------------

pub async fn post_trash_batch(
    State(state): State<AppState>,
    headers: HeaderMap,
    req: Request,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => {
            return json_response(
                StatusCode::FORBIDDEN,
                r#"{"error":"Accesso negato","success":false}"#,
            )
        }
    };
    let bytes = match read_body(req, 1024 * 1024).await {
        Ok(b) => b,
        Err(resp) => return resp,
    };
    #[derive(Deserialize, Default)]
    struct TrashBatchPayload {
        filenames: Option<Vec<String>>,
    }
    let payload: TrashBatchPayload = serde_json::from_slice(&bytes).unwrap_or_default();
    let filenames = match payload.filenames {
        Some(f) => f,
        None => {
            return json_response(
                StatusCode::BAD_REQUEST,
                r#"{"error":"Input non valido","success":false}"#,
            )
        }
    };
    let user_folder = state.upload_dir.join(&sess.username);
    let trash_folder = user_folder.join("trash");
    let _ = fs::create_dir_all(&trash_folder);
    let mut moved = Vec::new();
    let mut errors = Vec::new();
    for raw in filenames {
        if !is_valid_vault_filename(&raw) {
            errors.push(format!("File '{raw}' non trovato o non valido"));
            continue;
        }
        let src = user_folder.join(&raw);
        let dst = trash_folder.join(&raw);
        if !src.exists() {
            errors.push(format!("File '{raw}' non trovato o non valido"));
            continue;
        }
        if dst.exists() {
            errors.push(format!("Errore su {raw}: Un file con questo nome è già nel cestino"));
            continue;
        }
        match fs::rename(&src, &dst) {
            Ok(_) => {
                thumb_cache::invalidate_file(&user_folder, &raw);
                moved.push(raw);
            }
            Err(e) => errors.push(format!("Errore su {raw}: {e}")),
        }
    }
    if !moved.is_empty() {
        hash_index::remove_many_file_hashes(&user_folder, &moved);
    }
    if !errors.is_empty() {
        let status = if moved.is_empty() {
            StatusCode::INTERNAL_SERVER_ERROR
        } else {
            StatusCode::from_u16(207).unwrap()
        };
        return json_response(
            status,
            serde_json::json!({
                "success": !moved.is_empty(),
                "error": errors.join(". "),
            })
            .to_string(),
        );
    }
    json_response(StatusCode::OK, r#"{"success":true}"#)
}

pub async fn post_find_duplicates(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => return access_denied(),
    };
    let user_folder = state.upload_dir.join(&sess.username);
    if !user_folder.exists() {
        return json_response(StatusCode::OK, r#"{"duplicates":[]}"#);
    }
    let media = vault_manager::list_media_files(
        &user_folder,
        &state.upload_dir,
        Some(&sess.username),
    );
    if media.len() < 2 {
        return json_response(StatusCode::OK, r#"{"duplicates":[]}"#);
    }
    let hashed = hash_index::resolve_all_active_hashes(&user_folder, &sess.api_key);
    let mut by_hash: HashMap<String, Vec<String>> = HashMap::new();
    for (filename, sha) in hashed {
        by_hash.entry(sha).or_default().push(filename);
    }
    let mut duplicates: Vec<Vec<String>> = by_hash
        .into_values()
        .filter(|group| group.len() > 1)
        .map(|mut group| {
            group.sort();
            group
        })
        .collect();
    duplicates.sort();
    json_response(
        StatusCode::OK,
        serde_json::json!({ "duplicates": duplicates }).to_string(),
    )
}

// ---------------------------------------------------------------------------
// Backup check
// ---------------------------------------------------------------------------

pub async fn post_backup_check(
    State(state): State<AppState>,
    headers: HeaderMap,
    req: Request,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => return access_denied(),
    };
    let bytes = match read_body(req, 4 * 1024 * 1024).await {
        Ok(b) => b,
        Err(resp) => return resp,
    };
    let value: serde_json::Value = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(_) => {
            return json_response(
                StatusCode::BAD_REQUEST,
                r#"{"error":"Campo items non valido: atteso array"}"#,
            )
        }
    };
    let items = match value.get("items").and_then(|v| v.as_array()) {
        Some(v) => v,
        None => {
            return json_response(
                StatusCode::BAD_REQUEST,
                r#"{"error":"Campo items non valido: atteso array"}"#,
            )
        }
    };
    let mut wanted: Vec<String> = Vec::new();
    for entry in items.iter().take(500) {
        let raw = if let Some(s) = entry.as_str() {
            Some(s.to_string())
        } else {
            entry
                .get("sha256")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        };
        if let Some(raw) = raw {
            if let Some(sha) = hash_index::normalize_sha256_hex(&raw) {
                if !wanted.contains(&sha) {
                    wanted.push(sha);
                }
            }
        }
    }
    let user_folder = state.upload_dir.join(&sess.username);
    let _ = fs::create_dir_all(&user_folder);
    let (existing, pending) = hash_index::check_backup_items(&user_folder, &sess.api_key, &wanted);
    json_response(
        StatusCode::OK,
        serde_json::json!({
            "existingSha256": existing,
            "backfillPending": pending,
            "maxUploadMb": MAX_UPLOAD_MB,
        })
        .to_string(),
    )
}

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------

pub async fn post_prepare_zip(
    State(state): State<AppState>,
    headers: HeaderMap,
    req: Request,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => return access_denied(),
    };
    let bytes = match read_body(req, 1024 * 1024).await {
        Ok(b) => b,
        Err(resp) => return resp,
    };
    #[derive(Deserialize, Default)]
    struct ZipPayload {
        filenames: Option<Vec<String>>,
    }
    let payload: ZipPayload = serde_json::from_slice(&bytes).unwrap_or_default();
    let filenames: Vec<String> = payload
        .filenames
        .unwrap_or_default()
        .into_iter()
        .filter(|f| is_valid_vault_filename(f))
        .take(500)
        .collect();
    if filenames.is_empty() {
        return json_response(StatusCode::BAD_REQUEST, r#"{"error":"Nessun file selezionato"}"#);
    }
    let task_id = random_uuid_v4();
    {
        let mut tasks = state.zip_tasks.write().unwrap();
        tasks.insert(
            task_id.clone(),
            ZipTask {
                owner: sess.username.clone(),
                status: "starting".to_string(),
                progress: 0,
                filename: None,
                total_bytes: 0,
                processed_bytes: 0,
                error: None,
                zip_path: None,
                created_at: crate::state::now_ms(),
            },
        );
    }

    let state_for_task = state.clone();
    let task_id_for_task = task_id.clone();
    let username = sess.username.clone();
    let api_key = sess.api_key.clone();
    let upload_dir = state.upload_dir.clone();
    let temp_dir = state.temp_dir.clone();
    tokio::task::spawn_blocking(move || {
        let user_folder = upload_dir.join(&username);
        let result = build_zip(&user_folder, &filenames, &api_key, &temp_dir, &task_id_for_task, &state_for_task);
        match result {
            Ok((zip_filename, size)) => {
                let zip_path = temp_dir.join(&zip_filename);
                if let Ok(mut tasks) = state_for_task.zip_tasks.write() {
                    if let Some(task) = tasks.get_mut(&task_id_for_task) {
                        task.status = "complete".to_string();
                        task.progress = 100;
                        task.filename = Some(zip_filename);
                        task.total_bytes = size;
                        task.processed_bytes = size;
                        task.zip_path = Some(zip_path);
                    }
                }
            }
            Err(message) => {
                if let Ok(mut tasks) = state_for_task.zip_tasks.write() {
                    if let Some(task) = tasks.get_mut(&task_id_for_task) {
                        task.status = "error".to_string();
                        task.progress = 0;
                        task.error = Some(message);
                    }
                }
            }
        }
    });

    json_response(
        StatusCode::OK,
        serde_json::json!({ "task_id": task_id }).to_string(),
    )
}

fn build_zip(
    user_folder: &std::path::Path,
    filenames: &[String],
    api_key: &str,
    temp_dir: &std::path::Path,
    task_id: &str,
    state: &AppState,
) -> Result<(String, u64), String> {
    let total = filenames.len() as u32;
    let mut total_bytes = 0u64;
    for fname in filenames {
        let path = user_folder.join(fname);
        if let Ok(meta) = fs::metadata(&path) {
            total_bytes += meta.len().saturating_sub(crypto::GCM_OVERHEAD as u64);
        }
    }
    {
        let mut tasks = state.zip_tasks.write().map_err(|_| "lock")?;
        if let Some(task) = tasks.get_mut(task_id) {
            task.status = "processing".to_string();
            task.total_bytes = total_bytes;
        }
    }

    let cursor = std::io::Cursor::new(Vec::new());
    let mut writer = zip::ZipWriter::new(cursor);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let mut processed_bytes = 0u64;

    for (index, fname) in filenames.iter().enumerate() {
        let path = user_folder.join(fname);
        if !path.exists() {
            continue;
        }
        let enc = fs::read(&path).map_err(|e| e.to_string())?;
        let plain = crypto::decrypt_file(&enc, api_key).map_err(|e| e.to_string())?;
        processed_bytes += plain.len() as u64;
        let base = std::path::Path::new(fname)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(fname);
        writer
            .start_file(base, options)
            .map_err(|e| e.to_string())?;
        writer.write_all(&plain).map_err(|e| e.to_string())?;
        let progress = (((index as u32 + 1) * 100) / total.max(1)).min(99);
        if let Ok(mut tasks) = state.zip_tasks.write() {
            if let Some(task) = tasks.get_mut(task_id) {
                task.progress = progress;
                task.processed_bytes = processed_bytes;
            }
        }
    }

    let cursor = writer.finish().map_err(|e| e.to_string())?;
    let zip_bytes = cursor.into_inner();
    fs::create_dir_all(temp_dir).map_err(|e| e.to_string())?;
    let zip_filename = format!("{task_id}.zip");
    let zip_path = temp_dir.join(&zip_filename);
    fs::write(&zip_path, &zip_bytes).map_err(|e| e.to_string())?;
    Ok((zip_filename, zip_bytes.len() as u64))
}

pub async fn get_zip_progress(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(task_id): Path<String>,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => return access_denied(),
    };
    if !crate::state::is_valid_uuid(&task_id) {
        return json_response(
            StatusCode::NOT_FOUND,
            r#"{"status":"not_found","progress":0}"#,
        );
    }
    let tasks = state.zip_tasks.read().unwrap();
    let task = match tasks.get(&task_id) {
        Some(t) if t.owner == sess.username => t,
        _ => {
            return json_response(
                StatusCode::NOT_FOUND,
                r#"{"status":"not_found","progress":0}"#,
            )
        }
    };
    let mut body = serde_json::json!({
        "status": task.status,
        "progress": task.progress,
        "filename": task.filename,
        "totalBytes": task.total_bytes,
        "processedBytes": task.processed_bytes,
    });
    if let Some(err) = &task.error {
        body["error"] = serde_json::json!(err);
    }
    json_response(StatusCode::OK, body.to_string())
}

pub async fn get_download_zip(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(filename): Path<String>,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => return (StatusCode::FORBIDDEN, "Accesso negato").into_response(),
    };
    if !is_valid_vault_filename(&filename) {
        return (StatusCode::NOT_FOUND, "File non trovato").into_response();
    }
    let task_id = filename
        .rsplit_once('.')
        .map(|(stem, _)| stem.to_string())
        .unwrap_or_else(|| filename.clone());
    let zip_path = {
        let mut tasks = state.zip_tasks.write().unwrap();
        let task = match tasks.get(&task_id) {
            Some(t)
                if t.owner == sess.username
                    && t.filename.as_deref() == Some(filename.as_str())
                    && t.status == "complete" =>
            {
                t
            }
            _ => return (StatusCode::NOT_FOUND, "File non trovato").into_response(),
        };
        let path = task.zip_path.clone();
        tasks.remove(&task_id);
        path
    };
    let path = match zip_path {
        Some(p) if p.exists() => p,
        _ => return (StatusCode::NOT_FOUND, "File non trovato").into_response(),
    };
    let bytes = match fs::read(&path) {
        Ok(b) => b,
        Err(_) => return (StatusCode::NOT_FOUND, "File non trovato").into_response(),
    };
    let _ = fs::remove_file(&path);
    let mut resp = (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/zip".to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!(
                    "attachment; filename=\"{}\"",
                    encode_uri_component(&filename)
                ),
            ),
        ],
        bytes,
    )
        .into_response();
    resp.headers_mut()
        .insert("x-content-type-options", HeaderValue::from_static("nosniff"));
    resp
}

// ---------------------------------------------------------------------------
// Anteprima documenti
// ---------------------------------------------------------------------------

pub async fn get_document_preview(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(filename): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => return access_denied(),
    };
    if !is_valid_vault_filename(&filename) {
        return json_response(StatusCode::FORBIDDEN, r#"{"error":"Accesso non autorizzato."}"#);
    }
    let from_trash = query
        .get("from_trash")
        .map(|v| v == "true")
        .unwrap_or(false);
    let user_folder = state.upload_dir.join(&sess.username);
    let base = if from_trash {
        user_folder.join("trash")
    } else {
        user_folder
    };
    let path = base.join(&filename);
    if !path.exists() {
        return json_response(StatusCode::NOT_FOUND, r#"{"error":"File non trovato."}"#);
    }
    let enc = match fs::read(&path) {
        Ok(b) => b,
        Err(_) => {
            return json_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                r#"{"error":"Errore durante l'apertura del documento."}"#,
            )
        }
    };
    let plain = match crypto::decrypt_file(&enc, &sess.api_key) {
        Ok(b) => b,
        Err(_) => {
            return json_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                r#"{"error":"Errore durante l'apertura del documento."}"#,
            )
        }
    };
    let preview = document_engine::parse_document_buffer(&filename, &plain, from_trash);
    json_response(StatusCode::OK, preview.to_string())
}

// ---------------------------------------------------------------------------
// Editor media
// ---------------------------------------------------------------------------

fn ext_of(filename: &str) -> String {
    filename
        .rsplit_once('.')
        .map(|(_, e)| format!(".{}", e.to_lowercase()))
        .unwrap_or_default()
}

fn is_video_ext(ext: &str) -> bool {
    matches!(ext, ".mp4" | ".webm" | ".mov" | ".mkv")
}

fn is_allowed_edit_ext(ext: &str) -> bool {
    matches!(
        ext,
        ".jpg" | ".jpeg" | ".png" | ".webp" | ".mp4" | ".webm" | ".mov" | ".mkv"
    )
}

pub async fn post_media_edit(
    State(state): State<AppState>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => return access_denied(),
    };
    let mut media_buffer: Option<Vec<u8>> = None;
    let mut uploaded_ext = String::new();
    let mut original_filename = String::new();
    let mut mode = "copy".to_string();
    let mut target_extension = String::new();
    let mut base64_payload = String::new();

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or_default().to_string();
        match name.as_str() {
            "file" => {
                if let Some(fname) = field.file_name() {
                    uploaded_ext = ext_of(fname);
                }
                if let Ok(bytes) = field.bytes().await {
                    if !bytes.is_empty() {
                        media_buffer = Some(bytes.to_vec());
                    }
                }
            }
            "originalFilename" => {
                if let Ok(v) = field.text().await {
                    original_filename = v.trim().to_string();
                }
            }
            "mode" => {
                if let Ok(v) = field.text().await {
                    mode = v.trim().to_string();
                }
            }
            "targetExtension" => {
                if let Ok(v) = field.text().await {
                    let v = v.trim().to_lowercase();
                    target_extension = if v.is_empty() {
                        String::new()
                    } else if v.starts_with('.') {
                        v
                    } else {
                        format!(".{v}")
                    };
                }
            }
            "mediaBase64" | "imageBase64" => {
                if let Ok(v) = field.text().await {
                    base64_payload = v;
                }
            }
            _ => {}
        }
    }

    if media_buffer.is_none() && !base64_payload.is_empty() {
        use base64::Engine;
        let raw = base64_payload
            .split_once("base64,")
            .map(|(_, rest)| rest)
            .unwrap_or(base64_payload.as_str());
        if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(raw) {
            media_buffer = Some(bytes);
        }
    }

    let media = match media_buffer {
        Some(b) if !b.is_empty() => b,
        _ => {
            return json_response(
                StatusCode::BAD_REQUEST,
                r#"{"error":"File media modificato non valido o vuoto."}"#,
            )
        }
    };

    let orig_ext = ext_of(&original_filename);
    let chosen_ext = if is_allowed_edit_ext(&target_extension) {
        target_extension.clone()
    } else if is_allowed_edit_ext(&uploaded_ext) {
        uploaded_ext.clone()
    } else if is_allowed_edit_ext(&orig_ext) {
        orig_ext.clone()
    } else {
        ".jpg".to_string()
    };
    let is_video = is_video_ext(&chosen_ext) || is_video_ext(&orig_ext);
    let user_folder = state.upload_dir.join(&sess.username);
    let trash_folder = user_folder.join("trash");
    let _ = fs::create_dir_all(&user_folder);
    let _ = fs::create_dir_all(&trash_folder);

    let mut target_filename = String::new();
    let mut replaced_old_filename = String::new();

    if mode == "overwrite" && !original_filename.is_empty() && is_valid_vault_filename(&original_filename) {
        let candidate = user_folder.join(&original_filename);
        if candidate.exists() {
            if !orig_ext.is_empty() && orig_ext != chosen_ext && is_video_ext(&chosen_ext) {
                let stem = original_filename
                    .rsplit_once('.')
                    .map(|(s, _)| s)
                    .unwrap_or(&original_filename)
                    .chars()
                    .map(|c| {
                        if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                            c
                        } else {
                            '_'
                        }
                    })
                    .collect::<String>();
                let stem = if stem.is_empty() {
                    "video".to_string()
                } else {
                    stem
                };
                let mut candidate_name = format!("{stem}{chosen_ext}");
                if !is_valid_vault_filename(&candidate_name) {
                    candidate_name = format!("{}{chosen_ext}", random_hex(8));
                }
                target_filename = candidate_name;
                replaced_old_filename = original_filename.clone();
            } else {
                target_filename = original_filename.clone();
            }
        }
    }

    if target_filename.is_empty() {
        loop {
            let candidate = format!("{}{chosen_ext}", random_hex(8));
            if !user_folder.join(&candidate).exists() {
                target_filename = candidate;
                break;
            }
        }
    }

    let encrypted = match crypto::encrypt_file(&media, &sess.api_key) {
        Ok(b) => b,
        Err(_) => {
            return json_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                r#"{"error":"Errore salvataggio media modificato."}"#,
            )
        }
    };
    if fs::write(user_folder.join(&target_filename), encrypted).is_err() {
        return json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            r#"{"error":"Errore salvataggio media modificato."}"#,
        );
    }

    if !replaced_old_filename.is_empty() && replaced_old_filename != target_filename {
        let old_path = user_folder.join(&replaced_old_filename);
        if old_path.exists() {
            let _ = fs::remove_file(old_path);
        }
    }

    let mut albums_data = vault_manager::load_user_albums(&state.upload_dir, &sess.username);
    if !original_filename.is_empty() && target_filename != original_filename {
        if let Some(album) = albums_data.file_albums.get(&original_filename).cloned() {
            albums_data
                .file_albums
                .insert(target_filename.clone(), album);
            if !replaced_old_filename.is_empty() {
                albums_data.file_albums.remove(&replaced_old_filename);
            }
            let _ = vault_manager::save_user_albums(&state.upload_dir, &sess.username, &albums_data);
        }
    }

    thumb_cache::invalidate_file(&user_folder, &original_filename);
    if !replaced_old_filename.is_empty() {
        thumb_cache::invalidate_file(&user_folder, &replaced_old_filename);
        hash_index::remove_file_hash(&user_folder, &replaced_old_filename);
    }
    let _ = hash_index::record_file_hash(
        &user_folder,
        &target_filename,
        &hash_index::sha256_hex(&media),
        media.len() as u64,
    );
    thumb_cache::invalidate_file(&user_folder, &target_filename);

    let active = vault_manager::list_media_files(
        &user_folder,
        &state.upload_dir,
        Some(&sess.username),
    );
    let trashed = vault_manager::list_media_files(
        &trash_folder,
        &state.upload_dir,
        Some(&sess.username),
    );
    let stats = vault_manager::compute_cloud_storage_stats(&active, &trashed);
    let message = if mode == "overwrite" {
        if is_video {
            "Video originale aggiornato con successo."
        } else {
            "Foto originale aggiornata con successo."
        }
    } else if is_video {
        "Video modificato salvato come nuova copia."
    } else {
        "Foto modificata salvata come nuova copia."
    };
    let mut body = serde_json::json!({
        "success": true,
        "mode": mode,
        "isVideo": is_video,
        "filename": target_filename,
        "message": message,
        "mediaFiles": active,
        "storageStats": stats,
    });
    if !original_filename.is_empty() {
        body["previousFilename"] = serde_json::json!(original_filename);
    }
    json_response(StatusCode::OK, body.to_string())
}

fn random_hex(bytes: usize) -> String {
    let mut rng = rand::thread_rng();
    let mut buf = vec![0u8; bytes];
    rng.fill(&mut buf[..]);
    hex::encode(buf)
}

// ---------------------------------------------------------------------------
// Upload chunked
// ---------------------------------------------------------------------------

pub async fn post_chunked_init(
    State(state): State<AppState>,
    headers: HeaderMap,
    req: Request,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => return access_denied(),
    };
    let backup_origin = headers
        .get("x-backup-origin")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let bytes = match read_body(req, 1024 * 1024).await {
        Ok(b) => b,
        Err(resp) => return resp,
    };
    #[derive(Deserialize, Default)]
    #[serde(rename_all = "camelCase")]
    struct InitPayload {
        filename: Option<String>,
        total_size: Option<f64>,
        chunk_size_bytes: Option<f64>,
        album: Option<String>,
        timestamp_ms: Option<f64>,
        sha256: Option<String>,
        backup_origin: Option<String>,
    }
    let payload: InitPayload = serde_json::from_slice(&bytes).unwrap_or_default();
    let raw_filename = payload.filename.unwrap_or_default();
    let clean = std::path::Path::new(raw_filename.trim())
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    if clean.is_empty() || clean.len() > 255 {
        return json_response(StatusCode::BAD_REQUEST, r#"{"error":"Nome file non valido"}"#);
    }
    let total_size = match payload.total_size {
        Some(v) if v.is_finite() && v >= 0.0 && v.fract() == 0.0 => v as u64,
        _ => return json_response(StatusCode::BAD_REQUEST, r#"{"error":"totalSize non valido"}"#),
    };
    if total_size > MAX_UPLOAD_BYTES {
        return json_response(
            StatusCode::PAYLOAD_TOO_LARGE,
            serde_json::json!({"error": format!("File oltre il limite massimo consentito ({MAX_UPLOAD_MB} MB)")})
                .to_string(),
        );
    }
    let chunk_size = payload
        .chunk_size_bytes
        .filter(|v| v.is_finite() && *v > 0.0)
        .map(|v| (v.floor() as u64).clamp(1, MAX_CHUNKED_PART_BYTES))
        .unwrap_or(DEFAULT_CHUNKED_PART_BYTES);
    let album = payload
        .album
        .unwrap_or_default()
        .trim()
        .to_string();
    let album = if vault_manager::is_valid_album_name(&album) {
        album
    } else {
        String::new()
    };
    let timestamp_ms = payload
        .timestamp_ms
        .filter(|v| v.is_finite() && *v > 0.0)
        .map(|v| v as u64);
    let has_raw_sha = payload
        .sha256
        .as_ref()
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false);
    let expected_sha = payload
        .sha256
        .as_deref()
        .and_then(hash_index::normalize_sha256_hex);
    let is_auto_backup = backup_origin.trim().eq_ignore_ascii_case("auto")
        || payload
            .backup_origin
            .as_deref()
            .map(|v| v.trim().eq_ignore_ascii_case("auto"))
            .unwrap_or(false);
    if has_raw_sha && expected_sha.is_none() {
        return json_response(
            StatusCode::BAD_REQUEST,
            r#"{"error":"Checksum SHA-256 non valido (attesi 64 caratteri esadecimali)"}"#,
        );
    }
    if is_auto_backup && expected_sha.is_none() {
        return json_response(
            StatusCode::BAD_REQUEST,
            r#"{"error":"Checksum SHA-256 obbligatorio per backup automatico"}"#,
        );
    }

    let _ = fs::create_dir_all(&state.temp_dir);
    let upload_id = random_uuid_v4();
    let temp_part_path = state.temp_dir.join(format!("chunked_{upload_id}.part"));
    let file = match fs::File::create(&temp_part_path) {
        Ok(f) => f,
        Err(_) => {
            return json_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                r#"{"error":"Impossibile allocare file temporaneo upload"}"#,
            )
        }
    };
    if file.set_len(total_size).is_err() {
        let _ = fs::remove_file(&temp_part_path);
        return json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            r#"{"error":"Impossibile allocare file temporaneo upload"}"#,
        );
    }
    drop(file);
    let expected_total_chunks = if total_size == 0 {
        1
    } else {
        (total_size + chunk_size - 1) / chunk_size
    };
    {
        let mut uploads = state.chunked_uploads.write().unwrap();
        uploads.insert(
            upload_id.clone(),
            ChunkedUpload {
                owner: sess.username.clone(),
                filename: clean,
                total_size,
                chunk_size_bytes: chunk_size,
                expected_total_chunks,
                received_chunks: std::collections::HashSet::new(),
                temp_part_path,
                timestamp_ms,
                album,
                expected_sha256: expected_sha,
                is_auto_backup,
                expires_at: crate::state::now_ms() + CHUNKED_UPLOAD_TTL_MS,
            },
        );
    }
    json_response(
        StatusCode::OK,
        serde_json::json!({
            "uploadId": upload_id,
            "chunkSizeBytes": chunk_size,
            "totalChunks": expected_total_chunks,
            "maxUploadMb": MAX_UPLOAD_MB,
        })
        .to_string(),
    )
}

pub async fn put_chunked_part(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((upload_id, chunk_index)): Path<(String, String)>,
    req: Request,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => return access_denied(),
    };
    if !crate::state::is_valid_uuid(&upload_id) {
        return json_response(StatusCode::NOT_FOUND, r#"{"error":"Sessione upload non valida"}"#);
    }
    let chunk_index: u64 = match chunk_index.parse() {
        Ok(v) => v,
        Err(_) => {
            return json_response(StatusCode::BAD_REQUEST, r#"{"error":"Indice chunk non valido"}"#)
        }
    };
    let (temp_path, offset, expected_len, total_chunks) = {
        let uploads = state.chunked_uploads.read().unwrap();
        let upload = match uploads.get(&upload_id) {
            Some(u) if u.owner == sess.username => u,
            _ => {
                return json_response(
                    StatusCode::NOT_FOUND,
                    r#"{"error":"Sessione upload non trovata"}"#,
                )
            }
        };
        if chunk_index >= upload.expected_total_chunks {
            return json_response(
                StatusCode::BAD_REQUEST,
                r#"{"error":"Indice chunk fuori intervallo"}"#,
            );
        }
        let offset = chunk_index * upload.chunk_size_bytes;
        let expected_len = upload
            .chunk_size_bytes
            .min(upload.total_size.saturating_sub(offset));
        (
            upload.temp_part_path.clone(),
            offset,
            expected_len,
            upload.expected_total_chunks,
        )
    };
    let body: Bytes = match axum::body::to_bytes(req.into_body(), MAX_CHUNKED_PART_BYTES as usize + 4096).await {
        Ok(b) => b,
        Err(_) => {
            return json_response(
                StatusCode::PAYLOAD_TOO_LARGE,
                r#"{"error":"Chunk oltre il limite consentito (16 MB)."}"#,
            )
        }
    };
    if body.len() as u64 != expected_len {
        return json_response(
            StatusCode::BAD_REQUEST,
            serde_json::json!({
                "error": format!("Dimensione chunk errata (attesi {} byte, ricevuti {})", expected_len, body.len())
            })
            .to_string(),
        );
    }
    let write_result = (|| -> std::io::Result<()> {
        let mut file = fs::OpenOptions::new().write(true).open(&temp_path)?;
        file.seek(SeekFrom::Start(offset))?;
        if !body.is_empty() {
            file.write_all(&body)?;
        }
        Ok(())
    })();
    if write_result.is_err() {
        return json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            r#"{"error":"Errore scrittura chunk su disco"}"#,
        );
    }
    let received = {
        let mut uploads = state.chunked_uploads.write().unwrap();
        if let Some(upload) = uploads.get_mut(&upload_id) {
            upload.received_chunks.insert(chunk_index);
            upload.expires_at = crate::state::now_ms() + CHUNKED_UPLOAD_TTL_MS;
            upload.received_chunks.len() as u64
        } else {
            0
        }
    };
    json_response(
        StatusCode::OK,
        serde_json::json!({
            "success": true,
            "chunkIndex": chunk_index,
            "receivedChunks": received,
            "totalChunks": total_chunks,
        })
        .to_string(),
    )
}

pub async fn post_chunked_complete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(upload_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
    req: Request,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => return access_denied(),
    };
    if !crate::state::is_valid_uuid(&upload_id) {
        return json_response(
            StatusCode::NOT_FOUND,
            r#"{"error":"Sessione upload non trovata"}"#,
        );
    }
    let skip_list = decode_query_bool(query.get("skipList"));
    let body = read_body(req, 1024 * 1024).await.unwrap_or_default();
    let body_json: serde_json::Value = serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null);
    let skip_list = skip_list
        || body_json.get("skipList").map(|v| v == true || v == "1").unwrap_or(false);

    let upload = {
        let mut uploads = state.chunked_uploads.write().unwrap();
        match uploads.get(&upload_id) {
            Some(u) if u.owner == sess.username => {
                if (u.received_chunks.len() as u64) < u.expected_total_chunks {
                    return json_response(
                        StatusCode::BAD_REQUEST,
                        serde_json::json!({
                            "error": format!(
                                "Upload incompleto ({}/{} chunk ricevuti)",
                                u.received_chunks.len(),
                                u.expected_total_chunks
                            )
                        })
                        .to_string(),
                    );
                }
                uploads.remove(&upload_id)
            }
            _ => {
                return json_response(
                    StatusCode::NOT_FOUND,
                    r#"{"error":"Sessione upload non trovata"}"#,
                )
            }
        }
    };
    let upload = match upload {
        Some(u) => u,
        None => {
            return json_response(
                StatusCode::NOT_FOUND,
                r#"{"error":"Sessione upload non trovata"}"#,
            )
        }
    };

    let user_folder = state.upload_dir.join(&sess.username);
    let trash_folder = user_folder.join("trash");
    let _ = fs::create_dir_all(&user_folder);
    let _ = fs::create_dir_all(&trash_folder);

    let plain = match fs::read(&upload.temp_part_path) {
        Ok(b) => b,
        Err(e) => {
            return json_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                serde_json::json!({"error": format!("Errore finalizzazione upload chunked: {e}")})
                    .to_string(),
            )
        }
    };
    let sha = hash_index::sha256_hex(&plain);
    if let Some(expected) = &upload.expected_sha256 {
        if &sha != expected {
            let _ = fs::remove_file(&upload.temp_part_path);
            return json_response(
                StatusCode::BAD_REQUEST,
                r#"{"error":"Checksum SHA-256 non corrispondente"}"#,
            );
        }
    }
    let unique_name = allocate_unique_vault_filename(&user_folder, &upload.filename);
    let target_path = user_folder.join(&unique_name);
    let encrypted = match crypto::encrypt_file(&plain, &sess.api_key) {
        Ok(b) => b,
        Err(e) => {
            let _ = fs::remove_file(&upload.temp_part_path);
            return json_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                serde_json::json!({"error": format!("Errore finalizzazione upload chunked: {e}")})
                    .to_string(),
            )
        }
    };
    if fs::write(&target_path, encrypted).is_err() {
        let _ = fs::remove_file(&upload.temp_part_path);
        return json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            r#"{"error":"Errore finalizzazione upload chunked"}"#,
        );
    }
    let _ = fs::remove_file(&upload.temp_part_path);

    if let Some(ts_ms) = upload.timestamp_ms {
        let seconds = ts_ms / 1000;
        let nanos = ((ts_ms % 1000) * 1_000_000) as u32;
        if let Some(time) = std::time::SystemTime::UNIX_EPOCH
            .checked_add(std::time::Duration::new(seconds, nanos))
        {
            if let Ok(file) = fs::OpenOptions::new().write(true).open(&target_path) {
                let _ = file.set_modified(time);
            }
        }
    }

    let _ = hash_index::record_file_hash(&user_folder, &unique_name, &sha, plain.len() as u64);

    if !upload.album.is_empty() {
        let mut albums_data = vault_manager::load_user_albums(&state.upload_dir, &sess.username);
        if !albums_data.albums.contains(&upload.album) {
            albums_data.albums.push(upload.album.clone());
            albums_data.albums.sort();
        }
        albums_data
            .file_albums
            .insert(unique_name.clone(), upload.album.clone());
        let _ = vault_manager::save_user_albums(&state.upload_dir, &sess.username, &albums_data);
    }

    let media_files = if skip_list {
        None
    } else {
        Some(vault_manager::list_media_files(
            &user_folder,
            &state.upload_dir,
            Some(&sess.username),
        ))
    };
    let stats = if skip_list {
        None
    } else {
        let active = media_files.clone().unwrap_or_default();
        let trashed = vault_manager::list_media_files(
            &trash_folder,
            &state.upload_dir,
            Some(&sess.username),
        );
        Some(vault_manager::compute_cloud_storage_stats(&active, &trashed))
    };
    json_response(
        StatusCode::OK,
        serde_json::json!({
            "success": true,
            "filename": unique_name,
            "uploadedFilenames": [unique_name],
            "sha256": sha,
            "plaintextSize": plain.len(),
            "mediaFiles": media_files,
            "storageStats": stats,
        })
        .to_string(),
    )
}

// ---------------------------------------------------------------------------
// Helper per il serving dei media (usato anche da media.rs)
// ---------------------------------------------------------------------------

pub fn serve_plain_media(
    bytes: Vec<u8>,
    filename: &str,
    headers: &HeaderMap,
    download: bool,
) -> Response {
    let mime = guess_mime(filename);
    let total_len = bytes.len();
    let ext = filename
        .rsplit_once('.')
        .map(|(_, e)| e.to_lowercase())
        .unwrap_or_default();
    let dangerous = matches!(
        ext.as_str(),
        "html" | "htm" | "xhtml" | "xml" | "js" | "mjs" | "svg"
    );
    let disposition = if download { "attachment" } else { "inline" };
    let content_disposition = format!(
        "{disposition}; filename=\"{}\"",
        encode_uri_component(filename)
    );
    let content_type = if download {
        mime.to_string()
    } else if dangerous {
        let wants_image = headers
            .get("sec-fetch-dest")
            .and_then(|v| v.to_str().ok())
            .map(|v| v == "image")
            .unwrap_or(false);
        if ext == "svg" && wants_image {
            "image/svg+xml".to_string()
        } else {
            "text/plain; charset=utf-8".to_string()
        }
    } else {
        mime.to_string()
    };

    if let Some(range_hdr) = headers.get(header::RANGE).and_then(|h| h.to_str().ok()) {
        if let Some(r) = parse_range_header(range_hdr, total_len) {
            let slice = bytes[r.start..=r.end].to_vec();
            let content_range = format!("bytes {}-{}/{}", r.start, r.end, total_len);
            let mut resp = (
                StatusCode::PARTIAL_CONTENT,
                [
                    (header::CONTENT_TYPE, content_type),
                    (header::CONTENT_RANGE, content_range),
                    (header::ACCEPT_RANGES, "bytes".to_string()),
                    (header::CONTENT_DISPOSITION, content_disposition),
                ],
                slice,
            )
                .into_response();
            resp.headers_mut()
                .insert("x-content-type-options", HeaderValue::from_static("nosniff"));
            resp.headers_mut().insert(
                "content-security-policy",
                HeaderValue::from_static(
                    "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
                ),
            );
            return resp;
        }
    }

    let mut resp = (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, content_type),
            (header::ACCEPT_RANGES, "bytes".to_string()),
            (header::CONTENT_DISPOSITION, content_disposition),
        ],
        bytes,
    )
        .into_response();
    resp.headers_mut()
        .insert("x-content-type-options", HeaderValue::from_static("nosniff"));
    resp
}
