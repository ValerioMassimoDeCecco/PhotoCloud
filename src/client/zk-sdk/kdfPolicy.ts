import {
  DEFAULT_ARGON2ID_PARAMS,
  fromBase64Url,
  fromHex,
  toBase64Url,
  toHex,
  ZkCryptoError,
  ZkErrorCode,
  type Argon2idParams,
} from '../../lib/zk/index.ts';
import type { KdfParamsV2, KdfPinningStore, PinnedKdfRecord } from './types.ts';
export type { KdfPinningStore, PinnedKdfRecord };

// ============================================================================
// Costanti KDF Floor (Fase 3.2 / R8)
// ============================================================================

export const MIN_ARGON2_MEMORY_KIB = 65536; // 64 MiB floor (allineato ai parametri di registrazione)
export const MIN_ARGON2_ITERATIONS = 3;
export const MIN_ARGON2_PARALLELISM = 1;
export const MIN_SALT_BYTES = 16;
export const MIN_PASSPHRASE_LENGTH = 12;

export const DEFAULT_CLIENT_KDF_PARAMS: Argon2idParams = {
  ...DEFAULT_ARGON2ID_PARAMS,
};

export interface KdfFloorValidationResult {
  valid: true;
  saltBytes: Uint8Array;
  kdfParams: KdfParamsV2;
  argon2Params: Argon2idParams;
}

/**
 * Verifica che i parametri KDF e il salt restituiti dal server rispettino il floor minimo
 * di sicurezza del client (allineato ai parametri di registrazione):
 * - algorithm === 'Argon2id' (se specificato)
 * - memoryKiB >= 65536 (64 MiB)
 * - iterations >= 3
 * - parallelism >= 1
 * - salt >= 16 byte
 *
 * Accetta sia `(saltB64OrBytes, rawKdfParams)` sia `(rawKdfParams, saltBytesOptional)`.
 */
export function validateKdfParamsFloor(
  firstArg: unknown,
  secondArg?: unknown
): KdfFloorValidationResult {
  let rawKdfParams: Record<string, unknown>;
  let saltBytes: Uint8Array = new Uint8Array(MIN_SALT_BYTES);

  if (typeof firstArg === 'string' || firstArg instanceof Uint8Array) {
    // Chiamato come (salt, kdfParams)
    if (typeof firstArg === 'string') {
      if (firstArg.trim().length === 0) {
        throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'Salt KDF mancante o vuoto.');
      }
      try {
        saltBytes = fromBase64Url(firstArg.trim());
      } catch {
        throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'Salt KDF non è base64url valido.');
      }
    } else {
      saltBytes = firstArg;
    }
    if (!secondArg || typeof secondArg !== 'object') {
      throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'Parametri KDF mancanti.');
    }
    rawKdfParams = secondArg as Record<string, unknown>;
  } else if (firstArg && typeof firstArg === 'object') {
    // Chiamato come (kdfParams, saltBytes?)
    rawKdfParams = firstArg as Record<string, unknown>;
    if (secondArg instanceof Uint8Array) {
      saltBytes = secondArg;
    } else if (typeof secondArg === 'string') {
      saltBytes = fromBase64Url(secondArg.trim());
    }
  } else {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'Parametri KDF mancanti.');
  }

  if (saltBytes.byteLength < MIN_SALT_BYTES) {
    throw new ZkCryptoError(
      ZkErrorCode.INVALID_PARAMETER,
      `KDF_FLOOR_VIOLATION: Salt KDF troppo corto (${saltBytes.byteLength} byte, minimo ${MIN_SALT_BYTES} byte).`
    );
  }

  if (rawKdfParams.algorithm !== undefined) {
    const alg = String(rawKdfParams.algorithm || '').toLowerCase();
    if (alg !== 'argon2id') {
      throw new ZkCryptoError(
        ZkErrorCode.INVALID_PARAMETER,
        'KDF_FLOOR_VIOLATION: Algoritmo KDF non supportato (richiesto Argon2id).'
      );
    }
  }

  const memoryKiB = Number(rawKdfParams.memoryKiB);
  const iterations = Number(rawKdfParams.iterations);
  const parallelism = Number(rawKdfParams.parallelism);

  if (!Number.isSafeInteger(memoryKiB) || memoryKiB < MIN_ARGON2_MEMORY_KIB) {
    throw new ZkCryptoError(
      ZkErrorCode.INVALID_PARAMETER,
      `KDF_FLOOR_VIOLATION: memoryKiB (${memoryKiB}) inferiore al floor minimo (${MIN_ARGON2_MEMORY_KIB} KiB).`
    );
  }
  if (!Number.isSafeInteger(iterations) || iterations < MIN_ARGON2_ITERATIONS) {
    throw new ZkCryptoError(
      ZkErrorCode.INVALID_PARAMETER,
      `KDF_FLOOR_VIOLATION: iterations (${iterations}) inferiore al floor minimo (${MIN_ARGON2_ITERATIONS}).`
    );
  }
  if (!Number.isSafeInteger(parallelism) || parallelism < MIN_ARGON2_PARALLELISM) {
    throw new ZkCryptoError(
      ZkErrorCode.INVALID_PARAMETER,
      `KDF_FLOOR_VIOLATION: parallelism (${parallelism}) inferiore al floor minimo (${MIN_ARGON2_PARALLELISM}).`
    );
  }

  const kdfParams: KdfParamsV2 = {
    algorithm: 'Argon2id',
    memoryKiB,
    iterations,
    parallelism,
  };

  return {
    valid: true,
    saltBytes,
    kdfParams,
    argon2Params: {
      memoryKiB,
      iterations,
      parallelism,
      hashLength: 32,
    },
  };
}

