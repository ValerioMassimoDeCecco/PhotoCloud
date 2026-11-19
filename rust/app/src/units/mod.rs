pub mod common;
pub mod auth;
pub mod session;
pub mod push;
pub mod navigation;
pub mod root;
pub mod api;
pub mod media;
pub mod shares;
pub mod extras;
pub mod android;
pub mod zk_v2;
pub mod fallback;

use axum::extract::DefaultBodyLimit;
use axum::routing::{get, get_service, post, put};
use axum::Router;
use tower_http::services::{ServeDir, ServeFile};
use crate::state::AppState;

const UPLOAD_BODY_LIMIT: usize = 512 * 1024 * 1024; // 512 MiB

pub fn router(state: AppState) -> Router {
    let zk_api = zk_v2::v2_api_router(state.clone());
    let zk_web = zk_v2::v2_web_router();

    Router::new()
        .nest("/api/v2", zk_api)
        .nest("/v2", zk_web)
        .route("/", get(root::get_root))
        .route("/login", get(navigation::redirect_to_root).post(auth::post_login))
        .route("/logout", post(auth::post_logout))
        .route("/register", post(auth::post_register))
        .route("/trash", get(navigation::get_trash))
        .route("/map", get(extras::get_map_page))
        .route("/api/session", get(session::get_session))
        .route("/api/push/vapid-key", get(push::get_vapid_key))
        .route("/api/push/subscribe", post(push::post_subscribe))
        .route("/api/push/unsubscribe", post(push::post_unsubscribe))
        .route("/api/android/update-manifest", get(android::android_update_manifest))
        .route(
            "/api/ai-model/efficientnet_lite4.tflite",
            get(android::get_ai_model_tflite),
        )
        .route("/api/android/releases", get(android::get_android_releases))
        .route(
            "/api/android/build-release",
            post(android::post_android_build_release),
        )
        .route(
            "/api/android/download/{buildId}/{type}",
            get(android::get_android_download),
        )
        .route("/api/albums", get(api::get_albums))
        .route("/api/albums/create", post(api::post_albums_create))
        .route("/api/albums/assign", post(api::post_albums_assign))
        .route("/api/albums/delete", post(api::post_albums_delete))
        .route("/api/albums/share", post(shares::post_albums_share))
        .route("/api/albums/unshare", post(shares::post_albums_unshare))
        .route("/api/albums/shared", get(shares::get_albums_shared))
        .route("/api/shared-albums/{shareId}/media", get(shares::get_shared_album_media))
        .route(
            "/api/shared-albums/{shareId}/file/{filename}",
            get(shares::get_shared_album_file),
        )
        .route(
            "/api/shared-albums/{shareId}/upload",
            post(shares::post_shared_album_upload).layer(DefaultBodyLimit::max(UPLOAD_BODY_LIMIT)),
        )
        .route("/api/favorites", get(api::get_favorites))
        .route("/api/favorites/toggle", post(api::post_favorites_toggle))
        .route("/api/favorites/set-many", post(api::post_favorites_set_many))
        .route("/api/memories", get(api::get_memories))
        .route("/api/shares", get(shares::get_shares))
        .route("/api/shares/create", post(shares::post_shares_create))
        .route("/api/shares/delete", post(shares::post_shares_delete))
        .route("/share/{token}", get(shares::get_public_share_page))
        .route("/share/{token}/unlock", post(shares::post_public_share_unlock))
        .route(
            "/share/{token}/media/{filename}",
            get(shares::get_public_share_media_query),
        )
        .route("/api/search", get(api::get_search))
        .route("/api/similar_duplicates", post(api::post_similar_duplicates))
        .route("/api/exif/{filename}", get(extras::get_exif))
        .route("/api/map-photos", get(extras::get_map_photos))
        .route("/api/thumbs/stats", get(extras::get_thumb_stats))
        .route("/api/thumbs/rebuild", post(extras::post_thumb_rebuild))
        .route("/api/thumbs/{filename}", put(extras::put_thumb))
        .route("/api/backup/check", post(extras::post_backup_check))
        .route("/api/upload/chunked/init", post(extras::post_chunked_init))
        .route(
            "/api/upload/chunked/{uploadId}/{chunkIndex}",
            put(extras::put_chunked_part).layer(DefaultBodyLimit::max(UPLOAD_BODY_LIMIT)),
        )
        .route(
            "/api/upload/chunked/{uploadId}/complete",
            post(extras::post_chunked_complete),
        )
        .route("/api/document-preview/{filename}", get(extras::get_document_preview))
        .route(
            "/api/media/edit",
            post(extras::post_media_edit).layer(DefaultBodyLimit::max(UPLOAD_BODY_LIMIT)),
        )
        .route("/trash/batch", post(extras::post_trash_batch))
        .route("/find_duplicates_server", post(extras::post_find_duplicates))
        .route("/prepare-zip", post(extras::post_prepare_zip))
        .route("/zip-progress/{taskId}", get(extras::get_zip_progress))
        .route("/download-zip/{filename}", get(extras::get_download_zip))
        .route(
            "/upload",
            post(media::post_upload).layer(DefaultBodyLimit::max(UPLOAD_BODY_LIMIT)),
        )
        .route("/media/{filename}", get(media::get_media))
        .route("/trash/media/{filename}", get(media::get_trash_media))
        .route("/trash/{filename}", post(media::post_trash_file))
        .route("/restore/{filename}", post(media::post_restore_file))
        .route("/delete_permanent/{filename}", post(media::post_delete_permanent))
        .route("/empty_trash", post(media::post_empty_trash))
        .nest_service("/static", ServeDir::new("static"))
        .nest_service("/release", ServeDir::new("release"))
        .route("/register-pwa.js", get_service(ServeFile::new("public/register-pwa.js")))
        .route("/service-worker.js", get_service(ServeFile::new("public/service-worker.js")))
        .route("/manifest.webmanifest", get_service(ServeFile::new("public/manifest.webmanifest")))
        .route("/favicon.ico", get_service(ServeFile::new("public/favicon.ico")))
        .route("/icon.svg", get_service(ServeFile::new("public/icon.svg")))
        .route("/apple-touch-icon.png", get_service(ServeFile::new("public/apple-touch-icon.png")))
        .route("/pwa-192x192.png", get_service(ServeFile::new("public/pwa-192x192.png")))
        .route("/pwa-512x512.png", get_service(ServeFile::new("public/pwa-512x512.png")))
        .route(
            "/pwa-maskable-512x512.png",
            get_service(ServeFile::new("public/pwa-maskable-512x512.png")),
        )
        .fallback(fallback::not_found)
        .with_state(state)
}
