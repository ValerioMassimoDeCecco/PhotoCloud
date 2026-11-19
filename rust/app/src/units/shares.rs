use axum::extract::{Multipart, Path, Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use rand::Rng;
use serde::Deserialize;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use crate::crypto;
use crate::sharing::{self, PublicShareRecord, ShareResolveError};
use crate::state::AppState;
use crate::vault;
use crate::vault_manager::{self, is_valid_album_name, is_valid_vault_filename};
use super::common::{access_denied, html_response, json_response};
use super::media::{guess_mime, parse_range_header};

const SHARE_PAGE_TEMPLATE: &str = include_str!("../share_page.html");
const SHARE_PASSWORD_TEMPLATE: &str = include_str!("../share_password.html");
const SHARE_ERROR_TEMPLATE: &str = include_str!("../share_error.html");

#[derive(Debug, Deserialize, Default)]
pub struct CreateSharePayload {
    pub filenames: Option<Vec<String>>,
    pub label: Option<String>,
    #[serde(rename = "expiresInHours")]
    pub expires_in_hours: Option<f64>,
    #[serde(rename = "maxDownloads")]
    pub max_downloads: Option<f64>,
    pub password: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct DeleteSharePayload {
    pub id: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct AlbumSharePayload {
    pub album: Option<String>,
    pub username: Option<String>,
    pub role: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct UnlockPayload {
    pub password: Option<String>,
}

fn parse_json_body<T: for<'de> Deserialize<'de> + Default>(bytes: &[u8]) -> T {
    serde_json::from_slice(bytes).unwrap_or_default()
}

async fn read_body(req: Request, limit: usize) -> Result<Vec<u8>, Response> {
    axum::body::to_bytes(req.into_body(), limit)
        .await
        .map(|b| b.to_vec())
        .map_err(|_| json_response(StatusCode::BAD_REQUEST, r#"{"error":"Payload non valido"}"#))
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

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn cookie_value(headers: &HeaderMap, name: &str) -> Option<String> {
    let cookie = headers.get(header::COOKIE)?.to_str().ok()?;
    for part in cookie.split(';') {
        let trimmed = part.trim();
        if let Some((k, v)) = trimmed.split_once('=') {
            if k.trim() == name {
                return Some(v.trim().to_string());
            }
        }
    }
    None
}

fn media_kind(filename: &str) -> &'static str {
    let ext = filename
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "svg" | "heic" | "avif" => "image",
        "mp4" | "mov" | "webm" | "mkv" => "video",
        _ => "file",
    }
}

fn format_expiry(expires_at: i64) -> String {
    if expires_at <= 0 {
        return "nessuna scadenza".to_string();
    }
    if let Some(dt) = chrono::DateTime::from_timestamp_millis(expires_at) {
        let local: chrono::DateTime<chrono::Local> = dt.into();
        return local.format("%d/%m/%Y %H:%M").to_string();
    }
    "data sconosciuta".to_string()
}

fn render_error_page(state: &str) -> String {
    let (title, body) = match state {
        "expired" => (
            "⏰ Link scaduto",
            "Questo link di condivisione è scaduto e non è più disponibile.",
        ),
        "exhausted" => (
            "📦 Limite raggiunto",
            "Questo link ha raggiunto il numero massimo di download consentiti.",
        ),
        _ => (
            "❌ Link non valido",
            "Questo link di condivisione non esiste o è stato revocato dal proprietario.",
        ),
    };
    SHARE_ERROR_TEMPLATE
        .replace("__PC_TITLE__", &escape_html(title))
        .replace("__PC_BODY__", &escape_html(body))
}

fn render_password_page(token: &str, error: &str) -> String {
    let error_html = if error.is_empty() {
        String::new()
    } else {
        format!(r#"<div class="lock-error">{}</div>"#, escape_html(error))
    };
    SHARE_PASSWORD_TEMPLATE
        .replace("__PC_TOKEN__", token)
        .replace("__PC_ERROR__", &error_html)
}

fn share_cookie_name(record: &PublicShareRecord) -> String {
    format!("pc_share_{}", &record.id[..record.id.len().min(16)])
}

fn is_share_unlocked(
    headers: &HeaderMap,
    secret: &[u8; 32],
    token: &str,
    record: &PublicShareRecord,
) -> bool {
    if record.password_hash.is_none() {
        return true;
    }
    let cookie = match cookie_value(headers, &share_cookie_name(record)) {
        Some(v) => v,
        None => return false,
    };
    let expected = sharing::share_unlock_cookie_value(secret, token);
    cookie == expected
}

fn render_share_page(
    token: &str,
    record: &PublicShareRecord,
    filenames: &[String],
) -> String {
    let title = if record.label.trim().is_empty() {
        format!("Condivisione di {}", record.owner)
    } else {
        record.label.clone()
    };

    let mut cards = Vec::new();
    let mut has_media = false;
    for filename in filenames {
        let kind = media_kind(filename);
        if kind != "file" {
            has_media = true;
        }
        let enc = encode_uri_component(filename);
        let url = format!("/share/{token}/media/{enc}");
        let preview = format!("{url}?preview=thumb");
        let large = format!("{url}?preview=large");
        let safe_name = escape_html(filename);
        let inner = if kind == "image" || kind == "video" {
            format!(
                r#"<img loading="lazy" src="{preview}" alt="{safe_name}">"#
            )
        } else {
            let ext = filename
                .rsplit('.')
                .next()
                .unwrap_or("FILE")
                .to_uppercase();
            format!(
                r#"<div class="file-chip"><span class="ext">{}</span></div>"#,
                escape_html(&ext)
            )
        };
        cards.push(format!(
            r#"<a class="share-card" href="{url}?download=1" data-url="{url}" data-preview-url="{preview}" data-large-url="{large}" data-kind="{kind}" data-name="{safe_name}">{inner}<span class="file-name">{safe_name}</span></a>"#
        ));
    }

    let slideshow_btn = if has_media {
        r#"<button type="button" class="share-btn" id="ss-main-btn">▶ Slideshow</button>"#.to_string()
    } else {
        String::new()
    };
    let max_attr = match record.max_downloads {
        Some(v) if v > 0 => format!(r#" data-max-downloads="{v}""#),
        _ => String::new(),
    };
    let meta = format!(
        "{} elementi · condivisi da <strong>{}</strong> · scade il {}",
        filenames.len(),
        escape_html(&record.owner),
        escape_html(&format_expiry(record.expires_at))
    );

    SHARE_PAGE_TEMPLATE
        .replace("__PC_TITLE__", &escape_html(&title))
        .replace("__PC_CARDS__", &cards.join("\n"))
        .replace("__PC_META__", &meta)
        .replace("__PC_SLIDESHOW_BTN__", &slideshow_btn)
        .replace("__PC_MAX_DOWNLOADS_ATTR__", &max_attr)
}

fn serve_bytes(
    bytes: Vec<u8>,
    filename: &str,
    headers: &HeaderMap,
    download: bool,
) -> Response {
    let mime = guess_mime(filename);
    let total_len = bytes.len();
    let disposition = if download { "attachment" } else { "inline" };
    let content_disposition = format!(
        "{disposition}; filename=\"{}\"",
        encode_uri_component(filename)
    );

    if let Some(range_hdr) = headers.get(header::RANGE).and_then(|h| h.to_str().ok()) {
        if let Some(r) = parse_range_header(range_hdr, total_len) {
            let slice = bytes[r.start..=r.end].to_vec();
            let content_range = format!("bytes {}-{}/{}", r.start, r.end, total_len);
            let mut resp = (
                StatusCode::PARTIAL_CONTENT,
                [
                    (header::CONTENT_TYPE, mime.to_string()),
                    (header::CONTENT_RANGE, content_range),
                    (header::ACCEPT_RANGES, "bytes".to_string()),
                    (header::CONTENT_DISPOSITION, content_disposition),
                ],
                slice,
            )
                .into_response();
            resp.headers_mut()
                .insert("x-content-type-options", "nosniff".parse().unwrap());
            return resp;
        }
        let mut resp = StatusCode::RANGE_NOT_SATISFIABLE.into_response();
        resp.headers_mut().insert(
            header::CONTENT_RANGE,
            format!("bytes */{total_len}").parse().unwrap(),
        );
        return resp;
    }

    let mut resp = (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, mime.to_string()),
            (header::ACCEPT_RANGES, "bytes".to_string()),
            (header::CONTENT_DISPOSITION, content_disposition),
        ],
        bytes,
    )
        .into_response();
    resp.headers_mut()
        .insert("x-content-type-options", "nosniff".parse().unwrap());
    resp
}

fn placeholder_svg(label: &str) -> Vec<u8> {
    let safe = escape_html(label);
    format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640"><rect width="640" height="640" fill="#111a2e"/><circle cx="320" cy="300" r="90" fill="#1d2c4d" stroke="#4f8cff" stroke-width="6"/><path d="M295 250 L365 300 L295 350 Z" fill="#4f8cff"/><text x="320" y="470" text-anchor="middle" fill="#8ca0c6" font-family="sans-serif" font-size="26">{safe}</text></svg>"##
    )
    .into_bytes()
}

// GET /api/shares
pub async fn get_shares(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => return access_denied(),
    };
    let all = sharing::load_public_shares(&state.upload_dir);
    let now = sharing::now_ms();
    let mut shares: Vec<serde_json::Value> = all
        .values()
        .filter(|s| s.owner == sess.username)
        .map(|s| {
            serde_json::json!({
                "id": s.id,
                "filenames": s.filenames,
                "label": s.label,
                "createdAt": s.created_at,
                "expiresAt": s.expires_at,
                "expired": s.expires_at > 0 && s.expires_at <= now,
                "hasPassword": s.password_hash.is_some(),
                "maxDownloads": s.max_downloads,
                "downloadCount": s.download_count,
            })
        })
        .collect();
    shares.sort_by(|a, b| {
        b.get("createdAt")
            .and_then(|v| v.as_i64())
            .unwrap_or(0)
            .cmp(&a.get("createdAt").and_then(|v| v.as_i64()).unwrap_or(0))
    });
    json_response(
        StatusCode::OK,
        serde_json::json!({ "shares": shares }).to_string(),
    )
}

// POST /api/shares/create
pub async fn post_shares_create(
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
    let payload: CreateSharePayload = parse_json_body(&bytes);
    let user_folder = state.upload_dir.join(&sess.username);
    let filenames: Vec<String> = payload
        .filenames
        .unwrap_or_default()
        .into_iter()
        .filter(|f| is_valid_vault_filename(f) && user_folder.join(f).exists())
        .take(500)
        .collect();
    if filenames.is_empty() {
        return json_response(
            StatusCode::BAD_REQUEST,
            r#"{"error":"Nessun file valido selezionato"}"#,
        );
    }
    let expires_hours = payload
        .expires_in_hours
        .filter(|v| v.is_finite() && *v > 0.0)
        .map(|v| v.min(24.0 * 365.0) as i64)
        .unwrap_or(72);
    let max_downloads = payload
        .max_downloads
        .filter(|v| v.is_finite() && *v > 0.0)
        .map(|v| v.min(100000.0) as i64);
    let password = payload.password.unwrap_or_default();
    let password = password.chars().take(128).collect::<String>();
    let label = payload.label.unwrap_or_default();
    let secret = sharing::server_secret(&state.upload_dir);
    let (token, record) = sharing::create_public_share(
        &state.upload_dir,
        &secret,
        &sess.username,
        &sess.api_key,
        filenames,
        &label,
        expires_hours,
        &password,
        max_downloads,
    );
    let resp = serde_json::json!({
        "success": true,
        "url": format!("/share/{token}"),
        "expiresAt": record.expires_at,
        "count": record.filenames.len(),
    });
    json_response(StatusCode::OK, resp.to_string())
}

// POST /api/shares/delete
pub async fn post_shares_delete(
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
    let payload: DeleteSharePayload = parse_json_body(&bytes);
    let id = payload.id.unwrap_or_default();
    if id.len() != 64 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return json_response(
            StatusCode::BAD_REQUEST,
            r#"{"error":"ID condivisione non valido"}"#,
        );
    }
    let mut shares = sharing::load_public_shares(&state.upload_dir);
    match shares.get(&id) {
        Some(rec) if rec.owner == sess.username => {
            shares.remove(&id);
            let _ = sharing::save_public_shares(&state.upload_dir, &shares);
            json_response(StatusCode::OK, r#"{"success":true}"#)
        }
        _ => json_response(
            StatusCode::NOT_FOUND,
            r#"{"error":"Condivisione non trovata"}"#,
        ),
    }
}

// POST /api/albums/share
pub async fn post_albums_share(
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
    let payload: AlbumSharePayload = parse_json_body(&bytes);
    let album = payload.album.unwrap_or_default().trim().to_string();
    let target_user = payload.username.unwrap_or_default().trim().to_string();
    let role = match payload.role.as_deref() {
        Some("contributor") => "contributor",
        _ => "viewer",
    };
    if !is_valid_album_name(&album) {
        return json_response(StatusCode::BAD_REQUEST, r#"{"error":"Nome album non valido"}"#);
    }
    let valid_user = !target_user.is_empty()
        && target_user.len() <= 64
        && target_user
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    if !valid_user || target_user == sess.username {
        return json_response(
            StatusCode::BAD_REQUEST,
            r#"{"error":"Utente destinatario non valido"}"#,
        );
    }
    if state.find_user(&target_user).is_none() {
        return json_response(
            StatusCode::NOT_FOUND,
            &serde_json::json!({"error": format!("Utente \"{target_user}\" inesistente su questo server")})
                .to_string(),
        );
    }
    let data = vault_manager::load_user_albums(&state.upload_dir, &sess.username);
    if !data.albums.contains(&album) {
        return json_response(StatusCode::NOT_FOUND, r#"{"error":"Album non trovato"}"#);
    }
    let secret = sharing::server_secret(&state.upload_dir);
    let record = sharing::upsert_album_share(
        &state.upload_dir,
        &secret,
        &sess.username,
        &album,
        &sess.api_key,
        &target_user,
        role,
    );
    let resp = serde_json::json!({
        "success": true,
        "shareId": record.id,
        "participants": record.participants,
    });
    json_response(StatusCode::OK, resp.to_string())
}

// POST /api/albums/unshare
pub async fn post_albums_unshare(
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
    let payload: AlbumSharePayload = parse_json_body(&bytes);
    let album = payload.album.unwrap_or_default().trim().to_string();
    let target_user = payload.username.unwrap_or_default().trim().to_string();
    let changed = sharing::remove_album_share(
        &state.upload_dir,
        &sess.username,
        &album,
        &target_user,
    );
    json_response(
        StatusCode::OK,
        serde_json::json!({ "success": changed }).to_string(),
    )
}

// GET /api/albums/shared
pub async fn get_albums_shared(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => return access_denied(),
    };
    let all = sharing::load_album_shares(&state.upload_dir);
    let mut owned_by_me = Vec::new();
    let mut shared_with_me = Vec::new();
    for rec in all.values() {
        let albums_data = vault_manager::load_user_albums(&state.upload_dir, &rec.owner);
        if !albums_data.albums.contains(&rec.album) {
            continue;
        }
        let item_count = sharing::list_album_shared_files(&state.upload_dir, &rec.owner, &rec.album).len();
        if rec.owner == sess.username {
            owned_by_me.push(serde_json::json!({
                "id": rec.id,
                "album": rec.album,
                "participants": rec.participants,
                "createdAt": rec.created_at,
                "itemCount": item_count,
            }));
        } else if let Some(role) = rec.participants.get(&sess.username) {
            shared_with_me.push(serde_json::json!({
                "id": rec.id,
                "owner": rec.owner,
                "album": rec.album,
                "role": role,
                "createdAt": rec.created_at,
                "itemCount": item_count,
            }));
        }
    }
    json_response(
        StatusCode::OK,
        serde_json::json!({
            "ownedByMe": owned_by_me,
            "sharedWithMe": shared_with_me,
        })
        .to_string(),
    )
}

// GET /api/shared-albums/:shareId/media
pub async fn get_shared_album_media(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(share_id): Path<String>,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => return access_denied(),
    };
    let (record, role) = match sharing::resolve_album_share_for_user(
        &state.upload_dir,
        &share_id,
        &sess.username,
    ) {
        Some(v) => v,
        None => {
            return json_response(
                StatusCode::NOT_FOUND,
                r#"{"error":"Album condiviso non trovato o accesso negato"}"#,
            )
        }
    };
    let items = sharing::list_album_shared_files(&state.upload_dir, &record.owner, &record.album);
    let resp = serde_json::json!({
        "id": record.id,
        "owner": record.owner,
        "album": record.album,
        "role": role,
        "items": items,
    });
    json_response(StatusCode::OK, resp.to_string())
}

// GET /api/shared-albums/:shareId/file/:filename
pub async fn get_shared_album_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((share_id, filename)): Path<(String, String)>,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => return access_denied(),
    };
    let (record, _role) = match sharing::resolve_album_share_for_user(
        &state.upload_dir,
        &share_id,
        &sess.username,
    ) {
        Some(v) => v,
        None => {
            return (StatusCode::NOT_FOUND, "Album condiviso non trovato o accesso negato")
                .into_response()
        }
    };
    if !is_valid_vault_filename(&filename) {
        return (StatusCode::FORBIDDEN, "Nome file non autorizzato").into_response();
    }
    let albums_data = vault_manager::load_user_albums(&state.upload_dir, &record.owner);
    if albums_data.file_albums.get(&filename).map(|a| a == &record.album) != Some(true) {
        return (StatusCode::FORBIDDEN, "File non appartenente a questo album").into_response();
    }
    let owner_folder = state.upload_dir.join(&record.owner);
    let file_path = owner_folder.join(&filename);
    if !file_path.exists() {
        return (StatusCode::NOT_FOUND, "File non trovato").into_response();
    }
    let secret = sharing::server_secret(&state.upload_dir);
    let api_key = match vault::unwrap_secret(&secret, &record.key_wrap) {
        Some(k) => k,
        None => return (StatusCode::INTERNAL_SERVER_ERROR, "Album non decifrabile").into_response(),
    };
    let encrypted = match fs::read(&file_path) {
        Ok(b) => b,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Errore lettura file").into_response(),
    };
    match crypto::decrypt_file(&encrypted, &api_key) {
        Ok(plain) => serve_bytes(plain, &filename, &headers, false),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Errore decifratura").into_response(),
    }
}

// POST /api/shared-albums/:shareId/upload
pub async fn post_shared_album_upload(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(share_id): Path<String>,
    mut multipart: Multipart,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => return access_denied(),
    };
    let (record, role) = match sharing::resolve_album_share_for_user(
        &state.upload_dir,
        &share_id,
        &sess.username,
    ) {
        Some(v) => v,
        None => {
            return json_response(
                StatusCode::NOT_FOUND,
                r#"{"error":"Album condiviso non trovato o accesso negato"}"#,
            )
        }
    };
    if role != "contributor" {
        return json_response(
            StatusCode::FORBIDDEN,
            r#"{"error":"Solo i collaboratori possono caricare in questo album"}"#,
        );
    }
    let secret = sharing::server_secret(&state.upload_dir);
    let api_key = match vault::unwrap_secret(&secret, &record.key_wrap) {
        Some(k) => k,
        None => {
            return json_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                r#"{"error":"Album condiviso non decifrabile"}"#,
            )
        }
    };
    let owner_folder = state.upload_dir.join(&record.owner);
    let _ = fs::create_dir_all(&owner_folder);
    let mut uploaded = Vec::new();
    while let Ok(Some(field)) = multipart.next_field().await {
        let orig = field.file_name().unwrap_or("file.bin").to_string();
        let ext = PathBuf::from(&orig)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| format!(".{e}"))
            .unwrap_or_else(|| ".bin".to_string());
        let data = match field.bytes().await {
            Ok(b) => b,
            Err(_) => continue,
        };
        let mut rng = rand::thread_rng();
        let filename = loop {
            let mut buf = [0u8; 8];
            rng.fill(&mut buf[..]);
            let candidate = format!("{}{}", hex::encode(buf), ext);
            if !owner_folder.join(&candidate).exists() {
                break candidate;
            }
        };
        if let Ok(encrypted) = crypto::encrypt_file(&data, &api_key) {
            if fs::write(owner_folder.join(&filename), encrypted).is_ok() {
                uploaded.push(filename);
            }
        }
    }
    if uploaded.is_empty() {
        return json_response(StatusCode::BAD_REQUEST, r#"{"error":"Nessun file"}"#);
    }
    let mut albums_data = vault_manager::load_user_albums(&state.upload_dir, &record.owner);
    for filename in &uploaded {
        albums_data
            .file_albums
            .insert(filename.clone(), record.album.clone());
    }
    let _ = vault_manager::save_user_albums(&state.upload_dir, &record.owner, &albums_data);
    let items = sharing::list_album_shared_files(&state.upload_dir, &record.owner, &record.album);
    let resp = serde_json::json!({
        "success": true,
        "uploadedCount": uploaded.len(),
        "uploadedFilenames": uploaded,
        "items": items,
    });
    json_response(StatusCode::OK, resp.to_string())
}

