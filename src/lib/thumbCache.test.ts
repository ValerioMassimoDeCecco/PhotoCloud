import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Jimp } from 'jimp';
import { decryptFileAsync, encryptFileAsync } from './crypto';
import {
  MAX_CLIENT_THUMB_UPLOAD_BYTES,
  ThumbCacheManager,
  isJpegMagicBytes,
  parsePreviewVariant,
} from './thumbCache';

async function createSamplePngBuffer(width: number, height: number, color = 0x336699ff): Promise<Buffer> {
  const img = new Jimp({ width, height, color });
  return Buffer.from(await img.getBuffer('image/png'));
}

async function createSampleJpegBuffer(width: number, height: number, color = 0xcc5522ff): Promise<Buffer> {
  const img = new Jimp({ width, height, color });
  return Buffer.from(await img.getBuffer('image/jpeg', { quality: 85 }));
}

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('parsePreviewVariant maps 1/true/thumb to thumb, large to large, and ignores when download=true', () => {
  assert.equal(parsePreviewVariant('thumb', false), 'thumb');
  assert.equal(parsePreviewVariant('1', false), 'thumb');
  assert.equal(parsePreviewVariant('true', false), 'thumb');
  assert.equal(parsePreviewVariant('large', false), 'large');
  assert.equal(parsePreviewVariant('other', false), null);
  assert.equal(parsePreviewVariant('thumb', true), null);
  assert.equal(parsePreviewVariant('large', true), null);
});

