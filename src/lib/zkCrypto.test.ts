import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  blake2b,
  computeBlobRangePlan,
  computeDedupTag,
  concatBytes,
  constantTimeEqual,
  defaultArgon2idProvider,
  defaultCryptoProvider,
  decryptAlbums,
  decryptBlobRange,
  decryptBlobStream,
  decryptBlobToBytes,
  decryptMeta,
  decryptThumbnail,
  deriveKekAndAuthSecret,
  deriveRoot,
  deriveSubkeys,
  encryptAlbums,
  encryptBlobStream,
  encryptBlobToBytes,
  encryptMeta,
  encryptThumbnail,
  fromBase64Url,
  fromHex,
  IncrementalSha256,
  parsePczkHeader,
  PCZK_HEADER_LENGTH,
  toBase64Url,
  toHex,
  unwrapFileKey,
  unwrapFileKeyForShare,
  unwrapVaultKey,
  utf8Decode,
  utf8Encode,
  wrapFileKey,
  wrapFileKeyForShare,
  wrapVaultKey,
  zeroize,
  ZkCryptoError,
  ZkErrorCode,
  ZkWorkerClient,
  type Argon2idProgress,
  type BlobPlaintextMeta,
} from './zk/index.ts';

const REPO_ROOT = process.cwd();
const VECTORS_PATH = path.join(REPO_ROOT, 'test-vectors', 'zk-v1.json');
const VECTORS = JSON.parse(fs.readFileSync(VECTORS_PATH, 'utf-8'));

test('RFC 5869 (HKDF-SHA256) official test vectors pass', async () => {
  for (const tc of VECTORS.rfc5869HkdfSha256) {
    const ikm = fromHex(tc.ikmHex);
    const salt = fromHex(tc.saltHex);
    const info = fromHex(tc.infoHex);
    const okm = await defaultCryptoProvider.hkdfSha256(ikm, salt, info, tc.length);
    assert.equal(toHex(okm), tc.expectedOkmHex, `Failed ${tc.name}`);
  }
});

test('RFC 9106 §5.3 (Argon2id) official test vector passes', async () => {
  const s = VECTORS.rfc9106SelfCheck;
  const tag = await defaultArgon2idProvider.derive(
    fromHex(s.passwordHex),
    fromHex(s.saltHex),
    {
      memoryKiB: s.mKiB,
      iterations: s.t,
      parallelism: s.p,
      hashLength: s.tagLen,
    },
    {
      secret: fromHex(s.secretHex),
      associatedData: fromHex(s.associatedDataHex),
    }
  );
  assert.equal(toHex(tag), s.expectedTagHex);
});

test('Zero-Knowledge v2 key hierarchy vectors: withPassphraseFast, withPassphraseSpec (64 MiB), and withoutPassphrase', async () => {
  const accountKey = fromHex(VECTORS.inputs.accountKeyHex);
  const userSalt = fromHex(VECTORS.inputs.userSaltHex);
  const passphrase: string = VECTORS.inputs.passphraseUtf8;

  // 1. Fast profile (m=1024 KiB, t=2, p=1)
  const rootFast = await deriveRoot({
    accountKey,
    userSalt,
    passphrase,
    argon2Params: VECTORS.inputs.argon2FastParams,
  });
  assert.equal(toHex(rootFast), VECTORS.keyHierarchy.withPassphraseFast.rootHex);
  assert.equal(toBase64Url(rootFast), VECTORS.keyHierarchy.withPassphraseFast.rootB64u);

  const keysFast = await deriveKekAndAuthSecret(rootFast);
  assert.equal(toHex(keysFast.kek), VECTORS.keyHierarchy.withPassphraseFast.kekHex);
  assert.equal(toHex(keysFast.authSecret), VECTORS.keyHierarchy.withPassphraseFast.authSecretHex);

  // 2. Without passphrase (32 zero bytes)
  const rootNoPass = await deriveRoot({
    accountKey,
    userSalt,
    passphrase: null,
  });
  assert.equal(toHex(rootNoPass), VECTORS.keyHierarchy.withoutPassphrase.rootHex);
  const keysNoPass = await deriveKekAndAuthSecret(rootNoPass);
  assert.equal(toHex(keysNoPass.kek), VECTORS.keyHierarchy.withoutPassphrase.kekHex);
  assert.equal(toHex(keysNoPass.authSecret), VECTORS.keyHierarchy.withoutPassphrase.authSecretHex);

  // 3. Full production Spec profile (m=65536 KiB [64 MiB], t=3, p=1)
  const progressEvents: Argon2idProgress[] = [];
  const rootSpec = await deriveRoot({
    accountKey,
    userSalt,
    passphrase,
    argon2Params: VECTORS.inputs.argon2SpecParams,
    onProgress: (p) => progressEvents.push(p),
  });
  assert.equal(progressEvents.length, 12); // t=3 * 4 slices = 12 steps
  assert.equal(progressEvents[progressEvents.length - 1].percent, 100);
  assert.equal(toHex(rootSpec), VECTORS.keyHierarchy.withPassphraseSpec.rootHex);

  const keysSpec = await deriveKekAndAuthSecret(rootSpec);
  assert.equal(toHex(keysSpec.kek), VECTORS.keyHierarchy.withPassphraseSpec.kekHex);
  assert.equal(toHex(keysSpec.authSecret), VECTORS.keyHierarchy.withPassphraseSpec.authSecretHex);

  keysFast.zeroizeAll();
  keysNoPass.zeroizeAll();
  keysSpec.zeroizeAll();
});

