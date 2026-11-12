import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';

const root = process.cwd();

test('server protects vaults, preserves collisions, and handles real media flows', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'photocloud-test-'));
  const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
  for (const name of ['templates', 'static', 'public', 'release', 'android-app']) {
    if (fs.existsSync(path.join(root, name))) {
      fs.symlinkSync(path.join(root, name), path.join(dir, name), symlinkType);
    }
  }
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = (socket.address() as net.AddressInfo).port; await new Promise<void>(resolve => socket.close(() => resolve()));
  const child = spawn(process.execPath, ['--import', path.join(root, 'node_modules/tsx/dist/loader.mjs'), path.join(root, 'server.ts')], {
    cwd: dir, env: { ...process.env, PORT: String(port), GITHUB_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const base = `http://127.0.0.1:${port}`;
  const json = (body: unknown, cookie?: string) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  const get = (url: string, cookie?: string) => fetch(base + url, { headers: cookie ? { Cookie: cookie } : {} });
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error('Server exited during startup');
      try { await get('/api/session'); ready = true; break; } catch { await new Promise(r => setTimeout(r, 50)); }
    }
    assert.ok(ready, 'server did not start');
    async function register(name: string) {
      const form = new FormData(); form.set('username', name); form.set('key_type', 'custom'); form.set('custom_key', 'password123');
      return fetch(base + '/register', { method: 'POST', body: form });
    }
    async function login(name: string) {
      const response = await fetch(base + '/login', json({ username: name, api_key: 'password123' }));
      assert.equal(response.status, 200);
      return response.headers.get('set-cookie')!.split(';')[0];
    }
    assert.equal((await register('../escape')).status, 400);
    assert.equal((await register('alice')).status, 200);
    assert.equal((await register('bob')).status, 200);
    const alice = await login('alice'), bob = await login('bob');

    // Unauthenticated upload is rejected with 403 before buffering files
    const unauthForm = new FormData();
    unauthForm.append('file[]', new Blob(['unauth']), 'unauth.txt');
    assert.equal((await fetch(base + '/upload', { method: 'POST', body: unauthForm })).status, 403);

    async function upload(content: string) {
      const form = new FormData(); form.append('file[]', new Blob([content]), 'test.txt');
      return fetch(base + '/upload', { method: 'POST', headers: { Cookie: alice }, body: form });
    }
    const result = await (await upload('original')).json() as any;
    assert.equal(result.mediaFiles[0].size, 8);
    assert.ok(result.storageStats, 'POST /upload must return storageStats');
    assert.equal(result.storageStats.filesBytes, 8);
    assert.equal(await (await get('/media/test.txt', alice)).text(), 'original');

    // Verify RFC 9110 Range support on /media/test.txt (suffix range and 416 out-of-bounds)
    const suffixRangeResp = await fetch(base + '/media/test.txt', {
      headers: { Cookie: alice, Range: 'bytes=-4' },
    });
    assert.equal(suffixRangeResp.status, 206);
    assert.equal(await suffixRangeResp.text(), 'inal');

    const invalidRangeResp = await fetch(base + '/media/test.txt', {
      headers: { Cookie: alice, Range: 'bytes=99999-100000' },
    });
    assert.equal(invalidRangeResp.status, 416);

    assert.equal((await fetch(base + '/trash/test.txt', json({}, alice))).status, 200);

    // Verify trashed file direct download works via both /media/test.txt?from_trash=true&download=true and /trash/media/test.txt
    assert.equal(await (await get('/media/test.txt?from_trash=true&download=true', alice)).text(), 'original');
    assert.equal(await (await get('/trash/media/test.txt', alice)).text(), 'original');

    await upload('newdata');
    assert.equal((await fetch(base + '/restore/test.txt', json({}, alice))).status, 409);
    assert.equal(await (await get('/media/test.txt', alice)).text(), 'newdata');
    assert.equal((await fetch(base + '/trash/test.txt', json({}, alice))).status, 409);
    const zip = await (await fetch(base + '/prepare-zip', json({ filenames: ['test.txt'] }, alice))).json() as any;
    let progress: any;
    for (let i = 0; i < 100; i++) {
      progress = await (await get(`/zip-progress/${zip.task_id}`, alice)).json();
      if (progress.status === 'complete') break;
      assert.notEqual(progress.status, 'error'); await new Promise(r => setTimeout(r, 30));
    }
    assert.equal(progress.status, 'complete');
    assert.equal((await get(`/zip-progress/${zip.task_id}`, bob)).status, 404);
    assert.equal((await get(`/download-zip/${progress.filename}`, bob)).status, 404);
    assert.equal((await get(`/download-zip/${progress.filename}`, alice)).status, 200);
    assert.equal((await fetch(base + '/api/github-actions/trigger', json({}))).status, 410);
    assert.equal((await get('/manifest.webmanifest')).status, 200);
    assert.equal((await get('/service-worker.js')).status, 200);
    assert.equal((await get('/')).status, 200);
    assert.equal((await fetch(base + '/login', { redirect: 'manual' })).status, 302);

    // Verify Android update manifest and optional AI model Range streaming endpoints.
    // Invariante anti-loop: la versione annunciata deve corrispondere all'APK realmente servito.
    const updateManifestResp = await get('/api/android/update-manifest');
    if (updateManifestResp.status === 404) {
      const missing = await updateManifestResp.json() as any;
      assert.equal(missing.error, 'Nessun APK di release disponibile sul server');
      assert.equal(missing.versionName, '1.3.1');
    } else {
      assert.equal(updateManifestResp.status, 200);
      const updateManifest = await updateManifestResp.json() as any;
      assert.equal(updateManifest.versionCode, 28);
      assert.equal(updateManifest.versionName, '1.3.1');
      assert.equal(updateManifest.apkFilename, 'photocloud-release-v1.3.1-signed.apk');
      assert.equal(updateManifest.sha256.length, 64);
      assert.ok(updateManifest.sizeBytes > 10 * 1024 * 1024);
    }

    const modelRangeResp = await fetch(base + '/api/ai-model/efficientnet_lite4.tflite', {
      headers: { Range: 'bytes=0-1023' },
    });
    assert.equal(modelRangeResp.status, 206);
    const modelChunk = await modelRangeResp.arrayBuffer();
    assert.equal(modelChunk.byteLength, 1024);

    const modelInvalidRangeResp = await fetch(base + '/api/ai-model/efficientnet_lite4.tflite', {
      headers: { Range: 'bytes=999999999-' },
    });
    assert.equal(modelInvalidRangeResp.status, 416);

    // --- SECURITY HARDENING & AUTH/REGISTRATION COMPATIBILITY TESTS ---
    // 1. Verify HTTP security headers & X-Powered-By removal
    const rootResp = await get('/');
    assert.equal(rootResp.headers.get('x-powered-by'), null);
    assert.equal(rootResp.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(rootResp.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.ok(rootResp.headers.get('content-security-policy')?.includes("default-src 'self'"));

    // 2. Verify registration with auto-generated key + login via multipart auth_file JSON upload + logout
    const regGenForm = new FormData();
    regGenForm.set('username', 'charlie_sec');
    regGenForm.set('key_type', 'generate');
    const regGenResp = await fetch(base + '/register', { method: 'POST', body: regGenForm });
    assert.equal(regGenResp.status, 200);
    const authJsonText = await regGenResp.text();
    const authParsed = JSON.parse(authJsonText);
    assert.equal(authParsed.username, 'charlie_sec');
    assert.equal(authParsed.api_key.length, 32);

    const loginFileForm = new FormData();
    loginFileForm.set('auth_file', new Blob([authJsonText], { type: 'application/json' }), 'photocloud_auth_charlie_sec.json');
    const realLoginFileResp = await fetch(base + '/login', {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: loginFileForm,
    });
    assert.equal(realLoginFileResp.status, 200);
    const charlieCookie = realLoginFileResp.headers.get('set-cookie')!.split(';')[0];

    const sessBeforeLogout = await (await get('/api/session', charlieCookie)).json() as any;
    assert.equal(sessBeforeLogout.authenticated, true);
    assert.equal(sessBeforeLogout.username, 'charlie_sec');

    const logoutResp = await fetch(base + '/logout', json({}, charlieCookie));
    assert.equal(logoutResp.status, 200);
    const sessAfterLogout = await (await get('/api/session', charlieCookie)).json() as any;
    assert.equal(sessAfterLogout.authenticated, false);

    // 3. Stored XSS mitigation on /media/:filename (.html & .svg)
    const xssForm = new FormData();
    xssForm.append('file[]', new Blob(['<script>alert(document.cookie)</script>'], { type: 'text/html' }), 'evil.html');
    xssForm.append('file[]', new Blob(['<svg onload="alert(1)"></svg>'], { type: 'image/svg+xml' }), 'evil.svg');
    const xssUpResp = await fetch(base + '/upload', { method: 'POST', headers: { Cookie: alice }, body: xssForm });
    assert.equal(xssUpResp.status, 200);
    const xssUpData = await xssUpResp.json() as any;
    const htmlFile = xssUpData.mediaFiles.find((f: any) => f.filename.endsWith('.html'))?.filename;
    const svgFile = xssUpData.mediaFiles.find((f: any) => f.filename.endsWith('.svg'))?.filename;
    assert.ok(htmlFile);
    assert.ok(svgFile);

    const htmlMediaResp = await get(`/media/${encodeURIComponent(htmlFile)}`, alice);
    assert.equal(htmlMediaResp.status, 200);
    assert.ok(htmlMediaResp.headers.get('content-disposition')?.startsWith('attachment;'));
    assert.ok(htmlMediaResp.headers.get('content-type')?.startsWith('text/plain'));
    assert.ok(htmlMediaResp.headers.get('content-security-policy')?.includes('sandbox'));

    const svgMediaResp = await get(`/media/${encodeURIComponent(svgFile)}`, alice);
    assert.equal(svgMediaResp.status, 200);
    assert.ok(svgMediaResp.headers.get('content-disposition')?.startsWith('attachment;'));
    assert.ok(svgMediaResp.headers.get('content-security-policy')?.includes('sandbox'));

    // 4. Dot-file & internal metadata access prevention (.albums.json)
    await fetch(base + '/api/albums/create', json({ name: 'Segreto' }, alice));
    assert.equal((await get('/media/.albums.json', alice)).status, 403);
    assert.equal((await get('/api/document-preview/.albums.json', alice)).status, 403);
    assert.equal((await fetch(base + '/trash/.albums.json', json({}, alice))).status, 403);

    // 5. Prototype Pollution prevention in /api/albums/assign & orphan cleanup in /empty_trash
    const protoResp = await fetch(
      base + '/api/albums/assign',
      json({ filenames: ['__proto__', 'constructor', 'prototype', 'test.txt', 'orphan_deleted.jpg'], album: 'Segreto' }, alice)
    );
    assert.equal(protoResp.status, 200);
    const protoData = await protoResp.json() as any;
    assert.equal(Object.prototype.hasOwnProperty.call(protoData.fileAlbums, '__proto__'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(protoData.fileAlbums, 'constructor'), false);
    assert.equal(protoData.fileAlbums['test.txt'], 'Segreto');
    assert.equal(protoData.fileAlbums['orphan_deleted.jpg'], 'Segreto');

    const emptyTrashResp = await fetch(base + '/empty_trash', json({}, alice));
    assert.equal(emptyTrashResp.status, 200);
    const albumsAfterEmpty = await (await get('/api/albums', alice)).json() as any;
    assert.equal(albumsAfterEmpty.fileAlbums['test.txt'], 'Segreto');
    assert.equal(albumsAfterEmpty.fileAlbums['orphan_deleted.jpg'], undefined);

    // 6. CSRF Cross-Origin blocking on state-changing POST endpoints
    const csrfResp = await fetch(base + '/empty_trash', {
      method: 'POST',
      headers: {
        Cookie: alice,
        Origin: 'https://evil-attacker.example.com',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    assert.equal(csrfResp.status, 403);

    // 7. Android Builder authentication & path traversal checks
    assert.equal((await get('/api/android/releases')).status, 403);
    assert.equal((await get('/api/android/releases', alice)).status, 200);
    const unauthBuildResp = await fetch(base + '/api/android/build-release', json({}));
    assert.equal(unauthBuildResp.status, 403);
    const invalidDownloadResp = await get('/api/android/download/..%2F..%2Fetc/apk', alice);
    assert.equal(invalidDownloadResp.status, 400);

    // 8. Bulk Parallel Upload Stress Test (260 photos selected at once with 6 parallel workers)
    const totalPhotosToUpload = 260;
    const parallelWorkers = 6;
    const photoIndices = Array.from({ length: totalPhotosToUpload }, (_, idx) => idx);
    let cursor = 0;
    let totalUploadedCount = 0;

    async function bulkUploadWorker() {
      while (cursor < photoIndices.length) {
        const myIdx = cursor++;
        if (myIdx >= photoIndices.length) break;
        const form = new FormData();
        const fakeJpegPayload = new Uint8Array(1024);
        fakeJpegPayload[0] = 0xff;
        fakeJpegPayload[1] = 0xd8;
        fakeJpegPayload[2] = myIdx & 0xff;
        form.append('file[]', new Blob([fakeJpegPayload], { type: 'image/jpeg' }), `bulk_photo_${myIdx}.jpg`);
        form.append('timestamp[]', String(Date.now() - myIdx * 1000));
        form.append('album', 'Vacanze250');
        if (myIdx < totalPhotosToUpload - 1) {
          form.append('skipList', '1');
        }
        const resp = await fetch(base + '/upload', {
          method: 'POST',
          headers: { Cookie: bob },
          body: form,
        });
        assert.equal(resp.status, 200, `Bulk upload failed on photo ${myIdx}`);
        const data = await resp.json() as any;
        assert.equal(data.success, true);
        assert.equal(data.uploadedCount, 1);
        totalUploadedCount += data.uploadedCount;
      }
    }

    await Promise.all(Array.from({ length: parallelWorkers }, () => bulkUploadWorker()));
    assert.equal(totalUploadedCount, totalPhotosToUpload);

    const bobSession = await (await get('/api/session', bob)).json() as any;
    assert.equal(bobSession.authenticated, true);
    assert.equal(bobSession.media.length, totalPhotosToUpload);
    assert.ok(bobSession.albums.includes('Vacanze250'));
    assert.equal(bobSession.storageStats.mediaCount, totalPhotosToUpload);
    assert.equal(bobSession.storageStats.mediaBytes, totalPhotosToUpload * 1024);

    // 9. Video /api/media/edit test: upload MP4, save edited WebM copy, and overwrite original MP4 -> WebM migration
    const videoUploadForm = new FormData();
    const fakeMp4Bytes = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
    videoUploadForm.append('file[]', new Blob([fakeMp4Bytes], { type: 'video/mp4' }), 'clip_originale.mp4');
    videoUploadForm.append('timestamp[]', String(Date.now()));
    const upVidResp = await fetch(base + '/upload', {
      method: 'POST',
      headers: { Cookie: alice },
      body: videoUploadForm,
    });
    assert.equal(upVidResp.status, 200);
    const upVidData = await upVidResp.json() as any;
    const uploadedMp4Name = upVidData.uploadedFilenames?.[0] as string;
    assert.ok(uploadedMp4Name && uploadedMp4Name.endsWith('.mp4'));
    const uploadedStem = uploadedMp4Name.replace(/\.mp4$/i, '');

    const fakeWebmBytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01]);
    const copyEditForm = new FormData();
    copyEditForm.append('file', new Blob([fakeWebmBytes], { type: 'video/webm' }), `${uploadedStem}.webm`);
    copyEditForm.append('originalFilename', uploadedMp4Name);
    copyEditForm.append('mode', 'copy');
    const copyEditResp = await fetch(base + '/api/media/edit', {
      method: 'POST',
      headers: { Cookie: alice },
      body: copyEditForm,
    });
    assert.equal(copyEditResp.status, 200);
    const copyEditJson = await copyEditResp.json() as any;
    assert.equal(copyEditJson.success, true);
    assert.equal(copyEditJson.isVideo, true);
    assert.ok(copyEditJson.filename.endsWith('.webm'));
    assert.notEqual(copyEditJson.filename, uploadedMp4Name);
    assert.ok(copyEditJson.mediaFiles.some((f: any) => f.filename === uploadedMp4Name));
    assert.ok(copyEditJson.mediaFiles.some((f: any) => f.filename === copyEditJson.filename));

    const overwriteEditForm = new FormData();
    overwriteEditForm.append('file', new Blob([fakeWebmBytes], { type: 'video/webm' }), `${uploadedStem}.webm`);
    overwriteEditForm.append('originalFilename', uploadedMp4Name);
    overwriteEditForm.append('mode', 'overwrite');
    const owEditResp = await fetch(base + '/api/media/edit', {
      method: 'POST',
      headers: { Cookie: alice },
      body: overwriteEditForm,
    });
    assert.equal(owEditResp.status, 200);
    const owEditJson = await owEditResp.json() as any;
    assert.equal(owEditJson.success, true);
    assert.equal(owEditJson.isVideo, true);
    assert.equal(owEditJson.filename, `${uploadedStem}.webm`);
    assert.equal(owEditJson.mediaFiles.some((f: any) => f.filename === uploadedMp4Name), false);
    assert.equal(owEditJson.mediaFiles.some((f: any) => f.filename === `${uploadedStem}.webm`), true);
  } finally {
    child.kill(); await once(child, 'exit').catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
