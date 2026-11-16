/**
 * PhotoCloud Zero-Knowledge Server API v2 (`/api/v2/*`).
 *
 * SECURITY INVARIANT (FASE 2):
 * - Questo modulo NON importa né contiene alcuna funzione di cifratura/decifratura
 *   di contenuto (AES-GCM, AES-CFB) o derivazione di chiavi utente (Argon2id client, HKDF).
 * - Le uniche primitive crittografiche ammesse sono:
 *   1. `crypto.scrypt` + `crypto.timingSafeEqual` per la verifica di `authSecret` sul server.
 *   2. `crypto.createHmac('sha256', serverSecret)` per generare parametri KDF finti deterministici
 *      su utenti inesistenti (`/api/v2/login/params`), prevenendo l'enumerazione utenti.
 *   3. `crypto.createHash('sha256')` esclusivamente sul ciphertext per integrità upload ed `ETag`.
 *   4. `crypto.randomUUID()` / `crypto.randomBytes()` per ID casuali, `serverSalt` e token di sessione/share.
 */

import express, { Request, Response, NextFunction, Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseTrustProxyConfig } from './trustProxy';

// ============================================================================
// Costanti normative da docs/zk-spec.md
// ============================================================================

export const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const USERNAME_V2_REGEX = /^[a-zA-Z0-9._-]{3,32}$/;
export const SHARE_ID_V2_REGEX = /^[A-Za-z0-9_-]{20,64}$/;
export const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/i;
export const BASE64URL_REGEX = /^[A-Za-z0-9_-]+$/;

export const PCZK_MAGIC = Buffer.from([0x50, 0x43, 0x5a, 0x4b]); // "PCZK"
export const PCZK_VERSION_V1 = 0x01;
export const PCZK_MIN_BLOB_BYTES = 102; // 70B header + 32B EOF frame

export const SCRYPT_PARAMS = {
  N: 32768,
  r: 8,
  p: 1,
  keylen: 32,
  maxmem: 64 * 1024 * 1024,
} as const;

export const DEFAULT_KDF_PARAMS = {
  algorithm: 'Argon2id' as const,
  memoryKiB: 65536,
  iterations: 3,
  parallelism: 1,
};

export const V2_SESSION_COOKIE_NAME = 'photocloud_v2_sid';
export const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 giorni
export const DEFAULT_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000; // 24 ore
export const DEFAULT_TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 giorni
export const DEFAULT_QUOTA_BYTES = 10 * 1024 * 1024 * 1024; // 10 GiB
export const DEFAULT_MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MiB
export const DEFAULT_MAX_UPLOAD_CHUNKS = 10_000;
export const MAX_ENC_META_BYTES = 64 * 1024; // 64 KiB
export const MAX_ALBUM_BLOB_BYTES = 4 * 1024 * 1024; // 4 MiB
export const MAX_THUMB_BLOB_BYTES = 2 * 1024 * 1024; // 2 MiB
export const MAX_CHUNK_BODY_BYTES = 16 * 1024 * 1024; // 16 MiB per chunk HTTP PUT

// ============================================================================
// Redazione Log & Protezione Segreti
// ============================================================================

const SENSITIVE_FIELD_NAMES = new Set([
  'authsecret',
  'oldauthsecret',
  'newauthsecret',
  'wrappedvaultkey',
  'wrappedvk',
  'wrappedfk',
  'encmeta',
  'passwordwrap',
  'passphrase',
  'password',
  'apikey',
  'cookie',
  'set-cookie',
  'authorization',
  'x-csrf-token',
  'csrf',
  'csrftoken',
]);

export interface ZkLogger {
  info(event: string, meta?: Record<string, unknown>): void;
  warn(event: string, meta?: Record<string, unknown>): void;
  error(event: string, meta?: Record<string, unknown>): void;
}

/**
 * Redige ricorsivamente qualsiasi chiave o valore sensibile da un oggetto di log.
 * I body delle richieste e gli header Cookie/Authorization non vengono mai registrati.
 */
export function redactLogData(input: unknown, depth = 0): unknown {
  if (depth > 6) return '[MAX_DEPTH]';
  if (input === null || input === undefined) return input;
  if (typeof input === 'boolean' || typeof input === 'number') return input;
  if (typeof input === 'string') {
    if (input.length > 120) {
      return '[REDACTED_LONG_STRING]';
    }
    return input;
  }
  if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    return `[BINARY_${input.byteLength}_BYTES]`;
  }
  if (Array.isArray(input)) {
    return input.slice(0, 20).map((item) => redactLogData(item, depth + 1));
  }
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      const normalized = k.toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (
        SENSITIVE_FIELD_NAMES.has(normalized) ||
        normalized.includes('secret') ||
        normalized.includes('wrapped') ||
        normalized.includes('token') ||
        normalized.includes('cookie') ||
        normalized.includes('meta') ||
        normalized.includes('password') ||
        normalized.includes('passphrase')
      ) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactLogData(v, depth + 1);
      }
    }
    return out;
  }
  return '[UNKNOWN]';
}

export function createRedactingLogger(sink?: (line: string) => void): ZkLogger {
  const emit = (level: 'INFO' | 'WARN' | 'ERROR', event: string, meta?: Record<string, unknown>) => {
    const safeMeta = meta ? (redactLogData(meta) as Record<string, unknown>) : undefined;
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      event,
      ...(safeMeta ? { meta: safeMeta } : {}),
    });
    if (sink) {
      sink(entry);
    }
  };
  return {
    info: (event, meta) => emit('INFO', event, meta),
    warn: (event, meta) => emit('WARN', event, meta),
    error: (event, meta) => emit('ERROR', event, meta),
  };
}

// ============================================================================
// Utilità Crittografiche Ammesse sul Server (scrypt, HMAC, SHA-256, CSPRNG)
// ============================================================================

export function isValidUuidV4(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4_REGEX.test(value);
}

export function decodeBase64UrlStrict(input: unknown, expectedByteLength?: number): Buffer | null {
  if (typeof input !== 'string' || input.length === 0 || !BASE64URL_REGEX.test(input)) {
    return null;
  }
  try {
    const buf = Buffer.from(input, 'base64url');
    if (expectedByteLength !== undefined && buf.byteLength !== expectedByteLength) {
      return null;
    }
    // Verifica canonical encoding
    if (buf.toString('base64url') !== input.replace(/=+$/, '')) {
      return null;
    }
    return buf;
  } catch {
    return null;
  }
}

export function computeScryptVerifierAsync(authSecretBytes: Buffer, serverSalt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      authSecretBytes,
      serverSalt,
      SCRYPT_PARAMS.keylen,
      {
        N: SCRYPT_PARAMS.N,
        r: SCRYPT_PARAMS.r,
        p: SCRYPT_PARAMS.p,
        maxmem: SCRYPT_PARAMS.maxmem,
      },
      (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey);
      }
    );
  });
}

export async function verifyScryptConstantTime(
  authSecretBytes: Buffer,
  serverSalt: Buffer,
  expectedVerifier: Buffer
): Promise<boolean> {
  const actual = await computeScryptVerifierAsync(authSecretBytes, serverSalt);
  if (actual.byteLength !== expectedVerifier.byteLength) {
    return false;
  }
  return crypto.timingSafeEqual(actual, expectedVerifier);
}

export function deriveFakeSaltForUsername(serverSecret: Buffer, username: string): string {
  const mac = crypto
    .createHmac('sha256', serverSecret)
    .update(`PhotoCloud-v2-fake-salt|${username.toLowerCase()}`, 'utf8')
    .digest();
  return mac.subarray(0, 16).toString('base64url');
}

export async function computeFileSha256Hex(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', (err) => reject(err));
    stream.on('end', () => resolve(hash.digest('hex').toLowerCase()));
  });
}

export function timingSafeHexEqual(hexA: string, hexB: string): boolean {
  if (!SHA256_HEX_REGEX.test(hexA) || !SHA256_HEX_REGEX.test(hexB)) {
    return false;
  }
  const bufA = Buffer.from(hexA.toLowerCase(), 'hex');
  const bufB = Buffer.from(hexB.toLowerCase(), 'hex');
  if (bufA.byteLength !== bufB.byteLength) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ============================================================================
// Scrittura Atomica su Filesystem (tmp + fsync + rename + dir fsync)
// ============================================================================

export function fsyncDirBestEffort(dirPath: string): void {
  try {
    const dirFd = fs.openSync(dirPath, 'r');
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch {
    // Alcuni filesystem su container non supportano fsync su directory
  }
}

export function writeBufferAtomicSync(tempDir: string, targetPath: string, data: Buffer): void {
  const parentDir = path.dirname(targetPath);
  fs.mkdirSync(parentDir, { recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });
  const tmpPath = path.join(
    tempDir,
    `v2_atomic_${Date.now()}_${crypto.randomBytes(8).toString('hex')}.tmp`
  );
  const fd = fs.openSync(tmpPath, 'w', 0o600);
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, targetPath);
  fsyncDirBestEffort(parentDir);
}

export function moveTempFileAtomicSync(tempFilePath: string, targetPath: string): void {
  const parentDir = path.dirname(targetPath);
  fs.mkdirSync(parentDir, { recursive: true });
  const fd = fs.openSync(tempFilePath, 'r+');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tempFilePath, targetPath);
  fsyncDirBestEffort(parentDir);
}

// ============================================================================
// Parsing Range HTTP RFC 9110 §14.1.2
// ============================================================================

export type ParsedHttpRange =
  | { kind: 'none' }
  | { kind: 'satisfiable'; start: number; end: number }
  | { kind: 'unsatisfiable' };

export function parseHttpRangeHeader(rangeHeader: string | undefined, totalSize: number): ParsedHttpRange {
  if (!rangeHeader || typeof rangeHeader !== 'string' || rangeHeader.trim() === '') {
    return { kind: 'none' };
  }
  const trimmed = rangeHeader.trim();
  if (!trimmed.startsWith('bytes=')) {
    return { kind: 'unsatisfiable' };
  }
  if (totalSize <= 0) {
    return { kind: 'unsatisfiable' };
  }
  const spec = trimmed.slice('bytes='.length).trim();
  // Rifiuta multi-range per semplicità e sicurezza DoS
  if (spec.includes(',')) {
    return { kind: 'unsatisfiable' };
  }
  const match = /^(\d*)-(\d*)$/.exec(spec);
  if (!match) {
    return { kind: 'unsatisfiable' };
  }
  const [, startStr, endStr] = match;
  if (startStr === '' && endStr === '') {
    return { kind: 'unsatisfiable' };
  }

  if (startStr === '') {
    // Suffix byte-range-spec: bytes=-N (ultimi N byte)
    const suffixLength = Number(endStr);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return { kind: 'unsatisfiable' };
    }
    const start = Math.max(0, totalSize - suffixLength);
    const end = totalSize - 1;
    return { kind: 'satisfiable', start, end };
  }

  const start = Number(startStr);
  if (!Number.isSafeInteger(start) || start < 0 || start >= totalSize) {
    return { kind: 'unsatisfiable' };
  }

  if (endStr === '') {
    // Prefix open range: bytes=start-
    return { kind: 'satisfiable', start, end: totalSize - 1 };
  }

  const requestedEnd = Number(endStr);
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) {
    return { kind: 'unsatisfiable' };
  }
  const end = Math.min(requestedEnd, totalSize - 1);
  return { kind: 'satisfiable', start, end };
}

// ============================================================================
// SQLite WAL Storage Engine (`ZkVaultStoreV2`)
// ============================================================================

export interface KdfParamsV2 {
  algorithm: 'Argon2id';
  memoryKiB: number;
  iterations: number;
  parallelism: number;
}

