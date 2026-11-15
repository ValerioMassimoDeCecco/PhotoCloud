import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { decryptFileAsync, encryptFileAsync } from './crypto';
import { readJsonFile, sanitizePlainObject, writeJsonAtomic } from './vaultStorage';

export type ThumbVariant = 'thumb' | 'large';

export const THUMB_SPECS: Record<ThumbVariant, { maxDim: number; quality: number }> = {
  thumb: { maxDim: 320, quality: 80 },
  large: { maxDim: 1280, quality: 80 },
};

export const DEFAULT_THUMB_CACHE_MAX_MB = 512;
export const DEFAULT_NEGATIVE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const MAX_CLIENT_THUMB_UPLOAD_BYTES = 1024 * 1024; // 1 MB strict cap for client-uploaded JPEG frames
export const THUMB_CLIENT_CACHE_MAX_AGE_SEC = 7 * 24 * 60 * 60;

export const RASTER_THUMB_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp']);

export interface ThumbMetaEntry {
  filename: string;
  variant: ThumbVariant;
  sourceMtimeMs: number;
  relPath: string;
  plaintextBytes: number;
  diskBytes: number;
  etag: string;
  lastAccessMs: number;
  createdAtMs: number;
  source: 'server' | 'client';
}

export interface NegativeThumbEntry {
  filename: string;
  sourceMtimeMs: number;
  expiresAtMs: number;
  reason: string;
}

export interface ThumbMetaStore {
  v: 1;
  entries: Record<string, ThumbMetaEntry>;
  negatives: Record<string, NegativeThumbEntry>;
}

export interface ThumbStatsSnapshot {
  thumbCount: number;
  largeCount: number;
  totalEntries: number;
  diskBytes: number;
  maxBytes: number;
  hits: number;
  misses: number;
  negativeEntries: number;
  queuePending: number;
  activeWorkers: number;
}

export type ThumbLookupResult =
  | {
      status: 'ok';
      buffer: Buffer;
      etag: string;
      lastModifiedMs: number;
      hit: boolean;
      variant: ThumbVariant;
    }
  | {
      status: 'fallback';
      reason: string;
    }
  | {
      status: 'busy';
      reason: string;
    };

export interface ThumbCacheOptions {
  maxBytes?: number;
  negativeTtlMs?: number;
  maxConcurrentWorkers?: number;
  maxQueueLength?: number;
}

export function resolveThumbCacheMaxBytes(overrideMaxBytes?: number): number {
  if (typeof overrideMaxBytes === 'number' && Number.isFinite(overrideMaxBytes) && overrideMaxBytes > 0) {
    return Math.floor(overrideMaxBytes);
  }
  const envMb = Number(process.env.THUMB_CACHE_MAX_MB || DEFAULT_THUMB_CACHE_MAX_MB);
  const clampedMb = Number.isFinite(envMb) && envMb >= 1 ? Math.min(envMb, 1024 * 1024) : DEFAULT_THUMB_CACHE_MAX_MB;
  return Math.floor(clampedMb * 1024 * 1024);
}

export function parsePreviewVariant(rawQuery: unknown, isExplicitDownload = false): ThumbVariant | null {
  if (isExplicitDownload) return null;
  const normalized = String(rawQuery || '').trim().toLowerCase();
  if (normalized === 'thumb' || normalized === '1' || normalized === 'true') return 'thumb';
  if (normalized === 'large') return 'large';
  return null;
}

