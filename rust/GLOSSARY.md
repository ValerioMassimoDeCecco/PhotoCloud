# Domain Glossary: PhotoCloud TS to Rust

| Source Term (TS/JS) | Domain Meaning | Rust Representation |
| :--- | :--- | :--- |
| `Vault` | Root encrypted storage directory containing user assets, thumbnails, and metadata. | `struct Vault` / `crate::vault` |
| `VaultStorage` | Disk I/O management for secrets, encrypted files, and JSON index. | `struct VaultStorage` in `vault_storage.rs` |
| `HashIndex` / `vaultHashIndex` | Fast lookup map from SHA-256 hash to file records on disk. | `struct HashIndex` using `std::collections::HashMap` / `indexmap` |
| `Crypto` | Symmetric encryption (AES-256-GCM), key derivation, and file streaming. | `module crypto` using `aes_gcm`, `argon2`, `sha2` |
| `pHash` | Perceptual image hashing for duplicate and near-duplicate detection. | `fn compute_phash_hex`, `fn hamming_distance_hex` |
| `ExifMetadata` | Extracted camera, location, and date metadata from JPEG/TIFF files. | `struct ExifMetadata` |
| `ThumbCache` | Multi-tier thumbnail generation and caching mechanism. | `struct ThumbCache` using `image` crate |
| `DocumentEngine` | Spec resolver and document parsing for viewer previews. | `module document_engine` |
| `NaturalQuery` / `nlSearch` | Text parsing and matching for search filters (date, tag, type). | `module nl_search` |
| `PublicShareRecord` | Shared media link token with optional expiry and password hash. | `struct PublicShareRecord` |
| `TemplateRenderer` | SSR HTML generation for login, gallery, and map views. | `module template_renderer` using `askama` or string templates |
| `ZkServerV2` | Zero-Knowledge authentication and encrypted payload sync endpoint. | `module zk_server_v2` |
