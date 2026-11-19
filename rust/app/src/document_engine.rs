use std::io::{Cursor, Read};

use serde_json::{json, Value};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ViewerMode {
    Pdf,
    Word,
    Spreadsheet,
    Presentation,
    Text,
    Image,
    Video,
    Audio,
    External,
}

impl ViewerMode {
    fn as_str(self) -> &'static str {
        match self {
            ViewerMode::Pdf => "pdf",
            ViewerMode::Word => "word",
            ViewerMode::Spreadsheet => "spreadsheet",
            ViewerMode::Presentation => "presentation",
            ViewerMode::Text => "text",
            ViewerMode::Image => "image",
            ViewerMode::Video => "video",
            ViewerMode::Audio => "audio",
            ViewerMode::External => "external",
        }
    }
}

pub struct ViewerSpec {
    pub extension: String,
    pub mime_type: String,
    pub viewer_mode: ViewerMode,
    pub can_preview: bool,
    pub format_label: String,
}

fn mime_for_ext(ext: &str) -> &'static str {
    match ext {
        "pdf" => "application/pdf",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "odt" => "application/vnd.oasis.opendocument.text",
        "rtf" => "application/rtf",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ods" => "application/vnd.oasis.opendocument.spreadsheet",
        "csv" => "text/csv; charset=utf-8",
        "tsv" => "text/tab-separated-values; charset=utf-8",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "odp" => "application/vnd.oasis.opendocument.presentation",
        "txt" | "ts" | "tsx" | "jsx" | "py" | "kt" | "java" | "c" | "cpp" | "h" | "sh"
        | "sql" | "ini" | "conf" | "log" => "text/plain; charset=utf-8",
        "md" => "text/markdown; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "xml" => "application/xml; charset=utf-8",
        "yaml" | "yml" => "text/yaml; charset=utf-8",
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "heic" => "image/heic",
        "heif" => "image/heif",
        "avif" => "image/avif",
        "mp4" | "mov" => "video/mp4",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        "aac" => "audio/aac",
        "m4a" => "audio/mp4",
        "opus" => "audio/opus",
        "zip" => "application/zip",
        "rar" => "application/vnd.rar",
        "7z" => "application/x-7z-compressed",
        "tar" => "application/x-tar",
        "gz" => "application/gzip",
        "apk" => "application/vnd.android.package-archive",
        "iso" => "application/x-iso9660-image",
        _ => "application/octet-stream",
    }
}

