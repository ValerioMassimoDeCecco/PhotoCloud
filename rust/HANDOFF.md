# Handoff: PhotoCloud Pure Rust Server (100% Feature Parity)

## Current State
- **Phase**: Pure Rust Standalone Server — 100% Parity Complete (V1 + Zero-Knowledge V2 + Android/AI + Legacy CFB)
- **Fallback Rate**: 0.0% (Standalone pure Rust binary with zero dependency on Node.js at runtime)
- **Build Status**: `cargo build --release --manifest-path rust/app/Cargo.toml` — 0 warnings, 0 errors
- **Rust Unit Tests**: `cargo test --manifest-path rust/app/Cargo.toml` — 7/7 passed
- **V1 + Parity E2E Suite**: `npm run test:rust` (`tests/test_rust_server_e2e.py`, Python stdlib only, isolated temp cwd) — 17/17 passed
- **Zero-Knowledge V2 Playwright Browser E2E**: `scripts/e2e-v2-playwright.mjs` against `rust/app/target/release/server` — 9/9 flows passed
- **Cross-Stack Legacy AES-256-CFB Verification**: Node.js `aes-256-cfb` ciphertext decrypted byte-for-byte (full + HTTP 206 Range) by Rust server — passed
- **Release Binary**: `rust/app/target/release/server` (`server.exe` on Windows)

## Ported Components in `rust/app/src/`
- **`main.rs`**: Tokio async runtime, port binding (`PORT` env, default `8080`), single-use V2 setup token banner on empty vault, startup cleanup of orphaned `temp_uploads/chunked_*.part`, periodic 15-minute background cleanup (expired V2 uploads, expired V2 trash, stale chunked parts), graceful shutdown.
- **`state.rs`**: Shared session store with expiration, atomic user credential operations in `users.txt`, `ZkVaultStoreV2` handle (`VAULT_V2_DIR` env or `vault_v2`), playback grant windows for public shares.
- **`crypto.rs`**: `PhotoCloud-GCM-v1\0` AES-256-GCM encryption/decryption, **legacy AES-256-CFB-128** decryption fallback (16B salt + 16B IV + PBKDF2-HMAC-SHA256 100k iterations), LRU key cache, constant-time API key verification, 32-char API key generator.
- **`zk_v2_store.rs`**: Zero-Knowledge V2 storage engine using bundled SQLite (`rusqlite`, WAL mode, `vault_v2/index.sqlite`), `scrypt` (`N=32768, r=8, p=1, dkLen=32`) with constant-time verification, HMAC-SHA256 deterministic fake salts, UUIDv4 path validation, RFC 9110 Range parser, atomic file operations, rate limiters, single-use setup token.
- **`units/zk_v2.rs`**: Complete `/api/v2/*` Zero-Knowledge REST API (`/register`, `/login/params`, `/login`, `/logout`, `/account/rewrap`, `/blobs/upload/*`, `/blobs/{id}`, `/blobs/{id}/thumbs/{variant}`, `/items*`, `/backup/check`, `/albums`, `/trash*`, `/stats`, `/shares*` + all `/auth/*` aliases) and `/v2/*` Web Shell (`/v2`, `/v2/share/{shareId}`, `/v2/app.css`, `/v2/app.js`, `/v2/sw-stream.js` with `Service-Worker-Allowed: /v2`, strict CSP, CSRF origin/Sec-Fetch-Site checks).
- **`units/android.rs`**: Dynamic `GET /api/android/update-manifest` (reads `android-app/app/build.gradle.kts` + `release/photocloud-release-build.json`, resolves real signed APK, computes SHA-256), `GET /api/ai-model/efficientnet_lite4.tflite` (RFC 9110 Range 206/416), `GET /api/android/releases`, `POST /api/android/build-release` (ZIP packaging of `android-app/`), `GET /api/android/download/{buildId}/{type}`.
- **`units/media.rs`**: Multipart upload (`POST /upload`) with `?skipList=1`, per-file SHA-256 integrity verification + rollback on mismatch, `hash_index` recording, streaming Range decryption (HTTP 200 / 206 / 416), trash lifecycle.
- **`units/shares.rs`**: Public shares & shared albums with inline `maxDownloads` quota enforcement (audio/video `pc_pb` playback grant window) and HTTP 416 on invalid Range headers.
- **`units/extras.rs`**: EXIF metadata, `/map` with OpenStreetMap CSP, persistent encrypted thumbnail cache (`/api/thumbs/*`), `/api/backup/check`, chunked uploads (`/api/upload/chunked/*`), DOCX/PDF previews, media editing, duplicate detection, async ZIP export, HTTP 416 on invalid Range headers.
- **`units/auth.rs`, `units/session.rs`, `units/api.rs`, `units/push.rs`, `units/navigation.rs`, `units/root.rs`, `units/fallback.rs`**: Full V1 authentication, session/media catalog, albums, favorites, memories, NL search, perceptual hash duplicates, push stubs, PWA static assets, and Express-compatible CSP/404 handling.

## Running & Testing the Rust Application
- Build release binary:
  ```bash
  npm run build:rust
  ```
- Run release server (cross-platform Linux/macOS/Windows):
  ```bash
  npm run start:rust
  ```
- Run 17-suite isolated E2E tests (Python 3 stdlib only, zero external packages):
  ```bash
  npm run test:rust
  ```
- Run Rust unit tests:
  ```bash
  cargo test --manifest-path rust/app/Cargo.toml
  ```