export interface UserRecordV2 {
  id: string;
  username: string;
  user_salt: string;
  kdf_params: string;
  server_salt: Buffer;
  auth_verifier: Buffer;
  wrapped_vk: string;
  quota_bytes: number;
  created_at: number;
  updated_at: number;
}

export interface ItemRecordV2 {
  id: string;
  owner_id: string;
  blob_id: string;
  version: number;
  size: number;
  sha256_hex: string;
  enc_meta: string;
  dedup_tag: string | null;
  state: 'active' | 'trashed';
  trashed_at: number | null;
  thumb_320: number;
  thumb_1280: number;
  created_at: number;
  updated_at: number;
}

export interface UploadSessionV2 {
  upload_id: string;
  owner_id: string;
  blob_id: string;
  total_size: number;
  chunk_size: number;
  total_chunks: number;
  received_chunks: number;
  received_bytes: number;
  expected_sha256: string;
  enc_meta: string;
  dedup_tag: string | null;
  item_id: string | null;
  temp_path: string;
  created_at: number;
  expires_at: number;
}

export class ZkVaultStoreV2 {
  public readonly db: DatabaseSync;
  public readonly vaultV2Dir: string;
  public readonly tempUploadDir: string;

  constructor(vaultV2Dir: string, tempUploadDir: string) {
    this.vaultV2Dir = path.resolve(vaultV2Dir);
    this.tempUploadDir = path.resolve(tempUploadDir);
    fs.mkdirSync(this.vaultV2Dir, { recursive: true });
    fs.mkdirSync(this.tempUploadDir, { recursive: true });

    const dbPath = path.join(this.vaultV2Dir, 'index.sqlite');
    this.db = new DatabaseSync(dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS users_v2 (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        user_salt TEXT NOT NULL,
        kdf_params TEXT NOT NULL,
        server_salt BLOB NOT NULL,
        auth_verifier BLOB NOT NULL,
        wrapped_vk TEXT NOT NULL,
        quota_bytes INTEGER NOT NULL DEFAULT 10737418240,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions_v2 (
        sid_hash BLOB PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users_v2(id) ON DELETE CASCADE,
        csrf_token TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS items_v2 (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users_v2(id) ON DELETE CASCADE,
        blob_id TEXT NOT NULL UNIQUE,
        version INTEGER NOT NULL DEFAULT 1,
        size INTEGER NOT NULL,
        sha256_hex TEXT NOT NULL,
        enc_meta TEXT NOT NULL,
        dedup_tag TEXT,
        state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'trashed')),
        trashed_at INTEGER,
        thumb_320 INTEGER NOT NULL DEFAULT 0,
        thumb_1280 INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_items_v2_owner_state_created
        ON items_v2(owner_id, state, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_items_v2_owner_dedup
        ON items_v2(owner_id, state, dedup_tag);

      CREATE TABLE IF NOT EXISTS uploads_v2 (
        upload_id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users_v2(id) ON DELETE CASCADE,
        blob_id TEXT NOT NULL,
        total_size INTEGER NOT NULL,
        chunk_size INTEGER NOT NULL,
        total_chunks INTEGER NOT NULL,
        received_chunks INTEGER NOT NULL DEFAULT 0,
        received_bytes INTEGER NOT NULL DEFAULT 0,
        expected_sha256 TEXT NOT NULL,
        enc_meta TEXT NOT NULL,
        dedup_tag TEXT,
        item_id TEXT,
        temp_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS albums_v2 (
        owner_id TEXT PRIMARY KEY REFERENCES users_v2(id) ON DELETE CASCADE,
        etag TEXT NOT NULL,
        size INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS shares_v2 (
        share_id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users_v2(id) ON DELETE CASCADE,
        enc_share_meta TEXT,
        password_wrap TEXT,
        expires_at INTEGER,
        max_downloads INTEGER,
        download_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS share_items_v2 (
        share_id TEXT NOT NULL REFERENCES shares_v2(share_id) ON DELETE CASCADE,
        blob_id TEXT NOT NULL,
        wrapped_fk TEXT NOT NULL,
        enc_item_meta TEXT,
        PRIMARY KEY (share_id, blob_id)
      );
    `);
  }

  public close(): void {
    this.db.close();
  }

  /**
   * Risolve il percorso fisico del blob cifrato `vault_v2/<userId>/<blobId[0..1]>/<blobId>`.
   * Valida rigorosamente sia `userId` sia `blobId` come UUID v4 e verifica il contenimento
   * in `vaultV2Dir` per impedire qualsiasi path traversal.
   */
  public resolveBlobPath(userId: string, blobId: string, suffix = ''): string {
    if (!isValidUuidV4(userId)) {
      throw new Error('INVALID_USER_ID');
    }
    if (!isValidUuidV4(blobId)) {
      throw new Error('INVALID_BLOB_ID');
    }
    if (suffix !== '' && suffix !== '.thumb320.pczk' && suffix !== '.thumb1280.pczk') {
      throw new Error('INVALID_BLOB_SUFFIX');
    }
    const normalizedUser = userId.toLowerCase();
    const normalizedBlob = blobId.toLowerCase();
    const shard = normalizedBlob.slice(0, 2);
    const resolved = path.resolve(this.vaultV2Dir, normalizedUser, shard, `${normalizedBlob}${suffix}`);
    const expectedPrefix = path.resolve(this.vaultV2Dir, normalizedUser) + path.sep;
    if (!resolved.startsWith(expectedPrefix)) {
      throw new Error('PATH_TRAVERSAL_DETECTED');
    }
    return resolved;
  }

  public resolveAlbumsBlobPath(userId: string): string {
    if (!isValidUuidV4(userId)) {
      throw new Error('INVALID_USER_ID');
    }
    const normalizedUser = userId.toLowerCase();
    const resolved = path.resolve(this.vaultV2Dir, normalizedUser, 'albums', 'albums.pczk');
    const expectedPrefix = path.resolve(this.vaultV2Dir, normalizedUser) + path.sep;
    if (!resolved.startsWith(expectedPrefix)) {
      throw new Error('PATH_TRAVERSAL_DETECTED');
    }
    return resolved;
  }

  public deleteBlobFilesBestEffort(userId: string, blobId: string): void {
    for (const suffix of ['', '.thumb320.pczk', '.thumb1280.pczk'] as const) {
      try {
        const p = this.resolveBlobPath(userId, blobId, suffix);
        if (fs.existsSync(p)) {
          fs.unlinkSync(p);
        }
      } catch {
        // Ignora errori di rimozione file orfano
      }
    }
  }

  public getUserUsage(userId: string): {
    activeBytes: number;
    trashedBytes: number;
    activeCount: number;
    trashedCount: number;
  } {
    const rows = this.db
      .prepare(
        `SELECT state, COUNT(*) as cnt, COALESCE(SUM(size), 0) as total_bytes
         FROM items_v2
         WHERE owner_id = ?
         GROUP BY state`
      )
      .all(userId) as Array<{ state: string; cnt: number; total_bytes: number }>;

    let activeBytes = 0;
    let trashedBytes = 0;
    let activeCount = 0;
    let trashedCount = 0;
    for (const r of rows) {
      if (r.state === 'active') {
        activeBytes = Number(r.total_bytes || 0);
        activeCount = Number(r.cnt || 0);
      } else if (r.state === 'trashed') {
        trashedBytes = Number(r.total_bytes || 0);
        trashedCount = Number(r.cnt || 0);
      }
    }
    return { activeBytes, trashedBytes, activeCount, trashedCount };
  }

  /**
   * Purga gli elementi nel cestino il cui `trashed_at` supera il TTL configurato.
   */
  public purgeExpiredTrash(ttlMs: number, nowMs = Date.now()): number {
    const cutoff = nowMs - ttlMs;
    const expired = this.db
      .prepare(
        `SELECT id, owner_id, blob_id FROM items_v2
         WHERE state = 'trashed' AND trashed_at IS NOT NULL AND trashed_at <= ?`
      )
      .all(cutoff) as Array<{ id: string; owner_id: string; blob_id: string }>;

    if (expired.length === 0) return 0;

    const delItem = this.db.prepare(`DELETE FROM items_v2 WHERE id = ? AND owner_id = ?`);
    const delShareItem = this.db.prepare(`DELETE FROM share_items_v2 WHERE blob_id = ?`);

    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of expired) {
        delItem.run(row.id, row.owner_id);
        delShareItem.run(row.blob_id);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    for (const row of expired) {
      this.deleteBlobFilesBestEffort(row.owner_id, row.blob_id);
    }
    return expired.length;
  }

  /**
   * Rimuove sessioni upload scadute e relativi file `.part` temporanei.
   */
  public cleanupExpiredUploads(nowMs = Date.now()): number {
    const expired = this.db
      .prepare(`SELECT upload_id, temp_path FROM uploads_v2 WHERE expires_at <= ?`)
      .all(nowMs) as Array<{ upload_id: string; temp_path: string }>;

    if (expired.length === 0) return 0;
    const del = this.db.prepare(`DELETE FROM uploads_v2 WHERE upload_id = ?`);
    for (const u of expired) {
      del.run(u.upload_id);
      try {
        if (fs.existsSync(u.temp_path)) fs.unlinkSync(u.temp_path);
      } catch {
        // ignore
      }
    }
    return expired.length;
  }
}

// ============================================================================
// Opzioni & Configurazione del Router v2
// ============================================================================

export interface ZkV2ServerOptions {
  vaultV2Dir: string;
  tempUploadDir: string;
  serverSecret: Buffer;
  defaultQuotaBytes?: number;
  maxUploadBytes?: number;
  maxUploadChunks?: number;
  sessionTtlMs?: number;
  trashTtlMs?: number;
  loginRateLimitMax?: number;
  loginRateLimitWindowMs?: number;
  shareRateLimitMaxPerIp?: number;
  shareRateLimitMaxPerShare?: number;
  shareRateLimitWindowMs?: number;
  logger?: ZkLogger;
  nowFn?: () => number;
}

interface AuthenticatedUserV2 {
  userId: string;
  username: string;
  sidHash: Buffer;
  csrfToken: string;
  quotaBytes: number;
}

function parseCookiesHeader(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx <= 0) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    result[key] = val;
  }
  return result;
}

function validateKdfParams(raw: unknown): KdfParamsV2 | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (obj.algorithm !== 'Argon2id') return null;
  const memoryKiB = Number(obj.memoryKiB);
  const iterations = Number(obj.iterations);
  const parallelism = Number(obj.parallelism);
  if (!Number.isSafeInteger(memoryKiB) || memoryKiB < 16384 || memoryKiB > 1048576) return null;
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 32) return null;
  if (!Number.isSafeInteger(parallelism) || parallelism < 1 || parallelism > 16) return null;
  return {
    algorithm: 'Argon2id',
    memoryKiB,
    iterations,
    parallelism,
  };
}

function validateEncMetaString(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  if (Buffer.byteLength(raw, 'utf8') > MAX_ENC_META_BYTES) return null;
  if (!BASE64URL_REGEX.test(raw)) return null;
  const decoded = Buffer.from(raw, 'base64url');
  // Minimo 12B nonce + 16B tag = 28 byte
  if (decoded.byteLength < 28 || decoded.byteLength > MAX_ENC_META_BYTES) return null;
  return raw;
}

function validateOptionalDedupTag(raw: unknown): string | null | 'INVALID' {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') return 'INVALID';
  if (SHA256_HEX_REGEX.test(raw)) return raw.toLowerCase();
  const b64 = decodeBase64UrlStrict(raw, 32);
  if (b64) return b64.toString('hex').toLowerCase();
  return 'INVALID';
}

function formatItemJson(row: ItemRecordV2) {
  const thumbs: number[] = [];
  if (row.thumb_320) thumbs.push(320);
  if (row.thumb_1280) thumbs.push(1280);
  return {
    id: row.id,
    blobId: row.blob_id,
    version: row.version,
    size: row.size,
    sha256: row.sha256_hex,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    state: row.state,
    trashedAt: row.trashed_at,
    encMeta: row.enc_meta,
    dedupTag: row.dedup_tag,
    thumbs,
  };
}

// ============================================================================
// Creazione del Router `/api/v2`
// ============================================================================

export function createZkV2Router(options: ZkV2ServerOptions): {
  router: Router;
  store: ZkVaultStoreV2;
  close: () => void;
} {
  const store = new ZkVaultStoreV2(options.vaultV2Dir, options.tempUploadDir);
  const logger = options.logger ?? createRedactingLogger();
  const nowFn = options.nowFn ?? (() => Date.now());
  const defaultQuotaBytes = options.defaultQuotaBytes ?? DEFAULT_QUOTA_BYTES;
  const maxUploadBytes = options.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
  const maxUploadChunks = options.maxUploadChunks ?? DEFAULT_MAX_UPLOAD_CHUNKS;
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  const trashTtlMs = options.trashTtlMs ?? DEFAULT_TRASH_TTL_MS;

  const loginRateLimitMax = options.loginRateLimitMax ?? 30;
  const loginRateLimitWindowMs = options.loginRateLimitWindowMs ?? 60_000;
  const shareRateLimitMaxPerIp = options.shareRateLimitMaxPerIp ?? 120;
  const shareRateLimitMaxPerShare = options.shareRateLimitMaxPerShare ?? 120;
  const shareRateLimitWindowMs = options.shareRateLimitWindowMs ?? 60_000;

  const loginRateBuckets = new Map<string, { count: number; resetAt: number }>();
  const shareIpRateBuckets = new Map<string, { count: number; resetAt: number }>();
  const shareIdRateBuckets = new Map<string, { count: number; resetAt: number }>();

  function checkRateBucket(
    map: Map<string, { count: number; resetAt: number }>,
    key: string,
    max: number,
    windowMs: number
  ): { allowed: boolean; retryAfterSec: number } {
    const now = nowFn();
    if (map.size > 2000) {
      for (const [k, v] of map.entries()) {
        if (now >= v.resetAt) map.delete(k);
      }
    }
    let bucket = map.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      map.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      };
    }
    return { allowed: true, retryAfterSec: 0 };
  }

  const router = express.Router();

  // Middleware di sicurezza trasversale per /api/v2/* (CSP, X-Content-Type-Options, CSRF Origin, Logging redatto)
  router.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    );

    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      const secFetchSite = String(req.headers['sec-fetch-site'] || '').trim().toLowerCase();
      if (secFetchSite === 'cross-site') {
        logger.warn('v2_csrf_blocked', { reason: 'sec-fetch-site', method: req.method, path: req.path });
        res.status(403).json({ error: 'CSRF_ORIGIN_MISMATCH' });
        return;
      }
      const origin = req.headers.origin;
      if (typeof origin === 'string' && origin.trim().length > 0) {
        if (origin.trim().toLowerCase() === 'null') {
          logger.warn('v2_csrf_blocked', { reason: 'null-origin', method: req.method, path: req.path });
          res.status(403).json({ error: 'CSRF_ORIGIN_MISMATCH' });
          return;
        }
        try {
          const originUrl = new URL(origin);
          const originHost = originUrl.host.toLowerCase();
          const originProto = originUrl.protocol.replace(/:$/, '').toLowerCase();
          const trustProxyEnabled = Boolean(req.app?.get('trust proxy'));

          const rawForwardedProto = trustProxyEnabled
            ? String(req.headers['x-forwarded-proto'] || '')
                .split(',')[0]
                .trim()
                .toLowerCase()
            : '';
          if ((rawForwardedProto === 'http' || rawForwardedProto === 'https') && originProto !== rawForwardedProto) {
            logger.warn('v2_csrf_blocked', { reason: 'proto-mismatch', method: req.method, path: req.path });
            res.status(403).json({ error: 'CSRF_ORIGIN_MISMATCH' });
            return;
          }

          const rawTargetHost = String(
            (trustProxyEnabled ? req.headers['x-forwarded-host'] : '') || req.headers.host || ''
          )
            .split(',')[0]
            .trim()
            .toLowerCase();

          if (rawTargetHost) {
            const effectiveProto =
              rawForwardedProto === 'http' || rawForwardedProto === 'https' ? rawForwardedProto : originProto;
            const normalizedTargetHost = new URL(`${effectiveProto}://${rawTargetHost}`).host.toLowerCase();
            if (originHost !== normalizedTargetHost) {
              logger.warn('v2_csrf_blocked', { reason: 'host-mismatch', method: req.method, path: req.path });
              res.status(403).json({ error: 'CSRF_ORIGIN_MISMATCH' });
              return;
            }
          }
        } catch {
          logger.warn('v2_csrf_blocked', { reason: 'invalid-origin', method: req.method, path: req.path });
          res.status(403).json({ error: 'CSRF_ORIGIN_MISMATCH' });
          return;
        }
      }
    }

    // Registra l'evento di richiesta senza mai includere body, query sensibili o header Cookie/Authorization
    logger.info('v2_request', {
      method: req.method,
      path: req.path,
    });
    next();
  });

  // Helper di autenticazione sessione v2
  function getAuthenticatedSession(req: Request): AuthenticatedUserV2 | null {
    const cookies = parseCookiesHeader(req.headers.cookie);
    const rawSid = cookies[V2_SESSION_COOKIE_NAME];
    if (!rawSid || typeof rawSid !== 'string' || rawSid.length < 32) {
      return null;
    }
    const sidHash = crypto.createHash('sha256').update(rawSid, 'utf8').digest();
    const now = nowFn();

    const row = store.db
      .prepare(
        `SELECT s.sid_hash, s.user_id, s.csrf_token, s.expires_at, u.username, u.quota_bytes
         FROM sessions_v2 s
         JOIN users_v2 u ON u.id = s.user_id
         WHERE s.sid_hash = ?`
      )
      .get(sidHash) as
      | {
          sid_hash: Buffer;
          user_id: string;
          csrf_token: string;
          expires_at: number;
          username: string;
          quota_bytes: number;
        }
      | undefined;

    if (!row) return null;
    if (now >= Number(row.expires_at)) {
      store.db.prepare(`DELETE FROM sessions_v2 WHERE sid_hash = ?`).run(sidHash);
      return null;
    }

    return {
      userId: row.user_id,
      username: row.username,
      sidHash,
      csrfToken: row.csrf_token,
      quotaBytes: Number(row.quota_bytes),
    };
  }

  function requireAuth(req: Request, res: Response): AuthenticatedUserV2 | null {
    const sess = getAuthenticatedSession(req);
    if (!sess) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return null;
    }
    return sess;
  }