pub fn resolve_viewer_spec(filename: &str) -> ViewerSpec {
    let ext = filename
        .rsplit_once('.')
        .map(|(_, e)| e.to_lowercase())
        .unwrap_or_default();
    let mime = mime_for_ext(&ext).to_string();
    let make = |mode: ViewerMode, label: String| ViewerSpec {
        extension: if ext.is_empty() { "bin".to_string() } else { ext.clone() },
        mime_type: mime.clone(),
        viewer_mode: mode,
        can_preview: mode != ViewerMode::External,
        format_label: label,
    };
    match ext.as_str() {
        "pdf" => make(ViewerMode::Pdf, "Documento PDF".to_string()),
        "doc" | "docx" | "odt" | "rtf" => make(
            ViewerMode::Word,
            format!("Documento Word (.{})", ext.to_uppercase()),
        ),
        "xls" | "xlsx" | "ods" | "csv" | "tsv" => make(
            ViewerMode::Spreadsheet,
            format!("Foglio di Calcolo (.{})", ext.to_uppercase()),
        ),
        "ppt" | "pptx" | "odp" => make(
            ViewerMode::Presentation,
            format!("Presentazione (.{})", ext.to_uppercase()),
        ),
        "txt" | "md" | "json" | "xml" | "yaml" | "yml" | "html" | "htm" | "css" | "js"
        | "ts" | "tsx" | "jsx" | "py" | "kt" | "java" | "c" | "cpp" | "h" | "sh" | "sql"
        | "ini" | "conf" | "log" => make(
            ViewerMode::Text,
            format!("Testo / Codice (.{})", ext.to_uppercase()),
        ),
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "svg" | "heic" | "heif" | "avif" => {
            make(ViewerMode::Image, format!("Immagine (.{})", ext.to_uppercase()))
        }
        "mp4" | "mov" | "webm" | "mkv" | "avi" => make(
            ViewerMode::Video,
            format!("Video (.{})", ext.to_uppercase()),
        ),
        "mp3" | "wav" | "ogg" | "flac" | "aac" | "m4a" | "opus" => make(
            ViewerMode::Audio,
            format!("Audio (.{})", ext.to_uppercase()),
        ),
        _ => make(
            ViewerMode::External,
            if ext.is_empty() {
                "File Binario".to_string()
            } else {
                format!("File .{}", ext.to_uppercase())
            },
        ),
    }
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

fn decode_xml_entities(raw: &str) -> String {
    raw.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

fn count_words(text: &str) -> usize {
    text.split_whitespace().count()
}

fn strip_tags(xml: &str) -> String {
    let mut out = String::with_capacity(xml.len());
    let mut in_tag = false;
    for ch in xml.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    decode_xml_entities(&out)
}

/// Estrae il testo interno di tutti i tag con il nome indicato.
fn extract_tag_texts(xml: &str, tag: &str) -> Vec<String> {
    let open_prefix = format!("<{tag}");
    let close = format!("</{tag}>");
    let mut out = Vec::new();
    let mut pos = 0usize;
    while let Some(start_rel) = xml[pos..].find(&open_prefix) {
        let start = pos + start_rel;
        let after_open = match xml[start..].find('>') {
            Some(i) => start + i + 1,
            None => break,
        };
        if xml[start..after_open].ends_with("/>") {
            pos = after_open;
            continue;
        }
        let end = match xml[after_open..].find(&close) {
            Some(i) => after_open + i,
            None => break,
        };
        let text = strip_tags(&xml[after_open..end]);
        out.push(text);
        pos = end + close.len();
    }
    out
}

fn extract_blocks_from_paragraphs(xml: &str, tag: &str) -> Vec<Value> {
    let open_prefix = format!("<{tag}");
    let close = format!("</{tag}>");
    let mut blocks = Vec::new();
    let mut pos = 0usize;
    while let Some(start_rel) = xml[pos..].find(&open_prefix) {
        let start = pos + start_rel;
        let after_open = match xml[start..].find('>') {
            Some(i) => start + i + 1,
            None => break,
        };
        let end = match xml[after_open..].find(&close) {
            Some(i) => after_open + i,
            None => break,
        };
        let inner = &xml[after_open..end];
        let text = extract_tag_texts(inner, "w:t")
            .into_iter()
            .collect::<Vec<_>>()
            .join("");
        if !text.trim().is_empty() {
            blocks.push(json!({ "type": "paragraph", "text": text }));
        }
        pos = end + close.len();
    }
    blocks
}

fn read_zip_entry(buffer: &[u8], name: &str) -> Option<String> {
    let cursor = Cursor::new(buffer);
    let mut archive = zip::ZipArchive::new(cursor).ok()?;
    let file = archive.by_name(name).ok()?;
    let mut out = String::new();
    file.take(2 * 1024 * 1024).read_to_string(&mut out).ok()?;
    Some(out)
}

fn parse_csv_sheet(text: &str, delimiter: char, name: &str) -> Value {
    let mut rows: Vec<Vec<String>> = Vec::new();
    for line in text.lines().take(2000) {
        let cells: Vec<String> = line
            .split(delimiter)
            .map(|c| c.trim().trim_matches('"').to_string())
            .collect();
        if cells.iter().any(|c| !c.is_empty()) {
            rows.push(cells);
        }
    }
    let headers = rows.first().cloned().unwrap_or_default();
    let body: Vec<Vec<String>> = if rows.is_empty() { Vec::new() } else { rows[1..].to_vec() };
    json!({
        "name": name,
        "headers": headers,
        "rows": body,
        "allRows": rows,
        "totalRows": body.len(),
    })
}

fn build_sheet(name: &str, rows: Vec<Vec<String>>) -> Value {
    let headers = rows.first().cloned().unwrap_or_default();
    let body: Vec<Vec<String>> = if rows.is_empty() { Vec::new() } else { rows[1..].to_vec() };
    json!({
        "name": name,
        "headers": headers,
        "rows": body,
        "allRows": rows,
        "totalRows": body.len(),
    })
}

fn parse_docx(buffer: &[u8]) -> (Vec<Value>, usize) {
    let xml = match read_zip_entry(buffer, "word/document.xml") {
        Some(x) => x,
        None => return (Vec::new(), 0),
    };
    let blocks = extract_blocks_from_paragraphs(&xml, "w:p");
    let all_text: String = blocks
        .iter()
        .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
        .collect::<Vec<_>>()
        .join(" ");
    (blocks, count_words(&all_text))
}

fn parse_odt(buffer: &[u8]) -> (Vec<Value>, usize) {
    let xml = match read_zip_entry(buffer, "content.xml") {
        Some(x) => x,
        None => return (Vec::new(), 0),
    };
    let mut blocks = Vec::new();
    for text in extract_tag_texts(&xml, "text:p") {
        if !text.trim().is_empty() {
            blocks.push(json!({ "type": "paragraph", "text": text }));
        }
    }
    let all_text: String = blocks
        .iter()
        .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
        .collect::<Vec<_>>()
        .join(" ");
    (blocks, count_words(&all_text))
}

fn parse_rtf(text: &str) -> (Vec<Value>, usize) {
    let mut clean = String::new();
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            let mut word = String::new();
            while let Some(&next) = chars.peek() {
                if next.is_ascii_alphabetic() {
                    word.push(next);
                    chars.next();
                } else {
                    break;
                }
            }
            if word == "par" || word == "line" {
                clean.push('\n');
            } else if word == "tab" {
                clean.push('\t');
            } else if !word.is_empty() {
                if let Some(&next) = chars.peek() {
                    if next == ' ' {
                        chars.next();
                    }
                }
            } else if let Some(next) = chars.next() {
                if next == '\'' {
                    let _ = chars.next();
                    let _ = chars.next();
                } else {
                    clean.push(next);
                }
            }
        } else if ch == '{' || ch == '}' {
            continue;
        } else {
            clean.push(ch);
        }
    }
    let blocks = clean
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .map(|l| json!({ "type": "paragraph", "text": l }))
        .collect::<Vec<_>>();
    let words = count_words(&clean);
    (blocks, words)
}

