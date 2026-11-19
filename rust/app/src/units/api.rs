use axum::extract::{Query, Request, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use serde::Deserialize;
use std::collections::HashMap;

use crate::nl_search;
use crate::phash;
use crate::state::AppState;
use crate::vault_manager::{self, is_valid_album_name, is_valid_vault_filename};
use super::common::{access_denied, json_response};

#[derive(Debug, Deserialize, Default)]
pub struct CreateAlbumPayload {
    pub name: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct AssignAlbumPayload {
    pub filenames: Option<Vec<String>>,
    pub album: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct DeleteAlbumPayload {
    pub name: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct ToggleFavoritePayload {
    pub filename: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct SetManyFavoritesPayload {
    pub filenames: Option<Vec<String>>,
    pub favorite: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    pub q: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct SimilarDuplicatesPayload {
    pub threshold: Option<f64>,
}

// GET /api/albums
pub async fn get_albums(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => return access_denied(),
    };
    let data = vault_manager::load_user_albums(&state.upload_dir, &sess.username);
    json_response(StatusCode::OK, serde_json::to_string(&data).unwrap())
}

// POST /api/albums/create
pub async fn post_albums_create(
    State(state): State<AppState>,
    headers: HeaderMap,
    req: Request,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => return access_denied(),
    };

    let bytes = match axum::body::to_bytes(req.into_body(), 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => return json_response(StatusCode::BAD_REQUEST, r#"{"error":"Payload non valido"}"#),
    };

    let payload: CreateAlbumPayload = serde_json::from_slice(&bytes).unwrap_or_default();
    let raw_name = payload.name.unwrap_or_default().trim().to_string();
    if !is_valid_album_name(&raw_name) {
        return json_response(StatusCode::BAD_REQUEST, r#"{"error":"Nome album non valido"}"#);
    }

    let mut data = vault_manager::load_user_albums(&state.upload_dir, &sess.username);
    if !data.albums.contains(&raw_name) {
        data.albums.push(raw_name);
        data.albums.sort();
        let _ = vault_manager::save_user_albums(&state.upload_dir, &sess.username, &data);
    }

    let resp = serde_json::json!({
        "success": true,
        "albums": data.albums,
        "fileAlbums": data.file_albums,
    });
    json_response(StatusCode::OK, resp.to_string())
}

// POST /api/albums/assign
pub async fn post_albums_assign(
    State(state): State<AppState>,
    headers: HeaderMap,
    req: Request,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => return access_denied(),
    };

    let bytes = match axum::body::to_bytes(req.into_body(), 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => return json_response(StatusCode::BAD_REQUEST, r#"{"error":"Payload non valido"}"#),
    };

    let payload: AssignAlbumPayload = serde_json::from_slice(&bytes).unwrap_or_default();
    let album_name = payload.album.unwrap_or_default().trim().to_string();
    if !album_name.is_empty() && !is_valid_album_name(&album_name) {
        return json_response(StatusCode::BAD_REQUEST, r#"{"error":"Nome album non valido"}"#);
    }

    let mut data = vault_manager::load_user_albums(&state.upload_dir, &sess.username);
    if !album_name.is_empty() && !data.albums.contains(&album_name) {
        data.albums.push(album_name.clone());
        data.albums.sort();
    }

    if let Some(filenames) = payload.filenames {
        for fn_name in filenames {
            if !is_valid_vault_filename(&fn_name) {
                continue;
            }
            if !album_name.is_empty() {
                data.file_albums.insert(fn_name, album_name.clone());
            } else {
                data.file_albums.remove(&fn_name);
            }
        }
    }

    let _ = vault_manager::save_user_albums(&state.upload_dir, &sess.username, &data);
    let resp = serde_json::json!({
        "success": true,
        "albums": data.albums,
        "fileAlbums": data.file_albums,
    });
    json_response(StatusCode::OK, resp.to_string())
}

// POST /api/albums/delete
pub async fn post_albums_delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    req: Request,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => return access_denied(),
    };

    let bytes = match axum::body::to_bytes(req.into_body(), 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => return json_response(StatusCode::BAD_REQUEST, r#"{"error":"Payload non valido"}"#),
    };

    let payload: DeleteAlbumPayload = serde_json::from_slice(&bytes).unwrap_or_default();
    let album_name = payload.name.unwrap_or_default().trim().to_string();
    if !is_valid_album_name(&album_name) {
        return json_response(StatusCode::BAD_REQUEST, r#"{"error":"Nome album non valido"}"#);
    }

    let mut data = vault_manager::load_user_albums(&state.upload_dir, &sess.username);
    data.albums.retain(|a| a != &album_name);
    data.file_albums.retain(|_, a| a != &album_name);
    let _ = vault_manager::save_user_albums(&state.upload_dir, &sess.username, &data);

    let resp = serde_json::json!({
        "success": true,
        "albums": data.albums,
        "fileAlbums": data.file_albums,
    });
    json_response(StatusCode::OK, resp.to_string())
}

// GET /api/favorites
pub async fn get_favorites(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => return access_denied(),
    };

    let favorites = vault_manager::load_user_favorites(&state.upload_dir, &sess.username);
    let resp = serde_json::json!({ "favorites": favorites });
    json_response(StatusCode::OK, resp.to_string())
}

// POST /api/favorites/toggle
pub async fn post_favorites_toggle(
    State(state): State<AppState>,
    headers: HeaderMap,
    req: Request,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => return access_denied(),
    };

    let bytes = match axum::body::to_bytes(req.into_body(), 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => return json_response(StatusCode::BAD_REQUEST, r#"{"error":"Payload non valido"}"#),
    };

    let payload: ToggleFavoritePayload = serde_json::from_slice(&bytes).unwrap_or_default();
    let filename = payload.filename.unwrap_or_default();
    if !is_valid_vault_filename(&filename) {
        return json_response(StatusCode::BAD_REQUEST, r#"{"error":"Nome file non valido"}"#);
    }

    let mut favorites = vault_manager::load_user_favorites(&state.upload_dir, &sess.username);
    let is_favorite = if let Some(pos) = favorites.iter().position(|f| f == &filename) {
        favorites.remove(pos);
        false
    } else {
        favorites.push(filename.clone());
        true
    };

    let _ = vault_manager::save_user_favorites(&state.upload_dir, &sess.username, &favorites);
    let resp = serde_json::json!({
        "success": true,
        "isFavorite": is_favorite,
        "favorites": favorites,
    });
    json_response(StatusCode::OK, resp.to_string())
}

// POST /api/favorites/set-many
pub async fn post_favorites_set_many(
    State(state): State<AppState>,
    headers: HeaderMap,
    req: Request,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => return access_denied(),
    };

    let bytes = match axum::body::to_bytes(req.into_body(), 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => return json_response(StatusCode::BAD_REQUEST, r#"{"error":"Payload non valido"}"#),
    };

    let payload: SetManyFavoritesPayload = serde_json::from_slice(&bytes).unwrap_or_default();
    let make_fav = payload.favorite.unwrap_or(false);
    let mut favorites = vault_manager::load_user_favorites(&state.upload_dir, &sess.username);

    if let Some(filenames) = payload.filenames {
        for fn_name in filenames {
            if !is_valid_vault_filename(&fn_name) {
                continue;
            }
            if make_fav {
                if !favorites.contains(&fn_name) {
                    favorites.push(fn_name);
                }
            } else {
                favorites.retain(|f| f != &fn_name);
            }
        }
    }

    let _ = vault_manager::save_user_favorites(&state.upload_dir, &sess.username, &favorites);
    let resp = serde_json::json!({
        "success": true,
        "favorites": favorites,
    });
    json_response(StatusCode::OK, resp.to_string())
}

// GET /api/memories
pub async fn get_memories(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => return access_denied(),
    };

    let user_folder = state.upload_dir.join(&sess.username);
    let all_files = vault_manager::list_media_files(
        &user_folder,
        &state.upload_dir,
        Some(&sess.username),
    );

    let now = chrono::Local::now();
    let current_year = chrono::Datelike::year(&now);
    let current_month = chrono::Datelike::month(&now);
    let current_day = chrono::Datelike::day(&now);

    let mut on_this_day = Vec::new();
    let mut by_year: HashMap<i32, Vec<crate::types::MediaItem>> = HashMap::new();

    for item in all_files {
        if !item.is_media.unwrap_or(false) {
            continue;
        }
        if let Some(dt) = chrono::DateTime::from_timestamp(item.timestamp, 0) {
            let local_dt: chrono::DateTime<chrono::Local> = dt.into();
            if chrono::Datelike::month(&local_dt) == current_month
                && chrono::Datelike::day(&local_dt) == current_day
                && chrono::Datelike::year(&local_dt) < current_year
            {
                let yr = chrono::Datelike::year(&local_dt);
                by_year.entry(yr).or_default().push(item.clone());
                on_this_day.push(item);
            }
        }
    }

    let mut sections = Vec::new();
    let mut sorted_years: Vec<i32> = by_year.keys().cloned().collect();
    sorted_years.sort_by(|a, b| b.cmp(a));

    for yr in sorted_years {
        if let Some(items) = by_year.remove(&yr) {
            sections.push(serde_json::json!({
                "year": yr,
                "yearsAgo": current_year - yr,
                "items": items,
            }));
        }
    }

    let resp = serde_json::json!({
        "date": format!("{current_year:04}-{current_month:02}-{current_day:02}"),
        "count": on_this_day.len(),
        "sections": sections,
    });
    json_response(StatusCode::OK, resp.to_string())
}

// GET /api/search
pub async fn get_search(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<SearchQuery>,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => return access_denied(),
    };

    let raw_query = query.q.unwrap_or_default();
    if raw_query.trim().is_empty() {
        let resp = serde_json::json!({
            "query": raw_query,
            "explanation": [],
            "results": [],
        });
        return json_response(StatusCode::OK, resp.to_string());
    }

    let user_folder = state.upload_dir.join(&sess.username);
    let all_files = vault_manager::list_media_files(
        &user_folder,
        &state.upload_dir,
        Some(&sess.username),
    );
    let favorites = vault_manager::load_user_favorites(&state.upload_dir, &sess.username);

    let parsed = nl_search::parse_natural_query(&raw_query);
    let results: Vec<crate::types::MediaItem> = all_files
        .into_iter()
        .filter(|item| {
            let is_fav = favorites.contains(&item.filename);
            nl_search::media_item_matches_query(
                &item.filename,
                item.timestamp,
                item.album.as_deref(),
                is_fav,
                &parsed,
            )
        })
        .collect();

    let resp = serde_json::json!({
        "query": raw_query,
        "explanation": parsed.explanation,
        "count": results.len(),
        "results": results,
    });
    json_response(StatusCode::OK, resp.to_string())
}

// POST /api/similar_duplicates
pub async fn post_similar_duplicates(
    State(state): State<AppState>,
    headers: HeaderMap,
    req: Request,
) -> Response {
    let sess = match state.get_session(&headers) {
        Some(s) => s,
        None => return access_denied(),
    };

    let bytes = match axum::body::to_bytes(req.into_body(), 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => return json_response(StatusCode::BAD_REQUEST, r#"{"error":"Payload non valido"}"#),
    };

    let payload: SimilarDuplicatesPayload = serde_json::from_slice(&bytes).unwrap_or_default();
    let max_distance = payload
        .threshold
        .map(|t| (t.max(0.0) as u32).min(20))
        .unwrap_or(8);

    let user_folder = state.upload_dir.join(&sess.username);
    let media_files = vault_manager::list_media_files(
        &user_folder,
        &state.upload_dir,
        Some(&sess.username),
    );

    let mut entries = Vec::new();
    let mut scanned = 0;

    for m in media_files {
        if !m.is_media.unwrap_or(false) {
            continue;
        }
        let full = user_folder.join(&m.filename);
        if let Ok(enc) = std::fs::read(&full) {
            if let Ok(dec) = crate::crypto::decrypt_file(&enc, &sess.api_key) {
                if let Ok(hash_hex) = phash::compute_phash_hex(&dec) {
                    entries.push((m.filename, hash_hex));
                    scanned += 1;
                }
            }
        }
    }

    let groups = phash::group_similar_by_hash(&entries, max_distance);
    let hash_map: HashMap<String, String> = entries.iter().cloned().collect();
    let formatted_groups: Vec<serde_json::Value> = groups
        .into_iter()
        .map(|filenames| {
            let base_hash = filenames
                .first()
                .and_then(|f| hash_map.get(f))
                .cloned()
                .unwrap_or_default();
            let distances: Vec<u32> = filenames
                .iter()
                .map(|f| {
                    if let Some(h) = hash_map.get(f) {
                        phash::hamming_distance_hex(&base_hash, h).unwrap_or(0)
                    } else {
                        0
                    }
                })
                .collect();
            serde_json::json!({
                "filenames": filenames,
                "distances": distances,
            })
        })
        .collect();

    let resp = serde_json::json!({
        "groups": formatted_groups,
        "scanned": scanned,
        "cached": 0,
        "total": entries.len(),
        "threshold": max_distance,
    });
    json_response(StatusCode::OK, resp.to_string())
}

// GET /api/shares
pub async fn get_shares(
    State(_state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    if crate::state::extract_session_id(&headers).is_none() {
        return access_denied();
    }
    json_response(StatusCode::OK, r#"{"shares":[]}"#)
}
