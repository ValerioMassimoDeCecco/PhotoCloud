import { ZkCryptoError, ZkErrorCode } from './errors.ts';

/**
 * Best-Effort Memory Zeroization & Constant-Time Utilities.
 *
 * JAVASCRIPT / V8 ZEROIZATION LIMITATIONS (Documented per Spec §7.2):
 * 1. `Uint8Array.prototype.fill(0)` and `BigUint64Array.prototype.fill(0n)` overwrite
 *    the underlying `ArrayBuffer` memory in-place. We invoke `zeroize()` on all raw
 *    key buffers (`ikm`, `passphrasePart`, Argon2id memory blocks, unwrapped `FK`,
 *    and `VK` on lock) immediately after use in `finally` blocks.
 * 2. JavaScript `string` primitives (such as a user-entered passphrase string before
 *    UTF-8 encoding) are immutable in ECMAScript and managed by the V8 garbage
 *    collector; they cannot be overwritten in-place from JS. Callers should convert
 *    passphrases to `Uint8Array` as early as possible and drop string references.
 * 3. WebCrypto `CryptoKey` objects created with `extractable: false` store key material
 *    inside the browser/runtime native cryptographic subsystem outside the JS heap.
 */

export type ZeroizableBuffer =
  | Uint8Array
  | Uint32Array
  | Int32Array
  | BigUint64Array
  | ArrayBuffer
  | null
  | undefined;

export function zeroize(...buffers: ZeroizableBuffer[]): void {
  for (const buf of buffers) {
    if (!buf) continue;
    if (buf instanceof BigUint64Array) {
      buf.fill(0n);
    } else if (buf instanceof Uint8Array || buf instanceof Uint32Array || buf instanceof Int32Array) {
      buf.fill(0);
    } else if (buf instanceof ArrayBuffer) {
      new Uint8Array(buf).fill(0);
    }
  }
}

export async function withZeroizedBuffer<T>(
  buf: Uint8Array,
  fn: (buf: Uint8Array) => Promise<T> | T
): Promise<T> {
  try {
    return await fn(buf);
  } finally {
    zeroize(buf);
  }
}

/**
 * Constant-time byte array comparison.
 * Never branches on secret byte values; leaks only whether lengths differ.
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export function normalizePassphraseNfc(passphrase: string): Uint8Array {
  return utf8Encode(passphrase.normalize('NFC'));
}

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export function fromHex(hexStr: string): Uint8Array {
  if (hexStr.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hexStr)) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'Invalid hexadecimal string.');
  }
  const out = new Uint8Array(hexStr.length / 2);
  for (let i = 0; i < out.byteLength; i++) {
    out[i] = parseInt(hexStr.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function toBase64Url(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64url');
  }
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(b64u: string): Uint8Array {
  if (!/^[A-Za-z0-9\-_]*$/.test(b64u)) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'Invalid base64url string.');
  }
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64u, 'base64url'));
  }
  const padded = b64u.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64u.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidToBytes(uuid: string): Uint8Array {
  if (!UUID_REGEX.test(uuid)) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'Invalid canonical UUID string.');
  }
  return fromHex(uuid.replace(/-/g, '').toLowerCase());
}

export function bytesToUuid(bytes: Uint8Array): string {
  if (bytes.byteLength !== 16) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'UUID binary representation must be 16 bytes.');
  }
  const h = toHex(bytes);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const a of arrays) total += a.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.byteLength;
  }
  return out;
}