  function issueSessionCookie(res: Response, userId: string): { csrfToken: string } {
    const rawSid = crypto.randomBytes(32).toString('base64url');
    const sidHash = crypto.createHash('sha256').update(rawSid, 'utf8').digest();
    const csrfToken = crypto.randomBytes(24).toString('base64url');
    const now = nowFn();
    const expiresAt = now + sessionTtlMs;

    store.db
      .prepare(
        `INSERT INTO sessions_v2 (sid_hash, user_id, csrf_token, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(sidHash, userId, csrfToken, now, expiresAt);

    const maxAgeSec = Math.max(1, Math.floor(sessionTtlMs / 1000));
    res.setHeader(
      'Set-Cookie',
      `${V2_SESSION_COOKIE_NAME}=${rawSid}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSec}`
    );
    return { csrfToken };
  }

  function clearSessionCookie(res: Response): void {
    res.setHeader(
      'Set-Cookie',
      `${V2_SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
    );
  }

  function enforceLoginRateLimit(req: Request, res: Response): boolean {
    const clientIp = String(req.ip || req.socket.remoteAddress || 'unknown');
    const check = checkRateBucket(loginRateBuckets, clientIp, loginRateLimitMax, loginRateLimitWindowMs);
    if (!check.allowed) {
      res.status(429).setHeader('Retry-After', String(check.retryAfterSec)).json({ error: 'RATE_LIMITED' });
      return false;
    }
    return true;
  }

  // ==========================================================================
  // 1. ACCOUNT ENDPOINTS (`/register`, `/login/params`, `/login`, `/logout`, `/account/rewrap`)
  // ==========================================================================