fn parse_xlsx(buffer: &[u8]) -> Vec<Value> {
    let shared = read_zip_entry(buffer, "xl/sharedStrings.xml")
        .map(|xml| extract_tag_texts(&xml, "t"))
        .unwrap_or_default();
    let mut sheets = Vec::new();
    for idx in 1..=20 {
        let name = format!("xl/worksheets/sheet{idx}.xml");
        let xml = match read_zip_entry(buffer, &name) {
            Some(x) => x,
            None => break,
        };
        let mut rows: Vec<Vec<String>> = Vec::new();
        for row_xml in split_tag_blocks(&xml, "row") {
            let mut cells: Vec<String> = Vec::new();
            for cell_xml in split_tag_blocks(&row_xml, "c") {
                let is_shared = cell_xml.contains("t=\"s\"");
                let value = extract_tag_texts(&cell_xml, "v")
                    .into_iter()
                    .next()
                    .unwrap_or_default();
                let display = if is_shared {
                    value
                        .parse::<usize>()
                        .ok()
                        .and_then(|i| shared.get(i).cloned())
                        .unwrap_or_default()
                } else if value.is_empty() {
                    extract_tag_texts(&cell_xml, "t")
                        .into_iter()
                        .next()
                        .unwrap_or_default()
                } else {
                    value
                };
                cells.push(display);
            }
            if cells.iter().any(|c| !c.is_empty()) {
                rows.push(cells);
            }
        }
        if !rows.is_empty() {
            sheets.push(build_sheet(&format!("Foglio {idx}"), rows));
        }
    }
    sheets
}

