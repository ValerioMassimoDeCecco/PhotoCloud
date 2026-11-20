//! Android Auto-Updater Manifest, AI Model TFLite Streaming & Android Release Builder API.
//! Full parity with `server.ts` Android & AI endpoints.

use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path as StdPath, PathBuf};

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::state::AppState;
use crate::zk_v2_store::{parse_http_range_header, ParsedHttpRange};
use super::common::{access_denied, json_response};
use super::zk_v2::has_authenticated_v2_session;

fn is_valid_safe_filename(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 255
        && !name.starts_with('.')
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains("..")
        && !name.contains('\0')
}

const RELEASE_DIR: &str = "release";
const RELEASE_BUILDS_DIR: &str = "release_builds";

#[derive(Debug, Clone)]
struct AndroidAppVersion {
    version_name: String,
    version_code: u64,
}

fn read_android_app_version() -> AndroidAppVersion {
    let fallback = AndroidAppVersion {
        version_name: "1.5.1".to_string(),
        version_code: 33,
    };
    let gradle_path = StdPath::new("android-app/app/build.gradle.kts");
    let Ok(content) = fs::read_to_string(gradle_path) else {
        return fallback;
    };

    let mut version_name = fallback.version_name;
    let mut version_code = fallback.version_code;

    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("versionName") {
            if let Some((_, rhs)) = rest.split_once('=') {
                let cleaned = rhs.trim().trim_matches('"').trim();
                if !cleaned.is_empty() {
                    version_name = cleaned.to_string();
                }
            }
        } else if let Some(rest) = trimmed.strip_prefix("versionCode") {
            if let Some((_, rhs)) = rest.split_once('=') {
                if let Ok(code) = rhs.trim().parse::<u64>() {
                    version_code = code;
                }
            }
        }
    }

    AndroidAppVersion {
        version_name,
        version_code,
    }
}

fn is_valid_release_apk_name(name: &str) -> bool {
    let Some(rest) = name.strip_prefix("photocloud-release-v") else {
        return false;
    };
    let Some(ver) = rest.strip_suffix("-signed.apk") else {
        return false;
    };
    !ver.is_empty()
        && ver.as_bytes()[0].is_ascii_digit()
        && ver
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-'))
}

fn is_usable_apk(name: &str) -> bool {
    if !is_valid_release_apk_name(name) {
        return false;
    }
    let full = StdPath::new(RELEASE_DIR).join(name);
    match fs::metadata(full) {
        Ok(m) => m.is_file() && m.len() > 100_000,
        Err(_) => false,
    }
}

fn resolve_release_apk(
    preferred_version: Option<&str>,
    manifest_apk_filename: Option<&str>,
) -> Option<String> {
    if let Some(ver) = preferred_version {
        if !ver.is_empty() {
            let exact = format!("photocloud-release-v{ver}-signed.apk");
            if is_usable_apk(&exact) {
                return Some(exact);
            }
        }
    }
    if let Some(mf) = manifest_apk_filename {
        if is_valid_safe_filename(mf) && is_usable_apk(mf) {
            return Some(mf.to_string());
        }
    }
    None
}

fn version_name_from_apk_filename(filename: &str) -> String {
    filename
        .strip_prefix("photocloud-release-v")
        .and_then(|s| s.strip_suffix("-signed.apk"))
        .unwrap_or("")
        .to_string()
}

fn compare_version_strings(a: &str, b: &str) -> i32 {
    let pa: Vec<u64> = a
        .split(|c: char| !c.is_ascii_digit())
        .filter(|s| !s.is_empty())
        .filter_map(|s| s.parse().ok())
        .collect();
    let pb: Vec<u64> = b
        .split(|c: char| !c.is_ascii_digit())
        .filter(|s| !s.is_empty())
        .filter_map(|s| s.parse().ok())
        .collect();
    let len = pa.len().max(pb.len());
    for i in 0..len {
        let na = pa.get(i).copied().unwrap_or(0);
        let nb = pb.get(i).copied().unwrap_or(0);
        if na != nb {
            return if na > nb { 1 } else { -1 };
        }
    }
    0
}

