import {
  concatBytes,
  DEFAULT_ARGON2ID_PARAMS,
  defaultArgon2idProvider,
  defaultCryptoProvider,
  fromBase64Url,
  normalizePassphraseNfc,
  toBase64Url,
  unwrapFileKeyForShare,
  utf8Decode,
  utf8Encode,
  wrapFileKeyForShare,
  zeroize,
  ZkCryptoError,
  ZkErrorCode,
  type Argon2idProvider,
  type BlobPlaintextMeta,
  type ZkCryptoProvider,
} from '../../lib/zk/index.ts';
import { validateKdfParamsFloor } from './kdfPolicy.ts';
import type {
  KdfParamsV2,
  OwnerShareMetaPlaintextV2,
  PasswordWrapEnvelopeV2,
  ShareManifestPlaintextV2,
} from './types.ts';

const INFO_SHARE_WRAP = utf8Encode('photocloud/v2/share/wrap');
const INFO_SHARE_META = utf8Encode('photocloud/v2/share/meta');
const EMPTY_SALT = new Uint8Array(0);
const GCM_NONCE_LEN = 12;
const GCM_TAG_LEN = 16;

export interface ShareSubkeysV2 {
  shareWrapKey: Uint8Array;
  shareMetaKey: Uint8Array;
}

export async function deriveShareSubkeys(
  shareKey: Uint8Array,
  crypto: ZkCryptoProvider = defaultCryptoProvider
): Promise<ShareSubkeysV2> {
  if (shareKey.byteLength !== 32) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'shareKey deve essere di 32 byte.');
  }
  const shareWrapKey = await crypto.hkdfSha256(shareKey, EMPTY_SALT, INFO_SHARE_WRAP, 32);
  const shareMetaKey = await crypto.hkdfSha256(shareKey, EMPTY_SALT, INFO_SHARE_META, 32);
  return { shareWrapKey, shareMetaKey };
}

/**
 * Cifra `shareManifest` con `shareMetaKey` e `AAD = UTF8("share-manifest|" + shareId)`.
 * Restituisce una stringa base64url opaca.
 */
export async function encryptShareManifest(
  manifest: ShareManifestPlaintextV2,
  shareKey: Uint8Array,
  shareId: string,
  crypto: ZkCryptoProvider = defaultCryptoProvider
): Promise<string> {
  const { shareWrapKey, shareMetaKey } = await deriveShareSubkeys(shareKey, crypto);
  try {
    const nonce = crypto.randomBytes(GCM_NONCE_LEN);
    const aad = utf8Encode(`share-manifest|${shareId.toLowerCase()}`);
    const plaintext = utf8Encode(JSON.stringify(manifest));
    const ctAndTag = await crypto.aes256GcmEncrypt(shareMetaKey, nonce, plaintext, aad);
    return toBase64Url(concatBytes(nonce, ctAndTag));
  } finally {
    zeroize(shareWrapKey, shareMetaKey);
  }
}

/**
 * Decifra e autentica `shareManifest` con `shareMetaKey` e `AAD = UTF8("share-manifest|" + shareId)`.
 */
export async function decryptShareManifest(
  shareManifestB64: string,
  shareKey: Uint8Array,
  shareId: string,
  crypto: ZkCryptoProvider = defaultCryptoProvider
): Promise<ShareManifestPlaintextV2> {
  const { shareWrapKey, shareMetaKey } = await deriveShareSubkeys(shareKey, crypto);
  try {
    const raw = fromBase64Url(shareManifestB64);
    if (raw.byteLength < GCM_NONCE_LEN + GCM_TAG_LEN + 2) {
      throw new ZkCryptoError(ZkErrorCode.TRUNCATED_BLOB, 'shareManifest troppo corto.');
    }
    const nonce = raw.subarray(0, GCM_NONCE_LEN);
    const ctAndTag = raw.subarray(GCM_NONCE_LEN);
    const aad = utf8Encode(`share-manifest|${shareId.toLowerCase()}`);
    const plaintext = await crypto.aes256GcmDecrypt(
      shareMetaKey,
      nonce,
      ctAndTag,
      aad,
      ZkErrorCode.AUTH_TAG_MISMATCH
    );
    const parsed = JSON.parse(utf8Decode(plaintext)) as ShareManifestPlaintextV2;
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.items)) {
      throw new ZkCryptoError(ZkErrorCode.MALFORMED_HEADER, 'Struttura shareManifest non valida.');
    }
    return parsed;
  } finally {
    zeroize(shareWrapKey, shareMetaKey);
  }
}

export async function encryptShareItemMeta(
  meta: BlobPlaintextMeta,
  shareKey: Uint8Array,
  shareId: string,
  blobId: string,
  crypto: ZkCryptoProvider = defaultCryptoProvider
): Promise<string> {
  const { shareWrapKey, shareMetaKey } = await deriveShareSubkeys(shareKey, crypto);
  try {
    const nonce = crypto.randomBytes(GCM_NONCE_LEN);
    const aad = utf8Encode(`share-meta|${shareId.toLowerCase()}|${blobId.toLowerCase()}`);
    const plaintext = utf8Encode(JSON.stringify(meta));
    const ctAndTag = await crypto.aes256GcmEncrypt(shareMetaKey, nonce, plaintext, aad);
    return toBase64Url(concatBytes(nonce, ctAndTag));
  } finally {
    zeroize(shareWrapKey, shareMetaKey);
  }
}

