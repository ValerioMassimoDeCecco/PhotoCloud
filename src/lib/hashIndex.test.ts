import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  calculateBufferHash,
  decryptFileAsync,
  decryptFileSha256Stream,
  deriveKey,
  encryptFileAsync,
  encryptFileStream,
  findDuplicateGroups,
} from './crypto';
import { cleanupOrphanTempFiles, VaultHashIndex } from './hashIndex';

function encryptLegacyCfb(plaintext: Buffer, apiKey: string): Buffer {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cfb', deriveKey(apiKey, salt), iv);
  return Buffer.concat([salt, iv, cipher.update(plaintext), cipher.final()]);
}

test('encryptFileStream and decryptFileSha256Stream match buffer crypto helpers across GCM and legacy CFB', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-stream-crypto-'));
  try {
    const apiKey = 'StreamingTestKey!2026';
    // > 256 KB to span multiple 64 KB stream chunks
    const sample = crypto.randomBytes(260 * 1024 + 17);
    const expectedHash = calculateBufferHash(sample);

    const rawPath = path.join(dir, 'sample.bin');
    const encStreamPath = path.join(dir, 'sample.enc');
    fs.writeFileSync(rawPath, sample);

    const encRes = await encryptFileStream(rawPath, encStreamPath, apiKey);
    assert.equal(encRes.sha256, expectedHash);
    assert.equal(encRes.plaintextSize, sample.length);

    // Must decrypt identically with existing decryptFileAsync buffer decoder
    const decryptedBuf = await decryptFileAsync(fs.readFileSync(encStreamPath), apiKey);
    assert.equal(Buffer.compare(decryptedBuf, sample), 0);

    // Streaming SHA-256 verify on GCM file
    const gcmDigest = await decryptFileSha256Stream(encStreamPath, apiKey);
    assert.equal(gcmDigest.sha256, expectedHash);
    assert.equal(gcmDigest.plaintextSize, sample.length);

    // Streaming SHA-256 verify on legacy AES-256-CFB file
    const cfbPath = path.join(dir, 'legacy.enc');
    fs.writeFileSync(cfbPath, encryptLegacyCfb(sample, apiKey));
    const cfbDigest = await decryptFileSha256Stream(cfbPath, apiKey);
    assert.equal(cfbDigest.sha256, expectedHash);
    assert.equal(cfbDigest.plaintextSize, sample.length);

    // Tampered GCM ciphertext must fail auth tag check
    const tamperedPath = path.join(dir, 'tampered.enc');
    const tamperedBytes = fs.readFileSync(encStreamPath);
    tamperedBytes[tamperedBytes.length - 1] ^= 0xff;
    fs.writeFileSync(tamperedPath, tamperedBytes);
    await assert.rejects(() => decryptFileSha256Stream(tamperedPath, apiKey));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('VaultHashIndex tracks active files only (excludes trash) and reuses index for duplicates', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-hash-index-'));
  try {
    const userDir = path.join(dir, 'alice');
    const trashDir = path.join(userDir, 'trash');
    fs.mkdirSync(trashDir, { recursive: true });

    const apiKey = 'HashIndexKey!2026';
    const index = new VaultHashIndex();

    const bufA = Buffer.from('alpha-image-bytes');
    const hashA = calculateBufferHash(bufA);
    const bufB = Buffer.from('beta-trashed-bytes');
    const hashB = calculateBufferHash(bufB);

    fs.writeFileSync(path.join(userDir, 'a1.jpg'), await encryptFileAsync(bufA, apiKey));
    fs.writeFileSync(path.join(userDir, 'a2.jpg'), await encryptFileAsync(bufA, apiKey));
    // File placed ONLY in trash must NOT count as already backed up
    fs.writeFileSync(path.join(trashDir, 'trashed.jpg'), await encryptFileAsync(bufB, apiKey));

    const check1 = await index.checkBackupItems(userDir, apiKey, [
      { sha256: hashA, sizeBytes: bufA.length },
      { sha256: hashB, sizeBytes: bufB.length },
    ]);
    assert.deepEqual(check1.existingSha256, [hashA]);
    assert.equal(check1.backfillPending, 0);

    // Move one copy to trash -> still present via a2.jpg, then remove a2 -> absent
    fs.renameSync(path.join(userDir, 'a1.jpg'), path.join(trashDir, 'a1.jpg'));
    await index.removeFileHash(userDir, 'a1.jpg');

    const check2 = await index.checkBackupItems(userDir, apiKey, [{ sha256: hashA, sizeBytes: bufA.length }]);
    assert.deepEqual(check2.existingSha256, [hashA]);

    fs.renameSync(path.join(userDir, 'a2.jpg'), path.join(trashDir, 'a2.jpg'));
    await index.removeFileHash(userDir, 'a2.jpg');

    const check3 = await index.checkBackupItems(userDir, apiKey, [{ sha256: hashA, sizeBytes: bufA.length }]);
    assert.deepEqual(check3.existingSha256, []);

    // Restore both copies and check resolveAllActiveHashes + duplicate grouping
    fs.renameSync(path.join(trashDir, 'a1.jpg'), path.join(userDir, 'a1.jpg'));
    fs.renameSync(path.join(trashDir, 'a2.jpg'), path.join(userDir, 'a2.jpg'));
    const all = await index.resolveAllActiveHashes(userDir, apiKey);
    const dups = findDuplicateGroups(all);
    assert.deepEqual(dups, [['a1.jpg', 'a2.jpg']]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cleanupOrphanTempFiles removes leftover .part on startup and respects active sessions during sweeps', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-temp-clean-'));
  try {
    const activePart = path.join(dir, 'chunked_11111111-1111-1111-1111-111111111111.part');
    const orphanPart = path.join(dir, 'chunked_22222222-2222-2222-2222-222222222222.part');
    const staleTmp = path.join(dir, 'upload_1234_abcd.tmp');
    const freshTmp = path.join(dir, 'upload_9999_efgh.tmp');
    const unrelatedFile = path.join(dir, 'keep_me.txt');

    fs.writeFileSync(activePart, 'part-a');
    fs.writeFileSync(orphanPart, 'part-b');
    fs.writeFileSync(staleTmp, 'old-tmp');
    fs.writeFileSync(freshTmp, 'new-tmp');
    fs.writeFileSync(unrelatedFile, 'unrelated');

    const nowMs = Date.now();
    const oldDate = new Date(nowMs - 3 * 60 * 60 * 1000);
    fs.utimesSync(orphanPart, oldDate, oldDate);
    fs.utimesSync(staleTmp, oldDate, oldDate);

    // Periodic sweep mode: preserves activePart even if old, preserves freshTmp, removes stale unreferenced orphanPart + staleTmp
    const swept = cleanupOrphanTempFiles(dir, {
      activePartPaths: new Set([path.resolve(activePart)]),
      cleanAllChunkedParts: false,
      staleTempMaxAgeMs: 2 * 60 * 60 * 1000,
      nowMs,
    });
    assert.equal(swept, 2);
    assert.equal(fs.existsSync(orphanPart), false);
    assert.equal(fs.existsSync(staleTmp), false);
    assert.equal(fs.existsSync(activePart), true);
    assert.equal(fs.existsSync(freshTmp), true);
    assert.equal(fs.existsSync(unrelatedFile), true);

    // Startup mode (cleanAllChunkedParts=true): wipes ALL chunked_*.part even if fresh
    const removedAtStartup = cleanupOrphanTempFiles(dir, {
      cleanAllChunkedParts: true,
      staleTempMaxAgeMs: 2 * 60 * 60 * 1000,
      nowMs,
    });
    assert.equal(removedAtStartup, 1);
    assert.equal(fs.existsSync(activePart), false);
    assert.equal(fs.existsSync(freshTmp), true);
    assert.equal(fs.existsSync(unrelatedFile), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
