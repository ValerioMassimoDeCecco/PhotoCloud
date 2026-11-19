use aes::Aes256;
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use cfb_mode::cipher::{AsyncStreamCipher, KeyIvInit};
use hmac::Hmac;
use rand::Rng;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Mutex;
use subtle::ConstantTimeEq;

type Aes256CfbDec = cfb_mode::Decryptor<Aes256>;

const LOWER: &[u8] = b"abcdefghijklmnopqrstuvwxyz";
const UPPER: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS: &[u8] = b"0123456789";
const PUNCT: &[u8] = b"!#$%&()*+,-./:;<=>?@[]^_{|}~";

pub const MAGIC: &[u8] = b"PhotoCloud-GCM-v1\0";
pub const GCM_OVERHEAD: usize = MAGIC.len() + 16 + 12 + 16; // 18 + 16 + 12 + 16 = 62 bytes

static DERIVED_KEY_CACHE: Mutex<Option<HashMap<String, [u8; 32]>>> = Mutex::new(None);

pub fn generate_api_key(length: usize) -> String {
    let mut rng = rand::thread_rng();
    let all_chars: Vec<u8> = [LOWER, UPPER, DIGITS, PUNCT].concat();

    loop {
        let mut key_bytes = Vec::with_capacity(length);
        for _ in 0..length {
            let idx = rng.gen_range(0..all_chars.len());
            key_bytes.push(all_chars[idx]);
        }
        let has_lower = key_bytes.iter().any(|b| LOWER.contains(b));
        let has_upper = key_bytes.iter().any(|b| UPPER.contains(b));
        let has_digit = key_bytes.iter().any(|b| DIGITS.contains(b));
        let has_punct = key_bytes.iter().any(|b| PUNCT.contains(b));

        if has_lower && has_upper && has_digit && has_punct {
            return String::from_utf8(key_bytes).unwrap();
        }
    }
}

