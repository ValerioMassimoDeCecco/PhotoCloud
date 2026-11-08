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
    const bytes = crypto.randomBytes(length);
    for (let i = 0; i < length; i++) {
      key += ALL_CHARS[bytes[i] % ALL_CHARS.length];
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
 * Verifies an API key against a stored SHA-256 hex hash.
 */
export function verifyKey(key: string, storedHash: string): boolean {
  return hashKey(key) === storedHash.trim();
}

/**
 * Derives a 32-byte AES-256 key using PBKDF2-HMAC-SHA256 with 100,000 iterations.
 */
export function deriveKey(key: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(Buffer.from(key, 'utf-8'), salt, 100000, 32, 'sha256');
}

/**
 * Encrypts file data using AES-256-CFB8 (compatible with Python cryptography modes.CFB)
 * Format: [16-byte salt][16-byte iv][ciphertext]
 */
export function encryptFile(fileData: Buffer, key: string): Buffer {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(16);
  const derivedKey = deriveKey(key, salt);
  // Python cryptography's modes.CFB defaults to 128-bit feedback (aes-256-cfb)
  const cipher = crypto.createCipheriv('aes-256-cfb', derivedKey, iv);
  const encrypted = Buffer.concat([cipher.update(fileData), cipher.final()]);
  return Buffer.concat([salt, iv, encrypted]);
}

/**
 * Decrypts file data encrypted by encryptFile.
 */
export function decryptFile(encryptedData: Buffer, key: string): Buffer {
  if (encryptedData.length < 32) {
    throw new Error('Encrypted payload too short');
  }
  const salt = encryptedData.subarray(0, 16);
  const iv = encryptedData.subarray(16, 32);
  const ciphertext = encryptedData.subarray(32);
  const derivedKey = deriveKey(key, salt);
  const decipher = crypto.createDecipheriv('aes-256-cfb', derivedKey, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
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