// ============================================================================
// Pinning dei Parametri KDF Non Segreti
// ============================================================================

export class InMemoryKdfPinningStore implements KdfPinningStore {
  private readonly records = new Map<string, PinnedKdfRecord>();

  public get(username: string): PinnedKdfRecord | null {
    return this.records.get(username.trim().toLowerCase()) ?? null;
  }

  public set(record: PinnedKdfRecord): void {
    this.records.set(record.username.trim().toLowerCase(), {
      ...record,
      kdfParams: { ...record.kdfParams },
    });
  }
}

export interface KdfPinningCheckResult {
  changed: boolean;
  previous: PinnedKdfRecord | null;
  current: PinnedKdfRecord;
}

export function checkAndPinKdfParameters(
  store: KdfPinningStore,
  username: string,
  salt: string,
  kdfParams: { memoryKiB: number; iterations: number; parallelism: number },
  nowMs = Date.now()
): KdfPinningCheckResult {
  const normalizedUser = username.trim().toLowerCase();
  const previous = store.get(normalizedUser);
  const current: PinnedKdfRecord = {
    username: normalizedUser,
    salt,
    kdfParams: {
      algorithm: 'Argon2id',
      memoryKiB: kdfParams.memoryKiB,
      iterations: kdfParams.iterations,
      parallelism: kdfParams.parallelism,
    },
    pinnedAt: nowMs,
  };

  if (!previous) {
    store.set(current);
    return { changed: false, previous: null, current };
  }

  const changed =
    previous.salt !== salt ||
    previous.kdfParams.memoryKiB !== kdfParams.memoryKiB ||
    previous.kdfParams.iterations !== kdfParams.iterations ||
    previous.kdfParams.parallelism !== kdfParams.parallelism;

  store.set(current);
  return { changed, previous, current };
}

// ============================================================================
// Valutazione Forza Passphrase (>= 12 caratteri NFC)
// ============================================================================

export interface PassphraseStrengthResult {
  valid: boolean;
  normalizedLength: number;
  score: 0 | 1 | 2 | 3 | 4;
  label: 'insufficient' | 'weak' | 'fair' | 'strong' | 'excellent';
  estimatedBits: number;
  feedback: string;
}