export async function decryptShareItemMeta(
  encMetaB64: string,
  shareKey: Uint8Array,
  shareId: string,
  blobId: string,
  crypto: ZkCryptoProvider = defaultCryptoProvider
): Promise<BlobPlaintextMeta> {
  const { shareWrapKey, shareMetaKey } = await deriveShareSubkeys(shareKey, crypto);
  try {
    const raw = fromBase64Url(encMetaB64);
    if (raw.byteLength < GCM_NONCE_LEN + GCM_TAG_LEN + 2) {
      throw new ZkCryptoError(ZkErrorCode.TRUNCATED_BLOB, 'encItemMeta troppo corto.');
    }
    const nonce = raw.subarray(0, GCM_NONCE_LEN);
    const ctAndTag = raw.subarray(GCM_NONCE_LEN);
    const aad = utf8Encode(`share-meta|${shareId.toLowerCase()}|${blobId.toLowerCase()}`);
    const plaintext = await crypto.aes256GcmDecrypt(
      shareMetaKey,
      nonce,
      ctAndTag,
      aad,
      ZkErrorCode.AUTH_TAG_MISMATCH
    );
    return JSON.parse(utf8Decode(plaintext)) as BlobPlaintextMeta;
  } finally {
    zeroize(shareWrapKey, shareMetaKey);
  }
}

/**
 * Cifra i metadati privati della condivisione per il solo proprietario con `metaKey`
 * e `AAD = UTF8("owner-share-meta|" + shareId)`. Mai esposto sull'endpoint pubblico.
 */
export async function encryptOwnerShareMeta(
  metaKey: Uint8Array,
  shareId: string,
  meta: OwnerShareMetaPlaintextV2,
  crypto: ZkCryptoProvider = defaultCryptoProvider
): Promise<string> {
  if (metaKey.byteLength !== 32) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'metaKey deve essere di 32 byte.');
  }
  const nonce = crypto.randomBytes(GCM_NONCE_LEN);
  const aad = utf8Encode(`owner-share-meta|${shareId.toLowerCase()}`);
  const plaintext = utf8Encode(JSON.stringify(meta));
  const ctAndTag = await crypto.aes256GcmEncrypt(metaKey, nonce, plaintext, aad);
  return toBase64Url(concatBytes(nonce, ctAndTag));
}

/**
 * Decifra i metadati privati della condivisione del proprietario con `metaKey`.
 */
export async function decryptOwnerShareMeta(
  metaKey: Uint8Array,
  shareId: string,
  encShareMetaB64: string,
  crypto: ZkCryptoProvider = defaultCryptoProvider
): Promise<OwnerShareMetaPlaintextV2> {
  if (metaKey.byteLength !== 32) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'metaKey deve essere di 32 byte.');
  }
  const raw = fromBase64Url(encShareMetaB64);
  if (raw.byteLength < GCM_NONCE_LEN + GCM_TAG_LEN + 2) {
    throw new ZkCryptoError(ZkErrorCode.TRUNCATED_BLOB, 'encShareMeta troppo corto.');
  }
  const nonce = raw.subarray(0, GCM_NONCE_LEN);
  const ctAndTag = raw.subarray(GCM_NONCE_LEN);
  const aad = utf8Encode(`owner-share-meta|${shareId.toLowerCase()}`);
  const plaintext = await crypto.aes256GcmDecrypt(
    metaKey,
    nonce,
    ctAndTag,
    aad,
    ZkErrorCode.AUTH_TAG_MISMATCH
  );
  const parsed = JSON.parse(utf8Decode(plaintext)) as OwnerShareMetaPlaintextV2;
  if (!parsed || parsed.v !== 1 || typeof parsed.shareKeyB64u !== 'string') {
    throw new ZkCryptoError(ZkErrorCode.MALFORMED_HEADER, 'Struttura encShareMeta non valida.');
  }
  return parsed;
}

/**
 * Cifra `shareKey` (32B) con una password opzionale tramite Argon2id + AES-256-GCM.
 */
