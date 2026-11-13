import { Router, Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { decryptFileAsync } from '../lib/crypto';
import {
  computePHashHex,
  groupSimilarByHash,
  hammingDistanceHex,
  isPHashSupportedFilename,
} from '../lib/phash';
import { parseNaturalQuery, mediaItemMatchesQuery } from '../lib/nlSearch';
import { isExifParseableFilename, emptyExifMetadata } from '../lib/exif';
import {
  addUserSubscription,
  getVapidPublicKey,
  removeUserSubscription,
} from '../lib/pushService';
import { MediaItem } from '../types';
import {
  requireAuth,
  isValidVaultFilename,
  loadUserFavorites,
  loadPHashCache,
  savePHashCache,
  loadExifCache,
  getExifForVaultFile,
  listMediaFiles,
} from '../lib/serverContext';

export function createIntelligenceRouter(): Router {
  const router = Router();

  // ==========================================================================
  // v1.4.0 — RICORDI ("In questo giorno"): media scattati nello stesso
  // giorno/mese degli anni passati, in base al timestamp originale del file.
  // ==========================================================================
  router.get('/api/memories', requireAuth, (req: Request, res: Response) => {
    const { session: sess, userFolder } = req.auth!;
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const currentDay = now.getDate();

    const allFiles = listMediaFiles(userFolder, sess.username);

    const onThisDay = allFiles
      .filter((m) => {
        if (!m.isMedia) return false;
        const d = new Date(m.timestamp * 1000);
        return d.getMonth() === currentMonth && d.getDate() === currentDay && d.getFullYear() < currentYear;
      })
      .sort((a, b) => b.timestamp - a.timestamp);

    // Raggruppa per anno per le sezioni "N anni fa"
    const byYear = new Map<number, MediaItem[]>();
    for (const item of onThisDay) {
      const year = new Date(item.timestamp * 1000).getFullYear();
      if (!byYear.has(year)) byYear.set(year, []);
      byYear.get(year)!.push(item);
    }
    const sections = [...byYear.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([year, items]) => ({
        year,
        yearsAgo: currentYear - year,
        items,
      }));

    res.json({
      date: `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(currentDay).padStart(2, '0')}`,
      count: onThisDay.length,
      sections,
    });
  });

  // ==========================================================================
  // v1.4.0 — RICERCA IN LINGUAGGIO NATURALE (IT/EN)
  // ==========================================================================
  router.get('/api/search', requireAuth, (req: Request, res: Response) => {
    const { session: sess, userFolder } = req.auth!;
    const rawQuery = String(req.query.q || '').slice(0, 200);
    if (!rawQuery.trim()) {
      res.json({ query: rawQuery, explanation: [], results: [] });
      return;
    }
    const favorites = loadUserFavorites(sess.username);
    const allFiles = listMediaFiles(userFolder, sess.username);
    const parsed = parseNaturalQuery(rawQuery);
    const results = allFiles.filter((item) =>
      mediaItemMatchesQuery(
        { filename: item.filename, timestamp: item.timestamp, isMedia: item.isMedia === true, album: item.album },
        parsed,
        favorites
      )
    );
    res.json({
      query: rawQuery,
      explanation: parsed.explanation,
      count: results.length,
      results,
    });
  });

  // ==========================================================================
  // v1.4.0 — DUPLICATI QUASI IDENTICI (perceptual hash DCT 64-bit)
  // ==========================================================================
  router.post('/api/similar_duplicates', requireAuth, async (req: Request, res: Response) => {
    const { session: sess, userFolder } = req.auth!;
    const thresholdRaw = Number(req.body?.threshold);
    const maxDistance =
      Number.isFinite(thresholdRaw) && thresholdRaw >= 0 ? Math.min(20, Math.floor(thresholdRaw)) : 8;

    if (!fs.existsSync(userFolder)) {
      res.json({ groups: [], scanned: 0, cached: 0 });
      return;
    }
    const mediaFiles = listMediaFiles(userFolder, sess.username).filter((m) =>
      isPHashSupportedFilename(m.filename)
    );

    const cache = loadPHashCache(sess.username);
    const entries: Array<{ filename: string; phash: string }> = [];
    let recomputed = 0;
    let cacheHits = 0;

    for (const m of mediaFiles) {
      const fullPath = path.join(userFolder, m.filename);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }
      const cached = cache.entries[m.filename];
      if (cached && typeof cached.phash === 'string' && Math.abs(cached.mtimeMs - stat.mtimeMs) < 1) {
        entries.push({ filename: m.filename, phash: cached.phash });
        cacheHits++;
        continue;
      }
      try {
        const enc = await fs.promises.readFile(fullPath);
        const dec = await decryptFileAsync(enc, sess.apiKey);
        const phash = await computePHashHex(dec);
        cache.entries[m.filename] = { phash, mtimeMs: stat.mtimeMs };
        entries.push({ filename: m.filename, phash });
        recomputed++;
      } catch {
        // immagine non decodificabile (es. HEIC): ignorata dalla scansione
      }
    }

    // Ripulisci la cache dai file non più presenti nel vault attivo
    const activeSet = new Set(mediaFiles.map((m) => m.filename));
    for (const key of Object.keys(cache.entries)) {
      if (!activeSet.has(key)) delete cache.entries[key];
    }
    savePHashCache(sess.username, cache);

    const grouped = groupSimilarByHash(entries, maxDistance).map((group) => {
      const sorted = [...group].sort((a, b) => a.filename.localeCompare(b.filename, 'it'));
      return {
        filenames: sorted.map((g) => g.filename),
        distances: sorted.map((g) => hammingDistanceHex(sorted[0].phash, g.phash)),
      };
    });

    res.json({
      groups: grouped,
      scanned: recomputed,
      cached: cacheHits,
      total: entries.length,
      threshold: maxDistance,
    });
  });

  // ==========================================================================
  // v1.4.0 — NOTIFICHE PUSH WEB (VAPID): iscrizione/disicrizione dispositivi
  // ==========================================================================
  router.get('/api/push/vapid-key', (_req: Request, res: Response) => {
    const key = getVapidPublicKey();
    if (!key) {
      res.status(503).json({ error: 'Notifiche push non disponibili sul server' });
      return;
    }
    res.json({ publicKey: key });
  });

  router.post('/api/push/subscribe', requireAuth, (req: Request, res: Response) => {
    const { userFolder } = req.auth!;
    const sub = req.body?.subscription;
    const endpoint = typeof sub?.endpoint === 'string' ? sub.endpoint : '';
    const p256dh = typeof sub?.keys?.p256dh === 'string' ? sub.keys.p256dh : '';
    const auth = typeof sub?.keys?.auth === 'string' ? sub.keys.auth : '';
    if (!/^https:\/\/.{10,2000}$/.test(endpoint) || !p256dh || !auth) {
      res.status(400).json({ error: 'Subscription push non valida' });
      return;
    }
    const total = addUserSubscription(userFolder, {
      endpoint,
      keys: { p256dh, auth },
      userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
      createdAt: Date.now(),
    });
    res.json({ success: true, subscriptions: total });
  });

  router.post('/api/push/unsubscribe', requireAuth, (req: Request, res: Response) => {
    const { userFolder } = req.auth!;
    const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : '';
    if (!endpoint) {
      res.status(400).json({ error: 'Endpoint mancante' });
      return;
    }
    const remaining = removeUserSubscription(userFolder, endpoint);
    res.json({ success: true, subscriptions: remaining });
  });

  // ==========================================================================
  // v1.4.1 — METADATI EXIF (fotocamera, apertura, ISO, data originale, GPS)
  // ==========================================================================
  router.get('/api/exif/:filename', requireAuth, async (req: Request, res: Response) => {
    const { session: sess, userFolder, trashFolder } = req.auth!;
    const filename = String(req.params.filename || '');
    if (!isValidVaultFilename(filename)) {
      res.status(400).json({ error: 'Nome file non valido' });
      return;
    }
    const fullPath = path.join(userFolder, filename);
    const trashPath = path.join(trashFolder, filename);
    if (!fs.existsSync(fullPath) && !fs.existsSync(trashPath)) {
      res.status(404).json({ error: 'File non trovato' });
      return;
    }
    if (!isExifParseableFilename(filename)) {
      // Forma di risposta stabile: EXIF vuoto per formati non-JPEG
      res.json({ filename, exif: emptyExifMetadata(), supported: false });
      return;
    }
    const exif = await getExifForVaultFile(sess.username, filename, sess.apiKey);
    if (!exif) {
      res.status(404).json({ error: 'File non trovato' });
      return;
    }
    res.json({ filename, exif, supported: true });
  });

  // ==========================================================================
  // v1.4.1 — MAPPA FOTO GPS: elenco dei media con coordinate EXIF
  // ==========================================================================
  router.get('/api/map-photos', requireAuth, async (req: Request, res: Response) => {
    const { session: sess, userFolder } = req.auth!;
    fs.mkdirSync(userFolder, { recursive: true });
    const mediaItems = listMediaFiles(userFolder, sess.username);
    const items: Array<{
      filename: string;
      lat: number;
      lon: number;
      timestamp: number;
      album: string;
    }> = [];
    let processed = 0;
    let cacheHits = 0;
    const cacheBefore = loadExifCache(sess.username);
    for (const m of mediaItems) {
      if (!m.isMedia || !isExifParseableFilename(m.filename)) continue;
      const hadCache = Boolean(cacheBefore.entries[m.filename]);
      const exif = await getExifForVaultFile(sess.username, m.filename, sess.apiKey);
      processed++;
      if (!exif) continue;
      if (hadCache) cacheHits++;
      if (exif.hasGps && exif.latitude !== null && exif.longitude !== null) {
        items.push({
          filename: m.filename,
          lat: exif.latitude,
          lon: exif.longitude,
          timestamp: exif.dateTimeOriginalMs ? exif.dateTimeOriginalMs / 1000 : m.timestamp,
          album: m.album || '',
        });
      }
    }
    res.json({ count: items.length, processed, cacheHits, items });
  });

  return router;
}
