use std::collections::HashMap;
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::crypto;
use crate::vault;
use crate::vault_manager::is_valid_vault_filename;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HashIndexEntry {
    pub sha256: String,
    pub plaintext_size: u64,
    pub mtime_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HashIndexFile {
    pub version: u32,
    pub entries: HashMap<String, HashIndexEntry>,
}

impl Default for HashIndexFile {
    fn default() -> Self {
        Self {
            version: 1,
            entries: HashMap::new(),
        }
    }
}

pub fn normalize_sha256_hex(raw: &str) -> Option<String> {
    let clean = raw.trim().to_lowercase();
    if clean.len() == 64 && clean.bytes().all(|b| b.is_ascii_hexdigit()) {
        Some(clean)
    } else {
        None
    }
}

fn index_path(user_folder: &Path) -> std::path::PathBuf {
    user_folder.join(".hashes.json")
}

pub fn load_index(user_folder: &Path) -> HashIndexFile {
    let data: HashIndexFile = vault::read_json_file(&index_path(user_folder), HashIndexFile::default());
    let mut clean = HashMap::new();
    for (name, entry) in data.entries {
        if !is_valid_vault_filename(&name) {
            continue;
        }
        if let Some(sha) = normalize_sha256_hex(&entry.sha256) {
            clean.insert(
                name,
                HashIndexEntry {
                    sha256: sha,
                    plaintext_size: entry.plaintext_size,
                    mtime_ms: entry.mtime_ms,
                    updated_at_ms: entry.updated_at_ms,
                },
            );
        }
    }
    HashIndexFile {
        version: 1,
        entries: clean,
    }
}

pub fn save_index(user_folder: &Path, data: &HashIndexFile) -> std::io::Result<()> {
    fs::create_dir_all(user_folder)?;
    vault::write_json_atomic(&index_path(user_folder), data)
}

pub fn file_mtime_ms(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or_else(|| crate::sharing::now_ms())
}

pub fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

pub fn record_file_hash(
    user_folder: &Path,
    filename: &str,
    sha256: &str,
    plaintext_size: u64,
) -> std::io::Result<()> {
    let clean = match normalize_sha256_hex(sha256) {
        Some(v) => v,
        None => return Ok(()),
    };
    if !is_valid_vault_filename(filename) {
        return Ok(());
    }
    let mut data = load_index(user_folder);
    let mtime_ms = fs::metadata(user_folder.join(filename))
        .map(|m| file_mtime_ms(&m))
        .unwrap_or_else(|_| crate::sharing::now_ms());
    data.entries.insert(
        filename.to_string(),
        HashIndexEntry {
            sha256: clean,
            plaintext_size,
            mtime_ms,
            updated_at_ms: crate::sharing::now_ms(),
        },
    );
    save_index(user_folder, &data)
}

pub fn remove_file_hash(user_folder: &Path, filename: &str) {
    let mut data = load_index(user_folder);
    if data.entries.remove(filename).is_some() {
        let _ = save_index(user_folder, &data);
    }
}

pub fn remove_many_file_hashes(user_folder: &Path, filenames: &[String]) {
    if filenames.is_empty() {
        return;
    }
    let mut data = load_index(user_folder);
    let mut changed = false;
    for f in filenames {
        if data.entries.remove(f).is_some() {
            changed = true;
        }
    }
    if changed {
        let _ = save_index(user_folder, &data);
    }
}

/// Elenca i file attivi con hash SHA-256 del plaintext, aggiornando l'indice.
pub fn resolve_all_active_hashes(
    user_folder: &Path,
    api_key: &str,
) -> Vec<(String, String)> {
    let mut data = load_index(user_folder);
    let mut out = Vec::new();
    let mut changed = false;

    let entries = match fs::read_dir(user_folder) {
        Ok(e) => e,
        Err(_) => return out,
    };

    for entry in entries.flatten() {
        let name = match entry.file_name().to_str() {
            Some(n) => n.to_string(),
            None => continue,
        };
        if !is_valid_vault_filename(&name) {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) if m.is_file() => m,
            _ => continue,
        };
        let mtime_ms = file_mtime_ms(&meta);
        let cached = data.entries.get(&name).cloned();
        if let Some(entry) = cached {
            if (entry.mtime_ms - mtime_ms).abs() < 1 {
                out.push((name, entry.sha256));
                continue;
            }
        }
        let enc = match fs::read(entry.path()) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let plain = match crypto::decrypt_file(&enc, api_key) {
            Ok(p) => p,
            Err(_) => continue,
        };
        let sha = sha256_hex(&plain);
        data.entries.insert(
            name.clone(),
            HashIndexEntry {
                sha256: sha.clone(),
                plaintext_size: plain.len() as u64,
                mtime_ms,
                updated_at_ms: crate::sharing::now_ms(),
            },
        );
        changed = true;
        out.push((name, sha));
    }

    // Rimuove le voci di file non più attivi.
    let active: std::collections::HashSet<String> = out.iter().map(|(n, _)| n.clone()).collect();
    let before = data.entries.len();
    data.entries.retain(|k, _| active.contains(k));
    if data.entries.len() != before {
        changed = true;
    }

    if changed {
        let _ = save_index(user_folder, &data);
    }
    out
}

pub fn check_backup_items(
    user_folder: &Path,
    api_key: &str,
    wanted: &[String],
) -> (Vec<String>, usize) {
    if wanted.is_empty() {
        return (Vec::new(), 0);
    }
    let wanted_set: std::collections::HashSet<&String> = wanted.iter().collect();
    let all = resolve_all_active_hashes(user_folder, api_key);
    let mut existing = Vec::new();
    for (_, sha) in all {
        if wanted_set.contains(&sha) && !existing.contains(&sha) {
            existing.push(sha);
        }
    }
    (existing, 0)
}
