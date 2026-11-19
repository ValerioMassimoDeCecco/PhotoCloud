use std::fs;
use std::path::Path;
use crate::types::{FileCategory, MediaItem};
use crate::vault_manager;

const GALLERY_CONTENT: &str = include_str!("gallery_content.html");
const GALLERY_SCRIPTS: &str = include_str!("gallery_scripts.html");
const TRASH_CONTENT: &str = include_str!("trash_content.html");
const TRASH_SCRIPTS: &str = include_str!("trash_scripts.html");

pub fn render_with_base(styles: &str, content: &str, scripts: &str) -> String {
    let base_path = Path::new("templates/base.html");
    let mut base = fs::read_to_string(base_path).unwrap_or_default();

    base = replace_block(&base, "styles", styles);
    base = replace_block(&base, "content", content);
    base = replace_block(&base, "scripts", scripts);

    resolve_static_urls(&base)
}

pub fn render_login_template(error_message: Option<&str>) -> String {
    let login_path = Path::new("templates/login.html");
    let login = fs::read_to_string(login_path).unwrap_or_default();

    let styles = extract_block(&login, "styles");
    let mut content = extract_block(&login, "content");
    let scripts = extract_block(&login, "scripts");

    let err_html = if let Some(err) = error_message {
        format!(
            r#"<div role="alert" style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.35);color:#ef4444;padding:10px 14px;border-radius:10px;margin-bottom:14px;font-size:14px;">{}</div>"#,
            escape_html(err)
        )
    } else {
        String::new()
    };

    if content.contains("<div class=\"auth-tabs\">") {
        content = content.replace(
            "<div class=\"auth-tabs\">",
            &format!("{err_html}<div class=\"auth-tabs\">"),
        );
    } else {
        content = format!("{err_html}{content}");
    }

    render_with_base(&styles, &content, &scripts)
}

fn stat_u64(stats: &serde_json::Value, key: &str) -> u64 {
    stats.get(key).and_then(|v| v.as_u64()).unwrap_or(0)
}

fn stat_f64(stats: &serde_json::Value, key: &str) -> f64 {
    stats.get(key).and_then(|v| v.as_f64()).unwrap_or(0.0)
}

fn stat_str(stats: &serde_json::Value, key: &str) -> String {
    stats
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("0 B")
        .to_string()
}

fn category_name(category: Option<FileCategory>, is_media: bool) -> String {
    match category {
        Some(FileCategory::Media) => "media".to_string(),
        Some(FileCategory::Document) => "document".to_string(),
        Some(FileCategory::Archive) => "archive".to_string(),
        Some(FileCategory::Audio) => "audio".to_string(),
        Some(FileCategory::Code) => "code".to_string(),
        Some(FileCategory::Other) => "other".to_string(),
        None => {
            if is_media {
                "media".to_string()
            } else {
                "other".to_string()
            }
        }
    }
}

fn get_category_icon(category: &str, ext: &str) -> &'static str {
    match category {
        "document" => {
            if ext == "pdf" {
                "picture_as_pdf"
            } else {
                "description"
            }
        }
        "archive" => {
            if ext == "apk" {
                "android"
            } else {
                "folder_zip"
            }
        }
        "audio" => "audiotrack",
        "code" => "code",
        _ => "insert_drive_file",
    }
}

fn is_image_ext(ext: &str) -> bool {
    matches!(
        ext,
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "svg" | "heic" | "avif"
    )
}

fn is_video_ext(ext: &str) -> bool {
    matches!(ext, "mp4" | "mov" | "webm" | "mkv")
}

