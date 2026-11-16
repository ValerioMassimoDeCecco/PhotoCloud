import { ZkCryptoError, ZkErrorCode } from './errors.ts';
import { unwrapFileKey, wrapFileKey } from './kdf.ts';
import { defaultCryptoProvider, type ZkCryptoProvider } from './provider.ts';
import {
  bytesToUuid,
  concatBytes,
  constantTimeEqual,
  toBase64Url,
  toHex,
  uuidToBytes,
  zeroize,
} from './zeroize.ts';

export const PCZK_MAGIC = new Uint8Array([0x50, 0x43, 0x5a, 0x4b]); // "PCZK"
export const PCZK_VERSION_V1 = 0x01;
export const PCZK_HEADER_LENGTH = 86;
export const PCZK_GCM_TAG_LENGTH = 16;
export const PCZK_MIN_BLOB_LENGTH = PCZK_HEADER_LENGTH + PCZK_GCM_TAG_LENGTH; // 102 bytes
export const DEFAULT_CHUNK_SIZE_LOG2 = 20; // 2^20 = 1 MiB

export type ByteStreamSource =
  | AsyncIterable<Uint8Array>
  | Iterable<Uint8Array>
  | ReadableStream<Uint8Array>
  | Uint8Array;

export interface ParsedPczkHeader {
  magic: string;
  version: number;
  chunkSizeLog2: number;
  chunkPlaintextSize: number;
  chunkCiphertextSize: number;
  blobId: string;
  blobIdBytes: Uint8Array;
  noncePrefix: Uint8Array;
  wrappedFk: Uint8Array;
  rawHeader: Uint8Array;
}

export interface EncryptBlobStreamOptions {
  fkWrapKey: Uint8Array;
  blobId: string;
  fileKey?: Uint8Array;
  fkWrapNonce?: Uint8Array;
  noncePrefix?: Uint8Array;
  chunkSizeLog2?: number;
  dedupKey?: Uint8Array;
  cryptoProvider?: ZkCryptoProvider;
  onProgress?: (info: { chunkIndex: number; plaintextBytesProcessed: number }) => void;
}

export interface EncryptBlobStreamResult {
  blobId: string;
  chunkSizeLog2: number;
  totalPlaintextBytes: number;
  totalCiphertextBytes: number;
  chunkCount: number;
  headerBytes: Uint8Array;
  headerSha256Hex: string;
  ciphertextSha256Hex: string;
  dedupTagB64u?: string;
  dedupTagHex?: string;
}

export interface DecryptBlobStreamOptions {
  fkWrapKey?: Uint8Array;
  unwrappedFileKey?: Uint8Array;
  expectedBlobId?: string;
  expectedTotalCiphertextBytes?: number;
  cryptoProvider?: ZkCryptoProvider;
}

export interface DecryptBlobStreamResult {
  header: ParsedPczkHeader;
  totalPlaintextBytes: number;
  chunkCount: number;
}

export interface ChunkRangeDescriptor {
  chunkIndex: number;
  isLast: boolean;
  ciphertextStartInBlob: number;
  ciphertextEndInclusiveInBlob: number;
  ciphertextOffsetInSlice: number;
  ciphertextLength: number;
  plaintextStartInBlob: number;
  plaintextEndInclusiveInBlob: number;
}

export interface BlobRangePlan {
  totalCiphertextBytes: number;
  totalPlaintextBytes: number;
  chunkSizeLog2: number;
  chunkPlaintextSize: number;
  chunkCiphertextSize: number;
  totalChunks: number;
  startPlaintextByte: number;
  endPlaintextByteInclusive: number;
  startChunkIndex: number;
  endChunkIndex: number;
  ciphertextStartByte: number;
  ciphertextEndByteInclusive: number;
  chunks: ChunkRangeDescriptor[];
}

export interface DecryptBlobRangeOptions {
  headerBytes: Uint8Array;
  totalCiphertextBytes: number;
  startPlaintextByte: number;
  endPlaintextByteInclusive: number;
  fkWrapKey?: Uint8Array;
  unwrappedFileKey?: Uint8Array;
  expectedBlobId?: string;
  ciphertextSlice?: Uint8Array;
  fetchCiphertextRange?: (startByte: number, endByteInclusive: number) => Promise<Uint8Array>;
  cryptoProvider?: ZkCryptoProvider;
}

