//! JS bindings for `src/lib/`: generated from the signatures in `port.rs` by rust-anything.
//! Regenerate with `rust-anything refresh` after changing them.

use napi_derive::napi;

pub mod js;
pub mod port;
pub mod wire;

#[allow(unused_imports)]
use serde_json::Value;
pub mod utf16;

fn panic_message(payload: &(dyn std::any::Any + Send)) -> String {
    payload
        .downcast_ref::<&str>()
        .map(|s| (*s).to_string())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "unknown panic".into())
}

#[allow(dead_code)]
fn run<T>(f: impl FnOnce() -> Result<T, String>) -> napi::Result<T> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(result) => result.map_err(napi::Error::from_reason),
        Err(payload) => Err(napi::Error::from_reason(format!("Rust panic: {}", panic_message(&*payload)))),
    }
}


#[allow(dead_code)]
async fn run_async<T>(f: impl std::future::Future<Output = Result<T, String>>) -> napi::Result<T> {
    use futures::FutureExt as _;
    match std::panic::AssertUnwindSafe(f).catch_unwind().await {
        Ok(result) => result.map_err(napi::Error::from_reason),
        Err(payload) => Err(napi::Error::from_reason(format!("Rust panic: {}", panic_message(&*payload)))),
    }
}

/// `validateAndroidConfig`.
#[napi(js_name = "validateAndroidConfig")]
pub fn validate_android_config(config: String) -> napi::Result<napi::bindgen_prelude::Either<String, ()>> {
    run(move || {
        let config = crate::js::from_json(&config)?;
        let out = port::validate_android_config(config)?;
        Ok(out.map_or(napi::bindgen_prelude::Either::B(()), napi::bindgen_prelude::Either::A))
    })
}

/// `generateAndroidManifestXml`.
#[napi(js_name = "generateAndroidManifestXml")]
pub fn generate_android_manifest_xml(config: String) -> napi::Result<String> {
    run(move || {
        let config = crate::js::from_json(&config)?;
        let out = port::generate_android_manifest_xml(config)?;
        Ok(out)
    })
}

/// `generateAppBuildGradleKts`.
#[napi(js_name = "generateAppBuildGradleKts")]
pub fn generate_app_build_gradle_kts(config: String) -> napi::Result<String> {
    run(move || {
        let config = crate::js::from_json(&config)?;
        let out = port::generate_app_build_gradle_kts(config)?;
        Ok(out)
    })
}

/// `generateMainActivityKt`.
#[napi(js_name = "generateMainActivityKt")]
pub fn generate_main_activity_kt(config: String) -> napi::Result<String> {
    run(move || {
        let config = crate::js::from_json(&config)?;
        let out = port::generate_main_activity_kt(config)?;
        Ok(out)
    })
}

/// `generateApiKey`.
#[napi(js_name = "generateApiKey")]
pub fn generate_api_key(length: Option<f64>) -> napi::Result<String> {
    run(move || {
        let out = port::generate_api_key(length)?;
        Ok(out)
    })
}

/// `hashKey`.
#[napi(js_name = "hashKey")]
pub fn hash_key(key: String) -> napi::Result<String> {
    run(move || {
        let out = port::hash_key(key)?;
        Ok(out)
    })
}

/// `verifyKey`.
#[napi(js_name = "verifyKey")]
pub fn verify_key(key: String, stored_hash: String) -> napi::Result<bool> {
    run(move || {
        let out = port::verify_key(key, stored_hash)?;
        Ok(out)
    })
}

/// `deriveKey`.
#[napi(js_name = "deriveKey")]
pub fn derive_key(key: String, salt: String) -> napi::Result<String> {
    run(move || {
        let salt = crate::js::from_json(&salt)?;
        let out = port::derive_key(key, salt)?;
        crate::js::to_json(&out)
    })
}

/// `deriveKeyAsync`.
#[napi(js_name = "deriveKeyAsync")]
pub async fn derive_key_async(key: String, salt: String) -> napi::Result<String> {
    run_async(async move {
        let salt = crate::js::from_json(&salt)?;
        let out = port::derive_key_async(key, salt).await?;
        crate::js::to_json(&out)
    })
    .await
}

/// `encryptedPlaintextSize`.
#[napi(js_name = "encryptedPlaintextSize")]
pub fn encrypted_plaintext_size(data: String) -> napi::Result<f64> {
    run(move || {
        let data = crate::js::from_json(&data)?;
        let out = port::encrypted_plaintext_size(data)?;
        Ok(out)
    })
}

/// `encryptFile`.
#[napi(js_name = "encryptFile")]
pub fn encrypt_file(file_data: String, key: String) -> napi::Result<String> {
    run(move || {
        let file_data = crate::js::from_json(&file_data)?;
        let out = port::encrypt_file(file_data, key)?;
        crate::js::to_json(&out)
    })
}

/// `encryptFileAsync`.
#[napi(js_name = "encryptFileAsync")]
pub async fn encrypt_file_async(file_data: String, key: String) -> napi::Result<String> {
    run_async(async move {
        let file_data = crate::js::from_json(&file_data)?;
        let out = port::encrypt_file_async(file_data, key).await?;
        crate::js::to_json(&out)
    })
    .await
}

/// `encryptFileStream`.
#[napi(js_name = "encryptFileStream")]
pub async fn encrypt_file_stream(input_path: String, output_path: String, key: String) -> napi::Result<String> {
    run_async(async move {
        let out = port::encrypt_file_stream(input_path, output_path, key).await?;
        crate::js::to_json(&out)
    })
    .await
}

/// `decryptFile`.
#[napi(js_name = "decryptFile")]
pub fn decrypt_file(encrypted_data: String, key: String) -> napi::Result<String> {
    run(move || {
        let encrypted_data = crate::js::from_json(&encrypted_data)?;
        let out = port::decrypt_file(encrypted_data, key)?;
        crate::js::to_json(&out)
    })
}

/// `decryptFileAsync`.
#[napi(js_name = "decryptFileAsync")]
pub async fn decrypt_file_async(encrypted_data: String, key: String) -> napi::Result<String> {
    run_async(async move {
        let encrypted_data = crate::js::from_json(&encrypted_data)?;
        let out = port::decrypt_file_async(encrypted_data, key).await?;
        crate::js::to_json(&out)
    })
    .await
}

/// `decryptFileSha256Stream`.
#[napi(js_name = "decryptFileSha256Stream")]
pub async fn decrypt_file_sha256_stream(encrypted_path: String, key: String) -> napi::Result<String> {
    run_async(async move {
        let out = port::decrypt_file_sha256_stream(encrypted_path, key).await?;
        crate::js::to_json(&out)
    })
    .await
}

/// `calculateBufferHash`.
#[napi(js_name = "calculateBufferHash")]
pub fn calculate_buffer_hash(data: String) -> napi::Result<String> {
    run(move || {
        let data = crate::js::from_json(&data)?;
        let out = port::calculate_buffer_hash(data)?;
        Ok(out)
    })
}

/// `findDuplicateGroups`.
#[napi(js_name = "findDuplicateGroups")]
pub fn find_duplicate_groups(items: String) -> napi::Result<String> {
    run(move || {
        let items = crate::js::from_json(&items)?;
        let out = port::find_duplicate_groups(items)?;
        crate::js::to_json(&out)
    })
}

/// `resolveFileViewerSpec`.
#[napi(js_name = "resolveFileViewerSpec")]
pub fn resolve_file_viewer_spec(filename: String) -> napi::Result<String> {
    run(move || {
        let out = port::resolve_file_viewer_spec(filename)?;
        crate::js::to_json(&out)
    })
}

/// `parseDelimitedTextToSheet`.
#[napi(js_name = "parseDelimitedTextToSheet")]
pub fn parse_delimited_text_to_sheet(text: String, delimiter: Option<String>, sheet_name: Option<String>) -> napi::Result<String> {
    run(move || {
        let out = port::parse_delimited_text_to_sheet(text, delimiter, sheet_name)?;
        crate::js::to_json(&out)
    })
}

/// `parseDocumentBuffer`.
#[napi(js_name = "parseDocumentBuffer")]
pub async fn parse_document_buffer(arg1: String, arg2: String, from_trash: Option<bool>) -> napi::Result<String> {
    run_async(async move {
        let arg1 = crate::js::from_json(&arg1)?;
        let arg2 = crate::js::from_json(&arg2)?;
        let out = port::parse_document_buffer(arg1, arg2, from_trash).await?;
        crate::js::to_json(&out)
    })
    .await
}

/// `emptyExifMetadata`.
#[napi(js_name = "emptyExifMetadata")]
pub fn empty_exif_metadata() -> napi::Result<String> {
    run(move || {
        let out = port::empty_exif_metadata()?;
        crate::js::to_json(&out)
    })
}

/// `isExifParseableFilename`.
#[napi(js_name = "isExifParseableFilename")]
pub fn is_exif_parseable_filename(filename: String) -> napi::Result<bool> {
    run(move || {
        let out = port::is_exif_parseable_filename(filename)?;
        Ok(out)
    })
}

/// `parseExifDateTimeMs`.
#[napi(js_name = "parseExifDateTimeMs")]
pub fn parse_exif_date_time_ms(raw: Option<String>) -> napi::Result<napi::bindgen_prelude::Either<f64, ()>> {
    run(move || {
        let out = port::parse_exif_date_time_ms(raw)?;
        Ok(out.map_or(napi::bindgen_prelude::Either::B(()), napi::bindgen_prelude::Either::A))
    })
}

/// `parseExifFromJpeg`.
#[napi(js_name = "parseExifFromJpeg")]
pub fn parse_exif_from_jpeg(buffer: String) -> napi::Result<String> {
    run(move || {
        let buffer = crate::js::from_json(&buffer)?;
        let out = port::parse_exif_from_jpeg(buffer)?;
        crate::js::to_json(&out)
    })
}

/// `readCurrentAndroidReleaseVersion`.
#[napi(js_name = "readCurrentAndroidReleaseVersion")]
pub fn read_current_android_release_version(root_dir: Option<String>) -> napi::Result<String> {
    run(move || {
        let out = port::read_current_android_release_version(root_dir)?;
        crate::js::to_json(&out)
    })
}

/// `collectFilesToSync`.
#[napi(js_name = "collectFilesToSync")]
pub fn collect_files_to_sync(root_dir: Option<String>) -> napi::Result<Vec<String>> {
    run(move || {
        let out = port::collect_files_to_sync(root_dir)?;
        Ok(out)
    })
}

/// `extractApkSigningCertSha256`.
#[napi(js_name = "extractApkSigningCertSha256")]
pub async fn extract_apk_signing_cert_sha256(apk_buffer: String) -> napi::Result<String> {
    run_async(async move {
        let apk_buffer = crate::js::from_json(&apk_buffer)?;
        let out = port::extract_apk_signing_cert_sha256(apk_buffer).await?;
        Ok(out)
    })
    .await
}

/// `compileSignedAndroidApk`.
#[napi(js_name = "compileSignedAndroidApk")]
pub async fn compile_signed_android_apk(output_dir: String) -> napi::Result<String> {
    run_async(async move {
        let out = port::compile_signed_android_apk(output_dir).await?;
        crate::js::to_json(&out)
    })
    .await
}

/// `triggerGitHubActionsBuild`.
#[napi(js_name = "triggerGitHubActionsBuild")]
pub async fn trigger_git_hub_actions_build(options: String) -> napi::Result<String> {
    run_async(async move {
        let options = crate::js::from_json(&options)?;
        let out = port::trigger_git_hub_actions_build(options).await?;
        crate::js::to_json(&out)
    })
    .await
}

/// `publishApkToGitHubRelease`.
#[napi(js_name = "publishApkToGitHubRelease")]
pub async fn publish_apk_to_git_hub_release(options: String) -> napi::Result<String> {
    run_async(async move {
        let options = crate::js::from_json(&options)?;
        let out = port::publish_apk_to_git_hub_release(options).await?;
        crate::js::to_json(&out)
    })
    .await
}

/// `groupMediaItems`.
#[napi(js_name = "groupMediaItems")]
pub fn group_media_items(items: String, level: String) -> napi::Result<String> {
    run(move || {
        let items = crate::js::from_json(&items)?;
        let out = port::group_media_items(items, level)?;
        crate::js::to_json(&out)
    })
}

/// `isVideoFilename`.
#[napi(js_name = "isVideoFilename")]
pub fn is_video_filename(filename: String) -> napi::Result<bool> {
    run(move || {
        let out = port::is_video_filename(filename)?;
        Ok(out)
    })
}

/// `normalizeSha256Hex`.
#[napi(js_name = "normalizeSha256Hex")]
pub fn normalize_sha256_hex(raw: String) -> napi::Result<napi::bindgen_prelude::Either<String, ()>> {
    run(move || {
        let raw = crate::js::from_json(&raw)?;
        let out = port::normalize_sha256_hex(raw)?;
        Ok(out.map_or(napi::bindgen_prelude::Either::B(()), napi::bindgen_prelude::Either::A))
    })
}

/// `cleanupOrphanTempFiles`.
#[napi(js_name = "cleanupOrphanTempFiles")]
pub fn cleanup_orphan_temp_files(temp_upload_dir: String, options: String) -> napi::Result<f64> {
    run(move || {
        let options = crate::js::from_json(&options)?;
        let out = port::cleanup_orphan_temp_files(temp_upload_dir, options)?;
        Ok(out)
    })
}

/// `sanitizeHexColor`.
#[napi(js_name = "sanitizeHexColor")]
pub fn sanitize_hex_color(val: String, fallback: String) -> napi::Result<String> {
    run(move || {
        let val = crate::js::from_json(&val)?;
        let out = port::sanitize_hex_color(val, fallback)?;
        Ok(out)
    })
}

/// `hexToRgbTuple`.
#[napi(js_name = "hexToRgbTuple")]
pub fn hex_to_rgb_tuple(hex: String) -> napi::Result<String> {
    run(move || {
        let out = port::hex_to_rgb_tuple(hex)?;
        crate::js::to_json(&out)
    })
}

/// `sanitizeLiquidGlassConfig`.
#[napi(js_name = "sanitizeLiquidGlassConfig")]
pub fn sanitize_liquid_glass_config(raw: String) -> napi::Result<String> {
    run(move || {
        let raw = crate::js::from_json(&raw)?;
        let out = port::sanitize_liquid_glass_config(raw)?;
        crate::js::to_json(&out)
    })
}

/// `computeLiquidGlassCssVariables`.
#[napi(js_name = "computeLiquidGlassCssVariables")]
pub fn compute_liquid_glass_css_variables(raw_config: String, is_dark_mode: Option<bool>) -> napi::Result<String> {
    run(move || {
        let raw_config = crate::js::from_json(&raw_config)?;
        let out = port::compute_liquid_glass_css_variables(raw_config, is_dark_mode)?;
        crate::js::to_json(&out)
    })
}

/// `exportLiquidGlassConfigJson`.
#[napi(js_name = "exportLiquidGlassConfigJson")]
pub fn export_liquid_glass_config_json(config: String) -> napi::Result<String> {
    run(move || {
        let config = crate::js::from_json(&config)?;
        let out = port::export_liquid_glass_config_json(config)?;
        Ok(out)
    })
}

/// `importLiquidGlassConfigJson`.
#[napi(js_name = "importLiquidGlassConfigJson")]
pub fn import_liquid_glass_config_json(json_text: String) -> napi::Result<String> {
    run(move || {
        let out = port::import_liquid_glass_config_json(json_text)?;
        crate::js::to_json(&out)
    })
}

/// `renderMapPage`.
#[napi(js_name = "renderMapPage")]
pub fn render_map_page(username: String) -> napi::Result<String> {
    run(move || {
        let out = port::render_map_page(username)?;
        Ok(out)
    })
}

/// `parseNaturalQuery`.
#[napi(js_name = "parseNaturalQuery")]
pub fn parse_natural_query(raw_query: String, now: String) -> napi::Result<String> {
    run(move || {
        let now = crate::js::from_json(&now)?;
        let out = port::parse_natural_query(raw_query, now)?;
        crate::js::to_json(&out)
    })
}

/// `mediaItemMatchesQuery`.
#[napi(js_name = "mediaItemMatchesQuery")]
pub fn media_item_matches_query(item: String, q: String, favorites: String) -> napi::Result<bool> {
    run(move || {
        let item = crate::js::from_json(&item)?;
        let q = crate::js::from_json(&q)?;
        let favorites = crate::js::from_json(&favorites)?;
        let out = port::media_item_matches_query(item, q, favorites)?;
        Ok(out)
    })
}

