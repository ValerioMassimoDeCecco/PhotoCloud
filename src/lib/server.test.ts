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
  for (const name of ['templates', 'static', 'public', 'release']) {
    if (fs.existsSync(path.join(root, name))) {
      fs.symlinkSync(path.join(root, name), path.join(dir, name), 'dir');
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
    async function upload(content: string) {
      const form = new FormData(); form.append('file[]', new Blob([content]), 'test.txt');
      return fetch(base + '/upload', { method: 'POST', headers: { Cookie: alice }, body: form });
    }
    const result = await (await upload('original')).json() as any;
    assert.equal(result.mediaFiles[0].size, 8);
    assert.equal(await (await get('/media/test.txt', alice)).text(), 'original');
    assert.equal((await fetch(base + '/trash/test.txt', json({}, alice))).status, 200);
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

    // Verify v1.2.4 Android update manifest and optional AI model Range streaming endpoints
    const updateManifestResp = await get('/api/android/update-manifest');
    assert.equal(updateManifestResp.status, 200);
    const updateManifest = await updateManifestResp.json() as any;
    assert.equal(updateManifest.versionName, '1.2.4');
    assert.equal(updateManifest.versionCode, 21);
    assert.equal(updateManifest.apkFilename, 'photocloud-release-v1.2.4-signed.apk');
    assert.equal(updateManifest.sha256.length, 64);
    assert.ok(updateManifest.sizeBytes > 20 * 1024 * 1024);

    const modelRangeResp = await fetch(base + '/api/ai-model/efficientnet_lite4.tflite', {
      headers: { Range: 'bytes=0-1023' },
    });
    assert.equal(modelRangeResp.status, 206);
    const modelChunk = await modelRangeResp.arrayBuffer();
    assert.equal(modelChunk.byteLength, 1024);
  } finally {
    child.kill(); await once(child, 'exit').catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