async function* normalizeByteStream(source: ByteStreamSource): AsyncGenerator<Uint8Array, void, void> {
  if (source instanceof Uint8Array) {
    if (source.byteLength > 0) {
      yield source;
    }
    return;
  }
  if (typeof ReadableStream !== 'undefined' && source instanceof ReadableStream) {
    const reader = source.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) {
          yield value;
        }
      }
    } finally {
      reader.releaseLock();
    }
    return;
  }
  if (Symbol.asyncIterator in source) {
    for await (const chunk of source as AsyncIterable<Uint8Array>) {
      if (chunk && chunk.byteLength > 0) {
        yield chunk;
      }
    }
    return;
  }
  if (Symbol.iterator in source) {
    for (const chunk of source as Iterable<Uint8Array>) {
      if (chunk && chunk.byteLength > 0) {
        yield chunk;
      }
    }
    return;
  }
  throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'Unsupported stream source type.');
}

export function buildChunkNonce(noncePrefix: Uint8Array, chunkIndex: number): Uint8Array {
  if (noncePrefix.byteLength !== 4) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'noncePrefix must be 4 bytes.');
  }
  const nonce = new Uint8Array(12);
  nonce.set(noncePrefix, 0);
  const view = new DataView(nonce.buffer);
  view.setBigUint64(4, BigInt(chunkIndex), false); // big-endian u64
  return nonce;
}

export function buildChunkAad(headerSha256: Uint8Array, isLast: boolean): Uint8Array {
  if (headerSha256.byteLength !== 32) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'headerSha256 must be 32 bytes.');
  }
  const aad = new Uint8Array(33);
  aad.set(headerSha256, 0);
  aad[32] = isLast ? 0x01 : 0x00;
  return aad;
}

export function serializePczkHeader(params: {
  chunkSizeLog2: number;
  blobIdBytes: Uint8Array;
  noncePrefix: Uint8Array;
  wrappedFk: Uint8Array;
}): Uint8Array {
  const { chunkSizeLog2, blobIdBytes, noncePrefix, wrappedFk } = params;
  if (!Number.isInteger(chunkSizeLog2) || chunkSizeLog2 < 16 || chunkSizeLog2 > 24) {
    throw new ZkCryptoError(
      ZkErrorCode.MALFORMED_HEADER,
      `Invalid chunkSizeLog2 (${chunkSizeLog2}): must be between 16 and 24.`
    );
  }
  if (blobIdBytes.byteLength !== 16) {
    throw new ZkCryptoError(ZkErrorCode.MALFORMED_HEADER, 'blobIdBytes must be 16 bytes.');
  }
  if (noncePrefix.byteLength !== 4) {
    throw new ZkCryptoError(ZkErrorCode.MALFORMED_HEADER, 'noncePrefix must be 4 bytes.');
  }
  if (wrappedFk.byteLength !== 60) {
    throw new ZkCryptoError(ZkErrorCode.MALFORMED_HEADER, 'wrappedFk must be 60 bytes.');
  }

  const header = new Uint8Array(PCZK_HEADER_LENGTH);
  header.set(PCZK_MAGIC, 0);
  header[4] = PCZK_VERSION_V1;
  header[5] = chunkSizeLog2;
  header.set(blobIdBytes, 6);
  header.set(noncePrefix, 22);
  header.set(wrappedFk, 26);
  return header;
}