export async function wrapShareKeyWithPassword(
  shareKey: Uint8Array,
  password: string,
  shareId: string,
  options?: {
    kdfParams?: KdfParamsV2;
    crypto?: ZkCryptoProvider;
    argon2?: Argon2idProvider;
  }
): Promise<string> {
  const crypto = options?.crypto ?? defaultCryptoProvider;
  const argon2 = options?.argon2 ?? defaultArgon2idProvider;
  const kdfParams: KdfParamsV2 = options?.kdfParams ?? {
    algorithm: 'Argon2id',
    memoryKiB: 65536,
    iterations: 3,
    parallelism: 1,
  };
  const saltBytes = crypto.randomBytes(16);
  const saltB64 = toBase64Url(saltBytes);
  validateKdfParamsFloor(saltB64, kdfParams);

  const pwBytes = normalizePassphraseNfc(password);
  let pwKey: Uint8Array = new Uint8Array(0);
  try {
    pwKey = await argon2.derive(pwBytes, saltBytes, {
      memoryKiB: kdfParams.memoryKiB,
      iterations: kdfParams.iterations,
      parallelism: kdfParams.parallelism,
      hashLength: 32,
    });
    const nonce = crypto.randomBytes(GCM_NONCE_LEN);
    const aad = utf8Encode(`share-pw|${shareId.toLowerCase()}`);
    const ctAndTag = await crypto.aes256GcmEncrypt(pwKey, nonce, shareKey, aad);
    const wrappedShareKey = toBase64Url(concatBytes(nonce, ctAndTag));
    const envelope: PasswordWrapEnvelopeV2 = {
      v: 1,
      salt: saltB64,
      kdfParams,
      wrappedShareKey,
    };
    return toBase64Url(utf8Encode(JSON.stringify(envelope)));
  } finally {
    zeroize(pwBytes, pwKey);
  }
}

/**
 * Decifra `shareKey` da un `passwordWrap` opaco verificando prima il KDF floor.
 */
export async function unwrapShareKeyWithPassword(
  passwordWrapB64: string,
  password: string,
  shareId: string,
  options?: {
    crypto?: ZkCryptoProvider;
    argon2?: Argon2idProvider;
  }
): Promise<Uint8Array> {
  const crypto = options?.crypto ?? defaultCryptoProvider;
  const argon2 = options?.argon2 ?? defaultArgon2idProvider;

  const decodedJson = utf8Decode(fromBase64Url(passwordWrapB64));
  const envelope = JSON.parse(decodedJson) as PasswordWrapEnvelopeV2;
  const { saltBytes, kdfParams } = validateKdfParamsFloor(envelope?.salt, envelope?.kdfParams);

  const rawWrapped = fromBase64Url(envelope.wrappedShareKey);
  if (rawWrapped.byteLength !== 60) {
    throw new ZkCryptoError(
      ZkErrorCode.INVALID_PARAMETER,
      'wrappedShareKey deve essere di 60 byte.'
    );
  }

  const pwBytes = normalizePassphraseNfc(password);
  let pwKey: Uint8Array = new Uint8Array(0);
  try {
    pwKey = await argon2.derive(pwBytes, saltBytes, {
      memoryKiB: kdfParams.memoryKiB,
      iterations: kdfParams.iterations,
      parallelism: kdfParams.parallelism,
      hashLength: 32,
    });
    const nonce = rawWrapped.subarray(0, GCM_NONCE_LEN);
    const ctAndTag = rawWrapped.subarray(GCM_NONCE_LEN);
    const aad = utf8Encode(`share-pw|${shareId.toLowerCase()}`);
    return await crypto.aes256GcmDecrypt(
      pwKey,
      nonce,
      ctAndTag,
      aad,
      ZkErrorCode.AUTH_TAG_MISMATCH
    );
  } finally {
    zeroize(pwBytes, pwKey);
  }
}

/**
 * Costruisce l'URL pubblico di condivisione ponendo `shareKey` ESCLUSIVAMENTE nel fragment `#`.
 */
export function buildShareUrl(baseOrigin: string, shareId: string, shareKey: Uint8Array): string {
  if (shareKey.byteLength !== 32) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'shareKey deve essere di 32 byte.');
  }
  const cleanOrigin = baseOrigin.replace(/\/+$/, '');
  const keyB64 = toBase64Url(shareKey);
  return `${cleanOrigin}/v2/share/${encodeURIComponent(shareId)}#${keyB64}`;
}

/**
 * Estrae `shareKey` (32 byte) dal fragment `#<base64url>` dell'URL.
 * Rifiuta qualsiasi tentativo di passare la chiave nella query string.
 */
export function parseShareUrlFragment(urlOrHash: string): Uint8Array {
  if (urlOrHash.includes('?')) {
    const queryPart = urlOrHash.split('?')[1]?.split('#')[0] || '';
    if (/(^|&)(key|shareKey|token|k)=/i.test(queryPart)) {
      throw new ZkCryptoError(
        ZkErrorCode.INVALID_PARAMETER,
        'SHARE_KEY_IN_QUERY_FORBIDDEN: La chiave di condivisione non può mai trovarsi nella query string.'
      );
    }
  }
  const hashIdx = urlOrHash.indexOf('#');
  const rawFragment = hashIdx >= 0 ? urlOrHash.slice(hashIdx + 1).trim() : urlOrHash.trim();
  if (!rawFragment) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'Fragment #shareKey mancante nell URL.');
  }
  const keyBytes = fromBase64Url(rawFragment);
  if (keyBytes.byteLength !== 32) {
    throw new ZkCryptoError(
      ZkErrorCode.INVALID_PARAMETER,
      'shareKey nel fragment deve essere di 32 byte.'
    );
  }
  return keyBytes;
}

export { wrapFileKeyForShare, unwrapFileKeyForShare, DEFAULT_ARGON2ID_PARAMS };
