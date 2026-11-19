use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};

use crate::state::AppState;
use crate::template_renderer;
use crate::vault_manager;
use super::common::{html_response, standard_headers};

pub async fn redirect_to_root() -> Response {
    let mut resp = (
        StatusCode::FOUND,
        [
            (header::LOCATION, "/"),
            (header::CONTENT_TYPE, "text/plain; charset=utf-8"),
            (header::VARY, "Accept"),
        ],
        "Found. Redirecting to /",
    )
        .into_response();
    for (k, v) in standard_headers() {
        resp.headers_mut().insert(k, v.parse().unwrap());
    }
    resp
}

pub async fn get_trash(
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
        let html = template_renderer::render_trash_template(&trashed_files, &active_files);
        html_response(StatusCode::OK, html)
    } else {
        redirect_to_root().await
    }
}