pub fn hash_key(key: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(key.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn verify_key(key: &str, stored_hash: &str) -> bool {
    let computed_hex = hash_key(key);
    let clean_stored = stored_hash.trim().to_lowercase();
    if computed_hex.len() != clean_stored.len() {
        return false;
    }
    computed_hex.as_bytes().ct_eq(clean_stored.as_bytes()).into()
}

pub fn derive_key(key: &str, salt: &[u8]) -> [u8; 32] {
    let cache_key = format!("{}:{}", hash_key(key), hex::encode(salt));
    {
        let mut guard = DERIVED_KEY_CACHE.lock().unwrap();
        let cache = guard.get_or_insert_with(HashMap::new);
        if let Some(derived) = cache.get(&cache_key) {
            return *derived;
        }
    }

    let mut derived = [0u8; 32];
    pbkdf2::pbkdf2::<Hmac<Sha256>>(key.as_bytes(), salt, 100_000, &mut derived)
        .expect("PBKDF2 HMAC SHA-256 derivation failed");

    {
        let mut guard = DERIVED_KEY_CACHE.lock().unwrap();
        let cache = guard.get_or_insert_with(HashMap::new);
        if cache.len() >= 2048 {
            cache.clear();
        }
        cache.insert(cache_key, derived);
    }

    derived
}

pub fn encrypted_plaintext_size(data: &[u8]) -> usize {
    if data.starts_with(MAGIC) {
        data.len().saturating_sub(GCM_OVERHEAD)
    } else {
        data.len().saturating_sub(32)
    }
}

pub fn encrypt_file(file_data: &[u8], key: &str) -> Result<Vec<u8>, String> {
    let mut rng = rand::thread_rng();
    let mut salt = [0u8; 16];
    let mut iv = [0u8; 12];
    rng.fill(&mut salt);
    rng.fill(&mut iv);

    let derived = derive_key(key, &salt);
    let cipher = Aes256Gcm::new_from_slice(&derived).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(&iv);

    let ciphertext_with_tag = cipher.encrypt(nonce, file_data).map_err(|e| e.to_string())?;
    if ciphertext_with_tag.len() < 16 {
        return Err("Encryption produced invalid output".to_string());
    }

    let tag_idx = ciphertext_with_tag.len() - 16;
    let ciphertext = &ciphertext_with_tag[..tag_idx];
    let tag = &ciphertext_with_tag[tag_idx..];

    let mut out = Vec::with_capacity(MAGIC.len() + 16 + 12 + 16 + ciphertext.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&salt);
    out.extend_from_slice(&iv);
    out.extend_from_slice(tag);
    out.extend_from_slice(ciphertext);

    Ok(out)
}

pub fn decrypt_file(encrypted_data: &[u8], key: &str) -> Result<Vec<u8>, String> {
    if encrypted_data.starts_with(MAGIC) {
        if encrypted_data.len() < GCM_OVERHEAD {
            return Err("Encrypted payload too short".to_string());
        }
        let offset = MAGIC.len();
        let salt = &encrypted_data[offset..offset + 16];
        let iv = &encrypted_data[offset + 16..offset + 28];
        let tag = &encrypted_data[offset + 28..offset + 44];
        let ciphertext = &encrypted_data[offset + 44..];

        let derived = derive_key(key, salt);
        let cipher = Aes256Gcm::new_from_slice(&derived).map_err(|e| e.to_string())?;
        let nonce = Nonce::from_slice(iv);

        let mut payload = Vec::with_capacity(ciphertext.len() + 16);
        payload.extend_from_slice(ciphertext);
        payload.extend_from_slice(tag);

        cipher
            .decrypt(nonce, payload.as_ref())
            .map_err(|e| format!("Decryption failed: {e}"))
    } else {
        // Legacy AES-256-CFB format: 16B salt + 16B IV + ciphertext (full-block CFB-128)
        if encrypted_data.len() < 32 {
            return Err("Encrypted payload too short".to_string());
        }
        let salt = &encrypted_data[0..16];
        let iv = &encrypted_data[16..32];
        let ciphertext = &encrypted_data[32..];
        let derived = derive_key(key, salt);

        let mut plaintext = ciphertext.to_vec();
        let decryptor = Aes256CfbDec::new_from_slices(&derived, iv)
            .map_err(|e| format!("Invalid CFB key/iv: {e}"))?;
        decryptor.decrypt(&mut plaintext);
        Ok(plaintext)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cfb_mode::cipher::AsyncStreamCipher;

    type Aes256CfbEnc = cfb_mode::Encryptor<Aes256>;

    #[test]
    fn gcm_roundtrip_and_tamper_detection() {
        let key = "MySuperSecretKey!2026";
        let plain = b"PhotoCloud AES-256-GCM test payload with unicode \xF0\x9F\x93\xB7";
        let enc = encrypt_file(plain, key).expect("encrypt");
        assert!(enc.starts_with(MAGIC));
        assert_eq!(encrypted_plaintext_size(&enc), plain.len());

        let dec = decrypt_file(&enc, key).expect("decrypt");
        assert_eq!(dec, plain);

        let mut tampered = enc.clone();
        let last = tampered.len() - 1;
        tampered[last] ^= 0x01;
        assert!(decrypt_file(&tampered, key).is_err());
        assert!(decrypt_file(&enc, "WrongKey!2026").is_err());
    }

    #[test]
    fn legacy_aes_256_cfb_decryption_works() {
        let key = "LegacyVaultKey!99";
        let salt = [0x11u8; 16];
        let iv = [0x22u8; 16];
        let plain = b"Legacy PhotoCloud CFB-128 payload spanning more than one 16-byte AES block!";
        let derived = derive_key(key, &salt);

        let mut ct = plain.to_vec();
        let enc = Aes256CfbEnc::new_from_slices(&derived, &iv).unwrap();
        enc.encrypt(&mut ct);

        let mut legacy_blob = Vec::with_capacity(32 + ct.len());
        legacy_blob.extend_from_slice(&salt);
        legacy_blob.extend_from_slice(&iv);
        legacy_blob.extend_from_slice(&ct);

        assert_eq!(encrypted_plaintext_size(&legacy_blob), plain.len());
        let dec = decrypt_file(&legacy_blob, key).expect("legacy CFB decrypt");
        assert_eq!(dec, plain);
    }

    #[test]
    fn verify_key_constant_time() {
        let key = generate_api_key(32);
        let h = hash_key(&key);
        assert!(verify_key(&key, &h));
        assert!(verify_key(&key, &h.to_uppercase()));
        assert!(!verify_key("wrong", &h));
    }
}