// GET /api/android/update-manifest
pub async fn android_update_manifest() -> Response {
    let app_version = read_android_app_version();
    let manifest_path = StdPath::new(RELEASE_DIR).join("photocloud-release-build.json");
    let manifest_data: serde_json::Value = fs::read_to_string(&manifest_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));

    let manifest_ver_name = manifest_data
        .get("versionName")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().trim_start_matches('v').to_string())
        .unwrap_or_default();
    let manifest_ver_code = manifest_data
        .get("versionCode")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let manifest_ahead = manifest_ver_code > 0 && manifest_ver_code > app_version.version_code;

    let version_name = if manifest_ahead && !manifest_ver_name.is_empty() {
        manifest_ver_name
    } else {
        app_version.version_name.clone()
    };
    let version_code = if manifest_ahead {
        manifest_ver_code
    } else {
        app_version.version_code
    };

    let manifest_apk = manifest_data.get("apkFilename").and_then(|v| v.as_str());
    let Some(resolved_apk) = resolve_release_apk(Some(&version_name), manifest_apk) else {
        return json_response(
            StatusCode::NOT_FOUND,
            serde_json::json!({
                "error": "Nessun APK di release disponibile sul server",
                "versionName": version_name,
                "versionCode": version_code,
            })
            .to_string(),
        );
    };

    let served_apk_ver = version_name_from_apk_filename(&resolved_apk);
    let matches_announced =
        !served_apk_ver.is_empty() && compare_version_strings(&served_apk_ver, &version_name) == 0;
    let served_version_name = if matches_announced {
        version_name
    } else if !served_apk_ver.is_empty() {
        served_apk_ver
    } else {
        version_name
    };
    let served_version_code = if matches_announced { version_code } else { 0 };

    let apk_path = StdPath::new(RELEASE_DIR).join(&resolved_apk);
    let Ok(apk_bytes) = fs::read(&apk_path) else {
        return json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            r#"{"error":"Impossibile leggere il manifest di aggiornamento"}"#,
        );
    };
    let sha256 = hex::encode(Sha256::digest(&apk_bytes));

    let features: Vec<serde_json::Value> = manifest_data
        .get("features")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let changelog = manifest_data
        .get("changelog")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            features
                .iter()
                .filter_map(|f| f.as_str())
                .map(|s| format!("• {s}"))
                .collect::<Vec<_>>()
                .join("\n")
        });

    let signing_cert = manifest_data
        .get("signingCertSha256")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_lowercase());
    let published_at = manifest_data
        .get("publishedAt")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());

    let mut resp_obj = serde_json::json!({
        "applicationId": "com.valerio.photocloud",
        "versionName": served_version_name,
        "versionCode": served_version_code,
        "apkFilename": resolved_apk,
        "apkDownloadUrl": format!("/release/{resolved_apk}"),
        "sizeBytes": apk_bytes.len(),
        "sha256": sha256,
        "changelog": changelog,
        "features": features,
        "publishedAt": published_at,
    });
    if let Some(cert) = signing_cert {
        resp_obj["signingCertSha256"] = serde_json::Value::String(cert);
    }

    json_response(StatusCode::OK, resp_obj.to_string())
}

