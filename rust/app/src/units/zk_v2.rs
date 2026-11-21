//! PhotoCloud Zero-Knowledge API v2 (`/api/v2/*`) & Web Shell (`/v2/*`).
//!
//! Strict parity with `src/lib/zkServerV2.ts` and `src/client/v2-app/router.ts`.
//! Zero-Knowledge invariant: never decrypts user blobs/metadata, never logs secrets.

use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::PathBuf;

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Path, Query, Request, State};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, patch, post, put};
use axum::Router;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rusqlite::{params, OptionalExtension};
use sha2::{Digest, Sha256};

use crate::state::AppState;
use crate::zk_v2_store::{
    compute_file_sha256_hex, compute_scrypt_verifier, decode_base64url_strict,
    derive_fake_salt_for_username, derive_hmac_sha256, is_valid_base64url, is_valid_sha256_hex,
    is_valid_share_id, is_valid_uuid_v4, is_valid_v2_username, move_temp_file_atomic,
    now_ms_i64, parse_http_range_header, random_base64url, random_bytes, random_uuid_v4,
    row_to_item_v2, timing_safe_hex_equal, validate_enc_meta_string, validate_kdf_params,
    validate_optional_dedup_tag, validate_share_manifest_string, verify_scrypt_constant_time,
    verify_token_constant_time, write_buffer_atomic, AuthenticatedUserV2, ItemRecordV2,
    KdfParamsV2, ParsedHttpRange, RateLimiterState, RegistrationPolicy, UploadSessionV2,
    UserRecordV2, ITEM_V2_SELECT_COLS, MAX_ALBUM_BLOB_BYTES, MAX_CHUNK_BODY_BYTES,
    MAX_THUMB_BLOB_BYTES, PCZK_MAGIC, PCZK_MIN_BLOB_BYTES, PCZK_VERSION_V1,
    V2_SESSION_COOKIE_NAME,
};

pub const V2_API_CSP: &str = "default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

pub const V2_WEB_STRICT_CSP: &str = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob: data: https://tile.openstreetmap.org https://*.tile.openstreetmap.org; media-src 'self' blob:; worker-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

const LOGIN_RATE_LIMIT_MAX: u32 = 30;
const LOGIN_RATE_LIMIT_WINDOW_MS: i64 = 60_000;
const SHARE_RATE_LIMIT_MAX_PER_IP: u32 = 120;
const SHARE_RATE_LIMIT_MAX_PER_SHARE: u32 = 120;
const SHARE_RATE_LIMIT_WINDOW_MS: i64 = 60_000;

pub fn v2_api_router(state: AppState) -> Router<AppState> {
    Router::new()
        // 1. Account endpoints + aliases
        .route("/auth/config", get(get_auth_config))
        .route("/register", post(post_register))
        .route("/auth/register", post(post_register))
        .route("/login/params", post(post_login_params))
        .route("/auth/params", post(post_login_params))
        .route("/login", post(post_login))
        .route("/auth/login", post(post_login))
        .route("/logout", post(post_logout))
        .route("/auth/logout", post(post_logout))
        .route("/account/rewrap", post(post_account_rewrap))
        .route("/auth/passphrase", put(post_account_rewrap))
        // 2. Blob chunked upload & Range download
        .route("/blobs/upload/init", post(post_blob_upload_init))
        .route(
            "/blobs/upload/{uploadId}/{chunkIndex}",
            put(put_blob_upload_chunk).layer(DefaultBodyLimit::max(MAX_CHUNK_BODY_BYTES + 1024)),
        )
        .route(
            "/blobs/upload/{uploadId}/complete",
            post(post_blob_upload_complete),
        )
        .route(
            "/blobs/upload/{uploadId}",
            delete(delete_blob_upload),
        )
        .route("/blobs/{id}", get(get_blob))
        .route(
            "/blobs/{id}/thumbs/{variant}",
            put(put_blob_thumb)
                .get(get_blob_thumb)
                .layer(DefaultBodyLimit::max(MAX_THUMB_BLOB_BYTES + 1024)),
        )
        // 3. Items
        .route("/items", get(get_items))
        .route("/items/{id}", get(get_item).delete(delete_item))
        .route(
            "/items/{id}/meta",
            patch(patch_item_meta).put(patch_item_meta),
        )
        .route("/items/{id}/replace", post(post_item_replace))
        // 4. Dedup
        .route("/backup/check", post(post_backup_check))
        // 5. Albums
        .route(
            "/albums",
            get(get_albums)
                .put(put_albums)
                .layer(DefaultBodyLimit::max(MAX_ALBUM_BLOB_BYTES + 1024)),
        )
        // 6. Trash
        .route("/trash", post(post_trash).delete(delete_trash))
        .route("/trash/restore", post(post_trash_restore))
        // 7. Stats
        .route("/stats", get(get_stats))
        // 8. Shares
        .route("/shares", get(get_owner_shares).post(post_shares))
        .route("/shares/{shareId}", get(get_share).delete(delete_share))
        .route("/shares/{shareId}/blobs/{blobId}", get(get_share_blob))
        .layer(middleware::from_fn_with_state(state, v2_security_middleware))
}

pub fn v2_web_router() -> Router<AppState> {
    Router::new()
        .route("/", get(get_v2_shell))
        .route("/share/{shareId}", get(get_v2_shell))
        .route("/app.css", get(get_v2_app_css))
        .route("/app.js", get(get_v2_app_js))
        .route("/sw-stream.js", get(get_v2_sw_stream))
        .layer(middleware::from_fn(v2_web_headers_middleware))
}

fn apply_v2_web_headers(headers: &mut HeaderMap) {
    headers.insert(
        HeaderName::from_static("content-security-policy"),
        HeaderValue::from_static(V2_WEB_STRICT_CSP),
    );
    headers.insert(
        HeaderName::from_static("referrer-policy"),
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        HeaderName::from_static("x-content-type-options"),
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        HeaderName::from_static("x-frame-options"),
        HeaderValue::from_static("DENY"),
    );
}

async fn v2_web_headers_middleware(req: Request, next: Next) -> Response {
    let mut resp = next.run(req).await;
    apply_v2_web_headers(resp.headers_mut());
    resp
}

fn render_v2_html_shell() -> &'static str {
    r#"<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="referrer" content="no-referrer" />
  <title>PhotoCloud v2 — Zero-Knowledge E2EE Vault</title>
  <link rel="stylesheet" href="/v2/app.css" />
</head>
<body>
  <div id="zk-app-root"></div>
  <script type="module" src="/v2/app.js"></script>
</body>
</html>"#
}

async fn get_v2_shell() -> Response {
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "text/html; charset=utf-8"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        render_v2_html_shell(),
    )
        .into_response()
}

async fn get_v2_app_css() -> Response {
    let p = PathBuf::from("public").join("v2").join("app.css");
    match fs::read(&p) {
        Ok(bytes) => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "text/css; charset=utf-8")],
            bytes,
        )
            .into_response(),
        Err(_) => (StatusCode::NOT_FOUND, "/* app.css not found */").into_response(),
    }
}

async fn get_v2_app_js() -> Response {
    let p = PathBuf::from("public").join("v2").join("app.js");
    match fs::read(&p) {
        Ok(bytes) => (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, "application/javascript; charset=utf-8"),
                (header::CACHE_CONTROL, "no-store"),
            ],
            bytes,
        )
            .into_response(),
        Err(_) => (StatusCode::NOT_FOUND, "// app.js not found").into_response(),
    }
}

async fn get_v2_sw_stream() -> Response {
    let p = PathBuf::from("public").join("v2").join("sw-stream.js");
    match fs::read(&p) {
        Ok(bytes) => (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, "application/javascript; charset=utf-8"),
                (
                    HeaderName::from_static("service-worker-allowed"),
                    "/v2",
                ),
                (header::CACHE_CONTROL, "no-store"),
            ],
            bytes,
        )
            .into_response(),
        Err(_) => (StatusCode::NOT_FOUND, "// sw-stream.js not found").into_response(),
    }
}

// ============================================================================
// Security Middleware & Helpers
// ============================================================================

fn apply_v2_api_headers(headers: &mut HeaderMap) {
    headers.insert(
        HeaderName::from_static("x-content-type-options"),
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        HeaderName::from_static("x-frame-options"),
        HeaderValue::from_static("DENY"),
    );
    headers.insert(
        HeaderName::from_static("referrer-policy"),
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        HeaderName::from_static("content-security-policy"),
        HeaderValue::from_static(V2_API_CSP),
    );
}

fn v2_json(status: StatusCode, body: serde_json::Value) -> Response {
    let mut resp = (
        status,
        [(header::CONTENT_TYPE, "application/json; charset=utf-8")],
        body.to_string(),
    )
        .into_response();
    apply_v2_api_headers(resp.headers_mut());
    resp
}

fn trust_proxy_enabled() -> bool {
    match std::env::var("TRUST_PROXY") {
        Ok(val) => {
            let v = val.trim().to_lowercase();
            !v.is_empty() && !matches!(v.as_str(), "false" | "0" | "no" | "off")
        }
        Err(_) => false,
    }
}

fn normalize_host_port(proto: &str, raw_host: &str) -> String {
    let lower = raw_host.trim().to_lowercase();
    if proto == "http" {
        if let Some(stripped) = lower.strip_suffix(":80") {
            return stripped.to_string();
        }
    } else if proto == "https" {
        if let Some(stripped) = lower.strip_suffix(":443") {
            return stripped.to_string();
        }
    }
    lower
}

fn parse_origin_proto_and_host(origin: &str) -> Option<(String, String)> {
    let (proto, rest) = origin.split_once("://")?;
    let proto_lower = proto.to_lowercase();
    if proto_lower != "http" && proto_lower != "https" {
        return None;
    }
    let host_part = rest.split('/').next()?;
    if host_part.is_empty() || host_part.contains('@') || host_part.contains(' ') {
        return None;
    }
    Some((proto_lower.clone(), normalize_host_port(&proto_lower, host_part)))
}

async fn v2_security_middleware(
    State(_state): State<AppState>,
    req: Request,
    next: Next,
) -> Response {
    let method = req.method().clone();
    if matches!(method, Method::POST | Method::PUT | Method::DELETE | Method::PATCH) {
        let headers = req.headers();
        if let Some(sfs) = headers.get("sec-fetch-site").and_then(|v| v.to_str().ok()) {
            if sfs.trim().eq_ignore_ascii_case("cross-site") {
                return v2_json(
                    StatusCode::FORBIDDEN,
                    serde_json::json!({ "error": "CSRF_ORIGIN_MISMATCH" }),
                );
            }
        }
        if let Some(origin_raw) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
            let origin_trimmed = origin_raw.trim();
            if !origin_trimmed.is_empty() {
                if origin_trimmed.eq_ignore_ascii_case("null") {
                    return v2_json(
                        StatusCode::FORBIDDEN,
                        serde_json::json!({ "error": "CSRF_ORIGIN_MISMATCH" }),
                    );
                }
                let Some((origin_proto, origin_host)) = parse_origin_proto_and_host(origin_trimmed) else {
                    return v2_json(
                        StatusCode::FORBIDDEN,
                        serde_json::json!({ "error": "CSRF_ORIGIN_MISMATCH" }),
                    );
                };
                let trust_proxy = trust_proxy_enabled();
                let fwd_proto = if trust_proxy {
                    headers
                        .get("x-forwarded-proto")
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("")
                        .split(',')
                        .next()
                        .unwrap_or("")
                        .trim()
                        .to_lowercase()
                } else {
                    String::new()
                };
                if (fwd_proto == "http" || fwd_proto == "https") && origin_proto != fwd_proto {
                    return v2_json(
                        StatusCode::FORBIDDEN,
                        serde_json::json!({ "error": "CSRF_ORIGIN_MISMATCH" }),
                    );
                }
                let raw_target_host = if trust_proxy {
                    headers
                        .get("x-forwarded-host")
                        .and_then(|v| v.to_str().ok())
                        .or_else(|| headers.get(header::HOST).and_then(|v| v.to_str().ok()))
                        .unwrap_or("")
                } else {
                    headers
                        .get(header::HOST)
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("")
                }
                .split(',')
                .next()
                .unwrap_or("")
                .trim()
                .to_lowercase();

                if !raw_target_host.is_empty() {
                    let eff_proto = if fwd_proto == "http" || fwd_proto == "https" {
                        fwd_proto.as_str()
                    } else {
                        origin_proto.as_str()
                    };
                    let target_host = normalize_host_port(eff_proto, &raw_target_host);
                    if origin_host != target_host {
                        return v2_json(
                            StatusCode::FORBIDDEN,
                            serde_json::json!({ "error": "CSRF_ORIGIN_MISMATCH" }),
                        );
                    }
                }
            }
        }
    }

    let mut resp = next.run(req).await;
    apply_v2_api_headers(resp.headers_mut());
    resp
}

fn is_secure_or_localhost_request(headers: &HeaderMap) -> bool {
    if trust_proxy_enabled() {
        if let Some(proto) = headers
            .get("x-forwarded-proto")
            .and_then(|v| v.to_str().ok())
        {
            if proto
                .split(',')
                .next()
                .map(|s| s.trim().eq_ignore_ascii_case("https"))
                .unwrap_or(false)
            {
                return true;
            }
        }
    }
    let host_raw = headers
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .trim()
        .to_lowercase();
    if host_raw.is_empty() {
        return true;
    }
    let hostname = if host_raw.starts_with('[') {
        host_raw
            .split(']')
            .next()
            .unwrap_or("")
            .trim_start_matches('[')
    } else {
        host_raw.split(':').next().unwrap_or("")
    };
    matches!(hostname, "localhost" | "127.0.0.1" | "::1")
        || hostname.ends_with(".localhost")
}

