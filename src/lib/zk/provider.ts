import { ZkCryptoError, ZkErrorCode } from './errors.ts';
import { concatBytes, zeroize } from './zeroize.ts';

export interface StreamingDigest {
  update(chunk: Uint8Array): void;
  digest(): Uint8Array;
}

export interface Argon2idParams {
  memoryKiB: number;
  iterations: number;
  parallelism: number;
  hashLength: number;
}

export interface Argon2idProgress {
  percent: number;
  pass: number;
  totalPasses: number;
  slice: number;
}

export type Argon2idProgressCallback = (progress: Argon2idProgress) => void;

export interface Argon2idOptions {
  secret?: Uint8Array;
  associatedData?: Uint8Array;
  onProgress?: Argon2idProgressCallback;
}

export interface Argon2idProvider {
  derive(
    password: Uint8Array,
    salt: Uint8Array,
    params: Argon2idParams,
    options?: Argon2idOptions
  ): Promise<Uint8Array>;
}

export interface ZkCryptoProvider {
  randomBytes(length: number): Uint8Array;
  sha256(data: Uint8Array): Promise<Uint8Array>;
  createSha256Stream(): StreamingDigest;
  hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array>;
  createHmacSha256Stream(key: Uint8Array): StreamingDigest;
  hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array>;
  aes256GcmEncrypt(
    key: Uint8Array,
    nonce: Uint8Array,
    plaintext: Uint8Array,
    aad: Uint8Array
  ): Promise<Uint8Array>;
  aes256GcmDecrypt(
    key: Uint8Array,
    nonce: Uint8Array,
    ciphertextWithTag: Uint8Array,
    aad: Uint8Array,
    errorCodeOnFail?: ZkErrorCode
  ): Promise<Uint8Array>;
}