export function parsePczkHeader(headerBytes: Uint8Array): ParsedPczkHeader {
  if (headerBytes.byteLength < PCZK_HEADER_LENGTH) {
    throw new ZkCryptoError(
      ZkErrorCode.TRUNCATED_BLOB,
      `PCZK header truncated: expected at least ${PCZK_HEADER_LENGTH} bytes, got ${headerBytes.byteLength}.`
    );
  }
  const rawHeader = new Uint8Array(headerBytes.subarray(0, PCZK_HEADER_LENGTH));
  if (
    rawHeader[0] !== PCZK_MAGIC[0] ||
    rawHeader[1] !== PCZK_MAGIC[1] ||
    rawHeader[2] !== PCZK_MAGIC[2] ||
    rawHeader[3] !== PCZK_MAGIC[3]
  ) {
    throw new ZkCryptoError(ZkErrorCode.MALFORMED_HEADER, 'Invalid PCZK magic bytes.');
  }
  const version = rawHeader[4];
  if (version !== PCZK_VERSION_V1) {
    throw new ZkCryptoError(
      ZkErrorCode.UNSUPPORTED_VERSION,
      `Unsupported PCZK format version: ${version}.`
    );
  }
  const chunkSizeLog2 = rawHeader[5];
  if (chunkSizeLog2 < 16 || chunkSizeLog2 > 24) {
    throw new ZkCryptoError(
      ZkErrorCode.MALFORMED_HEADER,
      `Invalid PCZK chunkSizeLog2: ${chunkSizeLog2} (allowed: 16..24).`
    );
  }

  const chunkPlaintextSize = 1 << chunkSizeLog2;
  const chunkCiphertextSize = chunkPlaintextSize + PCZK_GCM_TAG_LENGTH;
  const blobIdBytes = new Uint8Array(rawHeader.subarray(6, 22));
  const blobId = bytesToUuid(blobIdBytes);
  const noncePrefix = new Uint8Array(rawHeader.subarray(22, 26));
  const wrappedFk = new Uint8Array(rawHeader.subarray(26, 86));

  return {
    magic: 'PCZK',
    version,
    chunkSizeLog2,
    chunkPlaintextSize,
    chunkCiphertextSize,
    blobId,
    blobIdBytes,
    noncePrefix,
    wrappedFk,
    rawHeader,
  };
}

/**
 * Constant-memory streaming blob encryption (`PCZK` v1).
 *
 * Yields:
 * 1. The 86-byte `PCZK` v1 header
 * 2. Encrypted chunks (`ciphertext || 16B tag`) one by one.
 *
 * Guarantees at least one chunk even for 0-byte empty inputs, and zeroizes
 * `fileKey` and the internal chunk buffer in `finally`.
 */