test('Vault Key (VK) wrap/unwrap, subkeys derivation, File Key (FK) wrap/unwrap, and Share FK wrap/unwrap match test vectors', async () => {
  const userId: string = VECTORS.inputs.userId;
  const vk = fromHex(VECTORS.vaultKeyAndSubkeys.vaultKeyHex);
  const vkNonce = fromHex(VECTORS.vaultKeyAndSubkeys.vkWrapNonceHex);
  const kekSpec = fromHex(VECTORS.keyHierarchy.withPassphraseSpec.kekHex);
  const kekFast = fromHex(VECTORS.keyHierarchy.withPassphraseFast.kekHex);
  const kekNoPass = fromHex(VECTORS.keyHierarchy.withoutPassphrase.kekHex);

  const wrappedVkSpec = await wrapVaultKey(kekSpec, vk, userId, vkNonce);
  assert.equal(toHex(wrappedVkSpec), VECTORS.vaultKeyAndSubkeys.wrappedVkSpecHex);
  assert.equal(toBase64Url(wrappedVkSpec), VECTORS.vaultKeyAndSubkeys.wrappedVkSpecB64u);

  const unwrappedVkSpec = await unwrapVaultKey(kekSpec, wrappedVkSpec, userId);
  assert.equal(toHex(unwrappedVkSpec), VECTORS.vaultKeyAndSubkeys.vaultKeyHex);

  const wrappedVkFast = await wrapVaultKey(kekFast, vk, userId, vkNonce);
  assert.equal(toHex(wrappedVkFast), VECTORS.vaultKeyAndSubkeys.wrappedVkFastHex);

  const wrappedVkNoPass = await wrapVaultKey(kekNoPass, vk, userId, vkNonce);
  assert.equal(toHex(wrappedVkNoPass), VECTORS.vaultKeyAndSubkeys.wrappedVkNoPassHex);

  const subkeys = await deriveSubkeys(vk);
  assert.equal(toHex(subkeys.metaKey), VECTORS.vaultKeyAndSubkeys.subkeys.metaKeyHex);
  assert.equal(toHex(subkeys.thumbKey), VECTORS.vaultKeyAndSubkeys.subkeys.thumbKeyHex);
  assert.equal(toHex(subkeys.dedupKey), VECTORS.vaultKeyAndSubkeys.subkeys.dedupKeyHex);
  assert.equal(toHex(subkeys.fkWrapKey), VECTORS.vaultKeyAndSubkeys.subkeys.fkWrapKeyHex);

  // File Key (FK) wrap/unwrap
  const blobId: string = VECTORS.fileKeyWrap.blobId;
  const fk = fromHex(VECTORS.fileKeyWrap.fileKeyHex);
  const fkNonce = fromHex(VECTORS.fileKeyWrap.fkWrapNonceHex);
  const wrappedFk = await wrapFileKey(subkeys.fkWrapKey, fk, blobId, fkNonce);
  assert.equal(toHex(wrappedFk), VECTORS.fileKeyWrap.wrappedFkHex);

  const unwrappedFk = await unwrapFileKey(subkeys.fkWrapKey, wrappedFk, blobId);
  assert.equal(toHex(unwrappedFk), VECTORS.fileKeyWrap.fileKeyHex);

  // Share FK wrap/unwrap
  const shareId: string = VECTORS.sharing.shareId;
  const shareKey = fromHex(VECTORS.sharing.shareKeyHex);
  const shareFkNonce = fromHex(VECTORS.sharing.shareFkNonceHex);
  const shareWrappedFk = await wrapFileKeyForShare(shareKey, fk, shareId, blobId, shareFkNonce);
  assert.equal(toHex(shareWrappedFk), VECTORS.sharing.shareWrappedFkHex);

  const shareUnwrappedFk = await unwrapFileKeyForShare(shareKey, shareWrappedFk, shareId, blobId);
  assert.equal(toHex(shareUnwrappedFk), VECTORS.fileKeyWrap.fileKeyHex);

  subkeys.zeroizeAll();
});