fn is_actual_https_request(headers: &HeaderMap) -> bool {
    if trust_proxy_enabled() {
        if let Some(proto) = headers
            .get("x-forwarded-proto")
            .and_then(|v| v.to_str().ok())
        {
            if proto
                .split(',')
                .next()
                .map(|s| s.trim().eq_ignore_ascii_case("https"))
                .unwrap_or(false)
            {
                return true;
            }
        }
    }
    false
}

fn is_explicit_http_transport_requested(headers: &HeaderMap) -> bool {
    let allow_env = std::env::var("PHOTOCLOUD_ALLOW_HTTP")
        .map(|v| matches!(v.trim().to_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(false);
    if allow_env {
        return true;
    }
    headers
        .get("x-photocloud-transport-mode")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .map(|s| s.trim().eq_ignore_ascii_case("http"))
        .unwrap_or(false)
}

fn should_mark_cookie_secure(headers: &HeaderMap) -> bool {
    if is_actual_https_request(headers) {
        return true;
    }
    if is_explicit_http_transport_requested(headers) {
        return false;
    }
    is_secure_or_localhost_request(headers)
}

fn require_https_or_localhost(headers: &HeaderMap) -> Result<(), Response> {
    if !is_secure_or_localhost_request(headers) && !is_explicit_http_transport_requested(headers) {
        return Err(v2_json(
            StatusCode::FORBIDDEN,
            serde_json::json!({
                "error": "HTTPS_REQUIRED",
                "message": "HTTPS è obbligatorio per le API Zero-Knowledge v2 (seleziona la modalità HTTP nella schermata di accesso oppure usa HTTPS)."
            }),
        ));
    }
    Ok(())
}

fn extract_client_ip(headers: &HeaderMap) -> String {
    if trust_proxy_enabled() {
        if let Some(xff) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
            if let Some(first) = xff.split(',').next().map(|s| s.trim()).filter(|s| !s.is_empty()) {
                return first.to_string();
            }
        }
    }
    headers
        .get("x-real-ip")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "127.0.0.1".to_string())
}

fn enforce_login_rate_limit(state: &AppState, headers: &HeaderMap) -> Result<(), Response> {
    let client_ip = extract_client_ip(headers);
    let now = now_ms_i64();
    let mut rl = state.zk_v2.rate_limiter.lock().unwrap();
    if let Err(retry) = RateLimiterState::check_bucket(
        &mut rl.login_buckets,
        &client_ip,
        LOGIN_RATE_LIMIT_MAX,
        LOGIN_RATE_LIMIT_WINDOW_MS,
        now,
    ) {
        let mut resp = v2_json(
            StatusCode::TOO_MANY_REQUESTS,
            serde_json::json!({ "error": "RATE_LIMITED" }),
        );
        if let Ok(val) = HeaderValue::from_str(&retry.to_string()) {
            resp.headers_mut().insert(header::RETRY_AFTER, val);
        }
        return Err(resp);
    }
    Ok(())
}

fn enforce_public_share_rate_limits(
    state: &AppState,
    headers: &HeaderMap,
    share_id: &str,
) -> Result<(), Response> {
    let client_ip = extract_client_ip(headers);
    let now = now_ms_i64();
    let mut rl = state.zk_v2.rate_limiter.lock().unwrap();
    if let Err(retry) = RateLimiterState::check_bucket(
        &mut rl.share_ip_buckets,
        &client_ip,
        SHARE_RATE_LIMIT_MAX_PER_IP,
        SHARE_RATE_LIMIT_WINDOW_MS,
        now,
    ) {
        let mut resp = v2_json(
            StatusCode::TOO_MANY_REQUESTS,
            serde_json::json!({ "error": "RATE_LIMITED_IP" }),
        );
        if let Ok(val) = HeaderValue::from_str(&retry.to_string()) {
            resp.headers_mut().insert(header::RETRY_AFTER, val);
        }
        return Err(resp);
    }
    if let Err(retry) = RateLimiterState::check_bucket(
        &mut rl.share_id_buckets,
        share_id,
        SHARE_RATE_LIMIT_MAX_PER_SHARE,
        SHARE_RATE_LIMIT_WINDOW_MS,
        now,
    ) {
        let mut resp = v2_json(
            StatusCode::TOO_MANY_REQUESTS,
            serde_json::json!({ "error": "RATE_LIMITED_SHARE" }),
        );
        if let Ok(val) = HeaderValue::from_str(&retry.to_string()) {
            resp.headers_mut().insert(header::RETRY_AFTER, val);
        }
        return Err(resp);
    }
    Ok(())
}

fn parse_cookie_value(headers: &HeaderMap, cookie_name: &str) -> Option<String> {
    let raw = headers.get(header::COOKIE)?.to_str().ok()?;
    for pair in raw.split(';') {
        let trimmed = pair.trim();
        if let Some((k, v)) = trimmed.split_once('=') {
            if k.trim() == cookie_name {
                return Some(v.trim().to_string());
            }
        }
    }
    None
}

fn get_authenticated_session(state: &AppState, headers: &HeaderMap) -> Option<AuthenticatedUserV2> {
    let raw_sid = parse_cookie_value(headers, V2_SESSION_COOKIE_NAME)?;
    if raw_sid.len() < 32 {
        return None;
    }
    let sid_hash = Sha256::digest(raw_sid.as_bytes()).to_vec();
    let now = now_ms_i64();
    let conn = state.zk_v2.db.lock().unwrap();
    let row: Option<(String, String, i64, String, i64)> = conn
        .query_row(
            "SELECT s.user_id, s.csrf_token, s.expires_at, u.username, u.quota_bytes
             FROM sessions_v2 s
             JOIN users_v2 u ON u.id = s.user_id
             WHERE s.sid_hash = ?1",
            params![&sid_hash],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .optional()
        .ok()
        .flatten();

    let (user_id, csrf_token, expires_at, username, quota_bytes) = row?;
    if now >= expires_at {
        let _ = conn.execute("DELETE FROM sessions_v2 WHERE sid_hash = ?1", params![&sid_hash]);
        return None;
    }

    Some(AuthenticatedUserV2 {
        user_id,
        username,
        sid_hash,
        csrf_token,
        quota_bytes,
    })
}

pub fn has_authenticated_v2_session(state: &AppState, headers: &HeaderMap) -> bool {
    get_authenticated_session(state, headers).is_some()
}

fn require_auth(state: &AppState, headers: &HeaderMap) -> Result<AuthenticatedUserV2, Response> {
    get_authenticated_session(state, headers).ok_or_else(|| {
        v2_json(
            StatusCode::UNAUTHORIZED,
            serde_json::json!({ "error": "UNAUTHENTICATED" }),
        )
    })
}

fn issue_session_cookie(
    state: &AppState,
    req_headers: &HeaderMap,
    user_id: &str,
) -> (String, String) {
    let raw_sid = random_base64url(32);
    let sid_hash = Sha256::digest(raw_sid.as_bytes()).to_vec();
    let csrf_token = random_base64url(24);
    let now = now_ms_i64();
    let expires_at = now + state.zk_v2.session_ttl_ms;

    {
        let conn = state.zk_v2.db.lock().unwrap();
        let _ = conn.execute(
            "INSERT INTO sessions_v2 (sid_hash, user_id, csrf_token, created_at, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![&sid_hash, user_id, &csrf_token, now, expires_at],
        );
    }

    let max_age_sec = (state.zk_v2.session_ttl_ms / 1000).max(1);
    let secure_flag = if should_mark_cookie_secure(req_headers) {
        "; Secure"
    } else {
        ""
    };
    let cookie = format!(
        "{V2_SESSION_COOKIE_NAME}={raw_sid}; Path=/; HttpOnly{secure_flag}; SameSite=Strict; Max-Age={max_age_sec}"
    );
    (csrf_token, cookie)
}

fn clear_session_cookie(req_headers: &HeaderMap) -> String {
    let secure_flag = if should_mark_cookie_secure(req_headers) {
        "; Secure"
    } else {
        ""
    };
    format!("{V2_SESSION_COOKIE_NAME}=; Path=/; HttpOnly{secure_flag}; SameSite=Strict; Max-Age=0")
}

// ============================================================================
// 1. ACCOUNT ENDPOINTS
// ============================================================================

async fn get_auth_config(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let user_count: i64 = {
        let conn = state.zk_v2.db.lock().unwrap();
        conn.query_row("SELECT COUNT(*) FROM users_v2", [], |r| r.get(0))
            .unwrap_or(0)
    };
    let has_invite = state
        .zk_v2
        .registration_invite_token
        .as_deref()
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    let can_use_setup_token = {
        let st = state.zk_v2.setup_token.lock().unwrap();
        !st.consumed && user_count == 0 && st.active_token.is_some()
    };

    let (registration_open, requires_invite_token, policy) = match state.zk_v2.registration_policy {
        RegistrationPolicy::Open => (true, false, "open"),
        RegistrationPolicy::Disabled => (has_invite, true, "disabled"),
        RegistrationPolicy::SetupTokenOrInvite => {
            (can_use_setup_token || has_invite, true, "setup_token_or_invite")
        }
    };

    let http_url = std::env::var("PHOTOCLOUD_HTTP_URL")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let https_url = std::env::var("PHOTOCLOUD_HTTPS_URL")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let current_protocol = if is_actual_https_request(&headers) {
        "https"
    } else {
        "http"
    };

    v2_json(
        StatusCode::OK,
        serde_json::json!({
            "registrationOpen": registration_open,
            "requiresInviteToken": requires_invite_token,
            "policy": policy,
            "transport": {
                "currentProtocol": current_protocol,
                "httpModeAllowed": true,
                "httpUrl": http_url,
                "httpsUrl": https_url,
            },
        }),
    )
}

async fn post_register(
    State(state): State<AppState>,
    headers: HeaderMap,
    body_bytes: Bytes,
) -> Response {
    if let Err(resp) = require_https_or_localhost(&headers) {
        return resp;
    }
    if let Err(resp) = enforce_login_rate_limit(&state, &headers) {
        return resp;
    }

    let body: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap_or_default();

    let user_count: i64 = {
        let conn = state.zk_v2.db.lock().unwrap();
        conn.query_row("SELECT COUNT(*) FROM users_v2", [], |r| r.get(0))
            .unwrap_or(0)
    };

    let provided_token: Option<String> = body
        .get("setupToken")
        .and_then(|v| v.as_str())
        .or_else(|| body.get("inviteToken").and_then(|v| v.as_str()))
        .or_else(|| headers.get("x-setup-token").and_then(|v| v.to_str().ok()))
        .or_else(|| {
            headers
                .get("x-registration-token")
                .and_then(|v| v.to_str().ok())
        })
        .map(|s| s.to_string());

    let has_valid_invite = verify_token_constant_time(
        state.zk_v2.registration_invite_token.as_deref(),
        provided_token.as_deref(),
    );

    let has_valid_setup_token = {
        let st = state.zk_v2.setup_token.lock().unwrap();
        !st.consumed
            && user_count == 0
            && st.active_token.is_some()
            && verify_token_constant_time(st.active_token.as_deref(), provided_token.as_deref())
    };

    match state.zk_v2.registration_policy {
        RegistrationPolicy::Disabled => {
            if !has_valid_invite {
                return v2_json(
                    StatusCode::FORBIDDEN,
                    serde_json::json!({ "error": "REGISTRATION_DISABLED" }),
                );
            }
        }
        RegistrationPolicy::SetupTokenOrInvite => {
            if !has_valid_invite && !has_valid_setup_token {
                return v2_json(
                    StatusCode::FORBIDDEN,
                    serde_json::json!({ "error": "REGISTRATION_DISABLED" }),
                );
            }
        }
        RegistrationPolicy::Open => {}
    }

    let username = body
        .get("username")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if !is_valid_v2_username(&username) {
        return v2_json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "INVALID_USERNAME" }),
        );
    }

    let salt_raw = body.get("salt").and_then(|v| v.as_str()).unwrap_or("");
    if decode_base64url_strict(salt_raw, 16).is_none() {
        return v2_json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "INVALID_USER_SALT" }),
        );
    }

    let Some(kdf_params) = body.get("kdfParams").and_then(validate_kdf_params) else {
        return v2_json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "INVALID_KDF_PARAMS" }),
        );
    };

    let auth_secret_raw = body.get("authSecret").and_then(|v| v.as_str()).unwrap_or("");
    let Some(mut auth_secret_buf) = decode_base64url_strict(auth_secret_raw, 32) else {
        return v2_json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "INVALID_AUTH_SECRET" }),
        );
    };

    let wrapped_vk_raw = body
        .get("wrappedVaultKey")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if decode_base64url_strict(wrapped_vk_raw, 60).is_none() {
        auth_secret_buf.fill(0);
        return v2_json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "INVALID_WRAPPED_VAULT_KEY" }),
        );
    }

    let user_id = match body.get("userId") {
        Some(v) if !v.is_null() => {
            let s = v.as_str().unwrap_or("");
            if !is_valid_uuid_v4(s) {
                auth_secret_buf.fill(0);
                return v2_json(
                    StatusCode::BAD_REQUEST,
                    serde_json::json!({ "error": "INVALID_USER_ID" }),
                );
            }
            s.to_lowercase()
        }
        _ => random_uuid_v4(),
    };

    {
        let conn = state.zk_v2.db.lock().unwrap();
        let existing: Option<String> = conn
            .query_row(
                "SELECT id FROM users_v2 WHERE username = ?1 OR id = ?2",
                params![&username, &user_id],
                |r| r.get(0),
            )
            .optional()
            .ok()
            .flatten();
        if existing.is_some() {
            auth_secret_buf.fill(0);
            return v2_json(
                StatusCode::CONFLICT,
                serde_json::json!({ "error": "REGISTRATION_CONFLICT" }),
            );
        }
    }

    let server_salt = random_bytes(16);
    let salt_for_task = server_salt.clone();
    let verifier_res = tokio::task::spawn_blocking(move || {
        let res = compute_scrypt_verifier(&auth_secret_buf, &salt_for_task);
        auth_secret_buf.fill(0);
        res
    })
    .await;

    let auth_verifier = match verifier_res {
        Ok(Ok(v)) => v,
        _ => {
            return v2_json(
                StatusCode::INTERNAL_SERVER_ERROR,
                serde_json::json!({ "error": "KDF_FAILED" }),
            );
        }
    };

    let now = now_ms_i64();
    let kdf_json = serde_json::to_string(&kdf_params).unwrap();
    let insert_res = {
        let conn = state.zk_v2.db.lock().unwrap();
        conn.execute(
            "INSERT INTO users_v2 (
               id, username, user_salt, kdf_params, server_salt, auth_verifier, wrapped_vk, quota_bytes, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                &user_id,
                &username,
                salt_raw,
                &kdf_json,
                &server_salt,
                &auth_verifier,
                wrapped_vk_raw,
                state.zk_v2.default_quota_bytes,
                now,
                now
            ],
        )
    };

    if insert_res.is_err() {
        return v2_json(
            StatusCode::CONFLICT,
            serde_json::json!({ "error": "REGISTRATION_CONFLICT" }),
        );
    }

    if user_count == 0 || has_valid_setup_token {
        let mut st = state.zk_v2.setup_token.lock().unwrap();
        st.consumed = true;
        st.active_token = None;
    }

    let (csrf_token, cookie) = issue_session_cookie(&state, &headers, &user_id);
    let mut resp = v2_json(
        StatusCode::CREATED,
        serde_json::json!({
            "userId": user_id,
            "username": username,
            "salt": salt_raw,
            "kdfParams": kdf_params,
            "wrappedVaultKey": wrapped_vk_raw,
            "csrfToken": csrf_token,
        }),
    );
    if let Ok(val) = HeaderValue::from_str(&cookie) {
        resp.headers_mut().insert(header::SET_COOKIE, val);
    }
    resp
}