export async function* encryptBlobStream(
  source: ByteStreamSource,
  options: EncryptBlobStreamOptions
): AsyncGenerator<Uint8Array, EncryptBlobStreamResult, void> {
  const {
    fkWrapKey,
    blobId,
    fkWrapNonce,
    chunkSizeLog2 = DEFAULT_CHUNK_SIZE_LOG2,
    dedupKey,
    cryptoProvider = defaultCryptoProvider,
    onProgress,
  } = options;

  if (!Number.isInteger(chunkSizeLog2) || chunkSizeLog2 < 16 || chunkSizeLog2 > 24) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'chunkSizeLog2 must be in range 16..24.');
  }

  const blobIdBytes = uuidToBytes(blobId);
  const fileKey = options.fileKey
    ? new Uint8Array(options.fileKey)
    : cryptoProvider.randomBytes(32);
  const noncePrefix = options.noncePrefix
    ? new Uint8Array(options.noncePrefix)
    : cryptoProvider.randomBytes(4);

  if (fileKey.byteLength !== 32) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'fileKey must be 32 bytes.');
  }
  if (noncePrefix.byteLength !== 4) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'noncePrefix must be 4 bytes.');
  }

  const chunkSize = 1 << chunkSizeLog2;
  const activeBuf = new Uint8Array(chunkSize);
  let activeLen = 0;
  let pendingFullChunk: Uint8Array | null = null;

  const ctHasher = cryptoProvider.createSha256Stream();
  const dedupMac = dedupKey ? cryptoProvider.createHmacSha256Stream(dedupKey) : null;

  try {
    const wrappedFk = await wrapFileKey(fkWrapKey, fileKey, blobIdBytes, fkWrapNonce, cryptoProvider);
    const header = serializePczkHeader({
      chunkSizeLog2,
      blobIdBytes,
      noncePrefix,
      wrappedFk,
    });
    const headerSha256 = await cryptoProvider.sha256(header);

    ctHasher.update(header);
    yield header;

    let chunkIndex = 0;
    let totalPlaintextBytes = 0;
    let totalCiphertextBytes = header.byteLength;

    const encryptAndEmitChunk = async (ptChunk: Uint8Array, isLast: boolean): Promise<Uint8Array> => {
      const nonce = buildChunkNonce(noncePrefix, chunkIndex);
      const aad = buildChunkAad(headerSha256, isLast);
      const encryptedChunk = await cryptoProvider.aes256GcmEncrypt(fileKey, nonce, ptChunk, aad);
      zeroize(nonce, aad);
      ctHasher.update(encryptedChunk);
      totalCiphertextBytes += encryptedChunk.byteLength;
      chunkIndex++;
      if (onProgress) {
        onProgress({ chunkIndex, plaintextBytesProcessed: totalPlaintextBytes });
      }
      return encryptedChunk;
    };

    for await (const incoming of normalizeByteStream(source)) {
      // Update streaming dedup HMAC in 64 KiB slices
      if (dedupMac) {
        for (let off = 0; off < incoming.byteLength; off += 65536) {
          dedupMac.update(incoming.subarray(off, Math.min(incoming.byteLength, off + 65536)));
        }
      }
      totalPlaintextBytes += incoming.byteLength;

      let inOffset = 0;
      while (inOffset < incoming.byteLength) {
        // Because incoming has at least 1 unread byte (`inOffset < incoming.byteLength`),
        // any `pendingFullChunk` is guaranteed NOT to be the last chunk (`isLast = false`)!
        if (pendingFullChunk !== null) {
          const outChunk = await encryptAndEmitChunk(pendingFullChunk, false);
          zeroize(pendingFullChunk);
          pendingFullChunk = null;
          yield outChunk;
        }

        const space = chunkSize - activeLen;
        const take = Math.min(space, incoming.byteLength - inOffset);
        activeBuf.set(incoming.subarray(inOffset, inOffset + take), activeLen);
        activeLen += take;
        inOffset += take;

        if (activeLen === chunkSize) {
          pendingFullChunk = new Uint8Array(activeBuf);
          activeLen = 0;
        }
      }
    }

    // Stream has ended: emit the final chunk with `isLast = true`.
    // Note: if the input was 0 bytes, both `pendingFullChunk === null` and `activeLen === 0`,
    // so we emit 1 empty chunk (`new Uint8Array(0)`) with `isLast = true` per Spec §4.2!
    if (pendingFullChunk !== null) {
      const lastChunk = await encryptAndEmitChunk(pendingFullChunk, true);
      zeroize(pendingFullChunk);
      pendingFullChunk = null;
      yield lastChunk;
    } else {
      const finalPt = activeBuf.subarray(0, activeLen);
      const lastChunk = await encryptAndEmitChunk(finalPt, true);
      yield lastChunk;
    }

    const ctSha256 = ctHasher.digest();
    const dedupDigest = dedupMac ? dedupMac.digest() : undefined;

    return {
      blobId: bytesToUuid(blobIdBytes),
      chunkSizeLog2,
      totalPlaintextBytes,
      totalCiphertextBytes,
      chunkCount: chunkIndex,
      headerBytes: header,
      headerSha256Hex: toHex(headerSha256),
      ciphertextSha256Hex: toHex(ctSha256),
      dedupTagB64u: dedupDigest ? toBase64Url(dedupDigest) : undefined,
      dedupTagHex: dedupDigest ? toHex(dedupDigest) : undefined,
    };
  } finally {
    zeroize(fileKey, activeBuf, pendingFullChunk);
  }
}

/**
 * Helper to collect an `encryptBlobStream` into a single `Uint8Array` + metadata
 * (for small/medium blobs or test vectors).
 */
export async function encryptBlobToBytes(
  source: ByteStreamSource,
  options: EncryptBlobStreamOptions
): Promise<{ ciphertext: Uint8Array; result: EncryptBlobStreamResult }> {
  const gen = encryptBlobStream(source, options);
  const parts: Uint8Array[] = [];
  while (true) {
    const step = await gen.next();
    if (step.done) {
      return {
        ciphertext: concatBytes(...parts),
        result: step.value,
      };
    }
    parts.push(step.value);
  }
}

/**
 * Constant-memory streaming blob decryption (`PCZK` v1).
 *
 * Security Invariants:
 * - Never buffers more than 1 encrypted chunk (`2^chunkSizeLog2 + 16` bytes + 1 lookahead byte).
 * - Authenticates each chunk's AES-256-GCM tag (`AAD = SHA256(header) || isLast`) BEFORE yielding
 *   a single byte of that chunk's plaintext.
 * - Detects truncation at exact chunk boundaries: if a multi-chunk stream is cut right after
 *   a non-final chunk (`isLast = 0x00`), EOF forces verification of that chunk with `isLast = 0x01`,
 *   which fails GCM authentication and throws before emitting any bytes from that chunk.
 */