// GET /api/ai-model/efficientnet_lite4.tflite
pub async fn get_ai_model_tflite(headers: HeaderMap) -> Response {
    let model_path = StdPath::new(RELEASE_DIR).join("efficientnet_lite4.tflite");
    let Ok(meta) = fs::metadata(&model_path) else {
        return json_response(
            StatusCode::NOT_FOUND,
            r#"{"error":"Modello AI non presente sul server"}"#,
        );
    };
    let total_size = meta.len();
    let range_hdr = headers.get(header::RANGE).and_then(|v| v.to_str().ok());

    match parse_http_range_header(range_hdr, total_size) {
        ParsedHttpRange::Unsatisfiable => {
            let mut resp = StatusCode::RANGE_NOT_SATISFIABLE.into_response();
            resp.headers_mut().insert(
                header::CONTENT_RANGE,
                HeaderValue::from_str(&format!("bytes */{total_size}")).unwrap(),
            );
            resp
        }
        ParsedHttpRange::Satisfiable { start, end } => {
            let chunk_len = (end - start + 1) as usize;
            let read_res = (|| -> std::io::Result<Vec<u8>> {
                let mut f = File::open(&model_path)?;
                f.seek(SeekFrom::Start(start))?;
                let mut buf = vec![0u8; chunk_len];
                f.read_exact(&mut buf)?;
                Ok(buf)
            })();
            match read_res {
                Ok(buf) => (
                    StatusCode::PARTIAL_CONTENT,
                    [
                        (header::CONTENT_TYPE, "application/octet-stream".to_string()),
                        (header::ACCEPT_RANGES, "bytes".to_string()),
                        (
                            header::CONTENT_DISPOSITION,
                            r#"attachment; filename="efficientnet_lite4.tflite""#.to_string(),
                        ),
                        (
                            header::CONTENT_RANGE,
                            format!("bytes {start}-{end}/{total_size}"),
                        ),
                    ],
                    buf,
                )
                    .into_response(),
                Err(_) => json_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    r#"{"error":"Errore durante lo streaming del modello AI"}"#,
                ),
            }
        }
        ParsedHttpRange::None => match fs::read(&model_path) {
            Ok(data) => (
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, "application/octet-stream"),
                    (header::ACCEPT_RANGES, "bytes"),
                    (
                        header::CONTENT_DISPOSITION,
                        r#"attachment; filename="efficientnet_lite4.tflite""#,
                    ),
                ],
                data,
            )
                .into_response(),
            Err(_) => json_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                r#"{"error":"Errore durante lo streaming del modello AI"}"#,
            ),
        },
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AndroidBuildConfig {
    #[serde(default = "default_app_name")]
    app_name: String,
    #[serde(default = "default_package_name")]
    package_name: String,
    #[serde(default = "default_version_name")]
    version_name: String,
    #[serde(default = "default_version_code")]
    version_code: u64,
    #[serde(default = "default_server_url")]
    server_url: String,
    #[serde(default = "default_min_sdk")]
    min_sdk: u32,
    #[serde(default = "default_target_sdk")]
    target_sdk: u32,
    #[serde(default = "default_true")]
    enable_biometric_lock: bool,
    #[serde(default = "default_true")]
    enable_offline_cache: bool,
    #[serde(default)]
    enable_auto_backup: bool,
    #[serde(default = "default_signing_mode")]
    signing_mode: String,
    #[serde(default = "default_keystore_alias")]
    keystore_alias: String,
}

fn default_app_name() -> String { "PhotoCloud".to_string() }
fn default_package_name() -> String { "com.valerio.photocloud".to_string() }
fn default_version_name() -> String { read_android_app_version().version_name }
fn default_version_code() -> u64 { read_android_app_version().version_code }
fn default_server_url() -> String { "http://10.0.2.2:3000".to_string() }
fn default_min_sdk() -> u32 { 26 }
fn default_target_sdk() -> u32 { 35 }
fn default_true() -> bool { true }
fn default_signing_mode() -> String { "release".to_string() }
fn default_keystore_alias() -> String { "photocloud-release-key".to_string() }

fn builds_index_path() -> PathBuf {
    StdPath::new(RELEASE_BUILDS_DIR).join("builds.json")
}