export function evaluatePassphraseStrength(passphrase: string): PassphraseStrengthResult {
  const normalized = (passphrase ?? '').normalize('NFC');
  const len = Array.from(normalized).length;
  if (len < MIN_PASSPHRASE_LENGTH) {
    return {
      valid: false,
      normalizedLength: len,
      score: 0,
      label: 'insufficient',
      estimatedBits: len * 3,
      feedback: `La passphrase deve contenere almeno ${MIN_PASSPHRASE_LENGTH} caratteri (attuali: ${len}).`,
    };
  }

  let classes = 0;
  let pool = 0;
  if (/[a-z]/.test(normalized)) {
    classes += 1;
    pool += 26;
  }
  if (/[A-Z]/.test(normalized)) {
    classes += 1;
    pool += 26;
  }
  if (/[0-9]/.test(normalized)) {
    classes += 1;
    pool += 10;
  }
  if (/[^a-zA-Z0-9]/.test(normalized)) {
    classes += 1;
    pool += 32;
  }

  const uniqueChars = new Set(Array.from(normalized)).size;
  const estimatedBits = Math.round(len * Math.log2(Math.max(2, pool)));

  if (uniqueChars < 4) {
    return {
      valid: false,
      normalizedLength: len,
      score: 1,
      label: 'weak',
      estimatedBits,
      feedback: 'La passphrase contiene troppi caratteri ripetuti.',
    };
  }

  let score: 1 | 2 | 3 | 4 = 2;
  if (len >= 20 && classes >= 3 && uniqueChars >= 10) {
    score = 4;
  } else if (len >= 16 || (len >= 12 && classes >= 3 && uniqueChars >= 8)) {
    score = 3;
  } else if (len >= 12 && classes >= 2) {
    score = 2;
  } else {
    score = 1;
  }

  const labels: Record<1 | 2 | 3 | 4, PassphraseStrengthResult['label']> = {
    1: 'weak',
    2: 'fair',
    3: 'strong',
    4: 'excellent',
  };

  return {
    valid: true,
    normalizedLength: len,
    score,
    label: labels[score],
    estimatedBits,
    feedback: `Passphrase valida (${labels[score]}).`,
  };
}

// ============================================================================
// Codice di Recupero Stampabile e Conferma Obbligatoria
// ============================================================================

export function formatRecoveryCode(accountKeyBytes: Uint8Array): string {
  if (accountKeyBytes.byteLength !== 32) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'accountKey deve essere di 32 byte.');
  }
  const hex = toHex(accountKeyBytes).toUpperCase();
  const groups: string[] = [];
  for (let i = 0; i < hex.length; i += 8) {
    groups.push(hex.slice(i, i + 8));
  }
  return groups.join('-');
}

export function parseRecoveryCodeToAccountKey(recoveryCode: string): Uint8Array {
  const cleaned = recoveryCode.replace(/[\s-]/g, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(cleaned)) {
    throw new ZkCryptoError(
      ZkErrorCode.INVALID_PARAMETER,
      'Codice di recupero non valido (attesi 64 caratteri hex).'
    );
  }
  return fromHex(cleaned);
}

export function verifyRecoveryCodeConfirmation(
  expectedRecoveryCode: string,
  userConfirmationInput: string
): boolean {
  const cleanExpected = expectedRecoveryCode.replace(/[\s-]/g, '').toUpperCase();
  const cleanInput = (userConfirmationInput || '').replace(/[\s-]/g, '').toUpperCase();
  if (cleanExpected.length !== 64 || cleanInput.length < 8) {
    return false;
  }
  if (cleanInput.length === 64) {
    return cleanInput === cleanExpected;
  }
  const expectedTail8 = cleanExpected.slice(-8);
  return cleanInput === expectedTail8;
}

export { toBase64Url };
