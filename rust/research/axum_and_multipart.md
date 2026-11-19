# Research: Axum, Multipart Uploads, and Streaming

## Sources
- Axum documentation (v0.7/v0.8): `axum::extract::Multipart`, `axum::response::IntoResponse`, `axum::body::Body`.
- Tower-HTTP documentation: `tower_http::cors::CorsLayer`, `tower_http::services::ServeDir`, `tower_http::trace::TraceLayer`.
- PhotoCloud source: `server.ts` routes, `multer` usage.

## Architectural Patterns

### 1. Multipart File Uploads
In `server.ts`, `multer` was configured with memory/disk storage for endpoints such as:
- `POST /api/upload` (single/batch photo and video uploads)
- `POST /api/upload_thumb` (client-generated thumbnail cache uploads)

In `axum`:
```rust
use axum::extract::Multipart;
use axum::response::Json;

pub async fn upload_handler(mut multipart: Multipart) -> Result<Json<UploadResponse>, AppError> {
    while let Some(field) = multipart.next_field().await.map_err(AppError::BadRequest)? {
        let name = field.name().unwrap_or("").to_string();
        let file_name = field.file_name().map(ToString::to_string);
        let content_type = field.content_type().map(ToString::to_string);
        let data = field.bytes().await.map_err(AppError::BadRequest)?;
        // Process encrypted stream / write to vault
    }
    Ok(Json(UploadResponse { status: "ok" }))
}
```

### 2. HTTP Range Requests (Video & Large Media Streaming)
PhotoCloud streams large encrypted media files with `Range` header support (`206 Partial Content`):
- Header: `Range: bytes=start-end`
- Response: `Content-Range: bytes start-end/total`, `Accept-Ranges: bytes`, status `206`.
- In Axum:
  Use `tower_http::services::ServeFile` or implement a custom streaming body wrapping decrypted stream chunks with seek offsets.

### 3. Static Asset Serving
The compiled React frontend (`dist/`, `public/`) is served via:
```rust
use tower_http::services::ServeDir;
let static_service = ServeDir::new("public").fallback(ServeFile::new("public/index.html"));
```
This guarantees SPA routing fallback to `index.html` for client-side navigation.

### 4. Semantic Traps
- **Chunk boundaries**: Encrypted chunks in PhotoCloud are aligned to 64 KB (`STREAM_CHUNK_BYTES`). Decryption streams must handle chunk alignment when arbitrary byte ranges are requested.
- **Multipart file size limits**: Ensure `axum::extract::DefaultBodyLimit` is adjusted for large raw photo / 4K video uploads (e.g. 2 GB).