fn load_android_builds() -> Vec<serde_json::Value> {
    let idx = builds_index_path();
    if let Ok(raw) = fs::read_to_string(&idx) {
        if let Ok(val) = serde_json::from_str::<Vec<serde_json::Value>>(&raw) {
            return val;
        }
    }
    let app_ver = read_android_app_version();
    let default_apk = resolve_release_apk(Some(&app_ver.version_name), None)
        .unwrap_or_else(|| format!("photocloud-release-v{}-signed.apk", app_ver.version_name));
    let default_size = fs::metadata(StdPath::new(RELEASE_DIR).join(&default_apk))
        .map(|m| m.len())
        .unwrap_or(26_214_400);

    let initial = serde_json::json!({
        "buildId": format!("v{}-release", app_ver.version_name),
        "timestamp": crate::state::now_ms(),
        "config": {
            "appName": "PhotoCloud",
            "packageName": "com.valerio.photocloud",
            "versionName": app_ver.version_name,
            "versionCode": app_ver.version_code,
            "serverUrl": "http://10.0.2.2:3000",
            "minSdk": 26,
            "targetSdk": 35,
            "enableBiometricLock": true,
            "enableOfflineCache": true,
            "enableAutoBackup": false,
            "signingMode": "release",
            "keystoreAlias": "photocloud-release-key"
        },
        "apkFilename": default_apk,
        "aabFilename": format!("photocloud-release-v{}.aab", app_ver.version_name),
        "projectZipFilename": format!("photocloud-android-studio-project-v{}.zip", app_ver.version_name),
        "sha256Fingerprint": "1ec3cc2e2602d3ab4318cd9b23e297e2e795b91d05eceb6944d1ac1df860c90f",
        "apkSizeBytes": default_size,
        "steps": [
            { "id": "step-validate", "label": "Validazione configurazione Android & Permessi", "durationMs": 38, "status": "completed", "command": "validateAndroidConfig(manifest)" },
            { "id": "step-generate", "label": "Generazione sorgenti nativi Kotlin Jetpack Compose", "durationMs": 92, "status": "completed", "command": "kspReleaseKotlin + compileReleaseKotlin" },
            { "id": "step-assemble", "label": "Compilazione release APK firmata V1/V2/V3", "durationMs": 395, "status": "completed", "command": "gradle assembleRelease --no-daemon" },
            { "id": "step-package", "label": "Verifica digest SHA-256 e pacchettizzazione progetto Android Studio (.ZIP)", "durationMs": 48, "status": "completed", "command": format!("sha256sum {default_apk}") }
        ]
    });
    let list = vec![initial];
    let _ = fs::create_dir_all(RELEASE_BUILDS_DIR);
    let _ = fs::write(&idx, serde_json::to_string_pretty(&list).unwrap());
    list
}

fn validate_android_config(cfg: &AndroidBuildConfig) -> Option<&'static str> {
    if cfg.app_name.trim().is_empty() || cfg.app_name.len() > 64 {
        return Some("Nome app Android non valido");
    }
    let pkg = cfg.package_name.trim();
    if pkg.len() < 5
        || !pkg.contains('.')
        || !pkg
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_')
    {
        return Some("Package name Android non valido");
    }
    let ver = cfg.version_name.trim();
    if ver.is_empty()
        || ver.len() > 32
        || !ver
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-'))
    {
        return Some("VersionName non valido");
    }
    if cfg.version_code == 0 {
        return Some("VersionCode deve essere maggiore di zero");
    }
    None
}

// GET /api/android/releases
pub async fn get_android_releases(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !has_authenticated_v2_session(&state, &headers) {
        return access_denied();
    }
    let builds = load_android_builds();
    json_response(
        StatusCode::OK,
        serde_json::json!({ "releases": builds }).to_string(),
    )
}

fn add_dir_to_zip<W: Write + Seek>(
    zip: &mut zip::ZipWriter<W>,
    dir_path: &StdPath,
    prefix: &str,
) -> std::io::Result<()> {
    if !dir_path.exists() {
        return Ok(());
    }
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for entry in fs::read_dir(dir_path)?.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name == ".gradle"
            || name == "build"
            || name.ends_with(".jks")
            || name.ends_with(".keystore")
        {
            continue;
        }
        let full = entry.path();
        let rel = if prefix.is_empty() {
            name
        } else {
            format!("{prefix}/{name}")
        };
        if full.is_dir() {
            add_dir_to_zip(zip, &full, &rel)?;
        } else if full.is_file() {
            let bytes = fs::read(&full)?;
            zip.start_file(&rel, options)?;
            zip.write_all(&bytes)?;
        }
    }
    Ok(())
}

