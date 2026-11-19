# Research: Web Push and VAPID Protocol

## Sources
- RFC 8291: Message Encryption for Web Push.
- RFC 8292: Voluntary Application Server Identification (VAPID) for Web Push.
- Node.js `web-push` library.
- Rust `web-push-native` crate.
- PhotoCloud source: `server.ts` push subscription endpoints (`/api/push/*`).

## Protocol & Architecture

### 1. VAPID Keys
- Key Pair: Elliptic Curve (NIST P-256 / secp256r1).
- Public Key: Uncompressed point (65 bytes), Base64URL-encoded (without padding).
- Private Key: Scalar (32 bytes), Base64URL-encoded.
- Handshake: Server signs a JWT with claims (`aud`, `sub: "mailto:..."`, `exp`) using ES256 and transmits it via `Authorization: vapid t=..., k=...` or `Authorization: Bearer <jwt>`.

### 2. Message Encryption (RFC 8291)
- User subscription endpoint provides:
  - `endpoint`: Target push service URL (e.g., FCM, Mozilla Push Service).
  - `keys.p256dh`: Client public key (65 bytes uncompressed P-256).
  - `keys.auth`: 16-byte authentication secret.
- Encryption process:
  - ECDH between server ephemeral key pair and client public key produces shared secret.
  - HKDF derives content encryption key (CEK) and nonce.
  - AES-128-GCM encrypts payload with `Content-Encoding: aes128gcm`.

### 3. Rust Implementation
The pure Rust crate `web-push-native` implements the full RFC 8291 / 8292 specification:
```rust
use web_push_native::{WebPushBuilder, p256::PublicKey, Auth, ContentEncoding};

let builder = WebPushBuilder::new(endpoint, p256dh)
    .with_vapid(&vapid_signature_builder, "mailto:admin@photocloud.local")
    .with_payload(ContentEncoding::Aes128Gcm, payload_bytes);
let request = builder.build()?;
```
This avoids node runtime overhead and executes push dispatch with zero subprocess overhead.
