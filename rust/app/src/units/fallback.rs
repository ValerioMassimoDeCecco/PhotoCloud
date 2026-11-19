use axum::extract::Request;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};

pub async fn not_found(req: Request) -> Response {
    let method = req.method().as_str();
    let path = req.uri().path();
    let body = format!(
        "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<title>Error</title>\n</head>\n<body>\n<pre>Cannot {method} {path}</pre>\n</body>\n</html>\n"
    );
    (
        StatusCode::NOT_FOUND,
        [
            (header::CONTENT_TYPE, "text/html; charset=utf-8"),
            (
                header::HeaderName::from_static("content-security-policy"),
                "default-src 'none'",
            ),
            (
                header::HeaderName::from_static("cross-origin-opener-policy"),
                "same-origin",
            ),
            (
                header::HeaderName::from_static("permissions-policy"),
                "camera=(), microphone=(), geolocation=()",
            ),
            (
                header::HeaderName::from_static("referrer-policy"),
                "strict-origin-when-cross-origin",
            ),
            (
                header::HeaderName::from_static("x-content-type-options"),
                "nosniff",
            ),
            (
                header::HeaderName::from_static("x-frame-options"),
                "SAMEORIGIN",
            ),
        ],
        body,
    )
        .into_response()
}