/// `searchMediaItems`.
#[napi(js_name = "searchMediaItems")]
pub fn search_media_items(items: String, raw_query: String, favorites: String, now: String) -> napi::Result<String> {
    run(move || {
        let items = crate::js::from_json(&items)?;
        let favorites = crate::js::from_json(&favorites)?;
        let now = crate::js::from_json(&now)?;
        let out = port::search_media_items(items, raw_query, favorites, now)?;
        crate::js::to_json(&out)
    })
}

/// `getProtectedSigningDir`.
#[napi(js_name = "getProtectedSigningDir")]
pub fn get_protected_signing_dir(home_dir: String) -> napi::Result<String> {
    run(move || {
        let home_dir = crate::js::from_json(&home_dir)?;
        let out = port::get_protected_signing_dir(home_dir)?;
        Ok(out)
    })
}

/// `getProtectedSigningPropertiesPath`.
#[napi(js_name = "getProtectedSigningPropertiesPath")]
pub fn get_protected_signing_properties_path(env: String, home_dir: String) -> napi::Result<String> {
    run(move || {
        let env = crate::js::from_json(&env)?;
        let home_dir = crate::js::from_json(&home_dir)?;
        let out = port::get_protected_signing_properties_path(env, home_dir)?;
        Ok(out)
    })
}

/// `parseSigningProperties`.
#[napi(js_name = "parseSigningProperties")]
pub fn parse_signing_properties(content: String) -> napi::Result<String> {
    run(move || {
        let out = port::parse_signing_properties(content)?;
        crate::js::to_json(&out)
    })
}

/// `serializeSigningProperties`.
#[napi(js_name = "serializeSigningProperties")]
pub fn serialize_signing_properties(cfg: String) -> napi::Result<String> {
    run(move || {
        let cfg = crate::js::from_json(&cfg)?;
        let out = port::serialize_signing_properties(cfg)?;
        Ok(out)
    })
}

/// `enforceProtectedPermissions`.
#[napi(js_name = "enforceProtectedPermissions")]
pub fn enforce_protected_permissions(target_path: String, is_directory: bool) -> napi::Result<()> {
    run(move || {
        port::enforce_protected_permissions(target_path, is_directory)?;
        Ok(())
    })
}

/// `readSigningPropertiesFile`.
#[napi(js_name = "readSigningPropertiesFile")]
pub fn read_signing_properties_file(file_path: String) -> napi::Result<String> {
    run(move || {
        let out = port::read_signing_properties_file(file_path)?;
        crate::js::to_json(&out)
    })
}

/// `writeProtectedSigningProperties`.
#[napi(js_name = "writeProtectedSigningProperties")]
pub fn write_protected_signing_properties(file_path: String, cfg: String) -> napi::Result<()> {
    run(move || {
        let cfg = crate::js::from_json(&cfg)?;
        port::write_protected_signing_properties(file_path, cfg)?;
        Ok(())
    })
}

/// `computePkcs12CertSha256WithOpenSsl`.
#[napi(js_name = "computePkcs12CertSha256WithOpenSsl")]
pub fn compute_pkcs12_cert_sha256_with_open_ssl(p12_path: String, password: String) -> napi::Result<String> {
    run(move || {
        let out = port::compute_pkcs12_cert_sha256_with_open_ssl(p12_path, password)?;
        Ok(out)
    })
}

/// `createPersistentPkcs12Keystore`.
#[napi(js_name = "createPersistentPkcs12Keystore")]
pub fn create_persistent_pkcs12_keystore(target_path: String, password: String, alias: String) -> napi::Result<String> {
    run(move || {
        let alias = crate::js::from_json(&alias)?;
        let out = port::create_persistent_pkcs12_keystore(target_path, password, alias)?;
        crate::js::to_json(&out)
    })
}

/// `applySigningEnvFromProtectedConfig`.
#[napi(js_name = "applySigningEnvFromProtectedConfig")]
pub fn apply_signing_env_from_protected_config(options: String) -> napi::Result<String> {
    run(move || {
        let options = crate::js::from_json(&options)?;
        let out = port::apply_signing_env_from_protected_config(options)?;
        crate::js::to_json(&out)
    })
}

/// `ensurePersistentLocalSigning`.
#[napi(js_name = "ensurePersistentLocalSigning")]
pub fn ensure_persistent_local_signing(options: String) -> napi::Result<String> {
    run(move || {
        let options = crate::js::from_json(&options)?;
        let out = port::ensure_persistent_local_signing(options)?;
        crate::js::to_json(&out)
    })
}

/// `isPHashSupportedFilename`.
#[napi(js_name = "isPHashSupportedFilename")]
pub fn is_p_hash_supported_filename(filename: String) -> napi::Result<bool> {
    run(move || {
        let out = port::is_p_hash_supported_filename(filename)?;
        Ok(out)
    })
}

/// `dctPHashFromGrayPixels`.
#[napi(js_name = "dctPHashFromGrayPixels")]
pub fn dct_p_hash_from_gray_pixels(gray: String, size: Option<f64>, low_freq: Option<f64>) -> napi::Result<String> {
    run(move || {
        let gray = crate::js::from_json(&gray)?;
        let out = port::dct_p_hash_from_gray_pixels(gray, size, low_freq)?;
        crate::js::to_json(&out)
    })
}

/// `pHashToHex`.
#[napi(js_name = "pHashToHex")]
pub fn p_hash_to_hex(hash: String) -> napi::Result<String> {
    run(move || {
        let hash = crate::js::from_json(&hash)?;
        let out = port::p_hash_to_hex(hash)?;
        Ok(out)
    })
}

/// `hexToPHash`.
#[napi(js_name = "hexToPHash")]
pub fn hex_to_p_hash(hex: String) -> napi::Result<String> {
    run(move || {
        let out = port::hex_to_p_hash(hex)?;
        crate::js::to_json(&out)
    })
}

/// `hammingDistanceHex`.
#[napi(js_name = "hammingDistanceHex")]
pub fn hamming_distance_hex(a: String, b: String) -> napi::Result<f64> {
    run(move || {
        let out = port::hamming_distance_hex(a, b)?;
        Ok(out)
    })
}

/// `computePHashHex`.
#[napi(js_name = "computePHashHex")]
pub async fn compute_p_hash_hex(buffer: String) -> napi::Result<String> {
    run_async(async move {
        let buffer = crate::js::from_json(&buffer)?;
        let out = port::compute_p_hash_hex(buffer).await?;
        Ok(out)
    })
    .await
}

/// `groupSimilarByHash`.
#[napi(js_name = "groupSimilarByHash")]
pub fn group_similar_by_hash(entries: String, max_distance: Option<f64>) -> napi::Result<String> {
    run(move || {
        let entries = crate::js::from_json(&entries)?;
        let out = port::group_similar_by_hash(entries, max_distance)?;
        crate::js::to_json(&out)
    })
}

/// `applyPresetToEditState`.
#[napi(js_name = "applyPresetToEditState")]
pub fn apply_preset_to_edit_state(current: String, preset_id: String) -> napi::Result<String> {
    run(move || {
        let current = crate::js::from_json(&current)?;
        let out = port::apply_preset_to_edit_state(current, preset_id)?;
        crate::js::to_json(&out)
    })
}

/// `normalizeRotation`.
#[napi(js_name = "normalizeRotation")]
pub fn normalize_rotation(deg: f64) -> napi::Result<f64> {
    run(move || {
        let out = port::normalize_rotation(deg)?;
        Ok(out)
    })
}

/// `clampNormalizedCropBox`.
#[napi(js_name = "clampNormalizedCropBox")]
pub fn clamp_normalized_crop_box(box: String, min_span: Option<f64>) -> napi::Result<String> {
    run(move || {
        let box = crate::js::from_json(&box)?;
        let out = port::clamp_normalized_crop_box(box, min_span)?;
        crate::js::to_json(&out)
    })
}

/// `fitAspectNormalizedCropBox`.
#[napi(js_name = "fitAspectNormalizedCropBox")]
pub fn fit_aspect_normalized_crop_box(src_width: f64, src_height: f64, aspect: String) -> napi::Result<String> {
    run(move || {
        let out = port::fit_aspect_normalized_crop_box(src_width, src_height, aspect)?;
        crate::js::to_json(&out)
    })
}

/// `dragNormalizedCropHandle`.
#[napi(js_name = "dragNormalizedCropHandle")]
pub fn drag_normalized_crop_handle(start_box: String, handle: String, dx_norm: f64, dy_norm: f64, aspect: Option<String>, src_width: Option<f64>, src_height: Option<f64>, min_span: Option<f64>) -> napi::Result<String> {
    run(move || {
        let start_box = crate::js::from_json(&start_box)?;
        let out = port::drag_normalized_crop_handle(start_box, handle, dx_norm, dy_norm, aspect, src_width, src_height, min_span)?;
        crate::js::to_json(&out)
    })
}

/// `normalizedBoxToPixelRect`.
#[napi(js_name = "normalizedBoxToPixelRect")]
pub fn normalized_box_to_pixel_rect(src_width: f64, src_height: f64, box: String) -> napi::Result<String> {
    run(move || {
        let box = crate::js::from_json(&box)?;
        let out = port::normalized_box_to_pixel_rect(src_width, src_height, box)?;
        crate::js::to_json(&out)
    })
}

/// `computeCropRect`.
#[napi(js_name = "computeCropRect")]
pub fn compute_crop_rect(src_width: f64, src_height: f64, aspect: String) -> napi::Result<String> {
    run(move || {
        let out = port::compute_crop_rect(src_width, src_height, aspect)?;
        crate::js::to_json(&out)
    })
}

/// `clampByte`.
#[napi(js_name = "clampByte")]
pub fn clamp_byte(val: f64) -> napi::Result<f64> {
    run(move || {
        let out = port::clamp_byte(val)?;
        Ok(out)
    })
}

/// `transformRgbPixel`.
#[napi(js_name = "transformRgbPixel")]
pub fn transform_rgb_pixel(r: f64, g: f64, b: f64, state: String) -> napi::Result<String> {
    run(move || {
        let state = crate::js::from_json(&state)?;
        let out = port::transform_rgb_pixel(r, g, b, state)?;
        crate::js::to_json(&out)
    })
}

/// `clampTrimRange`.
#[napi(js_name = "clampTrimRange")]
pub fn clamp_trim_range(start_sec: f64, end_sec: f64, duration_sec: f64, min_clip_sec: Option<f64>) -> napi::Result<String> {
    run(move || {
        let out = port::clamp_trim_range(start_sec, end_sec, duration_sec, min_clip_sec)?;
        crate::js::to_json(&out)
    })
}

/// `formatMediaDuration`.
#[napi(js_name = "formatMediaDuration")]
pub fn format_media_duration(seconds: f64, with_tenths: Option<bool>) -> napi::Result<String> {
    run(move || {
        let out = port::format_media_duration(seconds, with_tenths)?;
        Ok(out)
    })
}

/// `buildCssFilterString`.
#[napi(js_name = "buildCssFilterString")]
pub fn build_css_filter_string(state: String) -> napi::Result<String> {
    run(move || {
        let state = crate::js::from_json(&state)?;
        let out = port::build_css_filter_string(state)?;
        Ok(out)
    })
}

/// `computeFittedMediaSize`.
#[napi(js_name = "computeFittedMediaSize")]
pub fn compute_fitted_media_size(viewport_width: f64, viewport_height: f64, media_width: Option<f64>, media_height: Option<f64>) -> napi::Result<String> {
    run(move || {
        let out = port::compute_fitted_media_size(viewport_width, viewport_height, media_width, media_height)?;
        crate::js::to_json(&out)
    })
}

/// `clampZoomPan`.
#[napi(js_name = "clampZoomPan")]
pub fn clamp_zoom_pan(scale: f64, pan_x: f64, pan_y: f64, viewport_width: f64, viewport_height: f64, min_scale: Option<f64>, max_scale: Option<f64>, media_width: Option<f64>, media_height: Option<f64>) -> napi::Result<String> {
    run(move || {
        let out = port::clamp_zoom_pan(scale, pan_x, pan_y, viewport_width, viewport_height, min_scale, max_scale, media_width, media_height)?;
        crate::js::to_json(&out)
    })
}

/// `computePinchZoomPan`.
#[napi(js_name = "computePinchZoomPan")]
pub fn compute_pinch_zoom_pan(input: String) -> napi::Result<String> {
    run(move || {
        let input = crate::js::from_json(&input)?;
        let out = port::compute_pinch_zoom_pan(input)?;
        crate::js::to_json(&out)
    })
}

/// `getVapidPublicKey`.
#[napi(js_name = "getVapidPublicKey")]
pub fn get_vapid_public_key() -> napi::Result<napi::bindgen_prelude::Either<String, ()>> {
    run(move || {
        let out = port::get_vapid_public_key()?;
        Ok(out.map_or(napi::bindgen_prelude::Either::B(()), napi::bindgen_prelude::Either::A))
    })
}

/// `initPushService`.
#[napi(js_name = "initPushService")]
pub async fn init_push_service(root_dir: String) -> napi::Result<String> {
    run_async(async move {
        let out = port::init_push_service(root_dir).await?;
        crate::js::to_json(&out)
    })
    .await
}

/// `getUserPushPath`.
#[napi(js_name = "getUserPushPath")]
pub fn get_user_push_path(user_folder: String) -> napi::Result<String> {
    run(move || {
        let out = port::get_user_push_path(user_folder)?;
        Ok(out)
    })
}

/// `loadUserSubscriptions`.
#[napi(js_name = "loadUserSubscriptions")]
pub fn load_user_subscriptions(user_folder: String) -> napi::Result<String> {
    run(move || {
        let out = port::load_user_subscriptions(user_folder)?;
        crate::js::to_json(&out)
    })
}

/// `saveUserSubscriptions`.
#[napi(js_name = "saveUserSubscriptions")]
pub fn save_user_subscriptions(user_folder: String, subscriptions: String) -> napi::Result<()> {
    run(move || {
        let subscriptions = crate::js::from_json(&subscriptions)?;
        port::save_user_subscriptions(user_folder, subscriptions)?;
        Ok(())
    })
}

/// `addUserSubscription`.
#[napi(js_name = "addUserSubscription")]
pub fn add_user_subscription(user_folder: String, sub: String) -> napi::Result<f64> {
    run(move || {
        let sub = crate::js::from_json(&sub)?;
        let out = port::add_user_subscription(user_folder, sub)?;
        Ok(out)
    })
}

/// `removeUserSubscription`.
#[napi(js_name = "removeUserSubscription")]
pub fn remove_user_subscription(user_folder: String, endpoint: String) -> napi::Result<f64> {
    run(move || {
        let out = port::remove_user_subscription(user_folder, endpoint)?;
        Ok(out)
    })
}

/// `sendPushToUser`.
#[napi(js_name = "sendPushToUser")]
pub async fn send_push_to_user(user_folder: String, payload: String) -> napi::Result<String> {
    run_async(async move {
        let payload = crate::js::from_json(&payload)?;
        let out = port::send_push_to_user(user_folder, payload).await?;
        crate::js::to_json(&out)
    })
    .await
}

/// `renderSharePage`.
#[napi(js_name = "renderSharePage")]
pub fn render_share_page(model: String) -> napi::Result<String> {
    run(move || {
        let model = crate::js::from_json(&model)?;
        let out = port::render_share_page(model)?;
        Ok(out)
    })
}

/// `renderSharePasswordPage`.
#[napi(js_name = "renderSharePasswordPage")]
pub fn render_share_password_page(token: String, error: Option<String>) -> napi::Result<String> {
    run(move || {
        let out = port::render_share_password_page(token, error)?;
        Ok(out)
    })
}

/// `renderShareErrorPage`.
#[napi(js_name = "renderShareErrorPage")]
pub fn render_share_error_page(state: String) -> napi::Result<String> {
    run(move || {
        let state = crate::js::from_json(&state)?;
        let out = port::render_share_error_page(state)?;
        Ok(out)
    })
}

/// `getSharesFilePath`.
#[napi(js_name = "getSharesFilePath")]
pub fn get_shares_file_path(root_dir: String) -> napi::Result<String> {
    run(move || {
        let out = port::get_shares_file_path(root_dir)?;
        Ok(out)
    })
}

