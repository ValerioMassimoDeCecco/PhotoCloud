import crypto from 'node:crypto';
import fs from 'node:fs';

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const PUNCT = '!#$%&()*+,-./:;<=>?@[]^_{|}~';
const ALL_CHARS = LOWER + UPPER + DIGITS + PUNCT;

/**
 * Generates a secure API key with lowercase, uppercase, digits, and punctuation
 * matching Python's generate_api_key(length=32) in main.py.
 */
export function generateApiKey(length = 32): string {
  while (true) {
    let key = '';
    for (let i = 0; i < length; i++) {
      key += ALL_CHARS[crypto.randomInt(0, ALL_CHARS.length)];
    }
    const hasLower = [...key].some((c) => LOWER.includes(c));
    const hasUpper = [...key].some((c) => UPPER.includes(c));
    const hasDigit = [...key].some((c) => DIGITS.includes(c));
    const hasPunct = [...key].some((c) => PUNCT.includes(c));
    if (hasLower && hasUpper && hasDigit && hasPunct) {
      return key;
    }
  }
}

/**
 * Hashes an API key with SHA-256 hex digest.
 */
export function hashKey(key: string): string {
  return crypto.createHash('sha256').update(Buffer.from(key, 'utf-8')).digest('hex');
}

/**
 * Verifies an API key against a stored SHA-256 hex hash using constant-time comparison.
 */
export function verifyKey(key: string, storedHash: string): boolean {
  if (typeof key !== 'string' || typeof storedHash !== 'string') return false;
  const computedHex = hashKey(key);
  const cleanStored = storedHash.trim().toLowerCase();
  const computedBuf = Buffer.from(computedHex, 'utf-8');
  const storedBuf = Buffer.from(cleanStored, 'utf-8');
  if (computedBuf.length !== storedBuf.length) {
    // Compare computedBuf against itself to keep constant execution time before returning false
    crypto.timingSafeEqual(computedBuf, computedBuf);
    return false;
  }
  return crypto.timingSafeEqual(computedBuf, storedBuf);
}

const DERIVED_KEY_CACHE_MAX = 2048;
const DERIVED_KEY_CACHE = new Map<string, Buffer>();

function getDerivedKeyCacheKey(key: string, salt: Buffer): string {
  return `${hashKey(key)}:${salt.toString('hex')}`;
}

function setCachedDerivedKey(cacheKey: string, derived: Buffer): void {
  if (DERIVED_KEY_CACHE.has(cacheKey)) {
    DERIVED_KEY_CACHE.delete(cacheKey);
  } else if (DERIVED_KEY_CACHE.size >= DERIVED_KEY_CACHE_MAX) {
    const oldestKey = DERIVED_KEY_CACHE.keys().next().value;
    if (oldestKey !== undefined) {
      DERIVED_KEY_CACHE.delete(oldestKey);
    }
  }
  DERIVED_KEY_CACHE.set(cacheKey, derived);
}

/**
 * Derives a 32-byte AES-256 key using PBKDF2-HMAC-SHA256 with 100,000 iterations,
 * backed by a bounded LRU cache so repeated accesses (e.g. HTTP Range chunks) do not block the Event Loop.
 */
export function deriveKey(key: string, salt: Buffer): Buffer {
  const cacheKey = getDerivedKeyCacheKey(key, salt);
  const cached = DERIVED_KEY_CACHE.get(cacheKey);
  if (cached) {
    setCachedDerivedKey(cacheKey, cached);
    return cached;
  }
  const derived = crypto.pbkdf2Sync(Buffer.from(key, 'utf-8'), salt, 100000, 32, 'sha256');
  setCachedDerivedKey(cacheKey, derived);
  return derived;
}

/**
 * Non-blocking asynchronous PBKDF2 key derivation running on Node's libuv worker pool.
 */
export function deriveKeyAsync(key: string, salt: Buffer): Promise<Buffer> {
  const cacheKey = getDerivedKeyCacheKey(key, salt);
  const cached = DERIVED_KEY_CACHE.get(cacheKey);
  if (cached) {
    setCachedDerivedKey(cacheKey, cached);
    return Promise.resolve(cached);
  }
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(Buffer.from(key, 'utf-8'), salt, 100000, 32, 'sha256', (err, derivedKey) => {
      if (err) {
        reject(err);
        return;
      }
      setCachedDerivedKey(cacheKey, derivedKey);
      resolve(derivedKey);
    });
  });
}

// New files use authenticated encryption. Legacy salt/IV/CFB files remain readable.
const MAGIC = Buffer.from('PhotoCloud-GCM-v1\0', 'utf8');
const GCM_OVERHEAD = MAGIC.length + 16 + 12 + 16;
const STREAM_CHUNK_BYTES = 64 * 1024;

