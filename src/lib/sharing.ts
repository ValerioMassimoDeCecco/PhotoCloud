/**
 * Store delle condivisioni PhotoCloud v1.4.0:
 *
 * 1. **Link pubblici temporanei** (`user_media/.shares.json`): token opaco →
 *    elenco file del proprietario + chiave API avvolta (wrap) in modo che il
 *    server possa decifrare i media per i visitatori pubblici senza salvare la
 *    chiave in chiaro su disco. Revoca = distruzione del record.
 * 2. **Album multi-utente** (`user_media/.album-shares.json`): album di un
 *    proprietario accessibile ad altri utenti registrati con ruolo
 *    "viewer" (sola lettura) o "contributor" (può anche caricare).
 */
import crypto from 'node:crypto';
import path from 'node:path';
import {
  WrappedSecret,
  hashLookupToken,
  readJsonFile,
  sanitizePlainObject,
  wrapSecret,
  writeJsonAtomic,
} from './vaultStorage';

export const SHARE_TOKEN_REGEX = /^[0-9a-f]{48}$/;

export interface PublicShareRecord {
  id: string; // sha256 del token pubblico
  owner: string;
  filenames: string[];
  label: string;
  createdAt: number;
  expiresAt: number; // epoch ms
  passwordHash: string | null;
  maxDownloads: number | null;
  downloadCount: number;
  keyWrap: WrappedSecret;
}

export interface AlbumShareRecord {
  id: string; // sha256 casuale
  owner: string;
  album: string;
  participants: Record<string, 'viewer' | 'contributor'>;
  createdAt: number;
  keyWrap: WrappedSecret;
}

interface SharesFileSchema {
  version: 1;
  shares: Record<string, PublicShareRecord>;
}

interface AlbumSharesFileSchema {
  version: 1;
  shares: Record<string, AlbumShareRecord>;
}

export function getSharesFilePath(rootDir: string): string {
  return path.join(rootDir, '.shares.json');
}

export function getAlbumSharesFilePath(rootDir: string): string {
  return path.join(rootDir, '.album-shares.json');
}

function isValidShareFilenameList(list: unknown): list is string[] {
  return Array.isArray(list) && list.length > 0 && list.length <= 500;
}

function sanitizeShareRecord(raw: unknown): PublicShareRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' && /^[0-9a-f]{64}$/.test(r.id) ? r.id : null;
  const owner = typeof r.owner === 'string' ? r.owner : null;
  if (!id || !owner || !isValidShareFilenameList(r.filenames)) return null;
  if (!r.keyWrap || typeof r.keyWrap !== 'object') return null;
  return {
    id,
    owner,
    filenames: (r.filenames as unknown[]).filter((f): f is string => typeof f === 'string').slice(0, 500),
    label: typeof r.label === 'string' ? r.label.slice(0, 120) : '',
    createdAt: Number(r.createdAt) || 0,
    expiresAt: Number(r.expiresAt) || 0,
    passwordHash: typeof r.passwordHash === 'string' ? r.passwordHash : null,
    maxDownloads: typeof r.maxDownloads === 'number' && r.maxDownloads > 0 ? Math.floor(r.maxDownloads) : null,
    downloadCount: Number(r.downloadCount) || 0,
    keyWrap: r.keyWrap as WrappedSecret,
  };
}

function sanitizeAlbumShareRecord(raw: unknown): AlbumShareRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' && /^[0-9a-f]{32,64}$/.test(r.id) ? r.id : null;
  const owner = typeof r.owner === 'string' ? r.owner : null;
  const album = typeof r.album === 'string' ? r.album : null;
  if (!id || !owner || !album || !r.keyWrap || typeof r.keyWrap !== 'object') return null;
  const participants: Record<string, 'viewer' | 'contributor'> = Object.create(null);
  if (r.participants && typeof r.participants === 'object') {
    for (const [user, role] of Object.entries(r.participants as Record<string, unknown>)) {
      if (role === 'viewer' || role === 'contributor') {
        participants[user] = role;
      }
    }
  }
  return {
    id,
    owner,
    album,
    participants,
    createdAt: Number(r.createdAt) || 0,
    keyWrap: r.keyWrap as WrappedSecret,
  };
}

export function loadPublicShares(rootDir: string): Record<string, PublicShareRecord> {
  const raw = readJsonFile<SharesFileSchema>(getSharesFilePath(rootDir), { version: 1, shares: Object.create(null) });
  const out: Record<string, PublicShareRecord> = Object.create(null);
  const clean = sanitizePlainObject(raw.shares || Object.create(null)) as Record<string, unknown>;
  for (const [id, rec] of Object.entries(clean)) {
    const safe = sanitizeShareRecord(rec);
    if (safe && safe.id === id) out[id] = safe;
  }
  return out;
}

export function savePublicShares(rootDir: string, shares: Record<string, PublicShareRecord>): void {
  writeJsonAtomic(getSharesFilePath(rootDir), { version: 1, shares });
}

