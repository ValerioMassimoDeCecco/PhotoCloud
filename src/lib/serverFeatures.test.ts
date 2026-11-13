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

    // ================= v1.4.1 — EXIF + MAPPA FOTO GPS =================
    await t.test('v1.4.1: metadati EXIF e mappa interattiva foto GPS', async () => {
      // JPEG sintetico con EXIF (Canon EOS R6, 2023:08:15 14:22:10, f/2.8, ISO 200, 1/125, 50mm, GPS Roma)
      const w16le = (v: number) => { const b = Buffer.allocUnsafe(2); b.writeUInt16LE(v); return b; };
      const w32le = (v: number) => { const b = Buffer.allocUnsafe(4); b.writeUInt32LE(v); return b; };
      const w16be = (v: number) => { const b = Buffer.allocUnsafe(2); b.writeUInt16BE(v); return b; };
      const ent = (tag: number, type: number, count: number, vo: number) =>
        Buffer.concat([w16le(tag), w16le(type), w32le(count), w32le(vo)]);
      const asciiInline = (tag: number, s: string) => {
        const b = Buffer.alloc(12);
        Buffer.concat([w16le(tag), w16le(2), w32le(2)]).copy(b, 0);
        Buffer.from(s + String.fromCharCode(0), 'latin1').copy(b, 8);
        return b;
      };
      const shortInline = (tag: number, v: number) =>
        Buffer.concat([w16le(tag), w16le(3), w32le(1), w16le(v), w16le(0)]);
      const rat = (n: number, d: number) => Buffer.concat([w32le(n), w32le(d)]);

      const make = Buffer.from('Canon', 'latin1');
      const model = Buffer.from('Canon EOS R6', 'latin1');
      const dto = Buffer.from('2023:08:15 14:22:10', 'latin1');
      const ifd0Size = 2 + 4 * 12 + 4;
      const makeOff = 8 + ifd0Size;            // 62
      const modelOff = makeOff + make.length;  // 67
      const exifOff = modelOff + model.length; // 81? no: 67+14=81... ricalcolato sotto
      const exifIfdSize = 2 + 5 * 12 + 4;
      let c = exifOff + exifIfdSize;
      const expOff = c; c += 8;
      const fnumOff = c; c += 8;
      const dtoOff = c; c += dto.length;
      const focalOff = c; c += 8;
      const gpsOff = c;
      const gpsIfdSize = 2 + 6 * 12 + 4;
      let g = gpsOff + gpsIfdSize;
      const latOff = g; g += 24;
      const lonOff = g; g += 24;
      const altOff = g;
      const tiff = Buffer.concat([
        Buffer.from('II', 'latin1'), w16le(42), w32le(8),
        w16le(4),
        ent(0x010f, 2, make.length, makeOff),
        ent(0x0110, 2, model.length, modelOff),
        ent(0x8769, 4, 1, exifOff),
        ent(0x8825, 4, 1, gpsOff),
        w32le(0),
        make, model,
        w16le(5),
        ent(0x829a, 5, 1, expOff),
        ent(0x829d, 5, 1, fnumOff),
        shortInline(0x8827, 200),
        ent(0x9003, 2, dto.length, dtoOff),
        ent(0x920a, 5, 1, focalOff),
        w32le(0),
        rat(1, 125), rat(28, 10), dto, rat(50, 1),
        w16le(6),
        asciiInline(0x0001, 'N'),
        ent(0x0002, 5, 3, latOff),
        asciiInline(0x0003, 'E'),
        ent(0x0004, 5, 3, lonOff),
        ent(0x0005, 1, 1, 0),
        ent(0x0006, 5, 1, altOff),
        w32le(0),
        Buffer.concat([rat(41, 1), rat(53, 1), rat(36, 1)]),
        Buffer.concat([rat(12, 1), rat(29, 1), rat(33, 1)]),
        rat(52, 1),
      ]);
      const payload = Buffer.concat([Buffer.from('Exif' + String.fromCharCode(0) + String.fromCharCode(0), 'latin1'), tiff]);
      const jpegExif = Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
        w16be(payload.length + 2),
        payload,
        Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]),
      ]);

      // Upload del JPEG con EXIF
      const form = new FormData();
      form.append('file[]', new Blob([new Uint8Array(jpegExif)]), 'roma-colosseo.jpg');
      let res = await fetch(base + '/upload?skipList=1', { method: 'POST', headers: { Cookie: alice }, body: form });
      const up = (await res.json()) as { success: boolean; uploadedFilenames: string[] };
      assert.ok(up.success && up.uploadedFilenames[0].endsWith('.jpg'));
      const jpg = up.uploadedFilenames[0];

      // --- /api/exif/<file>: metadati completi ---
      res = await get(`/api/exif/${encodeURIComponent(jpg)}`, alice);
      assert.equal(res.status, 200);
      const exifData = (await res.json()) as {
        supported: boolean;
        exif: {
          camera: string | null; iso: number | null; apertureFNumber: number | null;
          exposureTimeLabel: string | null; focalLengthMm: number | null; hasGps: boolean;
          latitude: number | null; longitude: number | null; altitudeM: number | null;
          dateTimeOriginal: string | null;
        };
      };
      assert.equal(exifData.supported, true);
      assert.equal(exifData.exif.camera, 'Canon EOS R6');
      assert.equal(exifData.exif.iso, 200);
      assert.equal(exifData.exif.apertureFNumber, 2.8);
      assert.equal(exifData.exif.exposureTimeLabel, '1/125');
      assert.equal(exifData.exif.focalLengthMm, 50);
      assert.equal(exifData.exif.dateTimeOriginal, '2023:08:15 14:22:10');
      assert.equal(exifData.exif.hasGps, true);
      assert.ok(exifData.exif.latitude !== null && Math.abs(exifData.exif.latitude - 41.893333) < 0.0001);
      assert.ok(exifData.exif.longitude !== null && Math.abs(exifData.exif.longitude - 12.4925) < 0.0001);
      assert.equal(exifData.exif.altitudeM, 52);

      // guardie: anon 403, nome invalido 400, file assente 404, non-JPEG → supported:false
      assert.equal((await get(`/api/exif/${encodeURIComponent(jpg)}`)).status, 403);
      assert.equal((await get('/api/exif/..%2F..%2Fevil.jpg', alice)).status, 400);
      assert.equal((await get('/api/exif/non-esiste.jpg', alice)).status, 404);
      const pngName = up.uploadedFilenames[0];
      void pngName;
      const pngProbe = (await (await get('/api/session', alice)).json()) as { mediaFiles: Array<{ filename: string }> };
      const somePng = pngProbe.mediaFiles.find((m) => m.filename.endsWith('.png'));
      assert.ok(somePng, 'serve almeno un PNG nel vault di alice');
      res = await get(`/api/exif/${encodeURIComponent(somePng!.filename)}`, alice);
      assert.equal(res.status, 200);
      const pngExif = (await res.json()) as { supported: boolean; exif: { hasGps: boolean } };
      assert.equal(pngExif.supported, false);
      assert.equal(pngExif.exif.hasGps, false);

      // --- /api/map-photos: solo il JPEG con GPS, cache mtime-keyed ---
      res = await get('/api/map-photos', alice);
      assert.equal(res.status, 200);
      const map1 = (await res.json()) as {
        count: number; processed: number; cacheHits: number;
        items: Array<{ filename: string; lat: number; lon: number; album: string }>;
      };
      assert.ok(map1.processed >= 1);
      const found = map1.items.find((i) => i.filename === jpg);
      assert.ok(found, 'il JPEG con GPS deve comparire nella mappa');
      assert.ok(Math.abs(found!.lat - 41.893333) < 0.0001);
      assert.ok(Math.abs(found!.lon - 12.4925) < 0.0001);
      assert.equal(map1.items.some((i) => i.filename.endsWith('.png')), false);
      // bob ha vault separato: zero foto GPS
      const bobMap = (await (await get('/api/map-photos', bob)).json()) as { count: number };
      assert.equal(bobMap.count, 0);
      // seconda chiamata: tutto da cache (.exif.json su disco)
      const map2 = (await (await get('/api/map-photos', alice)).json()) as { cacheHits: number; processed: number };
      assert.ok(map2.cacheHits >= 1 && map2.cacheHits === map2.processed, 'seconda scansione totalmente da cache');
      assert.ok(fs.existsSync(path.join(dir, 'user_media', 'alice', '.exif.json')), 'cache EXIF persistita');

      // --- /map: pagina interattiva con tile OSM, guardata da sessione ---
      res = await get('/map', alice);
      assert.equal(res.status, 200);
      const mapHtml = await res.text();
      assert.ok(mapHtml.includes('id="pc-map"'));
      assert.ok(mapHtml.includes('/static/scripts/map.js'));
      assert.ok(mapHtml.includes('OpenStreetMap'));
      // anonimo: redirect a /
      const anon = await fetch(base + '/map', { redirect: 'manual' });
      assert.equal(anon.status, 302);
    });
  } finally {
    child.kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 200));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
