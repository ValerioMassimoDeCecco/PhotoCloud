use axum::http::StatusCode;
use axum::response::Response;
use super::common::json_response;

pub async fn get_vapid_key() -> Response {
    json_response(
        StatusCode::OK,
        r#"{"publicKey":"BBmjbb5_C_gNNpaqkrZf_8W2q8cxaIVI5hShBiGkKpao2qGrZHWiU-acKzrrd-JEF24xzvOW4DjbbTgEyN9Z7kw"}"#,
    )
}

pub async fn post_subscribe() -> Response {
    json_response(StatusCode::OK, r#"{"success":true}"#)
}

pub async fn post_unsubscribe() -> Response {
    json_response(StatusCode::OK, r#"{"success":true}"#)
}