async fn post_login_params(
    State(state): State<AppState>,
    headers: HeaderMap,
    body_bytes: Bytes,
) -> Response {
    if let Err(resp) = require_https_or_localhost(&headers) {
        return resp;
    }
    if let Err(resp) = enforce_login_rate_limit(&state, &headers) {
        return resp;
    }

    let body: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap_or_default();
    let username = body
        .get("username")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if !is_valid_v2_username(&username) {
        return v2_json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "INVALID_USERNAME" }),
        );
    }

    let row: Option<(String, String, Vec<u8>)> = {
        let conn = state.zk_v2.db.lock().unwrap();
        conn.query_row(
            "SELECT user_salt, kdf_params, server_salt FROM users_v2 WHERE username = ?1",
            params![&username],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .ok()
        .flatten()
    };

    // Timing-uniform dummy scrypt for both existing and non-existing users
    let dummy_secret = derive_hmac_sha256(
        &state.zk_v2.server_secret,
        &format!("PhotoCloud-v2-params-timing|{}", username.to_lowercase()),
    );
    let dummy_salt = match &row {
        Some((_, _, server_salt)) => server_salt.clone(),
        None => dummy_secret[..16].to_vec(),
    };
    let _ = tokio::task::spawn_blocking(move || compute_scrypt_verifier(&dummy_secret, &dummy_salt))
        .await;

    if let Some((user_salt, kdf_params_str, _)) = row {
        let parsed_kdf: KdfParamsV2 =
            serde_json::from_str(&kdf_params_str).unwrap_or_default();
        return v2_json(
            StatusCode::OK,
            serde_json::json!({
                "salt": user_salt,
                "kdfParams": parsed_kdf,
            }),
        );
    }

    let fake_salt = derive_fake_salt_for_username(&state.zk_v2.server_secret, &username);
    v2_json(
        StatusCode::OK,
        serde_json::json!({
            "salt": fake_salt,
            "kdfParams": KdfParamsV2::default(),
        }),
    )
}

async fn post_login(
    State(state): State<AppState>,
    headers: HeaderMap,
    body_bytes: Bytes,
) -> Response {
    if let Err(resp) = require_https_or_localhost(&headers) {
        return resp;
    }
    if let Err(resp) = enforce_login_rate_limit(&state, &headers) {
        return resp;
    }

    let body: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap_or_default();
    let username = body
        .get("username")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let auth_secret_raw = body.get("authSecret").and_then(|v| v.as_str()).unwrap_or("");
    let Some(mut auth_secret_buf) = decode_base64url_strict(auth_secret_raw, 32) else {
        return v2_json(
            StatusCode::UNAUTHORIZED,
            serde_json::json!({ "error": "INVALID_CREDENTIALS" }),
        );
    };
    if !is_valid_v2_username(&username) {
        auth_secret_buf.fill(0);
        return v2_json(
            StatusCode::UNAUTHORIZED,
            serde_json::json!({ "error": "INVALID_CREDENTIALS" }),
        );
    }

    let row: Option<UserRecordV2> = {
        let conn = state.zk_v2.db.lock().unwrap();
        conn.query_row(
            "SELECT id, username, user_salt, kdf_params, server_salt, auth_verifier, wrapped_vk, quota_bytes
             FROM users_v2 WHERE username = ?1",
            params![&username],
            |r| {
                Ok(UserRecordV2 {
                    id: r.get(0)?,
                    username: r.get(1)?,
                    user_salt: r.get(2)?,
                    kdf_params: r.get(3)?,
                    server_salt: r.get(4)?,
                    auth_verifier: r.get(5)?,
                    wrapped_vk: r.get(6)?,
                    quota_bytes: r.get(7)?,
                })
            },
        )
        .optional()
        .ok()
        .flatten()
    };

    let Some(user) = row else {
        let fake_server_salt = derive_hmac_sha256(
            &state.zk_v2.server_secret,
            &format!("PhotoCloud-v2-fake-server-salt|{}", username.to_lowercase()),
        )[..16]
            .to_vec();
        let _ = tokio::task::spawn_blocking(move || {
            let _ = compute_scrypt_verifier(&auth_secret_buf, &fake_server_salt);
            auth_secret_buf.fill(0);
        })
        .await;
        return v2_json(
            StatusCode::UNAUTHORIZED,
            serde_json::json!({ "error": "INVALID_CREDENTIALS" }),
        );
    };

    let server_salt = user.server_salt.clone();
    let expected_verifier = user.auth_verifier.clone();
    let ok = tokio::task::spawn_blocking(move || {
        let res = verify_scrypt_constant_time(&auth_secret_buf, &server_salt, &expected_verifier);
        auth_secret_buf.fill(0);
        res
    })
    .await
    .unwrap_or(false);

    if !ok {
        return v2_json(
            StatusCode::UNAUTHORIZED,
            serde_json::json!({ "error": "INVALID_CREDENTIALS" }),
        );
    }

    let (csrf_token, cookie) = issue_session_cookie(&state, &headers, &user.id);
    let parsed_kdf: KdfParamsV2 = serde_json::from_str(&user.kdf_params).unwrap_or_default();
    let mut resp = v2_json(
        StatusCode::OK,
        serde_json::json!({
            "userId": user.id,
            "username": user.username,
            "salt": user.user_salt,
            "kdfParams": parsed_kdf,
            "wrappedVaultKey": user.wrapped_vk,
            "csrfToken": csrf_token,
        }),
    );
    if let Ok(val) = HeaderValue::from_str(&cookie) {
        resp.headers_mut().insert(header::SET_COOKIE, val);
    }
    resp
}

async fn post_logout(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Some(sess) = get_authenticated_session(&state, &headers) {
        let conn = state.zk_v2.db.lock().unwrap();
        let _ = conn.execute(
            "DELETE FROM sessions_v2 WHERE sid_hash = ?1",
            params![&sess.sid_hash],
        );
    }
    let cookie = clear_session_cookie(&headers);
    let mut resp = v2_json(StatusCode::OK, serde_json::json!({ "ok": true }));
    if let Ok(val) = HeaderValue::from_str(&cookie) {
        resp.headers_mut().insert(header::SET_COOKIE, val);
    }
    resp
}

