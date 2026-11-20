//! PhotoCloud Zero-Knowledge Vault Storage & Server-Side Crypto Primitives (v2).
//!
//! SECURITY INVARIANT:
//! - Questo modulo NON importa né esegue alcuna cifra/decifra di contenuto utente
//!   (AES-GCM, AES-CFB, Argon2id client, HKDF).
//! - Primitive ammesse esclusivamente sul server:
//!   1. `scrypt` (N=32768, r=8, p=1, dk_len=32) + `subtle::ConstantTimeEq` per `authSecret`.
//!   2. `HMAC-SHA256` con `server_secret` per fake salt deterministici (anti-enumerazione).
//!   3. `SHA-256` sul ciphertext per verifica integrità upload ed `ETag`.
//!   4. CSPRNG (`rand`) per ID casuali, `serverSalt` e token di sessione/setup.

use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use hmac::{Hmac, Mac};
use rand::RngCore;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

pub const PCZK_MAGIC: &[u8; 4] = b"PCZK";
pub const PCZK_VERSION_V1: u8 = 0x01;
pub const PCZK_MIN_BLOB_BYTES: u64 = 102; // 70B header + 32B EOF frame

pub const V2_SESSION_COOKIE_NAME: &str = "photocloud_v2_sid";
pub const DEFAULT_SESSION_TTL_MS: i64 = 7 * 24 * 60 * 60 * 1000; // 7 giorni
pub const DEFAULT_UPLOAD_TTL_MS: i64 = 24 * 60 * 60 * 1000; // 24 ore
pub const DEFAULT_TRASH_TTL_MS: i64 = 30 * 24 * 60 * 60 * 1000; // 30 giorni
pub const DEFAULT_QUOTA_BYTES: i64 = 10 * 1024 * 1024 * 1024; // 10 GiB
pub const DEFAULT_MAX_UPLOAD_BYTES: u64 = 500 * 1024 * 1024; // 500 MiB
pub const DEFAULT_MAX_UPLOAD_CHUNKS: u64 = 10_000;
pub const MAX_ENC_META_BYTES: usize = 64 * 1024; // 64 KiB
pub const MAX_SHARE_MANIFEST_BYTES: usize = 1024 * 1024; // 1 MiB
pub const MAX_ALBUM_BLOB_BYTES: usize = 4 * 1024 * 1024; // 4 MiB
pub const MAX_THUMB_BLOB_BYTES: usize = 2 * 1024 * 1024; // 2 MiB
pub const MAX_CHUNK_BODY_BYTES: usize = 16 * 1024 * 1024; // 16 MiB per chunk HTTP PUT

pub const SCRYPT_LOG_N: u8 = 15; // 2^15 = 32768
pub const SCRYPT_R: u32 = 8;
pub const SCRYPT_P: u32 = 1;
pub const SCRYPT_KEYLEN: usize = 32;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KdfParamsV2 {
    pub algorithm: String,
    pub memory_ki_b: u32,
    pub iterations: u32,
    pub parallelism: u32,
}

impl Default for KdfParamsV2 {
    fn default() -> Self {
        Self {
            algorithm: "Argon2id".to_string(),
            memory_ki_b: 65536,
            iterations: 3,
            parallelism: 1,
        }
    }
}

#[derive(Debug, Clone)]
pub struct UserRecordV2 {
    pub id: String,
    pub username: String,
    pub user_salt: String,
    pub kdf_params: String,
    pub server_salt: Vec<u8>,
    pub auth_verifier: Vec<u8>,
    pub wrapped_vk: String,
    pub quota_bytes: i64,
}

