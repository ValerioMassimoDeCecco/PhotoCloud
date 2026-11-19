use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;

use crate::state::AppState;
use crate::template_renderer;
use crate::vault_manager;
use super::common::html_response;

pub async fn get_root(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    if let Some(sess) = state.get_session(&headers) {
        let user_folder = state.upload_dir.join(&sess.username);
        let trash_folder = user_folder.join("trash");
        let _ = std::fs::create_dir_all(&user_folder);
        let _ = std::fs::create_dir_all(&trash_folder);

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

        let html = template_renderer::render_gallery_template(
            &active_files,
            &albums_data.albums,
            &trashed_files,
            &favorites,
        );
        html_response(StatusCode::OK, html)
    } else {
        let html = template_renderer::render_login_template(None);
        html_response(StatusCode::OK, html)
    }
}