export function isJpegMagicBytes(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

function getThumbDir(userFolder: string): string {
  return path.join(userFolder, '.thumbs');
}

function getMetaPath(userFolder: string): string {
  return path.join(getThumbDir(userFolder), '.meta.json');
}

function entryKey(variant: ThumbVariant, filename: string): string {
  return `${variant}:${filename}`;
}

function hashedThumbFilename(filename: string, variant: ThumbVariant): string {
  const hash = crypto.createHash('sha256').update(filename, 'utf-8').digest('hex').slice(0, 32);
  return `${variant}/${hash}.${variant}.jpg.enc`;
}

function computeThumbEtag(variant: ThumbVariant, jpegBuffer: Buffer): string {
  const digest = crypto.createHash('sha256').update(jpegBuffer).digest('hex').slice(0, 24);
  return `"pc-${variant}-${digest}"`;
}

function emptyStore(): ThumbMetaStore {
  return {
    v: 1,
    entries: Object.create(null) as Record<string, ThumbMetaEntry>,
    negatives: Object.create(null) as Record<string, NegativeThumbEntry>,
  };
}

function loadStore(userFolder: string): ThumbMetaStore {
  const raw = readJsonFile<Partial<ThumbMetaStore>>(getMetaPath(userFolder), {});
  const store = emptyStore();
  if (raw && typeof raw.entries === 'object' && raw.entries !== null) {
    store.entries = sanitizePlainObject(raw.entries as Record<string, ThumbMetaEntry>);
  }
  if (raw && typeof raw.negatives === 'object' && raw.negatives !== null) {
    store.negatives = sanitizePlainObject(raw.negatives as Record<string, NegativeThumbEntry>);
  }
  return store;
}

function saveStore(userFolder: string, store: ThumbMetaStore): void {
  writeJsonAtomic(getMetaPath(userFolder), {
    v: 1,
    entries: sanitizePlainObject(store.entries),
    negatives: sanitizePlainObject(store.negatives),
  });
}

function isRasterImageFilename(filename: string): boolean {
  const ext = path.extname(filename).replace(/^\./, '').toLowerCase();
  return RASTER_THUMB_EXTENSIONS.has(ext);
}

async function encodeJpegThumbnailWithJimp(
  rawImageBuffer: Buffer,
  variant: ThumbVariant
): Promise<Buffer> {
  const { Jimp } = await import('jimp');
  const image = await Jimp.fromBuffer(rawImageBuffer);
  const spec = THUMB_SPECS[variant];
  const srcW = Math.max(1, image.bitmap.width || 1);
  const srcH = Math.max(1, image.bitmap.height || 1);
  const maxEdge = Math.max(srcW, srcH);
  if (maxEdge > spec.maxDim) {
    const scale = spec.maxDim / maxEdge;
    const targetW = Math.max(1, Math.round(srcW * scale));
    const targetH = Math.max(1, Math.round(srcH * scale));
    image.resize({ w: targetW, h: targetH });
  }
  return Buffer.from(await image.getBuffer('image/jpeg', { quality: spec.quality }));
}

export class ThumbCacheManager {
  private readonly overrideMaxBytes?: number;
  private readonly negativeTtlMs: number;
  private readonly maxConcurrentWorkers: number;
  private readonly maxQueueLength: number;

  private activeWorkers = 0;
  private readonly pendingQueue: Array<() => void> = [];
  private readonly inflightJobs = new Map<string, Promise<ThumbLookupResult>>();
  private readonly backgroundQueuedKeys = new Set<string>();
  private readonly userStats = new Map<string, { hits: number; misses: number }>();

  constructor(options: ThumbCacheOptions = {}) {
    this.overrideMaxBytes = options.maxBytes;
    this.negativeTtlMs = options.negativeTtlMs ?? DEFAULT_NEGATIVE_CACHE_TTL_MS;
    this.maxConcurrentWorkers = Math.max(1, options.maxConcurrentWorkers ?? 2);
    this.maxQueueLength = Math.max(4, options.maxQueueLength ?? 96);
  }

  private getMaxBytes(): number {
    return resolveThumbCacheMaxBytes(this.overrideMaxBytes);
  }

  private recordHit(userFolder: string): void {
    const st = this.userStats.get(userFolder) ?? { hits: 0, misses: 0 };
    st.hits++;
    this.userStats.set(userFolder, st);
  }

  private recordMiss(userFolder: string): void {
    const st = this.userStats.get(userFolder) ?? { hits: 0, misses: 0 };
    st.misses++;
    this.userStats.set(userFolder, st);
  }

  private runBoundedWorker<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const execute = () => {
        this.activeWorkers++;
        task()
          .then(resolve, reject)
          .finally(() => {
            this.activeWorkers--;
            const next = this.pendingQueue.shift();
            if (next) next();
          });
      };

      if (this.activeWorkers < this.maxConcurrentWorkers) {
        execute();
      } else if (this.pendingQueue.length >= this.maxQueueLength) {
        reject(new Error('THUMB_QUEUE_FULL'));
      } else {
        this.pendingQueue.push(execute);
      }
    });
  }

  private enforceLruEvictionSync(userFolder: string, store: ThumbMetaStore, protectedKey?: string): boolean {
    const maxBytes = this.getMaxBytes();
    const entriesList = Object.entries(store.entries);
    let totalBytes = 0;
    for (const [, e] of entriesList) {
      totalBytes += Math.max(0, Number(e.diskBytes) || 0);
    }
    if (totalBytes <= maxBytes) return false;

    const thumbRoot = path.resolve(getThumbDir(userFolder));
    entriesList.sort((a, b) => (a[1].lastAccessMs || 0) - (b[1].lastAccessMs || 0));

    let mutated = false;
    for (const [k, entry] of entriesList) {
      if (totalBytes <= maxBytes) break;
      if (k === protectedKey) continue;
      const diskPath = path.resolve(thumbRoot, entry.relPath);
      if (diskPath.startsWith(thumbRoot + path.sep) && fs.existsSync(diskPath)) {
        try {
          fs.unlinkSync(diskPath);
        } catch {
          // ignore
        }
      }
      totalBytes -= Math.max(0, Number(entry.diskBytes) || 0);
      delete store.entries[k];
      mutated = true;
    }
    return mutated;
  }

  private storeEncryptedVariantSync(
    userFolder: string,
    filename: string,
    variant: ThumbVariant,
    sourceMtimeMs: number,
    jpegBuffer: Buffer,
    encryptedThumbBuffer: Buffer,
    source: 'server' | 'client'
  ): ThumbMetaEntry {
    const thumbRoot = path.resolve(getThumbDir(userFolder));
    const relPath = hashedThumbFilename(filename, variant);
    const destPath = path.resolve(thumbRoot, relPath);
    if (!destPath.startsWith(thumbRoot + path.sep)) {
      throw new Error('Invalid thumbnail storage path');
    }

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const tmpPath = `${destPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmpPath, encryptedThumbBuffer);
    fs.renameSync(tmpPath, destPath);

    const now = Date.now();
    const k = entryKey(variant, filename);
    const metaEntry: ThumbMetaEntry = {
      filename,
      variant,
      sourceMtimeMs,
      relPath,
      plaintextBytes: jpegBuffer.length,
      diskBytes: encryptedThumbBuffer.length,
      etag: computeThumbEtag(variant, jpegBuffer),
      lastAccessMs: now,
      createdAtMs: now,
      source,
    };

    const store = loadStore(userFolder);
    store.entries[k] = metaEntry;
    delete store.negatives[filename];
    this.enforceLruEvictionSync(userFolder, store, k);
    saveStore(userFolder, store);
    return metaEntry;
  }

  private recordNegativeSync(
    userFolder: string,
    filename: string,
    sourceMtimeMs: number,
    reason: string
  ): void {
    const store = loadStore(userFolder);
    store.negatives[filename] = {
      filename,
      sourceMtimeMs,
      expiresAtMs: Date.now() + this.negativeTtlMs,
      reason,
    };
    saveStore(userFolder, store);
  }

  hasCachedThumbnail(userFolder: string, filename: string, variant: ThumbVariant = 'thumb'): boolean {
    const store = loadStore(userFolder);
    const entry = store.entries[entryKey(variant, filename)];
    if (!entry) return false;
    const thumbRoot = path.resolve(getThumbDir(userFolder));
    const diskPath = path.resolve(thumbRoot, entry.relPath);
    return diskPath.startsWith(thumbRoot + path.sep) && fs.existsSync(diskPath);
  }

  listFilesWithThumb(userFolder: string, variant: ThumbVariant = 'thumb'): Set<string> {
    const store = loadStore(userFolder);
    const result = new Set<string>();
    const thumbRoot = path.resolve(getThumbDir(userFolder));
    const prefix = `${variant}:`;
    for (const [k, entry] of Object.entries(store.entries)) {
      if (!k.startsWith(prefix)) continue;
      const diskPath = path.resolve(thumbRoot, entry.relPath);
      if (diskPath.startsWith(thumbRoot + path.sep) && fs.existsSync(diskPath)) {
        result.add(entry.filename);
      }
    }
    return result;
  }

  async getOrCreateThumbnail(
    userFolder: string,
    filename: string,
    variant: ThumbVariant,
    apiKey: string
  ): Promise<ThumbLookupResult> {
    const safeUserFolder = path.resolve(userFolder);
    const sourcePath = path.resolve(safeUserFolder, filename);
    if (!sourcePath.startsWith(safeUserFolder + path.sep) || !fs.existsSync(sourcePath)) {
      return { status: 'fallback', reason: 'source_missing' };
    }

    let sourceStat: fs.Stats;
    try {
      sourceStat = await fs.promises.stat(sourcePath);
    } catch {
      return { status: 'fallback', reason: 'source_stat_failed' };
    }

    const k = entryKey(variant, filename);
    const store = loadStore(safeUserFolder);
    const existing = store.entries[k];
    if (existing && (existing.sourceMtimeMs === sourceStat.mtimeMs || existing.source === 'client')) {
      const thumbRoot = path.resolve(getThumbDir(safeUserFolder));
      const diskPath = path.resolve(thumbRoot, existing.relPath);
      if (diskPath.startsWith(thumbRoot + path.sep) && fs.existsSync(diskPath)) {
        try {
          const encrypted = await fs.promises.readFile(diskPath);
          const decrypted = await decryptFileAsync(encrypted, apiKey);
          const now = Date.now();
          if (now - (existing.lastAccessMs || 0) >= 30_000) {
            const latestStore = loadStore(safeUserFolder);
            if (latestStore.entries[k]) {
              latestStore.entries[k].lastAccessMs = now;
              saveStore(safeUserFolder, latestStore);
            }
          }
          this.recordHit(safeUserFolder);
          return {
            status: 'ok',
            buffer: decrypted,
            etag: existing.etag,
            lastModifiedMs: existing.createdAtMs,
            hit: true,
            variant,
          };
        } catch {
          // Corrupted or stale key: fall through to regenerate
        }
      }
    }

    // Check negative cache before decoding with Jimp
    const negative = store.negatives[filename];
    if (
      negative &&
      negative.sourceMtimeMs === sourceStat.mtimeMs &&
      negative.expiresAtMs > Date.now()
    ) {
      return { status: 'fallback', reason: negative.reason };
    }

    if (!isRasterImageFilename(filename)) {
      return { status: 'fallback', reason: 'non_raster_media' };
    }

    this.recordMiss(safeUserFolder);

    const jobKey = `${safeUserFolder}:${variant}:${filename}:${sourceStat.mtimeMs}`;
    let inflight = this.inflightJobs.get(jobKey);
    if (!inflight) {
      inflight = this.runBoundedWorker(async (): Promise<ThumbLookupResult> => {
        try {
          const encryptedSrc = await fs.promises.readFile(sourcePath);
          const decryptedSrc = await decryptFileAsync(encryptedSrc, apiKey);
          const jpegBuffer = await encodeJpegThumbnailWithJimp(decryptedSrc, variant);
          const encryptedThumb = await encryptFileAsync(jpegBuffer, apiKey);
          const metaEntry = this.storeEncryptedVariantSync(
            safeUserFolder,
            filename,
            variant,
            sourceStat.mtimeMs,
            jpegBuffer,
            encryptedThumb,
            'server'
          );
          return {
            status: 'ok',
            buffer: jpegBuffer,
            etag: metaEntry.etag,
            lastModifiedMs: metaEntry.createdAtMs,
            hit: false,
            variant,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.recordNegativeSync(safeUserFolder, filename, sourceStat.mtimeMs, msg.slice(0, 120));
          return { status: 'fallback', reason: 'decode_failed' };
        }
      });
      this.inflightJobs.set(jobKey, inflight);
    }

    try {
      return await inflight;
    } catch (err) {
      if (err instanceof Error && err.message === 'THUMB_QUEUE_FULL') {
        return { status: 'busy', reason: 'queue_full' };
      }
      return { status: 'fallback', reason: 'generation_error' };
    } finally {
      this.inflightJobs.delete(jobKey);
    }
  }

  /**
   * Stores a client-generated JPEG thumbnail (typically Android MediaMetadataRetriever
   * frame for videos). Strictly validates JPEG magic bytes, byte budget, and Jimp decodability.
   */
  async putClientThumbnail(
    userFolder: string,
    filename: string,
    rawJpegBuffer: Buffer,
    apiKey: string,
    requestedVariant: ThumbVariant = 'thumb'
  ): Promise<{ savedVariants: ThumbVariant[]; etag: string }> {
    if (!Buffer.isBuffer(rawJpegBuffer) || rawJpegBuffer.length === 0) {
      throw new Error('EMPTY_THUMBNAIL');
    }
    if (rawJpegBuffer.length > MAX_CLIENT_THUMB_UPLOAD_BYTES) {
      throw new Error('THUMBNAIL_TOO_LARGE');
    }
    if (!isJpegMagicBytes(rawJpegBuffer)) {
      throw new Error('INVALID_JPEG_MAGIC');
    }

    const safeUserFolder = path.resolve(userFolder);
    const sourcePath = path.resolve(safeUserFolder, filename);
    if (!sourcePath.startsWith(safeUserFolder + path.sep) || !fs.existsSync(sourcePath)) {
      throw new Error('SOURCE_NOT_FOUND');
    }

    const sourceStat = await fs.promises.stat(sourcePath);

    // Decode & normalize with Jimp to ensure valid JPEG structure (no polyglot payload)
    const { Jimp } = await import('jimp');
    let decoded;
    try {
      decoded = await Jimp.fromBuffer(rawJpegBuffer);
    } catch {
      throw new Error('INVALID_JPEG_IMAGE');
    }

    const srcMaxEdge = Math.max(decoded.bitmap.width || 0, decoded.bitmap.height || 0);
    if (srcMaxEdge < 1) {
      throw new Error('INVALID_JPEG_IMAGE');
    }

    const savedVariants: ThumbVariant[] = [];
    let primaryEtag = '';

    const normalizedPrimary = await encodeJpegThumbnailWithJimp(rawJpegBuffer, requestedVariant);
    const encPrimary = await encryptFileAsync(normalizedPrimary, apiKey);
    const primaryMeta = this.storeEncryptedVariantSync(
      safeUserFolder,
      filename,
      requestedVariant,
      sourceStat.mtimeMs,
      normalizedPrimary,
      encPrimary,
      'client'
    );
    savedVariants.push(requestedVariant);
    primaryEtag = primaryMeta.etag;

    // If caller sent 'large' (or > 360px frame), automatically derive 'thumb' as well
    if (requestedVariant === 'large' || srcMaxEdge > THUMB_SPECS.thumb.maxDim) {
      const otherVariant: ThumbVariant = requestedVariant === 'large' ? 'thumb' : 'large';
      if (otherVariant === 'thumb' || srcMaxEdge >= 480) {
        const derivedBuf = await encodeJpegThumbnailWithJimp(rawJpegBuffer, otherVariant);
        const encDerived = await encryptFileAsync(derivedBuf, apiKey);
        this.storeEncryptedVariantSync(
          safeUserFolder,
          filename,
          otherVariant,
          sourceStat.mtimeMs,
          derivedBuf,
          encDerived,
          'client'
        );
        savedVariants.push(otherVariant);
      }
    }

    return { savedVariants, etag: primaryEtag };
  }

  enqueueBackgroundGeneration(
    userFolder: string,
    filenames: string[],
    apiKey: string,
    variants: ThumbVariant[] = ['thumb', 'large']
  ): number {
    const safeUserFolder = path.resolve(userFolder);
    let scheduled = 0;

    for (const filename of filenames) {
      if (!isRasterImageFilename(filename)) continue;
      for (const variant of variants) {
        const dedupeKey = `${safeUserFolder}:${variant}:${filename}`;
        if (this.backgroundQueuedKeys.has(dedupeKey)) continue;
        if (this.pendingQueue.length >= this.maxQueueLength) break;

        this.backgroundQueuedKeys.add(dedupeKey);
        scheduled++;
        void this.getOrCreateThumbnail(safeUserFolder, filename, variant, apiKey)
          .catch(() => undefined)
          .finally(() => {
            this.backgroundQueuedKeys.delete(dedupeKey);
          });
      }
    }

    return scheduled;
  }

  rebuildUserThumbnails(
    userFolder: string,
    apiKey: string,
    activeFilenames: string[],
    force = false
  ): { queuedCount: number; totalActiveImages: number } {
    const safeUserFolder = path.resolve(userFolder);
    if (force) {
      this.clearUserThumbnails(safeUserFolder);
    }
    const imageFiles = activeFilenames.filter((fn) => isRasterImageFilename(fn));
    const store = force ? emptyStore() : loadStore(safeUserFolder);
    let queuedCount = 0;

    for (const filename of imageFiles) {
      const missingVariants: ThumbVariant[] = [];
      for (const variant of ['thumb', 'large'] as const) {
        const k = entryKey(variant, filename);
        const existing = store.entries[k];
        const thumbRoot = path.resolve(getThumbDir(safeUserFolder));
        const existsOnDisk =
          existing &&
          fs.existsSync(path.resolve(thumbRoot, existing.relPath));
        if (!existsOnDisk) {
          missingVariants.push(variant);
        }
      }
      if (missingVariants.length > 0) {
        queuedCount += this.enqueueBackgroundGeneration(
          safeUserFolder,
          [filename],
          apiKey,
          missingVariants
        );
      }
    }

    return { queuedCount, totalActiveImages: imageFiles.length };
  }

  invalidateFile(userFolder: string, filename: string): void {
    const safeUserFolder = path.resolve(userFolder);
    const thumbRoot = path.resolve(getThumbDir(safeUserFolder));
    if (!fs.existsSync(thumbRoot)) return;

    const store = loadStore(safeUserFolder);
    let changed = false;

    for (const variant of ['thumb', 'large'] as const) {
      const k = entryKey(variant, filename);
      const entry = store.entries[k];
      if (entry) {
        const diskPath = path.resolve(thumbRoot, entry.relPath);
        if (diskPath.startsWith(thumbRoot + path.sep) && fs.existsSync(diskPath)) {
          try {
            fs.unlinkSync(diskPath);
          } catch {
            // ignore
          }
        }
        delete store.entries[k];
        changed = true;
      }
      // Also remove deterministic hashed file even if meta entry was absent
      const deterministicPath = path.resolve(thumbRoot, hashedThumbFilename(filename, variant));
      if (deterministicPath.startsWith(thumbRoot + path.sep) && fs.existsSync(deterministicPath)) {
        try {
          fs.unlinkSync(deterministicPath);
        } catch {
          // ignore
        }
      }
    }

    if (store.negatives[filename]) {
      delete store.negatives[filename];
      changed = true;
    }

    if (changed) {
      saveStore(safeUserFolder, store);
    }
  }

  renameFileCache(userFolder: string, oldFilename: string, newFilename: string): void {
    if (oldFilename === newFilename) return;
    this.invalidateFile(userFolder, oldFilename);
    this.invalidateFile(userFolder, newFilename);
  }

  clearUserThumbnails(userFolder: string): void {
    const thumbDir = getThumbDir(path.resolve(userFolder));
    if (fs.existsSync(thumbDir)) {
      fs.rmSync(thumbDir, { recursive: true, force: true });
    }
  }

  cleanupUserOrphans(userFolder: string): { removedEntries: number; removedDiskFiles: number } {
    const safeUserFolder = path.resolve(userFolder);
    const thumbRoot = path.resolve(getThumbDir(safeUserFolder));
    if (!fs.existsSync(thumbRoot)) {
      return { removedEntries: 0, removedDiskFiles: 0 };
    }

    const activeFiles = new Set<string>();
    try {
      for (const name of fs.readdirSync(safeUserFolder)) {
        if (name.startsWith('.')) continue;
        const full = path.join(safeUserFolder, name);
        try {
          if (fs.statSync(full).isFile()) activeFiles.add(name);
        } catch {
          // ignore
        }
      }
    } catch {
      return { removedEntries: 0, removedDiskFiles: 0 };
    }

    const store = loadStore(safeUserFolder);
    let removedEntries = 0;
    let changed = false;
    const validDiskPaths = new Set<string>();

    for (const [k, entry] of Object.entries(store.entries)) {
      const diskPath = path.resolve(thumbRoot, entry.relPath);
      const sourceExists = activeFiles.has(entry.filename);
      const diskExists = diskPath.startsWith(thumbRoot + path.sep) && fs.existsSync(diskPath);
      if (!sourceExists || !diskExists) {
        if (diskExists) {
          try {
            fs.unlinkSync(diskPath);
          } catch {
            // ignore
          }
        }
        delete store.entries[k];
        removedEntries++;
        changed = true;
      } else {
        validDiskPaths.add(diskPath);
      }
    }

    const now = Date.now();
    for (const [fn, neg] of Object.entries(store.negatives)) {
      if (!activeFiles.has(fn) || neg.expiresAtMs <= now) {
        delete store.negatives[fn];
        changed = true;
      }
    }

    let removedDiskFiles = 0;
    for (const variant of ['thumb', 'large'] as const) {
      const varDir = path.join(thumbRoot, variant);
      if (!fs.existsSync(varDir)) continue;
      for (const file of fs.readdirSync(varDir)) {
        const full = path.resolve(varDir, file);
        if (!validDiskPaths.has(full)) {
          try {
            fs.unlinkSync(full);
            removedDiskFiles++;
          } catch {
            // ignore
          }
        }
      }
    }

    if (this.enforceLruEvictionSync(safeUserFolder, store)) {
      changed = true;
    }

    if (changed) {
      saveStore(safeUserFolder, store);
    }

    return { removedEntries, removedDiskFiles };
  }

  cleanupAllUsersOrphans(uploadRoot: string): void {
    if (!fs.existsSync(uploadRoot)) return;
    for (const entry of fs.readdirSync(uploadRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      this.cleanupUserOrphans(path.join(uploadRoot, entry.name));
    }
  }

  getUserStats(userFolder: string): ThumbStatsSnapshot {
    const safeUserFolder = path.resolve(userFolder);
    const thumbRoot = path.resolve(getThumbDir(safeUserFolder));
    const store = loadStore(safeUserFolder);

    let thumbCount = 0;
    let largeCount = 0;
    let diskBytes = 0;

    for (const entry of Object.values(store.entries)) {
      const diskPath = path.resolve(thumbRoot, entry.relPath);
      if (!diskPath.startsWith(thumbRoot + path.sep) || !fs.existsSync(diskPath)) continue;
      if (entry.variant === 'thumb') thumbCount++;
      else if (entry.variant === 'large') largeCount++;
      try {
        diskBytes += fs.statSync(diskPath).size;
      } catch {
        diskBytes += Math.max(0, Number(entry.diskBytes) || 0);
      }
    }

    const stats = this.userStats.get(safeUserFolder) ?? { hits: 0, misses: 0 };
    const now = Date.now();
    let negativeEntries = 0;
    for (const neg of Object.values(store.negatives)) {
      if (neg.expiresAtMs > now) negativeEntries++;
    }

    return {
      thumbCount,
      largeCount,
      totalEntries: thumbCount + largeCount,
      diskBytes,
      maxBytes: this.getMaxBytes(),
      hits: stats.hits,
      misses: stats.misses,
      negativeEntries,
      queuePending: this.pendingQueue.length,
      activeWorkers: this.activeWorkers,
    };
  }
}

export const thumbCache = new ThumbCacheManager();