fn split_tag_blocks(xml: &str, tag: &str) -> Vec<String> {
    let open_prefix = format!("<{tag}");
    let close = format!("</{tag}>");
    let mut out = Vec::new();
    let mut pos = 0usize;
    while let Some(start_rel) = xml[pos..].find(&open_prefix) {
        let start = pos + start_rel;
        let after_open = match xml[start..].find('>') {
            Some(i) => start + i + 1,
            None => break,
        };
        if xml[start..after_open].ends_with("/>") {
            pos = after_open;
            continue;
        }
        let end = match xml[after_open..].find(&close) {
            Some(i) => after_open + i,
            None => break,
        };
        out.push(xml[start..end + close.len()].to_string());
        pos = end + close.len();
    }
    out
}

fn parse_pptx(buffer: &[u8]) -> Vec<Value> {
    let mut slides = Vec::new();
    for idx in 1..=200 {
        let name = format!("ppt/slides/slide{idx}.xml");
        let xml = match read_zip_entry(buffer, &name) {
            Some(x) => x,
            None => break,
        };
        let texts = extract_tag_texts(&xml, "a:t");
        let mut iter = texts.into_iter().filter(|t| !t.trim().is_empty());
        let title = iter.next().unwrap_or_default();
        let bullets: Vec<String> = iter.collect();
        slides.push(json!({
            "slideNumber": slides.len() + 1,
            "index": slides.len(),
            "title": title,
            "bullets": bullets,
        }));
    }
    slides
}

fn parse_ods(buffer: &[u8]) -> Vec<Value> {
    let xml = match read_zip_entry(buffer, "content.xml") {
        Some(x) => x,
        None => return Vec::new(),
    };
    let mut rows: Vec<Vec<String>> = Vec::new();
    for row_xml in split_tag_blocks(&xml, "table:table-row") {
        let cells = split_tag_blocks(&row_xml, "table:table-cell")
            .iter()
            .map(|c| strip_tags(c).trim().to_string())
            .collect::<Vec<_>>();
        if cells.iter().any(|c| !c.is_empty()) {
            rows.push(cells);
        }
    }
    if rows.is_empty() {
        Vec::new()
    } else {
        vec![build_sheet("Foglio 1", rows)]
    }
}

fn parse_odp(buffer: &[u8]) -> Vec<Value> {
    let xml = match read_zip_entry(buffer, "content.xml") {
        Some(x) => x,
        None => return Vec::new(),
    };
    let mut slides = Vec::new();
    for page_xml in split_tag_blocks(&xml, "draw:page") {
        let texts = extract_tag_texts(&page_xml, "text:p");
        let mut iter = texts.into_iter().filter(|t| !t.trim().is_empty());
        let title = iter.next().unwrap_or_default();
        let bullets: Vec<String> = iter.collect();
        slides.push(json!({
            "slideNumber": slides.len() + 1,
            "index": slides.len(),
            "title": title,
            "bullets": bullets,
        }));
    }
    slides
}

fn readable_binary_lines(buffer: &[u8]) -> Vec<String> {
    let mut lines = Vec::new();
    let mut current = String::new();
    for &b in buffer.iter().take(512 * 1024) {
        if b == b'\n' || b == b'\r' {
            if !current.trim().is_empty() {
                lines.push(current.trim().to_string());
            }
            current.clear();
        } else if (0x20..=0x7e).contains(&b) || b >= 0x80 {
            current.push(b as char);
        } else if !current.is_empty() {
            current.push(' ');
        }
        if lines.len() >= 500 {
            break;
        }
    }
    if !current.trim().is_empty() {
        lines.push(current.trim().to_string());
    }
    lines
}

