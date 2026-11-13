import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { hashKey, decryptFileAsync } from './crypto';
import { parseExifFromJpeg, ExifMetadata } from './exif';
import { getOrCreateServerSecret, readJsonFile, writeJsonAtomic } from './vaultStorage';
import { sendPushToUser } from './pushService';
import { FileCategory, MediaItem } from '../types';

export const APP_ROOT = process.cwd();
export const UPLOAD_FOLDER = path.resolve(APP_ROOT, 'user_media');
export const TEMP_UPLOAD_DIR = path.resolve(APP_ROOT, 'temp_uploads');
export const RELEASE_DIR = path.resolve(process.cwd(), 'release');
export const RELEASE_BUILDS_DIR = path.resolve(process.cwd(), 'release_builds');
export const USERS_FILE = path.resolve(process.cwd(), 'users.txt');
export const STATIC_DIR = path.resolve(process.cwd(), 'static');

fs.mkdirSync(UPLOAD_FOLDER, { recursive: true });
fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });
fs.mkdirSync(RELEASE_DIR, { recursive: true });
fs.mkdirSync(RELEASE_BUILDS_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, '', 'utf-8');
}

export interface SessionData {
  username: string;
  apiKey: string;
  expiresAt: number;
}

export interface UserAlbumsData {
  albums: string[];
  fileAlbums: Record<string, string>;
}

export interface ZipTaskInfo {
  owner: string;
  zipPath?: string;
  buffer?: Buffer;
  status: 'starting' | 'processing' | 'complete' | 'error';
  progress: number;
  filename: string | null;
  totalBytes?: number;
  processedBytes?: number;
  error?: string;
}

export const SESSIONS = new Map<string, SessionData>();
export const LOGIN_ATTEMPTS = new Map<string, { count: number; resetAt: number }>();
export const REGISTER_ATTEMPTS = new Map<string, { count: number; resetAt: number }>();
export const SHARE_UNLOCK_ATTEMPTS = new Map<string, { count: number; resetAt: number }>();
export const ZIP_TASKS = new Map<string, ZipTaskInfo>();

export const DUMMY_KEY_HASH = hashKey('PhotoCloud_Constant_Time_Dummy_Key_2026!@#');
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isValidVaultFilename(name: unknown): name is string {
  if (typeof name !== 'string') return false;
  if (name.length < 1 || name.length > 255) return false;
  if (FORBIDDEN_OBJECT_KEYS.has(name)) return false;
  if (name.startsWith('.')) return false;
  if (name !== path.basename(name)) return false;
  if (/[\/\\:\x00-\x1f\x7f]/.test(name)) return false;
  return true;
}

export function isValidAlbumName(name: unknown): name is string {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 128) return false;
  if (FORBIDDEN_OBJECT_KEYS.has(trimmed)) return false;
  if (/[\x00-\x1f\x7f]/.test(trimmed)) return false;
  return true;
}

// Periodic cleanup of expired sessions and rate-limit records
const sessionCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [sid, sess] of SESSIONS.entries()) {
    if (sess.expiresAt <= now) {
      SESSIONS.delete(sid);
    }
  }
  for (const [key, entry] of LOGIN_ATTEMPTS.entries()) {
    if (entry.resetAt <= now) {
      LOGIN_ATTEMPTS.delete(key);
    }
  }
  for (const [key, entry] of REGISTER_ATTEMPTS.entries()) {
    if (entry.resetAt <= now) {
      REGISTER_ATTEMPTS.delete(key);
    }
  }
}, 5 * 60 * 1000);
sessionCleanupTimer.unref();

export function parseCookies(cookieHeader?: string): Record<string, string> {
  const list: Record<string, string> = Object.create(null);
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    const key = parts.shift()?.trim();
    if (key && !FORBIDDEN_OBJECT_KEYS.has(key)) {
      try {
        list[key] = decodeURIComponent(parts.join('='));
      } catch {
        list[key] = parts.join('=');
      }
    }
  });
  return list;
}

export interface AuthContext {
  session: SessionData;
  userFolder: string;
  trashFolder: string;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const sess = getSession(req);
  if (!sess) {
    res.status(403).json({ error: 'Accesso negato' });
    return;
  }
  const userFolder = path.join(UPLOAD_FOLDER, sess.username);
  req.auth = {
    session: sess,
    userFolder,
    trashFolder: path.join(userFolder, 'trash'),
  };
  next();
}