async fn post_account_rewrap(
    State(state): State<AppState>,
    headers: HeaderMap,
    body_bytes: Bytes,
) -> Response {
    if let Err(resp) = require_https_or_localhost(&headers) {
        return resp;
    }
    let sess = match require_auth(&state, &headers) {
        Ok(s) => s,
        Err(resp) => return resp,
    };

    let body: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap_or_default();
    let old_secret_raw = body
        .get("oldAuthSecret")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let new_secret_raw = body
        .get("newAuthSecret")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let new_wrapped_vk = body
        .get("newWrappedVaultKey")
        .or_else(|| body.get("wrappedVaultKey"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let Some(mut old_secret_buf) = decode_base64url_strict(old_secret_raw, 32) else {
        return v2_json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "INVALID_REWRAP_PAYLOAD" }),
        );
    };
    let Some(mut new_secret_buf) = decode_base64url_strict(new_secret_raw, 32) else {
        old_secret_buf.fill(0);
        return v2_json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "INVALID_REWRAP_PAYLOAD" }),
        );
    };
    if decode_base64url_strict(new_wrapped_vk, 60).is_none() {
        old_secret_buf.fill(0);
        new_secret_buf.fill(0);
        return v2_json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "INVALID_REWRAP_PAYLOAD" }),
        );
    }

    let user_row: Option<(String, String, Vec<u8>, Vec<u8>)> = {
        let conn = state.zk_v2.db.lock().unwrap();
        conn.query_row(
            "SELECT user_salt, kdf_params, server_salt, auth_verifier FROM users_v2 WHERE id = ?1",
            params![&sess.user_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
        .ok()
        .flatten()
    };

    let Some((cur_user_salt, cur_kdf_json, cur_server_salt, cur_verifier)) = user_row else {
        old_secret_buf.fill(0);
        new_secret_buf.fill(0);
        return v2_json(
            StatusCode::UNAUTHORIZED,
            serde_json::json!({ "error": "UNAUTHENTICATED" }),
        );
    };

    let valid_old = tokio::task::spawn_blocking(move || {
        let ok = verify_scrypt_constant_time(&old_secret_buf, &cur_server_salt, &cur_verifier);
        old_secret_buf.fill(0);
        ok
    })
    .await
    .unwrap_or(false);

    if !valid_old {
        new_secret_buf.fill(0);
        return v2_json(
            StatusCode::UNAUTHORIZED,
            serde_json::json!({ "error": "INVALID_OLD_AUTH_SECRET" }),
        );
    }

    let next_user_salt = match body.get("newSalt").or_else(|| body.get("salt")) {
        Some(v) if !v.is_null() => {
            let s = v.as_str().unwrap_or("");
            if decode_base64url_strict(s, 16).is_none() {
                new_secret_buf.fill(0);
                return v2_json(
                    StatusCode::BAD_REQUEST,
                    serde_json::json!({ "error": "INVALID_USER_SALT" }),
                );
            }
            s.to_string()
        }
        _ => cur_user_salt,
    };

    let next_kdf_json = match body.get("newKdfParams").or_else(|| body.get("kdfParams")) {
        Some(v) if !v.is_null() => match validate_kdf_params(v) {
            Some(parsed) => serde_json::to_string(&parsed).unwrap(),
            None => {
                new_secret_buf.fill(0);
                return v2_json(
                    StatusCode::BAD_REQUEST,
                    serde_json::json!({ "error": "INVALID_KDF_PARAMS" }),
                );
            }
        },
        _ => cur_kdf_json,
    };

    let new_server_salt = random_bytes(16);
    let salt_clone = new_server_salt.clone();
    let new_verifier = match tokio::task::spawn_blocking(move || {
        let res = compute_scrypt_verifier(&new_secret_buf, &salt_clone);
        new_secret_buf.fill(0);
        res
    })
    .await
    {
        Ok(Ok(v)) => v,
        _ => {
            return v2_json(
                StatusCode::INTERNAL_SERVER_ERROR,
                serde_json::json!({ "error": "KDF_FAILED" }),
            );
        }
    };

    let now = now_ms_i64();
    {
        let conn = state.zk_v2.db.lock().unwrap();
        let _ = conn.execute("BEGIN IMMEDIATE", []);
        let upd = conn.execute(
            "UPDATE users_v2
             SET user_salt = ?1, kdf_params = ?2, server_salt = ?3, auth_verifier = ?4, wrapped_vk = ?5, updated_at = ?6
             WHERE id = ?7",
            params![
                &next_user_salt,
                &next_kdf_json,
                &new_server_salt,
                &new_verifier,
                new_wrapped_vk,
                now,
                &sess.user_id
            ],
        );
        let del = conn.execute(
            "DELETE FROM sessions_v2 WHERE user_id = ?1 AND sid_hash != ?2",
            params![&sess.user_id, &sess.sid_hash],
        );
        if upd.is_ok() && del.is_ok() {
            let _ = conn.execute("COMMIT", []);
        } else {
            let _ = conn.execute("ROLLBACK", []);
            return v2_json(
                StatusCode::INTERNAL_SERVER_ERROR,
                serde_json::json!({ "error": "REWRAP_DB_ERROR" }),
            );
        }
    }

    let parsed_kdf: KdfParamsV2 = serde_json::from_str(&next_kdf_json).unwrap_or_default();
    v2_json(
        StatusCode::OK,
        serde_json::json!({
            "ok": true,
            "salt": next_user_salt,
            "kdfParams": parsed_kdf,
            "wrappedVaultKey": new_wrapped_vk,
        }),
    )
}

// ============================================================================
// 2. BLOB CHUNKED UPLOAD & RANGE DOWNLOAD
// ============================================================================

async fn post_blob_upload_init(
    State(state): State<AppState>,
    headers: HeaderMap,
    body_bytes: Bytes,
) -> Response {
    let sess = match require_auth(&state, &headers) {
        Ok(s) => s,
        Err(resp) => return resp,
    };

    let now = now_ms_i64();
    state.zk_v2.cleanup_expired_uploads(now);

    let body: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap_or_default();
    let blob_id_raw = body.get("blobId").and_then(|v| v.as_str()).unwrap_or("");
    if !is_valid_uuid_v4(blob_id_raw) {
        return v2_json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "INVALID_BLOB_ID" }),
        );
    }
    let norm_blob_id = blob_id_raw.to_lowercase();

    let item_id: Option<String> = match body.get("itemId") {
        Some(v) if !v.is_null() => {
            let s = v.as_str().unwrap_or("");
            if !is_valid_uuid_v4(s) {
                return v2_json(
                    StatusCode::BAD_REQUEST,
                    serde_json::json!({ "error": "INVALID_ITEM_ID" }),
                );
            }
            Some(s.to_lowercase())
        }
        _ => None,
    };

    let Some(total_size) = body.get("totalSize").and_then(|v| v.as_u64()) else {
        return v2_json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "INVALID_TOTAL_SIZE" }),
        );
    };
    if total_size < PCZK_MIN_BLOB_BYTES || total_size > state.zk_v2.max_upload_bytes {
        return v2_json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "INVALID_TOTAL_SIZE" }),
        );
    }

    let chunk_size = body
        .get("chunkSize")
        .and_then(|v| v.as_u64())
        .unwrap_or(total_size);
    let total_chunks = body
        .get("totalChunks")
        .and_then(|v| v.as_u64())
        .unwrap_or(1);
    if chunk_size == 0
        || chunk_size > MAX_CHUNK_BODY_BYTES as u64
        || total_chunks < 1
        || total_chunks > state.zk_v2.max_upload_chunks
    {
        return v2_json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "INVALID_CHUNK_SPEC" }),
        );
    }

    let expected_sha256 = body
        .get("expectedSha256")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_lowercase();
    if !is_valid_sha256_hex(&expected_sha256) {
        return v2_json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "INVALID_EXPECTED_SHA256" }),
        );
    }

    let Some(enc_meta) = body
        .get("encMeta")
        .and_then(|v| v.as_str())
        .and_then(validate_enc_meta_string)
    else {
        return v2_json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "INVALID_ENC_META" }),
        );
    };

    let dedup_tag = match validate_optional_dedup_tag(body.get("dedupTag")) {
        Ok(v) => v,
        Err(()) => {
            return v2_json(
                StatusCode::BAD_REQUEST,
                serde_json::json!({ "error": "INVALID_DEDUP_TAG" }),
            );
        }
    };

    let upload_id = random_uuid_v4();
    let temp_path = state
        .zk_v2
        .temp_upload_dir
        .join(format!("v2_upload_{upload_id}.part"));
    let temp_path_str = temp_path.to_string_lossy().to_string();
    let expires_at = now + state.zk_v2.upload_ttl_ms;

    {
        let conn = state.zk_v2.db.lock().unwrap();
        let exists: Option<String> = conn
            .query_row(
                "SELECT id FROM items_v2 WHERE blob_id = ?1",
                params![&norm_blob_id],
                |r| r.get(0),
            )
            .optional()
            .ok()
            .flatten();
        if exists.is_some() {
            return v2_json(
                StatusCode::CONFLICT,
                serde_json::json!({ "error": "BLOB_ID_ALREADY_EXISTS" }),
            );
        }

        let usage = state.zk_v2.get_user_usage(&conn, &sess.user_id);
        let inflight_bytes: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(total_size), 0) FROM uploads_v2 WHERE owner_id = ?1",
                params![&sess.user_id],
                |r| r.get(0),
            )
            .unwrap_or(0);

        if usage.active_bytes + usage.trashed_bytes + inflight_bytes + (total_size as i64)
            > sess.quota_bytes
        {
            return v2_json(
                StatusCode::PAYLOAD_TOO_LARGE,
                serde_json::json!({ "error": "QUOTA_EXCEEDED" }),
            );
        }

        let _ = fs::create_dir_all(&state.zk_v2.temp_upload_dir);
        let mut opts = OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        if opts.open(&temp_path).is_err() {
            return v2_json(
                StatusCode::INTERNAL_SERVER_ERROR,
                serde_json::json!({ "error": "UPLOAD_INIT_IO_ERROR" }),
            );
        }

        if conn
            .execute(
                "INSERT INTO uploads_v2 (
                   upload_id, owner_id, blob_id, total_size, chunk_size, total_chunks,
                   received_chunks, received_bytes, expected_sha256, enc_meta, dedup_tag,
                   item_id, temp_path, created_at, expires_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 0, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                params![
                    &upload_id,
                    &sess.user_id,
                    &norm_blob_id,
                    total_size as i64,
                    chunk_size as i64,
                    total_chunks as i64,
                    &expected_sha256,
                    &enc_meta,
                    &dedup_tag,
                    &item_id,
                    &temp_path_str,
                    now,
                    expires_at
                ],
            )
            .is_err()
        {
            let _ = fs::remove_file(&temp_path);
            return v2_json(
                StatusCode::INTERNAL_SERVER_ERROR,
                serde_json::json!({ "error": "UPLOAD_INIT_DB_ERROR" }),
            );
        }
    }

    v2_json(
        StatusCode::CREATED,
        serde_json::json!({
            "uploadId": upload_id,
            "blobId": norm_blob_id,
            "receivedChunks": 0,
            "expiresAt": expires_at,
        }),
    )
}

fn load_upload_session(
    conn: &rusqlite::Connection,
    upload_id: &str,
    owner_id: &str,
) -> Option<UploadSessionV2> {
    conn.query_row(
        "SELECT upload_id, owner_id, blob_id, total_size, chunk_size, total_chunks,
                received_chunks, received_bytes, expected_sha256, enc_meta, dedup_tag,
                item_id, temp_path, created_at, expires_at
         FROM uploads_v2 WHERE upload_id = ?1 AND owner_id = ?2",
        params![upload_id, owner_id],
        |r| {
            Ok(UploadSessionV2 {
                upload_id: r.get(0)?,
                owner_id: r.get(1)?,
                blob_id: r.get(2)?,
                total_size: r.get(3)?,
                chunk_size: r.get(4)?,
                total_chunks: r.get(5)?,
                received_chunks: r.get(6)?,
                received_bytes: r.get(7)?,
                expected_sha256: r.get(8)?,
                enc_meta: r.get(9)?,
                dedup_tag: r.get(10)?,
                item_id: r.get(11)?,
                temp_path: r.get(12)?,
                created_at: r.get(13)?,
                expires_at: r.get(14)?,
            })
        },
    )
    .optional()
    .ok()
    .flatten()
}

async fn put_blob_upload_chunk(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((upload_id, chunk_index_raw)): Path<(String, String)>,
    body: Bytes,
) -> Response {
    let sess = match require_auth(&state, &headers) {
        Ok(s) => s,
        Err(resp) => return resp,
    };

    if !is_valid_uuid_v4(&upload_id) {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        );
    }

    let Ok(chunk_index) = chunk_index_raw.parse::<i64>() else {
        return v2_json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "INVALID_CHUNK_INDEX" }),
        );
    };
    if chunk_index < 0 {
        return v2_json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "INVALID_CHUNK_INDEX" }),
        );
    }

    let upload_row = {
        let conn = state.zk_v2.db.lock().unwrap();
        load_upload_session(&conn, &upload_id, &sess.user_id)
    };

    let Some(upload) = upload_row else {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        );
    };

    if now_ms_i64() >= upload.expires_at {
        {
            let conn = state.zk_v2.db.lock().unwrap();
            let _ = conn.execute(
                "DELETE FROM uploads_v2 WHERE upload_id = ?1",
                params![&upload_id],
            );
        }
        let _ = fs::remove_file(&upload.temp_path);
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "UPLOAD_EXPIRED" }),
        );
    }

    if chunk_index != upload.received_chunks {
        return v2_json(
            StatusCode::CONFLICT,
            serde_json::json!({
                "error": "CHUNK_OUT_OF_ORDER",
                "expectedChunkIndex": upload.received_chunks,
            }),
        );
    }

    if chunk_index >= upload.total_chunks {
        return v2_json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "CHUNK_INDEX_EXCEEDS_TOTAL" }),
        );
    }

    if body.is_empty() {
        return v2_json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "EMPTY_CHUNK_BODY" }),
        );
    }

    let new_received_bytes = upload.received_bytes + (body.len() as i64);
    if new_received_bytes > upload.total_size {
        return v2_json(
            StatusCode::PAYLOAD_TOO_LARGE,
            serde_json::json!({ "error": "UPLOAD_SIZE_EXCEEDED" }),
        );
    }

    if chunk_index == 0 {
        if body.len() < 22 {
            return v2_json(
                StatusCode::BAD_REQUEST,
                serde_json::json!({ "error": "INVALID_PCZK_HEADER" }),
            );
        }
        if &body[0..4] != PCZK_MAGIC || body[4] != PCZK_VERSION_V1 {
            return v2_json(
                StatusCode::BAD_REQUEST,
                serde_json::json!({ "error": "INVALID_PCZK_MAGIC_OR_VERSION" }),
            );
        }
        let header_blob_hex = hex::encode(&body[6..22]);
        let expected_blob_hex = upload.blob_id.replace('-', "").to_lowercase();
        if header_blob_hex != expected_blob_hex {
            return v2_json(
                StatusCode::BAD_REQUEST,
                serde_json::json!({ "error": "HEADER_BLOB_ID_MISMATCH" }),
            );
        }
    }

    let write_ok = (|| -> std::io::Result<()> {
        let mut opts = OpenOptions::new();
        opts.append(true).create(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut file = opts.open(&upload.temp_path)?;
        file.write_all(&body)?;
        file.sync_all()?;
        Ok(())
    })();

    if write_ok.is_err() {
        return v2_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            serde_json::json!({ "error": "CHUNK_WRITE_FAILED" }),
        );
    }

    let next_received_chunks = chunk_index + 1;
    {
        let conn = state.zk_v2.db.lock().unwrap();
        let _ = conn.execute(
            "UPDATE uploads_v2
             SET received_chunks = ?1, received_bytes = ?2
             WHERE upload_id = ?3 AND owner_id = ?4",
            params![
                next_received_chunks,
                new_received_bytes,
                &upload_id,
                &sess.user_id
            ],
        );
    }

    v2_json(
        StatusCode::OK,
        serde_json::json!({
            "uploadId": upload_id,
            "chunkIndex": chunk_index,
            "receivedChunks": next_received_chunks,
            "receivedBytes": new_received_bytes,
        }),
    )
}

