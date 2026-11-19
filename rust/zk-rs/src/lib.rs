//! JS bindings for `src/lib/zk/`: generated from the signatures in `port.rs` by rust-anything.
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


/// `blake2b`.
#[napi(js_name = "blake2b")]
pub fn blake2b(input: String, out_len: Option<f64>) -> napi::Result<String> {
    run(move || {
        let input = crate::js::from_json(&input)?;
        let out = port::blake2b(input, out_len)?;
        crate::js::to_json(&out)
    })
}

/// `blake2bLong`.
#[napi(js_name = "blake2bLong")]
pub fn blake2b_long(input: String, out_len: f64) -> napi::Result<String> {
    run(move || {
        let input = crate::js::from_json(&input)?;
        let out = port::blake2b_long(input, out_len)?;
        crate::js::to_json(&out)
    })
}

/// `buildChunkNonce`.
#[napi(js_name = "buildChunkNonce")]
pub fn build_chunk_nonce(nonce_prefix: String, chunk_index: f64) -> napi::Result<String> {
    run(move || {
        let nonce_prefix = crate::js::from_json(&nonce_prefix)?;
        let out = port::build_chunk_nonce(nonce_prefix, chunk_index)?;
        crate::js::to_json(&out)
    })
}

/// `buildChunkAad`.
#[napi(js_name = "buildChunkAad")]
pub fn build_chunk_aad(header_sha256: String, is_last: bool) -> napi::Result<String> {
    run(move || {
        let header_sha256 = crate::js::from_json(&header_sha256)?;
        let out = port::build_chunk_aad(header_sha256, is_last)?;
        crate::js::to_json(&out)
    })
}

/// `serializePczkHeader`.
#[napi(js_name = "serializePczkHeader")]
pub fn serialize_pczk_header(params: String) -> napi::Result<String> {
    run(move || {
        let params = crate::js::from_json(&params)?;
        let out = port::serialize_pczk_header(params)?;
        crate::js::to_json(&out)
    })
}

/// `parsePczkHeader`.
#[napi(js_name = "parsePczkHeader")]
pub fn parse_pczk_header(header_bytes: String) -> napi::Result<String> {
    run(move || {
        let header_bytes = crate::js::from_json(&header_bytes)?;
        let out = port::parse_pczk_header(header_bytes)?;
        crate::js::to_json(&out)
    })
}

/// `computeBlobRangePlan`.
#[napi(js_name = "computeBlobRangePlan")]
pub fn compute_blob_range_plan(params: String) -> napi::Result<String> {
    run(move || {
        let params = crate::js::from_json(&params)?;
        let out = port::compute_blob_range_plan(params)?;
        crate::js::to_json(&out)
    })
}

/// `constantTimeEqual`.
#[napi(js_name = "constantTimeEqual")]
pub fn constant_time_equal(a: String, b: String) -> napi::Result<bool> {
    run(move || {
        let a = crate::js::from_json(&a)?;
        let b = crate::js::from_json(&b)?;
        let out = port::constant_time_equal(a, b)?;
        Ok(out)
    })
}

/// `utf8Encode`.
#[napi(js_name = "utf8Encode")]
pub fn utf8_encode(text: String) -> napi::Result<String> {
    run(move || {
        let out = port::utf8_encode(text)?;
        crate::js::to_json(&out)
    })
}

/// `utf8Decode`.
#[napi(js_name = "utf8Decode")]
pub fn utf8_decode(bytes: String) -> napi::Result<String> {
    run(move || {
        let bytes = crate::js::from_json(&bytes)?;
        let out = port::utf8_decode(bytes)?;
        Ok(out)
    })
}

/// `normalizePassphraseNfc`.
#[napi(js_name = "normalizePassphraseNfc")]
pub fn normalize_passphrase_nfc(passphrase: String) -> napi::Result<String> {
    run(move || {
        let out = port::normalize_passphrase_nfc(passphrase)?;
        crate::js::to_json(&out)
    })
}

/// `toHex`.
#[napi(js_name = "toHex")]
pub fn to_hex(bytes: String) -> napi::Result<String> {
    run(move || {
        let bytes = crate::js::from_json(&bytes)?;
        let out = port::to_hex(bytes)?;
        Ok(out)
    })
}

/// `fromHex`.
#[napi(js_name = "fromHex")]
pub fn from_hex(hex_str: String) -> napi::Result<String> {
    run(move || {
        let out = port::from_hex(hex_str)?;
        crate::js::to_json(&out)
    })
}

/// `toBase64Url`.
#[napi(js_name = "toBase64Url")]
pub fn to_base64_url(bytes: String) -> napi::Result<String> {
    run(move || {
        let bytes = crate::js::from_json(&bytes)?;
        let out = port::to_base64_url(bytes)?;
        Ok(out)
    })
}

