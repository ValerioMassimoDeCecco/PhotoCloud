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
pub mod zk_v2_store;

use std::fs;
use std::net::SocketAddr;
use std::path::Path;
use std::time::{Duration, SystemTime};
use axum::serve::ListenerExt;
use state::AppState;

const CHUNKED_UPLOAD_TTL_SECS: u64 = 24 * 60 * 60;

fn cleanup_orphan_temp_files(temp_dir: &Path, clean_all_chunked_parts: bool) -> usize {
    let Ok(entries) = fs::read_dir(temp_dir) else {
        return 0;
    };
    let now = SystemTime::now();
    let mut removed = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let is_chunked_part = name.starts_with("chunked_") && name.ends_with(".part");
        let is_stale_tmp = name.starts_with("upload_") && name.ends_with(".tmp");
        if is_chunked_part && clean_all_chunked_parts {
            if fs::remove_file(&path).is_ok() {
                removed += 1;
            }
            continue;
        }
        if is_chunked_part || is_stale_tmp {
            let age_secs = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|m| now.duration_since(m).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            if age_secs >= CHUNKED_UPLOAD_TTL_SECS && fs::remove_file(&path).is_ok() {
                removed += 1;
            }
        }
    }
    removed
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}

#[tokio::main]
async fn main() {
    let state = AppState::default();

    // Startup cleanup of orphaned V1 chunked parts & stale temp files
    let cleaned = cleanup_orphan_temp_files(&state.temp_dir, true);
    if cleaned > 0 {
        println!(
            "PhotoCloud startup cleanup: rimossi {cleaned} file temporanei orfani da temp_uploads/"
        );
    }

    // Print single-use Zero-Knowledge v2 setup token once when users_v2 is empty
    if let Some(token) = state.zk_v2.active_setup_token() {
        println!(
            "[PhotoCloud v2 Setup] First-registration single-use setup token (printed once): {token}"
        );
    }

    // Periodic background cleanup (every 15 minutes): V1 stale temp files, V2 expired uploads & trash
    let bg_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(15 * 60));
        interval.tick().await; // skip immediate tick
        loop {
            interval.tick().await;
            let now_ms = zk_v2_store::now_ms_i64();
            let _ = bg_state.zk_v2.cleanup_expired_uploads(now_ms);
            let _ = bg_state.zk_v2.purge_expired_trash(now_ms);
            let _ = cleanup_orphan_temp_files(&bg_state.temp_dir, false);
        }
    });

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