test('PCZK v1 blobs match test vectors and Python-generated binary .pczk interoperability fixtures', async () => {
  const fkWrapKey = fromHex(VECTORS.vaultKeyAndSubkeys.subkeys.fkWrapKeyHex);
  const dedupKey = fromHex(VECTORS.vaultKeyAndSubkeys.subkeys.dedupKeyHex);
  const fk = fromHex(VECTORS.fileKeyWrap.fileKeyHex);
  const fkWrapNonce = fromHex(VECTORS.fileKeyWrap.fkWrapNonceHex);
  const blobId: string = VECTORS.fileKeyWrap.blobId;
  const noncePrefix = fromHex(VECTORS.pczkBlobs.noncePrefixHex);

  // 1. Empty 0-byte file
  const emptyEnc = await encryptBlobToBytes(new Uint8Array(0), {
    fkWrapKey,
    blobId,
    fileKey: fk,
    fkWrapNonce,
    noncePrefix,
    chunkSizeLog2: 20,
  });
  assert.equal(emptyEnc.ciphertext.byteLength, 102);
  assert.equal(toHex(emptyEnc.ciphertext), VECTORS.pczkBlobs.emptyFile.fullBlobHex);
  assert.equal(emptyEnc.result.ciphertextSha256Hex, VECTORS.pczkBlobs.emptyFile.ciphertextSha256Hex);

  const pyEmptyFixture = new Uint8Array(
    fs.readFileSync(path.join(REPO_ROOT, VECTORS.pczkBlobs.emptyFile.fixtureFile))
  );
  assert.deepEqual(emptyEnc.ciphertext, pyEmptyFixture);

  const emptyDec = await decryptBlobToBytes(pyEmptyFixture, { fkWrapKey, expectedBlobId: blobId });
  assert.equal(emptyDec.plaintext.byteLength, 0);
  assert.equal(emptyDec.result.chunkCount, 1);

  // 2. Single-chunk 37-byte file
  const singlePt = utf8Encode(VECTORS.pczkBlobs.singleChunk.plaintextUtf8);
  const singleEnc = await encryptBlobToBytes(singlePt, {
    fkWrapKey,
    blobId,
    fileKey: fk,
    fkWrapNonce,
    noncePrefix,
    chunkSizeLog2: 20,
    dedupKey,
  });
  assert.equal(toHex(singleEnc.ciphertext), VECTORS.pczkBlobs.singleChunk.fullBlobHex);
  assert.equal(singleEnc.result.dedupTagHex, VECTORS.dedupTags.singleChunkPlaintextDedupTagHex);

  const pySingleFixture = new Uint8Array(
    fs.readFileSync(path.join(REPO_ROOT, VECTORS.pczkBlobs.singleChunk.fixtureFile))
  );
  assert.deepEqual(singleEnc.ciphertext, pySingleFixture);

  const singleDec = await decryptBlobToBytes(pySingleFixture, { fkWrapKey, expectedBlobId: blobId });
  assert.equal(utf8Decode(singleDec.plaintext), VECTORS.pczkBlobs.singleChunk.plaintextUtf8);

  // 3. Multi-chunk 150,000-byte file (chunkSizeLog2 = 16 -> 3 chunks)
  const multiPt = new Uint8Array(150000);
  for (let i = 0; i < multiPt.byteLength; i++) {
    multiPt[i] = (i * 31 + 17) & 0xff;
  }
  const multiEnc = await encryptBlobToBytes(multiPt, {
    fkWrapKey,
    blobId,
    fileKey: fk,
    fkWrapNonce,
    noncePrefix,
    chunkSizeLog2: 16,
    dedupKey,
  });
  assert.equal(multiEnc.result.chunkCount, 3);
  assert.equal(multiEnc.result.totalCiphertextBytes, VECTORS.pczkBlobs.multiChunk.totalCiphertextLength);
  assert.equal(multiEnc.result.ciphertextSha256Hex, VECTORS.pczkBlobs.multiChunk.ciphertextSha256Hex);
  assert.equal(multiEnc.result.dedupTagHex, VECTORS.dedupTags.multiChunkPlaintextDedupTagHex);

  const pyMultiFixture = new Uint8Array(
    fs.readFileSync(path.join(REPO_ROOT, VECTORS.pczkBlobs.multiChunk.fixtureFile))
  );
  assert.deepEqual(multiEnc.ciphertext, pyMultiFixture);

  const multiDec = await decryptBlobToBytes(pyMultiFixture, { fkWrapKey, expectedBlobId: blobId });
  assert.deepEqual(multiDec.plaintext, multiPt);
});