/// `fromBase64Url`.
#[napi(js_name = "fromBase64Url")]
pub fn from_base64_url(b64u: String) -> napi::Result<String> {
    run(move || {
        let out = port::from_base64_url(b64u)?;
        crate::js::to_json(&out)
    })
}

/// `uuidToBytes`.
#[napi(js_name = "uuidToBytes")]
pub fn uuid_to_bytes(uuid: String) -> napi::Result<String> {
    run(move || {
        let out = port::uuid_to_bytes(uuid)?;
        crate::js::to_json(&out)
    })
}

/// `bytesToUuid`.
#[napi(js_name = "bytesToUuid")]
pub fn bytes_to_uuid(bytes: String) -> napi::Result<String> {
    run(move || {
        let bytes = crate::js::from_json(&bytes)?;
        let out = port::bytes_to_uuid(bytes)?;
        Ok(out)
    })
}

/// `concatBytes`.
#[napi(js_name = "concatBytes")]
pub fn concat_bytes(arrays: String) -> napi::Result<String> {
    run(move || {
        let arrays = crate::js::from_json(&arrays)?;
        let out = port::concat_bytes(arrays)?;
        crate::js::to_json(&out)
    })
}

/// Class `IncrementalSha256`.
#[napi(js_name = "IncrementalSha256")]
pub struct IncrementalSha256 {
    inner: port::IncrementalSha256,
}

#[napi]
impl IncrementalSha256 {
    #[napi(constructor)]
    pub fn new() -> napi::Result<Self> {
        run(move || {
            let out = port::IncrementalSha256::new()?;
            Ok(Self { inner: out })
        })
    }

    #[napi(js_name = "update")]
    pub fn update(&mut self, chunk: String) -> napi::Result<()> {
        let inner = &mut self.inner;
        run(move || {
            let chunk = crate::js::from_json(&chunk)?;
            inner.update(chunk)?;
            Ok(())
        })
    }

    #[napi(js_name = "digest")]
    pub fn digest(&mut self) -> napi::Result<String> {
        let inner = &mut self.inner;
        run(move || {
            let out = inner.digest()?;
            crate::js::to_json(&out)
        })
    }
}

/// Class `IncrementalHmacSha256`.
#[napi(js_name = "IncrementalHmacSha256")]
pub struct IncrementalHmacSha256 {
    inner: port::IncrementalHmacSha256,
}

#[napi]
impl IncrementalHmacSha256 {
    #[napi(constructor)]
    pub fn new(key: String) -> napi::Result<Self> {
        run(move || {
            let key = crate::js::from_json(&key)?;
            let out = port::IncrementalHmacSha256::new(key)?;
            Ok(Self { inner: out })
        })
    }

    #[napi(js_name = "update")]
    pub fn update(&mut self, chunk: String) -> napi::Result<()> {
        let inner = &mut self.inner;
        run(move || {
            let chunk = crate::js::from_json(&chunk)?;
            inner.update(chunk)?;
            Ok(())
        })
    }

    #[napi(js_name = "digest")]
    pub fn digest(&mut self) -> napi::Result<String> {
        let inner = &mut self.inner;
        run(move || {
            let out = inner.digest()?;
            crate::js::to_json(&out)
        })
    }
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

static S_BLAKE2B_0: wire::Schema = wire::Schema::Dyn;
static S_BLAKE2B_OUT: wire::Schema = wire::Schema::Dyn;

/// `blake2b` over the binary wire.
#[napi(js_name = "blake2bWire")]
pub fn blake2b_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let input: serde_json::Value = wire::read_value(r, &S_BLAKE2B_0)?;
        let out_len: Option<f64> = r.opt_js(|r| r.f64())?;
        let out = &port::blake2b(input, out_len)?;
        wire::write_value(w, out, &S_BLAKE2B_OUT)?;
        Ok(())
    })
}

static S_BLAKE2B_LONG_0: wire::Schema = wire::Schema::Dyn;
static S_BLAKE2B_LONG_OUT: wire::Schema = wire::Schema::Dyn;

/// `blake2bLong` over the binary wire.
#[napi(js_name = "blake2bLongWire")]
pub fn blake2b_long_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let input: serde_json::Value = wire::read_value(r, &S_BLAKE2B_LONG_0)?;
        let out_len: f64 = r.f64()?;
        let out = &port::blake2b_long(input, out_len)?;
        wire::write_value(w, out, &S_BLAKE2B_LONG_OUT)?;
        Ok(())
    })
}

static S_BUILD_CHUNK_NONCE_0: wire::Schema = wire::Schema::Dyn;
static S_BUILD_CHUNK_NONCE_OUT: wire::Schema = wire::Schema::Dyn;

