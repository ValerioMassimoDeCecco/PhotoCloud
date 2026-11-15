import fs from 'node:fs';
import path from 'node:path';
import { decryptFileSha256Stream } from './crypto';
import { readJsonFile, writeJsonAtomic } from './vaultStorage';

export interface HashIndexEntry {
  sha256: string;
  plaintextSize: number;
  mtimeMs: number;
  updatedAtMs: number;
}

export interface HashIndexFile {
  version: 1;
  entries: Record<string, HashIndexEntry>;
}

const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/i;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAGIC_PREFIX = Buffer.from('PhotoCloud-GCM-v1\0', 'utf8');

function isValidHashFilename(name: string): boolean {
  if (!name || name.startsWith('.') || FORBIDDEN_KEYS.has(name)) return false;
  if (name !== path.basename(name)) return false;
  if (/[\/\\:\x00-\x1f\x7f]/.test(name)) return false;
  return true;
}

function estimateEncryptedPlaintextSize(fullPath: string, stat: fs.Stats): number {
  let fd: number | null = null;
  try {
    fd = fs.openSync(fullPath, 'r');
    const header = Buffer.alloc(Math.min(stat.size, MAGIC_PREFIX.length));
    if (header.length > 0) {
      fs.readSync(fd, header, 0, header.length, 0);
    }
    const overhead = header.length === MAGIC_PREFIX.length && header.equals(MAGIC_PREFIX) ? 62 : 32;
    return Math.max(0, stat.size - overhead);
  } catch {
    return 0;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

export function normalizeSha256Hex(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const clean = raw.trim().toLowerCase();
  return SHA256_HEX_REGEX.test(clean) ? clean : null;
}

export class VaultHashIndex {
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly backfillInFlight = new Set<string>();

  private getIndexPath(userFolder: string): string {
    return path.join(userFolder, '.hashes.json');
  }

  private withUserLock<T>(userFolder: string, task: () => Promise<T>): Promise<T> {
    const key = path.resolve(userFolder);
    const prev = this.locks.get(key) ?? Promise.resolve();
    const next = prev.then(task, task);
    const tracked = next.catch(() => undefined);
    this.locks.set(key, tracked);
    tracked.finally(() => {
      if (this.locks.get(key) === tracked) {
        this.locks.delete(key);
      }
    });
    return next;
  }

  private loadRawIndex(userFolder: string): HashIndexFile {
    const raw = readJsonFile<Partial<HashIndexFile>>(this.getIndexPath(userFolder), {
      version: 1,
      entries: {},
    });
    const cleanEntries: Record<string, HashIndexEntry> = Object.create(null);
    if (raw.entries && typeof raw.entries === 'object') {
      for (const [k, v] of Object.entries(raw.entries)) {
        if (!isValidHashFilename(k) || !v || typeof v !== 'object') continue;
        const sha = normalizeSha256Hex((v as HashIndexEntry).sha256);
        const plaintextSize = Number((v as HashIndexEntry).plaintextSize);
        const mtimeMs = Number((v as HashIndexEntry).mtimeMs);
        const updatedAtMs = Number((v as HashIndexEntry).updatedAtMs) || Date.now();
        if (sha && Number.isFinite(plaintextSize) && plaintextSize >= 0 && Number.isFinite(mtimeMs)) {
          cleanEntries[k] = {
            sha256: sha,
            plaintextSize,
            mtimeMs,
            updatedAtMs,
          };
        }
      }
    }
    return {
      version: 1,
      entries: cleanEntries,
    };
  }

  private saveRawIndex(userFolder: string, data: HashIndexFile): void {
    fs.mkdirSync(userFolder, { recursive: true });
    writeJsonAtomic(this.getIndexPath(userFolder), data);
  }

  private listActiveVaultFiles(userFolder: string): Array<{ filename: string; fullPath: string; stat: fs.Stats }> {
    if (!fs.existsSync(userFolder)) return [];
    const results: Array<{ filename: string; fullPath: string; stat: fs.Stats }> = [];
    for (const entry of fs.readdirSync(userFolder, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!isValidHashFilename(entry.name)) continue;
      const fullPath = path.join(userFolder, entry.name);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          results.push({ filename: entry.name, fullPath, stat });
        }
      } catch {
        // skip disappearing file
      }
    }
    return results;
  }

  async recordFileHash(
    userFolder: string,
    filename: string,
    sha256: string,
    plaintextSize: number,
    mtimeMs?: number
  ): Promise<void> {
    const cleanSha = normalizeSha256Hex(sha256);
    if (!cleanSha || !isValidHashFilename(filename)) return;
    await this.withUserLock(userFolder, async () => {
      const fullPath = path.join(userFolder, filename);
      let resolvedMtime = typeof mtimeMs === 'number' && Number.isFinite(mtimeMs) ? mtimeMs : Date.now();
      try {
        resolvedMtime = fs.statSync(fullPath).mtimeMs;
      } catch {
        // fallback to provided/current mtime
      }
      const data = this.loadRawIndex(userFolder);
      data.entries[filename] = {
        sha256: cleanSha,
        plaintextSize: Math.max(0, plaintextSize),
        mtimeMs: resolvedMtime,
        updatedAtMs: Date.now(),
      };
      this.saveRawIndex(userFolder, data);
    });
  }

  async removeFileHash(userFolder: string, filename: string): Promise<void> {
    if (!isValidHashFilename(filename)) return;
    await this.withUserLock(userFolder, async () => {
      const data = this.loadRawIndex(userFolder);
      if (Object.prototype.hasOwnProperty.call(data.entries, filename)) {
        delete data.entries[filename];
        this.saveRawIndex(userFolder, data);
      }
    });
  }

  async removeManyFileHashes(userFolder: string, filenames: string[]): Promise<void> {
    if (filenames.length === 0) return;
    await this.withUserLock(userFolder, async () => {
      const data = this.loadRawIndex(userFolder);
      let changed = false;
      for (const fn of filenames) {
        if (isValidHashFilename(fn) && Object.prototype.hasOwnProperty.call(data.entries, fn)) {
          delete data.entries[fn];
          changed = true;
        }
      }
      if (changed) {
        this.saveRawIndex(userFolder, data);
      }
    });
  }

  /**
   * Computes or returns cached SHA-256 digests for all ACTIVE files in [userFolder].
   * Used by /find_duplicates_server to avoid redundant decryptions.
   */
  async resolveAllActiveHashes(
    userFolder: string,
    apiKey: string
  ): Promise<Array<{ filename: string; hash: string | null }>> {
    return this.withUserLock(userFolder, async () => {
      const activeFiles = this.listActiveVaultFiles(userFolder);
      const data = this.loadRawIndex(userFolder);
      const activeSet = new Set(activeFiles.map((f) => f.filename));
      let dirty = false;

      for (const existingKey of Object.keys(data.entries)) {
        if (!activeSet.has(existingKey)) {
          delete data.entries[existingKey];
          dirty = true;
        }
      }

      const out: Array<{ filename: string; hash: string | null }> = [];
      for (const item of activeFiles) {
        const cached = data.entries[item.filename];
        if (cached && Math.abs(cached.mtimeMs - item.stat.mtimeMs) < 1) {
          out.push({ filename: item.filename, hash: cached.sha256 });
          continue;
        }
        try {
          const { sha256, plaintextSize } = await decryptFileSha256Stream(item.fullPath, apiKey);
          data.entries[item.filename] = {
            sha256,
            plaintextSize,
            mtimeMs: item.stat.mtimeMs,
            updatedAtMs: Date.now(),
          };
          dirty = true;
          out.push({ filename: item.filename, hash: sha256 });
        } catch {
          out.push({ filename: item.filename, hash: null });
        }
      }

      if (dirty) {
        this.saveRawIndex(userFolder, data);
      }
      return out;
    });
  }

  /**
   * Checks which candidate hashes already exist as ACTIVE files in [userFolder] (excluding trash).
   * Lazily indexes matching-size unindexed files immediately and schedules background backfill
   * for any remaining pre-v1.5.0 files without blocking HTTP threads.
   */
  async checkBackupItems(
    userFolder: string,
    apiKey: string,
    items: Array<{ sha256: string; sizeBytes?: number }>
  ): Promise<{ existingSha256: string[]; backfillPending: number }> {
    const cleanItems: Array<{ sha256: string; sizeBytes?: number }> = [];
    const wantedSizes = new Set<number>();
    const wantedHashes = new Set<string>();

    for (const item of items) {
      const norm = normalizeSha256Hex(item.sha256);
      if (!norm || wantedHashes.has(norm)) continue;
      wantedHashes.add(norm);
      const sz = typeof item.sizeBytes === 'number' && Number.isFinite(item.sizeBytes) && item.sizeBytes >= 0
        ? Math.floor(item.sizeBytes)
        : undefined;
      if (sz !== undefined) wantedSizes.add(sz);
      cleanItems.push({ sha256: norm, sizeBytes: sz });
    }

    if (cleanItems.length === 0) {
      return { existingSha256: [], backfillPending: 0 };
    }

    const result = await this.withUserLock(userFolder, async () => {
      const activeFiles = this.listActiveVaultFiles(userFolder);
      const data = this.loadRawIndex(userFolder);
      const activeSet = new Set(activeFiles.map((f) => f.filename));
      let dirty = false;

      // Prune entries belonging to deleted or trashed files immediately
      for (const key of Object.keys(data.entries)) {
        if (!activeSet.has(key)) {
          delete data.entries[key];
          dirty = true;
        }
      }

      const unindexed: Array<{ filename: string; fullPath: string; stat: fs.Stats; estSize: number }> = [];
      for (const file of activeFiles) {
        const cached = data.entries[file.filename];
        if (!cached || Math.abs(cached.mtimeMs - file.stat.mtimeMs) >= 1) {
          unindexed.push({
            ...file,
            estSize: estimateEncryptedPlaintextSize(file.fullPath, file.stat),
          });
        }
      }

      // Synchronously index small unindexed sets (<= 8 files) or exact plaintext-size candidates
      // so pre-1.5.0 vaults immediately avoid re-uploading existing files during Auto Backup checks.
      const toComputeNow =
        unindexed.length <= 8
          ? unindexed
          : unindexed.filter((u) => wantedSizes.has(u.estSize)).slice(0, 16);

      for (const target of toComputeNow) {
        try {
          const { sha256, plaintextSize } = await decryptFileSha256Stream(target.fullPath, apiKey);
          data.entries[target.filename] = {
            sha256,
            plaintextSize,
            mtimeMs: target.stat.mtimeMs,
            updatedAtMs: Date.now(),
          };
          dirty = true;
        } catch {
          // ignore unreadable legacy/corrupt files during index pass
        }
      }

      if (dirty) {
        this.saveRawIndex(userFolder, data);
      }

      const activeHashSet = new Set<string>();
      for (const file of activeFiles) {
        const entry = data.entries[file.filename];
        if (entry) {
          activeHashSet.add(entry.sha256);
        }
      }

      const remainingUnindexed = activeFiles.filter((f) => {
        const e = data.entries[f.filename];
        return !e || Math.abs(e.mtimeMs - f.stat.mtimeMs) >= 1;
      }).length;

      const existingSha256 = cleanItems
        .filter((i) => activeHashSet.has(i.sha256))
        .map((i) => i.sha256);

      return {
        existingSha256,
        backfillPending: remainingUnindexed,
      };
    });

    if (result.backfillPending > 0) {
      this.startBackgroundBackfill(userFolder, apiKey);
    }

    return result;
  }

  startBackgroundBackfill(userFolder: string, apiKey: string): void {
    const resolved = path.resolve(userFolder);
    if (this.backfillInFlight.has(resolved)) return;
    this.backfillInFlight.add(resolved);

    setImmediate(() => {
      void (async () => {
        try {
          while (true) {
            const processed = await this.withUserLock(resolved, async () => {
              const activeFiles = this.listActiveVaultFiles(resolved);
              const data = this.loadRawIndex(resolved);
              const nextFile = activeFiles.find((f) => {
                const entry = data.entries[f.filename];
                return !entry || Math.abs(entry.mtimeMs - f.stat.mtimeMs) >= 1;
              });
              if (!nextFile) return false;
              try {
                const { sha256, plaintextSize } = await decryptFileSha256Stream(nextFile.fullPath, apiKey);
                data.entries[nextFile.filename] = {
                  sha256,
                  plaintextSize,
                  mtimeMs: nextFile.stat.mtimeMs,
                  updatedAtMs: Date.now(),
                };
                this.saveRawIndex(resolved, data);
              } catch {
                // avoid infinite loop on permanently undecryptable file
                data.entries[nextFile.filename] = {
                  sha256: '0'.repeat(64),
                  plaintextSize: 0,
                  mtimeMs: nextFile.stat.mtimeMs,
                  updatedAtMs: Date.now(),
                };
                this.saveRawIndex(resolved, data);
              }
              return true;
            });
            if (!processed) break;
            await new Promise((r) => setTimeout(r, 15));
          }
        } finally {
          this.backfillInFlight.delete(resolved);
        }
      })();
    });
  }
}

export const vaultHashIndex = new VaultHashIndex();