// GET /share/:token
pub async fn get_public_share_page(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(token): Path<String>,
) -> Response {
    let secret = sharing::server_secret(&state.upload_dir);
    let (id, record) = match sharing::resolve_share_by_token(&state.upload_dir, &token) {
        Ok(v) => v,
        Err(ShareResolveError::Expired) => {
            return html_response(StatusCode::GONE, render_error_page("expired"))
        }
        Err(ShareResolveError::Exhausted(_, _)) => {
            return html_response(StatusCode::GONE, render_error_page("exhausted"))
        }
        Err(ShareResolveError::Invalid) => {
            return html_response(StatusCode::NOT_FOUND, render_error_page("invalid"))
        }
    };
    let _ = id;
    if !is_share_unlocked(&headers, &secret, &token, &record) {
        return html_response(StatusCode::UNAUTHORIZED, render_password_page(&token, ""));
    }
    let owner_folder = state.upload_dir.join(&record.owner);
    let filenames: Vec<String> = record
        .filenames
        .iter()
        .filter(|f| owner_folder.join(f).exists())
        .cloned()
        .collect();
    html_response(StatusCode::OK, render_share_page(&token, &record, &filenames))
}

// POST /share/:token/unlock
pub async fn post_public_share_unlock(
    State(state): State<AppState>,
    _headers: HeaderMap,
    Path(token): Path<String>,
    req: Request,
) -> Response {
    let secret = sharing::server_secret(&state.upload_dir);
    let (_id, record) = match sharing::resolve_share_by_token(&state.upload_dir, &token) {
        Ok(v) => v,
        Err(_) => return html_response(StatusCode::GONE, render_error_page("invalid")),
    };
    let bytes = match axum::body::to_bytes(req.into_body(), 64 * 1024).await {
        Ok(b) => b,
        Err(_) => return html_response(StatusCode::BAD_REQUEST, render_password_page(&token, "Richiesta non valida.")),
    };
    let payload: UnlockPayload = serde_urlencoded::from_bytes(&bytes).unwrap_or_default();
    let password = payload.password.unwrap_or_default();
    if !sharing::verify_share_password(&record, &password) {
        return html_response(
            StatusCode::UNAUTHORIZED,
            render_password_page(&token, "Password errata."),
        );
    }
    let cookie = format!(
        "{}={}; Path=/share/{}; HttpOnly; SameSite=Lax; Max-Age=86400",
        share_cookie_name(&record),
        sharing::share_unlock_cookie_value(&secret, &token),
        token
    );
    (
        StatusCode::FOUND,
        [
            (header::LOCATION, format!("/share/{token}")),
            (header::SET_COOKIE, cookie),
        ],
        "",
    )
        .into_response()
}

