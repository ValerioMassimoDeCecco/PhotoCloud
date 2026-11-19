use std::fs;
use std::path::Path;
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use rand::Rng;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::Sha256;
use hkdf::Hkdf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WrappedSecret {
    pub v: u32,
    pub salt: String,
    pub iv: String,
    pub tag: String,
    pub ct: String,
}

pub fn read_json_file<T: DeserializeOwned>(path: &Path, fallback: T) -> T {
    if !path.exists() {
        return fallback;
    }
    match fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or(fallback),
        Err(_) => fallback,
    }
}

pub fn write_json_atomic<T: Serialize>(path: &Path, data: &T) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut rng = rand::thread_rng();
    let rand_suffix: u32 = rng.r#gen();
    let tmp_path = format!("{}.{}.{rand_suffix:08x}.tmp", path.display(), std::process::id());
    let json_bytes = serde_json::to_vec_pretty(data)?;
    fs::write(&tmp_path, json_bytes)?;
    fs::rename(&tmp_path, path)
}

pub fn get_or_create_server_secret(storage_dir: &Path) -> [u8; 32] {
    let secret_path = storage_dir.join(".server-secret");
    if secret_path.exists() {
        if let Ok(raw) = fs::read_to_string(&secret_path) {
            let clean = raw.trim();
            if clean.len() == 64 {
                if let Ok(bytes) = hex::decode(clean) {
                    let mut secret = [0u8; 32];
                    secret.copy_from_slice(&bytes[..32]);
                    return secret;
                }
            }
        }
    }

    let mut rng = rand::thread_rng();
    let mut secret = [0u8; 32];
    rng.fill(&mut secret);
    let _ = fs::create_dir_all(storage_dir);
    let hex_secret = hex::encode(secret);
    let _ = fs::write(&secret_path, hex_secret);
    secret
}

fn derive_wrap_key(server_secret: &[u8; 32], salt: &[u8]) -> [u8; 32] {
    let hk = Hkdf::<Sha256>::new(Some(salt), server_secret);
    let mut okm = [0u8; 32];
    hk.expand(b"photocloud-share-key-wrap-v1", &mut okm)
        .expect("HKDF expand failed");
    okm
}

pub fn wrap_secret(server_secret: &[u8; 32], plaintext: &str) -> WrappedSecret {
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine;

    let mut rng = rand::thread_rng();
    let mut salt = [0u8; 16];
    let mut iv = [0u8; 12];
    rng.fill(&mut salt);
    rng.fill(&mut iv);

    let key = derive_wrap_key(server_secret, &salt);
    let cipher = Aes256Gcm::new_from_slice(&key).unwrap();
    let nonce = Nonce::from_slice(&iv);

    let ct_with_tag = cipher.encrypt(nonce, plaintext.as_bytes()).unwrap();
    let tag_idx = ct_with_tag.len() - 16;
    let ct = &ct_with_tag[..tag_idx];
    let tag = &ct_with_tag[tag_idx..];

    WrappedSecret {
        v: 1,
        salt: B64.encode(salt),
        iv: B64.encode(iv),
        tag: B64.encode(tag),
        ct: B64.encode(ct),
    }
}

pub fn unwrap_secret(server_secret: &[u8; 32], wrapped: &WrappedSecret) -> Option<String> {
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine;

    let salt = B64.decode(&wrapped.salt).ok()?;
    let iv = B64.decode(&wrapped.iv).ok()?;
    let tag = B64.decode(&wrapped.tag).ok()?;
    let ct = B64.decode(&wrapped.ct).ok()?;

    if iv.len() != 12 || tag.len() != 16 {
        return None;
    }

    let key = derive_wrap_key(server_secret, &salt);
    let cipher = Aes256Gcm::new_from_slice(&key).ok()?;
    let nonce = Nonce::from_slice(&iv);

    let mut payload = Vec::with_capacity(ct.len() + 16);
    payload.extend_from_slice(&ct);
    payload.extend_from_slice(&tag);

    let plaintext_bytes = cipher.decrypt(nonce, payload.as_ref()).ok()?;
    String::from_utf8(plaintext_bytes).ok()
}