export function getSession(req: Request): SessionData | null {
  const cookies = parseCookies(req.headers.cookie);
  const rawHeaderSid = typeof req.headers['x-session-id'] === 'string' ? req.headers['x-session-id'].trim() : '';
  const sid = cookies['photocloud_sid'] || rawHeaderSid;
  if (!sid || !UUID_REGEX.test(sid)) return null;
  const session = SESSIONS.get(sid);
  if (session && session.expiresAt <= Date.now()) {
    SESSIONS.delete(sid);
    return null;
  }
  return session ?? null;
}

export function findUser(username: string): string | null {
  if (!fs.existsSync(USERS_FILE)) return null;
  const lines = fs.readFileSync(USERS_FILE, 'utf-8').split('\n');
  for (const line of lines) {
    if (line.startsWith(username + ':')) {
      return line.split(':')[1]?.trim() ?? null;
    }
  }
  return null;
}

export function saveUser(username: string, keyHash: string): void {
  const current = fs.existsSync(USERS_FILE) ? fs.readFileSync(USERS_FILE, 'utf-8') : '';
  const prefix = current.length > 0 && !current.endsWith('\n') ? `${current}\n` : current;
  const nextContent = `${prefix}${username}:${keyHash}\n`;
  const tmpFile = `${USERS_FILE}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmpFile, nextContent, 'utf-8');
  fs.renameSync(tmpFile, USERS_FILE);
}

const MEDIA_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.heic', '.avif', '.mp4', '.mov', '.webm', '.mkv']);
const DOC_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp', '.rtf', '.txt', '.md', '.csv', '.tsv']);
const ARCHIVE_EXTENSIONS = new Set(['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.apk', '.iso', '.dmg', '.exe']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.opus']);
const CODE_EXTENSIONS = new Set(['.json', '.xml', '.yaml', '.yml', '.js', '.ts', '.tsx', '.jsx', '.py', '.kt', '.java', '.c', '.cpp', '.h', '.html', '.htm', '.css', '.sql', '.sh', '.ini', '.conf', '.log']);

export function classifyFileExtension(filename: string): { isMedia: boolean; category: FileCategory } {
  const ext = path.extname(filename).toLowerCase();
  if (MEDIA_EXTENSIONS.has(ext)) return { isMedia: true, category: 'media' };
  if (DOC_EXTENSIONS.has(ext)) return { isMedia: false, category: 'document' };
  if (ARCHIVE_EXTENSIONS.has(ext)) return { isMedia: false, category: 'archive' };
  if (AUDIO_EXTENSIONS.has(ext)) return { isMedia: false, category: 'audio' };
  if (CODE_EXTENSIONS.has(ext)) return { isMedia: false, category: 'code' };
  return { isMedia: false, category: 'other' };
}

function getAlbumsFilePath(username: string): string {
  return path.join(UPLOAD_FOLDER, username, '.albums.json');
}

export function loadUserAlbums(username: string): UserAlbumsData {
  const p = getAlbumsFilePath(username);
  const emptyFileAlbums: Record<string, string> = Object.create(null);
  if (!fs.existsSync(p)) {
    return { albums: [], fileAlbums: emptyFileAlbums };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as Partial<UserAlbumsData>;
    const safeAlbums = Array.isArray(raw.albums)
      ? raw.albums.filter((a): a is string => isValidAlbumName(a)).map((a) => a.trim())
      : [];
    const safeFileAlbums: Record<string, string> = Object.create(null);
    if (raw.fileAlbums && typeof raw.fileAlbums === 'object') {
      for (const [k, v] of Object.entries(raw.fileAlbums)) {
        if (isValidVaultFilename(k) && isValidAlbumName(v)) {
          safeFileAlbums[k] = v.trim();
        }
      }
    }
    return {
      albums: safeAlbums,
      fileAlbums: safeFileAlbums,
    };
  } catch {
    return { albums: [], fileAlbums: emptyFileAlbums };
  }
}

export function saveUserAlbums(username: string, data: UserAlbumsData): void {
  const userFolder = path.join(UPLOAD_FOLDER, username);
  fs.mkdirSync(userFolder, { recursive: true });
  const targetPath = getAlbumsFilePath(username);
  const tmpPath = `${targetPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, targetPath);
}