/**
 * Pure incremental SHA-256 & HMAC-SHA256 implementation (FIPS 180-4 / RFC 2104)
 * so streaming `computeDedupTag` and `ciphertextSha256` work identically in
 * browser Web Workers and Node.js with strictly O(1) memory (64-byte block buffer)
 * without buffering multi-hundred-MiB files in RAM.
 */
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export class IncrementalSha256 implements StreamingDigest {
  private readonly state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private readonly block = new Uint8Array(64);
  private readonly w = new Uint32Array(64);
  private blockLen = 0;
  private totalBytes = 0;
  private finalized = false;

  public update(chunk: Uint8Array): void {
    if (this.finalized) {
      throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'Digest already finalized.');
    }
    let offset = 0;
    let remaining = chunk.byteLength;
    this.totalBytes += remaining;

    if (this.blockLen > 0 && this.blockLen + remaining >= 64) {
      const take = 64 - this.blockLen;
      this.block.set(chunk.subarray(0, take), this.blockLen);
      this.compressBlock(this.block, 0);
      this.blockLen = 0;
      offset += take;
      remaining -= take;
    }

    while (remaining >= 64) {
      this.compressBlock(chunk, offset);
      offset += 64;
      remaining -= 64;
    }

    if (remaining > 0) {
      this.block.set(chunk.subarray(offset, offset + remaining), this.blockLen);
      this.blockLen += remaining;
    }
  }

  public digest(): Uint8Array {
    if (this.finalized) {
      throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'Digest already finalized.');
    }
    this.finalized = true;

    this.block[this.blockLen++] = 0x80;
    if (this.blockLen > 56) {
      this.block.fill(0, this.blockLen, 64);
      this.compressBlock(this.block, 0);
      this.blockLen = 0;
    }
    this.block.fill(0, this.blockLen, 56);

    const totalBits = BigInt(this.totalBytes) * 8n;
    const view = new DataView(this.block.buffer, this.block.byteOffset, 64);
    view.setBigUint64(56, totalBits, false);
    this.compressBlock(this.block, 0);

    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) {
      outView.setUint32(i * 4, this.state[i], false);
    }
    zeroize(this.block, this.w, this.state);
    return out;
  }

  private compressBlock(buf: Uint8Array, offset: number): void {
    const w = this.w;
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] = ((buf[j] << 24) | (buf[j + 1] << 16) | (buf[j + 2] << 8) | buf[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const v1 = w[i - 15];
      const s0 = (((v1 >>> 7) | (v1 << 25)) ^ ((v1 >>> 18) | (v1 << 14)) ^ (v1 >>> 3)) >>> 0;
      const v2 = w[i - 2];
      const s1 = (((v2 >>> 17) | (v2 << 15)) ^ ((v2 >>> 19) | (v2 << 13)) ^ (v2 >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = this.state[0];
    let b = this.state[1];
    let c = this.state[2];
    let d = this.state[3];
    let e = this.state[4];
    let f = this.state[5];
    let g = this.state[6];
    let h = this.state[7];

    for (let i = 0; i < 64; i++) {
      const S1 = (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = (((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    this.state[0] = (this.state[0] + a) >>> 0;
    this.state[1] = (this.state[1] + b) >>> 0;
    this.state[2] = (this.state[2] + c) >>> 0;
    this.state[3] = (this.state[3] + d) >>> 0;
    this.state[4] = (this.state[4] + e) >>> 0;
    this.state[5] = (this.state[5] + f) >>> 0;
    this.state[6] = (this.state[6] + g) >>> 0;
    this.state[7] = (this.state[7] + h) >>> 0;
  }
}

export class IncrementalHmacSha256 implements StreamingDigest {
  private readonly inner = new IncrementalSha256();
  private readonly outerKeyPad = new Uint8Array(64);
  private finalized = false;

  constructor(key: Uint8Array) {
    const normalizedKey = new Uint8Array(64);
    if (key.byteLength > 64) {
      const hashed = new IncrementalSha256();
      hashed.update(key);
      const d = hashed.digest();
      normalizedKey.set(d, 0);
      zeroize(d);
    } else {
      normalizedKey.set(key, 0);
    }

    const innerKeyPad = new Uint8Array(64);
    for (let i = 0; i < 64; i++) {
      innerKeyPad[i] = normalizedKey[i] ^ 0x36;
      this.outerKeyPad[i] = normalizedKey[i] ^ 0x5c;
    }
    this.inner.update(innerKeyPad);
    zeroize(normalizedKey, innerKeyPad);
  }

  public update(chunk: Uint8Array): void {
    if (this.finalized) {
      throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'HMAC already finalized.');
    }
    this.inner.update(chunk);
  }

  public digest(): Uint8Array {
    if (this.finalized) {
      throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'HMAC already finalized.');
    }
    this.finalized = true;
    const innerDigest = this.inner.digest();
    const outer = new IncrementalSha256();
    outer.update(this.outerKeyPad);
    outer.update(innerDigest);
    const result = outer.digest();
    zeroize(innerDigest, this.outerKeyPad);
    return result;
  }
}

function toBufferSource(u8: Uint8Array): BufferSource {
  return new Uint8Array(u8.buffer, u8.byteOffset, u8.byteLength) as unknown as BufferSource;
}

export class WebCryptoProvider implements ZkCryptoProvider {
  private get subtle(): SubtleCrypto {
    if (!globalThis.crypto || !globalThis.crypto.subtle) {
      throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'WebCrypto SubtleCrypto is unavailable.');
    }
    return globalThis.crypto.subtle;
  }

  public randomBytes(length: number): Uint8Array {
    if (!Number.isInteger(length) || length < 0) {
      throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'Invalid randomBytes length.');
    }
    const out = new Uint8Array(length);
    let offset = 0;
    while (offset < length) {
      const sliceLen = Math.min(65536, length - offset);
      globalThis.crypto.getRandomValues(out.subarray(offset, offset + sliceLen));
      offset += sliceLen;
    }
    return out;
  }

  public async sha256(data: Uint8Array): Promise<Uint8Array> {
    const buf = await this.subtle.digest('SHA-256', toBufferSource(data));
    return new Uint8Array(buf);
  }

  public createSha256Stream(): StreamingDigest {
    return new IncrementalSha256();
  }

  public async hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
    if (key.byteLength === 0) {
      const mac = this.createHmacSha256Stream(key);
      mac.update(data);
      return mac.digest();
    }
    const cryptoKey = await this.subtle.importKey(
      'raw',
      toBufferSource(key),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await this.subtle.sign('HMAC', cryptoKey, toBufferSource(data));
    return new Uint8Array(sig);
  }

  public createHmacSha256Stream(key: Uint8Array): StreamingDigest {
    return new IncrementalHmacSha256(key);
  }

  public async hkdfSha256(
    ikm: Uint8Array,
    salt: Uint8Array,
    info: Uint8Array,
    length: number
  ): Promise<Uint8Array> {
    if (length <= 0 || length > 255 * 32) {
      throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'Invalid HKDF output length.');
    }
    const actualSalt = salt.byteLength > 0 ? salt : new Uint8Array(32);
    // Extract: PRK = HMAC-SHA256(salt, IKM)
    const prk = await this.hmacSha256(actualSalt, ikm);
    const okm = new Uint8Array(length);
    let t: Uint8Array = new Uint8Array(0);
    let offset = 0;
    let counter = 1;
    try {
      while (offset < length) {
        const input = concatBytes(t, info, new Uint8Array([counter]));
        zeroize(t);
        t = await this.hmacSha256(prk, input);
        zeroize(input);
        const take = Math.min(t.byteLength, length - offset);
        okm.set(t.subarray(0, take), offset);
        offset += take;
        counter++;
      }
      return okm;
    } finally {
      zeroize(prk, t);
    }
  }

  public async aes256GcmEncrypt(
    key: Uint8Array,
    nonce: Uint8Array,
    plaintext: Uint8Array,
    aad: Uint8Array
  ): Promise<Uint8Array> {
    if (key.byteLength !== 32) {
      throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'AES-256-GCM requires a 32-byte key.');
    }
    if (nonce.byteLength !== 12) {
      throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'AES-256-GCM requires a 12-byte nonce.');
    }
    const cryptoKey = await this.subtle.importKey(
      'raw',
      toBufferSource(key),
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );
    const ctWithTag = await this.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: toBufferSource(nonce),
        additionalData: toBufferSource(aad),
        tagLength: 128,
      },
      cryptoKey,
      toBufferSource(plaintext)
    );
    return new Uint8Array(ctWithTag);
  }

  public async aes256GcmDecrypt(
    key: Uint8Array,
    nonce: Uint8Array,
    ciphertextWithTag: Uint8Array,
    aad: Uint8Array,
    errorCodeOnFail: ZkErrorCode = ZkErrorCode.AUTH_TAG_MISMATCH
  ): Promise<Uint8Array> {
    if (key.byteLength !== 32) {
      throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'AES-256-GCM requires a 32-byte key.');
    }
    if (nonce.byteLength !== 12) {
      throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'AES-256-GCM requires a 12-byte nonce.');
    }
    if (ciphertextWithTag.byteLength < 16) {
      throw new ZkCryptoError(errorCodeOnFail, 'Ciphertext shorter than 16-byte GCM authentication tag.');
    }
    const cryptoKey = await this.subtle.importKey(
      'raw',
      toBufferSource(key),
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );
    try {
      const pt = await this.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: toBufferSource(nonce),
          additionalData: toBufferSource(aad),
          tagLength: 128,
        },
        cryptoKey,
        toBufferSource(ciphertextWithTag)
      );
      return new Uint8Array(pt);
    } catch {
      throw new ZkCryptoError(
        errorCodeOnFail,
        errorCodeOnFail === ZkErrorCode.WRONG_KEY_OR_PASSPHRASE
          ? 'Failed to unwrap key: invalid passphrase, key, or context AAD.'
          : 'AES-256-GCM authentication tag verification failed.'
      );
    }
  }
}

export const defaultCryptoProvider: ZkCryptoProvider = new WebCryptoProvider();
