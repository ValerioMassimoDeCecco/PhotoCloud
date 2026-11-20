use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;

use crate::state::AppState;
use super::common::{access_denied, json_response};
use super::zk_v2::has_authenticated_v2_session;

pub async fn get_vapid_key() -> Response {
    json_response(
        StatusCode::OK,
        r#"{"publicKey":"BBmjbb5_C_gNNpaqkrZf_8W2q8cxaIVI5hShBiGkKpao2qGrZHWiU-acKzrrd-JEF24xzvOW4DjbbTgEyN9Z7kw"}"#,
    )
}

pub async fn post_subscribe(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !has_authenticated_v2_session(&state, &headers) {
        return access_denied();
    }
    json_response(StatusCode::OK, r#"{"success":true}"#)
}

pub async fn post_unsubscribe(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !has_authenticated_v2_session(&state, &headers) {
        return access_denied();
    }
    json_response(StatusCode::OK, r#"{"success":true}"#)
}
