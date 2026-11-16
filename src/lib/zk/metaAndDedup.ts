import { ZkCryptoError, ZkErrorCode } from './errors.ts';
import type { ByteStreamSource } from './pczkStream.ts';
import { defaultCryptoProvider, type ZkCryptoProvider } from './provider.ts';
import {
  concatBytes,
  toBase64Url,
  toHex,
  utf8Decode,
  utf8Encode,
  uuidToBytes,
  zeroize,
} from './zeroize.ts';

export const DEDUP_STREAM_BLOCK_BYTES = 65536; // 64 KiB per Spec §5.4

export interface BlobThumbMeta {
  present: boolean;
  width: number;
  height: number;
  sizeBytes: number;
}

export interface BlobExifSubset {
  make?: string;
  model?: string;
  lensModel?: string;
  fNumber?: number;
  exposureTime?: string;
  iso?: number;
  focalLength?: number;
  lat?: number;
  lon?: number;
  altitude?: number;
  phash?: string;
  [key: string]: unknown;
}

export interface BlobPlaintextMeta {
  v: number;
  name: string;
  mime: string;
  size: number;
  takenAt: number;
  createdAt: number;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  isFavorite?: boolean;
  exifSubset?: BlobExifSubset | null;
  dedupTag?: string;
  thumbs?: {
    sm?: BlobThumbMeta;
    md?: BlobThumbMeta;
  };
}

export interface AlbumEntry {
  id: string;
  name: string;
  createdAt: number;
  coverBlobId?: string | null;
  blobIds: string[];
}

export interface AlbumCatalogPlaintext {
  v: number;
  revision: number;
  updatedAt: number;
  albums: AlbumEntry[];
}

async function* iterateSourceChunks(source: ByteStreamSource): AsyncGenerator<Uint8Array, void, void> {
  if (source instanceof Uint8Array) {
    yield source;
    return;
  }
  if (typeof ReadableStream !== 'undefined' && source instanceof ReadableStream) {
    const reader = source.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) yield value;
      }
    } finally {
      reader.releaseLock();
    }
    return;
  }
  if (Symbol.asyncIterator in source) {
    for await (const c of source as AsyncIterable<Uint8Array>) {
      if (c && c.byteLength > 0) yield c;
    }
    return;
  }
  if (Symbol.iterator in source) {
    for (const c of source as Iterable<Uint8Array>) {
      if (c && c.byteLength > 0) yield c;
    }
    return;
  }
  throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'Unsupported stream source for computeDedupTag.');
}

/**
 * Spec §5.4 (10):
 * Computes `dedupTag = HMAC-SHA256(dedupKey, plaintext)` in streaming 64 KiB blocks.
 */
export async function computeDedupTag(
  dedupKey: Uint8Array,
  source: ByteStreamSource,
  cryptoProvider: ZkCryptoProvider = defaultCryptoProvider
): Promise<{ tagBytes: Uint8Array; tagHex: string; tagB64u: string }> {
  if (dedupKey.byteLength !== 32) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'dedupKey must be 32 bytes.');
  }
  const mac = cryptoProvider.createHmacSha256Stream(dedupKey);
  for await (const chunk of iterateSourceChunks(source)) {
    for (let offset = 0; offset < chunk.byteLength; offset += DEDUP_STREAM_BLOCK_BYTES) {
      const end = Math.min(chunk.byteLength, offset + DEDUP_STREAM_BLOCK_BYTES);
      mac.update(chunk.subarray(offset, end));
    }
  }
  const tagBytes = mac.digest();
  return {
    tagBytes,
    tagHex: toHex(tagBytes),
    tagB64u: toBase64Url(tagBytes),
  };
}

/**
 * Spec §5.1 (8):
 * Derives `blobMetaKey = HKDF-SHA256(ikm=metaKey, salt=blobId_bytes(16B), info="photocloud/v2/blob-meta", L=32)`
 * and encrypts the JSON metadata with AES-256-GCM, 12B random nonce, `AAD = "meta|" + blobId`.
 */
export async function encryptMeta(
  metaKey: Uint8Array,
  blobId: string,
  metadata: BlobPlaintextMeta | string,
  nonce?: Uint8Array,
  cryptoProvider: ZkCryptoProvider = defaultCryptoProvider
): Promise<Uint8Array> {
  if (metaKey.byteLength !== 32) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'metaKey must be 32 bytes.');
  }
  const canonicalBlobId = blobId.toLowerCase();
  const blobIdBytes = uuidToBytes(canonicalBlobId);
  const blobMetaKey = await cryptoProvider.hkdfSha256(
    metaKey,
    blobIdBytes,
    utf8Encode('photocloud/v2/blob-meta'),
    32
  );
  try {
    const iv = nonce ?? cryptoProvider.randomBytes(12);
    if (iv.byteLength !== 12) {
      throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'metadata nonce must be 12 bytes.');
    }
    const jsonStr = typeof metadata === 'string' ? metadata : JSON.stringify(metadata);
    const ptBytes = utf8Encode(jsonStr);
    const aad = utf8Encode(`meta|${canonicalBlobId}`);
    const ctWithTag = await cryptoProvider.aes256GcmEncrypt(blobMetaKey, iv, ptBytes, aad);
    zeroize(ptBytes);
    return concatBytes(iv, ctWithTag);
  } finally {
    zeroize(blobMetaKey);
  }
}

