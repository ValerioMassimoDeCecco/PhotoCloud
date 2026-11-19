use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use hmac::{Hmac, Mac};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::vault::{self, WrappedSecret};

pub const SHARE_TOKEN_LEN: usize = 48;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicShareRecord {
    pub id: String,
    pub owner: String,
    pub filenames: Vec<String>,
    pub label: String,
    pub created_at: i64,
    pub expires_at: i64,
    pub password_hash: Option<String>,
    pub max_downloads: Option<i64>,
    pub download_count: i64,
    pub key_wrap: WrappedSecret,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlbumShareRecord {
    pub id: String,
    pub owner: String,
    pub album: String,
    pub participants: HashMap<String, String>,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "keyWrap")]
    pub key_wrap: WrappedSecret,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SharesFile {
    version: u32,
    shares: HashMap<String, PublicShareRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AlbumSharesFile {
    version: u32,
    shares: HashMap<String, AlbumShareRecord>,
}

pub fn is_valid_share_token(token: &str) -> bool {
    token.len() == SHARE_TOKEN_LEN
        && token.bytes().all(|b| b.is_ascii_hexdigit())
}

pub fn shares_file_path(root: &Path) -> PathBuf {
    root.join(".shares.json")
}

pub fn album_shares_file_path(root: &Path) -> PathBuf {
    root.join(".album-shares.json")
}

pub fn hash_lookup_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn load_public_shares(root: &Path) -> HashMap<String, PublicShareRecord> {
    let data: SharesFile = vault::read_json_file(
        &shares_file_path(root),
        SharesFile {
            version: 1,
            shares: HashMap::new(),
        },
    );
    data.shares
}

pub fn save_public_shares(
    root: &Path,
    shares: &HashMap<String, PublicShareRecord>,
) -> std::io::Result<()> {
    vault::write_json_atomic(
        &shares_file_path(root),
        &SharesFile {
            version: 1,
            shares: shares.clone(),
        },
    )
}

pub fn load_album_shares(root: &Path) -> HashMap<String, AlbumShareRecord> {
    let data: AlbumSharesFile = vault::read_json_file(
        &album_shares_file_path(root),
        AlbumSharesFile {
            version: 1,
            shares: HashMap::new(),
        },
    );
    data.shares
}

pub fn save_album_shares(
    root: &Path,
    shares: &HashMap<String, AlbumShareRecord>,
) -> std::io::Result<()> {
    vault::write_json_atomic(
        &album_shares_file_path(root),
        &AlbumSharesFile {
            version: 1,
            shares: shares.clone(),
        },
    )
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn random_hex(bytes: usize) -> String {
    let mut rng = rand::thread_rng();
    let mut buf = vec![0u8; bytes];
    rng.fill(&mut buf[..]);
    hex::encode(buf)
}

pub fn share_password_hash(id: &str, password: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format!("photocloud-share:{id}:{password}").as_bytes());
    hex::encode(hasher.finalize())
}

pub fn verify_share_password(record: &PublicShareRecord, password: &str) -> bool {
    match record.password_hash.as_deref() {
        None => true,
        Some(expected) => {
            let candidate = share_password_hash(&record.id, password);
            constant_time_eq(candidate.as_bytes(), expected.as_bytes())
        }
    }
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

pub fn share_unlock_cookie_value(server_secret: &[u8; 32], token: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(server_secret).expect("HMAC key");
    mac.update(format!("photocloud-share-unlock:{token}").as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

pub fn create_public_share(
    root: &Path,
    server_secret: &[u8; 32],
    owner: &str,
    owner_api_key: &str,
    filenames: Vec<String>,
    label: &str,
    expires_in_hours: i64,
    password: &str,
    max_downloads: Option<i64>,
) -> (String, PublicShareRecord) {
    let now = now_ms();
    let hours = expires_in_hours.clamp(1, 24 * 365);
    let token = random_hex(24);
    let id = hash_lookup_token(&token);
    let record = PublicShareRecord {
        id: id.clone(),
        owner: owner.to_string(),
        filenames: filenames.into_iter().take(500).collect(),
        label: label.chars().take(120).collect(),
        created_at: now,
        expires_at: now + hours * 60 * 60 * 1000,
        password_hash: if password.is_empty() {
            None
        } else {
            Some(share_password_hash(&id, password))
        },
        max_downloads: max_downloads.filter(|v| *v > 0),
        download_count: 0,
        key_wrap: vault::wrap_secret(server_secret, owner_api_key),
    };
    let mut shares = load_public_shares(root);
    shares.insert(id, record.clone());
    let _ = save_public_shares(root, &shares);
    (token, record)
}

pub enum ShareResolveError {
    Invalid,
    Expired,
    Exhausted(String, PublicShareRecord),
}

pub fn resolve_share_by_token(
    root: &Path,
    token: &str,
) -> Result<(String, PublicShareRecord), ShareResolveError> {
    if !is_valid_share_token(token) {
        return Err(ShareResolveError::Invalid);
    }
    let id = hash_lookup_token(token);
    let shares = load_public_shares(root);
    let record = match shares.get(&id) {
        Some(r) => r.clone(),
        None => return Err(ShareResolveError::Invalid),
    };
    let now = now_ms();
    if record.expires_at > 0 && record.expires_at <= now {
        return Err(ShareResolveError::Expired);
    }
    if let Some(max) = record.max_downloads {
        if record.download_count >= max {
            return Err(ShareResolveError::Exhausted(id, record));
        }
    }
    Ok((id, record))
}

pub fn increment_share_download_count(root: &Path, id: &str) -> bool {
    let mut shares = load_public_shares(root);
    let rec = match shares.get_mut(id) {
        Some(r) => r,
        None => return false,
    };
    let now = now_ms();
    if rec.expires_at > 0 && rec.expires_at <= now {
        return false;
    }
    if let Some(max) = rec.max_downloads {
        if rec.download_count >= max {
            return false;
        }
    }
    rec.download_count += 1;
    let _ = save_public_shares(root, &shares);
    true
}

pub fn upsert_album_share(
    root: &Path,
    server_secret: &[u8; 32],
    owner: &str,
    album: &str,
    owner_api_key: &str,
    username: &str,
    role: &str,
) -> AlbumShareRecord {
    let mut shares = load_album_shares(root);
    let existing_id = shares
        .values()
        .find(|s| s.owner == owner && s.album == album)
        .map(|s| s.id.clone());

    let record = match existing_id.and_then(|id| shares.get(&id).cloned()) {
        Some(mut rec) => {
            rec.participants
                .insert(username.to_string(), role.to_string());
            rec
        }
        None => {
            let mut participants = HashMap::new();
            participants.insert(username.to_string(), role.to_string());
            AlbumShareRecord {
                id: random_hex(16),
                owner: owner.to_string(),
                album: album.to_string(),
                participants,
                created_at: now_ms(),
                key_wrap: vault::wrap_secret(server_secret, owner_api_key),
            }
        }
    };
    shares.insert(record.id.clone(), record.clone());
    let _ = save_album_shares(root, &shares);
    record
}

/// Rimuove un partecipante oppure l'intera condivisione se `username` è vuoto.
/// Restituisce true se qualcosa è cambiato.
pub fn remove_album_share(root: &Path, owner: &str, album: &str, username: &str) -> bool {
    let mut shares = load_album_shares(root);
    let mut changed = false;
    let mut to_remove: Vec<String> = Vec::new();
    for (id, rec) in shares.iter_mut() {
        if rec.owner != owner || rec.album != album {
            continue;
        }
        if username.is_empty() {
            to_remove.push(id.clone());
            changed = true;
        } else if rec.participants.remove(username).is_some() {
            changed = true;
        }
    }
    for id in to_remove {
        shares.remove(&id);
    }
    if changed {
        let _ = save_album_shares(root, &shares);
    }
    changed
}

pub fn delete_album_shares_for_album(root: &Path, owner: &str, album: &str) -> usize {
    let mut shares = load_album_shares(root);
    let before = shares.len();
    shares.retain(|_, rec| !(rec.owner == owner && rec.album == album));
    let removed = before - shares.len();
    if removed > 0 {
        let _ = save_album_shares(root, &shares);
    }
    removed
}

pub fn resolve_album_share_for_user(
    root: &Path,
    share_id: &str,
    username: &str,
) -> Option<(AlbumShareRecord, String)> {
    if share_id.len() < 32 || share_id.len() > 64 {
        return None;
    }
    if !share_id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let shares = load_album_shares(root);
    let record = shares.get(share_id)?.clone();
    if record.owner == username {
        return Some((record, "owner".to_string()));
    }
    let role = record.participants.get(username)?.clone();
    Some((record, role))
}

pub fn list_album_shared_files(
    root: &Path,
    owner: &str,
    album: &str,
) -> Vec<crate::types::MediaItem> {
    let owner_folder = root.join(owner);
    let albums = crate::vault_manager::load_user_albums(root, owner);
    crate::vault_manager::list_media_files(&owner_folder, root, Some(owner))
        .into_iter()
        .filter(|m| albums.file_albums.get(&m.filename).map(|a| a == album).unwrap_or(false))
        .collect()
}

pub fn server_secret(root: &Path) -> [u8; 32] {
    vault::get_or_create_server_secret(root)
}

pub fn ensure_media_root(root: &Path) -> std::io::Result<()> {
    fs::create_dir_all(root)
}
