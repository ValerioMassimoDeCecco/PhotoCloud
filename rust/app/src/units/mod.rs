pub mod common;
pub mod push;
pub mod android;
pub mod zk_v2;

use axum::http::StatusCode;
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::{get, get_service, post};
use axum::{Json, Router};
use tower_http::services::{ServeDir, ServeFile};

use crate::state::AppState;

async fn redirect_to_v2() -> Redirect {
    Redirect::temporary("/v2")
}

async fn removed_v1_gone() -> Response {
    (
        StatusCode::GONE,
        Json(serde_json::json!({
            "error": "SERVER_SIDE_ENCRYPTION_REMOVED",
            "message": "La cifratura lato server (v1) è stata rimossa definitivamente. PhotoCloud opera esclusivamente in modalità Zero-Knowledge End-to-End su /v2 e /api/v2/*.",
            "v2Url": "/v2"
        })),
    )
        .into_response()
}

pub fn router(state: AppState) -> Router {
    let zk_api = zk_v2::v2_api_router(state.clone());
    let zk_web = zk_v2::v2_web_router();

    Router::new()
        .nest("/api/v2", zk_api)
        .nest("/v2", zk_web)
        // Unconditional redirects from legacy entry pages to the Zero-Knowledge v2 web app
        .route("/", get(redirect_to_v2))
        .route("/login", get(redirect_to_v2).post(removed_v1_gone))
        .route("/trash", get(redirect_to_v2))
        .route("/map", get(redirect_to_v2))
        // Push notifications (subscribe/unsubscribe authenticated via v2 session cookie)
        .route("/api/push/vapid-key", get(push::get_vapid_key))
        .route("/api/push/subscribe", post(push::post_subscribe))
        .route("/api/push/unsubscribe", post(push::post_unsubscribe))
        // Android OTA update manifest, on-device AI TFLite model, and Release Studio API
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
        // Static PWA & release assets
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
        // Every removed legacy V1 route fails closed with 410 Gone
        .fallback(removed_v1_gone)
        .with_state(state)
}