/// `buildChunkNonce` over the binary wire.
#[napi(js_name = "buildChunkNonceWire")]
pub fn build_chunk_nonce_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let nonce_prefix: serde_json::Value = wire::read_value(r, &S_BUILD_CHUNK_NONCE_0)?;
        let chunk_index: f64 = r.f64()?;
        let out = &port::build_chunk_nonce(nonce_prefix, chunk_index)?;
        wire::write_value(w, out, &S_BUILD_CHUNK_NONCE_OUT)?;
        Ok(())
    })
}

static S_BUILD_CHUNK_AAD_0: wire::Schema = wire::Schema::Dyn;
static S_BUILD_CHUNK_AAD_OUT: wire::Schema = wire::Schema::Dyn;

/// `buildChunkAad` over the binary wire.
#[napi(js_name = "buildChunkAadWire")]
pub fn build_chunk_aad_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let header_sha256: serde_json::Value = wire::read_value(r, &S_BUILD_CHUNK_AAD_0)?;
        let is_last: bool = r.bool()?;
        let out = &port::build_chunk_aad(header_sha256, is_last)?;
        wire::write_value(w, out, &S_BUILD_CHUNK_AAD_OUT)?;
        Ok(())
    })
}

static S_SERIALIZE_PCZK_HEADER_0: wire::Schema = wire::Schema::Dyn;
static S_SERIALIZE_PCZK_HEADER_OUT: wire::Schema = wire::Schema::Dyn;

/// `serializePczkHeader` over the binary wire.
#[napi(js_name = "serializePczkHeaderWire")]
pub fn serialize_pczk_header_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let params: serde_json::Value = wire::read_value(r, &S_SERIALIZE_PCZK_HEADER_0)?;
        let out = &port::serialize_pczk_header(params)?;
        wire::write_value(w, out, &S_SERIALIZE_PCZK_HEADER_OUT)?;
        Ok(())
    })
}

static S_PARSE_PCZK_HEADER_0: wire::Schema = wire::Schema::Dyn;
static S_PARSE_PCZK_HEADER_OUT: wire::Schema = wire::Schema::Obj(&[("magic", wire::Schema::Str16), ("version", wire::Schema::Num), ("chunkSizeLog2", wire::Schema::Num), ("chunkPlaintextSize", wire::Schema::Num), ("chunkCiphertextSize", wire::Schema::Num), ("blobId", wire::Schema::Str16), ("blobIdBytes", wire::Schema::Dyn), ("noncePrefix", wire::Schema::Dyn), ("wrappedFk", wire::Schema::Dyn), ("rawHeader", wire::Schema::Dyn)]);

/// `parsePczkHeader` over the binary wire.
#[napi(js_name = "parsePczkHeaderWire")]
pub fn parse_pczk_header_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let header_bytes: serde_json::Value = wire::read_value(r, &S_PARSE_PCZK_HEADER_0)?;
        let out = &port::parse_pczk_header(header_bytes)?;
        wire::write_value(w, out, &S_PARSE_PCZK_HEADER_OUT)?;
        Ok(())
    })
}

static S_COMPUTE_BLOB_RANGE_PLAN_0: wire::Schema = wire::Schema::Dyn;
static S_COMPUTE_BLOB_RANGE_PLAN_OUT: wire::Schema = wire::Schema::Obj(&[("totalCiphertextBytes", wire::Schema::Num), ("totalPlaintextBytes", wire::Schema::Num), ("chunkSizeLog2", wire::Schema::Num), ("chunkPlaintextSize", wire::Schema::Num), ("chunkCiphertextSize", wire::Schema::Num), ("totalChunks", wire::Schema::Num), ("startPlaintextByte", wire::Schema::Num), ("endPlaintextByteInclusive", wire::Schema::Num), ("startChunkIndex", wire::Schema::Num), ("endChunkIndex", wire::Schema::Num), ("ciphertextStartByte", wire::Schema::Num), ("ciphertextEndByteInclusive", wire::Schema::Num), ("chunks", wire::Schema::List(&wire::Schema::Obj(&[("chunkIndex", wire::Schema::Num), ("isLast", wire::Schema::Bool), ("ciphertextStartInBlob", wire::Schema::Num), ("ciphertextEndInclusiveInBlob", wire::Schema::Num), ("ciphertextOffsetInSlice", wire::Schema::Num), ("ciphertextLength", wire::Schema::Num), ("plaintextStartInBlob", wire::Schema::Num), ("plaintextEndInclusiveInBlob", wire::Schema::Num)])))]);

/// `computeBlobRangePlan` over the binary wire.
#[napi(js_name = "computeBlobRangePlanWire")]
pub fn compute_blob_range_plan_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let params: serde_json::Value = wire::read_value(r, &S_COMPUTE_BLOB_RANGE_PLAN_0)?;
        let out = &port::compute_blob_range_plan(params)?;
        wire::write_value(w, out, &S_COMPUTE_BLOB_RANGE_PLAN_OUT)?;
        Ok(())
    })
}