/// `getAlbumSharesFilePath`.
#[napi(js_name = "getAlbumSharesFilePath")]
pub fn get_album_shares_file_path(root_dir: String) -> napi::Result<String> {
    run(move || {
        let out = port::get_album_shares_file_path(root_dir)?;
        Ok(out)
    })
}

/// `loadPublicShares`.
#[napi(js_name = "loadPublicShares")]
pub fn load_public_shares(root_dir: String) -> napi::Result<String> {
    run(move || {
        let out = port::load_public_shares(root_dir)?;
        crate::js::to_json(&out)
    })
}

/// `savePublicShares`.
#[napi(js_name = "savePublicShares")]
pub fn save_public_shares(root_dir: String, shares: String) -> napi::Result<()> {
    run(move || {
        let shares = crate::js::from_json(&shares)?;
        port::save_public_shares(root_dir, shares)?;
        Ok(())
    })
}

/// `loadAlbumShares`.
#[napi(js_name = "loadAlbumShares")]
pub fn load_album_shares(root_dir: String) -> napi::Result<String> {
    run(move || {
        let out = port::load_album_shares(root_dir)?;
        crate::js::to_json(&out)
    })
}

/// `saveAlbumShares`.
#[napi(js_name = "saveAlbumShares")]
pub fn save_album_shares(root_dir: String, shares: String) -> napi::Result<()> {
    run(move || {
        let shares = crate::js::from_json(&shares)?;
        port::save_album_shares(root_dir, shares)?;
        Ok(())
    })
}

/// `createPublicShare`.
#[napi(js_name = "createPublicShare")]
pub fn create_public_share(root_dir: String, server_secret: String, input: String) -> napi::Result<String> {
    run(move || {
        let server_secret = crate::js::from_json(&server_secret)?;
        let input = crate::js::from_json(&input)?;
        let out = port::create_public_share(root_dir, server_secret, input)?;
        crate::js::to_json(&out)
    })
}

/// `verifySharePassword`.
#[napi(js_name = "verifySharePassword")]
pub fn verify_share_password(record: String, password: String) -> napi::Result<bool> {
    run(move || {
        let record = crate::js::from_json(&record)?;
        let out = port::verify_share_password(record, password)?;
        Ok(out)
    })
}

/// `resolveShareByToken`.
#[napi(js_name = "resolveShareByToken")]
pub fn resolve_share_by_token(root_dir: String, token: String) -> napi::Result<String> {
    run(move || {
        let out = port::resolve_share_by_token(root_dir, token)?;
        crate::js::to_json(&out)
    })
}

/// `incrementShareDownloadCount`.
#[napi(js_name = "incrementShareDownloadCount")]
pub fn increment_share_download_count(root_dir: String, id: String) -> napi::Result<bool> {
    run(move || {
        let out = port::increment_share_download_count(root_dir, id)?;
        Ok(out)
    })
}

/// `upsertAlbumShare`.
#[napi(js_name = "upsertAlbumShare")]
pub fn upsert_album_share(root_dir: String, server_secret: String, owner: String, album: String, owner_api_key: String, username: String, role: String) -> napi::Result<String> {
    run(move || {
        let server_secret = crate::js::from_json(&server_secret)?;
        let out = port::upsert_album_share(root_dir, server_secret, owner, album, owner_api_key, username, role)?;
        crate::js::to_json(&out)
    })
}

/// `deleteAlbumSharesForAlbum`.
#[napi(js_name = "deleteAlbumSharesForAlbum")]
pub fn delete_album_shares_for_album(root_dir: String, owner: String, album: String) -> napi::Result<f64> {
    run(move || {
        let out = port::delete_album_shares_for_album(root_dir, owner, album)?;
        Ok(out)
    })
}

/// `escapeHtml`.
#[napi(js_name = "escapeHtml")]
pub fn escape_html(str: String) -> napi::Result<String> {
    run(move || {
        let out = port::escape_html(str)?;
        Ok(out)
    })
}

/// `formatFileSize`.
#[napi(js_name = "formatFileSize")]
pub fn format_file_size(bytes: Option<f64>) -> napi::Result<String> {
    run(move || {
        let out = port::format_file_size(bytes)?;
        Ok(out)
    })
}

/// `computeCloudStorageStats`.
#[napi(js_name = "computeCloudStorageStats")]
pub fn compute_cloud_storage_stats(active_files: String, trashed_files: String, thumb_cache_bytes: Option<f64>) -> napi::Result<String> {
    run(move || {
        let active_files = crate::js::from_json(&active_files)?;
        let trashed_files = crate::js::from_json(&trashed_files)?;
        let out = port::compute_cloud_storage_stats(active_files, trashed_files, thumb_cache_bytes)?;
        crate::js::to_json(&out)
    })
}

/// `renderLoginTemplate`.
#[napi(js_name = "renderLoginTemplate")]
pub fn render_login_template(error_message: Option<String>) -> napi::Result<String> {
    run(move || {
        let out = port::render_login_template(error_message)?;
        Ok(out)
    })
}

/// `renderGalleryTemplate`.
#[napi(js_name = "renderGalleryTemplate")]
pub fn render_gallery_template(all_files: String, albums: String, trashed_files: String, favorites: String) -> napi::Result<String> {
    run(move || {
        let all_files = crate::js::from_json(&all_files)?;
        let albums = crate::js::from_json(&albums)?;
        let trashed_files = crate::js::from_json(&trashed_files)?;
        let favorites = crate::js::from_json(&favorites)?;
        let out = port::render_gallery_template(all_files, albums, trashed_files, favorites)?;
        Ok(out)
    })
}

/// `renderTrashTemplate`.
#[napi(js_name = "renderTrashTemplate")]
pub fn render_trash_template(trashed_files: String, active_files: String) -> napi::Result<String> {
    run(move || {
        let trashed_files = crate::js::from_json(&trashed_files)?;
        let active_files = crate::js::from_json(&active_files)?;
        let out = port::render_trash_template(trashed_files, active_files)?;
        Ok(out)
    })
}

/// `resolveThumbCacheMaxBytes`.
#[napi(js_name = "resolveThumbCacheMaxBytes")]
pub fn resolve_thumb_cache_max_bytes(override_max_bytes: Option<f64>) -> napi::Result<f64> {
    run(move || {
        let out = port::resolve_thumb_cache_max_bytes(override_max_bytes)?;
        Ok(out)
    })
}

/// `parsePreviewVariant`.
#[napi(js_name = "parsePreviewVariant")]
pub fn parse_preview_variant(raw_query: String, is_explicit_download: Option<bool>) -> napi::Result<napi::bindgen_prelude::Either<String, ()>> {
    run(move || {
        let raw_query = crate::js::from_json(&raw_query)?;
        let out = port::parse_preview_variant(raw_query, is_explicit_download)?;
        Ok(out.map_or(napi::bindgen_prelude::Either::B(()), napi::bindgen_prelude::Either::A))
    })
}

/// `isJpegMagicBytes`.
#[napi(js_name = "isJpegMagicBytes")]
pub fn is_jpeg_magic_bytes(buf: String) -> napi::Result<bool> {
    run(move || {
        let buf = crate::js::from_json(&buf)?;
        let out = port::is_jpeg_magic_bytes(buf)?;
        Ok(out)
    })
}

/// `writeJsonAtomic`.
#[napi(js_name = "writeJsonAtomic")]
pub fn write_json_atomic(file_path: String, data: String) -> napi::Result<()> {
    run(move || {
        let data = crate::js::from_json(&data)?;
        port::write_json_atomic(file_path, data)?;
        Ok(())
    })
}

/// `getOrCreateServerSecret`.
#[napi(js_name = "getOrCreateServerSecret")]
pub fn get_or_create_server_secret(storage_dir: String) -> napi::Result<String> {
    run(move || {
        let out = port::get_or_create_server_secret(storage_dir)?;
        crate::js::to_json(&out)
    })
}

/// `wrapSecret`.
#[napi(js_name = "wrapSecret")]
pub fn wrap_secret(server_secret: String, plaintext: String) -> napi::Result<String> {
    run(move || {
        let server_secret = crate::js::from_json(&server_secret)?;
        let out = port::wrap_secret(server_secret, plaintext)?;
        crate::js::to_json(&out)
    })
}

/// `unwrapSecret`.
#[napi(js_name = "unwrapSecret")]
pub fn unwrap_secret(server_secret: String, wrapped: String) -> napi::Result<napi::bindgen_prelude::Either<String, ()>> {
    run(move || {
        let server_secret = crate::js::from_json(&server_secret)?;
        let wrapped = crate::js::from_json(&wrapped)?;
        let out = port::unwrap_secret(server_secret, wrapped)?;
        Ok(out.map_or(napi::bindgen_prelude::Either::B(()), napi::bindgen_prelude::Either::A))
    })
}

/// `hashLookupToken`.
#[napi(js_name = "hashLookupToken")]
pub fn hash_lookup_token(token: String) -> napi::Result<String> {
    run(move || {
        let out = port::hash_lookup_token(token)?;
        Ok(out)
    })
}

/// `isValidUuidV4`.
#[napi(js_name = "isValidUuidV4")]
pub fn is_valid_uuid_v4(value: String) -> napi::Result<bool> {
    run(move || {
        let value = crate::js::from_json(&value)?;
        let out = port::is_valid_uuid_v4(value)?;
        Ok(out)
    })
}

/// `decodeBase64UrlStrict`.
#[napi(js_name = "decodeBase64UrlStrict")]
pub fn decode_base64_url_strict(input: String, expected_byte_length: Option<f64>) -> napi::Result<String> {
    run(move || {
        let input = crate::js::from_json(&input)?;
        let out = port::decode_base64_url_strict(input, expected_byte_length)?;
        crate::js::to_json(&out)
    })
}

/// `computeScryptVerifierAsync`.
#[napi(js_name = "computeScryptVerifierAsync")]
pub async fn compute_scrypt_verifier_async(auth_secret_bytes: String, server_salt: String) -> napi::Result<String> {
    run_async(async move {
        let auth_secret_bytes = crate::js::from_json(&auth_secret_bytes)?;
        let server_salt = crate::js::from_json(&server_salt)?;
        let out = port::compute_scrypt_verifier_async(auth_secret_bytes, server_salt).await?;
        crate::js::to_json(&out)
    })
    .await
}

/// `verifyScryptConstantTime`.
#[napi(js_name = "verifyScryptConstantTime")]
pub async fn verify_scrypt_constant_time(auth_secret_bytes: String, server_salt: String, expected_verifier: String) -> napi::Result<bool> {
    run_async(async move {
        let auth_secret_bytes = crate::js::from_json(&auth_secret_bytes)?;
        let server_salt = crate::js::from_json(&server_salt)?;
        let expected_verifier = crate::js::from_json(&expected_verifier)?;
        let out = port::verify_scrypt_constant_time(auth_secret_bytes, server_salt, expected_verifier).await?;
        Ok(out)
    })
    .await
}

/// `deriveFakeSaltForUsername`.
#[napi(js_name = "deriveFakeSaltForUsername")]
pub fn derive_fake_salt_for_username(server_secret: String, username: String) -> napi::Result<String> {
    run(move || {
        let server_secret = crate::js::from_json(&server_secret)?;
        let out = port::derive_fake_salt_for_username(server_secret, username)?;
        Ok(out)
    })
}

/// `computeFileSha256Hex`.
#[napi(js_name = "computeFileSha256Hex")]
pub async fn compute_file_sha256_hex(file_path: String) -> napi::Result<String> {
    run_async(async move {
        let out = port::compute_file_sha256_hex(file_path).await?;
        Ok(out)
    })
    .await
}

/// `timingSafeHexEqual`.
#[napi(js_name = "timingSafeHexEqual")]
pub fn timing_safe_hex_equal(hex_a: String, hex_b: String) -> napi::Result<bool> {
    run(move || {
        let out = port::timing_safe_hex_equal(hex_a, hex_b)?;
        Ok(out)
    })
}

/// `fsyncDirBestEffort`.
#[napi(js_name = "fsyncDirBestEffort")]
pub fn fsync_dir_best_effort(dir_path: String) -> napi::Result<()> {
    run(move || {
        port::fsync_dir_best_effort(dir_path)?;
        Ok(())
    })
}

/// `writeBufferAtomicSync`.
#[napi(js_name = "writeBufferAtomicSync")]
pub fn write_buffer_atomic_sync(temp_dir: String, target_path: String, data: String) -> napi::Result<()> {
    run(move || {
        let data = crate::js::from_json(&data)?;
        port::write_buffer_atomic_sync(temp_dir, target_path, data)?;
        Ok(())
    })
}

/// `moveTempFileAtomicSync`.
#[napi(js_name = "moveTempFileAtomicSync")]
pub fn move_temp_file_atomic_sync(temp_file_path: String, target_path: String) -> napi::Result<()> {
    run(move || {
        port::move_temp_file_atomic_sync(temp_file_path, target_path)?;
        Ok(())
    })
}

/// `parseHttpRangeHeader`.
#[napi(js_name = "parseHttpRangeHeader")]
pub fn parse_http_range_header(range_header: Option<String>, total_size: f64) -> napi::Result<String> {
    run(move || {
        let out = port::parse_http_range_header(range_header, total_size)?;
        crate::js::to_json(&out)
    })
}

/// `verifyInviteTokenConstantTime`.
#[napi(js_name = "verifyInviteTokenConstantTime")]
pub fn verify_invite_token_constant_time(expected_token: Option<String>, provided_token: String) -> napi::Result<bool> {
    run(move || {
        let provided_token = crate::js::from_json(&provided_token)?;
        let out = port::verify_invite_token_constant_time(expected_token, provided_token)?;
        Ok(out)
    })
}

/// `isSecureOrLocalhostRequest`.
#[napi(js_name = "isSecureOrLocalhostRequest")]
pub fn is_secure_or_localhost_request(req: String) -> napi::Result<bool> {
    run(move || {
        let req = crate::js::from_json(&req)?;
        let out = port::is_secure_or_localhost_request(req)?;
        Ok(out)
    })
}

// ---- the binary wire ------------------------------------------------------------------------

type WireBuffers = (
    napi::bindgen_prelude::Uint8Array,
    napi::bindgen_prelude::Uint8Array,
    napi::bindgen_prelude::Uint32Array,
);

thread_local! {
    static WIRE: std::cell::RefCell<Option<WireBuffers>> = const { std::cell::RefCell::new(None) };
    static PENDING: std::cell::RefCell<Vec<u8>> = const { std::cell::RefCell::new(Vec::new()) };
    static SCRATCH: std::cell::RefCell<Vec<u8>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// Registers the argument, result and argument-length buffers `index.cjs` uses.
#[napi(js_name = "rustAnythingWireInit")]
pub fn rust_anything_wire_init(
    input: napi::bindgen_prelude::Uint8Array,
    output: napi::bindgen_prelude::Uint8Array,
    len: napi::bindgen_prelude::Uint32Array,
) {
    WIRE.with(|w| *w.borrow_mut() = Some((input, output, len)));
}

/// Copies a result that did not fit into the (now larger) result buffer.
#[napi(js_name = "rustAnythingWireFlush")]
pub fn rust_anything_wire_flush() -> f64 {
    let bytes = PENDING.with(|p| std::mem::take(&mut *p.borrow_mut()));
    WIRE.with(|w| {
        let mut w = w.borrow_mut();
        let Some((_, output, _)) = w.as_mut() else {
            return -1.0;
        };
        // SAFETY: the call is synchronous; JS does not touch `output` until it returns.
        let out = unsafe { output.as_mut() };
        let n = bytes.len().min(out.len());
        out[..n].copy_from_slice(&bytes[..n]);
        n as f64
    })
}

/// Reads the argument bytes (`wLen[0]` of them), runs `f`, and writes its result; a negative
/// return is the size of a result that did not fit, kept for `rustAnythingWireFlush`.
fn wire_io(f: impl FnOnce(&mut wire::Reader, &mut wire::Writer) -> Result<(), String>) -> napi::Result<f64> {
    WIRE.with(|cell| {
        let mut guard = cell.borrow_mut();
        let Some((input, output, len)) = guard.as_mut() else {
            return Err(napi::Error::from_reason("rust-anything: the wire buffers are not registered"));
        };
        let len = (len.first().copied().unwrap_or(0) as usize).min(input.len());
        let mut w = wire::Writer(SCRATCH.with(|s| std::mem::take(&mut *s.borrow_mut())));
        w.0.clear();
        let result = run(|| f(&mut wire::Reader::new(&input[..len]), &mut w));
        let keep = |w: wire::Writer| SCRATCH.with(|s| *s.borrow_mut() = w.0);
        match result {
            // A result of another shape than the TS type: JS runs the call through JSON.
            Err(e) if e.reason.starts_with(wire::MISMATCH) => {
                keep(w);
                return Ok(f64::NAN);
            }
            Err(e) => {
                keep(w);
                let mut m = wire::Writer::default();
                m.string16(&e.reason);
                // SAFETY: the call is synchronous; JS does not touch `output` until it returns.
                let out = unsafe { output.as_mut() };
                if m.0.len() > out.len() {
                    return Err(e);
                }
                out[..m.0.len()].copy_from_slice(&m.0);
                return Ok(f64::INFINITY);
            }
            Ok(()) => {}
        }
        // SAFETY: the call is synchronous; JS does not touch `output` until it returns.
        let out = unsafe { output.as_mut() };
        let n = w.0.len();
        if n > out.len() {
            PENDING.with(|p| *p.borrow_mut() = w.0);
            return Ok(-(n as f64));
        }
        out[..n].copy_from_slice(&w.0);
        keep(w);
        Ok(n as f64)
    })
}

static S_VALIDATE_ANDROID_CONFIG_0: wire::Schema = wire::Schema::Dyn;

/// `validateAndroidConfig` over the binary wire.
#[napi(js_name = "validateAndroidConfigWire")]
pub fn validate_android_config_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let config: serde_json::Value = wire::read_value(r, &S_VALIDATE_ANDROID_CONFIG_0)?;
        let out = &port::validate_android_config(config)?;
        match out { Some(x0) => { w.tag(1); w.string16(x0); } None => w.tag(2) }
        Ok(())
    })
}

