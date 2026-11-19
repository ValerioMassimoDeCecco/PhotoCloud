use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;

use crate::state::AppState;
use crate::vault_manager;
use super::common::json_response;

pub async fn get_session(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    if let Some(sess) = state.get_session(&headers) {
        let user_folder = state.upload_dir.join(&sess.username);
        let trash_folder = user_folder.join("trash");

        let active_files = vault_manager::list_media_files(
            &user_folder,
            &state.upload_dir,
            Some(&sess.username),
        );
        let trashed_files = vault_manager::list_media_files(
            &trash_folder,
            &state.upload_dir,
            Some(&sess.username),
        );
        let albums_data = vault_manager::load_user_albums(&state.upload_dir, &sess.username);
        let favorites = vault_manager::load_user_favorites(&state.upload_dir, &sess.username);
        let stats = vault_manager::compute_cloud_storage_stats(&active_files, &trashed_files);

        let body = serde_json::json!({
            "authenticated": true,
            "username": sess.username,
            "media": active_files,
            "mediaFiles": active_files,
            "trashedFiles": trashed_files,
            "albums": albums_data.albums,
            "fileAlbums": albums_data.file_albums,
            "favorites": favorites,
            "storageStats": stats,
        });

        json_response(StatusCode::OK, body.to_string())
    } else {
        json_response(StatusCode::OK, r#"{"authenticated":false}"#)
    }
}