test('Encrypted metadata, thumbnail, album catalog, and streaming computeDedupTag match test vectors', async () => {
  const metaKey = fromHex(VECTORS.vaultKeyAndSubkeys.subkeys.metaKeyHex);
  const thumbKey = fromHex(VECTORS.vaultKeyAndSubkeys.subkeys.thumbKeyHex);
  const dedupKey = fromHex(VECTORS.vaultKeyAndSubkeys.subkeys.dedupKeyHex);
  const blobId: string = VECTORS.encryptedMetadata.blobId;
  const userId: string = VECTORS.encryptedAlbums.userId;

  // Metadata
  const metaNonce = fromHex(VECTORS.encryptedMetadata.nonceHex);
  const encMeta = await encryptMeta(
    metaKey,
    blobId,
    VECTORS.encryptedMetadata.plaintextJson,
    metaNonce
  );
  assert.equal(toHex(encMeta), VECTORS.encryptedMetadata.encryptedMetaHex);
  const decMeta = await decryptMeta<BlobPlaintextMeta>(metaKey, blobId, encMeta);
  assert.equal(decMeta.name, 'IMG_20261115_183000.jpg');
  assert.equal(decMeta.exifSubset?.model, 'Pixel 9 Pro');

  // Thumbnail 320px
  const thumbNonce = fromHex(VECTORS.encryptedThumbnail.nonceHex);
  const thumbPt = fromHex(VECTORS.encryptedThumbnail.plaintextHex);
  const encThumb = await encryptThumbnail(thumbKey, blobId, '320', thumbPt, thumbNonce);
  assert.equal(toHex(encThumb), VECTORS.encryptedThumbnail.encryptedThumbHex);
  const decThumb = await decryptThumbnail(thumbKey, blobId, '320', encThumb);
  assert.deepEqual(decThumb, thumbPt);

  // Albums
  const albumNonce = fromHex(VECTORS.encryptedAlbums.nonceHex);
  const encAlbums = await encryptAlbums(
    metaKey,
    userId,
    VECTORS.encryptedAlbums.plaintextJson,
    VECTORS.encryptedAlbums.revision,
    albumNonce
  );
  assert.equal(toHex(encAlbums), VECTORS.encryptedAlbums.payloadHex);
  const decAlbums = await decryptAlbums(metaKey, userId, encAlbums);
  assert.equal(decAlbums.revision, 1);
  assert.equal(decAlbums.catalog.albums[0].name, 'Vacanze Estate 2026');

  // Streaming dedupTag with arbitrarily sized input chunks (e.g. 17,389-byte slices)
  const multiPt = new Uint8Array(150000);
  for (let i = 0; i < multiPt.byteLength; i++) {
    multiPt[i] = (i * 31 + 17) & 0xff;
  }
  async function* oddChunkGenerator() {
    let off = 0;
    while (off < multiPt.byteLength) {
      const len = Math.min(17389, multiPt.byteLength - off);
      yield multiPt.subarray(off, off + len);
      off += len;
    }
  }
  const dedup = await computeDedupTag(dedupKey, oddChunkGenerator());
  assert.equal(dedup.tagHex, VECTORS.dedupTags.multiChunkPlaintextDedupTagHex);
  assert.equal(dedup.tagB64u, VECTORS.dedupTags.multiChunkPlaintextDedupTagB64u);
});

test('Round-trip boundary sizes: 0 B, 1 B, exactly 1 MiB, 1 MiB + 1 B, and multi-chunk (3.3 MiB)', async () => {
  const fkWrapKey = fromHex(VECTORS.vaultKeyAndSubkeys.subkeys.fkWrapKeyHex);
  const blobId = '11223344-5566-4778-899a-bbccddeeff00';
  const sizes = [
    0,
    1,
    1048576, // 1 MiB exact
    1048577, // 1 MiB + 1 byte
    3 * 1048576 + 345678, // 3.3 MiB (4 chunks)
  ];

  for (const size of sizes) {
    const pt = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      pt[i] = (i * 73 + 19) & 0xff;
    }
    const { ciphertext, result } = await encryptBlobToBytes(pt, {
      fkWrapKey,
      blobId,
      chunkSizeLog2: 20, // 1 MiB chunks
    });

    const expectedChunks = size === 0 ? 1 : Math.ceil(size / 1048576);
    assert.equal(result.chunkCount, expectedChunks, `Failed chunkCount for size=${size}`);
    assert.equal(
      ciphertext.byteLength,
      PCZK_HEADER_LENGTH + size + expectedChunks * 16,
      `Failed ciphertext length for size=${size}`
    );

    // Feed decryption in small uneven network-like fragments (e.g., 61,507 B)
    async function* fragmentedStream() {
      let off = 0;
      while (off < ciphertext.byteLength) {
        const take = Math.min(61507, ciphertext.byteLength - off);
        yield ciphertext.subarray(off, off + take);
        off += take;
      }
    }

    const dec = await decryptBlobToBytes(fragmentedStream(), {
      fkWrapKey,
      expectedBlobId: blobId,
      expectedTotalCiphertextBytes: ciphertext.byteLength,
    });
    assert.equal(dec.plaintext.byteLength, size);
    assert.deepEqual(dec.plaintext, pt);
  }
});