static S_GENERATE_ANDROID_MANIFEST_XML_0: wire::Schema = wire::Schema::Dyn;

/// `generateAndroidManifestXml` over the binary wire.
#[napi(js_name = "generateAndroidManifestXmlWire")]
pub fn generate_android_manifest_xml_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let config: serde_json::Value = wire::read_value(r, &S_GENERATE_ANDROID_MANIFEST_XML_0)?;
        let out = &port::generate_android_manifest_xml(config)?;
        w.string16(out);
        Ok(())
    })
}

static S_GENERATE_APP_BUILD_GRADLE_KTS_0: wire::Schema = wire::Schema::Dyn;

/// `generateAppBuildGradleKts` over the binary wire.
#[napi(js_name = "generateAppBuildGradleKtsWire")]
pub fn generate_app_build_gradle_kts_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let config: serde_json::Value = wire::read_value(r, &S_GENERATE_APP_BUILD_GRADLE_KTS_0)?;
        let out = &port::generate_app_build_gradle_kts(config)?;
        w.string16(out);
        Ok(())
    })
}

static S_GENERATE_MAIN_ACTIVITY_KT_0: wire::Schema = wire::Schema::Dyn;

/// `generateMainActivityKt` over the binary wire.
#[napi(js_name = "generateMainActivityKtWire")]
pub fn generate_main_activity_kt_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let config: serde_json::Value = wire::read_value(r, &S_GENERATE_MAIN_ACTIVITY_KT_0)?;
        let out = &port::generate_main_activity_kt(config)?;
        w.string16(out);
        Ok(())
    })
}


/// `generateApiKey` over the binary wire.
#[napi(js_name = "generateApiKeyWire")]
pub fn generate_api_key_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let length: Option<f64> = r.opt_js(|r| r.f64())?;
        let out = &port::generate_api_key(length)?;
        w.string16(out);
        Ok(())
    })
}


/// `hashKey` over the binary wire.
#[napi(js_name = "hashKeyWire")]
pub fn hash_key_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let key: String = r.string16()?;
        let out = &port::hash_key(key)?;
        w.string16(out);
        Ok(())
    })
}


/// `verifyKey` over the binary wire.
#[napi(js_name = "verifyKeyWire")]
pub fn verify_key_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let key: String = r.string16()?;
        let stored_hash: String = r.string16()?;
        let out = &port::verify_key(key, stored_hash)?;
        w.bool(*out);
        Ok(())
    })
}

static S_DERIVE_KEY_1: wire::Schema = wire::Schema::Dyn;
static S_DERIVE_KEY_OUT: wire::Schema = wire::Schema::Dyn;

/// `deriveKey` over the binary wire.
#[napi(js_name = "deriveKeyWire")]
pub fn derive_key_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let key: String = r.string16()?;
        let salt: serde_json::Value = wire::read_value(r, &S_DERIVE_KEY_1)?;
        let out = &port::derive_key(key, salt)?;
        wire::write_value(w, out, &S_DERIVE_KEY_OUT)?;
        Ok(())
    })
}

static S_ENCRYPTED_PLAINTEXT_SIZE_0: wire::Schema = wire::Schema::Dyn;

/// `encryptedPlaintextSize` over the binary wire.
#[napi(js_name = "encryptedPlaintextSizeWire")]
pub fn encrypted_plaintext_size_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let data: serde_json::Value = wire::read_value(r, &S_ENCRYPTED_PLAINTEXT_SIZE_0)?;
        let out = &port::encrypted_plaintext_size(data)?;
        w.f64(*out);
        Ok(())
    })
}

static S_ENCRYPT_FILE_0: wire::Schema = wire::Schema::Dyn;
static S_ENCRYPT_FILE_OUT: wire::Schema = wire::Schema::Dyn;

/// `encryptFile` over the binary wire.
#[napi(js_name = "encryptFileWire")]
pub fn encrypt_file_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let file_data: serde_json::Value = wire::read_value(r, &S_ENCRYPT_FILE_0)?;
        let key: String = r.string16()?;
        let out = &port::encrypt_file(file_data, key)?;
        wire::write_value(w, out, &S_ENCRYPT_FILE_OUT)?;
        Ok(())
    })
}

static S_DECRYPT_FILE_0: wire::Schema = wire::Schema::Dyn;
static S_DECRYPT_FILE_OUT: wire::Schema = wire::Schema::Dyn;

/// `decryptFile` over the binary wire.
#[napi(js_name = "decryptFileWire")]
pub fn decrypt_file_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let encrypted_data: serde_json::Value = wire::read_value(r, &S_DECRYPT_FILE_0)?;
        let key: String = r.string16()?;
        let out = &port::decrypt_file(encrypted_data, key)?;
        wire::write_value(w, out, &S_DECRYPT_FILE_OUT)?;
        Ok(())
    })
}

static S_CALCULATE_BUFFER_HASH_0: wire::Schema = wire::Schema::Dyn;

/// `calculateBufferHash` over the binary wire.
#[napi(js_name = "calculateBufferHashWire")]
pub fn calculate_buffer_hash_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let data: serde_json::Value = wire::read_value(r, &S_CALCULATE_BUFFER_HASH_0)?;
        let out = &port::calculate_buffer_hash(data)?;
        w.string16(out);
        Ok(())
    })
}

static S_FIND_DUPLICATE_GROUPS_0: wire::Schema = wire::Schema::List(&wire::Schema::Obj(&[("filename", wire::Schema::Str16), ("hash", wire::Schema::OptJs(&wire::Schema::Str16))]));

/// `findDuplicateGroups` over the binary wire.
#[napi(js_name = "findDuplicateGroupsWire")]
pub fn find_duplicate_groups_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let items: Vec<serde_json::Value> = r.list(|r| wire::read_value(r, S_FIND_DUPLICATE_GROUPS_0.inner()))?;
        let out = &port::find_duplicate_groups(items)?;
        w.tag(1); w.count(out.len()); for x0 in out.iter() { w.tag(1); w.count(x0.len()); for x1 in x0.iter() { w.string16(x1); } }
        Ok(())
    })
}

static S_RESOLVE_FILE_VIEWER_SPEC_OUT: wire::Schema = wire::Schema::Obj(&[("filename", wire::Schema::Str16), ("extension", wire::Schema::Str16), ("mimeType", wire::Schema::Str16), ("viewerMode", wire::Schema::Str16), ("viewerType", wire::Schema::Str16), ("canPreviewInApp", wire::Schema::Bool), ("canOpenInApp", wire::Schema::Bool), ("formatLabel", wire::Schema::Str16)]);

/// `resolveFileViewerSpec` over the binary wire.
#[napi(js_name = "resolveFileViewerSpecWire")]
pub fn resolve_file_viewer_spec_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let filename: String = r.string16()?;
        let out = &port::resolve_file_viewer_spec(filename)?;
        wire::write_value(w, out, &S_RESOLVE_FILE_VIEWER_SPEC_OUT)?;
        Ok(())
    })
}

static S_PARSE_DELIMITED_TEXT_TO_SHEET_OUT: wire::Schema = wire::Schema::Obj(&[("name", wire::Schema::Str16), ("headers", wire::Schema::List(&wire::Schema::Str16)), ("rows", wire::Schema::List(&wire::Schema::List(&wire::Schema::Str16))), ("allRows", wire::Schema::List(&wire::Schema::List(&wire::Schema::Str16))), ("totalRows", wire::Schema::Num)]);

/// `parseDelimitedTextToSheet` over the binary wire.
#[napi(js_name = "parseDelimitedTextToSheetWire")]
pub fn parse_delimited_text_to_sheet_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let text: String = r.string16()?;
        let delimiter: Option<String> = r.opt_js(|r| r.string16())?;
        let sheet_name: Option<String> = r.opt_js(|r| r.string16())?;
        let out = &port::parse_delimited_text_to_sheet(text, delimiter, sheet_name)?;
        wire::write_value(w, out, &S_PARSE_DELIMITED_TEXT_TO_SHEET_OUT)?;
        Ok(())
    })
}

static S_EMPTY_EXIF_METADATA_OUT: wire::Schema = wire::Schema::Obj(&[("make", wire::Schema::OptJs(&wire::Schema::Str16)), ("model", wire::Schema::OptJs(&wire::Schema::Str16)), ("camera", wire::Schema::OptJs(&wire::Schema::Str16)), ("dateTimeOriginal", wire::Schema::OptJs(&wire::Schema::Str16)), ("dateTimeOriginalMs", wire::Schema::OptJs(&wire::Schema::Num)), ("apertureFNumber", wire::Schema::OptJs(&wire::Schema::Num)), ("iso", wire::Schema::OptJs(&wire::Schema::Num)), ("exposureTimeSec", wire::Schema::OptJs(&wire::Schema::Num)), ("exposureTimeLabel", wire::Schema::OptJs(&wire::Schema::Str16)), ("focalLengthMm", wire::Schema::OptJs(&wire::Schema::Num)), ("latitude", wire::Schema::OptJs(&wire::Schema::Num)), ("longitude", wire::Schema::OptJs(&wire::Schema::Num)), ("altitudeM", wire::Schema::OptJs(&wire::Schema::Num)), ("hasGps", wire::Schema::Bool)]);

/// `emptyExifMetadata` over the binary wire.
#[napi(js_name = "emptyExifMetadataWire")]
pub fn empty_exif_metadata_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let out = &port::empty_exif_metadata()?;
        wire::write_value(w, out, &S_EMPTY_EXIF_METADATA_OUT)?;
        Ok(())
    })
}


/// `isExifParseableFilename` over the binary wire.
#[napi(js_name = "isExifParseableFilenameWire")]
pub fn is_exif_parseable_filename_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let filename: String = r.string16()?;
        let out = &port::is_exif_parseable_filename(filename)?;
        w.bool(*out);
        Ok(())
    })
}


/// `parseExifDateTimeMs` over the binary wire.
#[napi(js_name = "parseExifDateTimeMsWire")]
pub fn parse_exif_date_time_ms_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let raw: Option<String> = r.opt_js(|r| r.string16())?;
        let out = &port::parse_exif_date_time_ms(raw)?;
        match out { Some(x0) => { w.tag(1); w.f64(*x0); } None => w.tag(2) }
        Ok(())
    })
}

static S_PARSE_EXIF_FROM_JPEG_0: wire::Schema = wire::Schema::Dyn;
static S_PARSE_EXIF_FROM_JPEG_OUT: wire::Schema = wire::Schema::Obj(&[("make", wire::Schema::OptJs(&wire::Schema::Str16)), ("model", wire::Schema::OptJs(&wire::Schema::Str16)), ("camera", wire::Schema::OptJs(&wire::Schema::Str16)), ("dateTimeOriginal", wire::Schema::OptJs(&wire::Schema::Str16)), ("dateTimeOriginalMs", wire::Schema::OptJs(&wire::Schema::Num)), ("apertureFNumber", wire::Schema::OptJs(&wire::Schema::Num)), ("iso", wire::Schema::OptJs(&wire::Schema::Num)), ("exposureTimeSec", wire::Schema::OptJs(&wire::Schema::Num)), ("exposureTimeLabel", wire::Schema::OptJs(&wire::Schema::Str16)), ("focalLengthMm", wire::Schema::OptJs(&wire::Schema::Num)), ("latitude", wire::Schema::OptJs(&wire::Schema::Num)), ("longitude", wire::Schema::OptJs(&wire::Schema::Num)), ("altitudeM", wire::Schema::OptJs(&wire::Schema::Num)), ("hasGps", wire::Schema::Bool)]);

/// `parseExifFromJpeg` over the binary wire.
#[napi(js_name = "parseExifFromJpegWire")]
pub fn parse_exif_from_jpeg_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let buffer: serde_json::Value = wire::read_value(r, &S_PARSE_EXIF_FROM_JPEG_0)?;
        let out = &port::parse_exif_from_jpeg(buffer)?;
        wire::write_value(w, out, &S_PARSE_EXIF_FROM_JPEG_OUT)?;
        Ok(())
    })
}

static S_READ_CURRENT_ANDROID_RELEASE_VERSION_OUT: wire::Schema = wire::Schema::Obj(&[("versionName", wire::Schema::Str16), ("versionCode", wire::Schema::Num), ("tagName", wire::Schema::Str16), ("apkFilename", wire::Schema::Str16)]);

/// `readCurrentAndroidReleaseVersion` over the binary wire.
#[napi(js_name = "readCurrentAndroidReleaseVersionWire")]
pub fn read_current_android_release_version_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let root_dir: Option<String> = r.opt_js(|r| r.string16())?;
        let out = &port::read_current_android_release_version(root_dir)?;
        wire::write_value(w, out, &S_READ_CURRENT_ANDROID_RELEASE_VERSION_OUT)?;
        Ok(())
    })
}


/// `collectFilesToSync` over the binary wire.
#[napi(js_name = "collectFilesToSyncWire")]
pub fn collect_files_to_sync_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let root_dir: Option<String> = r.opt_js(|r| r.string16())?;
        let out = &port::collect_files_to_sync(root_dir)?;
        w.tag(1); w.count(out.len()); for x0 in out.iter() { w.string16(x0); }
        Ok(())
    })
}

static S_GROUP_MEDIA_ITEMS_0: wire::Schema = wire::Schema::List(&wire::Schema::Obj(&[("filename", wire::Schema::Str16), ("timestamp", wire::Schema::Num), ("size", wire::Schema::OptJs(&wire::Schema::Num)), ("isMedia", wire::Schema::OptJs(&wire::Schema::Bool)), ("category", wire::Schema::OptJs(&wire::Schema::Str16)), ("album", wire::Schema::OptJs(&wire::Schema::Str16)), ("hasThumb", wire::Schema::OptJs(&wire::Schema::Bool))]));
static S_GROUP_MEDIA_ITEMS_OUT: wire::Schema = wire::Schema::List(&wire::Schema::Obj(&[("title", wire::Schema::Str16), ("items", wire::Schema::List(&wire::Schema::Obj(&[("filename", wire::Schema::Str16), ("timestamp", wire::Schema::Num), ("size", wire::Schema::OptJs(&wire::Schema::Num)), ("isMedia", wire::Schema::OptJs(&wire::Schema::Bool)), ("category", wire::Schema::Dyn), ("album", wire::Schema::OptJs(&wire::Schema::Str16)), ("hasThumb", wire::Schema::OptJs(&wire::Schema::Bool))])))]));

/// `groupMediaItems` over the binary wire.
#[napi(js_name = "groupMediaItemsWire")]
pub fn group_media_items_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let items: Vec<serde_json::Value> = r.list(|r| wire::read_value(r, S_GROUP_MEDIA_ITEMS_0.inner()))?;
        let level: String = r.string16()?;
        let out = &port::group_media_items(items, level)?;
        w.tag(1); w.count(out.len()); for x0 in out.iter() { wire::write_value(w, x0, S_GROUP_MEDIA_ITEMS_OUT.inner())?; }
        Ok(())
    })
}


