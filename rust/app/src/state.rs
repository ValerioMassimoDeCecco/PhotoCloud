use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use rand::RngCore;

use crate::zk_v2_store::ZkVaultStoreV2;

const SERVER_SECRET_FILENAME: &str = ".server-secret";

/// Reads or creates a 32-byte server-only HMAC secret used EXCLUSIVELY for
/// deterministic fake salts (anti-username-enumeration in `/api/v2/login/params`).
/// Never used for encrypting or decrypting user data.
pub fn get_or_create_server_secret(dir: &Path) -> [u8; 32] {
    let _ = fs::create_dir_all(dir);
    let secret_path = dir.join(SERVER_SECRET_FILENAME);
    if let Ok(raw) = fs::read_to_string(&secret_path) {
        if let Ok(bytes) = hex::decode(raw.trim()) {
            if bytes.len() == 32 {
                let mut out = [0u8; 32];
                out.copy_from_slice(&bytes);
                return out;
            }
        }
    }
    let mut secret = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut secret);
    let tmp_path = dir.join(format!(
        "{}.{}.tmp",
        SERVER_SECRET_FILENAME,
        std::process::id()
    ));
    let _ = fs::write(&tmp_path, hex::encode(secret));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&tmp_path, fs::Permissions::from_mode(0o600));
    }
    let _ = fs::rename(&tmp_path, &secret_path);
    secret
}

#[derive(Clone)]
pub struct AppState {
    pub temp_dir: PathBuf,
    pub zk_v2: Arc<ZkVaultStoreV2>,
}

impl Default for AppState {
    fn default() -> Self {
        let temp_dir = std::env::var("TEMP_UPLOAD_DIR")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("temp_uploads"));
        let vault_v2_dir = std::env::var("VAULT_V2_DIR")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("vault_v2"));
        let _ = fs::create_dir_all(&temp_dir);
        let _ = fs::create_dir_all(&vault_v2_dir);
        let server_secret = get_or_create_server_secret(&vault_v2_dir);
        let zk_v2 = ZkVaultStoreV2::open(vault_v2_dir, temp_dir.clone(), server_secret)
            .expect("failed to initialize Zero-Knowledge v2 vault store");
        Self {
            temp_dir,
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