// GET /share/:token/media/:filename con query string
pub async fn get_public_share_media_query(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((token, filename)): Path<(String, String)>,
    axum::extract::Query(query): axum::extract::Query<HashMap<String, String>>,
) -> Response {
    let secret = sharing::server_secret(&state.upload_dir);
    let (id, record) = match sharing::resolve_share_by_token(&state.upload_dir, &token) {
        Ok(v) => v,
        Err(ShareResolveError::Exhausted(_, _)) => {
            return (StatusCode::GONE, "Limite download raggiunto").into_response()
        }
        Err(_) => return (StatusCode::GONE, "Link scaduto o non valido").into_response(),
    };
    if !is_share_unlocked(&headers, &secret, &token, &record) {
        return (StatusCode::UNAUTHORIZED, "Password richiesta").into_response();
    }
    if !is_valid_vault_filename(&filename) || !record.filenames.contains(&filename) {
        return (StatusCode::NOT_FOUND, "File non condiviso").into_response();
    }
    let owner_folder = state.upload_dir.join(&record.owner);
    let file_path = owner_folder.join(&filename);
    if !file_path.exists() {
        return (StatusCode::NOT_FOUND, "File non trovato").into_response();
    }
    let api_key = match vault::unwrap_secret(&secret, &record.key_wrap) {
        Some(k) => k,
        None => return (StatusCode::INTERNAL_SERVER_ERROR, "Condivisione non decifrabile").into_response(),
    };
    let encrypted = match fs::read(&file_path) {
        Ok(b) => b,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Errore lettura file").into_response(),
    };
    let plain = match crypto::decrypt_file(&encrypted, &api_key) {
        Ok(b) => b,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Errore decifratura").into_response(),
    };

    let preview = query.get("preview").map(|v| v.as_str()).unwrap_or("");
    let download = matches!(
        query.get("download").map(|v| v.as_str()),
        Some("1") | Some("true")
    );
    let is_preview = !download
        && matches!(
            preview.trim().to_lowercase().as_str(),
            "1" | "true" | "thumb" | "large"
        );
    if is_preview {
        if media_kind(&filename) != "image" {
            return (
                StatusCode::OK,
                [(header::CONTENT_TYPE, "image/svg+xml")],
                placeholder_svg(&filename),
            )
                .into_response();
        }
        return serve_bytes(plain, &filename, &headers, false);
    }

    // Validate Range before consuming quota
    let total_len = plain.len();
    let range_hdr = headers.get(header::RANGE).and_then(|h| h.to_str().ok());
    let parsed_range = if let Some(rh) = range_hdr {
        match parse_range_header(rh, total_len) {
            Some(r) => Some(r),
            None => {
                let mut resp = StatusCode::RANGE_NOT_SATISFIABLE.into_response();
                resp.headers_mut().insert(
                    header::CONTENT_RANGE,
                    format!("bytes */{total_len}").parse().unwrap(),
                );
                return resp;
            }
        }
    } else {
        None
    };

    // Enforce download quota for both explicit downloads and full inline fetches
    let mime = guess_mime(&filename);
    let is_av = mime.starts_with("video/") || mime.starts_with("audio/");
    let response_bytes = parsed_range
        .as_ref()
        .map(|r| r.end - r.start + 1)
        .unwrap_or(total_len);
    let max_grant_bytes = ((total_len as f64) * 2.5).floor().max(1.0) as usize;
    let now_ms = crate::state::now_ms();
    let window_ms: u64 = 2 * 60 * 60 * 1000;

    let visitor_token = headers
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(|c| {
            c.split(';').find_map(|p| {
                let (k, v) = p.trim().split_once('=')?;
                if k.trim() == "pc_pb" {
                    let t = v.trim();
                    if t.len() == 32 && t.bytes().all(|b| b.is_ascii_hexdigit()) {
                        return Some(t.to_string());
                    }
                }
                None
            })
        });

    let mut should_count_download = true;
    if is_av && !download && parsed_range.is_some() {
        if let Some(ref vt) = visitor_token {
            let grant_key = format!("{id}:{vt}:{filename}");
            if let Ok(mut grants) = state.share_playback_grants.write() {
                grants.retain(|_, g| now_ms.saturating_sub(g.granted_at) <= window_ms);
                if let Some(g) = grants.get_mut(&grant_key) {
                    if g.bytes_used + response_bytes <= g.max_bytes {
                        g.bytes_used += response_bytes;
                        should_count_download = false;
                    }
                }
            }
        }
    }

    let mut newly_issued_pb: Option<String> = None;
    if should_count_download {
        if !sharing::increment_share_download_count(&state.upload_dir, &id) {
            return (StatusCode::GONE, "Limite download raggiunto").into_response();
        }
        if is_av && !download && response_bytes <= max_grant_bytes {
            let vt = visitor_token.clone().unwrap_or_else(|| {
                let mut rng = rand::thread_rng();
                let mut buf = [0u8; 16];
                rng.fill(&mut buf[..]);
                hex::encode(buf)
            });
            if let Ok(mut grants) = state.share_playback_grants.write() {
                grants.insert(
                    format!("{id}:{vt}:{filename}"),
                    crate::state::SharePlaybackGrant {
                        granted_at: now_ms,
                        bytes_used: response_bytes,
                        max_bytes: max_grant_bytes,
                    },
                );
            }
            if visitor_token.is_none() {
                newly_issued_pb = Some(vt);
            }
        }
    }

    let mut resp = serve_bytes(plain, &filename, &headers, download);
    if let Some(vt) = newly_issued_pb {
        let cookie = format!("pc_pb={vt}; Path=/share/{token}; HttpOnly; SameSite=Lax; Max-Age=7200");
        if let Ok(val) = cookie.parse() {
            resp.headers_mut().append(header::SET_COOKIE, val);
        }
    }
    resp
}