test('getOrCreateThumbnail generates encrypted AES-256-GCM JPEG thumbnails in 320px and 1280px and caches hits', async () => {
  const dir = makeTempDir('pc-thumb-basic-');
  try {
    const apiKey = 'UserKey!234567890_Alpha';
    const mgr = new ThumbCacheManager({ maxBytes: 10 * 1024 * 1024 });

    const bigPng = await createSamplePngBuffer(2000, 1000);
    const encOrig = await encryptFileAsync(bigPng, apiKey);
    fs.writeFileSync(path.join(dir, 'sample.png'), encOrig);

    // Generate thumb (320px)
    const thumbRes = await mgr.getOrCreateThumbnail(dir, 'sample.png', 'thumb', apiKey);
    assert.equal(thumbRes.status, 'ok');
    assert.equal(thumbRes.hit, false);
    assert.equal(isJpegMagicBytes(thumbRes.buffer), true);
    const thumbJimp = await Jimp.fromBuffer(thumbRes.buffer);
    assert.equal(thumbJimp.bitmap.width, 320);
    assert.equal(thumbJimp.bitmap.height, 160);

    // Cache hit on second call
    const thumbHit = await mgr.getOrCreateThumbnail(dir, 'sample.png', 'thumb', apiKey);
    assert.equal(thumbHit.status, 'ok');
    assert.equal(thumbHit.hit, true);
    assert.equal(thumbHit.etag, thumbRes.etag);

    // Generate large (1280px)
    const largeRes = await mgr.getOrCreateThumbnail(dir, 'sample.png', 'large', apiKey);
    assert.equal(largeRes.status, 'ok');
    assert.equal(largeRes.hit, false);
    const largeJimp = await Jimp.fromBuffer(largeRes.buffer);
    assert.equal(largeJimp.bitmap.width, 1280);
    assert.equal(largeJimp.bitmap.height, 640);

    // Verify encrypted at rest on disk using wrong key fails & right key succeeds
    const thumbDir = path.join(dir, '.thumbs', 'thumb');
    const encFiles = fs.readdirSync(thumbDir);
    assert.equal(encFiles.length, 1);
    const rawOnDisk = fs.readFileSync(path.join(thumbDir, encFiles[0]));
    assert.equal(rawOnDisk.subarray(0, 17).toString('utf8'), 'PhotoCloud-GCM-v1');
    await assert.rejects(() => decryptFileAsync(rawOnDisk, 'WrongKey!999'));
    const dec = await decryptFileAsync(rawOnDisk, apiKey);
    assert.equal(isJpegMagicBytes(dec), true);

    const stats = mgr.getUserStats(dir);
    assert.equal(stats.thumbCount, 1);
    assert.equal(stats.largeCount, 1);
    assert.equal(stats.hits, 1);
    assert.equal(stats.misses, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('negative cache avoids re-decoding corrupted image until TTL expires', async () => {
  const dir = makeTempDir('pc-thumb-neg-');
  try {
    const apiKey = 'UserKey!NegativeCache1';
    const mgr = new ThumbCacheManager({ negativeTtlMs: 60_000 });
    const encBad = await encryptFileAsync(Buffer.from('not-a-valid-jpg-bytes'), apiKey);
    fs.writeFileSync(path.join(dir, 'broken.jpg'), encBad);

    const first = await mgr.getOrCreateThumbnail(dir, 'broken.jpg', 'thumb', apiKey);
    assert.equal(first.status, 'fallback');

    const stats1 = mgr.getUserStats(dir);
    assert.equal(stats1.negativeEntries, 1);
    assert.equal(stats1.misses, 1);

    // Second request hits negative cache immediately without incrementing misses
    const second = await mgr.getOrCreateThumbnail(dir, 'broken.jpg', 'thumb', apiKey);
    assert.equal(second.status, 'fallback');
    const stats2 = mgr.getUserStats(dir);
    assert.equal(stats2.misses, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('LRU eviction respects maxBytes cap by evicting oldest-accessed thumbnails', async () => {
  const dir = makeTempDir('pc-thumb-lru-');
  try {
    const apiKey = 'UserKey!LruTest123';
    // Generate two distinct images, check single thumb size, set maxBytes slightly above 1 entry
    const imgA = await createSamplePngBuffer(800, 800, 0x112233ff);
    const imgB = await createSamplePngBuffer(800, 800, 0x998877ff);
    fs.writeFileSync(path.join(dir, 'a.png'), await encryptFileAsync(imgA, apiKey));
    fs.writeFileSync(path.join(dir, 'b.png'), await encryptFileAsync(imgB, apiKey));

    const probeMgr = new ThumbCacheManager({ maxBytes: 10 * 1024 * 1024 });
    await probeMgr.getOrCreateThumbnail(dir, 'a.png', 'thumb', apiKey);
    const singleDiskBytes = probeMgr.getUserStats(dir).diskBytes;
    assert.ok(singleDiskBytes > 0);
    probeMgr.clearUserThumbnails(dir);

    const cappedMgr = new ThumbCacheManager({ maxBytes: Math.floor(singleDiskBytes * 1.4) });
    await cappedMgr.getOrCreateThumbnail(dir, 'a.png', 'thumb', apiKey);
    await new Promise((r) => setTimeout(r, 15));
    await cappedMgr.getOrCreateThumbnail(dir, 'b.png', 'thumb', apiKey);

    const stats = cappedMgr.getUserStats(dir);
    assert.equal(stats.thumbCount, 1);
    assert.equal(cappedMgr.hasCachedThumbnail(dir, 'a.png', 'thumb'), false);
    assert.equal(cappedMgr.hasCachedThumbnail(dir, 'b.png', 'thumb'), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('putClientThumbnail validates JPEG magic bytes, rejects oversized/invalid payloads, and caches video preview', async () => {
  const dir = makeTempDir('pc-thumb-client-');
  try {
    const apiKey = 'UserKey!ClientThumb99';
    const mgr = new ThumbCacheManager();
    fs.writeFileSync(path.join(dir, 'clip.mp4'), await encryptFileAsync(Buffer.from('fake-mp4'), apiKey));

    // Invalid magic bytes rejected
    await assert.rejects(
      () => mgr.putClientThumbnail(dir, 'clip.mp4', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]), apiKey),
      /INVALID_JPEG_MAGIC/
    );

    // Oversized payload rejected
    const huge = Buffer.alloc(MAX_CLIENT_THUMB_UPLOAD_BYTES + 1, 0);
    huge[0] = 0xff;
    huge[1] = 0xd8;
    huge[2] = 0xff;
    await assert.rejects(
      () => mgr.putClientThumbnail(dir, 'clip.mp4', huge, apiKey),
      /THUMBNAIL_TOO_LARGE/
    );

    // Valid JPEG frame accepted & retrievable encrypted
    const validJpg = await createSampleJpegBuffer(640, 360);
    const putRes = await mgr.putClientThumbnail(dir, 'clip.mp4', validJpg, apiKey, 'thumb');
    assert.ok(putRes.savedVariants.includes('thumb'));
    assert.equal(mgr.hasCachedThumbnail(dir, 'clip.mp4', 'thumb'), true);

    const served = await mgr.getOrCreateThumbnail(dir, 'clip.mp4', 'thumb', apiKey);
    assert.equal(served.status, 'ok');
    assert.equal(isJpegMagicBytes(served.buffer), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('invalidateFile and cleanupUserOrphans remove deleted file thumbnails cleanly', async () => {
  const dir = makeTempDir('pc-thumb-orphan-');
  try {
    const apiKey = 'UserKey!OrphanCleanup';
    const mgr = new ThumbCacheManager();
    const img = await createSamplePngBuffer(400, 400);
    fs.writeFileSync(path.join(dir, 'one.png'), await encryptFileAsync(img, apiKey));
    fs.writeFileSync(path.join(dir, 'two.png'), await encryptFileAsync(img, apiKey));

    await mgr.getOrCreateThumbnail(dir, 'one.png', 'thumb', apiKey);
    await mgr.getOrCreateThumbnail(dir, 'two.png', 'thumb', apiKey);
    assert.equal(mgr.getUserStats(dir).thumbCount, 2);

    mgr.invalidateFile(dir, 'one.png');
    assert.equal(mgr.getUserStats(dir).thumbCount, 1);

    // Delete underlying vault file 'two.png' outside manager, then sweep orphans
    fs.unlinkSync(path.join(dir, 'two.png'));
    const sweep = mgr.cleanupUserOrphans(dir);
    assert.equal(sweep.removedEntries, 1);
    assert.equal(mgr.getUserStats(dir).thumbCount, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
