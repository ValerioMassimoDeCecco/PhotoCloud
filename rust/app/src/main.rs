//! PhotoCloud standalone pure Rust server — 100% Zero-Knowledge End-to-End Encrypted (v2 only).
//!
//! Security invariant: this binary links ZERO symmetric cipher crates (no AES, no GCM, no CFB, no PBKDF2, no HKDF).
//! All encryption/decryption happens exclusively on the client.

mod units;
pub mod state;
pub mod zk_v2_store;

use std::net::SocketAddr;
use std::time::Duration;
use axum::serve::ListenerExt;
use state::AppState;

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}

#[tokio::main]
async fn main() {
    let state = AppState::default();

    // Startup cleanup of expired v2 uploads & trash
    let now_ms = zk_v2_store::now_ms_i64();
    let _ = state.zk_v2.cleanup_expired_uploads(now_ms);
    let _ = state.zk_v2.purge_expired_trash(now_ms);

    // Print single-use Zero-Knowledge v2 setup token once when users_v2 is empty
    if let Some(token) = state.zk_v2.active_setup_token() {
        println!(
            "[PhotoCloud v2 Setup] First-registration single-use setup token (printed once): {token}"
        );
    }

    // Periodic background cleanup (every 15 minutes): expired v2 uploads & trash
    let bg_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(15 * 60));
        interval.tick().await; // skip immediate tick
        loop {
            interval.tick().await;
            let now_ms = zk_v2_store::now_ms_i64();
            let _ = bg_state.zk_v2.cleanup_expired_uploads(now_ms);
            let _ = bg_state.zk_v2.purge_expired_trash(now_ms);
        }
    });

    let app = units::router(state);
    let port = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3000);
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], port)))
        .await
        .expect("binding the port");
    let listener = listener.tap_io(|tcp| {
        let _ = tcp.set_nodelay(true);
    });
    println!("PhotoCloud pure Rust Zero-Knowledge server listening on port {port}");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("serving");
}
