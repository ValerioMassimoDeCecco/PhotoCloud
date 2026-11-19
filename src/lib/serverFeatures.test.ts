import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { Jimp } from 'jimp';

const root = process.cwd();
const loaderUrl = pathToFileURL(path.join(root, 'node_modules/tsx/dist/loader.mjs')).href;

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
    ['--import', loaderUrl, path.join(root, 'server.ts')],
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

    await t.test('share pubblico preview: varianti ?preview=thumb (360px), ?preview=1 (alias) e ?preview=large (1280px) non consumano quota', async () => {
      const sharedPhoto = await uploadPng(alice, pngA);
      const vidForm = new FormData();
      vidForm.append('file[]', new Blob([Buffer.from('00000018667479706d703432', 'hex')]), 'clip.mp4');
      const vidUp = (await (await fetch(base + '/upload', { method: 'POST', headers: { Cookie: alice }, body: vidForm })).json()) as {
        mediaFiles: Array<{ filename: string }>;
      };
      const sharedVideo = vidUp.mediaFiles[0].filename;

      const { Jimp } = await import('jimp');
      const hiResImg = new Jimp({ width: 1600, height: 1200, color: 0x3366ccff });
      const hiResBuf = Buffer.from(await hiResImg.getBuffer('image/jpeg', { quality: 90 }));
      const hiForm = new FormData();
      hiForm.append('file[]', new Blob([hiResBuf], { type: 'image/jpeg' }), 'panorama_1600.jpg');
      const hiUp = (await (await fetch(base + '/upload', { method: 'POST', headers: { Cookie: alice }, body: hiForm })).json()) as {
        mediaFiles: Array<{ filename: string }>;
      };
      const sharedHiRes = hiUp.mediaFiles[0].filename;

      const createHiRes = await fetch(
        base + '/api/shares/create',
        json({ filenames: [sharedPhoto, sharedVideo, sharedHiRes], expiresInHours: 24, label: 'QuotaPreviewVariants', maxDownloads: 1 }, alice)
      );
      assert.equal(createHiRes.status, 200);
      const createdHi = (await createHiRes.json()) as { url: string };

      const pageRes = await get(createdHi.url);
      assert.equal(pageRes.status, 200);
      const pageHtml = await pageRes.text();
      assert.ok(
        pageHtml.includes(`src="${createdHi.url}/media/${encodeURIComponent(sharedPhoto)}?preview=thumb"`),
        'griglia foto deve usare ?preview=thumb'
      );
      assert.ok(
        pageHtml.includes(`data-large-url="${createdHi.url}/media/${encodeURIComponent(sharedPhoto)}?preview=large"`),
        'card deve esporre data-large-url con ?preview=large per il lightbox'
      );
      assert.ok(!pageHtml.includes(`<video preload="metadata"`), 'griglia non deve caricare <video> originale');
      assert.ok(pageHtml.includes('data-max-downloads="1"'), 'pagina deve esporre maxDownloads per bloccare lo streaming video originale nel lightbox');

      const thumbPrevRes = await get(`${createdHi.url}/media/${encodeURIComponent(sharedHiRes)}?preview=thumb`);
      assert.equal(thumbPrevRes.status, 200);
      assert.equal(thumbPrevRes.headers.get('x-content-type-options'), 'nosniff');
      const thumbBuf = Buffer.from(await thumbPrevRes.arrayBuffer());
      const thumbPrevImg = await Jimp.fromBuffer(thumbBuf);
      assert.equal(
        Math.max(thumbPrevImg.bitmap.width, thumbPrevImg.bitmap.height),
        360,
        '?preview=thumb deve ridimensionare immagini grandi a 360px sul lato lungo'
      );

      const aliasPrevRes = await get(`${createdHi.url}/media/${encodeURIComponent(sharedHiRes)}?preview=1`);
      assert.equal(aliasPrevRes.status, 200);
      const aliasBuf = Buffer.from(await aliasPrevRes.arrayBuffer());
      const aliasPrevImg = await Jimp.fromBuffer(aliasBuf);
      assert.equal(
        Math.max(aliasPrevImg.bitmap.width, aliasPrevImg.bitmap.height),
        360,
        '?preview=1 deve essere alias di ?preview=thumb (360px)'
      );
      assert.ok(aliasBuf.equals(thumbBuf), '?preview=1 e ?preview=thumb devono restituire lo stesso derivato');

      const lbPrevRes = await get(`${createdHi.url}/media/${encodeURIComponent(sharedHiRes)}?preview=large`);
      assert.equal(lbPrevRes.status, 200);
      const lbPrevImg = await Jimp.fromBuffer(Buffer.from(await lbPrevRes.arrayBuffer()));
      assert.equal(
        Math.max(lbPrevImg.bitmap.width, lbPrevImg.bitmap.height),
        1280,
        '?preview=large per il lightbox deve ridimensionare immagini grandi a 1280px sul lato lungo'
      );

      const vidPrevRes = await get(`${createdHi.url}/media/${encodeURIComponent(sharedVideo)}?preview=1`);
      assert.equal(vidPrevRes.status, 200);
      assert.equal(vidPrevRes.headers.get('x-content-type-options'), 'nosniff');
      assert.match(String(vidPrevRes.headers.get('content-type')), /image\/svg\+xml/);
      const svgBody = await vidPrevRes.text();
      assert.ok(svgBody.includes(sharedVideo), 'il poster SVG deve includere il nome file escapato');

      const hiList = (await (await get('/api/shares', alice)).json()) as {
        shares: Array<{ id: string; label: string; downloadCount: number }>;
      };
      const hiShareEntry = hiList.shares.find((s) => s.label === 'QuotaPreviewVariants');
      assert.equal(
        hiShareEntry?.downloadCount,
        0,
        'Né ?preview=thumb, né ?preview=1, né ?preview=large devono consumare la quota downloadCount'
      );
    });

    await t.test('share pubblico preview cache: chiave shareId+file+mtime, Cache-Control: private, no-cache, 304 su ETag e 410 dopo revoca o maxDownloads', async () => {
      const sharedPhoto = await uploadPng(alice, pngA);
      const createRes = await fetch(
        base + '/api/shares/create',
        json({ filenames: [sharedPhoto], expiresInHours: 24, label: 'QuotaPreviewCache', maxDownloads: 1 }, alice)
      );
      assert.equal(createRes.status, 200);
      const created = (await createRes.json()) as { url: string };

      const firstPrevRes = await get(`${created.url}/media/${encodeURIComponent(sharedPhoto)}?preview=1`);
      assert.equal(firstPrevRes.status, 200);
      const prevEtag = firstPrevRes.headers.get('etag');
      assert.ok(prevEtag && prevEtag.length > 4, '?preview=1 deve impostare ETag per il derivato cachato');
      const firstPrevBuf = Buffer.from(await firstPrevRes.arrayBuffer());
      assert.ok(!firstPrevBuf.equals(pngA), '?preview=1 deve servire un derivato ridotto, non il buffer originale');

      const listData = (await (await get('/api/shares', alice)).json()) as {
        shares: Array<{ id: string; label: string; downloadCount: number }>;
      };
      const shareEntry = listData.shares.find((s) => s.label === 'QuotaPreviewCache')!;
      assert.ok(
        prevEtag!.includes(shareEntry.id.slice(0, 12)),
        'chiave di cache / ETag preview deve essere legata a shareId+file+mtime'
      );

      const cachedPrevRes = await fetch(`${base}${created.url}/media/${encodeURIComponent(sharedPhoto)}?preview=1`, {
        headers: { 'If-None-Match': prevEtag! },
      });
      assert.equal(cachedPrevRes.status, 304, 'richiesta ?preview=1 con If-None-Match valido deve rispondere 304 dalla cache');

      const revokeRes = await fetch(base + '/api/shares/delete', json({ id: shareEntry.id }, alice));
      assert.equal(revokeRes.status, 200);
      const afterRevokePreviewRes = await fetch(
        `${base}${created.url}/media/${encodeURIComponent(sharedPhoto)}?preview=1`,
        { headers: { 'If-None-Match': prevEtag! } }
      );
      assert.equal(
        afterRevokePreviewRes.status,
        410,
        'dopo revoca, ?preview=1 con If-None-Match valido deve rispondere 410, non 304'
      );

      assert.equal(
        firstPrevRes.headers.get('cache-control'),
        'private, no-cache',
        'risposta ?preview deve avere Cache-Control: private, no-cache'
      );
    });

    await t.test('share pubblico 40 foto non in cache: loading="lazy", onerror backoff (1s,2s,4s), coda Jimp 32 job (oltre -> 503 + Retry-After) e tutte le 40 miniature caricate', async () => {
      const batch40: string[] = [];
      for (let i = 0; i < 40; i++) {
        batch40.push(await uploadPng(alice, pngA));
      }
      const create40Res = await fetch(
        base + '/api/shares/create',
        json({ filenames: batch40, expiresInHours: 24, label: 'Share40Photos' }, alice)
      );
      assert.equal(create40Res.status, 200);
      const created40 = (await create40Res.json()) as { url: string };

      const page40Res = await get(created40.url);
      assert.equal(page40Res.status, 200);
      const page40Html = await page40Res.text();
      assert.ok(
        page40Html.includes('loading="lazy"') && page40Html.includes('onerror=') && page40Html.includes('1000,2000,4000'),
        'La griglia share deve includere loading="lazy" e onerror con retry a backoff (1s, 2s, 4s -> 1000,2000,4000) sulle miniature'
      );

      // Lanciando insieme tutte le 40 miniature (?preview=thumb) e tutte le 40 preview lightbox (?preview=large) non in cache (80 job Jimp distinti > 2 attivi + 32 in coda):
      // - i job oltre 34 in coda ricevono 503 + Retry-After
      // - grazie alla coda da 32 job e al retry a backoff (1s, 2s, 4s), tutte le 40 miniature (e tutte le 40 preview large) risultano caricate (200) entro un timeout ragionevole senza 429 rate-limit
      const all40ThumbUrls = batch40.map(
        (fn) => `${base}${created40.url}/media/${encodeURIComponent(fn)}?preview=thumb`
      );
      const all40LargeUrls = batch40.map(
        (fn) => `${base}${created40.url}/media/${encodeURIComponent(fn)}?preview=large`
      );
      let saw503WithRetryAfter = false;
      const start40 = Date.now();
      const fetchWithBackoff = async (url: string): Promise<number> => {
        const delays = [1000, 2000, 4000];
        let res = await fetch(url);
        if (res.status === 503) {
          const ra = res.headers.get('retry-after');
          assert.ok(ra && Number(ra) > 0, '503 oltre la coda Jimp deve includere Retry-After');
          saw503WithRetryAfter = true;
        }
        for (let attempt = 0; attempt < delays.length && res.status === 503; attempt++) {
          await new Promise((r) => setTimeout(r, delays[attempt]));
          res = await fetch(`${url}&retry=${attempt + 1}`);
        }
        return res.status;
      };
      const [thumb40Statuses, large40Statuses] = await Promise.all([
        Promise.all(all40ThumbUrls.map((u) => fetchWithBackoff(u))),
        Promise.all(all40LargeUrls.map((u) => fetchWithBackoff(u))),
      ]);
      const elapsed40Ms = Date.now() - start40;
      assert.ok(
        thumb40Statuses.every((s) => s === 200),
        `Tutte le 40 miniature non in cache devono risultare caricate (200) entro il timeout ragionevole (osservato: ${thumb40Statuses.join(',')})`
      );
      assert.ok(
        large40Statuses.every((s) => s === 200),
        `Tutte le 40 preview large (lightbox) devono risultare caricate (200) senza 429 rate-limit (osservato: ${large40Statuses.join(',')})`
      );
      assert.ok(
        elapsed40Ms < 10000,
        `Tutte le 40 miniature + lightbox devono caricarsi entro un timeout ragionevole (<10s, impiegato: ${elapsed40Ms}ms)`
      );
      assert.ok(
        saw503WithRetryAfter,
        'Superando i 32 job in coda Jimp, le richieste eccedenti devono ricevere 503 + Retry-After prima di completarsi al retry'
      );
    });

    await t.test('share pubblico maxDownloads: download originale e Range su file non audio/video consumano quota fino a 410', async () => {
      const sharedPhoto = await uploadPng(alice, pngA);
      const createRes = await fetch(
        base + '/api/shares/create',
        json({ filenames: [sharedPhoto], expiresInHours: 24, label: 'Quota2', maxDownloads: 2 }, alice)
      );
      assert.equal(createRes.status, 200);
      const created = (await createRes.json()) as { url: string };

      const prevRes = await get(`${created.url}/media/${encodeURIComponent(sharedPhoto)}?preview=1`);
      assert.equal(prevRes.status, 200);
      const prevEtag = prevRes.headers.get('etag')!;

      const getShareCount = async () => {
        const listRes = await get('/api/shares', alice);
        const list = (await listRes.json()) as { shares: Array<{ id: string; label: string; downloadCount: number }> };
        return list.shares.find((s) => s.label === 'Quota2')?.downloadCount ?? -1;
      };
      assert.equal(await getShareCount(), 0);

      // 1. Richiesta inline all'originale CONTA come download (1/2)
      const origRes = await get(`${created.url}/media/${encodeURIComponent(sharedPhoto)}`);
      assert.equal(origRes.status, 200);
      assert.ok(Buffer.from(await origRes.arrayBuffer()).equals(pngA));
      assert.equal(await getShareCount(), 1, 'richiesta inline all\'originale deve incrementare downloadCount a 1');

      // 2. Per file NON audio/video (foto), Range start>0 CONTA come download (2/2)
      const rangePhotoMidRes = await fetch(`${base}${created.url}/media/${encodeURIComponent(sharedPhoto)}`, {
        headers: { Range: 'bytes=4-15' },
      });
      assert.equal(rangePhotoMidRes.status, 206);
      assert.equal(await getShareCount(), 2, 'Per file non audio/video Range con start > 0 deve incrementare downloadCount a 2');

      // 3. Quota esaurita (2/2) → 410 Gone (anche per ?preview=1 con If-None-Match valido)
      const exhaustedRes = await get(`${created.url}/media/${encodeURIComponent(sharedPhoto)}`);
      assert.equal(exhaustedRes.status, 410, 'dopo il raggiungimento di maxDownloads deve rispondere 410');
      const exhaustedPrev304Check = await fetch(
        `${base}${created.url}/media/${encodeURIComponent(sharedPhoto)}?preview=1`,
        { headers: { 'If-None-Match': prevEtag } }
      );
      assert.equal(
        exhaustedPrev304Check.status,
        410,
        'dopo esaurimento maxDownloads, ?preview=1 con If-None-Match valido deve dare 410, non 304'
      );

      // 4. bytes=1- ripetuto su foto con maxDownloads: 1 → 410 al secondo tentativo
      const createOneRes = await fetch(
        base + '/api/shares/create',
        json({ filenames: [sharedPhoto], expiresInHours: 24, label: 'QuotaBytes1', maxDownloads: 1 }, alice)
      );
      assert.equal(createOneRes.status, 200);
      const createdOne = (await createOneRes.json()) as { url: string };
      const firstBytes1 = await fetch(`${base}${createdOne.url}/media/${encodeURIComponent(sharedPhoto)}`, {
        headers: { Range: 'bytes=1-' },
      });
      assert.equal(firstBytes1.status, 206);
      const secondBytes1 = await fetch(`${base}${createdOne.url}/media/${encodeURIComponent(sharedPhoto)}`, {
        headers: { Range: 'bytes=1-' },
      });
      assert.equal(secondBytes1.status, 410, 'bytes=1- ripetuto con maxDownloads:1 deve rispondere 410 al secondo tentativo');
    });

    await t.test('share pubblico playback grant: budget 1.5x file size in 2h blocca bytes=1- ripetuto con cookie (410) e consente seek legittimi (206)', async () => {
      const vid20Form = new FormData();
      const vid20Bytes = Buffer.concat([Buffer.from('00000018667479706d703432', 'hex'), Buffer.alloc(8, 0xaa)]); // 20 byte -> budget 1.5x = 30 byte
      vid20Form.append('file[]', new Blob([vid20Bytes]), 'clip20.mp4');
      const vid20Up = (await (await fetch(base + '/upload', { method: 'POST', headers: { Cookie: alice }, body: vid20Form })).json()) as {
        mediaFiles: Array<{ filename: string }>;
      };
      const sharedVideo20 = vid20Up.mediaFiles[0].filename;

      // Test (a): bytes=1- ripetuto CON cookie valido, maxDownloads: 1 → 410 dopo il budget (1.5x = 30 byte)
      const createBudget1Res = await fetch(
        base + '/api/shares/create',
        json({ filenames: [sharedVideo20], expiresInHours: 24, label: 'QuotaVideoBudget1', maxDownloads: 1 }, alice)
      );
      assert.equal(createBudget1Res.status, 200);
      const createdBudget1 = (await createBudget1Res.json()) as { url: string };

      const firstWithGrantRes = await fetch(`${base}${createdBudget1.url}/media/${encodeURIComponent(sharedVideo20)}`, {
        headers: { Range: 'bytes=1-' },
      });
      assert.equal(firstWithGrantRes.status, 206);
      const budgetCookie = (firstWithGrantRes.headers.get('set-cookie') || '').split(';')[0];
      assert.ok(budgetCookie.startsWith('pc_pb='), 'deve emettere il cookie pc_pb al primo download');

      const repeatBytes1WithCookieRes = await fetch(
        `${base}${createdBudget1.url}/media/${encodeURIComponent(sharedVideo20)}`,
        { headers: { Range: 'bytes=1-', Cookie: budgetCookie } }
      );
      assert.equal(
        repeatBytes1WithCookieRes.status,
        410,
        'Test (a): bytes=1- ripetuto CON cookie valido e maxDownloads:1 deve rispondere 410 una volta superato il budget di 1.5x'
      );

      // Test (b): seek legittimi entro il budget 1.5x (30 byte) → 206 senza consumare quota
      const createVidRes = await fetch(
        base + '/api/shares/create',
        json({ filenames: [sharedVideo20], expiresInHours: 24, label: 'QuotaVideo2', maxDownloads: 2 }, alice)
      );
      assert.equal(createVidRes.status, 200);
      const createdVid = (await createVidRes.json()) as { url: string };
      const getVidShareCount = async () => {
        const listRes = await get('/api/shares', alice);
        const list = (await listRes.json()) as { shares: Array<{ label: string; downloadCount: number }> };
        return list.shares.find((s) => s.label === 'QuotaVideo2')?.downloadCount ?? -1;
      };

      const vidStartRes = await fetch(`${base}${createdVid.url}/media/${encodeURIComponent(sharedVideo20)}`, {
        headers: { Range: 'bytes=0-3' },
      });
      assert.equal(vidStartRes.status, 206);
      assert.equal(await getVidShareCount(), 1);
      const pbCookie = (vidStartRes.headers.get('set-cookie') || '').split(';')[0];
      assert.ok(pbCookie.startsWith('pc_pb='), 'deve emettere il cookie di playback pc_pb per il visitatore');

      for (const rangeSpec of ['bytes=4-11', 'bytes=12-19', 'bytes=2-9']) {
        const seekRes = await fetch(`${base}${createdVid.url}/media/${encodeURIComponent(sharedVideo20)}`, {
          headers: { Range: rangeSpec, Cookie: pbCookie },
        });
        assert.equal(seekRes.status, 206, `seek legittimo ${rangeSpec} entro il budget 1.5x deve rispondere 206`);
      }
      assert.equal(await getVidShareCount(), 1, 'Test (b): seek legittimi entro il budget 1.5x non devono consumare quota');

      const vidOtherVisitor = await fetch(`${base}${createdVid.url}/media/${encodeURIComponent(sharedVideo20)}`, {
        headers: { Range: 'bytes=1-' },
      });
      assert.equal(vidOtherVisitor.status, 206);
      assert.equal(await getVidShareCount(), 2, 'Range start>0 senza grant valido per quel visitatore deve contare');
      const vidExhausted = await fetch(`${base}${createdVid.url}/media/${encodeURIComponent(sharedVideo20)}`, {
        headers: { Range: 'bytes=1-' },
      });
      assert.equal(vidExhausted.status, 410, 'dopo esaurimento quota anche Range bytes=1- deve rispondere 410');

      // Test (c): 10 richieste bytes=1- parallele CON cookie valido e maxDownloads:1 → il totale servito (inclusa la 1ª richiesta contata) non deve superare il budget (30B)
      const createParGrantRes = await fetch(
        base + '/api/shares/create',
        json({ filenames: [sharedVideo20], expiresInHours: 24, label: 'QuotaVideoParallelGrant', maxDownloads: 1 }, alice)
      );
      assert.equal(createParGrantRes.status, 200);
      const createdParGrant = (await createParGrantRes.json()) as { url: string };

      // Prima richiesta contata: bytes=0-3 (4 byte su 20 -> restano 26 byte di budget su 30)
      const initGrantRes = await fetch(`${base}${createdParGrant.url}/media/${encodeURIComponent(sharedVideo20)}`, {
        headers: { Range: 'bytes=0-3' },
      });
      assert.equal(initGrantRes.status, 206);
      const initContentLength = Number(initGrantRes.headers.get('content-length') || '0');
      assert.equal(initContentLength, 4);
      const initServedBytes = Buffer.from(await initGrantRes.arrayBuffer()).length;
      assert.equal(initServedBytes, 4);
      const parGrantCookie = (initGrantRes.headers.get('set-cookie') || '').split(';')[0];
      assert.ok(parGrantCookie.startsWith('pc_pb='));

      // 10 richieste bytes=1- (19 byte ciascuna) in parallelo con cookie valido: solo 1 può rientrare nel budget (4 + 19 = 23 <= 30), le altre 9 devono dare 410
      const parGrantResponses = await Promise.all(
        Array.from({ length: 10 }, () =>
          fetch(`${base}${createdParGrant.url}/media/${encodeURIComponent(sharedVideo20)}`, {
            headers: { Range: 'bytes=1-', Cookie: parGrantCookie },
          })
        )
      );
      const parContentLength206 = parGrantResponses.reduce((acc, r) => {
        if (r.status !== 206) return acc;
        const cl = Number(r.headers.get('content-length') || '0');
        assert.ok(Number.isFinite(cl) && cl > 0, 'Ogni 206 deve esporre Content-Length valido');
        return acc + cl;
      }, 0);
      const totalContentLength206 = initContentLength + parContentLength206;
      assert.ok(
        totalContentLength206 <= 30,
        `Somma dei Content-Length dei 206 (${totalContentLength206}B) deve essere <= budget 1.5x (30B)`
      );

      const parGrantStatuses = parGrantResponses.map((r) => r.status).sort((a, b) => a - b);
      assert.deepEqual(
        parGrantStatuses,
        [206, 410, 410, 410, 410, 410, 410, 410, 410, 410],
        `Su 10 richieste bytes=1- parallele con cookie valido, solo 1 deve rispondere 206 e 9 devono rispondere 410 (osservato: ${parGrantStatuses.join(',')})`
      );
      const parBodies = await Promise.all(
        parGrantResponses.map(async (r) => (r.status === 206 ? Buffer.from(await r.arrayBuffer()).length : 0))
      );
      const totalServedWithFirst = initServedBytes + parBodies.reduce((acc, n) => acc + n, 0);
      assert.equal(totalServedWithFirst, 23);

      // Verifica che la prenotazione/controllo dei byte avvenga sincronamente PRIMA della decifratura:
      // se il payload cifrato su disco viene corrotto (mantenendo l'header/dimensione), una richiesta oltre budget deve fallire subito con 410 senza tentare decryptFileAsync (che darebbe 500)
      const vaultFilePath = path.join(dir, 'user_media', 'alice', sharedVideo20);
      const origEnc = fs.readFileSync(vaultFilePath);
      const corruptedEnc = Buffer.from(origEnc);
      corruptedEnc[corruptedEnc.length - 1] ^= 0xff;
      fs.writeFileSync(vaultFilePath, corruptedEnc);
      try {
        const overBudgetBeforeDecrypt = await fetch(
          `${base}${createdParGrant.url}/media/${encodeURIComponent(sharedVideo20)}`,
          { headers: { Range: 'bytes=1-', Cookie: parGrantCookie } }
        );
        assert.equal(
          overBudgetBeforeDecrypt.status,
          410,
          'Il controllo/prenotazione del playback grant deve avvenire sincronamente PRIMA di decryptFileAsync (410, non 500)'
        );
      } finally {
        fs.writeFileSync(vaultFilePath, origEnc);
      }

      // Test (d): connessione interrotta a metà — i byte prenotati restano consumati (fail-closed, niente rimborso gratuito del budget)
      const createDropRes = await fetch(
        base + '/api/shares/create',
        json({ filenames: [sharedVideo20], expiresInHours: 24, label: 'QuotaVideoDropMid', maxDownloads: 1 }, alice)
      );
      assert.equal(createDropRes.status, 200);
      const createdDrop = (await createDropRes.json()) as { url: string };

      const dropInitRes = await fetch(`${base}${createdDrop.url}/media/${encodeURIComponent(sharedVideo20)}`, {
        headers: { Range: 'bytes=0-3' },
      });
      assert.equal(dropInitRes.status, 206);
      await dropInitRes.arrayBuffer();
      const dropCookie = (dropInitRes.headers.get('set-cookie') || '').split(';')[0];
      assert.ok(dropCookie.startsWith('pc_pb='));

      // Seconda richiesta (12B: bytes=4-15) interrotta subito lato client alla ricezione della risposta (abort/drop TCP a metà)
      const http = await import('node:http');
      await new Promise<void>((resolve) => {
        const target = new URL(`${base}${createdDrop.url}/media/${encodeURIComponent(sharedVideo20)}`);
        const reqDrop = http.request(
          {
            hostname: target.hostname,
            port: Number(target.port),
            path: target.pathname,
            method: 'GET',
            headers: { Range: 'bytes=4-15', Cookie: dropCookie },
          },
          (resDrop) => {
            assert.equal(resDrop.statusCode, 206);
            resDrop.destroy();
            resolve();
          }
        );
        reqDrop.on('error', () => resolve());
        reqDrop.end();
      });

      // Attendi un tick perché il server completi l'eventuale gestione del close, poi verifica che i 12B restino prenotati:
      // 4B (init) + 12B (aborted, non rimborsati) = 16B usati su 30B -> 4B (bytes=16-19 -> 20B <= 30B) passano con 206, mentre bytes=1- (19B -> 39B > 30B) deve dare 410
      await new Promise((r) => setTimeout(r, 40));
      const postDropSmallRes = await fetch(`${base}${createdDrop.url}/media/${encodeURIComponent(sharedVideo20)}`, {
        headers: { Range: 'bytes=16-19', Cookie: dropCookie },
      });
      assert.equal(postDropSmallRes.status, 206, 'Seek entro il budget residuo dopo connessione caduta deve riuscire (206)');

      const postDropOverRes = await fetch(`${base}${createdDrop.url}/media/${encodeURIComponent(sharedVideo20)}`, {
        headers: { Range: 'bytes=1-', Cookie: dropCookie },
      });
      assert.equal(
        postDropOverRes.status,
        410,
        'I byte prenotati su connessione caduta a metà restano scalati (fail-closed): superare il budget residuo deve rispondere 410'
      );
    });

    await t.test('share pubblico maxDownloads concorrenza: incremento atomico sotto richieste parallele con maxDownloads: 1', async () => {
      const sharedPhoto = await uploadPng(alice, pngA);
      const createRaceRes = await fetch(
        base + '/api/shares/create',
        json({ filenames: [sharedPhoto], expiresInHours: 24, label: 'QuotaParallel1', maxDownloads: 1 }, alice)
      );
      assert.equal(createRaceRes.status, 200);
      const createdRace = (await createRaceRes.json()) as { url: string };
      const parallelResponses = await Promise.all(
        Array.from({ length: 6 }, () => fetch(`${base}${createdRace.url}/media/${encodeURIComponent(sharedPhoto)}`))
      );
      const statuses = parallelResponses.map((r) => r.status).sort();
      assert.deepEqual(
        statuses,
        [200, 410, 410, 410, 410, 410],
        `Con maxDownloads:1 e 6 richieste parallele, solo 1 deve ricevere 200 e 5 devono ricevere 410 (osservato: ${statuses.join(',')})`
      );
      const raceList = (await (await get('/api/shares', alice)).json()) as {
        shares: Array<{ label: string; downloadCount: number }>;
      };
      const raceCount = raceList.shares.find((s) => s.label === 'QuotaParallel1')?.downloadCount ?? -1;
      assert.equal(raceCount, 1, 'downloadCount finale dopo richieste parallele non deve superare maxDownloads (1)');
    });

    await t.test('share pubblico Range: unità diversa da bytes= ignorata (200 e conta download), bytes= malformato/fuori limite risponde 416', async () => {
      const sharedPhoto = await uploadPng(alice, pngA);
      const createRangeUnitRes = await fetch(
        base + '/api/shares/create',
        json({ filenames: [sharedPhoto], expiresInHours: 24, label: 'QuotaRangeUnits', maxDownloads: 1 }, alice)
      );
      assert.equal(createRangeUnitRes.status, 200);
      const createdRangeUnit = (await createRangeUnitRes.json()) as { url: string };

      const shareBadBytesRange = await fetch(`${base}${createdRangeUnit.url}/media/${encodeURIComponent(sharedPhoto)}`, {
        headers: { Range: 'bytes=99999999-' },
      });
      assert.equal(shareBadBytesRange.status, 416, 'bytes= fuori limite su /share/:token/media/:filename deve rispondere 416');

      const shareMalformedBytesRange = await fetch(`${base}${createdRangeUnit.url}/media/${encodeURIComponent(sharedPhoto)}`, {
        headers: { Range: 'bytes=abc-def' },
      });
      assert.equal(shareMalformedBytesRange.status, 416, 'bytes= malformato su /share/:token/media/:filename deve rispondere 416');

      const shareNonBytesRange = await fetch(`${base}${createdRangeUnit.url}/media/${encodeURIComponent(sharedPhoto)}`, {
        headers: { Range: 'items=0-5' },
      });
      assert.equal(
        shareNonBytesRange.status,
        200,
        'Range con unità diversa da bytes= su /share/:token/media/:filename deve essere ignorato e rispondere 200'
      );
      const afterNonBytesList = (await (await get('/api/shares', alice)).json()) as {
        shares: Array<{ label: string; downloadCount: number }>;
      };
      assert.equal(
        afterNonBytesList.shares.find((s) => s.label === 'QuotaRangeUnits')?.downloadCount,
        1,
        'Risposta 200 con Range non-bytes ignorato deve contare come download'
      );
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

      // Range fuori limite o malformato su album condiviso → 416 Range Not Satisfiable
      const badRangeRes = await fetch(`${base}/api/shared-albums/${shareId}/file/${encodeURIComponent(photo)}`, {
        headers: { Cookie: bob, Range: 'bytes=99999999-100000000' },
      });
      assert.equal(badRangeRes.status, 416, 'Range invalido su album condiviso deve rispondere 416');
      assert.equal(badRangeRes.headers.get('content-range'), `bytes */${pngA.length}`);

      const nonBytesUnitRangeRes = await fetch(`${base}/api/shared-albums/${shareId}/file/${encodeURIComponent(photo)}`, {
        headers: { Cookie: bob, Range: 'items=0-5' },
      });
      assert.equal(nonBytesUnitRangeRes.status, 200, 'Range con unità diversa da bytes= deve essere ignorato e rispondere 200');

      const multiRangeInvalidRes = await fetch(`${base}/api/shared-albums/${shareId}/file/${encodeURIComponent(photo)}`, {
        headers: { Cookie: bob, Range: 'bytes=0-2, 999999-' },
      });
      assert.equal(multiRangeInvalidRes.status, 416, 'Multi-range non supportato o con intervallo invalido deve rispondere 416');

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