async fn post_blob_upload_complete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(upload_id): Path<String>,
    body_bytes: Bytes,
) -> Response {
    let sess = match require_auth(&state, &headers) {
        Ok(s) => s,
        Err(resp) => return resp,
    };

    if !is_valid_uuid_v4(&upload_id) {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        );
    }

    let upload_row = {
        let conn = state.zk_v2.db.lock().unwrap();
        load_upload_session(&conn, &upload_id, &sess.user_id)
    };
    let Some(upload) = upload_row else {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        );
    };

    if upload.received_chunks != upload.total_chunks
        || upload.received_bytes != upload.total_size
    {
        return v2_json(
            StatusCode::CONFLICT,
            serde_json::json!({
                "error": "UPLOAD_INCOMPLETE",
                "receivedChunks": upload.received_chunks,
                "totalChunks": upload.total_chunks,
                "receivedBytes": upload.received_bytes,
                "totalSize": upload.total_size,
            }),
        );
    }

    let temp_path = PathBuf::from(&upload.temp_path);
    let Ok(meta) = fs::metadata(&temp_path) else {
        let conn = state.zk_v2.db.lock().unwrap();
        let _ = conn.execute(
            "DELETE FROM uploads_v2 WHERE upload_id = ?1",
            params![&upload_id],
        );
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "UPLOAD_TEMP_MISSING" }),
        );
    };

    if meta.len() as i64 != upload.total_size {
        let _ = fs::remove_file(&temp_path);
        let conn = state.zk_v2.db.lock().unwrap();
        let _ = conn.execute(
            "DELETE FROM uploads_v2 WHERE upload_id = ?1",
            params![&upload_id],
        );
        return v2_json(
            StatusCode::UNPROCESSABLE_ENTITY,
            serde_json::json!({ "error": "CIPHERTEXT_SIZE_MISMATCH" }),
        );
    }

    let temp_for_hash = temp_path.clone();
    let actual_sha256 = match tokio::task::spawn_blocking(move || {
        compute_file_sha256_hex(&temp_for_hash)
    })
    .await
    {
        Ok(Ok(h)) => h,
        _ => {
            return v2_json(
                StatusCode::INTERNAL_SERVER_ERROR,
                serde_json::json!({ "error": "SHA256_COMPUTE_FAILED" }),
            );
        }
    };

    if !timing_safe_hex_equal(&actual_sha256, &upload.expected_sha256) {
        let _ = fs::remove_file(&temp_path);
        let conn = state.zk_v2.db.lock().unwrap();
        let _ = conn.execute(
            "DELETE FROM uploads_v2 WHERE upload_id = ?1",
            params![&upload_id],
        );
        return v2_json(
            StatusCode::UNPROCESSABLE_ENTITY,
            serde_json::json!({ "error": "CIPHERTEXT_INTEGRITY_MISMATCH" }),
        );
    }

    {
        let conn = state.zk_v2.db.lock().unwrap();
        let usage = state.zk_v2.get_user_usage(&conn, &sess.user_id);
        if usage.active_bytes + usage.trashed_bytes + upload.total_size > sess.quota_bytes {
            let _ = fs::remove_file(&temp_path);
            let _ = conn.execute(
                "DELETE FROM uploads_v2 WHERE upload_id = ?1",
                params![&upload_id],
            );
            return v2_json(
                StatusCode::PAYLOAD_TOO_LARGE,
                serde_json::json!({ "error": "QUOTA_EXCEEDED" }),
            );
        }
    }

    let Ok(final_blob_path) = state
        .zk_v2
        .resolve_blob_path(&sess.user_id, &upload.blob_id, "")
    else {
        return v2_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            serde_json::json!({ "error": "BLOB_PATH_ERROR" }),
        );
    };

    if move_temp_file_atomic(&temp_path, &final_blob_path).is_err() {
        return v2_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            serde_json::json!({ "error": "BLOB_COMMIT_IO_ERROR" }),
        );
    }

    let body: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap_or_default();
    let create_item = body.get("createItem").and_then(|v| v.as_bool()) != Some(false);
    let item_id = upload.item_id.unwrap_or_else(|| upload.blob_id.clone());
    let now = now_ms_i64();

    let created_item: Option<ItemRecordV2> = {
        let conn = state.zk_v2.db.lock().unwrap();
        let _ = conn.execute("BEGIN IMMEDIATE", []);
        let del_res = conn.execute(
            "DELETE FROM uploads_v2 WHERE upload_id = ?1",
            params![&upload_id],
        );
        let ins_res = if create_item {
            conn.execute(
                "INSERT INTO items_v2 (
                   id, owner_id, blob_id, version, size, sha256_hex, enc_meta, dedup_tag,
                   state, trashed_at, thumb_320, thumb_1280, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6, ?7, 'active', NULL, 0, 0, ?8, ?9)",
                params![
                    &item_id,
                    &sess.user_id,
                    &upload.blob_id,
                    upload.total_size,
                    &actual_sha256,
                    &upload.enc_meta,
                    &upload.dedup_tag,
                    now,
                    now
                ],
            )
        } else {
            Ok(0)
        };

        if del_res.is_ok() && ins_res.is_ok() {
            let _ = conn.execute("COMMIT", []);
            if create_item {
                conn.query_row(
                    &format!(
                        "SELECT {ITEM_V2_SELECT_COLS} FROM items_v2 WHERE id = ?1 AND owner_id = ?2"
                    ),
                    params![&item_id, &sess.user_id],
                    row_to_item_v2,
                )
                .ok()
            } else {
                None
            }
        } else {
            let _ = conn.execute("ROLLBACK", []);
            let _ = fs::remove_file(&final_blob_path);
            return v2_json(
                StatusCode::CONFLICT,
                serde_json::json!({ "error": "ITEM_CONFLICT" }),
            );
        }
    };

    if let Some(item) = created_item {
        v2_json(
            StatusCode::CREATED,
            serde_json::json!({ "item": item.to_json() }),
        )
    } else {
        v2_json(
            StatusCode::CREATED,
            serde_json::json!({
                "blobId": upload.blob_id,
                "size": upload.total_size,
                "sha256": actual_sha256,
            }),
        )
    }
}

async fn delete_blob_upload(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(upload_id): Path<String>,
) -> Response {
    let sess = match require_auth(&state, &headers) {
        Ok(s) => s,
        Err(resp) => return resp,
    };

    if !is_valid_uuid_v4(&upload_id) {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        );
    }

    let temp_path_opt: Option<String> = {
        let conn = state.zk_v2.db.lock().unwrap();
        let found: Option<String> = conn
            .query_row(
                "SELECT temp_path FROM uploads_v2 WHERE upload_id = ?1 AND owner_id = ?2",
                params![&upload_id, &sess.user_id],
                |r| r.get(0),
            )
            .optional()
            .ok()
            .flatten();
        if found.is_some() {
            let _ = conn.execute(
                "DELETE FROM uploads_v2 WHERE upload_id = ?1 AND owner_id = ?2",
                params![&upload_id, &sess.user_id],
            );
        }
        found
    };

    let Some(temp_path) = temp_path_opt else {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        );
    };

    if !temp_path.is_empty() {
        let _ = fs::remove_file(&temp_path);
    }

    v2_json(
        StatusCode::OK,
        serde_json::json!({
            "ok": true,
            "uploadId": upload_id,
        }),
    )
}

fn serve_ciphertext_blob_with_range(
    req_headers: &HeaderMap,
    file_path: &PathBuf,
    total_size: u64,
    sha256_hex: &str,
) -> Response {
    if !file_path.exists() {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        );
    }

    let etag = format!("\"{sha256_hex}\"");
    let has_range = req_headers.contains_key(header::RANGE);
    if !has_range {
        if let Some(inm) = req_headers
            .get(header::IF_NONE_MATCH)
            .and_then(|v| v.to_str().ok())
        {
            if inm.trim() == etag {
                let mut resp = StatusCode::NOT_MODIFIED.into_response();
                let h = resp.headers_mut();
                h.insert(header::ETAG, HeaderValue::from_str(&etag).unwrap());
                h.insert(
                    header::CACHE_CONTROL,
                    HeaderValue::from_static("private, max-age=31536000, immutable"),
                );
                apply_v2_api_headers(h);
                return resp;
            }
        }
    }

    let range_hdr = req_headers.get(header::RANGE).and_then(|v| v.to_str().ok());
    let parsed_range = parse_http_range_header(range_hdr, total_size);

    match parsed_range {
        ParsedHttpRange::Unsatisfiable => {
            let mut resp = StatusCode::RANGE_NOT_SATISFIABLE.into_response();
            let h = resp.headers_mut();
            h.insert(
                header::CONTENT_RANGE,
                HeaderValue::from_str(&format!("bytes */{total_size}")).unwrap(),
            );
            apply_v2_api_headers(h);
            resp
        }
        ParsedHttpRange::None => match fs::read(file_path) {
            Ok(data) => {
                let mut resp = (StatusCode::OK, data).into_response();
                let h = resp.headers_mut();
                h.insert(
                    header::CONTENT_TYPE,
                    HeaderValue::from_static("application/octet-stream"),
                );
                h.insert(
                    header::CACHE_CONTROL,
                    HeaderValue::from_static("private, max-age=31536000, immutable"),
                );
                h.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
                h.insert(header::ETAG, HeaderValue::from_str(&etag).unwrap());
                apply_v2_api_headers(h);
                resp
            }
            Err(_) => v2_json(
                StatusCode::INTERNAL_SERVER_ERROR,
                serde_json::json!({ "error": "BLOB_READ_ERROR" }),
            ),
        },
        ParsedHttpRange::Satisfiable { start, end } => {
            let chunk_len = (end - start + 1) as usize;
            let read_res = (|| -> std::io::Result<Vec<u8>> {
                let mut f = File::open(file_path)?;
                f.seek(SeekFrom::Start(start))?;
                let mut buf = vec![0u8; chunk_len];
                f.read_exact(&mut buf)?;
                Ok(buf)
            })();
            match read_res {
                Ok(buf) => {
                    let mut resp = (StatusCode::PARTIAL_CONTENT, buf).into_response();
                    let h = resp.headers_mut();
                    h.insert(
                        header::CONTENT_TYPE,
                        HeaderValue::from_static("application/octet-stream"),
                    );
                    h.insert(
                        header::CACHE_CONTROL,
                        HeaderValue::from_static("private, max-age=31536000, immutable"),
                    );
                    h.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
                    h.insert(header::ETAG, HeaderValue::from_str(&etag).unwrap());
                    h.insert(
                        header::CONTENT_RANGE,
                        HeaderValue::from_str(&format!("bytes {start}-{end}/{total_size}"))
                            .unwrap(),
                    );
                    apply_v2_api_headers(h);
                    resp
                }
                Err(_) => v2_json(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    serde_json::json!({ "error": "BLOB_READ_ERROR" }),
                ),
            }
        }
    }
}

async fn get_blob(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(blob_id): Path<String>,
) -> Response {
    let sess = match require_auth(&state, &headers) {
        Ok(s) => s,
        Err(resp) => return resp,
    };
    if !is_valid_uuid_v4(&blob_id) {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        );
    }
    let norm_blob = blob_id.to_lowercase();
    let item_info: Option<(i64, String)> = {
        let conn = state.zk_v2.db.lock().unwrap();
        conn.query_row(
            "SELECT size, sha256_hex FROM items_v2 WHERE blob_id = ?1 AND owner_id = ?2",
            params![&norm_blob, &sess.user_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .ok()
        .flatten()
    };

    let Some((size, sha256_hex)) = item_info else {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        );
    };
    let Ok(blob_path) = state.zk_v2.resolve_blob_path(&sess.user_id, &norm_blob, "") else {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        );
    };

    serve_ciphertext_blob_with_range(&headers, &blob_path, size.max(0) as u64, &sha256_hex)
}

async fn put_blob_thumb(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((blob_id, variant)): Path<(String, String)>,
    body: Bytes,
) -> Response {
    let sess = match require_auth(&state, &headers) {
        Ok(s) => s,
        Err(resp) => return resp,
    };
    if !is_valid_uuid_v4(&blob_id) || (variant != "320" && variant != "1280") {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        );
    }
    let norm_blob = blob_id.to_lowercase();

    let item_id: Option<String> = {
        let conn = state.zk_v2.db.lock().unwrap();
        conn.query_row(
            "SELECT id FROM items_v2 WHERE blob_id = ?1 AND owner_id = ?2",
            params![&norm_blob, &sess.user_id],
            |r| r.get(0),
        )
        .optional()
        .ok()
        .flatten()
    };

    let Some(item_id) = item_id else {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        );
    };

    if body.len() < 28 || body.len() > MAX_THUMB_BLOB_BYTES {
        return v2_json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "INVALID_THUMB_SIZE" }),
        );
    }
    if body.len() >= 5 && &body[0..4] == PCZK_MAGIC && body[4] != PCZK_VERSION_V1 {
        return v2_json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "INVALID_PCZK_MAGIC_OR_VERSION" }),
        );
    }

    let suffix = if variant == "320" {
        ".thumb320.pczk"
    } else {
        ".thumb1280.pczk"
    };
    let Ok(thumb_path) = state
        .zk_v2
        .resolve_blob_path(&sess.user_id, &norm_blob, suffix)
    else {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        );
    };

    if write_buffer_atomic(&state.zk_v2.temp_upload_dir, &thumb_path, &body).is_err() {
        return v2_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            serde_json::json!({ "error": "THUMB_WRITE_ERROR" }),
        );
    }

    let col = if variant == "320" {
        "thumb_320"
    } else {
        "thumb_1280"
    };
    {
        let conn = state.zk_v2.db.lock().unwrap();
        let _ = conn.execute(
            &format!("UPDATE items_v2 SET {col} = 1, updated_at = ?1 WHERE id = ?2 AND owner_id = ?3"),
            params![now_ms_i64(), &item_id, &sess.user_id],
        );
    }

    let variant_num: u32 = variant.parse().unwrap_or(320);
    v2_json(
        StatusCode::OK,
        serde_json::json!({
            "ok": true,
            "blobId": norm_blob,
            "variant": variant_num,
        }),
    )
}

async fn get_blob_thumb(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((blob_id, variant)): Path<(String, String)>,
) -> Response {
    let sess = match require_auth(&state, &headers) {
        Ok(s) => s,
        Err(resp) => return resp,
    };
    if !is_valid_uuid_v4(&blob_id) || (variant != "320" && variant != "1280") {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        );
    }
    let norm_blob = blob_id.to_lowercase();
    let row: Option<(i64, i64)> = {
        let conn = state.zk_v2.db.lock().unwrap();
        conn.query_row(
            "SELECT thumb_320, thumb_1280 FROM items_v2 WHERE blob_id = ?1 AND owner_id = ?2",
            params![&norm_blob, &sess.user_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .ok()
        .flatten()
    };

    let Some((t320, t1280)) = row else {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        );
    };
    let has_thumb = if variant == "320" {
        t320 != 0
    } else {
        t1280 != 0
    };
    if !has_thumb {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        );
    }

    let suffix = if variant == "320" {
        ".thumb320.pczk"
    } else {
        ".thumb1280.pczk"
    };
    let Ok(thumb_path) = state
        .zk_v2
        .resolve_blob_path(&sess.user_id, &norm_blob, suffix)
    else {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        );
    };
    let Ok(data) = fs::read(&thumb_path) else {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        );
    };
    let sha = hex::encode(Sha256::digest(&data));
    serve_ciphertext_blob_with_range(&headers, &thumb_path, data.len() as u64, &sha)
}

// ============================================================================
// 3. ITEM ENDPOINTS
// ============================================================================

