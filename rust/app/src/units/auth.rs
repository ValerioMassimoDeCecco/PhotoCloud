use axum::extract::multipart::Multipart;
use axum::extract::{FromRequest, Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use rand::Rng;
use serde::Deserialize;

use crate::crypto;
use crate::state::{AppState, SessionData};
use crate::template_renderer;
use super::common::{html_response, json_response};

#[derive(Debug, Deserialize)]
pub struct LoginPayload {
    pub username: Option<String>,
    pub api_key: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RegisterPayload {
    pub username: Option<String>,
    pub key_type: Option<String>,
    pub custom_key: Option<String>,
}

pub fn generate_uuid() -> String {
    let mut rng = rand::thread_rng();
    format!(
        "{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        rng.r#gen::<u32>(),
        rng.r#gen::<u16>(),
        rng.r#gen::<u16>() & 0x0fff,
        (rng.r#gen::<u16>() & 0x3fff) | 0x8000,
        rng.r#gen::<u64>() & 0x0000ffffffffffff,
    )
}

fn login_error(wants_json: bool, status: StatusCode, message: &str) -> Response {
    if wants_json {
        let body = serde_json::json!({ "error": message }).to_string();
        json_response(status, body)
    } else {
        html_response(status, template_renderer::render_login_template(Some(message)))
    }
}

pub async fn post_login(
    State(state): State<AppState>,
    headers: HeaderMap,
    req: Request,
) -> Response {
    let accept_header = headers
        .get(header::ACCEPT)
        .and_then(|h| h.to_str().ok())
        .unwrap_or_default();
    let wants_json = accept_header.contains("application/json");

    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_string();

    let mut username = String::new();
    let mut api_key = String::new();

    if content_type.starts_with("multipart/form-data") {
        let mut multipart = match Multipart::from_request(req, &state).await {
            Ok(m) => m,
            Err(_) => {
                return login_error(
                    wants_json,
                    StatusCode::BAD_REQUEST,
                    "File di autenticazione non valido.",
                );
            }
        };

        loop {
            let field = match multipart.next_field().await {
                Ok(Some(field)) => field,
                Ok(None) => break,
                Err(_) => {
                    return login_error(
                        wants_json,
                        StatusCode::BAD_REQUEST,
                        "File di autenticazione non valido.",
                    );
                }
            };
            let name = field.name().unwrap_or_default().to_string();
            let is_file = field.file_name().is_some();
            let value = match field.text().await {
                Ok(v) => v,
                Err(_) => {
                    return login_error(
                        wants_json,
                        StatusCode::BAD_REQUEST,
                        "File di autenticazione non valido.",
                    );
                }
            };

            if name == "auth_file" || is_file {
                match serde_json::from_str::<LoginPayload>(&value) {
                    Ok(auth_data) => {
                        if let Some(u) = auth_data.username {
                            username = u.trim().to_string();
                        }
                        if let Some(k) = auth_data.api_key {
                            api_key = k;
                        }
                    }
                    Err(_) => {
                        return login_error(
                            wants_json,
                            StatusCode::BAD_REQUEST,
                            "File di autenticazione non valido.",
                        );
                    }
                }
            } else {
                match name.as_str() {
                    "username" => username = value.trim().to_string(),
                    "api_key" => api_key = value,
                    _ => {}
                }
            }
        }
    } else {
        let bytes = match axum::body::to_bytes(req.into_body(), 10 * 1024 * 1024).await {
            Ok(b) => b,
            Err(_) => {
                return json_response(StatusCode::BAD_REQUEST, r#"{"error":"Richiesta non valida"}"#);
            }
        };

        if let Ok(json_data) = serde_json::from_slice::<LoginPayload>(&bytes) {
            if let Some(u) = json_data.username {
                username = u.trim().to_string();
            }
            if let Some(k) = json_data.api_key {
                api_key = k;
            }
        } else if let Ok(form_data) = serde_urlencoded::from_bytes::<LoginPayload>(&bytes) {
            if let Some(u) = form_data.username {
                username = u.trim().to_string();
            }
            if let Some(k) = form_data.api_key {
                api_key = k;
            }
        }
    }

    if username.is_empty() || api_key.is_empty() {
        return login_error(
            wants_json,
            StatusCode::BAD_REQUEST,
            "File di autenticazione non trovato.",
        );
    }

    let stored_hash = state.find_user(&username);
    let dummy_hash = crypto::hash_key("PhotoCloud_Constant_Time_Dummy_Key_2026!@#");
    let is_valid = if let Some(hash) = stored_hash {
        crypto::verify_key(&api_key, &hash)
    } else {
        let _ = crypto::verify_key(&api_key, &dummy_hash);
        false
    };

    if !is_valid {
        if wants_json {
            return json_response(
                StatusCode::UNAUTHORIZED,
                r#"{"error":"Credenziali non valide."}"#,
            );
        } else {
            return html_response(
                StatusCode::UNAUTHORIZED,
                template_renderer::render_login_template(Some("Credenziali non valide.")),
            );
        }
    }

    let sid = generate_uuid();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let expires_at = now + 86_400_000;

    {
        let mut sessions = state.sessions.write().unwrap();
        sessions.insert(
            sid.clone(),
            SessionData {
                username: username.clone(),
                api_key: api_key.clone(),
                expires_at,
            },
        );
    }

    let cookie_val = format!("photocloud_sid={sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400");
    if wants_json {
        let body = format!(r#"{{"success":true,"username":"{username}"}}"#);
        let mut resp = json_response(StatusCode::OK, body);
        resp.headers_mut()
            .insert(header::SET_COOKIE, cookie_val.parse().unwrap());
        resp
    } else {
        let mut resp = StatusCode::FOUND.into_response();
        resp.headers_mut()
            .insert(header::LOCATION, "/".parse().unwrap());
        resp.headers_mut()
            .insert(header::SET_COOKIE, cookie_val.parse().unwrap());
        resp
    }
}

pub async fn post_logout(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    if let Some(sid) = crate::state::extract_session_id(&headers) {
        let mut sessions = state.sessions.write().unwrap();
        sessions.remove(&sid);
    }

    let accept_header = headers
        .get(header::ACCEPT)
        .and_then(|h| h.to_str().ok())
        .unwrap_or_default();
    let wants_json = accept_header.contains("application/json");

    let clear_cookie = "photocloud_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
    if wants_json {
        let mut resp = json_response(StatusCode::OK, r#"{"success":true}"#);
        resp.headers_mut()
            .insert(header::SET_COOKIE, clear_cookie.parse().unwrap());
        resp
    } else {
        let mut resp = StatusCode::FOUND.into_response();
        resp.headers_mut()
            .insert(header::LOCATION, "/".parse().unwrap());
        resp.headers_mut()
            .insert(header::SET_COOKIE, clear_cookie.parse().unwrap());
        resp
    }
}

pub async fn post_register(
    State(state): State<AppState>,
    req: Request,
) -> Response {
    let content_type = req
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_string();

    let mut username = String::new();
    let mut custom_key = None;
    let mut key_type = "generate".to_string();

    if content_type.starts_with("multipart/form-data") {
        let mut multipart = match Multipart::from_request(req, &state).await {
            Ok(m) => m,
            Err(_) => {
                return (StatusCode::BAD_REQUEST, "Richiesta non valida").into_response();
            }
        };

        loop {
            let field = match multipart.next_field().await {
                Ok(Some(field)) => field,
                Ok(None) => break,
                Err(_) => {
                    return (StatusCode::BAD_REQUEST, "Richiesta non valida").into_response();
                }
            };
            let name = field.name().unwrap_or_default().to_string();
            let value = match field.text().await {
                Ok(v) => v,
                Err(_) => {
                    return (StatusCode::BAD_REQUEST, "Richiesta non valida").into_response();
                }
            };
            match name.as_str() {
                "username" => username = value.trim().to_string(),
                "key_type" => key_type = value,
                "custom_key" => custom_key = Some(value),
                _ => {}
            }
        }
    } else {
        let bytes = match axum::body::to_bytes(req.into_body(), 10 * 1024 * 1024).await {
            Ok(b) => b,
            Err(_) => {
                return (StatusCode::BAD_REQUEST, "Richiesta non valida").into_response();
            }
        };

        if let Ok(json_data) = serde_json::from_slice::<RegisterPayload>(&bytes) {
            if let Some(u) = json_data.username {
                username = u.trim().to_string();
            }
            if let Some(kt) = json_data.key_type {
                key_type = kt;
            }
            custom_key = json_data.custom_key;
        } else if let Ok(form_data) = serde_urlencoded::from_bytes::<RegisterPayload>(&bytes) {
            if let Some(u) = form_data.username {
                username = u.trim().to_string();
            }
            if let Some(kt) = form_data.key_type {
                key_type = kt;
            }
            custom_key = form_data.custom_key;
        }
    }

    if key_type.is_empty() {
        key_type = "generate".to_string();
    }

    if username.is_empty()
        || username.len() > 64
        || !username.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return (StatusCode::BAD_REQUEST, "Username non valido!").into_response();
    }

    if state.find_user(&username).is_some() {
        return (StatusCode::CONFLICT, "Username già esistente!").into_response();
    }

    let api_key = if key_type == "custom" {
        let k = custom_key.unwrap_or_default();
        if k.len() < 8 {
            return (
                StatusCode::BAD_REQUEST,
                "La chiave personalizzata deve avere almeno 8 caratteri.",
            )
                .into_response();
        }
        k
    } else {
        crypto::generate_api_key(32)
    };

    let key_hash = crypto::hash_key(&api_key);
    if let Err(e) = state.save_user(&username, &key_hash) {
        return (StatusCode::INTERNAL_SERVER_ERROR, format!("Errore salvataggio: {e}")).into_response();
    }

    let user_folder = state.upload_dir.join(&username);
    let trash_folder = user_folder.join("trash");
    let _ = std::fs::create_dir_all(&user_folder);
    let _ = std::fs::create_dir_all(&trash_folder);

    let auth_data = serde_json::json!({
        "username": username,
        "api_key": api_key,
        "session_id": generate_uuid(),
        "created_at": std::time::SystemTime::now()
            .duration_since(std::time::SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64(),
        "hash_of_key": key_hash,
    });

    let safe_name: String = username
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
        .collect();
    let download_name = format!("photocloud_auth_{safe_name}.json");

    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/json; charset=utf-8"),
            (
                header::CONTENT_DISPOSITION,
                &format!(r#"attachment; filename="{download_name}""#),
            ),
        ],
        serde_json::to_string_pretty(&auth_data).unwrap(),
    )
        .into_response()
}