static S_CONSTANT_TIME_EQUAL_0: wire::Schema = wire::Schema::Dyn;
static S_CONSTANT_TIME_EQUAL_1: wire::Schema = wire::Schema::Dyn;

/// `constantTimeEqual` over the binary wire.
#[napi(js_name = "constantTimeEqualWire")]
pub fn constant_time_equal_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let a: serde_json::Value = wire::read_value(r, &S_CONSTANT_TIME_EQUAL_0)?;
        let b: serde_json::Value = wire::read_value(r, &S_CONSTANT_TIME_EQUAL_1)?;
        let out = &port::constant_time_equal(a, b)?;
        w.bool(*out);
        Ok(())
    })
}

static S_UTF8_ENCODE_OUT: wire::Schema = wire::Schema::Dyn;

/// `utf8Encode` over the binary wire.
#[napi(js_name = "utf8EncodeWire")]
pub fn utf8_encode_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let text: String = r.string16()?;
        let out = &port::utf8_encode(text)?;
        wire::write_value(w, out, &S_UTF8_ENCODE_OUT)?;
        Ok(())
    })
}

static S_UTF8_DECODE_0: wire::Schema = wire::Schema::Dyn;

/// `utf8Decode` over the binary wire.
#[napi(js_name = "utf8DecodeWire")]
pub fn utf8_decode_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let bytes: serde_json::Value = wire::read_value(r, &S_UTF8_DECODE_0)?;
        let out = &port::utf8_decode(bytes)?;
        w.string16(out);
        Ok(())
    })
}

static S_NORMALIZE_PASSPHRASE_NFC_OUT: wire::Schema = wire::Schema::Dyn;

/// `normalizePassphraseNfc` over the binary wire.
#[napi(js_name = "normalizePassphraseNfcWire")]
pub fn normalize_passphrase_nfc_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let passphrase: String = r.string16()?;
        let out = &port::normalize_passphrase_nfc(passphrase)?;
        wire::write_value(w, out, &S_NORMALIZE_PASSPHRASE_NFC_OUT)?;
        Ok(())
    })
}

static S_TO_HEX_0: wire::Schema = wire::Schema::Dyn;

/// `toHex` over the binary wire.
#[napi(js_name = "toHexWire")]
pub fn to_hex_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let bytes: serde_json::Value = wire::read_value(r, &S_TO_HEX_0)?;
        let out = &port::to_hex(bytes)?;
        w.string16(out);
        Ok(())
    })
}

static S_FROM_HEX_OUT: wire::Schema = wire::Schema::Dyn;

/// `fromHex` over the binary wire.
#[napi(js_name = "fromHexWire")]
pub fn from_hex_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let hex_str: String = r.string16()?;
        let out = &port::from_hex(hex_str)?;
        wire::write_value(w, out, &S_FROM_HEX_OUT)?;
        Ok(())
    })
}

static S_TO_BASE64_URL_0: wire::Schema = wire::Schema::Dyn;

/// `toBase64Url` over the binary wire.
#[napi(js_name = "toBase64UrlWire")]
pub fn to_base64_url_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let bytes: serde_json::Value = wire::read_value(r, &S_TO_BASE64_URL_0)?;
        let out = &port::to_base64_url(bytes)?;
        w.string16(out);
        Ok(())
    })
}

static S_FROM_BASE64_URL_OUT: wire::Schema = wire::Schema::Dyn;

/// `fromBase64Url` over the binary wire.
#[napi(js_name = "fromBase64UrlWire")]
pub fn from_base64_url_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let b64u: String = r.string16()?;
        let out = &port::from_base64_url(b64u)?;
        wire::write_value(w, out, &S_FROM_BASE64_URL_OUT)?;
        Ok(())
    })
}

static S_UUID_TO_BYTES_OUT: wire::Schema = wire::Schema::Dyn;

/// `uuidToBytes` over the binary wire.
#[napi(js_name = "uuidToBytesWire")]
pub fn uuid_to_bytes_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let uuid: String = r.string16()?;
        let out = &port::uuid_to_bytes(uuid)?;
        wire::write_value(w, out, &S_UUID_TO_BYTES_OUT)?;
        Ok(())
    })
}

static S_BYTES_TO_UUID_0: wire::Schema = wire::Schema::Dyn;

/// `bytesToUuid` over the binary wire.
#[napi(js_name = "bytesToUuidWire")]
pub fn bytes_to_uuid_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let bytes: serde_json::Value = wire::read_value(r, &S_BYTES_TO_UUID_0)?;
        let out = &port::bytes_to_uuid(bytes)?;
        w.string16(out);
        Ok(())
    })
}