async fn get_items(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let sess = match require_auth(&state, &headers) {
        Ok(s) => s,
        Err(resp) => return resp,
    };

    state.zk_v2.purge_expired_trash(now_ms_i64());

    let state_param = query
        .get("state")
        .map(|s| s.as_str())
        .unwrap_or("active");
    if state_param != "active" && state_param != "trashed" {
        return v2_json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "INVALID_STATE_FILTER" }),
        );
    }

    let limit: usize = query
        .get("limit")
        .and_then(|s| s.parse::<usize>().ok())
        .map(|n| n.clamp(1, 500))
        .unwrap_or(100);

    let cursor_raw = query
        .get("cursor")
        .map(|s| s.trim())
        .unwrap_or("");

    let mut rows: Vec<ItemRecordV2> = if !cursor_raw.is_empty() {
        let decoded_bytes = match URL_SAFE_NO_PAD.decode(cursor_raw) {
            Ok(b) => b,
            Err(_) => {
                return v2_json(
                    StatusCode::BAD_REQUEST,
                    serde_json::json!({ "error": "INVALID_CURSOR" }),
                );
            }
        };
        let decoded = String::from_utf8_lossy(&decoded_bytes);
        let Some((ts_str, id_part)) = decoded.split_once('|') else {
            return v2_json(
                StatusCode::BAD_REQUEST,
                serde_json::json!({ "error": "INVALID_CURSOR" }),
            );
        };
        let Ok(cursor_ts) = ts_str.parse::<i64>() else {
            return v2_json(
                StatusCode::BAD_REQUEST,
                serde_json::json!({ "error": "INVALID_CURSOR" }),
            );
        };
        if !is_valid_uuid_v4(id_part) {
            return v2_json(
                StatusCode::BAD_REQUEST,
                serde_json::json!({ "error": "INVALID_CURSOR" }),
            );
        }
        let norm_id = id_part.to_lowercase();
        let conn = state.zk_v2.db.lock().unwrap();
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {ITEM_V2_SELECT_COLS} FROM items_v2
                 WHERE owner_id = ?1 AND state = ?2
                   AND (created_at < ?3 OR (created_at = ?4 AND id < ?5))
                 ORDER BY created_at DESC, id DESC
                 LIMIT ?6"
            ))
            .unwrap();
        stmt.query_map(
            params![&sess.user_id, state_param, cursor_ts, cursor_ts, &norm_id, (limit + 1) as i64],
            row_to_item_v2,
        )
        .map(|it| it.flatten().collect())
        .unwrap_or_default()
    } else {
        let conn = state.zk_v2.db.lock().unwrap();
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {ITEM_V2_SELECT_COLS} FROM items_v2
                 WHERE owner_id = ?1 AND state = ?2
                 ORDER BY created_at DESC, id DESC
                 LIMIT ?3"
            ))
            .unwrap();
        stmt.query_map(
            params![&sess.user_id, state_param, (limit + 1) as i64],
            row_to_item_v2,
        )
        .map(|it| it.flatten().collect())
        .unwrap_or_default()
    };

    let mut next_cursor: Option<String> = None;
    if rows.len() > limit {
        rows.truncate(limit);
        if let Some(last) = rows.last() {
            next_cursor = Some(URL_SAFE_NO_PAD.encode(format!("{}|{}", last.created_at, last.id)));
        }
    }

    let items_json: Vec<serde_json::Value> = rows.iter().map(ItemRecordV2::to_json).collect();
    v2_json(
        StatusCode::OK,
        serde_json::json!({
            "items": items_json,
            "nextCursor": next_cursor,
        }),
    )
}

async fn get_item(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(item_id): Path<String>,
) -> Response {
    let sess = match require_auth(&state, &headers) {
        Ok(s) => s,
        Err(resp) => return resp,
    };
    if !is_valid_uuid_v4(&item_id) {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        );
    }
    let norm_id = item_id.to_lowercase();
    let row: Option<ItemRecordV2> = {
        let conn = state.zk_v2.db.lock().unwrap();
        conn.query_row(
            &format!("SELECT {ITEM_V2_SELECT_COLS} FROM items_v2 WHERE id = ?1 AND owner_id = ?2"),
            params![&norm_id, &sess.user_id],
            row_to_item_v2,
        )
        .optional()
        .ok()
        .flatten()
    };

    match row {
        Some(item) => v2_json(StatusCode::OK, serde_json::json!({ "item": item.to_json() })),
        None => v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        ),
    }
}

async fn patch_item_meta(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(item_id): Path<String>,
    body_bytes: Bytes,
) -> Response {
    let sess = match require_auth(&state, &headers) {
        Ok(s) => s,
        Err(resp) => return resp,
    };
    if !is_valid_uuid_v4(&item_id) {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        );
    }
    let norm_id = item_id.to_lowercase();
    let body: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap_or_default();

    let conn = state.zk_v2.db.lock().unwrap();
    let row: Option<ItemRecordV2> = conn
        .query_row(
            &format!("SELECT {ITEM_V2_SELECT_COLS} FROM items_v2 WHERE id = ?1 AND owner_id = ?2"),
            params![&norm_id, &sess.user_id],
            row_to_item_v2,
        )
        .optional()
        .ok()
        .flatten();

    let Some(item) = row else {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        );
    };

    let Some(enc_meta) = body
        .get("encMeta")
        .and_then(|v| v.as_str())
        .and_then(validate_enc_meta_string)
    else {
        return v2_json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "INVALID_ENC_META" }),
        );
    };

    if let Some(exp_v) = body.get("expectedVersion") {
        if !exp_v.is_null() {
            let exp_num = exp_v.as_i64().unwrap_or(-1);
            if exp_num != item.version {
                return v2_json(
                    StatusCode::PRECONDITION_FAILED,
                    serde_json::json!({
                        "error": "VERSION_MISMATCH",
                        "currentVersion": item.version,
                    }),
                );
            }
        }
    }

    let now = now_ms_i64();
    let next_version = item.version + 1;
    let _ = conn.execute(
        "UPDATE items_v2 SET enc_meta = ?1, version = ?2, updated_at = ?3 WHERE id = ?4 AND owner_id = ?5",
        params![&enc_meta, next_version, now, &norm_id, &sess.user_id],
    );

    let updated: Option<ItemRecordV2> = conn
        .query_row(
            &format!("SELECT {ITEM_V2_SELECT_COLS} FROM items_v2 WHERE id = ?1 AND owner_id = ?2"),
            params![&norm_id, &sess.user_id],
            row_to_item_v2,
        )
        .optional()
        .ok()
        .flatten();

    match updated {
        Some(u) => v2_json(StatusCode::OK, serde_json::json!({ "item": u.to_json() })),
        None => v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        ),
    }
}

async fn post_item_replace(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(item_id): Path<String>,
    body_bytes: Bytes,
) -> Response {
    let sess = match require_auth(&state, &headers) {
        Ok(s) => s,
        Err(resp) => return resp,
    };
    if !is_valid_uuid_v4(&item_id) {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        );
    }
    let norm_id = item_id.to_lowercase();
    let body: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap_or_default();

    let row: Option<ItemRecordV2> = {
        let conn = state.zk_v2.db.lock().unwrap();
        conn.query_row(
            &format!("SELECT {ITEM_V2_SELECT_COLS} FROM items_v2 WHERE id = ?1 AND owner_id = ?2"),
            params![&norm_id, &sess.user_id],
            row_to_item_v2,
        )
        .optional()
        .ok()
        .flatten()
    };

    let Some(item) = row else {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        );
    };

    let exp_version = body.get("expectedVersion").and_then(|v| v.as_i64());
    if exp_version != Some(item.version) {
        return v2_json(
            StatusCode::PRECONDITION_FAILED,
            serde_json::json!({
                "error": "VERSION_MISMATCH",
                "currentVersion": item.version,
            }),
        );
    }

    let new_blob_raw = body.get("newBlobId").and_then(|v| v.as_str()).unwrap_or("");
    if !is_valid_uuid_v4(new_blob_raw) {
        return v2_json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "INVALID_BLOB_ID" }),
        );
    }
    let norm_new_blob = new_blob_raw.to_lowercase();

    let Some(enc_meta) = body
        .get("encMeta")
        .and_then(|v| v.as_str())
        .and_then(validate_enc_meta_string)
    else {
        return v2_json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "INVALID_ENC_META" }),
        );
    };

    let dedup_tag = match validate_optional_dedup_tag(body.get("dedupTag")) {
        Ok(v) => v,
        Err(()) => {
            return v2_json(
                StatusCode::BAD_REQUEST,
                serde_json::json!({ "error": "INVALID_DEDUP_TAG" }),
            );
        }
    };

    let Ok(new_blob_path) = state
        .zk_v2
        .resolve_blob_path(&sess.user_id, &norm_new_blob, "")
    else {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NEW_BLOB_NOT_FOUND" }),
        );
    };
    let Ok(meta) = fs::metadata(&new_blob_path) else {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NEW_BLOB_NOT_FOUND" }),
        );
    };
    let sha256_hex = match compute_file_sha256_hex(&new_blob_path) {
        Ok(h) => h,
        Err(_) => {
            return v2_json(
                StatusCode::INTERNAL_SERVER_ERROR,
                serde_json::json!({ "error": "BLOB_READ_ERROR" }),
            );
        }
    };

    let old_blob_id = item.blob_id.clone();
    let next_version = item.version + 1;
    let now = now_ms_i64();

    let updated: Option<ItemRecordV2> = {
        let conn = state.zk_v2.db.lock().unwrap();
        let _ = conn.execute("BEGIN IMMEDIATE", []);
        let d = conn.execute(
            "DELETE FROM items_v2 WHERE blob_id = ?1 AND owner_id = ?2 AND id != ?3",
            params![&norm_new_blob, &sess.user_id, &norm_id],
        );
        let u = conn.execute(
            "UPDATE items_v2
             SET blob_id = ?1, version = ?2, size = ?3, sha256_hex = ?4, enc_meta = ?5, dedup_tag = ?6,
                 thumb_320 = 0, thumb_1280 = 0, updated_at = ?7
             WHERE id = ?8 AND owner_id = ?9",
            params![
                &norm_new_blob,
                next_version,
                meta.len() as i64,
                &sha256_hex,
                &enc_meta,
                &dedup_tag,
                now,
                &norm_id,
                &sess.user_id
            ],
        );
        if d.is_ok() && u.is_ok() {
            let _ = conn.execute("COMMIT", []);
            conn.query_row(
                &format!("SELECT {ITEM_V2_SELECT_COLS} FROM items_v2 WHERE id = ?1 AND owner_id = ?2"),
                params![&norm_id, &sess.user_id],
                row_to_item_v2,
            )
            .ok()
        } else {
            let _ = conn.execute("ROLLBACK", []);
            return v2_json(
                StatusCode::INTERNAL_SERVER_ERROR,
                serde_json::json!({ "error": "REPLACE_DB_ERROR" }),
            );
        }
    };

    if old_blob_id != norm_new_blob {
        state
            .zk_v2
            .delete_blob_files_best_effort(&sess.user_id, &old_blob_id);
    }

    match updated {
        Some(u) => v2_json(StatusCode::OK, serde_json::json!({ "item": u.to_json() })),
        None => v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        ),
    }
}

async fn delete_item(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(item_id): Path<String>,
) -> Response {
    let sess = match require_auth(&state, &headers) {
        Ok(s) => s,
        Err(resp) => return resp,
    };
    if !is_valid_uuid_v4(&item_id) {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        );
    }
    let norm_id = item_id.to_lowercase();

    let blob_id: Option<String> = {
        let conn = state.zk_v2.db.lock().unwrap();
        let found: Option<String> = conn
            .query_row(
                "SELECT blob_id FROM items_v2 WHERE id = ?1 AND owner_id = ?2",
                params![&norm_id, &sess.user_id],
                |r| r.get(0),
            )
            .optional()
            .ok()
            .flatten();

        if let Some(ref bid) = found {
            let _ = conn.execute("BEGIN IMMEDIATE", []);
            let _ = conn.execute(
                "DELETE FROM items_v2 WHERE id = ?1 AND owner_id = ?2",
                params![&norm_id, &sess.user_id],
            );
            let _ = conn.execute("DELETE FROM share_items_v2 WHERE blob_id = ?1", params![bid]);
            let _ = conn.execute("COMMIT", []);
        }
        found
    };

    let Some(bid) = blob_id else {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        );
    };

    state.zk_v2.delete_blob_files_best_effort(&sess.user_id, &bid);
    v2_json(StatusCode::OK, serde_json::json!({ "deletedId": norm_id }))
}

// ============================================================================
// 4. DEDUP ENDPOINT
// ============================================================================

