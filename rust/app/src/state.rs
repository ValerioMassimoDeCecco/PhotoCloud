use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

#[derive(Clone)]
pub struct SessionData {
    pub username: String,
    pub api_key: String,
    pub expires_at: u64,
}

#[derive(Clone)]
pub struct AppState {
    pub sessions: Arc<RwLock<HashMap<String, SessionData>>>,
    pub upload_dir: PathBuf,
    pub users_file: PathBuf,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            upload_dir: PathBuf::from("user_media"),
            users_file: PathBuf::from("users.txt"),
        }
    }
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