test('Random-access decryptBlobRange: single chunk, cross-chunk range, exact boundary, and final partial chunk', async () => {
  const fkWrapKey = fromHex(VECTORS.vaultKeyAndSubkeys.subkeys.fkWrapKeyHex);
  const blobId: string = VECTORS.fileKeyWrap.blobId;
  const multiCt = new Uint8Array(
    fs.readFileSync(path.join(REPO_ROOT, VECTORS.pczkBlobs.multiChunk.fixtureFile))
  );
  const headerBytes = multiCt.subarray(0, PCZK_HEADER_LENGTH);
  const multiPt = new Uint8Array(150000);
  for (let i = 0; i < multiPt.byteLength; i++) {
    multiPt[i] = (i * 31 + 17) & 0xff;
  }

  const rangeCases: Array<[number, number]> = [
    [0, 0], // first byte
    [100, 5000], // inside chunk 0
    [65535, 65536], // 2-byte boundary crossing chunk 0 -> chunk 1
    [50000, 140000], // crossing all 3 chunks (chunk 0, chunk 1, chunk 2)
    [131072, 149999], // entire final partial chunk (chunk 2: 18,928 bytes)
    [149990, 149999], // tail 10 bytes of final partial chunk
  ];

  for (const [start, endInclusive] of rangeCases) {
    let fetchedRangeCount = 0;
    const decSlice = await decryptBlobRange({
      headerBytes,
      totalCiphertextBytes: multiCt.byteLength,
      startPlaintextByte: start,
      endPlaintextByteInclusive: endInclusive,
      fkWrapKey,
      expectedBlobId: blobId,
      fetchCiphertextRange: async (ctStart, ctEndInclusive) => {
        fetchedRangeCount++;
        return multiCt.subarray(ctStart, ctEndInclusive + 1);
      },
    });
    assert.equal(fetchedRangeCount, 1);
    assert.deepEqual(decSlice, multiPt.subarray(start, endInclusive + 1));
  }
});

test('Constant-memory streaming test with a 305 MiB file (> 300 MiB requirement)', async () => {
  const TOTAL_MIB = 305;
  const CHUNK_SIZE = 1048576; // 1 MiB
  const TOTAL_BYTES = TOTAL_MIB * CHUNK_SIZE; // 319,815,680 bytes (~305 MiB)
  const fkWrapKey = fromHex(VECTORS.vaultKeyAndSubkeys.subkeys.fkWrapKeyHex);
  const blobId = '30500000-0000-4000-8000-000000000305';

  // Fast no-op sha256 stream spy for the 305 MiB memory test so we test the AES-256-GCM
  // chunk streaming pipeline without spending CPU time hashing 305 MiB in pure JS twice.
  const fastStreamProvider = Object.assign(Object.create(defaultCryptoProvider), {
    createSha256Stream() {
      return {
        update(_chunk: Uint8Array) {},
        digest() {
          return new Uint8Array(32);
        },
      };
    },
  });

  // Deterministic 1 MiB template mutated per chunk index so every chunk is distinct
  const baseTemplate = new Uint8Array(CHUNK_SIZE);
  for (let i = 0; i < CHUNK_SIZE; i++) {
    baseTemplate[i] = (i * 13 + 7) & 0xff;
  }

  async function* generate305MiBPlaintext(): AsyncGenerator<Uint8Array, void, void> {
    for (let c = 0; c < TOTAL_MIB; c++) {
      const chunk = new Uint8Array(baseTemplate);
      chunk[0] = c & 0xff;
      chunk[1] = (c >> 8) & 0xff;
      chunk[CHUNK_SIZE - 1] = (c ^ 0xa5) & 0xff;
      yield chunk;
    }
  }

  const baselineHeap = process.memoryUsage().heapUsed;
  let maxHeapDeltaBytes = 0;

  const encryptedGenerator = encryptBlobStream(generate305MiBPlaintext(), {
    fkWrapKey,
    blobId,
    chunkSizeLog2: 20,
    cryptoProvider: fastStreamProvider,
  });

  let decryptedChunks = 0;
  let decryptedBytes = 0;

  for await (const decChunk of decryptBlobStream(encryptedGenerator, {
    fkWrapKey,
    expectedBlobId: blobId,
    cryptoProvider: fastStreamProvider,
  })) {
    assert.equal(decChunk.byteLength, CHUNK_SIZE);
    assert.equal(decChunk[0], decryptedChunks & 0xff);
    assert.equal(decChunk[1], (decryptedChunks >> 8) & 0xff);
    assert.equal(decChunk[CHUNK_SIZE - 1], (decryptedChunks ^ 0xa5) & 0xff);
    decryptedChunks++;
    decryptedBytes += decChunk.byteLength;

    if (decryptedChunks % 50 === 0) {
      const currentDelta = process.memoryUsage().heapUsed - baselineHeap;
      if (currentDelta > maxHeapDeltaBytes) {
        maxHeapDeltaBytes = currentDelta;
      }
    }
  }

  assert.equal(decryptedChunks, TOTAL_MIB);
  assert.equal(decryptedBytes, TOTAL_BYTES);
  // 305 MiB file would take > 305 MiB if buffered in RAM; streaming keeps heap delta well below 90 MiB
  assert.ok(
    maxHeapDeltaBytes < 95 * 1024 * 1024,
    `Expected constant memory (< 95 MiB delta), got ${Math.round(maxHeapDeltaBytes / (1024 * 1024))} MiB`
  );
});

