# Migration Map: PhotoCloud to Pure Rust

## Goal
Port PhotoCloud's backend server, zero-knowledge encryption, vault storage, media processing, and API routes to a standalone high-performance Rust server binary, serving the existing React client as static web assets.

## Architectural Decisions
See [DECISIONS.md](DECISIONS.md) for full ADRs:
- **ADR-001**: Shape and Scope - Native Rust HTTP Server with Static SPA Frontend
- **ADR-002**: Backend Runtime and Web Framework - Tokio and Axum
- **ADR-003**: Dependency Mapping to Native Rust Crates
- **ADR-004**: Wire-Level and Storage-Level 100% Equivalence
- **ADR-005**: Incremental Migration Strategy with Replay and Checkpoints
- **ADR-006**: System Toolchain Initialization

## Progress Metrics
- **Replay Accuracy**: 155/155 cases passing (100.0%)
- **Fallback Rate**: 0.0% (Zero fallbacks to Node.js)
- **Integration Test Pass Rate**: 14/14 suites passing (100.0%)
- **Release Target Binary**: `rust/app/target/release/server.exe`

## Units and Migration Waves

### Wave 0 (Foundation & Leaf Units) - COMPLETED
- `src/types.ts` - `done` (Implemented in `rust/app/src/types.rs`)
- `static/` - `done` (Served natively by Tower ServeDir)
- `public/` - `done` (Served natively by Tower ServeDir)
- `release/` - `done` (Served natively by Tower ServeDir)

### Wave 1 (Core Engine & Storage) - COMPLETED
- `crypto.rs` - `done` (`PhotoCloud-GCM-v1\0` AES-GCM + PBKDF2)
- `phash.rs` - `done` (32x32 DCT-II, Hamming distance, union-find duplicate grouping)
- `nl_search.rs` - `done` (Natural language query parser IT/EN)
- `vault.rs` - `done` (Atomic storage & HKDF-SHA256 server secret)
- `vault_manager.rs` - `done` (Albums, favorites, directory listing, storage stats)
- `template_renderer.rs` - `done` (SSR login, gallery, trash template stitching)

### Wave 2 & 3 (API & State Handlers) - COMPLETED
- `state.rs` - `done` (In-memory session store & users.txt persistence)
- `units/auth.rs` - `done` (`/login`, `/logout`, `/register`)
- `units/session.rs` - `done` (`GET /api/session`)
- `units/api.rs` - `done` (Albums, Favorites, Memories, Search, Similar Duplicates, Shares)
- `units/media.rs` - `done` (`/upload`, Range request streaming `/media/:filename`, trash management)
- `units/push.rs` - `done` (`/api/push/vapid-key`, subscribe stubs)
- `units/android.rs` - `done` (`/api/android/update-manifest`)
- `units/navigation.rs` - `done` (302 redirects)
- `units/fallback.rs` - `done` (Express-compatible 404 handler)

### Wave 4 (Standalone Binary) - COMPLETED
- Native pure Rust binary built and verified at `rust/app/target/release/server.exe`.