/// `isVideoFilename` over the binary wire.
#[napi(js_name = "isVideoFilenameWire")]
pub fn is_video_filename_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let filename: String = r.string16()?;
        let out = &port::is_video_filename(filename)?;
        w.bool(*out);
        Ok(())
    })
}

static S_NORMALIZE_SHA256_HEX_0: wire::Schema = wire::Schema::Dyn;

/// `normalizeSha256Hex` over the binary wire.
#[napi(js_name = "normalizeSha256HexWire")]
pub fn normalize_sha256_hex_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let raw: serde_json::Value = wire::read_value(r, &S_NORMALIZE_SHA256_HEX_0)?;
        let out = &port::normalize_sha256_hex(raw)?;
        match out { Some(x0) => { w.tag(1); w.string16(x0); } None => w.tag(2) }
        Ok(())
    })
}


/// `cleanupOrphanTempFiles` over the binary wire.
#[napi(js_name = "cleanupOrphanTempFilesWire")]
pub fn cleanup_orphan_temp_files_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let temp_upload_dir: String = r.string16()?;
        let options: Option<serde_json::Value> = wire::read_dyn_opt(r)?;
        let out = &port::cleanup_orphan_temp_files(temp_upload_dir, options)?;
        w.f64(*out);
        Ok(())
    })
}

static S_SANITIZE_HEX_COLOR_0: wire::Schema = wire::Schema::Dyn;

/// `sanitizeHexColor` over the binary wire.
#[napi(js_name = "sanitizeHexColorWire")]
pub fn sanitize_hex_color_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let val: serde_json::Value = wire::read_value(r, &S_SANITIZE_HEX_COLOR_0)?;
        let fallback: String = r.string16()?;
        let out = &port::sanitize_hex_color(val, fallback)?;
        w.string16(out);
        Ok(())
    })
}

static S_HEX_TO_RGB_TUPLE_OUT: wire::Schema = wire::Schema::Dyn;

/// `hexToRgbTuple` over the binary wire.
#[napi(js_name = "hexToRgbTupleWire")]
pub fn hex_to_rgb_tuple_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let hex: String = r.string16()?;
        let out = &port::hex_to_rgb_tuple(hex)?;
        wire::write_value(w, out, &S_HEX_TO_RGB_TUPLE_OUT)?;
        Ok(())
    })
}

static S_SANITIZE_LIQUID_GLASS_CONFIG_OUT: wire::Schema = wire::Schema::Obj(&[("glassIntensity", wire::Schema::Num), ("transparency", wire::Schema::Num), ("opacity", wire::Schema::Num), ("blurRadius", wire::Schema::Num), ("backdropSaturation", wire::Schema::Num), ("brightness", wire::Schema::Num), ("contrast", wire::Schema::Num), ("visualDepth", wire::Schema::Num), ("primaryColor", wire::Schema::Str16), ("secondaryColor", wire::Schema::Str16), ("glassColor", wire::Schema::Str16), ("surfaceToneColor", wire::Schema::Str16), ("borderColor", wire::Schema::Str16), ("iconColor", wire::Schema::Str16), ("textColor", wire::Schema::Str16), ("accentColor", wire::Schema::Str16), ("useCustomColors", wire::Schema::Bool), ("specularHighlights", wire::Schema::Bool), ("highlightIntensity", wire::Schema::Num), ("luminousBorders", wire::Schema::Bool), ("borderGlowIntensity", wire::Schema::Num), ("surfaceGradient", wire::Schema::Bool), ("gradientAngle", wire::Schema::Num), ("shadowsEnabled", wire::Schema::Bool), ("shadowIntensity", wire::Schema::Num), ("depthEffect", wire::Schema::Bool), ("refractionIntensity", wire::Schema::Num), ("animationsEnabled", wire::Schema::Bool), ("animationIntensity", wire::Schema::Num), ("componentCornerRadius", wire::Schema::Num), ("navBarGlassStyle", wire::Schema::Str16), ("cardGlassStyle", wire::Schema::Str16)]);

/// `sanitizeLiquidGlassConfig` over the binary wire.
#[napi(js_name = "sanitizeLiquidGlassConfigWire")]
pub fn sanitize_liquid_glass_config_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let raw: Option<serde_json::Value> = wire::read_dyn_opt(r)?;
        let out = &port::sanitize_liquid_glass_config(raw)?;
        wire::write_value(w, out, &S_SANITIZE_LIQUID_GLASS_CONFIG_OUT)?;
        Ok(())
    })
}

static S_COMPUTE_LIQUID_GLASS_CSS_VARIABLES_0: wire::Schema = wire::Schema::Dyn;
static S_COMPUTE_LIQUID_GLASS_CSS_VARIABLES_OUT: wire::Schema = wire::Schema::Map16(&wire::Schema::Str16);

/// `computeLiquidGlassCssVariables` over the binary wire.
#[napi(js_name = "computeLiquidGlassCssVariablesWire")]
pub fn compute_liquid_glass_css_variables_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let raw_config: serde_json::Value = wire::read_value(r, &S_COMPUTE_LIQUID_GLASS_CSS_VARIABLES_0)?;
        let is_dark_mode: Option<bool> = r.opt_js(|r| r.bool())?;
        let out = &port::compute_liquid_glass_css_variables(raw_config, is_dark_mode)?;
        wire::write_value(w, out, &S_COMPUTE_LIQUID_GLASS_CSS_VARIABLES_OUT)?;
        Ok(())
    })
}

static S_EXPORT_LIQUID_GLASS_CONFIG_JSON_0: wire::Schema = wire::Schema::Dyn;

/// `exportLiquidGlassConfigJson` over the binary wire.
#[napi(js_name = "exportLiquidGlassConfigJsonWire")]
pub fn export_liquid_glass_config_json_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let config: serde_json::Value = wire::read_value(r, &S_EXPORT_LIQUID_GLASS_CONFIG_JSON_0)?;
        let out = &port::export_liquid_glass_config_json(config)?;
        w.string16(out);
        Ok(())
    })
}

static S_IMPORT_LIQUID_GLASS_CONFIG_JSON_OUT: wire::Schema = wire::Schema::OptJs(&wire::Schema::Obj(&[("glassIntensity", wire::Schema::Num), ("transparency", wire::Schema::Num), ("opacity", wire::Schema::Num), ("blurRadius", wire::Schema::Num), ("backdropSaturation", wire::Schema::Num), ("brightness", wire::Schema::Num), ("contrast", wire::Schema::Num), ("visualDepth", wire::Schema::Num), ("primaryColor", wire::Schema::Str16), ("secondaryColor", wire::Schema::Str16), ("glassColor", wire::Schema::Str16), ("surfaceToneColor", wire::Schema::Str16), ("borderColor", wire::Schema::Str16), ("iconColor", wire::Schema::Str16), ("textColor", wire::Schema::Str16), ("accentColor", wire::Schema::Str16), ("useCustomColors", wire::Schema::Bool), ("specularHighlights", wire::Schema::Bool), ("highlightIntensity", wire::Schema::Num), ("luminousBorders", wire::Schema::Bool), ("borderGlowIntensity", wire::Schema::Num), ("surfaceGradient", wire::Schema::Bool), ("gradientAngle", wire::Schema::Num), ("shadowsEnabled", wire::Schema::Bool), ("shadowIntensity", wire::Schema::Num), ("depthEffect", wire::Schema::Bool), ("refractionIntensity", wire::Schema::Num), ("animationsEnabled", wire::Schema::Bool), ("animationIntensity", wire::Schema::Num), ("componentCornerRadius", wire::Schema::Num), ("navBarGlassStyle", wire::Schema::Str16), ("cardGlassStyle", wire::Schema::Str16)]));

/// `importLiquidGlassConfigJson` over the binary wire.
#[napi(js_name = "importLiquidGlassConfigJsonWire")]
pub fn import_liquid_glass_config_json_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let json_text: String = r.string16()?;
        let out = &port::import_liquid_glass_config_json(json_text)?;
        match out { Some(x0) => { w.tag(1); wire::write_value(w, x0, S_IMPORT_LIQUID_GLASS_CONFIG_JSON_OUT.inner())?; } None => w.tag(2) }
        Ok(())
    })
}


/// `renderMapPage` over the binary wire.
#[napi(js_name = "renderMapPageWire")]
pub fn render_map_page_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let username: String = r.string16()?;
        let out = &port::render_map_page(username)?;
        w.string16(out);
        Ok(())
    })
}

static S_PARSE_NATURAL_QUERY_OUT: wire::Schema = wire::Schema::Obj(&[("textTokens", wire::Schema::List(&wire::Schema::Str16)), ("years", wire::Schema::List(&wire::Schema::Num)), ("months", wire::Schema::List(&wire::Schema::Num)), ("days", wire::Schema::List(&wire::Schema::Num)), ("dateFrom", wire::Schema::OptJs(&wire::Schema::Num)), ("dateTo", wire::Schema::OptJs(&wire::Schema::Num)), ("mediaType", wire::Schema::OptJs(&wire::Schema::Str16)), ("favoritesOnly", wire::Schema::Bool), ("albums", wire::Schema::List(&wire::Schema::Str16)), ("explanation", wire::Schema::List(&wire::Schema::Str16))]);

/// `parseNaturalQuery` over the binary wire.
#[napi(js_name = "parseNaturalQueryWire")]
pub fn parse_natural_query_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let raw_query: String = r.string16()?;
        let now: Option<serde_json::Value> = wire::read_dyn_opt(r)?;
        let out = &port::parse_natural_query(raw_query, now)?;
        wire::write_value(w, out, &S_PARSE_NATURAL_QUERY_OUT)?;
        Ok(())
    })
}

static S_MEDIA_ITEM_MATCHES_QUERY_0: wire::Schema = wire::Schema::Dyn;
static S_MEDIA_ITEM_MATCHES_QUERY_1: wire::Schema = wire::Schema::Dyn;

/// `mediaItemMatchesQuery` over the binary wire.
#[napi(js_name = "mediaItemMatchesQueryWire")]
pub fn media_item_matches_query_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let item: serde_json::Value = wire::read_value(r, &S_MEDIA_ITEM_MATCHES_QUERY_0)?;
        let q: serde_json::Value = wire::read_value(r, &S_MEDIA_ITEM_MATCHES_QUERY_1)?;
        let favorites: Option<serde_json::Value> = wire::read_dyn_opt(r)?;
        let out = &port::media_item_matches_query(item, q, favorites)?;
        w.bool(*out);
        Ok(())
    })
}

static S_SEARCH_MEDIA_ITEMS_0: wire::Schema = wire::Schema::List(&wire::Schema::Obj(&[("filename", wire::Schema::Str16), ("timestamp", wire::Schema::Num), ("isMedia", wire::Schema::Bool), ("album", wire::Schema::OptJs(&wire::Schema::Str16))]));
static S_SEARCH_MEDIA_ITEMS_OUT: wire::Schema = wire::Schema::Obj(&[("query", wire::Schema::Obj(&[("textTokens", wire::Schema::List(&wire::Schema::Str16)), ("years", wire::Schema::List(&wire::Schema::Num)), ("months", wire::Schema::List(&wire::Schema::Num)), ("days", wire::Schema::List(&wire::Schema::Num)), ("dateFrom", wire::Schema::OptJs(&wire::Schema::Num)), ("dateTo", wire::Schema::OptJs(&wire::Schema::Num)), ("mediaType", wire::Schema::OptJs(&wire::Schema::Str16)), ("favoritesOnly", wire::Schema::Bool), ("albums", wire::Schema::List(&wire::Schema::Str16)), ("explanation", wire::Schema::List(&wire::Schema::Str16))])), ("results", wire::Schema::List(&wire::Schema::Obj(&[("filename", wire::Schema::Str16), ("timestamp", wire::Schema::Num), ("isMedia", wire::Schema::Bool), ("album", wire::Schema::OptJs(&wire::Schema::Str16))])))]);

/// `searchMediaItems` over the binary wire.
#[napi(js_name = "searchMediaItemsWire")]
pub fn search_media_items_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let items: Vec<serde_json::Value> = r.list(|r| wire::read_value(r, S_SEARCH_MEDIA_ITEMS_0.inner()))?;
        let raw_query: String = r.string16()?;
        let favorites: Option<serde_json::Value> = wire::read_dyn_opt(r)?;
        let now: Option<serde_json::Value> = wire::read_dyn_opt(r)?;
        let out = &port::search_media_items(items, raw_query, favorites, now)?;
        wire::write_value(w, out, &S_SEARCH_MEDIA_ITEMS_OUT)?;
        Ok(())
    })
}


/// `getProtectedSigningDir` over the binary wire.
#[napi(js_name = "getProtectedSigningDirWire")]
pub fn get_protected_signing_dir_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let home_dir: Option<serde_json::Value> = wire::read_dyn_opt(r)?;
        let out = &port::get_protected_signing_dir(home_dir)?;
        w.string16(out);
        Ok(())
    })
}


/// `getProtectedSigningPropertiesPath` over the binary wire.
#[napi(js_name = "getProtectedSigningPropertiesPathWire")]
pub fn get_protected_signing_properties_path_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let env: Option<serde_json::Value> = wire::read_dyn_opt(r)?;
        let home_dir: Option<serde_json::Value> = wire::read_dyn_opt(r)?;
        let out = &port::get_protected_signing_properties_path(env, home_dir)?;
        w.string16(out);
        Ok(())
    })
}

static S_PARSE_SIGNING_PROPERTIES_OUT: wire::Schema = wire::Schema::Map16(&wire::Schema::Str16);

/// `parseSigningProperties` over the binary wire.
#[napi(js_name = "parseSigningPropertiesWire")]
pub fn parse_signing_properties_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let content: String = r.string16()?;
        let out = &port::parse_signing_properties(content)?;
        wire::write_value(w, out, &S_PARSE_SIGNING_PROPERTIES_OUT)?;
        Ok(())
    })
}

static S_SERIALIZE_SIGNING_PROPERTIES_0: wire::Schema = wire::Schema::Dyn;

/// `serializeSigningProperties` over the binary wire.
#[napi(js_name = "serializeSigningPropertiesWire")]
pub fn serialize_signing_properties_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let cfg: serde_json::Value = wire::read_value(r, &S_SERIALIZE_SIGNING_PROPERTIES_0)?;
        let out = &port::serialize_signing_properties(cfg)?;
        w.string16(out);
        Ok(())
    })
}


/// `enforceProtectedPermissions` over the binary wire.
#[napi(js_name = "enforceProtectedPermissionsWire")]
pub fn enforce_protected_permissions_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let target_path: String = r.string16()?;
        let is_directory: bool = r.bool()?;
        let () = port::enforce_protected_permissions(target_path, is_directory)?;
        Ok(())
    })
}


/// `readSigningPropertiesFile` over the binary wire.
#[napi(js_name = "readSigningPropertiesFileWire")]
pub fn read_signing_properties_file_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let file_path: String = r.string16()?;
        let out = &port::read_signing_properties_file(file_path)?;
        wire::write_dyn(w, &serde_json::to_value(out).map_err(|e| e.to_string())?);
        Ok(())
    })
}

static S_WRITE_PROTECTED_SIGNING_PROPERTIES_1: wire::Schema = wire::Schema::Dyn;

/// `writeProtectedSigningProperties` over the binary wire.
#[napi(js_name = "writeProtectedSigningPropertiesWire")]
pub fn write_protected_signing_properties_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let file_path: String = r.string16()?;
        let cfg: serde_json::Value = wire::read_value(r, &S_WRITE_PROTECTED_SIGNING_PROPERTIES_1)?;
        let () = port::write_protected_signing_properties(file_path, cfg)?;
        Ok(())
    })
}


/// `computePkcs12CertSha256WithOpenSsl` over the binary wire.
#[napi(js_name = "computePkcs12CertSha256WithOpenSslWire")]
pub fn compute_pkcs12_cert_sha256_with_open_ssl_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let p12_path: String = r.string16()?;
        let password: String = r.string16()?;
        let out = &port::compute_pkcs12_cert_sha256_with_open_ssl(p12_path, password)?;
        w.string16(out);
        Ok(())
    })
}

