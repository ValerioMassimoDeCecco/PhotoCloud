# Architecture Decision Records (ADRs)

## ADR-001: Shape and Scope - Native Rust HTTP Server with Static SPA Frontend
- **Status**: accepted (2026-11-19)
- **Context**: PhotoCloud consists of an Express HTTP server backend handling file storage, zero-knowledge encryption, search, thumbnail caching, and metadata extraction, alongside a React 19 / Vite SPA client.
- **Decision**: Port the backend server and core cryptographic and storage libraries (`server.ts`, `src/lib/*`) into a standalone native Rust HTTP server. The React SPA frontend (`src/App.tsx`, `src/components/`, `src/main.tsx`) remains in TypeScript/React, compiled into static web assets and served directly by the Rust server from `public/` (or embedded in release).
- **Consequences**: Avoids rewriting the web UI into a desktop/WASM GUI. Delivers native backend performance, memory safety, and high-concurrency throughput while preserving the existing user interface.

## ADR-002: Backend Runtime and Web Framework - Tokio and Axum
- **Status**: accepted (2026-11-19)
- **Context**: The existing backend is powered by Node.js and Express 5. An equivalent high-performance async framework in Rust is needed.
- **Decision**: Use `tokio` (multi-threaded async runtime) and `axum` (modern HTTP framework with Tower middleware ecosystem).
- **Consequences**: Standardized ecosystem support for async I/O, streaming file uploads/downloads, robust error handling, and seamless Tower middleware integration (tracing, compression, CORS).

## ADR-003: Dependency Mapping to Native Rust Crates
- **Status**: accepted (2026-11-19)
- **Context**: The Node.js application relies on external npm packages without direct 1:1 C ABI ports.
- **Decision**:
  - `multer` -> `axum::extract::Multipart`
  - `jszip` -> `zip` crate
  - `jimp` -> `image` crate (pure Rust image decoding, resizing, encoding)
  - `hash-wasm` / `node:crypto` -> Native crates: `sha2`, `blake3`, `aes-gcm`, `argon2`, `hex`, `base64`
  - `web-push` -> `web-push-native` crate (RFC 8291 / VAPID protocol)
  - `express` -> `axum` + `tower-http`
- **Consequences**: All foreign dependencies are replaced by high-performance, memory-safe pure Rust crates.

## ADR-004: Wire-Level and Storage-Level 100% Equivalence
- **Status**: accepted (2026-11-19)
- **Context**: PhotoCloud interacts with mobile clients (Android app) and web browsers. Vault data on disk must remain compatible across versions without data loss.
- **Decision**: Ensure 100% backward compatibility for all HTTP API endpoints (`/api/...`), JSON schemas, status codes, encrypted file formats, salt/IV structures, and vault metadata files. Environment variables (`PORT`, `VAULT_PATH`, `JWT_SECRET`, etc.) retain existing naming and behavior.
- **Consequences**: Clients and existing user data remain fully functional without migration scripts or breaking changes.

## ADR-005: Incremental Migration Strategy with Replay and Checkpoints
- **Status**: accepted (2026-11-19)
- **Context**: Porting an entire server in a single monolithic step risks subtle behavioral discrepancies and regressions.
- **Decision**: Follow the `rust-anything` methodology:
  1. Record external behavior on edge-cases and workloads (`app record`).
  2. Implement an Axum-based `rust/app` front door that proxies non-migrated routes to the original Node.js server.
  3. Migrate modules wave-by-wave (Wave 0 to Wave 4) using `rust-anything bridge`, `diff`, and `gate`.
  4. Perform `app lift` once all units pass gate with 0% fallback to generate a pure Rust binary.
  5. Hold verification checkpoints after each wave.
- **Consequences**: The application stays runnable and testable at every single step of the migration.

## ADR-006: System Toolchain Initialization
- **Status**: accepted (2026-11-19)
- **Context**: Compilation of Rust crates requires `cargo` and MSVC / C++ build tools.
- **Decision**: Install and verify the Rust toolchain (`rustup`, `cargo`, `rustc`) on the Windows host.
- **Consequences**: Enables crate building, running unit tests, diffing cases, and gating.
