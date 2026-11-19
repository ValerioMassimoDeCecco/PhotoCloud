use std::fs;
use std::path::Path;
use crate::types::MediaItem;

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

pub fn render_gallery_template(
    all_files: &[MediaItem],
    albums: &[String],
    _trashed_files: &[MediaItem],
    favorites: &[String],
) -> String {
    let styles = r#"<link rel="stylesheet" href="/static/styles/gallery.css">"#;
    let albums_json = serde_json::to_string(albums).unwrap_or_default();
    let favorites_json = serde_json::to_string(favorites).unwrap_or_default();

    let content = format!(
        r#"
<div class="gallery-container" data-albums='{}' data-favorites='{}'>
    <header class="gallery-header">
        <div class="header-content">
            <div class="header-title-group">
                <h1 id="main-view-title">Il tuo archivio</h1>
                <p id="media-count">{} elementi</p>
            </div>
        </div>
    </header>
    <main class="gallery-grid" id="gallery-grid">
    </main>
</div>
"#,
        escape_html(&albums_json),
        escape_html(&favorites_json),
        all_files.len()
    );

    let scripts = r#"<script src="/static/scripts/gallery.js"></script>"#;
    render_with_base(styles, &content, scripts)
}

pub fn render_trash_template(
    trashed_files: &[MediaItem],
    _active_files: &[MediaItem],
) -> String {
    let styles = r#"<link rel="stylesheet" href="/static/styles/gallery.css">"#;
    let content = format!(
        r#"
<div class="gallery-container">
    <header class="gallery-header">
        <div class="header-content">
            <div class="header-title-group">
                <h1>Cestino</h1>
                <p id="media-count">{} elementi</p>
            </div>
        </div>
    </header>
    <main class="gallery-grid" id="trash-grid">
    </main>
</div>
"#,
        trashed_files.len()
    );
    let scripts = r#"<script src="/static/scripts/trash.js"></script>"#;
    render_with_base(styles, &content, scripts)
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
