mod units;
pub mod types;
pub mod crypto;
pub mod phash;
pub mod nl_search;
pub mod vault;
pub mod vault_manager;
pub mod template_renderer;
pub mod state;
pub mod sharing;
pub mod exif;
pub mod document_engine;
pub mod hash_index;
pub mod thumb_cache;

use std::net::SocketAddr;
use axum::serve::ListenerExt;
use state::AppState;

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}

#[tokio::main]
async fn main() {
    let state = AppState::default();
    let app = units::router(state);
    let port = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], port)))
        .await
        .expect("binding the port");
    let listener = listener.tap_io(|tcp| {
        let _ = tcp.set_nodelay(true);
    });
    println!("PhotoCloud pure Rust server listening on port {port}");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("serving");
}
