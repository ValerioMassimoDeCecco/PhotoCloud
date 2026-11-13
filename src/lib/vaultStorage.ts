/**
 * Utility di persistenza atomica per i metadati delle funzionalità v1.4.0:
 * preferiti, cache pHash, condivisioni pubbliche, album multi-utente e push.
 *
 * Tutte le scritture avvengono in modo atomico (file temporaneo + rename) così
 * un crash a metà scrittura non corrompe mai i metadati sul disco.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    const parsed = JSON.parse(raw) as T;
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

/** Scrittura atomica di un oggetto JSON (tmp + rename sullo stesso filesystem). */
export function writeJsonAtomic(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

/** Lettura JSON tollerante agli errori, con protezione da chiavi prototype-polluting. */
export function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  return safeJsonParse(fs.readFileSync(filePath, 'utf-8'), fallback);
}

/**
 * Segreto crittografico a livello server utilizzato per "avvolgere" (wrap) le
 * chiavi API degli utenti nei record di condivisione: in questo modo il file
 * JSON delle condivisioni non contiene MAI le chiavi in chiaro, e la revoca di
 * una condivisione distrugge semplicemente il record cifrato.
 *
 * Viene generato UNA VOLTA e persistito in `user_media/.server-secret`
 * (directory già esclusa da git tramite .gitignore) con permessi 0600.
 */
export function getOrCreateServerSecret(storageDir: string): Buffer {
  const secretPath = path.join(storageDir, '.server-secret');
  try {
    if (fs.existsSync(secretPath)) {
      const raw = fs.readFileSync(secretPath, 'utf-8').trim();
      if (/^[0-9a-f]{64}$/i.test(raw)) {
        return Buffer.from(raw, 'hex');
      }
    }
  } catch {
    // rigenera sotto
  }
  const secret = crypto.randomBytes(32);
  fs.mkdirSync(storageDir, { recursive: true });
  const tmpPath = `${secretPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, secret.toString('hex'), { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(tmpPath, secretPath);
  return secret;
}

export interface WrappedSecret {
  v: 1;
  salt: string;
  iv: string;
  tag: string;
  ct: string;
}

function deriveWrapKey(serverSecret: Buffer, salt: Buffer): Buffer {
  return Buffer.from(
    crypto.hkdfSync('sha256', serverSecret, salt, Buffer.from('photocloud-share-key-wrap-v1'), 32)
  );
}

/**
 * Cifra un segreto (es. la chiave API dell'utente proprietario) per archiviarlo
 * in un record di condivisione revocabile, senza salvarlo in chiaro sul disco.
 */
export function wrapSecret(serverSecret: Buffer, plaintext: string): WrappedSecret {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveWrapKey(serverSecret, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  return {
    v: 1,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ct: ct.toString('base64'),
  };
}

/** Decifra un segreto precedentemente avvolto con `wrapSecret`. */
export function unwrapSecret(serverSecret: Buffer, wrapped: WrappedSecret): string | null {
  try {
    if (!wrapped || wrapped.v !== 1) return null;
    const salt = Buffer.from(String(wrapped.salt), 'base64');
    const iv = Buffer.from(String(wrapped.iv), 'base64');
    const tag = Buffer.from(String(wrapped.tag), 'base64');
    const ct = Buffer.from(String(wrapped.ct), 'base64');
    const key = deriveWrapKey(serverSecret, salt);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf-8');
  } catch {
    return null;
  }
}

/** Hash di lookup veloce per token pubblici (sha256): il token grezzo non viene mai memorizzato. */
export function hashLookupToken(token: string): string {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function sanitizePlainObject<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = Object.create(null);
  for (const [k, v] of Object.entries(obj)) {
    if (!FORBIDDEN_OBJECT_KEYS.has(k)) out[k] = v;
  }
  return out as T;
}