export function encryptedPlaintextSize(data: Buffer): number {
  return Math.max(0, data.length - (data.subarray(0, MAGIC.length).equals(MAGIC) ? GCM_OVERHEAD : 32));
}

export function encryptFile(fileData: Buffer, key: string): Buffer {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(key, salt), iv);
  const ciphertext = Buffer.concat([cipher.update(fileData), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), ciphertext]);
}

export async function encryptFileAsync(fileData: Buffer, key: string): Promise<Buffer> {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const derived = await deriveKeyAsync(key, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', derived, iv);
  const ciphertext = Buffer.concat([cipher.update(fileData), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), ciphertext]);
}

/**
 * Encrypts [inputPath] into [outputPath] using streaming 64 KB I/O without loading the file into RAM,
 * producing a payload byte-layout identical to encryptFile/encryptFileAsync while computing plaintext SHA-256.
 */
export async function encryptFileStream(
  inputPath: string,
  outputPath: string,
  key: string
): Promise<{ sha256: string; plaintextSize: number }> {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const derived = await deriveKeyAsync(key, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', derived, iv);
  const hash = crypto.createHash('sha256');
  const tmpPath = `${outputPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.enc.tmp`;

  let inHandle: fs.promises.FileHandle | null = null;
  let outHandle: fs.promises.FileHandle | null = null;
  let plaintextSize = 0;

  try {
    inHandle = await fs.promises.open(inputPath, 'r');
    outHandle = await fs.promises.open(tmpPath, 'w');

    // Reserve header: [MAGIC][salt][iv][16-byte tag placeholder]
    const header = Buffer.alloc(GCM_OVERHEAD);
    MAGIC.copy(header, 0);
    salt.copy(header, MAGIC.length);
    iv.copy(header, MAGIC.length + 16);

    let outPos = 0;
    await outHandle.write(header, 0, header.length, outPos);
    outPos += header.length;

    const readBuf = Buffer.allocUnsafe(STREAM_CHUNK_BYTES);
    let inPos = 0;
    while (true) {
      const { bytesRead } = await inHandle.read(readBuf, 0, readBuf.length, inPos);
      if (bytesRead <= 0) break;
      inPos += bytesRead;
      plaintextSize += bytesRead;
      const slice = readBuf.subarray(0, bytesRead);
      hash.update(slice);
      const encChunk = cipher.update(slice);
      if (encChunk.length > 0) {
        await outHandle.write(encChunk, 0, encChunk.length, outPos);
        outPos += encChunk.length;
      }
    }

    const finalChunk = cipher.final();
    if (finalChunk.length > 0) {
      await outHandle.write(finalChunk, 0, finalChunk.length, outPos);
      outPos += finalChunk.length;
    }

    const tag = cipher.getAuthTag();
    await outHandle.write(tag, 0, 16, MAGIC.length + 16 + 12);
    await outHandle.close();
    outHandle = null;
    await inHandle.close();
    inHandle = null;

    await fs.promises.rename(tmpPath, outputPath);
    return {
      sha256: hash.digest('hex'),
      plaintextSize,
    };
  } catch (err) {
    try {
      await inHandle?.close();
    } catch {
      // ignore
    }
    try {
      await outHandle?.close();
    } catch {
      // ignore
    }
    try {
      if (fs.existsSync(tmpPath)) {
        await fs.promises.unlink(tmpPath);
      }
    } catch {
      // ignore
    }
    throw err;
  }
}

export function decryptFile(encryptedData: Buffer, key: string): Buffer {
  if (encryptedData.subarray(0, MAGIC.length).equals(MAGIC)) {
    if (encryptedData.length < GCM_OVERHEAD) throw new Error('Encrypted payload too short');
    const offset = MAGIC.length;
    const salt = encryptedData.subarray(offset, offset + 16);
    const iv = encryptedData.subarray(offset + 16, offset + 28);
    const tag = encryptedData.subarray(offset + 28, offset + 44);
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(key, salt), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encryptedData.subarray(offset + 44)), decipher.final()]);
  }
  if (encryptedData.length < 32) throw new Error('Encrypted payload too short');
  const salt = encryptedData.subarray(0, 16);
  const iv = encryptedData.subarray(16, 32);
  const decipher = crypto.createDecipheriv('aes-256-cfb', deriveKey(key, salt), iv);
  return Buffer.concat([decipher.update(encryptedData.subarray(32)), decipher.final()]);
}