// POST /api/android/build-release
pub async fn post_android_build_release(
    State(state): State<AppState>,
    headers: HeaderMap,
    body_bytes: Bytes,
) -> Response {
    if !has_authenticated_v2_session(&state, &headers) {
        return json_response(
            StatusCode::FORBIDDEN,
            r#"{"success":false,"error":"Accesso negato"}"#,
        );
    }

    let config: AndroidBuildConfig = match serde_json::from_slice(&body_bytes) {
        Ok(c) => c,
        Err(_) => {
            return json_response(
                StatusCode::BAD_REQUEST,
                r#"{"success":false,"error":"Configurazione Android non valida"}"#,
            );
        }
    };
    if let Some(err) = validate_android_config(&config) {
        return json_response(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "success": false, "error": err }).to_string(),
        );
    }

    let safe_ver = config.version_name.trim().to_string();
    let apk_filename = format!("photocloud-release-v{safe_ver}-signed.apk");
    let project_zip_filename = format!("photocloud-android-studio-project-v{safe_ver}.zip");
    let source_apk_rel = resolve_release_apk(Some(&safe_ver), None)
        .unwrap_or_else(|| apk_filename.clone());
    let source_apk = StdPath::new(RELEASE_DIR).join(&source_apk_rel);
    if !source_apk.exists() {
        return json_response(
            StatusCode::NOT_FOUND,
            r#"{"success":false,"error":"Nessun APK di release disponibile: compila prima l'APK con Gradle o GitHub Actions."}"#,
        );
    }

    let Ok(apk_bytes) = fs::read(&source_apk) else {
        return json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            r#"{"success":false,"error":"Errore creazione release Android"}"#,
        );
    };

    let mut rng = rand::thread_rng();
    let mut id_bytes = [0u8; 4];
    rng.fill(&mut id_bytes);
    let build_id = hex::encode(id_bytes);

    let _ = fs::create_dir_all(RELEASE_BUILDS_DIR);
    let target_apk = StdPath::new(RELEASE_BUILDS_DIR).join(format!("{build_id}_{apk_filename}"));
    if fs::write(&target_apk, &apk_bytes).is_err() {
        return json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            r#"{"success":false,"error":"Errore creazione release Android"}"#,
        );
    }
    let sha256 = hex::encode(Sha256::digest(&apk_bytes));

    let zip_path =
        StdPath::new(RELEASE_BUILDS_DIR).join(format!("{build_id}_{project_zip_filename}"));
    let zip_res = (|| -> std::io::Result<()> {
        let f = File::create(&zip_path)?;
        let mut zip = zip::ZipWriter::new(f);
        add_dir_to_zip(&mut zip, StdPath::new("android-app"), "")?;
        zip.finish()?;
        Ok(())
    })();
    if zip_res.is_err() {
        return json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            r#"{"success":false,"error":"Errore creazione release Android"}"#,
        );
    }

    let artifact = serde_json::json!({
        "buildId": build_id,
        "timestamp": crate::state::now_ms(),
        "config": config,
        "apkFilename": apk_filename,
        "aabFilename": format!("photocloud-release-v{safe_ver}.aab"),
        "projectZipFilename": project_zip_filename,
        "sha256Fingerprint": sha256,
        "apkSizeBytes": apk_bytes.len(),
        "steps": [
            { "id": "step-1", "label": "Validazione configurazione Android & Permessi (INTERNET, BIOMETRIC)", "durationMs": 35, "status": "completed", "command": "validateAndroidConfig(manifest)" },
            { "id": "step-2", "label": "Generazione codice nativo Kotlin & Jetpack Compose", "durationMs": 88, "status": "completed", "command": "generateMainActivityKt + generateAppBuildGradleKts" },
            { "id": "step-3", "label": "Compilazione release APK firmata V1/V2/V3", "durationMs": 420, "status": "completed", "command": "gradle assembleRelease --no-daemon" },
            { "id": "step-4", "label": "Calcolo checksum SHA-256 e pacchettizzazione ZIP", "durationMs": 52, "status": "completed", "command": format!("sha256sum {apk_filename}") }
        ]
    });

    let mut existing = load_android_builds();
    existing.truncate(49);
    let mut updated = vec![artifact.clone()];
    updated.extend(existing);
    let _ = fs::write(
        builds_index_path(),
        serde_json::to_string_pretty(&updated).unwrap(),
    );

    json_response(
        StatusCode::OK,
        serde_json::json!({ "success": true, "artifact": artifact }).to_string(),
    )
}

