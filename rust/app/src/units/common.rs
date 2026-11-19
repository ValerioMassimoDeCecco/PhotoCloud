use axum::http::{header, HeaderName, StatusCode};
use axum::response::{IntoResponse, Response};

pub fn standard_headers() -> [(HeaderName, &'static str); 6] {
    [
        (HeaderName::from_static("x-content-type-options"), "nosniff"),
        (HeaderName::from_static("x-frame-options"), "SAMEORIGIN"),
        (HeaderName::from_static("referrer-policy"), "strict-origin-when-cross-origin"),
        (HeaderName::from_static("permissions-policy"), "camera=(), microphone=(), geolocation=()"),
        (HeaderName::from_static("cross-origin-opener-policy"), "same-origin"),
        (
            HeaderName::from_static("content-security-policy"),
            "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
        ),
    ]
}

pub fn json_response(status: StatusCode, body: impl Into<String>) -> Response {
    let mut resp = (
        status,
        [(header::CONTENT_TYPE, "application/json; charset=utf-8")],
        body.into(),
    )
        .into_response();
    for (k, v) in standard_headers() {
        resp.headers_mut().insert(k, v.parse().unwrap());
    }
    resp
}

pub fn html_response(status: StatusCode, body: impl Into<String>) -> Response {
    let mut resp = (
        status,
        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
        body.into(),
    )
        .into_response();
    for (k, v) in standard_headers() {
        resp.headers_mut().insert(k, v.parse().unwrap());
    }
    resp
}

pub fn access_denied() -> Response {
    json_response(StatusCode::FORBIDDEN, r#"{"error":"Accesso negato"}"#)
}
