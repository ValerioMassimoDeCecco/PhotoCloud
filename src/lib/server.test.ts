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
      assert.equal(missing.versionName, '1.4.1');
    } else {
      assert.equal(updateManifestResp.status, 200);
      const updateManifest = await updateManifestResp.json() as any;
      assert.equal(updateManifest.versionCode, 31);
      assert.equal(updateManifest.versionName, '1.4.1');
      assert.equal(updateManifest.apkFilename, 'photocloud-release-v1.4.1-signed.apk');
      assert.equal(updateManifest.sha256.length, 64);
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

    // --- CSRF Origin / Sec-Fetch-Site defense & session cookie flags ---
    const loginCookieCheck = await fetch(base + '/login', json({ username: 'alice', api_key: 'password123' }));
    const rawSetCookie = String(loginCookieCheck.headers.get('set-cookie') || '');
    assert.match(rawSetCookie, /photocloud_sid=/);
    assert.match(rawSetCookie, /HttpOnly/i);
    assert.match(rawSetCookie, /SameSite=(Lax|Strict)/i);

    // 1. Cross-origin Origin -> 403
    const csrfCrossOrigin = await fetch(base + '/api/albums/create', {
      method: 'POST',
      headers: { Cookie: alice, 'Content-Type': 'application/json', Origin: 'https://evil.example.com' },
      body: JSON.stringify({ name: 'CsrfCrossOrigin' }),
    });
    assert.equal(csrfCrossOrigin.status, 403);

    // 2. Origin: "null" (e.g. sandboxed iframe form POST) -> 403
    const csrfNullOrigin = await fetch(base + '/api/albums/create', {
      method: 'POST',
      headers: { Cookie: alice, 'Content-Type': 'application/json', Origin: 'null' },
      body: JSON.stringify({ name: 'CsrfNullOrigin' }),
    });
    assert.equal(csrfNullOrigin.status, 403, 'Origin: null must be rejected with 403');

    // 3. Sec-Fetch-Site: cross-site (even without Origin) -> 403
    const csrfFetchSiteCross = await fetch(base + '/api/albums/create', {
      method: 'POST',
      headers: { Cookie: alice, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' },
      body: JSON.stringify({ name: 'CsrfFetchSiteCross' }),
    });
    assert.equal(csrfFetchSiteCross.status, 403, 'Sec-Fetch-Site: cross-site must be rejected with 403');

    // 4. Same-origin Origin + Sec-Fetch-Site: same-origin -> 200
    const csrfSameOrigin = await fetch(base + '/api/albums/create', {
      method: 'POST',
      headers: {
        Cookie: alice,
        'Content-Type': 'application/json',
        Origin: base,
        'Sec-Fetch-Site': 'same-origin',
      },
      body: JSON.stringify({ name: 'CsrfSameOriginOk' }),
    });
    assert.equal(csrfSameOrigin.status, 200);

    // 5. No Origin and no Sec-Fetch-Site (native OkHttp / CLI client) -> 200
    const csrfNativeClient = await fetch(base + '/api/albums/create', {
      method: 'POST',
      headers: { Cookie: alice, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'CsrfNativeClientOk' }),
    });
    assert.equal(csrfNativeClient.status, 200);

    // 6. Reverse proxy (X-Forwarded-*) con trust proxy DISATTIVATO (default):
    // X-Forwarded-Host e X-Forwarded-Proto devono essere ignorati se TRUST_PROXY non è abilitato -> 403
    const csrfUntrustedProxyHeaders = await fetch(base + '/api/albums/create', {
      method: 'POST',
      headers: {
        Cookie: alice,
        'Content-Type': 'application/json',
        Origin: 'https://cloud.example.com',
        'X-Forwarded-Host': 'cloud.example.com:443, 10.0.0.1',
        'X-Forwarded-Proto': 'https, http',
      },
      body: JSON.stringify({ name: 'CsrfUntrustedProxyBlocked' }),
    });
    assert.equal(
      csrfUntrustedProxyHeaders.status,
      403,
      'Con trust proxy disattivato, X-Forwarded-* deve essere ignorato e Origin https://cloud.example.com rifiutato con 403'
    );

    // Con trust proxy disattivato, header X-Forwarded-* contraffatti non devono bloccare una richiesta same-origin legittima su Host reale
    const csrfUntrustedSpoofedIgnored = await fetch(base + '/api/albums/create', {
      method: 'POST',
      headers: {
        Cookie: alice,
        'Content-Type': 'application/json',
        Origin: base,
        'X-Forwarded-Host': 'evil.example.com',
        'X-Forwarded-Proto': 'https',
      },
      body: JSON.stringify({ name: 'CsrfUntrustedSpoofedIgnored' }),
    });
    assert.equal(
      csrfUntrustedSpoofedIgnored.status,
      200,
      'Con trust proxy disattivato, X-Forwarded-* contraffatti devono essere ignorati quando Origin combacia con Host reale'
    );

    // 7-10. Reverse proxy (X-Forwarded-*) con TRUST_PROXY=1 abilitato via config
    const proxySock = net.createServer();
    proxySock.listen(0, '127.0.0.1');
    await once(proxySock, 'listening');
    const proxyPort = (proxySock.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => proxySock.close(() => resolve()));
    const proxyChild = spawn(
      process.execPath,
      ['--import', path.join(root, 'node_modules/tsx/dist/loader.mjs'), path.join(root, 'server.ts')],
      {
        cwd: dir,
        env: { ...process.env, PORT: String(proxyPort), GITHUB_TOKEN: '', TRUST_PROXY: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    const proxyBase = `http://127.0.0.1:${proxyPort}`;
    try {
      let proxyReady = false;
      for (let i = 0; i < 100; i++) {
        if (proxyChild.exitCode !== null) throw new Error('Proxy server exited during startup');
        try {
          await fetch(proxyBase + '/api/session');
          proxyReady = true;
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 50));
        }
      }
      assert.ok(proxyReady, 'proxy server did not start');
      const proxyLoginRes = await fetch(proxyBase + '/login', json({ username: 'alice', api_key: 'password123' }));
      assert.equal(proxyLoginRes.status, 200);
      const proxyAlice = proxyLoginRes.headers.get('set-cookie')!.split(';')[0];

      // 7. TRUST_PROXY=1: X-Forwarded-Host con porta default :443 e Origin https senza :443 -> 200
      const csrfProxyDefaultPort = await fetch(proxyBase + '/api/albums/create', {
        method: 'POST',
        headers: {
          Cookie: proxyAlice,
          'Content-Type': 'application/json',
          Origin: 'https://cloud.example.com',
          'X-Forwarded-Host': 'cloud.example.com:443, 10.0.0.1',
          'X-Forwarded-Proto': 'https, http',
        },
        body: JSON.stringify({ name: 'CsrfProxyDefault443' }),
      });
      assert.equal(csrfProxyDefaultPort.status, 200, 'Con TRUST_PROXY=1, X-Forwarded-Host con :443 deve combaciare con Origin https://cloud.example.com');

      // 8. TRUST_PROXY=1: X-Forwarded-Host senza porta + X-Forwarded-Port: 8443 e Origin https://cloud.example.com:8443 -> 200
      const csrfProxyCustomPort = await fetch(proxyBase + '/api/albums/create', {
        method: 'POST',
        headers: {
          Cookie: proxyAlice,
          'Content-Type': 'application/json',
          Origin: 'https://cloud.example.com:8443',
          'X-Forwarded-Host': 'cloud.example.com',
          'X-Forwarded-Port': '8443',
          'X-Forwarded-Proto': 'https',
        },
        body: JSON.stringify({ name: 'CsrfProxyPort8443' }),
      });
      assert.equal(csrfProxyCustomPort.status, 200, 'Con TRUST_PROXY=1, X-Forwarded-Host + X-Forwarded-Port: 8443 deve combaciare con Origin https://cloud.example.com:8443');

      // 9. TRUST_PROXY=1: X-Forwarded-Proto: https ma Origin: http://cloud.example.com (protocol mismatch) -> 403
      const csrfProxyProtoMismatch = await fetch(proxyBase + '/api/albums/create', {
        method: 'POST',
        headers: {
          Cookie: proxyAlice,
          'Content-Type': 'application/json',
          Origin: 'http://cloud.example.com',
          'X-Forwarded-Host': 'cloud.example.com',
          'X-Forwarded-Proto': 'https',
        },
        body: JSON.stringify({ name: 'CsrfProxyProtoMismatch' }),
      });
      assert.equal(csrfProxyProtoMismatch.status, 403, 'Con TRUST_PROXY=1, disallineamento protocollo Origin (http) vs X-Forwarded-Proto (https) deve restituire 403');

      // 10. TRUST_PROXY=1: Origin cross-origin diverso da X-Forwarded-Host -> 403
      const csrfProxyCrossHost = await fetch(proxyBase + '/api/albums/create', {
        method: 'POST',
        headers: {
          Cookie: proxyAlice,
          'Content-Type': 'application/json',
          Origin: 'https://evil.example.com',
          'X-Forwarded-Host': 'cloud.example.com',
          'X-Forwarded-Proto': 'https',
        },
        body: JSON.stringify({ name: 'CsrfProxyCrossHost' }),
      });
      assert.equal(csrfProxyCrossHost.status, 403);

      // 11. TRUST_PROXY=1: X-Forwarded-For multiplo non permette di scegliere l'IP del rate limit su /share/*
      const rlShareCreate = await fetch(proxyBase + '/api/shares/create', {
        method: 'POST',
        headers: { Cookie: proxyAlice, 'Content-Type': 'application/json', Origin: proxyBase },
        body: JSON.stringify({ filenames: ['test.txt'], expiresInHours: 24, label: 'RateLimitProxyTest' }),
      });
      assert.equal(rlShareCreate.status, 200);
      const rlShare = (await rlShareCreate.json()) as { url: string };

      const rlSock = net.createServer();
      rlSock.listen(0, '127.0.0.1');
      await once(rlSock, 'listening');
      const rlPort = (rlSock.address() as net.AddressInfo).port;
      await new Promise<void>((resolve) => rlSock.close(() => resolve()));
      const rlChild = spawn(
        process.execPath,
        ['--import', path.join(root, 'node_modules/tsx/dist/loader.mjs'), path.join(root, 'server.ts')],
        {
          cwd: dir,
          env: {
            ...process.env,
            PORT: String(rlPort),
            GITHUB_TOKEN: '',
            TRUST_PROXY: '1',
            SHARE_RATE_LIMIT_MAX: '10',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );
      const rlBase = `http://127.0.0.1:${rlPort}`;
      try {
        let rlReady = false;
        for (let i = 0; i < 100; i++) {
          if (rlChild.exitCode !== null) throw new Error('RL proxy server exited during startup');
          try {
            await fetch(rlBase + '/api/session');
            rlReady = true;
            break;
          } catch {
            await new Promise((r) => setTimeout(r, 50));
          }
        }
        assert.ok(rlReady, 'RL proxy server did not start');

        // 10 richieste con IP client reale (rightmost prima del proxy) = 203.0.113.50 ma IP leftmost contraffatto diverso ogni volta
        for (let i = 0; i < 10; i++) {
          const r = await fetch(rlBase + rlShare.url, {
            headers: { 'X-Forwarded-For': `198.51.100.${i + 1}, 203.0.113.50` },
          });
          assert.equal(r.status, 200, `Richiesta ${i + 1}/10 da 203.0.113.50 deve passare (200)`);
        }
        // L'11ª richiesta, anche cambiando nuovamente il leftmost IP, con TRUST_PROXY=1 usa 203.0.113.50 e deve scattare 429
        const blocked11 = await fetch(rlBase + rlShare.url, {
          headers: { 'X-Forwarded-For': '198.51.100.250, 203.0.113.50' },
        });
        assert.equal(
          blocked11.status,
          429,
          'Con TRUST_PROXY=1 un X-Forwarded-For multiplo non deve permettere di scegliere l\'IP sinistro per aggirare il rate limit'
        );
      } finally {
        rlChild.kill();
        await once(rlChild, 'exit').catch(() => {});
      }

      // 12. TRUST_PROXY="true" deve essere rifiutato/ignorato con warning all'avvio (X-Forwarded-* ignorati)
      const trueSock = net.createServer();
      trueSock.listen(0, '127.0.0.1');
      await once(trueSock, 'listening');
      const truePort = (trueSock.address() as net.AddressInfo).port;
      await new Promise<void>((resolve) => trueSock.close(() => resolve()));
      let trueOutput = '';
      const trueChild = spawn(
        process.execPath,
        ['--import', path.join(root, 'node_modules/tsx/dist/loader.mjs'), path.join(root, 'server.ts')],
        {
          cwd: dir,
          env: { ...process.env, PORT: String(truePort), GITHUB_TOKEN: '', TRUST_PROXY: 'true' },
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );
      trueChild.stdout?.on('data', (d) => { trueOutput += String(d); });
      trueChild.stderr?.on('data', (d) => { trueOutput += String(d); });
      const trueBase = `http://127.0.0.1:${truePort}`;
      try {
        let trueReady = false;
        for (let i = 0; i < 100; i++) {
          if (trueChild.exitCode !== null) throw new Error('TRUST_PROXY=true server exited during startup');
          try {
            await fetch(trueBase + '/api/session');
            trueReady = true;
            break;
          } catch {
            await new Promise((r) => setTimeout(r, 50));
          }
        }
        assert.ok(trueReady, 'TRUST_PROXY=true server did not start');
        assert.match(
          trueOutput,
          /TRUST_PROXY.*true/i,
          'TRUST_PROXY="true" deve emettere un warning esplicito all\'avvio'
        );
        const trueLoginRes = await fetch(trueBase + '/login', json({ username: 'alice', api_key: 'password123' }));
        assert.equal(trueLoginRes.status, 200);
        const trueAlice = trueLoginRes.headers.get('set-cookie')!.split(';')[0];
        const trueIgnoredRes = await fetch(trueBase + '/api/albums/create', {
          method: 'POST',
          headers: {
            Cookie: trueAlice,
            'Content-Type': 'application/json',
            Origin: 'https://cloud.example.com',
            'X-Forwarded-Host': 'cloud.example.com',
            'X-Forwarded-Proto': 'https',
          },
          body: JSON.stringify({ name: 'TrustProxyTrueIgnored' }),
        });
        assert.equal(
          trueIgnoredRes.status,
          403,
          'TRUST_PROXY="true" deve essere rifiutato/ignorato e quindi non fidarsi di X-Forwarded-*'
        );
      } finally {
        trueChild.kill();
        await once(trueChild, 'exit').catch(() => {});
      }

      // 13. TRUST_PROXY con lista di subnet (es. 127.0.0.0/8,10.0.0.0/8) è supportato
      const subnetSock = net.createServer();
      subnetSock.listen(0, '127.0.0.1');
      await once(subnetSock, 'listening');
      const subnetPort = (subnetSock.address() as net.AddressInfo).port;
      await new Promise<void>((resolve) => subnetSock.close(() => resolve()));
      const subnetChild = spawn(
        process.execPath,
        ['--import', path.join(root, 'node_modules/tsx/dist/loader.mjs'), path.join(root, 'server.ts')],
        {
          cwd: dir,
          env: { ...process.env, PORT: String(subnetPort), GITHUB_TOKEN: '', TRUST_PROXY: '127.0.0.0/8, 10.0.0.0/8' },
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );
      const subnetBase = `http://127.0.0.1:${subnetPort}`;
      try {
        let subnetReady = false;
        for (let i = 0; i < 100; i++) {
          if (subnetChild.exitCode !== null) throw new Error('Subnet proxy server exited during startup');
          try {
            await fetch(subnetBase + '/api/session');
            subnetReady = true;
            break;
          } catch {
            await new Promise((r) => setTimeout(r, 50));
          }
        }
        assert.ok(subnetReady, 'subnet proxy server did not start');
        const subnetLoginRes = await fetch(subnetBase + '/login', json({ username: 'alice', api_key: 'password123' }));
        assert.equal(subnetLoginRes.status, 200);
        const subnetAlice = subnetLoginRes.headers.get('set-cookie')!.split(';')[0];
        const subnetAcceptedRes = await fetch(subnetBase + '/api/albums/create', {
          method: 'POST',
          headers: {
            Cookie: subnetAlice,
            'Content-Type': 'application/json',
            Origin: 'https://cloud.example.com',
            'X-Forwarded-Host': 'cloud.example.com',
            'X-Forwarded-Proto': 'https',
          },
          body: JSON.stringify({ name: 'TrustProxySubnetOk' }),
        });
        assert.equal(
          subnetAcceptedRes.status,
          200,
          'TRUST_PROXY con lista di subnet (127.0.0.0/8, 10.0.0.0/8) deve accettare X-Forwarded-* dal proxy fidato'
        );
      } finally {
        subnetChild.kill();
        await once(subnetChild, 'exit').catch(() => {});
      }
    } finally {
      proxyChild.kill();
      await once(proxyChild, 'exit').catch(() => {});
    }
  } finally {
    child.kill(); await once(child, 'exit').catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
