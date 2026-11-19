use chrono::{Datelike, TimeZone, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NaturalQuery {
    pub text_tokens: Vec<String>,
    pub years: Vec<i32>,
    pub months: Vec<u32>,
    pub days: Vec<u32>,
    pub date_from: Option<i64>,
    pub date_to: Option<i64>,
    pub media_type: Option<String>,
    pub favorites_only: bool,
    pub albums: Vec<String>,
    pub explanation: Vec<String>,
}

pub fn parse_natural_query(raw_query: &str) -> NaturalQuery {
    let raw = raw_query.to_lowercase();
    let mut q = NaturalQuery {
        text_tokens: Vec::new(),
        years: Vec::new(),
        months: Vec::new(),
        days: Vec::new(),
        date_from: None,
        date_to: None,
        media_type: None,
        favorites_only: false,
        albums: Vec::new(),
        explanation: Vec::new(),
    };

    if raw.trim().is_empty() {
        return q;
    }

    if raw.contains("preferit") || raw.contains("favorite") {
        q.favorites_only = true;
        q.explanation.push("preferiti".to_string());
    }

    if raw.contains("video") {
        q.media_type = Some("video".to_string());
        q.explanation.push("video".to_string());
    } else if raw.contains("foto") || raw.contains("photo") || raw.contains("immagin") {
        q.media_type = Some("photo".to_string());
        q.explanation.push("foto".to_string());
    }

    let tokens: Vec<String> = raw
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| !s.is_empty() && s.len() > 1)
        .map(|s| s.to_string())
        .collect();

    for t in &tokens {
        if let Ok(y) = t.parse::<i32>() {
            if (1990..=2050).contains(&y) {
                q.years.push(y);
            }
        } else if !["foto", "video", "preferiti", "favorites"].contains(&t.as_str()) {
            q.text_tokens.push(t.clone());
        }
    }

    q
}

pub fn media_item_matches_query(
    filename: &str,
    timestamp: i64,
    album: Option<&str>,
    is_favorite: bool,
    q: &NaturalQuery,
) -> bool {
    if q.favorites_only && !is_favorite {
        return false;
    }

    if let (Some(from), Some(to)) = (q.date_from, q.date_to) {
        if timestamp < from || timestamp > to {
            return false;
        }
    }

    if !q.years.is_empty() {
        if let Some(dt) = Utc.timestamp_opt(timestamp, 0).single() {
            if !q.years.contains(&dt.year()) {
                return false;
            }
        }
    }

    for token in &q.text_tokens {
        let in_file = filename.to_lowercase().contains(token);
        let in_album = album.map(|a| a.to_lowercase().contains(token)).unwrap_or(false);
        if !in_file && !in_album {
            return false;
        }
    }

    true
}