export async function decryptFileAsync(encryptedData: Buffer, key: string): Promise<Buffer> {
  if (encryptedData.subarray(0, MAGIC.length).equals(MAGIC)) {
    if (encryptedData.length < GCM_OVERHEAD) throw new Error('Encrypted payload too short');
    const offset = MAGIC.length;
    const salt = encryptedData.subarray(offset, offset + 16);
    const iv = encryptedData.subarray(offset + 16, offset + 28);
    const tag = encryptedData.subarray(offset + 28, offset + 44);
    const derived = await deriveKeyAsync(key, salt);
    const decipher = crypto.createDecipheriv('aes-256-gcm', derived, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encryptedData.subarray(offset + 44)), decipher.final()]);
  }
  if (encryptedData.length < 32) throw new Error('Encrypted payload too short');
  const salt = encryptedData.subarray(0, 16);
  const iv = encryptedData.subarray(16, 32);
  const derived = await deriveKeyAsync(key, salt);
  const decipher = crypto.createDecipheriv('aes-256-cfb', derived, iv);
  return Buffer.concat([decipher.update(encryptedData.subarray(32)), decipher.final()]);
}

/**
 * Streams decryption of [encryptedPath] in 64 KB chunks to compute SHA-256 of the plaintext
 * without loading large media files into RAM. Supports both PhotoCloud-GCM-v1 and legacy AES-CFB files.
 */
export async function decryptFileSha256Stream(
  encryptedPath: string,
  key: string
): Promise<{ sha256: string; plaintextSize: number }> {
  let fh: fs.promises.FileHandle | null = null;
  try {
    fh = await fs.promises.open(encryptedPath, 'r');
    const stat = await fh.stat();
    const prefixBuf = Buffer.alloc(Math.min(stat.size, GCM_OVERHEAD));
    if (prefixBuf.length > 0) {
      await fh.read(prefixBuf, 0, prefixBuf.length, 0);
    }

    let decipher: crypto.DecipherGCM | crypto.Decipheriv;
    let pos: number;

    if (prefixBuf.length >= MAGIC.length && prefixBuf.subarray(0, MAGIC.length).equals(MAGIC)) {
      if (stat.size < GCM_OVERHEAD) throw new Error('Encrypted payload too short');
      const offset = MAGIC.length;
      const salt = prefixBuf.subarray(offset, offset + 16);
      const iv = prefixBuf.subarray(offset + 16, offset + 28);
      const tag = prefixBuf.subarray(offset + 28, offset + 44);
      const derived = await deriveKeyAsync(key, salt);
      const gcm = crypto.createDecipheriv('aes-256-gcm', derived, iv);
      gcm.setAuthTag(tag);
      decipher = gcm;
      pos = GCM_OVERHEAD;
    } else {
      if (stat.size < 32) throw new Error('Encrypted payload too short');
      const salt = prefixBuf.subarray(0, 16);
      const iv = prefixBuf.subarray(16, 32);
      const derived = await deriveKeyAsync(key, salt);
      decipher = crypto.createDecipheriv('aes-256-cfb', derived, iv);
      pos = 32;
    }

    const hash = crypto.createHash('sha256');
    const chunkBuf = Buffer.allocUnsafe(STREAM_CHUNK_BYTES);
    let plaintextSize = 0;

    while (pos < stat.size) {
      const { bytesRead } = await fh.read(chunkBuf, 0, chunkBuf.length, pos);
      if (bytesRead <= 0) break;
      pos += bytesRead;
      const dec = decipher.update(chunkBuf.subarray(0, bytesRead));
      if (dec.length > 0) {
        hash.update(dec);
        plaintextSize += dec.length;
      }
    }

    const finalChunk = decipher.final();
    if (finalChunk.length > 0) {
      hash.update(finalChunk);
      plaintextSize += finalChunk.length;
    }

    return {
      sha256: hash.digest('hex'),
      plaintextSize,
    };
  } finally {
    try {
      await fh?.close();
    } catch {
      // ignore
    }
  }
}

/**
 * Calculates SHA-256 hash of decrypted media buffer for duplicate detection.
 */
export function calculateBufferHash(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Groups files with identical SHA-256 hashes into duplicate sets.
 */
export function findDuplicateGroups(items: Array<{ filename: string; hash: string | null }>): string[][] {
  const byHash = new Map<string, string[]>();
  for (const item of items) {
    if (!item.hash) continue;
    const list = byHash.get(item.hash) ?? [];
    list.push(item.filename);
    byHash.set(item.hash, list);
  }
  const duplicates: string[][] = [];
  for (const group of byHash.values()) {
    if (group.length > 1) {
      duplicates.push(group.sort());
    }
  }
  return duplicates;
}