async fn post_backup_check(
    State(state): State<AppState>,
    headers: HeaderMap,
    body_bytes: Bytes,
) -> Response {
    let sess = match require_auth(&state, &headers) {
        Ok(s) => s,
        Err(resp) => return resp,
    };

    let body: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap_or_default();
    let Some(raw_tags) = body.get("dedupTags").and_then(|v| v.as_array()) else {
        return v2_json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "INVALID_DEDUP_TAGS" }),
        );
    };
    if raw_tags.len() > 5000 {
        return v2_json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "INVALID_DEDUP_TAGS" }),
        );
    }

    let mut normalized_pairs: Vec<(String, String)> = Vec::with_capacity(raw_tags.len());
    let mut seen = std::collections::HashSet::new();
    for t in raw_tags {
        match validate_optional_dedup_tag(Some(t)) {
            Ok(Some(norm)) => {
                if seen.insert(norm.clone()) {
                    normalized_pairs.push((norm, t.as_str().unwrap_or("").to_string()));
                }
            }
            _ => {
                return v2_json(
                    StatusCode::BAD_REQUEST,
                    serde_json::json!({ "error": "INVALID_DEDUP_TAG_ELEMENT" }),
                );
            }
        }
    }

    let mut existing_tags: Vec<String> = Vec::new();
    let mut existing_items = serde_json::Map::new();

    if !normalized_pairs.is_empty() {
        let conn = state.zk_v2.db.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, blob_id FROM items_v2
                 WHERE owner_id = ?1 AND state = 'active' AND dedup_tag = ?2",
            )
            .unwrap();
        for (norm_tag, orig_tag) in normalized_pairs {
            let hit: Option<(String, String)> = stmt
                .query_row(params![&sess.user_id, &norm_tag], |r| {
                    Ok((r.get(0)?, r.get(1)?))
                })
                .optional()
                .ok()
                .flatten();
            if let Some((item_id, blob_id)) = hit {
                existing_tags.push(orig_tag.clone());
                existing_items.insert(
                    orig_tag,
                    serde_json::json!({
                        "itemId": item_id,
                        "blobId": blob_id,
                    }),
                );
            }
        }
    }

    v2_json(
        StatusCode::OK,
        serde_json::json!({
            "existingTags": existing_tags,
            "existingItems": existing_items,
        }),
    )
}

// ============================================================================
// 5. ALBUM CATALOG ENDPOINTS
// ============================================================================

async fn get_albums(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let sess = match require_auth(&state, &headers) {
        Ok(s) => s,
        Err(resp) => return resp,
    };

    let etag_opt: Option<String> = {
        let conn = state.zk_v2.db.lock().unwrap();
        conn.query_row(
            "SELECT etag FROM albums_v2 WHERE owner_id = ?1",
            params![&sess.user_id],
            |r| r.get(0),
        )
        .optional()
        .ok()
        .flatten()
    };

    let Some(etag) = etag_opt else {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "ALBUMS_NOT_INITIALIZED" }),
        );
    };

    let Ok(album_path) = state.zk_v2.resolve_albums_blob_path(&sess.user_id) else {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "ALBUMS_NOT_INITIALIZED" }),
        );
    };
    if !album_path.exists() {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "ALBUMS_NOT_INITIALIZED" }),
        );
    }

    let quoted_etag = format!("\"{etag}\"");
    if let Some(inm) = headers
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
    {
        if inm.trim() == quoted_etag {
            let mut resp = StatusCode::NOT_MODIFIED.into_response();
            let h = resp.headers_mut();
            h.insert(header::ETAG, HeaderValue::from_str(&quoted_etag).unwrap());
            h.insert(
                header::CACHE_CONTROL,
                HeaderValue::from_static("private, no-cache"),
            );
            apply_v2_api_headers(h);
            return resp;
        }
    }

    match fs::read(&album_path) {
        Ok(data) => {
            let mut resp = (StatusCode::OK, data).into_response();
            let h = resp.headers_mut();
            h.insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/octet-stream"),
            );
            h.insert(header::ETAG, HeaderValue::from_str(&quoted_etag).unwrap());
            h.insert(
                header::CACHE_CONTROL,
                HeaderValue::from_static("private, no-cache"),
            );
            apply_v2_api_headers(h);
            resp
        }
        Err(_) => v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "ALBUMS_NOT_INITIALIZED" }),
        ),
    }
}

async fn put_albums(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let sess = match require_auth(&state, &headers) {
        Ok(s) => s,
        Err(resp) => return resp,
    };

    if body.is_empty() || body.len() > MAX_ALBUM_BLOB_BYTES {
        return v2_json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "INVALID_ALBUMS_BLOB_SIZE" }),
        );
    }

    let current_etag: Option<String> = {
        let conn = state.zk_v2.db.lock().unwrap();
        conn.query_row(
            "SELECT etag FROM albums_v2 WHERE owner_id = ?1",
            params![&sess.user_id],
            |r| r.get(0),
        )
        .optional()
        .ok()
        .flatten()
    };

    let if_match = headers
        .get(header::IF_MATCH)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .trim();
    let if_none_match = headers
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .trim();

    match current_etag {
        None => {
            if !if_match.is_empty() && if_match != "*" {
                return v2_json(
                    StatusCode::PRECONDITION_FAILED,
                    serde_json::json!({ "error": "PRECONDITION_FAILED" }),
                );
            }
        }
        Some(ref cur) => {
            if if_none_match == "*" {
                return v2_json(
                    StatusCode::PRECONDITION_FAILED,
                    serde_json::json!({
                        "error": "PRECONDITION_FAILED",
                        "currentEtag": format!("\"{cur}\""),
                    }),
                );
            }
            let norm_if_match = if_match.trim_matches('"');
            if if_match.is_empty() || norm_if_match != cur.as_str() {
                return v2_json(
                    StatusCode::PRECONDITION_FAILED,
                    serde_json::json!({
                        "error": "PRECONDITION_FAILED",
                        "currentEtag": format!("\"{cur}\""),
                    }),
                );
            }
        }
    }

    let new_etag = hex::encode(Sha256::digest(&body));
    let Ok(album_path) = state.zk_v2.resolve_albums_blob_path(&sess.user_id) else {
        return v2_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            serde_json::json!({ "error": "ALBUMS_PATH_ERROR" }),
        );
    };
    if write_buffer_atomic(&state.zk_v2.temp_upload_dir, &album_path, &body).is_err() {
        return v2_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            serde_json::json!({ "error": "ALBUMS_WRITE_ERROR" }),
        );
    }

    let now = now_ms_i64();
    {
        let conn = state.zk_v2.db.lock().unwrap();
        let _ = conn.execute(
            "INSERT INTO albums_v2 (owner_id, etag, size, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(owner_id) DO UPDATE SET etag = excluded.etag, size = excluded.size, updated_at = excluded.updated_at",
            params![&sess.user_id, &new_etag, body.len() as i64, now],
        );
    }

    let quoted = format!("\"{new_etag}\"");
    let mut resp = v2_json(
        StatusCode::OK,
        serde_json::json!({
            "etag": quoted,
            "size": body.len(),
            "updatedAt": now,
        }),
    );
    if let Ok(val) = HeaderValue::from_str(&quoted) {
        resp.headers_mut().insert(header::ETAG, val);
    }
    resp
}

// ============================================================================
// 6. TRASH ENDPOINTS
// ============================================================================

fn extract_item_ids(body: &serde_json::Value) -> Option<Vec<String>> {
    let raw: Vec<&str> = if let Some(arr) = body.get("itemIds").and_then(|v| v.as_array()) {
        let mut out = Vec::with_capacity(arr.len());
        for item in arr {
            out.push(item.as_str()?);
        }
        out
    } else if let Some(single) = body.get("itemId").and_then(|v| v.as_str()) {
        vec![single]
    } else {
        return None;
    };

    if raw.is_empty() || raw.len() > 1000 || !raw.iter().all(|s| is_valid_uuid_v4(s)) {
        return None;
    }
    Some(raw.into_iter().map(|s| s.to_lowercase()).collect())
}

async fn post_trash(
    State(state): State<AppState>,
    headers: HeaderMap,
    body_bytes: Bytes,
) -> Response {
    let sess = match require_auth(&state, &headers) {
        Ok(s) => s,
        Err(resp) => return resp,
    };
    let body: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap_or_default();
    let Some(ids) = extract_item_ids(&body) else {
        return v2_json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "INVALID_ITEM_IDS" }),
        );
    };

    let now = now_ms_i64();
    {
        let conn = state.zk_v2.db.lock().unwrap();
        for id in &ids {
            let exists: Option<String> = conn
                .query_row(
                    "SELECT id FROM items_v2 WHERE id = ?1 AND owner_id = ?2",
                    params![id, &sess.user_id],
                    |r| r.get(0),
                )
                .optional()
                .ok()
                .flatten();
            if exists.is_none() {
                return v2_json(
                    StatusCode::NOT_FOUND,
                    serde_json::json!({ "error": "NOT_FOUND" }),
                );
            }
        }
        let _ = conn.execute("BEGIN IMMEDIATE", []);
        for id in &ids {
            let _ = conn.execute(
                "UPDATE items_v2 SET state = 'trashed', trashed_at = ?1, updated_at = ?2 WHERE id = ?3 AND owner_id = ?4",
                params![now, now, id, &sess.user_id],
            );
        }
        let _ = conn.execute("COMMIT", []);
    }

    v2_json(
        StatusCode::OK,
        serde_json::json!({
            "trashedIds": ids,
            "trashedAt": now,
        }),
    )
}

async fn post_trash_restore(
    State(state): State<AppState>,
    headers: HeaderMap,
    body_bytes: Bytes,
) -> Response {
    let sess = match require_auth(&state, &headers) {
        Ok(s) => s,
        Err(resp) => return resp,
    };
    let body: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap_or_default();
    let Some(ids) = extract_item_ids(&body) else {
        return v2_json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "INVALID_ITEM_IDS" }),
        );
    };

    let now = now_ms_i64();
    {
        let conn = state.zk_v2.db.lock().unwrap();
        for id in &ids {
            let exists: Option<String> = conn
                .query_row(
                    "SELECT id FROM items_v2 WHERE id = ?1 AND owner_id = ?2",
                    params![id, &sess.user_id],
                    |r| r.get(0),
                )
                .optional()
                .ok()
                .flatten();
            if exists.is_none() {
                return v2_json(
                    StatusCode::NOT_FOUND,
                    serde_json::json!({ "error": "NOT_FOUND" }),
                );
            }
        }
        let _ = conn.execute("BEGIN IMMEDIATE", []);
        for id in &ids {
            let _ = conn.execute(
                "UPDATE items_v2 SET state = 'active', trashed_at = NULL, updated_at = ?1 WHERE id = ?2 AND owner_id = ?3",
                params![now, id, &sess.user_id],
            );
        }
        let _ = conn.execute("COMMIT", []);
    }

    v2_json(
        StatusCode::OK,
        serde_json::json!({ "restoredIds": ids }),
    )
}

async fn delete_trash(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let sess = match require_auth(&state, &headers) {
        Ok(s) => s,
        Err(resp) => return resp,
    };

    let trashed_blobs: Vec<String> = {
        let conn = state.zk_v2.db.lock().unwrap();
        let mut blobs = Vec::new();
        if let Ok(mut stmt) = conn.prepare(
            "SELECT blob_id FROM items_v2 WHERE owner_id = ?1 AND state = 'trashed'",
        ) {
            if let Ok(rows) = stmt.query_map(params![&sess.user_id], |r| r.get::<_, String>(0)) {
                for r in rows.flatten() {
                    blobs.push(r);
                }
            }
        }
        let _ = conn.execute("BEGIN IMMEDIATE", []);
        let _ = conn.execute(
            "DELETE FROM items_v2 WHERE owner_id = ?1 AND state = 'trashed'",
            params![&sess.user_id],
        );
        for bid in &blobs {
            let _ = conn.execute("DELETE FROM share_items_v2 WHERE blob_id = ?1", params![bid]);
        }
        let _ = conn.execute("COMMIT", []);
        blobs
    };

    let count = trashed_blobs.len();
    for bid in trashed_blobs {
        state.zk_v2.delete_blob_files_best_effort(&sess.user_id, &bid);
    }

    v2_json(StatusCode::OK, serde_json::json!({ "deletedCount": count }))
}

// ============================================================================
// 7. STATS ENDPOINT
// ============================================================================

async fn get_stats(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let sess = match require_auth(&state, &headers) {
        Ok(s) => s,
        Err(resp) => return resp,
    };

    state.zk_v2.purge_expired_trash(now_ms_i64());
    let usage = {
        let conn = state.zk_v2.db.lock().unwrap();
        state.zk_v2.get_user_usage(&conn, &sess.user_id)
    };

    v2_json(
        StatusCode::OK,
        serde_json::json!({
            "activeBytes": usage.active_bytes,
            "trashedBytes": usage.trashed_bytes,
            "activeCount": usage.active_count,
            "trashedCount": usage.trashed_count,
            "quotaBytes": sess.quota_bytes,
        }),
    )
}

// ============================================================================
// 8. SHARE ENDPOINTS
// ============================================================================