pub fn parse_document_buffer(filename: &str, buffer: &[u8], from_trash: bool) -> Value {
    let spec = resolve_viewer_spec(filename);
    let encoded = encode_uri_component(filename);
    let trash_query = if from_trash { "&from_trash=true" } else { "" };
    let base = json!({
        "filename": filename,
        "extension": spec.extension,
        "mimeType": spec.mime_type,
        "viewerMode": spec.viewer_mode.as_str(),
        "viewerType": spec.viewer_mode.as_str(),
        "canPreviewInApp": spec.can_preview,
        "canOpenInApp": spec.can_preview,
        "formatLabel": spec.format_label,
        "sizeBytes": buffer.len(),
        "mediaUrl": format!("/media/{encoded}?inline=1{trash_query}"),
        "downloadUrl": format!("/media/{encoded}?download=1{trash_query}"),
        "blocks": [],
        "sheets": [],
        "slides": [],
    });
    let mut obj = base.as_object().cloned().unwrap_or_default();

    match spec.viewer_mode {
        ViewerMode::Pdf => {
            let raw = String::from_utf8_lossy(buffer);
            let page_count = raw.matches("/Type /Page").count().max(1);
            let page_count_alt = raw.matches("/Type/Page").count();
            obj.insert("pageCount".into(), json!(page_count.max(page_count_alt)));
        }
        ViewerMode::Word => match spec.extension.as_str() {
            "docx" => {
                let (blocks, words) = parse_docx(buffer);
                obj.insert("blocks".into(), json!(blocks));
                obj.insert("wordCount".into(), json!(words));
            }
            "odt" => {
                let (blocks, words) = parse_odt(buffer);
                obj.insert("blocks".into(), json!(blocks));
                obj.insert("wordCount".into(), json!(words));
            }
            "rtf" => {
                let (blocks, words) = parse_rtf(&String::from_utf8_lossy(buffer));
                obj.insert("blocks".into(), json!(blocks));
                obj.insert("wordCount".into(), json!(words));
            }
            _ => {
                let lines = readable_binary_lines(buffer);
                let blocks: Vec<Value> = lines
                    .iter()
                    .map(|l| json!({ "type": "paragraph", "text": l }))
                    .collect();
                obj.insert("wordCount".into(), json!(count_words(&lines.join(" "))));
                obj.insert("blocks".into(), json!(blocks));
            }
        },
        ViewerMode::Spreadsheet => match spec.extension.as_str() {
            "xlsx" => {
                obj.insert("sheets".into(), json!(parse_xlsx(buffer)));
            }
            "csv" | "tsv" => {
                let delimiter = if spec.extension == "tsv" { '\t' } else { ',' };
                let text = String::from_utf8_lossy(buffer);
                obj.insert(
                    "sheets".into(),
                    json!([parse_csv_sheet(&text, delimiter, "Foglio 1")]),
                );
            }
            "ods" => {
                obj.insert("sheets".into(), json!(parse_ods(buffer)));
            }
            _ => {
                let lines = readable_binary_lines(buffer);
                let rows: Vec<Vec<String>> = lines.into_iter().map(|l| vec![l]).collect();
                obj.insert("sheets".into(), json!([build_sheet("Foglio 1", rows)]));
            }
        },
        ViewerMode::Presentation => match spec.extension.as_str() {
            "pptx" => {
                let slides = parse_pptx(buffer);
                obj.insert("pageCount".into(), json!(slides.len()));
                obj.insert("slides".into(), json!(slides));
            }
            "odp" => {
                let slides = parse_odp(buffer);
                obj.insert("pageCount".into(), json!(slides.len()));
                obj.insert("slides".into(), json!(slides));
            }
            _ => {
                let lines = readable_binary_lines(buffer);
                let slides: Vec<Value> = lines
                    .iter()
                    .enumerate()
                    .map(|(i, l)| {
                        json!({
                            "slideNumber": i + 1,
                            "index": i,
                            "title": l,
                            "bullets": [],
                        })
                    })
                    .collect();
                obj.insert("pageCount".into(), json!(slides.len()));
                obj.insert("slides".into(), json!(slides));
            }
        },
        ViewerMode::Text => {
            let raw = String::from_utf8_lossy(&buffer[..buffer.len().min(512 * 1024)]).to_string();
            let formatted = if spec.extension == "json" {
                serde_json::from_str::<Value>(&raw)
                    .ok()
                    .and_then(|v| serde_json::to_string_pretty(&v).ok())
                    .unwrap_or_else(|| raw.clone())
            } else {
                raw
            };
            let line_count = formatted.lines().count();
            obj.insert("textContent".into(), json!(formatted));
            obj.insert("rawText".into(), json!(formatted));
            obj.insert("lineCount".into(), json!(line_count));
            obj.insert("wordCount".into(), json!(count_words(&formatted)));
        }
        _ => {}
    }

    Value::Object(obj)
}

pub fn viewer_mime(filename: &str) -> String {
    resolve_viewer_spec(filename).mime_type
}
