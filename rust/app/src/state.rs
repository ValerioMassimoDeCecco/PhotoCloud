use std::collections::{HashMap, HashSet};
use std::fs;
use std::io;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use crate::vault;
use crate::zk_v2_store::ZkVaultStoreV2;

#[derive(Clone)]
pub struct SessionData {
    pub username: String,
    pub api_key: String,
    pub expires_at: u64,
}

#[derive(Clone)]
pub struct SharePlaybackGrant {
    pub granted_at: u64,
    pub bytes_used: usize,
    pub max_bytes: usize,
}

#[derive(Clone)]
pub struct ZipTask {
    pub owner: String,
    pub status: String,
    pub progress: u32,
    pub filename: Option<String>,
    pub total_bytes: u64,
    pub processed_bytes: u64,
    pub error: Option<String>,
    pub zip_path: Option<PathBuf>,
    pub created_at: u64,
}

#[derive(Clone)]
pub struct ChunkedUpload {
    pub owner: String,
    pub filename: String,
    pub total_size: u64,
    pub chunk_size_bytes: u64,
    pub expected_total_chunks: u64,
    pub received_chunks: HashSet<u64>,
    pub temp_part_path: PathBuf,
    pub timestamp_ms: Option<u64>,
    pub album: String,
    pub expected_sha256: Option<String>,
    pub is_auto_backup: bool,
    pub expires_at: u64,
}

#[derive(Clone)]
pub struct AppState {
    pub sessions: Arc<RwLock<HashMap<String, SessionData>>>,
    pub upload_dir: PathBuf,
    pub users_file: PathBuf,
    pub temp_dir: PathBuf,
    pub zip_tasks: Arc<RwLock<HashMap<String, ZipTask>>>,
    pub chunked_uploads: Arc<RwLock<HashMap<String, ChunkedUpload>>>,
    pub share_playback_grants: Arc<RwLock<HashMap<String, SharePlaybackGrant>>>,
    pub zk_v2: Arc<ZkVaultStoreV2>,
}

impl Default for AppState {
    fn default() -> Self {
        let upload_dir = PathBuf::from("user_media");
        let temp_dir = PathBuf::from("temp_uploads");
        let vault_v2_dir = std::env::var("VAULT_V2_DIR")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("vault_v2"));
        let _ = fs::create_dir_all(&upload_dir);
        let _ = fs::create_dir_all(&temp_dir);
        let server_secret = vault::get_or_create_server_secret(&upload_dir);
        let zk_v2 = ZkVaultStoreV2::open(vault_v2_dir, temp_dir.clone(), server_secret)
            .expect("failed to initialize Zero-Knowledge v2 vault store");
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            upload_dir,
            users_file: PathBuf::from("users.txt"),
            temp_dir,
            zip_tasks: Arc::new(RwLock::new(HashMap::new())),
            chunked_uploads: Arc::new(RwLock::new(HashMap::new())),
            share_playback_grants: Arc::new(RwLock::new(HashMap::new())),
            zk_v2: Arc::new(zk_v2),
        }
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn random_uuid_v4() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let mut bytes = [0u8; 16];
    rng.fill(&mut bytes[..]);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex = hex::encode(bytes);
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

impl AppState {
    pub fn find_user(&self, username: &str) -> Option<String> {
        if !self.users_file.exists() {
            return None;
        }
        let content = fs::read_to_string(&self.users_file).ok()?;
        for line in content.lines() {
            if let Some((user, hash)) = line.split_once(':') {
                if user.trim() == username {
                    return Some(hash.trim().to_string());
                }
            }
        }
        None
    }

    pub fn save_user(&self, username: &str, key_hash: &str) -> io::Result<()> {
        let mut content = if self.users_file.exists() {
            fs::read_to_string(&self.users_file)?
        } else {
            String::new()
        };
        if !content.is_empty() && !content.ends_with('\n') {
            content.push('\n');
        }
        content.push_str(&format!("{}:{}\n", username, key_hash));

        let tmp = format!("{}.{}.tmp", self.users_file.display(), std::process::id());
        fs::write(&tmp, content)?;
        fs::rename(tmp, &self.users_file)
    }

    pub fn get_session(&self, headers: &axum::http::HeaderMap) -> Option<SessionData> {
        let sid = extract_session_id(headers)?;
        let sessions = self.sessions.read().ok()?;
        if let Some(sess) = sessions.get(&sid) {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::SystemTime::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;
            if sess.expires_at > now {
                return Some(sess.clone());
            }
        }
        None
    }
}

pub fn extract_session_id(headers: &axum::http::HeaderMap) -> Option<String> {
    if let Some(cookie) = headers.get(axum::http::header::COOKIE) {
        if let Ok(cookie_str) = cookie.to_str() {
            for part in cookie_str.split(';') {
                let trimmed = part.trim();
                if let Some((k, v)) = trimmed.split_once('=') {
                    if k.trim() == "photocloud_sid" {
                        let sid = v.trim();
                        if is_valid_uuid(sid) {
                            return Some(sid.to_string());
                        }
                    }
                }
            }
        }
    }
    if let Some(h) = headers.get("x-session-id") {
        if let Ok(sid) = h.to_str() {
            let sid = sid.trim();
            if is_valid_uuid(sid) {
                return Some(sid.to_string());
            }
        }
    }
    None
}

pub fn is_valid_uuid(s: &str) -> bool {
    if s.len() != 36 {
        return false;
    }
    let b = s.as_bytes();
    if b[8] != b'-' || b[13] != b'-' || b[18] != b'-' || b[23] != b'-' {
        return false;
    }
    s.chars().enumerate().all(|(i, c)| {
        if i == 8 || i == 13 || i == 18 || i == 23 {
            true
        } else {
            c.is_ascii_hexdigit()
        }
    })
}