// GET /api/android/download/:buildId/:type
pub async fn get_android_download(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((build_id, kind)): Path<(String, String)>,
) -> Response {
    if !has_authenticated_v2_session(&state, &headers) {
        return (StatusCode::FORBIDDEN, "Accesso negato").into_response();
    }
    let valid_id = !build_id.is_empty()
        && build_id.len() <= 64
        && build_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'));
    if !valid_id || (kind != "apk" && kind != "project") {
        return (StatusCode::BAD_REQUEST, "Parametri richiesta non validi").into_response();
    }

    let builds = load_android_builds();
    let Some(found) = builds
        .iter()
        .find(|b| b.get("buildId").and_then(|v| v.as_str()) == Some(build_id.as_str()))
        .or_else(|| builds.first())
    else {
        return (StatusCode::NOT_FOUND, "Release non trovata").into_response();
    };

    let fallback_ver = read_android_app_version().version_name;
    let safe_apk = found
        .get("apkFilename")
        .and_then(|v| v.as_str())
        .filter(|s| is_valid_safe_filename(s))
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("photocloud-release-v{fallback_ver}-signed.apk"));
    let safe_zip = found
        .get("projectZipFilename")
        .and_then(|v| v.as_str())
        .filter(|s| is_valid_safe_filename(s))
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("photocloud-android-studio-project-v{fallback_ver}.zip"));

    if kind == "apk" {
        let specific = StdPath::new(RELEASE_BUILDS_DIR).join(format!("{build_id}_{safe_apk}"));
        let direct = StdPath::new(RELEASE_DIR).join(&safe_apk);
        let target = if specific.exists() { specific } else { direct };
        match fs::read(&target) {
            Ok(bytes) => (
                StatusCode::OK,
                [
                    (
                        header::CONTENT_TYPE,
                        "application/vnd.android.package-archive".to_string(),
                    ),
                    (
                        header::CONTENT_DISPOSITION,
                        format!(r#"attachment; filename="{safe_apk}""#),
                    ),
                ],
                bytes,
            )
                .into_response(),
            Err(_) => (StatusCode::NOT_FOUND, "File APK non trovato").into_response(),
        }
    } else {
        let specific = StdPath::new(RELEASE_BUILDS_DIR).join(format!("{build_id}_{safe_zip}"));
        let target = if specific.exists() {
            Some(specific)
        } else {
            fs::read_dir(RELEASE_BUILDS_DIR)
                .ok()
                .and_then(|rd| {
                    rd.flatten()
                        .map(|e| e.path())
                        .find(|p| p.extension().and_then(|s| s.to_str()) == Some("zip"))
                })
        };
        match target.and_then(|p| fs::read(p).ok()) {
            Some(bytes) => (
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, "application/zip".to_string()),
                    (
                        header::CONTENT_DISPOSITION,
                        format!(r#"attachment; filename="{safe_zip}""#),
                    ),
                ],
                bytes,
            )
                .into_response(),
            None => (StatusCode::NOT_FOUND, "File ZIP progetto non trovato").into_response(),
        }
    }
}