// ---------------------------------------------------------------------------
// v1.4.0 — Preferiti persistenti per utente (`user_media/<user>/.favorites.json`)
// ---------------------------------------------------------------------------
interface UserFavoritesFile {
  version: 1;
  favorites: string[];
}

function getFavoritesFilePath(username: string): string {
  return path.join(UPLOAD_FOLDER, username, '.favorites.json');
}

export function loadUserFavorites(username: string): Set<string> {
  const data = readJsonFile<UserFavoritesFile>(getFavoritesFilePath(username), {
    version: 1,
    favorites: [],
  });
  const set = new Set<string>();
  if (Array.isArray(data.favorites)) {
    for (const f of data.favorites) {
      if (typeof f === 'string' && isValidVaultFilename(f)) set.add(f);
    }
  }
  return set;
}

export function saveUserFavorites(username: string, favorites: ReadonlySet<string>): void {
  const userFolder = path.join(UPLOAD_FOLDER, username);
  fs.mkdirSync(userFolder, { recursive: true });
  writeJsonAtomic(getFavoritesFilePath(username), {
    version: 1,
    favorites: [...favorites].sort((a, b) => a.localeCompare(b, 'it')).slice(0, 20000),
  });
}

// ---------------------------------------------------------------------------
// v1.4.0 — Cache pHash per utente (`user_media/<user>/.phash.json`)
// ---------------------------------------------------------------------------
export interface PHashCacheFile {
  version: 1;
  entries: Record<string, { phash: string; mtimeMs: number }>;
}

function getPHashCachePath(username: string): string {
  return path.join(UPLOAD_FOLDER, username, '.phash.json');
}

export function loadPHashCache(username: string): PHashCacheFile {
  const data = readJsonFile<PHashCacheFile>(getPHashCachePath(username), {
    version: 1,
    entries: Object.create(null),
  });
  if (!data.entries || typeof data.entries !== 'object') {
    data.entries = Object.create(null);
  }
  return data;
}

export function savePHashCache(username: string, cache: PHashCacheFile): void {
  writeJsonAtomic(getPHashCachePath(username), cache);
}

// ---------------------------------------------------------------------------
// v1.4.1 — Cache metadati EXIF per utente (`user_media/<user>/.exif.json`)
// ---------------------------------------------------------------------------
export interface ExifCacheFile {
  version: 1;
  entries: Record<string, { exif: ExifMetadata; mtimeMs: number }>;
}

function getExifCachePath(username: string): string {
  return path.join(UPLOAD_FOLDER, username, '.exif.json');
}

export function loadExifCache(username: string): ExifCacheFile {
  const data = readJsonFile<ExifCacheFile>(getExifCachePath(username), {
    version: 1,
    entries: Object.create(null),
  });
  if (!data.entries || typeof data.entries !== 'object') {
    data.entries = Object.create(null);
  }
  return data;
}

export function saveExifCache(username: string, cache: ExifCacheFile): void {
  writeJsonAtomic(getExifCachePath(username), cache);
}

/**
 * Legge (con cache mtime-keyed) i metadati EXIF di un file JPEG del vault,
 * decifrando il file in memoria solo quando serve. Mai lancia eccezioni.
 */
export async function getExifForVaultFile(
  username: string,
  filename: string,
  apiKey: string
): Promise<ExifMetadata | null> {
  try {
    const userFolder = path.join(UPLOAD_FOLDER, username);
    const fullPath = path.join(userFolder, filename);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      return null;
    }
    const cache = loadExifCache(username);
    const cached = cache.entries[filename];
    if (cached && cached.exif && Math.abs(cached.mtimeMs - stat.mtimeMs) < 1) {
      return cached.exif;
    }
    const encrypted = await fs.promises.readFile(fullPath);
    const decrypted = await decryptFileAsync(encrypted, apiKey);
    const exif = parseExifFromJpeg(decrypted);
    cache.entries[filename] = { exif, mtimeMs: stat.mtimeMs };
    saveExifCache(username, cache);
    return exif;
  } catch {
    return null;
  }
}

export function isShareUnlockRateLimited(clientIp: string): boolean {
  const now = Date.now();
  const entry = SHARE_UNLOCK_ATTEMPTS.get(clientIp);
  if (entry && entry.resetAt > now && entry.count >= 10) return true;
  SHARE_UNLOCK_ATTEMPTS.set(clientIp, {
    count: entry && entry.resetAt > now ? entry.count + 1 : 1,
    resetAt: entry && entry.resetAt > now ? entry.resetAt : now + 10 * 60 * 1000,
  });
  return false;
}

