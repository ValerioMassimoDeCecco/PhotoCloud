use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};

use crate::crypto;

pub const THUMB_MAX_BYTES: u64 = 256 * 1024 * 1024;

pub fn is_raster_image_filename(filename: &str) -> bool {
    let lower = filename.to_lowercase();
    [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"]
        .iter()
        .any(|ext| lower.ends_with(ext))
}

fn thumb_root(user_folder: &Path) -> PathBuf {
    user_folder.join(".thumbs")
}

fn variant_dir(user_folder: &Path, variant: &str) -> PathBuf {
    thumb_root(user_folder).join(variant)
}

pub fn variant_path(user_folder: &Path, filename: &str, variant: &str) -> PathBuf {
    variant_dir(user_folder, variant).join(format!("{filename}.jpg"))
}

pub fn invalidate_file(user_folder: &Path, filename: &str) {
    for variant in ["thumb", "large"] {
        let p = variant_path(user_folder, filename, variant);
        if p.exists() {
            let _ = fs::remove_file(p);
        }
    }
}

pub fn clear_user_thumbnails(user_folder: &Path) {
    let root = thumb_root(user_folder);
    if root.exists() {
        let _ = fs::remove_dir_all(root);
    }
}

fn decode_cached(path: &Path, api_key: &str) -> Option<Vec<u8>> {
    let enc = fs::read(path).ok()?;
    crypto::decrypt_file(&enc, api_key).ok()
}

fn write_encrypted(path: &Path, bytes: &[u8], api_key: &str) -> bool {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    match crypto::encrypt_file(bytes, api_key) {
        Ok(enc) => fs::write(path, enc).is_ok(),
        Err(_) => false,
    }
}

fn max_dim_for(variant: &str) -> u32 {
    if variant == "large" { 1600 } else { 480 }
}

fn quality_for(variant: &str) -> u8 {
    if variant == "large" { 78 } else { 72 }
}

/// Genera (o recupera dalla cache) una miniatura JPEG del file indicato.
pub fn get_or_create_thumbnail(
    user_folder: &Path,
    filename: &str,
    variant: &str,
    api_key: &str,
) -> Option<Vec<u8>> {
    let variant = if variant == "large" { "large" } else { "thumb" };
    if !is_raster_image_filename(filename) {
        return None;
    }
    let path = variant_path(user_folder, filename, variant);
    if let Some(bytes) = decode_cached(&path, api_key) {
        return Some(bytes);
    }
    let source_path = user_folder.join(filename);
    if !source_path.exists() {
        return None;
    }
    let enc = fs::read(&source_path).ok()?;
    let plain = crypto::decrypt_file(&enc, api_key).ok()?;
    let img = image::load_from_memory(&plain).ok()?;
    let max_dim = max_dim_for(variant);
    let (w, h) = (img.width(), img.height());
    let resized = if w.max(h) > max_dim {
        let scale = max_dim as f64 / w.max(h) as f64;
        let nw = ((w as f64 * scale).round() as u32).max(1);
        let nh = ((h as f64 * scale).round() as u32).max(1);
        img.resize(nw, nh, image::imageops::FilterType::Triangle)
    } else {
        img
    };
    let rgb = resized.to_rgb8();
    let mut out = Vec::new();
    {
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(
            Cursor::new(&mut out),
            quality_for(variant),
        );
        if encoder.encode_image(&rgb).is_err() {
            return None;
        }
    }
    let _ = write_encrypted(&path, &out, api_key);
    Some(out)
}

/// Salva una miniatura JPEG fornita dal client (già renderizzata).
pub fn put_client_thumbnail(
    user_folder: &Path,
    filename: &str,
    bytes: &[u8],
    api_key: &str,
    variant: &str,
) -> Result<u64, &'static str> {
    if !user_folder.join(filename).exists() {
        return Err("SOURCE_NOT_FOUND");
    }
    if bytes.len() > 1024 * 1024 {
        return Err("THUMBNAIL_TOO_LARGE");
    }
    if !bytes.starts_with(&[0xff, 0xd8]) {
        return Err("INVALID_JPEG");
    }
    let variant = if variant == "large" { "large" } else { "thumb" };
    let path = variant_path(user_folder, filename, variant);
    if !write_encrypted(&path, bytes, api_key) {
        return Err("WRITE_FAILED");
    }
    Ok(bytes.len() as u64)
}

pub struct ThumbStats {
    pub disk_bytes: u64,
    pub total_entries: u64,
    pub thumb_count: u64,
    pub large_count: u64,
    pub negative_entries: u64,
    pub queue_pending: u64,
    pub max_bytes: u64,
}

pub fn get_user_stats(user_folder: &Path) -> ThumbStats {
    let mut disk_bytes = 0u64;
    let mut total_entries = 0u64;
    let mut thumb_count = 0u64;
    let mut large_count = 0u64;
    let root = thumb_root(user_folder);
    if let Ok(entries) = fs::read_dir(&root) {
        for entry in entries.flatten() {
            let path = entry.path();
            let is_large = path
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| n == "large")
                .unwrap_or(false);
            if path.is_dir() {
                if let Ok(inner) = fs::read_dir(&path) {
                    for f in inner.flatten() {
                        if let Ok(meta) = f.metadata() {
                            if meta.is_file() {
                                disk_bytes += meta.len();
                                total_entries += 1;
                                if is_large {
                                    large_count += 1;
                                } else {
                                    thumb_count += 1;
                                }
                            }
                        }
                    }
                }
            } else if let Ok(meta) = path.metadata() {
                if meta.is_file() {
                    disk_bytes += meta.len();
                    total_entries += 1;
                    thumb_count += 1;
                }
            }
        }
    }
    ThumbStats {
        disk_bytes,
        total_entries,
        thumb_count,
        large_count,
        negative_entries: 0,
        queue_pending: 0,
        max_bytes: THUMB_MAX_BYTES,
    }
}

pub struct RebuildResult {
    pub queued_count: u64,
    pub total_active_images: u64,
}

pub fn rebuild_user_thumbnails(
    user_folder: &Path,
    api_key: &str,
    active_filenames: &[String],
    force: bool,
) -> RebuildResult {
    if force {
        clear_user_thumbnails(user_folder);
    }
    let images: Vec<&String> = active_filenames
        .iter()
        .filter(|f| is_raster_image_filename(f))
        .collect();
    let mut queued = 0u64;
    for filename in &images {
        for variant in ["thumb", "large"] {
            let path = variant_path(user_folder, filename, variant);
            if !path.exists() {
                if get_or_create_thumbnail(user_folder, filename, variant, api_key).is_some() {
                    queued += 1;
                }
            }
        }
    }
    RebuildResult {
        queued_count: queued,
        total_active_images: images.len() as u64,
    }
}
