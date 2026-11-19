# Handoff: PhotoCloud Pure Rust Port

## Current State
- **Phase**: Pure Rust Standalone Server Completed & Verified
- **Replay Status**: 155/155 cases passed (100.0% compatibility verified against `rust/app/target/release/server.exe`)
- **Fallback Rate**: 0.0% (Standalone pure Rust server with zero fallback to Node.js)
- **End-to-End Tests**: 14/14 passed (100.0% in `tests/test_rust_server_e2e.py`)
- **Release Binary**: `rust/app/target/release/server.exe`

## Ported Components in `rust/app/src/`
- **`main.rs`**: Tokio async runtime, port binding (`PORT` env, default 8080), graceful shutdown.
- **`state.rs`**: Shared memory session store with expiration, atomic user credential operations in `users.txt`.
- **`crypto.rs`**: `PhotoCloud-GCM-v1\0` header layout, 100,000-iteration PBKDF2 with LRU cache, AES-256-GCM, constant-time verification, 32-char API key generator.
- **`vault.rs`**: Atomic file and JSON writes with process PID suffix, HKDF-SHA256 server secret wrapping.
- **`vault_manager.rs`**: Safe vault filename validation, user albums & favorites persistence, directory listing, cloud storage stats.
- **`phash.rs`**: 32x32 DCT-II perceptual hash, Hamming distance, union-find duplicate grouping.
- **`nl_search.rs`**: Natural language query parser (Italian & English) with token and date matching.
- **`template_renderer.rs`**: Jinja-like template stitching with `base.html`, `login.html`, gallery, trash, and `url_for('static', ...)` resolution.
- **`units/auth.rs`**: `POST /login`, `POST /logout`, `POST /register` with auth file JSON generation and cookies.
- **`units/session.rs`**: `GET /api/session` (full media catalog & storage stats when authenticated, `{ "authenticated": false }` when not).
- **`units/api.rs`**: Albums (`/api/albums`), Favorites (`/api/favorites`), Memories (`/api/memories`), Natural Search (`/api/search`), Similar Duplicates (`/api/similar_duplicates`), Shares (`/api/shares`).
- **`units/media.rs`**: Multipart file upload (`POST /upload`), streaming authenticated Range request decryption (`GET /media/:filename`, `GET /trash/media/:filename`), trash lifecycle (`POST /trash/:filename`, `/restore/:filename`, `/delete_permanent/:filename`, `/empty_trash`).
- **`units/push.rs`**: `GET /api/push/vapid-key`, push subscription stubs.
- **`units/android.rs`**: `GET /api/android/update-manifest`.
- **`units/navigation.rs`**: 302 redirects with Express-exact headers and body for `/login`, `/trash`, `/map`.
- **`units/fallback.rs`**: Express-compatible 404 handler with exact Content-Security-Policy and HTML error formatting.

## Running the Rust Application
- Run release server:
  ```powershell
  npm run start:rust
  # or directly:
  .\rust\app\target\release\server.exe
  ```
- Run integration tests:
  ```powershell
  npm run test:rust
  ```
- Run characterization replay:
  ```powershell
  rust-anything app replay . --build rust/app/target/release/server.exe
  ```
