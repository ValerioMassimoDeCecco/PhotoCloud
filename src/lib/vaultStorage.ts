/**
 * Utility di persistenza atomica JSON e generazione del segreto HMAC del server
 * (usato esclusivamente per fake-salt deterministico anti-enumerazione utenti nel vault ZK v2).
 *
 * ZERO cifratura/decifratura lato server dei dati utente: tutta la crittografia avviene sul client.
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

/** Lettura JSON tollerante agli errori. */
export function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  return safeJsonParse(fs.readFileSync(filePath, 'utf-8'), fallback);
}

/**
 * Segreto casuale da 32 byte persistito con permessi 0600 (usato esclusivamente per
 * derivare il fake-salt HMAC deterministico in POST /api/v2/login/params anti-enumerazione).
 * Non cifra né decifra mai file o metadati degli utenti.
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

export function sanitizePlainObject<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = Object.create(null);
  for (const [k, v] of Object.entries(obj)) {
    if (!FORBIDDEN_OBJECT_KEYS.has(k)) out[k] = v;
  }
  return out as T;
}