fn encode_uri_component(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for b in input.bytes() {
        let keep = b.is_ascii_alphanumeric()
            || matches!(b, b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')');
        if keep {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn file_ext(filename: &str) -> String {
    filename
        .rsplit('.')
        .next()
        .map(|e| e.to_lowercase())
        .unwrap_or_default()
}

fn render_media_card(item: &MediaItem, index: usize, favorites: &[String]) -> String {
    let file = escape_html(&item.filename);
    let ext = file_ext(&item.filename);
    let is_img = is_image_ext(&ext);
    let is_vid = is_video_ext(&ext);
    let is_media = item.is_media.unwrap_or(is_img || is_vid);
    let category = category_name(item.category, is_media);
    let album = escape_html(item.album.as_deref().unwrap_or(""));
    let size_bytes = item.size.unwrap_or(0);
    let human_size = vault_manager::format_file_size(size_bytes);
    let timestamp = item.timestamp;
    let enc_filename = encode_uri_component(&item.filename);

    let media_tag = if is_img {
        format!(
            r#"<img src="/media/{enc_filename}?preview=thumb" alt="{file}" loading="lazy" decoding="async">"#
        )
    } else if is_vid && item.has_thumb.unwrap_or(false) {
        format!(
            r#"<img src="/media/{enc_filename}?preview=thumb" alt="{file}" loading="lazy" decoding="async">
                    <div class="video-overlay"><span class="material-icons">play_circle</span></div>"#
        )
    } else if is_vid {
        let video_mime = match ext.as_str() {
            "webm" => "video/webm",
            "mov" => "video/quicktime",
            "mkv" => "video/x-matroska",
            _ => "video/mp4",
        };
        format!(
            r#"<video preload="metadata" muted playsinline>
                        <source src="/media/{enc_filename}#t=0.5" type="{video_mime}">
                    </video>
                    <div class="video-overlay"><span class="material-icons">play_circle</span></div>"#
        )
    } else {
        let icon_name = get_category_icon(&category, &ext);
        let ext_label = if ext.is_empty() {
            "FILE".to_string()
        } else {
            escape_html(&ext.to_uppercase())
        };
        let sub = if album.is_empty() {
            human_size
        } else {
            format!("{human_size} &bull; {album}")
        };
        format!(
            r#"<div class="cloud-file-preview" data-category="{category}">
                        <div class="cloud-file-icon-wrap">
                            <span class="material-icons">{icon_name}</span>
                            <span class="cloud-file-ext">{ext_label}</span>
                        </div>
                        <div class="cloud-file-meta">
                            <span class="cloud-file-title" title="{file}">{file}</span>
                            <span class="cloud-file-sub">{sub}</span>
                        </div>
                    </div>"#
        )
    };

    let album_badge = if !album.is_empty() && is_media {
        format!(
            r#"<span class="media-album-badge" title="Album: {album}"><span class="material-icons">photo_album</span>{album}</span>"#
        )
    } else {
        String::new()
    };

    let is_favorite = favorites.iter().any(|f| f == &item.filename);
    let favorite_badge = if is_media {
        let fav_class = if is_favorite { "is-favourite" } else { "" };
        let fav_title = if is_favorite {
            "Rimuovi dai Preferiti"
        } else {
            "Aggiungi ai Preferiti"
        };
        let fav_icon = if is_favorite { "star" } else { "star_border" };
        format!(
            r#"<button type="button" class="media-fav-badge {fav_class}" title="{fav_title}" aria-label="Preferito" onclick="window.toggleFavoriteFromGallery && window.toggleFavoriteFromGallery(this.closest('[data-filename]').dataset.filename, event)"><span class="material-icons">{fav_icon}</span></button>"#
        )
    } else {
        String::new()
    };

    let edit_btn = if is_img || is_vid {
        let title = if is_vid {
            "Modifica Video"
        } else {
            "Modifica Foto"
        };
        format!(
            r#"<button type="button" class="btn icon edit-photo-btn" title="{title}" aria-label="Modifica {file}" onclick="window.openPhotoEditor && window.openPhotoEditor(this.closest('[data-filename]').dataset.filename, event)">
                            <span class="material-icons">tune</span>
                        </button>"#
        )
    } else {
        String::new()
    };

    let doc_btn = if !is_media {
        format!(
            r#"<button type="button" class="btn icon open-doc-btn" title="Apri documento o file" aria-label="Apri {file}" onclick="window.openCloudFile && window.openCloudFile(this.closest('[data-filename]').dataset.filename, {size_bytes}, false, event)">
                            <span class="material-icons">open_in_new</span>
                        </button>"#
        )
    } else {
        String::new()
    };

    let wrapper_class = if is_media {
        "is-media-item"
    } else {
        "is-cloud-file"
    };
    let card_class = if is_media {
        "clickable-media"
    } else {
        "clickable-cloud-file"
    };
    let is_media_str = if is_media { "true" } else { "false" };
    let is_fav_str = if is_favorite { "true" } else { "false" };

    format!(
        r#"
        <div class="media-card-wrapper {wrapper_class}"
             data-timestamp="{timestamp}"
             data-filename="{file}"
             data-size="{size_bytes}"
             data-is-media="{is_media_str}"
             data-category="{category}"
             data-album="{album}"
             data-favorite="{is_fav_str}">
            <div class="media-card {card_class}" data-index="{index}" data-filename="{file}">
                {media_tag}
                {album_badge}
                {favorite_badge}
                <div class="media-actions">
                    {edit_btn}
                    {doc_btn}
                    <form action="/trash/{enc_filename}" method="POST" class="delete-form" data-filename="{file}">
                        <button type="submit" class="btn icon danger" title="Sposta nel Cestino" onclick="handleDelete(event, this)">
                            <span class="material-icons">delete</span>
                        </button>
                    </form>
                </div>
            </div>
            <div class="selection-overlay"></div>
            <input type="checkbox" class="media-checkbox" data-filename="{file}" onclick="event.stopPropagation();">
        </div>"#
    )
}

pub fn render_gallery_template(
    all_files: &[MediaItem],
    albums: &[String],
    trashed_files: &[MediaItem],
    favorites: &[String],
) -> String {
    let styles = r#"<link rel="stylesheet" href="/static/styles/gallery.css">"#;
    let albums_json = serde_json::to_string(albums).unwrap_or_else(|_| "[]".to_string());
    let favorites_json = serde_json::to_string(favorites).unwrap_or_else(|_| "[]".to_string());
    let filenames: Vec<String> = all_files.iter().map(|m| m.filename.clone()).collect();
    let filenames_json = serde_json::to_string(&filenames).unwrap_or_else(|_| "[]".to_string());

    let stats = vault_manager::compute_cloud_storage_stats(all_files, trashed_files);
    let active_formatted = stat_str(&stats, "activeTotalFormatted");
    let grand_total_formatted = stat_str(&stats, "grandTotalFormatted");
    let media_formatted = stat_str(&stats, "mediaFormatted");
    let files_formatted = stat_str(&stats, "filesFormatted");
    let trash_formatted = stat_str(&stats, "trashFormatted");
    let media_pct = stat_f64(&stats, "mediaPct");
    let files_pct = stat_f64(&stats, "filesPct");
    let trash_pct = stat_f64(&stats, "trashPct");
    let media_count = stat_u64(&stats, "mediaCount");
    let files_count = stat_u64(&stats, "filesCount");
    let trash_count = stat_u64(&stats, "trashCount");
    let trash_bytes = stat_u64(&stats, "trashBytes");

    let empty_html = if all_files.is_empty() {
        r#"<div class="empty-state">
            <span class="material-icons">photo_library</span>
            <h3>Il tuo archivio è vuoto</h3>
            <p>Tocca Carica nella barra fluttuante per cifrare foto, video o qualsiasi file nel Cloud.</p>
        </div>"#
            .to_string()
    } else {
        String::new()
    };

    let cards_html = all_files
        .iter()
        .enumerate()
        .map(|(index, item)| render_media_card(item, index, favorites))
        .collect::<Vec<_>>()
        .join("\n");

    let grid = format!(
        r#"    <div class="gallery-grid" data-media-files='{}'>
        {}
        {}
    </div>
"#,
        escape_html(&filenames_json),
        empty_html,
        cards_html
    );

    let mut content = GALLERY_CONTENT.to_string();
    let grid_start = content
        .find("    <div class=\"gallery-grid\"")
        .unwrap_or(0);
    let grid_end = content[grid_start..]
        .find("\n    <!-- ALBUM MODAL -->")
        .map(|idx| grid_start + idx)
        .unwrap_or(content.len());
    content.replace_range(grid_start..grid_end, &grid);

    content = content.replace("data-albums='[]'", &format!("data-albums='{}'", escape_html(&albums_json)));
    content = content.replace(
        "data-favorites='[]'",
        &format!("data-favorites='{}'", escape_html(&favorites_json)),
    );
    content = content.replace(
        "<p id=\"media-count\">0 elementi</p>",
        &format!("<p id=\"media-count\">{} elementi</p>", all_files.len()),
    );
    content = content.replace(
        "<span id=\"cloud-storage-badge-text\">Cloud: 0 B</span>",
        &format!(
            "<span id=\"cloud-storage-badge-text\">Cloud: {active_formatted}</span>"
        ),
    );
    let trash_dot_display = if trash_bytes > 0 {
        "inline-block"
    } else {
        "none"
    };
    content = content.replace(
        "id=\"cloud-storage-trash-dot\" class=\"cloud-storage-trash-dot\" style=\"display: none;\"",
        &format!(
            "id=\"cloud-storage-trash-dot\" class=\"cloud-storage-trash-dot\" style=\"display: {trash_dot_display};\""
        ),
    );
    content = content.replace(
        "<strong id=\"popover-storage-active-bytes\">0 B</strong>",
        &format!("<strong id=\"popover-storage-active-bytes\">{active_formatted}</strong>"),
    );
    content = content.replace(
        "id=\"popover-storage-grand-total-bytes\">(0 B incluso cestino)</span>",
        &format!(
            "id=\"popover-storage-grand-total-bytes\">({grand_total_formatted} incluso cestino)</span>"
        ),
    );
    content = content.replace(
        "id=\"popover-bar-media\" class=\"storage-segment segment-media\" style=\"width: 0%;\"",
        &format!(
            "id=\"popover-bar-media\" class=\"storage-segment segment-media\" style=\"width: {media_pct}%;\""
        ),
    );
    content = content.replace(
        "id=\"popover-bar-files\" class=\"storage-segment segment-files\" style=\"width: 0%;\"",
        &format!(
            "id=\"popover-bar-files\" class=\"storage-segment segment-files\" style=\"width: {files_pct}%;\""
        ),
    );
    content = content.replace(
        "id=\"popover-bar-trash\" class=\"storage-segment segment-trash\" style=\"width: 0%;\"",
        &format!(
            "id=\"popover-bar-trash\" class=\"storage-segment segment-trash\" style=\"width: {trash_pct}%;\""
        ),
    );
    content = content.replace(
        "<span id=\"popover-cat-media-count\">0</span>",
        &format!("<span id=\"popover-cat-media-count\">{media_count}</span>"),
    );
    content = content.replace(
        "<strong id=\"popover-cat-media-bytes\">0 B</strong>",
        &format!("<strong id=\"popover-cat-media-bytes\">{media_formatted}</strong>"),
    );
    content = content.replace(
        "<span id=\"popover-cat-media-pct\">0%</span>",
        &format!("<span id=\"popover-cat-media-pct\">{media_pct}%</span>"),
    );
    content = content.replace(
        "<span id=\"popover-cat-files-count\">0</span>",
        &format!("<span id=\"popover-cat-files-count\">{files_count}</span>"),
    );
    content = content.replace(
        "<strong id=\"popover-cat-files-bytes\">0 B</strong>",
        &format!("<strong id=\"popover-cat-files-bytes\">{files_formatted}</strong>"),
    );
    content = content.replace(
        "<span id=\"popover-cat-files-pct\">0%</span>",
        &format!("<span id=\"popover-cat-files-pct\">{files_pct}%</span>"),
    );
    content = content.replace(
        "<span id=\"popover-cat-trash-count\">0</span>",
        &format!("<span id=\"popover-cat-trash-count\">{trash_count}</span>"),
    );
    content = content.replace(
        "<strong id=\"popover-cat-trash-bytes\">0 B</strong>",
        &format!("<strong id=\"popover-cat-trash-bytes\">{trash_formatted}</strong>"),
    );
    content = content.replace(
        "<span id=\"popover-cat-trash-pct\">0%</span>",
        &format!("<span id=\"popover-cat-trash-pct\">{trash_pct}%</span>"),
    );

    render_with_base(styles, &content, GALLERY_SCRIPTS)
}

fn render_trash_item(item: &MediaItem) -> String {
    let file = escape_html(&item.filename);
    let ext = file_ext(&item.filename);
    let is_img = matches!(
        ext.as_str(),
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "heic"
    );
    let is_vid = is_video_ext(&ext);
    let is_media = item.is_media.unwrap_or(is_img || is_vid);
    let category = category_name(item.category, is_media);
    let size_bytes = item.size.unwrap_or(0);
    let enc_filename = encode_uri_component(&item.filename);

    let media_tag = if is_img {
        format!(
            r#"<img src="/media/{enc_filename}?from_trash=true&preview=thumb" alt="{file}" loading="lazy" decoding="async">"#
        )
    } else if is_vid {
        format!(
            r#"<video preload="metadata">
                                <source src="/media/{enc_filename}?from_trash=true#t=0.5" type="video/mp4">
                            </video>"#
        )
    } else {
        let icon_name = get_category_icon(&category, &ext);
        let ext_label = if ext.is_empty() {
            "FILE".to_string()
        } else {
            escape_html(&ext.to_uppercase())
        };
        format!(
            r#"<div class="cloud-file-preview" data-category="{category}">
                            <div class="cloud-file-icon-wrap">
                                <span class="material-icons">{icon_name}</span>
                                <span class="cloud-file-ext">{ext_label}</span>
                            </div>
                            <div class="cloud-file-meta">
                                <span class="cloud-file-title">{file}</span>
                                <span class="cloud-file-sub">{}</span>
                            </div>
                        </div>"#,
            vault_manager::format_file_size(size_bytes)
        )
    };

    format!(
        r#"
                <div class="media-card-wrapper" data-size="{size_bytes}" data-category="{category}">
                    <div class="media-card clickable-media" data-filename="{file}">
                        {media_tag}
                        <div class="media-actions">
                            <button class="btn icon restore-btn" title="Ripristina" data-filename="{file}">
                                <span class="material-icons">restore_from_trash</span>
                            </button>
                            <button class="btn icon danger permanent-delete-btn" title="Elimina Definitivamente" data-filename="{file}">
                                <span class="material-icons">delete_forever</span>
                            </button>
                        </div>
                    </div>
                </div>"#
    )
}

pub fn render_trash_template(
    trashed_files: &[MediaItem],
    active_files: &[MediaItem],
) -> String {
    let styles = r#"<link rel="stylesheet" href="/static/styles/gallery.css">"#;
    let stats = vault_manager::compute_cloud_storage_stats(active_files, trashed_files);
    let active_formatted = stat_str(&stats, "activeTotalFormatted");
    let trash_formatted = stat_str(&stats, "trashFormatted");
    let grand_total_formatted = stat_str(&stats, "grandTotalFormatted");
    let media_pct = stat_f64(&stats, "mediaPercent");
    let files_pct = stat_f64(&stats, "filesPercent");
    let trash_pct = stat_f64(&stats, "trashPercent");
    let trash_count = stat_u64(&stats, "trashCount");
    let trash_bytes = stat_u64(&stats, "trashBytes");
    let active_bytes = stat_u64(&stats, "activeTotalBytes");

    let empty_btn_html = if !trashed_files.is_empty() {
        r#"<button class="btn danger" id="empty-trash-btn">
                    <span class="material-icons">delete_sweep</span>
                    Svuota Cestino
                </button>"#
            .to_string()
    } else {
        String::new()
    };

    let header_controls = format!(
        r#"            <div class="header-top-controls">
                <div class="cloud-storage-badge" id="cloud-storage-header-badge" title="Memoria usata totale del Cloud">
                    <span class="material-icons cloud-storage-icon">cloud_done</span>
                    <span class="cloud-storage-badge-label">Cloud: <strong id="cloud-storage-badge-text">{active_formatted}</strong></span>
                </div>
                {empty_btn_html}
            </div>"#
    );

    let trash_banner_html = if !trashed_files.is_empty() {
        format!(
            r#"<div class="trash-storage-banner" id="trash-recoverable-storage-banner" data-trash-bytes="{trash_bytes}" data-active-bytes="{active_bytes}">
            <div class="trash-storage-banner-info">
                <div class="trash-storage-banner-icon">
                    <span class="material-icons">restore_from_trash</span>
                </div>
                <div class="trash-storage-banner-text">
                    <strong>Spazio recuperabile nel Cestino: <span id="trash-banner-size">{trash_formatted}</span></strong>
                    <span><span id="trash-banner-count">{trash_count}</span> elementi ({trash_pct}% della memoria totale Cloud: {grand_total_formatted})</span>
                </div>
            </div>
            <div class="trash-storage-banner-bar-wrap">
                <div class="cloud-storage-segmented-bar">
                    <div class="storage-segment segment-media" style="width: {media_pct}%"></div>
                    <div class="storage-segment segment-files" style="width: {files_pct}%"></div>
                    <div class="storage-segment segment-trash" style="width: {trash_pct}%"></div>
                </div>
            </div>
        </div>"#
        )
    } else {
        String::new()
    };

    let items_html = if trashed_files.is_empty() {
        r#"<div class="empty-state">
                    <span class="material-icons">delete_sweep</span>
                    <h3>Il cestino è vuoto</h3>
                    <p>I file eliminati appariranno qui.</p>
                </div>"#
            .to_string()
    } else {
        trashed_files
            .iter()
            .map(render_trash_item)
            .collect::<Vec<_>>()
            .join("\n")
    };

    let grid = format!(
        r#"    <div class="gallery-grid">
        {trash_banner_html}
        <div class="media-group">
             <div class="media-group-grid">
                {items_html}
            </div>
        </div>
    </div>
"#
    );

    let mut content = TRASH_CONTENT.to_string();
    let grid_start = content.find("    <div class=\"gallery-grid\">").unwrap_or(0);
    let grid_end = content[grid_start..]
        .find("\n    <div class=\"m3-floating-bar-wrapper\">")
        .map(|idx| grid_start + idx)
        .unwrap_or(content.len());
    content.replace_range(grid_start..grid_end, &grid);

    let header_start = content
        .find("            <div class=\"header-top-controls\">")
        .unwrap_or(0);
    let header_end = content[header_start..]
        .find("\n            </div>")
        .map(|idx| header_start + idx + "\n            </div>".len())
        .unwrap_or(content.len());
    content.replace_range(header_start..header_end, &header_controls);

    content = content.replace(
        "<p id=\"media-count\">0 elementi</p>",
        &format!(
            "<p id=\"media-count\">{} elementi</p>",
            trashed_files.len()
        ),
    );

    render_with_base(styles, &content, TRASH_SCRIPTS)
}

pub fn resolve_static_urls(src: &str) -> String {
    let mut out = String::with_capacity(src.len());
    let mut remaining = src;
    let pattern = "{{ url_for('static', filename='";
    let end_pattern = "') }}";

    while let Some(start) = remaining.find(pattern) {
        out.push_str(&remaining[..start]);
        let filename_start = start + pattern.len();
        if let Some(end) = remaining[filename_start..].find(end_pattern) {
            let filename = &remaining[filename_start..filename_start + end];
            out.push_str("/static/");
            out.push_str(filename);
            remaining = &remaining[filename_start + end + end_pattern.len()..];
        } else {
            out.push_str(pattern);
            remaining = &remaining[filename_start..];
        }
    }
    out.push_str(remaining);
    out
}

pub fn extract_block(src: &str, name: &str) -> String {
    let open = format!("{{% block {name} %}}");
    let close = "{% endblock %}";
    if let Some(start) = src.find(&open) {
        let content_start = start + open.len();
        if let Some(end) = src[content_start..].find(close) {
            return src[content_start..content_start + end].to_string();
        }
    }
    String::new()
}

pub fn replace_block(src: &str, name: &str, replacement: &str) -> String {
    let pattern = format!("{{% block {name} %}}");
    let close = "{% endblock %}";
    if let Some(start) = src.find(&pattern) {
        let content_start = start + pattern.len();
        if let Some(end) = src[content_start..].find(close) {
            let close_end = content_start + end + close.len();
            let mut res = String::new();
            res.push_str(&src[..start]);
            res.push_str(replacement);
            res.push_str(&src[close_end..]);
            return res;
        }
    }
    src.to_string()
}

pub fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
