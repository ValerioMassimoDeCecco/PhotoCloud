//! The Rust port of `src/lib/zk/`.
//!
//! Replace each `unimplemented!` with the port of the source function. Return `Err` where
//! the source throws or raises: the caller gets an error there too. After changing a
//! signature, run `rust-anything refresh` to regenerate the bindings. `rust-anything diff` checks
//! behavior against what the source recorded.

#![forbid(unsafe_code)]

/// Port of `blake2b` (`src/lib/zk/argon2id.ts:41`).
pub fn blake2b(input: serde_json::Value, out_len: Option<f64>) -> Result<serde_json::Value, String> {
    let _ = (&input, &out_len);
    unimplemented!("port `blake2b` from src/lib/zk/argon2id.ts")
}

/// Port of `blake2bLong` (`src/lib/zk/argon2id.ts:173`).
pub fn blake2b_long(input: serde_json::Value, out_len: f64) -> Result<serde_json::Value, String> {
    let _ = (&input, &out_len);
    unimplemented!("port `blake2bLong` from src/lib/zk/argon2id.ts")
}

/// Port of `buildChunkNonce` (`src/lib/zk/pczkStream.ts:160`).
pub fn build_chunk_nonce(nonce_prefix: serde_json::Value, chunk_index: f64) -> Result<serde_json::Value, String> {
    let _ = (&nonce_prefix, &chunk_index);
    unimplemented!("port `buildChunkNonce` from src/lib/zk/pczkStream.ts")
}

/// Port of `buildChunkAad` (`src/lib/zk/pczkStream.ts:171`).
pub fn build_chunk_aad(header_sha256: serde_json::Value, is_last: bool) -> Result<serde_json::Value, String> {
    let _ = (&header_sha256, &is_last);
    unimplemented!("port `buildChunkAad` from src/lib/zk/pczkStream.ts")
}

/// Port of `serializePczkHeader` (`src/lib/zk/pczkStream.ts:181`).
pub fn serialize_pczk_header(params: serde_json::Value) -> Result<serde_json::Value, String> {
    let _ = &params;
    unimplemented!("port `serializePczkHeader` from src/lib/zk/pczkStream.ts")
}

/// Port of `parsePczkHeader` (`src/lib/zk/pczkStream.ts:214`).
pub fn parse_pczk_header(header_bytes: serde_json::Value) -> Result<serde_json::Value, String> {
    let _ = &header_bytes;
    unimplemented!("port `parsePczkHeader` from src/lib/zk/pczkStream.ts")
}

/// Port of `computeBlobRangePlan` (`src/lib/zk/pczkStream.ts:673`).
pub fn compute_blob_range_plan(params: serde_json::Value) -> Result<serde_json::Value, String> {
    let _ = &params;
    unimplemented!("port `computeBlobRangePlan` from src/lib/zk/pczkStream.ts")
}

/// Port of `constantTimeEqual` (`src/lib/zk/zeroize.ts:56`).
pub fn constant_time_equal(a: serde_json::Value, b: serde_json::Value) -> Result<bool, String> {
    let _ = (&a, &b);
    unimplemented!("port `constantTimeEqual` from src/lib/zk/zeroize.ts")
}

/// Port of `utf8Encode` (`src/lib/zk/zeroize.ts:67`).
pub fn utf8_encode(text: String) -> Result<serde_json::Value, String> {
    let _ = &text;
    unimplemented!("port `utf8Encode` from src/lib/zk/zeroize.ts")
}

/// Port of `utf8Decode` (`src/lib/zk/zeroize.ts:71`).
pub fn utf8_decode(bytes: serde_json::Value) -> Result<String, String> {
    let _ = &bytes;
    unimplemented!("port `utf8Decode` from src/lib/zk/zeroize.ts")
}

/// Port of `normalizePassphraseNfc` (`src/lib/zk/zeroize.ts:75`).
pub fn normalize_passphrase_nfc(passphrase: String) -> Result<serde_json::Value, String> {
    let _ = &passphrase;
    unimplemented!("port `normalizePassphraseNfc` from src/lib/zk/zeroize.ts")
}