static S_CREATE_PERSISTENT_PKCS12_KEYSTORE_OUT: wire::Schema = wire::Schema::Obj(&[("storeFile", wire::Schema::Str16), ("storePassword", wire::Schema::Str16), ("keyAlias", wire::Schema::Str16), ("keyPassword", wire::Schema::Str16), ("storeType", wire::Schema::Str16), ("certSha256", wire::Schema::OptJs(&wire::Schema::Str16)), ("createdAt", wire::Schema::OptJs(&wire::Schema::Str16))]);

/// `createPersistentPkcs12Keystore` over the binary wire.
#[napi(js_name = "createPersistentPkcs12KeystoreWire")]
pub fn create_persistent_pkcs12_keystore_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let target_path: String = r.string16()?;
        let password: String = r.string16()?;
        let alias: Option<serde_json::Value> = wire::read_dyn_opt(r)?;
        let out = &port::create_persistent_pkcs12_keystore(target_path, password, alias)?;
        wire::write_value(w, out, &S_CREATE_PERSISTENT_PKCS12_KEYSTORE_OUT)?;
        Ok(())
    })
}

static S_APPLY_SIGNING_ENV_FROM_PROTECTED_CONFIG_OUT: wire::Schema = wire::Schema::Obj(&[("source", wire::Schema::Str16), ("propertiesPath", wire::Schema::Str16), ("config", wire::Schema::OptJs(&wire::Schema::Obj(&[("storeFile", wire::Schema::Str16), ("storePassword", wire::Schema::Str16), ("keyAlias", wire::Schema::Str16), ("keyPassword", wire::Schema::Str16), ("storeType", wire::Schema::Str16), ("certSha256", wire::Schema::OptJs(&wire::Schema::Str16)), ("createdAt", wire::Schema::OptJs(&wire::Schema::Str16))])))]);

/// `applySigningEnvFromProtectedConfig` over the binary wire.
#[napi(js_name = "applySigningEnvFromProtectedConfigWire")]
pub fn apply_signing_env_from_protected_config_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let options: Option<serde_json::Value> = wire::read_dyn_opt(r)?;
        let out = &port::apply_signing_env_from_protected_config(options)?;
        wire::write_value(w, out, &S_APPLY_SIGNING_ENV_FROM_PROTECTED_CONFIG_OUT)?;
        Ok(())
    })
}

static S_ENSURE_PERSISTENT_LOCAL_SIGNING_OUT: wire::Schema = wire::Schema::Obj(&[("source", wire::Schema::Str16), ("propertiesPath", wire::Schema::Str16), ("config", wire::Schema::OptJs(&wire::Schema::Obj(&[("storeFile", wire::Schema::Str16), ("storePassword", wire::Schema::Str16), ("keyAlias", wire::Schema::Str16), ("keyPassword", wire::Schema::Str16), ("storeType", wire::Schema::Str16), ("certSha256", wire::Schema::OptJs(&wire::Schema::Str16)), ("createdAt", wire::Schema::OptJs(&wire::Schema::Str16))])))]);

/// `ensurePersistentLocalSigning` over the binary wire.
#[napi(js_name = "ensurePersistentLocalSigningWire")]
pub fn ensure_persistent_local_signing_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let options: Option<serde_json::Value> = wire::read_dyn_opt(r)?;
        let out = &port::ensure_persistent_local_signing(options)?;
        wire::write_value(w, out, &S_ENSURE_PERSISTENT_LOCAL_SIGNING_OUT)?;
        Ok(())
    })
}


/// `isPHashSupportedFilename` over the binary wire.
#[napi(js_name = "isPHashSupportedFilenameWire")]
pub fn is_p_hash_supported_filename_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let filename: String = r.string16()?;
        let out = &port::is_p_hash_supported_filename(filename)?;
        w.bool(*out);
        Ok(())
    })
}

static S_DCT_P_HASH_FROM_GRAY_PIXELS_0: wire::Schema = wire::Schema::Dyn;
static S_DCT_P_HASH_FROM_GRAY_PIXELS_OUT: wire::Schema = wire::Schema::Dyn;

/// `dctPHashFromGrayPixels` over the binary wire.
#[napi(js_name = "dctPHashFromGrayPixelsWire")]
pub fn dct_p_hash_from_gray_pixels_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let gray: serde_json::Value = wire::read_value(r, &S_DCT_P_HASH_FROM_GRAY_PIXELS_0)?;
        let size: Option<f64> = r.opt_js(|r| r.f64())?;
        let low_freq: Option<f64> = r.opt_js(|r| r.f64())?;
        let out = &port::dct_p_hash_from_gray_pixels(gray, size, low_freq)?;
        wire::write_value(w, out, &S_DCT_P_HASH_FROM_GRAY_PIXELS_OUT)?;
        Ok(())
    })
}

static S_P_HASH_TO_HEX_0: wire::Schema = wire::Schema::Dyn;

/// `pHashToHex` over the binary wire.
#[napi(js_name = "pHashToHexWire")]
pub fn p_hash_to_hex_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let hash: serde_json::Value = wire::read_value(r, &S_P_HASH_TO_HEX_0)?;
        let out = &port::p_hash_to_hex(hash)?;
        w.string16(out);
        Ok(())
    })
}

static S_HEX_TO_P_HASH_OUT: wire::Schema = wire::Schema::Dyn;

/// `hexToPHash` over the binary wire.
#[napi(js_name = "hexToPHashWire")]
pub fn hex_to_p_hash_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let hex: String = r.string16()?;
        let out = &port::hex_to_p_hash(hex)?;
        wire::write_value(w, out, &S_HEX_TO_P_HASH_OUT)?;
        Ok(())
    })
}


/// `hammingDistanceHex` over the binary wire.
#[napi(js_name = "hammingDistanceHexWire")]
pub fn hamming_distance_hex_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let a: String = r.string16()?;
        let b: String = r.string16()?;
        let out = &port::hamming_distance_hex(a, b)?;
        w.f64(*out);
        Ok(())
    })
}

static S_GROUP_SIMILAR_BY_HASH_0: wire::Schema = wire::Schema::List(&wire::Schema::Obj(&[("filename", wire::Schema::Str16), ("phash", wire::Schema::Str16)]));
static S_GROUP_SIMILAR_BY_HASH_OUT: wire::Schema = wire::Schema::List(&wire::Schema::List(&wire::Schema::Obj(&[("filename", wire::Schema::Str16), ("phash", wire::Schema::Str16)])));

/// `groupSimilarByHash` over the binary wire.
#[napi(js_name = "groupSimilarByHashWire")]
pub fn group_similar_by_hash_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let entries: Vec<serde_json::Value> = r.list(|r| wire::read_value(r, S_GROUP_SIMILAR_BY_HASH_0.inner()))?;
        let max_distance: Option<f64> = r.opt_js(|r| r.f64())?;
        let out = &port::group_similar_by_hash(entries, max_distance)?;
        w.tag(1); w.count(out.len()); for x0 in out.iter() { w.tag(1); w.count(x0.len()); for x1 in x0.iter() { wire::write_value(w, x1, S_GROUP_SIMILAR_BY_HASH_OUT.inner().inner())?; } }
        Ok(())
    })
}

static S_APPLY_PRESET_TO_EDIT_STATE_0: wire::Schema = wire::Schema::Dyn;
static S_APPLY_PRESET_TO_EDIT_STATE_OUT: wire::Schema = wire::Schema::Obj(&[("brightness", wire::Schema::Num), ("contrast", wire::Schema::Num), ("saturation", wire::Schema::Num), ("warmth", wire::Schema::Num), ("rotation", wire::Schema::Num), ("flipH", wire::Schema::Bool), ("flipV", wire::Schema::Bool), ("cropAspect", wire::Schema::Str16), ("cropBox", wire::Schema::Obj(&[("left", wire::Schema::Num), ("top", wire::Schema::Num), ("right", wire::Schema::Num), ("bottom", wire::Schema::Num)])), ("filterPreset", wire::Schema::Str16)]);

/// `applyPresetToEditState` over the binary wire.
#[napi(js_name = "applyPresetToEditStateWire")]
pub fn apply_preset_to_edit_state_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let current: serde_json::Value = wire::read_value(r, &S_APPLY_PRESET_TO_EDIT_STATE_0)?;
        let preset_id: String = r.string16()?;
        let out = &port::apply_preset_to_edit_state(current, preset_id)?;
        wire::write_value(w, out, &S_APPLY_PRESET_TO_EDIT_STATE_OUT)?;
        Ok(())
    })
}


/// `normalizeRotation` over the binary wire.
#[napi(js_name = "normalizeRotationWire")]
pub fn normalize_rotation_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let deg: f64 = r.f64()?;
        let out = &port::normalize_rotation(deg)?;
        w.f64(*out);
        Ok(())
    })
}

static S_CLAMP_NORMALIZED_CROP_BOX_0: wire::Schema = wire::Schema::Dyn;
static S_CLAMP_NORMALIZED_CROP_BOX_OUT: wire::Schema = wire::Schema::Obj(&[("left", wire::Schema::Num), ("top", wire::Schema::Num), ("right", wire::Schema::Num), ("bottom", wire::Schema::Num)]);

/// `clampNormalizedCropBox` over the binary wire.
#[napi(js_name = "clampNormalizedCropBoxWire")]
pub fn clamp_normalized_crop_box_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let box: serde_json::Value = wire::read_value(r, &S_CLAMP_NORMALIZED_CROP_BOX_0)?;
        let min_span: Option<f64> = r.opt_js(|r| r.f64())?;
        let out = &port::clamp_normalized_crop_box(box, min_span)?;
        wire::write_value(w, out, &S_CLAMP_NORMALIZED_CROP_BOX_OUT)?;
        Ok(())
    })
}

static S_FIT_ASPECT_NORMALIZED_CROP_BOX_OUT: wire::Schema = wire::Schema::Obj(&[("left", wire::Schema::Num), ("top", wire::Schema::Num), ("right", wire::Schema::Num), ("bottom", wire::Schema::Num)]);

/// `fitAspectNormalizedCropBox` over the binary wire.
#[napi(js_name = "fitAspectNormalizedCropBoxWire")]
pub fn fit_aspect_normalized_crop_box_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let src_width: f64 = r.f64()?;
        let src_height: f64 = r.f64()?;
        let aspect: String = r.string16()?;
        let out = &port::fit_aspect_normalized_crop_box(src_width, src_height, aspect)?;
        wire::write_value(w, out, &S_FIT_ASPECT_NORMALIZED_CROP_BOX_OUT)?;
        Ok(())
    })
}

static S_DRAG_NORMALIZED_CROP_HANDLE_0: wire::Schema = wire::Schema::Dyn;
static S_DRAG_NORMALIZED_CROP_HANDLE_OUT: wire::Schema = wire::Schema::Obj(&[("left", wire::Schema::Num), ("top", wire::Schema::Num), ("right", wire::Schema::Num), ("bottom", wire::Schema::Num)]);

/// `dragNormalizedCropHandle` over the binary wire.
#[napi(js_name = "dragNormalizedCropHandleWire")]
pub fn drag_normalized_crop_handle_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let start_box: serde_json::Value = wire::read_value(r, &S_DRAG_NORMALIZED_CROP_HANDLE_0)?;
        let handle: String = r.string16()?;
        let dx_norm: f64 = r.f64()?;
        let dy_norm: f64 = r.f64()?;
        let aspect: Option<String> = r.opt_js(|r| r.string16())?;
        let src_width: Option<f64> = r.opt_js(|r| r.f64())?;
        let src_height: Option<f64> = r.opt_js(|r| r.f64())?;
        let min_span: Option<f64> = r.opt_js(|r| r.f64())?;
        let out = &port::drag_normalized_crop_handle(start_box, handle, dx_norm, dy_norm, aspect, src_width, src_height, min_span)?;
        wire::write_value(w, out, &S_DRAG_NORMALIZED_CROP_HANDLE_OUT)?;
        Ok(())
    })
}

static S_NORMALIZED_BOX_TO_PIXEL_RECT_2: wire::Schema = wire::Schema::Dyn;
static S_NORMALIZED_BOX_TO_PIXEL_RECT_OUT: wire::Schema = wire::Schema::Obj(&[("x", wire::Schema::Num), ("y", wire::Schema::Num), ("width", wire::Schema::Num), ("height", wire::Schema::Num)]);

/// `normalizedBoxToPixelRect` over the binary wire.
#[napi(js_name = "normalizedBoxToPixelRectWire")]
pub fn normalized_box_to_pixel_rect_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let src_width: f64 = r.f64()?;
        let src_height: f64 = r.f64()?;
        let box: serde_json::Value = wire::read_value(r, &S_NORMALIZED_BOX_TO_PIXEL_RECT_2)?;
        let out = &port::normalized_box_to_pixel_rect(src_width, src_height, box)?;
        wire::write_value(w, out, &S_NORMALIZED_BOX_TO_PIXEL_RECT_OUT)?;
        Ok(())
    })
}

static S_COMPUTE_CROP_RECT_OUT: wire::Schema = wire::Schema::Obj(&[("x", wire::Schema::Num), ("y", wire::Schema::Num), ("width", wire::Schema::Num), ("height", wire::Schema::Num)]);

/// `computeCropRect` over the binary wire.
#[napi(js_name = "computeCropRectWire")]
pub fn compute_crop_rect_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let src_width: f64 = r.f64()?;
        let src_height: f64 = r.f64()?;
        let aspect: String = r.string16()?;
        let out = &port::compute_crop_rect(src_width, src_height, aspect)?;
        wire::write_value(w, out, &S_COMPUTE_CROP_RECT_OUT)?;
        Ok(())
    })
}


/// `clampByte` over the binary wire.
#[napi(js_name = "clampByteWire")]
pub fn clamp_byte_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let val: f64 = r.f64()?;
        let out = &port::clamp_byte(val)?;
        w.f64(*out);
        Ok(())
    })
}

static S_TRANSFORM_RGB_PIXEL_3: wire::Schema = wire::Schema::Dyn;
static S_TRANSFORM_RGB_PIXEL_OUT: wire::Schema = wire::Schema::Dyn;

/// `transformRgbPixel` over the binary wire.
#[napi(js_name = "transformRgbPixelWire")]
pub fn transform_rgb_pixel_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let r: f64 = r.f64()?;
        let g: f64 = r.f64()?;
        let b: f64 = r.f64()?;
        let state: serde_json::Value = wire::read_value(r, &S_TRANSFORM_RGB_PIXEL_3)?;
        let out = &port::transform_rgb_pixel(r, g, b, state)?;
        wire::write_value(w, out, &S_TRANSFORM_RGB_PIXEL_OUT)?;
        Ok(())
    })
}

static S_CLAMP_TRIM_RANGE_OUT: wire::Schema = wire::Schema::Obj(&[("trimStartSec", wire::Schema::Num), ("trimEndSec", wire::Schema::Num), ("trimmedDurationSec", wire::Schema::Num)]);

/// `clampTrimRange` over the binary wire.
#[napi(js_name = "clampTrimRangeWire")]
pub fn clamp_trim_range_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let start_sec: f64 = r.f64()?;
        let end_sec: f64 = r.f64()?;
        let duration_sec: f64 = r.f64()?;
        let min_clip_sec: Option<f64> = r.opt_js(|r| r.f64())?;
        let out = &port::clamp_trim_range(start_sec, end_sec, duration_sec, min_clip_sec)?;
        wire::write_value(w, out, &S_CLAMP_TRIM_RANGE_OUT)?;
        Ok(())
    })
}


/// `formatMediaDuration` over the binary wire.
#[napi(js_name = "formatMediaDurationWire")]
pub fn format_media_duration_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let seconds: f64 = r.f64()?;
        let with_tenths: Option<bool> = r.opt_js(|r| r.bool())?;
        let out = &port::format_media_duration(seconds, with_tenths)?;
        w.string16(out);
        Ok(())
    })
}

static S_BUILD_CSS_FILTER_STRING_0: wire::Schema = wire::Schema::Dyn;

/// `buildCssFilterString` over the binary wire.
#[napi(js_name = "buildCssFilterStringWire")]
pub fn build_css_filter_string_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let state: serde_json::Value = wire::read_value(r, &S_BUILD_CSS_FILTER_STRING_0)?;
        let out = &port::build_css_filter_string(state)?;
        w.string16(out);
        Ok(())
    })
}

static S_COMPUTE_FITTED_MEDIA_SIZE_OUT: wire::Schema = wire::Schema::Obj(&[("width", wire::Schema::Num), ("height", wire::Schema::Num)]);

