import crypto from 'node:crypto';

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