test('Mandatory negative tests: bit-flips, truncation (including exact chunk boundary), chunk reordering/duplication, blobId swap, wrong passphrase, unknown version — zero unauthenticated plaintext leaked', async () => {
  const fkWrapKey = fromHex(VECTORS.vaultKeyAndSubkeys.subkeys.fkWrapKeyHex);
  const blobId: string = VECTORS.fileKeyWrap.blobId;
  const singleCt = new Uint8Array(
    fs.readFileSync(path.join(REPO_ROOT, VECTORS.pczkBlobs.singleChunk.fixtureFile))
  );
  const multiCt = new Uint8Array(
    fs.readFileSync(path.join(REPO_ROOT, VECTORS.pczkBlobs.multiChunk.fixtureFile))
  );

  async function assertStreamFailsWithZeroPlaintextOnCorruptedChunk(
    corruptedBlob: Uint8Array,
    expectedCode: ZkErrorCode,
    opts?: { expectedBlobId?: string; fkWrapKeyOverride?: Uint8Array }
  ) {
    let emittedBytes = 0;
    await assert.rejects(
      async () => {
        for await (const chunk of decryptBlobStream(corruptedBlob, {
          fkWrapKey: opts?.fkWrapKeyOverride ?? fkWrapKey,
          expectedBlobId: opts?.expectedBlobId ?? blobId,
        })) {
          emittedBytes += chunk.byteLength;
        }
      },
      (err: unknown) => {
        assert.ok(err instanceof ZkCryptoError, `Expected ZkCryptoError, got ${err}`);
        assert.equal(err.code, expectedCode);
        return true;
      }
    );
    return emittedBytes;
  }

  // 1. Unknown header version (byte 4)
  for (const badVer of [0x00, 0x02, 0x99, 0xff]) {
    const mutated = new Uint8Array(singleCt);
    mutated[4] = badVer;
    const leaked = await assertStreamFailsWithZeroPlaintextOnCorruptedChunk(
      mutated,
      ZkErrorCode.UNSUPPORTED_VERSION
    );
    assert.equal(leaked, 0);
  }

  // 2. Bit-flip in magic (bytes 0..3) and invalid chunkSizeLog2 (byte 5)
  {
    const mutatedMagic = new Uint8Array(singleCt);
    mutatedMagic[0] ^= 0x01;
    assert.equal(
      await assertStreamFailsWithZeroPlaintextOnCorruptedChunk(
        mutatedMagic,
        ZkErrorCode.MALFORMED_HEADER
      ),
      0
    );

    const mutatedLog2 = new Uint8Array(singleCt);
    mutatedLog2[5] = 15; // below minimum 16
    assert.equal(
      await assertStreamFailsWithZeroPlaintextOnCorruptedChunk(
        mutatedLog2,
        ZkErrorCode.MALFORMED_HEADER
      ),
      0
    );
  }

  // 3. Bit-flip in header noncePrefix (bytes 22..25) -> changes header SHA-256 AAD & chunk nonce
  {
    const mutatedPrefix = new Uint8Array(singleCt);
    mutatedPrefix[22] ^= 0x80;
    assert.equal(
      await assertStreamFailsWithZeroPlaintextOnCorruptedChunk(
        mutatedPrefix,
        ZkErrorCode.AUTH_TAG_MISMATCH
      ),
      0
    );
  }

  // 4. Bit-flip in header wrappedFK (bytes 26..85: IV, ciphertext, tag) -> fails FK unwrap
  for (const offset of [26, 45, 85]) {
    const mutatedWrappedFk = new Uint8Array(singleCt);
    mutatedWrappedFk[offset] ^= 0x01;
    assert.equal(
      await assertStreamFailsWithZeroPlaintextOnCorruptedChunk(
        mutatedWrappedFk,
        ZkErrorCode.WRONG_KEY_OR_PASSPHRASE
      ),
      0
    );
  }

  // 5. Bit-flip in every position of the single-chunk payload (ciphertext + 16B GCM tag: bytes 86..138)
  for (let pos = PCZK_HEADER_LENGTH; pos < singleCt.byteLength; pos++) {
    const mutated = new Uint8Array(singleCt);
    mutated[pos] ^= 0x04;
    const leaked = await assertStreamFailsWithZeroPlaintextOnCorruptedChunk(
      mutated,
      ZkErrorCode.AUTH_TAG_MISMATCH
    );
    assert.equal(leaked, 0, `Leaked plaintext on bit-flip at byte ${pos}`);
  }

  // 6. Truncation: partial header, header-only (86B), mid-chunk, and EXACT CHUNK BOUNDARY truncation!
  {
    // Partial header (50 bytes)
    assert.equal(
      await assertStreamFailsWithZeroPlaintextOnCorruptedChunk(
        singleCt.subarray(0, 50),
        ZkErrorCode.TRUNCATED_BLOB
      ),
      0
    );
    // Header only (86 bytes, 0 chunks)
    assert.equal(
      await assertStreamFailsWithZeroPlaintextOnCorruptedChunk(
        singleCt.subarray(0, PCZK_HEADER_LENGTH),
        ZkErrorCode.TRUNCATED_BLOB
      ),
      0
    );
    // Truncated to < 16B chunk tag
    assert.equal(
      await assertStreamFailsWithZeroPlaintextOnCorruptedChunk(
        singleCt.subarray(0, PCZK_HEADER_LENGTH + 10),
        ZkErrorCode.TRUNCATED_BLOB
      ),
      0
    );
    // Exact chunk boundary truncation on multi-chunk blob:
    // Cut right after chunk 0 (86 + 65552 = 65638 bytes)!
    // Chunk 0 was encrypted with `isLast = 0x00`, so when the truncated stream ends after chunk 0,
    // `decryptBlobStream` attempts to authenticate chunk 0 with `isLast = 0x01`, which MUST fail
    // with AUTH_TAG_MISMATCH and emit ZERO plaintext bytes!
    const exactChunk0End = PCZK_HEADER_LENGTH + 65552;
    const truncatedAfterChunk0 = multiCt.subarray(0, exactChunk0End);
    const leakedOnChunk0Cut = await assertStreamFailsWithZeroPlaintextOnCorruptedChunk(
      truncatedAfterChunk0,
      ZkErrorCode.AUTH_TAG_MISMATCH
    );
    assert.equal(leakedOnChunk0Cut, 0);
  }

  // 7. Chunk reordering and chunk duplication in multi-chunk blob
  {
    const header = multiCt.subarray(0, 86);
    const chunk0 = multiCt.subarray(86, 86 + 65552);
    const chunk1 = multiCt.subarray(86 + 65552, 86 + 65552 * 2);
    const chunk2 = multiCt.subarray(86 + 65552 * 2);

    // Reorder: swap chunk 0 and chunk 1 -> fails on chunk 0 immediately with 0 bytes emitted
    const reordered = concatBytes(header, chunk1, chunk0, chunk2);
    assert.equal(
      await assertStreamFailsWithZeroPlaintextOnCorruptedChunk(
        reordered,
        ZkErrorCode.AUTH_TAG_MISMATCH
      ),
      0
    );

    // Duplicate chunk 0 at index 1 -> chunk 0 is valid, then index 1 fails immediately
    const duplicated = concatBytes(header, chunk0, chunk0, chunk2);
    await assert.rejects(
      async () => {
        await decryptBlobToBytes(duplicated, { fkWrapKey, expectedBlobId: blobId });
      },
      (err: unknown) => err instanceof ZkCryptoError && err.code === ZkErrorCode.AUTH_TAG_MISMATCH
    );
  }

  // 8. Blob swapped between two blobIds or two users
  {
    const otherBlobId = '99999999-1111-4222-8333-444444444444';
    assert.equal(
      await assertStreamFailsWithZeroPlaintextOnCorruptedChunk(
        singleCt,
        ZkErrorCode.WRONG_KEY_OR_PASSPHRASE,
        { expectedBlobId: otherBlobId }
      ),
      0
    );

    // Attacker overwrites header blobId bytes (6..21) with otherBlobId -> FK unwrap AAD fails!
    const forgedBlobIdCt = new Uint8Array(singleCt);
    forgedBlobIdCt.set(fromHex(otherBlobId.replace(/-/g, '')), 6);
    assert.equal(
      await assertStreamFailsWithZeroPlaintextOnCorruptedChunk(
        forgedBlobIdCt,
        ZkErrorCode.WRONG_KEY_OR_PASSPHRASE,
        { expectedBlobId: otherBlobId }
      ),
      0
    );

    // Wrong user's fkWrapKey
    const wrongFkWrapKey = new Uint8Array(32).fill(0xaa);
    assert.equal(
      await assertStreamFailsWithZeroPlaintextOnCorruptedChunk(
        singleCt,
        ZkErrorCode.WRONG_KEY_OR_PASSPHRASE,
        { fkWrapKeyOverride: wrongFkWrapKey }
      ),
      0
    );
  }

  // 9. Wrong passphrase / wrong kek when unwrapping Vault Key (VK)
  {
    const wrappedVk = fromHex(VECTORS.vaultKeyAndSubkeys.wrappedVkFastHex);
    const wrongKek = new Uint8Array(32).fill(0x42);
    await assert.rejects(
      async () => {
        await unwrapVaultKey(wrongKek, wrappedVk, VECTORS.inputs.userId);
      },
      (err: unknown) =>
        err instanceof ZkCryptoError && err.code === ZkErrorCode.WRONG_KEY_OR_PASSPHRASE
    );
  }
});

