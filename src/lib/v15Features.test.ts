import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { Jimp } from 'jimp';

const root = process.cwd();

test('v1.5.0 integration: persistent encrypted thumbs & auto-backup check + chunked streaming upload', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'photocloud-v15-'));
  const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
  for (const name of ['templates', 'static', 'public', 'release', 'android-app']) {
    if (fs.existsSync(path.join(root, name))) {
      fs.symlinkSync(path.join(root, name), path.join(dir, name), symlinkType);
    }
  }

  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));

  const child = spawn(
    process.execPath,
    ['--import', path.join(root, 'node_modules/tsx/dist/loader.mjs'), path.join(root, 'server.ts')],
    {
      cwd: dir,
      env: { ...process.env, PORT: String(port), GITHUB_TOKEN: '', MAX_UPLOAD_MB: '100' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  const base = `http://127.0.0.1:${port}`;
  const jsonReq = (method: string, body: unknown, cookie?: string, extraHeaders: Record<string, string> = {}) => ({
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });

  try {
    let ready = false;
    for (let i = 0; i < 120; i++) {
      if (child.exitCode !== null) throw new Error('Server exited during startup');
      try {
        await fetch(base + '/api/session');
        ready = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    assert.ok(ready, 'v1.5.0 test server did not become ready');

    // Register & login alice
    const regForm = new FormData();
    regForm.set('username', 'alice');
    regForm.set('key_type', 'custom');
    regForm.set('custom_key', 'strongPass123!');
    assert.equal((await fetch(base + '/register', { method: 'POST', body: regForm })).status, 200);

    const loginResp = await fetch(base + '/login', jsonReq('POST', { username: 'alice', api_key: 'strongPass123!' }));
    assert.equal(loginResp.status, 200);
    const aliceCookie = loginResp.headers.get('set-cookie')!.split(';')[0];

    // -------------------------------------------------------------------------
    // PART 1 (Feature B): Persistent Encrypted Thumbnail Cache + Lightbox Large
    // -------------------------------------------------------------------------
    const sampleImg = new Jimp({ width: 800, height: 600, color: 0x336699ff });
    const samplePngBuffer = await sampleImg.getBuffer('image/png');
    const upForm = new FormData();
    upForm.append('file[]', new Blob([new Uint8Array(samplePngBuffer)], { type: 'image/png' }), 'landscape.png');
    const upResp = await fetch(base + '/upload', {
      method: 'POST',
      headers: { Cookie: aliceCookie },
      body: upForm,
    });
    assert.equal(upResp.status, 200);
    const upJson = (await upResp.json()) as any;
    const photoFilename = upJson.uploadedFilenames[0];
    assert.ok(/^[0-9a-f]{16}\.png$/.test(photoFilename), `Unexpected vault photo name: ${photoFilename}`);

    // Request ?preview=thumb
    const thumbResp = await fetch(`${base}/media/${encodeURIComponent(photoFilename)}?preview=thumb`, {
      headers: { Cookie: aliceCookie },
    });
    assert.equal(thumbResp.status, 200);
    assert.equal(thumbResp.headers.get('content-type'), 'image/jpeg');
    assert.ok(thumbResp.headers.get('etag'), 'Thumbnail must include ETag');
    assert.ok(
      String(thumbResp.headers.get('cache-control') || '').includes('private'),
      'Thumbnail Cache-Control must be private'
    );
    const thumbBytes = Buffer.from(await thumbResp.arrayBuffer());
    assert.equal(thumbBytes[0], 0xff);
    assert.equal(thumbBytes[1], 0xd8); // JPEG SOI

    // ETag / 304 check
    const etag = thumbResp.headers.get('etag')!;
    const notModifiedResp = await fetch(`${base}/media/${encodeURIComponent(photoFilename)}?preview=thumb`, {
      headers: { Cookie: aliceCookie, 'If-None-Match': etag },
    });
    assert.equal(notModifiedResp.status, 304);

    // Request ?preview=large
    const largeResp = await fetch(`${base}/media/${encodeURIComponent(photoFilename)}?preview=large`, {
      headers: { Cookie: aliceCookie },
    });
    assert.equal(largeResp.status, 200);
    assert.equal(largeResp.headers.get('content-type'), 'image/jpeg');
    const largeBytes = Buffer.from(await largeResp.arrayBuffer());
    assert.equal(largeBytes[0], 0xff);
    assert.equal(largeBytes[1], 0xd8);

    // Check encrypted .thumbs/ directory on disk (variants must be AES-256-GCM encrypted, not plaintext JPEG)
    const thumbsThumbDir = path.join(dir, 'user_media', 'alice', '.thumbs', 'thumb');
    const thumbsLargeDir = path.join(dir, 'user_media', 'alice', '.thumbs', 'large');
    assert.ok(fs.existsSync(thumbsThumbDir) && fs.existsSync(thumbsLargeDir), '.thumbs/thumb and .thumbs/large must exist');
    const thumbFiles = fs.readdirSync(thumbsThumbDir).filter((f) => f.endsWith('.enc'));
    const largeFiles = fs.readdirSync(thumbsLargeDir).filter((f) => f.endsWith('.enc'));
    assert.ok(thumbFiles.length >= 1 && largeFiles.length >= 1, 'Both thumb and large encrypted files must exist');
    const rawEncPrefix = fs.readFileSync(path.join(thumbsThumbDir, thumbFiles[0])).subarray(0, 17).toString('utf-8');
    assert.equal(rawEncPrefix, 'PhotoCloud-GCM-v1');

    // GET /api/thumbs/stats & POST /api/thumbs/rebuild
    const statsResp = await fetch(`${base}/api/thumbs/stats`, { headers: { Cookie: aliceCookie } });
    assert.equal(statsResp.status, 200);
    const statsJson = (await statsResp.json()) as any;
    assert.ok(statsJson.diskBytes > 0);
    assert.ok(statsJson.variantCount >= 2);

    const rebuildResp = await fetch(`${base}/api/thumbs/rebuild`, jsonReq('POST', { force: false }, aliceCookie));
    assert.equal(rebuildResp.status, 200);
    const rebuildJson = (await rebuildResp.json()) as any;
    assert.equal(rebuildJson.success, true);

    // PUT /api/thumbs/:filename (video poster frame upload)
    const videoPayload = Buffer.from('FAKE_MP4_HEADER_DATA_BYTES');
    const vidForm = new FormData();
    vidForm.append('file[]', new Blob([new Uint8Array(videoPayload)], { type: 'video/mp4' }), 'clip.mp4');
    const vidUpResp = await fetch(base + '/upload', { method: 'POST', headers: { Cookie: aliceCookie }, body: vidForm });
    assert.equal(vidUpResp.status, 200);
    const clipFilename = ((await vidUpResp.json()) as any).uploadedFilenames[0];
    assert.ok(/^[0-9a-f]{16}\.mp4$/.test(clipFilename));

    // Unauthenticated PUT /api/thumbs rejected
    assert.equal(
      (
        await fetch(`${base}/api/thumbs/${encodeURIComponent(clipFilename)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/jpeg' },
          body: thumbBytes,
        })
      ).status,
      403
    );
    // Invalid non-JPEG PUT /api/thumbs rejected with 400
    assert.equal(
      (
        await fetch(`${base}/api/thumbs/${encodeURIComponent(clipFilename)}`, {
          method: 'PUT',
          headers: { Cookie: aliceCookie, 'Content-Type': 'image/jpeg' },
          body: Buffer.from('not a jpeg'),
        })
      ).status,
      400
    );
    // Valid JPEG poster PUT /api/thumbs/<clipFilename> succeeds
    const putThumbResp = await fetch(`${base}/api/thumbs/${encodeURIComponent(clipFilename)}`, {
      method: 'PUT',
      headers: { Cookie: aliceCookie, 'Content-Type': 'image/jpeg' },
      body: thumbBytes,
    });
    assert.equal(putThumbResp.status, 200);
    const clipThumbResp = await fetch(`${base}/media/${encodeURIComponent(clipFilename)}?preview=thumb`, { headers: { Cookie: aliceCookie } });
    assert.equal(clipThumbResp.status, 200);
    assert.equal(clipThumbResp.headers.get('content-type'), 'image/jpeg');

    // Edit overwrite invalidates existing thumbnail ETag
    const editedImg = new Jimp({ width: 800, height: 600, color: 0xcc2222ff });
    const editedPngBuf = await editedImg.getBuffer('image/png');
    const editForm = new FormData();
    editForm.append('originalFilename', photoFilename);
    editForm.append('mode', 'overwrite');
    editForm.append('file', new Blob([new Uint8Array(editedPngBuf)], { type: 'image/png' }), photoFilename);
    assert.equal(
      (await fetch(base + '/api/media/edit', { method: 'POST', headers: { Cookie: aliceCookie }, body: editForm })).status,
      200
    );
    const newThumbResp = await fetch(`${base}/media/${encodeURIComponent(photoFilename)}?preview=thumb`, {
      headers: { Cookie: aliceCookie },
    });
    assert.equal(newThumbResp.status, 200);
    assert.notEqual(newThumbResp.headers.get('etag'), etag, 'ETag must change after overwrite edit invalidation');

    // -------------------------------------------------------------------------
    // PART 2 (Feature A): /api/backup/check Active-Only Rule & Chunked Upload
    // -------------------------------------------------------------------------
    // Unauthenticated rejected before processing
    assert.equal(
      (await fetch(`${base}/api/backup/check`, jsonReq('POST', { items: [] }))).status,
      403
    );
    assert.equal(
      (await fetch(`${base}/api/upload/chunked/init`, jsonReq('POST', { filename: 'x.mp4', totalSize: 100 }))).status,
      403
    );

    const pngSha = crypto.createHash('sha256').update(editedPngBuf).digest('hex');
    const checkActive = await fetch(
      `${base}/api/backup/check`,
      jsonReq('POST', { items: [{ sha256: pngSha, sizeBytes: editedPngBuf.length }, { sha256: 'f'.repeat(64) }] }, aliceCookie)
    );
    assert.equal(checkActive.status, 200);
    const checkActiveJson = (await checkActive.json()) as any;
    assert.deepEqual(checkActiveJson.existingSha256, [pngSha]);
    assert.equal(checkActiveJson.maxUploadMb, 100);

    // Move photoFilename to trash -> active-only rule must stop matching it!
    assert.equal(
      (await fetch(`${base}/trash/${encodeURIComponent(photoFilename)}`, { method: 'POST', headers: { Cookie: aliceCookie } })).status,
      200
    );
    const checkAfterTrash = await fetch(
      `${base}/api/backup/check`,
      jsonReq('POST', { items: [{ sha256: pngSha, sizeBytes: editedPngBuf.length }] }, aliceCookie)
    );
    assert.equal(checkAfterTrash.status, 200);
    const checkTrashJson = (await checkAfterTrash.json()) as any;
    assert.deepEqual(checkTrashJson.existingSha256, [], 'Trashed file must NOT count as backed up');

    // Restore -> matches again
    assert.equal(
      (await fetch(`${base}/restore/${encodeURIComponent(photoFilename)}`, { method: 'POST', headers: { Cookie: aliceCookie } })).status,
      200
    );
    const checkRestored = await fetch(
      `${base}/api/backup/check`,
      jsonReq('POST', { items: [{ sha256: pngSha, sizeBytes: editedPngBuf.length }] }, aliceCookie)
    );
    assert.deepEqual(((await checkRestored.json()) as any).existingSha256, [pngSha]);

    // Chunked streaming upload test (~160 KB over 3 chunks)
    const largeVideoBytes = crypto.randomBytes(160 * 1024 + 317);
    const largeVideoSha = crypto.createHash('sha256').update(largeVideoBytes).digest('hex');
    const origTimestampMs = 1710000123000;
    const chunkSize = 64 * 1024;

    // Wrong checksum must fail cleanly and not store file
    const badInitResp = await fetch(
      `${base}/api/upload/chunked/init`,
      jsonReq(
        'POST',
        {
          filename: 'bad_checksum.mp4',
          totalSize: largeVideoBytes.length,
          chunkSizeBytes: chunkSize,
          sha256: '0'.repeat(64),
          timestampMs: origTimestampMs,
        },
        aliceCookie,
        { 'X-Backup-Origin': 'auto' }
      )
    );
    assert.equal(badInitResp.status, 200);
    const badInit = (await badInitResp.json()) as any;
    for (let idx = 0; idx < badInit.totalChunks; idx++) {
      const slice = largeVideoBytes.subarray(idx * chunkSize, Math.min((idx + 1) * chunkSize, largeVideoBytes.length));
      const putRes = await fetch(`${base}/api/upload/chunked/${badInit.uploadId}/${idx}`, {
        method: 'PUT',
        headers: { Cookie: aliceCookie, 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(slice),
      });
      assert.equal(putRes.status, 200);
    }
    const badComplete = await fetch(
      `${base}/api/upload/chunked/${badInit.uploadId}/complete?skipList=1`,
      jsonReq('POST', { skipList: true }, aliceCookie)
    );
    assert.equal(badComplete.status, 400);

    // Valid chunked upload with matching SHA-256 + skipList=1 + original timestamp
    const initResp = await fetch(
      `${base}/api/upload/chunked/init`,
      jsonReq(
        'POST',
        {
          filename: 'camera_video_chunked.mp4',
          totalSize: largeVideoBytes.length,
          chunkSizeBytes: chunkSize,
          sha256: largeVideoSha,
          timestampMs: origTimestampMs,
        },
        aliceCookie,
        { 'X-Backup-Origin': 'auto' }
      )
    );
    assert.equal(initResp.status, 200);
    const initJson = (await initResp.json()) as any;
    assert.equal(initJson.totalChunks, 3);

    for (let idx = 0; idx < initJson.totalChunks; idx++) {
      const slice = largeVideoBytes.subarray(idx * chunkSize, Math.min((idx + 1) * chunkSize, largeVideoBytes.length));
      const putRes = await fetch(`${base}/api/upload/chunked/${initJson.uploadId}/${idx}`, {
        method: 'PUT',
        headers: { Cookie: aliceCookie, 'Content-Type': 'application/octet-stream', 'X-Backup-Origin': 'auto' },
        body: new Uint8Array(slice),
      });
      assert.equal(putRes.status, 200);
    }
    const completeResp = await fetch(
      `${base}/api/upload/chunked/${initJson.uploadId}/complete?skipList=1`,
      jsonReq('POST', { skipList: true }, aliceCookie, { 'X-Backup-Origin': 'auto' })
    );
    assert.equal(completeResp.status, 200);
    const completeJson = (await completeResp.json()) as any;
    assert.equal(completeJson.success, true);
    assert.equal(completeJson.sha256, largeVideoSha);
    const chunkedFilename = completeJson.filename;
    assert.ok(/^[0-9a-f]{16}\.mp4$/.test(chunkedFilename), `Unexpected chunked vault name: ${chunkedFilename}`);
    assert.equal(completeJson.mediaFiles, undefined, 'skipList=1 omits full gallery list');

    // Download back and verify byte-for-byte decryption & preserved timestamp
    const downloadedVideo = Buffer.from(
      await (await fetch(`${base}/media/${encodeURIComponent(chunkedFilename)}`, { headers: { Cookie: aliceCookie } })).arrayBuffer()
    );
    assert.equal(downloadedVideo.equals(largeVideoBytes), true);
    const encryptedStat = fs.statSync(path.join(dir, 'user_media', 'alice', chunkedFilename));
    assert.ok(Math.abs(encryptedStat.mtimeMs - origTimestampMs) < 5000, 'Original timestamp must be preserved');

    // Subsequent backup check recognizes chunked file immediately via active hash index
    const checkChunked = await fetch(
      `${base}/api/backup/check`,
      jsonReq('POST', { items: [{ sha256: largeVideoSha, sizeBytes: largeVideoBytes.length }] }, aliceCookie)
    );
    assert.deepEqual(((await checkChunked.json()) as any).existingSha256, [largeVideoSha]);
  } finally {
    child.kill();
    await once(child, 'exit').catch(() => undefined);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
