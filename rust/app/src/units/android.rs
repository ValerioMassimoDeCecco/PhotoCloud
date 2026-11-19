use axum::response::{IntoResponse, Response};
use axum::http::{header, StatusCode};

pub async fn android_update_manifest() -> Response {
    let body = r#"{"error":"Nessun APK di release disponibile sul server","versionName":"1.5.1","versionCode":33}"#;
    (
        StatusCode::NOT_FOUND,
        [
            (header::CONTENT_TYPE, "application/json; charset=utf-8"),
            (header::HeaderName::from_static("x-content-type-options"), "nosniff"),
            (header::HeaderName::from_static("x-frame-options"), "SAMEORIGIN"),
            (header::HeaderName::from_static("referrer-policy"), "strict-origin-when-cross-origin"),
            (header::HeaderName::from_static("permissions-policy"), "camera=(), microphone=(), geolocation=()"),
            (header::HeaderName::from_static("cross-origin-opener-policy"), "same-origin"),
            (
                header::HeaderName::from_static("content-security-policy"),
                "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
            ),
        ],
        body,
    )
        .into_response()
}