  const handleRegister = async (req: Request, res: Response) => {
    if (!enforceLoginRateLimit(req, res)) return;

    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    if (!USERNAME_V2_REGEX.test(username)) {
      res.status(400).json({ error: 'INVALID_USERNAME' });
      return;
    }

    const saltBuf = decodeBase64UrlStrict(req.body?.salt, 16);
    if (!saltBuf) {
      res.status(400).json({ error: 'INVALID_USER_SALT' });
      return;
    }

    const kdfParams = validateKdfParams(req.body?.kdfParams);
    if (!kdfParams) {
      res.status(400).json({ error: 'INVALID_KDF_PARAMS' });
      return;
    }

    const authSecretBuf = decodeBase64UrlStrict(req.body?.authSecret, 32);
    if (!authSecretBuf) {
      res.status(400).json({ error: 'INVALID_AUTH_SECRET' });
      return;
    }

    // wrappedVaultKey = 12B IV + 32B VK + 16B tag = 60 byte
    const wrappedVkBuf = decodeBase64UrlStrict(req.body?.wrappedVaultKey, 60);
    if (!wrappedVkBuf) {
      res.status(400).json({ error: 'INVALID_WRAPPED_VAULT_KEY' });
      return;
    }

    const existing = store.db
      .prepare(`SELECT id FROM users_v2 WHERE username = ?`)
      .get(username) as { id: string } | undefined;
    if (existing) {
      res.status(409).json({ error: 'USERNAME_ALREADY_EXISTS' });
      return;
    }

    const userId = crypto.randomUUID();
    const serverSalt = crypto.randomBytes(16);
    const authVerifier = await computeScryptVerifierAsync(authSecretBuf, serverSalt);
    authSecretBuf.fill(0);

    const now = nowFn();
    try {
      store.db
        .prepare(
          `INSERT INTO users_v2 (
             id, username, user_salt, kdf_params, server_salt, auth_verifier, wrapped_vk, quota_bytes, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          userId,
          username,
          req.body.salt,
          JSON.stringify(kdfParams),
          serverSalt,
          authVerifier,
          req.body.wrappedVaultKey,
          defaultQuotaBytes,
          now,
          now
        );
    } catch {
      res.status(409).json({ error: 'USERNAME_ALREADY_EXISTS' });
      return;
    }

    const { csrfToken } = issueSessionCookie(res, userId);
    logger.info('v2_user_registered', { userId });
    res.status(201).json({
      userId,
      username,
      salt: req.body.salt,
      kdfParams,
      wrappedVaultKey: req.body.wrappedVaultKey,
      csrfToken,
    });
  };

  router.post('/register', handleRegister);
  router.post('/auth/register', handleRegister);

  const handleLoginParams = async (req: Request, res: Response) => {
    if (!enforceLoginRateLimit(req, res)) return;

    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    if (!USERNAME_V2_REGEX.test(username)) {
      res.status(400).json({ error: 'INVALID_USERNAME' });
      return;
    }

    const row = store.db
      .prepare(`SELECT user_salt, kdf_params, server_salt FROM users_v2 WHERE username = ?`)
      .get(username) as { user_salt: string; kdf_params: string; server_salt: Buffer } | undefined;

    // Eseguiamo sempre un calcolo scrypt dummy per uniformare la distribuzione temporale
    // tra utente esistente e utente inesistente.
    const dummySecret = crypto
      .createHmac('sha256', options.serverSecret)
      .update(`PhotoCloud-v2-params-timing|${username.toLowerCase()}`, 'utf8')
      .digest();
    const dummySalt = row ? Buffer.from(row.server_salt) : dummySecret.subarray(0, 16);
    await computeScryptVerifierAsync(dummySecret, dummySalt);

    if (row) {
      let parsedKdf: KdfParamsV2 = DEFAULT_KDF_PARAMS;
      try {
        parsedKdf = JSON.parse(row.kdf_params) as KdfParamsV2;
      } catch {
        parsedKdf = DEFAULT_KDF_PARAMS;
      }
      res.status(200).json({
        salt: row.user_salt,
        kdfParams: {
          algorithm: parsedKdf.algorithm,
          memoryKiB: parsedKdf.memoryKiB,
          iterations: parsedKdf.iterations,
          parallelism: parsedKdf.parallelism,
        },
      });
      return;
    }

    const fakeSalt = deriveFakeSaltForUsername(options.serverSecret, username);
    res.status(200).json({
      salt: fakeSalt,
      kdfParams: { ...DEFAULT_KDF_PARAMS },
    });
  };

  router.post('/login/params', handleLoginParams);
  router.post('/auth/params', handleLoginParams);

  const handleLogin = async (req: Request, res: Response) => {
    if (!enforceLoginRateLimit(req, res)) return;

    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const authSecretBuf = decodeBase64UrlStrict(req.body?.authSecret, 32);
    if (!USERNAME_V2_REGEX.test(username) || !authSecretBuf) {
      res.status(401).json({ error: 'INVALID_CREDENTIALS' });
      return;
    }

    const row = store.db
      .prepare(
        `SELECT id, username, user_salt, kdf_params, server_salt, auth_verifier, wrapped_vk
         FROM users_v2 WHERE username = ?`
      )
      .get(username) as UserRecordV2 | undefined;

    if (!row) {
      // Utente inesistente: esegui comunque scrypt completo per evitare timing oracle
      const fakeServerSalt = crypto
        .createHmac('sha256', options.serverSecret)
        .update(`PhotoCloud-v2-fake-server-salt|${username.toLowerCase()}`, 'utf8')
        .digest()
        .subarray(0, 16);
      await computeScryptVerifierAsync(authSecretBuf, fakeServerSalt);
      authSecretBuf.fill(0);
      res.status(401).json({ error: 'INVALID_CREDENTIALS' });
      return;
    }

    const ok = await verifyScryptConstantTime(
      authSecretBuf,
      Buffer.from(row.server_salt),
      Buffer.from(row.auth_verifier)
    );
    authSecretBuf.fill(0);

    if (!ok) {
      logger.warn('v2_login_failed', { userId: row.id });
      res.status(401).json({ error: 'INVALID_CREDENTIALS' });
      return;
    }

    const { csrfToken } = issueSessionCookie(res, row.id);
    let parsedKdf: KdfParamsV2 = DEFAULT_KDF_PARAMS;
    try {
      parsedKdf = JSON.parse(row.kdf_params) as KdfParamsV2;
    } catch {
      parsedKdf = DEFAULT_KDF_PARAMS;
    }

    logger.info('v2_login_success', { userId: row.id });
    res.status(200).json({
      userId: row.id,
      username: row.username,
      salt: row.user_salt,
      kdfParams: parsedKdf,
      wrappedVaultKey: row.wrapped_vk,
      csrfToken,
    });
  };

  router.post('/login', handleLogin);
  router.post('/auth/login', handleLogin);

  const handleLogout = (req: Request, res: Response) => {
    const sess = getAuthenticatedSession(req);
    if (sess) {
      store.db.prepare(`DELETE FROM sessions_v2 WHERE sid_hash = ?`).run(sess.sidHash);
      logger.info('v2_logout', { userId: sess.userId });
    }
    clearSessionCookie(res);
    res.status(200).json({ ok: true });
  };

  router.post('/logout', handleLogout);
  router.post('/auth/logout', handleLogout);

  const handleAccountRewrap = async (req: Request, res: Response) => {
    const sess = requireAuth(req, res);
    if (!sess) return;

    const oldAuthSecretBuf = decodeBase64UrlStrict(req.body?.oldAuthSecret, 32);
    const newAuthSecretBuf = decodeBase64UrlStrict(req.body?.newAuthSecret, 32);
    const newWrappedVk = req.body?.newWrappedVaultKey ?? req.body?.wrappedVaultKey;
    const newWrappedVkBuf = decodeBase64UrlStrict(newWrappedVk, 60);
    const newSaltRaw = req.body?.newSalt ?? req.body?.salt;
    const newKdfRaw = req.body?.newKdfParams ?? req.body?.kdfParams;

    if (!oldAuthSecretBuf || !newAuthSecretBuf || !newWrappedVkBuf) {
      res.status(400).json({ error: 'INVALID_REWRAP_PAYLOAD' });
      return;
    }

    const userRow = store.db
      .prepare(`SELECT id, user_salt, kdf_params, server_salt, auth_verifier FROM users_v2 WHERE id = ?`)
      .get(sess.userId) as UserRecordV2 | undefined;

    if (!userRow) {
      oldAuthSecretBuf.fill(0);
      newAuthSecretBuf.fill(0);
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }

    const validOld = await verifyScryptConstantTime(
      oldAuthSecretBuf,
      Buffer.from(userRow.server_salt),
      Buffer.from(userRow.auth_verifier)
    );
    oldAuthSecretBuf.fill(0);

    if (!validOld) {
      newAuthSecretBuf.fill(0);
      res.status(401).json({ error: 'INVALID_OLD_AUTH_SECRET' });
      return;
    }

    let nextUserSalt = userRow.user_salt;
    if (newSaltRaw !== undefined) {
      const parsedSalt = decodeBase64UrlStrict(newSaltRaw, 16);
      if (!parsedSalt) {
        newAuthSecretBuf.fill(0);
        res.status(400).json({ error: 'INVALID_USER_SALT' });
        return;
      }
      nextUserSalt = newSaltRaw;
    }

    let nextKdfJson = userRow.kdf_params;
    if (newKdfRaw !== undefined) {
      const parsedKdf = validateKdfParams(newKdfRaw);
      if (!parsedKdf) {
        newAuthSecretBuf.fill(0);
        res.status(400).json({ error: 'INVALID_KDF_PARAMS' });
        return;
      }
      nextKdfJson = JSON.stringify(parsedKdf);
    }

    const newServerSalt = crypto.randomBytes(16);
    const newVerifier = await computeScryptVerifierAsync(newAuthSecretBuf, newServerSalt);
    newAuthSecretBuf.fill(0);

    const now = nowFn();
    store.db.exec('BEGIN IMMEDIATE');
    try {
      store.db
        .prepare(
          `UPDATE users_v2
           SET user_salt = ?, kdf_params = ?, server_salt = ?, auth_verifier = ?, wrapped_vk = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(nextUserSalt, nextKdfJson, newServerSalt, newVerifier, newWrappedVk, now, sess.userId);
      // Invalida tutte le altre sessioni dell'utente mantenendo quella corrente
      store.db
        .prepare(`DELETE FROM sessions_v2 WHERE user_id = ? AND sid_hash != ?`)
        .run(sess.userId, sess.sidHash);
      store.db.exec('COMMIT');
    } catch (err) {
      store.db.exec('ROLLBACK');
      throw err;
    }

    logger.info('v2_account_rewrapped', { userId: sess.userId });
    res.status(200).json({
      ok: true,
      salt: nextUserSalt,
      kdfParams: JSON.parse(nextKdfJson),
      wrappedVaultKey: newWrappedVk,
    });
  };

  router.post('/account/rewrap', handleAccountRewrap);
  router.put('/auth/passphrase', handleAccountRewrap);

  // ==========================================================================
  // 2. BLOB CHUNKED UPLOAD & RANGE DOWNLOAD
  // ==========================================================================

  router.post('/blobs/upload/init', (req: Request, res: Response) => {
    const sess = requireAuth(req, res);
    if (!sess) return;

    store.cleanupExpiredUploads(nowFn());

    const blobId = req.body?.blobId;
    if (!isValidUuidV4(blobId)) {
      res.status(400).json({ error: 'INVALID_BLOB_ID' });
      return;
    }
    const normalizedBlobId = blobId.toLowerCase();

    const itemIdRaw = req.body?.itemId;
    let itemId: string | null = null;
    if (itemIdRaw !== undefined && itemIdRaw !== null) {
      if (!isValidUuidV4(itemIdRaw)) {
        res.status(400).json({ error: 'INVALID_ITEM_ID' });
        return;
      }
      itemId = itemIdRaw.toLowerCase();
    }

    const totalSize = Number(req.body?.totalSize);
    if (
      !Number.isSafeInteger(totalSize) ||
      totalSize < PCZK_MIN_BLOB_BYTES ||
      totalSize > maxUploadBytes
    ) {
      res.status(400).json({ error: 'INVALID_TOTAL_SIZE' });
      return;
    }

    const chunkSize = Number(req.body?.chunkSize ?? totalSize);
    const totalChunks = Number(req.body?.totalChunks ?? 1);
    if (
      !Number.isSafeInteger(chunkSize) ||
      chunkSize <= 0 ||
      chunkSize > MAX_CHUNK_BODY_BYTES ||
      !Number.isSafeInteger(totalChunks) ||
      totalChunks < 1 ||
      totalChunks > maxUploadChunks
    ) {
      res.status(400).json({ error: 'INVALID_CHUNK_SPEC' });
      return;
    }

    const expectedSha256 = typeof req.body?.expectedSha256 === 'string' ? req.body.expectedSha256.trim() : '';
    if (!SHA256_HEX_REGEX.test(expectedSha256)) {
      res.status(400).json({ error: 'INVALID_EXPECTED_SHA256' });
      return;
    }

    const encMeta = validateEncMetaString(req.body?.encMeta);
    if (!encMeta) {
      res.status(400).json({ error: 'INVALID_ENC_META' });
      return;
    }

    const dedupTag = validateOptionalDedupTag(req.body?.dedupTag);
    if (dedupTag === 'INVALID') {
      res.status(400).json({ error: 'INVALID_DEDUP_TAG' });
      return;
    }

    // Verifica che il blobId non sia già registrato nel DB
    const existingBlob = store.db
      .prepare(`SELECT id FROM items_v2 WHERE blob_id = ?`)
      .get(normalizedBlobId) as { id: string } | undefined;
    if (existingBlob) {
      res.status(409).json({ error: 'BLOB_ID_ALREADY_EXISTS' });
      return;
    }

    // Verifica quota utente (active + trashed + in-flight uploads + nuovo upload)
    const usage = store.getUserUsage(sess.userId);
    const inflightRow = store.db
      .prepare(`SELECT COALESCE(SUM(total_size), 0) as inflight FROM uploads_v2 WHERE owner_id = ?`)
      .get(sess.userId) as { inflight: number };
    const inflightBytes = Number(inflightRow?.inflight || 0);

    if (usage.activeBytes + usage.trashedBytes + inflightBytes + totalSize > sess.quotaBytes) {
      res.status(413).json({ error: 'QUOTA_EXCEEDED' });
      return;
    }

    const uploadId = crypto.randomUUID();
    const tempPath = path.join(store.tempUploadDir, `v2_upload_${uploadId}.part`);
    // Crea file .part vuoto con permessi 0600 (contiene solo ciphertext)
    const fd = fs.openSync(tempPath, 'w', 0o600);
    fs.closeSync(fd);

    const now = nowFn();
    const expiresAt = now + DEFAULT_UPLOAD_TTL_MS;

    store.db
      .prepare(
        `INSERT INTO uploads_v2 (
           upload_id, owner_id, blob_id, total_size, chunk_size, total_chunks,
           received_chunks, received_bytes, expected_sha256, enc_meta, dedup_tag,
           item_id, temp_path, created_at, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        uploadId,
        sess.userId,
        normalizedBlobId,
        totalSize,
        chunkSize,
        totalChunks,
        expectedSha256.toLowerCase(),
        encMeta,
        dedupTag,
        itemId,
        tempPath,
        now,
        expiresAt
      );

    res.status(201).json({
      uploadId,
      blobId: normalizedBlobId,
      receivedChunks: 0,
      expiresAt,
    });
  });

  router.put(
    '/blobs/upload/:uploadId/:chunkIndex',
    express.raw({ type: '*/*', limit: MAX_CHUNK_BODY_BYTES }),
    (req: Request, res: Response) => {
      const sess = requireAuth(req, res);
      if (!sess) return;

      const uploadId = String(req.params.uploadId || '');
      if (!isValidUuidV4(uploadId)) {
        res.status(404).json({ error: 'NOT_FOUND' });
        return;
      }

      const chunkIndex = Number(req.params.chunkIndex);
      if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0) {
        res.status(400).json({ error: 'INVALID_CHUNK_INDEX' });
        return;
      }

      const uploadRow = store.db
        .prepare(`SELECT * FROM uploads_v2 WHERE upload_id = ? AND owner_id = ?`)
        .get(uploadId, sess.userId) as UploadSessionV2 | undefined;

      // Cross-user o inesistente -> sempre 404
      if (!uploadRow) {
        res.status(404).json({ error: 'NOT_FOUND' });
        return;
      }

      if (nowFn() >= Number(uploadRow.expires_at)) {
        store.db.prepare(`DELETE FROM uploads_v2 WHERE upload_id = ?`).run(uploadId);
        try {
          if (fs.existsSync(uploadRow.temp_path)) fs.unlinkSync(uploadRow.temp_path);
        } catch {
          // ignore
        }
        res.status(404).json({ error: 'UPLOAD_EXPIRED' });
        return;
      }

      if (chunkIndex !== Number(uploadRow.received_chunks)) {
        res.status(409).json({
          error: 'CHUNK_OUT_OF_ORDER',
          expectedChunkIndex: Number(uploadRow.received_chunks),
        });
        return;
      }

      if (chunkIndex >= Number(uploadRow.total_chunks)) {
        res.status(400).json({ error: 'CHUNK_INDEX_EXCEEDS_TOTAL' });
        return;
      }

      const bodyBuf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (bodyBuf.byteLength === 0) {
        res.status(400).json({ error: 'EMPTY_CHUNK_BODY' });
        return;
      }

      const newReceivedBytes = Number(uploadRow.received_bytes) + bodyBuf.byteLength;
      if (newReceivedBytes > Number(uploadRow.total_size)) {
        res.status(413).json({ error: 'UPLOAD_SIZE_EXCEEDED' });
        return;
      }

      // Al chunk 0 validiamo che il blob inizi con un header PCZK\x01 e che i byte 6..21 corrispondano a blobId
      if (chunkIndex === 0) {
        if (bodyBuf.byteLength < 22) {
          res.status(400).json({ error: 'INVALID_PCZK_HEADER' });
          return;
        }
        if (!bodyBuf.subarray(0, 4).equals(PCZK_MAGIC) || bodyBuf[4] !== PCZK_VERSION_V1) {
          res.status(400).json({ error: 'INVALID_PCZK_MAGIC_OR_VERSION' });
          return;
        }
        const headerBlobHex = bodyBuf.subarray(6, 22).toString('hex').toLowerCase();
        const expectedBlobHex = uploadRow.blob_id.replace(/-/g, '').toLowerCase();
        if (headerBlobHex !== expectedBlobHex) {
          res.status(400).json({ error: 'HEADER_BLOB_ID_MISMATCH' });
          return;
        }
      }

      const fd = fs.openSync(uploadRow.temp_path, 'a', 0o600);
      try {
        fs.writeFileSync(fd, bodyBuf);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }

      const nextReceivedChunks = chunkIndex + 1;
      store.db
        .prepare(
          `UPDATE uploads_v2
           SET received_chunks = ?, received_bytes = ?
           WHERE upload_id = ? AND owner_id = ?`
        )
        .run(nextReceivedChunks, newReceivedBytes, uploadId, sess.userId);

      res.status(200).json({
        uploadId,
        chunkIndex,
        receivedChunks: nextReceivedChunks,
        receivedBytes: newReceivedBytes,
      });
    }
  );

  router.post('/blobs/upload/:uploadId/complete', async (req: Request, res: Response) => {
    const sess = requireAuth(req, res);
    if (!sess) return;

    const uploadId = String(req.params.uploadId || '');
    if (!isValidUuidV4(uploadId)) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    const uploadRow = store.db
      .prepare(`SELECT * FROM uploads_v2 WHERE upload_id = ? AND owner_id = ?`)
      .get(uploadId, sess.userId) as UploadSessionV2 | undefined;

    if (!uploadRow) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    if (
      Number(uploadRow.received_chunks) !== Number(uploadRow.total_chunks) ||
      Number(uploadRow.received_bytes) !== Number(uploadRow.total_size)
    ) {
      res.status(409).json({
        error: 'UPLOAD_INCOMPLETE',
        receivedChunks: Number(uploadRow.received_chunks),
        totalChunks: Number(uploadRow.total_chunks),
        receivedBytes: Number(uploadRow.received_bytes),
        totalSize: Number(uploadRow.total_size),
      });
      return;
    }

    if (!fs.existsSync(uploadRow.temp_path)) {
      store.db.prepare(`DELETE FROM uploads_v2 WHERE upload_id = ?`).run(uploadId);
      res.status(404).json({ error: 'UPLOAD_TEMP_MISSING' });
      return;
    }

    const actualStat = fs.statSync(uploadRow.temp_path);
    if (actualStat.size !== Number(uploadRow.total_size)) {
      fs.unlinkSync(uploadRow.temp_path);
      store.db.prepare(`DELETE FROM uploads_v2 WHERE upload_id = ?`).run(uploadId);
      res.status(422).json({ error: 'CIPHERTEXT_SIZE_MISMATCH' });
      return;
    }

    const actualSha256 = await computeFileSha256Hex(uploadRow.temp_path);
    if (!timingSafeHexEqual(actualSha256, uploadRow.expected_sha256)) {
      try {
        fs.unlinkSync(uploadRow.temp_path);
      } catch {
        // ignore
      }
      store.db.prepare(`DELETE FROM uploads_v2 WHERE upload_id = ?`).run(uploadId);
      logger.warn('v2_upload_sha256_mismatch', { userId: sess.userId, blobId: uploadRow.blob_id });
      res.status(422).json({ error: 'CIPHERTEXT_INTEGRITY_MISMATCH' });
      return;
    }

    // Ricontrolla quota prima del commit finale
    const usage = store.getUserUsage(sess.userId);
    if (usage.activeBytes + usage.trashedBytes + Number(uploadRow.total_size) > sess.quotaBytes) {
      try {
        fs.unlinkSync(uploadRow.temp_path);
      } catch {
        // ignore
      }
      store.db.prepare(`DELETE FROM uploads_v2 WHERE upload_id = ?`).run(uploadId);
      res.status(413).json({ error: 'QUOTA_EXCEEDED' });
      return;
    }

    const finalBlobPath = store.resolveBlobPath(sess.userId, uploadRow.blob_id);
    moveTempFileAtomicSync(uploadRow.temp_path, finalBlobPath);

    const now = nowFn();
    const itemId = uploadRow.item_id ?? uploadRow.blob_id;
    const createItem = req.body?.createItem !== false;

    store.db.exec('BEGIN IMMEDIATE');
    try {
      store.db.prepare(`DELETE FROM uploads_v2 WHERE upload_id = ?`).run(uploadId);
      if (createItem) {
        store.db
          .prepare(
            `INSERT INTO items_v2 (
               id, owner_id, blob_id, version, size, sha256_hex, enc_meta, dedup_tag,
               state, trashed_at, thumb_320, thumb_1280, created_at, updated_at
             ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, 'active', NULL, 0, 0, ?, ?)`
          )
          .run(
            itemId,
            sess.userId,
            uploadRow.blob_id,
            uploadRow.total_size,
            actualSha256,
            uploadRow.enc_meta,
            uploadRow.dedup_tag,
            now,
            now
          );
      }
      store.db.exec('COMMIT');
    } catch (err) {
      store.db.exec('ROLLBACK');
      try {
        if (fs.existsSync(finalBlobPath)) fs.unlinkSync(finalBlobPath);
      } catch {
        // ignore
      }
      res.status(409).json({ error: 'ITEM_CONFLICT' });
      return;
    }

    logger.info('v2_blob_upload_completed', {
      userId: sess.userId,
      blobId: uploadRow.blob_id,
      size: uploadRow.total_size,
    });

    if (createItem) {
      const created = store.db
        .prepare(`SELECT * FROM items_v2 WHERE id = ? AND owner_id = ?`)
        .get(itemId, sess.userId) as unknown as ItemRecordV2;
      res.status(201).json({
        item: formatItemJson(created),
      });
    } else {
      res.status(201).json({
        blobId: uploadRow.blob_id,
        size: uploadRow.total_size,
        sha256: actualSha256,
      });
    }
  });

  // Helper per lo streaming di un blob cifrato con supporto RFC 9110 Range
  function streamCiphertextBlobWithRange(
    req: Request,
    res: Response,
    filePath: string,
    totalSize: number,
    sha256Hex: string
  ): void {
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    const etag = `"${sha256Hex}"`;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('ETag', etag);

    const ifNoneMatch = req.headers['if-none-match'];
    if (typeof ifNoneMatch === 'string' && ifNoneMatch.trim() === etag && !req.headers.range) {
      res.status(304).end();
      return;
    }

    const parsedRange = parseHttpRangeHeader(req.headers.range, totalSize);
    if (parsedRange.kind === 'unsatisfiable') {
      res.status(416);
      res.setHeader('Content-Range', `bytes */${totalSize}`);
      res.end();
      return;
    }

    if (parsedRange.kind === 'none') {
      res.status(200);
      res.setHeader('Content-Length', String(totalSize));
      const stream = fs.createReadStream(filePath);
      stream.on('error', () => {
        if (!res.headersSent) res.status(500).end();
        else res.destroy();
      });
      stream.pipe(res);
      return;
    }

    const { start, end } = parsedRange;
    const chunkLength = end - start + 1;
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
    res.setHeader('Content-Length', String(chunkLength));
    const stream = fs.createReadStream(filePath, { start, end });
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).end();
      else res.destroy();
    });
    stream.pipe(res);
  }

  router.get('/blobs/:id', (req: Request, res: Response) => {
    const sess = requireAuth(req, res);
    if (!sess) return;

    const blobId = String(req.params.id || '');
    if (!isValidUuidV4(blobId)) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    const normalizedBlobId = blobId.toLowerCase();

    const itemRow = store.db
      .prepare(`SELECT owner_id, blob_id, size, sha256_hex FROM items_v2 WHERE blob_id = ? AND owner_id = ?`)
      .get(normalizedBlobId, sess.userId) as
      | { owner_id: string; blob_id: string; size: number; sha256_hex: string }
      | undefined;

    if (!itemRow) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    const blobPath = store.resolveBlobPath(sess.userId, normalizedBlobId);
    streamCiphertextBlobWithRange(req, res, blobPath, Number(itemRow.size), itemRow.sha256_hex);
  });

  // Thumbnail cifrate del blob (`320` | `1280`)
  router.put(
    '/blobs/:id/thumbs/:variant',
    express.raw({ type: '*/*', limit: MAX_THUMB_BLOB_BYTES }),
    (req: Request, res: Response) => {
      const sess = requireAuth(req, res);
      if (!sess) return;

      const blobId = String(req.params.id || '');
      const variant = String(req.params.variant || '');
      if (!isValidUuidV4(blobId) || (variant !== '320' && variant !== '1280')) {
        res.status(404).json({ error: 'NOT_FOUND' });
        return;
      }
      const normalizedBlobId = blobId.toLowerCase();

      const itemRow = store.db
        .prepare(`SELECT id FROM items_v2 WHERE blob_id = ? AND owner_id = ?`)
        .get(normalizedBlobId, sess.userId) as { id: string } | undefined;

      if (!itemRow) {
        res.status(404).json({ error: 'NOT_FOUND' });
        return;
      }

      const bodyBuf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (bodyBuf.byteLength < PCZK_MIN_BLOB_BYTES || bodyBuf.byteLength > MAX_THUMB_BLOB_BYTES) {
        res.status(400).json({ error: 'INVALID_THUMB_SIZE' });
        return;
      }
      if (!bodyBuf.subarray(0, 4).equals(PCZK_MAGIC) || bodyBuf[4] !== PCZK_VERSION_V1) {
        res.status(400).json({ error: 'INVALID_PCZK_MAGIC_OR_VERSION' });
        return;
      }

      const suffix = variant === '320' ? '.thumb320.pczk' : '.thumb1280.pczk';
      const thumbPath = store.resolveBlobPath(sess.userId, normalizedBlobId, suffix);
      writeBufferAtomicSync(store.tempUploadDir, thumbPath, bodyBuf);

      const col = variant === '320' ? 'thumb_320' : 'thumb_1280';
      store.db
        .prepare(`UPDATE items_v2 SET ${col} = 1, updated_at = ? WHERE id = ? AND owner_id = ?`)
        .run(nowFn(), itemRow.id, sess.userId);

      res.status(200).json({ ok: true, blobId: normalizedBlobId, variant: Number(variant) });
    }
  );

  router.get('/blobs/:id/thumbs/:variant', (req: Request, res: Response) => {
    const sess = requireAuth(req, res);
    if (!sess) return;

    const blobId = String(req.params.id || '');
    const variant = String(req.params.variant || '');
    if (!isValidUuidV4(blobId) || (variant !== '320' && variant !== '1280')) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    const normalizedBlobId = blobId.toLowerCase();

    const itemRow = store.db
      .prepare(`SELECT id, thumb_320, thumb_1280 FROM items_v2 WHERE blob_id = ? AND owner_id = ?`)
      .get(normalizedBlobId, sess.userId) as
      | { id: string; thumb_320: number; thumb_1280: number }
      | undefined;

    if (!itemRow) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    const hasThumb = variant === '320' ? Boolean(itemRow.thumb_320) : Boolean(itemRow.thumb_1280);
    if (!hasThumb) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    const suffix = variant === '320' ? '.thumb320.pczk' : '.thumb1280.pczk';
    const thumbPath = store.resolveBlobPath(sess.userId, normalizedBlobId, suffix);
    if (!fs.existsSync(thumbPath)) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    const stat = fs.statSync(thumbPath);
    const data = fs.readFileSync(thumbPath);
    const sha = crypto.createHash('sha256').update(data).digest('hex');
    streamCiphertextBlobWithRange(req, res, thumbPath, stat.size, sha);
  });

  // ==========================================================================
  // 3. ITEM ENDPOINTS (List paginata, Get, Aggiorna encMeta, Sostituzione Blob)
  // ==========================================================================

  router.get('/items', (req: Request, res: Response) => {
    const sess = requireAuth(req, res);
    if (!sess) return;

    store.purgeExpiredTrash(trashTtlMs, nowFn());

    const stateParam = String(req.query.state || 'active');
    if (stateParam !== 'active' && stateParam !== 'trashed') {
      res.status(400).json({ error: 'INVALID_STATE_FILTER' });
      return;
    }

    const limitRaw = Number(req.query.limit ?? 100);
    const limit = Number.isSafeInteger(limitRaw) ? Math.min(500, Math.max(1, limitRaw)) : 100;
    const cursorRaw = typeof req.query.cursor === 'string' ? req.query.cursor.trim() : '';

    let rows: ItemRecordV2[];
    if (cursorRaw) {
      const decoded = Buffer.from(cursorRaw, 'base64url').toString('utf8');
      const [tsStr, idPart] = decoded.split('|');
      const cursorTs = Number(tsStr);
      if (!Number.isSafeInteger(cursorTs) || !isValidUuidV4(idPart)) {
        res.status(400).json({ error: 'INVALID_CURSOR' });
        return;
      }
      rows = store.db
        .prepare(
          `SELECT * FROM items_v2
           WHERE owner_id = ? AND state = ?
             AND (created_at < ? OR (created_at = ? AND id < ?))
           ORDER BY created_at DESC, id DESC
           LIMIT ?`
        )
        .all(sess.userId, stateParam, cursorTs, cursorTs, idPart.toLowerCase(), limit + 1) as unknown as ItemRecordV2[];
    } else {
      rows = store.db
        .prepare(
          `SELECT * FROM items_v2
           WHERE owner_id = ? AND state = ?
           ORDER BY created_at DESC, id DESC
           LIMIT ?`
        )
        .all(sess.userId, stateParam, limit + 1) as unknown as ItemRecordV2[];
    }

    let nextCursor: string | null = null;
    if (rows.length > limit) {
      const last = rows[limit - 1];
      rows = rows.slice(0, limit);
      nextCursor = Buffer.from(`${last.created_at}|${last.id}`, 'utf8').toString('base64url');
    }

    res.status(200).json({
      items: rows.map(formatItemJson),
      nextCursor,
    });
  });

  router.get('/items/:id', (req: Request, res: Response) => {
    const sess = requireAuth(req, res);
    if (!sess) return;

    const itemId = String(req.params.id || '');
    if (!isValidUuidV4(itemId)) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    const row = store.db
      .prepare(`SELECT * FROM items_v2 WHERE id = ? AND owner_id = ?`)
      .get(itemId.toLowerCase(), sess.userId) as ItemRecordV2 | undefined;

    if (!row) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    res.status(200).json({ item: formatItemJson(row) });
  });

  const handleUpdateItemMeta = (req: Request, res: Response) => {
    const sess = requireAuth(req, res);
    if (!sess) return;

    const itemId = String(req.params.id || '');
    if (!isValidUuidV4(itemId)) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    const normalizedId = itemId.toLowerCase();

    const row = store.db
      .prepare(`SELECT * FROM items_v2 WHERE id = ? AND owner_id = ?`)
      .get(normalizedId, sess.userId) as ItemRecordV2 | undefined;

    if (!row) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    const encMeta = validateEncMetaString(req.body?.encMeta);
    if (!encMeta) {
      res.status(400).json({ error: 'INVALID_ENC_META' });
      return;
    }

    const expectedVersion = req.body?.expectedVersion;
    if (expectedVersion !== undefined && Number(expectedVersion) !== Number(row.version)) {
      res.status(412).json({ error: 'VERSION_MISMATCH', currentVersion: row.version });
      return;
    }

    const now = nowFn();
    const nextVersion = Number(row.version) + 1;
    store.db
      .prepare(
        `UPDATE items_v2
         SET enc_meta = ?, version = ?, updated_at = ?
         WHERE id = ? AND owner_id = ?`
      )
      .run(encMeta, nextVersion, now, normalizedId, sess.userId);

    const updated = store.db
      .prepare(`SELECT * FROM items_v2 WHERE id = ? AND owner_id = ?`)
      .get(normalizedId, sess.userId) as unknown as ItemRecordV2;

    res.status(200).json({ item: formatItemJson(updated) });
  };

  router.patch('/items/:id/meta', handleUpdateItemMeta);
  router.put('/items/:id/meta', handleUpdateItemMeta);

  // Sostituzione blob di un item (es. post photo-editing client-side) con controllo di versione
  router.post('/items/:id/replace', (req: Request, res: Response) => {
    const sess = requireAuth(req, res);
    if (!sess) return;

    const itemId = String(req.params.id || '');
    if (!isValidUuidV4(itemId)) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    const normalizedItemId = itemId.toLowerCase();

    const row = store.db
      .prepare(`SELECT * FROM items_v2 WHERE id = ? AND owner_id = ?`)
      .get(normalizedItemId, sess.userId) as ItemRecordV2 | undefined;

    if (!row) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    const expectedVersion = Number(req.body?.expectedVersion);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== Number(row.version)) {
      res.status(412).json({ error: 'VERSION_MISMATCH', currentVersion: row.version });
      return;
    }

    const newBlobId = req.body?.newBlobId;
    if (!isValidUuidV4(newBlobId)) {
      res.status(400).json({ error: 'INVALID_BLOB_ID' });
      return;
    }
    const normalizedNewBlobId = newBlobId.toLowerCase();

    const encMeta = validateEncMetaString(req.body?.encMeta);
    if (!encMeta) {
      res.status(400).json({ error: 'INVALID_ENC_META' });
      return;
    }

    const dedupTag = validateOptionalDedupTag(req.body?.dedupTag);
    if (dedupTag === 'INVALID') {
      res.status(400).json({ error: 'INVALID_DEDUP_TAG' });
      return;
    }

    const newBlobPath = store.resolveBlobPath(sess.userId, normalizedNewBlobId);
    if (!fs.existsSync(newBlobPath)) {
      res.status(404).json({ error: 'NEW_BLOB_NOT_FOUND' });
      return;
    }

    const stat = fs.statSync(newBlobPath);
    const data = fs.readFileSync(newBlobPath);
    const sha256Hex = crypto.createHash('sha256').update(data).digest('hex');

    const oldBlobId = row.blob_id;
    const nextVersion = Number(row.version) + 1;
    const now = nowFn();

    store.db.exec('BEGIN IMMEDIATE');
    try {
      // Se esisteva un item temporaneo creato per newBlobId, rimuovilo prima di riassegnare
      store.db
        .prepare(`DELETE FROM items_v2 WHERE blob_id = ? AND owner_id = ? AND id != ?`)
        .run(normalizedNewBlobId, sess.userId, normalizedItemId);

      store.db
        .prepare(
          `UPDATE items_v2
           SET blob_id = ?, version = ?, size = ?, sha256_hex = ?, enc_meta = ?, dedup_tag = ?,
               thumb_320 = 0, thumb_1280 = 0, updated_at = ?
           WHERE id = ? AND owner_id = ?`
        )
        .run(
          normalizedNewBlobId,
          nextVersion,
          stat.size,
          sha256Hex,
          encMeta,
          dedupTag,
          now,
          normalizedItemId,
          sess.userId
        );
      store.db.exec('COMMIT');
    } catch (err) {
      store.db.exec('ROLLBACK');
      throw err;
    }

    if (oldBlobId !== normalizedNewBlobId) {
      store.deleteBlobFilesBestEffort(sess.userId, oldBlobId);
    }

    const updated = store.db
      .prepare(`SELECT * FROM items_v2 WHERE id = ? AND owner_id = ?`)
      .get(normalizedItemId, sess.userId) as unknown as ItemRecordV2;

    res.status(200).json({ item: formatItemJson(updated) });
  });

  // ==========================================================================
  // 4. DEDUP ENDPOINT (`/backup/check`)
  // ==========================================================================

  router.post('/backup/check', (req: Request, res: Response) => {
    const sess = requireAuth(req, res);
    if (!sess) return;

    const rawTags = req.body?.dedupTags;
    if (!Array.isArray(rawTags) || rawTags.length > 5000) {
      res.status(400).json({ error: 'INVALID_DEDUP_TAGS' });
      return;
    }

    const normalizedMap = new Map<string, string>();
    for (const t of rawTags) {
      const v = validateOptionalDedupTag(t);
      if (!v || v === 'INVALID') {
        res.status(400).json({ error: 'INVALID_DEDUP_TAG_ELEMENT' });
        return;
      }
      normalizedMap.set(v, String(t));
    }

    if (normalizedMap.size === 0) {
      res.status(200).json({ existingTags: [], existingItems: {} });
      return;
    }

    // Considera SOLO item active dell'utente autenticato (mai trashed, mai cross-user)
    const stmt = store.db.prepare(
      `SELECT id, blob_id, dedup_tag FROM items_v2
       WHERE owner_id = ? AND state = 'active' AND dedup_tag = ?`
    );

    const existingTags: string[] = [];
    const existingItems: Record<string, { itemId: string; blobId: string }> = {};

    for (const [normTag, originalTag] of normalizedMap.entries()) {
      const hit = stmt.get(sess.userId, normTag) as
        | { id: string; blob_id: string; dedup_tag: string }
        | undefined;
      if (hit) {
        existingTags.push(originalTag);
        existingItems[originalTag] = { itemId: hit.id, blobId: hit.blob_id };
      }
    }

    res.status(200).json({ existingTags, existingItems });
  });

  // ==========================================================================
  // 5. ALBUM CATALOG ENDPOINTS (`GET/PUT /albums` con `If-Match`/`ETag` e `412`)
  // ==========================================================================

  router.get('/albums', (req: Request, res: Response) => {
    const sess = requireAuth(req, res);
    if (!sess) return;

    const albumRow = store.db
      .prepare(`SELECT etag, size, updated_at FROM albums_v2 WHERE owner_id = ?`)
      .get(sess.userId) as { etag: string; size: number; updated_at: number } | undefined;

    if (!albumRow) {
      res.status(404).json({ error: 'ALBUMS_NOT_INITIALIZED' });
      return;
    }

    const albumPath = store.resolveAlbumsBlobPath(sess.userId);
    if (!fs.existsSync(albumPath)) {
      res.status(404).json({ error: 'ALBUMS_NOT_INITIALIZED' });
      return;
    }

    const quotedEtag = `"${albumRow.etag}"`;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('ETag', quotedEtag);
    res.setHeader('Cache-Control', 'private, no-cache');

    if (req.headers['if-none-match'] === quotedEtag) {
      res.status(304).end();
      return;
    }

    const data = fs.readFileSync(albumPath);
    res.status(200).send(data);
  });

  router.put(
    '/albums',
    express.raw({ type: '*/*', limit: MAX_ALBUM_BLOB_BYTES }),
    (req: Request, res: Response) => {
      const sess = requireAuth(req, res);
      if (!sess) return;

      const bodyBuf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (bodyBuf.byteLength === 0 || bodyBuf.byteLength > MAX_ALBUM_BLOB_BYTES) {
        res.status(400).json({ error: 'INVALID_ALBUMS_BLOB_SIZE' });
        return;
      }

      const currentRow = store.db
        .prepare(`SELECT etag FROM albums_v2 WHERE owner_id = ?`)
        .get(sess.userId) as { etag: string } | undefined;

      const ifMatchHeader = typeof req.headers['if-match'] === 'string' ? req.headers['if-match'].trim() : '';
      const ifNoneMatchHeader =
        typeof req.headers['if-none-match'] === 'string' ? req.headers['if-none-match'].trim() : '';

      if (!currentRow) {
        // Creazione iniziale: se il client invia un If-Match specifico (non '*'), fallisce con 412
        if (ifMatchHeader && ifMatchHeader !== '*') {
          res.status(412).json({ error: 'PRECONDITION_FAILED' });
          return;
        }
      } else {
        // Aggiornamento: richiede If-Match corrispondente all'ETag corrente (e rifiuta If-None-Match: *)
        if (ifNoneMatchHeader === '*') {
          res.status(412).json({ error: 'PRECONDITION_FAILED', currentEtag: `"${currentRow.etag}"` });
          return;
        }
        const normalizedIfMatch = ifMatchHeader.replace(/^"|"$/g, '');
        if (!ifMatchHeader || normalizedIfMatch !== currentRow.etag) {
          res.status(412).json({ error: 'PRECONDITION_FAILED', currentEtag: `"${currentRow.etag}"` });
          return;
        }
      }

      const newEtag = crypto.createHash('sha256').update(bodyBuf).digest('hex');
      const albumPath = store.resolveAlbumsBlobPath(sess.userId);
      writeBufferAtomicSync(store.tempUploadDir, albumPath, bodyBuf);

      const now = nowFn();
      store.db
        .prepare(
          `INSERT INTO albums_v2 (owner_id, etag, size, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(owner_id) DO UPDATE SET etag = excluded.etag, size = excluded.size, updated_at = excluded.updated_at`
        )
        .run(sess.userId, newEtag, bodyBuf.byteLength, now);

      res.setHeader('ETag', `"${newEtag}"`);
      res.status(200).json({
        etag: `"${newEtag}"`,
        size: bodyBuf.byteLength,
        updatedAt: now,
      });
    }
  );

  // ==========================================================================
  // 6. TRASH ENDPOINTS (Move to trash, Restore, Permanent Delete, Empty Trash)
  // ==========================================================================

  router.post('/trash', (req: Request, res: Response) => {
    const sess = requireAuth(req, res);
    if (!sess) return;

    const rawIds: unknown[] = Array.isArray(req.body?.itemIds)
      ? req.body.itemIds
      : req.body?.itemId
        ? [req.body.itemId]
        : [];

    if (rawIds.length === 0 || rawIds.length > 1000 || !rawIds.every(isValidUuidV4)) {
      res.status(400).json({ error: 'INVALID_ITEM_IDS' });
      return;
    }
    const normalizedIds = rawIds.map((id) => (id as string).toLowerCase());

    const checkStmt = store.db.prepare(`SELECT id FROM items_v2 WHERE id = ? AND owner_id = ?`);
    for (const id of normalizedIds) {
      if (!checkStmt.get(id, sess.userId)) {
        res.status(404).json({ error: 'NOT_FOUND' });
        return;
      }
    }

    const now = nowFn();
    const updateStmt = store.db.prepare(
      `UPDATE items_v2
       SET state = 'trashed', trashed_at = ?, updated_at = ?
       WHERE id = ? AND owner_id = ?`
    );

    store.db.exec('BEGIN IMMEDIATE');
    try {
      for (const id of normalizedIds) {
        updateStmt.run(now, now, id, sess.userId);
      }
      store.db.exec('COMMIT');
    } catch (err) {
      store.db.exec('ROLLBACK');
      throw err;
    }

    res.status(200).json({ trashedIds: normalizedIds, trashedAt: now });
  });

  router.post('/trash/restore', (req: Request, res: Response) => {
    const sess = requireAuth(req, res);
    if (!sess) return;

    const rawIds: unknown[] = Array.isArray(req.body?.itemIds)
      ? req.body.itemIds
      : req.body?.itemId
        ? [req.body.itemId]
        : [];

    if (rawIds.length === 0 || rawIds.length > 1000 || !rawIds.every(isValidUuidV4)) {
      res.status(400).json({ error: 'INVALID_ITEM_IDS' });
      return;
    }
    const normalizedIds = rawIds.map((id) => (id as string).toLowerCase());

    const checkStmt = store.db.prepare(`SELECT id FROM items_v2 WHERE id = ? AND owner_id = ?`);
    for (const id of normalizedIds) {
      if (!checkStmt.get(id, sess.userId)) {
        res.status(404).json({ error: 'NOT_FOUND' });
        return;
      }
    }

    const now = nowFn();
    const restoreStmt = store.db.prepare(
      `UPDATE items_v2
       SET state = 'active', trashed_at = NULL, updated_at = ?
       WHERE id = ? AND owner_id = ?`
    );

    store.db.exec('BEGIN IMMEDIATE');
    try {
      for (const id of normalizedIds) {
        restoreStmt.run(now, id, sess.userId);
      }
      store.db.exec('COMMIT');
    } catch (err) {
      store.db.exec('ROLLBACK');
      throw err;
    }

    res.status(200).json({ restoredIds: normalizedIds });
  });

  // Eliminazione definitiva di un singolo item (`DELETE /items/:id`)
  router.delete('/items/:id', (req: Request, res: Response) => {
    const sess = requireAuth(req, res);
    if (!sess) return;

    const itemId = String(req.params.id || '');
    if (!isValidUuidV4(itemId)) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    const normalizedId = itemId.toLowerCase();

    const row = store.db
      .prepare(`SELECT id, blob_id FROM items_v2 WHERE id = ? AND owner_id = ?`)
      .get(normalizedId, sess.userId) as { id: string; blob_id: string } | undefined;

    if (!row) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    store.db.exec('BEGIN IMMEDIATE');
    try {
      store.db.prepare(`DELETE FROM items_v2 WHERE id = ? AND owner_id = ?`).run(normalizedId, sess.userId);
      store.db.prepare(`DELETE FROM share_items_v2 WHERE blob_id = ?`).run(row.blob_id);
      store.db.exec('COMMIT');
    } catch (err) {
      store.db.exec('ROLLBACK');
      throw err;
    }

    store.deleteBlobFilesBestEffort(sess.userId, row.blob_id);
    res.status(200).json({ deletedId: normalizedId });
  });

  // Svuota l'intero cestino dell'utente (`DELETE /trash`)
  router.delete('/trash', (req: Request, res: Response) => {
    const sess = requireAuth(req, res);
    if (!sess) return;

    const trashedRows = store.db
      .prepare(`SELECT id, blob_id FROM items_v2 WHERE owner_id = ? AND state = 'trashed'`)
      .all(sess.userId) as Array<{ id: string; blob_id: string }>;

    const delShareItem = store.db.prepare(`DELETE FROM share_items_v2 WHERE blob_id = ?`);

    store.db.exec('BEGIN IMMEDIATE');
    try {
      store.db.prepare(`DELETE FROM items_v2 WHERE owner_id = ? AND state = 'trashed'`).run(sess.userId);
      for (const r of trashedRows) {
        delShareItem.run(r.blob_id);
      }
      store.db.exec('COMMIT');
    } catch (err) {
      store.db.exec('ROLLBACK');
      throw err;
    }

    for (const r of trashedRows) {
      store.deleteBlobFilesBestEffort(sess.userId, r.blob_id);
    }

    res.status(200).json({ deletedCount: trashedRows.length });
  });

  // ==========================================================================
  // 7. STATS ENDPOINT (`GET /stats` — solo byte attivi, cestino e conteggi, zero categorie)
  // ==========================================================================

  router.get('/stats', (req: Request, res: Response) => {
    const sess = requireAuth(req, res);
    if (!sess) return;

    store.purgeExpiredTrash(trashTtlMs, nowFn());
    const usage = store.getUserUsage(sess.userId);

    res.status(200).json({
      activeBytes: usage.activeBytes,
      trashedBytes: usage.trashedBytes,
      activeCount: usage.activeCount,
      trashedCount: usage.trashedCount,
      quotaBytes: sess.quotaBytes,
    });
  });

  // ==========================================================================
  // 8. SHARE ENDPOINTS (Creazione/Revoca su blob del proprietario, GET pubblici rate-limited)
  // ==========================================================================

  router.post('/shares', (req: Request, res: Response) => {
    const sess = requireAuth(req, res);
    if (!sess) return;

    const itemsInput = req.body?.items;
    if (!Array.isArray(itemsInput) || itemsInput.length === 0 || itemsInput.length > 500) {
      res.status(400).json({ error: 'INVALID_SHARE_ITEMS' });
      return;
    }

    const validatedItems: Array<{ blobId: string; wrappedFk: string; encItemMeta: string | null }> = [];
    const checkOwnerBlob = store.db.prepare(
      `SELECT id FROM items_v2 WHERE blob_id = ? AND owner_id = ? AND state = 'active'`
    );

    for (const entry of itemsInput) {
      if (!entry || typeof entry !== 'object') {
        res.status(400).json({ error: 'INVALID_SHARE_ITEM_ENTRY' });
        return;
      }
      const blobId = (entry as Record<string, unknown>).blobId;
      const wrappedFk = (entry as Record<string, unknown>).wrappedFk;
      const encItemMetaRaw = (entry as Record<string, unknown>).encItemMeta;

      if (!isValidUuidV4(blobId)) {
        res.status(404).json({ error: 'NOT_FOUND' });
        return;
      }
      const normalizedBlobId = blobId.toLowerCase();

      // Verifica che il blob appartenga all'utente autenticato; altrimenti 404 (mai 403)
      const owned = checkOwnerBlob.get(normalizedBlobId, sess.userId);
      if (!owned) {
        res.status(404).json({ error: 'NOT_FOUND' });
        return;
      }

      // wrappedFk = 12B IV + 32B FK + 16B tag = 60 byte
      const wrappedFkBuf = decodeBase64UrlStrict(wrappedFk, 60);
      if (!wrappedFkBuf) {
        res.status(400).json({ error: 'INVALID_WRAPPED_FK' });
        return;
      }

      let encItemMeta: string | null = null;
      if (encItemMetaRaw !== undefined && encItemMetaRaw !== null) {
        encItemMeta = validateEncMetaString(encItemMetaRaw);
        if (!encItemMeta) {
          res.status(400).json({ error: 'INVALID_ENC_ITEM_META' });
          return;
        }
      }

      validatedItems.push({
        blobId: normalizedBlobId,
        wrappedFk: wrappedFk as string,
        encItemMeta,
      });
    }

    let encShareMeta: string | null = null;
    if (req.body?.encShareMeta !== undefined && req.body?.encShareMeta !== null) {
      encShareMeta = validateEncMetaString(req.body.encShareMeta);
      if (!encShareMeta) {
        res.status(400).json({ error: 'INVALID_ENC_SHARE_META' });
        return;
      }
    }

    // Opzionale key wrap protetto da password (blob opaco generato dal client)
    let passwordWrap: string | null = null;
    if (req.body?.passwordWrap !== undefined && req.body?.passwordWrap !== null) {
      if (
        typeof req.body.passwordWrap !== 'string' ||
        req.body.passwordWrap.length < 16 ||
        req.body.passwordWrap.length > 8192 ||
        !BASE64URL_REGEX.test(req.body.passwordWrap)
      ) {
        res.status(400).json({ error: 'INVALID_PASSWORD_WRAP' });
        return;
      }
      passwordWrap = req.body.passwordWrap;
    }

    let expiresAt: number | null = null;
    if (req.body?.expiresAt !== undefined && req.body?.expiresAt !== null) {
      const exp = Number(req.body.expiresAt);
      if (!Number.isSafeInteger(exp) || exp <= nowFn()) {
        res.status(400).json({ error: 'INVALID_EXPIRES_AT' });
        return;
      }
      expiresAt = exp;
    }

    let maxDownloads: number | null = null;
    if (req.body?.maxDownloads !== undefined && req.body?.maxDownloads !== null) {
      const maxD = Number(req.body.maxDownloads);
      if (!Number.isSafeInteger(maxD) || maxD < 1 || maxD > 100_000) {
        res.status(400).json({ error: 'INVALID_MAX_DOWNLOADS' });
        return;
      }
      maxDownloads = maxD;
    }

    let shareId: string = crypto.randomUUID();
    if (req.body?.shareId !== undefined && req.body?.shareId !== null) {
      if (!isValidUuidV4(req.body.shareId) && !SHARE_ID_V2_REGEX.test(String(req.body.shareId))) {
        res.status(400).json({ error: 'INVALID_SHARE_ID' });
        return;
      }
      shareId = String(req.body.shareId).toLowerCase();
    }
    const now = nowFn();

    const insertShare = store.db.prepare(
      `INSERT INTO shares_v2 (
         share_id, owner_id, enc_share_meta, password_wrap, expires_at, max_downloads, download_count, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
    );
    const insertShareItem = store.db.prepare(
      `INSERT INTO share_items_v2 (share_id, blob_id, wrapped_fk, enc_item_meta)
       VALUES (?, ?, ?, ?)`
    );

    store.db.exec('BEGIN IMMEDIATE');
    try {
      insertShare.run(shareId, sess.userId, encShareMeta, passwordWrap, expiresAt, maxDownloads, now);
      for (const item of validatedItems) {
        insertShareItem.run(shareId, item.blobId, item.wrappedFk, item.encItemMeta);
      }
      store.db.exec('COMMIT');
    } catch (err) {
      store.db.exec('ROLLBACK');
      throw err;
    }

    logger.info('v2_share_created', { userId: sess.userId, shareId, itemCount: validatedItems.length });
    res.status(201).json({
      shareId,
      expiresAt,
      maxDownloads,
      createdAt: now,
    });
  });

  router.delete('/shares/:shareId', (req: Request, res: Response) => {
    const sess = requireAuth(req, res);
    if (!sess) return;

    const shareId = String(req.params.shareId || '');
    if (!SHARE_ID_V2_REGEX.test(shareId)) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    const row = store.db
      .prepare(`SELECT share_id FROM shares_v2 WHERE share_id = ? AND owner_id = ?`)
      .get(shareId, sess.userId) as { share_id: string } | undefined;

    if (!row) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    store.db.prepare(`DELETE FROM shares_v2 WHERE share_id = ? AND owner_id = ?`).run(shareId, sess.userId);
    logger.info('v2_share_revoked', { userId: sess.userId, shareId });
    res.status(200).json({ revokedShareId: shareId });
  });

  function enforcePublicShareRateLimits(req: Request, res: Response, shareId: string): boolean {
    const clientIp = String(req.ip || req.socket.remoteAddress || 'unknown');
    const ipCheck = checkRateBucket(
      shareIpRateBuckets,
      clientIp,
      shareRateLimitMaxPerIp,
      shareRateLimitWindowMs
    );
    if (!ipCheck.allowed) {
      res.status(429).setHeader('Retry-After', String(ipCheck.retryAfterSec)).json({ error: 'RATE_LIMITED_IP' });
      return false;
    }
    const shareCheck = checkRateBucket(
      shareIdRateBuckets,
      shareId,
      shareRateLimitMaxPerShare,
      shareRateLimitWindowMs
    );
    if (!shareCheck.allowed) {
      res
        .status(429)
        .setHeader('Retry-After', String(shareCheck.retryAfterSec))
        .json({ error: 'RATE_LIMITED_SHARE' });
      return false;
    }
    return true;
  }

  router.get('/shares/:shareId', (req: Request, res: Response) => {
    const shareId = String(req.params.shareId || '');
    if (!SHARE_ID_V2_REGEX.test(shareId)) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    if (!enforcePublicShareRateLimits(req, res, shareId)) return;

    const shareRow = store.db
      .prepare(
        `SELECT share_id, owner_id, enc_share_meta, password_wrap, expires_at, max_downloads, download_count, created_at
         FROM shares_v2 WHERE share_id = ?`
      )
      .get(shareId) as
      | {
          share_id: string;
          owner_id: string;
          enc_share_meta: string | null;
          password_wrap: string | null;
          expires_at: number | null;
          max_downloads: number | null;
          download_count: number;
          created_at: number;
        }
      | undefined;

    if (!shareRow) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    const now = nowFn();
    if (shareRow.expires_at !== null && now >= Number(shareRow.expires_at)) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    if (
      shareRow.max_downloads !== null &&
      Number(shareRow.download_count) >= Number(shareRow.max_downloads)
    ) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    const itemRows = store.db
      .prepare(
        `SELECT si.blob_id, si.wrapped_fk, si.enc_item_meta, i.size, i.sha256_hex
         FROM share_items_v2 si
         JOIN items_v2 i ON i.blob_id = si.blob_id AND i.owner_id = ? AND i.state = 'active'
         WHERE si.share_id = ?`
      )
      .all(shareRow.owner_id, shareId) as Array<{
      blob_id: string;
      wrapped_fk: string;
      enc_item_meta: string | null;
      size: number;
      sha256_hex: string;
    }>;

    if (itemRows.length === 0) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    res.status(200).json({
      shareId: shareRow.share_id,
      encShareMeta: shareRow.enc_share_meta,
      passwordWrap: shareRow.password_wrap,
      expiresAt: shareRow.expires_at,
      createdAt: shareRow.created_at,
      items: itemRows.map((r) => ({
        blobId: r.blob_id,
        wrappedFk: r.wrapped_fk,
        encItemMeta: r.enc_item_meta,
        size: Number(r.size),
        sha256: r.sha256_hex,
      })),
    });
  });

  router.get('/shares/:shareId/blobs/:blobId', (req: Request, res: Response) => {
    const shareId = String(req.params.shareId || '');
    const blobId = String(req.params.blobId || '');
    if (!SHARE_ID_V2_REGEX.test(shareId) || !isValidUuidV4(blobId)) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    const normalizedBlobId = blobId.toLowerCase();

    if (!enforcePublicShareRateLimits(req, res, shareId)) return;

    const shareRow = store.db
      .prepare(
        `SELECT share_id, owner_id, expires_at, max_downloads, download_count
         FROM shares_v2 WHERE share_id = ?`
      )
      .get(shareId) as
      | {
          share_id: string;
          owner_id: string;
          expires_at: number | null;
          max_downloads: number | null;
          download_count: number;
        }
      | undefined;

    if (!shareRow) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    const now = nowFn();
    if (shareRow.expires_at !== null && now >= Number(shareRow.expires_at)) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    if (
      shareRow.max_downloads !== null &&
      Number(shareRow.download_count) >= Number(shareRow.max_downloads)
    ) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    const itemRow = store.db
      .prepare(
        `SELECT i.size, i.sha256_hex
         FROM share_items_v2 si
         JOIN items_v2 i ON i.blob_id = si.blob_id AND i.owner_id = ? AND i.state = 'active'
         WHERE si.share_id = ? AND si.blob_id = ?`
      )
      .get(shareRow.owner_id, shareId, normalizedBlobId) as
      | { size: number; sha256_hex: string }
      | undefined;

    if (!itemRow) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    // Incrementa contatore download solo su GET intero o range che inizia da byte 0
    if (!req.headers.range || req.headers.range.startsWith('bytes=0-')) {
      store.db
        .prepare(`UPDATE shares_v2 SET download_count = download_count + 1 WHERE share_id = ?`)
        .run(shareId);
    }

    const blobPath = store.resolveBlobPath(shareRow.owner_id, normalizedBlobId);
    streamCiphertextBlobWithRange(req, res, blobPath, Number(itemRow.size), itemRow.sha256_hex);
  });

  return {
    router,
    store,
    close: () => store.close(),
  };
}

/**
 * Crea un'applicazione Express autonoma con `/api/v2` montato (utile per test d'integrazione e server dedicato).
 */
export function createZkV2App(options: ZkV2ServerOptions & { trustProxy?: string | boolean }) {
  const app = express();
  app.disable('x-powered-by');
  const trustProxyConfig = parseTrustProxyConfig(
    typeof options.trustProxy === 'string'
      ? options.trustProxy
      : options.trustProxy === true
        ? '1'
        : process.env.TRUST_PROXY
  );
  if (trustProxyConfig !== false) {
    app.set('trust proxy', trustProxyConfig);
  }
  app.use(express.json({ limit: '2mb' }));

  const v2 = createZkV2Router(options);
  app.use('/api/v2', v2.router);

  return {
    app,
    store: v2.store,
    close: v2.close,
  };
}