async fn post_shares(
    State(state): State<AppState>,
    headers: HeaderMap,
    body_bytes: Bytes,
) -> Response {
    let sess = match require_auth(&state, &headers) {
        Ok(s) => s,
        Err(resp) => return resp,
    };

    let body: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap_or_default();

    let share_manifest: Option<String> = match body.get("shareManifest") {
        Some(v) if !v.is_null() => {
            let Some(m) = v.as_str().and_then(validate_share_manifest_string) else {
                return v2_json(
                    StatusCode::BAD_REQUEST,
                    serde_json::json!({ "error": "INVALID_SHARE_MANIFEST" }),
                );
            };
            Some(m)
        }
        _ => None,
    };

    let Some(items_input) = body.get("items").and_then(|v| v.as_array()) else {
        return v2_json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "INVALID_SHARE_ITEMS" }),
        );
    };
    if items_input.is_empty() || items_input.len() > 500 {
        return v2_json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "INVALID_SHARE_ITEMS" }),
        );
    }

    let mut validated_items: Vec<(String, String, Option<String>)> =
        Vec::with_capacity(items_input.len());

    {
        let conn = state.zk_v2.db.lock().unwrap();
        for entry in items_input {
            let Some(obj) = entry.as_object() else {
                return v2_json(
                    StatusCode::BAD_REQUEST,
                    serde_json::json!({ "error": "INVALID_SHARE_ITEM_ENTRY" }),
                );
            };
            let blob_id = obj.get("blobId").and_then(|v| v.as_str()).unwrap_or("");
            if !is_valid_uuid_v4(blob_id) {
                return v2_json(
                    StatusCode::NOT_FOUND,
                    serde_json::json!({ "error": "NOT_FOUND" }),
                );
            }
            let norm_blob = blob_id.to_lowercase();
            let owned: Option<String> = conn
                .query_row(
                    "SELECT id FROM items_v2 WHERE blob_id = ?1 AND owner_id = ?2 AND state = 'active'",
                    params![&norm_blob, &sess.user_id],
                    |r| r.get(0),
                )
                .optional()
                .ok()
                .flatten();
            if owned.is_none() {
                return v2_json(
                    StatusCode::NOT_FOUND,
                    serde_json::json!({ "error": "NOT_FOUND" }),
                );
            }

            let wrapped_fk = obj.get("wrappedFk").and_then(|v| v.as_str()).unwrap_or("");
            if decode_base64url_strict(wrapped_fk, 60).is_none() {
                return v2_json(
                    StatusCode::BAD_REQUEST,
                    serde_json::json!({ "error": "INVALID_WRAPPED_FK" }),
                );
            }

            let enc_item_meta = match obj.get("encItemMeta") {
                Some(v) if !v.is_null() => {
                    let Some(m) = v.as_str().and_then(validate_enc_meta_string) else {
                        return v2_json(
                            StatusCode::BAD_REQUEST,
                            serde_json::json!({ "error": "INVALID_ENC_ITEM_META" }),
                        );
                    };
                    Some(m)
                }
                _ => None,
            };

            validated_items.push((norm_blob, wrapped_fk.to_string(), enc_item_meta));
        }
    }

    let enc_share_meta: Option<String> = match body.get("encShareMeta") {
        Some(v) if !v.is_null() => {
            let Some(m) = v.as_str().and_then(validate_enc_meta_string) else {
                return v2_json(
                    StatusCode::BAD_REQUEST,
                    serde_json::json!({ "error": "INVALID_ENC_SHARE_META" }),
                );
            };
            Some(m)
        }
        _ => None,
    };

    let password_wrap: Option<String> = match body.get("passwordWrap") {
        Some(v) if !v.is_null() => {
            let s = v.as_str().unwrap_or("");
            if s.len() < 16 || s.len() > 8192 || !is_valid_base64url(s) {
                return v2_json(
                    StatusCode::BAD_REQUEST,
                    serde_json::json!({ "error": "INVALID_PASSWORD_WRAP" }),
                );
            }
            Some(s.to_string())
        }
        _ => None,
    };

    let now = now_ms_i64();
    let expires_at: Option<i64> = match body.get("expiresAt") {
        Some(v) if !v.is_null() => {
            let Some(exp) = v.as_i64() else {
                return v2_json(
                    StatusCode::BAD_REQUEST,
                    serde_json::json!({ "error": "INVALID_EXPIRES_AT" }),
                );
            };
            if exp <= now {
                return v2_json(
                    StatusCode::BAD_REQUEST,
                    serde_json::json!({ "error": "INVALID_EXPIRES_AT" }),
                );
            }
            Some(exp)
        }
        _ => None,
    };

    let max_downloads: Option<i64> = match body.get("maxDownloads") {
        Some(v) if !v.is_null() => {
            let Some(max_d) = v.as_i64() else {
                return v2_json(
                    StatusCode::BAD_REQUEST,
                    serde_json::json!({ "error": "INVALID_MAX_DOWNLOADS" }),
                );
            };
            if !(1..=100_000).contains(&max_d) {
                return v2_json(
                    StatusCode::BAD_REQUEST,
                    serde_json::json!({ "error": "INVALID_MAX_DOWNLOADS" }),
                );
            }
            Some(max_d)
        }
        _ => None,
    };

    let share_id: String = match body.get("shareId") {
        Some(v) if !v.is_null() => {
            let s = v.as_str().unwrap_or("");
            if !is_valid_uuid_v4(s) && !is_valid_share_id(s) {
                return v2_json(
                    StatusCode::BAD_REQUEST,
                    serde_json::json!({ "error": "INVALID_SHARE_ID" }),
                );
            }
            s.to_lowercase()
        }
        _ => random_uuid_v4(),
    };

    {
        let conn = state.zk_v2.db.lock().unwrap();
        let _ = conn.execute("BEGIN IMMEDIATE", []);
        let s_res = conn.execute(
            "INSERT INTO shares_v2 (
               share_id, owner_id, enc_share_meta, share_manifest, password_wrap, expires_at, max_downloads, download_count, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8)",
            params![
                &share_id,
                &sess.user_id,
                &enc_share_meta,
                &share_manifest,
                &password_wrap,
                &expires_at,
                &max_downloads,
                now
            ],
        );
        let mut items_ok = s_res.is_ok();
        if items_ok {
            for (bid, wfk, eim) in &validated_items {
                if conn
                    .execute(
                        "INSERT INTO share_items_v2 (share_id, blob_id, wrapped_fk, enc_item_meta)
                         VALUES (?1, ?2, ?3, ?4)",
                        params![&share_id, bid, wfk, eim],
                    )
                    .is_err()
                {
                    items_ok = false;
                    break;
                }
            }
        }
        if items_ok {
            let _ = conn.execute("COMMIT", []);
        } else {
            let _ = conn.execute("ROLLBACK", []);
            return v2_json(
                StatusCode::CONFLICT,
                serde_json::json!({ "error": "SHARE_CONFLICT" }),
            );
        }
    }

    v2_json(
        StatusCode::CREATED,
        serde_json::json!({
            "shareId": share_id,
            "expiresAt": expires_at,
            "maxDownloads": max_downloads,
            "createdAt": now,
        }),
    )
}

async fn get_owner_shares(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let sess = match require_auth(&state, &headers) {
        Ok(s) => s,
        Err(resp) => return resp,
    };

    let mut shares_json = Vec::new();
    {
        let conn = state.zk_v2.db.lock().unwrap();
        if let Ok(mut stmt) = conn.prepare(
            "SELECT s.share_id,
                    s.enc_share_meta,
                    CASE WHEN s.password_wrap IS NOT NULL THEN 1 ELSE 0 END AS has_password,
                    s.expires_at,
                    s.max_downloads,
                    s.download_count,
                    s.created_at,
                    (SELECT COUNT(*) FROM share_items_v2 si WHERE si.share_id = s.share_id) AS item_count
             FROM shares_v2 s
             WHERE s.owner_id = ?1
             ORDER BY s.created_at DESC",
        ) {
            if let Ok(rows) = stmt.query_map(params![&sess.user_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, Option<i64>>(3)?,
                    r.get::<_, Option<i64>>(4)?,
                    r.get::<_, i64>(5)?,
                    r.get::<_, i64>(6)?,
                    r.get::<_, i64>(7)?,
                ))
            }) {
                for r in rows.flatten() {
                    shares_json.push(serde_json::json!({
                        "shareId": r.0,
                        "encShareMeta": r.1,
                        "hasPassword": r.2 == 1,
                        "expiresAt": r.3,
                        "maxDownloads": r.4,
                        "downloadCount": r.5,
                        "createdAt": r.6,
                        "itemCount": r.7,
                    }));
                }
            }
        }
    }

    v2_json(
        StatusCode::OK,
        serde_json::json!({ "shares": shares_json }),
    )
}

async fn delete_share(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(share_id): Path<String>,
) -> Response {
    let sess = match require_auth(&state, &headers) {
        Ok(s) => s,
        Err(resp) => return resp,
    };
    if !is_valid_share_id(&share_id) {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        );
    }

    let deleted = {
        let conn = state.zk_v2.db.lock().unwrap();
        conn.execute(
            "DELETE FROM shares_v2 WHERE share_id = ?1 AND owner_id = ?2",
            params![&share_id, &sess.user_id],
        )
        .unwrap_or(0)
    };

    if deleted == 0 {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        );
    }

    v2_json(
        StatusCode::OK,
        serde_json::json!({ "revokedShareId": share_id }),
    )
}

async fn get_share(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(share_id): Path<String>,
) -> Response {
    if !is_valid_share_id(&share_id) {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        );
    }
    if let Err(resp) = enforce_public_share_rate_limits(&state, &headers, &share_id) {
        return resp;
    }

    let now = now_ms_i64();
    let conn = state.zk_v2.db.lock().unwrap();
    type ShareRow = (
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<i64>,
        Option<i64>,
        i64,
        i64,
    );
    let share_row: Option<ShareRow> = conn
        .query_row(
            "SELECT share_id, owner_id, enc_share_meta, share_manifest, password_wrap,
                    expires_at, max_downloads, download_count, created_at
             FROM shares_v2 WHERE share_id = ?1",
            params![&share_id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                    r.get(8)?,
                ))
            },
        )
        .optional()
        .ok()
        .flatten();

    let Some((
        sid,
        owner_id,
        enc_share_meta,
        share_manifest,
        password_wrap,
        expires_at,
        max_downloads,
        download_count,
        created_at,
    )) = share_row
    else {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        );
    };

    if let Some(exp) = expires_at {
        if now >= exp {
            return v2_json(
                StatusCode::NOT_FOUND,
                serde_json::json!({ "error": "NOT_FOUND" }),
            );
        }
    }
    if let Some(max_d) = max_downloads {
        if download_count >= max_d {
            return v2_json(
                StatusCode::NOT_FOUND,
                serde_json::json!({ "error": "NOT_FOUND" }),
            );
        }
    }

    let mut items_json = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT si.blob_id, si.wrapped_fk, si.enc_item_meta, i.size, i.sha256_hex
         FROM share_items_v2 si
         JOIN items_v2 i ON i.blob_id = si.blob_id AND i.owner_id = ?1 AND i.state = 'active'
         WHERE si.share_id = ?2",
    ) {
        if let Ok(rows) = stmt.query_map(params![&owner_id, &share_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, String>(4)?,
            ))
        }) {
            for r in rows.flatten() {
                items_json.push(serde_json::json!({
                    "blobId": r.0,
                    "wrappedFk": r.1,
                    "encItemMeta": r.2,
                    "size": r.3,
                    "sha256": r.4,
                }));
            }
        }
    }

    if items_json.is_empty() {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        );
    }

    let _ = enc_share_meta;
    v2_json(
        StatusCode::OK,
        serde_json::json!({
            "shareId": sid,
            "shareManifest": share_manifest,
            "passwordWrap": password_wrap,
            "expiresAt": expires_at,
            "maxDownloads": max_downloads,
            "downloadsCount": download_count,
            "createdAt": created_at,
            "items": items_json,
        }),
    )
}

async fn get_share_blob(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((share_id, blob_id)): Path<(String, String)>,
) -> Response {
    if !is_valid_share_id(&share_id) || !is_valid_uuid_v4(&blob_id) {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        );
    }
    let norm_blob = blob_id.to_lowercase();
    if let Err(resp) = enforce_public_share_rate_limits(&state, &headers, &share_id) {
        return resp;
    }

    let now = now_ms_i64();
    let lookup: Option<(String, i64, String)> = {
        let conn = state.zk_v2.db.lock().unwrap();
        let share_row: Option<(String, Option<i64>, Option<i64>, i64)> = conn
            .query_row(
                "SELECT owner_id, expires_at, max_downloads, download_count
                 FROM shares_v2 WHERE share_id = ?1",
                params![&share_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()
            .ok()
            .flatten();

        let Some((owner_id, expires_at, max_downloads, download_count)) = share_row else {
            return v2_json(
                StatusCode::NOT_FOUND,
                serde_json::json!({ "error": "NOT_FOUND" }),
            );
        };
        if let Some(exp) = expires_at {
            if now >= exp {
                return v2_json(
                    StatusCode::NOT_FOUND,
                    serde_json::json!({ "error": "NOT_FOUND" }),
                );
            }
        }
        if let Some(max_d) = max_downloads {
            if download_count >= max_d {
                return v2_json(
                    StatusCode::NOT_FOUND,
                    serde_json::json!({ "error": "NOT_FOUND" }),
                );
            }
        }

        let item_row: Option<(i64, String)> = conn
            .query_row(
                "SELECT i.size, i.sha256_hex
                 FROM share_items_v2 si
                 JOIN items_v2 i ON i.blob_id = si.blob_id AND i.owner_id = ?1 AND i.state = 'active'
                 WHERE si.share_id = ?2 AND si.blob_id = ?3",
                params![&owner_id, &share_id, &norm_blob],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .ok()
            .flatten();

        if let Some((size, sha)) = item_row {
            let range_hdr = headers.get(header::RANGE).and_then(|v| v.to_str().ok());
            if range_hdr.is_none()
                || range_hdr
                    .map(|s| s.trim().starts_with("bytes=0-"))
                    .unwrap_or(false)
            {
                let _ = conn.execute(
                    "UPDATE shares_v2 SET download_count = download_count + 1 WHERE share_id = ?1",
                    params![&share_id],
                );
            }
            Some((owner_id, size, sha))
        } else {
            None
        }
    };

    let Some((owner_id, size, sha256_hex)) = lookup else {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        );
    };

    let Ok(blob_path) = state.zk_v2.resolve_blob_path(&owner_id, &norm_blob, "") else {
        return v2_json(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "NOT_FOUND" }),
        );
    };

    serve_ciphertext_blob_with_range(&headers, &blob_path, size.max(0) as u64, &sha256_hex)
}
