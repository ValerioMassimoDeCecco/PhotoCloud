import { Router, Request, Response, NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { encryptFileAsync } from '../lib/crypto';
import { streamDecryptedVaultFile } from '../lib/mediaStreamer';
import { unwrapSecret } from '../lib/vaultStorage';
import {
  PublicShareRecord,
  SHARE_TOKEN_REGEX,
  createPublicShare,
  incrementShareDownloadCount,
  loadAlbumShares,
  loadPublicShares,
  resolveShareByToken,
  saveAlbumShares,
  savePublicShares,
  upsertAlbumShare,
  verifySharePassword,
} from '../lib/sharing';
import {
  renderShareErrorPage,
  renderSharePage,
  renderSharePasswordPage,
} from '../lib/sharePage';
import {
  UPLOAD_FOLDER,
  SessionData,
  isValidVaultFilename,
  isValidAlbumName,
  parseCookies,
  requireAuth,
  getSession,
  findUser,
  loadUserAlbums,
  saveUserAlbums,
  isShareUnlockRateLimited,
  getServerSecret,
  shareUnlockCookieValue,
  listAlbumSharedFiles,
  notifyUserAsync,
  upload,
  readUploadedFileBuffer,
  cleanupUploadedFiles,
} from '../lib/serverContext';

function isShareUnlocked(req: Request, record: PublicShareRecord): boolean {
  if (!record.passwordHash) return true;
  const cookies = parseCookies(req.headers.cookie);
  return (
    cookies[`pc_share_${record.id.slice(0, 16)}`] ===
    shareUnlockCookieValue(
      // Il client conosce solo il token; ricostruiamo il check dal token in URL
      String(req.params.token || '')
    )
  );
}

function resolveAlbumShareForUser(
  req: Request,
  sess: SessionData
): { record: ReturnType<typeof loadAlbumShares>[string]; role: 'owner' | 'viewer' | 'contributor' } | null {
  const shareId = String(req.params.shareId || '');
  if (!/^[0-9a-f]{32,64}$/.test(shareId)) return null;
  const all = loadAlbumShares(UPLOAD_FOLDER);
  const record = all[shareId];
  if (!record) return null;
  const albumsData = loadUserAlbums(record.owner);
  if (!albumsData.albums.includes(record.album)) return null;
  if (record.owner === sess.username) return { record, role: 'owner' };
  const role = record.participants[sess.username];
  if (!role) return null;
  return { record, role };
}

export function createSharingRouter(): Router {
  const router = Router();

  // ==========================================================================
  // v1.4.0 — CONDIVISIONI PUBBLICHE TEMPORANEE (link opachi, revocabili)
  // ==========================================================================
  router.post('/api/shares/create', requireAuth, (req: Request, res: Response) => {
    const { session: sess, userFolder } = req.auth!;
    const rawFilenames: unknown[] = Array.isArray(req.body?.filenames) ? req.body.filenames : [];
    const filenames = rawFilenames
      .filter((f): f is string => isValidVaultFilename(f))
      .filter((f) => fs.existsSync(path.join(userFolder, f)))
      .slice(0, 500);
    if (filenames.length === 0) {
      res.status(400).json({ error: 'Nessun file valido selezionato' });
      return;
    }
    const expiresInHoursRaw = Number(req.body?.expiresInHours);
    const expiresInHours =
      Number.isFinite(expiresInHoursRaw) && expiresInHoursRaw > 0
        ? Math.min(expiresInHoursRaw, 24 * 365)
        : 72;
    const maxDownloadsRaw = Number(req.body?.maxDownloads);
    const maxDownloads =
      Number.isFinite(maxDownloadsRaw) && maxDownloadsRaw > 0 ? Math.min(maxDownloadsRaw, 100000) : null;
    const password = typeof req.body?.password === 'string' ? req.body.password.slice(0, 128) : '';

    const { token, record } = createPublicShare(UPLOAD_FOLDER, getServerSecret(), {
      owner: sess.username,
      ownerApiKey: sess.apiKey,
      filenames,
      label: typeof req.body?.label === 'string' ? req.body.label : '',
      expiresInHours,
      password,
      maxDownloads,
    });

    res.json({
      success: true,
      url: `/share/${token}`,
      expiresAt: record.expiresAt,
      count: record.filenames.length,
    });
  });

  router.get('/api/shares', requireAuth, (req: Request, res: Response) => {
    const { session: sess } = req.auth!;
    const all = loadPublicShares(UPLOAD_FOLDER);
    const mine = Object.values(all)
      .filter((s) => s.owner === sess.username)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((s) => ({
        id: s.id,
        filenames: s.filenames,
        label: s.label,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        expired: s.expiresAt > 0 && s.expiresAt <= Date.now(),
        hasPassword: !!s.passwordHash,
        maxDownloads: s.maxDownloads,
        downloadCount: s.downloadCount,
      }));
    res.json({ shares: mine });
  });

  router.post('/api/shares/delete', requireAuth, (req: Request, res: Response) => {
    const { session: sess } = req.auth!;
    const id = String(req.body?.id || '');
    if (!/^[0-9a-f]{64}$/.test(id)) {
      res.status(400).json({ error: 'ID condivisione non valido' });
      return;
    }
    const all = loadPublicShares(UPLOAD_FOLDER);
    const rec = all[id];
    if (!rec || rec.owner !== sess.username) {
      res.status(404).json({ error: 'Condivisione non trovata' });
      return;
    }
    delete all[id];
    savePublicShares(UPLOAD_FOLDER, all);
    res.json({ success: true });
  });

  // ==========================================================================
  // v1.4.0 — PAGINE PUBBLICHE DI CONDIVISIONE (senza autenticazione)
  // ==========================================================================
  router.get('/share/:token', (req: Request, res: Response) => {
    const token = String(req.params.token || '');
    if (!SHARE_TOKEN_REGEX.test(token)) {
      res.status(404).setHeader('Content-Type', 'text/html; charset=utf-8').send(renderShareErrorPage('invalid'));
      return;
    }
    const resolved = resolveShareByToken(UPLOAD_FOLDER, token);
    if ('error' in resolved) {
      res
        .status(resolved.error === 'expired' ? 410 : resolved.error === 'exhausted' ? 410 : 404)
        .setHeader('Content-Type', 'text/html; charset=utf-8')
        .send(renderShareErrorPage(resolved.error));
      return;
    }
    const { record } = resolved;
    if (record.passwordHash && !isShareUnlocked(req, record)) {
      res.status(401).setHeader('Content-Type', 'text/html; charset=utf-8').send(renderSharePasswordPage(token));
      return;
    }
    record.filenames = record.filenames.filter((f) =>
      fs.existsSync(path.join(UPLOAD_FOLDER, record.owner, f))
    );
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(
      renderSharePage({
        token,
        filenames: record.filenames,
        label: record.label,
        owner: record.owner,
        expiresAt: record.expiresAt,
      })
    );
  });

  router.post('/share/:token/unlock', (req: Request, res: Response) => {
    const token = String(req.params.token || '');
    if (!SHARE_TOKEN_REGEX.test(token)) {
      res.status(404).setHeader('Content-Type', 'text/html; charset=utf-8').send(renderShareErrorPage('invalid'));
      return;
    }
    const clientIp = String(req.ip || req.socket.remoteAddress || 'unknown');
    if (isShareUnlockRateLimited(clientIp)) {
      res
        .status(429)
        .setHeader('Content-Type', 'text/html; charset=utf-8')
        .send(renderSharePasswordPage(token, 'Troppi tentativi. Riprova tra qualche minuto.'));
      return;
    }
    const resolved = resolveShareByToken(UPLOAD_FOLDER, token);
    if ('error' in resolved) {
      res.status(410).setHeader('Content-Type', 'text/html; charset=utf-8').send(renderShareErrorPage(resolved.error));
      return;
    }
    const password = typeof req.body?.password === 'string' ? req.body.password.slice(0, 128) : '';
    if (!verifySharePassword(resolved.record, password)) {
      res
        .status(401)
        .setHeader('Content-Type', 'text/html; charset=utf-8')
        .send(renderSharePasswordPage(token, 'Password errata.'));
      return;
    }
    res.setHeader(
      'Set-Cookie',
      `pc_share_${resolved.id.slice(0, 16)}=${shareUnlockCookieValue(token)}; Path=/share/${token}; HttpOnly; SameSite=Lax; Max-Age=86400${req.secure ? '; Secure' : ''}`
    );
    res.redirect(`/share/${token}`);
  });

  router.get('/share/:token/media/:filename', async (req: Request, res: Response) => {
    const token = String(req.params.token || '');
    if (!SHARE_TOKEN_REGEX.test(token)) {
      res.status(404).send('Link non valido');
      return;
    }
    const resolved = resolveShareByToken(UPLOAD_FOLDER, token);
    if ('error' in resolved) {
      res.status(410).send('Link scaduto o non valido');
      return;
    }
    const { id, record } = resolved;
    if (record.passwordHash && !isShareUnlocked(req, record)) {
      res.status(401).send('Password richiesta');
      return;
    }
    const filename = String(req.params.filename);
    if (!isValidVaultFilename(filename) || !record.filenames.includes(filename)) {
      res.status(404).send('File non condiviso');
      return;
    }
    const ownerFolder = path.join(UPLOAD_FOLDER, record.owner);
    const safeFilepath = path.resolve(ownerFolder, filename);
    if (!safeFilepath.startsWith(path.resolve(ownerFolder) + path.sep) || !fs.existsSync(safeFilepath)) {
      res.status(404).send('File non trovato');
      return;
    }
    const apiKey = unwrapSecret(getServerSecret(), record.keyWrap);
    if (!apiKey) {
      res.status(500).send('Condivisione non decifrabile');
      return;
    }
    const isExplicitDownload = req.query.download === '1' || req.query.download === 'true';
    await streamDecryptedVaultFile(req, res, {
      filePath: safeFilepath,
      filename,
      apiKey,
      isExplicitDownload,
      onBeforeSend: isExplicitDownload ? () => incrementShareDownloadCount(UPLOAD_FOLDER, id) : undefined,
    });
  });

  // ==========================================================================
  // v1.4.0 — ALBUM MULTI-UTENTE (condivisione tra utenti registrati)
  // ==========================================================================
  router.post('/api/albums/share', requireAuth, (req: Request, res: Response) => {
    const { session: sess } = req.auth!;
    const albumName = String(req.body?.album || '').trim();
    const targetUser = String(req.body?.username || '').trim();
    const role = req.body?.role === 'contributor' ? 'contributor' : 'viewer';
    if (!isValidAlbumName(albumName)) {
      res.status(400).json({ error: 'Nome album non valido' });
      return;
    }
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(targetUser) || targetUser === sess.username) {
      res.status(400).json({ error: 'Utente destinatario non valido' });
      return;
    }
    if (!findUser(targetUser)) {
      res.status(404).json({ error: `Utente "${targetUser}" inesistente su questo server` });
      return;
    }
    const data = loadUserAlbums(sess.username);
    if (!data.albums.includes(albumName)) {
      res.status(404).json({ error: 'Album non trovato' });
      return;
    }
    const record = upsertAlbumShare(
      UPLOAD_FOLDER,
      getServerSecret(),
      sess.username,
      albumName,
      sess.apiKey,
      targetUser,
      role
    );
    notifyUserAsync(
      targetUser,
      '📁 Album condiviso con te',
      `${sess.username} ha condiviso l'album "${albumName}" (${role === 'contributor' ? 'puoi anche caricare' : 'sola lettura'}).`,
      'photocloud-album-share'
    );
    res.json({ success: true, shareId: record.id, participants: record.participants });
  });

  router.post('/api/albums/unshare', requireAuth, (req: Request, res: Response) => {
    const { session: sess } = req.auth!;
    const albumName = String(req.body?.album || '').trim();
    const targetUser = String(req.body?.username || '').trim();
    const all = loadAlbumShares(UPLOAD_FOLDER);
    let changed = false;
    for (const rec of Object.values(all)) {
      if (rec.owner !== sess.username || rec.album !== albumName) continue;
      if (targetUser) {
        if (delete rec.participants[targetUser]) changed = true;
      } else {
        delete all[rec.id];
        changed = true;
      }
    }
    if (changed) saveAlbumShares(UPLOAD_FOLDER, all);
    res.json({ success: changed });
  });

  router.get('/api/albums/shared', requireAuth, (req: Request, res: Response) => {
    const { session: sess } = req.auth!;
    const all = loadAlbumShares(UPLOAD_FOLDER);
    const ownedByMe: Array<Record<string, unknown>> = [];
    const sharedWithMe: Array<Record<string, unknown>> = [];
    for (const rec of Object.values(all)) {
      if (rec.owner === sess.username) {
        const albumsData = loadUserAlbums(rec.owner);
        if (!albumsData.albums.includes(rec.album)) continue;
        ownedByMe.push({
          id: rec.id,
          album: rec.album,
          participants: rec.participants,
          createdAt: rec.createdAt,
          itemCount: listAlbumSharedFiles(rec.owner, rec.album).length,
        });
      } else if (rec.participants[sess.username]) {
        const albumsData = loadUserAlbums(rec.owner);
        if (!albumsData.albums.includes(rec.album)) continue;
        sharedWithMe.push({
          id: rec.id,
          owner: rec.owner,
          album: rec.album,
          role: rec.participants[sess.username],
          createdAt: rec.createdAt,
          itemCount: listAlbumSharedFiles(rec.owner, rec.album).length,
        });
      }
    }
    res.json({ ownedByMe, sharedWithMe });
  });

  router.get('/api/shared-albums/:shareId/media', requireAuth, (req: Request, res: Response) => {
    const { session: sess } = req.auth!;
    const resolved = resolveAlbumShareForUser(req, sess);
    if (!resolved) {
      res.status(404).json({ error: 'Album condiviso non trovato o accesso negato' });
      return;
    }
    const { record, role } = resolved;
    res.json({
      id: record.id,
      owner: record.owner,
      album: record.album,
      role,
      items: listAlbumSharedFiles(record.owner, record.album),
    });
  });

  router.get('/api/shared-albums/:shareId/file/:filename', async (req: Request, res: Response) => {
    const sess = getSession(req);
    if (!sess) {
      res.status(403).send('Accesso negato');
      return;
    }
    const resolved = resolveAlbumShareForUser(req, sess);
    if (!resolved) {
      res.status(404).send('Album condiviso non trovato o accesso negato');
      return;
    }
    const { record } = resolved;
    const filename = String(req.params.filename);
    if (!isValidVaultFilename(filename)) {
      res.status(403).send('Accesso non autorizzato.');
      return;
    }
    const albumsData = loadUserAlbums(record.owner);
    if (albumsData.fileAlbums[filename] !== record.album) {
      res.status(403).send('File non appartenente a questo album condiviso');
      return;
    }
    const ownerFolder = path.resolve(UPLOAD_FOLDER, record.owner);
    const safeFilepath = path.resolve(ownerFolder, filename);
    if (!safeFilepath.startsWith(ownerFolder + path.sep) || !fs.existsSync(safeFilepath)) {
      res.status(404).send('File non trovato');
      return;
    }
    const apiKey = unwrapSecret(getServerSecret(), record.keyWrap);
    if (!apiKey) {
      res.status(500).send('Album condiviso non decifrabile');
      return;
    }
    await streamDecryptedVaultFile(req, res, {
      filePath: safeFilepath,
      filename,
      apiKey,
    });
  });

  router.post(
    '/api/shared-albums/:shareId/upload',
    requireAuth,
    (req: Request, res: Response, next: NextFunction) => {
      upload.array('file[]')(req, res, (err: unknown) => {
        if (err) {
          cleanupUploadedFiles(req);
          res.status(400).json({ error: 'Upload non valido' });
          return;
        }
        next();
      });
    },
    async (req: Request, res: Response) => {
      try {
        const { session: sess } = req.auth!;
        const resolved = resolveAlbumShareForUser(req, sess);
        if (!resolved || resolved.role !== 'contributor') {
          res.status(403).json({ error: 'Solo i collaboratori possono caricare in questo album' });
          return;
        }
        const files = req.files as Express.Multer.File[] | undefined;
        if (!files || files.length === 0) {
          res.status(400).json({ error: 'Nessun file' });
          return;
        }
        const { record } = resolved;
        const apiKey = unwrapSecret(getServerSecret(), record.keyWrap);
        if (!apiKey) {
          res.status(500).json({ error: 'Album condiviso non decifrabile' });
          return;
        }
        const ownerFolder = path.join(UPLOAD_FOLDER, record.owner);
        const uploadedFilenames: string[] = [];
        for (const file of files) {
          const rawOrig = path.basename(file.originalname || `file_${Date.now()}`);
          const ext = path.extname(rawOrig) || '.bin';
          let filename = '';
          let filepath = '';
          while (true) {
            filename = `${crypto.randomBytes(8).toString('hex')}${ext}`;
            filepath = path.join(ownerFolder, filename);
            if (!fs.existsSync(filepath)) break;
          }
          const rawBuf = readUploadedFileBuffer(file);
          const encrypted = await encryptFileAsync(rawBuf, apiKey);
          await fs.promises.writeFile(filepath, encrypted);
          uploadedFilenames.push(filename);
        }
        const albumsData = loadUserAlbums(record.owner);
        for (const fn of uploadedFilenames) {
          albumsData.fileAlbums[fn] = record.album;
        }
        saveUserAlbums(record.owner, albumsData);
        notifyUserAsync(
          record.owner,
          '📥 Nuovo contenuto condiviso',
          `${sess.username} ha caricato ${uploadedFilenames.length} file nell'album "${record.album}".`,
          'photocloud-album-upload'
        );
        res.json({
          success: true,
          uploadedCount: uploadedFilenames.length,
          uploadedFilenames,
          items: listAlbumSharedFiles(record.owner, record.album),
        });
      } catch (e: unknown) {
        res.status(500).json({ error: `Errore caricamento: ${e instanceof Error ? e.message : String(e)}` });
      } finally {
        cleanupUploadedFiles(req);
      }
    }
  );

  return router;
}