export async function* decryptBlobStream(
  source: ByteStreamSource,
  options: DecryptBlobStreamOptions
): AsyncGenerator<Uint8Array, DecryptBlobStreamResult, void> {
  const {
    fkWrapKey,
    unwrappedFileKey,
    expectedBlobId,
    expectedTotalCiphertextBytes,
    cryptoProvider = defaultCryptoProvider,
  } = options;

  if (!fkWrapKey && !unwrappedFileKey) {
    throw new ZkCryptoError(
      ZkErrorCode.INVALID_PARAMETER,
      'Either fkWrapKey or unwrappedFileKey must be provided.'
    );
  }

  if (
    expectedTotalCiphertextBytes !== undefined &&
    expectedTotalCiphertextBytes < PCZK_MIN_BLOB_LENGTH
  ) {
    throw new ZkCryptoError(
      ZkErrorCode.TRUNCATED_BLOB,
      `Total ciphertext length (${expectedTotalCiphertextBytes}) is shorter than minimum PCZK blob (${PCZK_MIN_BLOB_LENGTH}).`
    );
  }

  const iterator = normalizeByteStream(source)[Symbol.asyncIterator]();
  let pendingSlice: Uint8Array = new Uint8Array(0);
  let streamEnded = false;
  let totalBytesRead = 0;

  async function fillBytes(targetLength: number): Promise<Uint8Array> {
    const out = new Uint8Array(targetLength);
    let filled = 0;

    while (filled < targetLength) {
      if (pendingSlice.byteLength > 0) {
        const take = Math.min(pendingSlice.byteLength, targetLength - filled);
        out.set(pendingSlice.subarray(0, take), filled);
        filled += take;
        pendingSlice = pendingSlice.subarray(take);
      } else if (!streamEnded) {
        const next = await iterator.next();
        if (next.done || !next.value) {
          streamEnded = true;
          break;
        }
        totalBytesRead += next.value.byteLength;
        pendingSlice = next.value;
      } else {
        break;
      }
    }
    return filled === targetLength ? out : out.subarray(0, filled);
  }

  async function hasMoreBytes(): Promise<boolean> {
    while (pendingSlice.byteLength === 0 && !streamEnded) {
      const next = await iterator.next();
      if (next.done || !next.value) {
        streamEnded = true;
        return false;
      }
      totalBytesRead += next.value.byteLength;
      pendingSlice = next.value;
    }
    return pendingSlice.byteLength > 0;
  }

  let fileKey: Uint8Array | null = null;

  try {
    const headerBuf = await fillBytes(PCZK_HEADER_LENGTH);
    if (headerBuf.byteLength < PCZK_HEADER_LENGTH) {
      throw new ZkCryptoError(
        ZkErrorCode.TRUNCATED_BLOB,
        `Truncated PCZK header: got ${headerBuf.byteLength} bytes, expected ${PCZK_HEADER_LENGTH}.`
      );
    }

    const header = parsePczkHeader(headerBuf);

    if (expectedBlobId !== undefined) {
      const expectedBytes = uuidToBytes(expectedBlobId);
      if (!constantTimeEqual(header.blobIdBytes, expectedBytes)) {
        throw new ZkCryptoError(
          ZkErrorCode.WRONG_KEY_OR_PASSPHRASE,
          'Blob header blobId does not match expectedBlobId.'
        );
      }
    }

    if (unwrappedFileKey) {
      if (unwrappedFileKey.byteLength !== 32) {
        throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'unwrappedFileKey must be 32 bytes.');
      }
      fileKey = new Uint8Array(unwrappedFileKey);
    } else if (fkWrapKey) {
      fileKey = await unwrapFileKey(
        fkWrapKey,
        header.wrappedFk,
        header.blobIdBytes,
        cryptoProvider
      );
    } else {
      throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'Missing file key unwrap material.');
    }

    const headerSha256 = await cryptoProvider.sha256(header.rawHeader);
    const maxChunkCtSize = header.chunkCiphertextSize;

    let chunkIndex = 0;
    let totalPlaintextBytes = 0;

    while (true) {
      const chunkCt = await fillBytes(maxChunkCtSize);
      if (chunkCt.byteLength === 0) {
        if (chunkIndex === 0) {
          throw new ZkCryptoError(
            ZkErrorCode.TRUNCATED_BLOB,
            'PCZK blob contains header but zero chunks.'
          );
        }
        break;
      }

      if (chunkCt.byteLength < PCZK_GCM_TAG_LENGTH) {
        throw new ZkCryptoError(
          ZkErrorCode.TRUNCATED_BLOB,
          `Truncated PCZK chunk ${chunkIndex}: length ${chunkCt.byteLength} < ${PCZK_GCM_TAG_LENGTH}.`
        );
      }

      const moreFollows = await hasMoreBytes();
      const isLast = !moreFollows;

      if (!isLast && chunkCt.byteLength !== maxChunkCtSize) {
        throw new ZkCryptoError(
          ZkErrorCode.TRUNCATED_BLOB,
          `Non-final chunk ${chunkIndex} has incomplete size ${chunkCt.byteLength}.`
        );
      }

      // Empty 0-byte chunk (`chunkCt.byteLength === 16`) is ONLY legal when `chunkIndex === 0 && isLast === true`.
      if (chunkCt.byteLength === PCZK_GCM_TAG_LENGTH && (chunkIndex > 0 || !isLast)) {
        throw new ZkCryptoError(
          ZkErrorCode.TRUNCATED_BLOB,
          `Zero-byte trailing chunk at index ${chunkIndex} is invalid.`
        );
      }

      const nonce = buildChunkNonce(header.noncePrefix, chunkIndex);
      const aad = buildChunkAad(headerSha256, isLast);

      let plaintextChunk: Uint8Array;
      try {
        plaintextChunk = await cryptoProvider.aes256GcmDecrypt(
          fileKey,
          nonce,
          chunkCt,
          aad,
          ZkErrorCode.AUTH_TAG_MISMATCH
        );
      } finally {
        zeroize(nonce, aad);
      }

      totalPlaintextBytes += plaintextChunk.byteLength;
      chunkIndex++;

      if (plaintextChunk.byteLength > 0) {
        yield plaintextChunk;
      }

      if (isLast) {
        break;
      }
    }

    if (
      expectedTotalCiphertextBytes !== undefined &&
      totalBytesRead !== expectedTotalCiphertextBytes
    ) {
      throw new ZkCryptoError(
        ZkErrorCode.TRUNCATED_BLOB,
        `Ciphertext length mismatch: read ${totalBytesRead}, expected ${expectedTotalCiphertextBytes}.`
      );
    }

    return {
      header,
      totalPlaintextBytes,
      chunkCount: chunkIndex,
    };
  } finally {
    zeroize(fileKey);
  }
}