/**
 * Spec §5.1 (8):
 * Decrypts `encryptedMeta` (`nonce(12B) || ciphertext || tag(16B)`) using `metaKey` and `blobId`.
 */
export async function decryptMeta<T = BlobPlaintextMeta>(
  metaKey: Uint8Array,
  blobId: string,
  encryptedMeta: Uint8Array,
  cryptoProvider: ZkCryptoProvider = defaultCryptoProvider
): Promise<T> {
  if (metaKey.byteLength !== 32) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'metaKey must be 32 bytes.');
  }
  if (encryptedMeta.byteLength < 12 + 16) {
    throw new ZkCryptoError(
      ZkErrorCode.TRUNCATED_BLOB,
      'encryptedMeta is shorter than minimum 28 bytes (12B nonce + 16B tag).'
    );
  }
  const canonicalBlobId = blobId.toLowerCase();
  const blobIdBytes = uuidToBytes(canonicalBlobId);
  const blobMetaKey = await cryptoProvider.hkdfSha256(
    metaKey,
    blobIdBytes,
    utf8Encode('photocloud/v2/blob-meta'),
    32
  );
  try {
    const iv = encryptedMeta.subarray(0, 12);
    const ctWithTag = encryptedMeta.subarray(12);
    const aad = utf8Encode(`meta|${canonicalBlobId}`);
    const ptBytes = await cryptoProvider.aes256GcmDecrypt(
      blobMetaKey,
      iv,
      ctWithTag,
      aad,
      ZkErrorCode.AUTH_TAG_MISMATCH
    );
    try {
      const jsonStr = utf8Decode(ptBytes);
      return JSON.parse(jsonStr) as T;
    } catch {
      throw new ZkCryptoError(ZkErrorCode.MALFORMED_HEADER, 'Decrypted metadata is not valid UTF-8 JSON.');
    } finally {
      zeroize(ptBytes);
    }
  } finally {
    zeroize(blobMetaKey);
  }
}

/**
 * Spec §5.3 (9):
 * Client-side thumbnail encryption (`320` or `1280` px variant).
 */
export async function encryptThumbnail(
  thumbKey: Uint8Array,
  blobId: string,
  variant: '320' | '1280',
  thumbPlaintext: Uint8Array,
  nonce?: Uint8Array,
  cryptoProvider: ZkCryptoProvider = defaultCryptoProvider
): Promise<Uint8Array> {
  if (thumbKey.byteLength !== 32) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'thumbKey must be 32 bytes.');
  }
  if (variant !== '320' && variant !== '1280') {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'Thumbnail variant must be "320" or "1280".');
  }
  const canonicalBlobId = blobId.toLowerCase();
  const blobIdBytes = uuidToBytes(canonicalBlobId);
  const blobThumbKey = await cryptoProvider.hkdfSha256(
    thumbKey,
    blobIdBytes,
    utf8Encode(`photocloud/v2/thumb/${variant}`),
    32
  );
  try {
    const iv = nonce ?? cryptoProvider.randomBytes(12);
    if (iv.byteLength !== 12) {
      throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'thumbnail nonce must be 12 bytes.');
    }
    const aad = utf8Encode(`thumb|${canonicalBlobId}|${variant}`);
    const ctWithTag = await cryptoProvider.aes256GcmEncrypt(blobThumbKey, iv, thumbPlaintext, aad);
    return concatBytes(iv, ctWithTag);
  } finally {
    zeroize(blobThumbKey);
  }
}