/// `computeFittedMediaSize` over the binary wire.
#[napi(js_name = "computeFittedMediaSizeWire")]
pub fn compute_fitted_media_size_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let viewport_width: f64 = r.f64()?;
        let viewport_height: f64 = r.f64()?;
        let media_width: Option<f64> = r.opt_js(|r| r.f64())?;
        let media_height: Option<f64> = r.opt_js(|r| r.f64())?;
        let out = &port::compute_fitted_media_size(viewport_width, viewport_height, media_width, media_height)?;
        wire::write_value(w, out, &S_COMPUTE_FITTED_MEDIA_SIZE_OUT)?;
        Ok(())
    })
}

static S_CLAMP_ZOOM_PAN_OUT: wire::Schema = wire::Schema::Obj(&[("scale", wire::Schema::Num), ("panX", wire::Schema::Num), ("panY", wire::Schema::Num)]);

/// `clampZoomPan` over the binary wire.
#[napi(js_name = "clampZoomPanWire")]
pub fn clamp_zoom_pan_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let scale: f64 = r.f64()?;
        let pan_x: f64 = r.f64()?;
        let pan_y: f64 = r.f64()?;
        let viewport_width: f64 = r.f64()?;
        let viewport_height: f64 = r.f64()?;
        let min_scale: Option<f64> = r.opt_js(|r| r.f64())?;
        let max_scale: Option<f64> = r.opt_js(|r| r.f64())?;
        let media_width: Option<f64> = r.opt_js(|r| r.f64())?;
        let media_height: Option<f64> = r.opt_js(|r| r.f64())?;
        let out = &port::clamp_zoom_pan(scale, pan_x, pan_y, viewport_width, viewport_height, min_scale, max_scale, media_width, media_height)?;
        wire::write_value(w, out, &S_CLAMP_ZOOM_PAN_OUT)?;
        Ok(())
    })
}

static S_COMPUTE_PINCH_ZOOM_PAN_0: wire::Schema = wire::Schema::Dyn;
static S_COMPUTE_PINCH_ZOOM_PAN_OUT: wire::Schema = wire::Schema::Obj(&[("scale", wire::Schema::Num), ("panX", wire::Schema::Num), ("panY", wire::Schema::Num)]);

/// `computePinchZoomPan` over the binary wire.
#[napi(js_name = "computePinchZoomPanWire")]
pub fn compute_pinch_zoom_pan_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let input: serde_json::Value = wire::read_value(r, &S_COMPUTE_PINCH_ZOOM_PAN_0)?;
        let out = &port::compute_pinch_zoom_pan(input)?;
        wire::write_value(w, out, &S_COMPUTE_PINCH_ZOOM_PAN_OUT)?;
        Ok(())
    })
}


/// `getVapidPublicKey` over the binary wire.
#[napi(js_name = "getVapidPublicKeyWire")]
pub fn get_vapid_public_key_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let out = &port::get_vapid_public_key()?;
        match out { Some(x0) => { w.tag(1); w.string16(x0); } None => w.tag(2) }
        Ok(())
    })
}


/// `getUserPushPath` over the binary wire.
#[napi(js_name = "getUserPushPathWire")]
pub fn get_user_push_path_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let user_folder: String = r.string16()?;
        let out = &port::get_user_push_path(user_folder)?;
        w.string16(out);
        Ok(())
    })
}

static S_LOAD_USER_SUBSCRIPTIONS_OUT: wire::Schema = wire::Schema::List(&wire::Schema::Obj(&[("endpoint", wire::Schema::Str16), ("keys", wire::Schema::Obj(&[("p256dh", wire::Schema::Str16), ("auth", wire::Schema::Str16)])), ("userAgent", wire::Schema::OptJs(&wire::Schema::Str16)), ("createdAt", wire::Schema::Num)]));

/// `loadUserSubscriptions` over the binary wire.
#[napi(js_name = "loadUserSubscriptionsWire")]
pub fn load_user_subscriptions_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let user_folder: String = r.string16()?;
        let out = &port::load_user_subscriptions(user_folder)?;
        w.tag(1); w.count(out.len()); for x0 in out.iter() { wire::write_value(w, x0, S_LOAD_USER_SUBSCRIPTIONS_OUT.inner())?; }
        Ok(())
    })
}

static S_SAVE_USER_SUBSCRIPTIONS_1: wire::Schema = wire::Schema::List(&wire::Schema::Obj(&[("endpoint", wire::Schema::Str16), ("keys", wire::Schema::Obj(&[("p256dh", wire::Schema::Str16), ("auth", wire::Schema::Str16)])), ("userAgent", wire::Schema::OptJs(&wire::Schema::Str16)), ("createdAt", wire::Schema::Num)]));

/// `saveUserSubscriptions` over the binary wire.
#[napi(js_name = "saveUserSubscriptionsWire")]
pub fn save_user_subscriptions_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let user_folder: String = r.string16()?;
        let subscriptions: Vec<serde_json::Value> = r.list(|r| wire::read_value(r, S_SAVE_USER_SUBSCRIPTIONS_1.inner()))?;
        let () = port::save_user_subscriptions(user_folder, subscriptions)?;
        Ok(())
    })
}

static S_ADD_USER_SUBSCRIPTION_1: wire::Schema = wire::Schema::Dyn;

/// `addUserSubscription` over the binary wire.
#[napi(js_name = "addUserSubscriptionWire")]
pub fn add_user_subscription_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let user_folder: String = r.string16()?;
        let sub: serde_json::Value = wire::read_value(r, &S_ADD_USER_SUBSCRIPTION_1)?;
        let out = &port::add_user_subscription(user_folder, sub)?;
        w.f64(*out);
        Ok(())
    })
}


/// `removeUserSubscription` over the binary wire.
#[napi(js_name = "removeUserSubscriptionWire")]
pub fn remove_user_subscription_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let user_folder: String = r.string16()?;
        let endpoint: String = r.string16()?;
        let out = &port::remove_user_subscription(user_folder, endpoint)?;
        w.f64(*out);
        Ok(())
    })
}

static S_RENDER_SHARE_PAGE_0: wire::Schema = wire::Schema::Dyn;

/// `renderSharePage` over the binary wire.
#[napi(js_name = "renderSharePageWire")]
pub fn render_share_page_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let model: serde_json::Value = wire::read_value(r, &S_RENDER_SHARE_PAGE_0)?;
        let out = &port::render_share_page(model)?;
        w.string16(out);
        Ok(())
    })
}


/// `renderSharePasswordPage` over the binary wire.
#[napi(js_name = "renderSharePasswordPageWire")]
pub fn render_share_password_page_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let token: String = r.string16()?;
        let error: Option<String> = r.opt_js(|r| r.string16())?;
        let out = &port::render_share_password_page(token, error)?;
        w.string16(out);
        Ok(())
    })
}

static S_RENDER_SHARE_ERROR_PAGE_0: wire::Schema = wire::Schema::Dyn;

/// `renderShareErrorPage` over the binary wire.
#[napi(js_name = "renderShareErrorPageWire")]
pub fn render_share_error_page_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let state: serde_json::Value = wire::read_value(r, &S_RENDER_SHARE_ERROR_PAGE_0)?;
        let out = &port::render_share_error_page(state)?;
        w.string16(out);
        Ok(())
    })
}


/// `getSharesFilePath` over the binary wire.
#[napi(js_name = "getSharesFilePathWire")]
pub fn get_shares_file_path_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let root_dir: String = r.string16()?;
        let out = &port::get_shares_file_path(root_dir)?;
        w.string16(out);
        Ok(())
    })
}


/// `getAlbumSharesFilePath` over the binary wire.
#[napi(js_name = "getAlbumSharesFilePathWire")]
pub fn get_album_shares_file_path_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let root_dir: String = r.string16()?;
        let out = &port::get_album_shares_file_path(root_dir)?;
        w.string16(out);
        Ok(())
    })
}

static S_LOAD_PUBLIC_SHARES_OUT: wire::Schema = wire::Schema::Map16(&wire::Schema::Obj(&[("id", wire::Schema::Str16), ("owner", wire::Schema::Str16), ("filenames", wire::Schema::List(&wire::Schema::Str16)), ("label", wire::Schema::Str16), ("createdAt", wire::Schema::Num), ("expiresAt", wire::Schema::Num), ("passwordHash", wire::Schema::OptJs(&wire::Schema::Str16)), ("maxDownloads", wire::Schema::OptJs(&wire::Schema::Num)), ("downloadCount", wire::Schema::Num), ("keyWrap", wire::Schema::Obj(&[("v", wire::Schema::Num), ("salt", wire::Schema::Str16), ("iv", wire::Schema::Str16), ("tag", wire::Schema::Str16), ("ct", wire::Schema::Str16)]))]));

/// `loadPublicShares` over the binary wire.
#[napi(js_name = "loadPublicSharesWire")]
pub fn load_public_shares_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let root_dir: String = r.string16()?;
        let out = &port::load_public_shares(root_dir)?;
        wire::write_value(w, out, &S_LOAD_PUBLIC_SHARES_OUT)?;
        Ok(())
    })
}

static S_SAVE_PUBLIC_SHARES_1: wire::Schema = wire::Schema::Dyn;

/// `savePublicShares` over the binary wire.
#[napi(js_name = "savePublicSharesWire")]
pub fn save_public_shares_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let root_dir: String = r.string16()?;
        let shares: serde_json::Value = wire::read_value(r, &S_SAVE_PUBLIC_SHARES_1)?;
        let () = port::save_public_shares(root_dir, shares)?;
        Ok(())
    })
}

static S_LOAD_ALBUM_SHARES_OUT: wire::Schema = wire::Schema::Map16(&wire::Schema::Obj(&[("id", wire::Schema::Str16), ("owner", wire::Schema::Str16), ("album", wire::Schema::Str16), ("participants", wire::Schema::Map16(&wire::Schema::Str16)), ("createdAt", wire::Schema::Num), ("keyWrap", wire::Schema::Obj(&[("v", wire::Schema::Num), ("salt", wire::Schema::Str16), ("iv", wire::Schema::Str16), ("tag", wire::Schema::Str16), ("ct", wire::Schema::Str16)]))]));

/// `loadAlbumShares` over the binary wire.
#[napi(js_name = "loadAlbumSharesWire")]
pub fn load_album_shares_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let root_dir: String = r.string16()?;
        let out = &port::load_album_shares(root_dir)?;
        wire::write_value(w, out, &S_LOAD_ALBUM_SHARES_OUT)?;
        Ok(())
    })
}

static S_SAVE_ALBUM_SHARES_1: wire::Schema = wire::Schema::Dyn;

/// `saveAlbumShares` over the binary wire.
#[napi(js_name = "saveAlbumSharesWire")]
pub fn save_album_shares_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let root_dir: String = r.string16()?;
        let shares: serde_json::Value = wire::read_value(r, &S_SAVE_ALBUM_SHARES_1)?;
        let () = port::save_album_shares(root_dir, shares)?;
        Ok(())
    })
}

static S_CREATE_PUBLIC_SHARE_1: wire::Schema = wire::Schema::Dyn;
static S_CREATE_PUBLIC_SHARE_2: wire::Schema = wire::Schema::Dyn;
static S_CREATE_PUBLIC_SHARE_OUT: wire::Schema = wire::Schema::Dyn;

/// `createPublicShare` over the binary wire.
#[napi(js_name = "createPublicShareWire")]
pub fn create_public_share_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let root_dir: String = r.string16()?;
        let server_secret: serde_json::Value = wire::read_value(r, &S_CREATE_PUBLIC_SHARE_1)?;
        let input: serde_json::Value = wire::read_value(r, &S_CREATE_PUBLIC_SHARE_2)?;
        let out = &port::create_public_share(root_dir, server_secret, input)?;
        wire::write_value(w, out, &S_CREATE_PUBLIC_SHARE_OUT)?;
        Ok(())
    })
}

static S_VERIFY_SHARE_PASSWORD_0: wire::Schema = wire::Schema::Dyn;

/// `verifySharePassword` over the binary wire.
#[napi(js_name = "verifySharePasswordWire")]
pub fn verify_share_password_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let record: serde_json::Value = wire::read_value(r, &S_VERIFY_SHARE_PASSWORD_0)?;
        let password: String = r.string16()?;
        let out = &port::verify_share_password(record, password)?;
        w.bool(*out);
        Ok(())
    })
}

static S_RESOLVE_SHARE_BY_TOKEN_OUT: wire::Schema = wire::Schema::Dyn;

/// `resolveShareByToken` over the binary wire.
#[napi(js_name = "resolveShareByTokenWire")]
pub fn resolve_share_by_token_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let root_dir: String = r.string16()?;
        let token: String = r.string16()?;
        let out = &port::resolve_share_by_token(root_dir, token)?;
        wire::write_value(w, out, &S_RESOLVE_SHARE_BY_TOKEN_OUT)?;
        Ok(())
    })
}


/// `incrementShareDownloadCount` over the binary wire.
#[napi(js_name = "incrementShareDownloadCountWire")]
pub fn increment_share_download_count_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let root_dir: String = r.string16()?;
        let id: String = r.string16()?;
        let out = &port::increment_share_download_count(root_dir, id)?;
        w.bool(*out);
        Ok(())
    })
}

static S_UPSERT_ALBUM_SHARE_1: wire::Schema = wire::Schema::Dyn;
static S_UPSERT_ALBUM_SHARE_OUT: wire::Schema = wire::Schema::Obj(&[("id", wire::Schema::Str16), ("owner", wire::Schema::Str16), ("album", wire::Schema::Str16), ("participants", wire::Schema::Map16(&wire::Schema::Str16)), ("createdAt", wire::Schema::Num), ("keyWrap", wire::Schema::Obj(&[("v", wire::Schema::Num), ("salt", wire::Schema::Str16), ("iv", wire::Schema::Str16), ("tag", wire::Schema::Str16), ("ct", wire::Schema::Str16)]))]);

/// `upsertAlbumShare` over the binary wire.
#[napi(js_name = "upsertAlbumShareWire")]
pub fn upsert_album_share_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let root_dir: String = r.string16()?;
        let server_secret: serde_json::Value = wire::read_value(r, &S_UPSERT_ALBUM_SHARE_1)?;
        let owner: String = r.string16()?;
        let album: String = r.string16()?;
        let owner_api_key: String = r.string16()?;
        let username: String = r.string16()?;
        let role: String = r.string16()?;
        let out = &port::upsert_album_share(root_dir, server_secret, owner, album, owner_api_key, username, role)?;
        wire::write_value(w, out, &S_UPSERT_ALBUM_SHARE_OUT)?;
        Ok(())
    })
}


/// `deleteAlbumSharesForAlbum` over the binary wire.
#[napi(js_name = "deleteAlbumSharesForAlbumWire")]
pub fn delete_album_shares_for_album_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let root_dir: String = r.string16()?;
        let owner: String = r.string16()?;
        let album: String = r.string16()?;
        let out = &port::delete_album_shares_for_album(root_dir, owner, album)?;
        w.f64(*out);
        Ok(())
    })
}


/// `escapeHtml` over the binary wire.
#[napi(js_name = "escapeHtmlWire")]
pub fn escape_html_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let str: String = r.string16()?;
        let out = &port::escape_html(str)?;
        w.string16(out);
        Ok(())
    })
}


/// `formatFileSize` over the binary wire.
#[napi(js_name = "formatFileSizeWire")]
pub fn format_file_size_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let bytes: Option<f64> = r.opt_js(|r| r.f64())?;
        let out = &port::format_file_size(bytes)?;
        w.string16(out);
        Ok(())
    })
}