export async function decryptBlobToBytes(
  source: ByteStreamSource,
  options: DecryptBlobStreamOptions
): Promise<{ plaintext: Uint8Array; result: DecryptBlobStreamResult }> {
  const gen = decryptBlobStream(source, options);
  const parts: Uint8Array[] = [];
  while (true) {
    const step = await gen.next();
    if (step.done) {
      return {
        plaintext: concatBytes(...parts),
        result: step.value,
      };
    }
    parts.push(step.value);
  }
}

/**
 * Spec §4.3:
 * Computes the exact chunk indices and ciphertext byte offsets needed to satisfy
 * a random-access plaintext range `[startPlaintextByte, endPlaintextByteInclusive]`.
 */
export function computeBlobRangePlan(params: {
  totalCiphertextBytes: number;
  chunkSizeLog2: number;
  startPlaintextByte: number;
  endPlaintextByteInclusive: number;
}): BlobRangePlan {
  const {
    totalCiphertextBytes,
    chunkSizeLog2,
    startPlaintextByte,
    endPlaintextByteInclusive,
  } = params;

  if (!Number.isInteger(chunkSizeLog2) || chunkSizeLog2 < 16 || chunkSizeLog2 > 24) {
    throw new ZkCryptoError(ZkErrorCode.MALFORMED_HEADER, 'chunkSizeLog2 must be 16..24.');
  }
  if (totalCiphertextBytes < PCZK_MIN_BLOB_LENGTH) {
    throw new ZkCryptoError(
      ZkErrorCode.TRUNCATED_BLOB,
      `totalCiphertextBytes (${totalCiphertextBytes}) < ${PCZK_MIN_BLOB_LENGTH}.`
    );
  }

  const chunkPlaintextSize = 1 << chunkSizeLog2;
  const chunkCiphertextSize = chunkPlaintextSize + PCZK_GCM_TAG_LENGTH;
  const chunksPayloadBytes = totalCiphertextBytes - PCZK_HEADER_LENGTH;

  let totalChunks: number;
  let totalPlaintextBytes: number;

  if (chunksPayloadBytes === PCZK_GCM_TAG_LENGTH) {
    totalChunks = 1;
    totalPlaintextBytes = 0;
  } else {
    totalChunks = Math.ceil(chunksPayloadBytes / chunkCiphertextSize);
    const lastChunkCtLen = chunksPayloadBytes - (totalChunks - 1) * chunkCiphertextSize;
    if (lastChunkCtLen <= PCZK_GCM_TAG_LENGTH) {
      throw new ZkCryptoError(
        ZkErrorCode.TRUNCATED_BLOB,
        `Invalid final chunk ciphertext size (${lastChunkCtLen} bytes).`
      );
    }
    totalPlaintextBytes =
      (totalChunks - 1) * chunkPlaintextSize + (lastChunkCtLen - PCZK_GCM_TAG_LENGTH);
  }

  if (totalPlaintextBytes === 0) {
    throw new ZkCryptoError(
      ZkErrorCode.INVALID_PARAMETER,
      'Cannot request a byte range on an empty 0-byte blob.'
    );
  }
  if (
    !Number.isInteger(startPlaintextByte) ||
    !Number.isInteger(endPlaintextByteInclusive) ||
    startPlaintextByte < 0 ||
    endPlaintextByteInclusive < startPlaintextByte ||
    endPlaintextByteInclusive >= totalPlaintextBytes
  ) {
    throw new ZkCryptoError(
      ZkErrorCode.INVALID_PARAMETER,
      `Invalid plaintext range [${startPlaintextByte}..${endPlaintextByteInclusive}] for totalPlaintextBytes=${totalPlaintextBytes}.`
    );
  }

  const startChunkIndex = Math.floor(startPlaintextByte / chunkPlaintextSize);
  const endChunkIndex = Math.floor(endPlaintextByteInclusive / chunkPlaintextSize);

  const ciphertextStartByte = PCZK_HEADER_LENGTH + startChunkIndex * chunkCiphertextSize;
  const ciphertextEndByteInclusive = Math.min(
    totalCiphertextBytes - 1,
    PCZK_HEADER_LENGTH + (endChunkIndex + 1) * chunkCiphertextSize - 1
  );

  const chunks: ChunkRangeDescriptor[] = [];
  for (let idx = startChunkIndex; idx <= endChunkIndex; idx++) {
    const isLast = idx === totalChunks - 1;
    const ctStart = PCZK_HEADER_LENGTH + idx * chunkCiphertextSize;
    const ctEnd = isLast
      ? totalCiphertextBytes - 1
      : ctStart + chunkCiphertextSize - 1;
    const ctLen = ctEnd - ctStart + 1;
    const ptLen = ctLen - PCZK_GCM_TAG_LENGTH;
    const ptStart = idx * chunkPlaintextSize;
    const ptEnd = ptStart + ptLen - 1;

    chunks.push({
      chunkIndex: idx,
      isLast,
      ciphertextStartInBlob: ctStart,
      ciphertextEndInclusiveInBlob: ctEnd,
      ciphertextOffsetInSlice: ctStart - ciphertextStartByte,
      ciphertextLength: ctLen,
      plaintextStartInBlob: ptStart,
      plaintextEndInclusiveInBlob: ptEnd,
    });
  }

  return {
    totalCiphertextBytes,
    totalPlaintextBytes,
    chunkSizeLog2,
    chunkPlaintextSize,
    chunkCiphertextSize,
    totalChunks,
    startPlaintextByte,
    endPlaintextByteInclusive,
    startChunkIndex,
    endChunkIndex,
    ciphertextStartByte,
    ciphertextEndByteInclusive,
    chunks,
  };
}