export async function decryptThumbnail(
  thumbKey: Uint8Array,
  blobId: string,
  variant: '320' | '1280',
  encryptedThumb: Uint8Array,
  cryptoProvider: ZkCryptoProvider = defaultCryptoProvider
): Promise<Uint8Array> {
  if (thumbKey.byteLength !== 32) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'thumbKey must be 32 bytes.');
  }
  if (variant !== '320' && variant !== '1280') {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'Thumbnail variant must be "320" or "1280".');
  }
  if (encryptedThumb.byteLength < 12 + 16) {
    throw new ZkCryptoError(ZkErrorCode.TRUNCATED_BLOB, 'encryptedThumb shorter than 28 bytes.');
  }
  const canonicalBlobId = blobId.toLowerCase();
  const blobIdBytes = uuidToBytes(canonicalBlobId);
  const blobThumbKey = await cryptoProvider.hkdfSha256(
    thumbKey,
    blobIdBytes,
    utf8Encode(`photocloud/v2/thumb/${variant}`),
    32
  );
  try {
    const iv = encryptedThumb.subarray(0, 12);
    const ctWithTag = encryptedThumb.subarray(12);
    const aad = utf8Encode(`thumb|${canonicalBlobId}|${variant}`);
    return await cryptoProvider.aes256GcmDecrypt(
      blobThumbKey,
      iv,
      ctWithTag,
      aad,
      ZkErrorCode.AUTH_TAG_MISMATCH
    );
  } finally {
    zeroize(blobThumbKey);
  }
}

/**
 * Spec §5.2 (8):
 * Encrypts the Album Catalog JSON with `albumCatalogKey = HKDF-SHA256(metaKey, UTF8(userId), "photocloud/v2/albums", 32)`
 * and `AAD = "albums|" + userId + "|" + revision`.
 * Binary layout: `uint32_be(revision) (4B) || nonce (12B) || ciphertext || tag (16B)`.
 */
export async function encryptAlbums(
  metaKey: Uint8Array,
  userId: string,
  catalog: AlbumCatalogPlaintext | string,
  revision: number,
  nonce?: Uint8Array,
  cryptoProvider: ZkCryptoProvider = defaultCryptoProvider
): Promise<Uint8Array> {
  if (metaKey.byteLength !== 32) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'metaKey must be 32 bytes.');
  }
  if (!Number.isInteger(revision) || revision < 1) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'Album catalog revision must be >= 1.');
  }
  const canonicalUserId = userId.toLowerCase();
  uuidToBytes(canonicalUserId);

  const albumCatalogKey = await cryptoProvider.hkdfSha256(
    metaKey,
    utf8Encode(canonicalUserId),
    utf8Encode('photocloud/v2/albums'),
    32
  );
  try {
    const iv = nonce ?? cryptoProvider.randomBytes(12);
    if (iv.byteLength !== 12) {
      throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'albums nonce must be 12 bytes.');
    }
    const jsonStr = typeof catalog === 'string' ? catalog : JSON.stringify(catalog);
    const ptBytes = utf8Encode(jsonStr);
    const aad = utf8Encode(`albums|${canonicalUserId}|${revision}`);
    const ctWithTag = await cryptoProvider.aes256GcmEncrypt(albumCatalogKey, iv, ptBytes, aad);
    zeroize(ptBytes);

    const revPrefix = new Uint8Array(4);
    new DataView(revPrefix.buffer).setUint32(0, revision >>> 0, false);
    return concatBytes(revPrefix, iv, ctWithTag);
  } finally {
    zeroize(albumCatalogKey);
  }
}

export async function decryptAlbums(
  metaKey: Uint8Array,
  userId: string,
  encryptedPayload: Uint8Array,
  cryptoProvider: ZkCryptoProvider = defaultCryptoProvider
): Promise<{ revision: number; catalog: AlbumCatalogPlaintext }> {
  if (metaKey.byteLength !== 32) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'metaKey must be 32 bytes.');
  }
  if (encryptedPayload.byteLength < 4 + 12 + 16) {
    throw new ZkCryptoError(ZkErrorCode.TRUNCATED_BLOB, 'Encrypted album payload shorter than 32 bytes.');
  }
  const canonicalUserId = userId.toLowerCase();
  uuidToBytes(canonicalUserId);

  const dv = new DataView(
    encryptedPayload.buffer,
    encryptedPayload.byteOffset,
    encryptedPayload.byteLength
  );
  const revision = dv.getUint32(0, false);
  if (revision < 1) {
    throw new ZkCryptoError(ZkErrorCode.MALFORMED_HEADER, 'Invalid album catalog revision 0.');
  }

  const albumCatalogKey = await cryptoProvider.hkdfSha256(
    metaKey,
    utf8Encode(canonicalUserId),
    utf8Encode('photocloud/v2/albums'),
    32
  );
  try {
    const iv = encryptedPayload.subarray(4, 16);
    const ctWithTag = encryptedPayload.subarray(16);
    const aad = utf8Encode(`albums|${canonicalUserId}|${revision}`);
    const ptBytes = await cryptoProvider.aes256GcmDecrypt(
      albumCatalogKey,
      iv,
      ctWithTag,
      aad,
      ZkErrorCode.AUTH_TAG_MISMATCH
    );
    try {
      const catalog = JSON.parse(utf8Decode(ptBytes)) as AlbumCatalogPlaintext;
      return { revision, catalog };
    } finally {
      zeroize(ptBytes);
    }
  } finally {
    zeroize(albumCatalogKey);
  }
}