static S_COMPUTE_CLOUD_STORAGE_STATS_0: wire::Schema = wire::Schema::OptJs(&wire::Schema::List(&wire::Schema::Obj(&[("filename", wire::Schema::Str16), ("timestamp", wire::Schema::Num), ("size", wire::Schema::OptJs(&wire::Schema::Num)), ("isMedia", wire::Schema::OptJs(&wire::Schema::Bool)), ("category", wire::Schema::OptJs(&wire::Schema::Str16)), ("album", wire::Schema::OptJs(&wire::Schema::Str16)), ("hasThumb", wire::Schema::OptJs(&wire::Schema::Bool))])));
static S_COMPUTE_CLOUD_STORAGE_STATS_1: wire::Schema = wire::Schema::OptJs(&wire::Schema::List(&wire::Schema::Obj(&[("filename", wire::Schema::Str16), ("timestamp", wire::Schema::Num), ("size", wire::Schema::OptJs(&wire::Schema::Num)), ("isMedia", wire::Schema::OptJs(&wire::Schema::Bool)), ("category", wire::Schema::OptJs(&wire::Schema::Str16)), ("album", wire::Schema::OptJs(&wire::Schema::Str16)), ("hasThumb", wire::Schema::OptJs(&wire::Schema::Bool))])));
static S_COMPUTE_CLOUD_STORAGE_STATS_OUT: wire::Schema = wire::Schema::Obj(&[("mediaBytes", wire::Schema::Num), ("mediaCount", wire::Schema::Num), ("filesBytes", wire::Schema::Num), ("filesCount", wire::Schema::Num), ("activeBytes", wire::Schema::Num), ("activeTotalBytes", wire::Schema::Num), ("activeCount", wire::Schema::Num), ("trashBytes", wire::Schema::Num), ("trashCount", wire::Schema::Num), ("grandTotalBytes", wire::Schema::Num), ("grandTotalCount", wire::Schema::Num), ("mediaPct", wire::Schema::Num), ("filesPct", wire::Schema::Num), ("trashPct", wire::Schema::Num), ("mediaPercent", wire::Schema::Num), ("filesPercent", wire::Schema::Num), ("trashPercent", wire::Schema::Num), ("mediaFormatted", wire::Schema::Str16), ("filesFormatted", wire::Schema::Str16), ("activeTotalFormatted", wire::Schema::Str16), ("trashFormatted", wire::Schema::Str16), ("grandTotalFormatted", wire::Schema::Str16), ("thumbCacheBytes", wire::Schema::OptJs(&wire::Schema::Num)), ("thumbCacheFormatted", wire::Schema::OptJs(&wire::Schema::Str16))]);

/// `computeCloudStorageStats` over the binary wire.
#[napi(js_name = "computeCloudStorageStatsWire")]
pub fn compute_cloud_storage_stats_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let active_files: Option<Vec<serde_json::Value>> = r.opt_js(|r| r.list(|r| wire::read_value(r, S_COMPUTE_CLOUD_STORAGE_STATS_0.inner().inner())))?;
        let trashed_files: Option<Vec<serde_json::Value>> = r.opt_js(|r| r.list(|r| wire::read_value(r, S_COMPUTE_CLOUD_STORAGE_STATS_1.inner().inner())))?;
        let thumb_cache_bytes: Option<f64> = r.opt_js(|r| r.f64())?;
        let out = &port::compute_cloud_storage_stats(active_files, trashed_files, thumb_cache_bytes)?;
        wire::write_value(w, out, &S_COMPUTE_CLOUD_STORAGE_STATS_OUT)?;
        Ok(())
    })
}


/// `renderLoginTemplate` over the binary wire.
#[napi(js_name = "renderLoginTemplateWire")]
pub fn render_login_template_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let error_message: Option<String> = r.opt_js(|r| r.string16())?;
        let out = &port::render_login_template(error_message)?;
        w.string16(out);
        Ok(())
    })
}

static S_RENDER_GALLERY_TEMPLATE_0: wire::Schema = wire::Schema::List(&wire::Schema::Obj(&[("filename", wire::Schema::Str16), ("timestamp", wire::Schema::Num), ("size", wire::Schema::OptJs(&wire::Schema::Num)), ("isMedia", wire::Schema::OptJs(&wire::Schema::Bool)), ("category", wire::Schema::OptJs(&wire::Schema::Str16)), ("album", wire::Schema::OptJs(&wire::Schema::Str16)), ("hasThumb", wire::Schema::OptJs(&wire::Schema::Bool))]));
static S_RENDER_GALLERY_TEMPLATE_2: wire::Schema = wire::Schema::OptJs(&wire::Schema::List(&wire::Schema::Obj(&[("filename", wire::Schema::Str16), ("timestamp", wire::Schema::Num), ("size", wire::Schema::OptJs(&wire::Schema::Num)), ("isMedia", wire::Schema::OptJs(&wire::Schema::Bool)), ("category", wire::Schema::OptJs(&wire::Schema::Str16)), ("album", wire::Schema::OptJs(&wire::Schema::Str16)), ("hasThumb", wire::Schema::OptJs(&wire::Schema::Bool))])));

/// `renderGalleryTemplate` over the binary wire.
#[napi(js_name = "renderGalleryTemplateWire")]
pub fn render_gallery_template_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let all_files: Vec<serde_json::Value> = r.list(|r| wire::read_value(r, S_RENDER_GALLERY_TEMPLATE_0.inner()))?;
        let albums: Option<Vec<String>> = r.opt_js(|r| r.list(|r| r.string16()))?;
        let trashed_files: Option<Vec<serde_json::Value>> = r.opt_js(|r| r.list(|r| wire::read_value(r, S_RENDER_GALLERY_TEMPLATE_2.inner().inner())))?;
        let favorites: Option<Vec<String>> = r.opt_js(|r| r.list(|r| r.string16()))?;
        let out = &port::render_gallery_template(all_files, albums, trashed_files, favorites)?;
        w.string16(out);
        Ok(())
    })
}

static S_RENDER_TRASH_TEMPLATE_0: wire::Schema = wire::Schema::List(&wire::Schema::Obj(&[("filename", wire::Schema::Str16), ("timestamp", wire::Schema::Num), ("size", wire::Schema::OptJs(&wire::Schema::Num)), ("isMedia", wire::Schema::OptJs(&wire::Schema::Bool)), ("category", wire::Schema::OptJs(&wire::Schema::Str16)), ("album", wire::Schema::OptJs(&wire::Schema::Str16)), ("hasThumb", wire::Schema::OptJs(&wire::Schema::Bool))]));
static S_RENDER_TRASH_TEMPLATE_1: wire::Schema = wire::Schema::OptJs(&wire::Schema::List(&wire::Schema::Obj(&[("filename", wire::Schema::Str16), ("timestamp", wire::Schema::Num), ("size", wire::Schema::OptJs(&wire::Schema::Num)), ("isMedia", wire::Schema::OptJs(&wire::Schema::Bool)), ("category", wire::Schema::OptJs(&wire::Schema::Str16)), ("album", wire::Schema::OptJs(&wire::Schema::Str16)), ("hasThumb", wire::Schema::OptJs(&wire::Schema::Bool))])));

/// `renderTrashTemplate` over the binary wire.
#[napi(js_name = "renderTrashTemplateWire")]
pub fn render_trash_template_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let trashed_files: Vec<serde_json::Value> = r.list(|r| wire::read_value(r, S_RENDER_TRASH_TEMPLATE_0.inner()))?;
        let active_files: Option<Vec<serde_json::Value>> = r.opt_js(|r| r.list(|r| wire::read_value(r, S_RENDER_TRASH_TEMPLATE_1.inner().inner())))?;
        let out = &port::render_trash_template(trashed_files, active_files)?;
        w.string16(out);
        Ok(())
    })
}


/// `resolveThumbCacheMaxBytes` over the binary wire.
#[napi(js_name = "resolveThumbCacheMaxBytesWire")]
pub fn resolve_thumb_cache_max_bytes_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let override_max_bytes: Option<f64> = r.opt_js(|r| r.f64())?;
        let out = &port::resolve_thumb_cache_max_bytes(override_max_bytes)?;
        w.f64(*out);
        Ok(())
    })
}

static S_PARSE_PREVIEW_VARIANT_0: wire::Schema = wire::Schema::Dyn;

/// `parsePreviewVariant` over the binary wire.
#[napi(js_name = "parsePreviewVariantWire")]
pub fn parse_preview_variant_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let raw_query: serde_json::Value = wire::read_value(r, &S_PARSE_PREVIEW_VARIANT_0)?;
        let is_explicit_download: Option<bool> = r.opt_js(|r| r.bool())?;
        let out = &port::parse_preview_variant(raw_query, is_explicit_download)?;
        match out { Some(x0) => { w.tag(1); w.string16(x0); } None => w.tag(2) }
        Ok(())
    })
}

static S_IS_JPEG_MAGIC_BYTES_0: wire::Schema = wire::Schema::Dyn;

/// `isJpegMagicBytes` over the binary wire.
#[napi(js_name = "isJpegMagicBytesWire")]
pub fn is_jpeg_magic_bytes_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let buf: serde_json::Value = wire::read_value(r, &S_IS_JPEG_MAGIC_BYTES_0)?;
        let out = &port::is_jpeg_magic_bytes(buf)?;
        w.bool(*out);
        Ok(())
    })
}

static S_WRITE_JSON_ATOMIC_1: wire::Schema = wire::Schema::Dyn;

/// `writeJsonAtomic` over the binary wire.
#[napi(js_name = "writeJsonAtomicWire")]
pub fn write_json_atomic_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let file_path: String = r.string16()?;
        let data: serde_json::Value = wire::read_value(r, &S_WRITE_JSON_ATOMIC_1)?;
        let () = port::write_json_atomic(file_path, data)?;
        Ok(())
    })
}

static S_GET_OR_CREATE_SERVER_SECRET_OUT: wire::Schema = wire::Schema::Dyn;

/// `getOrCreateServerSecret` over the binary wire.
#[napi(js_name = "getOrCreateServerSecretWire")]
pub fn get_or_create_server_secret_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let storage_dir: String = r.string16()?;
        let out = &port::get_or_create_server_secret(storage_dir)?;
        wire::write_value(w, out, &S_GET_OR_CREATE_SERVER_SECRET_OUT)?;
        Ok(())
    })
}

static S_WRAP_SECRET_0: wire::Schema = wire::Schema::Dyn;
static S_WRAP_SECRET_OUT: wire::Schema = wire::Schema::Obj(&[("v", wire::Schema::Num), ("salt", wire::Schema::Str16), ("iv", wire::Schema::Str16), ("tag", wire::Schema::Str16), ("ct", wire::Schema::Str16)]);

/// `wrapSecret` over the binary wire.
#[napi(js_name = "wrapSecretWire")]
pub fn wrap_secret_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let server_secret: serde_json::Value = wire::read_value(r, &S_WRAP_SECRET_0)?;
        let plaintext: String = r.string16()?;
        let out = &port::wrap_secret(server_secret, plaintext)?;
        wire::write_value(w, out, &S_WRAP_SECRET_OUT)?;
        Ok(())
    })
}

static S_UNWRAP_SECRET_0: wire::Schema = wire::Schema::Dyn;
static S_UNWRAP_SECRET_1: wire::Schema = wire::Schema::Dyn;

/// `unwrapSecret` over the binary wire.
#[napi(js_name = "unwrapSecretWire")]
pub fn unwrap_secret_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let server_secret: serde_json::Value = wire::read_value(r, &S_UNWRAP_SECRET_0)?;
        let wrapped: serde_json::Value = wire::read_value(r, &S_UNWRAP_SECRET_1)?;
        let out = &port::unwrap_secret(server_secret, wrapped)?;
        match out { Some(x0) => { w.tag(1); w.string16(x0); } None => w.tag(2) }
        Ok(())
    })
}


/// `hashLookupToken` over the binary wire.
#[napi(js_name = "hashLookupTokenWire")]
pub fn hash_lookup_token_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let token: String = r.string16()?;
        let out = &port::hash_lookup_token(token)?;
        w.string16(out);
        Ok(())
    })
}

static S_IS_VALID_UUID_V4_0: wire::Schema = wire::Schema::Dyn;

/// `isValidUuidV4` over the binary wire.
#[napi(js_name = "isValidUuidV4Wire")]
pub fn is_valid_uuid_v4_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let value: serde_json::Value = wire::read_value(r, &S_IS_VALID_UUID_V4_0)?;
        let out = &port::is_valid_uuid_v4(value)?;
        wire::write_dyn(w, &serde_json::to_value(out).map_err(|e| e.to_string())?);
        Ok(())
    })
}

static S_DECODE_BASE64_URL_STRICT_0: wire::Schema = wire::Schema::Dyn;

/// `decodeBase64UrlStrict` over the binary wire.
#[napi(js_name = "decodeBase64UrlStrictWire")]
pub fn decode_base64_url_strict_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let input: serde_json::Value = wire::read_value(r, &S_DECODE_BASE64_URL_STRICT_0)?;
        let expected_byte_length: Option<f64> = r.opt_js(|r| r.f64())?;
        let out = &port::decode_base64_url_strict(input, expected_byte_length)?;
        wire::write_dyn(w, &serde_json::to_value(out).map_err(|e| e.to_string())?);
        Ok(())
    })
}

static S_DERIVE_FAKE_SALT_FOR_USERNAME_0: wire::Schema = wire::Schema::Dyn;

/// `deriveFakeSaltForUsername` over the binary wire.
#[napi(js_name = "deriveFakeSaltForUsernameWire")]
pub fn derive_fake_salt_for_username_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let server_secret: serde_json::Value = wire::read_value(r, &S_DERIVE_FAKE_SALT_FOR_USERNAME_0)?;
        let username: String = r.string16()?;
        let out = &port::derive_fake_salt_for_username(server_secret, username)?;
        w.string16(out);
        Ok(())
    })
}


/// `timingSafeHexEqual` over the binary wire.
#[napi(js_name = "timingSafeHexEqualWire")]
pub fn timing_safe_hex_equal_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let hex_a: String = r.string16()?;
        let hex_b: String = r.string16()?;
        let out = &port::timing_safe_hex_equal(hex_a, hex_b)?;
        w.bool(*out);
        Ok(())
    })
}


/// `fsyncDirBestEffort` over the binary wire.
#[napi(js_name = "fsyncDirBestEffortWire")]
pub fn fsync_dir_best_effort_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let dir_path: String = r.string16()?;
        let () = port::fsync_dir_best_effort(dir_path)?;
        Ok(())
    })
}

static S_WRITE_BUFFER_ATOMIC_SYNC_2: wire::Schema = wire::Schema::Dyn;

/// `writeBufferAtomicSync` over the binary wire.
#[napi(js_name = "writeBufferAtomicSyncWire")]
pub fn write_buffer_atomic_sync_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let temp_dir: String = r.string16()?;
        let target_path: String = r.string16()?;
        let data: serde_json::Value = wire::read_value(r, &S_WRITE_BUFFER_ATOMIC_SYNC_2)?;
        let () = port::write_buffer_atomic_sync(temp_dir, target_path, data)?;
        Ok(())
    })
}


/// `moveTempFileAtomicSync` over the binary wire.
#[napi(js_name = "moveTempFileAtomicSyncWire")]
pub fn move_temp_file_atomic_sync_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let temp_file_path: String = r.string16()?;
        let target_path: String = r.string16()?;
        let () = port::move_temp_file_atomic_sync(temp_file_path, target_path)?;
        Ok(())
    })
}

static S_PARSE_HTTP_RANGE_HEADER_OUT: wire::Schema = wire::Schema::Dyn;

/// `parseHttpRangeHeader` over the binary wire.
#[napi(js_name = "parseHttpRangeHeaderWire")]
pub fn parse_http_range_header_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let range_header: Option<String> = r.opt_js(|r| r.string16())?;
        let total_size: f64 = r.f64()?;
        let out = &port::parse_http_range_header(range_header, total_size)?;
        wire::write_value(w, out, &S_PARSE_HTTP_RANGE_HEADER_OUT)?;
        Ok(())
    })
}

static S_VERIFY_INVITE_TOKEN_CONSTANT_TIME_1: wire::Schema = wire::Schema::Dyn;

/// `verifyInviteTokenConstantTime` over the binary wire.
#[napi(js_name = "verifyInviteTokenConstantTimeWire")]
pub fn verify_invite_token_constant_time_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let expected_token: Option<String> = r.opt_js(|r| r.string16())?;
        let provided_token: serde_json::Value = wire::read_value(r, &S_VERIFY_INVITE_TOKEN_CONSTANT_TIME_1)?;
        let out = &port::verify_invite_token_constant_time(expected_token, provided_token)?;
        w.bool(*out);
        Ok(())
    })
}

static S_IS_SECURE_OR_LOCALHOST_REQUEST_0: wire::Schema = wire::Schema::Dyn;

/// `isSecureOrLocalhostRequest` over the binary wire.
#[napi(js_name = "isSecureOrLocalhostRequestWire")]
pub fn is_secure_or_localhost_request_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let req: serde_json::Value = wire::read_value(r, &S_IS_SECURE_OR_LOCALHOST_REQUEST_0)?;
        let out = &port::is_secure_or_localhost_request(req)?;
        w.bool(*out);
        Ok(())
    })
}