let cachedServerSecret: Buffer | null = null;
export function getServerSecret(): Buffer {
  if (!cachedServerSecret) {
    cachedServerSecret = getOrCreateServerSecret(UPLOAD_FOLDER);
  }
  return cachedServerSecret;
}

/**
 * Genera (o valida) il cookie di sblocco per condivisioni protette da password:
 * HMAC del token con il segreto server, a prova di manomissione e revocabile
 * eliminando la condivisione.
 */
export function shareUnlockCookieValue(token: string): string {
  return crypto
    .createHmac('sha256', getServerSecret())
    .update(`photocloud-share-unlock:${token}`)
    .digest('hex');
}

/**
 * Restituisce i filename di un utente che appartengono ad un album condiviso
 * (`source` = record di condivisione album multi-utente).
 */
export function listAlbumSharedFiles(sourceOwner: string, albumName: string): MediaItem[] {
  const userFolder = path.join(UPLOAD_FOLDER, sourceOwner);
  const albumsData = loadUserAlbums(sourceOwner);
  return listMediaFiles(userFolder, sourceOwner).filter(
    (m) => albumsData.fileAlbums[m.filename] === albumName
  );
}

export function getEncryptedFilePlaintextSize(fullPath: string, stat?: fs.Stats): number {
  try {
    const s = stat ?? fs.statSync(fullPath);
    const fd = fs.openSync(fullPath, 'r');
    const header = Buffer.alloc(Math.min(s.size, 18));
    try {
      fs.readSync(fd, header, 0, header.length, 0);
    } finally {
      fs.closeSync(fd);
    }
    const overhead = header.equals(Buffer.from('PhotoCloud-GCM-v1\0')) ? 62 : 32;
    return Math.max(0, s.size - overhead);
  } catch {
    return 0;
  }
}

export function listMediaFiles(folderPath: string, username?: string): MediaItem[] {
  if (!fs.existsSync(folderPath)) return [];
  const files = fs.readdirSync(folderPath);
  const albumsData = username ? loadUserAlbums(username) : { albums: [], fileAlbums: Object.create(null) };
  const details: MediaItem[] = [];
  for (const f of files) {
    if (f.startsWith('.') || !isValidVaultFilename(f)) continue; // skip .albums.json and hidden files
    const full = path.join(folderPath, f);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.isFile()) {
      const { isMedia, category } = classifyFileExtension(f);
      const originalApproxSize = getEncryptedFilePlaintextSize(full, stat);
      details.push({
        filename: f,
        timestamp: stat.mtimeMs / 1000,
        size: originalApproxSize,
        isMedia,
        category,
        album: albumsData.fileAlbums[f] || '',
      });
    }
  }
  details.sort((a, b) => b.timestamp - a.timestamp);
  return details;
}

/** Notifica broadcast all'utente (fire-and-forget, mai bloccante). */
export function notifyUserAsync(username: string, title: string, body: string, tag?: string): void {
  const userFolder = path.join(UPLOAD_FOLDER, username);
  void sendPushToUser(userFolder, { title, body, tag });
}

export const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });
      cb(null, TEMP_UPLOAD_DIR);
    },
    filename: (_req, _file, cb) => {
      cb(null, `upload_${Date.now()}_${crypto.randomBytes(8).toString('hex')}.tmp`);
    },
  }),
  limits: {
    fileSize: 250 * 1024 * 1024, // 250 MB max per file
    files: 500, // Support large multi-file batches without LIMIT_FILE_COUNT crash
    fieldSize: 25 * 1024 * 1024,
  },
});

export function readUploadedFileBuffer(file: Express.Multer.File): Buffer {
  if (file.buffer && file.buffer.length > 0) {
    return file.buffer;
  }
  if (file.path && fs.existsSync(file.path)) {
    return fs.readFileSync(file.path);
  }
  return Buffer.alloc(0);
}

export function cleanupUploadedFiles(req: Request): void {
  const single = req.file;
  if (single?.path) {
    try {
      if (fs.existsSync(single.path)) fs.unlinkSync(single.path);
    } catch {
      // ignore cleanup error
    }
  }
  const multi = req.files;
  if (Array.isArray(multi)) {
    for (const f of multi) {
      if (f?.path) {
        try {
          if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
        } catch {
          // ignore cleanup error
        }
      }
    }
  }
}