test('Web Worker client (ZkWorkerClient) executes Argon2id with progress callback and off-thread blob encryption', async () => {
  const client = new ZkWorkerClient();
  try {
    const progressUpdates: Argon2idProgress[] = [];
    const derived = await client.deriveRootAndKeys({
      accountKey: fromHex(VECTORS.inputs.accountKeyHex),
      userSalt: fromHex(VECTORS.inputs.userSaltHex),
      passphrase: VECTORS.inputs.passphraseUtf8,
      argon2Params: VECTORS.inputs.argon2FastParams,
      onProgress: (p) => progressUpdates.push(p),
    });
    assert.equal(progressUpdates.length, 8); // t=2 * 4 slices = 8 updates
    assert.equal(progressUpdates[progressUpdates.length - 1].percent, 100);
    assert.equal(toHex(derived.root), VECTORS.keyHierarchy.withPassphraseFast.rootHex);
    assert.equal(toHex(derived.kek), VECTORS.keyHierarchy.withPassphraseFast.kekHex);
    assert.equal(toHex(derived.authSecret), VECTORS.keyHierarchy.withPassphraseFast.authSecretHex);

    const fkWrapKey = fromHex(VECTORS.vaultKeyAndSubkeys.subkeys.fkWrapKeyHex);
    const blobId: string = VECTORS.fileKeyWrap.blobId;
    const pt = utf8Encode('Worker encrypted payload');
    const chunkEvents: number[] = [];
    const enc = await client.encryptBlob({
      plaintext: pt,
      fkWrapKey,
      blobId,
      onProgress: ({ chunkIndex }) => chunkEvents.push(chunkIndex),
    });
    assert.deepEqual(chunkEvents, [1]);
    const dec = await decryptBlobToBytes(enc.ciphertext, { fkWrapKey, expectedBlobId: blobId });
    assert.equal(utf8Decode(dec.plaintext), 'Worker encrypted payload');
  } finally {
    client.terminate();
  }
});

test('Zeroization utility overwrites TypedArrays and ArrayBuffers in-place', () => {
  const u8 = new Uint8Array([1, 2, 3, 4]);
  const u32 = new Uint32Array([0xdeadbeef, 0xcafebabe]);
  const u64 = new BigUint64Array([0x1122334455667788n]);
  zeroize(u8, u32, u64);
  assert.deepEqual([...u8], [0, 0, 0, 0]);
  assert.deepEqual([...u32], [0, 0]);
  assert.deepEqual([...u64], [0n]);
  assert.equal(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2])), true);
  assert.equal(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3])), false);
});
