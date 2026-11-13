import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { Jimp } from 'jimp';

const root = process.cwd();

async function makePng(seedVariant: 'split' | 'stripes' | 'dots'): Promise<Buffer> {
  const img = new Jimp({ width: 48, height: 48, color: 0x336699ff });
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 48; x++) {
      let on = false;
      if (seedVariant === 'split') on = x >= 24;
      else if (seedVariant === 'stripes') on = y % 2 === 0;
      else on = (x * y) % 7 === 0;
      img.setPixelColor(on ? 0xf2f2f2ff : 0x111111ff, x, y);
    }
  }
  return Buffer.from(await img.getBuffer('image/png'));
}

test('v1.4.0: preferiti, ricordi, ricerca NL, condivisioni pubbliche, album multi-utente, duplicati simili, push', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'photocloud-features-'));
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
    { cwd: dir, env: { ...process.env, PORT: String(port), GITHUB_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const base = `http://127.0.0.1:${port}`;
  const json = (body: unknown, cookie?: string) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  const get = (url: string, cookie?: string) => fetch(base + url, { headers: cookie ? { Cookie: cookie } : {} });

  async function register(name: string) {
    const form = new FormData();
    form.set('username', name);
    form.set('key_type', 'custom');
    form.set('custom_key', 'password123');
    return fetch(base + '/register', { method: 'POST', body: form });
  }
  async function login(name: string) {
    const response = await fetch(base + '/login', json({ username: name, api_key: 'password123' }));
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie')!.split(';')[0];
  }
  async function uploadPng(cookie: string, buf: Buffer, tsMs?: number): Promise<string> {
    const form = new FormData();
    form.append('file[]', new Blob([new Uint8Array(buf)]), `pic-${Math.random().toString(36).slice(2)}.png`);
    if (tsMs) form.append('timestamp[]', String(tsMs));
    const res = await fetch(base + '/upload?skipList=1', { method: 'POST', headers: { Cookie: cookie }, body: form });
    const data = (await res.json()) as { success: boolean; uploadedFilenames: string[] };
    assert.ok(data.success && data.uploadedFilenames.length === 1);
    return data.uploadedFilenames[0];
  }

  try {
    // Attendi avvio server
    let ready = false;
    for (let i = 0; i < 120; i++) {
      if (child.exitCode !== null) throw new Error('Server crashato in avvio');
      try {
        await get('/api/session');
        ready = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    assert.ok(ready, 'server non avviato');

    assert.equal((await register('alice')).status, 200);
    assert.equal((await register('bob')).status, 200);
    const alice = await login('alice');
    const bob = await login('bob');

    const pngA = await makePng('split');
    const pngACopy = await makePng('split');
    const pngDiff = await makePng('stripes');

    // ============================ ⭐ PREFERITI ============================
    await t.test('preferiti: toggle, lista, set-many, session', async () => {
      const favFile = await uploadPng(alice, pngA);

      let res = await fetch(`${base}/api/favorites/toggle`, json({ filename: favFile }, alice));
      let data = (await res.json()) as { isFavorite?: boolean; favorites: string[] };
      assert.equal(res.status, 200);
      assert.equal(data.isFavorite, true);
      assert.deepEqual(data.favorites, [favFile]);

      // persistenza tramite sessione
      res = await get('/api/session', alice);
      const sessData = (await res.json()) as { favorites: string[] };
      assert.ok(sessData.favorites.includes(favFile));

      // file inesistente → 404; input sporco → 400
      res = await fetch(`${base}/api/favorites/toggle`, json({ filename: 'nope.png' }, alice));
      assert.equal(res.status, 404);
      res = await fetch(`${base}/api/favorites/toggle`, json({ filename: '../x' }, alice));
      assert.equal(res.status, 400);

      // secondo toggle → rimozione
      res = await fetch(`${base}/api/favorites/toggle`, json({ filename: favFile }, alice));
      data = (await res.json()) as { isFavorite?: boolean; favorites: string[] };
      assert.equal(data.isFavorite, false);
    });

    // ============================ 🕐 RICORDI ============================
    await t.test('ricordi: solo foto dello stesso giorno/mese di anni passati', async () => {
      const now = new Date();
      const lastYear = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate(), 10, 0, 0).getTime();
      const memoryFile = await uploadPng(alice, await makePng('dots'), lastYear);
      const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate(), 9, 0, 0).getTime();
      const memoryFile2 = await uploadPng(alice, await makePng('dots'), twoYearsAgo);

      const res = await get('/api/memories', alice);
      const data = (await res.json()) as {
        count: number;
        sections: Array<{ year: number; yearsAgo: number; items: Array<{ filename: string }> }>;
      };
      assert.equal(res.status, 200);
      const names = data.sections.flatMap((s) => s.items.map((i) => i.filename));
      assert.ok(names.includes(memoryFile), 'deve includere la foto dell\'anno scorso');
      assert.ok(names.includes(memoryFile2), 'deve includere la foto di due anni fa');
      const y1 = data.sections.find((s) => s.yearsAgo === 1);
      assert.ok(y1, 'sezione "1 anno fa" presente');

      // non autenticato → 403
      const resAnon = await get('/api/memories');
      assert.equal(resAnon.status, 403);
    });

    // ====================== 🔍 RICERCA LINGUAGGIO NATURALE ======================
    await t.test('ricerca NL: tipo, data, preferiti, testo', async () => {
      const form = new FormData();
      form.append('file[]', new Blob(['contabilita']), 'report-lavoro-2024.txt');
      const up = await fetch(base + '/upload', { method: 'POST', headers: { Cookie: alice }, body: form });
      assert.equal(up.status, 200);

      let res = await get('/api/search?q=' + encodeURIComponent('documenti lavoro'), alice);
      let data = (await res.json()) as { count?: number; results: Array<{ filename: string }> };
      assert.ok(data.results.some((r) => r.filename.startsWith('report-lavoro-2024')));

      // solo foto (txt non deve comparire)
      res = await get('/api/search?q=' + encodeURIComponent('foto'), alice);
      data = (await res.json()) as { count?: number; results: Array<{ filename: string }> };
      assert.ok(!data.results.some((r) => r.filename.endsWith('.txt')));

      // solo preferiti su query vuota di favoriti → 0 risultati
      res = await get('/api/search?q=preferiti', alice);
      data = (await res.json()) as { count?: number; results: Array<{ filename: string }> };
      assert.equal(data.count, 0);

      // year filter
      res = await get('/api/search?q=' + encodeURIComponent('foto 2024'), alice);
      data = (await res.json()) as { count?: number; results: Array<{ filename: string }> };
      assert.ok(data.results.every((r) => !r.filename.endsWith('.txt')));
    });

    // ================== 🧬 DUPLICATI QUASI IDENTICI (pHash) ==================
    await t.test('duplicati quasi identici: raggruppa copie, esclude diversi', async () => {
      const nameA = await uploadPng(alice, pngA);
      const nameACopy = await uploadPng(alice, pngACopy);
      const nameDiff = await uploadPng(alice, pngDiff);

      const res = await fetch(base + '/api/similar_duplicates', json({}, alice));
      assert.equal(res.status, 200);
      const data = (await res.json()) as { groups: Array<{ filenames: string[] }>; total: number };
      assert.ok(data.total >= 3);
      const groupWithA = data.groups.find((g) => g.filenames.includes(nameA));
      assert.ok(groupWithA, 'copia identica deve essere raggruppata');
      assert.ok(groupWithA!.filenames.includes(nameACopy));
      assert.ok(!groupWithA!.filenames.includes(nameDiff), 'immagine diversa non deve essere nel gruppo');

      // seconda chiamata usa la cache (stesso risultato)
      const res2 = await fetch(base + '/api/similar_duplicates', json({}, alice));
      const data2 = (await res2.json()) as { cached: number };
      assert.ok(data2.cached >= 3, 'la seconda scansione deve servire dalla cache');
      assert.ok(fs.existsSync(path.join(dir, 'user_media', 'alice', '.phash.json')));
    });

    // ================== 🔔 NOTIFICHE PUSH WEB ==================
    await t.test('push: chiave VAPID, subscribe/unsubscribe per utente', async () => {
      let key = '';
      for (let i = 0; i < 50; i++) {
        const res = await get('/api/push/vapid-key');
        if (res.status === 200) {
          key = ((await res.json()) as { publicKey: string }).publicKey;
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.ok(key.length > 20, 'chiave pubblica VAPID disponibile');

      const sub = { endpoint: 'https://push.example.com/sub/abc123', keys: { p256dh: 'BPdh-test', auth: 'auth-test' } };
      let res = await fetch(base + '/api/push/subscribe', json({ subscription: sub }, alice));
      let data = (await res.json()) as { success?: boolean; subscriptions: number };
      assert.equal(data.success, true);
      assert.equal(data.subscriptions, 1);

      // endpoint non https → 400
      res = await fetch(base + '/api/push/subscribe', json({ subscription: { endpoint: 'http://x', keys: { p256dh: 'a', auth: 'b' } } }, alice));
      assert.equal(res.status, 400);

      // alice e bob isolati
      res = await fetch(base + '/api/push/subscribe', json({ subscription: { endpoint: 'https://push.example.com/sub/bob1', keys: { p256dh: 'BPdh', auth: 'au' } } }, bob));
      assert.equal(res.status, 200);

      res = await fetch(base + '/api/push/unsubscribe', json({ endpoint: sub.endpoint }, alice));
      data = (await res.json()) as { success?: boolean; subscriptions: number };
      assert.equal(data.subscriptions, 0);
      assert.ok(fs.existsSync(path.join(dir, 'user_media', 'alice', '.push.json')));
    });

    // ============== 🔗 CONDIVISIONI PUBBLICHE TEMPORANEE ==============
    await t.test('share pubblico: crea, apri, scarica media, revoca, 404 su token errato', async () => {
      const sharedFile = await uploadPng(alice, pngA);

      const res = await fetch(base + '/api/shares/create', json({ filenames: [sharedFile], expiresInHours: 24, label: 'Test' }, alice));
      assert.equal(res.status, 200);
      const created = (await res.json()) as { success: boolean; url: string };
      assert.ok(created.success && created.url.startsWith('/share/'));
      const token = created.url.split('/share/')[1];

      // vista pubblica senza cookie
      const page = await get(created.url);
      assert.equal(page.status, 200);
      const html = await page.text();
      assert.ok(html.includes('share-grid'));
      // media pubblico
      const mediaRes = await get(`${created.url}/media/${encodeURIComponent(sharedFile)}`);
      assert.equal(mediaRes.status, 200);
      const body = Buffer.from(await mediaRes.arrayBuffer());
      assert.ok(body.equals(pngA), 'il media pubblico dev\'essere identico all\'originale');

      // file NON in condivisione → 404
      const intruder = await get(`${created.url}/media/${encodeURIComponent(await uploadPng(alice, pngDiff))}`);
      assert.equal(intruder.status, 404);

      // token errato → 404
      const wrong = await get('/share/' + '0'.repeat(48));
      assert.equal(wrong.status, 404);

      // lista personale + revoca
      const listRes = await get('/api/shares', alice);
      const list = (await listRes.json()) as { shares: Array<{ id: string; label: string }> };
      assert.equal(list.shares.length, 1);
      assert.equal(list.shares[0].label, 'Test');
      const delRes = await fetch(base + '/api/shares/delete', json({ id: list.shares[0].id }, alice));
      assert.equal(delRes.status, 200);
      const revokedPage = await get(created.url);
      assert.equal(revokedPage.status, 404, 'link revocato deve rispondere 404');

      // nessun file → 400
      const bad = await fetch(base + '/api/shares/create', json({ filenames: [] }, alice));
      assert.equal(bad.status, 400);
    });

    await t.test('share protetto da password: lock, unlock, cookie', async () => {
      const sharedFile = await uploadPng(alice, pngACopy);
      const res = await fetch(base + '/api/shares/create', json({ filenames: [sharedFile], password: 'segreta', expiresInHours: 1 }, alice));
      const { url } = (await res.json()) as { url: string };
      const token = url.split('/share/')[1];

      // senza password → 401 con pagina di sblocco
      const locked = await fetch(base + url, { redirect: 'manual' });
      assert.equal(locked.status, 401);
      assert.ok((await locked.text()).includes('Password'));

      // password errata → 401
      const wrongPw = await fetch(base + url + '/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'sbagliata' }),
        redirect: 'manual',
      });
      assert.equal(wrongPw.status, 401);

      // password giusta → redirect + cookie
      const unlocked = await fetch(base + url + '/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'segreta' }),
        redirect: 'manual',
      });
      assert.ok([302, 303].includes(unlocked.status));
      const cookie = unlocked.headers.get('set-cookie')!.split(';')[0];
      assert.ok(cookie.startsWith('pc_share_'));

      const page = await fetch(base + url, { headers: { Cookie: cookie } });
      assert.equal(page.status, 200);
    });

    // ============== 👥 ALBUM MULTI-UTENTE ==============
    await t.test('album multi-utente: share viewer, accesso media, contributor upload, revoke', async () => {
      const photo = await uploadPng(alice, pngA);
      let res = await fetch(base + '/api/albums/create', json({ name: 'Vacanze' }, alice));
      assert.equal(res.status, 200);
      res = await fetch(base + '/api/albums/assign', json({ filenames: [photo], album: 'Vacanze' }, alice));
      assert.equal(res.status, 200);

      // utente inesistente → 404; album inesistente → 404
      res = await fetch(base + '/api/albums/share', json({ album: 'Vacanze', username: 'nosuchuser' }, alice));
      assert.equal(res.status, 404);
      res = await fetch(base + '/api/albums/share', json({ album: 'Nope', username: 'bob' }, alice));
      assert.equal(res.status, 404);

      // condividi con bob (viewer)
      res = await fetch(base + '/api/albums/share', json({ album: 'Vacanze', username: 'bob', role: 'viewer' }, alice));
      assert.equal(res.status, 200);
      const sharedResp = (await res.json()) as { shareId: string };
      const shareId = sharedResp.shareId;

      // bob lo vede in sharedWithMe
      res = await get('/api/albums/shared', bob);
      const shared = (await res.json()) as { sharedWithMe: Array<{ id: string; owner: string; album: string; role: string }> };
      const entry = shared.sharedWithMe.find((s) => s.id === shareId);
      assert.ok(entry && entry.owner === 'alice' && entry.album === 'Vacanze' && entry.role === 'viewer');

      // bob lista i media e scarica la foto decifrata
      res = await get(`/api/shared-albums/${shareId}/media`, bob);
      const mediaList = (await res.json()) as { items: Array<{ filename: string }> };
      assert.ok(mediaList.items.some((i) => i.filename === photo));
      const fileRes = await fetch(`${base}/api/shared-albums/${shareId}/file/${encodeURIComponent(photo)}`, { headers: { Cookie: bob } });
      assert.equal(fileRes.status, 200);
      assert.ok(Buffer.from(await fileRes.arrayBuffer()).equals(pngA));

      // viewer non può caricare
      const formDenied = new FormData();
      formDenied.append('file[]', new Blob([new Uint8Array(pngDiff)]), 'x.png');
      const denied = await fetch(base + `/api/shared-albums/${shareId}/upload`, { method: 'POST', headers: { Cookie: bob }, body: formDenied });
      assert.equal(denied.status, 403);

      // file fuori album → 403
      const otherPhoto = await uploadPng(alice, pngDiff);
      const outOfAlbum = await fetch(`${base}/api/shared-albums/${shareId}/file/${encodeURIComponent(otherPhoto)}`, { headers: { Cookie: bob } });
      assert.equal(outOfAlbum.status, 403);

      // promuovi bob a contributor → upload ok
      res = await fetch(base + '/api/albums/share', json({ album: 'Vacanze', username: 'bob', role: 'contributor' }, alice));
      assert.equal(res.status, 200);
      const formOk = new FormData();
      formOk.append('file[]', new Blob([new Uint8Array(pngDiff)]), 'contrib.png');
      const upRes = await fetch(base + `/api/shared-albums/${shareId}/upload`, { method: 'POST', headers: { Cookie: bob }, body: formOk });
      assert.equal(upRes.status, 200);
      const upData = (await upRes.json()) as { uploadedFilenames: string[]; items: Array<{ filename: string }> };
      assert.equal(upData.uploadedFilenames.length, 1);
      assert.ok(upData.items.some((i) => i.filename === upData.uploadedFilenames[0]));

      // il file ora appartiene ad alice, nell'album Vacanze
      res = await get('/api/session', alice);
      const aliceSess = (await res.json()) as { fileAlbums: Record<string, string>; mediaFiles: Array<{ filename: string }> };
      assert.equal(aliceSess.fileAlbums[upData.uploadedFilenames[0]], 'Vacanze');

      // revoke → bob perde accesso
      res = await fetch(base + '/api/albums/unshare', json({ album: 'Vacanze', username: 'bob' }, alice));
      assert.equal(res.status, 200);
      res = await get(`/api/shared-albums/${shareId}/media`, bob);
      assert.equal(res.status, 404);
    });
  } finally {
    child.kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 200));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