/// Port of `toHex` (`src/lib/zk/zeroize.ts:79`).
pub fn to_hex(bytes: serde_json::Value) -> Result<String, String> {
    let _ = &bytes;
    unimplemented!("port `toHex` from src/lib/zk/zeroize.ts")
}

/// Port of `fromHex` (`src/lib/zk/zeroize.ts:87`).
pub fn from_hex(hex_str: String) -> Result<serde_json::Value, String> {
    let _ = &hex_str;
    unimplemented!("port `fromHex` from src/lib/zk/zeroize.ts")
}

/// Port of `toBase64Url` (`src/lib/zk/zeroize.ts:98`).
pub fn to_base64_url(bytes: serde_json::Value) -> Result<String, String> {
    let _ = &bytes;
    unimplemented!("port `toBase64Url` from src/lib/zk/zeroize.ts")
}

/// Port of `fromBase64Url` (`src/lib/zk/zeroize.ts:109`).
pub fn from_base64_url(b64u: String) -> Result<serde_json::Value, String> {
    let _ = &b64u;
    unimplemented!("port `fromBase64Url` from src/lib/zk/zeroize.ts")
}

/// Port of `uuidToBytes` (`src/lib/zk/zeroize.ts:127`).
pub fn uuid_to_bytes(uuid: String) -> Result<serde_json::Value, String> {
    let _ = &uuid;
    unimplemented!("port `uuidToBytes` from src/lib/zk/zeroize.ts")
}

/// Port of `bytesToUuid` (`src/lib/zk/zeroize.ts:134`).
pub fn bytes_to_uuid(bytes: serde_json::Value) -> Result<String, String> {
    let _ = &bytes;
    unimplemented!("port `bytesToUuid` from src/lib/zk/zeroize.ts")
}

/// Port of `concatBytes` (`src/lib/zk/zeroize.ts:142`).
pub fn concat_bytes(arrays: Option<Vec<serde_json::Value>>) -> Result<serde_json::Value, String> {
    let _ = &arrays;
    unimplemented!("port `concatBytes` from src/lib/zk/zeroize.ts")
}

/// Port of class `IncrementalSha256` (`src/lib/zk/provider.ts:79`): holds the instance state.
pub struct IncrementalSha256 {}

impl IncrementalSha256 {
    /// Port of `IncrementalSha256` constructor (`src/lib/zk/provider.ts:79`).
    pub fn new() -> Result<Self, String> {
        unimplemented!("port the `IncrementalSha256` constructor")
    }

    /// Port of `IncrementalSha256.update` (`src/lib/zk/provider.ts:90`).
    pub fn update(&mut self, chunk: serde_json::Value) -> Result<(), String> {
        let _ = &chunk;
        unimplemented!("port `IncrementalSha256.update`")
    }

    /// Port of `IncrementalSha256.digest` (`src/lib/zk/provider.ts:119`).
    pub fn digest(&mut self) -> Result<serde_json::Value, String> {
        unimplemented!("port `IncrementalSha256.digest`")
    }
}

/// Port of class `IncrementalHmacSha256` (`src/lib/zk/provider.ts:199`): holds the instance state.
pub struct IncrementalHmacSha256 {}

impl IncrementalHmacSha256 {
    /// Port of `IncrementalHmacSha256` constructor (`src/lib/zk/provider.ts:199`).
    pub fn new(key: serde_json::Value) -> Result<Self, String> {
        let _ = &key;
        unimplemented!("port the `IncrementalHmacSha256` constructor")
    }

    /// Port of `IncrementalHmacSha256.update` (`src/lib/zk/provider.ts:225`).
    pub fn update(&mut self, chunk: serde_json::Value) -> Result<(), String> {
        let _ = &chunk;
        unimplemented!("port `IncrementalHmacSha256.update`")
    }

    /// Port of `IncrementalHmacSha256.digest` (`src/lib/zk/provider.ts:232`).
    pub fn digest(&mut self) -> Result<serde_json::Value, String> {
        unimplemented!("port `IncrementalHmacSha256.digest`")
    }
}
