pub mod common;
pub mod auth;
pub mod session;
pub mod push;
pub mod navigation;
pub mod root;
pub mod api;
pub mod media;
pub mod android;
pub mod fallback;

use axum::routing::{get, post};
use axum::Router;
use tower_http::services::ServeDir;
use crate::state::AppState;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/", get(root::get_root))
        .route("/login", get(navigation::redirect_to_root).post(auth::post_login))
        .route("/logout", post(auth::post_logout))
        .route("/register", post(auth::post_register))
        .route("/trash", get(navigation::get_trash))
        .route("/map", get(navigation::redirect_to_root))
        .route("/api/session", get(session::get_session))
        .route("/api/push/vapid-key", get(push::get_vapid_key))
        .route("/api/push/subscribe", post(push::post_subscribe))
        .route("/api/push/unsubscribe", post(push::post_unsubscribe))
        .route("/api/android/update-manifest", get(android::android_update_manifest))
        .route("/api/albums", get(api::get_albums))
        .route("/api/albums/create", post(api::post_albums_create))
        .route("/api/albums/assign", post(api::post_albums_assign))
        .route("/api/albums/delete", post(api::post_albums_delete))
        .route("/api/favorites", get(api::get_favorites))
        .route("/api/favorites/toggle", post(api::post_favorites_toggle))
        .route("/api/favorites/set-many", post(api::post_favorites_set_many))
        .route("/api/memories", get(api::get_memories))
        .route("/api/shares", get(api::get_shares))
        .route("/api/search", get(api::get_search))
        .route("/api/similar_duplicates", post(api::post_similar_duplicates))
        .route("/upload", post(media::post_upload))
        .route("/media/{filename}", get(media::get_media))
        .route("/trash/media/{filename}", get(media::get_trash_media))
        .route("/trash/{filename}", post(media::post_trash_file))
        .route("/restore/{filename}", post(media::post_restore_file))
        .route("/delete_permanent/{filename}", post(media::post_delete_permanent))
        .route("/empty_trash", post(media::post_empty_trash))
        .nest_service("/static", ServeDir::new("static"))
        .nest_service("/release", ServeDir::new("release"))
        .fallback(fallback::not_found)
        .with_state(state)
}