#[derive(Debug, Clone)]
pub struct ItemRecordV2 {
    pub id: String,
    pub owner_id: String,
    pub blob_id: String,
    pub version: i64,
    pub size: i64,
    pub sha256_hex: String,
    pub enc_meta: String,
    pub dedup_tag: Option<String>,
    pub state: String,
    pub trashed_at: Option<i64>,
    pub thumb_320: i64,
    pub thumb_1280: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

impl ItemRecordV2 {
    pub fn to_json(&self) -> serde_json::Value {
        let mut thumbs: Vec<u32> = Vec::new();
        if self.thumb_320 != 0 {
            thumbs.push(320);
        }
        if self.thumb_1280 != 0 {
            thumbs.push(1280);
        }
        serde_json::json!({
            "id": self.id,
            "blobId": self.blob_id,
            "version": self.version,
            "size": self.size,
            "sha256": self.sha256_hex,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
            "state": self.state,
            "trashedAt": self.trashed_at,
            "encMeta": self.enc_meta,
            "dedupTag": self.dedup_tag,
            "thumbs": thumbs,
        })
    }
}

#[derive(Debug, Clone)]
pub struct UploadSessionV2 {
    pub upload_id: String,
    pub owner_id: String,
    pub blob_id: String,
    pub total_size: i64,
    pub chunk_size: i64,
    pub total_chunks: i64,
    pub received_chunks: i64,
    pub received_bytes: i64,
    pub expected_sha256: String,
    pub enc_meta: String,
    pub dedup_tag: Option<String>,
    pub item_id: Option<String>,
    pub temp_path: String,
    pub created_at: i64,
    pub expires_at: i64,
}

#[derive(Debug, Clone)]
pub struct AuthenticatedUserV2 {
    pub user_id: String,
    pub username: String,
    pub sid_hash: Vec<u8>,
    pub csrf_token: String,
    pub quota_bytes: i64,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct UserUsageV2 {
    pub active_bytes: i64,
    pub trashed_bytes: i64,
    pub active_count: i64,
    pub trashed_count: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RegistrationPolicy {
    Disabled,
    Open,
    SetupTokenOrInvite,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParsedHttpRange {
    None,
    Satisfiable { start: u64, end: u64 },
    Unsatisfiable,
}

pub fn now_ms_i64() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn random_bytes(len: usize) -> Vec<u8> {
    let mut buf = vec![0u8; len];
    rand::thread_rng().fill_bytes(&mut buf);
    buf
}

pub fn random_base64url(num_bytes: usize) -> String {
    URL_SAFE_NO_PAD.encode(random_bytes(num_bytes))
}

pub fn random_uuid_v4() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let h = hex::encode(bytes);
    format!(
        "{}-{}-{}-{}-{}",
        &h[0..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..32]
    )
}

pub fn is_valid_uuid_v4(s: &str) -> bool {
    if s.len() != 36 {
        return false;
    }
    let b = s.as_bytes();
    if b[8] != b'-' || b[13] != b'-' || b[18] != b'-' || b[23] != b'-' {
        return false;
    }
    if b[14] != b'4' {
        return false;
    }
    if !matches!(b[19], b'8' | b'9' | b'a' | b'b' | b'A' | b'B') {
        return false;
    }
    b.iter().enumerate().all(|(i, &c)| {
        if i == 8 || i == 13 || i == 18 || i == 23 {
            true
        } else {
            c.is_ascii_hexdigit()
        }
    })
}

pub fn is_valid_v2_username(s: &str) -> bool {
    let len = s.len();
    (3..=32).contains(&len)
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

pub fn is_valid_share_id(s: &str) -> bool {
    let len = s.len();
    (20..=64).contains(&len)
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
}

pub fn is_valid_sha256_hex(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

pub fn is_valid_base64url(s: &str) -> bool {
    !s.is_empty()
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

pub fn decode_base64url_strict(raw: &str, expected_len: usize) -> Option<Vec<u8>> {
    if !is_valid_base64url(raw) {
        return None;
    }
    let decoded = URL_SAFE_NO_PAD.decode(raw).ok()?;
    if decoded.len() != expected_len {
        return None;
    }
    Some(decoded)
}

pub fn validate_kdf_params(raw: &serde_json::Value) -> Option<KdfParamsV2> {
    let obj = raw.as_object()?;
    if obj.get("algorithm").and_then(|v| v.as_str()) != Some("Argon2id") {
        return None;
    }
    let memory = obj.get("memoryKiB")?.as_u64()?;
    let iterations = obj.get("iterations")?.as_u64()?;
    let parallelism = obj.get("parallelism")?.as_u64()?;
    if !(65536..=1_048_576).contains(&memory) {
        return None;
    }
    if !(3..=32).contains(&iterations) {
        return None;
    }
    if !(1..=16).contains(&parallelism) {
        return None;
    }
    Some(KdfParamsV2 {
        algorithm: "Argon2id".to_string(),
        memory_ki_b: memory as u32,
        iterations: iterations as u32,
        parallelism: parallelism as u32,
    })
}

pub fn validate_enc_meta_string(raw: &str) -> Option<String> {
    if raw.is_empty() || raw.len() > MAX_ENC_META_BYTES || !is_valid_base64url(raw) {
        return None;
    }
    let decoded = URL_SAFE_NO_PAD.decode(raw).ok()?;
    if decoded.len() < 28 || decoded.len() > MAX_ENC_META_BYTES {
        return None;
    }
    Some(raw.to_string())
}

pub fn validate_share_manifest_string(raw: &str) -> Option<String> {
    if raw.is_empty() || raw.len() > MAX_SHARE_MANIFEST_BYTES || !is_valid_base64url(raw) {
        return None;
    }
    let decoded = URL_SAFE_NO_PAD.decode(raw).ok()?;
    if decoded.len() < 28 || decoded.len() > MAX_SHARE_MANIFEST_BYTES {
        return None;
    }
    Some(raw.to_string())
}

/// Returns `Ok(None)` if omitted/null/empty, `Ok(Some(hex_lower))` if valid 32B hex or b64url,
/// or `Err(())` if invalid.
pub fn validate_optional_dedup_tag(raw: Option<&serde_json::Value>) -> Result<Option<String>, ()> {
    let val = match raw {
        None => return Ok(None),
        Some(v) if v.is_null() => return Ok(None),
        Some(v) => v,
    };
    let s = val.as_str().ok_or(())?;
    if s.is_empty() {
        return Ok(None);
    }
    if is_valid_sha256_hex(s) {
        return Ok(Some(s.to_lowercase()));
    }
    if let Some(decoded) = decode_base64url_strict(s, 32) {
        return Ok(Some(hex::encode(decoded)));
    }
    Err(())
}

pub fn compute_scrypt_verifier(auth_secret: &[u8], server_salt: &[u8]) -> Result<Vec<u8>, String> {
    let params = scrypt::Params::new(SCRYPT_LOG_N, SCRYPT_R, SCRYPT_P, SCRYPT_KEYLEN)
        .map_err(|e| format!("invalid scrypt params: {e}"))?;
    let mut output = vec![0u8; SCRYPT_KEYLEN];
    scrypt::scrypt(auth_secret, server_salt, &params, &mut output)
        .map_err(|e| format!("scrypt failed: {e}"))?;
    Ok(output)
}

pub fn verify_scrypt_constant_time(
    auth_secret: &[u8],
    server_salt: &[u8],
    expected_verifier: &[u8],
) -> bool {
    if expected_verifier.len() != SCRYPT_KEYLEN {
        return false;
    }
    match compute_scrypt_verifier(auth_secret, server_salt) {
        Ok(derived) => bool::from(derived.as_slice().ct_eq(expected_verifier)),
        Err(_) => false,
    }
}

pub fn derive_fake_salt_for_username(server_secret: &[u8; 32], username: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(server_secret).expect("HMAC key");
    mac.update(format!("PhotoCloud-v2-fake-salt|{}", username.to_lowercase()).as_bytes());
    let digest = mac.finalize().into_bytes();
    URL_SAFE_NO_PAD.encode(&digest[..16])
}

pub fn derive_hmac_sha256(server_secret: &[u8; 32], msg: &str) -> [u8; 32] {
    let mut mac = Hmac::<Sha256>::new_from_slice(server_secret).expect("HMAC key");
    mac.update(msg.as_bytes());
    let bytes = mac.finalize().into_bytes();
    let mut out = [0u8; 32];
    out.copy_from_slice(&bytes);
    out
}

pub fn verify_token_constant_time(expected: Option<&str>, provided: Option<&str>) -> bool {
    let (Some(exp), Some(prov)) = (expected, provided) else {
        return false;
    };
    let exp = exp.trim();
    let prov = prov.trim();
    if exp.is_empty() || prov.is_empty() {
        return false;
    }
    // Hash both to fixed 32-byte digests to avoid length leaks
    let h_exp = Sha256::digest(exp.as_bytes());
    let h_prov = Sha256::digest(prov.as_bytes());
    bool::from(h_exp.as_slice().ct_eq(h_prov.as_slice()))
}

pub fn timing_safe_hex_equal(hex_a: &str, hex_b: &str) -> bool {
    if !is_valid_sha256_hex(hex_a) || !is_valid_sha256_hex(hex_b) {
        return false;
    }
    let Ok(a) = hex::decode(hex_a.to_lowercase()) else {
        return false;
    };
    let Ok(b) = hex::decode(hex_b.to_lowercase()) else {
        return false;
    };
    if a.len() != b.len() {
        return false;
    }
    bool::from(a.as_slice().ct_eq(b.as_slice()))
}

pub fn compute_file_sha256_hex(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

pub fn parse_http_range_header(range_header: Option<&str>, total_size: u64) -> ParsedHttpRange {
    let raw = match range_header {
        Some(s) if !s.trim().is_empty() => s.trim(),
        _ => return ParsedHttpRange::None,
    };
    if !raw.starts_with("bytes=") || total_size == 0 {
        return ParsedHttpRange::Unsatisfiable;
    }
    let spec = raw["bytes=".len()..].trim();
    if spec.contains(',') {
        return ParsedHttpRange::Unsatisfiable;
    }
    let Some((start_str, end_str)) = spec.split_once('-') else {
        return ParsedHttpRange::Unsatisfiable;
    };
    if start_str.is_empty() && end_str.is_empty() {
        return ParsedHttpRange::Unsatisfiable;
    }
    if !start_str.bytes().all(|b| b.is_ascii_digit())
        || !end_str.bytes().all(|b| b.is_ascii_digit())
    {
        return ParsedHttpRange::Unsatisfiable;
    }
    if start_str.is_empty() {
        let suffix_len = match end_str.parse::<u64>() {
            Ok(v) if v > 0 => v,
            _ => return ParsedHttpRange::Unsatisfiable,
        };
        let start = total_size.saturating_sub(suffix_len);
        return ParsedHttpRange::Satisfiable {
            start,
            end: total_size - 1,
        };
    }
    let start = match start_str.parse::<u64>() {
        Ok(v) if v < total_size => v,
        _ => return ParsedHttpRange::Unsatisfiable,
    };
    if end_str.is_empty() {
        return ParsedHttpRange::Satisfiable {
            start,
            end: total_size - 1,
        };
    }
    let requested_end = match end_str.parse::<u64>() {
        Ok(v) if v >= start => v,
        _ => return ParsedHttpRange::Unsatisfiable,
    };
    ParsedHttpRange::Satisfiable {
        start,
        end: requested_end.min(total_size - 1),
    }
}

pub fn write_buffer_atomic(temp_dir: &Path, target_path: &Path, data: &[u8]) -> io::Result<()> {
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::create_dir_all(temp_dir)?;
    let tmp_name = format!(
        "v2_atomic_{}_{}.tmp",
        now_ms_i64(),
        hex::encode(random_bytes(8))
    );
    let tmp_path = temp_dir.join(tmp_name);
    {
        let mut opts = OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut file = opts.open(&tmp_path)?;
        file.write_all(data)?;
        file.sync_all()?;
    }
    if let Err(err) = fs::rename(&tmp_path, target_path) {
        // Cross-filesystem fallback
        fs::copy(&tmp_path, target_path)?;
        let _ = fs::remove_file(&tmp_path);
        if !target_path.exists() {
            return Err(err);
        }
    }
    Ok(())
}

pub fn move_temp_file_atomic(temp_path: &Path, target_path: &Path) -> io::Result<()> {
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)?;
    }
    if let Ok(file) = OpenOptions::new().read(true).write(true).open(temp_path) {
        let _ = file.sync_all();
    }
    if let Err(_) = fs::rename(temp_path, target_path) {
        fs::copy(temp_path, target_path)?;
        let _ = fs::remove_file(temp_path);
    }
    Ok(())
}

fn parse_registration_policy_from_env() -> RegistrationPolicy {
    match std::env::var("REGISTRATION_ENABLED") {
        Ok(val) => match val.trim().to_lowercase().as_str() {
            "true" | "1" | "yes" | "open" => RegistrationPolicy::Open,
            "false" | "0" | "no" | "disabled" | "never" => RegistrationPolicy::Disabled,
            "setup_token_or_invite" | "invite" | "invite_only" | "token" | "first_user_only" => {
                RegistrationPolicy::SetupTokenOrInvite
            }
            "" => {
                if std::env::var("REGISTRATION_INVITE_TOKEN")
                    .ok()
                    .map(|s| !s.trim().is_empty())
                    .unwrap_or(false)
                {
                    RegistrationPolicy::SetupTokenOrInvite
                } else {
                    RegistrationPolicy::Open
                }
            }
            _ => RegistrationPolicy::SetupTokenOrInvite,
        },
        Err(_) => {
            if std::env::var("REGISTRATION_INVITE_TOKEN")
                .ok()
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false)
            {
                RegistrationPolicy::SetupTokenOrInvite
            } else {
                RegistrationPolicy::Open
            }
        }
    }
}

fn parse_default_quota_from_env() -> i64 {
    std::env::var("DEFAULT_QUOTA_BYTES")
        .ok()
        .and_then(|v| v.trim().parse::<i64>().ok())
        .filter(|&v| v > 0)
        .unwrap_or(DEFAULT_QUOTA_BYTES)
}

#[derive(Default)]
pub struct RateBucket {
    pub count: u32,
    pub reset_at: i64,
}

#[derive(Default)]
pub struct RateLimiterState {
    pub login_buckets: HashMap<String, RateBucket>,
    pub share_ip_buckets: HashMap<String, RateBucket>,
    pub share_id_buckets: HashMap<String, RateBucket>,
}

impl RateLimiterState {
    pub fn check_bucket(
        map: &mut HashMap<String, RateBucket>,
        key: &str,
        max: u32,
        window_ms: i64,
        now: i64,
    ) -> Result<(), u64> {
        if map.len() > 2000 {
            map.retain(|_, v| now < v.reset_at);
        }
        let entry = map.entry(key.to_string()).or_insert_with(|| RateBucket {
            count: 0,
            reset_at: now + window_ms,
        });
        if now >= entry.reset_at {
            entry.count = 0;
            entry.reset_at = now + window_ms;
        }
        entry.count += 1;
        if entry.count > max {
            let secs = ((entry.reset_at - now + 999) / 1000).max(1) as u64;
            return Err(secs);
        }
        Ok(())
    }
}

pub struct SetupTokenState {
    pub active_token: Option<String>,
    pub consumed: bool,
}

pub struct ZkVaultStoreV2 {
    pub db: Mutex<Connection>,
    pub vault_v2_dir: PathBuf,
    pub temp_upload_dir: PathBuf,
    pub server_secret: [u8; 32],
    pub default_quota_bytes: i64,
    pub max_upload_bytes: u64,
    pub max_upload_chunks: u64,
    pub session_ttl_ms: i64,
    pub trash_ttl_ms: i64,
    pub upload_ttl_ms: i64,
    pub registration_policy: RegistrationPolicy,
    pub registration_invite_token: Option<String>,
    pub setup_token: Mutex<SetupTokenState>,
    pub rate_limiter: Mutex<RateLimiterState>,
}

impl ZkVaultStoreV2 {
    pub fn open(
        vault_v2_dir: PathBuf,
        temp_upload_dir: PathBuf,
        server_secret: [u8; 32],
    ) -> Result<Self, String> {
        fs::create_dir_all(&vault_v2_dir)
            .map_err(|e| format!("failed to create vault_v2 dir: {e}"))?;
        fs::create_dir_all(&temp_upload_dir)
            .map_err(|e| format!("failed to create temp_uploads dir: {e}"))?;

        let db_path = vault_v2_dir.join("index.sqlite");
        let conn = Connection::open(&db_path)
            .map_err(|e| format!("failed to open {}: {e}", db_path.display()))?;

        Self::init_schema(&conn)?;

        let user_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM users_v2", [], |row| row.get(0))
            .unwrap_or(0);

        let setup_state = if user_count == 0 {
            let token = match std::env::var("INITIAL_SETUP_TOKEN") {
                Ok(t) if t.trim().len() >= 16 => t.trim().to_string(),
                _ => random_base64url(24),
            };
            SetupTokenState {
                active_token: Some(token),
                consumed: false,
            }
        } else {
            SetupTokenState {
                active_token: None,
                consumed: true,
            }
        };

        let store = Self {
            db: Mutex::new(conn),
            vault_v2_dir,
            temp_upload_dir,
            server_secret,
            default_quota_bytes: parse_default_quota_from_env(),
            max_upload_bytes: DEFAULT_MAX_UPLOAD_BYTES,
            max_upload_chunks: DEFAULT_MAX_UPLOAD_CHUNKS,
            session_ttl_ms: DEFAULT_SESSION_TTL_MS,
            trash_ttl_ms: DEFAULT_TRASH_TTL_MS,
            upload_ttl_ms: DEFAULT_UPLOAD_TTL_MS,
            registration_policy: parse_registration_policy_from_env(),
            registration_invite_token: std::env::var("REGISTRATION_INVITE_TOKEN")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            setup_token: Mutex::new(setup_state),
            rate_limiter: Mutex::new(RateLimiterState::default()),
        };

        let now = now_ms_i64();
        store.cleanup_expired_uploads(now);
        store.purge_expired_trash(now);

        Ok(store)
    }

    fn init_schema(conn: &Connection) -> Result<(), String> {
        conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA foreign_keys = ON;
            PRAGMA busy_timeout = 5000;

            CREATE TABLE IF NOT EXISTS users_v2 (
              id TEXT PRIMARY KEY,
              username TEXT NOT NULL UNIQUE COLLATE NOCASE,
              user_salt TEXT NOT NULL,
              kdf_params TEXT NOT NULL,
              server_salt BLOB NOT NULL,
              auth_verifier BLOB NOT NULL,
              wrapped_vk TEXT NOT NULL,
              quota_bytes INTEGER NOT NULL DEFAULT 10737418240,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions_v2 (
              sid_hash BLOB PRIMARY KEY,
              user_id TEXT NOT NULL REFERENCES users_v2(id) ON DELETE CASCADE,
              csrf_token TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              expires_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS items_v2 (
              id TEXT PRIMARY KEY,
              owner_id TEXT NOT NULL REFERENCES users_v2(id) ON DELETE CASCADE,
              blob_id TEXT NOT NULL UNIQUE,
              version INTEGER NOT NULL DEFAULT 1,
              size INTEGER NOT NULL,
              sha256_hex TEXT NOT NULL,
              enc_meta TEXT NOT NULL,
              dedup_tag TEXT,
              state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'trashed')),
              trashed_at INTEGER,
              thumb_320 INTEGER NOT NULL DEFAULT 0,
              thumb_1280 INTEGER NOT NULL DEFAULT 0,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_items_v2_owner_state_created
              ON items_v2(owner_id, state, created_at DESC, id DESC);
            CREATE INDEX IF NOT EXISTS idx_items_v2_owner_dedup
              ON items_v2(owner_id, state, dedup_tag);

            CREATE TABLE IF NOT EXISTS uploads_v2 (
              upload_id TEXT PRIMARY KEY,
              owner_id TEXT NOT NULL REFERENCES users_v2(id) ON DELETE CASCADE,
              blob_id TEXT NOT NULL,
              total_size INTEGER NOT NULL,
              chunk_size INTEGER NOT NULL,
              total_chunks INTEGER NOT NULL,
              received_chunks INTEGER NOT NULL DEFAULT 0,
              received_bytes INTEGER NOT NULL DEFAULT 0,
              expected_sha256 TEXT NOT NULL,
              enc_meta TEXT NOT NULL,
              dedup_tag TEXT,
              item_id TEXT,
              temp_path TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              expires_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS albums_v2 (
              owner_id TEXT PRIMARY KEY REFERENCES users_v2(id) ON DELETE CASCADE,
              etag TEXT NOT NULL,
              size INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS shares_v2 (
              share_id TEXT PRIMARY KEY,
              owner_id TEXT NOT NULL REFERENCES users_v2(id) ON DELETE CASCADE,
              enc_share_meta TEXT,
              share_manifest TEXT,
              password_wrap TEXT,
              expires_at INTEGER,
              max_downloads INTEGER,
              download_count INTEGER NOT NULL DEFAULT 0,
              created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS share_items_v2 (
              share_id TEXT NOT NULL REFERENCES shares_v2(share_id) ON DELETE CASCADE,
              blob_id TEXT NOT NULL,
              wrapped_fk TEXT NOT NULL,
              enc_item_meta TEXT,
              PRIMARY KEY (share_id, blob_id)
            );
            "#,
        )
        .map_err(|e| format!("failed to initialize v2 sqlite schema: {e}"))?;

        let _ = conn.execute("ALTER TABLE shares_v2 ADD COLUMN share_manifest TEXT", []);
        Ok(())
    }

    pub fn active_setup_token(&self) -> Option<String> {
        let guard = self.setup_token.lock().unwrap();
        if guard.consumed {
            None
        } else {
            guard.active_token.clone()
        }
    }

    pub fn resolve_blob_path(
        &self,
        user_id: &str,
        blob_id: &str,
        suffix: &str,
    ) -> Result<PathBuf, &'static str> {
        if !is_valid_uuid_v4(user_id) {
            return Err("INVALID_USER_ID");
        }
        if !is_valid_uuid_v4(blob_id) {
            return Err("INVALID_BLOB_ID");
        }
        if !matches!(suffix, "" | ".thumb320.pczk" | ".thumb1280.pczk") {
            return Err("INVALID_BLOB_SUFFIX");
        }
        let norm_user = user_id.to_lowercase();
        let norm_blob = blob_id.to_lowercase();
        let shard = &norm_blob[0..2];
        Ok(self
            .vault_v2_dir
            .join(&norm_user)
            .join(shard)
            .join(format!("{norm_blob}{suffix}")))
    }

    pub fn resolve_albums_blob_path(&self, user_id: &str) -> Result<PathBuf, &'static str> {
        if !is_valid_uuid_v4(user_id) {
            return Err("INVALID_USER_ID");
        }
        let norm_user = user_id.to_lowercase();
        Ok(self
            .vault_v2_dir
            .join(norm_user)
            .join("albums")
            .join("albums.pczk"))
    }

    pub fn delete_blob_files_best_effort(&self, user_id: &str, blob_id: &str) {
        for suffix in ["", ".thumb320.pczk", ".thumb1280.pczk"] {
            if let Ok(path) = self.resolve_blob_path(user_id, blob_id, suffix) {
                let _ = fs::remove_file(path);
            }
        }
    }

    pub fn get_user_usage(&self, conn: &Connection, user_id: &str) -> UserUsageV2 {
        let mut usage = UserUsageV2::default();
        if let Ok(mut stmt) = conn.prepare(
            "SELECT state, COUNT(*) AS cnt, COALESCE(SUM(size), 0) AS total_bytes
             FROM items_v2 WHERE owner_id = ?1 GROUP BY state",
        ) {
            if let Ok(rows) = stmt.query_map(params![user_id], |row| {
                let state: String = row.get(0)?;
                let cnt: i64 = row.get(1)?;
                let total: i64 = row.get(2)?;
                Ok((state, cnt, total))
            }) {
                for r in rows.flatten() {
                    if r.0 == "active" {
                        usage.active_count = r.1;
                        usage.active_bytes = r.2;
                    } else if r.0 == "trashed" {
                        usage.trashed_count = r.1;
                        usage.trashed_bytes = r.2;
                    }
                }
            }
        }
        usage
    }

    pub fn cleanup_expired_uploads(&self, now_ms: i64) -> usize {
        let expired: Vec<(String, String)> = {
            let conn = self.db.lock().unwrap();
            let mut list = Vec::new();
            if let Ok(mut stmt) =
                conn.prepare("SELECT upload_id, temp_path FROM uploads_v2 WHERE expires_at <= ?1")
            {
                if let Ok(rows) = stmt.query_map(params![now_ms], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                }) {
                    for r in rows.flatten() {
                        list.push(r);
                    }
                }
            }
            let _ = conn.execute("DELETE FROM uploads_v2 WHERE expires_at <= ?1", params![now_ms]);
            list
        };

        let mut cleaned = 0;
        for (_, temp_path) in expired {
            if fs::remove_file(&temp_path).is_ok() {
                cleaned += 1;
            }
        }
        cleaned
    }

    pub fn purge_expired_trash(&self, now_ms: i64) -> usize {
        let cutoff = now_ms - self.trash_ttl_ms;
        let to_purge: Vec<(String, String, String)> = {
            let conn = self.db.lock().unwrap();
            let mut list = Vec::new();
            if let Ok(mut stmt) = conn.prepare(
                "SELECT id, owner_id, blob_id FROM items_v2
                 WHERE state = 'trashed' AND trashed_at IS NOT NULL AND trashed_at <= ?1",
            ) {
                if let Ok(rows) = stmt.query_map(params![cutoff], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                }) {
                    for r in rows.flatten() {
                        list.push(r);
                    }
                }
            }
            if !list.is_empty() {
                let _ = conn.execute("BEGIN IMMEDIATE", []);
                for (id, owner_id, blob_id) in &list {
                    let _ = conn.execute(
                        "DELETE FROM items_v2 WHERE id = ?1 AND owner_id = ?2",
                        params![id, owner_id],
                    );
                    let _ = conn.execute(
                        "DELETE FROM share_items_v2 WHERE blob_id = ?1",
                        params![blob_id],
                    );
                }
                let _ = conn.execute("COMMIT", []);
            }
            list
        };

        for (_, owner_id, blob_id) in &to_purge {
            self.delete_blob_files_best_effort(owner_id, blob_id);
        }
        to_purge.len()
    }
}

pub fn row_to_item_v2(row: &rusqlite::Row<'_>) -> rusqlite::Result<ItemRecordV2> {
    Ok(ItemRecordV2 {
        id: row.get(0)?,
        owner_id: row.get(1)?,
        blob_id: row.get(2)?,
        version: row.get(3)?,
        size: row.get(4)?,
        sha256_hex: row.get(5)?,
        enc_meta: row.get(6)?,
        dedup_tag: row.get(7)?,
        state: row.get(8)?,
        trashed_at: row.get(9)?,
        thumb_320: row.get(10)?,
        thumb_1280: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
    })
}

pub const ITEM_V2_SELECT_COLS: &str = "id, owner_id, blob_id, version, size, sha256_hex, enc_meta, dedup_tag, state, trashed_at, thumb_320, thumb_1280, created_at, updated_at";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uuid_v4_validation() {
        let id = random_uuid_v4();
        assert!(is_valid_uuid_v4(&id));
        assert!(!is_valid_uuid_v4("not-a-uuid"));
        assert!(!is_valid_uuid_v4("00000000-0000-1000-8000-000000000000")); // v1, not v4
        assert!(!is_valid_uuid_v4("../etc/passwd"));
    }

    #[test]
    fn scrypt_verify_and_fake_salt_deterministic() {
        let secret = random_bytes(32);
        let salt = random_bytes(16);
        let verifier = compute_scrypt_verifier(&secret, &salt).expect("scrypt");
        assert_eq!(verifier.len(), 32);
        assert!(verify_scrypt_constant_time(&secret, &salt, &verifier));
        let mut wrong = secret.clone();
        wrong[0] ^= 0xff;
        assert!(!verify_scrypt_constant_time(&wrong, &salt, &verifier));

        let srv_secret = [0x42u8; 32];
        let s1 = derive_fake_salt_for_username(&srv_secret, "Alice");
        let s2 = derive_fake_salt_for_username(&srv_secret, "alice");
        let s3 = derive_fake_salt_for_username(&srv_secret, "bob");
        assert_eq!(s1, s2);
        assert_ne!(s1, s3);
        assert!(decode_base64url_strict(&s1, 16).is_some());
    }

    #[test]
    fn rfc9110_range_parsing() {
        assert_eq!(parse_http_range_header(None, 100), ParsedHttpRange::None);
        assert_eq!(
            parse_http_range_header(Some("bytes=0-9"), 100),
            ParsedHttpRange::Satisfiable { start: 0, end: 9 }
        );
        assert_eq!(
            parse_http_range_header(Some("bytes=90-999"), 100),
            ParsedHttpRange::Satisfiable { start: 90, end: 99 }
        );
        assert_eq!(
            parse_http_range_header(Some("bytes=50-"), 100),
            ParsedHttpRange::Satisfiable { start: 50, end: 99 }
        );
        assert_eq!(
            parse_http_range_header(Some("bytes=-10"), 100),
            ParsedHttpRange::Satisfiable { start: 90, end: 99 }
        );
        assert_eq!(
            parse_http_range_header(Some("bytes=100-110"), 100),
            ParsedHttpRange::Unsatisfiable
        );
        assert_eq!(
            parse_http_range_header(Some("bytes=10-5"), 100),
            ParsedHttpRange::Unsatisfiable
        );
        assert_eq!(
            parse_http_range_header(Some("bytes=0-1,2-3"), 100),
            ParsedHttpRange::Unsatisfiable
        );
        assert_eq!(
            parse_http_range_header(Some("items=0-5"), 100),
            ParsedHttpRange::Unsatisfiable
        );
    }

    #[test]
    fn sqlite_store_opens_and_initializes_schema() {
        let dir = std::env::temp_dir().join(format!("pc_zk_v2_test_{}", random_uuid_v4()));
        let tmp = dir.join("tmp");
        let store = ZkVaultStoreV2::open(dir.clone(), tmp, [0x77u8; 32]).expect("open store");
        assert!(store.active_setup_token().is_some());
        let uid = random_uuid_v4();
        let bid = random_uuid_v4();
        let p = store.resolve_blob_path(&uid, &bid, "").expect("blob path");
        assert!(p.starts_with(&dir));
        let _ = fs::remove_dir_all(&dir);
    }
}