export function loadAlbumShares(rootDir: string): Record<string, AlbumShareRecord> {
  const raw = readJsonFile<AlbumSharesFileSchema>(getAlbumSharesFilePath(rootDir), { version: 1, shares: Object.create(null) });
  const out: Record<string, AlbumShareRecord> = Object.create(null);
  const clean = sanitizePlainObject(raw.shares || Object.create(null)) as Record<string, unknown>;
  for (const [id, rec] of Object.entries(clean)) {
    const safe = sanitizeAlbumShareRecord(rec);
    if (safe && safe.id === id) out[id] = safe;
  }
  return out;
}

export function saveAlbumShares(rootDir: string, shares: Record<string, AlbumShareRecord>): void {
  writeJsonAtomic(getAlbumSharesFilePath(rootDir), { version: 1, shares });
}

export interface CreatePublicShareInput {
  owner: string;
  ownerApiKey: string;
  filenames: string[];
  label?: string;
  expiresInHours?: number;
  password?: string;
  maxDownloads?: number | null;
}

/**
 * Crea un link di condivisione pubblico. Restituisce il token opaco (parte
 * segreta dell'URL): sul disco restano solo hash + chiave avvolta.
 */
export function createPublicShare(rootDir: string, serverSecret: Buffer, input: CreatePublicShareInput) {
  const now = Date.now();
  const hours = Math.min(Math.max(Number(input.expiresInHours) || 72, 1), 24 * 365);
  const token = crypto.randomBytes(24).toString('hex');
  const id = hashLookupToken(token);
  const record: PublicShareRecord = {
    id,
    owner: input.owner,
    filenames: input.filenames.slice(0, 500),
    label: String(input.label || '').slice(0, 120),
    createdAt: now,
    expiresAt: now + hours * 60 * 60 * 1000,
    passwordHash: input.password
      ? crypto.createHash('sha256').update(`photocloud-share:${id}:${input.password}`).digest('hex')
      : null,
    maxDownloads: input.maxDownloads && input.maxDownloads > 0 ? Math.floor(input.maxDownloads) : null,
    downloadCount: 0,
    keyWrap: wrapSecret(serverSecret, input.ownerApiKey),
  };
  const shares = loadPublicShares(rootDir);
  shares[id] = record;
  savePublicShares(rootDir, shares);
  return { token, record };
}

export function verifySharePassword(record: PublicShareRecord, password: string): boolean {
  if (!record.passwordHash) return true;
  const candidate = crypto.createHash('sha256').update(`photocloud-share:${record.id}:${password}`).digest('hex');
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(record.passwordHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Restituisce il record se il link è utilizzabile (non scaduto e quota download
 * non superata), altrimenti null con motivo.
 */
export function resolveShareByToken(
  rootDir: string,
  token: string
): { id: string; record: PublicShareRecord } | { error: 'invalid' | 'expired' | 'exhausted' } {
  if (!SHARE_TOKEN_REGEX.test(token)) return { error: 'invalid' };
  const id = hashLookupToken(token);
  const shares = loadPublicShares(rootDir);
  const record = shares[id];
  if (!record) return { error: 'invalid' };
  if (record.expiresAt > 0 && record.expiresAt <= Date.now()) return { error: 'expired' };
  if (record.maxDownloads !== null && record.downloadCount >= record.maxDownloads) return { error: 'exhausted' };
  return { id, record };
}

export function incrementShareDownloadCount(rootDir: string, id: string): void {
  const shares = loadPublicShares(rootDir);
  const rec = shares[id];
  if (!rec) return;
  rec.downloadCount += 1;
  savePublicShares(rootDir, shares);
}

/**
 * Crea (o aggiorna) una condivisione di album multi-utente.
 */
export function upsertAlbumShare(
  rootDir: string,
  serverSecret: Buffer,
  owner: string,
  album: string,
  ownerApiKey: string,
  username: string,
  role: 'viewer' | 'contributor'
): AlbumShareRecord {
  const shares = loadAlbumShares(rootDir);
  let existing = Object.values(shares).find((s) => s.owner === owner && s.album === album);
  if (!existing) {
    existing = {
      id: crypto.randomBytes(16).toString('hex'),
      owner,
      album,
      participants: Object.create(null),
      createdAt: Date.now(),
      keyWrap: wrapSecret(serverSecret, ownerApiKey),
    };
  }
  existing.participants[username] = role;
  shares[existing.id] = existing;
  saveAlbumShares(rootDir, shares);
  return existing;
}

/** Rimuove tutte le condivisioni associate ad un album (es. alla sua eliminazione). */
export function deleteAlbumSharesForAlbum(rootDir: string, owner: string, album: string): number {
  const shares = loadAlbumShares(rootDir);
  let removed = 0;
  for (const [id, rec] of Object.entries(shares)) {
    if (rec.owner === owner && rec.album === album) {
      delete shares[id];
      removed++;
    }
  }
  if (removed > 0) saveAlbumShares(rootDir, shares);
  return removed;
}