/**
 * Spec §4.3:
 * Random-access authenticated range decryption for HTTP `Range` requests.
 * Authenticates every spanned chunk with its exact `chunkIndex` nonce and
 * `AAD = SHA256(header) || isLast` before slicing the requested plaintext range.
 */
export async function decryptBlobRange(options: DecryptBlobRangeOptions): Promise<Uint8Array> {
  const {
    headerBytes,
    totalCiphertextBytes,
    startPlaintextByte,
    endPlaintextByteInclusive,
    fkWrapKey,
    unwrappedFileKey,
    expectedBlobId,
    ciphertextSlice,
    fetchCiphertextRange,
    cryptoProvider = defaultCryptoProvider,
  } = options;

  const header = parsePczkHeader(headerBytes);

  if (expectedBlobId !== undefined) {
    const expectedBytes = uuidToBytes(expectedBlobId);
    if (!constantTimeEqual(header.blobIdBytes, expectedBytes)) {
      throw new ZkCryptoError(
        ZkErrorCode.WRONG_KEY_OR_PASSPHRASE,
        'Blob header blobId does not match expectedBlobId.'
      );
    }
  }

  const plan = computeBlobRangePlan({
    totalCiphertextBytes,
    chunkSizeLog2: header.chunkSizeLog2,
    startPlaintextByte,
    endPlaintextByteInclusive,
  });

  const expectedSliceLength = plan.ciphertextEndByteInclusive - plan.ciphertextStartByte + 1;
  let rangeSlice: Uint8Array;
  if (ciphertextSlice !== undefined) {
    rangeSlice = ciphertextSlice;
  } else if (fetchCiphertextRange) {
    rangeSlice = await fetchCiphertextRange(
      plan.ciphertextStartByte,
      plan.ciphertextEndByteInclusive
    );
  } else {
    throw new ZkCryptoError(
      ZkErrorCode.INVALID_PARAMETER,
      'Either ciphertextSlice or fetchCiphertextRange must be provided.'
    );
  }

  if (rangeSlice.byteLength < expectedSliceLength) {
    throw new ZkCryptoError(
      ZkErrorCode.TRUNCATED_BLOB,
      `Range ciphertext slice truncated: got ${rangeSlice.byteLength}, expected ${expectedSliceLength}.`
    );
  }

  let fileKey: Uint8Array | null = null;
  try {
    if (unwrappedFileKey) {
      if (unwrappedFileKey.byteLength !== 32) {
        throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'unwrappedFileKey must be 32 bytes.');
      }
      fileKey = new Uint8Array(unwrappedFileKey);
    } else if (fkWrapKey) {
      fileKey = await unwrapFileKey(
        fkWrapKey,
        header.wrappedFk,
        header.blobIdBytes,
        cryptoProvider
      );
    } else {
      throw new ZkCryptoError(
        ZkErrorCode.INVALID_PARAMETER,
        'Either fkWrapKey or unwrappedFileKey must be provided.'
      );
    }

    const headerSha256 = await cryptoProvider.sha256(header.rawHeader);
    const outputLength = endPlaintextByteInclusive - startPlaintextByte + 1;
    const output = new Uint8Array(outputLength);
    let outOffset = 0;

    for (const chunkDesc of plan.chunks) {
      const chunkCt = rangeSlice.subarray(
        chunkDesc.ciphertextOffsetInSlice,
        chunkDesc.ciphertextOffsetInSlice + chunkDesc.ciphertextLength
      );
      const nonce = buildChunkNonce(header.noncePrefix, chunkDesc.chunkIndex);
      const aad = buildChunkAad(headerSha256, chunkDesc.isLast);

      let chunkPt: Uint8Array;
      try {
        chunkPt = await cryptoProvider.aes256GcmDecrypt(
          fileKey,
          nonce,
          chunkCt,
          aad,
          ZkErrorCode.AUTH_TAG_MISMATCH
        );
      } finally {
        zeroize(nonce, aad);
      }

      const sliceStartInChunk = Math.max(
        0,
        startPlaintextByte - chunkDesc.plaintextStartInBlob
      );
      const sliceEndExclusiveInChunk = Math.min(
        chunkPt.byteLength,
        endPlaintextByteInclusive - chunkDesc.plaintextStartInBlob + 1
      );
      const subSlice = chunkPt.subarray(sliceStartInChunk, sliceEndExclusiveInChunk);
      output.set(subSlice, outOffset);
      outOffset += subSlice.byteLength;
      zeroize(chunkPt);
    }

    return output;
  } finally {
    zeroize(fileKey);
  }
}
