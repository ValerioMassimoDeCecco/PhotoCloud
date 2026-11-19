# Research: Cryptography and Vault Storage Porting

## Sources
- Node.js `crypto` documentation (v22/v24): `createCipheriv`, `pbkdf2Sync`, `timingSafeEqual`.
- Rust `aes-gcm` crate (v0.10): `Aes256Gcm`, `KeyInit`, `AeadInPlace`, `Tag`.
- Rust `pbkdf2` & `sha2` crates (RustCrypto): `pbkdf2_hmac`.
- Rust `subtle` crate: `ConstantTimeEq`.
- PhotoCloud source: `src/lib/crypto.ts`, `src/lib/vaultStorage.ts`, `src/lib/zk/`.

## Binary Layout Specifications

### 1. PhotoCloud GCM v1 File Format
The encrypted file structure produced by `encryptFile` / `encryptFileStream` is strictly:
```
+--------------------------+----------+----------+----------+--------------------+
| Magic Header             | Salt     | IV       | Auth Tag | Ciphertext         |
| "PhotoCloud-GCM-v1\0"    | 16 bytes | 12 bytes | 16 bytes | Variable length    |
| (18 bytes)               |          |          |          | (Plaintext size)   |
+--------------------------+----------+----------+----------+--------------------+
```
- Total header overhead: `18 + 16 + 12 + 16 = 62` bytes (`GCM_OVERHEAD`).
- In Rust, `aes_gcm::Aes256Gcm::encrypt` appends the 16-byte tag to the ciphertext by default.
  **Trap**: In the PhotoCloud file format, the 16-byte tag is stored **before** the ciphertext!
  Specifically:
  - Header: bytes `0..18` = `PhotoCloud-GCM-v1\0`
  - Salt: bytes `18..34` (16 bytes)
  - Nonce (IV): bytes `34..46` (12 bytes)
  - Tag: bytes `46..62` (16 bytes)
  - Ciphertext: bytes `62..end`
  When decrypting with `aes_gcm`, the tag must be detached from bytes `46..62` and combined with the ciphertext or verified using `decrypt_in_place_detached(&nonce, &[], buffer, tag)`.

### 2. Legacy Format Support
Legacy files do not have the magic header:
- Salt: bytes `0..16` (16 bytes)
- IV: bytes `16..32` (16 bytes)
- Ciphertext: bytes `32..end` (AES-256-CFB mode, using `aes` + `cfb_mode` or fallback).

### 3. Key Derivation (PBKDF2)
- Iterations: `100,000`
- Digest: `SHA-256`
- Output length: `32` bytes (256 bits)
- Key input: UTF-8 bytes of user password/key
- Salt: 16 random bytes
- Cache: In memory LRU cache indexed by `SHA256(key):hex(salt)` to avoid repeated expensive derivations during HTTP Range requests.

### 4. API Key Generation & Verification
- `ALL_CHARS`: `a-z` (26) + `A-Z` (26) + `0-9` (10) + `!#$%&()*+,-./:;<=>?@[]^_{|}~` (29) = 91 characters.
- Must contain at least one lowercase, one uppercase, one digit, and one punctuation character.
- Verification uses constant-time comparison to prevent timing attacks.

### 5. Semantic Traps & Guardrails
- **Tag position**: As noted, the auth tag precedes ciphertext on disk. Failing to slice at offset 62 will result in tag verification failures.
- **Atomic file writes**: `writeJsonAtomic` and `encryptFileStream` write to a PID-tagged temporary file (`.tmp`) and atomically rename it to prevent partial writes during crashes.
- **UTF-8 vs UTF-16**: JSON serialization for vault index must maintain deterministic key ordering where hash indices are validated.
